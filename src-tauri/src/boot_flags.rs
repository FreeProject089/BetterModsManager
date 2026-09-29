//! Flags read in `main()` BEFORE WebView2 starts (PLAN-BMM-RESOURCES-2026.md, H3).
//!
//! Which graphics card the interface draws with, and whether it may use one at all. Both must
//! be decided before the webview exists, so they cannot live in data.json, which is loaded
//! later.
//!
//! - **Off**: some drivers crash WebView2's GPU process (a black or frozen window, or a "GPU
//!   process isn't usable" restart loop); turning hardware acceleration off is the standard way
//!   out. Two fixed switches: `--disable-gpu --disable-gpu-compositing`.
//! - **High performance / Power saving**: on a PC with two graphics cards (a laptop's integrated
//!   chip and its dedicated card), Chromium's own switches pick one for the window:
//!   `--force_high_performance_gpu` or `--force_low_power_gpu`. One fixed switch each.
//! - **Automatic** (the default) adds nothing: WebView2 and Windows choose, and a per-app
//!   choice made in Windows' Settings → Display → Graphics still applies.
//!
//! The file is `boot-flags.json` in the app-data folder. Its schema is strict and closed: a
//! boolean and one of three words. Nothing from it is ever pasted into the browser arguments;
//! the only thing it can do is make BMM append the FIXED switches below. A missing, unreadable
//! or malformed file (an unknown key, an unknown word) means the default, so a broken file can
//! never lock the user into a state they cannot see. A file an older BMM wrote (the boolean
//! alone) keeps its meaning.
//!
//! When the user set `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` themselves, theirs wins (BMM does
//! not touch that variable at all then) and the Settings screen says so.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU8, Ordering};

pub const FILE: &str = "boot-flags.json";
/// The only arguments this file can add, and they are constants.
pub const GPU_OFF_ARGS: &str = "--disable-gpu --disable-gpu-compositing";
pub const HIGH_PERFORMANCE_ARG: &str = "--force_high_performance_gpu";
pub const POWER_SAVING_ARG: &str = "--force_low_power_gpu";
/// Tauri's identifier: the app-data folder is `%APPDATA%\<identifier>` (tauri.conf.json).
const IDENTIFIER: &str = "com.bettermm.desktop";

/// Which graphics card the window asks for when the GPU is on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, Default)]
#[serde(rename_all = "snake_case")]
pub enum GpuPreference {
    #[default]
    Auto,
    PowerSaving,
    HighPerformance,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct BootFlags {
    #[serde(default = "yes")]
    pub webview_gpu: bool,
    #[serde(default)]
    pub gpu_preference: GpuPreference,
}

fn yes() -> bool { true }

impl Default for BootFlags {
    fn default() -> Self { BootFlags { webview_gpu: true, gpu_preference: GpuPreference::Auto } }
}

/// The one word the Settings screen shows and sends: auto | power_saving | high_performance | off.
pub fn mode_of(f: BootFlags) -> &'static str {
    if !f.webview_gpu { return "off"; }
    match f.gpu_preference {
        GpuPreference::Auto => "auto",
        GpuPreference::PowerSaving => "power_saving",
        GpuPreference::HighPerformance => "high_performance",
    }
}

/// The flags for a mode word. Anything else is refused: the word never reaches the arguments.
pub fn flags_for_mode(mode: &str) -> Result<BootFlags, String> {
    let (webview_gpu, gpu_preference) = match mode.trim() {
        "auto" => (true, GpuPreference::Auto),
        "power_saving" => (true, GpuPreference::PowerSaving),
        "high_performance" => (true, GpuPreference::HighPerformance),
        "off" => (false, GpuPreference::Auto),
        other => return Err(format!("unknown graphics mode: {other} (auto | power_saving | high_performance | off)")),
    };
    Ok(BootFlags { webview_gpu, gpu_preference })
}

fn mode_code(f: BootFlags) -> u8 {
    match mode_of(f) { "off" => 3, "power_saving" => 1, "high_performance" => 2, _ => 0 }
}
fn mode_from_code(c: u8) -> &'static str {
    match c { 3 => "off", 1 => "power_saving", 2 => "high_performance", _ => "auto" }
}

/// What this process started with, for the Settings screen ("applies after a restart").
static STARTED_WITH_GPU: AtomicBool = AtomicBool::new(true);
static STARTED_MODE: AtomicU8 = AtomicU8::new(0);
static ENV_OVERRIDE: AtomicBool = AtomicBool::new(false);

/// The app-data folder before Tauri exists (Windows: roaming AppData + identifier).
pub fn early_dir() -> Option<PathBuf> {
    std::env::var_os("APPDATA").map(|d| PathBuf::from(d).join(IDENTIFIER))
}

/// Read the flags from `dir`. Missing, unreadable or malformed → the default (GPU on, automatic).
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
    if !flags.webview_gpu { return format!("{base} {GPU_OFF_ARGS}"); }
    match flags.gpu_preference {
        GpuPreference::Auto => base.to_string(),
        GpuPreference::HighPerformance => format!("{base} {HIGH_PERFORMANCE_ARG}"),
        GpuPreference::PowerSaving => format!("{base} {POWER_SAVING_ARG}"),
    }
}

/// The arguments for a start, from the flags saved in `dir`; `None` when the user's own
/// environment variable is set (then BMM leaves it, and every argument, alone).
pub fn args_at_boot(base: &str, dir: Option<&Path>, env_override: bool) -> Option<String> {
    if env_override { return None; }
    Some(browser_args(base, dir.map(read).unwrap_or_default()))
}

/// Called once in `main()`. Returns the arguments to set, or `None` when the user's own
/// environment variable must be left alone.
pub fn apply_at_boot(base: &str) -> Option<String> {
    let env_override = std::env::var("WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS").is_ok();
    ENV_OVERRIDE.store(env_override, Ordering::Relaxed);
    let dir = early_dir();
    if !env_override {
        let flags = dir.as_deref().map(read).unwrap_or_default();
        STARTED_WITH_GPU.store(flags.webview_gpu, Ordering::Relaxed);
        STARTED_MODE.store(mode_code(flags), Ordering::Relaxed);
    }
    args_at_boot(base, dir.as_deref(), env_override)
}

#[derive(Serialize)]
pub struct WebviewGpuState {
    /// What is saved for the next start: the GPU may be used at all.
    pub enabled: bool,
    /// What this session started with.
    pub active: bool,
    /// The user's own WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS is in charge; the switch does nothing.
    pub overridden: bool,
    /// The saved mode: auto | power_saving | high_performance | off.
    pub mode: &'static str,
    /// The mode this session started with (a change applies on the next start).
    pub active_mode: &'static str,
}

fn state_for(dir: Option<&Path>) -> WebviewGpuState {
    let saved = dir.map(read).unwrap_or_default();
    WebviewGpuState {
        enabled: saved.webview_gpu,
        active: STARTED_WITH_GPU.load(Ordering::Relaxed),
        overridden: ENV_OVERRIDE.load(Ordering::Relaxed),
        mode: mode_of(saved),
        active_mode: mode_from_code(STARTED_MODE.load(Ordering::Relaxed)),
    }
}

// Async: a sync command runs on the main thread in Tauri v2, and these read and write a file.
#[tauri::command]
pub async fn get_webview_gpu(app: tauri::AppHandle) -> Result<WebviewGpuState, String> {
    use tauri::Manager;
    Ok(state_for(app.path().app_data_dir().ok().as_deref()))
}

/// The older on/off switch: keeps the saved card preference.
#[tauri::command]
pub async fn set_webview_gpu(app: tauri::AppHandle, enabled: bool) -> Result<WebviewGpuState, String> {
    use tauri::Manager;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    let cur = read(&dir);
    write(&dir, BootFlags { webview_gpu: enabled, ..cur })?;
    Ok(state_for(Some(&dir)))
}

/// Graphics: auto | power_saving | high_performance | off. Applies on the next start.
#[tauri::command]
pub async fn set_webview_gpu_mode(app: tauri::AppHandle, mode: String) -> Result<WebviewGpuState, String> {
    use tauri::Manager;
    let flags = flags_for_mode(&mode)?;
    let dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
    write(&dir, flags)?;
    Ok(state_for(Some(&dir)))
}

/// Restart BMM so a new Graphics choice applies. Tauri's own restart (as `POST /api/restart`
/// uses): it relaunches with the right entry point, then exits. The Settings screen asks first.
#[tauri::command]
pub async fn app_restart(app: tauri::AppHandle) {
    app.restart();
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
        assert_eq!(browser_args("--a --b", BootFlags { webview_gpu: true, ..Default::default() }), "--a --b");
        assert_eq!(browser_args("--a --b", BootFlags { webview_gpu: false, ..Default::default() }), "--a --b --disable-gpu --disable-gpu-compositing");
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

    // ── Which GPU the window draws with (agent-bmm-storage) ───────────────────────────────
    // "Automatic" adds nothing, "High performance" and "Power saving" add exactly one fixed
    // Chromium switch each, and "Off" keeps its two. Nothing else can reach the arguments.

    #[test]
    fn each_gpu_mode_puts_exactly_its_fixed_switch_in_the_webview_args() {
        let base = "--a --b";
        let at = |mode: &str| browser_args(base, flags_for_mode(mode).unwrap());
        assert_eq!(at("auto"), "--a --b", "automatic leaves the choice to Windows and WebView2");
        assert_eq!(at("high_performance"), "--a --b --force_high_performance_gpu");
        assert_eq!(at("power_saving"), "--a --b --force_low_power_gpu");
        assert_eq!(at("off"), "--a --b --disable-gpu --disable-gpu-compositing");
        assert!(flags_for_mode("--remote-debugging-port=1").is_err(), "an unknown mode is refused, never pasted");
        for m in ["auto", "high_performance", "power_saving", "off"] {
            assert_eq!(mode_of(flags_for_mode(m).unwrap()), m, "{m} round-trips");
        }
    }

    #[test]
    fn a_saved_gpu_mode_reaches_the_args_the_next_start_sets() {
        let d = scratch("mode-boot");
        write(&d, flags_for_mode("high_performance").unwrap()).unwrap();
        assert_eq!(args_at_boot("--base", Some(&d), false).as_deref(), Some("--base --force_high_performance_gpu"));
        write(&d, flags_for_mode("power_saving").unwrap()).unwrap();
        assert_eq!(args_at_boot("--base", Some(&d), false).as_deref(), Some("--base --force_low_power_gpu"));
        // The user's own WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: BMM sets nothing at all.
        assert_eq!(args_at_boot("--base", Some(&d), true), None);
        // No app-data folder yet (first start): the defaults, which add nothing.
        assert_eq!(args_at_boot("--base", None, false).as_deref(), Some("--base"));
    }

    #[test]
    fn an_old_one_bool_file_still_reads_and_a_bad_mode_means_the_default() {
        let d = scratch("mode-compat");
        std::fs::write(d.join(FILE), r#"{"webview_gpu":false}"#).unwrap();
        assert_eq!(mode_of(read(&d)), "off", "the file an older BMM wrote keeps its meaning");
        std::fs::write(d.join(FILE), r#"{"webview_gpu":true,"gpu_preference":"--disable-web-security"}"#).unwrap();
        assert_eq!(read(&d), BootFlags::default(), "an unknown preference refuses the whole file");
        assert_eq!(browser_args("--base", read(&d)), "--base");
    }

    #[test]
    fn write_then_read_round_trips() {
        let d = scratch("rt");
        write(&d, BootFlags { webview_gpu: false, ..Default::default() }).unwrap();
        assert!(!read(&d).webview_gpu);
        write(&d, BootFlags { webview_gpu: true, ..Default::default() }).unwrap();
        assert!(read(&d).webview_gpu);
    }
}
