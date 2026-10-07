//! The activation order, end to end on real folders.
//!
//! Each test builds a game folder, a backup folder and a few mods in a temp dir, then drives the
//! same functions the commands drive: `fs_utils::apply_mod_stacked` to enable (appending to the
//! order), `fallback_order` + `read_roots` + `fs_utils::unapply_mod_stacked` to disable, and
//! `handovers` + `redeploy` to reorder. What is asserted is the bytes on disk.

use super::*;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::Write;
use std::path::PathBuf;

/// A little world: a game with one vanilla file, a backup root, mods, and the profile's order.
struct World {
    root: PathBuf,
    game: PathBuf,
    backup: PathBuf,
    folders: HashMap<String, PathBuf>,
    order: Vec<String>,
}

impl World {
    fn new(name: &str) -> Self {
        let root = std::env::temp_dir().join(format!("bmm_order_{}_{}", name, std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let game = root.join("game");
        let backup = root.join("backup");
        fs::create_dir_all(game.join("Data")).unwrap();
        fs::create_dir_all(&backup).unwrap();
        fs::write(game.join("Data/tex.dds"), b"vanilla").unwrap();
        World { root, game, backup, folders: HashMap::new(), order: Vec::new() }
    }

    /// A folder mod shipping `files` (relative path → content).
    fn folder_mod(&mut self, id: &str, files: &[(&str, &str)]) {
        let dir = self.root.join("mods").join(id);
        for (rel, body) in files {
            let p = dir.join(rel);
            fs::create_dir_all(p.parent().unwrap()).unwrap();
            fs::write(p, body).unwrap();
        }
        self.folders.insert(id.to_string(), dir);
    }

    /// An archived mod: a `.zip` in the mods folder. Name made unique per test run, because
    /// the extraction cache is keyed by the archive's name, size and mtime.
    fn zip_mod(&mut self, id: &str, files: &[(&str, &str)]) {
        let dir = self.root.join("mods");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(format!("{}_{}_{}.zip", id, std::process::id(), self.root.file_name().unwrap().to_string_lossy()));
        let f = fs::File::create(&path).unwrap();
        let mut z = zip::ZipWriter::new(f);
        let o = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Stored);
        for (rel, body) in files {
            z.start_file(*rel, o).unwrap();
            z.write_all(body.as_bytes()).unwrap();
        }
        z.finish().unwrap();
        self.folders.insert(id.to_string(), path);
    }

    fn files_of(&self, id: &str) -> Vec<String> {
        crate::fs_utils::list_mod_files(&self.folders[id])
            .unwrap()
            .into_iter()
            .map(|p| p.to_string_lossy().to_string())
            .collect()
    }

    /// enable_mod, minus the UI: the mod's files over whatever is there, appended to the order.
    fn enable(&mut self, id: &str) {
        let mut others: HashSet<PathBuf> = HashSet::new();
        for a in &self.order {
            for f in crate::fs_utils::list_mod_files(&self.folders[a]).unwrap() {
                others.insert(f);
            }
        }
        let folder = crate::archive::mod_read_root(&self.folders[id]);
        crate::fs_utils::apply_mod_stacked(&folder, &self.game, &self.backup, &others, false).unwrap();
        self.order.push(id.to_string());
    }

    /// disable_mod, minus the UI: the remaining providers in order, archives read from cache.
    fn disable(&mut self, id: &str) {
        let leaving: HashSet<String> = [id.to_string()].into_iter().collect();
        let files = self.files_of(id);
        let remaining = fallback_order(&self.order, &leaving);
        let wanted: HashSet<String> = files.iter().map(|f| rel_key(f)).collect();
        let roots = read_roots(&remaining, &self.folders, Some(&wanted));
        crate::fs_utils::unapply_mod_stacked(&self.game, &self.backup, files, &roots, false).unwrap();
        self.order.retain(|m| m != id);
    }

    fn index(&self) -> ProviderIndex {
        let lists: Vec<(String, Vec<String>)> = self.order.iter().map(|id| (id.clone(), self.files_of(id))).collect();
        build_index(lists.iter().map(|(id, f)| (id, f.clone())))
    }

    /// mod_order_set, minus the UI: save the order, re-copy only the files that changed hands.
    fn reorder(&mut self, after: &[&str]) -> usize {
        let after: Vec<String> = after.iter().map(|s| s.to_string()).collect();
        assert!(is_permutation(&self.order, &after));
        let index = self.index();
        let changed: HashSet<String> = handovers(&index, &self.order, &after).into_iter().map(|h| h.path).collect();
        let moved: Vec<ContestedFile> = contested(&index, &after).into_iter().filter(|c| changed.contains(&c.path)).collect();
        self.order = after;
        let roots: HashMap<String, PathBuf> = read_roots(&self.order, &self.folders, None).into_iter().collect();
        let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Deploy, "test");
        redeploy(&self.game, &moved, &roots, false, &ticket).unwrap().copied
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

fn s(v: &[&str]) -> Vec<String> {
    v.iter().map(|x| x.to_string()).collect()
}

// ── Deploy and undeploy follow the order ──────────────────────────────────────────────────

#[test]
fn three_mods_on_one_file_the_last_enabled_is_on_disk() {
    let mut w = World::new("three");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.folder_mod("c", &[("Data/tex.dds", "C")]);
    w.enable("a");
    w.enable("b");
    w.enable("c");
    assert_eq!(w.read("Data/tex.dds"), "C");
    assert!(w.backup.join("_original/Data/tex.dds").exists(), "vanilla backed up once");
}

/// THE BUG. disable_mod built the fallback list newest-first and unapply walked it backwards,
/// so the OLDEST provider came back: disable C over A < B and the game showed A, a layer that
/// had been overwritten and that nobody had seen since B was enabled.
#[test]
fn disabling_the_top_mod_reveals_the_one_directly_under_it() {
    let mut w = World::new("top");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.folder_mod("c", &[("Data/tex.dds", "C")]);
    w.enable("a");
    w.enable("b");
    w.enable("c");
    w.disable("c");
    assert_eq!(w.read("Data/tex.dds"), "B");
}

#[test]
fn disabling_a_mod_that_is_not_on_top_changes_nothing_visible() {
    let mut w = World::new("middle");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.folder_mod("c", &[("Data/tex.dds", "C")]);
    w.enable("a");
    w.enable("b");
    w.enable("c");
    w.disable("b");
    assert_eq!(w.read("Data/tex.dds"), "C");
    w.disable("a");
    assert_eq!(w.read("Data/tex.dds"), "C");
    w.disable("c");
    assert_eq!(w.read("Data/tex.dds"), "vanilla", "the last one out brings the game file back");
    assert!(!w.backup.join("_original/Data/tex.dds").exists(), "and frees its backup");
}

#[test]
fn enabling_in_another_order_gives_the_other_winner() {
    let mut w = World::new("orders");
    w.folder_mod("a", &[("Data/tex.dds", "A"), ("Data/new.pak", "A-new")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.enable("b");
    w.enable("a");
    assert_eq!(w.read("Data/tex.dds"), "A");
    w.disable("a");
    assert_eq!(w.read("Data/tex.dds"), "B");
    assert_eq!(w.read("Data/new.pak"), "<absent>", "a file the game never had is removed");
}

// ── Reordering after deployment ───────────────────────────────────────────────────────────

#[test]
fn a_reorder_recopies_only_the_files_that_change_hands() {
    let mut w = World::new("reorder");
    w.folder_mod("a", &[("Data/tex.dds", "A"), ("Data/a_only.txt", "A1")]);
    w.folder_mod("b", &[("Data/tex.dds", "B"), ("Data/shared2.txt", "B2")]);
    w.folder_mod("c", &[("Data/shared2.txt", "C2")]);
    w.enable("a");
    w.enable("b");
    w.enable("c");
    assert_eq!(w.read("Data/tex.dds"), "B");
    assert_eq!(w.read("Data/shared2.txt"), "C2");
    // A sentinel on a file whose winner does NOT change: a reorder that rewrote every contested
    // file would put C2 back over it.
    fs::write(w.game.join("Data/shared2.txt"), b"untouched").unwrap();

    let copied = w.reorder(&["b", "a", "c"]);
    assert_eq!(copied, 1, "only tex.dds changed hands");
    assert_eq!(w.read("Data/tex.dds"), "A");
    assert_eq!(w.read("Data/shared2.txt"), "untouched");
    assert_eq!(w.read("Data/a_only.txt"), "A1");
}

#[test]
fn after_a_reorder_disabling_follows_the_new_order() {
    let mut w = World::new("reorder_disable");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.folder_mod("c", &[("Data/tex.dds", "C")]);
    w.enable("a");
    w.enable("b");
    w.enable("c");
    w.reorder(&["c", "b", "a"]);
    assert_eq!(w.read("Data/tex.dds"), "A");
    w.disable("a");
    assert_eq!(w.read("Data/tex.dds"), "B", "b is directly under a in the NEW order");
    w.disable("b");
    assert_eq!(w.read("Data/tex.dds"), "C");
}

#[test]
fn a_preview_names_each_file_that_would_change_hands() {
    let idx = build_index(
        [
            (&"a".to_string(), s(&["x", "y"])),
            (&"b".to_string(), s(&["x"])),
            (&"c".to_string(), s(&["y", "z"])),
        ]
        .into_iter(),
    );
    let h = handovers(&idx, &s(&["a", "b", "c"]), &s(&["b", "a", "c"]));
    assert_eq!(h, vec![Handover { path: "x".into(), from: "b".into(), to: "a".into() }]);
    assert!(handovers(&idx, &s(&["a", "b", "c"]), &s(&["a", "b", "c"])).is_empty());
}

// ── Archived mods ─────────────────────────────────────────────────────────────────────────

/// A zip was never a provider on disable: `Mod.zip/Data/tex.dds` names nothing, so disabling
/// the mod on top of it restored the vanilla file instead of the zipped mod's copy.
#[test]
fn disabling_the_mod_over_an_archived_one_brings_the_archived_copy_back() {
    let mut w = World::new("zip_under");
    w.zip_mod("z", &[("Data/tex.dds", "ZIP")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.enable("z");
    w.enable("b");
    assert_eq!(w.read("Data/tex.dds"), "B");
    w.disable("b");
    assert_eq!(w.read("Data/tex.dds"), "ZIP");
}

#[test]
fn reordering_an_archived_mod_on_top_deploys_its_copy() {
    let mut w = World::new("zip_reorder");
    w.zip_mod("z", &[("Data/tex.dds", "ZIP")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.enable("z");
    w.enable("b");
    let copied = w.reorder(&["b", "z"]);
    assert_eq!(copied, 1);
    assert_eq!(w.read("Data/tex.dds"), "ZIP");
}

#[test]
fn a_zip_and_a_folder_shipping_the_same_file_are_one_key() {
    assert_eq!(rel_key("Data\\tex.dds"), rel_key("Data/tex.dds"));
    assert_eq!(rel_key("./Data/tex.dds"), "Data/tex.dds");
    let idx = build_index([(&"f".to_string(), s(&["Data\\tex.dds"])), (&"z".to_string(), s(&["Data/tex.dds"]))].into_iter());
    assert_eq!(contested(&idx, &s(&["f", "z"])).len(), 1);
}

// ── Batch disable ─────────────────────────────────────────────────────────────────────────

/// Two mods over a vanilla file, disabled together ("Disable selected"). Unapplying them one by
/// one either put a batch member's copy back or, with the backup freed by the first, deleted
/// the game's own file. One plan, one unapply: the vanilla file comes back.
#[test]
fn a_batch_disable_brings_the_vanilla_file_back() {
    let mut w = World::new("batch");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.folder_mod("keep", &[("Data/other.txt", "K")]);
    w.enable("keep");
    w.enable("a");
    w.enable("b");
    let leaving: HashSet<String> = s(&["a", "b"]).into_iter().collect();
    let plan = plan_batch_disable(&[w.order.clone()], &leaving, &|id| w.files_of(id));
    assert_eq!(plan.remaining, s(&["keep"]));
    let roots = read_roots(&plan.remaining, &w.folders, None);
    crate::fs_utils::unapply_mod_stacked(&w.game, &w.backup, plan.files.clone(), &roots, false).unwrap();
    assert_eq!(w.read("Data/tex.dds"), "vanilla");
    assert_eq!(w.read("Data/other.txt"), "K");
}

#[test]
fn a_batch_disable_falls_back_to_the_last_remaining_provider() {
    let mut w = World::new("batch_fallback");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("b", &[("Data/tex.dds", "B")]);
    w.folder_mod("c", &[("Data/tex.dds", "C")]);
    w.enable("a");
    w.enable("b");
    w.enable("c");
    let leaving: HashSet<String> = s(&["c", "a"]).into_iter().collect();
    let plan = plan_batch_disable(&[w.order.clone()], &leaving, &|id| w.files_of(id));
    let roots = read_roots(&plan.remaining, &w.folders, None);
    crate::fs_utils::unapply_mod_stacked(&w.game, &w.backup, plan.files, &roots, false).unwrap();
    assert_eq!(w.read("Data/tex.dds"), "B");
}

// ── Placing a block (move to top/bottom, modpack insertion) ──────────────────────────────

#[test]
fn a_block_goes_to_the_end_in_its_own_order() {
    let order = s(&["x", "a", "y", "b"]);
    assert_eq!(place_block(&order, &s(&["b", "a"]), None), s(&["x", "y", "b", "a"]));
}

#[test]
fn a_block_goes_to_a_position_counted_without_it() {
    let order = s(&["x", "a", "y", "b"]);
    assert_eq!(place_block(&order, &s(&["b"]), Some(0)), s(&["b", "x", "a", "y"]));
    assert_eq!(place_block(&order, &s(&["x"]), Some(99)), s(&["a", "y", "b", "x"]), "clamped");
    assert_eq!(place_block(&order, &s(&["a", "y"]), Some(1)), s(&["x", "a", "y", "b"]));
}

#[test]
fn a_block_ignores_mods_that_are_not_active_and_duplicates() {
    let order = s(&["x", "a"]);
    let out = place_block(&order, &s(&["ghost", "x", "x"]), None);
    assert_eq!(out, s(&["a", "x"]));
    assert!(is_permutation(&order, &out), "placing never adds or drops a mod");
}

/// A modpack applied into a profile that already has some of its mods: the pack's mods end up
/// on top, contiguous, in the pack's order, and nothing else moves relative to each other.
#[test]
fn a_modpack_inserts_its_mods_on_top_in_the_pack_order() {
    let profile = s(&["base", "p2", "other", "p1"]);
    let pack = s(&["p1", "p2", "p3-not-installed"]);
    assert_eq!(place_block(&profile, &pack, None), s(&["base", "other", "p1", "p2"]));
}

// ── Model, migration, refusal ─────────────────────────────────────────────────────────────

/// There is nothing to migrate, and this is the proof: a profile written before the order view
/// existed reads back with its order untouched, and that order is what the view shows.
#[test]
fn a_legacy_profile_keeps_its_order() {
    let legacy = r#"{
        "id": "p", "name": "P", "game_name": "G",
        "game_path": "C:/g", "mods_path": "C:/g/mods", "backup_path": "C:/g/bak",
        "active_mods": ["c", "a", "b"],
        "color": null, "icon": null, "created_at": "2025-01-01T00:00:00Z",
        "origin_repo_profile_id": null
    }"#;
    let p: crate::models::profile::Profile = serde_json::from_str(legacy).unwrap();
    assert_eq!(p.active_mods, s(&["c", "a", "b"]));
    let again: crate::models::profile::Profile = serde_json::from_value(serde_json::to_value(&p).unwrap()).unwrap();
    assert_eq!(again.active_mods, s(&["c", "a", "b"]), "a save/load round trip keeps it");
    let idx = build_index([(&"a".to_string(), s(&["f"])), (&"c".to_string(), s(&["f"]))].into_iter());
    assert_eq!(contested(&idx, &p.active_mods)[0].winner, "a", "a is after c: a wins");
}

#[test]
fn a_reorder_must_be_the_same_set() {
    assert!(is_permutation(&s(&["a", "b"]), &s(&["b", "a"])));
    assert!(!is_permutation(&s(&["a", "b"]), &s(&["a"])));
    assert!(!is_permutation(&s(&["a", "b"]), &s(&["a", "b", "c"])));
    assert!(!is_permutation(&s(&["a", "b"]), &s(&["a", "a"])));
}

#[test]
fn only_active_mods_contest_a_file() {
    let idx = build_index([(&"a".to_string(), s(&["f"])), (&"off".to_string(), s(&["f"]))].into_iter());
    assert!(contested(&idx, &s(&["a"])).is_empty(), "a file a disabled mod shares is not a conflict yet");
}


// ── Profiles sharing only the game folder ─────────────────────────────────────────────────

fn profile(id: &str, game: &std::path::Path, mods: &std::path::Path, backup: &std::path::Path, active: &[&str]) -> crate::models::profile::Profile {
    let mut p = crate::models::profile::Profile::new(id.into(), "G".into(), game.to_path_buf(), mods.to_path_buf(), backup.to_path_buf());
    p.id = id.to_string();
    p.active_mods = s(active);
    p
}

#[test]
fn one_game_folder_has_one_key() {
    let a = game_folder_key(std::path::Path::new(r"E:\Games\Foo\"));
    let b = game_folder_key(std::path::Path::new("E:/Games/Foo"));
    assert_eq!(a, b);
    if cfg!(windows) {
        assert_eq!(a, game_folder_key(std::path::Path::new(r"e:\games\foo")));
        assert_eq!(a, game_folder_key(std::path::Path::new(r"\\?\E:\Games\Foo")));
    }
    assert_ne!(a, game_folder_key(std::path::Path::new("E:/Games/Bar")));
}

/// The other profiles on the same game folder are the owners, whatever their mods folder; a
/// profile on another game folder is not; this profile's own mods and backup are left out.
#[test]
fn the_share_is_every_other_profile_on_that_game_folder() {
    let g = std::path::Path::new("C:/game");
    let profiles = vec![
        profile("me", g, std::path::Path::new("C:/modsA"), std::path::Path::new("C:/bakA"), &["mine", "both"]),
        profile("other", std::path::Path::new("C:/game/"), std::path::Path::new("C:/modsB"), std::path::Path::new("C:/bakB"), &["x", "both"]),
        profile("twin", g, std::path::Path::new("C:/modsA"), std::path::Path::new("C:/bakA"), &["mine", "both"]),
        profile("elsewhere", std::path::Path::new("C:/other-game"), std::path::Path::new("C:/modsC"), std::path::Path::new("C:/bakC"), &["y"]),
    ];
    let share = game_folder_share(&profiles, "me");
    assert_eq!(share.owners, s(&["x"]));
    assert_eq!(share.backups, vec![PathBuf::from("C:/bakB")], "own backup (and its twin) left out");
    assert_eq!(game_folder_share(&profiles, "nobody"), GameFolderShare::default());
}

#[test]
fn the_own_stack_stays_on_top_of_the_shared_one() {
    let leaving: HashSet<String> = ["top".to_string()].into_iter().collect();
    // Another profile's mods first (under), the own remaining stack last (on top, last wins);
    // an id in both counts once, at its own place.
    assert_eq!(shared_fallback_order(&s(&["x", "a"]), &s(&["a", "b", "top"]), &leaving), s(&["x", "a", "b"]));
    assert_eq!(shared_fallback_order(&[], &s(&["a", "top"]), &leaving), s(&["a"]));
}

/// Profile A (mods folder A, backup A) deploys `a` over the vanilla file; profile B (mods
/// folder B, backup B, SAME game folder) then deploys `x` over it. B must not take `a`'s copy
/// for a game original; disabling `x` must bring `a`'s copy back, and disabling `a` afterwards
/// the vanilla file, from A's backup.
#[test]
fn a_profile_sharing_only_the_game_folder_never_backs_up_the_other_ones_mod_file() {
    let mut w = World::new("share_game_only");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("x", &[("Data/tex.dds", "X"), ("Data/new.lua", "X-new")]);
    let backup_b = w.root.join("backup_b");
    fs::create_dir_all(&backup_b).unwrap();
    let mut pa = profile("A", &w.game, &w.root.join("modsA"), &w.backup, &[]);
    let mut pb = profile("B", &w.game, &w.root.join("modsB"), &backup_b, &[]);

    // A enables a (nothing else on the folder).
    w.enable("a");
    pa.active_mods = s(&["a"]);
    assert_eq!(fs::read(w.backup.join("_original/Data/tex.dds")).unwrap(), b"vanilla");

    // B enables x: its guard is built from every profile on that game folder.
    let profiles = vec![pa.clone(), pb.clone()];
    let share = game_folder_share(&profiles, "B");
    assert_eq!(share.owners, s(&["a"]));
    let others: HashSet<PathBuf> = share.owners.iter().flat_map(|id| crate::fs_utils::list_mod_files(&w.folders[id]).unwrap()).collect();
    crate::fs_utils::apply_mod_stacked(&w.folders["x"], &w.game, &backup_b, &others, false).unwrap();
    pb.active_mods = s(&["x"]);
    assert!(!backup_b.join("_original/Data/tex.dds").exists(), "a's copy is not a game original");
    assert_eq!(fs::read(w.game.join("Data/tex.dds")).unwrap(), b"X");

    // B disables x: a's copy comes back, the file the game never had goes.
    let profiles = vec![pa.clone(), pb.clone()];
    let share = game_folder_share(&profiles, "B");
    let leaving: HashSet<String> = ["x".to_string()].into_iter().collect();
    let remaining = shared_fallback_order(&share.owners, &pb.active_mods, &leaving);
    let roots = read_roots(&remaining, &w.folders, None);
    crate::fs_utils::unapply_mod_stacked_shared(&w.game, &backup_b, &share.backups, w.files_of("x"), &roots, false).unwrap();
    pb.active_mods.clear();
    assert_eq!(fs::read(w.game.join("Data/tex.dds")).unwrap(), b"A");
    assert!(!w.game.join("Data/new.lua").exists());
    assert_eq!(fs::read(w.backup.join("_original/Data/tex.dds")).unwrap(), b"vanilla", "A's backup untouched");

    // A disables a: vanilla.
    w.disable("a");
    assert_eq!(fs::read(w.game.join("Data/tex.dds")).unwrap(), b"vanilla");
    let _ = fs::remove_dir_all(&w.root);
}

/// The other order: A disables its mod while B's covers the file. The vanilla backup is in
/// A's folder; when B later disables, it must be found there rather than the file deleted.
#[test]
fn the_original_is_found_in_the_backup_of_the_profile_that_replaced_it_first() {
    let mut w = World::new("share_backup_lookup");
    w.folder_mod("a", &[("Data/tex.dds", "A")]);
    w.folder_mod("x", &[("Data/tex.dds", "X")]);
    let backup_b = w.root.join("backup_b");
    fs::create_dir_all(&backup_b).unwrap();
    let mut pa = profile("A", &w.game, &w.root.join("modsA"), &w.backup, &[]);
    let mut pb = profile("B", &w.game, &w.root.join("modsB"), &backup_b, &[]);

    w.enable("a");
    pa.active_mods = s(&["a"]);
    let others: HashSet<PathBuf> = crate::fs_utils::list_mod_files(&w.folders["a"]).unwrap().into_iter().collect();
    crate::fs_utils::apply_mod_stacked(&w.folders["x"], &w.game, &backup_b, &others, false).unwrap();
    pb.active_mods = s(&["x"]);

    // A disables a: x (B's) is a provider on that folder, so X stays and the backup stays.
    let profiles = vec![pa.clone(), pb.clone()];
    let share = game_folder_share(&profiles, "A");
    let leaving: HashSet<String> = ["a".to_string()].into_iter().collect();
    let roots = read_roots(&shared_fallback_order(&share.owners, &pa.active_mods, &leaving), &w.folders, None);
    crate::fs_utils::unapply_mod_stacked_shared(&w.game, &w.backup, &share.backups, w.files_of("a"), &roots, false).unwrap();
    pa.active_mods.clear();
    assert_eq!(fs::read(w.game.join("Data/tex.dds")).unwrap(), b"X");
    assert!(w.backup.join("_original/Data/tex.dds").exists());

    // B disables x: nothing provides it, B has no backup, A's has the vanilla file.
    let profiles = vec![pa.clone(), pb.clone()];
    let share = game_folder_share(&profiles, "B");
    assert_eq!(share.backups, vec![w.backup.clone()]);
    crate::fs_utils::unapply_mod_stacked_shared(&w.game, &backup_b, &share.backups, w.files_of("x"), &[], false).unwrap();
    assert_eq!(fs::read(w.game.join("Data/tex.dds")).unwrap(), b"vanilla", "restored, not deleted");
    assert!(!w.backup.join("_original/Data/tex.dds").exists(), "the backup is reclaimed once restored");
    let _ = fs::remove_dir_all(&w.root);
}
