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
//! Added in 1.0.3: deployed-files check (active mods' files gone from the game folder, broken
//! or stale links, files missing from the library), large files, mod name / version report,
//! duplicate profiles, cache cleaner (preview, then a confirmed clean of fixed cache folders),
//! BMM log reader, and a catalogue / repo.json diff.
//!
//! Everything here READS, except `tools_cache_clean`. Nothing else deletes, moves or rewrites: a finder that also cleans up is
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

// ═════════════════════════════════════════════════════════════════════════════════════════
// 1.0.3 additions. Same rules as above: every finder READS; the one command that deletes
// (`tools_cache_clean`) only ever touches the fixed cache folders listed in `cache_targets`,
// never a path from an argument, and the hub asks before calling it.
// ═════════════════════════════════════════════════════════════════════════════════════════

// ── Deployed files: what an active mod put in the game folder, still there? ─────────────

/// What a path is on disk, for the deployed-files rules (injected so they test without one).
#[derive(Debug, Clone, Copy, PartialEq)]
pub enum Probe {
    Missing,
    File,
    Dir,
    /// A symbolic link; `target_exists` = it resolves.
    Link { target_exists: bool },
}

pub fn probe_path(p: &Path) -> Probe {
    match std::fs::symlink_metadata(p) {
        Err(_) => Probe::Missing,
        Ok(md) if md.file_type().is_symlink() => Probe::Link { target_exists: p.metadata().is_ok() },
        Ok(md) if md.is_dir() => Probe::Dir,
        Ok(_) => Probe::File,
    }
}

/// One active mod, with the files it deployed (relative to the game folder).
#[derive(Debug, Clone)]
pub struct DeployedMod {
    pub id: String,
    pub name: String,
    pub folder: PathBuf,
    pub archive: bool,
    pub files: Vec<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DeployIssue {
    /// `mod_folder_missing` · `missing_target` · `broken_link` · `missing_source` ·
    /// `unsafe_path` · `no_file_list` · `stale_link`
    pub kind: String,
    pub mod_id: Option<String>,
    pub mod_name: Option<String>,
    pub profile_name: String,
    /// The file concerned (absolute), or the mod folder.
    pub path: String,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct DeployReport {
    pub items: Vec<DeployIssue>,
    pub profiles_checked: usize,
    pub mods_checked: usize,
    pub files_checked: usize,
    pub truncated: bool,
    pub cancelled: bool,
}

pub const DEPLOY_ISSUE_CAP: usize = 5000;

/// The deployed-files rules for one profile's active mods.
pub fn check_deployed_in(mods: &[DeployedMod], game: &Path, profile_name: &str, probe: &dyn Fn(&Path) -> Probe) -> (Vec<DeployIssue>, usize) {
    let mut out = Vec::new();
    let mut checked = 0usize;
    let issue = |kind: &str, m: &DeployedMod, path: String| DeployIssue {
        kind: kind.into(), mod_id: Some(m.id.clone()), mod_name: Some(m.name.clone()), profile_name: profile_name.to_string(), path,
    };
    for m in mods {
        let folder_ok = probe(&m.folder) != Probe::Missing;
        if !folder_ok {
            out.push(issue("mod_folder_missing", m, m.folder.to_string_lossy().to_string()));
        }
        if m.files.is_empty() {
            out.push(issue("no_file_list", m, m.folder.to_string_lossy().to_string()));
            continue;
        }
        for rel in &m.files {
            checked += 1;
            let Some(safe) = crate::fs_utils::safe_relative_path(rel) else {
                out.push(issue("unsafe_path", m, rel.clone()));
                continue;
            };
            let target = game.join(&safe);
            match probe(&target) {
                Probe::Missing => out.push(issue("missing_target", m, target.to_string_lossy().to_string())),
                Probe::Link { target_exists: false } => out.push(issue("broken_link", m, target.to_string_lossy().to_string())),
                _ => {}
            }
            // An archived mod's files live in its archive; a missing folder is reported once.
            if folder_ok && !m.archive && probe(&m.folder.join(&safe)) == Probe::Missing {
                out.push(issue("missing_source", m, m.folder.join(&safe).to_string_lossy().to_string()));
            }
        }
    }
    (out, checked)
}

/// Active mods' deployed files that are gone or point nowhere, mod files missing from the
/// library, and dangling links left next to them. `profile_id` = one profile, else all.
#[tauri::command]
pub async fn tools_check_deployed(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    profile_id: Option<String>,
) -> Result<DeployReport, String> {
    CANCEL.store(false, Ordering::Relaxed);
    // (profile name, game path, active mods with their files)
    let work: Vec<(String, PathBuf, Vec<DeployedMod>)> = {
        let data = state.data.lock().unwrap_or_else(|p| p.into_inner());
        data.profiles.iter()
            .filter(|p| profile_id.as_deref().map(|id| id == p.id).unwrap_or(true))
            .map(|p| {
                let mods = p.active_mods.iter().filter_map(|id| data.mods.iter().find(|m| &m.id == id)).map(|m| DeployedMod {
                    id: m.id.clone(), name: m.name.clone(), folder: m.mod_folder_path.clone(),
                    archive: crate::archive::is_archive(&m.mod_folder_path),
                    files: m.installed_files.clone(),
                }).collect();
                (p.name.clone(), p.game_path.clone(), mods)
            }).collect()
    };
    if profile_id.is_some() && work.is_empty() { return Err("tools.err.noProfile".into()); }
    tauri::async_runtime::spawn_blocking(move || {
        let ticket = crate::governor::runtime::global()
            .begin(crate::governor::config::OpKind::Scan, "tools: deployed files");
        let mut report = DeployReport { profiles_checked: work.len(), ..Default::default() };
        let total = work.len();
        for (i, (pname, game, mods)) in work.iter().enumerate() {
            if cancelled() || ticket.checkpoint().is_err() { report.cancelled = true; break; }
            progress(&app, "deployed", "files", i, total);
            report.mods_checked += mods.len();
            let (mut items, n) = check_deployed_in(mods, game, pname, &|p: &Path| probe_path(p));
            report.files_checked += n;
            // Dangling links in the folders these files live in (a link BMM or a tool made,
            // whose target went away).
            let mut dirs: Vec<PathBuf> = mods.iter().flat_map(|m| m.files.iter())
                .filter_map(|r| crate::fs_utils::safe_relative_path(r))
                .filter_map(|r| game.join(r).parent().map(Path::to_path_buf))
                .collect();
            dirs.sort();
            dirs.dedup();
            let reported: HashSet<String> = items.iter().map(|x| x.path.to_lowercase()).collect();
            for (n, d) in dirs.iter().enumerate() {
                if n % 64 == 0 && (cancelled() || ticket.checkpoint().is_err()) { report.cancelled = true; break; }
                let Ok(rd) = std::fs::read_dir(d) else { continue };
                for e in rd.flatten() {
                    let p = e.path();
                    if probe_path(&p) == (Probe::Link { target_exists: false }) && !reported.contains(&p.to_string_lossy().to_lowercase()) {
                        items.push(DeployIssue { kind: "stale_link".into(), mod_id: None, mod_name: None, profile_name: pname.clone(), path: p.to_string_lossy().to_string() });
                    }
                }
            }
            report.items.extend(items);
            if report.items.len() > DEPLOY_ISSUE_CAP { report.items.truncate(DEPLOY_ISSUE_CAP); report.truncated = true; break; }
        }
        progress(&app, "deployed", "done", total, total);
        report
    }).await.map_err(|e| e.to_string())
}

// ── Large files ─────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LargeFile {
    pub path: String,
    pub bytes: u64,
    /// `mods` · `backups`
    pub area: String,
    pub profile_name: String,
    pub mod_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct LargeFileReport {
    pub files: Vec<LargeFile>,
    pub files_scanned: usize,
    pub bytes_scanned: u64,
    pub min_bytes: u64,
    pub cancelled: bool,
}

/// Keep the `n` largest of what is pushed, without holding everything (a min-heap).
pub struct TopN {
    n: usize,
    heap: std::collections::BinaryHeap<std::cmp::Reverse<(u64, String)>>,
}

impl TopN {
    pub fn new(n: usize) -> Self { TopN { n: n.max(1), heap: std::collections::BinaryHeap::new() } }
    pub fn push(&mut self, size: u64, key: String) {
        if self.heap.len() < self.n { self.heap.push(std::cmp::Reverse((size, key))); return; }
        if let Some(std::cmp::Reverse((min, _))) = self.heap.peek() {
            if size > *min { self.heap.pop(); self.heap.push(std::cmp::Reverse((size, key))); }
        }
    }
    /// Largest first, then by path.
    pub fn into_sorted(self) -> Vec<(u64, String)> {
        let mut v: Vec<(u64, String)> = self.heap.into_iter().map(|std::cmp::Reverse(x)| x).collect();
        v.sort_by(|a, b| b.0.cmp(&a.0).then_with(|| a.1.cmp(&b.1)));
        v
    }
}

/// The largest files in a profile's mods and backups folders (or every profile's).
#[tauri::command]
pub async fn tools_large_files(
    app: tauri::AppHandle,
    state: tauri::State<'_, AppState>,
    profile_id: Option<String>,
    min_mb: Option<u64>,
    limit: Option<usize>,
) -> Result<LargeFileReport, String> {
    CANCEL.store(false, Ordering::Relaxed);
    let (profiles, mods) = snapshot(&state);
    let chosen: Vec<ProfileSnap> = profiles.into_iter().filter(|p| profile_id.as_deref().map(|id| id == p.id).unwrap_or(true)).collect();
    if profile_id.is_some() && chosen.is_empty() { return Err("tools.err.noProfile".into()); }
    let min_bytes = min_mb.unwrap_or(50).min(1_048_576).saturating_mul(1024 * 1024);
    let limit = limit.unwrap_or(50).clamp(1, 500);
    tauri::async_runtime::spawn_blocking(move || {
        let ticket = crate::governor::runtime::global()
            .begin(crate::governor::config::OpKind::Scan, "tools: large files");
        let mut report = LargeFileReport { min_bytes, ..Default::default() };
        let mut top = TopN::new(limit);
        // (root, area, profile name), each folder once even when profiles share it.
        let mut roots: Vec<(PathBuf, &'static str, String)> = Vec::new();
        for p in &chosen {
            for (dir, area) in [(&p.mods_path, "mods"), (&p.backup_path, "backups")] {
                if dir.as_os_str().is_empty() || roots.iter().any(|(d, _, _)| same_path(d, dir)) { continue; }
                roots.push((dir.clone(), area, p.name.clone()));
            }
        }
        let mut meta: HashMap<String, (&'static str, String)> = HashMap::new();
        let total = roots.len();
        'roots: for (ri, (root, area, pname)) in roots.iter().enumerate() {
            progress(&app, "largefiles", "walk", ri, total);
            for (n, e) in walkdir::WalkDir::new(root).follow_links(false).into_iter().flatten().enumerate() {
                if n % 512 == 0 && (cancelled() || ticket.checkpoint().is_err()) { report.cancelled = true; break 'roots; }
                if !e.file_type().is_file() { continue; }
                let size = e.metadata().map(|m| m.len()).unwrap_or(0);
                report.files_scanned += 1;
                report.bytes_scanned += size;
                if size >= min_bytes.max(1) {
                    let key = e.path().to_string_lossy().to_string();
                    meta.insert(key.clone(), (area, pname.clone()));
                    top.push(size, key);
                }
            }
        }
        report.files = top.into_sorted().into_iter().map(|(bytes, path)| {
            let (area, profile_name) = meta.get(&path).cloned().unwrap_or(("mods", String::new()));
            let pb = PathBuf::from(&path);
            let mod_name = mods.iter().find(|m| !m.path.is_empty() && pb.starts_with(&m.path)).map(|m| m.name.clone());
            LargeFile { path, bytes, area: area.to_string(), profile_name, mod_name }
        }).collect();
        progress(&app, "largefiles", "done", total, total);
        report
    }).await.map_err(|e| e.to_string())
}

// ── Mod names and versions ──────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NameIssue {
    /// `trim` · `spaces` · `separators` · `version_in_name` · `version_empty` ·
    /// `version_prefix` · `version_format`
    pub code: String,
    /// The value the rule suggests (a name or a version), or empty when there is none.
    pub suggestion: String,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct NamedMod {
    pub mod_id: String,
    pub name: String,
    pub version: String,
    pub profile_name: Option<String>,
    pub issues: Vec<NameIssue>,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct NamesReport {
    pub mods: Vec<NamedMod>,
    pub mods_checked: usize,
    pub by_code: BTreeMap<String, usize>,
}

/// A trailing version in a name: ` v1.2`, `_1.2.3`, `-V2`, ` (1.0)`. Returns (name without
/// it, the version without its `v`).
pub fn split_trailing_version(name: &str) -> Option<(String, String)> {
    let t = name.trim_end();
    let t2 = t.trim_end_matches(')');
    let paren = t2.len() != t.len();
    let cut = t2.rfind(|c: char| c == ' ' || c == '_' || c == '-' || (paren && c == '('))?;
    let tail = &t2[cut + 1..];
    let ver = tail.strip_prefix(['v', 'V']).unwrap_or(tail);
    let ok = !ver.is_empty()
        && ver.chars().next().is_some_and(|c| c.is_ascii_digit())
        && ver.chars().all(|c| c.is_ascii_digit() || c == '.')
        && (ver.contains('.') || tail.len() != ver.len());
    if !ok { return None; }
    let head = t2[..cut].trim_end_matches([' ', '_', '-', '(']).trim_end();
    if head.is_empty() { return None; }
    Some((head.to_string(), ver.to_string()))
}

/// `1`, `1.2`, `1.2.3`, with an optional `-beta`, `+build` or ` rc1` style suffix.
pub fn version_is_standard(v: &str) -> bool {
    let core: &str = v.split(['-', '+', ' ']).next().unwrap_or("");
    !core.is_empty() && core.split('.').all(|p| !p.is_empty() && p.chars().all(|c| c.is_ascii_digit()))
}

/// The name and version rules for one mod. Suggestions only: nothing is renamed.
pub fn name_issues(name: &str, version: &str) -> Vec<NameIssue> {
    let mut v = Vec::new();
    let mk = |code: &str, s: String| NameIssue { code: code.into(), suggestion: s };
    if name != name.trim() { v.push(mk("trim", name.trim().to_string())); }
    let collapsed = name.split_whitespace().collect::<Vec<_>>().join(" ");
    if name.trim().contains("  ") { v.push(mk("spaces", collapsed.clone())); }
    if collapsed.contains('_') && !collapsed.contains(' ') { v.push(mk("separators", collapsed.replace('_', " "))); }
    let vt = version.trim();
    if let Some((head, ver)) = split_trailing_version(&collapsed) {
        v.push(mk("version_in_name", head));
        if vt.is_empty() { v.push(mk("version_empty", ver)); }
    } else if vt.is_empty() {
        v.push(mk("version_empty", String::new()));
    }
    if let Some(rest) = vt.strip_prefix(['v', 'V']) {
        if rest.chars().next().is_some_and(|c| c.is_ascii_digit()) { v.push(mk("version_prefix", rest.to_string())); }
    } else if !vt.is_empty() && !version_is_standard(vt) {
        v.push(mk("version_format", String::new()));
    }
    v
}

/// Mod names and versions that do not follow one shape, with what each would become.
#[tauri::command(async)]
pub fn tools_names_report(state: tauri::State<AppState>) -> Result<NamesReport, String> {
    let (_, mods) = snapshot(&state);
    let mut r = NamesReport { mods_checked: mods.len(), ..Default::default() };
    for m in &mods {
        let issues = name_issues(&m.name, &m.version);
        if issues.is_empty() { continue; }
        for i in &issues { *r.by_code.entry(i.code.clone()).or_default() += 1; }
        r.mods.push(NamedMod { mod_id: m.id.clone(), name: m.name.clone(), version: m.version.clone(), profile_name: m.profile_name.clone(), issues });
    }
    r.mods.sort_by(|a, b| b.issues.len().cmp(&a.issues.len()).then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase())));
    Ok(r)
}

// ── Duplicate profiles ──────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct ProfilePair {
    pub a_id: String,
    pub a_name: String,
    pub b_id: String,
    pub b_name: String,
    /// Shared active mods ÷ all active mods of the two (1.0 = the same set).
    pub similarity: f64,
    pub shared: usize,
    pub only_a: usize,
    pub only_b: usize,
    pub identical: bool,
    pub same_game_path: bool,
    pub same_mods_path: bool,
}

/// Pairs of profiles worth a look: the same active mods (or nearly: `threshold`), or the same
/// game or mods folder. `sets` = each profile's active mods as match keys.
fn profile_pairs(profiles: &[ProfileSnap], sets: &[HashSet<String>], threshold: f64) -> Vec<ProfilePair> {
    let mut out = Vec::new();
    for i in 0..profiles.len() {
        for j in (i + 1)..profiles.len() {
            let (a, b) = (&profiles[i], &profiles[j]);
            let (sa, sb) = (&sets[i], &sets[j]);
            let shared = sa.intersection(sb).count();
            let union = sa.union(sb).count();
            let similarity = if union == 0 { 0.0 } else { shared as f64 / union as f64 };
            let identical = union > 0 && shared == union;
            let same_game_path = !a.game_path.as_os_str().is_empty() && same_path(&a.game_path, &b.game_path);
            let same_mods_path = !a.mods_path.as_os_str().is_empty() && same_path(&a.mods_path, &b.mods_path);
            if identical || (union > 0 && similarity >= threshold) || same_game_path || same_mods_path {
                out.push(ProfilePair {
                    a_id: a.id.clone(), a_name: a.name.clone(), b_id: b.id.clone(), b_name: b.name.clone(),
                    similarity: (similarity * 1000.0).round() / 1000.0, shared,
                    only_a: sa.len() - shared, only_b: sb.len() - shared,
                    identical, same_game_path, same_mods_path,
                });
            }
        }
    }
    out.sort_by(|x, y| y.similarity.partial_cmp(&x.similarity).unwrap_or(std::cmp::Ordering::Equal).then_with(|| x.a_name.cmp(&y.a_name)));
    out
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct ProfilePairsReport {
    pub pairs: Vec<ProfilePair>,
    pub profiles_checked: usize,
    pub threshold: f64,
}

/// Profiles that duplicate each other: same active mods, or sharing a game or mods folder.
#[tauri::command(async)]
pub fn tools_duplicate_profiles(state: tauri::State<AppState>, threshold: Option<f64>) -> Result<ProfilePairsReport, String> {
    let (profiles, mods) = snapshot(&state);
    let threshold = threshold.unwrap_or(0.8).clamp(0.1, 1.0);
    let by_id: HashMap<&str, &ToolMod> = mods.iter().map(|m| (m.id.as_str(), m)).collect();
    let sets: Vec<HashSet<String>> = profiles.iter().map(|p| p.active_mods.iter()
        .filter_map(|id| by_id.get(id.as_str()))
        .map(|m| match_key(m.content_id.as_deref(), &m.name))
        .filter(|k| k != "name:")
        .collect()).collect();
    Ok(ProfilePairsReport { pairs: profile_pairs(&profiles, &sets, threshold), profiles_checked: profiles.len(), threshold })
}

// ── Cache cleaner ───────────────────────────────────────────────────────────────────────

/// The only places `tools_cache_clean` may delete, each rebuilt by BMM when needed.
/// `(id, folder, name prefix)`: a prefix = the entries of `folder` whose name starts with it.
pub fn cache_targets(app_data: &Path, temp: &Path) -> Vec<(&'static str, PathBuf, Option<&'static [&'static str]>)> {
    vec![
        ("catalog_cache", app_data.join("catalog-cache"), None),
        ("mod_cache", temp.join("bmm_mod_cache"), None),
        ("update_leftovers", temp.to_path_buf(), Some(&["bmm_update_", "bmm_incremental_update", "bmm_catalog_build"][..])),
        ("crash_archive", app_data.join("Crashes").join("Archive"), None),
    ]
}

/// The entries a target covers: the folder's children, or the matching entries of it.
pub fn cache_entries(folder: &Path, prefixes: Option<&[&str]>) -> Vec<PathBuf> {
    let Ok(rd) = std::fs::read_dir(folder) else { return Vec::new() };
    rd.flatten().map(|e| e.path()).filter(|p| match prefixes {
        None => true,
        Some(ps) => p.file_name().map(|n| n.to_string_lossy().to_string()).is_some_and(|n| ps.iter().any(|x| n.starts_with(x))),
    }).collect()
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct CacheItem {
    pub id: String,
    pub path: String,
    pub bytes: u64,
    pub entries: usize,
    /// Cleaning it now would race a running mod operation.
    pub busy: bool,
}

#[derive(Debug, Clone, Serialize, Default)]
pub struct CacheReport {
    pub items: Vec<CacheItem>,
    pub total_bytes: u64,
    /// For a clean: what was freed and what could not be removed.
    pub freed_bytes: u64,
    pub errors: Vec<String>,
}

fn mod_ops_running() -> bool {
    use crate::governor::config::OpKind;
    crate::governor::runtime::global().queue().snapshot().iter()
        .any(|t| matches!(t.kind, OpKind::Deploy | OpKind::Extract | OpKind::Install))
}

fn app_data_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

fn measure(paths: &[PathBuf], ticket: &crate::governor::queue::Ticket) -> u64 {
    paths.iter().map(|p| path_size(p, ticket)).sum()
}

/// What each cache folder holds. Nothing is removed.
#[tauri::command]
pub async fn tools_cache_preview(app: tauri::AppHandle) -> Result<CacheReport, String> {
    CANCEL.store(false, Ordering::Relaxed);
    let app_data = app_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let ticket = crate::governor::runtime::global()
            .begin(crate::governor::config::OpKind::Scan, "tools: cache preview");
        let busy = mod_ops_running();
        let mut r = CacheReport::default();
        for (id, folder, prefixes) in cache_targets(&app_data, &std::env::temp_dir()) {
            let entries = cache_entries(&folder, prefixes);
            let bytes = measure(&entries, &ticket);
            r.total_bytes += bytes;
            r.items.push(CacheItem { id: id.to_string(), path: folder.to_string_lossy().to_string(), bytes, entries: entries.len(), busy: busy && id == "mod_cache" });
        }
        r
    }).await.map_err(|e| e.to_string())
}

/// Empty the chosen cache folders. `ids` must name targets of `cache_targets`; `confirmed`
/// must be true (the hub sets it only after the person said yes to the sizes it showed).
#[tauri::command]
pub async fn tools_cache_clean(app: tauri::AppHandle, ids: Vec<String>, confirmed: bool) -> Result<CacheReport, String> {
    if !confirmed { return Err("tools.cache.notConfirmed".into()); }
    let app_data = app_data_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || {
        let ticket = crate::governor::runtime::global()
            .begin(crate::governor::config::OpKind::Maintenance, "tools: cache clean");
        let mut r = CacheReport::default();
        for (id, folder, prefixes) in cache_targets(&app_data, &std::env::temp_dir()) {
            if !ids.iter().any(|x| x == id) { continue; }
            if id == "mod_cache" && mod_ops_running() { r.errors.push(format!("{}: tools.cache.busy", id)); continue; }
            for p in cache_entries(&folder, prefixes) {
                if ticket.checkpoint().is_err() { r.errors.push("cancelled".into()); return r; }
                let bytes = path_size(&p, &ticket);
                // symlink_metadata: a link is removed as a link, never followed into.
                let res = match std::fs::symlink_metadata(&p) {
                    Ok(md) if md.is_dir() => std::fs::remove_dir_all(&p),
                    Ok(_) => std::fs::remove_file(&p),
                    Err(e) => Err(e),
                };
                match res {
                    Ok(()) => r.freed_bytes += bytes,
                    Err(e) => r.errors.push(format!("{}: {}", p.to_string_lossy(), e)),
                }
            }
        }
        log_cache_clean(&ids, r.freed_bytes, r.errors.len());
        r
    }).await.map_err(|e| e.to_string())
}

fn log_cache_clean(ids: &[String], freed: u64, errors: usize) {
    crate::commands::crash::log_line(format!("[TOOLS] cache clean {:?}: {} bytes freed, {} error(s)", ids, freed, errors));
}

// ── Logs ────────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct LogEntry {
    /// `current`, or `<Reports|Archive>/<Crash|Session>/<file>.zip`.
    pub id: String,
    /// `current` · `session` · `crash`
    pub kind: String,
    pub archived: bool,
    pub bytes: u64,
    /// Seconds since the epoch.
    pub modified: u64,
}

const LOG_DIRS: [&str; 4] = ["Reports/Crash", "Reports/Session", "Archive/Crash", "Archive/Session"];

/// A log id → its zip under the crash folder, or None for anything else (no `..`, no other
/// folder, only a plain `.zip` name).
pub fn log_zip_path(crash_dir: &Path, id: &str) -> Option<PathBuf> {
    let (dir, file) = id.rsplit_once('/')?;
    if !LOG_DIRS.contains(&dir) { return None; }
    let ok = file.ends_with(".zip") && file.len() > 4
        && file.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
        && !file.starts_with('.');
    if !ok { return None; }
    let mut p = crash_dir.to_path_buf();
    for seg in dir.split('/') { p.push(seg); }
    Some(p.join(file))
}

/// BMM's logs: this session, then the saved session and crash reports, newest first.
#[tauri::command(async)]
pub fn tools_log_list(app: tauri::AppHandle) -> Result<Vec<LogEntry>, String> {
    let crash = crate::commands::crash::get_crash_dir(Some(&app));
    let mut out = vec![LogEntry { id: "current".into(), kind: "current".into(), archived: false, bytes: 0, modified: SystemTimeNow::secs() }];
    for dir in LOG_DIRS {
        let Ok(rd) = std::fs::read_dir(crash.join(dir)) else { continue };
        for e in rd.flatten() {
            let name = e.file_name().to_string_lossy().to_string();
            let id = format!("{}/{}", dir, name);
            if log_zip_path(&crash, &id).is_none() { continue; }
            let md = e.metadata().ok();
            out.push(LogEntry {
                id, kind: if dir.ends_with("Crash") { "crash".into() } else { "session".into() },
                archived: dir.starts_with("Archive"),
                bytes: md.as_ref().map(|m| m.len()).unwrap_or(0),
                modified: md.and_then(|m| m.modified().ok()).and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok()).map(|d| d.as_secs()).unwrap_or(0),
            });
        }
    }
    out[1..].sort_by(|a, b| b.modified.cmp(&a.modified));
    out.truncate(400);
    Ok(out)
}

struct SystemTimeNow;
impl SystemTimeNow {
    fn secs() -> u64 { std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0) }
}

const LOG_READ_CAP: u64 = 8 * 1024 * 1024;

/// The text of one log (the app log inside a report zip), capped at 8 MB.
#[tauri::command(async)]
pub fn tools_log_read(app: tauri::AppHandle, id: String) -> Result<String, String> {
    if id == "current" {
        return Ok(crate::commands::crash::read_session_log_tail(Some(LOG_READ_CAP as usize)));
    }
    let crash = crate::commands::crash::get_crash_dir(Some(&app));
    let path = log_zip_path(&crash, &id).ok_or("tools.logs.badId")?;
    let file = std::fs::File::open(&path).map_err(|e| e.to_string())?;
    let mut zip = zip::ZipArchive::new(file).map_err(|e| e.to_string())?;
    let mut entry = zip.by_name("app_logs.txt").map_err(|_| "tools.logs.noAppLog".to_string())?;
    use std::io::Read;
    let mut buf = Vec::new();
    (&mut entry).take(LOG_READ_CAP).read_to_end(&mut buf).map_err(|e| e.to_string())?;
    Ok(String::from_utf8_lossy(&buf).to_string())
}

// ── Catalogue / repo.json diff ──────────────────────────────────────────────────────────

const LIST_KEYS: [&str; 11] = ["apps", "items", "mods", "plugins", "themes", "presets", "entries", "catalogs", "modpacks", "lists", "tutorials"];

/// The entries of a catalogue-like document: the first known list key (or the document
/// itself when it is an array), each keyed by `id`, else `name` / `title` / `url`.
pub fn doc_entries(v: &serde_json::Value) -> (String, Vec<(String, serde_json::Value)>) {
    let (key, list) = match v {
        serde_json::Value::Array(a) => ("(root)".to_string(), a.clone()),
        serde_json::Value::Object(o) => match LIST_KEYS.iter().find(|k| o.get(**k).is_some_and(|x| x.is_array())) {
            Some(k) => (k.to_string(), o[*k].as_array().cloned().unwrap_or_default()),
            None => (String::new(), Vec::new()),
        },
        _ => (String::new(), Vec::new()),
    };
    let entries = list.into_iter().enumerate().map(|(i, e)| {
        let k = ["id", "repo_mod_id", "name", "title", "url"].iter()
            .find_map(|f| e.get(*f).and_then(|x| match x { serde_json::Value::String(s) if !s.trim().is_empty() => Some(s.trim().to_string()), serde_json::Value::Number(n) => Some(n.to_string()), _ => None }))
            .unwrap_or_else(|| format!("#{}", i));
        (k, e)
    }).collect();
    (key, entries)
}

fn entry_name(v: &serde_json::Value) -> String {
    ["name", "title", "id"].iter().find_map(|f| v.get(*f).and_then(|x| x.as_str()).map(str::to_string)).unwrap_or_default()
}

#[derive(Debug, Clone, Serialize, PartialEq)]
pub struct DiffEntry {
    pub key: String,
    pub name: String,
    /// For a changed entry: its top-level fields that differ.
    pub fields: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Default, PartialEq)]
pub struct JsonDiff {
    pub a_path: String,
    pub b_path: String,
    pub a_list: String,
    pub b_list: String,
    pub a_count: usize,
    pub b_count: usize,
    pub added: Vec<DiffEntry>,
    pub removed: Vec<DiffEntry>,
    pub changed: Vec<DiffEntry>,
    pub same: usize,
    /// Top-level fields outside the list that differ (name, version, signatures…).
    pub meta_changed: Vec<String>,
}

pub fn diff_docs(a: &serde_json::Value, b: &serde_json::Value) -> JsonDiff {
    let (la, ea) = doc_entries(a);
    let (lb, eb) = doc_entries(b);
    let mut d = JsonDiff { a_list: la.clone(), b_list: lb.clone(), a_count: ea.len(), b_count: eb.len(), ..Default::default() };
    let ma: BTreeMap<String, serde_json::Value> = ea.into_iter().collect();
    let mb: BTreeMap<String, serde_json::Value> = eb.into_iter().collect();
    for (k, va) in &ma {
        match mb.get(k) {
            None => d.removed.push(DiffEntry { key: k.clone(), name: entry_name(va), fields: vec![] }),
            Some(vb) if vb == va => d.same += 1,
            Some(vb) => {
                let mut fields: Vec<String> = Vec::new();
                let keys: std::collections::BTreeSet<String> = va.as_object().map(|o| o.keys().cloned().collect::<Vec<String>>()).unwrap_or_default().into_iter()
                    .chain(vb.as_object().map(|o| o.keys().cloned().collect::<Vec<_>>()).unwrap_or_default()).collect();
                for f in keys { if va.get(&f) != vb.get(&f) { fields.push(f); } }
                if fields.is_empty() { fields.push("(value)".into()); }
                d.changed.push(DiffEntry { key: k.clone(), name: entry_name(vb), fields });
            }
        }
    }
    for (k, vb) in &mb {
        if !ma.contains_key(k) { d.added.push(DiffEntry { key: k.clone(), name: entry_name(vb), fields: vec![] }); }
    }
    if let (Some(oa), Some(ob)) = (a.as_object(), b.as_object()) {
        let keys: std::collections::BTreeSet<&String> = oa.keys().chain(ob.keys()).collect();
        for k in keys {
            if *k == la || *k == lb { continue; }
            if oa.get(k) != ob.get(k) { d.meta_changed.push(k.clone()); }
        }
    }
    d
}

const DIFF_FILE_CAP: u64 = 32 * 1024 * 1024;

fn read_json_file(path: &str) -> Result<serde_json::Value, String> {
    let md = std::fs::metadata(path).map_err(|e| e.to_string())?;
    if !md.is_file() { return Err("tools.jsondiff.notFile".into()); }
    if md.len() > DIFF_FILE_CAP { return Err("tools.jsondiff.tooLarge".into()); }
    let text = std::fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str(text.trim_start_matches('\u{feff}')).map_err(|_| "tools.jsondiff.notJson".to_string())
}

/// Compare two catalogue / repo.json files the person picked. Reads them; writes nothing.
#[tauri::command(async)]
pub fn tools_json_diff(path_a: String, path_b: String) -> Result<JsonDiff, String> {
    let a = read_json_file(&path_a)?;
    let b = read_json_file(&path_b)?;
    let mut d = diff_docs(&a, &b);
    d.a_path = path_a;
    d.b_path = path_b;
    Ok(d)
}

#[cfg(test)]
mod tests_more {
    use super::*;
    use serde_json::json;

    fn dm(id: &str, folder: &str, archive: bool, files: &[&str]) -> DeployedMod {
        DeployedMod { id: id.into(), name: id.to_uppercase(), folder: PathBuf::from(folder), archive, files: files.iter().map(|s| s.to_string()).collect() }
    }

    #[test]
    fn tools_deployed_rules() {
        let present: HashMap<PathBuf, Probe> = [
            ("G/a.lua", Probe::File), ("G/link.dds", Probe::Link { target_exists: false }),
            ("M/a", Probe::Dir), ("M/a/a.lua", Probe::File), ("M/a/link.dds", Probe::File),
            ("M/z.zip", Probe::File),
        ].iter().map(|(p, k)| (PathBuf::from(p), *k)).collect();
        let probe = |p: &Path| *present.get(&PathBuf::from(p.to_string_lossy().replace('\\', "/"))).unwrap_or(&Probe::Missing);
        let mods = vec![
            dm("a", "M/a", false, &["a.lua", "link.dds", "gone.lua", "../evil"]),
            dm("z", "M/z.zip", true, &["inside.lua"]),
            dm("lost", "M/lost", false, &[]),
        ];
        let (items, checked) = check_deployed_in(&mods, Path::new("G"), "Main", &probe);
        let kinds: Vec<(&str, &str)> = items.iter().map(|i| (i.kind.as_str(), i.mod_id.as_deref().unwrap_or(""))).collect();
        assert!(kinds.contains(&("broken_link", "a")), "{:?}", kinds);
        assert!(kinds.contains(&("missing_target", "a")), "{:?}", kinds);
        assert!(kinds.contains(&("missing_source", "a")), "{:?}", kinds);
        assert!(kinds.contains(&("unsafe_path", "a")), "{:?}", kinds);
        // An archived mod's files are not looked for next to the archive.
        assert!(kinds.contains(&("missing_target", "z")) && !kinds.contains(&("missing_source", "z")), "{:?}", kinds);
        assert!(kinds.contains(&("mod_folder_missing", "lost")) && kinds.contains(&("no_file_list", "lost")), "{:?}", kinds);
        assert_eq!(checked, 5);
        assert_eq!(items.iter().filter(|i| i.kind == "missing_source").count(), 1, "{:?}", kinds);
    }

    #[test]
    fn tools_top_n_keeps_the_largest() {
        let mut t = TopN::new(3);
        for (s, k) in [(5, "e"), (1, "a"), (9, "i"), (7, "g"), (9, "h"), (2, "b")] { t.push(s, k.into()); }
        assert_eq!(t.into_sorted(), vec![(9, "h".into()), (9, "i".into()), (7, "g".into())]);
    }

    #[test]
    fn tools_trailing_version_is_found() {
        assert_eq!(split_trailing_version("Better Trees v1.2"), Some(("Better Trees".into(), "1.2".into())));
        assert_eq!(split_trailing_version("F-16 Cockpit_2.0.1"), Some(("F-16 Cockpit".into(), "2.0.1".into())));
        assert_eq!(split_trailing_version("Mod (1.0)"), Some(("Mod".into(), "1.0".into())));
        assert_eq!(split_trailing_version("Pack V2"), Some(("Pack".into(), "2".into())));
        assert_eq!(split_trailing_version("F-16"), None);
        assert_eq!(split_trailing_version("Mirage 2000"), None);
        assert_eq!(split_trailing_version("v1.2"), None);
    }

    #[test]
    fn tools_name_rules() {
        let codes = |n: &str, v: &str| name_issues(n, v).into_iter().map(|i| i.code).collect::<Vec<_>>();
        assert!(codes("Clean Mod", "1.0.2").is_empty());
        assert!(codes("Clean Mod", "2.0-beta").is_empty());
        assert_eq!(codes(" Padded  Name ", "1"), vec!["trim", "spaces"]);
        assert_eq!(codes("under_score_name", "1"), vec!["separators"]);
        let i = name_issues("Trees v1.4", "");
        assert_eq!(i.iter().map(|x| x.code.as_str()).collect::<Vec<_>>(), vec!["version_in_name", "version_empty"]);
        assert_eq!(i[1].suggestion, "1.4");
        assert_eq!(name_issues("X", "v2.1")[0], NameIssue { code: "version_prefix".into(), suggestion: "2.1".into() });
        assert_eq!(codes("X", "latest"), vec!["version_format"]);
        assert!(version_is_standard("1.2.3+build5") && !version_is_standard("1..2"));
    }

    #[test]
    fn tools_profile_pairs() {
        let p = |id: &str, game: &str, mods: &str| ProfileSnap {
            id: id.into(), name: id.to_uppercase(), mods_path: PathBuf::from(mods), game_path: PathBuf::from(game),
            backup_path: PathBuf::new(), active_mods: vec![],
        };
        let set = |v: &[&str]| v.iter().map(|s| s.to_string()).collect::<HashSet<String>>();
        let profiles = vec![p("a", "G1", "M1"), p("b", "G2", "M2"), p("c", "G1", "M3"), p("d", "G4", "M4")];
        let sets = vec![set(&["x", "y", "z"]), set(&["x", "y", "z"]), set(&["q"]), set(&["x", "y", "z", "w", "v"])];
        let pairs = profile_pairs(&profiles, &sets, 0.8);
        let ids: Vec<(String, String)> = pairs.iter().map(|x| (x.a_id.clone(), x.b_id.clone())).collect();
        assert_eq!(pairs[0].a_id, "a");
        assert!(pairs[0].identical && pairs[0].similarity == 1.0);
        assert!(ids.contains(&("a".into(), "c".into())), "same game folder: {:?}", ids);
        assert!(!ids.contains(&("a".into(), "d".into())), "0.6 is under the threshold: {:?}", ids);
        // Two empty profiles on different folders are not "the same".
        let none = profile_pairs(&[p("e", "", ""), p("f", "", "")], &[set(&[]), set(&[])], 0.8);
        assert!(none.is_empty());
    }

    #[test]
    fn tools_cache_targets_are_fixed_and_prefixed() {
        let dir = std::env::temp_dir().join(format!("bmm-tools-cache-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(dir.join("bmm_update_1")).unwrap();
        std::fs::write(dir.join("bmm_catalog_build"), b"x").unwrap();
        std::fs::write(dir.join("unrelated.txt"), b"keep").unwrap();
        let t = cache_targets(Path::new("A"), &dir);
        assert_eq!(t.iter().map(|x| x.0).collect::<Vec<_>>(), vec!["catalog_cache", "mod_cache", "update_leftovers", "crash_archive"]);
        let left = t.iter().find(|x| x.0 == "update_leftovers").unwrap();
        let mut names: Vec<String> = cache_entries(&left.1, left.2).iter().map(|p| p.file_name().unwrap().to_string_lossy().to_string()).collect();
        names.sort();
        assert_eq!(names, vec!["bmm_catalog_build", "bmm_update_1"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn tools_log_ids_stay_in_the_crash_folder() {
        let c = Path::new("C");
        assert_eq!(log_zip_path(c, "Reports/Crash/crash_2026-10-13_23-38-11.zip"), Some(PathBuf::from("C").join("Reports").join("Crash").join("crash_2026-10-13_23-38-11.zip")));
        for bad in ["../x.zip", "Reports/Crash/../../x.zip", "Other/x.zip", "Reports/Crash/x.txt", "Reports/Crash/.zip", "Reports/Crash/a b.zip", "x.zip"] {
            assert_eq!(log_zip_path(c, bad), None, "{}", bad);
        }
    }

    #[test]
    fn tools_json_diff_by_id() {
        let a = json!({ "name": "Cat", "version": "1", "apps": [ { "id": "a", "version": "1" }, { "id": "b", "title": "B" }, { "id": "c" } ] });
        let b = json!({ "name": "Cat", "version": "2", "apps": [ { "id": "a", "version": "2" }, { "id": "c" }, { "id": "d", "name": "D" } ] });
        let d = diff_docs(&a, &b);
        assert_eq!(d.a_list, "apps");
        assert_eq!(d.added.iter().map(|x| x.key.as_str()).collect::<Vec<_>>(), vec!["d"]);
        assert_eq!(d.added[0].name, "D");
        assert_eq!(d.removed.iter().map(|x| x.key.as_str()).collect::<Vec<_>>(), vec!["b"]);
        assert_eq!(d.changed.len(), 1);
        assert_eq!(d.changed[0].fields, vec!["version".to_string()]);
        assert_eq!(d.same, 1);
        assert_eq!(d.meta_changed, vec!["version".to_string()]);
        // A repo.json keyed by name, and a bare array.
        let r = diff_docs(&json!({ "mods": [ { "name": "X" } ] }), &json!([ { "name": "X" }, { "url": "u" } ]));
        assert_eq!(r.b_list, "(root)");
        assert_eq!(r.added[0].key, "u");
        assert_eq!(r.same, 1);
    }
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
