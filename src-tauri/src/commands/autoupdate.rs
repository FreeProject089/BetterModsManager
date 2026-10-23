use tauri::Manager;
use tauri::Emitter;
use serde::{Serialize, Deserialize};
use crate::commands::crash::log_line;

use std::fs::File;
use std::io::Write;

#[derive(Serialize, Clone)]
pub struct UpdateInfo {
    pub has_update: bool,
    pub current_version: String,
    pub latest_version: String,
    pub release_url: String,
    pub release_notes: String,
    pub download_url: String,
    /// URL of the incremental update manifest (if present in release assets)
    pub manifest_url: Option<String>,
    /// True when the selected release is a GitHub pre-release.
    pub is_prerelease: bool,
    /// True when the MAJOR version increases (e.g. 0.9.11 -> 1.0.0). Such a jump can change the
    /// bundle id, the data layout and the installer itself, so an in-place incremental patch is
    /// unsafe — the UI must offer only the full installer (run by hand), never "Quick Update".
    pub major_bump: bool,
    /// Size in bytes of the installer asset `download_url` names (0 when unknown), for the
    /// « 62 MB » the update dialog shows before anything is downloaded.
    pub download_size: u64,
    /// The channel this check read: "stable" or "prerelease" (the setting, or forced to
    /// "prerelease" when this build is itself a pre-release).
    pub channel: String,
    /// The release's tag exactly as published (`v1.0.1`), which the install step re-reads.
    pub release_tag: String,
    /// What will vouch for the installer: "signed" (update-manifest.json), "update-json" (the
    /// checksum in the release's update.json) or "unverified" (nothing; BMM asks first).
    pub verification: String,
    /// Why it is "unverified", in plain words ("" otherwise).
    pub verification_note: String,
}

/// A single file entry in the incremental update manifest.
///
/// `Deserialize` is only ever reached through [`SignedBody`], i.e. after the signature over
/// the body that contains it has been checked. No command takes a `ManifestFile` (or a list of
/// them) as an argument.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct ManifestFile {
    /// Relative path within the BMM install directory (e.g. "frontend/js/docs/interactive-docs.js")
    pub path: String,
    /// Expected SHA-256 hex digest of the file after update
    pub sha256: String,
    /// Direct download URL for this file
    pub download_url: String,
    /// File size in bytes (informational)
    pub size: u64,
}

/// What `fetch_update_manifest` hands the UI: the verified content, plus the raw document it
/// was read from.
///
/// Deliberately NOT `Deserialize`. It used to be, and `apply_incremental_update` took one as its
/// argument: the UI fetched the manifest, then passed the parsed object back, and Rust wrote
/// whatever `files` that object listed. Anything able to call `invoke` could therefore name the
/// files to write and the hashes to expect. Now the UI passes the object back unchanged and Rust
/// reads ONLY `document` from it ([`ApplyRequest`]), verifying it again from scratch; `version`
/// and `files` here are for display.
#[derive(Serialize, Clone)]
pub struct UpdateManifest {
    pub version: String,
    pub files: Vec<ManifestFile>,
    /// The `update-manifest.json` exactly as downloaded.
    pub document: String,
}

// ── The signed incremental manifest ─────────────────────────────────────────────────────────
//
// Same scheme as BetterInstaller's signed `update.json` (bpkg-core/src/update.rs), with its
// own context string so a signature made for one can never be accepted by the other:
//
//   {
//     "version": "1.2.0", "files": [ … ],            ← copy for BMM builds that predate signing
//     "signed": "{\"app_id\":\"com.bettermm.desktop\",\"version\":\"1.2.0\",\"files\":[…],
//                 \"installers\":[…],\"issued\":\"…Z\",\"expires\":\"…Z\"}",
//     "signature": "<128 hex>"                         ← Ed25519 over CONTEXT ‖ bytes of `signed`
//   }
//
// `signed` is a JSON document carried as a STRING, so the signature covers its exact bytes and
// nothing has to be re-serialised identically on both sides. Only the signed body is read; the
// top-level copy is never trusted. Publisher side: scripts/sign-update-manifest.mjs.

/// Prefix of the signed message. BetterInstaller's is `BetterInstaller update manifest v1\n`.
pub const MANIFEST_SIG_CONTEXT: &[u8] = b"BetterModsManager incremental manifest v1\n";

/// The app a manifest must name — BMM's bundle identifier (tauri.conf.json `identifier`).
pub const MANIFEST_APP_ID: &str = "com.bettermm.desktop";

/// The publisher key, `[security].public_key` of BetterInstaller/examples/bmm/installer.toml.
/// Compiled in on purpose: a key read from a file in the install directory would be replaced by
/// whoever can write there, which is exactly who this check is meant to stop. A test compares it
/// with installer.toml and with the Node signer (tests/sign-update-manifest.test.mjs).
pub const MANIFEST_PUBLIC_KEY_HEX: &str =
    "8e0647c277dd67158d34dd1c10d0a2d97191716dc4f92aebde6d349d1c0f168b";

/// Longest `expires - issued` accepted, for update-manifest.json and the release's update.json.
/// A host that stops receiving fresh copies — a freeze, or a stalled job — stops being believed
/// after at most this long. BMM 1.0.2 and 0.9.12 accept only 7 days, so the publisher still
/// signs for 7 and re-signs weekly (.github/workflows/resign-manifests.yml); signing switches to
/// 90 days once those versions are no longer in use (RELEASE.md).
pub const MANIFEST_MAX_VALIDITY_DAYS: i64 = 90;

/// The signed body. Every field is required (a body missing one is not a manifest), except
/// `installers`, which manifests signed before the full-installer check do not carry.
#[derive(Deserialize)]
struct SignedBody {
    app_id: String,
    version: String,
    files: Vec<ManifestFile>,
    /// The full installers of this release (`path` = the installer's file name), for the
    /// fallback `download_and_install_update`: it runs an installer only when it is listed here
    /// and its bytes have this SHA-256.
    #[serde(default)]
    installers: Vec<ManifestFile>,
    issued: String,
    expires: String,
}

/// What survived verification.
#[derive(Debug, Clone, PartialEq)]
pub struct VerifiedManifest {
    pub version: String,
    pub files: Vec<ManifestFile>,
    pub installers: Vec<ManifestFile>,
}

/// The argument of `apply_incremental_update`. The UI passes back the object
/// `fetch_update_manifest` returned; only its raw `document` is read (unknown fields such as a
/// top-level `files` are ignored by serde), and it is verified again before anything is written.
/// A pre-parsed `{version, files}` has no `document` and does not deserialize.
#[derive(Deserialize)]
pub struct ApplyRequest {
    document: String,
}

fn publisher_key() -> Result<ed25519_dalek::VerifyingKey, String> {
    let bytes = hex::decode(MANIFEST_PUBLIC_KEY_HEX).map_err(|_| "bad built-in key".to_string())?;
    let arr: [u8; 32] = bytes.try_into().map_err(|_| "bad built-in key".to_string())?;
    ed25519_dalek::VerifyingKey::from_bytes(&arr).map_err(|_| "bad built-in key".to_string())
}

/// The first dotted number run in `text` (`v1.2.3-rc1` → [1, 2, 3]), `None` when there is no
/// number at all. A mirror of `bpkg_core::version::extract_version` — BMM does not depend on
/// the BetterInstaller crate, but the two must order versions the same way.
fn extract_version(text: &str) -> Option<Vec<u64>> {
    let bytes = text.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i].is_ascii_digit() {
            let start = i;
            while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
                // A trailing dot ends the run rather than joining what follows.
                if bytes[i] == b'.' && (i + 1 >= bytes.len() || !bytes[i + 1].is_ascii_digit()) {
                    break;
                }
                i += 1;
            }
            let parts: Vec<u64> = text[start..i].split('.').filter_map(|x| x.parse().ok()).collect();
            if !parts.is_empty() {
                return Some(parts);
            }
        }
        i += 1;
    }
    None
}

/// Component-wise comparison, a missing component counting as 0 (`1.3` = `1.3.0`).
fn cmp_version(a: &[u64], b: &[u64]) -> std::cmp::Ordering {
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (a.get(i).copied().unwrap_or(0), b.get(i).copied().unwrap_or(0));
        if x != y {
            return x.cmp(&y);
        }
    }
    std::cmp::Ordering::Equal
}

/// The pre-release tag right after the first number run (`1.2.3-rc.1+abc` → `rc.1`), `None`
/// for a plain release. Build metadata (`+…`) is not a pre-release.
fn prerelease_tag(text: &str) -> Option<&str> {
    let bytes = text.as_bytes();
    let start = bytes.iter().position(|b| b.is_ascii_digit())?;
    let mut i = start;
    while i < bytes.len() && (bytes[i].is_ascii_digit() || bytes[i] == b'.') {
        if bytes[i] == b'.' && (i + 1 >= bytes.len() || !bytes[i + 1].is_ascii_digit()) {
            break;
        }
        i += 1;
    }
    let rest = text[i..].strip_prefix('-')?;
    let tag = rest.split('+').next().unwrap_or("").trim();
    (!tag.is_empty()).then_some(tag)
}

/// True for a pre-release build version (`1.1.0-beta.2`). Such a build follows the
/// pre-release channel whatever the setting says: it is already on it.
pub(crate) fn is_prerelease_version(v: &str) -> bool {
    prerelease_tag(v).is_some()
}

/// Natural order of two pre-release tags: digit runs compare as numbers (`rc10` > `rc9`).
fn cmp_tag(a: &str, b: &str) -> std::cmp::Ordering {
    let split = |s: &str| -> Vec<(bool, String)> {
        let mut out: Vec<(bool, String)> = Vec::new();
        for c in s.to_ascii_lowercase().chars() {
            let d = c.is_ascii_digit();
            match out.last_mut() {
                Some((kind, run)) if *kind == d => run.push(c),
                _ => out.push((d, c.to_string())),
            }
        }
        out
    };
    let (xa, xb) = (split(a), split(b));
    for (pa, pb) in xa.iter().zip(xb.iter()) {
        let o = match (pa.0, pb.0) {
            (true, true) => pa.1.parse::<u64>().unwrap_or(0).cmp(&pb.1.parse::<u64>().unwrap_or(0)),
            _ => pa.1.cmp(&pb.1),
        };
        if o != std::cmp::Ordering::Equal {
            return o;
        }
    }
    xa.len().cmp(&xb.len())
}

/// Is `a` strictly newer than `b`? `bpkg_core::version::is_newer`'s rule — `a` with no number is
/// never newer; `b` with no number counts as 0 — plus ONE rule bpkg-core does not need: at the
/// same number, the release is newer than its pre-releases (`1.2.0` > `1.2.0-rc.1`), and two
/// pre-releases order naturally (`rc.2` > `rc.1`). Without it a person on `1.2.0-rc.1` was never
/// offered `1.2.0`. BetterInstaller's own path only ever serves plain versions, so the two still
/// agree on everything it sees.
pub(crate) fn is_newer(a: &str, b: &str) -> bool {
    let Some(va) = extract_version(a) else { return false };
    let vb = extract_version(b).unwrap_or_default();
    match cmp_version(&va, &vb) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => match (prerelease_tag(a), prerelease_tag(b)) {
            (None, Some(_)) => true,
            (Some(x), Some(y)) => cmp_tag(x, y) == std::cmp::Ordering::Greater,
            _ => false,
        },
    }
}

/// A manifest path is relative and made of plain names only: no `..`, no root, no drive.
fn safe_relative_path(p: &str) -> bool {
    use std::path::Component;
    if p.is_empty() || p.split(|c| c == '/' || c == '\\').any(|seg| seg == ".." || seg == "...") {
        return false;
    }
    std::path::Path::new(p).components().all(|c| matches!(c, Component::Normal(_) | Component::CurDir))
}

fn is_https(url: &str) -> bool {
    let Ok(u) = reqwest::Url::parse(url) else { return false };
    if u.scheme() == "https" && u.host_str().is_some() {
        return true;
    }
    // Tests only: the flow tests serve the manifest and the installer from a plain-HTTP
    // server on the loopback (autoupdate_flow_tests.rs). Never compiled into the app.
    #[cfg(test)]
    if u.scheme() == "http" && u.host_str() == Some("127.0.0.1") {
        return true;
    }
    false
}

/// Read an `update-manifest.json`, refusing it unless every rule holds:
/// signed by `key` over [`MANIFEST_SIG_CONTEXT`] ‖ `signed`; for [`MANIFEST_APP_ID`];
/// `issued < expires`, `expires - issued <= MANIFEST_MAX_VALIDITY_DAYS`, `now < expires`; a version strictly newer
/// than `current_version`; every file with an https URL, a SHA-256 and a safe relative path.
/// Only the signed body is read.
pub(crate) fn verify_manifest_text(
    text: &str,
    key: &ed25519_dalek::VerifyingKey,
    current_version: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<VerifiedManifest, String> {
    let refuse = |why: String| Err(format!("Update manifest refused: {why}"));
    let doc: serde_json::Value =
        serde_json::from_str(text).map_err(|e| format!("Update manifest refused: not JSON ({e})"))?;
    let Some(signed) = doc.get("signed").and_then(|s| s.as_str()) else {
        return refuse("it is not signed".into());
    };
    let sig: [u8; 64] = match doc
        .get("signature")
        .and_then(|s| s.as_str())
        .filter(|s| s.len() == 128)
        .and_then(|s| hex::decode(s).ok())
        .and_then(|b| <[u8; 64]>::try_from(b).ok())
    {
        Some(s) => s,
        None => return refuse("the signature is missing or malformed".into()),
    };
    let mut msg = MANIFEST_SIG_CONTEXT.to_vec();
    msg.extend_from_slice(signed.as_bytes());
    if key.verify_strict(&msg, &ed25519_dalek::Signature::from_bytes(&sig)).is_err() {
        return refuse("its signature does not match the publisher key".into());
    }

    let body: SignedBody = serde_json::from_str(signed)
        .map_err(|e| format!("Update manifest refused: the signed part is incomplete ({e})"))?;
    if body.app_id != MANIFEST_APP_ID {
        return refuse(format!("it is for {:?}, not {:?}", body.app_id, MANIFEST_APP_ID));
    }
    let time = |field: &str, v: &str| {
        chrono::DateTime::parse_from_rfc3339(v)
            .map(|t| t.with_timezone(&chrono::Utc))
            .map_err(|_| format!("Update manifest refused: `{field}` is not an RFC 3339 time"))
    };
    let issued = time("issued", &body.issued)?;
    let expires = time("expires", &body.expires)?;
    if expires <= issued || expires - issued > chrono::Duration::days(MANIFEST_MAX_VALIDITY_DAYS) {
        return refuse(format!(
            "it claims to be valid from {issued} to {expires}; the limit is {MANIFEST_MAX_VALIDITY_DAYS} days"
        ));
    }
    if now >= expires {
        return refuse(format!(
            "it expired on {expires} (the publisher re-signs it before it expires; an expired copy means \
             the host is not serving a current one, or this PC's clock is wrong)"
        ));
    }
    if !is_newer(&body.version, current_version) {
        return refuse(format!(
            "it offers {} and this is {current_version}; only a newer version is applied",
            body.version
        ));
    }
    for f in &body.files {
        if !is_https(&f.download_url) {
            return refuse(format!("{} is not downloaded over https", f.path));
        }
        if !safe_relative_path(&f.path) {
            return refuse(format!("{:?} is not a plain relative path", f.path));
        }
        // Lowercase only: the apply loop compares against `format!("{:x}")`.
        if !is_lower_sha256(&f.sha256) {
            return refuse(format!("{} has no lowercase SHA-256", f.path));
        }
    }
    for f in &body.installers {
        if !is_https(&f.download_url) {
            return refuse(format!("the installer {} is not downloaded over https", f.path));
        }
        if installer_file_name(&f.path).is_none() {
            return refuse(format!("{:?} is not an installer file name (one .exe or .msi name)", f.path));
        }
        if !is_lower_sha256(&f.sha256) {
            return refuse(format!("the installer {} has no lowercase SHA-256", f.path));
        }
    }
    Ok(VerifiedManifest { version: body.version, files: body.files, installers: body.installers })
}

fn is_lower_sha256(h: &str) -> bool {
    h.len() == 64 && h.bytes().all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// An installer entry's `path` as the file name it is saved under: ONE plain name ending in
/// `.exe` or `.msi`, or `None`. Never the name the UI derived from the URL: that is where a
/// `..\` or a drive used to reach `temp_dir().join(..)`.
pub(crate) fn installer_file_name(path: &str) -> Option<String> {
    let name = crate::fs_utils::safe_folder_name(path)?;
    let lower = name.to_ascii_lowercase();
    (lower.ends_with(".exe") || lower.ends_with(".msi")).then_some(name)
}

/// The installer the signed manifest vouches for at `url`, or why there is none.
///
/// The fallback used to download whatever `url` the UI passed (the release's first `.msi` or
/// `.exe` asset, taken from an unsigned API answer) and run it: no signature, no hash. Whoever
/// could answer for the release feed, or sit on a plain-HTTP hop of it, chose the program BMM
/// launched. Now the URL must be one the publisher signed, with its hash.
pub(crate) fn installer_for<'a>(manifest: &'a VerifiedManifest, url: &str) -> Result<&'a ManifestFile, String> {
    if manifest.installers.is_empty() {
        return Err(format!(
            "Update refused: the signed manifest of v{} lists no installer, so this download cannot be \
             checked. BMM stays on its current version; download the installer from the release page.",
            manifest.version
        ));
    }
    manifest.installers.iter().find(|f| f.download_url == url.trim()).ok_or_else(|| {
        format!(
            "Update refused: {url} is not an installer the signed manifest of v{} vouches for. \
             BMM stays on its current version.",
            manifest.version
        )
    })
}

/// The installer to run: the one at `hint` (the release asset the UI picked) when the signed
/// manifest lists it, otherwise the manifest's own choice: `BMM-Setup.exe` (BetterInstaller's
/// setup, what BMM ships since 1.0), then the first `.exe`, then the first entry.
///
/// The hint is only ever used to CHOOSE among signed entries; what is downloaded is always the
/// entry's own `download_url`. Falling back used to be an error ("not an installer the signed
/// manifest vouches for") whenever the UI's pick, the first `.msi` of the release, was not the
/// file the manifest listed, which made the update fail for a purely cosmetic reason.
pub(crate) fn pick_installer<'a>(manifest: &'a VerifiedManifest, hint: &str) -> Result<&'a ManifestFile, String> {
    if let Ok(e) = installer_for(manifest, hint) {
        return Ok(e);
    }
    if manifest.installers.is_empty() {
        return installer_for(manifest, hint);
    }
    let lower = |f: &&ManifestFile| f.path.to_ascii_lowercase();
    Ok(manifest
        .installers
        .iter()
        .find(|f| lower(f) == "bmm-setup.exe")
        .or_else(|| manifest.installers.iter().find(|f| lower(f).ends_with(".exe")))
        .unwrap_or(&manifest.installers[0]))
}

/// Progress of the full-installer download, emitted as `update-download-progress`.
#[derive(Clone, Serialize)]
pub struct DownloadProgress {
    /// "downloading" | "verifying" | "launching"
    pub phase: String,
    pub received: u64,
    pub total: u64,
    /// True when this download continued a partial file left by an interrupted one.
    pub resumed: bool,
}

fn emit_download(app: &tauri::AppHandle, phase: &str, received: u64, total: u64, resumed: bool) {
    let _ = app.emit("update-download-progress", DownloadProgress { phase: phase.to_string(), received, total, resumed });
}

/// Download the installer `entry` names, resuming a partial download left by an interrupted
/// one, and return its bytes ONLY once they have the SHA-256 the signed manifest gives.
///
/// The partial file lives in BMM's own local app-data folder (`updates/<sha256>.part`), named by
/// the signed hash, so a different release never resumes into it. Whatever it holds is checked
/// with the rest: a wrong byte anywhere fails the hash, the partial file is deleted, and a
/// resumed download is retried once from zero before giving up.
async fn download_installer(app: &tauri::AppHandle, entry: &ManifestFile) -> Result<Vec<u8>, String> {
    let dir = updates_dir(app)?;
    let mut report = |p: DownloadProgress| {
        let _ = app.emit("update-download-progress", p);
    };
    download_installer_into(&dir, entry, &mut report).await
}

/// `<local app data>/updates`, created on demand: partial downloads and staged installers.
fn updates_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    let dir = app
        .path()
        .app_local_data_dir()
        .map_err(|e| format!("Cannot resolve the download folder: {e}"))?
        .join("updates");
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create folder: {e}"))?;
    Ok(dir)
}

/// The download itself, into `dir`, reporting through `report`. Separate from the Tauri side so
/// the flow tests run it against a local server (autoupdate_flow_tests.rs).
pub(crate) async fn download_installer_into(
    dir: &std::path::Path,
    entry: &ManifestFile,
    report: &mut (dyn FnMut(DownloadProgress) + Send),
) -> Result<Vec<u8>, String> {
    use std::io::{Read as _, Seek as _};
    let mut emit = |phase: &str, received: u64, total: u64, resumed: bool| {
        report(DownloadProgress { phase: phase.to_string(), received, total, resumed })
    };
    std::fs::create_dir_all(dir).map_err(|e| format!("Failed to create folder: {e}"))?;
    // `sha256` is 64 lowercase hex (verify_manifest_text), so this is a plain file name.
    let part = dir.join(format!("{}.part", entry.sha256));

    for attempt in 0..2 {
        let mut have = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
        if entry.size > 0 && have > entry.size {
            let _ = std::fs::remove_file(&part);
            have = 0;
        }
        let mut resumed = have > 0;
        let complete_already = entry.size > 0 && have == entry.size;

        if !complete_already {
            let mut req = crate::commands::net::client()
                .get(&entry.download_url)
                .header(reqwest::header::USER_AGENT, "BetterModManager");
            if have > 0 {
                req = req.header(reqwest::header::RANGE, format!("bytes={have}-"));
            }
            let mut response = req.send().await.map_err(|e| {
                format!("Download error: {e}. Check the connection and try again; the download resumes where it stopped.")
            })?;
            let status = response.status().as_u16();
            let append = match status {
                206 if have > 0 => true,
                200 => false,
                // The server says the partial file already holds everything: verify it.
                416 if have > 0 => true,
                _ => return Err(format!("Download failed with status: {}", response.status())),
            };
            if !append {
                // The server ignored the range and sent the whole file: start over, and do not
                // call it a resumed download.
                have = 0;
                resumed = false;
            }
            let mut cap = crate::fs_utils::DownloadCap::with_limit(INSTALLER_MAX_BYTES);
            cap.add(have)?;
            let announced = response.content_length();
            cap.check_announced(announced.map(|n| n + have))?;
            let total = if entry.size > 0 { entry.size } else { have + announced.unwrap_or(0) };

            if status != 416 {
                let mut file = std::fs::OpenOptions::new()
                    .create(true)
                    .write(true)
                    .append(append)
                    .truncate(!append)
                    .open(&part)
                    .map_err(|e| format!("Failed to create file: {e}"))?;
                emit("downloading", have, total, resumed);
                let mut last_emit = std::time::Instant::now();
                loop {
                    let chunk = match response.chunk().await {
                        Ok(Some(c)) => c,
                        Ok(None) => break,
                        Err(e) => {
                            // Keep what arrived: the next try continues from here.
                            return Err(format!(
                                "Download interrupted at {} of {} MB ({e}). Try again: it resumes where it stopped.",
                                have / 1_048_576,
                                total.max(have) / 1_048_576
                            ));
                        }
                    };
                    cap.add(chunk.len() as u64)?;
                    // Never more than the signed size: what follows cannot be the installer.
                    if entry.size > 0 && have + chunk.len() as u64 > entry.size {
                        drop(file);
                        let _ = std::fs::remove_file(&part);
                        return Err(format!(
                            "Update refused: the server sent more than the {} bytes the signed manifest gives for {}. \
                             Nothing was run; BMM stays on its current version.",
                            entry.size, entry.path
                        ));
                    }
                    file.write_all(&chunk).map_err(|e| format!("Failed to write to file: {e}"))?;
                    have += chunk.len() as u64;
                    if last_emit.elapsed() >= std::time::Duration::from_millis(120) {
                        emit("downloading", have, total, resumed);
                        last_emit = std::time::Instant::now();
                    }
                }
                file.flush().map_err(|e| format!("Failed to write to file: {e}"))?;
                emit("downloading", have, total, resumed);
            }
        }

        emit("verifying", have, have, resumed);
        let mut bytes = Vec::with_capacity(have as usize);
        let mut f = File::open(&part).map_err(|e| format!("Failed to read the download: {e}"))?;
        f.rewind().ok();
        f.read_to_end(&mut bytes).map_err(|e| format!("Failed to read the download: {e}"))?;
        drop(f);
        let _ = std::fs::remove_file(&part);
        match check_installer_bytes(entry, &bytes) {
            Ok(()) => return Ok(bytes),
            // A resumed file can carry a bad stretch from an earlier, different attempt.
            Err(_) if resumed && attempt == 0 => {
                log_line("[UPDATE] Resumed download failed the hash; downloading again from the start");
                continue;
            }
            Err(e) => return Err(e),
        }
    }
    Err("Update refused: the download did not match the signed manifest twice. BMM stays on its current version.".to_string())
}

/// The downloaded installer is the one the manifest names, byte for byte.
pub(crate) fn check_installer_bytes(entry: &ManifestFile, bytes: &[u8]) -> Result<(), String> {
    use sha2::{Digest, Sha256};
    let actual = format!("{:x}", Sha256::digest(bytes));
    if actual != entry.sha256 {
        return Err(format!(
            "Update refused: the downloaded installer {} does not match the signed manifest \
             (expected SHA-256 {}, got {}). It was not run; BMM stays on its current version.",
            entry.path, entry.sha256, actual
        ));
    }
    Ok(())
}

/// Progress event emitted per file during incremental update.
#[derive(Clone, Serialize)]
pub struct IncrementalProgress {
    pub file: String,
    pub index: usize,
    pub total: usize,
    pub status: String, // "downloading" | "verifying" | "applied" | "error"
}

/// Result returned after applying an incremental update.
#[derive(Serialize)]
pub struct IncrementalResult {
    pub applied: usize,
    pub skipped: usize,
    pub errors: Vec<String>,
}

const DEFAULT_UPDATE_API: &str = "https://api.github.com/repos/FreeProject089/BetterModsManager/releases";

/// The URL to ask for a release list or for the latest one.
///
/// Two feeds are supported and their paths are NOT the same shape, which is the whole reason
/// this function exists rather than a `format!` at each call site:
///
///   GitHub   base = .../repos/OWNER/REPO/releases
///            list = base                      latest = base + "/latest"
///   BCWEB    base = .../api/updates/bmm
///            list = base + "/releases"        latest = base + "/latest"
///
/// `latest` happens to be base + "/latest" on both. The LIST is where a naive swap of one
/// base for the other produces a 404 — and a 404 is read as NO_RELEASE, so the failure would
/// have looked like "you are up to date" rather than like an error.
fn release_url(api_base: &str, include_pre: bool) -> String {
    let base = api_base.trim_end_matches('/');
    if !include_pre {
        return format!("{}/latest", base);
    }
    if base.ends_with("/releases") {
        format!("{}?per_page=20", base)
    } else {
        format!("{}/releases", base)
    }
}

/// Whether a failure against one source is worth trying the next one for.
///
/// A 404 is NOT: it means that feed genuinely has no release, and the fallback almost
/// certainly has none either. Everything else is — and 403/429 is the case this whole
/// mechanism exists for, because GitHub allows 60 unauthenticated API calls per hour PER IP.
/// Behind a shared address (a company, a campus, a CGNAT provider) that budget is spent by
/// other people, and BMM would report a network error for the rest of the hour.
fn worth_retrying(err: &str) -> bool {
    err == "NETWORK_ERROR" || err == "RATE_LIMITED"
}

/// Fetch the release object from ONE source. Errors are the small vocabulary the caller
/// switches on: NETWORK_ERROR, RATE_LIMITED, NO_RELEASE, or a message.
async fn fetch_release(client: &reqwest::Client, api_base: &str, include_pre: bool) -> Result<serde_json::Value, String> {
    let url = release_url(api_base, include_pre);
    let response = client.get(&url).send().await.map_err(|e| {
        log_line(format!("[UPDATE] Network error from {} (skipped): {}", api_base, e));
        "NETWORK_ERROR".to_string()
    })?;
    let status = response.status();
    if !status.is_success() {
        if status.as_u16() == 404 { return Err("NO_RELEASE".to_string()); }
        if status.as_u16() == 403 || status.as_u16() == 429 {
            log_line(format!("[UPDATE] {} rate-limited ({})", api_base, status));
            return Err("RATE_LIMITED".to_string());
        }
        if status.as_u16() >= 500 {
            log_line(format!("[UPDATE] {} returned {} — skipped", api_base, status));
            return Err("NETWORK_ERROR".to_string());
        }
        return Err(format!("Update API returned status {}", status));
    }
    let parsed: serde_json::Value = response.json().await.map_err(|e| format!("JSON parse error: {}", e))?;
    if !include_pre {
        // `/latest` never returns a pre-release on GitHub, but a mirror can (BCWEB's feed, or a
        // GitHub "latest" set by hand on a pre-release). The stable channel must not follow it:
        // read the list and take the newest STABLE release instead.
        let flagged = parsed["prerelease"].as_bool().unwrap_or(false) || parsed["draft"].as_bool().unwrap_or(false);
        if !flagged {
            return Ok(parsed);
        }
        log_line(format!("[UPDATE] {} answered \"latest\" with a pre-release; reading the list", api_base));
        return fetch_list(client, api_base, false).await;
    }
    select_release(parsed.as_array().map(|a| a.as_slice()).unwrap_or(&[]), true)
        .ok_or_else(|| "NO_RELEASE".to_string())
}

/// The release list of one source, reduced to the release the channel offers.
async fn fetch_list(client: &reqwest::Client, api_base: &str, include_pre: bool) -> Result<serde_json::Value, String> {
    let url = release_url(api_base, true);
    let response = client.get(&url).send().await.map_err(|_| "NETWORK_ERROR".to_string())?;
    if !response.status().is_success() {
        return Err(match response.status().as_u16() {
            404 => "NO_RELEASE".to_string(),
            403 | 429 => "RATE_LIMITED".to_string(),
            s if s >= 500 => "NETWORK_ERROR".to_string(),
            _ => format!("Update API returned status {}", response.status()),
        });
    }
    let parsed: serde_json::Value = response.json().await.map_err(|e| format!("JSON parse error: {}", e))?;
    select_release(parsed.as_array().map(|a| a.as_slice()).unwrap_or(&[]), include_pre)
        .ok_or_else(|| "NO_RELEASE".to_string())
}

/// The release a channel offers, out of a release list: never a draft, a pre-release only when
/// `include_pre`, and the HIGHEST version rather than the first entry. GitHub orders the list by
/// creation date, so a hot-fix to an older line published after a newer release (1.0.3 after
/// 1.1.0-beta.1) used to come first and hide the newer one.
pub(crate) fn select_release(releases: &[serde_json::Value], include_pre: bool) -> Option<serde_json::Value> {
    let tag = |r: &serde_json::Value| r["tag_name"].as_str().unwrap_or("").to_string();
    let mut best: Option<&serde_json::Value> = None;
    for r in releases {
        if r["draft"].as_bool().unwrap_or(false) {
            continue;
        }
        if !include_pre && r["prerelease"].as_bool().unwrap_or(false) {
            continue;
        }
        if extract_version(&tag(r)).is_none() {
            continue;
        }
        if best.map(|b| is_newer(&tag(r), &tag(b))).unwrap_or(true) {
            best = Some(r);
        }
    }
    best.cloned()
}

/// The channel a check reads: the pre-release channel when the person chose it, or when this
/// build is itself a pre-release (it would otherwise never hear of the next one).
pub(crate) fn effective_include_pre(chosen: bool, current_version: &str) -> bool {
    chosen || is_prerelease_version(current_version)
}

/// The release object turned into what the UI shows. Pure, so the asset rules are tested
/// against fixtures (autoupdate_flow_tests.rs).
pub(crate) fn release_to_info(body: &serde_json::Value, current_version: &str, include_pre: bool) -> UpdateInfo {
    let is_prerelease = body["prerelease"].as_bool().unwrap_or(false);
    let tag_name = body["tag_name"]
        .as_str()
        .unwrap_or("")
        .trim_start_matches('v')
        .trim_start_matches('V')
        .to_string();
    let release_url = body["html_url"].as_str().unwrap_or("").to_string();
    let release_notes = body["body"].as_str().unwrap_or("").to_string();
    let assets = body["assets"].as_array().cloned().unwrap_or_default();

    // The installer asset: BMM-Setup.exe (BetterInstaller's setup, the only installer a release
    // carries since 1.0.2), else any .exe, else an .msi (releases before 1.0). Only a HINT for
    // download_and_install_update, which picks among the signed manifest's entries.
    let named = |pred: &dyn Fn(&str) -> bool| {
        assets.iter().find(|a| a["name"].as_str().map(|n| pred(&n.to_ascii_lowercase())).unwrap_or(false))
    };
    let installer = named(&|n| n == "bmm-setup.exe")
        .or_else(|| named(&|n| n.ends_with(".exe")))
        .or_else(|| named(&|n| n.ends_with(".msi")));
    let download_url = installer
        .and_then(|a| a["browser_download_url"].as_str().map(|s| s.to_string()))
        .unwrap_or_else(|| release_url.clone());
    let download_size = installer.and_then(|a| a["size"].as_u64()).unwrap_or(0);

    let manifest_url = assets
        .iter()
        .find(|a| a["name"].as_str().map(|n| n == "update-manifest.json").unwrap_or(false))
        .and_then(|a| a["browser_download_url"].as_str().map(|s| s.to_string()));

    let has_update = is_newer_version(&tag_name, current_version);
    // The major component of each version (the digits before the first '.'), 0 if unparseable.
    let major = |v: &str| v.trim_start_matches('v').split('.').next().and_then(|s| s.parse::<u32>().ok()).unwrap_or(0);
    let major_bump = major(&tag_name) > major(current_version);
    let verification = if manifest_url.is_some() { "signed" } else { "unverified" }.to_string();

    UpdateInfo {
        has_update,
        current_version: current_version.to_string(),
        latest_version: tag_name,
        release_url,
        release_notes,
        download_url,
        manifest_url,
        is_prerelease,
        major_bump,
        download_size,
        channel: if include_pre { "prerelease" } else { "stable" }.to_string(),
        release_tag: body["tag_name"].as_str().unwrap_or("").to_string(),
        verification,
        verification_note: String::new(),
    }
}


/// Checks GitHub releases API for a newer version.
/// Compares version strings using semver-like logic.
#[tauri::command]
pub async fn check_for_update(app_handle: tauri::AppHandle, include_prerelease: Option<bool>, api_base_url: Option<String>, fallback_api_url: Option<String>) -> Result<UpdateInfo, String> {
    let current_version = app_handle.package_info().version.to_string();
    let include_pre = effective_include_pre(include_prerelease.unwrap_or(false), &current_version);
    let api_base = api_base_url.as_deref().unwrap_or(DEFAULT_UPDATE_API);
    log_line(format!("[UPDATE] Checking for updates (current: v{}, prerelease: {})", current_version, include_pre));

    let client = reqwest::Client::builder()
        .user_agent("BetterModManager")
        .timeout(std::time::Duration::from_secs(10))
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    // Primary, then fallback. The release object is the same shape either way — BCWEB
    // deliberately serves the GitHub /releases and /releases/latest shapes so nothing
    // downstream has to know which one answered.
    //
    // Choosing the object: prerelease ON → list, newest first, first non-draft (which may be
    // a pre-release). Prerelease OFF → the "latest" endpoint, which excludes pre-releases.
    let body: serde_json::Value = match fetch_release(&client, api_base, include_pre).await {
        Ok(v) => v,
        Err(e) => {
            let fb = fallback_api_url.as_deref().map(str::trim).filter(|u| !u.is_empty());
            match (worth_retrying(&e), fb) {
                (true, Some(url)) => {
                    log_line(format!("[UPDATE] Primary failed ({}) — trying fallback {}", e, url));
                    // A fallback that also fails reports ITS OWN error, not the primary's: the
                    // last thing tried is the one whose message describes the current state.
                    fetch_release(&client, url, include_pre).await?
                }
                _ => return Err(e),
            }
        }
    };

    let mut info = release_to_info(&body, &current_version, include_pre);
    if info.manifest_url.is_none() && info.has_update {
        // Say up front what the install step will be able to check (update.json).
        let (v, note) = label_from_update_json(&body, &current_version).await;
        info.verification = v;
        info.verification_note = note;
    }
    Ok(info)
}

/// Locate the BetterInstaller maintenance binary left next to BMM at install time
/// (`<install>/uninstall.exe` — it handles repair / update / uninstall). `None` when
/// BMM wasn't installed by BetterInstaller (dev/portable run).
#[cfg(windows)]
fn installer_maintenance_exe(app_handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    // Install root = parent of the resource dir (where frontend/, Lang/ … live), with a
    // fallback to the running exe's folder.
    let root = app_handle
        .path()
        .resource_dir()
        .ok()
        .and_then(|mut p| {
            p.pop();
            Some(p)
        })
        .or_else(|| {
            std::env::current_exe()
                .ok()
                .and_then(|e| e.parent().map(|p| p.to_path_buf()))
        })?;
    let exe = root.join("uninstall.exe");
    exe.exists().then_some(exe)
}
#[cfg(not(windows))]
fn installer_maintenance_exe(_app_handle: &tauri::AppHandle) -> Option<std::path::PathBuf> {
    None
}

/// Check for updates *through BetterInstaller* — runs `<install>/uninstall.exe
/// --check-update` and returns its JSON report (`update_available`, `current_version`,
/// `latest_version`, `notes`, `url`, …). Returns `Ok(None)` when BMM wasn't installed by
/// BetterInstaller, so the caller can fall back to the direct GitHub check.
///
/// Async and time-boxed: it used to be a plain `fn` (Tauri runs those on the main thread) that
/// waited on `uninstall.exe` with no limit, so a slow or unreachable manifest host froze the
/// whole window during the startup check.
#[tauri::command]
pub async fn check_update_via_installer(
    app_handle: tauri::AppHandle,
) -> Result<Option<serde_json::Value>, String> {
    let exe = match installer_maintenance_exe(&app_handle) {
        Some(e) => e,
        None => return Ok(None),
    };
    let out = tauri::async_runtime::spawn_blocking(move || {
        let mut cmd = crate::commands::proc::hidden_command(&exe);
        cmd.arg("--check-update");
        crate::commands::proc::run_with_timeout(cmd, 45)
    })
    .await
    .map_err(|e| format!("Failed to run updater: {e}"))?
    .map_err(|e| format!("Failed to run updater: {e}"))?;
    if out.timed_out {
        return Err("The BetterInstaller update check did not answer in time".to_string());
    }
    let json: serde_json::Value =
        serde_json::from_str(out.stdout.trim()).map_err(|e| format!("Bad updater output: {e}"))?;
    log_line(format!("[UPDATE] BetterInstaller check: {json}"));
    Ok(Some(json))
}

/// Apply an update *through BetterInstaller*: spawn `<install>/uninstall.exe --update`
/// (downloads + verifies the signed `.bpkg`, delta when offered, rollback on failure)
/// then exit BMM so its files can be replaced. Errs when not installed by BetterInstaller
/// (the caller falls back to the direct download).
///
/// Async: ShellExecuteExW waits while a Windows permission prompt is open, and a plain `fn`
/// command would hold the main thread (and freeze the window) for that long.
#[tauri::command]
pub async fn update_via_installer(app_handle: tauri::AppHandle) -> Result<(), String> {
    let exe = installer_maintenance_exe(&app_handle)
        .ok_or_else(|| "not installed via BetterInstaller".to_string())?;
    log_line(format!("[UPDATE] Launching BetterInstaller updater: {exe:?}"));
    // ShellExecuteExW: an install under Program Files needs the UAC prompt, which a plain
    // CreateProcess refuses with ERROR_ELEVATION_REQUIRED (the UI then silently fell back to the
    // full-installer download). The argument is a constant.
    #[cfg(windows)]
    {
        let target = exe.clone();
        tauri::async_runtime::spawn_blocking(move || crate::commands::proc::shell_launch(&target, Some("--update")))
            .await
            .map_err(|e| format!("Failed to launch updater: {e}"))?
            .map_err(|e| {
                log_line(format!("[UPDATE] Updater launch failed (code {}): {}", e.code, e.message));
                format!("Failed to launch updater: {}", e.message)
            })?;
    }
    #[cfg(not(windows))]
    crate::commands::proc::hidden_command(&exe)
        .arg("--update")
        .spawn()
        .map_err(|e| format!("Failed to launch updater: {e}"))?;
    // Give the updater a moment to start, then quit so the install dir unlocks.
    std::thread::sleep(std::time::Duration::from_millis(300));
    std::process::exit(0);
}

/// Returns true if `latest` is strictly newer than `current`.
///
/// The same ordering as the signed manifest's version rule ([`is_newer`]). It used to drop
/// any component that was not a bare number (`1.2.3-rc1` read as `1.2`), so the release check
/// and the manifest check could disagree about the same two strings: the Quick Update button
/// would appear for a release whose manifest is then refused as "not newer", or the reverse.
fn is_newer_version(latest: &str, current: &str) -> bool {
    is_newer(latest, current)
}

/// Largest installer accepted, whatever the manifest says (BMM's is well under 100 MB).
const INSTALLER_MAX_BYTES: u64 = 1024 * 1024 * 1024;

/// The full-installer path: download, check, start, quit.
///
/// With `manifest_url` (the release's signed `update-manifest.json`, verified exactly as for a
/// Quick Update: publisher key, app, expiry, newer version): only an installer it lists, with the
/// SHA-256 it gives. Without one: the release `tag` is re-read from GitHub and its installer
/// checked against the release's update.json ([`install_from_release`]); `confirm_sha256` is set
/// only by the dialog's « Install anyway ». `url` and `filename` never choose what is downloaded.
#[tauri::command]
pub async fn download_and_install_update(
    app_handle: tauri::AppHandle,
    url: String,
    manifest_url: Option<String>,
    filename: Option<String>,
    tag: Option<String>,
    confirm_sha256: Option<String>,
) -> Result<(), String> {
    let _ = filename;
    log_line(format!("[UPDATE] Full installer requested: {}", url));
    let Some(manifest_url) = manifest_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) else {
        // No signed manifest: the release's update.json, then the person's choice.
        return download_and_install_from_release(&app_handle, tag.as_deref(), confirm_sha256.as_deref()).await;
    };
    let document = fetch_manifest_document(manifest_url).await?;
    let current = app_handle.package_info().version.to_string();
    let manifest = verify_manifest_text(&document, &publisher_key()?, &current, chrono::Utc::now())
        .inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    // `url` only chooses among the SIGNED entries; the entry's own URL is what is downloaded.
    let entry = pick_installer(&manifest, &url).inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;

    log_line(format!("[UPDATE] Downloading v{} installer from: {}", manifest.version, entry.download_url));
    let bytes = download_installer(&app_handle, entry).await.inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    // download_installer returns only verified bytes; checked again here, next to the write and
    // the launch, so the order "verify, then write, then run" is visible in one place.
    check_installer_bytes(entry, &bytes).inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    let file_path = write_installer_to_fresh_dir(entry, &bytes)?;
    launch_installer_and_exit(&app_handle, &file_path, bytes.len() as u64).await
}

/// The no-manifest half of `download_and_install_update`: [`install_from_release`], then start
/// the installer and quit.
async fn download_and_install_from_release(app_handle: &tauri::AppHandle, tag: Option<&str>, confirm_sha256: Option<&str>) -> Result<(), String> {
    let tag = tag.map(str::trim).filter(|t| !t.is_empty()).ok_or_else(|| {
        "Update refused: this release cannot be checked from here. BMM stays on its current version; \
         download the installer from the release page."
            .to_string()
    })?;
    let file_path = install_from_release(app_handle, tag, confirm_sha256).await.inspect_err(|e| {
        if !e.starts_with(UNVERIFIED_PREFIX) {
            log_line(format!("[UPDATE] {}", e));
        }
    })?;
    let size = std::fs::metadata(&file_path).map(|m| m.len()).unwrap_or(0);
    launch_installer_and_exit(app_handle, &file_path, size).await
}

/// Write verified installer bytes under the entry's own name, in a folder of our own made new
/// for this launch: a fixed name in %TEMP% is one another program can plant or swap between the
/// check and the launch. Never the name the UI derived from the URL.
pub(crate) fn write_installer_to_fresh_dir(entry: &ManifestFile, bytes: &[u8]) -> Result<std::path::PathBuf, String> {
    let file_name = installer_file_name(&entry.path).ok_or_else(|| "Update refused: bad installer name".to_string())?;
    let dir = std::env::temp_dir().join(format!("bmm_update_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create folder: {}", e))?;
    let file_path = dir.join(&file_name);
    log_line(format!("[UPDATE] Installer verified (SHA-256 {}), saving to: {:?}", entry.sha256, file_path));
    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(bytes).map_err(|e| format!("Failed to write to file: {}", e))?;
    drop(file);
    Ok(file_path)
}

/// Start the verified installer at `file_path`, then quit so it can replace BMM's files.
async fn launch_installer_and_exit(app_handle: &tauri::AppHandle, file_path: &std::path::Path, size: u64) -> Result<(), String> {
    log_line("[UPDATE] Launching installer and exiting...");
    emit_download(app_handle, "launching", size, size, false);

    #[cfg(target_os = "windows")]
    {
        // ShellExecuteExW, not the `open` crate: open 5.x goes through a hidden PowerShell
        // Start-Process and reports only "ExitStatus(1)" when it fails (see proc::shell_launch).
        // The file name comes from the signed manifest (installer_file_name: one plain
        // .exe/.msi name) and nothing is put on a command line.
        // Off the async runtime: ShellExecuteExW waits while a permission prompt is open.
        // A BetterInstaller install updates in place with no questions (BMM-Setup.exe --update
        // --wait-pid <pid> --launch); anything else, or an installer that answers « no existing
        // install », runs interactively.
        let name = file_path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let args = installer_args(installer_maintenance_exe(app_handle).is_some(), &name, std::process::id());
        log_line(format!("[UPDATE] Installer arguments: {:?}", args));
        let target = file_path.to_path_buf();
        let launch_args = args.clone();
        let mut result = tauri::async_runtime::spawn_blocking(move || crate::commands::proc::shell_launch(&target, launch_args.as_deref()))
            .await
            .map_err(|e| format!("Failed to start installer: {e}"))?;
        if let Err(e) = &result {
            if retry_interactively(&args, e.exit_code) {
                log_line("[UPDATE] No existing install to update: starting the installer interactively");
                let target = file_path.to_path_buf();
                result = tauri::async_runtime::spawn_blocking(move || crate::commands::proc::shell_launch(&target, None))
                    .await
                    .map_err(|e| format!("Failed to start installer: {e}"))?;
            }
        }
        result.map_err(|e| {
            log_line(format!("[UPDATE] Installer launch failed (code {}, exit {:?}): {}", e.code, e.exit_code, e.message));
            format!("Failed to start installer: {} The installer was kept at {}.", e.message, file_path.display())
        })?;
    }
    #[cfg(target_os = "macos")]
    {
        crate::commands::proc::hidden_command("open")
            .arg(&file_path.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        crate::commands::proc::hidden_command("xdg-open")
            .arg(&file_path.to_string_lossy().to_string())
            .spawn()
            .map_err(|e| format!("Failed to start installer: {}", e))?;
    }

    // Exit BMM
    std::process::exit(0);
}

// ── Releases without a signed update-manifest.json: the release's update.json ───────────────
//
// The published 1.0.1 has no update-manifest.json. For such a release the install step re-reads
// the release from GitHub by its tag (nothing the UI says is reused), takes its installer
// (BMM-Setup.exe, else the only .exe, else the only .msi; two of a kind is refused), from BMM's
// own GitHub releases only, and compares the downloaded bytes with the SHA-256 the release's
// `update.json` declares for that file. update.json is BetterInstaller's signed manifest, read
// the way BetterInstaller reads it with a pinned key: publisher signature over its own context
// string, BMM's app id, at most MANIFEST_MAX_VALIDITY_DAYS valid and not expired, a version newer than this one.
//
// When that cannot vouch for the file (no update.json, an invalid one, no entry for the
// installer, or bytes that differ) the dialog says what failed and the installer runs only if
// the person chooses « Install anyway »: a second call naming the SHA-256 of exactly the bytes
// that were shown (`confirm_sha256`). GitHub's own `digest` is shown as extra information, and a
// file that differs from it is treated as a mismatch.

/// Every installer BMM downloads from a release lives under this prefix.
pub const REPO_DOWNLOAD_PREFIX: &str = "https://github.com/FreeProject089/BetterModsManager/releases/download/";
/// The release is re-read from here, by tag, at install time.
const RELEASE_BY_TAG_API: &str = "https://api.github.com/repos/FreeProject089/BetterModsManager/releases/tags/";
/// BetterInstaller's context string for `update.json` (bpkg-core/src/update.rs).
pub const BI_MANIFEST_SIG_CONTEXT: &[u8] = b"BetterInstaller update manifest v1\n";
const RELEASE_JSON_MAX_BYTES: usize = 4 * 1024 * 1024;

/// One release asset, as the GitHub API describes it.
#[derive(Debug, Clone, PartialEq)]
pub struct ReleaseAsset {
    pub name: String,
    pub url: String,
    pub size: u64,
    /// The SHA-256 GitHub publishes for the asset (`digest`), when it does. Extra information
    /// only: it is not what vouches for the file.
    pub github_sha256: Option<String>,
}

/// `sha256:<64 hex>` → the lowercase hex.
pub(crate) fn github_digest(asset: &serde_json::Value) -> Option<String> {
    let h = asset["digest"].as_str()?.strip_prefix("sha256:")?.to_ascii_lowercase();
    is_lower_sha256(&h).then_some(h)
}

/// A tag that can go into the API path as it is.
pub(crate) fn valid_tag(tag: &str) -> bool {
    !tag.is_empty() && tag.len() <= 64 && tag.bytes().all(|b| b.is_ascii_alphanumeric() || b"._-+".contains(&b))
}

/// The installer of a release: `BMM-Setup.exe`, else the only `.exe`, else the only `.msi`.
/// Two candidates of the same rank is refused (which one would be a guess), as is a URL outside
/// `prefix`, a name that is not one plain .exe/.msi name, and a size of 0 or over the cap.
pub(crate) fn pick_release_installer(release: &serde_json::Value, prefix: &str) -> Result<ReleaseAsset, String> {
    let assets = release["assets"].as_array().cloned().unwrap_or_default();
    let name = |a: &serde_json::Value| a["name"].as_str().unwrap_or("").to_ascii_lowercase();
    let rank = |pred: &dyn Fn(&str) -> bool| assets.iter().filter(|a| pred(&name(a))).collect::<Vec<_>>();
    let mut chosen = None;
    for (label, list) in [
        ("BMM-Setup.exe", rank(&|n| n == "bmm-setup.exe")),
        (".exe", rank(&|n| n.ends_with(".exe"))),
        (".msi", rank(&|n| n.ends_with(".msi"))),
    ] {
        match list.len() {
            0 => continue,
            1 => {
                chosen = Some(list[0]);
                break;
            }
            n => {
                return Err(format!(
                    "Update refused: the release has {n} {label} installers, so which one to run would be a guess. Use the release page."
                ))
            }
        }
    }
    let a = chosen.ok_or_else(|| "Update refused: the release has no installer (.exe or .msi). Use the release page.".to_string())?;
    let asset = ReleaseAsset {
        name: a["name"].as_str().unwrap_or("").to_string(),
        url: a["browser_download_url"].as_str().unwrap_or("").to_string(),
        size: a["size"].as_u64().unwrap_or(0),
        github_sha256: github_digest(a),
    };
    installer_file_name(&asset.name).ok_or_else(|| format!("Update refused: {:?} is not a plain installer name", asset.name))?;
    if !asset.url.starts_with(prefix) || asset.url.contains("/../") || !asset.url.ends_with(&format!("/{}", asset.name)) {
        return Err(format!("Update refused: {} is not a download from BMM's own GitHub releases", asset.url));
    }
    if asset.size == 0 || asset.size > INSTALLER_MAX_BYTES {
        return Err(format!("Update refused: the release gives {} a size of {} bytes", asset.name, asset.size));
    }
    Ok(asset)
}

/// The release's `update.json` asset, when it has one under `prefix`.
pub(crate) fn release_update_json_url(release: &serde_json::Value, prefix: &str) -> Option<String> {
    release["assets"].as_array()?.iter().find(|a| a["name"].as_str() == Some("update.json")).and_then(|a| {
        a["browser_download_url"].as_str().filter(|u| u.starts_with(prefix)).map(str::to_string)
    })
}

#[derive(Deserialize)]
struct BiInstaller {
    #[serde(alias = "name")]
    path: String,
    sha256: String,
}

#[derive(Deserialize)]
struct BiBody {
    app_id: Option<String>,
    version: String,
    #[serde(default)]
    installers: Vec<BiInstaller>,
    issued: Option<String>,
    expires: Option<String>,
}

/// Why the installer is not vouched for: (kind, plain-words detail). Kinds: "missing" (no
/// update.json), "invalid" (it cannot be believed), "no-entry" (it lists no checksum for the
/// installer), "mismatch" (the bytes differ from what the release declares).
pub(crate) type Unvouched = (&'static str, String);

/// The SHA-256 the release's `update.json` declares for `installer`. The entry is
/// `installers: [{ "path": "BMM-Setup.exe", "sha256": "<64 hex>" }]` in the signed body
/// (BetterInstaller's release script does not write it yet: see RELEASE.md).
pub(crate) fn update_json_checksum(
    text: &str,
    key: &ed25519_dalek::VerifyingKey,
    current: &str,
    now: chrono::DateTime<chrono::Utc>,
    installer: &str,
) -> Result<String, Unvouched> {
    let bad = |why: String| Err(("invalid", why));
    let Ok(doc) = serde_json::from_str::<serde_json::Value>(text) else {
        return bad("The release's update.json is not readable.".into());
    };
    let Some(signed) = doc.get("signed").and_then(|s| s.as_str()) else {
        return bad("The release's update.json is not signed by the publisher.".into());
    };
    let sig = doc
        .get("signature")
        .and_then(|s| s.as_str())
        .filter(|s| s.len() == 128)
        .and_then(|s| hex::decode(s).ok())
        .and_then(|b| <[u8; 64]>::try_from(b).ok());
    let Some(sig) = sig else {
        return bad("The release's update.json has no valid signature.".into());
    };
    let mut msg = BI_MANIFEST_SIG_CONTEXT.to_vec();
    msg.extend_from_slice(signed.as_bytes());
    if key.verify_strict(&msg, &ed25519_dalek::Signature::from_bytes(&sig)).is_err() {
        return bad("The signature of the release's update.json does not match the publisher's key.".into());
    }
    let Ok(body) = serde_json::from_str::<BiBody>(signed) else {
        return bad("The signed part of the release's update.json is incomplete.".into());
    };
    if body.app_id.as_deref() != Some(MANIFEST_APP_ID) {
        return bad(format!("The release's update.json is for {:?}, not for BMM.", body.app_id.unwrap_or_default()));
    }
    let time = |v: &Option<String>| {
        v.as_deref()
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|t| t.with_timezone(&chrono::Utc))
    };
    let (Some(issued), Some(expires)) = (time(&body.issued), time(&body.expires)) else {
        return bad("The release's update.json has no valid dates.".into());
    };
    if expires <= issued || expires - issued > chrono::Duration::days(MANIFEST_MAX_VALIDITY_DAYS) {
        return bad(format!("The release's update.json claims a validity longer than {MANIFEST_MAX_VALIDITY_DAYS} days."));
    }
    if now >= expires {
        return bad(format!(
            "The release's update.json expired on {} (the publisher renews it before it expires; or this PC's clock is wrong).",
            expires.format("%Y-%m-%d")
        ));
    }
    if !is_newer(&body.version, current) {
        return bad(format!(
            "The release's update.json describes version {}, which is not newer than this one ({current}).",
            body.version
        ));
    }
    match body.installers.iter().find(|i| i.path.eq_ignore_ascii_case(installer)) {
        Some(i) if is_lower_sha256(&i.sha256) => Ok(i.sha256.clone()),
        Some(_) => bad(format!("The checksum the release's update.json gives for {installer} is malformed.")),
        None => Err((
            "no-entry",
            format!("The release's update.json lists no checksum for {installer} (it only describes the update package)."),
        )),
    }
}

/// What the person sees when the installer is not vouched for.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct UnverifiedInstaller {
    /// "missing" | "invalid" | "no-entry" | "mismatch" (the most serious).
    pub kind: String,
    pub detail: String,
    pub file: String,
    pub size: u64,
    pub version: String,
    /// SHA-256 of the downloaded bytes: « Install anyway » names exactly these.
    pub sha256: String,
    pub github_sha256: Option<String>,
    pub github_matches: Option<bool>,
}

/// The verdict on downloaded `bytes`: their SHA-256 when `declared` (update.json's checksum)
/// vouches for them, otherwise what is wrong. A difference from GitHub's own digest is a
/// mismatch too.
pub(crate) fn assess_download(
    declared: &Result<String, Unvouched>,
    asset: &ReleaseAsset,
    bytes: &[u8],
    version: &str,
) -> Result<String, UnverifiedInstaller> {
    use sha2::{Digest, Sha256};
    let actual = format!("{:x}", Sha256::digest(bytes));
    let github_matches = asset.github_sha256.as_ref().map(|g| *g == actual);
    let gh_note = if github_matches == Some(false) {
        format!(
            " It also differs from the checksum GitHub publishes for this file ({}).",
            asset.github_sha256.clone().unwrap_or_default()
        )
    } else {
        String::new()
    };
    let (kind, detail) = match declared {
        Ok(exp) if *exp == actual && github_matches != Some(false) => return Ok(actual),
        Ok(exp) if *exp != actual => (
            "mismatch",
            format!(
                "The downloaded file does not match what the release declares (update.json gives SHA-256 {exp}, the file has {actual}). It may be corrupted or tampered with.{gh_note}"
            ),
        ),
        Ok(_) => (
            "mismatch",
            format!("The downloaded file does not match what the release declares.{gh_note} It may be corrupted or tampered with."),
        ),
        Err((_, d)) if github_matches == Some(false) => ("mismatch", format!("{d}{gh_note} It may be corrupted or tampered with.")),
        Err((k, d)) => (*k, d.clone()),
    };
    Err(UnverifiedInstaller {
        kind: kind.to_string(),
        detail,
        file: asset.name.clone(),
        size: bytes.len() as u64,
        version: version.to_string(),
        sha256: actual,
        github_sha256: asset.github_sha256.clone(),
        github_matches,
    })
}

/// Run the bytes? Vouched-for bytes, yes. Others only when the person chose « Install anyway »
/// for exactly these bytes (`confirmed_sha256`, sent by the dialog's button and nothing else).
pub(crate) fn may_launch(assessment: &Result<String, UnverifiedInstaller>, confirmed_sha256: Option<&str>) -> bool {
    match assessment {
        Ok(_) => true,
        Err(u) => confirmed_sha256.map(|c| !u.sha256.is_empty() && c.trim() == u.sha256).unwrap_or(false),
    }
}

/// The label the update dialog shows before anything is downloaded.
pub(crate) fn verification_label(declared: &Result<String, Unvouched>) -> (String, String) {
    match declared {
        Ok(_) => ("update-json".to_string(), String::new()),
        Err((_, d)) => ("unverified".to_string(), d.clone()),
    }
}

/// The error string that carries an [`UnverifiedInstaller`] to the dialog.
pub const UNVERIFIED_PREFIX: &str = "UNVERIFIED:";

/// `url` (https only; the loopback under cfg(test)), at most `cap` bytes, whole.
async fn fetch_capped(url: &str, cap: usize, what: &str) -> Result<Vec<u8>, String> {
    if !is_https(url) {
        return Err(format!("Update refused: the {what} URL is not https"));
    }
    let mut response = crate::commands::net::client()
        .get(url)
        .header(reqwest::header::USER_AGENT, "BetterModManager")
        .timeout(std::time::Duration::from_secs(30))
        .send()
        .await
        .map_err(|e| format!("Network error: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("Download of the {what} failed with status: {}", response.status()));
    }
    let mut out = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| format!("Network error: {e}"))? {
        if out.len() + chunk.len() > cap {
            return Err(format!("Update refused: the {what} is too large"));
        }
        out.extend_from_slice(&chunk);
    }
    Ok(out)
}

/// The installer asset's bytes, never more than its announced `size`, reporting progress. A
/// short download is an error (try again), not a file.
pub(crate) async fn download_asset(
    asset: &ReleaseAsset,
    report: &mut (dyn FnMut(DownloadProgress) + Send),
) -> Result<Vec<u8>, String> {
    if !is_https(&asset.url) {
        return Err("Update refused: the installer URL is not https".to_string());
    }
    let mut response = crate::commands::net::client()
        .get(&asset.url)
        .header(reqwest::header::USER_AGENT, "BetterModManager")
        .send()
        .await
        .map_err(|e| format!("Download error: {e}. Check the connection and try again."))?;
    if !response.status().is_success() {
        return Err(format!("Download failed with status: {}", response.status()));
    }
    let mut out: Vec<u8> = Vec::with_capacity(asset.size as usize);
    let mut emit = |phase: &str, received: u64, total: u64| report(DownloadProgress { phase: phase.to_string(), received, total, resumed: false });
    emit("downloading", 0, asset.size);
    let mut last = std::time::Instant::now();
    loop {
        let chunk = match response.chunk().await {
            Ok(Some(c)) => c,
            Ok(None) => break,
            Err(e) => return Err(format!("Download interrupted ({e}). Try again.")),
        };
        if out.len() as u64 + chunk.len() as u64 > asset.size {
            return Err(format!(
                "Update refused: the server sent more than the {} bytes the release gives for {}. Nothing was run.",
                asset.size, asset.name
            ));
        }
        out.extend_from_slice(&chunk);
        if last.elapsed() >= std::time::Duration::from_millis(120) {
            emit("downloading", out.len() as u64, asset.size);
            last = std::time::Instant::now();
        }
    }
    emit("downloading", out.len() as u64, asset.size);
    if out.len() as u64 != asset.size {
        return Err(format!("Download incomplete: {} of {} bytes arrived. Try again.", out.len(), asset.size));
    }
    emit("verifying", out.len() as u64, out.len() as u64);
    Ok(out)
}

/// The checksum the release's update.json declares for `installer`, or why there is none.
async fn declared_checksum(
    release: &serde_json::Value,
    prefix: &str,
    installer: &str,
    key: &ed25519_dalek::VerifyingKey,
    current: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<String, Unvouched> {
    let Some(url) = release_update_json_url(release, prefix) else {
        return Err(("missing", "This release publishes no update.json, so nothing declares the installer's checksum.".to_string()));
    };
    let text = fetch_capped(&url, MANIFEST_MAX_BYTES, "update.json")
        .await
        .map_err(|e| ("invalid", format!("The release's update.json could not be downloaded ({e}).")))?;
    let text = String::from_utf8(text).map_err(|_| ("invalid", "The release's update.json is not readable.".to_string()))?;
    update_json_checksum(&text, key, current, now, installer)
}

/// Where the release-by-tag path looks: production values, or a test server.
pub(crate) struct ReleaseSource<'a> {
    /// `<api>/releases/tags/` — the tag is appended.
    pub by_tag_api: &'a str,
    /// The only place an installer or update.json may be downloaded from.
    pub download_prefix: &'a str,
}

pub(crate) const GITHUB_SOURCE: ReleaseSource<'static> =
    ReleaseSource { by_tag_api: RELEASE_BY_TAG_API, download_prefix: REPO_DOWNLOAD_PREFIX };

/// The release-by-tag path up to the decision: re-read the release, pick its installer, read
/// update.json, download, assess. Returns the asset, its bytes and the assessment. Nothing runs.
pub(crate) async fn fetch_and_assess(
    src: &ReleaseSource<'_>,
    tag: &str,
    current: &str,
    key: &ed25519_dalek::VerifyingKey,
    now: chrono::DateTime<chrono::Utc>,
    report: &mut (dyn FnMut(DownloadProgress) + Send),
) -> Result<(ReleaseAsset, Vec<u8>, Result<String, UnverifiedInstaller>), String> {
    if !valid_tag(tag) {
        return Err("Update refused: unusable release tag".to_string());
    }
    let release = fetch_capped(&format!("{}{tag}", src.by_tag_api), RELEASE_JSON_MAX_BYTES, "release description").await?;
    let release: serde_json::Value = serde_json::from_slice(&release)
        .map_err(|e| format!("Update refused: the release description is not readable ({e})"))?;
    if release["tag_name"].as_str() != Some(tag) {
        return Err(format!("Update refused: GitHub answered for another release than {tag}"));
    }
    let asset = pick_release_installer(&release, src.download_prefix)?;
    let version = tag.trim_start_matches(['v', 'V']).to_string();
    if !is_newer(&version, current) {
        return Err(format!("Update refused: {tag} is not newer than this version ({current})."));
    }
    let declared = declared_checksum(&release, src.download_prefix, &asset.name, key, current, now).await;
    log_line(format!("[UPDATE] Downloading {} ({} bytes) from: {}", asset.name, asset.size, asset.url));
    let bytes = download_asset(&asset, report).await?;
    let assessment = assess_download(&declared, &asset, &bytes, &version);
    Ok((asset, bytes, assessment))
}

/// Bytes downloaded and found unvouched for, kept in memory (never on disk, where another
/// program could swap them) until the person answers. « Install anyway » runs these.
struct PendingInstaller {
    tag: String,
    name: String,
    bytes: Vec<u8>,
    sha256: String,
}
static PENDING: std::sync::Mutex<Option<PendingInstaller>> = std::sync::Mutex::new(None);

/// The release-by-tag path, whole: the file to launch, or an [`UNVERIFIED_PREFIX`] error that
/// the dialog turns into « Cancel » / « Install anyway ».
async fn install_from_release(app_handle: &tauri::AppHandle, tag: &str, confirmed_sha256: Option<&str>) -> Result<std::path::PathBuf, String> {
    if let Some(c) = confirmed_sha256 {
        let pending = PENDING.lock().map(|mut p| p.take()).unwrap_or(None);
        if let Some(p) = pending.filter(|p| p.tag == tag && p.sha256 == c.trim()) {
            log_line(format!("[UPDATE] Running {} {} UNVERIFIED, as the user chose (SHA-256 {})", p.name, tag, p.sha256));
            return write_bytes_to_fresh_dir(&p.name, &p.bytes);
        }
    }
    let current = app_handle.package_info().version.to_string();
    let mut report = |p: DownloadProgress| {
        let _ = app_handle.emit("update-download-progress", p);
    };
    let (asset, bytes, assessment) =
        fetch_and_assess(&GITHUB_SOURCE, tag, &current, &publisher_key()?, chrono::Utc::now(), &mut report).await?;
    if may_launch(&assessment, confirmed_sha256) {
        match &assessment {
            Ok(sha) => log_line(format!("[UPDATE] {} matches update.json (SHA-256 {sha})", asset.name)),
            Err(u) => log_line(format!("[UPDATE] Running {} UNVERIFIED ({}), as the user chose (SHA-256 {})", asset.name, u.kind, u.sha256)),
        }
        return write_bytes_to_fresh_dir(&asset.name, &bytes);
    }
    let Err(u) = assessment else { unreachable!("a vouched-for download is always launched") };
    log_line(format!("[UPDATE] {} not vouched for ({}): {}", asset.name, u.kind, u.detail));
    if let Ok(mut p) = PENDING.lock() {
        *p = Some(PendingInstaller { tag: tag.to_string(), name: asset.name, bytes, sha256: u.sha256.clone() });
    }
    Err(format!("{UNVERIFIED_PREFIX}{}", serde_json::to_string(&u).unwrap_or_default()))
}

/// What the check says about a release with no signed manifest, before anything is downloaded.
async fn label_from_update_json(body: &serde_json::Value, current: &str) -> (String, String) {
    let declared = match (pick_release_installer(body, REPO_DOWNLOAD_PREFIX), publisher_key()) {
        (Ok(asset), Ok(key)) => declared_checksum(body, REPO_DOWNLOAD_PREFIX, &asset.name, &key, current, chrono::Utc::now()).await,
        (Err(e), _) | (_, Err(e)) => Err(("invalid", e)),
    };
    verification_label(&declared)
}

// ── How the installer is started ────────────────────────────────────────────────────────────

/// The exit code BetterInstaller's `--update` returns at once when there is no existing install
/// to update. BMM then starts the same installer interactively.
pub const INSTALLER_EXIT_NO_EXISTING_INSTALL: u32 = 3;

/// The installer's arguments. `BMM-Setup.exe --update --wait-pid <pid> --launch` (update the
/// existing install with no questions, once BMM has exited, then start BMM again) only when
/// this copy was installed by BetterInstaller and the file is BMM-Setup.exe; otherwise none, and
/// the installer runs interactively (a fresh install needs the person's consent screens).
pub(crate) fn installer_args(betterinstaller_install: bool, file_name: &str, pid: u32) -> Option<String> {
    (betterinstaller_install && file_name.eq_ignore_ascii_case("BMM-Setup.exe")).then(|| format!("--update --wait-pid {pid} --launch"))
}

/// Retry interactively? Only when the silent update said « no existing install ».
pub(crate) fn retry_interactively(args: &Option<String>, exit_code: Option<u32>) -> bool {
    args.is_some() && exit_code == Some(INSTALLER_EXIT_NO_EXISTING_INSTALL)
}

/// Write `bytes` as `name` in a folder of our own, new for this launch: a fixed name in %TEMP%
/// is one another program can plant or swap between the check and the launch.
pub(crate) fn write_bytes_to_fresh_dir(name: &str, bytes: &[u8]) -> Result<std::path::PathBuf, String> {
    let file_name = installer_file_name(name).ok_or_else(|| "Update refused: bad installer name".to_string())?;
    let dir = std::env::temp_dir().join(format!("bmm_update_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create folder: {}", e))?;
    let file_path = dir.join(&file_name);
    let mut file = File::create(&file_path).map_err(|e| format!("Failed to create file: {}", e))?;
    file.write_all(bytes).map_err(|e| format!("Failed to write to file: {}", e))?;
    drop(file);
    Ok(file_path)
}

// ── « Install on next launch » ─────────────────────────────────────────────────────────────
//
// `stage_update` downloads and verifies the installer now and keeps it, with the signed
// manifest it was checked against, in `<local app data>/updates/staged/`. On the next start the
// UI asks `staged_update` whether one is waiting, and `install_staged_update` runs it.
//
// The folder is user-writable, so nothing in it is believed: the installer runs only when the
// kept manifest still verifies against the pinned key, still offers a version newer than this
// build, still lists the kept file by name, and the file still has the signed SHA-256. Only the
// 7-day expiry is relaxed, to the moment the update was staged: a signed manifest cannot be
// forged, and a genuine one can only name a genuine newer installer.

/// What `staged/staged.json` holds.
#[derive(Serialize, Deserialize, Clone)]
pub(crate) struct StagedRecord {
    pub version: String,
    /// The `update-manifest.json` the installer was verified against, as downloaded.
    pub document: String,
    /// The installer's file name inside `staged/` (= the signed entry's `path`).
    pub file: String,
    /// RFC 3339, when it was staged.
    pub staged_at: String,
}

/// What the UI is told about a staged update.
#[derive(Serialize)]
pub struct StagedInfo {
    pub version: String,
    pub staged_at: String,
    pub size: u64,
}

fn staged_dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    Ok(updates_dir(app)?.join("staged"))
}

/// Verify a staged record against the pinned `key`: the signature, app and version rules of
/// [`verify_manifest_text`], at `now`, or — when only the expiry fails — at the time it was
/// staged (never later than `now`). Then the kept file must be a listed installer with the
/// signed hash. Returns the entry the file matched.
pub(crate) fn verify_staged(
    rec: &StagedRecord,
    bytes: &[u8],
    key: &ed25519_dalek::VerifyingKey,
    current_version: &str,
    now: chrono::DateTime<chrono::Utc>,
) -> Result<ManifestFile, String> {
    let manifest = match verify_manifest_text(&rec.document, key, current_version, now) {
        Ok(m) => m,
        Err(e) if e.contains("expired on") => {
            let at = chrono::DateTime::parse_from_rfc3339(&rec.staged_at)
                .map(|t| t.with_timezone(&chrono::Utc))
                .map_err(|_| "Staged update refused: unreadable staging time".to_string())?;
            if at > now {
                return Err("Staged update refused: it claims to be staged in the future".to_string());
            }
            verify_manifest_text(&rec.document, key, current_version, at)?
        }
        Err(e) => return Err(e),
    };
    let entry = manifest
        .installers
        .iter()
        .find(|f| f.path == rec.file)
        .ok_or_else(|| format!("Staged update refused: {} is not an installer its signed manifest lists", rec.file))?;
    check_installer_bytes(entry, bytes)?;
    Ok(entry.clone())
}

/// Download and verify the installer now; run it on the next start (`install_staged_update`).
#[tauri::command]
pub async fn stage_update(app_handle: tauri::AppHandle, url: String, manifest_url: Option<String>) -> Result<StagedInfo, String> {
    let Some(manifest_url) = manifest_url.as_deref().map(str::trim).filter(|u| !u.is_empty()) else {
        return Err("Update refused: this release publishes no signed update manifest, so its installer \
                    cannot be checked. Download the installer from the release page."
            .to_string());
    };
    let document = fetch_manifest_document(manifest_url).await?;
    let current = app_handle.package_info().version.to_string();
    let manifest = verify_manifest_text(&document, &publisher_key()?, &current, chrono::Utc::now())
        .inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    let entry = pick_installer(&manifest, &url)?.clone();
    let bytes = download_installer(&app_handle, &entry).await.inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    check_installer_bytes(&entry, &bytes)?;

    let file = installer_file_name(&entry.path).ok_or_else(|| "Update refused: bad installer name".to_string())?;
    let dir = staged_dir(&app_handle)?;
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).map_err(|e| format!("Failed to create folder: {e}"))?;
    std::fs::write(dir.join(&file), &bytes).map_err(|e| format!("Failed to write to file: {e}"))?;
    let rec = StagedRecord {
        version: manifest.version.clone(),
        document,
        file,
        staged_at: chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true),
    };
    let json = serde_json::to_string(&rec).map_err(|e| e.to_string())?;
    std::fs::write(dir.join("staged.json"), json).map_err(|e| format!("Failed to write to file: {e}"))?;
    log_line(format!("[UPDATE] v{} staged for the next start", rec.version));
    Ok(StagedInfo { version: rec.version, staged_at: rec.staged_at, size: bytes.len() as u64 })
}

fn read_staged(app: &tauri::AppHandle) -> Option<(StagedRecord, Vec<u8>)> {
    let dir = staged_dir(app).ok()?;
    let rec: StagedRecord = serde_json::from_str(&std::fs::read_to_string(dir.join("staged.json")).ok()?).ok()?;
    installer_file_name(&rec.file)?;
    let bytes = std::fs::read(dir.join(&rec.file)).ok()?;
    Some((rec, bytes))
}

/// The update staged on an earlier run, if one is waiting and still verifies. Anything that no
/// longer does (already installed, tampered with, half written) is deleted and reported as none.
#[tauri::command]
pub async fn staged_update(app_handle: tauri::AppHandle) -> Result<Option<StagedInfo>, String> {
    let Some((rec, bytes)) = read_staged(&app_handle) else { return Ok(None) };
    let current = app_handle.package_info().version.to_string();
    match verify_staged(&rec, &bytes, &publisher_key()?, &current, chrono::Utc::now()) {
        Ok(_) => Ok(Some(StagedInfo { version: rec.version, staged_at: rec.staged_at, size: bytes.len() as u64 })),
        Err(e) => {
            log_line(format!("[UPDATE] Staged update dropped: {e}"));
            if let Ok(dir) = staged_dir(&app_handle) {
                let _ = std::fs::remove_dir_all(dir);
            }
            Ok(None)
        }
    }
}

/// Run the staged installer (verified again, then copied to a fresh folder) and quit.
#[tauri::command]
pub async fn install_staged_update(app_handle: tauri::AppHandle) -> Result<(), String> {
    let (rec, bytes) = read_staged(&app_handle).ok_or_else(|| "No update is waiting to be installed.".to_string())?;
    let current = app_handle.package_info().version.to_string();
    let entry = verify_staged(&rec, &bytes, &publisher_key()?, &current, chrono::Utc::now())
        .inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    let file_path = write_installer_to_fresh_dir(&entry, &bytes)?;
    if let Ok(dir) = staged_dir(&app_handle) {
        let _ = std::fs::remove_dir_all(dir);
    }
    launch_installer_and_exit(&app_handle, &file_path, bytes.len() as u64).await
}

/// Forget the staged update.
#[tauri::command]
pub async fn discard_staged_update(app_handle: tauri::AppHandle) -> Result<(), String> {
    let dir = staged_dir(&app_handle)?;
    let _ = std::fs::remove_dir_all(dir);
    Ok(())
}

/// Largest manifest accepted. It lists a handful of files; anything near this is not one.
const MANIFEST_MAX_BYTES: usize = 1024 * 1024;

/// The raw `update-manifest.json` at `url` (https only, size-capped, UTF-8). Not verified:
/// every caller hands it to `verify_manifest_text` next.
async fn fetch_manifest_document(url: &str) -> Result<String, String> {
    if !is_https(url) {
        return Err("Update manifest refused: its URL is not https".to_string());
    }
    let response = crate::commands::net::client().get(url)
        .header(reqwest::header::USER_AGENT, "BetterModManager")
        .timeout(std::time::Duration::from_secs(30))
        .send().await.map_err(|e| format!("Network error: {}", e))?;
    if !response.status().is_success() {
        return Err(format!("Manifest fetch failed: {}", response.status()));
    }
    let bytes = response.bytes().await.map_err(|e| format!("Network error: {}", e))?;
    if bytes.len() > MANIFEST_MAX_BYTES {
        return Err("Update manifest refused: too large".to_string());
    }
    String::from_utf8(bytes.to_vec()).map_err(|_| "Update manifest refused: not UTF-8".to_string())
}

/// Fetches the incremental update manifest from the given URL and verifies it
/// ([`verify_manifest_text`]). Returns the verified content for display, plus the raw document
/// that `apply_incremental_update` verifies again.
#[tauri::command]
pub async fn fetch_update_manifest(app_handle: tauri::AppHandle, url: String) -> Result<UpdateManifest, String> {
    log_line(format!("[UPDATE] Fetching incremental manifest from: {}", url));
    let document = fetch_manifest_document(&url).await?;
    let current = app_handle.package_info().version.to_string();
    let verified = verify_manifest_text(&document, &publisher_key()?, &current, chrono::Utc::now())
        .inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;
    log_line(format!("[UPDATE] Manifest verified: v{}, {} files listed", verified.version, verified.files.len()));
    Ok(UpdateManifest { version: verified.version, files: verified.files, document })
}

/// Applies an incremental update: downloads only changed files and replaces them in-place.
/// Emits `update-progress` events to the window during the process.
///
/// `manifest` is whatever the UI got from `fetch_update_manifest`; only its raw `document` is
/// read, and it is verified again here — signature, app, expiry, version — before any file is
/// downloaded or written. Nothing the UI parsed or edited is trusted.
#[tauri::command]
pub async fn apply_incremental_update(
    app_handle: tauri::AppHandle,
    window: tauri::Window,
    manifest: ApplyRequest,
) -> Result<IncrementalResult, String> {
    use sha2::{Sha256, Digest};

    let current = app_handle.package_info().version.to_string();
    let manifest = verify_manifest_text(&manifest.document, &publisher_key()?, &current, chrono::Utc::now())
        .inspect_err(|e| log_line(format!("[UPDATE] {}", e)))?;

    // Resolve the BMM install root: parent of the resource dir (where frontend/, Lang/, etc. live)
    let install_root = app_handle
        .path()
        .resource_dir().ok()
        .and_then(|mut p| { p.pop(); Some(p) })
        .ok_or_else(|| "Cannot resolve install directory".to_string())?;

    log_line(format!("[UPDATE] Install root: {:?}", install_root));
    log_line(format!("[UPDATE] Starting incremental update: {} files", manifest.files.len()));

    let client = reqwest::Client::builder()
        .user_agent("BetterModManager")
        .build()
        .map_err(|e| format!("HTTP client error: {}", e))?;

    let temp_dir = std::env::temp_dir().join("bmm_incremental_update");
    std::fs::create_dir_all(&temp_dir).ok();

    let total = manifest.files.len();
    let mut applied = 0usize;
    let mut skipped = 0usize;
    let mut errors: Vec<String> = Vec::new();

    for (index, file_entry) in manifest.files.iter().enumerate() {
        let _ = window.emit("update-progress", IncrementalProgress {
            file: file_entry.path.clone(),
            index,
            total,
            status: "downloading".to_string(),
        });

        // CWE-494/22 (defense-in-depth): the manifest is fetched from GitHub over
        // HTTPS, but treat its contents as data, not trust. Reject any per-file URL
        // that isn't HTTPS (no plain-HTTP swap) and any path that tries to escape the
        // install root via traversal segments before joining/writing.
        if !file_entry.download_url.to_ascii_lowercase().starts_with("https://") {
            let err = format!("Refused (non-HTTPS update URL) for {}", file_entry.path);
            log_line(format!("[UPDATE] {}", err));
            errors.push(err);
            continue;
        }
        if file_entry.path.split(|c| c == '/' || c == '\\').any(|seg| seg == ".." || seg == "...") {
            let err = format!("Refused (path traversal in manifest) for {}", file_entry.path);
            log_line(format!("[UPDATE] {}", err));
            errors.push(err);
            continue;
        }
        let dest_path = install_root.join(&file_entry.path);
        if !dest_path.starts_with(&install_root) {
            let err = format!("Refused (escapes install root) for {}", file_entry.path);
            log_line(format!("[UPDATE] {}", err));
            errors.push(err);
            continue;
        }

        // Check if local file already matches the expected hash (skip if unchanged)
        if dest_path.exists() {
            if let Ok(existing_bytes) = std::fs::read(&dest_path) {
                let mut hasher = Sha256::new();
                hasher.update(&existing_bytes);
                let existing_hash = format!("{:x}", hasher.finalize());
                if existing_hash == file_entry.sha256 {
                    log_line(format!("[UPDATE] Skipping (unchanged): {}", file_entry.path));
                    skipped += 1;
                    let _ = window.emit("update-progress", IncrementalProgress {
                        file: file_entry.path.clone(),
                        index,
                        total,
                        status: "skipped".to_string(),
                    });
                    continue;
                }
            }
        }

        // Download the file
        let download_result = client.get(&file_entry.download_url).send().await;
        let response = match download_result {
            Ok(r) if r.status().is_success() => r,
            Ok(r) => {
                let err = format!("Download failed for {}: HTTP {}", file_entry.path, r.status());
                log_line(format!("[UPDATE] {}", err));
                errors.push(err);
                continue;
            }
            Err(e) => {
                let err = format!("Download error for {}: {}", file_entry.path, e);
                log_line(format!("[UPDATE] {}", err));
                errors.push(err);
                continue;
            }
        };

        let bytes = match response.bytes().await {
            Ok(b) => b,
            Err(e) => {
                let err = format!("Read error for {}: {}", file_entry.path, e);
                errors.push(err);
                continue;
            }
        };

        // Verify SHA256
        let _ = window.emit("update-progress", IncrementalProgress {
            file: file_entry.path.clone(),
            index,
            total,
            status: "verifying".to_string(),
        });

        let mut hasher = Sha256::new();
        hasher.update(&bytes);
        let actual_hash = format!("{:x}", hasher.finalize());

        if actual_hash != file_entry.sha256 {
            let err = format!("Hash mismatch for {} — expected {}, got {}", file_entry.path, file_entry.sha256, actual_hash);
            log_line(format!("[UPDATE] {}", err));
            errors.push(err);
            continue;
        }

        // Write to temp first, then move atomically
        let temp_file = temp_dir.join(format!("{}.tmp", index));
        if let Err(e) = std::fs::write(&temp_file, &bytes) {
            errors.push(format!("Write temp error for {}: {}", file_entry.path, e));
            continue;
        }

        // Ensure destination directory exists
        if let Some(parent) = dest_path.parent() {
            std::fs::create_dir_all(parent).ok();
        }

        if let Err(e) = std::fs::rename(&temp_file, &dest_path) {
            // rename may fail across drives — fall back to copy+delete
            if let Err(e2) = std::fs::copy(&temp_file, &dest_path) {
                errors.push(format!("Apply error for {}: {} / {}", file_entry.path, e, e2));
                continue;
            }
            std::fs::remove_file(&temp_file).ok();
        }

        log_line(format!("[UPDATE] Applied: {}", file_entry.path));
        applied += 1;
        let _ = window.emit("update-progress", IncrementalProgress {
            file: file_entry.path.clone(),
            index,
            total,
            status: "applied".to_string(),
        });
    }

    // Clean up temp dir
    std::fs::remove_dir_all(&temp_dir).ok();

    log_line(format!("[UPDATE] Incremental update complete — applied: {}, skipped: {}, errors: {}", applied, skipped, errors.len()));

    Ok(IncrementalResult { applied, skipped, errors })
}

#[cfg(test)]
#[path = "autoupdate_manifest_tests.rs"]
mod manifest_tests;

#[cfg(test)]
#[path = "autoupdate_flow_tests.rs"]
mod flow_tests;
