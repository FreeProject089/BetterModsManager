//! Everything a repo carries that is not a mod.
//!
//! A repo was profiles of mods plus modpacks, and every other part of a setup — the plugin
//! that drives it, the automation that keeps it in step, the theme, the mod lists, the
//! catalogues to follow — had to be published somewhere else and described in prose. What
//! somebody received was a folder of mods and instructions.
//!
//! Two shapes travel here, and the difference is deliberate:
//!
//!  - **Files are copied.** A plugin, an automation, a theme, a `.mm`, a `.bmmbundle` are
//!    snapshots by nature; the repo holds the bytes and a sha256, and they are verified on
//!    arrival exactly as a mod file is.
//!  - **Catalogues and apps are addresses.** A catalogue is a thing that CHANGES — copying
//!    one into a repo would publish a frozen fork that quietly stops matching its source,
//!    and the reader would have no way to tell.
//!
//! Nothing here RUNS what it installs. An automation lands in the scheduler disabled and a
//! plugin lands with no permissions, because a repo is a stranger's document and the moment
//! to decide about a task that runs commands is not the moment it is written to disk.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tauri::State;

use crate::models::repo::{RepoExtra, RepoFile};
use crate::state::AppState;

/// The kinds this build knows how to act on. An entry naming anything else is kept and
/// SHOWN — named, and refused with a reason — rather than hidden, so a repo published by a
/// newer BMM does not appear to be missing things.
pub const EXTRA_KINDS: &[&str] = &["plugin", "task", "theme", "modlist", "bundle", "catalog", "app"];

/// Does this kind carry bytes, or an address?
pub fn is_file_kind(kind: &str) -> bool {
    matches!(kind, "plugin" | "task" | "theme" | "modlist" | "bundle")
}

/// A file name that cannot climb out of the folder it belongs in.
///
/// The name reaches here from a manifest on somebody else's server, and it is joined onto a
/// local path. `../../` in it is the whole of CWE-22, so the components are dropped rather
/// than escaped — a path that tried to traverse becomes a plain name, and nothing outside
/// `extras/<kind>/` can be reached even by a manifest written to do it.
///
/// The character set is narrow for a second reason. What comes out of here goes into the
/// manifest AND becomes the path on whatever hosts the repo, and BCWEB's own normaliser
/// replaces everything outside `[A-Za-z0-9._-]` — spaces included. Keeping a space here
/// would write `My Theme.bmmtheme` into the manifest, store `My_Theme.bmmtheme` on the
/// server, and 404 on a file that is sitting right there. The failure reads as a publisher
/// who forgot to upload something.
pub fn safe_name(raw: &str) -> String {
    let base = raw.rsplit(|c| c == '/' || c == '\\').next().unwrap_or("file");
    let cleaned: String = base
        .chars()
        // ASCII, not Unicode. is_alphanumeric() accepts 'é' and the host's [A-Za-z0-9]
        // does not, so an accented name would be renamed in transit — which is the exact
        // failure this narrowing exists to prevent. Found by the test, not by reading.
        .map(|c| if c.is_ascii_alphanumeric() || "._-".contains(c) { c } else { '_' })
        .collect();
    let trimmed = cleaned.trim_matches(|c| c == '.' || c == '_').to_string();
    if trimmed.is_empty() { "file".to_string() } else { trimmed }
}

/// What the publisher hands over for one extra.
///
/// `file_path` for something already on disk, `inline` for something the app holds as JSON
/// (a scheduled task, a theme) and would otherwise have to write to a temporary file just to
/// hand it back. `url` for the two kinds that are addresses.
#[derive(Debug, Deserialize, Clone)]
pub struct ExtraSource {
    pub kind: String,
    pub id: String,
    pub name: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub author: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub file_path: Option<String>,
    #[serde(default)]
    pub inline: Option<serde_json::Value>,
    #[serde(default)]
    pub url: Option<String>,
    #[serde(default)]
    pub catalog_type: Option<String>,
}

/// Copy the carried files into `<repo_dir>/extras/<kind>/` and describe them.
///
/// Returns what belongs in `repo.json`. Called by the export path after the mods are
/// written, and by the "add to an existing repo" screen on its own.
#[tauri::command]
pub fn repo_extras_write(repo_dir: String, sources: Vec<ExtraSource>) -> Result<Vec<RepoExtra>, String> {
    let root = std::path::PathBuf::from(&repo_dir);
    let mut out: Vec<RepoExtra> = Vec::new();

    for src in sources {
        if !EXTRA_KINDS.contains(&src.kind.as_str()) {
            return Err(format!("repo.extras.errKind|{}", src.kind));
        }

        // An address kind is written as it stands. No fetch: a repo that reached out to
        // every catalogue it names at BUILD time would be publishing whatever those
        // happened to say that afternoon.
        if !is_file_kind(&src.kind) {
            let url = src
                .url
                .clone()
                .filter(|u| !u.trim().is_empty())
                .ok_or_else(|| format!("repo.extras.errNoUrl|{}", src.name))?;
            if !url.starts_with("http://") && !url.starts_with("https://") {
                return Err(format!("repo.extras.errBadUrl|{}", url));
            }
            out.push(RepoExtra {
                kind: src.kind,
                id: src.id,
                name: src.name,
                description: src.description,
                author: src.author,
                version: src.version,
                file: None,
                url: Some(url),
                catalog_type: src.catalog_type,
                locked: false,
                icon: src.icon,
            });
            continue;
        }

        let dir = root.join("extras").join(&src.kind);
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

        // What gets written, and under what name.
        let (bytes, name) = if let Some(v) = src.inline.as_ref() {
            let text = serde_json::to_string_pretty(v).map_err(|e| e.to_string())?;
            let ext = match src.kind.as_str() {
                "task" => "bmmpa",
                "theme" => "bmmtheme",
                _ => "json",
            };
            (text.into_bytes(), format!("{}.{}", safe_name(&src.id), ext))
        } else {
            let p = src
                .file_path
                .clone()
                .filter(|p| !p.is_empty())
                .ok_or_else(|| format!("repo.extras.errNoFile|{}", src.name))?;
            let path = std::path::PathBuf::from(&p);
            let bytes = std::fs::read(&path)
                .map_err(|e| format!("repo.extras.errRead|{}|{}", src.name, e))?;
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("file");
            (bytes, safe_name(name))
        };

        // Two extras with the same file name would silently overwrite each other and the
        // repo would ship one file described twice. The id disambiguates.
        let mut file_name = name;
        while dir.join(&file_name).exists() {
            file_name = format!("{}-{}", safe_name(&src.id), file_name);
        }

        // A sealed list is stated in the manifest, so the screen can say so before the
        // download rather than after. `locked_header` reads the readable header a locked
        // `.mm` deliberately leaves outside its envelope.
        let locked = src.kind == "modlist" && crate::commands::modlist::locked_header(&bytes).is_some();

        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let sha = format!("{:x}", hasher.finalize());
        let size = bytes.len() as u64;
        std::fs::write(dir.join(&file_name), &bytes).map_err(|e| e.to_string())?;

        out.push(RepoExtra {
            kind: src.kind,
            id: src.id,
            name: src.name,
            description: src.description,
            author: src.author,
            version: src.version,
            file: Some(RepoFile { relative_path: file_name, size, sha256_hash: sha, chunks: None, mtime: None }),
            url: None,
            catalog_type: src.catalog_type,
            locked,
            icon: src.icon,
        });
    }

    Ok(out)
}

/// Write the extras into a repo that already exists, and put them in its manifest.
///
/// One command for three moments that are the same act: finishing an export, updating a
/// repo, and adding something to a repo published months ago. Writing this into the export
/// path instead would have made the third impossible without re-exporting every mod.
///
/// The manifest is **re-signed**, because the extras are inside what the signature covers.
/// Leaving the old signature in place would publish a manifest that fails its own check —
/// which reads to a downloader as tampering, and is indistinguishable from it.
#[tauri::command]
pub fn repo_extras_apply(
    handle: tauri::AppHandle,
    repo_dir: String,
    sources: Vec<ExtraSource>,
    // Aucun fichier remplacé: overwrite the manifest list rather than adding to it. What the builder
    // screen sends, since it shows the whole list and the user edits it; an "add these"
    // caller sends false and its entries merge in by (kind, id).
    replace: bool,
) -> Result<Vec<RepoExtra>, String> {
    let manifest_path = std::path::PathBuf::from(&repo_dir).join("repo.json");
    let raw = std::fs::read_to_string(&manifest_path)
        .map_err(|_| "repo.extras.errNoManifest".to_string())?;
    let mut repo: crate::models::repo::ServerRepo =
        serde_json::from_str(&raw).map_err(|e| format!("repo.extras.errManifest|{}", e))?;

    // Written first: if a file cannot be copied, the manifest must not already claim it.
    let written = repo_extras_write(repo_dir.clone(), sources)?;

    if replace {
        // The files of dropped entries are left on disk rather than deleted. A repo folder
        // is somebody's directory, and this is not the place to decide that a file nothing
        // points at any more is a file nobody wants — an unreferenced extra is invisible to
        // every client, which is what removing it was for.
        repo.extras = written.clone();
    } else {
        repo.extras.retain(|e| !written.iter().any(|w| w.kind == e.kind && w.id == e.id));
        repo.extras.extend(written.clone());
    }

    // Cleared before signing, so the signature covers the same bytes the verifier will
    // reconstruct. Signing a document that still carries the previous signature would
    // produce one that can never be checked.
    repo.author_id = None;
    repo.signature = None;
    let payload = serde_json::to_string(&repo).map_err(|e| e.to_string())?;
    let (author_id, signature) = crate::commands::security::sign_message(&handle, payload.as_bytes())?;
    repo.author_id = Some(author_id);
    repo.signature = Some(signature);

    std::fs::write(
        &manifest_path,
        serde_json::to_string_pretty(&repo).map_err(|e| e.to_string())?,
    )
    .map_err(|_| "repo.errWriteManifest".to_string())?;

    Ok(written)
}

/// What happened to one extra, told in the terms the caller has to act on.
#[derive(Debug, Serialize, Clone)]
pub struct ExtraInstalled {
    pub kind: String,
    pub id: String,
    pub name: String,
    /// Where it landed, for a kind that becomes a file the user then opens.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub path: Option<String>,
    /// The address, for a kind the caller follows rather than installs.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub catalog_type: Option<String>,
    /// True when the caller still has to do something — follow a catalogue, open a list.
    pub needs_caller: bool,
    /// A locked `.mm`: downloaded and verified, and it opens with a passphrase or not at all.
    pub locked: bool,
    /// The manifest carried no hash, so nothing vouched for these bytes. Reported rather
    /// than treated as a pass — "checked and correct" and "nothing to check against" are
    /// different facts, and only one of them is reassuring.
    pub unverified: bool,
}

/// Fetch and install one extra.
///
/// `base_url` is the repo's, the same one its mods resolve against.
#[tauri::command]
pub async fn repo_extras_install(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    base_url: String,
    entry: RepoExtra,
    creator_id: Option<String>,
    password: Option<String>,
) -> Result<ExtraInstalled, String> {
    install_extra(&app, &state, &base_url, entry, creator_id.as_deref(), password.as_deref()).await
}

/// The same, as a plain function.
///
/// Split out so the HTTP API, the CLI and the MCP bridge reach the SAME code rather than a
/// second implementation of it — a route that re-did the hash check slightly differently
/// would be a second security decision nobody knows they are maintaining.
pub async fn install_extra(
    app: &tauri::AppHandle,
    state: &AppState,
    base_url: &str,
    entry: RepoExtra,
    creator_id: Option<&str>,
    password: Option<&str>,
) -> Result<ExtraInstalled, String> {
    // An address kind never downloads. The caller follows it, which is where the decision
    // about trusting a source belongs — and where the code that already does it lives.
    if !is_file_kind(&entry.kind) {
        let url = entry
            .url
            .clone()
            .ok_or_else(|| format!("repo.extras.errNoUrl|{}", entry.name))?;
        return Ok(ExtraInstalled {
            kind: entry.kind,
            id: entry.id,
            name: entry.name,
            path: None,
            url: Some(url),
            catalog_type: entry.catalog_type,
            needs_caller: true,
            locked: false,
            unverified: false,
        });
    }

    let file = entry
        .file
        .clone()
        .ok_or_else(|| format!("repo.extras.errNoFile|{}", entry.name))?;
    let url = extra_url(base_url, &entry.kind, &file.relative_path);

    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(cid) = creator_id {
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(cid) {
            headers.insert("X-Creator-ID", hv);
        }
    }
    if let Some(pw) = password.filter(|p| !p.is_empty()) {
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(pw) {
            headers.insert("X-Repo-Password", hv);
        }
    }
    crate::commands::repo_keyauth::add_proof(&mut headers, &url);

    let client = reqwest::Client::builder()
        .default_headers(headers)
        .build()
        .map_err(|e| e.to_string())?;
    let res = client.get(&url).send().await.map_err(|e| e.to_string())?;
    if res.status() == 401 {
        return Err("repo.errPasswordRequired".to_string());
    }
    if !res.status().is_success() {
        return Err(format!("repo.extras.errFetch|{}|{}", entry.name, res.status()));
    }
    let bytes = res.bytes().await.map_err(|e| e.to_string())?.to_vec();

    // Checked BEFORE anything is written or parsed. An extra is a plugin, an automation or
    // a theme — the three things in BMM that are code or drive it — so a manifest hash that
    // does not match is the one moment there is to refuse.
    //
    // An EMPTY hash is a manifest that never carried one (a discovered listing, an older
    // publisher). That is not silently a pass: it installs, and `unverified` says so.
    let unverified = file.sha256_hash.is_empty();
    if !unverified {
        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        if format!("{:x}", hasher.finalize()) != file.sha256_hash.to_lowercase() {
            return Err(format!("repo.extras.errHash|{}", entry.name));
        }
    }

    let done = |id: String, path: Option<String>, needs_caller: bool, locked: bool| ExtraInstalled {
        kind: entry.kind.clone(),
        id,
        name: entry.name.clone(),
        path,
        url: None,
        // Carried through for a `bundle`, which IS a catalogue — one in a zip. The receiver
        // follows it as a source of that type rather than installing it, so dropping the
        // type here would leave the caller with a file and no idea what it is a catalogue of.
        catalog_type: entry.catalog_type.clone(),
        needs_caller,
        locked,
        unverified,
    };

    match entry.kind.as_str() {
        "plugin" => {
            let id = crate::commands::plugins::install_plugin_bytes(state, app, &bytes)?;
            Ok(done(id, None, false, false))
        }
        "theme" => {
            let tmp = write_temp(app, &entry.kind, &file.relative_path, &bytes)?;
            let r = crate::commands::themes::import_theme(app.clone(), tmp.to_string_lossy().to_string());
            let _ = std::fs::remove_file(&tmp);
            r?;
            Ok(done(entry.id.clone(), None, false, false))
        }
        // An automation is handed BACK, not installed here.
        //
        // A `.bmmpa` carries `includes` — the reusable blocks, modpacks and launch packs its
        // tasks call — and restoring those means writing to localStorage, which is the
        // interface's, not Rust's. Installing the task alone would import one whose
        // `Run a block` step points at a name that does not exist here, and that stops the
        // task rather than skipping quietly. It was doing exactly that.
        //
        // The caller runs the same importer every other .bmmpa goes through, which is also
        // where "disabled, no permissions" is enforced — one rule, one place.
        "task" => {
            let path = write_temp(app, &entry.kind, &file.relative_path, &bytes)?;
            Ok(done(entry.id.clone(), Some(path.to_string_lossy().to_string()), true, false))
        }
        // A list and a bundle become a FILE, and the caller opens it — because opening one
        // asks questions (a passphrase, which credentials to accept, which entries to take)
        // that belong on screen and not in a download loop.
        _ => {
            let path = write_temp(app, &entry.kind, &file.relative_path, &bytes)?;
            let locked = entry.locked || crate::commands::modlist::locked_header(&bytes).is_some();
            Ok(done(entry.id.clone(), Some(path.to_string_lossy().to_string()), true, locked))
        }
    }
}

/// Where an extra's bytes live, given the repo's base URL.
///
/// Split out because it is the one piece of this that is worth testing directly, and
/// because the trailing-slash and `repo.json` cases are exactly the ones that get a URL
/// wrong by one character and report a 404 that reads as "the publisher forgot the file".
pub fn extra_url(base_url: &str, kind: &str, relative_path: &str) -> String {
    let mut base = base_url.trim().to_string();
    if let Some(s) = base.strip_suffix("repo.json") {
        base = s.to_string();
    }
    while base.ends_with('/') {
        base.pop();
    }
    format!("{}/extras/{}/{}", base, kind, relative_path)
}

fn app_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    app.path().app_data_dir().map_err(|e| e.to_string())
}

/// Somewhere on disk under the app's own data dir, never the system temp.
///
/// A `.mm` downloaded here can carry credentials, and the system temp is a directory every
/// process on the machine can read.
fn write_temp(
    app: &tauri::AppHandle,
    kind: &str,
    name: &str,
    bytes: &[u8],
) -> Result<std::path::PathBuf, String> {
    let dir = app_dir(app)?.join("repo-extras").join(kind);
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    let path = dir.join(safe_name(name));
    std::fs::write(&path, bytes).map_err(|e| e.to_string())?;
    Ok(path)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn src(kind: &str, id: &str) -> ExtraSource {
        ExtraSource {
            kind: kind.into(),
            id: id.into(),
            name: id.into(),
            description: None,
            author: None,
            version: None,
            icon: None,
            file_path: None,
            inline: None,
            url: None,
            catalog_type: None,
        }
    }

    #[test]
    fn a_name_cannot_climb_out_of_its_folder() {
        assert_eq!(safe_name("../../evil.exe"), "evil.exe");
        assert_eq!(safe_name("..\\..\\evil.exe"), "evil.exe");
        assert_eq!(safe_name("/etc/passwd"), "passwd");
        // A name that is nothing BUT traversal must still produce a usable file name rather
        // than an empty one, which would join to the directory itself.
        assert_eq!(safe_name(".."), "file");
        assert_eq!(safe_name(""), "file");
    }

    #[test]
    fn a_name_survives_the_host_that_will_serve_it() {
        // Not merely "is it safe" — is it the SAME name once the server has normalised it.
        // BCWEB replaces everything outside [A-Za-z0-9._-], so anything kept here that it
        // does not keep is a manifest pointing at a path that does not exist, and the 404
        // reads as a publisher who forgot to upload the file.
        assert_eq!(safe_name("My Theme v2.bmmtheme"), "My_Theme_v2.bmmtheme");
        assert_eq!(safe_name("weird:name?.mm"), "weird_name_.mm");

        let host_norm = |s: &str| -> String {
            s.chars()
                .map(|c| if c.is_ascii_alphanumeric() || ".-_".contains(c) { c } else { '_' })
                .collect()
        };
        for raw in ["My Theme v2.bmmtheme", "café list.mm", "a b c.bmmpa", "weird:name?.mm"] {
            let ours = safe_name(raw);
            assert_eq!(host_norm(&ours), ours, "{:?} would be renamed by the host", raw);
        }
    }

    #[test]
    fn file_kinds_and_address_kinds_are_not_confused() {
        for k in ["plugin", "task", "theme", "modlist", "bundle"] {
            assert!(is_file_kind(k), "{} carries bytes", k);
        }
        for k in ["catalog", "app"] {
            assert!(!is_file_kind(k), "{} is an address", k);
        }
    }

    #[test]
    fn the_download_url_survives_every_shape_of_base() {
        for base in [
            "https://host/r",
            "https://host/r/",
            "https://host/r/repo.json",
            "  https://host/r//  ",
        ] {
            assert_eq!(
                extra_url(base, "theme", "dark.bmmtheme"),
                "https://host/r/extras/theme/dark.bmmtheme",
                "base was {:?}",
                base
            );
        }
    }

    #[test]
    fn an_address_kind_refuses_anything_that_is_not_http() {
        // The url reaches a fetcher and, for an app, a downloader. `file://` and
        // `javascript:` are why this is checked when it is WRITTEN as well as when read.
        let mut bad = src("catalog", "c");
        bad.url = Some("javascript:alert(1)".into());
        let dir = tempfile::tempdir().unwrap();
        let err = repo_extras_write(dir.path().to_string_lossy().to_string(), vec![bad]).unwrap_err();
        assert!(err.starts_with("repo.extras.errBadUrl"), "{}", err);
    }

    #[test]
    fn an_address_kind_with_no_address_is_refused_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let err = repo_extras_write(dir.path().to_string_lossy().to_string(), vec![src("catalog", "c")])
            .unwrap_err();
        assert!(err.starts_with("repo.extras.errNoUrl"), "{}", err);
    }

    #[test]
    fn an_unknown_kind_is_refused_by_name() {
        let dir = tempfile::tempdir().unwrap();
        let err = repo_extras_write(dir.path().to_string_lossy().to_string(), vec![src("wat", "x")])
            .unwrap_err();
        assert_eq!(err, "repo.extras.errKind|wat");
    }

    #[test]
    fn an_inline_task_is_written_and_hashed() {
        let dir = tempfile::tempdir().unwrap();
        let mut s = src("task", "t-1");
        s.inline = Some(serde_json::json!({ "id": "t-1", "name": "Nightly" }));
        let out = repo_extras_write(dir.path().to_string_lossy().to_string(), vec![s]).unwrap();
        let f = out[0].file.as_ref().unwrap();
        assert_eq!(f.relative_path, "t-1.bmmpa");
        let written = dir.path().join("extras").join("task").join("t-1.bmmpa");
        assert!(written.exists());

        // The hash in the manifest must be the hash of what is on disk. The install path
        // refuses on a mismatch, so a wrong one here publishes something nobody can install
        // — and the failure looks like a corrupted download, which sends them nowhere near
        // the actual cause.
        let bytes = std::fs::read(&written).unwrap();
        let mut h = Sha256::new();
        h.update(&bytes);
        assert_eq!(format!("{:x}", h.finalize()), f.sha256_hash);
        assert_eq!(f.size, bytes.len() as u64);
    }

    #[test]
    fn two_files_with_one_name_do_not_overwrite_each_other() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().to_string_lossy().to_string();
        let mut a = src("task", "dup");
        a.inline = Some(serde_json::json!({ "id": "dup" }));
        let b = a.clone();
        // The same id twice is the pathological case: without the guard the second write
        // lands on the first and the repo ships one file described as two.
        let out = repo_extras_write(root, vec![a, b]).unwrap();
        let an = out[0].file.as_ref().unwrap().relative_path.clone();
        let bn = out[1].file.as_ref().unwrap().relative_path.clone();
        assert_ne!(an, bn);
        assert!(dir.path().join("extras/task").join(&an).exists());
        assert!(dir.path().join("extras/task").join(&bn).exists());
    }

    #[test]
    fn a_locked_list_is_flagged_in_the_manifest() {
        // So the screen can say "this one needs a passphrase" before the download instead
        // of after it — otherwise what arrives is a file that will not open, and no way to
        // tell whether that is the point or a broken transfer.
        let dir = tempfile::tempdir().unwrap();
        let list = dir.path().join("secret.mm");
        std::fs::write(
            &list,
            serde_json::to_vec(&serde_json::json!({
                "bmm_locked": true, "name": "Secret Ops", "author": "me",
                "game_name": "DCS", "created_at": "2026-08-26T00:00:00Z",
                "mods_count": 12, "sealed": { "bmm_enc": 1 }
            }))
            .unwrap(),
        )
        .unwrap();

        let mut s = src("modlist", "m-1");
        s.file_path = Some(list.to_string_lossy().to_string());
        let out = repo_extras_write(dir.path().to_string_lossy().to_string(), vec![s]).unwrap();
        assert!(out[0].locked);

        // And an ordinary list is not flagged — a warning on every entry is a warning
        // nobody reads by the third repo.
        let plain = dir.path().join("open.mm");
        std::fs::write(&plain, br#"{"format_version":"1.0","name":"Open","mods":[]}"#).unwrap();
        let mut s2 = src("modlist", "m-2");
        s2.file_path = Some(plain.to_string_lossy().to_string());
        let out2 = repo_extras_write(dir.path().to_string_lossy().to_string(), vec![s2]).unwrap();
        assert!(!out2[0].locked);
    }
}
