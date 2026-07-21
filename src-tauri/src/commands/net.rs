//! Shared HTTP clients.
//!
//! A `reqwest::Client` owns a connection pool and a TLS session cache. Building a
//! fresh one per request — as many commands used to — throws that away every call and
//! forces a new TCP + TLS handshake to the same host. This process-wide client is
//! built once and reused, so repeated calls (telemetry flush, catalog/blog fetch,
//! avatars, update checks) get HTTP keep-alive for free. Per-request settings
//! (timeout, User-Agent, headers) go on the `RequestBuilder`, so one client serves
//! many call sites; only clients that need a *build-time* difference (custom/invalid
//! certs, proxy, blocking) keep their own.

use std::sync::OnceLock;

/// The default async client: standard TLS + gzip + redirects, with **no** default
/// timeout or User-Agent. Set `.timeout(..)` per request, and add a
/// `.header(reqwest::header::USER_AGENT, ..)` for hosts that require one (e.g. GitHub).
pub fn client() -> &'static reqwest::Client {
    static C: OnceLock<reqwest::Client> = OnceLock::new();
    C.get_or_init(|| reqwest::Client::builder().build().unwrap_or_default())
}

/// True only for first-party BetterCommunity hosts (+ localhost for dev). We attach the
/// identity header ONLY to these, never to GitHub raw or an arbitrary community-source
/// URL — a substring check would let `https://evil.com/bettercommunity/...` steal it, so
/// this parses and matches the HOST exactly.
fn is_bettercommunity_host(url: &str) -> bool {
    reqwest::Url::parse(url).ok().and_then(|u| u.host_str().map(|h| {
        let h = h.to_ascii_lowercase();
        h == "bettercommunity.ch" || h.ends_with(".bettercommunity.ch") || h == "localhost" || h.starts_with("127.0.0.1")
    })).unwrap_or(false)
}

/// GET a BetterCommunity catalog feed or payload. Carries the site identity header
/// (X-Creator-ID) — the same one the repo fetches send — so PRIVATE community catalogs
/// can gate access by the caller's linked account. The header is added ONLY for
/// first-party hosts (see above), so a third-party feed URL never receives the id.
/// Set `.timeout(..)` on the returned builder before sending.
pub fn catalog_get(handle: &tauri::AppHandle, url: &str) -> reqwest::RequestBuilder {
    let mut req = client().get(url).header(reqwest::header::USER_AGENT, "BetterModsManager/1.0");
    if is_bettercommunity_host(url) {
        if let Ok(cid) = crate::commands::security::get_creator_id(handle.clone()) {
            if let Ok(hv) = reqwest::header::HeaderValue::from_str(&cid) {
                req = req.header("X-Creator-ID", hv);
            }
        }
    }
    req
}

/// Fetch a small remote JSON config (links.json, contributors.json, …) over the Rust HTTP
/// client and return its body as text. The frontend used a browser `fetch()` for these, but the
/// webview enforces CORS and `bettercommunity.ch/api/assets/*` sends no
/// `Access-Control-Allow-Origin`, so those requests were blocked ("has been blocked by CORS
/// policy"). Going through the backend sidesteps CORS entirely and reuses the pooled client + BC
/// identity header. Only http(s) URLs are accepted; local bundled fallbacks stay webview fetches.
#[tauri::command]
pub async fn fetch_remote_json(handle: tauri::AppHandle, url: String) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs are supported".into());
    }
    let resp = catalog_get(&handle, &url)
        .timeout(std::time::Duration::from_secs(10))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    resp.text().await.map_err(|e| e.to_string())
}
