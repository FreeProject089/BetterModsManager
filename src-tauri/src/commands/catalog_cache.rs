//! Fetching a catalogue with an HTTP cache that survives a restart, and a status per source.
//!
//! Every catalogue was fetched in full on every open, with a cache-busting `?t=` so nothing in
//! between could help, and a source that failed simply vanished from the list until it came
//! back. Three things change here, for the catalogue reader that goes through
//! `catalog_fetch`:
//!
//!  - **Conditional requests.** The `ETag` and `Last-Modified` of the last good answer are
//!    sent back as `If-None-Match` / `If-Modified-Since`; a `304` reuses the stored body. Always
//!    revalidated unless the caller says the copy is young enough (`max_age_secs`): a
//!    catalogue must never be staler than its server says.
//!  - **Last good copy.** A source that is unreachable, or answers 5xx, serves the body it last
//!    served successfully, marked `stale`, with the error beside it. One failing source never
//!    empties a list, and never blocks the others: each fetch is its own command.
//!  - **Status.** Per source: last success, last error, consecutive failures, size, hash —
//!    `catalog_cache_status` lists them for the interface and a script.
//!
//! Its own folder (`catalog-cache/`, one file per source) rather than `catalog_store`: that
//! module holds catalogues this machine AUTHORS, and a cache must be deletable without losing
//! anything — mixing the two is how somebody clears a cache and loses their catalogue.

use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};

/// A catalogue is a list; beyond this the answer is refused rather than held in memory.
pub const MAX_BODY: usize = 16 * 1024 * 1024;

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CacheEntry {
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
    /// The last good body. Absent in status listings.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body: Option<String>,
    /// SHA-256 of the body, hex — lets a reader tell "changed" from "re-sent".
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
    #[serde(default)]
    pub bytes: usize,
    /// Last network attempt, RFC 3339.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub fetched_at: Option<String>,
    /// Last time the server answered 200 or 304.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_ok: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub last_error: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(default)]
    pub failures: u32,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum FetchState {
    /// 200: a new body.
    Fresh,
    /// 304: the stored body is still current.
    NotModified,
    /// Within `max_age_secs`: not asked at all.
    Cached,
    /// The server failed; this is the last good body.
    Stale,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FetchResult {
    pub url: String,
    pub body: String,
    pub state: FetchState,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub http_status: Option<u16>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub etag: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_ok: Option<String>,
    /// Set with `Stale`: why the server's answer was not used.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub sha256: Option<String>,
}

/// The cache key: the address without the cache-busting `t=` parameter (and its fragment),
/// so `?t=1712…` on every call does not make every call a new source.
pub fn cache_key(url: &str) -> String {
    let no_frag = url.split('#').next().unwrap_or(url);
    let Some((base, q)) = no_frag.split_once('?') else { return no_frag.to_string() };
    let kept: Vec<&str> = q.split('&').filter(|p| !p.is_empty() && *p != "t" && !p.starts_with("t=")).collect();
    if kept.is_empty() { base.to_string() } else { format!("{base}?{}", kept.join("&")) }
}

fn hex_sha(b: &[u8]) -> String { hex::encode(Sha256::digest(b)) }

fn file_name(url: &str) -> String { format!("{}.json", &hex_sha(cache_key(url).as_bytes())[..32]) }

fn dir(app: &tauri::AppHandle) -> Result<std::path::PathBuf, String> {
    use tauri::Manager;
    Ok(app.path().app_data_dir().map_err(|e| e.to_string())?.join("catalog-cache"))
}

async fn load(app: &tauri::AppHandle, url: &str) -> CacheEntry {
    let Ok(d) = dir(app) else { return CacheEntry { url: cache_key(url), ..Default::default() } };
    match tokio::fs::read_to_string(d.join(file_name(url))).await {
        Ok(t) => serde_json::from_str(&t).unwrap_or_else(|_| CacheEntry { url: cache_key(url), ..Default::default() }),
        Err(_) => CacheEntry { url: cache_key(url), ..Default::default() },
    }
}

/// Write via a temporary file and a rename, so two fetches of one source never leave half a file.
async fn save(app: &tauri::AppHandle, e: &CacheEntry) {
    let Ok(d) = dir(app) else { return };
    let _ = tokio::fs::create_dir_all(&d).await;
    let target = d.join(file_name(&e.url));
    let tmp = d.join(format!("{}.{}.tmp", file_name(&e.url), std::process::id()));
    if let Ok(text) = serde_json::to_string(e) {
        if tokio::fs::write(&tmp, text).await.is_ok() {
            let _ = tokio::fs::rename(&tmp, &target).await;
        }
    }
}

/// A failed attempt: recorded, and answered with the last good body when there is one.
async fn fail(app: &tauri::AppHandle, mut entry: CacheEntry, err: String, status: Option<u16>) -> Result<FetchResult, String> {
    entry.last_error = Some(err.clone());
    entry.failures = entry.failures.saturating_add(1);
    if status.is_some() { entry.http_status = status; }
    save(app, &entry).await;
    if entry.body.is_some() { Ok(result(&entry, FetchState::Stale, Some(err))) } else { Err(err) }
}

fn now() -> String { chrono::Utc::now().to_rfc3339() }

fn young_enough(last_ok: Option<&str>, max_age: u64) -> bool {
    let Some(t) = last_ok.and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok()) else { return false };
    let age = chrono::Utc::now().signed_duration_since(t.with_timezone(&chrono::Utc)).num_seconds();
    age >= 0 && (age as u64) < max_age
}

fn result(e: &CacheEntry, state: FetchState, error: Option<String>) -> FetchResult {
    FetchResult {
        url: e.url.clone(),
        body: e.body.clone().unwrap_or_default(),
        state,
        http_status: e.http_status,
        etag: e.etag.clone(),
        last_modified: e.last_modified.clone(),
        last_ok: e.last_ok.clone(),
        error,
        sha256: e.sha256.clone(),
    }
}

/// Fetch a catalogue through the cache. http(s) only (the interface reads `ssh://`, files and
/// bundles itself). `password` is the download password, sent as `X-Repo-Password` exactly as
/// `fetch_remote_json` does; a 401 is `repo.errPasswordRequired`, the one code the interface
/// prompts on. `max_age_secs` lets a refresh skip a source fetched recently; `force` ignores it.
#[tauri::command]
pub async fn catalog_fetch(
    app: tauri::AppHandle,
    url: String,
    password: Option<String>,
    force: Option<bool>,
    max_age_secs: Option<u64>,
) -> Result<FetchResult, String> {
    let low = url.trim().to_ascii_lowercase();
    if !(low.starts_with("https://") || low.starts_with("http://")) {
        return Err("only http(s) URLs are supported".into());
    }
    let mut entry = load(&app, &url).await;
    let have_body = entry.body.is_some();
    if have_body && !force.unwrap_or(false) {
        if let Some(age) = max_age_secs.filter(|a| *a > 0) {
            if young_enough(entry.last_ok.as_deref(), age) {
                return Ok(result(&entry, FetchState::Cached, None));
            }
        }
    }

    let mut req = crate::commands::net::catalog_get(&app, &url).timeout(std::time::Duration::from_secs(15));
    if let Some(pw) = password.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(pw) { req = req.header("X-Repo-Password", hv); }
    }
    if have_body {
        if let Some(et) = entry.etag.as_deref() {
            if let Ok(hv) = reqwest::header::HeaderValue::from_str(et) { req = req.header(reqwest::header::IF_NONE_MATCH, hv); }
        }
        if let Some(lm) = entry.last_modified.as_deref() {
            if let Ok(hv) = reqwest::header::HeaderValue::from_str(lm) { req = req.header(reqwest::header::IF_MODIFIED_SINCE, hv); }
        }
    }
    entry.fetched_at = Some(now());

    let resp = match req.send().await {
        Ok(r) => r,
        Err(e) => return fail(&app, entry, e.to_string(), None).await,
    };
    let status = resp.status().as_u16();
    if status == 304 && have_body {
        entry.http_status = Some(304);
        entry.last_ok = Some(now());
        entry.last_error = None;
        entry.failures = 0;
        save(&app, &entry).await;
        return Ok(result(&entry, FetchState::NotModified, None));
    }
    if status == 401 {
        // Not served from the cache: a password that stopped working is news, not an outage.
        let mut e = entry.clone();
        e.last_error = Some("repo.errPasswordRequired".into());
        e.http_status = Some(401);
        save(&app, &e).await;
        return Err("repo.errPasswordRequired".into());
    }
    if status == 403 || status == 404 || status == 410 {
        // The server says the catalogue is gone or closed: forget the copy, it is not "stale".
        let mut e = CacheEntry { url: entry.url.clone(), fetched_at: entry.fetched_at.clone(), ..Default::default() };
        e.last_error = Some(format!("HTTP {status}"));
        e.http_status = Some(status);
        e.failures = entry.failures.saturating_add(1);
        save(&app, &e).await;
        return Err(if status == 403 { "forbidden: this catalog is private".into() } else { format!("HTTP {status}") });
    }
    if !resp.status().is_success() {
        return fail(&app, entry, format!("HTTP {status}"), Some(status)).await;
    }
    let etag = resp.headers().get(reqwest::header::ETAG).and_then(|v| v.to_str().ok()).map(|s| s.chars().take(256).collect());
    let lm = resp.headers().get(reqwest::header::LAST_MODIFIED).and_then(|v| v.to_str().ok()).map(|s| s.chars().take(64).collect());
    if resp.content_length().map(|l| l as usize > MAX_BODY).unwrap_or(false) {
        return fail(&app, entry, "too large".into(), Some(status)).await;
    }
    let bytes = match resp.bytes().await {
        Ok(b) => b,
        Err(e) => return fail(&app, entry, e.to_string(), Some(status)).await,
    };
    if bytes.len() > MAX_BODY {
        return fail(&app, entry, "too large".into(), Some(status)).await;
    }
    let body = String::from_utf8_lossy(&bytes).into_owned();
    entry.sha256 = Some(hex_sha(&bytes));
    entry.bytes = bytes.len();
    entry.body = Some(body);
    entry.etag = etag;
    entry.last_modified = lm;
    entry.http_status = Some(status);
    entry.last_ok = Some(now());
    entry.last_error = None;
    entry.failures = 0;
    save(&app, &entry).await;
    Ok(result(&entry, FetchState::Fresh, None))
}

/// Every cached source and how it last went, without the bodies.
#[tauri::command]
pub async fn catalog_cache_status(app: tauri::AppHandle) -> Result<Vec<CacheEntry>, String> {
    let d = dir(&app)?;
    let mut out = Vec::new();
    let Ok(mut rd) = tokio::fs::read_dir(&d).await else { return Ok(out) };
    while let Ok(Some(f)) = rd.next_entry().await {
        let p = f.path();
        if p.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        if let Ok(t) = tokio::fs::read_to_string(&p).await {
            if let Ok(mut e) = serde_json::from_str::<CacheEntry>(&t) {
                e.body = None;
                out.push(e);
            }
        }
    }
    out.sort_by(|a, b| a.url.cmp(&b.url));
    Ok(out)
}

/// Forget one source's cached copy, or every one. Returns how many were removed.
#[tauri::command]
pub async fn catalog_cache_clear(app: tauri::AppHandle, url: Option<String>) -> Result<usize, String> {
    let d = dir(&app)?;
    if let Some(u) = url {
        return Ok(match tokio::fs::remove_file(d.join(file_name(&u))).await { Ok(()) => 1, Err(_) => 0 });
    }
    let mut n = 0;
    let Ok(mut rd) = tokio::fs::read_dir(&d).await else { return Ok(0) };
    while let Ok(Some(f)) = rd.next_entry().await {
        let p = f.path();
        if p.extension().and_then(|e| e.to_str()) == Some("json") && tokio::fs::remove_file(&p).await.is_ok() { n += 1; }
    }
    Ok(n)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn catalog_cache_key_ignores_the_cache_buster() {
        assert_eq!(cache_key("https://a.example/c.json?t=171234"), "https://a.example/c.json");
        assert_eq!(cache_key("https://a.example/c.json?kind=plugin&t=1"), "https://a.example/c.json?kind=plugin");
        assert_eq!(cache_key("https://a.example/c.json?t&x=1#frag"), "https://a.example/c.json?x=1");
        assert_eq!(file_name("https://a.example/c.json?t=1"), file_name("https://a.example/c.json?t=2"));
        assert_ne!(file_name("https://a.example/c.json?kind=a"), file_name("https://a.example/c.json?kind=b"));
    }

    #[test]
    fn catalog_cache_age_rule() {
        let recent = chrono::Utc::now().to_rfc3339();
        assert!(young_enough(Some(&recent), 60));
        assert!(!young_enough(Some("2001-01-01T00:00:00Z"), 60));
        assert!(!young_enough(None, 60));
        assert!(!young_enough(Some("garbage"), 60));
    }

    #[test]
    fn catalog_cache_status_never_carries_bodies() {
        let e = CacheEntry { url: "u".into(), body: Some("{}".into()), ..Default::default() };
        let mut listed = e.clone();
        listed.body = None;
        let j = serde_json::to_value(&listed).unwrap();
        assert!(j.get("body").is_none());
    }
}
