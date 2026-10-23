//! What FORMAT a `repo.json` is written in, and how an old one becomes the current one.
//!
//! Until format 1.0 a manifest said nothing about its own shape. Its `version` field is the
//! REPO's version (the author's "1.0.0"), not the format's, so the only way to know what a
//! manifest was written by was to read it and guess. Five shapes are in circulation — every
//! one a BMM of its day wrote — and the oldest does not even load in today's reader: it has
//! no `download_links` on its mods, and serde refuses the whole document over that, which
//! the user sees as an EMPTY repo, not an old one.
//!
//! So a manifest now says what it is: `"format_version": "1.0"` at the top level. This
//! module owns:
//!
//!  - the registry of every format, with what each one added ([`REGISTRY`]);
//!  - detection — the declared version when there is one, the SHAPE when there is not
//!    ([`detect`]);
//!  - the read gate — what BMM refuses ([`read_gate`]);
//!  - the conversion of any older shape to 1.0 ([`convert`]): the missing keys filled, the
//!    files re-hashed from disk, the format stamped. Signing is NOT done here: it needs the
//!    user's key, which only the app holds. The caller re-signs (see `repo_convert`).
//!
//! It works on `serde_json::Value`, not on `ServerRepo`, on purpose: a legacy manifest is
//! exactly the document the struct cannot read, and the CLI mounts this file on its own
//! (`extra_tools/mcp_server.rs`), without the app's models. No `crate::` path in here.

use serde::Serialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::io::Read;
use std::path::{Component, Path, PathBuf};

/// The format BMM writes.
pub const CURRENT: &str = "1.0";
/// The major BMM reads. A manifest declaring a higher one is refused.
pub const CURRENT_MAJOR: u32 = 1;
/// Files above this carry a per-chunk table. Same value as `repo::CHUNK_SIZE`, restated so
/// this file stays mountable alone; `chunk_size_matches_the_sync` in repo.rs pins the two.
pub const CHUNK_SIZE: u64 = 4 * 1024 * 1024;
/// The top-level key. `formatVersion` is accepted on read, never written.
pub const KEY: &str = "format_version";

/// One known format.
#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatEntry {
    pub version: &'static str,
    /// Short name shown next to the number.
    pub name: &'static str,
    /// When BMM started writing it.
    pub since: &'static str,
    /// What it added over the previous one.
    pub added: &'static str,
    /// Whether today's BMM reads it as-is. `false` = only after the in-memory upgrade.
    pub reads_as_is: bool,
}

/// Every format, oldest first. Dates are the commits that introduced each shape
/// (`git log -S` on the field names in `models/repo.rs`).
pub const REGISTRY: &[FormatEntry] = &[
    FormatEntry {
        version: "0.1", name: "first export", since: "2026-03",
        added: "name, description, author, version, game_name, created_at, profiles; mods with tags and files (relative_path, size, sha256_hash)",
        reads_as_is: false,
    },
    FormatEntry {
        version: "0.2", name: "signed", since: "2026-03",
        added: "author_id + signature (ed25519), seed, upload_limit; mod download_links; file chunks",
        reads_as_is: true,
    },
    FormatEntry {
        version: "0.3", name: "modpacks", since: "2026-04",
        added: "modpacks, require_login; mod archive (zip mods), dependencies, changelog, update sources; profile icon/color",
        reads_as_is: true,
    },
    FormatEntry {
        version: "0.4", name: "hosting", since: "2026-08",
        added: "files_base_url, files_layout, file mtime, extras, sealed credentials",
        reads_as_is: true,
    },
    FormatEntry {
        version: "1.0", name: "versioned", since: "2026-10",
        added: "format_version; every required key written; the signature covers the format",
        reads_as_is: true,
    },
];

/// Where a manifest stands with this BMM.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum FormatStatus {
    /// Declares the format BMM writes.
    Current,
    /// Unversioned, readable as-is. Converting is recommended, not required.
    Legacy,
    /// Unversioned and NOT readable as-is (the 0.1 shape, or a required key missing).
    /// BMM reads it through the in-memory upgrade; converting fixes the file itself.
    NeedsConversion,
    /// Declares a later 1.x. Read; fields this BMM does not know are ignored.
    NewerMinor,
    /// Declares a major this BMM does not know. Refused.
    TooNew,
    /// Not a manifest at all (not an object), or an unreadable declared version.
    Invalid,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    /// "1.0", "0.3", "1.2", "2.0"… or "" when there is nothing to report.
    pub version: String,
    /// True when it came from `format_version`, false when it was inferred from the shape.
    pub declared: bool,
    pub status: FormatStatus,
    /// Required keys the strict reader would refuse the document over, as JSON paths.
    /// Capped: the first few say what is wrong, a thousand say nothing more.
    pub missing: Vec<String>,
}

impl FormatInfo {
    /// The words the UI and the CLI show: « format 1.0 », « legacy 0.3 ».
    pub fn label(&self) -> String {
        match self.status {
            FormatStatus::Current | FormatStatus::NewerMinor => format!("format {}", self.version),
            FormatStatus::Legacy | FormatStatus::NeedsConversion => format!("legacy {}", self.version),
            FormatStatus::TooNew => format!("format {} (newer than this BMM)", self.version),
            FormatStatus::Invalid => "not a repo manifest".to_string(),
        }
    }
}

/// `"1.0"` → (1, 0). A bare `"1"` is 1.0. Anything else is `None`.
pub fn parse_version(s: &str) -> Option<(u32, u32)> {
    let s = s.trim();
    let mut it = s.splitn(2, '.');
    let major: u32 = it.next()?.parse().ok()?;
    let minor: u32 = match it.next() {
        None => 0,
        Some(m) => m.parse().ok()?,
    };
    Some((major, minor))
}

fn declared_version(v: &Value) -> Option<&Value> {
    v.get(KEY).or_else(|| v.get("formatVersion"))
}

const MISSING_CAP: usize = 8;

/// Required keys, by the rules of `models/repo.rs`: a key without `#[serde(default)]` and
/// not an `Option` must be present or the whole document fails. Checked structurally so the
/// answer exists without the struct (the CLI) and names the PATH, which serde does not.
fn missing_required(v: &Value) -> Vec<String> {
    fn need(obj: &Map<String, Value>, keys: &[&str], at: &str, out: &mut Vec<String>) {
        for k in keys {
            if out.len() >= MISSING_CAP { return; }
            if !obj.contains_key(*k) { out.push(format!("{at}.{k}")); }
        }
    }
    let mut out = Vec::new();
    let Some(profiles) = v.get("profiles").and_then(Value::as_array) else { return out };
    for (pi, p) in profiles.iter().enumerate() {
        let Some(po) = p.as_object() else { out.push(format!("profiles[{pi}]")); continue };
        need(po, &["id", "name", "game_name", "mods"], &format!("profiles[{pi}]"), &mut out);
        let Some(mods) = po.get("mods").and_then(Value::as_array) else { continue };
        for (mi, m) in mods.iter().enumerate() {
            let at = format!("profiles[{pi}].mods[{mi}]");
            let Some(mo) = m.as_object() else { out.push(at); continue };
            need(mo, &["id", "name", "version", "tags", "files", "download_links"], &at, &mut out);
            for (ti, t) in mo.get("tags").and_then(Value::as_array).into_iter().flatten().enumerate() {
                if let Some(to) = t.as_object() {
                    need(to, &["id", "name", "color_bg", "color_text"], &format!("{at}.tags[{ti}]"), &mut out);
                }
            }
            for (fi, f) in mo.get("files").and_then(Value::as_array).into_iter().flatten().enumerate() {
                if let Some(fo) = f.as_object() {
                    need(fo, &["relative_path", "size", "sha256_hash"], &format!("{at}.files[{fi}]"), &mut out);
                }
            }
            if out.len() >= MISSING_CAP { return out; }
        }
    }
    out
}

fn has_any(o: &Map<String, Value>, keys: &[&str]) -> bool {
    keys.iter().any(|k| o.contains_key(*k))
}

fn mods_of(v: &Value) -> impl Iterator<Item = &Map<String, Value>> {
    v.get("profiles").and_then(Value::as_array).into_iter().flatten()
        .filter_map(|p| p.get("mods").and_then(Value::as_array))
        .flatten()
        .filter_map(Value::as_object)
}

/// The oldest format whose shape matches — newest marker wins.
fn shape_version(v: &Value) -> &'static str {
    let Some(top) = v.as_object() else { return "0.1" };
    let files_have_mtime = mods_of(v)
        .flat_map(|m| m.get("files").and_then(Value::as_array).into_iter().flatten())
        .any(|f| f.get("mtime").is_some());
    if has_any(top, &["files_base_url", "filesBaseUrl", "files_layout", "filesLayout", "extras", "credentials"]) || files_have_mtime {
        return "0.4";
    }
    let profile_looks = v.get("profiles").and_then(Value::as_array).into_iter().flatten()
        .filter_map(Value::as_object)
        .any(|p| has_any(p, &["icon", "color", "icon_image"]));
    let mod_looks = mods_of(v).any(|m| has_any(m, &["archive", "dependencies", "changelog", "update_url", "direct_url", "update_sources"]));
    if has_any(top, &["modpacks", "require_login", "requireLogin"]) || profile_looks || mod_looks {
        return "0.3";
    }
    let every_mod_has_links = mods_of(v).all(|m| m.contains_key("download_links"));
    if has_any(top, &["author_id", "signature", "seed", "upload_limit"]) && every_mod_has_links {
        return "0.2";
    }
    "0.1"
}

/// What this manifest is.
pub fn detect(v: &Value) -> FormatInfo {
    if !v.is_object() {
        return FormatInfo { version: String::new(), declared: false, status: FormatStatus::Invalid, missing: vec![] };
    }
    let missing = missing_required(v);
    if let Some(d) = declared_version(v) {
        // A number (`1.0`) is tolerated, as a hand-written manifest will try it.
        let text = match d {
            Value::String(s) => s.trim().to_string(),
            Value::Number(n) => n.to_string(),
            _ => String::new(),
        };
        return match parse_version(&text) {
            None => FormatInfo { version: text, declared: true, status: FormatStatus::Invalid, missing },
            Some((major, minor)) => {
                let version = format!("{major}.{minor}");
                let status = if major > CURRENT_MAJOR {
                    FormatStatus::TooNew
                } else if major < 1 {
                    // A manifest claiming "0.x" is a legacy one that knows it.
                    if missing.is_empty() { FormatStatus::Legacy } else { FormatStatus::NeedsConversion }
                } else if !missing.is_empty() {
                    // Says 1.x, is not: a hand edit or a foreign generator. Same treatment
                    // as an old file — read through the upgrade, offer to fix it.
                    FormatStatus::NeedsConversion
                } else if (major, minor) == parse_version(CURRENT).unwrap_or((1, 0)) {
                    FormatStatus::Current
                } else if minor > parse_version(CURRENT).map(|v| v.1).unwrap_or(0) {
                    FormatStatus::NewerMinor
                } else {
                    FormatStatus::Current
                };
                FormatInfo { version, declared: true, status, missing }
            }
        };
    }
    let version = shape_version(v).to_string();
    let status = if missing.is_empty() && version != "0.1" { FormatStatus::Legacy } else { FormatStatus::NeedsConversion };
    FormatInfo { version, declared: false, status, missing }
}

/// What BMM refuses to read. `Err` carries an i18n key.
pub fn read_gate(info: &FormatInfo) -> Result<(), &'static str> {
    match info.status {
        FormatStatus::TooNew => Err("repo.errFormatTooNew"),
        FormatStatus::Invalid if info.declared => Err("repo.errFormatInvalid"),
        _ => Ok(()),
    }
}

/// One line of a conversion's diff.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Change {
    /// `format` · `key_added` · `value_normalised` · `hash_filled` · `hash_changed` ·
    /// `size_changed` · `chunks_updated` · `file_missing` · `signature_removed` ·
    /// `unknown_key`.
    pub kind: &'static str,
    /// JSON path in the manifest (`profiles[0].mods[2].files[5].sha256_hash`).
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub before: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub after: Option<String>,
}

fn change(kind: &'static str, path: impl Into<String>, before: Option<String>, after: Option<String>) -> Change {
    Change { kind, path: path.into(), before, after }
}

fn short(v: &Value) -> String {
    let s = match v { Value::String(s) => s.clone(), other => other.to_string() };
    if s.chars().count() > 24 { format!("{}…", s.chars().take(23).collect::<String>()) } else { s }
}

/// The top-level keys the 1.0 writer knows. Anything else is reported: BMM's writer goes
/// through the struct, which drops what it has no field for.
const KNOWN_TOP: &[&str] = &[
    "name", "description", "author", "author_id", "signature", "version", "game_name", "created_at",
    "seed", "upload_limit", "require_login", "requireLogin", "files_base_url", "filesBaseUrl",
    "files_layout", "filesLayout", "profiles", "modpacks", "extras", "credentials", KEY, "formatVersion",
];

/// Fill every key the strict reader requires, with the value that means what the old
/// manifest meant by leaving it out. Lossless: nothing present is changed except a blank
/// `description` / `author` (the 0.1 writer wrote "" for "none"), which becomes `null`.
pub fn upgrade_keys(v: &mut Value, changes: &mut Vec<Change>) {
    let Some(top) = v.as_object_mut() else { return };
    let defaults: [(&str, Value); 11] = [
        ("name", json!("Repo")), ("description", Value::Null), ("author", Value::Null),
        ("author_id", Value::Null), ("signature", Value::Null), ("version", json!("1.0")),
        ("game_name", json!("")), ("seed", Value::Null), ("upload_limit", Value::Null),
        ("profiles", json!([])), ("modpacks", Value::Null),
    ];
    for (k, d) in defaults {
        if !top.contains_key(k) {
            changes.push(change("key_added", k, None, Some(short(&d))));
            top.insert(k.to_string(), d);
        }
    }
    if !top.contains_key("created_at") {
        // Unknown, so "now" — the struct's own default, and never the epoch.
        let now = chrono::Utc::now().to_rfc3339();
        changes.push(change("key_added", "created_at", None, Some(now.clone())));
        top.insert("created_at".into(), json!(now));
    }
    for k in ["description", "author"] {
        if top.get(k).and_then(Value::as_str).is_some_and(|s| s.trim().is_empty()) {
            changes.push(change("value_normalised", k, Some("\"\"".into()), Some("null".into())));
            top.insert(k.into(), Value::Null);
        }
    }
    // The camelCase spellings are accepted on read; 1.0 writes one spelling.
    for (camel, snake) in [("requireLogin", "require_login"), ("filesBaseUrl", "files_base_url"), ("filesLayout", "files_layout"), ("formatVersion", KEY)] {
        if let Some(val) = top.remove(camel) {
            changes.push(change("value_normalised", camel, Some(camel.into()), Some(snake.into())));
            top.entry(snake.to_string()).or_insert(val);
        }
    }
    let unknown: Vec<String> = top.keys().filter(|k| !KNOWN_TOP.contains(&k.as_str())).cloned().collect();
    for k in unknown {
        changes.push(change("unknown_key", k, None, None));
    }

    let Some(profiles) = top.get_mut("profiles").and_then(Value::as_array_mut) else { return };
    for (pi, p) in profiles.iter_mut().enumerate() {
        let Some(po) = p.as_object_mut() else { continue };
        let at = format!("profiles[{pi}]");
        for (k, d) in [("id", json!(format!("profile-{pi}"))), ("name", json!(format!("Profile {}", pi + 1))), ("game_name", json!("")), ("mods", json!([]))] {
            if !po.contains_key(k) {
                changes.push(change("key_added", format!("{at}.{k}"), None, Some(short(&d))));
                po.insert(k.into(), d);
            }
        }
        let Some(mods) = po.get_mut("mods").and_then(Value::as_array_mut) else { continue };
        for (mi, m) in mods.iter_mut().enumerate() {
            let Some(mo) = m.as_object_mut() else { continue };
            let at = format!("{at}.mods[{mi}]");
            let fallback_id = mo.get("name").and_then(Value::as_str).unwrap_or("mod").to_string();
            for (k, d) in [("id", json!(fallback_id)), ("name", json!(fallback_id)), ("version", json!("0")), ("tags", json!([])), ("files", json!([])), ("download_links", json!([]))] {
                if !mo.contains_key(k) {
                    changes.push(change("key_added", format!("{at}.{k}"), None, Some(short(&d))));
                    mo.insert(k.into(), d);
                }
            }
            for k in ["description", "author"] {
                if mo.get(k).and_then(Value::as_str).is_some_and(|s| s.trim().is_empty()) {
                    changes.push(change("value_normalised", format!("{at}.{k}"), Some("\"\"".into()), Some("null".into())));
                    mo.insert(k.into(), Value::Null);
                }
            }
            if let Some(tags) = mo.get_mut("tags").and_then(Value::as_array_mut) {
                for (ti, t) in tags.iter_mut().enumerate() {
                    // A bare string tag ("hd") from a hand-written manifest becomes the
                    // object the reader needs, named after itself.
                    if let Value::String(s) = t {
                        let s = s.clone();
                        changes.push(change("value_normalised", format!("{at}.tags[{ti}]"), Some(s.clone()), Some("{id,name,color_bg,color_text}".into())));
                        *t = json!({ "id": s, "name": s, "color_bg": "#444444", "color_text": "#ffffff" });
                        continue;
                    }
                    let Some(to) = t.as_object_mut() else { continue };
                    let name = to.get("name").or_else(|| to.get("id")).and_then(Value::as_str).unwrap_or("tag").to_string();
                    for (k, d) in [("id", json!(name)), ("name", json!(name)), ("color_bg", json!("#444444")), ("color_text", json!("#ffffff"))] {
                        if !to.contains_key(k) {
                            changes.push(change("key_added", format!("{at}.tags[{ti}].{k}"), None, Some(short(&d))));
                            to.insert(k.into(), d);
                        }
                    }
                }
            }
            if let Some(files) = mo.get_mut("files").and_then(Value::as_array_mut) {
                for (fi, f) in files.iter_mut().enumerate() {
                    let Some(fo) = f.as_object_mut() else { continue };
                    for (k, d) in [("size", json!(0)), ("sha256_hash", json!("")), ("chunks", Value::Null)] {
                        if !fo.contains_key(k) {
                            changes.push(change("key_added", format!("{at}.files[{fi}].{k}"), None, Some(short(&d))));
                            fo.insert(k.into(), d);
                        }
                    }
                }
            }
        }
    }
}

/// A manifest-relative path, joined under `root` only if it cannot leave it.
fn safe_join(root: &Path, rel: &str) -> Option<PathBuf> {
    let rel = rel.replace('\\', "/");
    let p = Path::new(&rel);
    if rel.is_empty() || p.is_absolute() || rel.contains(':') { return None; }
    if !p.components().all(|c| matches!(c, Component::Normal(_))) { return None; }
    Some(root.join(p))
}

/// Same rule as `repo::mod_file_tail`, restated for the reason the module header gives;
/// `layout_matches_the_sync` in repo.rs pins the two together.
pub fn file_tail(files_layout: Option<&str>, mod_id: &str, relative_path: &str) -> String {
    let path = relative_path.replace('\\', "/");
    let layout = files_layout.map(str::trim).filter(|l| !l.is_empty()).unwrap_or("mods/{id}/{path}");
    layout.trim_start_matches('/').replace("{id}", mod_id).replace("{path}", &path)
}

/// sha256 of the whole file, and the chunk table when it is larger than one chunk — the
/// exporter's rule (`compute_file_hash_and_chunks`).
pub fn hash_file(path: &Path) -> std::io::Result<(u64, String, Option<Vec<Value>>)> {
    let size = std::fs::metadata(path)?.len();
    let want_chunks = size > CHUNK_SIZE;
    let mut reader = std::io::BufReader::with_capacity(128 * 1024, std::fs::File::open(path)?);
    let mut whole = Sha256::new();
    let mut chunks = Vec::new();
    let mut buf = vec![0u8; CHUNK_SIZE as usize];
    loop {
        // Fill a whole chunk: a short read must not split one chunk into two entries.
        let mut n = 0;
        while n < buf.len() {
            let r = reader.read(&mut buf[n..])?;
            if r == 0 { break; }
            n += r;
        }
        if n == 0 { break; }
        whole.update(&buf[..n]);
        if want_chunks {
            chunks.push(json!({ "size": n as u32, "sha256_hash": format!("{:x}", Sha256::digest(&buf[..n])) }));
        }
        if n < buf.len() { break; }
    }
    Ok((size, format!("{:x}", whole.finalize()), if want_chunks && !chunks.is_empty() { Some(chunks) } else { None }))
}

/// What hashing one file gives: its size, the sha256 of the whole, the chunk table.
pub type Hashed = (u64, String, Option<Vec<Value>>);

/// Hashes a list of files, in order, one result per path (`Err` = not readable). The app
/// injects one that runs on the resource governor's Hash pool, reports progress and can be
/// cancelled (`Err` from the whole call); this file stays mountable alone with
/// [`hash_in_order`], the plain sequential one.
pub type HashAll<'a> = &'a dyn Fn(&[PathBuf]) -> Result<Vec<std::io::Result<Hashed>>, String>;

/// The plain hasher: one file after the other, on this thread.
#[allow(dead_code)] // the CLI's mount (mcp/server.rs) and the tests; the app injects its hasher
pub fn hash_in_order(paths: &[PathBuf]) -> Result<Vec<std::io::Result<Hashed>>, String> {
    Ok(paths.iter().map(|p| hash_file(p)).collect())
}

/// Apply one file's hash to its entry.
fn rehash_entry(entry: &mut Map<String, Value>, hashed: std::io::Result<Hashed>, at: &str, changes: &mut Vec<Change>, missing: &mut usize) {
    let Ok((size, hash, chunks)) = hashed else {
        *missing += 1;
        changes.push(change("file_missing", at.to_string(), None, None));
        return;
    };
    let old_hash = entry.get("sha256_hash").and_then(Value::as_str).unwrap_or("").to_string();
    if old_hash.is_empty() {
        changes.push(change("hash_filled", format!("{at}.sha256_hash"), None, Some(hash[..12].to_string())));
    } else if !old_hash.eq_ignore_ascii_case(&hash) {
        changes.push(change("hash_changed", format!("{at}.sha256_hash"), Some(old_hash.chars().take(12).collect()), Some(hash[..12].to_string())));
    }
    let old_size = entry.get("size").and_then(Value::as_u64).unwrap_or(0);
    if old_size != size {
        changes.push(change("size_changed", format!("{at}.size"), Some(old_size.to_string()), Some(size.to_string())));
    }
    let new_chunks = chunks.map(Value::Array).unwrap_or(Value::Null);
    if entry.get("chunks").unwrap_or(&Value::Null) != &new_chunks {
        let n = new_chunks.as_array().map(Vec::len).unwrap_or(0);
        changes.push(change("chunks_updated", format!("{at}.chunks"), None, Some(if n == 0 { "null".into() } else { format!("{n} chunk(s)") })));
    }
    entry.insert("sha256_hash".into(), json!(hash));
    entry.insert("size".into(), json!(size));
    entry.insert("chunks".into(), new_chunks);
}

/// One file the manifest lists: where its entry is (a JSON pointer), how a report names it,
/// and where it is on disk.
struct Target { pointer: String, at: String, disk: PathBuf }

/// Every file the manifest lists that is on this disk, in manifest order.
fn targets(v: &Value, repo_dir: &Path, warnings: &mut Vec<String>) -> Vec<Target> {
    let mut out = Vec::new();
    let layout = v.get("files_layout").and_then(Value::as_str).map(str::to_string);
    let str_at = |o: &Value, k: &str| o.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    if let Some(profiles) = v.get("profiles").and_then(Value::as_array) {
        for (pi, p) in profiles.iter().enumerate() {
            let Some(mods) = p.get("mods").and_then(Value::as_array) else { continue };
            for (mi, m) in mods.iter().enumerate() {
                if !m.is_object() { continue; }
                let id = str_at(m, "id");
                let at = format!("profiles[{pi}].mods[{mi}]");
                let ptr = format!("/profiles/{pi}/mods/{mi}");
                if let Some(arch) = m.get("archive").filter(|a| a.is_object()) {
                    let rel = str_at(arch, "relative_path");
                    match safe_join(repo_dir, &rel) {
                        Some(disk) => out.push(Target { pointer: format!("{ptr}/archive"), at: format!("{at}.archive"), disk }),
                        None => warnings.push(format!("{at}.archive: unsafe path {rel:?} left unhashed")),
                    }
                }
                let Some(files) = m.get("files").and_then(Value::as_array) else { continue };
                for (fi, f) in files.iter().enumerate() {
                    if !f.is_object() { continue; }
                    let rel = str_at(f, "relative_path");
                    let tail = file_tail(layout.as_deref(), &id, &rel);
                    match safe_join(repo_dir, &tail) {
                        Some(disk) => out.push(Target { pointer: format!("{ptr}/files/{fi}"), at: format!("{at}.files[{fi}]"), disk }),
                        None => warnings.push(format!("{at}.files[{fi}]: unsafe path {rel:?} left unhashed")),
                    }
                }
            }
        }
    }
    if let Some(extras) = v.get("extras").and_then(Value::as_array) {
        for (ei, e) in extras.iter().enumerate() {
            let kind = str_at(e, "kind");
            let Some(fo) = e.get("file").filter(|f| f.is_object()) else { continue };
            let rel = str_at(fo, "relative_path");
            match safe_join(repo_dir, &format!("extras/{kind}/{rel}")) {
                Some(disk) => out.push(Target { pointer: format!("/extras/{ei}/file"), at: format!("extras[{ei}].file"), disk }),
                None => warnings.push(format!("extras[{ei}]: unsafe path {rel:?} left unhashed")),
            }
        }
    }
    out
}

/// Re-hash every file the manifest lists, from the repo folder. Returns how many were not
/// found. Files hosted elsewhere (`files_base_url`) are not on this disk: left as they are.
#[allow(dead_code)] // the CLI's mount (mcp/server.rs) and the tests; the app injects its hasher
pub fn rehash(v: &mut Value, repo_dir: &Path, changes: &mut Vec<Change>, warnings: &mut Vec<String>) -> usize {
    rehash_with(v, repo_dir, changes, warnings, &hash_in_order).unwrap_or(0)
}

/// [`rehash`] with the hasher injected: every path is collected first, hashed in ONE call
/// (in parallel, in the app), then applied in manifest order, so the report reads the same
/// whatever the hasher. `Err` = the hasher stopped (cancelled); nothing was applied.
pub fn rehash_with(v: &mut Value, repo_dir: &Path, changes: &mut Vec<Change>, warnings: &mut Vec<String>, hash_all: HashAll<'_>) -> Result<usize, String> {
    let mut missing = 0usize;
    if v.get("files_base_url").and_then(Value::as_str).is_some_and(|s| !s.trim().is_empty()) {
        warnings.push("files_base_url: the files live on another host, so their hashes were kept as they are".into());
        return Ok(0);
    }
    let list = targets(v, repo_dir, warnings);
    let paths: Vec<PathBuf> = list.iter().map(|t| t.disk.clone()).collect();
    let results = hash_all(&paths)?;
    for (t, hashed) in list.into_iter().zip(results) {
        if let Some(entry) = v.pointer_mut(&t.pointer).and_then(Value::as_object_mut) {
            rehash_entry(entry, hashed, &t.at, changes, &mut missing);
        }
    }
    Ok(missing)
}

#[derive(Debug, Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertCounts {
    pub keys_added: usize,
    pub hashes_filled: usize,
    pub hashes_changed: usize,
    pub files_missing: usize,
}

/// The result of a conversion, written or not.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConvertPlan {
    pub from: FormatInfo,
    pub to: &'static str,
    /// Nothing to do: already the current format, and (when re-hashed) every hash matched.
    pub up_to_date: bool,
    /// The original carried a signature. The conversion invalidates it, by construction:
    /// the format key is part of what is signed.
    pub was_signed: bool,
    pub previous_author_id: Option<String>,
    pub changes: Vec<Change>,
    pub counts: ConvertCounts,
    pub warnings: Vec<String>,
    /// The converted manifest, UNSIGNED (`author_id` and `signature` null).
    #[serde(skip)]
    pub manifest: Value,
}

/// Convert any readable shape to the current format.
///
/// `repo_dir` = the folder holding `repo.json`; `Some` re-hashes every file from it. The
/// result is unsigned — signing needs the user's key (the caller's job). Refuses a manifest
/// declaring a NEWER format: converting it "down" would drop what this BMM cannot see.
#[allow(dead_code)] // the CLI's mount (mcp/server.rs) and the tests; the app injects its hasher
pub fn convert(v: Value, repo_dir: Option<&Path>) -> Result<ConvertPlan, String> {
    convert_with_hasher(v, repo_dir, &hash_in_order)
}

/// [`convert`] with the hasher injected (see [`HashAll`]).
pub fn convert_with_hasher(mut v: Value, repo_dir: Option<&Path>, hash_all: HashAll<'_>) -> Result<ConvertPlan, String> {
    let from = detect(&v);
    match from.status {
        FormatStatus::Invalid if !from.declared => return Err("repo.convert.errNotManifest".into()),
        FormatStatus::Invalid => return Err("repo.errFormatInvalid".into()),
        FormatStatus::TooNew | FormatStatus::NewerMinor => return Err("repo.convert.errNewer".into()),
        _ => {}
    }
    let mut changes = Vec::new();
    let mut warnings = Vec::new();
    let was_signed = v.get("signature").is_some_and(|s| !s.is_null());
    let previous_author_id = v.get("author_id").and_then(Value::as_str).map(str::to_string);

    upgrade_keys(&mut v, &mut changes);
    let files_missing = match repo_dir {
        Some(dir) => rehash_with(&mut v, dir, &mut changes, &mut warnings, hash_all)?,
        None => 0,
    };

    let top = v.as_object_mut().ok_or("repo.convert.errNotManifest")?;
    let declared = top.get(KEY).and_then(Value::as_str).map(str::to_string);
    if declared.as_deref() != Some(CURRENT) {
        changes.push(change("format", KEY, declared.or_else(|| Some(format!("(none — {})", from.version))), Some(CURRENT.into())));
        top.insert(KEY.into(), json!(CURRENT));
    }
    // Whatever was signed before is not this document any more.
    // Reports, not edits: an unknown key is left alone here, and a missing file keeps its entry.
    let content_changed = changes.iter().any(|c| !matches!(c.kind, "unknown_key" | "file_missing"));
    if was_signed && content_changed {
        changes.push(change("signature_removed", "signature", Some("ed25519".into()), None));
    }
    if content_changed || !was_signed {
        top.insert("author_id".into(), Value::Null);
        top.insert("signature".into(), Value::Null);
    }

    let counts = ConvertCounts {
        keys_added: changes.iter().filter(|c| c.kind == "key_added").count(),
        hashes_filled: changes.iter().filter(|c| c.kind == "hash_filled").count(),
        hashes_changed: changes.iter().filter(|c| c.kind == "hash_changed").count(),
        files_missing,
    };
    if files_missing > 0 {
        warnings.push(format!("{files_missing} file(s) listed in the manifest are not in the folder; their entries were kept as they were"));
    }
    Ok(ConvertPlan {
        up_to_date: !content_changed,
        from,
        to: CURRENT,
        was_signed,
        previous_author_id,
        changes,
        counts,
        warnings,
        manifest: v,
    })
}

/// The backup name for the manifest a conversion replaces: `repo.json.v0.3-20261013-101500.bak`.
/// Never served: the built-in and mini servers only serve `repo.json` and `info.json` at the
/// repo root.
pub fn backup_name(from_version: &str, now: chrono::DateTime<chrono::Utc>) -> String {
    let v = if from_version.is_empty() { "unknown" } else { from_version };
    format!("repo.json.v{}-{}.bak", v, now.format("%Y%m%d-%H%M%S"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // One fixture per legacy shape, each the exact key set a BMM of that day wrote
    // (`git show <commit>:src-tauri/src/models/repo.rs`). Written by hand from those
    // structs: no manifest of the period was committed.
    const V01: &str = include_str!("../../tests/repo_format/v0.1-first-export.json");
    const V02: &str = include_str!("../../tests/repo_format/v0.2-signed.json");
    const V03: &str = include_str!("../../tests/repo_format/v0.3-modpacks.json");
    const V04: &str = include_str!("../../tests/repo_format/v0.4-hosting.json");
    const V10: &str = include_str!("../../tests/repo_format/v1.0.json");

    fn val(s: &str) -> Value { serde_json::from_str(s).unwrap() }

    #[test]
    fn every_fixture_is_detected_as_its_own_format() {
        for (src, want, status) in [
            (V01, "0.1", FormatStatus::NeedsConversion),
            (V02, "0.2", FormatStatus::Legacy),
            (V03, "0.3", FormatStatus::Legacy),
            (V04, "0.4", FormatStatus::Legacy),
            (V10, "1.0", FormatStatus::Current),
        ] {
            let info = detect(&val(src));
            assert_eq!(info.version, want, "{info:?}");
            assert_eq!(info.status, status, "{info:?}");
            assert_eq!(info.declared, want == "1.0");
        }
    }

    #[test]
    fn the_first_export_names_what_the_reader_refuses() {
        let info = detect(&val(V01));
        assert!(info.missing.iter().any(|m| m.ends_with(".download_links")), "{:?}", info.missing);
    }

    #[test]
    fn declared_versions_gate_the_reader() {
        let with = |v: Value| { let mut m = val(V10); m[KEY] = v; detect(&m) };
        assert_eq!(with(json!("1.0")).status, FormatStatus::Current);
        assert_eq!(with(json!("1")).status, FormatStatus::Current, "a bare major is .0");
        assert_eq!(with(json!(1.0)).status, FormatStatus::Current, "a number is tolerated");
        assert_eq!(with(json!("1.3")).status, FormatStatus::NewerMinor);
        assert_eq!(read_gate(&with(json!("1.3"))), Ok(()), "a newer minor is read");
        assert_eq!(with(json!("2.0")).status, FormatStatus::TooNew);
        assert_eq!(read_gate(&with(json!("2.0"))), Err("repo.errFormatTooNew"));
        assert_eq!(with(json!("banana")).status, FormatStatus::Invalid);
        assert_eq!(read_gate(&with(json!("banana"))), Err("repo.errFormatInvalid"));
        // An unversioned manifest is never refused on format grounds.
        assert_eq!(read_gate(&detect(&val(V01))), Ok(()));
        assert_eq!(detect(&json!([])).status, FormatStatus::Invalid);
    }

    #[test]
    fn a_manifest_claiming_one_point_oh_but_missing_keys_needs_conversion() {
        let mut m = val(V10);
        m["profiles"][0]["mods"][0].as_object_mut().unwrap().remove("download_links");
        assert_eq!(detect(&m).status, FormatStatus::NeedsConversion);
    }

    #[test]
    fn every_legacy_shape_converts_to_a_complete_one_point_oh() {
        for src in [V01, V02, V03, V04] {
            let plan = convert(val(src), None).unwrap();
            let after = detect(&plan.manifest);
            assert_eq!(after.status, FormatStatus::Current, "{:?} → {after:?}", plan.from);
            assert!(after.missing.is_empty(), "{:?}", after.missing);
            assert!(plan.changes.iter().any(|c| c.kind == "format"));
            assert!(plan.manifest["signature"].is_null() && plan.manifest["author_id"].is_null());
        }
    }

    #[test]
    fn the_first_export_keeps_what_it_said() {
        let plan = convert(val(V01), None).unwrap();
        let m = &plan.manifest;
        assert_eq!(m["name"], "Old Repo");
        assert_eq!(m["author"], "Someone", "a real author is kept");
        assert!(m["description"].is_null(), "the 0.1 writer's \"\" meant none");
        let f = &m["profiles"][0]["mods"][0]["files"][0];
        assert_eq!(f["sha256_hash"], "aa11", "no re-hash without a folder");
        assert!(f["chunks"].is_null());
        assert_eq!(m["profiles"][0]["mods"][0]["download_links"], json!([]));
    }

    #[test]
    fn a_signed_manifest_says_its_signature_goes() {
        let plan = convert(val(V02), None).unwrap();
        assert!(plan.was_signed);
        assert!(plan.changes.iter().any(|c| c.kind == "signature_removed"));
        assert_eq!(plan.previous_author_id.as_deref(), Some(&"ab".repeat(32)[..]));
    }

    #[test]
    fn a_current_manifest_is_up_to_date_and_keeps_its_signature() {
        let plan = convert(val(V10), None).unwrap();
        assert!(plan.up_to_date, "{:?}", plan.changes);
        assert_eq!(plan.manifest["signature"], val(V10)["signature"]);
    }

    #[test]
    fn a_newer_format_is_never_converted_down() {
        let mut m = val(V10);
        m[KEY] = json!("1.4");
        assert_eq!(convert(m.clone(), None).unwrap_err(), "repo.convert.errNewer");
        m[KEY] = json!("3.0");
        assert_eq!(convert(m, None).unwrap_err(), "repo.convert.errNewer");
        assert_eq!(convert(json!("x"), None).unwrap_err(), "repo.convert.errNotManifest");
    }

    #[test]
    fn rehash_fills_fixes_and_reports_from_the_folder() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("mods/cool-mod/Data")).unwrap();
        std::fs::write(root.join("mods/cool-mod/Data/a.txt"), b"hello").unwrap();
        // A file bigger than one chunk, to check the chunk table matches the exporter's rule.
        let big = vec![7u8; (CHUNK_SIZE + 10) as usize];
        std::fs::write(root.join("mods/cool-mod/big.bin"), &big).unwrap();

        let m = json!({
            "name": "R", "profiles": [{ "id": "p", "name": "P", "game_name": "G", "mods": [{
                "id": "cool-mod", "name": "Cool", "version": "1", "tags": [], "download_links": [],
                "files": [
                    { "relative_path": "Data/a.txt", "size": 1, "sha256_hash": "" },
                    { "relative_path": "big.bin", "size": 3, "sha256_hash": "00ff", "chunks": null },
                    { "relative_path": "gone.txt", "size": 1, "sha256_hash": "11" },
                    { "relative_path": "../../escape.txt", "size": 1, "sha256_hash": "22" }
                ]
            }]}]
        });
        let plan = convert(m, Some(root)).unwrap();
        let files = &plan.manifest["profiles"][0]["mods"][0]["files"];
        // sha256("hello")
        assert_eq!(files[0]["sha256_hash"], "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
        assert_eq!(files[0]["size"], 5);
        assert_eq!(files[1]["chunks"].as_array().map(Vec::len), Some(2));
        assert_eq!(files[1]["chunks"][1]["size"], 10);
        assert_eq!(files[2]["sha256_hash"], "11", "a missing file keeps its entry");
        assert_eq!(files[3]["sha256_hash"], "22", "an escaping path is never read");
        assert_eq!(plan.counts.hashes_filled, 1);
        assert_eq!(plan.counts.hashes_changed, 1);
        assert_eq!(plan.counts.files_missing, 1);
        assert!(plan.warnings.iter().any(|w| w.contains("unsafe path")));
    }

    #[test]
    fn layout_and_archive_are_followed() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path();
        std::fs::create_dir_all(root.join("addons/m1")).unwrap();
        std::fs::write(root.join("addons/m1/x.txt"), b"x").unwrap();
        std::fs::create_dir_all(root.join("mods")).unwrap();
        std::fs::write(root.join("mods/m2.zip"), b"zip").unwrap();
        let m = json!({
            "name": "R", "files_layout": "addons/{id}/{path}", "profiles": [{ "id": "p", "name": "P", "game_name": "G", "mods": [
                { "id": "m1", "name": "A", "version": "1", "tags": [], "download_links": [],
                  "files": [{ "relative_path": "x.txt", "size": 1, "sha256_hash": "" }] },
                { "id": "m2", "name": "B", "version": "1", "tags": [], "download_links": [], "files": [],
                  "archive": { "relative_path": "mods/m2.zip", "size": 0, "sha256_hash": "" } }
            ]}]
        });
        let plan = convert(m, Some(root)).unwrap();
        assert_eq!(plan.counts.hashes_filled, 2, "{:?}", plan.changes);
        assert_eq!(plan.counts.files_missing, 0);
    }

    #[test]
    fn files_hosted_elsewhere_are_not_rehashed() {
        let dir = tempfile::tempdir().unwrap();
        let plan = convert(val(V04), Some(dir.path())).unwrap();
        assert_eq!(plan.counts.files_missing, 0);
        assert!(plan.warnings.iter().any(|w| w.starts_with("files_base_url")));
    }

    #[test]
    fn the_registry_is_ordered_and_ends_at_the_current_format() {
        let vs: Vec<(u32, u32)> = REGISTRY.iter().map(|e| parse_version(e.version).unwrap()).collect();
        assert!(vs.windows(2).all(|w| w[0] < w[1]), "{vs:?}");
        assert_eq!(REGISTRY.last().unwrap().version, CURRENT);
        assert_eq!(parse_version(CURRENT).unwrap().0, CURRENT_MAJOR);
    }

    #[test]
    fn the_backup_name_says_what_it_was() {
        let t = chrono::DateTime::parse_from_rfc3339("2026-10-13T10:15:00Z").unwrap().with_timezone(&chrono::Utc);
        assert_eq!(backup_name("0.3", t), "repo.json.v0.3-20261013-101500.bak");
        assert_eq!(backup_name("", t), "repo.json.vunknown-20261013-101500.bak");
    }
}
