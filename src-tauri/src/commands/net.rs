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

/// What `http_request` hands back. The status is returned rather than folded into an
/// `Err`, because a scheduler step may legitimately want to branch on a 404.
#[derive(serde::Serialize)]
pub struct HttpReply {
    pub status: u16,
    pub body: String,
}

/// A general HTTP request for scheduler automations.
///
/// Deliberately NOT built on `catalog_get`. That helper attaches the X-Creator-ID identity
/// header for first-party hosts, and this URL comes from a task definition that may have
/// arrived in a shared `.bmmpa` — an automation someone downloaded must not be able to make
/// BMM send the user's creator id anywhere, including to bettercommunity.ch on their behalf.
/// A plain pooled client, no identity, no ambient credentials.
///
/// Nothing here is logged. The URL can carry a token in its query string and the headers
/// routinely carry an Authorization line; writing either to the log would move a live
/// secret into a file that gets pasted into bug reports (CWE-532).
///
/// The body is capped. A task pointed at a large download would otherwise pull the whole
/// thing into memory and then into a variable, and the useful reply to an automation asking
/// for a value is never eight megabytes.
#[tauri::command]
pub async fn http_request(
    url: String,
    method: String,
    headers: std::collections::HashMap<String, String>,
    body: Option<String>,
    timeout_ms: Option<u64>,
) -> Result<HttpReply, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs are supported".into());
    }
    let method = reqwest::Method::from_bytes(method.to_ascii_uppercase().as_bytes())
        .map_err(|_| "unsupported HTTP method".to_string())?;

    let mut req = client()
        .request(method, &url)
        .header(reqwest::header::USER_AGENT, "BetterModsManager/1.0")
        .timeout(std::time::Duration::from_millis(timeout_ms.unwrap_or(15_000).clamp(1_000, 120_000)));

    for (k, v) in headers {
        // A header name or value the task got wrong is reported, not skipped: a request
        // that quietly went out without its Authorization line fails later, somewhere
        // else, as a 401 that looks like a wrong token.
        let name = reqwest::header::HeaderName::from_bytes(k.as_bytes())
            .map_err(|_| format!("not a usable header name: {k}"))?;
        let value = reqwest::header::HeaderValue::from_str(&v)
            .map_err(|_| format!("not a usable value for header {k}"))?;
        req = req.header(name, value);
    }
    if let Some(b) = body {
        req = req.body(b);
    }

    let resp = req.send().await.map_err(|e| e.to_string())?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| e.to_string())?;
    const MAX: usize = 1_048_576;
    let body = if text.len() > MAX {
        // Truncation is announced in the value itself. Silently returning the first
        // megabyte would let a condition compare against a value that is not what the
        // server said, and nothing on screen would suggest why.
        format!("{}\n…[truncated at 1 MB]", &text[..text.floor_char_boundary(MAX)])
    } else {
        text
    };
    Ok(HttpReply { status, body })
}
