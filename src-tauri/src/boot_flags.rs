//! Flags read in `main()` BEFORE WebView2 starts (PLAN-BMM-RESOURCES-2026.md, H3).
//!
//! One today: whether the interface may use the GPU. Some drivers crash WebView2's GPU
//! process (a black or frozen window, or a "GPU process isn't usable" restart loop); turning
//! hardware acceleration off is the standard way out, and it must be decided before the
//! webview exists, so it cannot live in data.json, which is loaded later.
//!
//! The file is `boot-flags.json` in the app-data folder. Its schema is strict and closed:
//! one boolean. Nothing from it is ever pasted into the browser arguments; the only thing it
//! can do is make BMM append the two FIXED flags below. A missing, unreadable or malformed file
//! means GPU on (the default), so a broken file can never lock the user into a state they
//! cannot see.
//!
//! When the user set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` themselves, theirs wins (BMM does
//! not touch that variable at all then) and the Settings screen says so.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

pub const FILE: &str = "boot-flags.json";
/// The only arguments this file can add, and they are constants.
pub const GPU_OFF_ARGS: &str = "--disable-gpu --disable-gpu-compositing";
/// Tauri's identifier: the app-data folder is `%APPDATA%\<identifier>` (tauri.conf.json).
const IDENTIFIER: &str = "com.bettermm.desktop";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootFlags {
    #[serde(default = "yes")]
    pub webview_gpu: bool,
}

fn yes() -> bool { true }

impl Default for BootFlags {
    fn default() -> Self { BootFlags { webview_gpu: true } }
}

/// What this process started with, for the Settings screen ("applies after a restart").
static STARTED_WITH_GPU: AtomicBool = AtomicBool::new(true);
static ENV_OVERRIDE: AtomicBool = AtomicBool::new(false);

/// The app-data folder before Tauri exists (Windows: roaming AppData + identifier).
pub fn early_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(IDENTIFIER))
}

/// Read the flags from `dir`. Missing, unreadable or malformed → the default (GPU on).
pub fn read(dir: &Path) -> BootFlags {
    std::fs::read_to_string(dir.join(FILE)).ok()
        .and_then(|s| serde_json::from_str::<BootFlags>(&s).ok())
        .unwrap_or_default()
}

pub fn write(dir: &Path, flags: BootFlags) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let body = serde_json::to_string_pretty(&flags).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{FILE}.tmp"));
    std::fs::write(&tmp, body).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(FILE)).map_err(|e| e.to_string())
}

/// The browser arguments BMM sets, given its own base list and the flags.
pub fn browser_args(base: &str, flags: BootFlags) -> String {
    if flags.webview_gpu { base.to_string() } else { format!("{base} {GPU_OFF_ARGS}") }
}

/// Called once in `main()`. Returns the arguments to set, or `None` when the user's own
/// environment variable must be left alone.
pub fn apply_at_boot(base: &str) -> Option<String> {
    if std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_ok() {
        ENV_OVERRIDE.store(true, Ordering::Relaxed);
        return None;
    }
    let flags = early_dir().map(|d| read(&d)).unwrap_or_default();
    STARTED_WITH_GPU.store(flags.webview_gpu, Ordering::Relaxed);
    Some(browser_args(base, flags))
}

#[derive(Serialize)]
pub struct WebviewGpuState {
    /// What is saved for the next start.
    pub enabled: bool,
    /// What this session started with.
    pub active: bool,
    /// The user's own WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is in charge; the switch does nothing.
    pub overridden: bool,
}

#[tauri::command]
pub fn get_webview_gpu(app: tauri::AppHandle) -> WebviewGpuState {
    use tauri::Manager;
    let enabled = app.path().app_data_dir().ok().map(|d| read(&d)).unwrap_or_default().webview_gpu;
    WebviewGpuState { enabled, active: STARTED_WITH_GPU.load(Ordering::Relaxed), overridden: ENV_OVERRIDE.load(Ordering::Relaxed) }
}

#[tauri::command]
pub fn set_webview_gpu(app: tauri::AppHandle, enabled: bool) -> Result<WebviewGpuState, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    write(&dir, BootFlags { webview_gpu: enabled })?;
    Ok(get_webview_gpu(app))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("bmm-bootflags-{tag}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&d);
        std::fs::create_dir_all(&d).unwrap();
        d
    }

    #[test]
    fn gpu_off_adds_exactly_the_two_fixed_flags() {
        assert_eq!(browser_args("--a --b", BootFlags { webview_gpu: true }), "--a --b");
        assert_eq!(browser_args("--a --b", BootFlags { webview_gpu: false }), "--a --b --disable-gpu --disable-gpu-compositing");
    }

    #[test]
    fn missing_or_corrupt_boot_flags_means_gpu_on() {
        let d = scratch("missing");
        assert!(read(&d).webview_gpu, "no file");
        std::fs::write(d.join(FILE), "{not json").unwrap();
        assert!(read(&d).webview_gpu, "corrupt file");
        std::fs::write(d.join(FILE), "").unwrap();
        assert!(read(&d).webview_gpu, "empty file");
    }

    #[test]
    fn boot_flags_rejects_anything_but_a_bool() {
        let d = scratch("strict");
        // A string where the bool goes, or an extra key trying to smuggle arguments in: both are
        // refused as a whole, which means the default, which means GPU on and no extra argument.
        std::fs::write(d.join(FILE), r#"{"webview_gpu":"--remote-debugging-port=9222"}"#).unwrap();
        assert!(read(&d).webview_gpu);
        std::fs::write(d.join(FILE), r#"{"webview_gpu":false,"args":"--remote-debugging-port=9222"}"#).unwrap();
        assert!(read(&d).webview_gpu, "unknown keys refuse the whole file");
        let args = browser_args("--base", read(&d));
        assert!(!args.contains("remote-debugging"));
    }

    #[test]
    fn write_then_read_round_trips() {
        let d = scratch("rt");
        write(&d, BootFlags { webview_gpu: false }).unwrap();
        assert!(!read(&d).webview_gpu);
        write(&d, BootFlags { webview_gpu: true }).unwrap();
        assert!(read(&d).webview_gpu);
    }
}
