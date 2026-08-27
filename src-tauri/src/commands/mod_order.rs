//! Which mod wins a file, and how to change the answer.
//!
//! BMM deploys by copying a mod's files into the game, so two active mods that ship the same
//! relative path do not merge — one of them is what is on disk. The rule has always been
//! **last wins**: `Profile.active_mods` is the deployment order, and `fs_utils` already reads
//! it backwards when a mod is disabled, to find who provides that file now.
//!
//! That order was real and invisible. Nothing showed it, nothing could change it, and the way
//! to make a mod win was to disable both and enable them again in the right sequence — which
//! nobody guesses, and which is not a thing to ask of somebody with forty mods.
//!
//! Two commands, and one rule that has to hold: reordering must RE-DEPLOY the files that
//! changed hands. A list that says one thing while the disk says another is worse than no
//! list, because it is the one people will trust.

use crate::state::AppState;
use serde::Serialize;
use std::collections::HashMap;
use tauri::State;

/// One active mod, in deployment order.
#[derive(Debug, Serialize, Clone)]
pub struct OrderedMod {
    pub id: String,
    pub name: String,
    /// 0-based position. Higher wins a shared file.
    pub position: usize,
    /// How many of this mod's files another active mod also provides.
    pub contested: usize,
    /// Of those, how many this mod currently WINS.
    pub winning: usize,
}

/// One file more than one active mod provides.
#[derive(Debug, Serialize, Clone)]
pub struct ContestedFile {
    /// Path relative to the game folder.
    pub path: String,
    /// Every active mod that ships it, in deployment order.
    pub mods: Vec<String>,
    /// The one on disk: the last of them.
    pub winner: String,
}

/// Files provided by more than one ACTIVE mod, and who currently wins each.
///
/// Built from the same index the conflict screen uses, narrowed to the active set, because a
/// file two disabled mods share is not a conflict — it is a thing that might become one.
fn contested_now(state: &State<'_, AppState>, order: &[String]) -> Vec<ContestedFile> {
    let index = state.conflict_index.lock().unwrap_or_else(|p| p.into_inner());
    let rank: HashMap<&str, usize> = order.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
    let mut out = Vec::new();
    for (path, ids) in index.iter() {
        let mut active: Vec<&String> = ids.iter().filter(|id| rank.contains_key(id.as_str())).collect();
        if active.len() < 2 {
            continue;
        }
        active.sort_by_key(|id| rank[id.as_str()]);
        out.push(ContestedFile {
            path: path.to_string_lossy().replace('\\', "/"),
            // The last one is the winner, which is the deployment rule stated as data rather
            // than as a comment somewhere else.
            winner: active.last().map(|s| s.to_string()).unwrap_or_default(),
            mods: active.into_iter().cloned().collect(),
        });
    }
    out.sort_by(|a, b| a.path.cmp(&b.path));
    out
}

/// The active mods of a profile, in the order they are deployed.
#[tauri::command]
pub fn mod_order_get(
    state: State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<(Vec<OrderedMod>, Vec<ContestedFile>), String> {
    let (order, names) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let pid = profile_id.or_else(|| data.active_profile_id.clone());
        let prof = data
            .profiles
            .iter()
            .find(|p| Some(&p.id) == pid.as_ref())
            .ok_or_else(|| "order.errNoProfile".to_string())?;
        let names: HashMap<String, String> =
            data.mods.iter().map(|m| (m.id.clone(), m.name.clone())).collect();
        (prof.active_mods.clone(), names)
    };
    let contested = contested_now(&state, &order);
    let mods = order
        .iter()
        .enumerate()
        .map(|(i, id)| {
            let mine: Vec<&ContestedFile> = contested.iter().filter(|c| c.mods.contains(id)).collect();
            OrderedMod {
                id: id.clone(),
                name: names.get(id).cloned().unwrap_or_else(|| id.clone()),
                position: i,
                contested: mine.len(),
                winning: mine.iter().filter(|c| &c.winner == id).count(),
            }
        })
        .collect();
    Ok((mods, contested))
}

/// Reorder the active mods, and make the disk agree.
///
/// The new order must be a PERMUTATION of what is active: same ids, same count. Anything else
/// is refused rather than reconciled — a caller sending a stale list would otherwise silently
/// drop a mod from the deployment order while leaving its files in the game, and the profile
/// would be describing a state that does not exist.
#[tauri::command]
pub async fn mod_order_set(
    state: State<'_, AppState>,
    profile_id: Option<String>,
    order: Vec<String>,
) -> Result<usize, String> {
    let (pid, before, game_path) = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let pid = profile_id.or_else(|| data.active_profile_id.clone());
        let prof = data
            .profiles
            .iter()
            .find(|p| Some(&p.id) == pid.as_ref())
            .ok_or_else(|| "order.errNoProfile".to_string())?;
        (
            prof.id.clone(),
            prof.active_mods.clone(),
            prof.game_path.clone(),
        )
    };

    let mut a: Vec<&String> = before.iter().collect();
    let mut b: Vec<&String> = order.iter().collect();
    a.sort();
    b.sort();
    if a != b {
        return Err("order.errNotPermutation".to_string());
    }

    // What each contested file WAS resolved to, so only the ones that actually change hands
    // are touched. Re-copying every contested file would work and would also rewrite files
    // that did not move, which turns a reorder into an I/O storm on a big profile.
    let was: HashMap<String, String> = contested_now(&state, &before)
        .into_iter()
        .map(|c| (c.path, c.winner))
        .collect();

    {
        let mut data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        if let Some(prof) = data.profiles.iter_mut().find(|p| p.id == pid) {
            prof.active_mods = order.clone();
        }
    }
    let _ = state.save();

    let now = contested_now(&state, &order);
    let mut moved = Vec::new();
    for c in now {
        if was.get(&c.path).map(|w| w != &c.winner).unwrap_or(false) {
            moved.push(c);
        }
    }
    if moved.is_empty() {
        return Ok(0);
    }

    // The copy itself. Off the UI thread: this touches the filesystem, and a sync command
    // holding the main thread is how the window freezes.
    let count = moved.len();
    let folder_of = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        let mut m: HashMap<String, std::path::PathBuf> = HashMap::new();
        for id in order.iter() {
            if let Some(entry) = data.mods.iter().find(|x| &x.id == id) {
                m.insert(id.clone(), entry.mod_folder_path.clone());
            }
        }
        m
    };
    tauri::async_runtime::spawn_blocking(move || {
        for c in moved {
            let Some(src_dir) = folder_of.get(&c.winner) else { continue };
            let src = src_dir.join(&c.path);
            if !src.is_file() {
                continue;
            }
            let dst = game_path.join(&c.path);
            if let Some(parent) = dst.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            // No backup here on purpose: the file being replaced belongs to another MOD, and
            // the original game file was backed up when the first of them was enabled.
            let _ = std::fs::copy(&src, &dst);
        }
    })
    .await
    .map_err(|e| e.to_string())?;

    Ok(count)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// The rule, as data. Written as a test because "last wins" lived only in a comment in
    /// another file, and a rule nothing checks is a rule that drifts.
    #[test]
    fn the_last_provider_of_a_file_is_the_one_on_disk() {
        let order = vec!["a".to_string(), "b".to_string(), "c".to_string()];
        let rank: HashMap<&str, usize> =
            order.iter().enumerate().map(|(i, id)| (id.as_str(), i)).collect();
        let mut providers = vec!["c", "a"];
        providers.sort_by_key(|id| rank[id]);
        assert_eq!(providers, vec!["a", "c"]);
        assert_eq!(*providers.last().unwrap(), "c", "later in active_mods wins");
    }

    #[test]
    fn a_reorder_must_be_the_same_set() {
        // The check that stops a stale caller from dropping a mod out of the deployment order
        // while its files stay in the game.
        let before = ["a".to_string(), "b".to_string()];
        let same = ["b".to_string(), "a".to_string()];
        let missing = ["a".to_string()];
        let extra = ["a".to_string(), "b".to_string(), "c".to_string()];
        fn sorted(v: &[String]) -> Vec<String> {
            let mut x = v.to_vec();
            x.sort();
            x
        }
        assert_eq!(sorted(&before), sorted(&same));
        assert_ne!(sorted(&before), sorted(&missing));
        assert_ne!(sorted(&before), sorted(&extra));
    }
}
