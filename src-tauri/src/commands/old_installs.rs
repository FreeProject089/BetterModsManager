//! Old installations of BMM: found read-only, removed only on an explicit click.
//!
//! BMM 0.9.x was a Tauri 1 app called « Better Mod Manager » (bundle id `com.bettermm.app`),
//! installed by NSIS or MSI. 1.0.x is installed by BetterInstaller (`com.bettermm.desktop`) and
//! copies the 0.9.x data on its first start (main.rs `migrate_legacy_appdata`). The 1.0.1
//! pre-release also shipped Tauri-built NSIS/MSI packages of 1.0.0. So one machine can carry,
//! next to the BMM that is running:
//!
//! - other installs, listed in the Windows uninstall keys (HKCU, HKLM 64-bit, HKLM 32-bit);
//! - the old data folder `%AppData%\com.bettermm.app` (and `%LocalAppData%\com.bettermm.app`,
//!   which under Tauri 1 is mostly the WebView2 cache `EBWebView`);
//! - Start menu / desktop shortcuts that point at an exe that is gone or that belongs to one
//!   of those old installs.
//!
//! Rules this file keeps:
//! - The scan never writes anything and never lists the running install (its exe folder, its
//!   registered location, or, when an entry names no folder at all, its exact version).
//! - Nothing is removed unless the frontend asks for ONE item by id, and the id is looked up in
//!   a FRESH scan here: a path from the page is only compared, never trusted.
//! - The old data folder is removable only once the migration finished (a marker written by
//!   main.rs, or every old file present in the new folder).
//! - A path is deleted only inside its expected root, with no `..`, no link or junction on the
//!   way, and the canonical path still inside the canonical root.
//! - An uninstaller runs with constant or validated arguments only (`/S`, `--uninstall`,
//!   `/x {GUID}`), through `proc::shell_run_wait` (ShellExecuteExW, UAC when it asks).
//!
//! The parsing is pure and tested on fixtures; the registry and file system access is thin and
//! Windows-only (an empty answer elsewhere).

use serde::{Deserialize, Serialize};
use std::path::{Component, Path, PathBuf};

pub const OLD_ID: &str = "com.bettermm.app";
pub const NEW_ID: &str = "com.bettermm.desktop";
/// Written into the new app-data folder by main.rs once the 0.9.x data was copied.
pub const MIGRATED_MARKER: &str = ".migrated-from-com.bettermm.app";
const PREFS_FILE: &str = "old-installs.json";
/// The folder Tauri 1's WebView2 used under `%LocalAppData%\<id>`.
const WEBVIEW_DIR: &str = "EBWebView";
/// A walk that goes past this many entries stops counting (sizes become a lower bound and the
/// "every old file was copied" proof gives up, which keeps the folder NOT removable).
const WALK_CAP: usize = 200_000;

// ── What the page receives ──────────────────────────────────────────────────

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ItemKind { Install, Data, Cache, Shortcut }

#[derive(Serialize, Clone, Copy, Debug, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum InstallerType { Nsis, Msi, BetterInstaller, Unknown }

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OldItem {
    /// Stable across scans: `install:HKCU:<key>`, `data:roaming`, `data:local`, `cache:local`,
    /// `shortcut:<lowercased path>`.
    pub id: String,
    pub kind: ItemKind,
    /// DisplayName, folder name or shortcut name: text, shown as text.
    pub label: String,
    pub version: Option<String>,
    pub installer: Option<InstallerType>,
    /// Install folder, data folder or the .lnk itself.
    pub path: Option<String>,
    pub size_bytes: Option<u64>,
    /// Whether BMM offers a remove button for it at all.
    pub removable: bool,
    /// An i18n key: why it is not removable here.
    pub reason: Option<String>,
    /// An i18n key: something to know before removing (still removable).
    pub warning: Option<String>,
    /// "user" or "machine" (machine-wide items may need administrator rights).
    pub scope: String,
    /// A shortcut's target.
    pub target: Option<String>,
    /// The uninstaller has a quiet mode BMM can ask for.
    pub can_silent: bool,
    /// A BetterInstaller (1.0+) install that is not the running one: listed in Settings, never
    /// put forward at start-up.
    pub current_line: bool,
    /// The registry entry this came from (`HKCU\<key>`), for the curious.
    pub source: Option<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct OldScan {
    pub items: Vec<OldItem>,
    /// The 0.9.x data was carried into this BMM's folder.
    pub migrated: bool,
    pub running_exe: String,
    /// Default folder for a backup .zip (Documents).
    pub documents_dir: Option<String>,
}

// ── Registry fixtures (pure) ────────────────────────────────────────────────

/// One uninstall entry as read from the registry. Built by hand in the tests.
#[derive(Clone, Debug, Default, PartialEq)]
pub struct RegEntry {
    /// "HKCU", "HKLM64" or "HKLM32".
    pub hive: String,
    pub key: String,
    pub display_name: String,
    pub display_version: String,
    pub publisher: String,
    pub install_location: String,
    pub uninstall_string: String,
    pub quiet_uninstall_string: String,
    pub display_icon: String,
    pub estimated_size_kb: Option<u32>,
    pub windows_installer: bool,
}

/// Lowercase ASCII letters and digits only: "Better Mod Manager" → "bettermodmanager".
pub fn normalize_name(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect()
}

/// « Better Mod Manager » or « Better Mods Manager », optionally followed by a version or an
/// architecture ("Better Mod Manager 0.9.5", "… (x64)"). Not "Better Mods Manager Tools".
pub fn is_bmm_name(name: &str) -> bool {
    let n = normalize_name(name);
    for base in ["bettermodsmanager", "bettermodmanager"] {
        if let Some(rest) = n.strip_prefix(base) {
            let rest = rest.replace("x64", "").replace("x86", "").replace("64bit", "").replace("32bit", "");
            return rest.chars().all(|c| c.is_ascii_digit());
        }
    }
    false
}

/// `{XXXXXXXX-XXXX-XXXX-XXXX-XXXXXXXXXXXX}`, hex only. The one shape a product code may have
/// before it goes into an msiexec argument.
pub fn is_guid(s: &str) -> bool {
    let b = s.as_bytes();
    if b.len() != 38 || b[0] != b'{' || b[37] != b'}' {
        return false;
    }
    b[1..37].iter().enumerate().all(|(i, c)| match i {
        8 | 13 | 18 | 23 => *c == b'-',
        _ => c.is_ascii_hexdigit(),
    })
}

/// The MSI product code: the key name when it is one, else the GUID after /X or /I in the
/// uninstall string (`MsiExec.exe /X{…}`).
pub fn msi_product_code(e: &RegEntry) -> Option<String> {
    if is_guid(&e.key) {
        return Some(e.key.to_ascii_uppercase());
    }
    let s = e.uninstall_string.as_str();
    let start = s.find('{')?;
    let cand = s.get(start..start + 38)?;
    is_guid(cand).then(|| cand.to_ascii_uppercase())
}

/// Split a command line into (program, arguments). Handles a quoted program, and an unquoted
/// one with spaces by cutting after the first ".exe".
pub fn split_command(cmd: &str) -> (String, String) {
    let c = cmd.trim();
    if let Some(rest) = c.strip_prefix('"') {
        if let Some(end) = rest.find('"') {
            return (rest[..end].to_string(), rest[end + 1..].trim().to_string());
        }
        return (rest.to_string(), String::new());
    }
    let lower = c.to_ascii_lowercase();
    if let Some(i) = lower.find(".exe") {
        let cut = i + 4;
        return (c[..cut].to_string(), c[cut..].trim().to_string());
    }
    match c.split_once(' ') {
        Some((a, b)) => (a.to_string(), b.trim().to_string()),
        None => (c.to_string(), String::new()),
    }
}

/// DisplayIcon is `path` or `path,index`, sometimes quoted.
pub fn icon_path(icon: &str) -> String {
    let s = icon.trim().trim_matches('"');
    match s.rsplit_once(',') {
        Some((p, idx)) if idx.trim().trim_start_matches('-').chars().all(|c| c.is_ascii_digit()) => p.trim_matches('"').to_string(),
        _ => s.to_string(),
    }
}

pub fn classify(e: &RegEntry) -> InstallerType {
    let un = e.uninstall_string.to_ascii_lowercase();
    if e.windows_installer || un.contains("msiexec") || is_guid(&e.key) {
        return if msi_product_code(e).is_some() { InstallerType::Msi } else { InstallerType::Unknown };
    }
    if e.key == NEW_ID || un.contains("--uninstall") {
        return InstallerType::BetterInstaller;
    }
    let (exe, _) = split_command(&e.uninstall_string);
    let file = Path::new(&exe).file_name().map(|f| f.to_string_lossy().to_ascii_lowercase()).unwrap_or_default();
    if file.starts_with("uninstall") && file.ends_with(".exe") {
        return InstallerType::Nsis;
    }
    InstallerType::Unknown
}

/// A comparable spelling of a Windows path: lowercase, backslashes, no `\\?\`, no trailing `\`.
pub fn norm_path(p: &str) -> String {
    let mut s = p.trim().trim_matches('"').replace('/', "\\").to_lowercase();
    if let Some(r) = s.strip_prefix(r"\\?\") {
        s = r.to_string();
    }
    while s.ends_with('\\') && s.len() > 3 {
        s.pop();
    }
    s
}

fn parent_of(p: &str) -> Option<String> {
    let n = norm_path(p);
    if n.is_empty() {
        return None;
    }
    n.rfind('\\').map(|i| n[..i].to_string()).filter(|s| !s.is_empty())
}

/// The folders an entry tells about: InstallLocation, the uninstaller's folder, the icon's.
pub fn entry_dirs(e: &RegEntry) -> Vec<String> {
    let mut out = Vec::new();
    if !e.install_location.trim().is_empty() {
        out.push(norm_path(&e.install_location));
    }
    if !e.uninstall_string.to_ascii_lowercase().contains("msiexec") {
        let (exe, _) = split_command(&e.uninstall_string);
        if let Some(d) = parent_of(&exe) { out.push(d); }
    }
    let icon = icon_path(&e.display_icon);
    if icon.to_ascii_lowercase().ends_with(".exe") {
        if let Some(d) = parent_of(&icon) { out.push(d); }
    }
    out.sort();
    out.dedup();
    out
}

/// THE exclusion: an entry is the running install when one of its folders is the running exe's
/// folder, or its icon is the running exe. An entry that names no folder at all (some MSI) is
/// taken for the running one when its version is exactly the running version: unsure means
/// not listed, never "offered for removal".
pub fn is_running_install(e: &RegEntry, running_exe: &str, running_version: &str) -> bool {
    let exe = norm_path(running_exe);
    let Some(dir) = parent_of(running_exe) else { return false };
    let dirs = entry_dirs(e);
    if dirs.iter().any(|d| *d == dir) {
        return true;
    }
    if norm_path(&icon_path(&e.display_icon)) == exe {
        return true;
    }
    dirs.is_empty() && e.display_version.trim() == running_version
}

pub fn install_id(e: &RegEntry) -> String {
    format!("install:{}:{}", e.hive, e.key)
}

/// The BMM uninstall entries other than the running one, as items. Sizes come from
/// EstimatedSize (KB) here; the caller may fill a missing one from the folder.
pub fn entries_to_items(entries: &[RegEntry], running_exe: &str, running_version: &str) -> Vec<OldItem> {
    let mut out = Vec::new();
    for e in entries {
        let named = is_bmm_name(&e.display_name) || e.key == OLD_ID || e.key == NEW_ID;
        if !named || is_running_install(e, running_exe, running_version) {
            continue;
        }
        let installer = classify(e);
        let removable = installer != InstallerType::Unknown;
        let location = (!e.install_location.trim().is_empty()).then(|| e.install_location.trim().trim_matches('"').to_string())
            .or_else(|| entry_dirs(e).into_iter().next());
        out.push(OldItem {
            id: install_id(e),
            kind: ItemKind::Install,
            label: if e.display_name.trim().is_empty() { e.key.clone() } else { e.display_name.trim().to_string() },
            version: (!e.display_version.trim().is_empty()).then(|| e.display_version.trim().to_string()),
            installer: Some(installer),
            path: location,
            size_bytes: e.estimated_size_kb.map(|k| k as u64 * 1024),
            removable,
            reason: (!removable).then(|| "oldInstalls.reasonNoUninstaller".to_string()),
            warning: None,
            scope: if e.hive == "HKCU" { "user".into() } else { "machine".into() },
            target: None,
            can_silent: matches!(installer, InstallerType::Nsis | InstallerType::Msi),
            current_line: installer == InstallerType::BetterInstaller,
            source: Some(format!("{}\\{}", e.hive, e.key)),
        });
    }
    out
}

/// What to start to remove an install: the program and its (constant or validated) arguments.
pub fn uninstall_plan(e: &RegEntry, silent: bool, system_root: &str) -> Result<(PathBuf, Option<String>), String> {
    match classify(e) {
        InstallerType::Msi => {
            let code = msi_product_code(e).ok_or_else(|| "oldInstalls.errNoUninstaller".to_string())?;
            let exe = Path::new(system_root).join("System32").join("msiexec.exe");
            // /passive: a progress bar and no question, but still the UAC prompt (/qn would
            // fail without administrator rights instead of asking for them).
            let args = if silent { format!("/x {code} /passive /norestart") } else { format!("/x {code}") };
            Ok((exe, Some(args)))
        }
        InstallerType::Nsis => {
            let (exe, _) = split_command(&e.uninstall_string);
            Ok((PathBuf::from(exe), silent.then(|| "/S".to_string())))
        }
        InstallerType::BetterInstaller => {
            let (exe, _) = split_command(&e.uninstall_string);
            Ok((PathBuf::from(exe), Some("--uninstall".to_string())))
        }
        InstallerType::Unknown => Err("oldInstalls.errNoUninstaller".to_string()),
    }
}

// ── Start-up offer (pure) ───────────────────────────────────────────────────

#[derive(Serialize, Deserialize, Clone, Debug, Default, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct OfferPrefs {
    pub never_ask: bool,
    /// Item ids already put in front of the person (« Not now »).
    pub seen: Vec<String>,
}

/// What may be put forward at start-up: something BMM can actually remove, never a 1.0 install.
pub fn offerable(items: &[OldItem]) -> Vec<String> {
    items.iter().filter(|i| i.removable && !i.current_line).map(|i| i.id.clone()).collect()
}

/// Offer when nobody said « Never ask again » and something offerable was never shown.
pub fn should_offer(prefs: &OfferPrefs, items: &[OldItem]) -> bool {
    !prefs.never_ask && offerable(items).iter().any(|id| !prefs.seen.contains(id))
}

// ── Shortcuts (pure) ────────────────────────────────────────────────────────

fn u16_at(b: &[u8], o: usize) -> Option<u16> { b.get(o..o + 2).map(|s| u16::from_le_bytes([s[0], s[1]])) }
fn u32_at(b: &[u8], o: usize) -> Option<u32> { b.get(o..o + 4).map(|s| u32::from_le_bytes([s[0], s[1], s[2], s[3]])) }

fn cstr_ascii(b: &[u8], o: usize) -> Option<String> {
    let s = b.get(o..)?;
    let end = s.iter().position(|c| *c == 0)?;
    let raw = &s[..end];
    // A non-ASCII ANSI path cannot be decoded without the code page it was written in. A wrong
    // guess would read as "target missing" and call a good shortcut an orphan: unknown instead.
    raw.is_ascii().then(|| String::from_utf8_lossy(raw).into_owned())
}

fn cstr_utf16(b: &[u8], o: usize) -> Option<String> {
    let mut units = Vec::new();
    let mut i = o;
    loop {
        let u = u16_at(b, i)?;
        if u == 0 { break; }
        units.push(u);
        i += 2;
    }
    String::from_utf16(&units).ok()
}

/// The local target path of a .lnk (MS-SHLLINK LinkInfo), or None when it has none or it
/// cannot be read with certainty.
pub fn lnk_target(b: &[u8]) -> Option<String> {
    if u32_at(b, 0)? != 0x4C {
        return None;
    }
    let flags = u32_at(b, 0x14)?;
    let mut o = 0x4Cusize;
    if flags & 0x1 != 0 {
        o += 2 + u16_at(b, o)? as usize;
    }
    if flags & 0x2 == 0 {
        return None;
    }
    let size = u32_at(b, o)? as usize;
    let header = u32_at(b, o + 4)? as usize;
    let li_flags = u32_at(b, o + 8)?;
    if size < 0x1C || header < 0x1C || b.len() < o + size || li_flags & 0x1 == 0 {
        return None;
    }
    let base_off = u32_at(b, o + 16)? as usize;
    let suffix_off = u32_at(b, o + 24)? as usize;
    let (base, suffix) = if header >= 0x24 {
        let bu = u32_at(b, o + 28)? as usize;
        let su = u32_at(b, o + 32)? as usize;
        (cstr_utf16(b, o + bu)?, if su != 0 { cstr_utf16(b, o + su).unwrap_or_default() } else { String::new() })
    } else {
        (cstr_ascii(b, o + base_off)?, cstr_ascii(b, o + suffix_off).unwrap_or_default())
    };
    let joined = format!("{base}{suffix}");
    (!joined.is_empty()).then_some(joined)
}

/// Whether a shortcut is one to list: a BMM name, a target that is not the running BMM, and a
/// target that is gone or inside one of the old installs' folders.
pub fn shortcut_is_leftover(stem: &str, target: &str, target_exists: bool, running_exe: &str, old_dirs: &[String]) -> bool {
    if !is_bmm_name(stem) {
        return false;
    }
    let t = norm_path(target);
    if t == norm_path(running_exe) {
        return false;
    }
    if let Some(rd) = parent_of(running_exe) {
        if t.starts_with(&format!("{rd}\\")) {
            return false;
        }
    }
    !target_exists || old_dirs.iter().any(|d| !d.is_empty() && t.starts_with(&format!("{d}\\")))
}

// ── Path guard ──────────────────────────────────────────────────────────────

/// Lexical: absolute, no `.`/`..`, and strictly inside `root` (case-insensitive, by component).
pub fn lexically_inside(path: &Path, root: &Path) -> Result<(), String> {
    if !path.is_absolute() {
        return Err("oldInstalls.errNotAbsolute".into());
    }
    if path.components().any(|c| matches!(c, Component::ParentDir | Component::CurDir)) {
        return Err("oldInstalls.errDotSegment".into());
    }
    let p: Vec<String> = path.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect();
    let r: Vec<String> = root.components().map(|c| c.as_os_str().to_string_lossy().to_lowercase()).collect();
    if r.is_empty() || p.len() <= r.len() || p[..r.len()] != r[..] {
        return Err("oldInstalls.errOutsideRoots".into());
    }
    Ok(())
}

/// A symlink, a junction or any other reparse point: never followed, never deleted through.
fn is_link(meta: &std::fs::Metadata) -> bool {
    if meta.file_type().is_symlink() {
        return true;
    }
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        const FILE_ATTRIBUTE_REPARSE_POINT: u32 = 0x400;
        if meta.file_attributes() & FILE_ATTRIBUTE_REPARSE_POINT != 0 {
            return true;
        }
    }
    false
}

/// The full check before a delete: lexically inside one of `roots`, no link or junction on the
/// path itself or any folder between it and the root, and the canonical path still inside the
/// canonical root. Returns the canonical path to delete.
pub fn guard_path(path: &Path, roots: &[PathBuf]) -> Result<PathBuf, String> {
    let mut last = Err("oldInstalls.errOutsideRoots".to_string());
    let root = roots.iter().find(|r| {
        last = lexically_inside(path, r);
        last.is_ok()
    });
    let Some(root) = root else { return Err(last.unwrap_err()) };
    let mut cur = path.to_path_buf();
    loop {
        if cur.components().count() <= root.components().count() {
            break;
        }
        let meta = std::fs::symlink_metadata(&cur).map_err(|_| "oldInstalls.errMissing".to_string())?;
        if is_link(&meta) {
            return Err("oldInstalls.errLink".into());
        }
        if !cur.pop() {
            break;
        }
    }
    let cp = std::fs::canonicalize(path).map_err(|_| "oldInstalls.errMissing".to_string())?;
    let cr = std::fs::canonicalize(root).map_err(|_| "oldInstalls.errMissing".to_string())?;
    if !cp.starts_with(&cr) || cp == cr {
        return Err("oldInstalls.errOutsideRoots".into());
    }
    Ok(cp)
}

// ── Folders (impure, small) ─────────────────────────────────────────────────

/// Bytes under `dir`, links not followed, stopping after WALK_CAP entries.
pub fn dir_size(dir: &Path) -> u64 {
    let mut total = 0u64;
    for (n, entry) in walkdir::WalkDir::new(dir).follow_links(false).into_iter().flatten().enumerate() {
        if n > WALK_CAP { break; }
        if entry.file_type().is_file() {
            total += entry.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    total
}

/// The migration is done when main.rs left its marker, or (for a migration done by a build that
/// did not write one) when every file of the old folder exists in the new one.
pub fn migration_complete(old_dir: &Path, new_dir: &Path) -> bool {
    if new_dir.join(MIGRATED_MARKER).is_file() {
        return true;
    }
    if !new_dir.join("data.json").is_file() || !old_dir.is_dir() {
        return false;
    }
    for (n, entry) in walkdir::WalkDir::new(old_dir).follow_links(false).into_iter().enumerate() {
        if n > WALK_CAP { return false; }
        let Ok(entry) = entry else { return false };
        if !entry.file_type().is_file() { continue; }
        let Ok(rel) = entry.path().strip_prefix(old_dir) else { return false };
        if !new_dir.join(rel).exists() { return false; }
    }
    true
}

/// `%LocalAppData%\com.bettermm.app` holding nothing but the WebView2 cache.
fn only_webview_cache(dir: &Path) -> bool {
    let Ok(rd) = std::fs::read_dir(dir) else { return false };
    let mut any = false;
    for e in rd.flatten() {
        any = true;
        if !e.file_name().to_string_lossy().eq_ignore_ascii_case(WEBVIEW_DIR) {
            return false;
        }
    }
    any
}

fn env_dir(var: &str) -> Option<PathBuf> {
    std::env::var_os(var).filter(|v| !v.is_empty()).map(PathBuf::from)
}

/// Roots a data or cache folder may be deleted from.
fn data_roots() -> Vec<PathBuf> {
    ["APPDATA", "LOCALAPPDATA"].iter().filter_map(|v| env_dir(v)).collect()
}

/// Folders a shortcut may be deleted from: (path, machine-wide, max depth).
fn shortcut_dirs() -> Vec<(PathBuf, bool, usize)> {
    let mut out = Vec::new();
    let start = |p: PathBuf| p.join("Microsoft").join("Windows").join("Start Menu").join("Programs");
    if let Some(p) = env_dir("APPDATA") { out.push((start(p), false, 2)); }
    if let Some(p) = env_dir("ProgramData") { out.push((start(p), true, 2)); }
    if let Some(p) = env_dir("USERPROFILE") { out.push((p.join("Desktop"), false, 1)); }
    if let Some(p) = env_dir("OneDrive") { out.push((p.join("Desktop"), false, 1)); }
    if let Some(p) = env_dir("PUBLIC") { out.push((p.join("Desktop"), true, 1)); }
    out
}

fn shortcut_roots() -> Vec<PathBuf> {
    shortcut_dirs().into_iter().map(|(p, _, _)| p).collect()
}

// ── Registry (Windows only) ─────────────────────────────────────────────────

#[cfg_attr(not(windows), allow(dead_code))]
const UNINSTALL: &str = r"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall";

#[cfg(windows)]
fn hive_of(name: &str) -> Option<(winreg::HKEY, u32)> {
    use winreg::enums::*;
    match name {
        "HKCU" => Some((HKEY_CURRENT_USER, 0)),
        "HKLM64" => Some((HKEY_LOCAL_MACHINE, KEY_WOW64_64KEY)),
        "HKLM32" => Some((HKEY_LOCAL_MACHINE, KEY_WOW64_32KEY)),
        _ => None,
    }
}

#[cfg(windows)]
pub fn read_registry() -> Vec<RegEntry> {
    use winreg::enums::KEY_READ;
    use winreg::RegKey;
    let mut out = Vec::new();
    for hive in ["HKCU", "HKLM64", "HKLM32"] {
        let Some((root, view)) = hive_of(hive) else { continue };
        let Ok(base) = RegKey::predef(root).open_subkey_with_flags(UNINSTALL, KEY_READ | view) else { continue };
        for key in base.enum_keys().flatten() {
            let Ok(sub) = base.open_subkey_with_flags(&key, KEY_READ | view) else { continue };
            let s = |n: &str| sub.get_value::<String, _>(n).unwrap_or_default();
            let display_name = s("DisplayName");
            if !(is_bmm_name(&display_name) || key == OLD_ID || key == NEW_ID) {
                continue;
            }
            out.push(RegEntry {
                hive: hive.to_string(),
                display_name,
                display_version: s("DisplayVersion"),
                publisher: s("Publisher"),
                install_location: s("InstallLocation"),
                uninstall_string: s("UninstallString"),
                quiet_uninstall_string: s("QuietUninstallString"),
                display_icon: s("DisplayIcon"),
                estimated_size_kb: sub.get_value::<u32, _>("EstimatedSize").ok(),
                windows_installer: sub.get_value::<u32, _>("WindowsInstaller").map(|v| v == 1).unwrap_or(false),
                key,
            });
        }
    }
    // HKLM 64 and 32 are separate keys, but on a 32-bit Windows both views are the same one.
    let mut seen = std::collections::HashSet::new();
    out.retain(|e| seen.insert((e.hive.starts_with("HKLM"), e.key.clone(), norm_path(&e.install_location))));
    out
}

#[cfg(not(windows))]
pub fn read_registry() -> Vec<RegEntry> { Vec::new() }

#[cfg(windows)]
fn reg_key_exists(hive: &str, key: &str) -> bool {
    use winreg::enums::KEY_READ;
    let Some((root, view)) = hive_of(hive) else { return false };
    winreg::RegKey::predef(root)
        .open_subkey_with_flags(format!("{UNINSTALL}\\{key}"), KEY_READ | view)
        .is_ok()
}

// ── The scan ────────────────────────────────────────────────────────────────

fn running_exe() -> String {
    std::env::current_exe().map(|p| p.to_string_lossy().into_owned()).unwrap_or_default()
}

/// Everything found, with the registry entries the install items came from.
pub fn scan(new_data_dir: &Path) -> (OldScan, Vec<RegEntry>) {
    let exe = running_exe();
    let version = env!("CARGO_PKG_VERSION");
    let entries = if cfg!(windows) { read_registry() } else { Vec::new() };
    let mut items = entries_to_items(&entries, &exe, version);
    for it in items.iter_mut() {
        if it.size_bytes.is_none() {
            if let Some(p) = it.path.as_deref().map(PathBuf::from).filter(|p| p.is_dir()) {
                it.size_bytes = Some(dir_size(&p));
            }
        }
    }
    let old_install_present = items.iter().any(|i| !i.current_line);
    let old_dirs: Vec<String> = entries.iter()
        .filter(|e| items.iter().any(|i| i.id == install_id(e) && !i.current_line))
        .flat_map(entry_dirs)
        .collect();

    let mut migrated = false;
    if cfg!(windows) {
        let roaming_old = env_dir("APPDATA").map(|p| p.join(OLD_ID));
        if let Some(old) = roaming_old.filter(|p| p.is_dir()) {
            migrated = migration_complete(&old, new_data_dir);
            items.push(OldItem {
                id: "data:roaming".into(),
                kind: ItemKind::Data,
                label: OLD_ID.into(),
                version: None,
                installer: None,
                size_bytes: Some(dir_size(&old)),
                path: Some(old.to_string_lossy().into_owned()),
                removable: migrated,
                reason: (!migrated).then(|| "oldInstalls.reasonMigrationPending".to_string()),
                warning: old_install_present.then(|| "oldInstalls.warnOldInstallUsesData".to_string()),
                scope: "user".into(),
                target: None,
                can_silent: false,
                current_line: false,
                source: None,
            });
        }
        if let Some(local) = env_dir("LOCALAPPDATA").map(|p| p.join(OLD_ID)).filter(|p| p.is_dir()) {
            let cache = only_webview_cache(&local);
            let removable = cache || migrated;
            items.push(OldItem {
                id: if cache { "cache:local".into() } else { "data:local".into() },
                kind: if cache { ItemKind::Cache } else { ItemKind::Data },
                label: OLD_ID.into(),
                version: None,
                installer: None,
                size_bytes: Some(dir_size(&local)),
                path: Some(local.to_string_lossy().into_owned()),
                removable,
                reason: (!removable).then(|| "oldInstalls.reasonMigrationPending".to_string()),
                warning: old_install_present.then(|| "oldInstalls.warnOldInstallUsesData".to_string()),
                scope: "user".into(),
                target: None,
                can_silent: false,
                current_line: false,
                source: None,
            });
        }
        for (dir, machine, depth) in shortcut_dirs() {
            if !dir.is_dir() { continue; }
            for entry in walkdir::WalkDir::new(&dir).max_depth(depth).follow_links(false).into_iter().flatten() {
                let p = entry.path();
                if !entry.file_type().is_file() || !p.extension().map(|x| x.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
                    continue;
                }
                let stem = p.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
                if !is_bmm_name(&stem) { continue; }
                let Ok(bytes) = std::fs::read(p) else { continue };
                let Some(target) = lnk_target(&bytes) else { continue };
                let exists = Path::new(&target).exists();
                if !shortcut_is_leftover(&stem, &target, exists, &exe, &old_dirs) { continue; }
                let path = p.to_string_lossy().into_owned();
                items.push(OldItem {
                    id: format!("shortcut:{}", norm_path(&path)),
                    kind: ItemKind::Shortcut,
                    label: stem,
                    version: None,
                    installer: None,
                    size_bytes: entry.metadata().ok().map(|m| m.len()),
                    path: Some(path),
                    removable: true,
                    reason: None,
                    warning: (!exists).then(|| "oldInstalls.warnTargetMissing".to_string()),
                    scope: if machine { "machine".into() } else { "user".into() },
                    target: Some(target),
                    can_silent: false,
                    current_line: false,
                    source: None,
                });
            }
        }
    }
    let documents = env_dir("USERPROFILE").map(|p| p.join("Documents")).filter(|p| p.is_dir());
    let scan = OldScan {
        items,
        migrated,
        running_exe: exe,
        documents_dir: documents.map(|p| p.to_string_lossy().into_owned()),
    };
    (scan, entries)
}

fn app_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn read_prefs(dir: &Path) -> OfferPrefs {
    std::fs::read_to_string(dir.join(PREFS_FILE)).ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default()
}

fn write_prefs(dir: &Path, prefs: &OfferPrefs) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let text = serde_json::to_string_pretty(prefs).map_err(|e| e.to_string())?;
    std::fs::write(dir.join(PREFS_FILE), text).map_err(|e| e.to_string())
}

/// The item `id` in a fresh scan, checked removable, with its registry entry when it is one.
fn find_fresh(new_dir: &Path, id: &str) -> Result<(OldItem, Option<RegEntry>), String> {
    let (scan, entries) = scan(new_dir);
    let item = scan.items.into_iter().find(|i| i.id == id).ok_or_else(|| "oldInstalls.errGone".to_string())?;
    if !item.removable {
        return Err(item.reason.clone().unwrap_or_else(|| "oldInstalls.errNotRemovable".into()));
    }
    let entry = entries.into_iter().find(|e| install_id(e) == id);
    Ok((item, entry))
}

// ── Commands ────────────────────────────────────────────────────────────────

/// Read-only: everything found.
#[tauri::command]
pub async fn old_installs_scan(app: tauri::AppHandle) -> Result<OldScan, String> {
    let dir = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || scan(&dir).0).await.map_err(|e| e.to_string())
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OfferAnswer {
    pub offer: bool,
    pub never_ask: bool,
    /// What « Not now » marks as seen: the same rule as `offer`, not a copy of it in the page.
    pub offer_ids: Vec<String>,
    pub scan: OldScan,
}

/// The start-up question: scan, then whether to show the dialog (something new and offerable,
/// and no « Never ask again »).
#[tauri::command]
pub async fn old_installs_offer(app: tauri::AppHandle) -> Result<OfferAnswer, String> {
    let dir = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let prefs = read_prefs(&dir);
        let (scan, _) = scan(&dir);
        OfferAnswer { offer: should_offer(&prefs, &scan.items), never_ask: prefs.never_ask, offer_ids: offerable(&scan.items), scan }
    }).await.map_err(|e| e.to_string())
}

/// « Not now » (`later`: these ids were seen), « Never ask again » (`never`), or the Settings
/// switch turned back on (`reset`).
#[tauri::command]
pub fn old_installs_dismiss(app: tauri::AppHandle, mode: String, ids: Vec<String>) -> Result<(), String> {
    let dir = app_dir(&app)?;
    let mut prefs = read_prefs(&dir);
    match mode.as_str() {
        "later" => {
            for id in ids {
                if !prefs.seen.contains(&id) { prefs.seen.push(id); }
            }
        }
        "never" => prefs.never_ask = true,
        "reset" => prefs.never_ask = false,
        _ => return Err("oldInstalls.errBadMode".into()),
    }
    write_prefs(&dir, &prefs)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct UninstallOutcome {
    /// The uninstaller's exit code, when it ended within the wait.
    pub exit_code: Option<u32>,
    /// Its registry entry is gone.
    pub removed: bool,
    /// The person said No to the UAC prompt or cancelled the uninstaller.
    pub cancelled: bool,
}

/// Run one old install's registered uninstaller and wait for it, then report whether its entry
/// went away. `silent` adds the quiet flag (NSIS `/S`, MSI `/passive`).
#[tauri::command]
pub async fn old_installs_uninstall(app: tauri::AppHandle, id: String, silent: bool) -> Result<UninstallOutcome, String> {
    let dir = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || uninstall_blocking(&dir, &id, silent))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(windows)]
fn uninstall_blocking(dir: &Path, id: &str, silent: bool) -> Result<UninstallOutcome, String> {
    use std::time::{Duration, Instant};
    let (item, entry) = find_fresh(dir, id)?;
    if item.kind != ItemKind::Install {
        return Err("oldInstalls.errNotRemovable".into());
    }
    let entry = entry.ok_or_else(|| "oldInstalls.errGone".to_string())?;
    let system_root = std::env::var("SystemRoot").unwrap_or_else(|_| r"C:\Windows".into());
    let (exe, args) = uninstall_plan(&entry, silent && item.can_silent, &system_root)?;
    if !exe.is_file() {
        return Err("oldInstalls.errUninstallerMissing".into());
    }
    crate::commands::crash::log_line(format!("[OLD-INSTALLS] uninstall {} via {} {}", item.label, exe.display(), args.as_deref().unwrap_or("")));
    let exit = match crate::commands::proc::shell_run_wait(&exe, args.as_deref(), 30 * 60) {
        Ok(code) => code,
        Err(e) if e.code == crate::commands::proc::ERROR_CANCELLED => {
            return Ok(UninstallOutcome { exit_code: None, removed: false, cancelled: true });
        }
        Err(e) => return Err(format!("oldInstalls.errLaunch|{}", e.message)),
    };
    // 1602: the person cancelled an MSI uninstall.
    if exit == Some(1602) {
        return Ok(UninstallOutcome { exit_code: exit, removed: false, cancelled: true });
    }
    // An NSIS uninstaller copies itself to %TEMP% (Un_A.exe) and exits at once, so the process
    // BMM waited for is not the one doing the work: keep watching the entry while that copy runs.
    let nsis = classify(&entry) == InstallerType::Nsis;
    let started = Instant::now();
    let limit = if nsis { Duration::from_secs(30 * 60) } else { Duration::from_secs(60) };
    let mut sys = sysinfo::System::new();
    loop {
        if !reg_key_exists(&entry.hive, &entry.key) {
            return Ok(UninstallOutcome { exit_code: exit, removed: true, cancelled: false });
        }
        if started.elapsed() > limit {
            break;
        }
        if nsis && started.elapsed() > Duration::from_secs(5) {
            sys.refresh_processes();
            let running = sys.processes_by_exact_name("Un_A.exe").next().is_some()
                || sys.processes_by_exact_name("Au_.exe").next().is_some();
            if !running {
                break;
            }
        }
        std::thread::sleep(Duration::from_millis(1500));
    }
    let removed = !reg_key_exists(&entry.hive, &entry.key);
    Ok(UninstallOutcome { exit_code: exit, removed, cancelled: false })
}

#[cfg(not(windows))]
fn uninstall_blocking(_dir: &Path, _id: &str, _silent: bool) -> Result<UninstallOutcome, String> {
    Err("oldInstalls.errNotRemovable".into())
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    pub zip_path: String,
    pub files: u64,
    pub bytes: u64,
}

/// Zip `src` (links not followed) into a new file in `dest_dir`. Written to `.part`, re-opened
/// and counted, then renamed: a backup that did not complete never carries the final name.
pub fn backup_folder(src: &Path, dest_dir: &Path, stem: &str) -> Result<BackupResult, String> {
    use std::io::Write;
    if !dest_dir.is_absolute() || !dest_dir.is_dir() {
        return Err("oldInstalls.errBackupDir".into());
    }
    let src_c = std::fs::canonicalize(src).map_err(|_| "oldInstalls.errMissing".to_string())?;
    let dest_c = std::fs::canonicalize(dest_dir).map_err(|_| "oldInstalls.errBackupDir".to_string())?;
    if dest_c.starts_with(&src_c) {
        return Err("oldInstalls.errBackupInside".into());
    }
    let name = format!("{stem}-{}.zip", chrono::Local::now().format("%Y%m%d-%H%M%S"));
    let final_path = dest_c.join(&name);
    let part = dest_c.join(format!("{name}.part"));
    let fail = |e: String| { let _ = std::fs::remove_file(&part); format!("oldInstalls.errBackup|{e}") };
    let file = std::fs::File::create(&part).map_err(|e| fail(e.to_string()))?;
    let mut zip = zip::ZipWriter::new(std::io::BufWriter::new(file));
    let mut files = 0u64;
    let mut bytes = 0u64;
    let mut entries = 0usize;
    for entry in walkdir::WalkDir::new(&src_c).follow_links(false).min_depth(1) {
        let entry = entry.map_err(|e| fail(e.to_string()))?;
        let ft = entry.file_type();
        if ft.is_symlink() { continue; }
        let meta = entry.metadata().map_err(|e| fail(e.to_string()))?;
        if is_link(&meta) { continue; }
        let rel = entry.path().strip_prefix(&src_c).map_err(|e| fail(e.to_string()))?;
        let rel_name = rel.to_string_lossy().replace('\\', "/");
        if ft.is_dir() {
            zip.add_directory(format!("{rel_name}/"), zip::write::FileOptions::default()).map_err(|e| fail(e.to_string()))?;
            entries += 1;
        } else if ft.is_file() {
            let opts = zip::write::FileOptions::default()
                .compression_method(zip::CompressionMethod::Deflated)
                .large_file(meta.len() >= u32::MAX as u64);
            zip.start_file(rel_name, opts).map_err(|e| fail(e.to_string()))?;
            let mut f = std::fs::File::open(entry.path()).map_err(|e| fail(e.to_string()))?;
            let n = std::io::copy(&mut f, &mut zip).map_err(|e| fail(e.to_string()))?;
            files += 1;
            bytes += n;
            entries += 1;
        }
    }
    let mut w = zip.finish().map_err(|e| fail(e.to_string()))?;
    w.flush().map_err(|e| fail(e.to_string()))?;
    drop(w);
    // Proof, not hope: the archive opens and holds what was written.
    let check = std::fs::File::open(&part).map_err(|e| fail(e.to_string()))?;
    let archive = zip::ZipArchive::new(check).map_err(|e| fail(e.to_string()))?;
    if archive.len() != entries {
        return Err(fail(format!("{} of {entries} entries", archive.len())));
    }
    drop(archive);
    std::fs::rename(&part, &final_path).map_err(|e| fail(e.to_string()))?;
    Ok(BackupResult { zip_path: final_path.to_string_lossy().into_owned(), files, bytes })
}

/// Back up an old data or cache folder as a .zip into `dest_dir` (the person picked it).
#[tauri::command]
pub async fn old_installs_backup(app: tauri::AppHandle, id: String, dest_dir: String) -> Result<BackupResult, String> {
    let dir = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (item, _) = find_fresh(&dir, &id)?;
        if !matches!(item.kind, ItemKind::Data | ItemKind::Cache) {
            return Err("oldInstalls.errNotRemovable".to_string());
        }
        let src = PathBuf::from(item.path.unwrap_or_default());
        guard_folder(&src)?;
        let stem = format!("BMM-old-data-{}", id.replace(':', "-"));
        backup_folder(&src, Path::new(&dest_dir), &stem)
    }).await.map_err(|e| e.to_string())?
}

/// A data/cache folder: inside %AppData% or %LocalAppData%, named exactly com.bettermm.app,
/// directly under the root.
fn guard_folder(src: &Path) -> Result<PathBuf, String> {
    let roots = data_roots();
    if src.file_name().map(|n| n.to_string_lossy().to_string()) != Some(OLD_ID.to_string()) {
        return Err("oldInstalls.errOutsideRoots".into());
    }
    let parent_ok = src.parent().map(|p| roots.iter().any(|r| norm_path(&r.to_string_lossy()) == norm_path(&p.to_string_lossy()))).unwrap_or(false);
    if !parent_ok {
        return Err("oldInstalls.errOutsideRoots".into());
    }
    guard_path(src, &roots)
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RemoveResult {
    pub freed_bytes: u64,
}

/// Delete one old data folder, cache folder or shortcut. `path` must be the path the page showed
/// in its confirmation: if the fresh scan says otherwise, nothing is deleted.
#[tauri::command]
pub async fn old_installs_remove(app: tauri::AppHandle, id: String, path: String) -> Result<RemoveResult, String> {
    let dir = app_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let (item, _) = find_fresh(&dir, &id)?;
        let item_path = item.path.clone().unwrap_or_default();
        if norm_path(&item_path) != norm_path(&path) {
            return Err("oldInstalls.errPathChanged".to_string());
        }
        let p = PathBuf::from(&item_path);
        match item.kind {
            ItemKind::Data | ItemKind::Cache => {
                let real = guard_folder(&p)?;
                let freed = dir_size(&real);
                std::fs::remove_dir_all(&real).map_err(|e| format!("oldInstalls.errDelete|{e}"))?;
                crate::commands::crash::log_line(format!("[OLD-INSTALLS] removed folder {}", real.display()));
                Ok(RemoveResult { freed_bytes: freed })
            }
            ItemKind::Shortcut => {
                if !p.extension().map(|x| x.eq_ignore_ascii_case("lnk")).unwrap_or(false) {
                    return Err("oldInstalls.errOutsideRoots".to_string());
                }
                let real = guard_path(&p, &shortcut_roots())?;
                let freed = std::fs::metadata(&real).map(|m| m.len()).unwrap_or(0);
                std::fs::remove_file(&real).map_err(|e| format!("oldInstalls.errDelete|{e}"))?;
                crate::commands::crash::log_line(format!("[OLD-INSTALLS] removed shortcut {}", real.display()));
                Ok(RemoveResult { freed_bytes: freed })
            }
            ItemKind::Install => Err("oldInstalls.errNotRemovable".to_string()),
        }
    }).await.map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;

    const RUN: &str = r"C:\Program Files\Better Mods Manager\better-mods-manager.exe";

    fn nsis_090() -> RegEntry {
        RegEntry {
            hive: "HKCU".into(),
            key: "Better Mod Manager".into(),
            display_name: "Better Mod Manager".into(),
            display_version: "0.9.5".into(),
            publisher: "bettermm".into(),
            install_location: r"C:\Users\me\AppData\Local\Better Mod Manager".into(),
            uninstall_string: r#""C:\Users\me\AppData\Local\Better Mod Manager\uninstall.exe""#.into(),
            quiet_uninstall_string: r#""C:\Users\me\AppData\Local\Better Mod Manager\uninstall.exe" /S"#.into(),
            display_icon: r#""C:\Users\me\AppData\Local\Better Mod Manager\Better Mod Manager.exe""#.into(),
            estimated_size_kb: Some(12_000),
            windows_installer: false,
        }
    }

    fn msi_100() -> RegEntry {
        RegEntry {
            hive: "HKLM64".into(),
            key: "{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9}".into(),
            display_name: "Better Mod Manager".into(),
            display_version: "1.0.0".into(),
            install_location: r"C:\Program Files\Better Mod Manager\".into(),
            uninstall_string: "MsiExec.exe /X{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9}".into(),
            windows_installer: true,
            ..Default::default()
        }
    }

    fn bi_current() -> RegEntry {
        RegEntry {
            hive: "HKCU".into(),
            key: NEW_ID.into(),
            display_name: "Better Mods Manager".into(),
            display_version: "1.0.2".into(),
            install_location: r"C:\Program Files\Better Mods Manager".into(),
            uninstall_string: r#""C:\Program Files\Better Mods Manager\uninstall.exe" --uninstall"#.into(),
            ..Default::default()
        }
    }

    #[test]
    fn names_that_are_bmm_and_names_that_are_not() {
        assert!(is_bmm_name("Better Mod Manager"));
        assert!(is_bmm_name("Better Mods Manager"));
        assert!(is_bmm_name("Better Mod Manager 0.9.5"));
        assert!(is_bmm_name("Better Mod Manager (x64)"));
        assert!(!is_bmm_name("Better Mods Manager Tools"));
        assert!(!is_bmm_name("Mod Manager"));
        assert!(!is_bmm_name(""));
    }

    #[test]
    fn guids_are_strict() {
        assert!(is_guid("{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9}"));
        assert!(!is_guid("{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F}"));
        assert!(!is_guid("{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8FZ}"));
        assert!(!is_guid("{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9} & calc"));
    }

    #[test]
    fn installer_types_are_told_apart() {
        assert_eq!(classify(&nsis_090()), InstallerType::Nsis);
        assert_eq!(classify(&msi_100()), InstallerType::Msi);
        assert_eq!(classify(&bi_current()), InstallerType::BetterInstaller);
        let odd = RegEntry { display_name: "Better Mod Manager".into(), uninstall_string: r"C:\x\setup.exe /remove".into(), ..Default::default() };
        assert_eq!(classify(&odd), InstallerType::Unknown);
        assert_eq!(msi_product_code(&msi_100()).as_deref(), Some("{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9}"));
    }

    #[test]
    fn command_lines_split() {
        assert_eq!(split_command(r#""C:\a b\uninstall.exe" /S"#), (r"C:\a b\uninstall.exe".into(), "/S".into()));
        assert_eq!(split_command(r"C:\a b\uninstall.exe /S"), (r"C:\a b\uninstall.exe".into(), "/S".into()));
        assert_eq!(icon_path(r#""C:\a\b.exe",0"#), r"C:\a\b.exe");
        assert_eq!(icon_path(r"C:\a\b.exe"), r"C:\a\b.exe");
    }

    #[test]
    fn the_running_install_is_never_listed() {
        let items = entries_to_items(&[nsis_090(), msi_100(), bi_current()], RUN, "1.0.2");
        let ids: Vec<&str> = items.iter().map(|i| i.id.as_str()).collect();
        assert!(!ids.contains(&"install:HKCU:com.bettermm.desktop"), "{ids:?}");
        assert_eq!(items.len(), 2);
        // Case and a trailing backslash do not hide it.
        let mut shouty = bi_current();
        shouty.install_location = r"c:\PROGRAM FILES\better mods manager\".into();
        shouty.uninstall_string = String::new();
        assert!(is_running_install(&shouty, RUN, "1.0.2"));
        // An entry that names no folder at all, at exactly the running version: not listed.
        let blind = RegEntry { display_name: "Better Mods Manager".into(), display_version: "1.0.2".into(), key: "{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9}".into(), uninstall_string: "MsiExec.exe /X{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9}".into(), ..Default::default() };
        assert!(is_running_install(&blind, RUN, "1.0.2"));
        assert!(!is_running_install(&blind, RUN, "1.0.3"));
    }

    #[test]
    fn a_betterinstaller_install_that_is_not_running_is_listed_but_not_offered() {
        let dev = r"E:\src\bmm\target\debug\better-mods-manager.exe";
        let items = entries_to_items(&[bi_current()], dev, "1.0.2");
        assert_eq!(items.len(), 1);
        assert!(items[0].current_line);
        assert!(offerable(&items).is_empty());
    }

    #[test]
    fn uninstall_plans_use_constant_or_validated_arguments() {
        let (exe, args) = uninstall_plan(&nsis_090(), false, r"C:\Windows").unwrap();
        assert_eq!(exe, PathBuf::from(r"C:\Users\me\AppData\Local\Better Mod Manager\uninstall.exe"));
        assert_eq!(args, None);
        assert_eq!(uninstall_plan(&nsis_090(), true, r"C:\Windows").unwrap().1.as_deref(), Some("/S"));
        let (exe, args) = uninstall_plan(&msi_100(), false, r"C:\Windows").unwrap();
        assert_eq!(exe, PathBuf::from(r"C:\Windows").join("System32").join("msiexec.exe"));
        assert_eq!(args.as_deref(), Some("/x {0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9}"));
        // A product code that is not a clean GUID never reaches msiexec.
        let mut evil = msi_100();
        evil.key = "Better Mod Manager".into();
        evil.uninstall_string = "MsiExec.exe /X{0A1B2C3D-4E5F-6071-8293-A4B5C6D7E8F9\" & calc".into();
        assert!(uninstall_plan(&evil, false, r"C:\Windows").is_err());
        assert_eq!(uninstall_plan(&bi_current(), true, r"C:\Windows").unwrap().1.as_deref(), Some("--uninstall"));
    }

    #[test]
    fn the_offer_is_once_per_new_thing_and_never_after_never() {
        let items = entries_to_items(&[nsis_090()], RUN, "1.0.2");
        let mut prefs = OfferPrefs::default();
        assert!(should_offer(&prefs, &items));
        prefs.seen = offerable(&items);
        assert!(!should_offer(&prefs, &items), "Not now: the same thing is not offered again");
        let more = entries_to_items(&[nsis_090(), msi_100()], RUN, "1.0.2");
        assert!(should_offer(&prefs, &more), "something new is");
        prefs.never_ask = true;
        assert!(!should_offer(&prefs, &more));
        assert!(!should_offer(&OfferPrefs::default(), &[]));
    }

    /// A minimal .lnk: header, no IDList, a LinkInfo with an ANSI local base path.
    fn lnk(path: &str, unicode: bool) -> Vec<u8> {
        let mut b = vec![0u8; 0x4C];
        b[0..4].copy_from_slice(&0x4Cu32.to_le_bytes());
        b[0x14..0x18].copy_from_slice(&0x2u32.to_le_bytes()); // HasLinkInfo
        let header: u32 = if unicode { 0x24 } else { 0x1C };
        let mut li = vec![0u8; header as usize];
        let base_off = header as usize;
        let mut tail = path.as_bytes().to_vec();
        tail.push(0);
        let suffix_off = base_off + tail.len();
        tail.push(0); // empty suffix
        let uni_off = base_off + tail.len();
        if unicode {
            for u in path.encode_utf16() { tail.extend_from_slice(&u.to_le_bytes()); }
            tail.extend_from_slice(&[0, 0]);
        }
        let size = (header as usize + tail.len()) as u32;
        li[0..4].copy_from_slice(&size.to_le_bytes());
        li[4..8].copy_from_slice(&header.to_le_bytes());
        li[8..12].copy_from_slice(&1u32.to_le_bytes());
        li[16..20].copy_from_slice(&(base_off as u32).to_le_bytes());
        li[24..28].copy_from_slice(&(suffix_off as u32).to_le_bytes());
        if unicode {
            li[28..32].copy_from_slice(&(uni_off as u32).to_le_bytes());
        }
        b.extend(li);
        b.extend(tail);
        b
    }

    #[test]
    fn shortcut_targets_are_read() {
        let p = r"C:\Users\me\AppData\Local\Better Mod Manager\Better Mod Manager.exe";
        assert_eq!(lnk_target(&lnk(p, false)).as_deref(), Some(p));
        let u = r"C:\Users\Zoé\Better Mod Manager.exe";
        assert_eq!(lnk_target(&lnk(u, true)).as_deref(), Some(u));
        assert_eq!(lnk_target(b"not a shortcut"), None);
        assert_eq!(lnk_target(&lnk(p, false)[..0x50]), None, "truncated");
    }

    #[test]
    fn leftover_shortcuts() {
        let old = vec![norm_path(r"C:\Users\me\AppData\Local\Better Mod Manager")];
        let t = r"C:\Users\me\AppData\Local\Better Mod Manager\Better Mod Manager.exe";
        assert!(shortcut_is_leftover("Better Mod Manager", t, true, RUN, &old), "points into an old install");
        assert!(shortcut_is_leftover("Better Mod Manager", r"D:\gone\bmm.exe", false, RUN, &[]), "target gone");
        assert!(!shortcut_is_leftover("Better Mods Manager", RUN, true, RUN, &old), "the running BMM");
        assert!(!shortcut_is_leftover("Better Mod Manager", r"D:\elsewhere\bmm.exe", true, RUN, &[]), "alive and not old");
        assert!(!shortcut_is_leftover("Steam", r"D:\gone\steam.exe", false, RUN, &[]), "not ours");
    }

    #[test]
    fn lexical_guard() {
        let root = std::env::temp_dir();
        assert!(lexically_inside(&root.join("a").join(OLD_ID), &root).is_ok());
        assert_eq!(lexically_inside(&root.join("..").join(OLD_ID), &root).unwrap_err(), "oldInstalls.errDotSegment");
        assert_eq!(lexically_inside(Path::new("relative\\x"), &root).unwrap_err(), "oldInstalls.errNotAbsolute");
        assert_eq!(lexically_inside(&root, &root).unwrap_err(), "oldInstalls.errOutsideRoots", "the root itself");
        let other = root.parent().unwrap_or(&root).join("elsewhere-bmm");
        assert_eq!(lexically_inside(&other, &root.join("sub")).unwrap_err(), "oldInstalls.errOutsideRoots");
    }

    #[test]
    fn guard_refuses_wrong_root_and_accepts_a_real_folder() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("root");
        let inside = root.join(OLD_ID);
        std::fs::create_dir_all(&inside).unwrap();
        let outside = base.path().join("outside");
        std::fs::create_dir_all(&outside).unwrap();
        assert!(guard_path(&inside, &[root.clone()]).is_ok());
        assert_eq!(guard_path(&outside, &[root.clone()]).unwrap_err(), "oldInstalls.errOutsideRoots");
        assert_eq!(guard_path(&root.join("missing"), &[root.clone()]).unwrap_err(), "oldInstalls.errMissing");
    }

    #[test]
    fn guard_refuses_a_link() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("root");
        std::fs::create_dir_all(&root).unwrap();
        let target = base.path().join("precious");
        std::fs::create_dir_all(&target).unwrap();
        let link = root.join(OLD_ID);
        #[cfg(windows)]
        let made = std::os::windows::fs::symlink_dir(&target, &link).is_ok();
        #[cfg(unix)]
        let made = std::os::unix::fs::symlink(&target, &link).is_ok();
        if !made {
            eprintln!("symlinks not allowed here (Windows without Developer Mode): skipped");
            return;
        }
        assert_eq!(guard_path(&link, &[root.clone()]).unwrap_err(), "oldInstalls.errLink");
        // A link on the way counts too.
        let below = link.join("x");
        std::fs::create_dir_all(target.join("x")).unwrap();
        assert_eq!(guard_path(&below, &[root.clone()]).unwrap_err(), "oldInstalls.errLink");
        assert!(target.exists());
    }

    /// A junction needs no special rights to create, so this one always runs on Windows: the
    /// data folder replaced by a junction to somewhere precious must be refused, not followed.
    #[cfg(windows)]
    #[test]
    fn guard_refuses_a_junction() {
        let base = tempfile::tempdir().unwrap();
        let root = base.path().join("root");
        std::fs::create_dir_all(&root).unwrap();
        let target = base.path().join("precious");
        std::fs::create_dir_all(&target).unwrap();
        std::fs::write(target.join("keep.txt"), "x").unwrap();
        let link = root.join(OLD_ID);
        let out = crate::commands::proc::hidden_command("cmd")
            .arg("/c").arg("mklink").arg("/J").arg(&link).arg(&target)
            .output().unwrap();
        assert!(out.status.success(), "mklink /J failed: {}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(guard_path(&link, &[root.clone()]).unwrap_err(), "oldInstalls.errLink");
        assert_eq!(guard_path(&link.join("keep.txt"), &[root.clone()]).unwrap_err(), "oldInstalls.errLink");
        assert!(target.join("keep.txt").exists());
    }

    #[test]
    fn migration_is_proven_by_marker_or_by_every_file() {
        let base = tempfile::tempdir().unwrap();
        let old = base.path().join(OLD_ID);
        let new = base.path().join(NEW_ID);
        std::fs::create_dir_all(old.join("Replays")).unwrap();
        std::fs::create_dir_all(&new).unwrap();
        std::fs::write(old.join("data.json"), "{}").unwrap();
        std::fs::write(old.join("Replays").join("a.bmmreplay"), "x").unwrap();
        assert!(!migration_complete(&old, &new), "nothing copied yet");
        std::fs::write(new.join("data.json"), "{}").unwrap();
        assert!(!migration_complete(&old, &new), "one file still only in the old folder");
        std::fs::create_dir_all(new.join("Replays")).unwrap();
        std::fs::write(new.join("Replays").join("a.bmmreplay"), "x").unwrap();
        assert!(migration_complete(&old, &new));
        std::fs::write(old.join("late.txt"), "x").unwrap();
        assert!(!migration_complete(&old, &new));
        std::fs::write(new.join(MIGRATED_MARKER), "").unwrap();
        assert!(migration_complete(&old, &new), "the marker settles it");
    }

    #[test]
    fn backup_zip_holds_every_file_and_refuses_itself() {
        let base = tempfile::tempdir().unwrap();
        let src = base.path().join(OLD_ID);
        std::fs::create_dir_all(src.join("sub")).unwrap();
        std::fs::write(src.join("data.json"), "{\"a\":1}").unwrap();
        std::fs::write(src.join("sub").join("b.txt"), "hello").unwrap();
        let dest = base.path().join("backups");
        std::fs::create_dir_all(&dest).unwrap();
        let r = backup_folder(&src, &dest, "BMM-old-data-test").unwrap();
        assert_eq!(r.files, 2);
        assert!(r.zip_path.ends_with(".zip"));
        let archive = zip::ZipArchive::new(std::fs::File::open(&r.zip_path).unwrap()).unwrap();
        assert_eq!(archive.len(), 3, "two files and one folder");
        assert_eq!(backup_folder(&src, &src.join("sub"), "x").unwrap_err(), "oldInstalls.errBackupInside");
        assert_eq!(backup_folder(&src, Path::new("relative"), "x").unwrap_err(), "oldInstalls.errBackupDir");
    }
}
