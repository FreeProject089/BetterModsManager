//! Where a task writes, and what stops it writing anywhere.
//!
//! A scheduled task could read files and run programs, and could not write a line anywhere.
//! So the way to record what a task did was to run a script that echoes into a file — which
//! needs the script permission, spawns a shell, and is a very large hammer for "note that this
//! happened".
//!
//! The rule is one sentence: **a relative path lands in the task's output folder.** An
//! absolute path or a place name is honoured as written, because a task told exactly where to
//! write was told on purpose. What is refused is the third case — a relative path that climbs
//! out of the folder it was given, which is the only one nobody means.

use serde::Serialize;
use tauri::{AppHandle, Manager};

/// Where a task writes by default.
///
/// Per-task, under BMM's own data folder. Not the game folder and not next to the executable:
/// a log written beside `better-mods-manager.exe` is one nobody finds and one an installer
/// eventually deletes.
pub fn default_output_dir(app: &AppHandle, task_id: &str) -> Result<std::path::PathBuf, String> {
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let safe = crate::commands::plugin_assets_core::safe_component(task_id);
    Ok(base.join("TaskOutput").join(safe))
}

/// What a write produced, for the caller to put in a variable.
#[derive(Serialize)]
pub struct WriteResult {
    pub path: String,
    pub bytes: u64,
}

/// Resolve where this write goes, without touching the disk.
///
/// Split out so the rule can be tested. It is the whole security surface of the feature, and
/// a rule you can only exercise by writing files is one that gets tested once.
pub fn destination(
    root: &std::path::Path,
    rel_or_abs: &str,
) -> Result<std::path::PathBuf, String> {
    let raw = rel_or_abs.trim();
    if raw.is_empty() {
        return Err("task.out.errNoPath".to_string());
    }
    let p = std::path::Path::new(raw);
    // Absolute means the caller named a place. Honoured: a task told to write to
    // `D:\reports\today.csv` was told that on purpose, and refusing would make the feature
    // useless for the case people actually have.
    if p.is_absolute() {
        return Ok(p.to_path_buf());
    }
    // Relative goes in the output folder, and may not leave it. `..` is the only shape here
    // that nobody writes by accident and everybody writes on purpose.
    for c in p.components() {
        if matches!(c, std::path::Component::ParentDir) {
            return Err("task.out.errOutside".to_string());
        }
    }
    Ok(root.join(p))
}

/// Write (or append to) a file on behalf of a task.
///
/// `output_dir` may itself be a place name \u2014 `mods:`, `plugin:x/bundle` \u2014 which is resolved
/// first, so "write into the folder that plugin ships" is one setting rather than a path that
/// breaks on the next machine.
#[tauri::command]
pub async fn task_write_file(
    app: AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    task_id: String,
    output_dir: Option<String>,
    path: String,
    text: String,
    append: Option<bool>,
) -> Result<String, String> {
    let root = match output_dir.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(d) => {
            let resolved = if crate::commands::bmm_paths_core::parse_spec(d).is_some() {
                crate::commands::bmm_paths_core::resolve_with(
                    &crate::commands::bmm_paths::roots_now(&app, &state),
                    d,
                )?
            } else {
                d.to_string()
            };
            std::path::PathBuf::from(resolved)
        }
        None => default_output_dir(&app, &task_id)?,
    };
    let dest = destination(&root, &path)?;
    let append = append.unwrap_or(false);

    // Off the UI thread. A sync command that touches the filesystem is how the window freezes
    // \u2014 and a task appending to a log on a slow network drive is exactly that case.
    let out = tauri::async_runtime::spawn_blocking(move || -> Result<WriteResult, String> {
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("task.out.errWrite|{}", e))?;
        }
        if append {
            use std::io::Write;
            let mut f = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&dest)
                .map_err(|e| format!("task.out.errWrite|{}", e))?;
            f.write_all(text.as_bytes()).map_err(|e| format!("task.out.errWrite|{}", e))?;
        } else {
            std::fs::write(&dest, text.as_bytes()).map_err(|e| format!("task.out.errWrite|{}", e))?;
        }
        Ok(WriteResult {
            bytes: dest.metadata().map(|m| m.len()).unwrap_or(0),
            path: dest.to_string_lossy().to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())??;

    Ok(out.path)
}

/// The folder a task writes into, for showing it and for opening it.
#[tauri::command]
pub fn task_output_dir(
    app: AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    task_id: String,
    output_dir: Option<String>,
) -> Result<String, String> {
    match output_dir.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(d) if crate::commands::bmm_paths_core::parse_spec(d).is_some() => {
            crate::commands::bmm_paths_core::resolve_with(
                &crate::commands::bmm_paths::roots_now(&app, &state),
                d,
            )
        }
        Some(d) => Ok(d.to_string()),
        None => Ok(default_output_dir(&app, &task_id)?.to_string_lossy().to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_relative_path_lands_in_the_output_folder() {
        let root = std::path::Path::new("C:/out/task-1");
        let got = destination(root, "run.log").unwrap();
        assert!(got.ends_with("run.log"));
        assert!(got.starts_with(root));
        // A subfolder is fine and is created on write.
        assert!(destination(root, "reports/today.csv").unwrap().starts_with(root));
    }

    #[test]
    fn an_absolute_path_is_honoured_because_it_was_meant() {
        // The feature is useless if a task cannot write where it was explicitly told to. This
        // is a decision, not an oversight, which is why it has a test saying so.
        let root = std::path::Path::new("C:/out/task-1");
        let got = destination(root, "D:/reports/today.csv").unwrap();
        assert_eq!(got, std::path::PathBuf::from("D:/reports/today.csv"));
    }

    #[test]
    fn a_relative_path_may_not_climb_out() {
        // The one shape nobody writes by accident.
        let root = std::path::Path::new("C:/out/task-1");
        for evil in ["../other/run.log", r"..\other\run.log", "reports/../../escape.txt"] {
            assert_eq!(destination(root, evil).unwrap_err(), "task.out.errOutside", "{}", evil);
        }
    }

    #[test]
    fn an_empty_path_is_refused_rather_than_writing_the_folder() {
        let root = std::path::Path::new("C:/out/task-1");
        assert_eq!(destination(root, "   ").unwrap_err(), "task.out.errNoPath");
    }
}
