use std::time::Instant;
use serde::Serialize;
use lazy_static::lazy_static;
use crate::error::AppError;

lazy_static! {
    static ref START_TIME: Instant = Instant::now();
}

#[derive(Serialize)]
pub struct DebugStats {
    pub pid: u32,
    pub uptime_secs: u64,
    pub memory_mb: u64,
}


#[tauri::command]
pub async fn get_debug_stats() -> Result<DebugStats, AppError> {
    use sysinfo::System;
    let mut sys = System::new();
    
    let pid = std::process::id();
    let sys_pid = sysinfo::Pid::from(pid as usize);

    sys.refresh_process(sys_pid);
    
    let memory_mb = sys.process(sys_pid)
        .map(|p| p.memory() / 1024 / 1024)
        .unwrap_or(0);

    Ok(DebugStats {
        pid,
        uptime_secs: START_TIME.elapsed().as_secs(),
        memory_mb,
    })
}

#[tauri::command]
pub async fn get_rust_logs(max_lines: Option<usize>) -> Result<Vec<String>, AppError> {
    let limit = max_lines.unwrap_or(200);
    let logs = crate::commands::crash::get_log_lines();
    let start = if logs.len() > limit { logs.len() - limit } else { 0 };
    Ok(logs[start..].to_vec())
}

/// One file that answers "what state was BMM in?" — the production diagnostic.
///
/// In a dev build you attach a debugger; in the shipped app the user has none of that,
/// and "améliore le débogueur pour la prod" means exactly this: everything a bug report
/// needs, gathered in one click into one JSON the user can attach — instead of being
/// asked to screenshot the devtools, find a log file by hand, and recall their version.
///
/// Deliberately NOT included: paths of the user's mods, profile names, repo URLs.
/// A diagnostic travels — to Discord, to an issue tracker — and must be safe to post
/// as-is. What it carries is the app's own state: build, uptime, memory, and the same
/// in-memory log lines the Rust tab already shows.
#[tauri::command]
pub async fn export_diagnostics(
    app: tauri::AppHandle,
    frontend: Option<serde_json::Value>,
) -> Result<String, AppError> {
    use tauri::Manager;
    let stats = get_debug_stats().await?;
    let logs = crate::commands::crash::get_log_lines();
    let doc = serde_json::json!({
        "app": "better-mods-manager",
        "version": app.package_info().version.to_string(),
        // Which binary this is — a "debug" here explains every perf number in the file.
        "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
        "pid": stats.pid,
        "uptime_secs": stats.uptime_secs,
        "memory_mb": stats.memory_mb,
        "exported_at": chrono::Local::now().to_rfc3339(),
        "log_lines": logs,
        // The webview's own environment, which this process structurally cannot see.
        // It is where a whole class of "the app is broken" reports actually lives: a
        // frozen spinner that turned out to be Windows' "Animation effects" switch
        // reaching the WebView as prefers-reduced-motion took three wrong diagnoses to
        // find, because nothing reported it. Null when the caller sends nothing.
        "frontend": frontend,
    });

    let dir = app.path().app_data_dir().map_err(|e| AppError::from(e.to_string()))?.join("diagnostics");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::from(e.to_string()))?;
    let path = dir.join(format!("bmm-diag-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    std::fs::write(&path, serde_json::to_vec_pretty(&doc).map_err(|e| AppError::from(e.to_string()))?)
        .map_err(|e| AppError::from(e.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

/// A diagnostic report a human can read, as Markdown.
///
/// `export_diagnostics` writes JSON, which is right for a machine and wrong for the
/// moment it is actually used: someone pasting their problem into a chat. Nobody
/// reads a wall of JSON, so the useful facts get lost among the ones that happen to
/// be adjacent. This is the same data, ordered so the first screen answers "what is
/// this and what went wrong".
#[tauri::command(async)]
pub async fn generate_diagnostic_report(
    app: tauri::AppHandle,
    frontend: Option<serde_json::Value>,
) -> Result<String, AppError> {
    use std::fmt::Write as _;
    use tauri::Manager;

    let stats = get_debug_stats().await?;
    let logs = crate::commands::crash::get_log_lines();
    let mut r = String::new();

    let _ = writeln!(r, "# BMM diagnostic report");
    let _ = writeln!(r, "\n_Generated {}_\n", chrono::Local::now().to_rfc3339());

    let _ = writeln!(r, "## Build");
    let _ = writeln!(r, "| | |\n|---|---|");
    let _ = writeln!(r, "| Version | {} |", app.package_info().version);
    // A debug build explains every performance number below it, so it is stated
    // rather than left for the reader to wonder about.
    let _ = writeln!(r, "| Profile | {} |", if cfg!(debug_assertions) { "debug" } else { "release" });
    let _ = writeln!(r, "| OS / arch | {} / {} |", std::env::consts::OS, std::env::consts::ARCH);
    let _ = writeln!(r, "| PID | {} |", stats.pid);
    let _ = writeln!(r, "| Uptime | {} s |", stats.uptime_secs);
    let _ = writeln!(r, "| Memory | {} MB |", stats.memory_mb);

    // The webview half. This is the part that keeps turning out to matter — a
    // spinner that would not turn was an OS accessibility switch reaching the
    // WebView as prefers-reduced-motion, invisible in every screenshot of it.
    if let Some(fe) = frontend.as_ref().and_then(|v| v.as_object()) {
        let _ = writeln!(r, "\n## Web view");
        let _ = writeln!(r, "| | |\n|---|---|");
        for key in [
            "prefersReducedMotion", "prefersColorScheme", "prefersContrast", "forcedColors",
            "viewport", "devicePixelRatio", "language", "theme", "docked", "noAnim",
        ] {
            if let Some(v) = fe.get(key) {
                let _ = writeln!(r, "| {} | {} |", key, v.to_string().trim_matches('"'));
            }
        }
        if let Some(errs) = fe.get("recentErrors").and_then(|v| v.as_array()) {
            let _ = writeln!(r, "\n## Recent web view errors ({})", errs.len());
            if errs.is_empty() {
                let _ = writeln!(r, "\n_None this session._");
            } else {
                // Newest first: the error that made someone open this is the last one
                // that happened, and it should not be at the bottom of a long list.
                for e in errs.iter().rev().take(15) {
                    let get = |k: &str| e.get(k).and_then(|v| v.as_str()).unwrap_or("").to_string();
                    let _ = writeln!(r, "\n- **{}** `{}`\n  {}", get("kind"), get("at"), get("message"));
                    let src = get("source");
                    if !src.is_empty() { let _ = writeln!(r, "  _{}_", src); }
                }
            }
        }
        if let Some(ua) = fe.get("userAgent").and_then(|v| v.as_str()) {
            let _ = writeln!(r, "\n<details><summary>User agent</summary>\n\n`{}`\n\n</details>", ua);
        }
    } else {
        let _ = writeln!(r, "\n## Web view\n\n_Not supplied._");
    }

    // Folded, because it is long and is the least likely part to be read first —
    // but present, because it is the part that answers the follow-up question.
    let _ = writeln!(r, "\n<details><summary>Backend log — last {} lines</summary>\n\n```", logs.len().min(200));
    for line in logs.iter().rev().take(200).rev() {
        let _ = writeln!(r, "{}", line);
    }
    let _ = writeln!(r, "```\n\n</details>");

    let dir = app.path().app_data_dir().map_err(|e| AppError::from(e.to_string()))?.join("diagnostics");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::from(e.to_string()))?;
    let path = dir.join(format!("bmm-report-{}.md", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    std::fs::write(&path, r.as_bytes()).map_err(|e| AppError::from(e.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

/// A memory SNAPSHOT — deliberately not a crash minidump, and named accordingly.
///
/// A real minidump on Windows means either a new FFI dependency on dbghelp, or
/// `rundll32 comsvcs.dll MiniDump`, which every antivirus flags hard because it is
/// the standard LSASS-theft technique. Making BMM look like malware to gain a debug
/// button is a bad trade, and a button labelled "dump" that silently produces
/// something else is worse. So: what can be measured honestly, sampled over a short
/// window so a leak shows as a slope rather than a single number that proves nothing.
#[tauri::command(async)]
pub async fn capture_memory_snapshot(
    app: tauri::AppHandle,
    js_heap: Option<serde_json::Value>,
) -> Result<String, AppError> {
    use sysinfo::System;
    use tauri::Manager;

    let pid = std::process::id();
    let mut sys = System::new();
    // Same construction get_debug_stats uses. The newer ProcessesToUpdate API is not
    // in this sysinfo version — matching the file rather than the docs.
    let spid = sysinfo::Pid::from(pid as usize);

    let mut samples: Vec<serde_json::Value> = Vec::new();
    for i in 0..6 {
        sys.refresh_process(spid);
        if let Some(proc_) = sys.process(spid) {
            samples.push(serde_json::json!({
                "at_ms": i * 500,
                "memory_kb": proc_.memory() / 1024,
                "virtual_kb": proc_.virtual_memory() / 1024,
            }));
        }
        if i < 5 { std::thread::sleep(std::time::Duration::from_millis(500)); }
    }

    // The slope over the window, stated outright. A single memory figure tells you
    // nothing about a leak; the difference between the first and last sample is the
    // question the button is actually being pressed to answer.
    let trend_kb = match (samples.first(), samples.last()) {
        (Some(a), Some(b)) => b["memory_kb"].as_u64().unwrap_or(0) as i64
            - a["memory_kb"].as_u64().unwrap_or(0) as i64,
        _ => 0,
    };

    let doc = serde_json::json!({
        "kind": "memory-snapshot",
        "note": "Sampled process memory over 2.5s. NOT a crash minidump — see capture_memory_snapshot in debug.rs for why.",
        "pid": pid,
        "captured_at": chrono::Local::now().to_rfc3339(),
        "profile": if cfg!(debug_assertions) { "debug" } else { "release" },
        "samples": samples,
        "trend_kb_over_window": trend_kb,
        // The web view's heap, which the process figure above does not separate out
        // and which is where an app like this actually leaks.
        "js_heap": js_heap,
    });

    let dir = app.path().app_data_dir().map_err(|e| AppError::from(e.to_string()))?.join("diagnostics");
    std::fs::create_dir_all(&dir).map_err(|e| AppError::from(e.to_string()))?;
    let path = dir.join(format!("bmm-memory-{}.json", chrono::Local::now().format("%Y%m%d-%H%M%S")));
    std::fs::write(&path, serde_json::to_vec_pretty(&doc).map_err(|e| AppError::from(e.to_string()))?)
        .map_err(|e| AppError::from(e.to_string()))?;
    Ok(path.to_string_lossy().to_string())
}

