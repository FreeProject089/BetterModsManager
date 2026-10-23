"""Should BMM ship a SECOND Laya pack? Re-ask the exact questions of the eval set with another
checkpoint, so the Rust bench can score its answers with the production combination rules.

    # 1. the questions, as the bench asked them (and the int8 multilingual pack's answers):
    BMM_LAYA_EVAL_QS=calls.json cargo test --release --bin better-mods-manager measure_pipeline -- --ignored --nocapture
    # 2. the same questions to other checkpoints (fp32 PyTorch, the `laya` 0.3.21 package):
    python scripts/laya/compare_packs.py calls.json <checkpoint dir> out.json [--lang en]
    python scripts/laya/compare_packs.py --mean a.json b.json mean.json     (an ensemble of two)
    # 3. score them with the bench's own rules (the calls are replayed in order):
    BMM_LAYA_EVAL_REPLAY=out.json BMM_LAYA_EVAL_LANG=en cargo test … measure_pipeline …

Checkpoints: convaiinnovations/laya (English, ModernBERT-large, 512 tokens) and
convaiinnovations/laya-multilingual (mmBERT-base, 1024 tokens), from huggingface.co at the
revisions in laya-model.lock.json (`router`).
"""
import json
import os
import sys
import time
import warnings

warnings.filterwarnings("ignore")
os.environ.setdefault("HF_HUB_OFFLINE", "1")


def items_lang(path):
    here = os.path.dirname(os.path.abspath(__file__))
    ev = json.load(open(os.path.join(here, "..", "..", "src-tauri", "tests", "laya_eval.json"), encoding="utf-8"))
    return {i["id"]: i["lang"] for i in ev["items"]}


def run(calls_path, ckpt, out_path, lang=None):
    import torch
    torch.set_num_threads(int(os.environ.get("THREADS", "4")))
    from laya.agent import Agent
    agent = Agent(ckpt, compile=False, device="cpu")
    langs = items_lang(calls_path)
    calls = json.load(open(calls_path, encoding="utf-8"))
    if lang:
        calls = [c for c in calls if langs.get(c["item"]) == lang]
    out = []
    t0 = time.perf_counter()
    for n, c in enumerate(calls):
        qs = {}
        for q in c["questions"]:
            d = {"type": q["type"], "instructions": q["instructions"]}
            if q["criteria"]:
                d["criteria"] = {k: v for k, v in q["criteria"]}
            qs[q["id"]] = d
        r = agent.predict({"body": c["text"]}, qs)
        probs = []
        for q in c["questions"]:
            a = r["answers"][q["id"]]
            if a["type"] == "choice":
                probs.append([a["probabilities"][k] for k, _ in q["criteria"]])
            else:
                probs.append([1 - a["noul"], a["noul"]])
        out.append({"item": c["item"], "probs": probs})
        if n % 25 == 0:
            print("%d/%d calls, %.0f s" % (n, len(calls), time.perf_counter() - t0), flush=True)
    json.dump(out, open(out_path, "w", encoding="utf-8"))
    print("wrote", out_path, len(out), "calls in %.0f s" % (time.perf_counter() - t0))


def mean(a_path, b_path, out_path):
    a = json.load(open(a_path, encoding="utf-8"))
    b = json.load(open(b_path, encoding="utf-8"))
    assert len(a) == len(b), "the two runs did not ask the same calls"
    out = []
    for x, y in zip(a, b):
        assert x["item"] == y["item"]
        out.append({"item": x["item"], "probs": [[(p + q) / 2 for p, q in zip(u, v)] for u, v in zip(x["probs"], y["probs"])]})
    json.dump(out, open(out_path, "w", encoding="utf-8"))
    print("wrote", out_path)


def native(calls_path, out_path, lang=None):
    """The int8 multilingual pack's own answers (from the bench dump), filtered like the others."""
    langs = items_lang(calls_path)
    calls = json.load(open(calls_path, encoding="utf-8"))
    out = [{"item": c["item"], "probs": c["probs"]} for c in calls if not lang or langs.get(c["item"]) == lang]
    json.dump(out, open(out_path, "w", encoding="utf-8"))
    print("wrote", out_path, len(out))


if __name__ == "__main__":
    args = [a for a in sys.argv[1:] if not a.startswith("--lang")]
    lang = None
    for i, a in enumerate(sys.argv):
        if a == "--lang":
            lang = sys.argv[i + 1]
            args.remove(lang)
    if args[0] == "--mean":
        mean(args[1], args[2], args[3])
    elif args[0] == "--native":
        native(args[1], args[2], lang)
    else:
        run(args[0], args[1], args[2], lang)
