//! Placement modes on real folders, and the portable order (parse, resolve, merge, preview).

use super::*;
use crate::commands::mod_order::{contested, handovers, build_index, read_roots, redeploy, ContestedFile, ProviderIndex};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::PathBuf;

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

// ── A game folder, a few folder mods, and the order ────────────────────────────────────────

struct World {
    root: PathBuf,
    game: PathBuf,
    backup: PathBuf,
    folders: HashMap<String, PathBuf>,
    order: Vec<String>,
}

impl World {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("bmm_ordershare_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let game = root.join("game");
        let backup = root.join("backup");
        fs::create_dir_all(game.join("Data")).unwrap();
        fs::create_dir_all(&backup).unwrap();
        fs::write(game.join("Data/tex.dds"), b"vanilla").unwrap();
        World { root, game, backup, folders: HashMap::new(), order: Vec::new() }
    }

    fn folder_mod(&mut self, id: &str, files: &[(&str, &str)]) {
        let dir = self.root.join("mods").join(id);
        for (rel, body) in files {
            let p = dir.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
        }
        self.folders.insert(id.to_string(), dir);
    }

    fn files_of(&self, id: &str) -> Vec<String> {
        crate::fs_utils::list_mod_files(&self.folders[id])
            .unwrap()
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    }

    /// enable_mod: over whatever is there, appended to the order.
    fn enable(&mut self, id: &str) {
        let mut others: HashSet<PathBuf> = HashSet::new();
        for a in &self.order {
            for f in crate::fs_utils::list_mod_files(&self.folders[a]).unwrap() {
                others.insert(f);
            }
        }
        crate::fs_utils::apply_mod_stacked(&self.folders[id], &self.game, &self.backup, &others, false).unwrap();
        self.order.push(id.to_string());
    }

    fn index(&self) -> ProviderIndex {
        let lists: Vec<(String, Vec<String>)> = self.order.iter().map(|id| (id.clone(), self.files_of(id))).collect();
        build_index(lists.iter().map(|(id, f)| (id, f.clone())))
    }

    /// What `mod_order::commit` does with a new order: re-copy the files that changed hands.
    fn commit(&mut self, after: Vec<String>) -> usize {
        assert!(crate::commands::mod_order::is_permutation(&self.order, &after), "a mode never adds or drops a mod");
        let index = self.index();
        let changed: HashSet<String> = handovers(&index, &self.order, &after).into_iter().map(|h| h.path).collect();
        let moved: Vec<ContestedFile> = contested(&index, &after).into_iter().filter(|c| changed.contains(&c.path)).collect();
        self.order = after;
        let roots: HashMap<String, PathBuf> = read_roots(&self.order, &self.folders, None).into_iter().collect();
        let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Deploy, "test");
        redeploy(&self.game, &moved, &roots, false, &ticket).unwrap().copied
    }

    /// A bulk enable: every id of `block` not yet active is enabled in the block's order, then
    /// the block is placed by `mode` — `newly_only` is what "Enable all" passes.
    fn bulk_enable(&mut self, block: &[&str], mode: PlaceMode, newly_only: bool) -> usize {
        let mut placed = Vec::new();
        for id in block {
            if !self.order.iter().any(|x| x == id) {
                self.enable(id);
                placed.push(id.to_string());
            } else if !newly_only {
                placed.push(id.to_string());
            }
        }
        let after = arrange(&self.order, &placed, mode);
        self.commit(after)
    }

    fn read(&self, rel: &str) -> String {
        fs::read_to_string(self.game.join(rel)).unwrap_or_else(|_| "<absent>".into())
    }
}

impl Drop for World {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

/// x and y active (y wins), then a pack [p, x] where p and x both ship tex.dds.
fn world_with_pack(name: &str) -> World {
    let mut w = World::new(name);
    w.folder_mod("x", &[("Data/tex.dds", "X"), ("Data/x.txt", "x")]);
    w.folder_mod("y", &[("Data/tex.dds", "Y")]);
    w.folder_mod("p", &[("Data/tex.dds", "P"), ("Data/p.txt", "p")]);
    w.enable("x");
    w.enable("y");
    assert_eq!(w.read("Data/tex.dds"), "Y");
    w
}

#[test]
fn top_puts_the_whole_pack_on_top_in_the_packs_order() {
    let mut w = world_with_pack("top");
    // Pack order [p, x]: x is last in the pack, so x wins; the pack is above y.
    let moved = w.bulk_enable(&["p", "x"], PlaceMode::Top, false);
    assert_eq!(w.order, s(&["y", "p", "x"]));
    assert_eq!(w.read("Data/tex.dds"), "X", "the pack wins as it was built");
    assert_eq!(moved, 1, "only the file that changed hands is copied");
    assert_eq!(w.read("Data/p.txt"), "p");
}

#[test]
fn bottom_leaves_what_was_active_winning() {
    let mut w = world_with_pack("bottom");
    let moved = w.bulk_enable(&["p", "x"], PlaceMode::Bottom, false);
    assert_eq!(w.order, s(&["p", "x", "y"]));
    assert_eq!(w.read("Data/tex.dds"), "Y", "y was on top and stays on top");
    assert_eq!(moved, 1, "p was deployed on top by enable, y takes the file back");
    assert_eq!(w.read("Data/p.txt"), "p", "a file nobody else ships is untouched");
}

#[test]
fn keep_moves_nothing_already_active() {
    let mut w = world_with_pack("keep");
    let moved = w.bulk_enable(&["p", "x"], PlaceMode::Keep, false);
    assert_eq!(w.order, s(&["x", "y", "p"]), "x keeps its place, p lands on top as enabled");
    assert_eq!(w.read("Data/tex.dds"), "P");
    assert_eq!(moved, 0, "nothing to re-copy");
}

#[test]
fn enable_all_top_never_reshuffles_the_mods_already_active() {
    let mut w = World::new("all");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.folder_mod("c", &[("Data/tex.dds", "C")]);
    w.enable("b");
    w.enable("a"); // the user's order: a above b
    let moved = w.bulk_enable(&["a", "b", "c"], PlaceMode::Top, true);
    assert_eq!(w.order, s(&["b", "a", "c"]));
    assert_eq!(w.read("Data/tex.dds"), "C");
    assert_eq!(moved, 0);
    // Bottom: the new one goes under, the user's winner comes back.
    let mut w2 = World::new("all_bottom");
    w2.folder_mod("a", &[("Data/tex.dds", "A")]);
    w2.folder_mod("c", &[("Data/tex.dds", "C")]);
    w2.enable("a");
    let moved = w2.bulk_enable(&["a", "c"], PlaceMode::Bottom, true);
    assert_eq!(w2.order, s(&["c", "a"]));
    assert_eq!(w2.read("Data/tex.dds"), "A");
    assert_eq!(moved, 1);
}

#[test]
fn an_imported_order_reaches_the_disk() {
    let mut w = World::new("import");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.folder_mod("z", &[("Data/z.txt", "z")]);
    w.enable("a");
    w.enable("z");
    w.enable("b");
    let lib = vec![
        LibMod { id: "a".into(), name: "Alpha".into(), ..Default::default() },
        LibMod { id: "b".into(), name: "Beta".into(), ..Default::default() },
        LibMod { id: "z".into(), name: "Zed".into(), ..Default::default() },
    ];
    let doc = parse_text("1. Beta\n2. Alpha\n").unwrap();
    let plan = plan_import(&w.order, &doc, &lib);
    assert_eq!(plan.result, s(&["b", "z", "a"]), "z keeps its slot");
    let moved = w.commit(plan.result.clone());
    assert_eq!(w.read("Data/tex.dds"), "A");
    assert_eq!(moved, 1);
}

// ── Modes ──────────────────────────────────────────────────────────────────────────────────

#[test]
fn mode_resolution_falls_back_to_the_setting_then_top() {
    assert_eq!(resolve_mode(Some("bottom"), "top"), PlaceMode::Bottom);
    assert_eq!(resolve_mode(Some("default"), "keep"), PlaceMode::Keep);
    assert_eq!(resolve_mode(None, "keep"), PlaceMode::Keep);
    assert_eq!(resolve_mode(Some("sideways"), "bottom"), PlaceMode::Bottom);
    assert_eq!(resolve_mode(None, ""), PlaceMode::Top);
    for m in ["top", "bottom", "keep"] {
        assert_eq!(PlaceMode::parse(m).unwrap().as_str(), m);
    }
}

#[test]
fn arrange_ignores_mods_that_are_not_active() {
    let o = s(&["a", "b", "c"]);
    assert_eq!(arrange(&o, &s(&["ghost", "a"]), PlaceMode::Top), s(&["b", "c", "a"]));
    assert_eq!(arrange(&o, &s(&["c", "ghost"]), PlaceMode::Bottom), s(&["c", "a", "b"]));
    assert_eq!(arrange(&o, &s(&["c"]), PlaceMode::Keep), o);
}

// ── The document ───────────────────────────────────────────────────────────────────────────

fn lib() -> Vec<LibMod> {
    vec![
        LibMod { id: "id-a".into(), name: "Alpha".into(), version: "1.0".into(), content_id: Some("cid-a".into()), repo_mod_id: None },
        LibMod { id: "id-b".into(), name: "Beta".into(), version: "2.0".into(), content_id: None, repo_mod_id: Some("repo-b".into()) },
        LibMod { id: "id-c".into(), name: "Gamma".into(), version: "1.0".into(), content_id: None, repo_mod_id: None },
        LibMod { id: "id-d".into(), name: "Delta".into(), version: "1.0".into(), content_id: None, repo_mod_id: None },
    ]
}

#[test]
fn code_link_json_and_text_all_read_back() {
    let doc = build_doc(&s(&["id-b", "id-a", "id-c"]), &lib(), Some("Main".into()), Some("Game".into()));
    for text in [encode_code(&doc), encode_link(&doc), serde_json::to_string(&doc).unwrap()] {
        let back = parse_text(&text).unwrap();
        assert_eq!(back.mods, doc.mods);
        assert_eq!(back.name.as_deref(), Some("Main"));
    }
    let plain = parse_text(&encode_text(&doc)).unwrap();
    let names: Vec<&str> = plain.mods.iter().map(|m| m.name.as_str()).collect();
    assert_eq!(names, ["Beta", "Alpha", "Gamma"]);
    // A link whose code was percent-encoded by a chat client.
    let enc = encode_link(&doc).replace('_', "%5F").replace('-', "%2D");
    assert_eq!(parse_text(&enc).unwrap().mods, doc.mods);
}

#[test]
fn a_pasted_mm_list_is_read_for_its_order() {
    let doc = build_doc(&s(&["id-a"]), &lib(), None, None);
    let mm = serde_json::json!({ "format_version": "1", "name": "list", "load_order": doc });
    assert_eq!(parse_text(&mm.to_string()).unwrap().mods.len(), 1);
}

#[test]
fn garbage_empty_and_foreign_json_are_refused() {
    assert_eq!(parse_text("   ").unwrap_err(), "order.errEmpty");
    assert_eq!(parse_text("BMMORDER1.!!!").unwrap_err(), "order.errParse");
    assert_eq!(parse_text("{\"format\":\"other\",\"mods\":[]}").unwrap_err(), "order.errParse");
    assert_eq!(parse_text("bmm://order?x=1").unwrap_err(), "order.errParse");
    assert_eq!(parse_text("# only a comment\n").unwrap_err(), "order.errEmpty");
    assert_eq!(parse_text(&"a".repeat(3 * 1024 * 1024)).unwrap_err(), "order.errTooLarge");
}

#[test]
fn bullets_and_numbers_are_stripped() {
    let d = parse_text("12. Alpha\n3) Beta\n- Gamma\n* Delta\n  Epsilon  \n2024 Edition\n").unwrap();
    let names: Vec<&str> = d.mods.iter().map(|m| m.name.as_str()).collect();
    assert_eq!(names, ["Alpha", "Beta", "Gamma", "Delta", "Epsilon", "2024 Edition"]);
}

#[test]
fn resolution_prefers_fingerprints_over_names() {
    let doc = OrderDoc {
        format: FORMAT.into(),
        version: 1,
        name: None,
        game: None,
        created_at: String::new(),
        mods: vec![
            // Renamed on the other machine, same fingerprint.
            OrderEntry { name: "Alpha HD".into(), content_id: Some("cid-a".into()), ..Default::default() },
            OrderEntry { name: "Beta (repo)".into(), repo_mod_id: Some("repo-b".into()), ..Default::default() },
            OrderEntry { name: "gamma".into(), ..Default::default() },
            // A foreign local id means nothing here.
            OrderEntry { name: "Nope".into(), id: Some("id-d".into()), ..Default::default() },
        ],
    };
    assert_eq!(resolve(&doc, &lib()), vec![Some("id-a".into()), Some("id-b".into()), Some("id-c".into()), None]);
}

#[test]
fn two_mods_with_one_name_need_the_version() {
    let mut l = lib();
    l.push(LibMod { id: "id-c2".into(), name: "Gamma".into(), version: "2.0".into(), ..Default::default() });
    let d = |v: &str| OrderDoc {
        format: FORMAT.into(), version: 1, name: None, game: None, created_at: String::new(),
        mods: vec![OrderEntry { name: "Gamma".into(), version: v.into(), ..Default::default() }],
    };
    assert_eq!(resolve(&d("2.0"), &l), vec![Some("id-c2".into())]);
    assert_eq!(resolve(&d(""), &l), vec![None], "ambiguous: nobody is guessed");
}

#[test]
fn merge_keeps_extras_in_their_slots() {
    let cur = s(&["a", "x", "b", "y", "c"]);
    assert_eq!(merge_order(&cur, &s(&["c", "b", "a"])), s(&["c", "x", "b", "y", "a"]));
    assert_eq!(merge_order(&cur, &s(&["ghost", "c", "a"])), s(&["c", "x", "b", "y", "a"]));
    assert_eq!(merge_order(&cur, &s(&["a", "a", "b"])), cur, "duplicates count once");
    assert_eq!(merge_order(&cur, &[]), cur);
}

#[test]
fn preview_sorts_every_entry_into_one_bucket() {
    let current = s(&["id-a", "id-c", "id-b"]);
    let doc = parse_text("Beta\nDelta\nAlpha\nUnknown Mod\n").unwrap();
    let p = plan_import(&current, &doc, &lib());
    assert_eq!(p.total, 4);
    assert_eq!(p.result, s(&["id-b", "id-c", "id-a"]));
    assert!(p.changed);
    let m: Vec<(&str, usize, usize)> = p.matched.iter().map(|r| (r.name.as_str(), r.from, r.to)).collect();
    assert_eq!(m, [("Beta", 3, 1), ("Alpha", 1, 3)]);
    assert_eq!(p.inactive.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["Delta"]);
    assert_eq!(p.missing, ["Unknown Mod"]);
    let e: Vec<(&str, usize, usize)> = p.extra.iter().map(|r| (r.name.as_str(), r.from, r.to)).collect();
    assert_eq!(e, [("Gamma", 2, 2)]);
}

#[test]
fn lists_and_packs_carry_the_order_and_older_files_still_read() {
    // An older .mm and an older pack have neither field: they must still load, with none.
    let old_list: crate::models::modlist::ModList =
        serde_json::from_value(serde_json::to_value(crate::models::modlist::ModList::new("L".into(), "G".into(), String::new())).unwrap()).unwrap();
    assert!(old_list.load_order.is_none());
    let mut list = crate::models::modlist::ModList::new("L".into(), "G".into(), String::new());
    list.load_order = Some(build_doc(&s(&["id-b", "id-a"]), &lib(), Some("Main".into()), None));
    let back: crate::models::modlist::ModList = serde_json::from_str(&serde_json::to_string(&list).unwrap()).unwrap();
    let doc = back.load_order.expect("the order travels in the list");
    assert_eq!(doc.mods.iter().map(|m| m.name.as_str()).collect::<Vec<_>>(), ["Beta", "Alpha"]);
    // And the list pasted whole into Import reads as that order.
    let pasted = parse_text(&serde_json::to_string(&list).unwrap()).unwrap();
    assert_eq!(pasted.mods.len(), 2);

    let pack_json = serde_json::json!({
        "id": "p", "name": "P", "description": null, "created_at": "", "updated_at": "",
        "multi_profile": false, "dependency_mode": "none", "skip_integrity_check": false,
        "mods": [], "sr_link": null, "game_name": null
    });
    let old_pack: crate::models::modpack::LocalModpack = serde_json::from_value(pack_json.clone()).unwrap();
    assert!(old_pack.order_mode.is_none());
    let mut with_mode = pack_json;
    with_mode["order_mode"] = "bottom".into();
    let pack: crate::models::modpack::LocalModpack = serde_json::from_value(with_mode).unwrap();
    assert_eq!(resolve_mode(pack.order_mode.as_deref(), "top"), PlaceMode::Bottom, "the pack's mode beats the setting");
}
