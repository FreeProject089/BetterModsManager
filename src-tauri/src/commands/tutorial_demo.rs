//! tutorial_demo.rs — Ephemeral example data for the interactive tutorial.
//!
//! When a tutorial needs to *show* mod/profile features (conflicts, hashes &
//! content-id, integrity, mapping…) but the user has no real data yet, we
//! inject a clearly-marked demo profile + a couple of demo mods so the steps
//! can point at a concrete example. These entities exist ONLY while the
//! tutorial is open: they are removed on finish/quit, and any leftovers are
//! purged on startup (in case BMM closed mid-tutorial).
//!
//! Safety: the demo is modified in memory only and never written to disk by
//! these commands. `tutorial_cleanup_demo` saves a clean state, and
//! `purge_tutorial_demo` (called at startup) removes anything that might have
//! been persisted by an unrelated auto-save while the tutorial was running.

use crate::state::{AppState, AppData};
use crate::models::profile::Profile;
use crate::models::mod_entry::{ModEntry, ModStatus};
use crate::models::modpack::{LocalModpack, ModpackModRef, DependencyMode};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use serde::Serialize;
use tauri::State;

pub const DEMO_PROFILE_ID: &str = "__bmm_tutorial_demo_profile__";
pub const DEMO_MOD_PREFIX: &str = "__bmm_tutorial_demo_mod_";
pub const DEMO_MODPACK_ID: &str = "__bmm_tutorial_demo_modpack__";

/// On-disk sandbox for the tutorial — real folders + files so the demo mods behave
/// exactly like real ones (mapper trees, activation copy, scan…). Wiped on cleanup.
fn demo_root() -> PathBuf {
    std::env::temp_dir().join("bmm-tutorial-demo")
}

/// The two demo mods, as (name, [relative files]). Both ship `Mods/shared/config.ini`
/// on purpose so the conflict step has a real Inter-conflict to show.
const DEMO_MOD_FILES: [(&str, &[&str]); 2] = [
    ("Example Texture Pack", &["Mods/textures/sky.dds", "Mods/textures/grass.dds", "Mods/shared/config.ini"]),
    ("Example Weapon Mod",   &["Mods/weapons/sword.nif", "Mods/shared/config.ini"]),
];

/// Materialise the sandbox on disk (idempotent). Returns (game_dir, mods_dir, backup_dir).
fn ensure_demo_files() -> std::io::Result<(PathBuf, PathBuf, PathBuf)> {
    use std::fs;
    let root = demo_root();
    let game = root.join("game");
    let mods = root.join("mods");
    let backups = root.join("backups");
    // A couple of real game folders so the Mapper's right-hand (game) tree isn't empty.
    fs::create_dir_all(game.join("Mods"))?;
    fs::create_dir_all(game.join("Data"))?;
    fs::create_dir_all(&backups)?;
    for (name, files) in DEMO_MOD_FILES {
        for rel in files {
            let p = mods.join(name).join(rel);
            if let Some(parent) = p.parent() { fs::create_dir_all(parent)?; }
            if !p.exists() {
                fs::write(&p, format!("; Tutorial demo file — {name}/{rel}\n").as_bytes())?;
            }
        }
    }
    Ok((game, mods, backups))
}

/// Best-effort removal of the on-disk sandbox.
pub fn purge_demo_files() {
    let _ = std::fs::remove_dir_all(demo_root());
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DemoSetupResult {
    /// True when demo data was actually created (no real mods existed).
    pub created: bool,
    /// The profile the tutorial should point at (demo or an existing one).
    pub profile_id: String,
    /// The active profile before setup, so cleanup can restore it.
    pub prev_active: Option<String>,
}

fn make_demo_mod(idx: u32, name: &str, mods_dir: &Path, files: &[&str], dep: Option<&str>) -> ModEntry {
    // Real folder on disk so the mod behaves like any other (file tree, copy on activate…).
    let mut m = ModEntry::new(name.to_string(), mods_dir.join(name));
    m.id = format!("{}{}", DEMO_MOD_PREFIX, idx);
    m.version = "1.0.0".to_string();
    m.author = Some("BMM Tutorial".to_string());
    m.description = Some(
        "Example mod created for the interactive tutorial. It is removed automatically \
         when you finish or leave the tutorial.".to_string(),
    );
    let all: Vec<String> = files.iter().map(|s| s.to_string()).collect();
    m.cached_files = Some(all.clone());
    // Fake but stable per-file hashes so the integrity / hashes step has data to show.
    let mut hashes = HashMap::new();
    for (i, f) in all.iter().enumerate() {
        hashes.insert(f.clone(), format!("{:064x}", (idx as u128) * 100_000 + i as u128 + f.len() as u128));
    }
    m.file_hashes = Some(hashes);
    m.file_hashes_timestamp = Some(chrono::Local::now().to_rfc3339());
    m.content_id = Some(format!("tutorial-demo-content-{}", idx));
    m.enabled = true;
    m.status = ModStatus::Enabled;
    m.activation_order = idx;
    if let Some(d) = dep { m.dependencies = vec![d.to_string()]; }
    m
}

/// Create the demo profile + mods so any tutorial that needs a mod/profile is fully
/// followable — ALWAYS, even when the user already has real data (the demo is a clearly
/// labelled sandbox, switched away from on cleanup). The mods are real folders on disk.
#[tauri::command]
pub fn tutorial_setup_demo(state: State<AppState>) -> Result<DemoSetupResult, String> {
    let mut data = state.data.lock().map_err(|_| "Failed to lock AppState".to_string())?;
    // Remember the *real* active profile (never the demo, in case of re-entry).
    let prev_active = data.active_profile_id.clone().filter(|id| id != DEMO_PROFILE_ID);

    // Materialise the on-disk sandbox first so the mods point at real files.
    let (game, mods, backups) = ensure_demo_files()
        .map_err(|e| format!("Failed to create tutorial demo files: {e}"))?;

    // Build the demo profile + mods (idempotent — rebuild if missing).
    if !data.profiles.iter().any(|p| p.id == DEMO_PROFILE_ID) {
        let mut prof = Profile::new(
            "🎓 Tutorial Example".to_string(),
            "Tutorial Sandbox".to_string(),
            game,
            mods.clone(),
            backups,
        );
        prof.id = DEMO_PROFILE_ID.to_string();
        prof.color = Some("#a855f7".to_string());
        prof.icon = Some("graduation-cap".to_string());

        // Two mods that BOTH ship "Mods/shared/config.ini" → demonstrates a conflict.
        let m1 = make_demo_mod(1, DEMO_MOD_FILES[0].0, &mods, DEMO_MOD_FILES[0].1, None);
        let m2 = make_demo_mod(2, DEMO_MOD_FILES[1].0, &mods, DEMO_MOD_FILES[1].1,
            Some(&format!("{}1", DEMO_MOD_PREFIX)));

        prof.active_mods = vec![m1.id.clone(), m2.id.clone()];

        // A demo modpack bundling both mods, so the modpack tutorial steps have a real
        // pack to point at / apply.
        let now = chrono::Local::now().to_rfc3339();
        let pack_ref = |m: &ModEntry| ModpackModRef {
            mod_id: m.id.clone(),
            mod_name: m.name.clone(),
            mod_version: m.version.clone(),
            profile_id: Some(DEMO_PROFILE_ID.to_string()),
            profile_name: Some("🎓 Tutorial Example".to_string()),
            sha256: m.content_id.clone().unwrap_or_default(),
            file_manifest: Vec::new(),
            include_dependencies: false,
            download_link: None,
            fallback_link: None,
            fallback_type: None,
        };
        let demo_pack = LocalModpack {
            id: DEMO_MODPACK_ID.to_string(),
            name: "🎓 Example Modpack".to_string(),
            description: Some("A demo modpack for the tutorial — removed when you leave.".to_string()),
            created_at: now.clone(),
            updated_at: now,
            multi_profile: false,
            dependency_mode: DependencyMode::Manual,
            skip_integrity_check: true,
            mods: vec![pack_ref(&m1), pack_ref(&m2)],
            sr_link: None,
            game_name: Some("Tutorial Sandbox".to_string()),
        };

        // Drop any stale demo entities before re-adding (defensive).
        data.mods.retain(|m| !m.id.starts_with(DEMO_MOD_PREFIX));
        data.modpacks.retain(|p| p.id != DEMO_MODPACK_ID);
        data.mods.push(m1);
        data.mods.push(m2);
        data.modpacks.push(demo_pack);
        data.profiles.push(prof);
    }
    data.active_profile_id = Some(DEMO_PROFILE_ID.to_string());
    // Intentionally NOT saved to disk — cleanup + startup purge handle removal.
    Ok(DemoSetupResult { created: true, profile_id: DEMO_PROFILE_ID.to_string(), prev_active })
}

/// Remove the demo data and restore the previously-active profile.
#[tauri::command]
pub fn tutorial_cleanup_demo(state: State<AppState>, prev_active: Option<String>) -> Result<(), String> {
    {
        let mut data = state.data.lock().map_err(|_| "Failed to lock AppState".to_string())?;
        let removed = purge_tutorial_demo(&mut data);
        if removed {
            data.active_profile_id = prev_active
                .filter(|id| data.profiles.iter().any(|p| &p.id == id))
                .or_else(|| data.profiles.first().map(|p| p.id.clone()));
        }
    }
    // Remove the on-disk sandbox too.
    purge_demo_files();
    // Persist a clean state so any demo that an auto-save may have written is gone.
    let _ = state.save();
    Ok(())
}

/// Remove every tutorial-demo entity from the data. Returns true if anything was
/// removed. Call at startup to clean up after a crash/mid-tutorial close.
pub fn purge_tutorial_demo(data: &mut AppData) -> bool {
    let before_p = data.profiles.len();
    let before_m = data.mods.len();
    data.profiles.retain(|p| p.id != DEMO_PROFILE_ID);
    data.mods.retain(|m| !m.id.starts_with(DEMO_MOD_PREFIX));
    data.modpacks.retain(|p| p.id != DEMO_MODPACK_ID);
    if data.active_profile_id.as_deref() == Some(DEMO_PROFILE_ID) {
        data.active_profile_id = data.profiles.first().map(|p| p.id.clone());
    }
    before_p != data.profiles.len() || before_m != data.mods.len()
}
