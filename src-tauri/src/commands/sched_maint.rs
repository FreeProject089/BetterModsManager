//! Two jobs a scheduled task needed and had no command for: downloading a catalogue item
//! without installing it, and keeping the logs it writes from growing for ever.
//!
//! **`sched_download`** — « check my subscribed catalogue items and download the new versions,
//! I will install them myself ». Every other download in BMM installs as it goes. The rules are
//! the network rules of `sched_net.rs` (public addresses only, re-checked on every redirect,
//! connection pinned to the checked addresses, no proxy) plus three of its own, none of which a
//! task can lift:
//!
//!   - **https only** — the file is something that will be run;
//!   - **a SHA-256 is required** and checked as the bytes arrive; a mismatch deletes the partial
//!     file and fails. An entry without a checksum is not downloaded unattended — the same rule
//!     as the plugin auto-update (`checkPluginUpdates`);
//!   - **the file lands in the task's own folder** (`<output>/downloads/<name>`), under a name
//!     reduced to one safe path component, written to `.part` first and renamed only once the
//!     checksum matched — so a half download is never mistaken for a finished one.
//!
//! **`sched_logs_rotate`** — what a task writes with `log.print` and `file.write` accumulates in
//! `TaskOutput/<task>/`. This rotates every `*.log` there that grew past a size (`x.log` →
//! `x.1.log`, one old copy kept), drops rotated copies and session-report archives older than a
//! number of days, and with `dry_run` only says what it would do. Crash reports and BMM's own
//! audit logs are not touched: they are evidence, not clutter.
//!
//! Both run on the async runtime with tokio's file API (no blocking thread) under a governor
//! ticket — Download and Maintenance — with a checkpoint per chunk or per file, so the resource
//! preset and game mode slow or pause them like any other heavy work.

use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};
use tauri::{AppHandle, Manager};
use tokio::io::AsyncWriteExt;

use crate::commands::sched_net::{clean_err, pinned_client, refusal_text, resolve_checked, url_refusal};

/// Redirect hops a download may take (GitHub release assets take one or two).
const MAX_REDIRECTS: usize = 6;
/// The default ceiling on one download, and the hard one.
const DEFAULT_MAX_MB: u64 = 2048;
const HARD_MAX_MB: u64 = 16384;

// ── Download ─────────────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Debug)]
pub struct DownloadResult {
    pub path: String,
    pub bytes: u64,
    pub sha256: String,
}

/// Why this download may not start, or None. Pure, so the rules are tested without a network.
pub fn download_refusal(url: &str, sha256: &str) -> Option<&'static str> {
    if let Some(why) = url_refusal(url) {
        return Some(why);
    }
    if !url.trim().to_ascii_lowercase().starts_with("https://") {
        return Some("not-https");
    }
    let h = sha256.trim();
    if h.len() != 64 || !h.chars().all(|c| c.is_ascii_hexdigit()) {
        return Some("no-checksum");
    }
    None
}

/// One path component, never empty, never a dot name, never a reserved Windows device.
pub fn safe_file_name(raw: &str, fallback: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c.is_control() || "<>:\"/\\|?*".contains(c) { '_' } else { c })
        .collect();
    let trimmed = cleaned.trim().trim_matches('.').trim();
    let base = if trimmed.is_empty() { fallback } else { trimmed };
    let stem = base.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = ["CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "LPT1", "LPT2", "LPT3"];
    let mut out: String = if reserved.contains(&stem.as_str()) { format!("_{base}") } else { base.to_string() };
    if out.chars().count() > 120 {
        out = out.chars().take(120).collect();
    }
    out
}

/// The file name a URL ends in, if it has one worth keeping.
fn name_from_url(u: &reqwest::Url) -> String {
    u.path_segments()
        .and_then(|mut s| s.next_back().map(str::to_string))
        .map(|s| percent_decode(&s))
        .unwrap_or_default()
}

fn percent_decode(s: &str) -> String {
    let b = s.as_bytes();
    let mut out = Vec::with_capacity(b.len());
    let mut i = 0;
    while i < b.len() {
        if b[i] == b'%' && i + 2 < b.len() {
            if let Ok(v) = u8::from_str_radix(&s[i + 1..i + 3], 16) {
                out.push(v);
                i += 3;
                continue;
            }
        }
        out.push(b[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).to_string()
}

/// The task's output folder, resolved exactly as `task_write_file` resolves it.
fn task_root(app: &AppHandle, state: &tauri::State<'_, crate::state::AppState>, task_id: &str, output_dir: Option<&str>) -> Result<PathBuf, String> {
    match output_dir.map(str::trim).filter(|s| !s.is_empty()) {
        Some(d) => {
            let resolved = if crate::commands::bmm_paths_core::parse_spec(d).is_some() {
                crate::commands::bmm_paths_core::resolve_with(&crate::commands::bmm_paths::roots_now(app, state), d)?
            } else {
                d.to_string()
            };
            Ok(PathBuf::from(resolved))
        }
        None => crate::commands::task_output::default_output_dir(app, task_id),
    }
}

/// Download one file for a task: https, checked addresses, SHA-256 verified, into the task's
/// `downloads/` folder. Fails closed on every rule (see the module header).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn sched_download(
    app: AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    task_id: String,
    output_dir: Option<String>,
    url: String,
    sha256: String,
    file_name: Option<String>,
    max_mb: Option<u64>,
) -> Result<DownloadResult, String> {
    if let Some(why) = download_refusal(&url, &sha256) {
        return Err(match why {
            "not-https" => "sched.dl.notHttps".to_string(),
            "no-checksum" => "sched.dl.noChecksum".to_string(),
            other => refusal_text(other),
        });
    }
    let want = sha256.trim().to_ascii_lowercase();
    let cap = max_mb.unwrap_or(DEFAULT_MAX_MB).clamp(1, HARD_MAX_MB) * 1024 * 1024;
    let root = task_root(&app, &state, &task_id, output_dir.as_deref())?;
    let dir = root.join("downloads");

    let ticket = crate::governor::runtime::global()
        .begin_async(crate::governor::config::OpKind::Download, format!("task download {}", task_id))
        .await;

    let mut u = reqwest::Url::parse(url.trim()).map_err(|_| refusal_text("invalid"))?;
    let timeout = Duration::from_secs(30 * 60);
    let mut resp = None;
    for _ in 0..=MAX_REDIRECTS {
        let addrs = resolve_checked(&u, false).await?;
        let client = pinned_client(&u, &addrs, timeout)?;
        let r = client
            .get(u.clone())
            .header(reqwest::header::USER_AGENT, "BetterModsManager/1.0")
            .send()
            .await
            .map_err(clean_err)?;
        if r.status().is_redirection() {
            let loc = r
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "sched.net.redirect".to_string())?;
            let next = u.join(loc).map_err(|_| "sched.net.redirect".to_string())?;
            // A redirect may not downgrade to http, nor leave for a private address (checked
            // again at the top of the loop, on what the new name resolves to).
            if let Some(why) = download_refusal(next.as_str(), &want) {
                return Err(if why == "not-https" { "sched.dl.notHttps".to_string() } else { refusal_text(why) });
            }
            u = next;
            continue;
        }
        resp = Some(r);
        break;
    }
    let mut resp = resp.ok_or_else(|| "sched.net.redirect".to_string())?;
    if !resp.status().is_success() {
        return Err(format!("sched.dl.status|{}", resp.status().as_u16()));
    }
    if resp.content_length().is_some_and(|n| n > cap) {
        return Err("sched.net.tooLarge".to_string());
    }

    let name = {
        let given = file_name.as_deref().map(str::trim).filter(|s| !s.is_empty()).map(str::to_string);
        safe_file_name(&given.unwrap_or_else(|| name_from_url(&u)), "download.bin")
    };
    tokio::fs::create_dir_all(&dir).await.map_err(|e| format!("task.out.errWrite|{}", e))?;
    let dest = dir.join(&name);
    let part = dir.join(format!("{name}.part"));

    let mut file = tokio::fs::File::create(&part).await.map_err(|e| format!("task.out.errWrite|{}", e))?;
    let mut hasher = Sha256::new();
    let mut bytes: u64 = 0;
    let outcome: Result<(), String> = async {
        while let Some(chunk) = resp.chunk().await.map_err(clean_err)? {
            if ticket.checkpoint_async().await.is_err() {
                return Err("sched.dl.cancelled".to_string());
            }
            bytes += chunk.len() as u64;
            if bytes > cap {
                return Err("sched.net.tooLarge".to_string());
            }
            hasher.update(&chunk);
            file.write_all(&chunk).await.map_err(|e| format!("task.out.errWrite|{}", e))?;
        }
        file.flush().await.map_err(|e| format!("task.out.errWrite|{}", e))?;
        Ok(())
    }
    .await;
    drop(file);
    if let Err(e) = outcome {
        let _ = tokio::fs::remove_file(&part).await;
        return Err(e);
    }
    let got = hex(&hasher.finalize());
    if got != want {
        let _ = tokio::fs::remove_file(&part).await;
        crate::commands::crash::log_line(format!("[SCHED] download refused: checksum mismatch for {}", name));
        return Err("sched.dl.badChecksum".to_string());
    }
    let _ = tokio::fs::remove_file(&dest).await;
    tokio::fs::rename(&part, &dest).await.map_err(|e| format!("task.out.errWrite|{}", e))?;
    crate::commands::crash::log_line(format!("[SCHED] downloaded {} ({} bytes, sha256 ok)", name, bytes));
    Ok(DownloadResult { path: dest.to_string_lossy().to_string(), bytes, sha256: got })
}

fn hex(b: &[u8]) -> String {
    b.iter().map(|x| format!("{:02x}", x)).collect()
}

// ── Log rotation ─────────────────────────────────────────────────────────────────────────────

#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct RotateItem {
    pub path: String,
    /// `task-log` · `rotated-log` · `session-archive`
    pub kind: String,
    /// `rotate` · `delete`
    pub action: String,
    pub bytes: u64,
}

#[derive(Serialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct RotateReport {
    pub items: Vec<RotateItem>,
    pub freed_bytes: u64,
    pub rotated: u32,
    pub deleted: u32,
    pub dry_run: bool,
    pub errors: Vec<String>,
}

/// What to do with one file, from its name, size and age. Pure: the whole policy in one place.
pub fn rotation_for(name: &str, bytes: u64, age_days: u64, max_bytes: u64, keep_days: u64, in_task_dir: bool) -> Option<(&'static str, &'static str)> {
    let lower = name.to_ascii_lowercase();
    if in_task_dir {
        if lower.ends_with(".1.log") {
            return (age_days >= keep_days).then_some(("rotated-log", "delete"));
        }
        if lower.ends_with(".log") {
            return (bytes > max_bytes).then_some(("task-log", "rotate"));
        }
        return None;
    }
    // The session-report archive: zips only, older than the window.
    (lower.starts_with("session_") && lower.ends_with(".zip") && age_days >= keep_days).then_some(("session-archive", "delete"))
}

fn age_days(md: &std::fs::Metadata) -> u64 {
    md.modified()
        .ok()
        .and_then(|m| SystemTime::now().duration_since(m).ok())
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0)
}

/// Every plain file directly inside `dir` (links skipped: never followed, never removed).
async fn plain_files(dir: &Path) -> Vec<(PathBuf, std::fs::Metadata)> {
    let mut out = Vec::new();
    let Ok(mut rd) = tokio::fs::read_dir(dir).await else { return out };
    while let Ok(Some(e)) = rd.next_entry().await {
        let p = e.path();
        if let Ok(md) = tokio::fs::symlink_metadata(&p).await {
            if md.is_file() {
                out.push((p, md));
            }
        }
    }
    out
}

/// Rotate the logs tasks write, and drop old rotated copies and session-report archives.
#[tauri::command]
pub async fn sched_logs_rotate(app: AppHandle, keep_days: Option<u64>, max_kb: Option<u64>, dry_run: Option<bool>) -> Result<RotateReport, String> {
    let keep = keep_days.unwrap_or(30).clamp(1, 3650);
    let max_bytes = max_kb.unwrap_or(1024).clamp(16, 1024 * 1024) * 1024;
    let dry = dry_run.unwrap_or(false);
    let base = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let ticket = crate::governor::runtime::global()
        .begin_async(crate::governor::config::OpKind::Maintenance, "task logs rotation".to_string())
        .await;
    let mut r = RotateReport { dry_run: dry, ..Default::default() };

    // TaskOutput/<task>/*.log
    let mut dirs: Vec<PathBuf> = Vec::new();
    if let Ok(mut rd) = tokio::fs::read_dir(base.join("TaskOutput")).await {
        while let Ok(Some(e)) = rd.next_entry().await {
            if let Ok(md) = tokio::fs::symlink_metadata(e.path()).await {
                if md.is_dir() {
                    dirs.push(e.path());
                }
            }
        }
    }
    let mut plan: Vec<(PathBuf, RotateItem)> = Vec::new();
    for d in &dirs {
        for (p, md) in plain_files(d).await {
            let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
            if let Some((kind, action)) = rotation_for(&name, md.len(), age_days(&md), max_bytes, keep, true) {
                plan.push((p.clone(), RotateItem { path: p.to_string_lossy().to_string(), kind: kind.into(), action: action.into(), bytes: md.len() }));
            }
        }
    }
    // Crashes/Archive/Session/*.zip (crash reports are kept: they are evidence).
    for (p, md) in plain_files(&base.join("Crashes").join("Archive").join("Session")).await {
        let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        if let Some((kind, action)) = rotation_for(&name, md.len(), age_days(&md), max_bytes, keep, false) {
            plan.push((p.clone(), RotateItem { path: p.to_string_lossy().to_string(), kind: kind.into(), action: action.into(), bytes: md.len() }));
        }
    }

    for (p, item) in plan {
        if ticket.checkpoint_async().await.is_err() {
            r.errors.push("cancelled".into());
            break;
        }
        if !dry {
            let res = if item.action == "rotate" {
                // x.log → x.1.log, replacing the previous copy (counted as freed).
                let old = p.with_file_name(format!(
                    "{}.1.log",
                    p.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default()
                ));
                if let Ok(md) = tokio::fs::symlink_metadata(&old).await {
                    if md.is_file() && tokio::fs::remove_file(&old).await.is_ok() {
                        r.freed_bytes += md.len();
                    }
                }
                tokio::fs::rename(&p, &old).await
            } else {
                tokio::fs::remove_file(&p).await
            };
            if let Err(e) = res {
                r.errors.push(format!("{}: {}", item.path, e));
                continue;
            }
        }
        if item.action == "rotate" {
            r.rotated += 1;
        } else {
            r.deleted += 1;
            r.freed_bytes += item.bytes;
        }
        r.items.push(item);
    }
    if !dry {
        crate::commands::crash::log_line(format!("[SCHED] logs rotated: {} rotated, {} deleted, {} bytes freed", r.rotated, r.deleted, r.freed_bytes));
    }
    Ok(r)
}

#[cfg(test)]
mod tests {
    use super::*;

    const H: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    #[test]
    fn a_download_needs_https_and_a_checksum() {
        assert_eq!(download_refusal("https://example.com/a.zip", H), None);
        assert_eq!(download_refusal("http://example.com/a.zip", H), Some("not-https"));
        assert_eq!(download_refusal("https://example.com/a.zip", ""), Some("no-checksum"));
        assert_eq!(download_refusal("https://example.com/a.zip", "abc"), Some("no-checksum"));
        assert_eq!(download_refusal("https://example.com/a.zip", &H.replace('a', "g")), Some("no-checksum"));
        assert_eq!(download_refusal("file:///C:/x", H), Some("not-http"));
        assert_eq!(download_refusal("https://user:pw@example.com/a", H), Some("credentials"));
    }

    #[test]
    fn a_file_name_is_one_safe_component() {
        assert_eq!(safe_file_name("tool-1.2.zip", "x"), "tool-1.2.zip");
        assert_eq!(safe_file_name("../../evil.exe", "x"), "_.._evil.exe");
        assert_eq!(safe_file_name("a/b\\c:d", "x"), "a_b_c_d");
        assert_eq!(safe_file_name("   ", "download.bin"), "download.bin");
        assert_eq!(safe_file_name("..", "download.bin"), "download.bin");
        assert_eq!(safe_file_name("CON.txt", "x"), "_CON.txt");
        assert!(safe_file_name(&"a".repeat(400), "x").chars().count() <= 120);
        assert!(!safe_file_name("../x", "y").contains('/'));
    }

    #[test]
    fn a_url_name_is_decoded() {
        let u = reqwest::Url::parse("https://h/releases/My%20Tool%201.0.zip?x=1").unwrap();
        assert_eq!(name_from_url(&u), "My Tool 1.0.zip");
    }

    #[test]
    fn the_rotation_policy() {
        let mb = 1024 * 1024;
        // A task log: rotated past the size, left alone under it.
        assert_eq!(rotation_for("run.log", 2 * mb, 0, mb, 30, true), Some(("task-log", "rotate")));
        assert_eq!(rotation_for("run.log", 10, 400, mb, 30, true), None);
        // A rotated copy: dropped once older than the window.
        assert_eq!(rotation_for("run.1.log", 10, 31, mb, 30, true), Some(("rotated-log", "delete")));
        assert_eq!(rotation_for("run.1.log", 10, 2, mb, 30, true), None);
        // Anything else a task wrote is its own business.
        assert_eq!(rotation_for("report.md", 50 * mb, 900, mb, 30, true), None);
        // Session archives: old zips only. Crash archives never reach this function.
        assert_eq!(rotation_for("session_2026.zip", 10, 40, mb, 30, false), Some(("session-archive", "delete")));
        assert_eq!(rotation_for("session_2026.zip", 10, 3, mb, 30, false), None);
        assert_eq!(rotation_for("crash_2026.zip", 10, 400, mb, 30, false), None);
    }
}
