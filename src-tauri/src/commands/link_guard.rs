//! Hard limits for what a `bmm://` link may make the backend do.
//!
//! Any web page can fire a `bmm://` link, so everything a link carries is input from a
//! stranger (CWE-352 / CWE-601 / CWE-78 / CWE-22). The frontend (`core/deeplink-guard.ts`)
//! asks the user in-app before any link changes anything; the commands here are the ones the
//! link routes call once the user has said yes, and they enforce the limits that NO answer
//! can lift:
//!
//!   - `link_launch_app`     launches only an app BMM registered, by id — never a path, and
//!                           never a script (.ps1/.bat/.cmd/…), so never `-ExecutionPolicy Bypass`.
//!   - `link_install_app`    https only, a sha256 is REQUIRED and must match, no script
//!                           payloads, no "install anyway", and the install folder is
//!                           BMM's own or a local folder (never a network share).
//!   - `link_install_plugin` https only, sha256 checked when the link carries one, and the
//!                           plugin lands DISABLED with no permissions (`install_plugin_bytes`).
//!   - `link_export_app_data` never a network path, and the data file is REDACTED on the way
//!                           out (`report_redact`) — a link cannot produce a copy with tokens.
//!
//! These exist beside the unrestricted commands (the app's own screens still use those)
//! so the link path cannot fall back to them: the frontend's link branches only ever
//! invoke these.

use tauri::{AppHandle, State};

use crate::state::AppState;

/// Why a link-supplied filesystem path is refused, or `None` when it is acceptable.
///
/// Checked BEFORE the path touches the filesystem: merely asking Windows whether
/// `\\host\share` exists sends the user's NTLM credentials to `host`.
pub fn path_refusal(p: &str) -> Option<&'static str> {
    let s = p.trim();
    if s.is_empty() {
        return Some("empty");
    }
    if s.chars().any(|c| c == '\0' || c.is_control()) {
        return Some("invalid");
    }
    // UNC (\\host\share, //host/share), device and verbatim prefixes (\\?\, \\.\).
    if s.starts_with("\\\\") || s.starts_with("//") || s.starts_with("\\/") || s.starts_with("/\\") {
        return Some("network");
    }
    let lower = s.to_ascii_lowercase();
    if lower.contains("://") || lower.starts_with("file:") {
        return Some("network");
    }
    // Absolute only: `C:\…` or `C:/…` on Windows, `/…` elsewhere. `C:foo` is relative to
    // the current directory of drive C — not absolute, whatever it looks like.
    let b = s.as_bytes();
    let drive_abs = b.len() >= 3 && b[0].is_ascii_alphabetic() && b[1] == b':' && (b[2] == b'\\' || b[2] == b'/');
    let unix_abs = !cfg!(windows) && s.starts_with('/');
    if !drive_abs && !unix_abs {
        return Some("relative");
    }
    // A second colon after the drive letter is an NTFS alternate data stream.
    if s.get(2..).unwrap_or("").contains(':') {
        return Some("invalid");
    }
    if s.split(['/', '\\']).any(|seg| seg == "..") {
        return Some("traversal");
    }
    None
}

/// Why a link-supplied download URL is refused. https only, a host, no credentials.
pub fn https_refusal(url: &str) -> Option<&'static str> {
    let u = url.trim();
    if u.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Some("invalid");
    }
    let Some(rest) = u.get(..8).filter(|p| p.eq_ignore_ascii_case("https://")).map(|_| &u[8..]) else {
        return Some("not-https");
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.is_empty() {
        return Some("no-host");
    }
    if authority.contains('@') {
        return Some("credentials");
    }
    None
}

/// The host a URL names, lowercased — what the gate's dialog puts on its own line.
pub fn host_of(url: &str) -> String {
    reqwest::Url::parse(url.trim())
        .ok()
        .and_then(|u| u.host_str().map(|h| h.to_ascii_lowercase()))
        .unwrap_or_default()
}

/// Why the address the bytes actually came from is refused, or `None`.
///
/// The gate shows the host on its own line precisely so a look-alike cannot hide in a long
/// URL. A redirect moves the download somewhere else AFTER the person has read that line, so
/// the host they approved and the host that served them are not the same fact.
///
/// A checksum settles it: the content is pinned whatever serves it, and catalogues do
/// legitimately point at a release that redirects to a CDN. Without one — and a plugin
/// catalogue carries no checksum — the server is the only thing vouching for the bytes, so it
/// must be the server that was shown.
pub fn redirect_refusal(requested: &str, final_url: &str, has_checksum: bool) -> Option<&'static str> {
    if has_checksum {
        return None;
    }
    let shown = host_of(requested);
    if shown.is_empty() {
        return Some("no-host");
    }
    (shown != host_of(final_url)).then_some("redirected-host")
}

/// A sha256 as a catalogue writes it: 64 hex digits, optionally prefixed `sha256:`.
pub fn normalize_sha256(s: &str) -> Option<String> {
    let t = s.trim();
    let t = t.strip_prefix("sha256:").unwrap_or(t).to_ascii_lowercase();
    (t.len() == 64 && t.chars().all(|c| c.is_ascii_hexdigit())).then_some(t)
}

/// Only a plain program is started from a link. Scripts need an interpreter, and the
/// interpreter for `.ps1` is started with `-ExecutionPolicy Bypass` — never from a link.
pub fn launch_refusal(exe: &str) -> Option<&'static str> {
    let ext = std::path::Path::new(exe.trim())
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.to_ascii_lowercase());
    match ext.as_deref() {
        Some("exe") => path_refusal(exe),
        _ => Some("not-a-program"),
    }
}

/// An app id becomes a folder name under the install directory: letters, digits, `-_.`,
/// and never `.`/`..` on its own.
pub fn app_id_ok(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && id != "."
        && id != ".."
        && id.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.'))
}

/// A payload whose NAME says it is a script is refused from a link whatever `type` says.
fn url_names_script(url: &str) -> bool {
    let file = url.split(['?', '#']).next().unwrap_or("").rsplit('/').next().unwrap_or("").to_ascii_lowercase();
    [".ps1", ".bat", ".cmd", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".hta", ".sh", ".py", ".lnk", ".scr"]
        .iter()
        .any(|x| file.ends_with(x))
}

fn refused(what: &str, why: &str) -> String {
    format!("LINK_REFUSED:{why}: {what}")
}

/// `bmm://app/launch?id=…` — the app BMM registered under that id, nothing else.
#[tauri::command]
pub fn link_launch_app(app_handle: AppHandle, app_id: String) -> Result<(), String> {
    let (_title, exe) = crate::commands::apps::registered_app_exe(&app_handle, &app_id)
        .ok_or_else(|| refused(&app_id, "unknown-app"))?;
    if let Some(why) = launch_refusal(&exe) {
        return Err(refused(&exe, why));
    }
    crate::commands::apps::launch_app(app_handle, app_id, exe)
}

/// `bmm://app/install` and `bmm://catalog/app/install`, after the user confirmed in-app.
#[tauri::command]
pub async fn link_install_app(
    app_handle: AppHandle,
    app_id: String,
    app_title: String,
    download_url: String,
    file_type: String,
    install_path: Option<String>,
    sha256: Option<String>,
) -> Result<crate::models::app_catalog::InstallResult, String> {
    if let Some(why) = https_refusal(&download_url) {
        return Err(refused(&download_url, why));
    }
    if !app_id_ok(&app_id) {
        return Err(refused(&app_id, "bad-id"));
    }
    let ft = file_type.trim().to_ascii_lowercase();
    if !matches!(ft.as_str(), "exe" | "msi" | "zip") || url_names_script(&download_url) {
        return Err(refused(&download_url, "script"));
    }
    let sha = sha256
        .as_deref()
        .and_then(normalize_sha256)
        .ok_or_else(|| refused(&download_url, "no-checksum"))?;
    let dir = match install_path.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => {
            if let Some(why) = path_refusal(p) {
                return Err(refused(p, why));
            }
            p.to_string()
        }
        None => crate::commands::apps::get_default_apps_path(app_handle.clone())?,
    };
    crate::commands::apps::install_app(
        app_handle, app_id, app_title, download_url, ft, dir,
        None, None, None,
        Some(sha),
        Some(false), // never plain http from a link
        Some(false), // a mismatch is never "installed anyway" from a link
        None,        // never a local file named by a link
    )
    .await
}

/// `bmm://catalog/plugin/install`, after the user confirmed in-app. Returns the plugin id.
#[tauri::command]
pub async fn link_install_plugin(
    state: State<'_, AppState>,
    handle: AppHandle,
    download_url: String,
    sha256: Option<String>,
) -> Result<String, String> {
    if let Some(why) = https_refusal(&download_url) {
        return Err(refused(&download_url, why));
    }
    let expected = match sha256.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(s) => Some(normalize_sha256(s).ok_or_else(|| refused(s, "bad-checksum"))?),
        None => None,
    };
    let resp = crate::commands::net::catalog_get(&handle, &download_url)
        .timeout(std::time::Duration::from_secs(60))
        .send()
        .await
        .map_err(|e| format!("Download error: {}", e))?;
    // The final address after redirects must still be https — and, with no checksum to pin
    // the bytes, must still be the server the dialog showed.
    if let Some(why) = https_refusal(resp.url().as_str()) {
        return Err(refused(resp.url().as_str(), why));
    }
    if let Some(why) = redirect_refusal(&download_url, resp.url().as_str(), expected.is_some()) {
        return Err(refused(resp.url().as_str(), why));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("Read error: {}", e))?;
    if let Some(exp) = expected {
        use sha2::{Digest, Sha256};
        let actual = hex::encode(Sha256::digest(&bytes));
        if actual != exp {
            return Err(format!("LINK_REFUSED:checksum-mismatch: expected {exp}, got {actual}"));
        }
    }
    crate::commands::plugins::install_plugin_bytes(&state, &handle, &bytes)
}

/// `bmm://data/export-auto`, after the user confirmed and picked the folder. The data file
/// goes out REDACTED: a link can never produce a copy carrying tokens.
#[tauri::command]
pub fn link_export_app_data(
    state: State<AppState>,
    dir: String,
    name: Option<String>,
    increment: Option<String>,
) -> Result<String, String> {
    if let Some(why) = path_refusal(&dir) {
        return Err(refused(&dir, why));
    }
    let _ = state.save();
    let text = std::fs::read_to_string(&*state.data_path).map_err(|e| e.to_string())?;
    let out = redacted_export_beside(&text, std::path::Path::new(&*state.data_path));
    let dest = crate::commands::settings::backup_dest_path(dir, name, increment, None)?;
    std::fs::write(&dest, out).map_err(|e| e.to_string())?;
    Ok(dest)
}

/// The data file with every secret redacted, by field name and by value.
pub fn redacted_export(data_json: &str) -> String {
    let mut r = crate::commands::report_redact::Redactor::new();
    r.absorb_json_text(data_json);
    r.redact_json_text(data_json)
}

/// The same, plus the secrets that live in a file of their OWN beside the data file.
///
/// Redaction by key name only removes what a key names. The BetterCommunity API key is in no
/// JSON at all, so the value layer never learns it unless something reads that file — which
/// `crash.rs` does before writing a report, and this did not. A key echoed into the data file
/// under a name `is_secret_key` does not read as one (`bc`, `account`, `licence`) would have
/// survived the one export a web page can still ask for. Both paths learn the same secrets now.
pub fn redacted_export_beside(data_json: &str, data_path: &std::path::Path) -> String {
    let mut r = crate::commands::report_redact::Redactor::new();
    r.absorb_json_text(data_json);
    r.absorb_secret_file(&data_path.with_file_name(crate::commands::security::BC_API_KEY_FILE));
    r.redact_json_text(data_json)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn network_paths_are_refused() {
        for p in [
            r"\\attacker\share",
            r"\\attacker\share\out",
            "//attacker/share",
            r"\\?\C:\Users",
            r"\\.\pipe\x",
            r"\/attacker/share",
            "file://attacker/share",
            "smb://attacker/share",
        ] {
            assert_eq!(path_refusal(p), Some("network"), "{p}");
        }
    }

    #[test]
    fn relative_traversal_and_streams_are_refused() {
        assert_eq!(path_refusal(""), Some("empty"));
        assert_eq!(path_refusal("out"), Some("relative"));
        assert_eq!(path_refusal("C:out"), Some("relative"));
        assert_eq!(path_refusal(r"C:\Users\me\..\..\Windows"), Some("traversal"));
        assert_eq!(path_refusal(r"C:\x\data.json:evil"), Some("invalid"));
        assert_eq!(path_refusal("C:\\x\u{0}y"), Some("invalid"));
    }

    #[test]
    fn local_absolute_paths_pass() {
        assert_eq!(path_refusal(r"C:\Users\me\Backups"), None);
        assert_eq!(path_refusal("D:/BMM/out"), None);
    }

    #[test]
    fn downloads_are_https_only() {
        assert_eq!(https_refusal("https://example.com/a.zip"), None);
        assert_eq!(https_refusal("HTTPS://example.com/a.zip"), None);
        assert_eq!(https_refusal("http://example.com/a.zip"), Some("not-https"));
        assert_eq!(https_refusal("file:///C:/x.exe"), Some("not-https"));
        assert_eq!(https_refusal(r"\\attacker\share\x.exe"), Some("not-https"));
        assert_eq!(https_refusal("https://"), Some("no-host"));
        assert_eq!(https_refusal("https://user:pw@example.com/x"), Some("credentials"));
        assert_eq!(https_refusal("https://exa mple.com/x"), Some("invalid"));
    }

    #[test]
    fn launch_is_programs_only() {
        assert_eq!(launch_refusal(r"C:\Apps\tool\tool.exe"), None);
        for p in [r"C:\x\a.ps1", r"C:\x\a.bat", r"C:\x\a.cmd", r"C:\x\a.vbs", r"C:\x\a.py", r"C:\x\a", r"C:\x\a.lnk"] {
            assert_eq!(launch_refusal(p), Some("not-a-program"), "{p}");
        }
        assert_eq!(launch_refusal(r"\\attacker\share\a.exe"), Some("network"));
    }

    #[test]
    fn app_ids_cannot_climb_out_of_the_install_folder() {
        assert!(app_id_ok("obs-studio"));
        assert!(app_id_ok("tool_2.1"));
        for id in ["", ".", "..", "../x", r"..\x", "a/b", r"a\b", "C:x", "a b"] {
            assert!(!app_id_ok(id), "{id}");
        }
    }

    #[test]
    fn sha256_shape() {
        let h = "a".repeat(64);
        assert_eq!(normalize_sha256(&h), Some(h.clone()));
        assert_eq!(normalize_sha256(&format!("sha256:{}", h.to_uppercase())), Some(h));
        assert_eq!(normalize_sha256("abc"), None);
        assert_eq!(normalize_sha256(""), None);
    }

    #[test]
    fn an_unchecksummed_download_must_come_from_the_host_that_was_shown() {
        // The dialog showed `good.example`; the bytes arrived from somewhere else.
        assert_eq!(
            redirect_refusal("https://good.example/p.zip", "https://evil.example/p.zip", false),
            Some("redirected-host")
        );
        assert_eq!(
            redirect_refusal("https://good.example/p.zip", "https://cdn.good.example/p.zip", false),
            Some("redirected-host"),
            "a subdomain is a different server"
        );
        // Same host, any path, any case: nothing moved.
        assert_eq!(redirect_refusal("https://good.example/a", "https://GOOD.example/b/c", false), None);
        assert_eq!(redirect_refusal("https://good.example/a", "https://good.example/a", false), None);
        // A checksum pins the content, so the release → CDN redirect catalogues really use
        // stays allowed.
        assert_eq!(
            redirect_refusal("https://github.com/o/r/releases/x.zip", "https://objects.githubusercontent.com/x", true),
            None
        );
        assert_eq!(redirect_refusal("https://", "https://evil.example/x", false), Some("no-host"));
        assert_eq!(host_of("https://Good.Example:443/x"), "good.example");
    }

    #[test]
    fn script_payload_names() {
        assert!(url_names_script("https://x/y/run.ps1"));
        assert!(url_names_script("https://x/y/run.BAT?dl=1"));
        assert!(!url_names_script("https://x/y/setup.exe"));
    }

    #[test]
    fn the_exported_data_file_carries_no_token() {
        let data = r#"{"settings":{"github_token":"ghp_abcdefghijklmnopqrstuvwxyz0123456789","api_token":"s3cr3t-api-token-value","author":"Me"},"profiles":[]}"#;
        let out = redacted_export(data);
        assert!(!out.contains("ghp_abcdefghijklmnopqrstuvwxyz0123456789"), "{out}");
        assert!(!out.contains("s3cr3t-api-token-value"), "{out}");
        assert!(out.contains("Me"), "non-secret fields survive: {out}");
    }

    #[test]
    fn a_secret_kept_in_its_own_file_is_scrubbed_from_the_export_too() {
        // The BetterCommunity API key is in no JSON, so nothing NAMES it. Here the data file
        // echoes it under `bc_account`, a key `is_secret_key` reads as harmless — the one
        // shape the name layer cannot catch and only reading the file can.
        let dir = std::env::temp_dir().join(format!("bmm-link-guard-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let data_path = dir.join("data.json");
        let secret = "bc_live_9f2c41e8a7d64b0e";
        std::fs::write(dir.join(crate::commands::security::BC_API_KEY_FILE), secret).unwrap();
        let data = format!(r#"{{"settings":{{"bc_account":"{secret}","author":"Me"}}}}"#);

        let out = redacted_export_beside(&data, &data_path);
        assert!(!out.contains(secret), "{out}");
        assert!(out.contains("Me"), "non-secret fields survive: {out}");
        // And the name-only path is what it was, so the difference is the file, not luck.
        assert!(redacted_export(&data).contains(secret));

        let _ = std::fs::remove_dir_all(&dir);
    }

    // Refused whatever the user answered: the limits are checked before any I/O, so these
    // need no app handle to prove it.
    #[test]
    fn refusal_marker_shape() {
        assert!(refused(r"\\h\s", "network").starts_with("LINK_REFUSED:network:"));
    }
}
