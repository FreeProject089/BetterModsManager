//! Running BMM as administrator, when a game lives in a folder Windows protects.
//!
//! A game installed under C:\Program Files (DCS World's default) cannot be written by a program
//! that is not elevated; the deploy then answers `PROTECTED_FOLDER|…` (fs_utils.rs) and the
//! Library offers « Restart BMM as administrator » (features/mods/protected-folder.ts). These are
//! the commands behind it:
//!
//!   · `get_elevation_state`      is this BMM elevated?
//!   · `check_folder_protection`  is this folder under Program Files / Windows, and does it matter
//!                                (it does not when BMM already runs elevated)?
//!   · `restart_elevated`         save, start BMM again with the `runas` verb (Windows shows its
//!                                UAC prompt: the person decides, nothing is elevated silently),
//!                                then close this one. The profile is the saved active profile.
//!
//! The new instance is started with `--bmm-elevated-from <pid>` and waits (`wait_for_parent`,
//! called first thing in main) for this one to end, so the single-instance guard does not hand it
//! back to the old window.

use serde::Serialize;
use tauri::State;

use crate::state::AppState;

/// The argument an elevated relaunch carries: the pid of the instance that asked.
pub const ELEVATED_FROM_ARG: &str = "--bmm-elevated-from";

/// How long the new instance waits for the old one to close.
const PARENT_WAIT_MS: u32 = 15_000;

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct ElevationState {
    pub elevated: bool,
    /// Windows only: elsewhere there is nothing to restart into.
    pub can_elevate: bool,
}

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct FolderProtection {
    /// Under Program Files, Program Files (x86) or Windows.
    pub protected: bool,
    /// Which of them.
    pub root: Option<String>,
    pub elevated: bool,
    /// Protected AND this BMM is not elevated: activating a mod there will be refused.
    pub needs_elevation: bool,
}

/// `check_folder_protection`'s answer for a path, a set of protected roots and an elevation state.
pub fn folder_protection(path: &str, roots: &[std::path::PathBuf], elevated: bool) -> FolderProtection {
    let root = if path.trim().is_empty() {
        None
    } else {
        crate::fs_utils::protected_root_of(std::path::Path::new(path.trim()), roots)
    };
    let protected = root.is_some();
    FolderProtection {
        protected,
        root: root.map(|r| r.display().to_string()),
        elevated,
        needs_elevation: protected && !elevated,
    }
}

#[tauri::command]
pub async fn get_elevation_state() -> Result<ElevationState, String> {
    Ok(ElevationState { elevated: crate::commands::proc::is_elevated(), can_elevate: cfg!(windows) })
}

#[tauri::command]
pub async fn check_folder_protection(path: String) -> Result<FolderProtection, String> {
    Ok(folder_protection(&path, &crate::fs_utils::protected_roots(), crate::commands::proc::is_elevated()))
}

/// The parameter string of the elevated relaunch: a constant and a number, never user text.
pub fn relaunch_args(pid: u32) -> String {
    format!("{ELEVATED_FROM_ARG} {pid}")
}

/// The pid after `--bmm-elevated-from`, when it is a plain number.
pub fn parent_pid_from_args(argv: &[String]) -> Option<u32> {
    let i = argv.iter().position(|a| a == ELEVATED_FROM_ARG)?;
    argv.get(i + 1)?.parse::<u32>().ok().filter(|p| *p != 0)
}

/// First thing in main: an elevated relaunch waits for the instance that started it to close.
pub fn wait_for_parent(argv: &[String]) {
    #[cfg(windows)]
    if let Some(pid) = parent_pid_from_args(argv) {
        let _ = crate::commands::proc::wait_for_pid_exit(pid, PARENT_WAIT_MS);
    }
    #[cfg(not(windows))]
    let _ = (argv, PARENT_WAIT_MS);
}

/// Save, ask Windows to start BMM elevated (its UAC prompt), and close this instance once the
/// new one started. Errors are translation keys, or Windows' own text for anything else.
#[tauri::command]
pub async fn restart_elevated(app: tauri::AppHandle, state: State<'_, AppState>) -> Result<(), String> {
    if crate::commands::proc::is_elevated() {
        return Err("mod.elevation.errAlreadyElevated".to_string());
    }
    #[cfg(not(windows))]
    {
        let _ = (app, state);
        return Err("mod.elevation.errUnsupported".to_string());
    }
    #[cfg(windows)]
    {
        // The active profile and everything else as they are now: the new instance reads them.
        state.save().map_err(|e| e.to_string())?;
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let args = relaunch_args(std::process::id());
        // Off the async runtime: ShellExecuteExW waits while the UAC prompt is open.
        let started = tauri::async_runtime::spawn_blocking(move || crate::commands::proc::shell_runas(&exe, Some(&args)))
            .await
            .map_err(|e| e.to_string())?;
        match started {
            Ok(()) => {
                crate::commands::crash::log_line("[ELEVATION] elevated BMM started, closing this instance");
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(300));
                    app.exit(0);
                });
                Ok(())
            }
            Err(e) if e.code == crate::commands::proc::ERROR_CANCELLED => Err("mod.elevation.errDeclined".to_string()),
            Err(e) => Err(e.message),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    #[test]
    fn the_relaunch_argument_round_trips_and_refuses_anything_else() {
        let a: Vec<String> = ["bmm.exe".to_string()].into_iter()
            .chain(relaunch_args(4242).split(' ').map(str::to_string)).collect();
        assert_eq!(parent_pid_from_args(&a), Some(4242));
        for bad in [vec!["bmm.exe", ELEVATED_FROM_ARG], vec!["bmm.exe", ELEVATED_FROM_ARG, "x"], vec!["bmm.exe", ELEVATED_FROM_ARG, "0"], vec!["bmm.exe"]] {
            let v: Vec<String> = bad.iter().map(|s| s.to_string()).collect();
            assert_eq!(parent_pid_from_args(&v), None, "{v:?}");
        }
    }

    #[test]
    fn a_protected_folder_needs_elevation_only_when_bmm_is_not_elevated() {
        let roots = vec![PathBuf::from(r"C:\Program Files")];
        let dcs = r"C:\Program Files\Eagle Dynamics\DCS World";
        let p = folder_protection(dcs, &roots, false);
        assert!(p.protected && p.needs_elevation);
        assert_eq!(p.root.as_deref(), Some(r"C:\Program Files"));
        assert!(!folder_protection(dcs, &roots, true).needs_elevation, "elevated: nothing to warn about");
        let free = folder_protection(r"E:\Games\DCS World", &roots, false);
        assert!(!free.protected && !free.needs_elevation && free.root.is_none());
        assert!(!folder_protection("  ", &roots, false).protected);
    }
}
