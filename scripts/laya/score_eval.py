"""Calibrate and check the « Laya v2 » combination rules on the raw answers of the eval set.

    BMM_LAYA_EVAL_OUT=raw.json cargo test --release --bin better-mods-manager measure_pipeline -- --ignored --nocapture
    python scripts/laya/score_eval.py raw.json

The weights and thresholds in src-tauri/src/commands/ai_laya.rs are chosen on the EVEN ids of
laya_eval.json and reported on the ODD ids (held out), so the « after » figure is not the set
the numbers were fitted on. The formulas below mirror ai_laya.rs line for line; the Rust test
prints the figures of the shipped constants on the whole set.
"""
import itertools
import json
import sys

LANGS = ["en", "fr", "de", "es", "it", "pt", "ru", "pl", "zh", "ja"]
CATS = ["crash", "bug", "performance", "install", "mod_conflict", "ui", "other"]
SEVS = ["low", "medium", "high", "critical"]


def half(items, parity):
    return [i for i in items if int(i["id"][1:]) % 2 == parity]


def argmax(v):
    return max(range(len(v)), key=lambda i: v[i])


def f1(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 1.0
    r = tp / (tp + fn) if tp + fn else 1.0
    return (2 * p * r / (p + r) if p + r else 0.0), p, r


# ── tags ────────────────────────────────────────────────────────────────────────────────────
def tags_v2(it, w_noul, w_choice, w_lex, thr, k=6, noul_all=False):
    lex, cands = it["lex"], it["cands"]
    ch = it["choice"]
    p_none = ch[-1]
    n = len(cands)
    out = []
    for j, i in enumerate(cands):
        pc = min(ch[j] * n / 2.0, 1.0) * (1.0 - p_none * 0.5)
        pn = it["noul_all"][i]
        out.append((i, w_noul * pn + w_choice * pc + w_lex * lex[i]))
    out.sort(key=lambda x: -x[1])
    return [it["names"][i] for i, p in out if p >= thr][:3]


def tags_old(it):
    r = sorted([(i, p) for i, p in enumerate(it["old_tag_p"]) if p >= 0.5], key=lambda x: -x[1])
    return [it["names"][i] for i, _ in r[:3]]


def score_tags(items, fn):
    tp = fp = fnn = top = 0
    for it in items:
        got, gold = fn(it), it["gold_tags"]
        tp += sum(g in gold for g in got)
        fp += sum(g not in gold for g in got)
        fnn += sum(g not in got for g in gold)
        top += bool(got) and got[0] in gold
    f, p, r = f1(tp, fp, fnn)
    return {"F1": round(f, 3), "P": round(p, 3), "R": round(r, 3), "top1": "%d/%d" % (top, len(items))}


# ── language ────────────────────────────────────────────────────────────────────────────────
def lang_v2(laya, det, thr):
    best = None
    for i, c in enumerate(LANGS):
        pl = laya[i]
        if det is None:
            pd = pl
        else:
            pd = det[1] if det[0] == c else 0.0
        p = 0.5 * pl + 0.5 * pd
        if best is None or p > best[1]:
            best = (c, p)
    return best[0] if best[1] >= thr else None


def acc(pairs):
    n = len(pairs)
    ans = [(g, w) for g, w in pairs if g is not None]
    right = sum(g == w for g, w in ans)
    return {"right": "%d/%d (%.1f%%)" % (right, n, 100 * right / max(n, 1)), "precision": "%.1f%%" % (100 * right / max(len(ans), 1)), "coverage": "%.1f%%" % (100 * len(ans) / max(n, 1))}


# ── duplicates ──────────────────────────────────────────────────────────────────────────────
def dup_v2(it, w, thr, k=3):
    best = None
    for (i, ov), pn in list(zip(it["all"], it["all_noul"]))[:k]:
        p = w * pn + (1 - w) * min(ov, 1.0)
        if best is None or p > best[1]:
            best = (i, p)
    return best[0] if best and best[1] >= thr else None


def dup_old(it):
    a = argmax(it["old"])
    return a if a < len(it["old"]) - 1 else None


def score_dup(items, fn):
    right = sum(fn(it) == it["gold"] for it in items)
    false_dup = sum(fn(it) is not None and fn(it) != it["gold"] for it in items)
    return "%d/%d right, %d false duplicates" % (right, len(items), false_dup)


def main(path):
    raw = json.load(open(path, encoding="utf-8"))
    mods = [r for r in raw if r["task"] == "mod"]
    reps = [r for r in raw if r["task"] == "report"]
    dups = [r for r in raw if r["task"] == "dup"]
    langs = [r for r in raw if r["task"] == "lang"]

    # Tags: grid on even ids.
    grid = []
    for wn, wc in itertools.product([0.0, 0.2, 0.35, 0.5, 0.7], [0.0, 0.2, 0.35, 0.5]):
        wl = round(1 - wn - wc, 2)
        if wl < 0:
            continue
        for thr in [0.25, 0.3, 0.35, 0.4, 0.45, 0.5, 0.55, 0.6]:
            f = score_tags(half(mods, 0), lambda it: tags_v2(it, wn, wc, wl, thr))["F1"]
            grid.append((f, wn, wc, wl, thr))
    grid.sort(reverse=True)
    best = grid[0]
    print("TAGS  best on even ids: F1 %.3f with noul %.2f choice %.2f lex %.2f thr %.2f" % best)
    for name, fn in [("old", tags_old), ("v2 (fitted)", lambda it: tags_v2(it, *best[1:]))]:
        print("   %-12s even %s | odd (held out) %s | all %s" % (name, score_tags(half(mods, 0), fn), score_tags(half(mods, 1), fn), score_tags(mods, fn)))
    for name, args in [("noul only", (1, 0, 0, 0.5)), ("choice only", (0, 1, 0, 0.5)), ("lex only", (0, 0, 1, 0.3))]:
        print("   %-12s all %s" % (name, score_tags(mods, lambda it: tags_v2(it, *args))))

    # nsfw
    old = sum(it["old_nsfw"] == it["gold_nsfw"] for it in mods)
    new = sum((it["nsfw_p"] >= 0.5) == it["gold_nsfw"] for it in mods)
    print("ADULT old %d/%d  new %d/%d" % (old, len(mods), new, len(mods)))

    # language (mods + snippets)
    for thr in [0.3, 0.4, 0.45, 0.5]:
        pm = [(lang_v2(it["lang_laya"], it["lang_det"], thr), it["gold_lang"]) for it in mods]
        ps = [(lang_v2(it["laya"], it["det"], thr), it["gold"]) for it in langs]
        print("LANG  thr %.2f  mods %s  snippets %s" % (thr, acc(pm), acc(ps)))
    print("LANG  old mods %s  snippets %s" % (acc([(LANGS[argmax(it["old_lang"])], it["gold_lang"]) for it in mods]), acc([(LANGS[argmax(it["old"])], it["gold"]) for it in langs])))
    print("LANG  laya-on-prose only mods %s" % acc([(LANGS[argmax(it["lang_laya"])], it["gold_lang"]) for it in mods]))
    print("LANG  detector only mods %s" % acc([((it["lang_det"] or [None])[0], it["gold_lang"]) for it in mods]))

    # reports
    for thr in [0.0, 0.25, 0.3, 0.35, 0.4]:
        pc = [(CATS[argmax(it["cat"])] if max(it["cat"]) >= thr else None, it["gold_cat"]) for it in reps]
        ps = [(SEVS[argmax(it["sev"])] if max(it["sev"]) >= thr else None, it["gold_sev"]) for it in reps]
        print("REPORT thr %.2f  category %s  severity %s" % (thr, acc(pc), acc(ps)))
    print("REPORT old  category %s  severity %s" % (acc([(CATS[argmax(it["old_cat"])], it["gold_cat"]) for it in reps]), acc([(SEVS[argmax(it["old_sev"])], it["gold_sev"]) for it in reps])))

    # duplicates
    dg = []
    for w in [0.0, 0.3, 0.5, 0.6, 0.8, 1.0]:
        for thr in [0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7]:
            r = sum(dup_v2(it, w, thr) == it["gold"] for it in half(dups, 0))
            dg.append((r, w, thr))
    dg.sort(reverse=True)
    _, w, thr = dg[0]
    print("DUP   best on even ids: noul weight %.2f thr %.2f" % (w, thr))
    print("   old  all %s" % score_dup(dups, dup_old))
    print("   v2   even %s | odd (held out) %s | all %s" % (score_dup(half(dups, 0), lambda it: dup_v2(it, w, thr)), score_dup(half(dups, 1), lambda it: dup_v2(it, w, thr)), score_dup(dups, lambda it: dup_v2(it, w, thr))))


if __name__ == "__main__":
    main(sys.argv[1])
