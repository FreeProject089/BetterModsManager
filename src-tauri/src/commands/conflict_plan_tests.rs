//! "Who wins this file": the rule behind the conflicts view (`mod_order::winner_of` and the
//! functions built on it), pins included, and what a draft plan says it would change.
//!
//! The last test drives the disk: a pinned file survives an enable that copied the order's
//! winner over it, because `pins_to_reassert` + `redeploy` put it back.

use super::*;
use std::fs;

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

fn pins(v: &[(&str, &str)]) -> Pins {
    v.iter().map(|(k, m)| (k.to_string(), m.to_string())).collect()
}

/// a, b, c all ship `x`; a and b ship `y`; c alone ships `z`.
fn index() -> ProviderIndex {
    let a = "a".to_string();
    let b = "b".to_string();
    let c = "c".to_string();
    build_index(vec![
        (&a, s(&["x", "y"])),
        (&b, s(&["x", "y"])),
        (&c, s(&["x", "z"])),
    ])
}

fn winner_in(files: &[ContestedFile], path: &str) -> String {
    files.iter().find(|f| f.path == path).map(|f| f.winner.clone()).unwrap_or_default()
}

#[test]
fn without_pins_the_last_provider_wins() {
    let ids = s(&["a", "b", "c"]);
    let refs: Vec<&String> = ids.iter().collect();
    let none = Pins::new();
    assert_eq!(winner_of("x", &refs, &none).map(|(w, p)| (w.as_str(), p)), Some(("c", false)));
    assert_eq!(winner_of("x", &[], &none), None, "nobody active: the game's own file");
}

#[test]
fn a_pin_wins_only_while_its_mod_is_an_active_provider() {
    let ids = s(&["a", "b", "c"]);
    let refs: Vec<&String> = ids.iter().collect();
    let p = pins(&[("x", "a")]);
    assert_eq!(winner_of("x", &refs, &p).map(|(w, p)| (w.as_str(), p)), Some(("a", true)));
    // The pinned mod is not among the providers (disabled, or it no longer ships the file).
    let without_a: Vec<&String> = ids[1..].iter().collect();
    assert_eq!(winner_of("x", &without_a, &p).map(|(w, p)| (w.as_str(), p)), Some(("c", false)));
    // A pin naming a mod that never shipped the file changes nothing.
    let ghost = pins(&[("x", "ghost")]);
    assert_eq!(winner_of("x", &refs, &ghost).map(|(w, _)| w.as_str()), Some("c"));
}

#[test]
fn contested_files_follow_the_order_and_the_pins() {
    let ix = index();
    let files = contested_pinned(&ix, &s(&["a", "b", "c"]), &Pins::new());
    assert_eq!(files.iter().map(|f| f.path.as_str()).collect::<Vec<_>>(), vec!["x", "y"], "z has one provider: no conflict");
    assert_eq!(winner_in(&files, "x"), "c");
    assert_eq!(winner_in(&files, "y"), "b");
    assert_eq!(files[0].mods, s(&["a", "b", "c"]), "providers listed in activation order");

    let reordered = contested_pinned(&ix, &s(&["c", "b", "a"]), &Pins::new());
    assert_eq!(winner_in(&reordered, "x"), "a");
    assert_eq!(winner_in(&reordered, "y"), "a");

    let pinned = contested_pinned(&ix, &s(&["a", "b", "c"]), &pins(&[("y", "a")]));
    assert_eq!(winner_in(&pinned, "y"), "a");
    assert!(pinned.iter().find(|f| f.path == "y").unwrap().pinned);
    assert!(!pinned.iter().find(|f| f.path == "x").unwrap().pinned);
    // The plain function is the pinned one with no pins.
    assert_eq!(winner_in(&contested(&ix, &s(&["a", "b", "c"])), "x"), "c");
}

#[test]
fn a_plan_reports_exactly_the_files_that_change_hands() {
    let ix = index();
    let before = s(&["a", "b", "c"]);
    let none = Pins::new();

    // Moving `a` on top: it takes x from c and y from b.
    let mut h = plan_handovers(&ix, &before, &none, &s(&["b", "c", "a"]), &none);
    h.sort_by(|p, q| p.path.cmp(&q.path));
    assert_eq!(h, vec![
        Handover { path: "x".into(), from: "c".into(), to: "a".into() },
        Handover { path: "y".into(), from: "b".into(), to: "a".into() },
    ]);

    // The same order changes nothing.
    assert!(plan_handovers(&ix, &before, &none, &before, &none).is_empty());

    // A pin alone: y goes to a, x untouched.
    assert_eq!(plan_handovers(&ix, &before, &none, &before, &pins(&[("y", "a")])), vec![
        Handover { path: "y".into(), from: "b".into(), to: "a".into() },
    ]);

    // Disabling c: x falls back to b (the next provider down).
    assert_eq!(plan_handovers(&ix, &before, &none, &s(&["a", "b"]), &none), vec![
        Handover { path: "x".into(), from: "c".into(), to: "b".into() },
    ]);

    // Disabling everything that ships y: back to the game's own copy, `to` empty.
    let h = plan_handovers(&ix, &before, &none, &s(&["c"]), &none);
    assert!(h.contains(&Handover { path: "y".into(), from: "b".into(), to: String::new() }));
    // The legacy entry point agrees with the plan one.
    assert_eq!(handovers(&ix, &before, &s(&["b", "c", "a"])).len(), 2);
}

#[test]
fn pair_summaries_count_who_gets_each_shared_file() {
    let ix = index();
    let files = contested_pinned(&ix, &s(&["a", "b", "c"]), &Pins::new());
    let pairs = pair_summaries(&files);
    let get = |a: &str, b: &str| pairs.iter().find(|p| p.a == a && p.b == b).cloned().unwrap();
    // a and b share x and y: c wins x, b wins y.
    assert_eq!(get("a", "b"), PairSummary { a: "a".into(), b: "b".into(), files: 2, a_wins: 0, b_wins: 1, pinned: 0 });
    assert_eq!(get("a", "c"), PairSummary { a: "a".into(), b: "c".into(), files: 1, a_wins: 0, b_wins: 1, pinned: 0 });
    assert_eq!(get("b", "c").files, 1);
    assert_eq!(pairs[0].files, 2, "the pair with the most shared files comes first");

    // With a pin on y for a, the a/b pair splits differently and says so.
    let files = contested_pinned(&ix, &s(&["a", "b", "c"]), &pins(&[("y", "a")]));
    let pairs = pair_summaries(&files);
    let ab = pairs.iter().find(|p| p.a == "a" && p.b == "b").unwrap();
    assert_eq!((ab.a_wins, ab.b_wins, ab.pinned), (1, 0, 1));
}

#[test]
fn a_draft_is_checked_and_disabled_mods_leave_the_order() {
    let ix = index();
    let cur = s(&["a", "b", "c"]);
    let none = Pins::new();
    assert_eq!(
        plan_view(&ix, &cur, &none, Some(s(&["a", "b"])), None, &[]).unwrap_err(),
        "order.errNotPermutation",
        "a shorter order would silently drop a mod"
    );
    let (after, p, files, _pairs, moves) = plan_view(&ix, &cur, &none, None, Some(pins(&[("y", "a")])), &s(&["c"])).unwrap();
    assert_eq!(after, s(&["a", "b"]));
    assert_eq!(p.get("y").map(String::as_str), Some("a"));
    assert_eq!(winner_in(&files, "x"), "b");
    assert_eq!(winner_in(&files, "y"), "a");
    assert_eq!(moves.len(), 2, "x: c -> b, y: b -> a");
}

#[test]
fn pins_are_normalised_and_empty_ones_dropped() {
    let raw = pins(&[("./Data\\tex.dds", "a"), ("", "b"), ("Data/x", "")]);
    let n = normalize_pins(&raw);
    assert_eq!(n.len(), 1);
    assert_eq!(n.get("Data/tex.dds").map(String::as_str), Some("a"));
}

#[test]
fn only_pins_that_override_the_order_need_putting_back() {
    let ix = index();
    let order = s(&["a", "b", "c"]);
    assert!(pins_to_reassert(&ix, &order, &Pins::new()).is_empty());
    // c is last anyway: its pin agrees with the order, nothing to redo.
    assert!(pins_to_reassert(&ix, &order, &pins(&[("x", "c")])).is_empty());
    let r = pins_to_reassert(&ix, &order, &pins(&[("x", "a"), ("y", "b")]));
    assert_eq!(r.iter().map(|c| (c.path.as_str(), c.winner.as_str())).collect::<Vec<_>>(), vec![("x", "a")]);
}

/// On disk: enabling a mod copies its file over a pinned one; putting the pins back restores
/// the pinned mod's bytes, and the redeploy reads the WINNER's copy even when it is not last.
#[test]
fn a_pinned_file_is_put_back_after_an_enable() {
    let root = std::env::temp_dir().join(format!("bmm_conflict_pins_{}", std::process::id()));
    let _ = fs::remove_dir_all(&root);
    let game = root.join("game");
    let backup = root.join("backup");
    fs::create_dir_all(game.join("Data")).unwrap();
    fs::create_dir_all(&backup).unwrap();
    fs::write(game.join("Data/tex.dds"), b"vanilla").unwrap();
    let mut folders = HashMap::new();
    for (id, body) in [("a", "A"), ("b", "B")] {
        let dir = root.join("mods").join(id);
        fs::create_dir_all(dir.join("Data")).unwrap();
        fs::write(dir.join("Data/tex.dds"), body).unwrap();
        folders.insert(id.to_string(), dir);
    }
    let mut placed: HashSet<PathBuf> = HashSet::new();
    for id in ["a", "b"] {
        let files = crate::fs_utils::apply_mod_stacked(&folders[id], &game, &backup, &placed, false).unwrap();
        placed.extend(files);
    }
    assert_eq!(fs::read_to_string(game.join("Data/tex.dds")).unwrap(), "B", "the order's winner was copied last");

    let order = s(&["a", "b"]);
    let a = "a".to_string();
    let b = "b".to_string();
    let ix = build_index(vec![(&a, s(&["Data/tex.dds"])), (&b, s(&["Data\\tex.dds"]))]);
    let p = pins(&[("Data/tex.dds", "a")]);
    let moved = pins_to_reassert(&ix, &order, &p);
    assert_eq!(moved.len(), 1);
    let roots: HashMap<String, PathBuf> = read_roots(&order, &folders, None).into_iter().collect();
    let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Deploy, "test");
    let rep = redeploy(&game, &moved, &roots, false, &ticket).unwrap();
    assert_eq!(rep.copied, 1);
    assert_eq!(fs::read_to_string(game.join("Data/tex.dds")).unwrap(), "A", "the pinned copy is back");
    let _ = fs::remove_dir_all(&root);
}
