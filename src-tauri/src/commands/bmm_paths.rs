//! Collecting the places BMM knows about, and resolving a spec against them.
//!
//! The deciding half lives in `bmm_paths_core`, with no Tauri in it. This half is the part
//! that needs BMM's state to answer "where is that plugin installed", and it is deliberately
//! thin: everything worth testing is over there.

use crate::commands::bmm_paths_core::{resolve_with, PathRoot};
use crate::state::AppState;
use tauri::{AppHandle, Manager, State};

/// Every root a spec can name, as things stand right now.
///
/// Rebuilt on each call rather than cached. A plugin installed while the app is open, a
/// profile switched, an app uninstalled — a cached list is a list that sends a task to a
/// folder that is no longer there, and this is cheap.
pub fn roots_now(app: &AppHandle, state: &State<'_, AppState>) -> Vec<PathRoot> {
    let mut out = Vec::new();
    let push = |out: &mut Vec<PathRoot>, kind: &str, id: &str, label: &str, path: String| {
        if !path.trim().is_empty() {
            out.push(PathRoot { kind: kind.into(), id: id.into(), label: label.into(), path });
        }
    };

    if let Ok(dir) = app.path().app_data_dir() {
        push(&mut out, "appdata", "", "BMM data", dir.to_string_lossy().to_string());
    }

    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());

    for p in &data.installed_plugins {
        push(&mut out, "plugin", &p.manifest.id, &p.manifest.name, p.install_dir.clone());
    }
    for m in &data.modpacks {
        // A modpack is a document, not a folder — its mods carry the profile, not the pack.
        // For an ordinary pack that still means one directory: the mods folder of the profile
        // its mods live in.
        //
        // A MULTI-PROFILE pack means two or more, so it gets none. Picking the first would be
        // an answer that is right about half the time, which is worse than no answer: a task
        // writing into the wrong profile's mods folder does not fail, it succeeds in the wrong
        // place. Those packs are still reachable by id through the modpack actions.
        if m.multi_profile {
            continue;
        }
        let dir = m
            .mods
            .iter()
            .find_map(|r| r.profile_id.as_ref())
            .and_then(|pid| data.profiles.iter().find(|pr| &pr.id == pid))
            .map(|pr| pr.mods_path.to_string_lossy().to_string())
            .unwrap_or_default();
        push(&mut out, "modpack", &m.id, &m.name, dir);
    }
    for pr in &data.profiles {
        push(&mut out, "profile", &pr.id, &pr.name, pr.mods_path.to_string_lossy().to_string());
    }

    // The active profile's three folders, under names that do not change when the profile
    // does — which is the point: a task written once keeps working after a profile switch.
    if let Some(active) = data
        .active_profile_id
        .as_ref()
        .and_then(|id| data.profiles.iter().find(|p| &p.id == id))
    {
        push(&mut out, "mods", "", "Mods folder", active.mods_path.to_string_lossy().to_string());
        push(&mut out, "game", "", "Game folder", active.game_path.to_string_lossy().to_string());
        push(&mut out, "backup", "", "Backups", active.backup_path.to_string_lossy().to_string());
    }
    drop(data);

    for a in crate::commands::apps::installed_apps_for_paths(app) {
        push(&mut out, "app", &a.0, &a.1, a.2);
    }
    out
}

/// Every place a path spec can point at, for a picker.
#[tauri::command]
pub fn bmm_path_roots(app: AppHandle, state: State<'_, AppState>) -> Result<Vec<PathRoot>, String> {
    Ok(roots_now(&app, &state))
}

/// Turn one spec into a real path.
///
/// Returns the input unchanged when it is not a spec, so a caller can hand it anything a
/// person typed: `C:\mods\out.txt` comes back as itself rather than as an error about a
/// scheme nobody was trying to use.
#[tauri::command]
pub fn bmm_path_resolve(app: AppHandle, state: State<'_, AppState>, spec: String) -> Result<String, String> {
    if crate::commands::bmm_paths_core::parse_spec(&spec).is_none() {
        return Ok(spec);
    }
    resolve_with(&roots_now(&app, &state), &spec)
}
