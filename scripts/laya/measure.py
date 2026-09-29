"""Measure an ONNX export against the fp32 PyTorch reference on the fixed sample set.

    python scripts/laya/measure.py ref   <checkpoint dir>                  -> measure-ref.json
    python scripts/laya/measure.py NAME  <checkpoint dir> <model.onnx>     -> measure-NAME.json
    python scripts/laya/measure.py compare                                 -> the table

One variant per process, so the RSS figures are that variant's own (they include Python, numpy
and, because ONNXAgent imports transformers, torch: ~400 MB that BMM does not have). CPU,
2 intra-op threads and one state per call — what BMM does. Top-1 = the argmax option (P(true)
>= 0.5 for yes/no); max |dp| = the largest difference on any probability of any answer.
"""
import glob
import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")
os.environ.setdefault("HF_HUB_OFFLINE", "1")
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))


def run(name, ckpt, onnx_path=None):
    import psutil
    from samples import all_items

    proc = psutil.Process()
    items = all_items()
    t0 = time.perf_counter()
    if onnx_path is None:
        import torch
        torch.set_num_threads(2)
        from laya.agent import Agent
        agent = Agent(ckpt, compile=False, device="cpu")
    else:
        import onnxruntime as ort
        from laya.onnx_agent import ONNXAgent
        agent = ONNXAgent(ckpt, onnx_path=onnx_path)
        so = ort.SessionOptions()
        so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        so.intra_op_num_threads = 2
        so.inter_op_num_threads = 1
        agent.session = ort.InferenceSession(onnx_path, sess_options=so, providers=["CPUExecutionProvider"])
    load_s = time.perf_counter() - t0
    agent.predict(items[0]["state"], items[0]["questions"])
    out, lat = {}, []
    for it in items:
        t = time.perf_counter()
        r = agent.predict(it["state"], it["questions"])
        lat.append((time.perf_counter() - t) * 1000.0)
        ans = {}
        for qid, a in r["answers"].items():
            if a["type"] == "choice":
                ans[qid] = {"type": "choice", "top": a["choice"], "probs": a["probabilities"]}
            else:
                ans[qid] = {"type": "noul", "top": "true" if a["noul"] >= 0.5 else "false",
                            "probs": {"false": round(1 - a["noul"], 4), "true": a["noul"]}}
        out[it["id"]] = ans
    mi = proc.memory_info()
    doc = {"name": name, "model": onnx_path, "size": os.path.getsize(onnx_path) if onnx_path else None,
           "load_s": load_s, "rss": mi.rss, "peak": getattr(mi, "peak_wset", 0), "lat_ms": lat, "answers": out}
    json.dump(doc, open("measure-%s.json" % name, "w", encoding="utf-8"), ensure_ascii=False)


def compare():
    ref = json.load(open("measure-ref.json", encoding="utf-8"))
    for f in sorted(glob.glob("measure-*.json")):
        r = json.load(open(f, encoding="utf-8"))
        if r["name"] == "ref":
            continue
        n = agree = 0
        maxd, flips = 0.0, []
        for iid, ans in ref["answers"].items():
            for qid, a in ans.items():
                b = r["answers"][iid][qid]
                n += 1
                if a["top"] == b["top"]:
                    agree += 1
                else:
                    flips.append("%s/%s" % (iid, qid))
                maxd = max([maxd] + [abs(v - b["probs"][k]) for k, v in a["probs"].items()])
        lat = sorted(r["lat_ms"])
        print("%-16s %7.1f MB  top-1 %d/%d = %.2f%%  max|dp| %.4f  median %.0f ms  p90 %.0f ms  RSS %.0f MB  flips: %s" % (
            r["name"], (r["size"] or 0) / 1e6, agree, n, 100.0 * agree / n, maxd, lat[len(lat) // 2],
            lat[int(len(lat) * 0.9)], r["rss"] / 2**20, ", ".join(flips) or "-"))


if __name__ == "__main__":
    if sys.argv[1] == "compare":
        compare()
    elif sys.argv[1] == "ref":
        run("ref", sys.argv[2])
    else:
        run(sys.argv[1], sys.argv[2], sys.argv[3])
