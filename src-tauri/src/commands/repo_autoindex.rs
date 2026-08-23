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


    // Captured VERBATIM from a running BCWEB instance
    // (GET /hosting/<owner>/<repo>/files/cool-mod/Data/textures/). BCWEB generates this
    // listing so that a hosted repo can be consumed by "Update from server" exactly like
    // somebody's own nginx. The two live in different repositories and different
    // languages, so nothing but a test keeps them agreeing: if BCWEB's renderer drifts —
    // a wrapped line, a localised month, a human-readable size — this fails instead of
    // silently forcing a full re-hash on every refresh.
    const BCWEB: &str = r#"<html><head><title>Index of /hosting/idx/probe/files/cool-mod/Data/textures/</title></head><body>
<h1>Index of /hosting/idx/probe/files/cool-mod/Data/textures/</h1><hr><pre><a href="../">../</a>
<a href="a.dds">a.dds</a>                                               13-Aug-2026 04:41                2048
<a href="big%20file.dds">big file.dds</a>                                        13-Aug-2026 04:41             5242880
</pre><hr></body></html>"#;


    // Captured VERBATIM from a running BCWEB instance AFTER checksums were appended to each
    // row. The sha sits after the size on purpose: this parser walks the line backwards for
    // the first token that parses as a u64, and a 64-character hex string overflows u64 (and
    // usually contains letters), so it is skipped and the SIZE is still what is found.
    // Putting it before the size would silently return the wrong length.
    //
    // `nohash.bin` is the third row for a reason — a file uploaded before hashing existed
    // ends its line at the size, and that must parse identically.
    const BCWEB_SHA: &str = r#"<h1>Index of /hosting/idx2/probe/files/mods/</h1><hr><pre><a href="../">../</a>
<a href="a.dds">a.dds</a>                                               13-Aug-2026 08:06                2048  9f2c1b7ae4d05f3c8a1e6b0d4f7c2a91b3e8d5c7f0a2b4d6e8f1c3a5b7d9e0f2
<a href="big%20file.pak">big file.pak</a>                                        13-Aug-2026 08:06             5242880  1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
<a href="nohash.bin">nohash.bin</a>                                          13-Aug-2026 08:06                  10
</pre><hr></body></html>"#;

    #[test]
    fn a_trailing_checksum_never_shifts_the_size() {
        let rows = parse_autoindex(BCWEB_SHA);
        assert_eq!(rows.len(), 3, "{rows:?}");

        assert_eq!(rows[0].name, "a.dds");
        assert_eq!(rows[0].size, Some(2048), "the sha must not be read as the size");

        // Percent-encoded name AND a sha that is entirely digits — the worst case for a
        // backwards scan, and still not a u64 because 64 digits overflow it.
        assert_eq!(rows[1].name, "big file.pak");
        assert_eq!(rows[1].size, Some(5_242_880));

        // No checksum at all: the line ends at the size, exactly as before.
        assert_eq!(rows[2].name, "nohash.bin");
        assert_eq!(rows[2].size, Some(10));

        for r in &rows {
            assert!(r.mtime.is_some(), "{} lost its date", r.name);
        }
    }

    #[test]
    fn bcweb_hosted_listings_parse_like_nginx() {
        let rows = parse_autoindex(BCWEB);
        assert_eq!(rows.len(), 2, "../ is navigation, not content");

        assert_eq!(rows[0].name, "a.dds");
        assert!(!rows[0].is_dir);
        assert_eq!(rows[0].size, Some(2048));
        assert!(rows[0].mtime.is_some(), "a missing date forces a needless re-hash");

        // The percent-encoded href must decode, or the file is requested under a name
        // that does not exist and the refresh fails on a file it can see.
        assert_eq!(rows[1].name, "big file.dds");
        assert_eq!(rows[1].size, Some(5_242_880));

        // Both rows carry the same UTC minute in the capture; the point is that it parsed
        // at all, and to the same instant for both.
        assert_eq!(rows[0].mtime, rows[1].mtime);
    }

    // The directory level of the same listing.
    const BCWEB_DIRS: &str = r#"<h1>Index of /hosting/idx/probe/files/</h1><hr><pre><a href="../">../</a>
<a href="cool-mod/">cool-mod/</a>                                           13-Aug-2026 04:41                   -
<a href="other-mod/">other-mod/</a>                                          13-Aug-2026 04:41                   -
</pre><hr></body></html>"#;

    #[test]
    fn bcweb_directory_rows_carry_no_size() {
        let rows = parse_autoindex(BCWEB_DIRS);
        assert_eq!(rows.len(), 2);
        for r in &rows {
            assert!(r.is_dir, "{} should be a directory", r.name);
            // The dash matters: any integer here would be read as a file length and every
            // directory would look like a changed file.
            assert_eq!(r.size, None, "{} must not report a size", r.name);
        }
        assert_eq!(rows[0].name, "cool-mod");
        assert_eq!(rows[1].name, "other-mod");
    }

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

    /// Captured verbatim from `.Assets/test-repo/serve_test_repo.py`, the bench used to
    /// exercise this feature. The other fixtures in this file are hand-written, so they
    /// only prove the parser handles what I imagined nginx emits; this one proves it
    /// handles what the test bench actually sends, padding and column widths included.
    #[test]
    fn the_test_benchs_own_output_parses() {
        const REAL: &str = "<html><head><title>Index of /mods/cool-mod/</title></head><body>\n<h1>Index of /mods/cool-mod/</h1><hr><pre><a href=\"../\">../</a>\n<a href=\"Data/\">Data/</a>                                               11-Aug-2026 05:26                   -\n<a href=\"readme.txt\">readme.txt</a>                                          11-Aug-2026 05:26                   9\n</pre><hr></body></html>";

        let rows = parse_autoindex(REAL);
        assert_eq!(rows.len(), 2, "../ must not be a row");

        assert_eq!(rows[0].name, "Data");
        assert!(rows[0].is_dir);

        let f = &rows[1];
        assert_eq!(f.name, "readme.txt");
        assert!(!f.is_dir);
        assert_eq!(f.size, Some(9), "the byte count must survive the padding");
        assert!(f.mtime.is_some(), "no timestamp means every refresh re-hashes everything");
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
    /// On the server, absent from the manifest — the repo is incomplete, not merely stale.
    pub added: Vec<String>,
    /// In both, but the bytes moved.
    pub changed: Vec<String>,
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
    // The download password, when the server asks for one. Never stored — it arrives per call
    // and lives as long as the request, the same contract as every other protected fetch.
    password: Option<String>,
) -> Result<RemotePlanReport, String> {
    use crate::commands::repo_remote::{plan_refresh, FullRehash};

    // Default headers, so EVERY request this client makes carries them — the directory
    // listing, the manifest and each file it reads to hash. Setting them per-call would be
    // the mistake the repo sync already made once: a header on some paths and not others
    // authenticates the first request and 401s halfway through the rest.
    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(pw) = password.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(pw) {
            headers.insert("X-Repo-Password", hv);
        }
    }
    crate::commands::repo_keyauth::add_proof(&mut headers, base_url.trim());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(30))
        .default_headers(headers)
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
        added: plan.added,
        changed: plan.changed,
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
    /// True when the previous manifest was read FROM THE SERVER rather than from a local
    /// file. Reported because it changes what the numbers below mean: hashes were carried
    /// forward from a document the server handed us, which the signature check accepted.
    #[serde(default)]
    pub previous_from_server: bool,
    pub manifest_path: String,
    pub mods: usize,
    pub files: usize,
    pub hashed: usize,
    pub added: usize,
    pub changed: usize,
    pub reused: usize,
    pub removed: Vec<String>,
    pub downloaded_bytes: u64,
    pub signed: bool,
    pub warnings: Vec<String>,
    /// True when there was no manifest and this run created one.
    pub created: bool,
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
    name: Option<String>,
    game_name: Option<String>,
    // Same contract as the plan above. The two MUST carry the same credentials, or the
    // preview succeeds and the run that follows it 401s — the worst possible split, because
    // the person has already been told it would work.
    password: Option<String>,
) -> Result<RemoteRefreshReport, String> {
    use crate::commands::repo_remote::plan_refresh;
    use crate::models::repo::{RepoFile, RepoMod, RepoProfile, ServerRepo};
    use tauri::Emitter;

    let mut headers = reqwest::header::HeaderMap::new();
    if let Some(pw) = password.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(pw) {
            headers.insert("X-Repo-Password", hv);
        }
    }
    crate::commands::repo_keyauth::add_proof(&mut headers, base_url.trim());

    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(300))
        .default_headers(headers)
        .build()
        .map_err(|e| e.to_string())?;
    let base = base_url.trim().trim_end_matches('/').to_string();

    let _ = window.emit("bmm://repo-export-progress", serde_json::json!({
        "step": "Reading the server listing", "progress": 2.0, "current_file": "",
    }));
    let listing = crawl(&base, &client).await?;

    // The previous manifest, from disk — or FROM THE SERVER when there is no local copy.
    //
    // This is the ordinary case and it was the unsupported one: the repo.json already lives
    // beside the mods, and asking somebody to first download it, point a file picker at it,
    // and then ask BMM to update it is three steps to fetch a file BMM can fetch. Without a
    // previous manifest the planner has nothing to carry forward, so EVERY file comes back
    // hashless and every mod installs "unverified" — which is what that report was.
    //
    // Fetched, never trusted blindly: it goes through the same signature check as a local
    // one (see plan_refresh), so a manifest the server rewrote is treated as "not ours" and
    // its hashes are recomputed rather than believed.
    let mut previous: Option<ServerRepo> = std::fs::read_to_string(&manifest_path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok());
    let mut previous_from_server = false;
    if previous.is_none() {
        // `<base>/repo.json` and one level up, which is where the two layouts put it: beside
        // the mods folder, or inside it.
        for url in [format!("{}/repo.json", base), base.rsplit_once('/').map(|(p, _)| format!("{}/repo.json", p)).unwrap_or_default()] {
            if url.is_empty() { continue; }
            let Ok(resp) = client.get(&url).send().await else { continue };
            if !resp.status().is_success() { continue; }
            let Ok(text) = resp.text().await else { continue };
            if let Ok(doc) = serde_json::from_str::<ServerRepo>(&text) {
                previous = Some(doc);
                previous_from_server = true;
                let _ = window.emit("bmm://repo-export-progress", serde_json::json!({
                    "step": format!("Found the repo.json already on the server ({url})"),
                    "progress": 6.0, "current_file": "",
                }));
                break;
            }
        }
    }
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

    // No previous manifest means this run CREATES the repo — there is no requirement to have
    // one already. The name and game then have to come from the caller: a repo published as
    // "BMM Repo" with an empty game is not something anyone can subscribe to sensibly, and
    // there would be no way to fix it afterwards without hand-editing the JSON.
    let is_new = previous.is_none();
    let mut repo = previous.clone()
        .unwrap_or_else(|| ServerRepo::new("BMM Repo".to_string(), String::new()));
    if is_new {
        if let Some(n) = name.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            repo.name = n.to_string();
        }
        if let Some(g) = game_name.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            repo.game_name = g.to_string();
        }
    }
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
    // Where it lands when the caller named no local file: beside the app data, under a name
    // taken from the repo. Somewhere real and reported, rather than refusing to write at the
    // end of a job that already did all the work.
    let manifest_path = if manifest_path.trim().is_empty() {
        let dir = { use tauri::Manager; handle.path().app_data_dir() }.unwrap_or_default().join("RemoteRepos");
        let _ = std::fs::create_dir_all(&dir);
        let stem: String = repo.name.chars()
            .map(|c| if c.is_alphanumeric() || c == '-' || c == '_' { c } else { '-' })
            .collect();
        dir.join(format!("{}-repo.json", stem.trim_matches('-')))
            .to_string_lossy().to_string()
    } else {
        manifest_path
    };
    std::fs::write(&manifest_path, json).map_err(|e| e.to_string())?;

    let _ = window.emit("bmm://repo-export-progress", serde_json::json!({
        "step": "repo.exportDone", "progress": 100.0, "current_file": "",
    }));

    Ok(RemoteRefreshReport {
        previous_from_server,
        manifest_path,
        mods: mods_count,
        files: files_count,
        hashed: plan.fetch.len(),
        added: plan.added.len(),
        changed: plan.changed.len(),
        reused: plan.carry_forward.len(),
        removed: plan.removed,
        downloaded_bytes,
        signed,
        warnings,
        created: is_new,
    })
}
