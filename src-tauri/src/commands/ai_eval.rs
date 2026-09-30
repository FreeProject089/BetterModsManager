//! The precision bench for the Laya pipeline: the hand-labelled set `tests/laya_eval.json`
//! (built by `scripts/laya/eval_set.py`), asked the OLD way (the question set BMM shipped
//! before « Laya v2 », kept here verbatim as the baseline) and the NEW way (`ai_laya`, what BMM
//! asks now), scored against the right answers, with the latency of each.
//!
//! Needs the model pack (Settings → Install, or `BMM_LAYA_DIR`), so it is `#[ignore]`d:
//!
//! ```text
//! cargo test --release --bin better-mods-manager measure_pipeline -- --ignored --nocapture
//! ```
//!
//! `BMM_LAYA_EVAL_OUT=<file.json>` also writes every raw probability, which is what
//! `scripts/laya/score_eval.py` calibrates the weights and thresholds on (even ids) and checks
//! them on (odd ids).

use serde_json::{json, Value};
use std::time::Instant;

use crate::commands::ai_core::{self, LayaQuestion};
use crate::commands::ai_embedded;
use crate::commands::ai_laya as L;

const EVAL: &str = include_str!("../../tests/laya_eval.json");

thread_local! {
    /// Every call made, for `BMM_LAYA_EVAL_QS` (the multi-pack comparison re-asks them).
    static CALLS: std::cell::RefCell<Vec<Value>> = const { std::cell::RefCell::new(Vec::new()) };
    static ITEM: std::cell::RefCell<String> = const { std::cell::RefCell::new(String::new()) };
}

thread_local! {
    /// `BMM_LAYA_EVAL_REPLAY`: another checkpoint's answers to the same calls, in order
    /// (scripts/laya/compare_packs.py), scored with the same rules.
    static REPLAY: std::cell::RefCell<Option<(Vec<Value>, usize)>> = std::cell::RefCell::new(
        std::env::var("BMM_LAYA_EVAL_REPLAY").ok().map(|p| (serde_json::from_str::<Vec<Value>>(&std::fs::read_to_string(p).expect("replay file")).expect("replay json"), 0))
    );
}

fn replaying() -> bool {
    REPLAY.with(|r| r.borrow().is_some())
}

/// Every answer's probabilities, in question order. Calls of ≤ 32 questions.
fn ask(text: &str, qs: &[LayaQuestion]) -> Vec<Vec<f64>> {
    let mut out = Vec::new();
    for chunk in qs.chunks(ai_embedded::MAX_QUESTIONS) {
        let q = ai_embedded::to_questions(chunk).expect("questions");
        let replayed = REPLAY.with(|r| {
            let mut r = r.borrow_mut();
            let (calls, i) = r.as_mut()?;
            let c = calls.get(*i).expect("the replay has fewer calls than the bench");
            *i += 1;
            assert_eq!(c["item"].as_str(), Some(ITEM.with(|x| x.borrow().clone())).as_deref(), "replay out of step");
            Some(c["probs"].as_array().unwrap().iter().map(|row| row.as_array().unwrap().iter().map(|x| x.as_f64().unwrap()).collect::<Vec<f64>>()).collect::<Vec<_>>())
        });
        let p = match replayed {
            Some(p) => p,
            None => ai_embedded::predict_raw(text, &q).expect("model pack (BMM_LAYA_DIR)").0,
        };
        CALLS.with(|c| {
            c.borrow_mut().push(json!({
                "item": ITEM.with(|i| i.borrow().clone()),
                "text": text,
                "questions": chunk.iter().map(|(id, k, ins, crit)| json!({ "id": id, "type": k, "instructions": ins, "criteria": crit })).collect::<Vec<_>>(),
                "probs": p,
            }))
        });
        out.extend(p);
    }
    out
}

fn argmax(p: &[f64]) -> usize {
    p.iter().enumerate().fold((0, f64::MIN), |a, (i, v)| if *v > a.1 { (i, *v) } else { a }).0
}

// ── The baseline: the questions BMM asked before, verbatim ──────────────────────────────────

fn legacy_mod_questions(names: &[String]) -> Vec<LayaQuestion<'static>> {
    let mut qs: Vec<LayaQuestion> = Vec::new();
    for (i, name) in names.iter().enumerate().take(ai_core::MAX_TAGS_ASKED) {
        qs.push((format!("tag_{}", i), "noul", format!("Is this game mod about \"{}\"? Answer yes only if the text clearly says so.", name), Vec::new()));
    }
    qs.push(("language".into(), "choice", "In which language is this text written?".into(), L::LANGS.iter().map(|(c, n)| (c.to_string(), n.to_string())).collect()));
    qs.push(("nsfw".into(), "noul", "Does this game mod contain sexual or adult-only content?".into(), Vec::new()));
    qs
}

fn legacy_report_questions() -> Vec<LayaQuestion<'static>> {
    vec![
        ("category".into(), "choice", "What kind of problem does this report describe?".into(), ai_core::REPORT_CATEGORIES.iter().map(|c| (c.to_string(), c.replace('_', " "))).collect()),
        ("severity".into(), "choice", "How severe is the problem for the user?".into(), ai_core::REPORT_SEVERITIES.iter().map(|c| (c.to_string(), c.to_string())).collect()),
    ]
}

fn legacy_dup_question(known: &[String]) -> LayaQuestion<'static> {
    let mut crit: Vec<(String, String)> = known.iter().enumerate().map(|(i, k)| (format!("r{}", i), k.chars().take(200).collect())).collect();
    crit.push(("none".into(), "None of these: a new problem".into()));
    ("duplicate".into(), "choice", "Which earlier report describes the same problem?".into(), crit)
}

// ── Scores ──────────────────────────────────────────────────────────────────────────────────

#[derive(Default, Debug, Clone)]
struct Prf {
    tp: usize,
    fp: usize,
    fn_: usize,
}
impl Prf {
    fn add(&mut self, got: &[String], want: &[String]) {
        for g in got {
            if want.contains(g) { self.tp += 1 } else { self.fp += 1 }
        }
        for w in want {
            if !got.contains(w) {
                self.fn_ += 1
            }
        }
    }
    fn p(&self) -> f64 { if self.tp + self.fp == 0 { 1.0 } else { self.tp as f64 / (self.tp + self.fp) as f64 } }
    fn r(&self) -> f64 { if self.tp + self.fn_ == 0 { 1.0 } else { self.tp as f64 / (self.tp + self.fn_) as f64 } }
    fn f1(&self) -> f64 { let (p, r) = (self.p(), self.r()); if p + r == 0.0 { 0.0 } else { 2.0 * p * r / (p + r) } }
}

/// Accuracy with abstention: `answered` = how many got an answer, `right` = how many of those
/// were right. Coverage = answered / n, precision = right / answered.
#[derive(Default, Debug, Clone)]
struct Acc {
    n: usize,
    answered: usize,
    right: usize,
}
impl Acc {
    fn add(&mut self, got: Option<&str>, want: Option<&str>) {
        self.n += 1;
        if let Some(g) = got {
            self.answered += 1;
            if Some(g) == want {
                self.right += 1;
            }
        }
    }
    fn line(&self) -> String {
        format!(
            "{:>5.1} % right overall ({}/{}), precision {:>5.1} % on the {:>3} answered (coverage {:>5.1} %)",
            100.0 * self.right as f64 / self.n.max(1) as f64,
            self.right,
            self.n,
            100.0 * self.right as f64 / self.answered.max(1) as f64,
            self.answered,
            100.0 * self.answered as f64 / self.n.max(1) as f64
        )
    }
}

/// The dup task: « none » is a real answer (null in the set).
#[derive(Default, Debug, Clone)]
struct Dup {
    n: usize,
    right: usize,
    false_dup: usize,
    missed: usize,
}

#[derive(Default)]
struct Board {
    tags: Prf,
    tag_top1: (usize, usize),
    lang_mod: Acc,
    lang_snip: Acc,
    nsfw: (usize, usize),
    cat: Acc,
    sev: Acc,
    dup: Dup,
    ms: Vec<f64>,
}

fn print(name: &str, b: &Board) {
    let mut ms = b.ms.clone();
    ms.sort_by(|a, c| a.partial_cmp(c).unwrap());
    let q = |f: f64| ms.get(((ms.len() as f64 - 1.0) * f).round() as usize).copied().unwrap_or(0.0);
    eprintln!("── {} ──", name);
    eprintln!("  tags     P {:.3}  R {:.3}  F1 {:.3}  (tp {} fp {} fn {}) · first tag right {}/{}", b.tags.p(), b.tags.r(), b.tags.f1(), b.tags.tp, b.tags.fp, b.tags.fn_, b.tag_top1.0, b.tag_top1.1);
    eprintln!("  lang/mod {}", b.lang_mod.line());
    eprintln!("  lang/txt {}", b.lang_snip.line());
    eprintln!("  adult    {}/{} right", b.nsfw.0, b.nsfw.1);
    eprintln!("  category {}", b.cat.line());
    eprintln!("  severity {}", b.sev.line());
    eprintln!("  duplicate {}/{} right · false duplicate {} · missed {}", b.dup.right, b.dup.n, b.dup.false_dup, b.dup.missed);
    eprintln!("  latency per item: median {:.0} ms · p90 {:.0} ms · max {:.0} ms ({} items)", q(0.5), q(0.9), q(1.0), ms.len());
}

#[test]
#[ignore]
fn measure_pipeline() {
    if ai_embedded::find_model_dir().is_none() && std::env::var("BMM_LAYA_EVAL_REPLAY").is_err() {
        eprintln!("measure_pipeline: no model pack — skipped");
        return;
    }
    let set: Value = serde_json::from_str(EVAL).unwrap();
    let vocab = |k: &str| -> Vec<String> { set["vocab"][k].as_array().unwrap().iter().map(|v| v.as_str().unwrap().to_string()).collect() };
    let s = |v: &Value| v.as_str().unwrap_or("").to_string();
    // Warm up (load) outside the timings.
    if !replaying() {
        ask("warm up", &[("w".into(), "noul", "Is this a test?".into(), Vec::new())]);
    }
    let only_lang = std::env::var("BMM_LAYA_EVAL_LANG").unwrap_or_default();
    let mut boards: Vec<(Board, Board)> = vec![(Board::default(), Board::default()), (Board::default(), Board::default())];
    let mut raw: Vec<Value> = Vec::new();
    let only = std::env::var("BMM_LAYA_EVAL_ONLY").unwrap_or_default();
    for item in set["items"].as_array().unwrap() {
        let text = s(&item["text"]);
        let id = s(&item["id"]);
        let blind = item["blind"].as_bool().unwrap_or(false);
        if (only == "blind" && !blind) || (only == "tuning" && blind) || (!only_lang.is_empty() && item["lang"].as_str() != Some(only_lang.as_str())) {
            continue;
        }
        ITEM.with(|i| *i.borrow_mut() = id.clone());
        let b = &mut boards[blind as usize];
        let (old, new) = (&mut b.0, &mut b.1);
        match item["task"].as_str().unwrap() {
            "mod" => {
                let names = vocab(item["vocab"].as_str().unwrap());
                let gold: Vec<String> = item["tags"].as_array().unwrap().iter().map(&s).collect();
                let gold_nsfw = item["nsfw"].as_bool().unwrap();
                let gold_lang = s(&item["lang"]);
                // OLD
                let t = Instant::now();
                let qs = legacy_mod_questions(&names);
                let p = ask(&text, &qs);
                old.ms.push(t.elapsed().as_secs_f64() * 1000.0);
                let n = names.len().min(ai_core::MAX_TAGS_ASKED);
                let mut ranked: Vec<(usize, f64)> = (0..n).map(|i| (i, p[i][1])).filter(|(_, x)| *x >= 0.5).collect();
                ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap());
                let got: Vec<String> = ranked.iter().take(ai_core::MAX_TAGS_PER_MOD).map(|(i, _)| names[*i].clone()).collect();
                old.tags.add(&got, &gold);
                old.tag_top1.1 += 1;
                if got.first().map(|g| gold.contains(g)).unwrap_or(false) {
                    old.tag_top1.0 += 1;
                }
                let lp = &p[n];
                old.lang_mod.add(Some(L::LANGS[argmax(lp)].0), Some(&gold_lang));
                let old_nsfw = p[n + 1][1] >= 0.5;
                old.nsfw.1 += 1;
                if old_nsfw == gold_nsfw {
                    old.nsfw.0 += 1;
                }
                let old_tag_p: Vec<f64> = (0..n).map(|i| p[i][1]).collect();
                // NEW
                let t = Instant::now();
                let lex = L::lexical_tag_scores(&text, &names);
                let cands = L::tag_candidates(&names, &lex, L::MAX_CHOICE);
                let mut qs = L::tag_questions(&names, &cands);
                qs.push(L::nsfw_question());
                let p = ask(&text, &qs);
                let lang = L::language_hint(&text);
                new.ms.push(t.elapsed().as_secs_f64() * 1000.0);
                let (choice, noul, nsfw_p) = if cands.is_empty() {
                    (Vec::new(), Vec::new(), p[0][1])
                } else {
                    let mut c: Vec<(String, f64)> = cands.iter().map(|i| format!("t{}", i)).zip(p[0].iter().cloned()).collect();
                    c.push(("none".into(), *p[0].last().unwrap()));
                    let n: Vec<Option<f64>> = (0..cands.len()).map(|j| Some(p[1 + j][1])).collect();
                    (c, n, p[1 + cands.len()][1])
                };
                let combined = L::combine_tag_votes(&names, &cands, &lex, &noul, &choice);
                let got: Vec<String> = L::pick_tags(&combined, ai_core::MAX_TAGS_PER_MOD).iter().map(|(i, _)| names[*i].clone()).collect();
                new.tags.add(&got, &gold);
                new.tag_top1.1 += 1;
                if got.first().map(|g| gold.contains(g)).unwrap_or(false) {
                    new.tag_top1.0 += 1;
                }
                new.nsfw.1 += 1;
                if (nsfw_p >= 0.5) == gold_nsfw {
                    new.nsfw.0 += 1;
                }
                new.lang_mod.add(lang.map(|x| x.0), Some(&gold_lang));
                // Calibration extras (not timed): the descriptive yes/no for EVERY tag.
                let all: Vec<usize> = (0..names.len()).collect();
                let extra_qs: Vec<LayaQuestion> = L::tag_questions(&names, &all).into_iter().skip(1).collect();
                let pe = ask(&text, &extra_qs);
                raw.push(json!({
                    "id": id, "task": "mod", "blind": blind, "gold_tags": gold, "gold_nsfw": gold_nsfw, "gold_lang": gold_lang, "names": names,
                    "known": names.iter().map(|n| L::concept_for(n).is_some()).collect::<Vec<_>>(),
                    "old_tag_p": old_tag_p, "old_lang": lp, "old_nsfw": old_nsfw,
                    "lex": lex, "cands": cands, "choice": if cands.is_empty() { json!([]) } else { json!(p[0]) }, "noul_all": pe.iter().map(|x| x[1]).collect::<Vec<_>>(),
                    "nsfw_p": nsfw_p, "lang": lang.map(|(c, p)| json!([c, p])),
                }));
            }
            "report" => {
                let gc = s(&item["category"]);
                let gs = s(&item["severity"]);
                let t = Instant::now();
                let p = ask(&text, &legacy_report_questions());
                old.ms.push(t.elapsed().as_secs_f64() * 1000.0);
                old.cat.add(Some(ai_core::REPORT_CATEGORIES[argmax(&p[0])]), Some(&gc));
                old.sev.add(Some(ai_core::REPORT_SEVERITIES[argmax(&p[1])]), Some(&gs));
                let t = Instant::now();
                let body = L::informative_chunks(&text, 1500);
                let pn = ask(&body, &L::report_questions());
                new.ms.push(t.elapsed().as_secs_f64() * 1000.0);
                let (ci, cp) = (argmax(&pn[0]), pn[0][argmax(&pn[0])]);
                let sev_l: Vec<(String, f64)> = L::SEVERITY_CRITERIA.iter().map(|(k, _)| k.to_string()).zip(pn[1].iter().cloned()).collect();
                let (sev, _) = L::combine_severity(L::REPORT_CRITERIA[ci].0, &text, &sev_l);
                new.cat.add(if cp >= L::CATEGORY_THRESHOLD { Some(L::REPORT_CRITERIA[ci].0) } else { None }, Some(&gc));
                new.sev.add(Some(&sev), Some(&gs));
                raw.push(json!({ "id": id, "task": "report", "blind": blind, "gold_cat": gc, "gold_sev": gs, "old_cat": p[0], "old_sev": p[1], "cat": pn[0], "sev": pn[1], "sev_v2": sev }));
            }
            "dup" => {
                let known: Vec<String> = item["known"].as_array().unwrap().iter().map(&s).collect();
                let gold = item["dup"].as_u64().map(|x| x as usize);
                let t = Instant::now();
                let p = ask(&text, &[legacy_dup_question(&known)]);
                old.ms.push(t.elapsed().as_secs_f64() * 1000.0);
                let a = argmax(&p[0]);
                let old_got = if a < known.len() { Some(a) } else { None };
                let t = Instant::now();
                let cands = L::dup_candidates(&text, &known, L::DUP_CANDIDATES);
                let pn = ask(&text, &L::dup_questions(&known, &cands));
                new.ms.push(t.elapsed().as_secs_f64() * 1000.0);
                let noul: Vec<Option<f64>> = pn.iter().map(|x| Some(x[1])).collect();
                let new_got = L::combine_dup(&cands, &noul).map(|x| x.0);
                for (b, got) in [(&mut *old, old_got), (&mut *new, new_got)] {
                    b.dup.n += 1;
                    if got == gold {
                        b.dup.right += 1;
                    } else if gold.is_none() || (got.is_some() && got != gold) {
                        b.dup.false_dup += 1;
                    } else {
                        b.dup.missed += 1;
                    }
                }
                let all: Vec<(usize, f64)> = L::dup_candidates(&text, &known, known.len());
                let pa = ask(&text, &L::dup_questions(&known, &all));
                raw.push(json!({ "id": id, "task": "dup", "blind": blind, "gold": gold, "old": p[0], "all": all.iter().map(|(i, o)| json!([i, o])).collect::<Vec<_>>(), "all_noul": pa.iter().map(|x| x[1]).collect::<Vec<_>>() }));
            }
            "lang" => {
                let gold = s(&item["lang"]);
                let t = Instant::now();
                let p = ask(&text, &[legacy_mod_questions(&[]).remove(0)]);
                old.ms.push(t.elapsed().as_secs_f64() * 1000.0);
                old.lang_snip.add(Some(L::LANGS[argmax(&p[0])].0), Some(&gold));
                let t = Instant::now();
                let lang = L::language_hint(&text);
                new.ms.push(t.elapsed().as_secs_f64() * 1000.0);
                new.lang_snip.add(lang.map(|x| x.0), Some(&gold));
                raw.push(json!({ "id": id, "task": "lang", "gold": gold, "old": p[0], "det": lang.map(|(c, p)| json!([c, p])) }));
            }
            _ => {}
        }
    }
    for (i, name) in ["TUNING SET (156 items: the weights were fitted on its even ids)", "BLIND SET (68 items written after the freeze, never tuned on)"].iter().enumerate() {
        if boards[i].0.ms.is_empty() {
            continue;
        }
        eprintln!("══ {} ══", name);
        print("BEFORE (questions BMM asked until now)", &boards[i].0);
        print("AFTER (Laya v2)", &boards[i].1);
    }
    if let Ok(path) = std::env::var("BMM_LAYA_EVAL_OUT") {
        std::fs::write(&path, serde_json::to_string(&raw).unwrap()).unwrap();
        eprintln!("raw answers → {}", path);
    }
    if let Ok(path) = std::env::var("BMM_LAYA_EVAL_QS") {
        CALLS.with(|c| std::fs::write(&path, serde_json::to_string(&*c.borrow()).unwrap()).unwrap());
        eprintln!("calls → {}", path);
    }
}

// ── « Ask Laya »: does the right page / command come first? ──────────────────────────────────

/// (question, expected intent, ids that count as a right answer — substrings of a hit id).
const ASK: &[(&str, &str, &[&str])] = &[
    ("what is game mode?", "docs", &["features/storage", "how-it-works/resources", "art:storage-manager"]),
    ("how do I share my mods with my squadron?", "docs", &["features/repo", "art:server-host", "art:hosting-flow", "art:modpacks", "repo.host"]),
    ("how do I export my mod list?", "command", &["mods.export", "features/modlist"]),
    ("where can I change the theme?", "setting", &["features/themes", "art:themes", "art:theme-system", "setting:"]),
    ("what is a modpack?", "docs", &["features/modpacks", "art:modpacks"]),
    ("how does BMM check file integrity?", "docs", &["integrity", "art:blake3-hashing", "mods.verify"]),
    ("scan my mods folder", "command", &["mods.scan", "art:scan", "scanning-cache"]),
    ("how do I import a profile from OvGME?", "command", &["profiles.import", "getting-started/migrating"]),
    ("what does the scheduler do?", "docs", &["features/scheduler", "art:scheduler"]),
    ("how do I limit the disk speed?", "setting", &["features/storage", "art:disk-io-limiter", "art:storage-manager", "settings.storage"]),
    ("open the command palette", "command", &["palette.open", "features/command-palette", "art:command-palette"]),
    ("what is sent when I report a bug?", "docs", &["features/feedback", "privacy-telemetry", "art:feedback-reporting"]),
    ("how does the load order decide which mod wins?", "docs", &["load-order", "art:conflicts", "how-it-works/conflicts"]),
    ("check my mods for updates", "command", &["checkUpdates", "art:staying-updated"]),
    ("what is Laya?", "docs", &["features/ai", "art:ai-optional"]),
    ("how do I use the mapper?", "docs", &["mapper"]),
    ("create a new profile", "command", &["profiles.new", "art:first-profile", "features/profiles"]),
    ("how do I restore a backup?", "docs", &["art:backups", "art:faq-deleted-mod", "restore"]),
    ("c'est quoi le mode jeu ?", "docs", &["features/storage", "how-it-works/resources", "art:storage-manager"]),
    ("comment partager mes mods avec mon escadron ?", "docs", &["features/repo", "art:server-host", "art:hosting-flow", "art:modpacks", "repo.host"]),
    ("comment exporter ma liste de mods ?", "command", &["mods.export", "features/modlist"]),
    ("où changer le thème ?", "setting", &["features/themes", "art:themes", "art:theme-system", "setting:"]),
    ("c'est quoi un modpack ?", "docs", &["features/modpacks", "art:modpacks"]),
    ("comment BMM vérifie l'intégrité des fichiers ?", "docs", &["integrity", "art:blake3-hashing", "mods.verify"]),
    ("scanner le dossier de mods", "command", &["mods.scan", "art:scan", "scanning-cache"]),
    ("importer un profil OvGME", "command", &["profiles.import", "getting-started/migrating"]),
    ("à quoi sert le planificateur ?", "docs", &["features/scheduler", "art:scheduler"]),
    ("comment limiter la vitesse du disque ?", "setting", &["features/storage", "art:disk-io-limiter", "art:storage-manager", "settings.storage"]),
    ("ouvrir la palette de commandes", "command", &["palette.open", "features/command-palette", "art:command-palette"]),
    ("qu'est-ce qui est envoyé quand je signale un bug ?", "docs", &["features/feedback", "privacy-telemetry", "art:feedback-reporting"]),
    ("comment l'ordre de chargement décide quel mod gagne ?", "docs", &["load-order", "art:conflicts", "how-it-works/conflicts"]),
    ("vérifier les mises à jour des mods", "command", &["checkUpdates", "art:staying-updated"]),
    ("c'est quoi Laya ?", "docs", &["features/ai", "art:ai-optional"]),
    ("comment utiliser le mapper ?", "docs", &["mapper"]),
    ("créer un nouveau profil", "command", &["profiles.new", "art:first-profile", "features/profiles"]),
    ("comment restaurer une sauvegarde ?", "docs", &["art:backups", "art:faq-deleted-mod", "restore"]),
];

#[test]
#[ignore]
fn measure_ask() {
    use crate::commands::ask_core::{self, Library, Request};
    let lib = Library::default();
    let model = ai_embedded::Embedded;
    let have_model = ai_embedded::find_model_dir().is_some();
    for (label, use_model) in [("retrieval only (BM25 + rules)", false), ("retrieval + Laya rerank", true)] {
        if use_model && !have_model {
            continue;
        }
        let (mut top1, mut top3, mut intent, mut ms) = (0, 0, 0, Vec::new());
        for (q, want_intent, ok) in ASK {
            let lang = if q.is_ascii() && !q.contains("c'est") { "en" } else { "fr" };
            let t = Instant::now();
            let a = ask_core::answer(&Request { question: q.to_string(), lang: lang.into(), scope: "all".into(), limit: 5, extra: Vec::new() }, &lib, if use_model { Some(&model as &dyn ai_core::LocalModel) } else { None });
            ms.push(t.elapsed().as_secs_f64() * 1000.0);
            let good = |id: &str| ok.iter().any(|k| id.contains(k));
            if a.hits.first().map(|h| good(&h.id)).unwrap_or(false) {
                top1 += 1;
            }
            if a.hits.iter().take(3).any(|h| good(&h.id)) {
                top3 += 1;
            } else {
                eprintln!("   miss: {:?} → {:?}", q, a.hits.iter().take(3).map(|h| h.id.clone()).collect::<Vec<_>>());
            }
            if a.intent == *want_intent {
                intent += 1;
            }
        }
        ms.sort_by(|a, b| a.partial_cmp(b).unwrap());
        eprintln!("── Ask Laya · {} ──", label);
        eprintln!("  right answer first {}/{} · in the top 3 {}/{} · intent {}/{} · median {:.0} ms, max {:.0} ms", top1, ASK.len(), top3, ASK.len(), intent, ASK.len(), ms[ms.len() / 2], ms[ms.len() - 1]);
    }
}
