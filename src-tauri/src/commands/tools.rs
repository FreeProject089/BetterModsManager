//! BMM Tools: the read-only diagnostics behind the Tools hub (frontend/src/features/tools).
//!
//! Four questions a library grows into and nothing else in BMM answers in one place:
//!
//!   · **Duplicates**: the same mod registered twice (often in two profiles), and identical
//!     files carried by several mods (size first, then BLAKE3 on the size collisions only).
//!   · **Disk usage**: how much each profile's mods and backups weigh, per mod, and what sits
//!     in BMM's own data folder (caches, logs, backups).
//!   · **Profile diff**: two profiles side by side: mods only in one, a different version, a
//!     different enabled state, a different activation order.
//!   · **Orphans**: profiles naming mods that no longer exist, mods whose folder is gone,
//!     folders in a mods directory BMM does not know about, profile folders that vanished.
//!
//! Everything here READS. Nothing deletes, moves or rewrites: a finder that also cleans up is
//! one misread result away from losing somebody's mods, and the hub's job is to show, with an
//! "open folder" next to each finding so the person decides.
//!
//! Every path walked comes from BMM's own state (the profiles' folders, the mods' folders, the
//! app data folder), never from an argument, so these commands cannot be pointed at an
//! arbitrary directory by whoever reaches the IPC.
//!
//! The thinking is in plain functions over plain data (tested below); the commands only take
//! the snapshot, walk the disk on a blocking thread under a governor ticket, and report.

use serde::Serialize;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};

use crate::state::AppState;

/// Set by `tools_cancel`, cleared when a run starts. One flag for the hub: it runs one long
/// tool at a time, and a stale cancel from a previous run must not stop the next one.
static CANCEL: AtomicBool = AtomicBool::new(false);

fn cancelled() -> bool { CANCEL.load(Ordering::Relaxed) }

/// Stop the running duplicate / disk-usage scan at its next file. Harmless when idle.
#[tauri::command]
pub fn tools_cancel() {
    CANCEL.store(true, Ordering::Relaxed);
}

fn progress(app: &tauri::AppHandle, tool: &str, phase: &str, done: usize, total: usize) {
    use tauri::Emitter;
    let _ = app.emit("tools-progress", serde_json::json!({ "tool": tool, "phase": phase, "done": done, "total": total }));
}

// ── Shared pure helpers ──────────────────────────────────────────────────────────────────

/// A mod name reduced to what identifies it: lower case, letters and digits only. "Better
/// Trees v2", "better_trees-v2" and "BetterTreesV2" are one mod for the purpose of "is this
/// registered twice".
pub fn normalize_name(name: &str) -> String {
    name.chars().filter(|c| c.is_alphanumeric()).flat_map(|c| c.to_lowercase()).collect()
}

/// The identity used to match a mod across profiles: its content id when it has one (two
/// names, same bytes), its normalised name otherwise.
pub fn match_key(content_id: Option<&str>, name: &str) -> String {
    match content_id.map(str::trim).filter(|s| !s.is_empty()) {
        Some(c) => format!("cid:{}", c),
        None => format!("name:{}", normalize_name(name)),
    }
}

/// Whether `child` is inside `root`, comparing canonical paths when both exist and the raw
/// ones otherwise (a vanished folder still belongs where it used to).
fn is_under(child: &Path, root: &Path) -> bool {
    if root.as_os_str().is_empty() { return false; }
    if child.starts_with(root) { return true; }
    match (child.canonicalize(), root.canonicalize()) {
        (Ok(a), Ok(b)) => a.starts_with(&b),
        _ => false,
    }
}

/// One mod, as these tools see it: no file lists, no hashes.
#[derive(Debug, Clone, Serialize)]
pub struct ToolMod {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub order: u32,
    pub path: String,
    pub content_id: Option<String>,
    /// The profile whose mods folder holds it, if any.
    pub profile_id: Option<String>,
    pub profile_name: Option<String>,
}

#[derive(Debug, Clone)]
struct ProfileSnap {
    id: String,
    name: String,
    mods_path: PathBuf,
    game_path: PathBuf,
    backup_path: PathBuf,
    active_mods: Vec<String>,
}

/// Copy what the tools need out of the state and let go of the lock before any disk work.
fn snapshot(state: &AppState) -> (Vec<ProfileSnap>, Vec<ToolMod>) {
    let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
    let profiles: Vec<ProfileSnap> = data.profiles.iter().map(|p| ProfileSnap {
        id: p.id.clone(),
        name: p.name.clone(),
        mods_path: p.mods_path.clone(),
        game_path: p.game_path.clone(),
        backup_path: p.backup_path.clone(),
        active_mods: p.active_mods.clone(),
    }).collect();
    let mods = data.mods.iter().map(|m| ToolMod {
        id: m.id.clone(),
        name: m.name.clone(),
        version: m.version.clone(),
        enabled: m.enabled,
        order: m.activation_order,
        path: m.mod_folder_path.to_string_lossy().to_string(),
        content_id: m.content_id.clone(),
        profile_id: None,
        profile_name: None,
    }).collect();
    drop(data);
    let mut mods: Vec<ToolMod> = mods;
    for m in mods.iter_mut() {
        let mp = PathBuf::from(&m.path);
        if let Some(p) = profiles.iter().find(|p| is_under(&mp, &p.mods_path)) {
            m.profile_id = Some(p.id.clone());
            m.profile_name = Some(p.name.clone());
        }
    }
    (profiles, mods)
}

// ── Duplicates ───────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DupModGroup {
    /// `cid:<content id>` or `name:<normalised name>`.
    pub key: String,
    pub mods: Vec<DupModRef>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DupModRef {
    pub id: String,
    pub name: String,
    pub version: String,
    pub path: String,
    pub profile_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DupFile {
    pub mod_id: String,
    pub mod_name: String,
    /// Absolute path of the file (or of the archive, for an archived mod).
    pub path: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DupFileGroup {
    pub hash: String,
    pub size: u64,
    /// Bytes that would be saved if only one copy existed: size × (copies − 1).
    pub wasted: u64,
    pub files: Vec<DupFile>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DuplicateReport {
    pub mod_groups: Vec<DupModGroup>,
    pub file_groups: Vec<DupFileGroup>,
    pub files_scanned: usize,
    pub files_hashed: usize,
    pub wasted_bytes: u64,
    /// The hash budget ran out: some size collisions were not hashed.
    pub truncated: bool,
    pub cancelled: bool,
}

/// Mods registered more than once, by content id or normalised name. Groups and their
/// members come out sorted, so the result reads the same on every run.
pub fn group_duplicate_mods(mods: &[ToolMod]) -> Vec<DupModGroup> {
    let mut by_key: BTreeMap<String, Vec<DupModRef>> = BTreeMap::new();
    for m in mods {
        let key = match_key(m.content_id.as_deref(), &m.name);
        if key == "name:" { continue; } // a nameless mod matches nothing meaningfully
        by_key.entry(key).or_default().push(DupModRef {
            id: m.id.clone(), name: m.name.clone(), version: m.version.clone(),
            path: m.path.clone(), profile_name: m.profile_name.clone(),
        });
    }
    by_key.into_iter()
        .filter(|(_, v)| v.len() > 1)
        .map(|(key, mut mods)| { mods.sort_by(|a, b| a.path.cmp(&b.path)); DupModGroup { key, mods } })
        .collect()
}

/// A file seen during the walk.
#[derive(Debug, Clone)]
pub struct SeenFile {
    pub mod_idx: usize,
    pub path: PathBuf,
    pub size: u64,
}

/// The files worth hashing: those sharing their size with another file, at or above
/// `min_size`. Most files have a unique size, so this is what keeps the scan cheap. Largest
/// sizes first, so a budget that runs out has spent itself on what matters most.
pub fn size_collisions(files: &[SeenFile], min_size: u64) -> Vec<(u64, Vec<usize>)> {
    let mut by_size: HashMap<u64, Vec<usize>> = HashMap::new();
    for (i, f) in files.iter().enumerate() {
        if f.size >= min_size.max(1) { by_size.entry(f.size).or_default().push(i); }
    }
    let mut out: Vec<(u64, Vec<usize>)> = by_size.into_iter().filter(|(_, v)| v.len() > 1).collect();
    out.sort_by(|a, b| b.0.cmp(&a.0));
    out
}

/// Group already-hashed files (index into `files`, hash) into duplicate sets.
pub fn group_by_hash(files: &[SeenFile], hashed: &[(usize, String)], mods: &[ToolMod]) -> Vec<DupFileGroup> {
    let mut by_hash: BTreeMap<(u64, String), Vec<usize>> = BTreeMap::new();
    for (i, h) in hashed {
        by_hash.entry((files[*i].size, h.clone())).or_default().push(*i);
    }
    let mut out: Vec<DupFileGroup> = by_hash.into_iter()
        .filter(|(_, v)| v.len() > 1)
        .map(|((size, hash), idxs)| {
            let mut files_out: Vec<DupFile> = idxs.iter().map(|&i| {
                let m = &mods[files[i].mod_idx];
                DupFile { mod_id: m.id.clone(), mod_name: m.name.clone(), path: files[i].path.to_string_lossy().to_string() }
            }).collect();
            files_out.sort_by(|a, b| a.path.cmp(&b.path));
            DupFileGroup { wasted: size.saturating_mul(files_out.len() as u64 - 1), hash, size, files: files_out }
        })
        .collect();
    out.sort_by(|a, b| b.wasted.cmp(&a.wasted).then_with(|| a.hash.cmp(&b.hash)));
    out
}

/// Find mods registered twice and identical files across mods.
///
/// `min_size_kb` (default 64) skips small files, which are numerous and rarely worth the
/// space; `max_hash` (default 20 000) bounds the hashing, and the report says when it ran out.
#[tauri::command]
pub async fn tools_find_duplicates(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    min_size_kb: Option<u64>,
    max_hash: Option<usize>,
) -> Result<DuplicateReport, String> {
    CANCEL.store(false, Ordering::Relaxed);
    let (_, mods) = snapshot(&state);
    let min_size = min_size_kb.unwrap_or(64).saturating_mul(1024);
    let budget = max_hash.unwrap_or(20_000).clamp(1, 200_000);
    tauri::async_runtime::spawn_blocking(move || {
        let ticket = crate::governor::runtime::global()
            .begin(crate::governor::config::OpKind::Hash, "tools: duplicate finder");
        let mut report = DuplicateReport { mod_groups: group_duplicate_mods(&mods), ..Default::default() };

        // Walk every mod once. An archived mod is one file: its archive.
        let mut files: Vec<SeenFile> = Vec::new();
        for (mi, m) in mods.iter().enumerate() {
            if cancelled() || ticket.checkpoint().is_err() { report.cancelled = true; return report; }
            progress(&app, "duplicates", "walk", mi, mods.len());
            let root = PathBuf::from(&m.path);
            if root.is_file() {
                if let Ok(md) = root.metadata() { files.push(SeenFile { mod_idx: mi, path: root, size: md.len() }); }
                continue;
            }
            for e in walkdir::WalkDir::new(&root).follow_links(false).into_iter().flatten() {
                if !e.file_type().is_file() { continue; }
                if let Ok(md) = e.metadata() {
                    files.push(SeenFile { mod_idx: mi, path: e.path().to_path_buf(), size: md.len() });
                }
            }
        }
        report.files_scanned = files.len();

        let groups = size_collisions(&files, min_size);
        let total: usize = groups.iter().map(|(_, v)| v.len()).sum();
        let mut hashed: Vec<(usize, String)> = Vec::new();
        'outer: for (_, idxs) in &groups {
            for &i in idxs {
                if hashed.len() >= budget { report.truncated = true; break 'outer; }
                if cancelled() || ticket.checkpoint().is_err() { report.cancelled = true; break 'outer; }
                if let Ok(h) = crate::fs_utils::compute_file_hash(&files[i].path) {
                    ticket.add_bytes(files[i].size, 0);
                    hashed.push((i, h.trim_start_matches("b3:").to_string()));
                }
                if hashed.len() % 25 == 0 { progress(&app, "duplicates", "hash", hashed.len(), total.min(budget)); }
            }
        }
        report.files_hashed = hashed.len();
        report.file_groups = group_by_hash(&files, &hashed, &mods);
        report.wasted_bytes = report.file_groups.iter().map(|g| g.wasted).sum();
        progress(&app, "duplicates", "done", report.files_hashed, report.files_hashed);
        report
    }).await.map_err(|e| e.to_string())
}

// ── Disk usage ───────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize)]
pub struct SizedItem {
    pub id: String,
    pub name: String,
    pub path: String,
    pub bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
pub struct ProfileUsage {
    pub id: String,
    pub name: String,
    pub mods_path: String,
    pub mods_bytes: u64,
    pub backup_path: String,
    pub backup_bytes: u64,
    /// The profile's registered mods, heaviest first.
    pub mods: Vec<SizedItem>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DiskUsageReport {
    pub profiles: Vec<ProfileUsage>,
    pub app_data_path: String,
    /// Top-level entries of BMM's data folder (caches, logs, backups…), heaviest first.
    pub app_data: Vec<SizedItem>,
    pub total_bytes: u64,
    pub cancelled: bool,
}

/// Size of a file, or of a folder's files (links not followed). Stops at a cancel and
/// answers what it had counted.
fn path_size(p: &Path, ticket: &crate::governor::queue::Ticket) -> u64 {
    if p.as_os_str().is_empty() { return 0; }
    if p.is_file() { return p.metadata().map(|m| m.len()).unwrap_or(0); }
    let mut total = 0u64;
    for (n, e) in walkdir::WalkDir::new(p).follow_links(false).into_iter().flatten().enumerate() {
        if n % 512 == 0 && (cancelled() || ticket.checkpoint().is_err()) { break; }
        if e.file_type().is_file() {
            total += e.metadata().map(|m| m.len()).unwrap_or(0);
        }
    }
    total
}

/// Heaviest first, then by name, so equal sizes keep a stable order.
pub fn sort_heaviest(items: &mut [SizedItem]) {
    items.sort_by(|a, b| b.bytes.cmp(&a.bytes).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
}

/// How much each profile's mods and backups weigh, per mod, and BMM's own data folder.
#[tauri::command]
pub async fn tools_disk_usage(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
) -> Result<DiskUsageReport, String> {
    CANCEL.store(false, Ordering::Relaxed);
    let (profiles, mods) = snapshot(&state);
    let app_dir = state.data_path.parent().map(Path::to_path_buf).unwrap_or_default();
    tauri::async_runtime::spawn_blocking(move || {
        let ticket = crate::governor::runtime::global()
            .begin(crate::governor::config::OpKind::Scan, "tools: disk usage");
        let mut report = DiskUsageReport { app_data_path: app_dir.to_string_lossy().to_string(), ..Default::default() };
        let steps = profiles.len() + 1;
        for (pi, p) in profiles.iter().enumerate() {
            progress(&app, "disk", "profiles", pi, steps);
            if cancelled() { report.cancelled = true; break; }
            let mut items: Vec<SizedItem> = mods.iter()
                .filter(|m| m.profile_id.as_deref() == Some(p.id.as_str()))
                .map(|m| SizedItem { id: m.id.clone(), name: m.name.clone(), path: m.path.clone(), bytes: path_size(Path::new(&m.path), &ticket) })
                .collect();
            sort_heaviest(&mut items);
            let mods_bytes = path_size(&p.mods_path, &ticket);
            let backup_bytes = path_size(&p.backup_path, &ticket);
            report.total_bytes += mods_bytes + backup_bytes;
            report.profiles.push(ProfileUsage {
                id: p.id.clone(), name: p.name.clone(),
                mods_path: p.mods_path.to_string_lossy().to_string(), mods_bytes,
                backup_path: p.backup_path.to_string_lossy().to_string(), backup_bytes,
                mods: items,
            });
        }
        if !report.cancelled && app_dir.is_dir() {
            progress(&app, "disk", "appdata", profiles.len(), steps);
            if let Ok(rd) = std::fs::read_dir(&app_dir) {
                for e in rd.flatten() {
                    if cancelled() { report.cancelled = true; break; }
                    let path = e.path();
                    let name = e.file_name().to_string_lossy().to_string();
                    let bytes = path_size(&path, &ticket);
                    report.app_data.push(SizedItem { id: name.clone(), name, path: path.to_string_lossy().to_string(), bytes });
                }
            }
            sort_heaviest(&mut report.app_data);
            report.total_bytes += report.app_data.iter().map(|x| x.bytes).sum::<u64>();
        }
        report.profiles.sort_by(|a, b| (b.mods_bytes + b.backup_bytes).cmp(&(a.mods_bytes + a.backup_bytes)));
        progress(&app, "disk", "done", steps, steps);
        report
    }).await.map_err(|e| e.to_string())
}

// ── Profile diff ─────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DiffSide {
    pub id: String,
    pub name: String,
    pub version: String,
    pub enabled: bool,
    pub order: u32,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DiffPair {
    pub key: String,
    pub a: DiffSide,
    pub b: DiffSide,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct ProfileDiff {
    pub a_name: String,
    pub b_name: String,
    pub only_a: Vec<DiffSide>,
    pub only_b: Vec<DiffSide>,
    pub version: Vec<DiffPair>,
    pub enabled: Vec<DiffPair>,
    /// Both enabled, in a different relative position (which one wins changes).
    pub order: Vec<DiffPair>,
    pub same: usize,
}

fn side(m: &ToolMod) -> DiffSide {
    DiffSide { id: m.id.clone(), name: m.name.clone(), version: m.version.clone(), enabled: m.enabled, order: m.order }
}

/// Rank of each enabled mod's key in activation order (0 = first), so two profiles with
/// different absolute numbers but the same sequence compare equal.
fn enabled_ranks(mods: &[&ToolMod]) -> HashMap<String, usize> {
    let mut en: Vec<&&ToolMod> = mods.iter().filter(|m| m.enabled).collect();
    en.sort_by(|x, y| x.order.cmp(&y.order).then_with(|| x.name.cmp(&y.name)));
    en.iter().enumerate().map(|(i, m)| (match_key(m.content_id.as_deref(), &m.name), i)).collect()
}

/// Compare two mod sets. Matching is by content id, else normalised name (a mod entry is
/// per-folder, so the "same" mod in two profiles has two different ids).
pub fn diff_mods(a: &[&ToolMod], b: &[&ToolMod]) -> ProfileDiff {
    let index = |v: &[&ToolMod]| -> BTreeMap<String, ToolMod> {
        v.iter().map(|m| (match_key(m.content_id.as_deref(), &m.name), (*m).clone())).collect()
    };
    let ia = index(a);
    let ib = index(b);
    // Order is compared among the mods enabled on BOTH sides only: a mod present on one side
    // shifts every rank after it, and that is already reported as "only in".
    let common_enabled: HashSet<String> = ia.iter()
        .filter(|(k, m)| m.enabled && ib.get(*k).map(|o| o.enabled).unwrap_or(false))
        .map(|(k, _)| k.clone()).collect();
    let ra = enabled_ranks(&a.iter().copied().filter(|m| common_enabled.contains(&match_key(m.content_id.as_deref(), &m.name))).collect::<Vec<_>>());
    let rb = enabled_ranks(&b.iter().copied().filter(|m| common_enabled.contains(&match_key(m.content_id.as_deref(), &m.name))).collect::<Vec<_>>());

    let mut d = ProfileDiff::default();
    for (k, ma) in &ia {
        match ib.get(k) {
            None => d.only_a.push(side(ma)),
            Some(mb) => {
                let pair = || DiffPair { key: k.clone(), a: side(ma), b: side(mb) };
                let mut differs = false;
                if ma.version.trim() != mb.version.trim() { d.version.push(pair()); differs = true; }
                if ma.enabled != mb.enabled { d.enabled.push(pair()); differs = true; }
                if let (Some(x), Some(y)) = (ra.get(k), rb.get(k)) {
                    if x != y { d.order.push(pair()); differs = true; }
                }
                if !differs { d.same += 1; }
            }
        }
    }
    for (k, mb) in &ib {
        if !ia.contains_key(k) { d.only_b.push(side(mb)); }
    }
    d
}

/// Compare the mods of two profiles.
#[tauri::command(async)]
pub fn tools_profile_diff(
    state: tauri::State<AppState>,
    profile_a: String,
    profile_b: String,
) -> Result<ProfileDiff, String> {
    let (profiles, mods) = snapshot(&state);
    let pa = profiles.iter().find(|p| p.id == profile_a).ok_or("tools.err.noProfile")?;
    let pb = profiles.iter().find(|p| p.id == profile_b).ok_or("tools.err.noProfile")?;
    let of = |pid: &str| mods.iter().filter(|m| m.profile_id.as_deref() == Some(pid)).collect::<Vec<_>>();
    let mut d = diff_mods(&of(&pa.id), &of(&pb.id));
    d.a_name = pa.name.clone();
    d.b_name = pb.name.clone();
    Ok(d)
}

// ── Orphans ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct Orphan {
    /// `dangling_active` · `missing_folder` · `unowned` · `unregistered` · `missing_profile_dir`
    pub kind: String,
    /// The mod or the folder concerned.
    pub name: String,
    pub path: String,
    pub profile_name: Option<String>,
    /// The mod id, when the finding is about a registered mod.
    pub mod_id: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct OrphanReport {
    pub items: Vec<Orphan>,
    pub profiles_checked: usize,
    pub mods_checked: usize,
}

/// Input of the orphan rules for one profile's mods folder: its top-level entries.
pub struct FolderListing {
    pub profile_idx: usize,
    pub entries: Vec<PathBuf>,
}

fn same_path(a: &Path, b: &Path) -> bool {
    if a == b { return true; }
    let norm = |p: &Path| p.to_string_lossy().replace('/', "\\").trim_end_matches('\\').to_lowercase();
    if cfg!(windows) && norm(a) == norm(b) { return true; }
    matches!((a.canonicalize(), b.canonicalize()), (Ok(x), Ok(y)) if x == y)
}

/// The orphan rules over plain data. `exists` is the disk, injected so the rules can be
/// tested without one.
fn find_orphans_in(
    profiles: &[ProfileSnap],
    mods: &[ToolMod],
    listings: &[FolderListing],
    exists: &dyn Fn(&Path) -> bool,
) -> Vec<Orphan> {
    let mut out = Vec::new();
    let ids: HashSet<&str> = mods.iter().map(|m| m.id.as_str()).collect();
    for p in profiles {
        for id in &p.active_mods {
            if !ids.contains(id.as_str()) {
                out.push(Orphan { kind: "dangling_active".into(), name: id.clone(), path: String::new(), profile_name: Some(p.name.clone()), mod_id: Some(id.clone()) });
            }
        }
        for (label, dir) in [("mods", &p.mods_path), ("game", &p.game_path), ("backup", &p.backup_path)] {
            if !dir.as_os_str().is_empty() && !exists(dir) {
                out.push(Orphan { kind: "missing_profile_dir".into(), name: label.into(), path: dir.to_string_lossy().to_string(), profile_name: Some(p.name.clone()), mod_id: None });
            }
        }
    }
    for m in mods {
        let mp = PathBuf::from(&m.path);
        if !exists(&mp) {
            out.push(Orphan { kind: "missing_folder".into(), name: m.name.clone(), path: m.path.clone(), profile_name: m.profile_name.clone(), mod_id: Some(m.id.clone()) });
        } else if m.profile_id.is_none() {
            out.push(Orphan { kind: "unowned".into(), name: m.name.clone(), path: m.path.clone(), profile_name: None, mod_id: Some(m.id.clone()) });
        }
    }
    for l in listings {
        let p = &profiles[l.profile_idx];
        for e in &l.entries {
            let known = mods.iter().any(|m| {
                let mp = Path::new(&m.path);
                same_path(mp, e) || mp.starts_with(e) // a mod registered on a sub-folder
            });
            let name = e.file_name().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
            // BMM's own bookkeeping next to the mods is not a stray folder.
            if known || name.starts_with('.') || name.eq_ignore_ascii_case("desktop.ini") { continue; }
            out.push(Orphan { kind: "unregistered".into(), name, path: e.to_string_lossy().to_string(), profile_name: Some(p.name.clone()), mod_id: None });
        }
    }
    out
}

/// Profiles naming mods that no longer exist, mods whose folder is gone or that no profile
/// owns, folders in a mods directory that no mod is registered on, and vanished profile folders.
#[tauri::command(async)]
pub fn tools_find_orphans(state: tauri::State<AppState>) -> Result<OrphanReport, String> {
    let (profiles, mods) = snapshot(&state);
    let mut listings = Vec::new();
    let mut seen_dirs: Vec<PathBuf> = Vec::new();
    for (i, p) in profiles.iter().enumerate() {
        // Two profiles can share a mods folder: list it once.
        if p.mods_path.as_os_str().is_empty() || seen_dirs.iter().any(|d| same_path(d, &p.mods_path)) { continue; }
        seen_dirs.push(p.mods_path.clone());
        if let Ok(rd) = std::fs::read_dir(&p.mods_path) {
            listings.push(FolderListing { profile_idx: i, entries: rd.flatten().map(|e| e.path()).collect() });
        }
    }
    let items = find_orphans_in(&profiles, &mods, &listings, &|p: &Path| p.exists());
    Ok(OrphanReport { items, profiles_checked: profiles.len(), mods_checked: mods.len() })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(id: &str, name: &str, ver: &str, enabled: bool, order: u32, path: &str, profile: Option<&str>) -> ToolMod {
        ToolMod {
            id: id.into(), name: name.into(), version: ver.into(), enabled, order, path: path.into(),
            content_id: None, profile_id: profile.map(String::from), profile_name: profile.map(String::from),
        }
    }

    #[test]
    fn tools_normalize_name_ignores_case_and_punctuation() {
        assert_eq!(normalize_name("Better Trees v2"), "bettertreesv2");
        assert_eq!(normalize_name("better_trees-V2"), "bettertreesv2");
        assert_eq!(match_key(Some(" abc "), "x"), "cid:abc");
        assert_eq!(match_key(Some(""), "A b"), "name:ab");
    }

    #[test]
    fn tools_duplicate_mods_group_by_name_across_profiles() {
        let mods = vec![
            m("1", "Better Trees", "1", true, 0, "C:/p1/trees", Some("P1")),
            m("2", "better-trees", "2", false, 0, "C:/p2/trees", Some("P2")),
            m("3", "Unique", "1", true, 1, "C:/p1/u", Some("P1")),
            m("4", "", "1", true, 1, "C:/p1/x", Some("P1")),
            m("5", "  ", "1", true, 1, "C:/p1/y", Some("P1")),
        ];
        let g = group_duplicate_mods(&mods);
        assert_eq!(g.len(), 1, "{:?}", g);
        assert_eq!(g[0].key, "name:bettertrees");
        assert_eq!(g[0].mods.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["1", "2"]);
    }

    #[test]
    fn tools_content_id_beats_name() {
        let mut a = m("1", "Alpha", "1", true, 0, "a", None);
        let mut b = m("2", "Completely different", "1", true, 0, "b", None);
        a.content_id = Some("same".into());
        b.content_id = Some("same".into());
        let g = group_duplicate_mods(&[a, b]);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].key, "cid:same");
    }

    #[test]
    fn tools_size_collisions_skip_unique_and_small() {
        let f = |i: usize, size: u64| SeenFile { mod_idx: i, path: PathBuf::from(format!("f{}-{}", i, size)), size };
        let files = vec![f(0, 10), f(1, 10), f(0, 5000), f(1, 5000), f(1, 5000), f(0, 7000)];
        let c = size_collisions(&files, 100);
        assert_eq!(c.len(), 1);
        assert_eq!(c[0].0, 5000);
        assert_eq!(c[0].1, vec![2, 3, 4]);
        // Zero-byte files are never "identical content" worth reporting.
        let z = size_collisions(&[f(0, 0), f(1, 0)], 0);
        assert!(z.is_empty());
    }

    #[test]
    fn tools_group_by_hash_counts_wasted_bytes() {
        let mods = vec![m("a", "A", "1", true, 0, "a", None), m("b", "B", "1", true, 0, "b", None)];
        let files = vec![
            SeenFile { mod_idx: 0, path: "a/x.dds".into(), size: 100 },
            SeenFile { mod_idx: 1, path: "b/x.dds".into(), size: 100 },
            SeenFile { mod_idx: 1, path: "b/y.dds".into(), size: 100 },
        ];
        let hashed = vec![(0, "h1".to_string()), (1, "h1".to_string()), (2, "h2".to_string())];
        let g = group_by_hash(&files, &hashed, &mods);
        assert_eq!(g.len(), 1);
        assert_eq!(g[0].wasted, 100);
        assert_eq!(g[0].files.len(), 2);
        assert_eq!(g[0].files[0].mod_name, "A");
    }

    #[test]
    fn tools_diff_reports_each_kind_once() {
        let a = vec![
            m("a1", "Shared", "1.0", true, 0, "", None),
            m("a2", "Only A", "1", true, 1, "", None),
            m("a3", "Ver", "1.0", true, 2, "", None),
            m("a4", "Toggle", "1", true, 3, "", None),
            m("a5", "First", "1", true, 4, "", None),
        ];
        let b = vec![
            m("b1", "shared", "1.0", true, 10, "", None),
            m("b3", "Ver", "2.0", true, 11, "", None),
            m("b4", "Toggle", "1", false, 12, "", None),
            m("b5", "First", "1", true, 0, "", None),
            m("b6", "Only B", "1", false, 13, "", None),
        ];
        let ra: Vec<&ToolMod> = a.iter().collect();
        let rb: Vec<&ToolMod> = b.iter().collect();
        let d = diff_mods(&ra, &rb);
        assert_eq!(d.only_a.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), vec!["Only A"]);
        assert_eq!(d.only_b.iter().map(|x| x.name.as_str()).collect::<Vec<_>>(), vec!["Only B"]);
        assert_eq!(d.version.len(), 1);
        assert_eq!(d.version[0].b.version, "2.0");
        assert_eq!(d.enabled.len(), 1);
        assert_eq!(d.enabled[0].a.name, "Toggle");
        // Common enabled: Shared, Ver, First. A: Shared(0) Ver(2) First(4) → 0,1,2.
        // B: First(0) Shared(10) Ver(11) → First 0, Shared 1, Ver 2. All three moved.
        assert_eq!(d.order.len(), 3, "{:?}", d.order);
        assert_eq!(d.same, 0);
    }

    #[test]
    fn tools_diff_identical_profiles_are_same() {
        let a = vec![m("a1", "X", "1", true, 0, "", None), m("a2", "Y", "1", true, 1, "", None)];
        let b = vec![m("b1", "X", "1", true, 5, "", None), m("b2", "Y", "1", true, 9, "", None)];
        let d = diff_mods(&a.iter().collect::<Vec<_>>(), &b.iter().collect::<Vec<_>>());
        assert_eq!(d.same, 2);
        assert!(d.only_a.is_empty() && d.only_b.is_empty() && d.version.is_empty() && d.enabled.is_empty() && d.order.is_empty());
    }

    #[test]
    fn tools_orphan_rules() {
        let profiles = vec![ProfileSnap {
            id: "p".into(), name: "Main".into(),
            mods_path: PathBuf::from("M:/mods"), game_path: PathBuf::from("M:/game"), backup_path: PathBuf::from("M:/gone"),
            active_mods: vec!["ok".into(), "ghost".into()],
        }];
        let mods = vec![
            m("ok", "Ok", "1", true, 0, "M:/mods/ok", Some("p")),
            m("lost", "Lost", "1", false, 0, "M:/mods/lost", Some("p")),
            m("stray", "Stray", "1", false, 0, "X:/elsewhere", None),
        ];
        let listings = vec![FolderListing { profile_idx: 0, entries: vec![
            PathBuf::from("M:/mods/ok"), PathBuf::from("M:/mods/newfolder"), PathBuf::from("M:/mods/.bmm"),
        ] }];
        let present: HashSet<PathBuf> = ["M:/mods", "M:/game", "M:/mods/ok", "X:/elsewhere", "M:/mods/newfolder"]
            .iter().map(PathBuf::from).collect();
        let out = find_orphans_in(&profiles, &mods, &listings, &|p: &Path| present.contains(p));
        let kinds: Vec<(&str, &str)> = out.iter().map(|o| (o.kind.as_str(), o.name.as_str())).collect();
        assert!(kinds.contains(&("dangling_active", "ghost")), "{:?}", kinds);
        assert!(kinds.contains(&("missing_profile_dir", "backup")), "{:?}", kinds);
        assert!(kinds.contains(&("missing_folder", "Lost")), "{:?}", kinds);
        assert!(kinds.contains(&("unowned", "Stray")), "{:?}", kinds);
        assert!(kinds.contains(&("unregistered", "newfolder")), "{:?}", kinds);
        assert_eq!(out.len(), 5, "{:?}", kinds);
    }

    #[test]
    fn tools_sort_heaviest_is_stable_by_name() {
        let mut v = vec![
            SizedItem { id: "1".into(), name: "b".into(), path: String::new(), bytes: 5 },
            SizedItem { id: "2".into(), name: "A".into(), path: String::new(), bytes: 5 },
            SizedItem { id: "3".into(), name: "c".into(), path: String::new(), bytes: 9 },
        ];
        sort_heaviest(&mut v);
        assert_eq!(v.iter().map(|x| x.id.as_str()).collect::<Vec<_>>(), vec!["3", "2", "1"]);
    }
}
