"""Build the « Laya hors ligne » model pack: laya-offline-<n>.zip.

    python scripts/laya/build_pack.py --out <dir> [--checkpoint <dir>] [--work <dir>]

Run in a venv with `pip install "laya[onnx]==0.3.21" torch` (CPU torch is enough). Steps:

1. Checkpoint: convaiinnovations/laya-multilingual at the revision pinned in laya-model.lock.json,
   every file checked against its SHA-256 (downloaded from huggingface.co unless --checkpoint).
2. Export: the model the package runs (`laya.agent.Agent(...).model`, a `laya.common.DecisionModel`)
   to ONNX opset 18 with the input/output names `ONNXAgent` uses. This is the package's own
   scripts/export_onnx.py with the one fix its laya-ts exporter already carries: batch-2 dummies
   and explicit `torch.export.Dim`s. The single-graph script traces batch 1 with `dynamic_axes`,
   which the dynamo exporter (torch >= 2.9) ignores — the graph then only runs one question per
   call. Verified against torch at several shapes before anything else happens.
3. Quantize (the variant measured best, see the lock file): every MatMul weight to 8-bit,
   block 32, weight-only with fp32 compute (MatMulNBits, accuracy_level 1); the 256 000 x 768
   embedding table to int8 with one scale per row (Gather int8 + Gather scale + Mul). The
   package's own `--quantize` recipe (dynamic int8, activations quantized too) agreed with the
   fp32 reference on only 78 % of the sample answers; this one on 98.9 %.
4. ONNX Runtime: Microsoft's official onnxruntime-win-x64 release zip, pinned by SHA-256.
5. Zip, deterministic (sorted names, fixed timestamps), and print the pins for the lock file.
"""
import argparse
import hashlib
import json
import os
import shutil
import sys
import urllib.request
import zipfile

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
LOCK = json.load(open(os.path.join(ROOT, "laya-model.lock.json"), encoding="utf-8"))


def sha256(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for chunk in iter(lambda: f.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def fetch(url, dest, want_sha):
    if not (os.path.exists(dest) and sha256(dest) == want_sha):
        os.makedirs(os.path.dirname(dest), exist_ok=True)
        print("download", url)
        urllib.request.urlretrieve(url, dest)
    got = sha256(dest)
    if got != want_sha:
        raise SystemExit("%s: sha256 %s, expected %s" % (dest, got, want_sha))


def checkpoint(dir_):
    rev = LOCK["model"]["revision"]
    base = "https://huggingface.co/%s/resolve/%s/" % (LOCK["model"]["id"], rev)
    for rel, sha in LOCK["model"]["files"].items():
        fetch(base + rel, os.path.join(dir_, rel), sha)
    return dir_


def export(ckpt, out):
    import numpy as np
    import torch
    from laya.agent import Agent

    model = Agent(ckpt, compile=False, device="cpu").model.eval().float()
    B, S = 2, 16
    ids = torch.randint(5, 1000, (B, S), dtype=torch.long)
    att = torch.ones((B, S), dtype=torch.long)
    mpos = torch.tensor([[1, 5]] * B, dtype=torch.long)
    mmask = torch.ones((B, 2), dtype=torch.bool)
    qtype = torch.tensor([0, 2], dtype=torch.long)
    batch = torch.export.Dim("batch", min=1, max=64)
    seq = torch.export.Dim("seq", min=8, max=4096)
    # >= 2: DecisionModel.forward branches on `p.size(-1) >= 2`; BMM never asks a 1-option question.
    markers = torch.export.Dim("markers", min=2, max=64)
    dyn = ({0: batch, 1: seq}, {0: batch, 1: seq}, {0: batch, 1: markers}, {0: batch, 1: markers}, {0: batch})
    torch.onnx.export(model, (ids, att, mpos, mmask, qtype), out,
                      input_names=["input_ids", "attention_mask", "marker_pos", "marker_mask", "qtype"],
                      output_names=["logits", "act_logits"], dynamic_shapes=dyn, opset_version=18, external_data=True)

    import onnxruntime as ort
    sess = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
    for (b, s, k) in [(1, 16, 2), (2, 16, 2), (4, 84, 10), (3, 300, 7), (2, 700, 3)]:
        g = torch.Generator().manual_seed(b * 1000 + s)
        x = torch.randint(5, 20000, (b, s), generator=g)
        a = torch.ones((b, s), dtype=torch.long)
        if b > 1:
            a[-1, s // 2:] = 0
        mp = torch.stack([torch.arange(1, 1 + 3 * k, 3)] * b)
        mm = torch.ones((b, k), dtype=torch.bool)
        qt = torch.tensor([i % 3 for i in range(b)])
        with torch.inference_mode():
            rl, _ = model(x, a, mp, mm, qt)
        ol, _ = sess.run(None, {"input_ids": x.numpy(), "attention_mask": a.numpy(), "marker_pos": mp.numpy(),
                                "marker_mask": mm.numpy(), "qtype": qt.numpy()})
        d = float(np.abs(ol - rl.numpy()).max())
        print("verify b=%d s=%d k=%d  max|dlogit| %.2e" % (b, s, k, d))
        if d > 1e-3:
            raise SystemExit("export does not match torch")


def quantize(src, out):
    import numpy as np
    import onnx
    from onnx import TensorProto, helper, numpy_helper
    from onnxruntime.quantization.matmul_nbits_quantizer import DefaultWeightOnlyQuantConfig, MatMulNBitsQuantizer
    from onnxruntime.quantization.quant_utils import QuantFormat

    m = onnx.load(src)
    del m.graph.value_info[:]
    inits = {i.name: i for i in m.graph.initializer}
    emb = next(n for n in m.graph.node if n.op_type == "Gather" and n.input[0] in inits
               and len(inits[n.input[0]].dims) == 2 and inits[n.input[0]].dims[0] > 100000)
    t = inits[emb.input[0]]
    w = numpy_helper.to_array(t).astype(np.float32)
    scale = np.abs(w).max(axis=1) / 127.0
    scale[scale == 0] = 1.0
    q = np.clip(np.round(w / scale[:, None]), -127, 127).astype(np.int8)
    qi = numpy_helper.from_array(q, t.name + "_q")
    si = numpy_helper.from_array(scale.astype(np.float32)[:, None], t.name + "_scale")
    m.graph.initializer.remove(t)
    m.graph.initializer.extend([qi, si])
    o, idx = emb.output[0], emb.input[1]
    emb.input[0] = qi.name
    emb.output[0] = o + "_q"
    m.graph.node.extend([
        helper.make_node("Gather", [si.name, idx], [o + "_s"], axis=0, name="emb_scale_gather"),
        helper.make_node("Cast", [o + "_q"], [o + "_qf"], to=TensorProto.FLOAT, name="emb_cast"),
        helper.make_node("Mul", [o + "_qf", o + "_s"], [o], name="emb_dequant"),
    ])
    cfg = DefaultWeightOnlyQuantConfig(block_size=32, is_symmetric=True, accuracy_level=1, quant_format=QuantFormat.QOperator,
                                       op_types_to_quantize=("MatMul",), quant_axes=(("MatMul", 0),), bits=8)
    qz = MatMulNBitsQuantizer(m, bits=8, block_size=32, is_symmetric=True, accuracy_level=1,
                              op_types_to_quantize=("MatMul",), quant_axes=(("MatMul", 0),), algo_config=cfg)
    qz.process()
    m = qz.model.model
    produced = {i.name for i in m.graph.input} | {i.name for i in m.graph.initializer} | {""}
    nodes, pending = [], list(m.graph.node)
    while pending:
        moved = False
        for nd in list(pending):
            if all(x in produced for x in nd.input):
                nodes.append(nd)
                produced.update(nd.output)
                pending.remove(nd)
                moved = True
        if not moved:
            raise SystemExit("graph cannot be ordered")
    del m.graph.node[:]
    m.graph.node.extend(nodes)
    onnx.save(m, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--checkpoint")
    ap.add_argument("--work", default=os.path.join(ROOT, "tmp", "laya-build"))
    a = ap.parse_args()
    os.makedirs(a.work, exist_ok=True)
    ckpt = a.checkpoint or checkpoint(os.path.join(a.work, "checkpoint"))
    fp32 = os.path.join(a.work, "laya_fp32.onnx")
    if not os.path.exists(fp32):
        export(ckpt, fp32)
    pack = os.path.join(a.work, "pack")
    shutil.rmtree(pack, ignore_errors=True)
    os.makedirs(pack)
    quantize(fp32, os.path.join(pack, "laya.onnx"))
    shutil.copy(os.path.join(ckpt, "tokenizer", "tokenizer.json"), os.path.join(pack, "tokenizer.json"))
    shutil.copy(os.path.join(ckpt, "rl_agent_config.json"), os.path.join(pack, "rl_agent_config.json"))

    ortz = os.path.join(a.work, "onnxruntime.zip")
    fetch(LOCK["onnxruntime"]["url"], ortz, LOCK["onnxruntime"]["sha256"])
    top = "onnxruntime-win-x64-%s/" % LOCK["onnxruntime"]["version"]
    with zipfile.ZipFile(ortz) as z:
        for inner, name in ((top + "lib/onnxruntime.dll", "onnxruntime.dll"), (top + "LICENSE", "LICENSE-onnxruntime.txt"),
                            (top + "ThirdPartyNotices.txt", "ThirdPartyNotices-onnxruntime.txt")):
            with z.open(inner) as src, open(os.path.join(pack, name), "wb") as dst:
                shutil.copyfileobj(src, dst)
    shutil.copy(os.path.join(HERE, "LICENSE-laya.txt"), os.path.join(pack, "LICENSE-laya.txt"))

    files = {n: {"sha256": sha256(os.path.join(pack, n)), "size": os.path.getsize(os.path.join(pack, n))}
             for n in ("laya.onnx", "tokenizer.json", "rl_agent_config.json", "onnxruntime.dll")}
    meta = {"format": 1, "model": LOCK["model"]["id"], "revision": LOCK["model"]["revision"], "variant": LOCK["variant"],
            "onnxruntime": LOCK["onnxruntime"]["version"], "files": files,
            "licenses": {"laya-multilingual": "Apache-2.0", "onnxruntime": "MIT"}}
    with open(os.path.join(pack, "pack.json"), "w", encoding="utf-8", newline="\n") as f:
        json.dump(meta, f, indent=1, sort_keys=True)

    os.makedirs(a.out, exist_ok=True)
    zpath = os.path.join(a.out, LOCK["pack"]["file"])
    with zipfile.ZipFile(zpath, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as z:
        for name in sorted(os.listdir(pack)):
            info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            info.external_attr = 0o644 << 16
            with open(os.path.join(pack, name), "rb") as f:
                z.writestr(info, f.read())
    out = {"pack": {"sha256": sha256(zpath), "size": os.path.getsize(zpath)}, "files": files}
    print(json.dumps(out, indent=1))
    drift = [n for n, v in files.items() if LOCK["files"].get(n) != v]
    if LOCK["pack"].get("sha256") != out["pack"]["sha256"]:
        drift.append("pack")
    print("matches laya-model.lock.json" if not drift else "DIFFERS from laya-model.lock.json: %s" % ", ".join(drift))


if __name__ == "__main__":
    sys.exit(main())
