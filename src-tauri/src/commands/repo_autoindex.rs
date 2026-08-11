//! Reading a server's own directory listing over HTTP.
//!
//! # Why this instead of an FTP client
//!
//! The plan called for FTP/SFTP so BMM could both list the server and upload the manifest
//! back. Listing is the half that matters: it is what turns "re-download the whole repo to
//! add one mod" into "hash the one mod that changed". And nginx already publishes a listing
//! with `autoindex on`, over the same http(s) BMM uses for downloads.
//!
//! So the listing needs no new dependency, no credentials, and no cleartext-password
//! problem. The remaining half — putting `repo.json` back on the server — is one small file
//! uploaded with the FTP client the author already uses to upload mods. That is a far
//! smaller ask than a supply-chain addition and a stored server password, and it keeps the
//! promise that a plain static host is enough.
//!
//! An FTP transport can still be added later for full automation; `repo_credentials`
//! already holds the shape for it. This is the version that ships without one.
//!
//! # What the parser has to survive
//!
//! nginx and Apache emit different HTML, and neither is a contract. The parser therefore
//! extracts only what it can check — an href, and the size/date text that follows it — and
//! treats anything it cannot read as absent rather than guessing. `mtime: None` flows into
//! the refresh planner as "unknown", which re-hashes. A wrong date would do worse: it would
//! silently keep a stale hash.

use crate::commands::repo_remote::RemoteEntry;
use std::collections::HashMap;

/// One row of a listing.
#[derive(Debug, Clone, PartialEq)]
pub struct IndexRow {
    pub name: String,
    pub is_dir: bool,
    pub size: Option<u64>,
    pub mtime: Option<i64>,
}

/// Pull the rows out of an autoindex page.
///
/// Handles nginx's `<a href="x">x</a>   date  size` and Apache's table rows, because a
/// server owner does not choose their listing format to suit us.
pub fn parse_autoindex(html: &str) -> Vec<IndexRow> {
    let mut out = Vec::new();
    for (idx, _) in html.match_indices("<a href=\"") {
        let rest = &html[idx + 9..];
        let Some(qend) = rest.find('"') else { continue };
        let href = &rest[..qend];

        // Parent links and absolute/external hrefs are navigation, not content.
        if href == "../" || href == "/" || href.starts_with("http") || href.starts_with('?') {
            continue;
        }
        let is_dir = href.ends_with('/');
        let name = percent_decode(href.trim_end_matches('/'));
        if name.is_empty() || name.contains('/') {
            continue;
        }

        // The trailing metadata sits between </a> and the end of the line.
        let after = &rest[qend..];
        let tail_end = after.find('\n').unwrap_or(after.len());
        let tail = strip_tags(&after[..tail_end]);

        out.push(IndexRow {
            name,
            is_dir,
            size: if is_dir { None } else { parse_size(&tail) },
            mtime: parse_date(&tail),
        });
    }
    out
}

fn percent_decode(s: &str) -> String {
    percent_encoding::percent_decode_str(s).decode_utf8_lossy().into_owned()
}

fn strip_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut depth = 0usize;
    for c in s.chars() {
        match c {
            '<' => depth += 1,
            '>' => depth = depth.saturating_sub(1),
            _ if depth == 0 => out.push(c),
            _ => {}
        }
    }
    out
}

/// The last bare integer on the line is nginx's byte count.
///
/// `-` means a directory, and a human-readable size ("1.2K") is refused rather than
/// approximated: a rounded size compared against an exact one would report every file as
/// changed, which is worse than reporting none.
fn parse_size(tail: &str) -> Option<u64> {
    tail.split_whitespace()
        .rev()
        .find_map(|tok| tok.parse::<u64>().ok())
}

/// nginx's `dd-Mon-yyyy HH:MM` in UTC. None on anything else — including Apache's own
/// format, which is not worth guessing at.
fn parse_date(tail: &str) -> Option<i64> {
    let toks: Vec<&str> = tail.split_whitespace().collect();
    for w in toks.windows(2) {
        let (d, t) = (w[0], w[1]);
        let parts: Vec<&str> = d.split('-').collect();
        if parts.len() != 3 || !t.contains(':') {
            continue;
        }
        let day: u32 = parts[0].parse().ok()?;
        let month = match parts[1] {
            "Jan" => 1, "Feb" => 2, "Mar" => 3, "Apr" => 4, "May" => 5, "Jun" => 6,
            "Jul" => 7, "Aug" => 8, "Sep" => 9, "Oct" => 10, "Nov" => 11, "Dec" => 12,
            _ => continue,
        };
        let year: i32 = parts[2].parse().ok()?;
        let hm: Vec<&str> = t.split(':').collect();
        if hm.len() < 2 {
            continue;
        }
        let (h, m): (u32, u32) = (hm[0].parse().ok()?, hm[1].parse().ok()?);
        return chrono::NaiveDate::from_ymd_opt(year, month, day)
            .and_then(|d| d.and_hms_opt(h, m, 0))
            .map(|dt| dt.and_utc().timestamp());
    }
    None
}

/// Flatten `<mod-dir>/<file>` rows into the shape the refresh planner consumes.
///
/// `dir` is the mod's folder name; paths come out as `<mod-id>/<path>` to match how the
/// manifest keys its files.
pub fn rows_to_entries(dir: &str, rows: &[IndexRow], prefix: &str) -> Vec<RemoteEntry> {
    rows.iter()
        .filter(|r| !r.is_dir)
        .map(|r| RemoteEntry {
            rel_path: if prefix.is_empty() {
                format!("{}/{}", dir, r.name)
            } else {
                format!("{}/{}/{}", dir, prefix.trim_matches('/'), r.name)
            },
            size: r.size.unwrap_or(0),
            mtime: r.mtime,
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const NGINX: &str = r#"<html><head><title>Index of /mods/cool-mod/</title></head><body>
<h1>Index of /mods/cool-mod/</h1><hr><pre><a href="../">../</a>
<a href="textures/">textures/</a>                                          12-Aug-2026 09:14       -
<a href="readme.txt">readme.txt</a>                                        03-Jul-2026 22:01     1024
<a href="big%20file.pak">big file.pak</a>                                  01-Jan-2026 00:00 2147483648
</pre><hr></body></html>"#;

    #[test]
    fn an_nginx_listing_yields_names_sizes_and_dates() {
        let rows = parse_autoindex(NGINX);
        assert_eq!(rows.len(), 3, "the ../ link must not be a row");

        let dir = &rows[0];
        assert_eq!(dir.name, "textures");
        assert!(dir.is_dir);
        assert_eq!(dir.size, None, "a directory has no size to compare");

        let readme = &rows[1];
        assert_eq!(readme.name, "readme.txt");
        assert!(!readme.is_dir);
        assert_eq!(readme.size, Some(1024));
        assert!(readme.mtime.is_some());

        // Percent-encoding is the server's, not the file's: the manifest must key on the
        // real name or every spaced filename reads as new on the next refresh.
        assert_eq!(rows[2].name, "big file.pak");
        assert_eq!(rows[2].size, Some(2147483648));
    }

    #[test]
    fn a_human_readable_size_is_refused_rather_than_approximated() {
        // "1.2K" rounded to 1228 would differ from the exact byte count in the manifest and
        // report an unchanged file as changed, every single refresh.
        let html = r#"<a href="a.pak">a.pak</a>   03-Jul-2026 22:01   1.2K"#;
        assert_eq!(parse_autoindex(html)[0].size, None);
    }

    #[test]
    fn an_unreadable_date_is_none_rather_than_a_guess() {
        // None flows into the planner as "unknown" and re-hashes. A wrong date would keep a
        // stale hash instead — silently.
        for html in [
            r#"<a href="a.pak">a.pak</a>   2026-07-03 22:01   10"#,   // ISO, not nginx
            r#"<a href="a.pak">a.pak</a>   10"#,                      // no date at all
            r#"<a href="a.pak">a.pak</a>   03-Xyz-2026 22:01   10"#,  // bad month
        ] {
            assert_eq!(parse_autoindex(html)[0].mtime, None, "{html}");
        }
    }

    #[test]
    fn navigation_links_are_never_content() {
        let html = r#"<a href="../">../</a><a href="/">root</a>
<a href="https://elsewhere/x">off-site</a><a href="?C=N;O=D">sort</a>
<a href="real.pak">real.pak</a>   03-Jul-2026 22:01   5"#;
        let rows = parse_autoindex(html);
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].name, "real.pak");
    }

    #[test]
    fn rows_become_manifest_shaped_paths() {
        let rows = parse_autoindex(NGINX);
        let flat = rows_to_entries("cool-mod", &rows, "");
        assert_eq!(flat.len(), 2, "directories are not files");
        assert_eq!(flat[0].rel_path, "cool-mod/readme.txt");

        let nested = rows_to_entries("cool-mod", &rows, "/textures/");
        assert_eq!(nested[0].rel_path, "cool-mod/textures/readme.txt");
    }

    #[test]
    fn junk_does_not_panic() {
        for html in ["", "<html></html>", "<a href=", r#"<a href="">"#, "<a href=\"a\">"] {
            let _ = parse_autoindex(html);
        }
    }
}

// ---------------------------------------------------------------------------
// Crawling
// ---------------------------------------------------------------------------

/// How deep a mod's own folder tree may go before the crawl gives up.
///
/// A bound rather than trust: an autoindex can link into itself (a symlink loop on the
/// server, or a proxy that answers every path with the same page), and an unbounded crawl
/// would spin until the app is killed. Mod trees are shallow; 8 is far past anything real.
const MAX_DEPTH: usize = 8;

/// Every file under `base_url`, walking one level of mod folders and their subtrees.
///
/// `base_url` is the directory that CONTAINS the mod folders — the same directory
/// `files_layout` resolves against.
pub async fn crawl(base_url: &str, client: &reqwest::Client) -> Result<Vec<RemoteEntry>, String> {
    let root = format!("{}/", base_url.trim_end_matches('/'));
    let top = fetch_rows(&root, client).await?;

    let mut out = Vec::new();
    for dir in top.iter().filter(|r| r.is_dir) {
        let mod_url = format!("{}{}/", root, encode_segment(&dir.name));
        walk_into(&mod_url, &dir.name, "", 0, client, &mut out).await?;
    }
    if out.is_empty() {
        return Err(format!(
            "No files found under {root} — is directory listing (autoindex) enabled?"
        ));
    }
    Ok(out)
}

/// Recursion is written as an explicit stack: an `async fn` that awaits itself needs boxing,
/// and the boxed future is easy to get subtly wrong for no gain at this depth.
async fn walk_into(
    url: &str,
    mod_dir: &str,
    prefix: &str,
    depth: usize,
    client: &reqwest::Client,
    out: &mut Vec<RemoteEntry>,
) -> Result<(), String> {
    let mut stack = vec![(url.to_string(), prefix.to_string(), depth)];
    while let Some((u, p, d)) = stack.pop() {
        if d > MAX_DEPTH {
            continue;
        }
        let rows = fetch_rows(&u, client).await?;
        out.extend(rows_to_entries(mod_dir, &rows, &p));
        for sub in rows.iter().filter(|r| r.is_dir) {
            let child_prefix = if p.is_empty() {
                sub.name.clone()
            } else {
                format!("{}/{}", p.trim_matches('/'), sub.name)
            };
            stack.push((format!("{}{}/", u, encode_segment(&sub.name)), child_prefix, d + 1));
        }
    }
    Ok(())
}

/// Percent-encode one path segment. The listing gives decoded names, and a name with a
/// space or a `#` would otherwise build a URL that fetches the wrong thing — or nothing.
fn encode_segment(name: &str) -> String {
    percent_encoding::utf8_percent_encode(name, percent_encoding::NON_ALPHANUMERIC)
        .to_string()
        // These are legal in a path segment and encoding them makes URLs needlessly ugly.
        .replace("%2D", "-").replace("%5F", "_").replace("%2E", ".").replace("%7E", "~")
}

async fn fetch_rows(url: &str, client: &reqwest::Client) -> Result<Vec<IndexRow>, String> {
    let resp = client.get(url).send().await.map_err(|e| format!("{url}: {e}"))?;
    if !resp.status().is_success() {
        return Err(format!("{url}: HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| format!("{url}: {e}"))?;
    Ok(parse_autoindex(&body))
}

#[cfg(test)]
mod crawl_tests {
    use super::*;

    #[test]
    fn a_segment_is_encoded_for_the_url_but_stays_readable() {
        assert_eq!(encode_segment("big file.pak"), "big%20file.pak");
        assert_eq!(encode_segment("cool-mod_v2.1"), "cool-mod_v2.1");
        // `#` would truncate the URL at a fragment and fetch the directory instead.
        assert_eq!(encode_segment("a#b"), "a%23b");
    }
}

// ---------------------------------------------------------------------------
// The read-only command
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemotePlanReport {
    pub summary: String,
    pub to_hash: Vec<String>,
    pub reused: usize,
    pub removed: Vec<String>,
    /// Present when nothing could be reused, naming why.
    pub full_rehash: Option<String>,
    pub warnings: Vec<String>,
    /// Bytes that would have to be downloaded to complete the refresh.
    pub download_bytes: u64,
}

/// Look at a server and report what refreshing its manifest would involve.
///
/// Reads only: it fetches listings, never files, and writes nothing. Separated from the
/// refresh itself on purpose — the first thing an author wants to know is "how much will
/// this cost and what did it notice", and answering that must not commit them to anything.
#[tauri::command]
pub async fn plan_remote_repo_refresh(
    handle: tauri::AppHandle,
    base_url: String,
    manifest_path: String,
    force_full: bool,
) -> Result<RemotePlanReport, String> {
    use crate::commands::repo_remote::{plan_refresh, FullRehash};

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .build()
        .map_err(|e| e.to_string())?;
    let listing = crawl(base_url.trim(), &client).await?;

    // Read from disk rather than over HTTP: this is the author's own copy, the one they
    // signed. Fetching the server's would ask the server to vouch for itself.
    let previous: Option<crate::models::repo::ServerRepo> = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());

    // Our own creator id. Without it every manifest reads as "not ours" and the planner
    // re-hashes the whole repo every single time — the exact cost this feature exists to
    // avoid, and it would have looked like the planner simply never reused anything.
    let mine = crate::commands::security::get_creator_id(handle).ok();
    let plan = plan_refresh(
        &listing,
        previous.as_ref(),
        mine.as_deref(),
        force_full,
        |r| crate::commands::security::verify_repo_signature(r.clone()),
    );

    let sizes: std::collections::HashMap<&str, u64> =
        listing.iter().map(|e| (e.rel_path.as_str(), e.size)).collect();
    let download_bytes = plan.fetch.iter().filter_map(|p| sizes.get(p.as_str())).sum();

    Ok(RemotePlanReport {
        summary: plan.summary(),
        reused: plan.carry_forward.len(),
        to_hash: plan.fetch,
        removed: plan.removed,
        full_rehash: plan.full_rehash.map(|r| match r {
            FullRehash::NoPreviousManifest => "no previous manifest".into(),
            FullRehash::Unsigned => "the previous manifest is unsigned".into(),
            FullRehash::NotOurs => "the previous manifest was not signed by this machine".into(),
            FullRehash::Requested => "a full re-hash was requested".into(),
        }),
        warnings: plan.warnings,
        download_bytes,
    })
}

// ---------------------------------------------------------------------------
// The refresh itself
// ---------------------------------------------------------------------------

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoteRefreshReport {
    pub manifest_path: String,
    pub mods: usize,
    pub files: usize,
    pub hashed: usize,
    pub reused: usize,
    pub removed: Vec<String>,
    pub downloaded_bytes: u64,
    pub signed: bool,
    pub warnings: Vec<String>,
}

/// Bring a manifest back in line with what the server is actually serving.
///
/// One call: list the server, work out what changed, download only that, and write a freshly
/// signed `repo.json` next to wherever the old one lived. The author then uploads that one
/// file with the client they already use for the mods themselves — BMM never needs write
/// access to the server.
///
/// The existing local paths (`export_server_repo`, `generate_repo_manifest`) are untouched.
/// This is a third route, for the case where the mods are only on the server.
#[tauri::command]
pub async fn refresh_repo_from_server(
    handle: tauri::AppHandle,
    window: tauri::Window,
    base_url: String,
    manifest_path: String,
    force_full: bool,
) -> Result<RemoteRefreshReport, String> {
    use crate::commands::repo_remote::plan_refresh;
    use crate::models::repo::{RepoFile, RepoMod, RepoProfile, ServerRepo};
    use tauri::Emitter;

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .build()
        .map_err(|e| e.to_string())?;
    let base = base_url.trim().trim_end_matches('/').to_string();

    let _ = window.emit("bmm://repo-export-progress", serde_json::json!({
        "step": "Reading the server listing", "progress": 2.0, "current_file": "",
    }));
    let listing = crawl(&base, &client).await?;

    let previous: Option<ServerRepo> = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    let mine = crate::commands::security::get_creator_id(handle.clone()).ok();
    let plan = plan_refresh(
        &listing,
        previous.as_ref(),
        mine.as_deref(),
        force_full,
        |r| crate::commands::security::verify_repo_signature(r.clone()),
    );

    // Every file the old manifest recorded, so a carried-forward entry keeps its CHUNK
    // hashes as well as its sha256. Dropping those would silently disable ranged resume for
    // files nobody even touched.
    let mut recorded: HashMap<String, RepoFile> = HashMap::new();
    if let Some(prev) = &previous {
        for p in &prev.profiles {
            for m in &p.mods {
                for f in &m.files {
                    let key = format!("{}/{}", m.id, f.relative_path.replace('\\', "/"));
                    recorded.insert(key, f.clone());
                }
            }
        }
    }
    let mtimes: HashMap<&str, Option<i64>> =
        listing.iter().map(|e| (e.rel_path.as_str(), e.mtime)).collect();

    let mut files: HashMap<String, RepoFile> = HashMap::new();
    for path in &plan.carry_forward {
        if let Some(f) = recorded.get(path) {
            files.insert(path.clone(), f.clone());
        }
    }

    let tmp_dir = std::env::temp_dir().join("bmm_remote_refresh");
    std::fs::create_dir_all(&tmp_dir).map_err(|e| e.to_string())?;
    let mut downloaded_bytes = 0u64;
    let mut warnings = plan.warnings.clone();
    let total = plan.fetch.len().max(1);

    for (i, path) in plan.fetch.iter().enumerate() {
        let _ = window.emit("bmm://repo-export-progress", serde_json::json!({
            "step": format!("Hashing {} ({}/{})", path, i + 1, plan.fetch.len()),
            "progress": 5.0 + (i as f32 / total as f32) * 90.0,
            "current_file": path,
        }));

        let encoded: Vec<String> = path.split('/').map(encode_segment).collect();
        let url = format!("{}/{}", base, encoded.join("/"));
        let resp = client.get(&url).send().await.map_err(|e| format!("{path}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("{path}: HTTP {}", resp.status()));
        }
        let bytes = resp.bytes().await.map_err(|e| format!("{path}: {e}"))?;
        downloaded_bytes += bytes.len() as u64;

        // Staged to a file so the existing, tested chunking path is reused verbatim rather
        // than reimplemented against an in-memory buffer.
        let tmp = tmp_dir.join("staging.bin");
        std::fs::write(&tmp, &bytes).map_err(|e| e.to_string())?;
        let need_chunks = bytes.len() > crate::commands::repo::CHUNK_SIZE;
        let (hash, chunks) =
            crate::commands::repo::compute_file_hash_and_chunks(&tmp, need_chunks)?;
        let _ = std::fs::remove_file(&tmp);

        // Same size, different bytes. Legitimate edits almost always move the size, so this
        // is the shape of tampering and it is free to notice here.
        if let Some(old) = recorded.get(path) {
            if super::repo_remote::suspicious_same_size_change(
                old.size, &old.sha256_hash, bytes.len() as u64, &hash,
            ) {
                warnings.push(format!("{path}: content changed but size did not"));
            }
        }

        let rel = path.splitn(2, '/').nth(1).unwrap_or(path).to_string();
        files.insert(path.clone(), RepoFile {
            relative_path: rel,
            size: bytes.len() as u64,
            sha256_hash: hash,
            chunks,
            // The SERVER's timestamp, not ours. The next refresh compares against what the
            // listing reports, so stamping our own clock would make every file look changed
            // from then on.
            mtime: mtimes.get(path.as_str()).copied().flatten(),
        });
    }
    let _ = std::fs::remove_dir_all(&tmp_dir);

    // Regroup by first path segment — the same rule the local generator uses, so a repo
    // refreshed this way is indistinguishable from one generated on disk.
    let mut by_mod: std::collections::BTreeMap<String, Vec<RepoFile>> = Default::default();
    for (path, f) in files {
        if let Some(id) = path.split('/').next() {
            if !id.is_empty() {
                by_mod.entry(id.to_string()).or_default().push(f);
            }
        }
    }
    let prev_mods: HashMap<String, RepoMod> = previous
        .as_ref()
        .map(|p| p.profiles.iter().flat_map(|pr| pr.mods.iter())
            .map(|m| (m.id.clone(), m.clone())).collect())
        .unwrap_or_default();

    let mut repo_mods = Vec::new();
    for (id, mut list) in by_mod {
        list.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
        // Curated metadata (name, tags, changelog, update sources) comes from the previous
        // manifest. A refresh is about file contents; resetting a mod's name to its folder
        // name would undo work nobody asked to undo.
        let mut m = prev_mods.get(&id).cloned().unwrap_or_else(|| RepoMod {
            id: id.clone(),
            name: id.clone(),
            version: "1.0.0".to_string(),
            author: None,
            description: None,
            tags: Vec::new(),
            files: Vec::new(),
            archive: None,
            download_links: Vec::new(),
            dependencies: Vec::new(),
            changelog: None,
            update_url: None,
            direct_url: None,
            update_sources: Vec::new(),
        });
        m.files = list;
        repo_mods.push(m);
    }
    if repo_mods.is_empty() {
        return Err("Nothing to publish — the listing produced no files".to_string());
    }

    let mut repo = previous.clone()
        .unwrap_or_else(|| ServerRepo::new("BMM Repo".to_string(), String::new()));
    if repo.seed.is_none() {
        repo.seed = Some(uuid::Uuid::new_v4().to_string());
    }
    let profile_id = previous.as_ref()
        .and_then(|p| p.profiles.first().map(|pr| pr.id.clone()))
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    let files_count: usize = repo_mods.iter().map(|m| m.files.len()).sum();
    let mods_count = repo_mods.len();
    repo.profiles = vec![RepoProfile {
        id: profile_id,
        name: repo.name.clone(),
        game_name: repo.game_name.clone(),
        mods: repo_mods,
        icon: None,
        color: None,
        icon_image: None,
    }];

    // Cleared before signing: verify_repo_signature() takes both fields out before hashing,
    // so a payload that still carried them would never verify.
    repo.author_id = None;
    repo.signature = None;
    let payload = serde_json::to_string(&repo).map_err(|e| e.to_string())?;
    let signed = match crate::commands::security::sign_message(&handle, payload.as_bytes()) {
        Ok((a, s)) => {
            repo.author_id = Some(a);
            repo.signature = Some(s);
            true
        }
        Err(e) => {
            tracing::warn!("Manifest written unsigned: {}", e);
            false
        }
    };

    let json = serde_json::to_string_pretty(&repo).map_err(|e| e.to_string())?;
    std::fs::write(&manifest_path, json).map_err(|e| e.to_string())?;

    let _ = window.emit("bmm://repo-export-progress", serde_json::json!({
        "step": "repo.exportDone", "progress": 100.0, "current_file": "",
    }));

    Ok(RemoteRefreshReport {
        manifest_path,
        mods: mods_count,
        files: files_count,
        hashed: plan.fetch.len(),
        reused: plan.carry_forward.len(),
        removed: plan.removed,
        downloaded_bytes,
        signed,
        warnings,
    })
}
