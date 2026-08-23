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
    // Key proof, when this BMM has a key to prove with. Attached to EVERY request rather than
    // behind a per-source setting: a server that does not require one ignores it, and asking
    // the user to declare in advance which sources are protected is a setting they would get
    // wrong once and then not understand. Signing is cached per origin (see repo_keyauth), so
    // the cost is one signature every two minutes, not one per file.
    {
        if let Some((name, value)) = crate::commands::repo_keyauth::header_for(url) {
            if let Ok(hv) = reqwest::header::HeaderValue::from_str(&value) {
                req = req.header(name, hv);
            }
        }
    }
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
///
/// `password` is the optional download password for a protected source. It is sent as
/// `X-Repo-Password` — BMM's existing contract with a password-protected repo, reused for
/// catalogs rather than inventing a second header, so a server implements one check and a
/// client speaks one language.
pub async fn fetch_remote_json(
    handle: tauri::AppHandle,
    url: String,
    password: Option<String>,
) -> Result<String, String> {
    if !(url.starts_with("https://") || url.starts_with("http://")) {
        return Err("only http(s) URLs are supported".into());
    }
    let mut req = catalog_get(&handle, &url).timeout(std::time::Duration::from_secs(10));
    if let Some(pw) = password.as_deref().map(str::trim).filter(|p| !p.is_empty()) {
        if let Ok(hv) = reqwest::header::HeaderValue::from_str(pw) {
            req = req.header("X-Repo-Password", hv);
        }
    }
    let resp = req.send().await.map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        // 401 is "this source needs a download password (or the one given is wrong)". The
        // SAME code fetch_repo_info returns, so the frontend has one rule for both: prompt
        // once, remember for the session, retry.
        if resp.status().as_u16() == 401 {
            return Err("repo.errPasswordRequired".to_string());
        }
        return Err(format!("HTTP {}", resp.status().as_u16()));
    }
    resp.text().await.map_err(|e| e.to_string())
}

/// What `http_request` hands back. The status is returned rather than folded into an
/// `Err`, because a scheduler step may legitimately want to branch on a 404.
#[derive(serde::Serialize, Debug)]
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

#[cfg(test)]
mod http_request_tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    /// A one-shot HTTP server on a free port. Returns the port and a handle that yields the
    /// raw request text the client actually sent.
    ///
    /// Deliberately not "point the test at the dev stack". A test that needs Docker running
    /// passes on my machine and fails on everyone else's, which makes it a test of the
    /// environment rather than of the code. This serves one canned response over a real
    /// socket, so reqwest, the status parse and the body read are all genuinely exercised.
    fn one_shot(status_line: &str, body: &str) -> (u16, std::thread::JoinHandle<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind an ephemeral port");
        let port = listener.local_addr().unwrap().port();
        let body = body.to_string();
        let status_line = status_line.to_string();
        let handle = std::thread::spawn(move || {
            let (mut sock, _) = listener.accept().expect("accept");
            let mut buf = [0u8; 8192];
            let n = sock.read(&mut buf).unwrap_or(0);
            let seen = String::from_utf8_lossy(&buf[..n]).to_string();
            let resp = format!(
                "HTTP/1.1 {status_line}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            let _ = sock.write_all(resp.as_bytes());
            let _ = sock.flush();
            seen
        });
        (port, handle)
    }

    #[tokio::test]
    async fn it_makes_a_real_request_and_returns_the_status_and_body() {
        let (port, seen) = one_shot("200 OK", r#"{"version":"1.2.3"}"#);
        let r = http_request(
            format!("http://127.0.0.1:{port}/health"),
            "GET".into(),
            std::collections::HashMap::new(),
            None,
            Some(5_000),
        )
        .await
        .expect("the request should succeed");
        assert_eq!(r.status, 200);
        assert_eq!(r.body, r#"{"version":"1.2.3"}"#);
        let req = seen.join().unwrap();
        assert!(req.starts_with("GET /health "), "the path and method reach the server: {req}");
    }

    #[tokio::test]
    async fn a_failing_status_is_returned_not_raised() {
        // The scheduler branches on http.status, including on a 404. Turning a non-2xx into
        // an Err here would take that decision away from the step that is supposed to make it.
        let (port, _seen) = one_shot("404 Not Found", "nope");
        let r = http_request(
            format!("http://127.0.0.1:{port}/missing"),
            "GET".into(),
            std::collections::HashMap::new(),
            None,
            Some(5_000),
        )
        .await
        .expect("a 404 is an answer, not a transport failure");
        assert_eq!(r.status, 404);
        assert_eq!(r.body, "nope");
    }

    #[tokio::test]
    async fn headers_and_a_body_reach_the_server() {
        let (port, seen) = one_shot("200 OK", "ok");
        let mut h = std::collections::HashMap::new();
        h.insert("Authorization".to_string(), "Bearer probe-token".to_string());
        let r = http_request(
            format!("http://127.0.0.1:{port}/post"),
            "POST".into(),
            h,
            Some("{\"a\":1}".into()),
            Some(5_000),
        )
        .await
        .expect("the request should succeed");
        assert_eq!(r.status, 200);
        let req = seen.join().unwrap();
        assert!(req.contains("POST /post "), "method: {req}");
        // Lowercased on the wire: reqwest normalises header names, which is correct — HTTP
        // header names are case-insensitive. Asserting the capitalised form failed against a
        // request that was perfectly well formed.
        assert!(
            req.to_ascii_lowercase().contains("authorization: bearer probe-token"),
            "the header is sent: {req}"
        );
        assert!(req.contains("{\"a\":1}"), "the body is sent: {req}");
    }

    #[tokio::test]
    async fn the_creator_id_header_is_never_attached() {
        // The whole reason this is not built on catalog_get. A URL can arrive inside a
        // downloaded .bmmpa, and an automation must not be able to make BMM identify the
        // user to a third party — including to bettercommunity.ch on their behalf.
        let (port, seen) = one_shot("200 OK", "ok");
        let _ = http_request(
            format!("http://127.0.0.1:{port}/x"),
            "GET".into(),
            std::collections::HashMap::new(),
            None,
            Some(5_000),
        )
        .await
        .expect("the request should succeed");
        let req = seen.join().unwrap();
        assert!(
            !req.to_ascii_lowercase().contains("x-creator-id"),
            "no identity header may be attached: {req}"
        );
    }

    #[tokio::test]
    async fn a_non_http_scheme_is_refused_before_any_socket_is_opened() {
        let err = http_request(
            "file:///etc/passwd".into(),
            "GET".into(),
            std::collections::HashMap::new(),
            None,
            Some(5_000),
        )
        .await
        .expect_err("file:// must be refused");
        assert!(err.contains("http(s)"), "the reason is stated: {err}");
    }

    #[tokio::test]
    async fn an_unusable_header_name_is_reported_rather_than_dropped() {
        // Silently skipping it would send the request WITHOUT its Authorization line, and
        // the failure would surface later as a 401 that looks like a wrong token.
        let mut h = std::collections::HashMap::new();
        h.insert("Bad Header".to_string(), "x".to_string());
        let err = http_request(
            "http://127.0.0.1:1/x".into(),
            "GET".into(),
            h,
            None,
            Some(1_000),
        )
        .await
        .expect_err("a malformed header name must be an error");
        assert!(err.contains("Bad Header"), "the offending name is named: {err}");
    }
}
