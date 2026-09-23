//! The scheduler's run log (PLAN-BMM-RESOURCES-2026.md §5.1, phase A1).
//!
//! A task used to keep only `history: {at, ok, ms, err} × 20` inside its own JSON: whether it
//! failed, never where or why. Each run is now a record with its steps (path in the tree,
//! label, start, duration, status, captured output, error), appended as one JSON line to
//! `<app-data>/TaskRuns/<id>.jsonl`.
//!
//! Three rules this file holds:
//!   · the file name comes from the task id filtered to [A-Za-z0-9_-], so an id cannot walk out
//!     of the folder;
//!   · the log is capped (50 runs AND 2 MB per task, oldest dropped first), so a task that runs
//!     every minute cannot fill the disk;
//!   · appends are serialised by a process-wide lock and written as one write of one line, so
//!     two runs finishing together cannot interleave their lines.
//! Secrets are removed by the frontend before a record is sent (sched-runlog.ts, the same rules
//! as the .bmmpa export), and the log is never part of an export.

use serde_json::Value;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use tauri::{AppHandle, Manager};

pub const MAX_RUNS: usize = 50;
pub const MAX_BYTES: usize = 2 * 1024 * 1024;
/// A single record larger than this is refused rather than evicting the whole history.
pub const MAX_RECORD: usize = 256 * 1024;

static LOCK: Mutex<()> = Mutex::new(());

pub fn safe_id(id: &str) -> Option<String> {
    let s: String = id.chars().filter(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_')).take(80).collect();
    if s.is_empty() { None } else { Some(s) }
}

pub fn log_path(dir: &Path, task_id: &str) -> Option<PathBuf> {
    safe_id(task_id).map(|id| dir.join(format!("{id}.jsonl")))
}

/// Append one run record and trim the file to the caps. Pure on the folder it is given.
pub fn append_in(dir: &Path, task_id: &str, record: &Value) -> Result<(), String> {
    let path = log_path(dir, task_id).ok_or("invalid task id")?;
    if !record.is_object() { return Err("a run record must be an object".into()); }
    let line = serde_json::to_string(record).map_err(|e| e.to_string())?;
    if line.len() > MAX_RECORD { return Err("run record too large".into()); }
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    {
        let mut f = std::fs::OpenOptions::new().create(true).append(true).open(&path).map_err(|e| e.to_string())?;
        f.write_all(format!("{line}\n").as_bytes()).map_err(|e| e.to_string())?;
    }
    trim(&path)
}

fn trim(path: &Path) -> Result<(), String> {
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut lines: Vec<&str> = text.lines().filter(|l| !l.trim().is_empty()).collect();
    let mut changed = false;
    while lines.len() > MAX_RUNS { lines.remove(0); changed = true; }
    while lines.iter().map(|l| l.len() + 1).sum::<usize>() > MAX_BYTES && lines.len() > 1 { lines.remove(0); changed = true; }
    if changed {
        let tmp = path.with_extension("jsonl.tmp");
        std::fs::write(&tmp, lines.join("\n") + "\n").map_err(|e| e.to_string())?;
        std::fs::rename(&tmp, path).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// The runs, newest first. A corrupt line is skipped, not fatal.
pub fn list_in(dir: &Path, task_id: &str) -> Result<Vec<Value>, String> {
    let path = log_path(dir, task_id).ok_or("invalid task id")?;
    let text = match std::fs::read_to_string(&path) { Ok(t) => t, Err(_) => return Ok(Vec::new()) };
    let mut v: Vec<Value> = text.lines().filter_map(|l| serde_json::from_str(l).ok()).collect();
    v.reverse();
    Ok(v)
}

fn runs_dir(app: &AppHandle) -> Result<PathBuf, String> {
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("TaskRuns"))
}

#[tauri::command]
pub fn sched_run_append(app: AppHandle, task_id: String, record: Value) -> Result<(), String> {
    append_in(&runs_dir(&app)?, &task_id, &record)
}

#[tauri::command]
pub fn sched_runs_list(app: AppHandle, task_id: String) -> Result<Vec<Value>, String> {
    list_in(&runs_dir(&app)?, &task_id)
}

#[tauri::command]
pub fn sched_runs_clear(app: AppHandle, task_id: String) -> Result<(), String> {
    let _g = LOCK.lock().unwrap_or_else(|p| p.into_inner());
    let path = log_path(&runs_dir(&app)?, &task_id).ok_or("invalid task id")?;
    match std::fs::remove_file(path) { Ok(()) => Ok(()), Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()), Err(e) => Err(e.to_string()) }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bmm-runs-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        d
    }

    #[test]
    fn a_run_records_each_step_with_status_and_duration() {
        let d = scratch("steps");
        let rec = json!({ "id": "r1", "ok": false, "steps": [
            { "path": "0", "label": "Backup", "ms": 120, "status": "ok" },
            { "path": "1", "label": "Deploy", "ms": 40, "status": "error", "error": "file in use" },
        ]});
        append_in(&d, "task-1", &rec).unwrap();
        let runs = list_in(&d, "task-1").unwrap();
        assert_eq!(runs.len(), 1);
        assert_eq!(runs[0]["steps"][1]["status"], "error");
        assert_eq!(runs[0]["steps"][1]["error"], "file in use");
    }

    #[test]
    fn the_log_is_capped_by_count_and_size() {
        let d = scratch("cap");
        for i in 0..(MAX_RUNS + 7) { append_in(&d, "t", &json!({ "n": i })).unwrap(); }
        let runs = list_in(&d, "t").unwrap();
        assert_eq!(runs.len(), MAX_RUNS);
        assert_eq!(runs[0]["n"], MAX_RUNS + 6, "newest first");
        assert_eq!(runs[MAX_RUNS - 1]["n"], 7, "the oldest were dropped");
        // By size: 200 KB records, 2 MB cap → about ten kept.
        let big = "x".repeat(200 * 1024);
        for i in 0..20 { append_in(&d, "big", &json!({ "n": i, "out": big })).unwrap(); }
        let len = std::fs::metadata(log_path(&d, "big").unwrap()).unwrap().len() as usize;
        assert!(len <= MAX_BYTES, "file {len} bytes over the cap");
        assert_eq!(list_in(&d, "big").unwrap()[0]["n"], 19);
        assert!(append_in(&d, "big", &json!({ "out": "y".repeat(MAX_RECORD + 1) })).is_err(), "one huge record is refused, not allowed to evict everything");
    }

    #[test]
    fn a_task_id_cannot_escape_the_runs_folder() {
        let d = scratch("escape");
        let p = log_path(&d, "../../evil").unwrap();
        assert_eq!(p, d.join("evil.jsonl"));
        let p = log_path(&d, "C:\\Windows\\x").unwrap();
        assert_eq!(p.parent().unwrap(), d.as_path());
        assert!(log_path(&d, "../..").is_none(), "an id that is nothing but traversal is refused");
        assert!(append_in(&d, "", &json!({})).is_err());
        assert!(append_in(&d, "ok", &json!([1, 2])).is_err(), "only objects");
    }

    #[test]
    fn two_runs_appending_at_once_do_not_interleave_lines() {
        let d = scratch("race");
        let mut hs = Vec::new();
        for t in 0..8 {
            let d2 = d.clone();
            hs.push(std::thread::spawn(move || {
                for i in 0..5 { append_in(&d2, "shared", &json!({ "thread": t, "i": i, "pad": "z".repeat(4000) })).unwrap(); }
            }));
        }
        for h in hs { h.join().unwrap(); }
        let text = std::fs::read_to_string(log_path(&d, "shared").unwrap()).unwrap();
        let lines: Vec<&str> = text.lines().collect();
        assert_eq!(lines.len(), 40);
        for l in lines { serde_json::from_str::<Value>(l).expect("every line is a whole record"); }
    }

    #[test]
    fn a_corrupt_line_is_skipped_not_fatal() {
        let d = scratch("corrupt");
        append_in(&d, "c", &json!({ "n": 1 })).unwrap();
        let p = log_path(&d, "c").unwrap();
        let mut f = std::fs::OpenOptions::new().append(true).open(&p).unwrap();
        f.write_all(b"{half a line\n").unwrap();
        drop(f);
        append_in(&d, "c", &json!({ "n": 2 })).unwrap();
        let runs = list_in(&d, "c").unwrap();
        assert_eq!(runs.iter().map(|r| r["n"].as_i64().unwrap()).collect::<Vec<_>>(), vec![2, 1]);
    }
}
