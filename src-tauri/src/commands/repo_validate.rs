//! « Check this repo » — the Server Repo page's Validate tool, in ONE Rust pass.
//!
//! The page used to ask four commands in a row (format, read, signature, then a conversion
//! dry run that re-hashed every file one after the other on one thread) and showed nothing
//! while it waited: on a large repo that was minutes of a disabled button. Now:
//!
//!  - one command reads the manifest once and answers everything the report shows;
//!  - the files are hashed on the resource governor's Hash pool (parallel, steps aside for a
//!    deploy, one thread in game mode) behind one ticket, so the dashboard shows it and its
//!    Cancel stops it at the next file;
//!  - a file whose size and modification time have not changed since it was last hashed in
//!    this session is not read again (the cache below; `deep` ignores it);
//!  - progress goes out as `bmm://repo-validate-progress` (files done / total, bytes, the
//!    current file, the ticket id the page's Cancel button sends to `resources_queue`).
//!
//! The checks themselves are the conversion's: the report is `repo_format::convert` run as a
//! dry run, so Validate and Convert can never disagree about a file.

use crate::commands::repo_format::{self, Change, FormatInfo, FormatStatus, Hashed};
use crate::governor::config::OpKind;
use crate::governor::queue::Ticket;
use crate::models::repo::ServerRepo;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant, UNIX_EPOCH};
use tauri::Emitter;

pub const PROGRESS_EVENT: &str = "bmm://repo-validate-progress";

/// Where progress goes: the page, tagged with the run it asked for.
#[derive(Clone)]
pub struct Progress {
    pub handle: tauri::AppHandle,
    pub run_id: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ProgressEvent<'a> {
    run_id: &'a str,
    ticket: u64,
    phase: &'a str,
    done: usize,
    total: usize,
    bytes_done: u64,
    bytes_total: u64,
    current: String,
}

// ── Runs: the page's token → the governor ticket, for its Cancel ────────────────────────────

fn runs() -> &'static Mutex<HashMap<String, u64>> {
    static R: OnceLock<Mutex<HashMap<String, u64>>> = OnceLock::new();
    R.get_or_init(Default::default)
}

/// Holds a run's ticket id under its token while the run lasts.
pub(crate) struct RunGuard(String);

impl RunGuard {
    pub(crate) fn new(run_id: &str, ticket: u64) -> Option<Self> {
        if run_id.is_empty() { return None; }
        runs().lock().unwrap_or_else(|e| e.into_inner()).insert(run_id.to_string(), ticket);
        Some(Self(run_id.to_string()))
    }
}

impl Drop for RunGuard {
    fn drop(&mut self) {
        runs().lock().unwrap_or_else(|e| e.into_inner()).remove(&self.0);
    }
}

/// Stop a running check or conversion by the token the page gave it: its ticket is cancelled
/// and the hashing stops at the next file. False when that run is not (or no longer) running.
#[tauri::command]
pub fn repo_validate_cancel(run_id: String) -> bool {
    let id = runs().lock().unwrap_or_else(|e| e.into_inner()).get(&run_id).copied();
    id.is_some_and(|id| crate::governor::runtime::global().queue().cancel(id))
}

// ── Hash cache ──────────────────────────────────────────────────────────────────────────────

/// (size, mtime in ns) → what hashing gave. Session-only: a file is read again after a
/// restart, and whenever its size or mtime moved.
type CacheEntry = (u64, u128, Hashed);
const CACHE_MAX: usize = 200_000;

fn cache() -> &'static Mutex<HashMap<PathBuf, CacheEntry>> {
    static C: OnceLock<Mutex<HashMap<PathBuf, CacheEntry>>> = OnceLock::new();
    C.get_or_init(Default::default)
}

fn stamp(p: &Path) -> Option<(u64, u128)> {
    let m = std::fs::metadata(p).ok()?;
    if !m.is_file() { return None; }
    let mt = m.modified().ok()?.duration_since(UNIX_EPOCH).ok()?.as_nanos();
    Some((m.len(), mt))
}

/// Hash one file, through the cache unless `deep`. Returns whether it was a cache hit.
pub(crate) fn hash_cached(p: &Path, deep: bool) -> (std::io::Result<Hashed>, bool) {
    let st = stamp(p);
    if !deep {
        if let Some((size, mt)) = st {
            let hit = cache().lock().unwrap_or_else(|e| e.into_inner()).get(p).filter(|e| e.0 == size && e.1 == mt).map(|e| e.2.clone());
            if let Some(h) = hit { return (Ok(h), true); }
        }
    }
    let r = repo_format::hash_file(p);
    if let (Ok(h), Some((size, mt))) = (&r, st) {
        // Only when the file did not move while it was read: a stamp taken before and still
        // true after is the stamp of the bytes hashed.
        if stamp(p) == Some((size, mt)) && h.0 == size {
            let mut c = cache().lock().unwrap_or_else(|e| e.into_inner());
            if c.len() >= CACHE_MAX { c.clear(); }
            c.insert(p.to_path_buf(), (size, mt, h.clone()));
        }
    }
    (r, false)
}

/// The hasher the app hands `repo_format`: every file on the Hash pool, each one behind the
/// ticket's checkpoint (pause / cancel / step aside), bytes counted on the ticket, progress
/// sent at most every 120 ms. `Err("repo.cancelled")` when the ticket is cancelled.
pub fn governed_hasher<'t>(
    ticket: &'t Ticket,
    progress: Option<Progress>,
    deep: bool,
) -> impl Fn(&[PathBuf]) -> Result<Vec<std::io::Result<Hashed>>, String> + 't {
    let hits = std::sync::Arc::new(AtomicUsize::new(0));
    governed_hasher_counting(ticket, progress, deep, hits)
}

fn governed_hasher_counting<'t>(
    ticket: &'t Ticket,
    progress: Option<Progress>,
    deep: bool,
    hits: std::sync::Arc<AtomicUsize>,
) -> impl Fn(&[PathBuf]) -> Result<Vec<std::io::Result<Hashed>>, String> + 't {
    move |paths: &[PathBuf]| {
        let total = paths.len();
        let bytes_total: u64 = paths.iter().filter_map(|p| stamp(p)).map(|s| s.0).sum();
        let done = AtomicUsize::new(0);
        let bytes = AtomicU64::new(0);
        let last = Mutex::new(Instant::now() - Duration::from_secs(1));
        let send = |phase: &str, current: String, force: bool| {
            let Some(pr) = &progress else { return };
            {
                let mut l = last.lock().unwrap_or_else(|e| e.into_inner());
                if !force && l.elapsed() < Duration::from_millis(120) { return; }
                *l = Instant::now();
            }
            let _ = pr.handle.emit(PROGRESS_EVENT, ProgressEvent {
                run_id: &pr.run_id,
                ticket: ticket.id(),
                phase,
                done: done.load(Ordering::Relaxed),
                total,
                bytes_done: bytes.load(Ordering::Relaxed),
                bytes_total,
                current,
            });
        };
        send("hash", String::new(), true);
        let gov = crate::governor::runtime::global();
        let out = gov.pool(OpKind::Hash).install(|| {
            use rayon::prelude::*;
            paths.par_iter()
                .map(|p| {
                    ticket.checkpoint().map_err(|_| "repo.cancelled".to_string())?;
                    let (r, hit) = hash_cached(p, deep);
                    if hit { hits.fetch_add(1, Ordering::Relaxed); }
                    if let Ok(h) = &r {
                        if !hit { ticket.add_bytes(h.0, 0); }
                        bytes.fetch_add(h.0, Ordering::Relaxed);
                    }
                    done.fetch_add(1, Ordering::Relaxed);
                    let name = p.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
                    send("hash", name, false);
                    Ok(r)
                })
                .collect::<Result<Vec<_>, String>>()
        });
        send("hashed", String::new(), true);
        out
    }
}

// ── The report ──────────────────────────────────────────────────────────────────────────────

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateArgs {
    /// The repo folder, or its `repo.json`.
    pub path: String,
    /// The page's token, echoed in the progress events.
    #[serde(default)]
    pub run_id: Option<String>,
    /// Re-read every file even when its size and date say it has not changed.
    #[serde(default)]
    pub deep: bool,
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidateReport {
    pub manifest_path: String,
    pub format: Option<FormatInfo>,
    pub current: String,
    /// BMM can open it: the strict reader, or the legacy upgrade the sync uses.
    pub readable: bool,
    pub read_error: Option<String>,
    pub name: String,
    pub version: String,
    pub author: String,
    pub profiles: usize,
    pub mods: usize,
    pub files: usize,
    pub bytes: u64,
    pub empty_profiles: Vec<String>,
    /// The same mod id twice in one profile: the sync keeps one and the other never updates.
    pub duplicate_ids: Vec<String>,
    /// `valid` · `invalid` · `unsigned` · `legacy` (an old shape: verified once converted).
    pub signature: String,
    pub author_id: Option<String>,
    pub files_base_url: Option<String>,
    /// The files were hashed (not hosted elsewhere, not a format this BMM cannot convert).
    pub files_checked: bool,
    pub files_missing: usize,
    pub hashes_changed: usize,
    pub hashes_filled: usize,
    pub sizes_changed: usize,
    /// The file-level findings, first ones only (missing, changed, size).
    pub problems: Vec<Change>,
    pub cache_hits: usize,
    pub elapsed_ms: u64,
    pub warnings: Vec<String>,
}

const PROBLEMS_SHOWN: usize = 100;

fn str_of(v: &serde_json::Value, k: &str) -> String {
    v.get(k).and_then(serde_json::Value::as_str).unwrap_or("").to_string()
}

/// Counts, empty profiles and duplicate ids, from the manifest as JSON (it may be a legacy
/// shape the struct cannot read).
fn tally(v: &serde_json::Value, r: &mut ValidateReport) {
    let profiles = v.get("profiles").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
    r.profiles = profiles.len();
    for p in &profiles {
        let mods = p.get("mods").and_then(serde_json::Value::as_array).cloned().unwrap_or_default();
        if mods.is_empty() { r.empty_profiles.push(str_of(p, "name")); }
        let mut seen = HashSet::new();
        for m in &mods {
            r.mods += 1;
            let id = str_of(m, "id");
            if !id.is_empty() && !seen.insert(id.to_lowercase()) && !r.duplicate_ids.contains(&id) {
                r.duplicate_ids.push(id);
            }
            for f in m.get("files").and_then(serde_json::Value::as_array).into_iter().flatten() {
                r.files += 1;
                r.bytes += f.get("size").and_then(serde_json::Value::as_u64).unwrap_or(0);
            }
        }
    }
}

/// The whole check, with the hasher injected (tests pass the sequential one).
pub fn validate_with(args: &ValidateArgs, hash_all: repo_format::HashAll<'_>) -> Result<ValidateReport, String> {
    let started = Instant::now();
    let file = crate::commands::repo_convert::manifest_path(&args.path)?;
    let mut r = ValidateReport { manifest_path: file.to_string_lossy().to_string(), current: repo_format::CURRENT.into(), ..Default::default() };
    let text = std::fs::read_to_string(&file).map_err(|_| "repo.convert.errRead".to_string())?;
    let body = text.trim_start_matches('\u{feff}');
    let original: serde_json::Value = serde_json::from_str(body).map_err(|_| "repo.convert.errNotJson".to_string())?;
    let info = repo_format::detect(&original);
    r.format = Some(info.clone());

    r.name = str_of(&original, "name");
    r.version = str_of(&original, "version");
    r.author = str_of(&original, "author");
    r.files_base_url = Some(str_of(&original, "files_base_url")).filter(|s| !s.trim().is_empty());
    tally(&original, &mut r);

    // Readable, and the signature subscribers will check.
    match serde_json::from_value::<ServerRepo>(original.clone()) {
        Ok(repo) => {
            r.readable = true;
            r.author_id = repo.author_id.clone();
            r.signature = if repo.signature.is_none() && repo.author_id.is_none() {
                "unsigned"
            } else if crate::commands::security::verify_repo_signature(repo) {
                "valid"
            } else {
                "invalid"
            }.into();
        }
        Err(e) => {
            r.readable = crate::commands::repo_convert::read_legacy(body).is_some();
            if !r.readable { r.read_error = Some(e.to_string()); }
            r.signature = if original.get("signature").is_some_and(|s| !s.is_null()) { "legacy" } else { "unsigned" }.into();
        }
    }

    // Files and hashes: the conversion's dry run, on the injected hasher.
    let convertible = !matches!(info.status, FormatStatus::TooNew | FormatStatus::NewerMinor | FormatStatus::Invalid);
    if convertible && r.files_base_url.is_none() {
        let dir = file.parent().map(Path::to_path_buf);
        let plan = repo_format::convert_with_hasher(original, dir.as_deref(), hash_all)?;
        r.files_checked = true;
        r.files_missing = plan.counts.files_missing;
        r.hashes_changed = plan.counts.hashes_changed;
        r.hashes_filled = plan.counts.hashes_filled;
        r.sizes_changed = plan.changes.iter().filter(|c| c.kind == "size_changed").count();
        let order = ["file_missing", "hash_changed", "size_changed"];
        let mut probs: Vec<Change> = plan.changes.into_iter().filter(|c| order.contains(&c.kind)).collect();
        probs.sort_by_key(|c| order.iter().position(|k| *k == c.kind));
        probs.truncate(PROBLEMS_SHOWN);
        r.problems = probs;
        r.warnings = plan.warnings.into_iter().filter(|w| !w.contains("listed in the manifest are not in the folder")).collect();
    }
    r.elapsed_ms = started.elapsed().as_millis() as u64;
    Ok(r)
}

/// The app's Validate: one Hash ticket, the governed hasher, progress to the page.
pub fn validate(handle: &tauri::AppHandle, args: &ValidateArgs) -> Result<ValidateReport, String> {
    let gov = crate::governor::runtime::global();
    let ticket = gov.begin(OpKind::Hash, &format!("repo check {}", args.path));
    let _run = RunGuard::new(args.run_id.as_deref().unwrap_or(""), ticket.id());
    let progress = Some(Progress { handle: handle.clone(), run_id: args.run_id.clone().unwrap_or_default() });
    let hits = std::sync::Arc::new(AtomicUsize::new(0));
    let hasher = governed_hasher_counting(&ticket, progress, args.deep, hits.clone());
    let mut r = validate_with(args, &hasher)?;
    r.cache_hits = hits.load(Ordering::Relaxed);
    Ok(r)
}

/// Validate a repo folder: format, readability, signature, every file against its hash.
/// Hashing is long on a big repo: off the async runtime, like the conversion.
#[tauri::command]
pub async fn repo_validate(handle: tauri::AppHandle, args: ValidateArgs) -> Result<ValidateReport, String> {
    tauri::async_runtime::spawn_blocking(move || validate(&handle, &args))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::repo_convert::{convert_with, ConvertArgs};
    use ed25519_dalek::{Signer, SigningKey};
    use sha2::{Digest, Sha256};

    fn signer(bytes: &[u8]) -> Result<(String, String), String> {
        let k = SigningKey::from_bytes(&[7u8; 32]);
        Ok((hex::encode(k.verifying_key().to_bytes()), hex::encode(k.sign(bytes).to_bytes())))
    }

    /// A 0.3-shaped repo as an old BMM left it on disk: two mods, real files under
    /// mods/{id}/, one hash stale, one missing, one never filled. The shape the owner's old
    /// repos have.
    fn old_repo() -> tempfile::TempDir {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("mods/alpha/Data")).unwrap();
        std::fs::create_dir_all(root.join("mods/beta")).unwrap();
        std::fs::write(root.join("mods/alpha/Data/a.txt"), b"hello").unwrap();
        std::fs::write(root.join("mods/alpha/readme.md"), b"changed since export").unwrap();
        std::fs::write(root.join("mods/beta/b.ini"), b"[x]\ny=1\n").unwrap();
        let good = format!("{:x}", Sha256::digest(b"hello"));
        let manifest = serde_json::json!({
            "name": "Old repo", "description": null, "author": "someone", "version": "0.9.2",
            "game_name": "game.x", "created_at": "2025-01-01T00:00:00Z",
            "profiles": [{ "id": "p1", "name": "Main", "mods": [
                { "id": "alpha", "name": "Alpha", "version": "1.0", "author": null, "description": null, "tags": [],
                  "download_links": [],
                  "files": [
                    { "relative_path": "Data/a.txt", "size": 5, "sha256_hash": good },
                    { "relative_path": "readme.md", "size": 3, "sha256_hash": "deadbeef" },
                    { "relative_path": "gone.esp", "size": 9, "sha256_hash": "11" }
                  ] },
                { "id": "beta", "name": "Beta", "version": "2", "author": null, "description": null, "tags": [],
                  "download_links": [],
                  "files": [ { "relative_path": "b.ini", "size": 0, "sha256_hash": "" } ] }
            ] }]
        });
        std::fs::write(root.join("repo.json"), serde_json::to_string_pretty(&manifest).unwrap()).unwrap();
        dir
    }

    fn vargs(dir: &Path) -> ValidateArgs { ValidateArgs { path: dir.to_string_lossy().to_string(), run_id: None, deep: false } }

    #[test]
    fn validate_reports_every_file_problem_and_writes_nothing() {
        let dir = old_repo();
        let before = std::fs::read_to_string(dir.path().join("repo.json")).unwrap();
        let r = validate_with(&vargs(dir.path()), &repo_format::hash_in_order).unwrap();
        assert!(r.files_checked);
        assert_eq!((r.files_missing, r.hashes_changed, r.hashes_filled), (1, 1, 1), "{r:?}");
        assert_eq!((r.profiles, r.mods, r.files), (1, 2, 4));
        assert_eq!(r.signature, "unsigned");
        assert!(r.problems.first().is_some_and(|c| c.kind == "file_missing"), "missing first: {:?}", r.problems);
        assert_eq!(std::fs::read_to_string(dir.path().join("repo.json")).unwrap(), before);
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 2, "repo.json and mods/: no backup, no temp");
    }

    /// The end-to-end path the page drives: Validate → Convert (dry run, then write) →
    /// Validate again is clean apart from the file that really is gone, and signed.
    #[test]
    fn convert_then_validate_round_trip_on_an_old_repo() {
        let dir = old_repo();
        let a = ConvertArgs { path: dir.path().to_string_lossy().to_string(), dry_run: true, rehash: true, sign: true, set_version: None };
        let plan = convert_with(&a, None, signer).unwrap();
        assert!(!plan.up_to_date && !plan.written);
        assert_eq!(plan.counts.files_missing, 1);
        let done = convert_with(&ConvertArgs { dry_run: false, ..a.clone() }, None, signer).unwrap();
        assert!(done.written, "{done:?}");
        assert!(std::path::Path::new(done.backup_path.as_deref().unwrap()).is_file(), "backup kept");

        let r = validate_with(&vargs(dir.path()), &repo_format::hash_in_order).unwrap();
        assert_eq!(r.signature, "valid", "{r:?}");
        assert_eq!(r.format.as_ref().unwrap().status, FormatStatus::Current);
        assert_eq!((r.files_missing, r.hashes_changed, r.hashes_filled), (1, 0, 0), "only the gone file remains: {r:?}");
        assert!(r.readable);
    }

    /// « Repair » on an unsigned or tampered current manifest signs it (it used to say
    /// "already up to date" and do nothing).
    #[test]
    fn repair_signs_an_unsigned_current_manifest_and_re_signs_a_tampered_one() {
        let dir = old_repo();
        let a = ConvertArgs { path: dir.path().to_string_lossy().to_string(), dry_run: false, rehash: true, sign: false, set_version: None };
        convert_with(&a, None, signer).unwrap();
        assert_eq!(validate_with(&vargs(dir.path()), &repo_format::hash_in_order).unwrap().signature, "unsigned");
        let fix = convert_with(&ConvertArgs { sign: true, ..a.clone() }, None, signer).unwrap();
        assert!(fix.written && fix.changes.iter().any(|c| c.kind == "signature_added"), "{:?}", fix.changes);
        assert_eq!(validate_with(&vargs(dir.path()), &repo_format::hash_in_order).unwrap().signature, "valid");

        // Hand-edit the description after signing.
        let p = dir.path().join("repo.json");
        let mut v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        v["description"] = serde_json::json!("edited by hand");
        std::fs::write(&p, serde_json::to_string_pretty(&v).unwrap()).unwrap();
        assert_eq!(validate_with(&vargs(dir.path()), &repo_format::hash_in_order).unwrap().signature, "invalid");
        let fix = convert_with(&ConvertArgs { sign: true, ..a }, None, signer).unwrap();
        assert!(fix.written && fix.changes.iter().any(|c| c.kind == "signature_invalid"), "{:?}", fix.changes);
        assert_eq!(validate_with(&vargs(dir.path()), &repo_format::hash_in_order).unwrap().signature, "valid");
    }

    /// Every shipped format fixture, laid out on disk the way that BMM wrote it (files under
    /// the layout it names, the archive where it says), stale hashes and all: Validate flags
    /// it, Convert (governed hasher, as the app runs it) writes a signed current manifest with
    /// a backup, and Validate is clean afterwards.
    #[test]
    fn every_fixture_on_disk_validates_converts_and_validates_clean() {
        const FIXTURES: [&str; 5] = [
            include_str!("../../tests/repo_format/v0.1-first-export.json"),
            include_str!("../../tests/repo_format/v0.2-signed.json"),
            include_str!("../../tests/repo_format/v0.3-modpacks.json"),
            include_str!("../../tests/repo_format/v0.4-hosting.json"),
            include_str!("../../tests/repo_format/v1.0.json"),
        ];
        for (i, src) in FIXTURES.iter().enumerate() {
            let dir = tempfile::tempdir().unwrap();
            let root = dir.path();
            let v: serde_json::Value = serde_json::from_str(src).unwrap();
            // Served from elsewhere: the files are not on this disk, Validate must not look.
            let remote = v.get("files_base_url").and_then(serde_json::Value::as_str).is_some_and(|u| !u.is_empty());
            let layout = v.get("files_layout").and_then(serde_json::Value::as_str).map(str::to_string);
            for p in v["profiles"].as_array().unwrap() {
                for m in p["mods"].as_array().unwrap() {
                    let id = m["id"].as_str().unwrap();
                    let put = |rel: String| {
                        let f = root.join(rel);
                        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
                        std::fs::write(f, format!("{id} {i}")).unwrap();
                    };
                    if let Some(a) = m.get("archive").filter(|a| a.is_object()) { put(a["relative_path"].as_str().unwrap().to_string()); }
                    for f in m.get("files").and_then(serde_json::Value::as_array).into_iter().flatten() {
                        put(repo_format::file_tail(layout.as_deref(), id, f["relative_path"].as_str().unwrap()));
                    }
                }
            }
            std::fs::write(root.join("repo.json"), src).unwrap();

            let before = validate_with(&vargs(root), &repo_format::hash_in_order).unwrap();
            assert!(before.readable, "fixture {i}: {before:?}");
            assert_eq!(before.files_checked, !remote, "fixture {i}");
            if !remote { assert!(before.hashes_changed + before.hashes_filled > 0, "fixture {i}: stale hashes are flagged: {before:?}"); }

            let gov = crate::governor::runtime::global();
            let ticket = gov.begin(OpKind::Hash, "repo convert fixture test");
            let h = governed_hasher(&ticket, None, true);
            let a = ConvertArgs { path: root.to_string_lossy().to_string(), dry_run: false, rehash: true, sign: true, set_version: None };
            let done = crate::commands::repo_convert::convert_with_hasher(&a, None, signer, &h).unwrap();
            if done.written { assert!(Path::new(done.backup_path.as_deref().unwrap()).is_file(), "fixture {i}: backup kept"); }

            let after = validate_with(&vargs(root), &repo_format::hash_in_order).unwrap();
            assert_eq!(after.format.as_ref().unwrap().status, FormatStatus::Current, "fixture {i}");
            assert_eq!(after.signature, "valid", "fixture {i}: {after:?}");
            assert_eq!((after.files_missing, after.hashes_changed, after.hashes_filled, after.sizes_changed), (0, 0, 0, 0), "fixture {i}: {after:?}");
        }
    }

    #[test]
    fn duplicate_ids_in_a_profile_are_named() {
        let dir = old_repo();
        let p = dir.path().join("repo.json");
        let mut v: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(&p).unwrap()).unwrap();
        let first = v["profiles"][0]["mods"][1].clone();
        let mut dup = first.clone();
        dup["id"] = serde_json::json!("BETA");
        v["profiles"][0]["mods"].as_array_mut().unwrap().push(dup);
        std::fs::write(&p, v.to_string()).unwrap();
        let r = validate_with(&vargs(dir.path()), &repo_format::hash_in_order).unwrap();
        assert_eq!(r.duplicate_ids, vec!["BETA".to_string()]);
    }

    #[test]
    fn the_cache_answers_an_unchanged_file_and_rereads_a_changed_one() {
        let dir = tempfile::tempdir().unwrap();
        let f = dir.path().join("x.bin");
        std::fs::write(&f, b"one").unwrap();
        let (a, hit) = hash_cached(&f, false);
        assert!(!hit);
        let (b, hit) = hash_cached(&f, false);
        assert!(hit, "same size and date: from the cache");
        assert_eq!(a.unwrap().1, b.unwrap().1);
        std::fs::write(&f, b"two!").unwrap();
        let (c, hit) = hash_cached(&f, false);
        assert!(!hit, "size moved: read again");
        assert_eq!(c.unwrap().1, format!("{:x}", Sha256::digest(b"two!")));
        let (_, hit) = hash_cached(&f, true);
        assert!(!hit, "deep never uses the cache");
    }

    /// The governed hasher gives the same answers as the sequential one, in the same order.
    #[test]
    fn the_governed_hasher_matches_the_plain_one() {
        let dir = old_repo();
        let gov = crate::governor::runtime::global();
        let ticket = gov.begin(OpKind::Hash, "repo validate test");
        let h = governed_hasher(&ticket, None, true);
        let a = validate_with(&vargs(dir.path()), &h).unwrap();
        let b = validate_with(&vargs(dir.path()), &repo_format::hash_in_order).unwrap();
        assert_eq!(serde_json::to_value(&a.problems).unwrap(), serde_json::to_value(&b.problems).unwrap());
        assert_eq!((a.files_missing, a.hashes_changed, a.hashes_filled), (b.files_missing, b.hashes_changed, b.hashes_filled));
    }

    #[test]
    fn cancel_by_run_token_reaches_the_ticket_and_the_token_ends_with_the_run() {
        let gov = crate::governor::runtime::global();
        let ticket = gov.begin(OpKind::Hash, "repo validate token test");
        {
            let _g = RunGuard::new("tok-1", ticket.id()).unwrap();
            assert!(repo_validate_cancel("tok-1".into()));
            assert!(ticket.checkpoint().is_err(), "cancelled");
        }
        assert!(!repo_validate_cancel("tok-1".into()), "gone with its guard");
        assert!(RunGuard::new("", ticket.id()).is_none());
    }

    #[test]
    fn a_cancelled_ticket_stops_the_check() {
        let dir = old_repo();
        let gov = crate::governor::runtime::global();
        let ticket = gov.begin(OpKind::Hash, "repo validate cancel test");
        gov.queue().cancel(ticket.id());
        let h = governed_hasher(&ticket, None, true);
        assert_eq!(validate_with(&vargs(dir.path()), &h).unwrap_err(), "repo.cancelled");
    }
}
