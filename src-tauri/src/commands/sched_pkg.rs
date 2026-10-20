//! Automation packages: an automation that carries its own files.
//!
//! An automation could already be shared as a `.bmmpa` — a JSON document holding the steps.
//! What it could not carry is the THINGS those steps act on: the hook script a server asks its
//! players to install, the mod list to check against, a small mod. Each had to travel beside
//! it, be put in the right place by hand, and be trusted on its word.
//!
//! **No new container.** A package is a `.bmmbundle` — the zip BMM already uses for a
//! catalogue that carries its payloads — holding:
//!
//! ```text
//! bmm_signature.json   the signed list of every entry and its SHA-256 (doc_sign::archive_manifest,
//!                      the same block .mm, .bmmplug and .bmmtheme archives carry)
//! automation.bmmpa     the automation, BMMPA version 2, itself signed (doc_sign::sign_doc) and
//!                      carrying `package.files`: every payload file with its SHA-256 and size
//! catalog.json         one preset pointing at automation.bmmpa, so a catalogue reader that opens
//!                      the bundle sees an automation it can install, and nothing else
//! files/…              the payloads (a script, a .mm, a mod folder, any file to place)
//! ```
//!
//! The rules that make it safe to open one from a stranger:
//!
//! * **Extraction is `archive::extract_to`**, into a fresh staging folder: the same zip-slip
//!   refusal and size budget as a mod archive. Nothing here interprets a path from the archive.
//! * **Fail closed on a changed package.** A signed archive whose files no longer match its
//!   list is refused, as is a payload the document does not list or lists with another hash.
//!   An unsigned package opens (every older tool writes unsigned files) and is SAID to be
//!   unsigned by the screen that shows it.
//! * **The store is content-addressed.** Opened packages are copied to
//!   `AutomationPackages/<id>/` next to data.json, `<id>` derived from the document's hash, so a
//!   changed package can never overwrite the files of the one a task was built on.
//! * **Installing re-checks the hash** of the stored copy against the package before copying,
//!   and writes only under a ROOT the app resolves itself — the DCS Saved Games folders, the
//!   active profile's game folder, its mods folder — at a relative path with no `..`, no drive
//!   and no root. There is no "any folder" root: a downloaded automation that could write
//!   anywhere could write into the Startup folder.
//! * **Running a program** (`launch_with_args`) takes an `.exe` and an argument LIST — no shell,
//!   nothing re-parsed — and only when the frontend says the task holds the `command`
//!   permission, the same contract as `run_scheduled_command`.
//! * **Every authorisation leaves a receipt** (`automation-consents.jsonl`): which task, which
//!   package (by hash), which file, where, the hash of the text the person read, and the answer.
//!   Hash-chained and append-only, local only — nothing here leaves the machine.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use tauri::{AppHandle, State};

use crate::state::AppState;

/// The automation inside a package.
pub const DOC_ENTRY: &str = "automation.bmmpa";
/// The format name bound into both signatures.
pub const FORMAT: &str = "bmmpa";
/// Where payloads live inside a package.
pub const FILES_DIR: &str = "files";
/// What a package may weigh, packed or unpacked. A package is for the things an automation
/// needs next to it — a script, a list, a small mod — not a 40 GB terrain: those come from the
/// catalogue or a repo, where they are downloaded with their own checks.
pub const MAX_PACKAGE_BYTES: u64 = 512 * 1024 * 1024;
const STORE: &str = "AutomationPackages";
const META: &str = "package.json";
const CONSENTS: &str = "automation-consents.jsonl";
const REPORT_FILE: &str = "bmm-joingate.json";

// ── Names ────────────────────────────────────────────────────────────────────────────────────

/// A payload name inside a package: `files/<segments>`, forward slashes, every segment a plain
/// name. `None` for anything else — the only names this module will ever join onto a folder.
pub fn safe_entry_name(name: &str) -> Option<String> {
    let n = name.trim().replace('\\', "/");
    if n.len() > 400 || n.chars().any(|c| c.is_control()) {
        return None;
    }
    let mut parts = n.split('/');
    if parts.next() != Some(FILES_DIR) {
        return None;
    }
    let rest: Vec<&str> = parts.collect();
    if rest.is_empty() {
        return None;
    }
    for seg in &rest {
        if !plain_segment(seg) {
            return None;
        }
    }
    Some(n)
}

/// One path segment that cannot climb, name a drive or a device, or hide in Windows' rules.
fn plain_segment(seg: &str) -> bool {
    if seg.is_empty() || seg == "." || seg == ".." || seg.len() > 200 {
        return false;
    }
    if seg.contains(':') || seg.contains('*') || seg.contains('?') || seg.contains('"') || seg.contains('<') || seg.contains('>') || seg.contains('|') {
        return false;
    }
    // "file. " and "file " are the same file as "file" to Windows, and a different one to a
    // comparison. Refused rather than normalised.
    if seg.ends_with(' ') || seg.ends_with('.') {
        return false;
    }
    let stem = seg.split('.').next().unwrap_or("").to_ascii_uppercase();
    const DEVICES: [&str; 22] = [
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8", "COM9",
        "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ];
    !DEVICES.contains(&stem.as_str())
}

/// A destination under an install root: relative, plain segments only. `""` is the root itself.
pub fn safe_rel(rel: &str) -> Option<PathBuf> {
    let r = rel.trim().replace('\\', "/");
    // A UNC path (`\\host\share`) is a place on another machine, not a folder to trim.
    if r.starts_with("//") {
        return None;
    }
    let r = r.trim_matches('/');
    let mut out = PathBuf::new();
    if r.is_empty() {
        return Some(out);
    }
    for seg in r.split('/') {
        if !plain_segment(seg) {
            return None;
        }
        out.push(seg);
    }
    // Belt and braces: whatever the segments said, the result must be purely relative.
    if out.components().any(|c| !matches!(c, Component::Normal(_))) {
        return None;
    }
    Some(out)
}

/// A store id: lowercase hex, as minted by `id_of`.
fn safe_id(id: &str) -> bool {
    (16..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_digit() || ('a'..='f').contains(&c))
}

fn sha256_hex(bytes: &[u8]) -> String {
    let mut h = Sha256::new();
    h.update(bytes);
    hex::encode(h.finalize())
}

/// The SHA-256 of a file, streamed: a mod file is not read into memory to be hashed.
pub fn sha256_file(path: &Path) -> std::io::Result<String> {
    let mut f = std::fs::File::open(path)?;
    let mut h = Sha256::new();
    let mut buf = vec![0u8; 256 * 1024];
    loop {
        let n = f.read(&mut buf)?;
        if n == 0 {
            break;
        }
        h.update(&buf[..n]);
    }
    Ok(hex::encode(h.finalize()))
}

/// The store id of a package: the hash of its document. Same document, same folder.
fn id_of(doc_bytes: &[u8]) -> String {
    sha256_hex(doc_bytes)[..24].to_string()
}

fn store_root(state: &AppState) -> PathBuf {
    state.data_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(std::env::temp_dir).join(STORE)
}

fn pkg_dir(state: &AppState, id: &str) -> Result<PathBuf, String> {
    if !safe_id(id) {
        return Err("pkg.errBadId".into());
    }
    Ok(store_root(state).join(id))
}

/// A path built from a checked name, under `base`.
fn join_entry(base: &Path, name: &str) -> PathBuf {
    let mut p = base.to_path_buf();
    for seg in name.split('/') {
        p.push(seg);
    }
    p
}

// ── What travels ─────────────────────────────────────────────────────────────────────────────

/// One payload file as the package lists it.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PkgFile {
    pub name: String,
    pub sha256: String,
    pub size: u64,
}

/// What opening (or creating) a package produced: the stored copy, and what to show about it.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PkgInfo {
    pub id: String,
    pub name: String,
    /// The automation document, verbatim. The frontend imports it through the same sanitiser
    /// as any `.bmmpa`: tasks arrive disabled, with every permission taken away.
    pub doc: String,
    /// `unsigned` · `valid` · (never `tampered` — that is refused before this exists).
    pub signature: String,
    pub author_id: Option<String>,
    pub files: Vec<PkgFile>,
    pub dir: String,
}

fn verdict_word(v: &crate::commands::doc_sign::Verdict) -> (&'static str, Option<String>) {
    use crate::commands::doc_sign::Verdict;
    match v {
        Verdict::Unsigned => ("unsigned", None),
        Verdict::Valid { author_id, .. } => ("valid", Some(author_id.clone())),
        Verdict::Tampered { author_id } => ("tampered", Some(author_id.clone())),
        Verdict::Malformed { .. } => ("malformed", None),
    }
}

/// The payload list a document declares, each name checked.
fn declared_files(doc: &Value) -> Result<Vec<PkgFile>, String> {
    let mut out = Vec::new();
    let Some(arr) = doc.pointer("/package/files").and_then(|v| v.as_array()) else {
        return Ok(out);
    };
    for row in arr {
        let f: PkgFile = serde_json::from_value(row.clone()).map_err(|_| "pkg.errBadName".to_string())?;
        let Some(name) = safe_entry_name(&f.name) else { return Err("pkg.errBadName".into()) };
        if f.sha256.len() != 64 || !f.sha256.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("pkg.errHash".into());
        }
        out.push(PkgFile { name, sha256: f.sha256.to_ascii_lowercase(), size: f.size });
    }
    Ok(out)
}

fn doc_name(doc: &Value) -> String {
    doc.pointer("/package/name")
        .and_then(|v| v.as_str())
        .or_else(|| doc.pointer("/tasks/0/name").and_then(|v| v.as_str()))
        .unwrap_or("automation")
        .chars()
        .take(120)
        .collect()
}

/// Write a checked package into the store: the document, the payloads, and the meta file the
/// installer reads its hashes from.
fn store_package(state: &AppState, doc_bytes: &[u8], doc: &Value, signature: &str, author: Option<String>, payload: &[(String, PathBuf)]) -> Result<PkgInfo, String> {
    let id = id_of(doc_bytes);
    let dir = pkg_dir(state, &id)?;
    let files = declared_files(doc)?;
    std::fs::create_dir_all(&dir).map_err(|e| format!("pkg.errWrite|{e}"))?;
    let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Install, &format!("automation package {id}"));
    for (name, src) in payload {
        let dst = join_entry(&dir, name);
        crate::fs_utils::copy_file_governed(crate::governor::config::OpKind::Install, src, &dst, Some(&ticket), false)
            .map_err(|e| format!("pkg.errWrite|{e}"))?;
    }
    std::fs::write(dir.join(DOC_ENTRY), doc_bytes).map_err(|e| format!("pkg.errWrite|{e}"))?;
    let info = PkgInfo {
        id: id.clone(),
        name: doc_name(doc),
        doc: String::from_utf8_lossy(doc_bytes).to_string(),
        signature: signature.to_string(),
        author_id: author,
        files,
        dir: dir.to_string_lossy().to_string(),
    };
    let meta = serde_json::json!({
        "v": 1, "id": id, "name": info.name, "signature": info.signature,
        "author_id": info.author_id, "files": info.files,
    });
    std::fs::write(dir.join(META), serde_json::to_vec_pretty(&meta).unwrap_or_default()).map_err(|e| format!("pkg.errWrite|{e}"))?;
    Ok(info)
}

/// Check payloads on disk against the document: every declared file present with its hash, and
/// nothing under `files/` that the document does not declare.
fn check_payload(base: &Path, declared: &[PkgFile], present: &[String]) -> Result<Vec<(String, PathBuf)>, String> {
    let listed: std::collections::HashSet<&str> = declared.iter().map(|f| f.name.as_str()).collect();
    if let Some(extra) = present.iter().find(|n| !listed.contains(n.as_str())) {
        return Err(format!("pkg.errHash|{extra}"));
    }
    let mut out = Vec::new();
    for f in declared {
        let p = join_entry(base, &f.name);
        let got = sha256_file(&p).map_err(|_| format!("pkg.errNoFile|{}", f.name))?;
        if got != f.sha256 {
            return Err(format!("pkg.errHash|{}", f.name));
        }
        out.push((f.name.clone(), p));
    }
    Ok(out)
}

/// Every file under `dir`, as `/`-separated names relative to it.
fn walk_names(dir: &Path) -> Vec<String> {
    let mut out = Vec::new();
    for e in walkdir::WalkDir::new(dir).follow_links(false).into_iter().flatten() {
        if !e.file_type().is_file() {
            continue;
        }
        if let Ok(rel) = e.path().strip_prefix(dir) {
            let name = rel.components().filter_map(|c| c.as_os_str().to_str()).collect::<Vec<_>>().join("/");
            out.push(name);
        }
    }
    out.sort();
    out
}

// ── Pack ─────────────────────────────────────────────────────────────────────────────────────

/// A file or folder to put in a package, by its name inside it.
#[derive(Debug, Clone, Deserialize)]
pub struct PackInput {
    /// `files/<name>`: where it goes in the package.
    pub name: String,
    /// A file or folder on disk (a picked file, or a stored package's copy).
    #[serde(default)]
    pub src: Option<String>,
    /// Or the content itself (a script written in the editor, a template's bundled file).
    #[serde(default)]
    pub text: Option<String>,
}

#[derive(Debug, Serialize)]
pub struct PackResult {
    pub path: String,
    pub files: u32,
    pub bytes: u64,
    pub signed: bool,
}

/// Gather the payload as (name, bytes), expanding folders, within the size budget.
fn gather(inputs: &[PackInput]) -> Result<Vec<(String, Vec<u8>)>, String> {
    let mut out: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total = 0u64;
    let mut seen = std::collections::HashSet::new();
    let mut push = |name: String, data: Vec<u8>, out: &mut Vec<(String, Vec<u8>)>| -> Result<(), String> {
        total += data.len() as u64;
        if total > MAX_PACKAGE_BYTES {
            return Err("pkg.errTooBig".into());
        }
        if seen.insert(name.clone()) {
            out.push((name, data));
        }
        Ok(())
    };
    for inp in inputs {
        let Some(name) = safe_entry_name(&inp.name) else { return Err(format!("pkg.errBadName|{}", inp.name)) };
        if let Some(text) = &inp.text {
            push(name, text.as_bytes().to_vec(), &mut out)?;
            continue;
        }
        let Some(src) = inp.src.as_deref().filter(|s| !s.trim().is_empty()) else { return Err(format!("pkg.errNoFile|{name}")) };
        let src = PathBuf::from(src);
        if src.is_file() {
            let data = std::fs::read(&src).map_err(|_| format!("pkg.errNoFile|{name}"))?;
            push(name, data, &mut out)?;
        } else if src.is_dir() {
            for rel in walk_names(&src) {
                let child = format!("{name}/{rel}");
                let Some(child) = safe_entry_name(&child) else { return Err(format!("pkg.errBadName|{child}")) };
                let data = std::fs::read(join_entry(&src, &rel)).map_err(|_| format!("pkg.errNoFile|{child}"))?;
                push(child, data, &mut out)?;
            }
        } else {
            return Err(format!("pkg.errNoFile|{name}"));
        }
    }
    Ok(out)
}

/// The document as it goes into the package: version 2, `package.files` filled from what is
/// actually packed (never from what the screen claimed), then signed.
fn finish_doc(mut doc: Value, payload: &[(String, Vec<u8>)]) -> Result<Value, String> {
    if doc.get("magic").and_then(|v| v.as_str()) != Some("BMMPA") || !doc.get("tasks").map(|t| t.is_array()).unwrap_or(false) {
        return Err("pkg.errNoDoc".into());
    }
    let files: Vec<Value> = payload
        .iter()
        .map(|(n, d)| serde_json::json!({ "name": n, "sha256": sha256_hex(d), "size": d.len() }))
        .collect();
    let obj = doc.as_object_mut().ok_or_else(|| "pkg.errNoDoc".to_string())?;
    obj.insert("version".into(), Value::from(2));
    let pkg = obj.entry("package").or_insert_with(|| serde_json::json!({}));
    if !pkg.is_object() {
        *pkg = serde_json::json!({});
    }
    let p = pkg.as_object_mut().unwrap();
    p.insert("v".into(), Value::from(1));
    p.insert("files".into(), Value::Array(files));
    Ok(doc)
}

/// Pack an automation and its files into a `.bmmbundle`.
#[tauri::command(async)]
pub fn automation_package_pack(app: AppHandle, out: String, doc: String, files: Vec<PackInput>) -> Result<PackResult, String> {
    let out_path = PathBuf::from(&out);
    let parsed: Value = serde_json::from_str(&doc).map_err(|_| "pkg.errNoDoc".to_string())?;
    let payload = gather(&files)?;
    let mut doc = finish_doc(parsed, &payload)?;
    let signed = crate::commands::doc_sign::sign_doc(&app, &mut doc, FORMAT);
    let doc_bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
    let catalog = serde_json::json!({
        "name": doc_name(&doc),
        "description": "BMM automation package",
        "presets": [{ "id": doc.pointer("/package/id").and_then(|v| v.as_str()).unwrap_or("automation"), "name": doc_name(&doc), "download_url": DOC_ENTRY }],
    });
    let mut entries: Vec<(String, Vec<u8>)> = vec![
        (DOC_ENTRY.to_string(), doc_bytes),
        ("catalog.json".to_string(), serde_json::to_vec_pretty(&catalog).unwrap_or_default()),
    ];
    entries.extend(payload);
    let manifest = crate::commands::doc_sign::archive_manifest(&app, FORMAT, &entries);
    entries.push((crate::commands::doc_sign::ARCHIVE_ENTRY.to_string(), serde_json::to_vec_pretty(&manifest).unwrap_or_default()));

    if let Some(parent) = out_path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let ticket = crate::governor::runtime::global()
        .begin(crate::governor::config::OpKind::Compress, &format!("automation package → {}", out_path.display()));
    let written = write_zip(&out_path, &entries, &ticket);
    if written.is_err() {
        let _ = std::fs::remove_file(&out_path);
    }
    let bytes = written?;
    Ok(PackResult { path: out_path.to_string_lossy().to_string(), files: entries.len() as u32, bytes, signed })
}

fn write_zip(out: &Path, entries: &[(String, Vec<u8>)], ticket: &crate::governor::queue::Ticket) -> Result<u64, String> {
    let file = std::fs::File::create(out).map_err(|e| format!("pkg.errWrite|{e}"))?;
    let pace = crate::governor::runtime::global().limiter(crate::governor::config::OpKind::Compress, out);
    let mut zip = zip::ZipWriter::new(file);
    let opts = zip::write::FileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut bytes = 0u64;
    for (name, data) in entries {
        ticket.checkpoint().map_err(|_| "bundle.cancelled".to_string())?;
        zip.start_file(name.clone(), opts).map_err(|e| e.to_string())?;
        zip.write_all(data).map_err(|e| e.to_string())?;
        ticket.add_bytes(data.len() as u64, 0);
        if let Some(l) = &pace {
            l.acquire(data.len() as u64);
        }
        bytes += data.len() as u64;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(bytes)
}

// ── Open ─────────────────────────────────────────────────────────────────────────────────────

/// A staging folder of our own, removed when dropped.
struct Staging(PathBuf);
impl Drop for Staging {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}
fn staging() -> Result<Staging, String> {
    let base = std::env::temp_dir().join("bmm_pkg_open");
    for n in 0..500u32 {
        let dir = base.join(format!("p_{}_{}_{}", std::process::id(), chrono::Utc::now().timestamp_millis(), n));
        if !dir.exists() {
            std::fs::create_dir_all(&dir).map_err(|e| format!("pkg.errWrite|{e}"))?;
            return Ok(Staging(dir));
        }
    }
    Err("pkg.errWrite|staging".into())
}

/// Open a package: extract, verify (signature over the entries, document over the payloads),
/// copy into the store. A changed package is refused here, before anything is kept.
pub fn open_package(state: &AppState, path: &Path) -> Result<PkgInfo, String> {
    let meta = std::fs::metadata(path).map_err(|_| "pkg.errNotFound".to_string())?;
    if !meta.is_file() {
        return Err("pkg.errNotFound".into());
    }
    if meta.len() > MAX_PACKAGE_BYTES {
        return Err("pkg.errTooBig".into());
    }
    let stage = staging()?;
    crate::archive::extract_to(path, &stage.0).map_err(|e| format!("pkg.errBadArchive|{e}"))?;
    let names = walk_names(&stage.0);
    let doc_path = stage.0.join(DOC_ENTRY);
    let doc_bytes = std::fs::read(&doc_path).map_err(|_| "pkg.errNoDoc".to_string())?;

    // The archive's own signature, over every entry. Read into memory for the check: the size
    // was bounded above, and the verifier's contract is (name, bytes).
    let mut entries: Vec<(String, Vec<u8>)> = Vec::new();
    let mut total = 0u64;
    for n in &names {
        let data = std::fs::read(join_entry(&stage.0, n)).map_err(|e| format!("pkg.errBadArchive|{e}"))?;
        total += data.len() as u64;
        if total > MAX_PACKAGE_BYTES {
            return Err("pkg.errTooBig".into());
        }
        entries.push((n.clone(), data));
    }
    let archive = crate::commands::doc_sign::verify_archive(&entries, FORMAT);
    let (aw, a_author) = verdict_word(&archive);
    if aw == "tampered" || aw == "malformed" {
        return Err("pkg.errTampered".into());
    }
    drop(entries);

    let doc: Value = serde_json::from_slice(&doc_bytes).map_err(|_| "pkg.errNoDoc".to_string())?;
    if doc.get("magic").and_then(|v| v.as_str()) != Some("BMMPA") {
        return Err("pkg.errNoDoc".into());
    }
    let dv = crate::commands::doc_sign::verify_doc(&doc, FORMAT);
    let (dw, d_author) = verdict_word(&dv);
    if dw == "tampered" || dw == "malformed" {
        return Err("pkg.errTampered".into());
    }
    let declared = declared_files(&doc)?;
    let present: Vec<String> = names.iter().filter(|n| n.starts_with("files/")).cloned().collect();
    for n in &present {
        if safe_entry_name(n).is_none() {
            return Err(format!("pkg.errBadName|{n}"));
        }
    }
    let payload = check_payload(&stage.0, &declared, &present)?;
    // Signed means the ARCHIVE is signed: that is what vouches for the payloads. A signed
    // document in an unsigned archive still has its payload hashes vouched for by the document.
    let (sig, author) = if aw == "valid" { ("valid", a_author) } else if dw == "valid" { ("valid", d_author) } else { ("unsigned", None) };
    store_package(state, &doc_bytes, &doc, sig, author, &payload)
}

#[tauri::command(async)]
pub fn automation_package_open(state: State<'_, AppState>, path: String) -> Result<PkgInfo, String> {
    open_package(&state, Path::new(&path))
}

/// Adopt the payloads of a `.bmmpa` v2 that arrived as a loose file with its `files/` beside it
/// (a catalogue bundle opened by the catalogue reader). Same checks, minus the archive list.
#[tauri::command(async)]
pub fn automation_package_adopt(state: State<'_, AppState>, path: String) -> Result<PkgInfo, String> {
    let p = PathBuf::from(&path);
    let doc_bytes = std::fs::read(&p).map_err(|_| "pkg.errNotFound".to_string())?;
    let doc: Value = serde_json::from_slice(&doc_bytes).map_err(|_| "pkg.errNoDoc".to_string())?;
    let dv = crate::commands::doc_sign::verify_doc(&doc, FORMAT);
    let (dw, author) = verdict_word(&dv);
    if dw == "tampered" || dw == "malformed" {
        return Err("pkg.errTampered".into());
    }
    let base = p.parent().ok_or_else(|| "pkg.errNotFound".to_string())?;
    let declared = declared_files(&doc)?;
    let payload = check_payload(base, &declared, &[])?;
    store_package(&state, &doc_bytes, &doc, if dw == "valid" { "valid" } else { "unsigned" }, author, &payload)
}

/// Attach files to a task while it is being written: a new store entry holding the files of
/// `base` (minus `remove`) plus `add`. A new id every time the set changes, so a task saved
/// earlier keeps pointing at exactly the files it was saved with.
#[tauri::command(async)]
pub fn automation_package_attach(state: State<'_, AppState>, name: String, base: Option<String>, add: Vec<PackInput>, remove: Vec<String>) -> Result<PkgInfo, String> {
    let mut inputs: Vec<PackInput> = Vec::new();
    if let Some(b) = base.filter(|b| !b.is_empty()) {
        let (dir, files, _) = read_meta(&state, &b)?;
        for f in files {
            let gone = remove.iter().any(|r| f.name == *r || f.name.starts_with(&format!("{r}/")));
            if gone {
                continue;
            }
            let p = join_entry(&dir, &f.name);
            if sha256_file(&p).map_err(|_| format!("pkg.errNoFile|{}", f.name))? != f.sha256 {
                return Err("pkg.errStoreTampered".into());
            }
            inputs.push(PackInput { name: f.name, src: Some(p.to_string_lossy().to_string()), text: None });
        }
    }
    inputs.extend(add);
    let payload = gather(&inputs)?;
    let label: String = name.chars().filter(|c| !c.is_control()).take(120).collect();
    let doc = finish_doc(serde_json::json!({ "magic": "BMMPA", "tasks": [], "package": { "name": label } }), &payload)?;
    let doc_bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
    let stage = staging()?;
    let mut on_disk = Vec::new();
    for (n, data) in &payload {
        let p = join_entry(&stage.0, n);
        if let Some(parent) = p.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("pkg.errWrite|{e}"))?;
        }
        std::fs::write(&p, data).map_err(|e| format!("pkg.errWrite|{e}"))?;
        on_disk.push((n.clone(), p));
    }
    store_package(&state, &doc_bytes, &doc, "local", None, &on_disk)
}

fn read_meta(state: &AppState, id: &str) -> Result<(PathBuf, Vec<PkgFile>, Value), String> {
    let dir = pkg_dir(state, id)?;
    let raw = std::fs::read(dir.join(META)).map_err(|_| "pkg.errNotFound".to_string())?;
    let meta: Value = serde_json::from_slice(&raw).map_err(|_| "pkg.errNotFound".to_string())?;
    let files: Vec<PkgFile> = serde_json::from_value(meta.get("files").cloned().unwrap_or(Value::Array(vec![]))).unwrap_or_default();
    Ok((dir, files, meta))
}

/// What the store holds for one package (the inspector lists it; the exporter packs from it).
#[tauri::command]
pub fn automation_package_info(state: State<'_, AppState>, id: String) -> Result<PkgInfo, String> {
    let (dir, files, meta) = read_meta(&state, &id)?;
    let doc = std::fs::read_to_string(dir.join(DOC_ENTRY)).unwrap_or_default();
    Ok(PkgInfo {
        id,
        name: meta.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string(),
        doc,
        signature: meta.get("signature").and_then(|v| v.as_str()).unwrap_or("unsigned").to_string(),
        author_id: meta.get("author_id").and_then(|v| v.as_str()).map(String::from),
        files,
        dir: dir.to_string_lossy().to_string(),
    })
}

/// Read one stored text file (a script shown before it is installed, a .mm to check against).
#[tauri::command]
pub fn automation_package_read(state: State<'_, AppState>, id: String, file: String) -> Result<String, String> {
    let (dir, files, _) = read_meta(&state, &id)?;
    let Some(name) = safe_entry_name(&file) else { return Err("pkg.errBadName".into()) };
    let f = files.iter().find(|f| f.name == name).ok_or_else(|| "pkg.errNoFile".to_string())?;
    if f.size > 4 * 1024 * 1024 {
        return Err("pkg.errTooBig".into());
    }
    let p = join_entry(&dir, &name);
    let data = std::fs::read(&p).map_err(|_| "pkg.errNoFile".to_string())?;
    if sha256_hex(&data) != f.sha256 {
        return Err("pkg.errStoreTampered".into());
    }
    Ok(String::from_utf8_lossy(&data).to_string())
}

/// The full path of a stored file, after its hash was checked (a .mm handed to the list
/// reader, which wants a path).
#[tauri::command]
pub fn automation_package_path(state: State<'_, AppState>, id: String, file: String) -> Result<String, String> {
    let (dir, files, _) = read_meta(&state, &id)?;
    let Some(name) = safe_entry_name(&file) else { return Err("pkg.errBadName".into()) };
    let f = files.iter().find(|f| f.name == name).ok_or_else(|| "pkg.errNoFile".to_string())?;
    let p = join_entry(&dir, &name);
    if sha256_file(&p).map_err(|_| "pkg.errNoFile".to_string())? != f.sha256 {
        return Err("pkg.errStoreTampered".into());
    }
    Ok(p.to_string_lossy().to_string())
}

// ── Install and verify ───────────────────────────────────────────────────────────────────────

/// The folders a package may write into. Resolved here, never taken from the task: `dcs` is
/// every DCS Saved Games folder (or the one named, if it IS one of them), `game` and `mods`
/// are the active profile's.
pub fn resolve_roots(state: &AppState, root: &str, dir: Option<&str>) -> Result<Vec<PathBuf>, String> {
    match root {
        "dcs" => {
            let all = crate::commands::game_watch::dcs_saved_games();
            if all.is_empty() {
                return Err("pkg.errNoDcs".into());
            }
            match dir.map(str::trim).filter(|d| !d.is_empty()) {
                Some(d) => {
                    let want = d.replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase();
                    let hit = all.iter().find(|a| a.replace('/', "\\").trim_end_matches('\\').to_ascii_lowercase() == want);
                    match hit {
                        Some(h) => Ok(vec![PathBuf::from(h)]),
                        None => Err("pkg.errNoRoot".into()),
                    }
                }
                None => Ok(all.into_iter().map(PathBuf::from).collect()),
            }
        }
        "game" | "mods" => {
            let data = state.data.lock().map_err(|_| "pkg.errNoRoot".to_string())?;
            let id = data.active_profile_id.clone().ok_or_else(|| "pkg.errNoRoot".to_string())?;
            let p = data.profiles.iter().find(|p| p.id == id).ok_or_else(|| "pkg.errNoRoot".to_string())?;
            let path = if root == "game" { p.game_path.clone() } else { p.mods_path.clone() };
            if path.as_os_str().is_empty() || !path.is_dir() {
                return Err("pkg.errNoRoot".into());
            }
            Ok(vec![path])
        }
        _ => Err("pkg.errNoRoot".into()),
    }
}

/// The stored entries an install of `file` covers: the file itself, or everything under a folder.
fn covered<'a>(files: &'a [PkgFile], file: &str) -> Vec<&'a PkgFile> {
    let prefix = format!("{file}/");
    files.iter().filter(|f| f.name == file || f.name.starts_with(&prefix)).collect()
}

/// Where one entry lands: `<root>/<dest>/<the entry's path below the installed item's parent>`.
pub fn target_for(root: &Path, dest: &Path, file: &str, entry: &str) -> PathBuf {
    let parent = file.rsplit_once('/').map(|(p, _)| p).unwrap_or("");
    let below = entry.strip_prefix(parent).unwrap_or(entry).trim_start_matches('/');
    join_entry(&root.join(dest), below)
}

/// The final check before a write: the folder the file goes into, as the OS resolves it
/// (junctions and links included), is still inside the root.
fn still_inside(root: &Path, target: &Path) -> bool {
    let (Some(parent), Ok(r)) = (target.parent(), root.canonicalize()) else { return false };
    match parent.canonicalize() {
        Ok(p) => p.starts_with(&r),
        Err(_) => false,
    }
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Placed {
    pub path: String,
    pub sha256: String,
    /// `true` when it was there already, identical: nothing was written.
    pub same: bool,
}

#[tauri::command(async)]
pub fn automation_package_install(
    state: State<'_, AppState>,
    id: String,
    file: String,
    root: String,
    dir: Option<String>,
    dest: String,
    overwrite: Option<bool>,
) -> Result<Vec<Placed>, String> {
    let (store, files, _) = read_meta(&state, &id)?;
    let Some(file) = safe_entry_name(&file) else { return Err("pkg.errBadName".into()) };
    let items = covered(&files, &file);
    if items.is_empty() {
        return Err(format!("pkg.errNoFile|{file}"));
    }
    let rel = safe_rel(&dest).ok_or_else(|| "pkg.errBadDest".to_string())?;
    let roots = resolve_roots(&state, &root, dir.as_deref())?;
    // The stored copy is checked BEFORE anything is written: a store edited on disk must not be
    // installed under the package's name.
    for f in &items {
        let got = sha256_file(&join_entry(&store, &f.name)).map_err(|_| format!("pkg.errNoFile|{}", f.name))?;
        if got != f.sha256 {
            return Err("pkg.errStoreTampered".into());
        }
    }
    let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Install, &format!("automation package install {file}"));
    let mut out = Vec::new();
    for r in &roots {
        for f in &items {
            let target = target_for(r, &rel, &file, &f.name);
            if target.is_file() && sha256_file(&target).ok().as_deref() == Some(f.sha256.as_str()) {
                out.push(Placed { path: target.to_string_lossy().to_string(), sha256: f.sha256.clone(), same: true });
                continue;
            }
            if target.exists() && overwrite == Some(false) {
                return Err(format!("pkg.errExists|{}", target.display()));
            }
            if let Some(parent) = target.parent() {
                std::fs::create_dir_all(parent).map_err(|e| format!("pkg.errWrite|{e}"))?;
            }
            if !still_inside(r, &target) {
                return Err("pkg.errEscape".into());
            }
            crate::fs_utils::copy_file_governed(crate::governor::config::OpKind::Install, &join_entry(&store, &f.name), &target, Some(&ticket), false)
                .map_err(|e| format!("pkg.errWrite|{e}"))?;
            out.push(Placed { path: target.to_string_lossy().to_string(), sha256: f.sha256.clone(), same: false });
        }
    }
    crate::commands::crash::log_line(format!("[PKG] installed {} file(s) of {} from package {}", out.len(), file, id));
    Ok(out)
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct Checked {
    pub path: String,
    pub expected: String,
    pub actual: Option<String>,
    pub ok: bool,
}

/// Is `file` of the package present, identical, at `<root>/<dest>` — in every root it covers.
#[tauri::command(async)]
pub fn automation_package_verify(state: State<'_, AppState>, id: String, file: String, root: String, dir: Option<String>, dest: String) -> Result<Vec<Checked>, String> {
    let (_, files, _) = read_meta(&state, &id)?;
    let Some(file) = safe_entry_name(&file) else { return Err("pkg.errBadName".into()) };
    let items = covered(&files, &file);
    if items.is_empty() {
        return Err(format!("pkg.errNoFile|{file}"));
    }
    let rel = safe_rel(&dest).ok_or_else(|| "pkg.errBadDest".to_string())?;
    let roots = resolve_roots(&state, &root, dir.as_deref())?;
    let mut out = Vec::new();
    for r in &roots {
        for f in &items {
            let target = target_for(r, &rel, &file, &f.name);
            let actual = sha256_file(&target).ok();
            let ok = actual.as_deref() == Some(f.sha256.as_str());
            out.push(Checked { path: target.to_string_lossy().to_string(), expected: f.sha256.clone(), actual, ok });
        }
    }
    Ok(out)
}

/// Write the verification result where a game-side script can read it: `<root>/Config/
/// bmm-joingate.json` under each DCS folder (or the game folder). The location is fixed — the
/// task chooses WHAT is reported, never WHERE it is written — and the report is signed with
/// the user's BMM key, so a tool that cares can tell it was this BMM that wrote it.
#[tauri::command(async)]
pub fn automation_gate_report(app: AppHandle, state: State<'_, AppState>, root: String, dir: Option<String>, report: Value) -> Result<Vec<String>, String> {
    if root != "dcs" && root != "game" {
        return Err("pkg.errNoRoot".into());
    }
    let Value::Object(mut obj) = report else { return Err("pkg.errNoDoc".into()) };
    obj.insert("v".into(), Value::from(1));
    obj.insert("at".into(), Value::from(chrono::Utc::now().timestamp()));
    obj.insert("app".into(), Value::from(app.package_info().version.to_string()));
    let mut doc = Value::Object(obj);
    let text = serde_json::to_string(&doc).unwrap_or_default();
    if text.len() > 16 * 1024 {
        return Err("pkg.errTooBig".into());
    }
    crate::commands::doc_sign::sign_doc(&app, &mut doc, "bmmgate");
    let bytes = serde_json::to_vec_pretty(&doc).map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for r in resolve_roots(&state, &root, dir.as_deref())? {
        let cfg = r.join("Config");
        std::fs::create_dir_all(&cfg).map_err(|e| format!("pkg.errWrite|{e}"))?;
        let target = cfg.join(REPORT_FILE);
        if !still_inside(&r, &target) {
            return Err("pkg.errEscape".into());
        }
        crate::state::atomic_write_bytes(&target, &bytes).map_err(|e| format!("pkg.errWrite|{e}"))?;
        out.push(target.to_string_lossy().to_string());
    }
    Ok(out)
}

// ── A mod list, checked ──────────────────────────────────────────────────────────────────────

/// What `modlist_verify` found. Names, not counts, wherever a person will have to act on it.
#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ListReport {
    pub name: String,
    pub total: usize,
    pub ok: bool,
    /// In the list, not installed.
    pub missing: Vec<String>,
    /// Installed, switched off.
    pub inactive: Vec<String>,
    /// A file the list hashes that is absent from the mod or differs from it: `Mod: path`.
    pub altered: Vec<String>,
    /// Switched on and not in the list (reported only with `exact`).
    pub extra: Vec<String>,
    /// Switched on, but a file it deployed is not in the game folder any more: `Mod: path`.
    pub undeployed: Vec<String>,
    /// 16 hex of the SHA-256 of the list's mods (`name@version`, lower case, sorted). The value
    /// a server compares with; the same list gives the same value on every machine.
    pub fingerprint: String,
    pub checked_files: u64,
}

/// The fingerprint of a set of mods. Order-free and case-free, so two exports of the same list
/// agree; the version is in it, so « the same mods, one older » does not.
pub fn list_fingerprint(mods: &[(String, String)]) -> String {
    let mut lines: Vec<String> = mods.iter().map(|(n, v)| format!("{}@{}", n.trim().to_lowercase(), v.trim().to_lowercase())).collect();
    lines.sort();
    lines.dedup();
    sha256_hex(lines.join("\n").as_bytes())[..16].to_string()
}

/// Is this list active, in place and intact? Read-only: nothing is enabled, installed or
/// rewritten — that is `modlist.apply`, after the person said yes.
///
/// * active: every mod of the list is installed and switched on (and, with `exact`, nothing
///   else is on);
/// * in place: every file a switched-on mod of the list deployed is still in the game folder;
/// * intact (`hashes`): every file the list carries a SHA-256 for is in the mod, identical.
#[tauri::command(async)]
pub fn modlist_verify(state: State<'_, AppState>, path: String, passphrase: Option<String>, exact: Option<bool>, hashes: Option<bool>) -> Result<ListReport, String> {
    let list = crate::commands::modlist::read_modlist_file_with(Path::new(&path), passphrase.as_deref()).map_err(|e| format!("pkg.errList|{e}"))?;
    let (mods, game) = {
        let data = state.data.lock().map_err(|_| "pkg.errNoRoot".to_string())?;
        let game = data
            .active_profile_id
            .as_ref()
            .and_then(|id| data.profiles.iter().find(|p| &p.id == id))
            .map(|p| p.game_path.clone());
        (data.mods.clone(), game)
    };
    let mut rep = ListReport { name: list.name.clone(), total: list.mods.len(), ..Default::default() };
    rep.fingerprint = list_fingerprint(&list.mods.iter().map(|m| (m.name.clone(), m.version.clone())).collect::<Vec<_>>());
    let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Hash, &format!("mod list check {}", list.name));
    let mut wanted = std::collections::HashSet::new();
    for entry in &list.mods {
        let key = entry.name.trim().to_lowercase();
        wanted.insert(key.clone());
        let Some(local) = mods.iter().find(|m| m.name.trim().to_lowercase() == key) else {
            rep.missing.push(entry.name.clone());
            continue;
        };
        if !local.enabled {
            rep.inactive.push(entry.name.clone());
            continue;
        }
        if let Some(g) = &game {
            for rel in local.installed_files.iter().take(5000) {
                if let Some(r) = safe_rel(rel) {
                    if !g.join(&r).exists() {
                        rep.undeployed.push(format!("{}: {}", entry.name, rel));
                    }
                }
            }
        }
        if hashes != Some(false) {
            let root = crate::archive::mod_read_root(&local.mod_folder_path);
            for f in entry.file_tree.iter().filter(|f| !f.is_directory) {
                let Some(want) = f.sha256.as_deref() else { continue };
                if ticket.checkpoint().is_err() {
                    return Err("bundle.cancelled".into());
                }
                let Some(r) = safe_rel(&f.relative_path) else { continue };
                rep.checked_files += 1;
                match sha256_file(&root.join(&r)) {
                    Ok(h) if h.eq_ignore_ascii_case(want) => {}
                    _ => rep.altered.push(format!("{}: {}", entry.name, f.relative_path)),
                }
            }
        }
    }
    if exact == Some(true) {
        for m in mods.iter().filter(|m| m.enabled) {
            if !wanted.contains(&m.name.trim().to_lowercase()) {
                rep.extra.push(m.name.clone());
            }
        }
    }
    rep.ok = rep.missing.is_empty() && rep.inactive.is_empty() && rep.altered.is_empty() && rep.extra.is_empty() && rep.undeployed.is_empty();
    Ok(rep)
}

// ── Launch ───────────────────────────────────────────────────────────────────────────────────

/// Start a program with arguments and do not wait for it — a game, not a tool whose output is
/// read (that is `run_scheduled_command`).
///
/// An executable and a LIST of arguments: nothing goes through a shell, so nothing in an
/// argument is ever re-parsed as a second command. `.exe` only on Windows — a `.bat` or a
/// `.ps1` is a script, and scripts have their own permission and their own step.
#[tauri::command]
pub fn launch_with_args(exe: String, args: Vec<String>, working_dir: Option<String>, allow: bool) -> Result<u32, String> {
    if !allow {
        return Err("pkg.errNotAllowed".into());
    }
    let path = PathBuf::from(exe.trim());
    if !path.is_file() {
        return Err("pkg.errNotFound".into());
    }
    if cfg!(windows) && !path.extension().map(|e| e.eq_ignore_ascii_case("exe")).unwrap_or(false) {
        return Err("pkg.errNotExe".into());
    }
    if args.len() > 64 || args.iter().any(|a| a.len() > 1024 || a.contains('\0')) {
        return Err("pkg.errBadArgs".into());
    }
    let wd = working_dir
        .filter(|d| !d.trim().is_empty() && Path::new(d).is_dir())
        .map(PathBuf::from)
        .unwrap_or_else(|| path.parent().map(|p| p.to_path_buf()).unwrap_or_default());
    crate::commands::crash::log_line(format!("[PKG] launching {} with {} argument(s)", path.display(), args.len()));
    let child = crate::commands::proc::hidden_command(&path)
        .args(&args)
        .current_dir(&wd)
        .spawn()
        .map_err(|e| format!("pkg.errLaunch|{e}"))?;
    Ok(child.id())
}

// ── Receipts ─────────────────────────────────────────────────────────────────────────────────

/// What the person was asked and what they answered.
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsentInput {
    pub task_id: String,
    pub pkg_id: String,
    pub file: String,
    pub root: String,
    pub dest: String,
    /// The exact text that was on screen. Hashed, never stored.
    pub text: String,
    /// `accepted` or `declined`.
    pub choice: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ConsentReceipt {
    pub seq: u64,
    pub at: String,
    pub task_id: String,
    pub pkg_id: String,
    pub file: String,
    pub root: String,
    pub dest: String,
    pub text_sha256: String,
    pub choice: String,
    pub prev: String,
    pub hash: String,
}

/// The canonical text a receipt's hash covers: every field but the hash, in a fixed order.
fn receipt_canonical(r: &ConsentReceipt) -> String {
    format!(
        "{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}\n{}",
        r.seq, r.at, r.task_id, r.pkg_id, r.file, r.root, r.dest, r.text_sha256, r.choice, r.prev
    )
}

fn consent_path(state: &AppState) -> PathBuf {
    state.data_path.parent().map(|p| p.to_path_buf()).unwrap_or_else(std::env::temp_dir).join(CONSENTS)
}

/// Every receipt whose chain still holds, oldest first. A line that breaks the chain ends the
/// list: what follows a forged line proves nothing.
pub fn read_receipts(path: &Path) -> Vec<ConsentReceipt> {
    let Ok(text) = std::fs::read_to_string(path) else { return Vec::new() };
    let mut out: Vec<ConsentReceipt> = Vec::new();
    let mut prev = "0".repeat(64);
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        let Ok(r) = serde_json::from_str::<ConsentReceipt>(line) else { break };
        if r.prev != prev || sha256_hex(receipt_canonical(&r).as_bytes()) != r.hash {
            break;
        }
        prev = r.hash.clone();
        out.push(r);
    }
    out
}

pub fn append_receipt(path: &Path, input: &ConsentInput) -> Result<ConsentReceipt, String> {
    let have = read_receipts(path);
    let clip = |s: &str, n: usize| s.chars().filter(|c| !c.is_control()).take(n).collect::<String>();
    let mut r = ConsentReceipt {
        seq: have.last().map(|x| x.seq + 1).unwrap_or(1),
        at: chrono::Utc::now().to_rfc3339(),
        task_id: clip(&input.task_id, 120),
        pkg_id: clip(&input.pkg_id, 64),
        file: clip(&input.file, 400),
        root: clip(&input.root, 16),
        dest: clip(&input.dest, 400),
        text_sha256: sha256_hex(input.text.as_bytes()),
        choice: if input.choice == "accepted" { "accepted".into() } else { "declined".into() },
        prev: have.last().map(|x| x.hash.clone()).unwrap_or_else(|| "0".repeat(64)),
        hash: String::new(),
    };
    r.hash = sha256_hex(receipt_canonical(&r).as_bytes());
    let mut f = std::fs::OpenOptions::new().create(true).append(true).open(path).map_err(|e| format!("pkg.errWrite|{e}"))?;
    writeln!(f, "{}", serde_json::to_string(&r).unwrap_or_default()).map_err(|e| format!("pkg.errWrite|{e}"))?;
    Ok(r)
}

/// Record an answer to « may this automation place this file there? ».
#[tauri::command]
pub fn automation_consent_record(state: State<'_, AppState>, input: ConsentInput) -> Result<ConsentReceipt, String> {
    let r = append_receipt(&consent_path(&state), &input)?;
    crate::commands::crash::log_line(format!("[PKG] consent #{} {} for task {} ({})", r.seq, r.choice, r.task_id, r.file));
    Ok(r)
}

/// The newest answer for exactly this placement (task, package, file, root, destination), if
/// any. A different package hash is a different question and has no answer yet.
#[tauri::command]
pub fn automation_consent_find(state: State<'_, AppState>, task_id: String, pkg_id: String, file: String, root: String, dest: String) -> Option<ConsentReceipt> {
    read_receipts(&consent_path(&state))
        .into_iter()
        .rev()
        .find(|r| r.task_id == task_id && r.pkg_id == pkg_id && r.file == file && r.root == root && r.dest == dest)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn entry_names_stay_inside_files() {
        assert_eq!(safe_entry_name("files/a.lua").as_deref(), Some("files/a.lua"));
        assert_eq!(safe_entry_name("files\\Mod\\x.lua").as_deref(), Some("files/Mod/x.lua"));
        for bad in ["a.lua", "files", "files/", "files/../x", "files/./x", "files/C:x", "/files/a", "files/a/../../b", "files/con.txt", "files/a. ", "files/a|b"] {
            assert!(safe_entry_name(bad).is_none(), "{bad} should be refused");
        }
    }

    #[test]
    fn destinations_are_relative_and_plain() {
        assert_eq!(safe_rel("Scripts/Hooks"), Some(PathBuf::from("Scripts").join("Hooks")));
        assert_eq!(safe_rel(""), Some(PathBuf::new()));
        for bad in ["../x", "C:/Windows", "C:\\x", "a/../../b", "\\\\host\\share", "a/./b", "nul"] {
            assert!(safe_rel(bad).is_none(), "{bad} should be refused");
        }
        // A leading slash is trimmed to a relative path, never read as the drive root.
        assert_eq!(safe_rel("/Scripts"), Some(PathBuf::from("Scripts")));
    }

    #[test]
    fn a_file_lands_under_dest_and_a_folder_keeps_its_shape() {
        let root = Path::new("R");
        let dest = PathBuf::from("Scripts").join("Hooks");
        assert_eq!(target_for(root, &dest, "files/gate.lua", "files/gate.lua"), root.join("Scripts").join("Hooks").join("gate.lua"));
        assert_eq!(target_for(root, Path::new(""), "files/MyMod", "files/MyMod/a/b.txt"), root.join("MyMod").join("a").join("b.txt"));
    }

    #[test]
    fn the_document_lists_what_is_packed_not_what_it_claimed() {
        let doc = serde_json::json!({ "magic": "BMMPA", "version": 1, "tasks": [], "package": { "files": [{ "name": "files/lie", "sha256": "00", "size": 1 }] } });
        let payload = vec![("files/a.txt".to_string(), b"hello".to_vec())];
        let out = finish_doc(doc, &payload).unwrap();
        assert_eq!(out["version"], 2);
        let files = declared_files(&out).unwrap();
        assert_eq!(files, vec![PkgFile { name: "files/a.txt".into(), sha256: sha256_hex(b"hello"), size: 5 }]);
        assert!(finish_doc(serde_json::json!({ "tasks": [] }), &payload).is_err(), "not an automation");
    }

    #[test]
    fn payload_checks_refuse_extras_and_changed_files() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(dir.path().join("files")).unwrap();
        std::fs::write(dir.path().join("files").join("a.txt"), b"hello").unwrap();
        let good = vec![PkgFile { name: "files/a.txt".into(), sha256: sha256_hex(b"hello"), size: 5 }];
        assert!(check_payload(dir.path(), &good, &["files/a.txt".into()]).is_ok());
        let changed = vec![PkgFile { name: "files/a.txt".into(), sha256: sha256_hex(b"other"), size: 5 }];
        assert!(check_payload(dir.path(), &changed, &[]).unwrap_err().starts_with("pkg.errHash"));
        assert!(check_payload(dir.path(), &good, &["files/a.txt".into(), "files/extra".into()]).unwrap_err().starts_with("pkg.errHash"));
        let missing = vec![PkgFile { name: "files/gone".into(), sha256: sha256_hex(b"x"), size: 1 }];
        assert!(check_payload(dir.path(), &missing, &[]).unwrap_err().starts_with("pkg.errNoFile"));
    }

    #[test]
    fn a_package_round_trips_and_a_changed_one_is_refused() {
        // Unsigned here (no keyring in a unit test); the archive list is verified by the same
        // doc_sign functions whose own tests sign with a fixed key.
        let dir = tempfile::tempdir().unwrap();
        let payload = vec![("files/gate.lua".to_string(), b"-- hook".to_vec())];
        let doc = finish_doc(serde_json::json!({ "magic": "BMMPA", "tasks": [{ "name": "t", "steps": [] }] }), &payload).unwrap();
        let doc_bytes = serde_json::to_vec_pretty(&doc).unwrap();
        let mut entries = vec![(DOC_ENTRY.to_string(), doc_bytes.clone())];
        entries.extend(payload.clone());
        let out = dir.path().join("p.bmmbundle");
        let ticket = crate::governor::runtime::global().begin(crate::governor::config::OpKind::Compress, "test");
        write_zip(&out, &entries, &ticket).unwrap();
        let stage = dir.path().join("x");
        crate::archive::extract_to(&out, &stage).unwrap();
        let names = walk_names(&stage);
        assert!(names.contains(&"files/gate.lua".to_string()));
        let declared = declared_files(&doc).unwrap();
        assert!(check_payload(&stage, &declared, &["files/gate.lua".into()]).is_ok());
        std::fs::write(stage.join("files").join("gate.lua"), b"-- changed").unwrap();
        assert!(check_payload(&stage, &declared, &[]).is_err());
    }

    #[test]
    fn receipts_chain_and_a_forged_line_ends_the_proof() {
        let dir = tempfile::tempdir().unwrap();
        let p = dir.path().join(CONSENTS);
        let input = ConsentInput {
            task_id: "t1".into(), pkg_id: "abc".into(), file: "files/gate.lua".into(), root: "dcs".into(),
            dest: "Scripts/Hooks".into(), text: "May it?".into(), choice: "accepted".into(),
        };
        let a = append_receipt(&p, &input).unwrap();
        let b = append_receipt(&p, &ConsentInput { choice: "declined".into(), ..input.clone() }).unwrap();
        assert_eq!(b.prev, a.hash);
        assert_eq!(read_receipts(&p).len(), 2);
        assert_eq!(b.choice, "declined");
        // Editing the first answer breaks the chain from there on.
        let text = std::fs::read_to_string(&p).unwrap().replacen("\"accepted\"", "\"declined\"", 1);
        std::fs::write(&p, text).unwrap();
        assert!(read_receipts(&p).is_empty());
    }

    #[test]
    fn a_list_fingerprint_ignores_order_and_case_but_not_versions() {
        let a = list_fingerprint(&[("A-4E".into(), "2.1".into()), ("Hercules".into(), "6.8".into())]);
        let b = list_fingerprint(&[("hercules".into(), "6.8".into()), ("a-4e".into(), "2.1".into())]);
        let c = list_fingerprint(&[("hercules".into(), "6.7".into()), ("a-4e".into(), "2.1".into())]);
        assert_eq!(a, b);
        assert_ne!(a, c);
        assert_eq!(a.len(), 16);
    }

    #[test]
    fn launching_needs_the_grant_and_an_executable() {
        assert_eq!(launch_with_args("C:/nope.exe".into(), vec![], None, false).unwrap_err(), "pkg.errNotAllowed");
        assert_eq!(launch_with_args("Z:/definitely/not/here.exe".into(), vec![], None, true).unwrap_err(), "pkg.errNotFound");
    }
}
