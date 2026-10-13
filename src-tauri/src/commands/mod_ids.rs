//! Mod ids: one record, one id.
//!
//! A `ModEntry.id` is what a profile's `active_mods`, dependencies, history and the UI hold on
//! to. Three paths could give two records the same id:
//!
//!  - the repo sync used the REPO's mod id as the local id, so syncing one repo into two local
//!    profiles made two records with one id (enabling one in a profile enabled "both");
//!  - the sync matched an existing record by folder only, so a repo that renamed a mod (its
//!    folder is `<id8>_<name>`) pushed a SECOND record with the same id beside the first;
//!  - a modpack repair copied the pack's id onto a mod that already existed.
//!
//! Now the sync matches a record by origin (repo + repo mod id, in the same mods folder)
//! before the folder, and gives a record the repo's id only when no other record holds it
//! ([`local_id_for`]: otherwise a stable id derived from the repo id and the mods folder, the
//! same one on every re-sync). And [`dedupe_mod_ids`] runs once per start to repair data
//! written before: every duplicate after the first gets its own id, and the profile it lives
//! in follows it. The caller backs `data.json` up before saving a repaired list.
//!
//! `repo_mod_id` stays the stable link to the repo: updates match on it, never on `id`.

use crate::models::mod_entry::ModEntry;
use crate::models::profile::Profile;
use sha2::{Digest, Sha256};
use std::collections::{HashMap, HashSet};
use std::path::Path;

fn folder_key(p: &Path) -> String {
    p.to_string_lossy().replace('\\', "/").trim_end_matches('/').to_lowercase()
}

/// The id a record synced from a repo gets in the mods folder `mods_path` when the repo's id
/// is already taken by another record: stable across re-syncs, distinct per folder.
pub fn derived_id(repo_mod_id: &str, mods_path: &Path) -> String {
    let h = Sha256::digest(folder_key(mods_path).as_bytes());
    format!("{}~{}", repo_mod_id, &hex::encode(h)[..8])
}

/// The local id for a repo mod about to get a NEW record in `mods_path`: the repo's id when
/// no record holds it, else [`derived_id`] (and a fresh uuid in the unlikely case that one is
/// taken too).
pub fn local_id_for(mods: &[ModEntry], repo_mod_id: &str, mods_path: &Path) -> String {
    let taken = |id: &str| mods.iter().any(|m| m.id == id);
    if !taken(repo_mod_id) { return repo_mod_id.to_string(); }
    let d = derived_id(repo_mod_id, mods_path);
    if !taken(&d) { return d; }
    uuid::Uuid::new_v4().to_string()
}

/// True when `folder` is inside `mods_path` (case-insensitive, either slash).
pub fn in_folder(folder: &Path, mods_path: &Path) -> bool {
    let f = folder_key(folder);
    let root = folder_key(mods_path);
    !root.is_empty() && (f == root || f.starts_with(&format!("{root}/")))
}

/// The existing record a synced repo mod is: same origin (repo + repo mod id) in the same
/// mods folder first — that one survives a rename of the mod in the repo, which moves its
/// folder — else the record at that exact folder.
pub fn find_synced_record(mods: &[ModEntry], src_repo: &str, repo_mod_id: &str, mods_path: &Path, folder: &Path) -> Option<usize> {
    let by_origin = mods.iter().position(|m| {
        m.repo_mod_id.as_deref() == Some(repo_mod_id)
            && m.source_repo.as_deref().map(crate::commands::repo::normalize_repo_url).as_deref() == Some(src_repo)
            && in_folder(&m.mod_folder_path, mods_path)
    });
    by_origin.or_else(|| mods.iter().position(|m| m.mod_folder_path == folder))
}

/// One id a repair changed.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
pub struct IdChange {
    pub old: String,
    pub new: String,
    pub name: String,
}

/// Give every duplicate id after the first its own id. The profile whose mods folder holds
/// the renamed record gets the new id in its `active_mods` (when it had the old one and the
/// record that kept the id is not in that profile), and the dependencies of the records in
/// that folder follow. Returns what changed; nothing when every id is unique.
pub fn dedupe_mod_ids(mods: &mut [ModEntry], profiles: &mut [Profile]) -> Vec<IdChange> {
    let mut first_at: HashMap<String, usize> = HashMap::new();
    let mut all: HashSet<String> = mods.iter().map(|m| m.id.clone()).collect();
    let mut changes = Vec::new();
    for i in 0..mods.len() {
        let id = mods[i].id.clone();
        let Some(&keeper) = first_at.get(&id) else {
            first_at.insert(id, i);
            continue;
        };
        let home = profiles.iter().position(|p| in_folder(&mods[i].mod_folder_path, &p.mods_path));
        let mut new = match (&mods[i].repo_mod_id, home) {
            (Some(rid), Some(h)) if !rid.is_empty() => derived_id(rid, &profiles[h].mods_path),
            _ => uuid::Uuid::new_v4().to_string(),
        };
        if all.contains(&new) { new = uuid::Uuid::new_v4().to_string(); }
        all.insert(new.clone());
        mods[i].id = new.clone();
        if let Some(h) = home {
            let keeper_here = in_folder(&mods[keeper].mod_folder_path, &profiles[h].mods_path);
            let p = &mut profiles[h];
            if !keeper_here {
                for a in p.active_mods.iter_mut() { if *a == id { *a = new.clone(); } }
                let root = p.mods_path.clone();
                for m in mods.iter_mut().filter(|m| in_folder(&m.mod_folder_path, &root)) {
                    for d in m.dependencies.iter_mut() { if *d == id { *d = new.clone(); } }
                }
            }
        }
        changes.push(IdChange { old: id, new, name: mods[i].name.clone() });
    }
    changes
}

/// After a sync into `mods_path`: the dependencies of the records synced there name REPO ids;
/// point each at the record of that repo mod in the same folder (its local id may differ).
pub fn relink_synced_dependencies(mods: &mut [ModEntry], src_repo: &str, mods_path: &Path) {
    let local: HashMap<String, String> = mods.iter()
        .filter(|m| in_folder(&m.mod_folder_path, mods_path)
            && m.source_repo.as_deref().map(crate::commands::repo::normalize_repo_url).as_deref() == Some(src_repo))
        .filter_map(|m| m.repo_mod_id.clone().map(|r| (r, m.id.clone())))
        .collect();
    for m in mods.iter_mut().filter(|m| in_folder(&m.mod_folder_path, mods_path)
        && m.source_repo.as_deref().map(crate::commands::repo::normalize_repo_url).as_deref() == Some(src_repo)) {
        for d in m.dependencies.iter_mut() {
            if let Some(l) = local.get(d.as_str()) { *d = l.clone(); }
        }
    }
}

/// The startup repair on `data.json`: dedupe, and when anything changed, keep a copy of the
/// file as it was (`data.json.pre-mod-ids-<time>.bak`) before the caller saves.
pub fn repair_at_startup(data_path: &Path, mods: &mut [ModEntry], profiles: &mut [Profile]) -> Vec<IdChange> {
    let changes = dedupe_mod_ids(mods, profiles);
    if !changes.is_empty() {
        if let Ok(bytes) = std::fs::read(data_path) {
            let name = format!("data.json.pre-mod-ids-{}.bak", chrono::Utc::now().format("%Y%m%d-%H%M%S"));
            let _ = std::fs::write(data_path.with_file_name(name), bytes);
        }
    }
    changes
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn m(id: &str, folder: &str, rid: Option<&str>) -> ModEntry {
        let mut e = ModEntry::new(id.to_string(), PathBuf::from(folder));
        e.id = id.to_string();
        e.repo_mod_id = rid.map(str::to_string);
        e.source_repo = rid.map(|_| "http://host/repo".to_string());
        e
    }
    fn p(id: &str, mods: &str, active: &[&str]) -> Profile {
        let mut p = Profile::new(id.into(), String::new(), PathBuf::new(), PathBuf::from(mods), PathBuf::new());
        p.id = id.into();
        p.active_mods = active.iter().map(|s| s.to_string()).collect();
        p
    }

    #[test]
    fn one_repo_in_two_profiles_gets_two_ids_and_each_profile_keeps_its_own() {
        let mut mods = vec![m("alpha", "C:/A/mods/alpha_x", Some("alpha")), m("alpha", "C:/B/mods/alpha_x", Some("alpha"))];
        let mut profiles = vec![p("a", "C:/A/mods", &["alpha"]), p("b", "C:/B/mods", &["alpha"])];
        let ch = dedupe_mod_ids(&mut mods, &mut profiles);
        assert_eq!(ch.len(), 1);
        assert_eq!(mods[0].id, "alpha", "the first keeps its id");
        assert_eq!(mods[1].id, derived_id("alpha", Path::new("C:/B/mods")));
        assert_eq!(profiles[0].active_mods, vec!["alpha"]);
        assert_eq!(profiles[1].active_mods, vec![mods[1].id.clone()], "profile b now names its own record");
        assert_eq!(mods[1].repo_mod_id.as_deref(), Some("alpha"), "the repo link is untouched");
        assert!(dedupe_mod_ids(&mut mods, &mut profiles).is_empty(), "idempotent");
    }

    #[test]
    fn a_rename_duplicate_in_the_same_profile_gets_a_fresh_id_and_leaves_the_profile_alone() {
        let mut mods = vec![m("alpha", "C:/A/mods/alpha_old", Some("alpha")), m("alpha", "C:/A/mods/alpha_new", Some("alpha"))];
        let mut profiles = vec![p("a", "C:/A/mods", &["alpha"])];
        let ch = dedupe_mod_ids(&mut mods, &mut profiles);
        assert_eq!(ch.len(), 1);
        assert_ne!(mods[0].id, mods[1].id);
        assert_eq!(profiles[0].active_mods, vec!["alpha"], "the record that kept the id is the enabled one");
    }

    #[test]
    fn local_ids_for_new_records_are_stable_and_unique() {
        let mods = vec![m("alpha", "C:/A/mods/alpha_x", Some("alpha"))];
        assert_eq!(local_id_for(&mods, "beta", Path::new("C:/B/mods")), "beta");
        let d = local_id_for(&mods, "alpha", Path::new("C:/B/mods"));
        assert_eq!(d, derived_id("alpha", Path::new("c:\\b\\mods\\")), "slashes, case and a trailing slash do not change it");
    }

    #[test]
    fn the_synced_record_is_found_by_origin_before_folder() {
        let mods = vec![m("x", "C:/A/mods/alpha_old", Some("alpha")), m("y", "C:/B/mods/alpha_old", Some("alpha"))];
        let at = find_synced_record(&mods, "http://host/repo", "alpha", Path::new("C:/B/mods"), Path::new("C:/B/mods/alpha_new"));
        assert_eq!(at, Some(1), "same repo mod, same profile folder, renamed: the same record");
        assert_eq!(find_synced_record(&mods, "http://other/repo", "alpha", Path::new("C:/B/mods"), Path::new("C:/B/mods/zzz")), None);
    }

    #[test]
    fn dependencies_follow_the_local_ids() {
        let mut a = m("alpha~1", "C:/B/mods/a", Some("alpha"));
        a.dependencies = vec!["beta".into(), "elsewhere".into()];
        let b = m("beta~2", "C:/B/mods/b", Some("beta"));
        let mut mods = vec![a, b];
        relink_synced_dependencies(&mut mods, "http://host/repo", Path::new("C:/B/mods"));
        assert_eq!(mods[0].dependencies, vec!["beta~2".to_string(), "elsewhere".to_string()]);
    }

    #[test]
    fn the_startup_repair_backs_up_only_when_it_changed_something() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("data.json");
        std::fs::write(&path, "{}").unwrap();
        let mut mods = vec![m("a", "C:/A/mods/a", None)];
        let mut profiles = vec![p("a", "C:/A/mods", &[])];
        assert!(repair_at_startup(&path, &mut mods, &mut profiles).is_empty());
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 1);
        mods.push(m("a", "C:/A/mods/b", None));
        assert_eq!(repair_at_startup(&path, &mut mods, &mut profiles).len(), 1);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2, "data.json + its backup");
    }
}
