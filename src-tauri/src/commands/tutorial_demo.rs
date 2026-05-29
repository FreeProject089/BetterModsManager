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
use std::collections::HashMap;
use std::path::PathBuf;
use serde::Serialize;
use tauri::State;

pub const DEMO_PROFILE_ID: &str = "__bmm_tutorial_demo_profile__";
pub const DEMO_MOD_PREFIX: &str = "__bmm_tutorial_demo_mod_";

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

fn make_demo_mod(idx: u32, name: &str, files: &[&str], dep: Option<&str>) -> ModEntry {
    let mut m = ModEntry::new(name.to_string(), PathBuf::from(format!("<tutorial-demo>/{}", name)));
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

/// Create the demo profile + mods IF the user has no real mods. Otherwise leave
/// everything untouched and just report an existing profile to point at.
#[tauri::command]
pub fn tutorial_setup_demo(state: State<AppState>) -> Result<DemoSetupResult, String> {
    let mut data = state.data.lock().map_err(|_| "Failed to lock AppState".to_string())?;
    let prev_active = data.active_profile_id.clone();

    // If real (non-demo) mods already exist, use them — never fabricate data.
    let has_real_mods = data.mods.iter().any(|m| !m.id.starts_with(DEMO_MOD_PREFIX));
    if has_real_mods {
        let pid = prev_active.clone()
            .or_else(|| data.profiles.iter().find(|p| p.id != DEMO_PROFILE_ID).map(|p| p.id.clone()))
            .unwrap_or_default();
        return Ok(DemoSetupResult { created: false, profile_id: pid, prev_active });
    }

    // Build the demo profile (idempotent).
    if !data.profiles.iter().any(|p| p.id == DEMO_PROFILE_ID) {
        let mut prof = Profile::new(
            "🎓 Tutorial Example".to_string(),
            "Tutorial Sandbox".to_string(),
            PathBuf::from("<tutorial-demo>/game"),
            PathBuf::from("<tutorial-demo>/mods"),
            PathBuf::from("<tutorial-demo>/backups"),
        );
        prof.id = DEMO_PROFILE_ID.to_string();
        prof.color = Some("#a855f7".to_string());
        prof.icon = Some("graduation-cap".to_string());

        // Two mods that BOTH ship "Mods/shared/config.ini" → demonstrates a conflict.
        let m1 = make_demo_mod(1, "Example Texture Pack",
            &["Mods/textures/sky.dds", "Mods/textures/grass.dds", "Mods/shared/config.ini"], None);
        let m2 = make_demo_mod(2, "Example Weapon Mod",
            &["Mods/weapons/sword.nif", "Mods/shared/config.ini"], Some(&format!("{}1", DEMO_MOD_PREFIX)));

        prof.active_mods = vec![m1.id.clone(), m2.id.clone()];
        data.mods.push(m1);
        data.mods.push(m2);
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
    if data.active_profile_id.as_deref() == Some(DEMO_PROFILE_ID) {
        data.active_profile_id = data.profiles.first().map(|p| p.id.clone());
    }
    before_p != data.profiles.len() || before_m != data.mods.len()
}
