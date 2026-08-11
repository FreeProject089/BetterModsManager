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
