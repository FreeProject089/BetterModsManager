//! What a scheduled task may send to, and fetch from, the network.
//!
//! Three things a task can now do that it could not before: tell a web service that something
//! happened (a generic webhook, a Discord or Slack channel), notice that a feed has a new item
//! (the `rss` trigger), and keep a feed of its own (an Atom file other programs can follow).
//!
//! Every URL here comes from a task, and a task may have arrived in a `.bmmpa` somebody shared.
//! So the rules below are the ones no task setting can lift, and the frontend's `network`
//! permission is only the first of them:
//!
//!   - **http(s) only**, a host, no `user:pass@` in the address;
//!   - **no private addresses** (loopback, RFC 1918, link-local, CGNAT, ULA, …) unless the step
//!     itself says `allowLan` — checked on the ADDRESSES THE NAME RESOLVES TO, and the
//!     connection is then pinned to exactly those addresses, so a name that answers "public"
//!     to the check and "127.0.0.1" to the connect (DNS rebinding) reaches nothing new;
//!   - **no system proxy**: a proxy would make the connection somewhere the check never saw;
//!   - **redirects** are followed only by a GET (a feed), each hop re-checked; a POST that is
//!     redirected reports the 3xx rather than re-sending its body somewhere else;
//!   - a **timeout** on every request and a **size cap** counted as the bytes arrive;
//!   - **nothing secret in an error**: reqwest puts the URL in its errors, and a webhook URL is
//!     usually the credential (Discord, Slack). Errors are rebuilt without it, and a header
//!     value — secret or not — is never quoted back.

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::time::{Duration, Instant};

/// The most a webhook's answer may weigh. It is read for a status and a line of text.
pub const WEBHOOK_MAX_BYTES: usize = 256 << 10;
/// The most a feed may weigh. A feed of a few hundred items is well under this.
pub const FEED_MAX_BYTES: usize = 4 << 20;
/// How much of an answer is handed back to be shown.
pub const EXCERPT_CHARS: usize = 2_000;
/// Redirect hops a feed fetch may take.
const MAX_REDIRECTS: usize = 5;
/// Items read out of one feed.
pub const FEED_MAX_ITEMS: usize = 100;

// ── Addresses ────────────────────────────────────────────────────────────────────────────────

/// Is this an address inside the machine or its network, rather than on the internet?
///
/// The list is the one an SSRF guard needs, not the one `is_global` would give: it also
/// covers the ranges people forget (CGNAT, the benchmark range, IPv4 hidden in IPv6).
pub fn ip_is_internal(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => v4_internal(v4),
        IpAddr::V6(v6) => {
            // An IPv4 address carried in IPv6 is judged as the IPv4 address it is:
            // `::ffff:127.0.0.1` is loopback, whatever family it arrived in.
            if let Some(v4) = v6.to_ipv4_mapped() {
                return v4_internal(v4);
            }
            let s = v6.segments();
            // NAT64 (64:ff9b::/96) embeds the IPv4 target in the low 32 bits.
            if s[0] == 0x64 && s[1] == 0xff9b && s[2..6].iter().all(|x| *x == 0) {
                let v4 = Ipv4Addr::new((s[6] >> 8) as u8, s[6] as u8, (s[7] >> 8) as u8, s[7] as u8);
                return v4_internal(v4);
            }
            v6.is_loopback()
                || v6.is_unspecified()
                || v6.is_multicast()
                || (s[0] & 0xfe00) == 0xfc00 // unique local fc00::/7
                || (s[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
                || (s[0] & 0xffc0) == 0xfec0 // site-local (deprecated) fec0::/10
                || (s[0] == 0x2001 && s[1] == 0x0db8) // documentation 2001:db8::/32
                // IPv4-compatible (deprecated) ::a.b.c.d
                || (s[0..6].iter().all(|x| *x == 0) && v4_internal(Ipv4Addr::new((s[6] >> 8) as u8, s[6] as u8, (s[7] >> 8) as u8, s[7] as u8)))
        }
    }
}

fn v4_internal(v4: Ipv4Addr) -> bool {
    let o = v4.octets();
    v4.is_loopback()
        || v4.is_private()
        || v4.is_link_local()
        || v4.is_broadcast()
        || v4.is_unspecified()
        || v4.is_multicast()
        || v4.is_documentation()
        || o[0] == 0 // "this network" 0.0.0.0/8
        || (o[0] == 100 && (o[1] & 0xc0) == 64) // CGNAT 100.64.0.0/10
        || (o[0] == 192 && o[1] == 0 && o[2] == 0) // IETF 192.0.0.0/24
        || (o[0] == 198 && (o[1] & 0xfe) == 18) // benchmarking 198.18.0.0/15
        || o[0] >= 240 // reserved 240.0.0.0/4
}

/// A host NAME that means "this machine" whatever DNS says.
fn name_is_local(host: &str) -> bool {
    let h = host.trim_end_matches('.').to_ascii_lowercase();
    h == "localhost" || h.ends_with(".localhost")
}

/// Why this address may not be requested at all, or `None`.
pub fn url_refusal(raw: &str) -> Option<&'static str> {
    let s = raw.trim();
    if s.is_empty() {
        return Some("empty");
    }
    if s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Some("invalid");
    }
    let Ok(u) = reqwest::Url::parse(s) else { return Some("invalid") };
    if u.scheme() != "http" && u.scheme() != "https" {
        return Some("not-http");
    }
    if u.host_str().map(str::is_empty).unwrap_or(true) {
        return Some("no-host");
    }
    if !u.username().is_empty() || u.password().is_some() {
        return Some("credentials");
    }
    None
}

/// A Discord or Slack webhook must be one: https, on the service's own host, on its webhook
/// path. Not a security boundary (the private-address rule is), but a step called "Send to
/// Discord" that posts the message somewhere else is a step that lies about what it does.
pub fn chat_refusal(kind: &str, raw: &str) -> Option<&'static str> {
    let Ok(u) = reqwest::Url::parse(raw.trim()) else { return Some("invalid") };
    let host = u.host_str().unwrap_or("").to_ascii_lowercase();
    let path = u.path();
    match kind {
        "discord" => {
            if u.scheme() != "https" { return Some("not-https"); }
            let hosts = ["discord.com", "discordapp.com", "ptb.discord.com", "canary.discord.com"];
            if !hosts.contains(&host.as_str()) || !path.starts_with("/api/webhooks/") {
                return Some("not-discord");
            }
            None
        }
        "slack" => {
            if u.scheme() != "https" { return Some("not-https"); }
            let ok_path = ["/services/", "/workflows/", "/triggers/"].iter().any(|p| path.starts_with(p));
            if host != "hooks.slack.com" || !ok_path {
                return Some("not-slack");
            }
            None
        }
        _ => None,
    }
}

enum HostKind {
    Ip(IpAddr),
    Name(String),
}

/// The host of a URL: an address literal (IPv6 without its brackets) or a name.
fn host_kind(u: &reqwest::Url) -> Option<HostKind> {
    let h = u.host_str()?;
    let bare = h.trim_start_matches('[').trim_end_matches(']');
    if bare.is_empty() {
        return None;
    }
    Some(match bare.parse::<IpAddr>() {
        Ok(ip) => HostKind::Ip(ip),
        Err(_) => HostKind::Name(bare.to_string()),
    })
}

/// Resolve the URL's host and refuse it when any address is internal (unless the step allows
/// the local network). Returns the addresses the connection must be pinned to.
pub async fn resolve_checked(u: &reqwest::Url, allow_lan: bool) -> Result<Vec<SocketAddr>, String> {
    let port = u.port_or_known_default().unwrap_or(80);
    let addrs: Vec<SocketAddr> = match host_kind(u) {
        Some(HostKind::Ip(ip)) => vec![SocketAddr::new(ip, port)],
        Some(HostKind::Name(d)) => {
            if !allow_lan && name_is_local(&d) {
                return Err(refusal_text("private"));
            }
            match tokio::net::lookup_host((d.as_str(), port)).await {
                Ok(it) => it.collect(),
                Err(_) => return Err("sched.net.dns".to_string()),
            }
        }
        None => return Err(refusal_text("no-host")),
    };
    if addrs.is_empty() {
        return Err("sched.net.dns".to_string());
    }
    if !allow_lan && addrs.iter().any(|a| ip_is_internal(a.ip())) {
        return Err(refusal_text("private"));
    }
    Ok(addrs)
}

/// The code the frontend translates, with the reason after a bar: `sched.net.refused|private`.
fn refusal_text(why: &str) -> String {
    format!("sched.net.refused|{why}")
}

/// A reqwest error, without the URL it would otherwise carry (the URL can be the secret).
fn clean_err(e: reqwest::Error) -> String {
    if e.is_timeout() {
        return "sched.net.timeout".to_string();
    }
    if e.is_connect() {
        return "sched.net.connect".to_string();
    }
    format!("sched.net.error|{}", e.without_url())
}

/// One client per request, pinned to the addresses that were checked, with no proxy and no
/// automatic redirects. Building a client is cheap next to a TLS handshake, and a shared one
/// could not be pinned per host.
fn pinned_client(u: &reqwest::Url, addrs: &[SocketAddr], timeout: Duration) -> Result<reqwest::Client, String> {
    let mut b = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .no_proxy()
        .timeout(timeout)
        .connect_timeout(timeout.min(Duration::from_secs(10)));
    if let Some(HostKind::Name(d)) = host_kind(u) {
        b = b.resolve_to_addrs(&d, addrs);
    }
    b.build().map_err(|e| format!("sched.net.error|{}", e.without_url()))
}

/// Read at most `max` bytes of a body. `true` when there was more.
async fn read_prefix(mut resp: reqwest::Response, max: usize) -> Result<(Vec<u8>, bool), String> {
    let mut out: Vec<u8> = Vec::new();
    while let Some(chunk) = resp.chunk().await.map_err(clean_err)? {
        let room = max.saturating_sub(out.len());
        if chunk.len() > room {
            out.extend_from_slice(&chunk[..room]);
            return Ok((out, true));
        }
        out.extend_from_slice(&chunk);
    }
    Ok((out, false))
}

fn excerpt(bytes: &[u8]) -> String {
    let text = String::from_utf8_lossy(bytes);
    let t = text.trim();
    if t.chars().count() > EXCERPT_CHARS {
        let cut: String = t.chars().take(EXCERPT_CHARS).collect();
        format!("{cut}…")
    } else {
        t.to_string()
    }
}

fn timeout_of(ms: Option<u64>) -> Duration {
    Duration::from_millis(ms.unwrap_or(15_000).clamp(1_000, 60_000))
}

// ── Webhooks ─────────────────────────────────────────────────────────────────────────────────

/// What a webhook step sends. `secret_headers` are headers like any other on the wire; they
/// are separate so nothing on the way (an error, a log, the debugger) can ever show them.
#[derive(Deserialize, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct WebhookReq {
    pub url: String,
    #[serde(default)]
    pub method: Option<String>,
    #[serde(default)]
    pub headers: HashMap<String, String>,
    #[serde(default)]
    pub secret_headers: HashMap<String, String>,
    #[serde(default)]
    pub body: Option<String>,
    #[serde(default)]
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub allow_lan: Option<bool>,
    /// Extra attempts after a failure worth retrying (a transport error, 429, 5xx). 0–4.
    #[serde(default)]
    pub retries: Option<u32>,
    /// `discord` / `slack` pin the host and path; anything else is a generic webhook.
    #[serde(default)]
    pub kind: Option<String>,
}

#[derive(Serialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WebhookReply {
    pub status: u16,
    pub ok: bool,
    pub attempts: u32,
    pub ms: u64,
    pub excerpt: String,
    pub truncated: bool,
}

/// Is this outcome worth another attempt? A transport failure, "slow down", or the server's
/// own fault. A 4xx is the request being wrong, and sending it again is sending it wrong again.
fn worth_retrying(status: Option<u16>) -> bool {
    match status {
        None => true,
        Some(s) => s == 429 || s == 408 || (500..600).contains(&s),
    }
}

fn header_map(req: &WebhookReq) -> Result<reqwest::header::HeaderMap, String> {
    let mut map = reqwest::header::HeaderMap::new();
    for (k, v) in req.headers.iter().chain(req.secret_headers.iter()) {
        let k = k.trim();
        if k.is_empty() {
            continue;
        }
        let name = reqwest::header::HeaderName::from_bytes(k.as_bytes())
            .map_err(|_| format!("sched.net.badHeader|{k}"))?;
        // The value is never quoted back: a secret header's value is the secret, and an
        // ordinary one may be an Authorization line somebody did not mark.
        let mut value = reqwest::header::HeaderValue::from_str(v.trim())
            .map_err(|_| format!("sched.net.badHeader|{k}"))?;
        if req.secret_headers.contains_key(k) {
            value.set_sensitive(true);
        }
        map.insert(name, value);
    }
    if !map.contains_key(reqwest::header::CONTENT_TYPE) {
        if let Some(b) = req.body.as_deref().filter(|b| !b.trim().is_empty()) {
            let ct = if serde_json::from_str::<serde_json::Value>(b).is_ok() {
                "application/json"
            } else {
                "text/plain; charset=utf-8"
            };
            map.insert(reqwest::header::CONTENT_TYPE, reqwest::header::HeaderValue::from_static(ct));
        }
    }
    Ok(map)
}

/// Send a webhook. The status is returned, not raised, so a step can branch on it; the step
/// decides what counts as failure.
pub async fn send_webhook(req: WebhookReq) -> Result<WebhookReply, String> {
    let url = req.url.trim().to_string();
    if let Some(why) = url_refusal(&url) {
        return Err(refusal_text(why));
    }
    if let Some(kind) = req.kind.as_deref() {
        if let Some(why) = chat_refusal(kind, &url) {
            return Err(refusal_text(why));
        }
    }
    let method = match req.method.as_deref().unwrap_or("POST").trim().to_ascii_uppercase().as_str() {
        "POST" => reqwest::Method::POST,
        "PUT" => reqwest::Method::PUT,
        "PATCH" => reqwest::Method::PATCH,
        _ => return Err("sched.net.method".to_string()),
    };
    let headers = header_map(&req)?;
    let u = reqwest::Url::parse(&url).map_err(|_| refusal_text("invalid"))?;
    let allow_lan = req.allow_lan == Some(true);
    let timeout = timeout_of(req.timeout_ms);
    let tries = 1 + req.retries.unwrap_or(0).min(4);
    let t0 = Instant::now();
    let mut last_err = String::new();
    for attempt in 1..=tries {
        // Resolved and checked on EVERY attempt: a name that changed its answer between two
        // attempts is exactly the rebinding case.
        let addrs = resolve_checked(&u, allow_lan).await?;
        let client = pinned_client(&u, &addrs, timeout)?;
        let mut rb = client
            .request(method.clone(), u.clone())
            .header(reqwest::header::USER_AGENT, "BetterModsManager/1.0")
            .headers(headers.clone());
        if let Some(b) = req.body.as_ref() {
            rb = rb.body(b.clone());
        }
        match rb.send().await {
            Ok(resp) => {
                let status = resp.status().as_u16();
                let (bytes, truncated) = read_prefix(resp, WEBHOOK_MAX_BYTES).await?;
                if attempt < tries && worth_retrying(Some(status)) {
                    tokio::time::sleep(backoff(attempt)).await;
                    continue;
                }
                return Ok(WebhookReply {
                    status,
                    ok: (200..300).contains(&status),
                    attempts: attempt,
                    ms: t0.elapsed().as_millis() as u64,
                    excerpt: excerpt(&bytes),
                    truncated,
                });
            }
            Err(e) => {
                last_err = clean_err(e);
                if attempt < tries {
                    tokio::time::sleep(backoff(attempt)).await;
                    continue;
                }
            }
        }
    }
    Err(last_err)
}

fn backoff(attempt: u32) -> Duration {
    Duration::from_millis((500u64 << attempt.min(4)).min(8_000))
}

#[tauri::command]
pub async fn sched_webhook(req: WebhookReq) -> Result<WebhookReply, String> {
    send_webhook(req).await
}

// ── Feeds: reading ───────────────────────────────────────────────────────────────────────────

/// One item of an RSS or Atom feed, as a trigger needs it.
#[derive(Serialize, Debug, Clone, PartialEq)]
pub struct FeedItem {
    /// What identifies it: the guid / id, else the link, else the title.
    pub id: String,
    pub title: String,
    pub link: String,
    pub published: String,
}

/// GET a URL under the network rules, following redirects hop by hop.
async fn get_checked(url: &str, allow_lan: bool, timeout: Duration, max: usize) -> Result<(u16, Vec<u8>), String> {
    if let Some(why) = url_refusal(url) {
        return Err(refusal_text(why));
    }
    let mut u = reqwest::Url::parse(url.trim()).map_err(|_| refusal_text("invalid"))?;
    for _ in 0..=MAX_REDIRECTS {
        let addrs = resolve_checked(&u, allow_lan).await?;
        let client = pinned_client(&u, &addrs, timeout)?;
        let resp = client
            .get(u.clone())
            .header(reqwest::header::USER_AGENT, "BetterModsManager/1.0")
            .header(reqwest::header::ACCEPT, "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5")
            .send()
            .await
            .map_err(clean_err)?;
        let status = resp.status();
        if status.is_redirection() {
            let loc = resp
                .headers()
                .get(reqwest::header::LOCATION)
                .and_then(|v| v.to_str().ok())
                .ok_or_else(|| "sched.net.redirect".to_string())?;
            let next = u.join(loc).map_err(|_| "sched.net.redirect".to_string())?;
            if let Some(why) = url_refusal(next.as_str()) {
                return Err(refusal_text(why));
            }
            u = next;
            continue;
        }
        if resp.content_length().is_some_and(|n| n as usize > max) {
            return Err("sched.net.tooLarge".to_string());
        }
        let (bytes, truncated) = read_prefix(resp, max).await?;
        if truncated {
            return Err("sched.net.tooLarge".to_string());
        }
        return Ok((status.as_u16(), bytes));
    }
    Err("sched.net.redirect".to_string())
}

fn re(p: &str) -> regex::Regex {
    regex::Regex::new(p).expect("static pattern")
}

/// Unwrap CDATA, decode the five entities and numeric references, drop tags, squeeze spaces.
pub fn xml_text(raw: &str) -> String {
    let mut s = raw.trim().to_string();
    if let (Some(a), Some(b)) = (s.find("<![CDATA["), s.rfind("]]>")) {
        if a < b {
            s = format!("{}{}{}", &s[..a], &s[a + 9..b], &s[b + 3..]);
        }
    }
    let tags = re(r"<[^>]*>");
    let s = tags.replace_all(&s, " ").to_string();
    let num = re(r"&#(x[0-9A-Fa-f]{1,6}|[0-9]{1,7});");
    let s = num
        .replace_all(&s, |c: &regex::Captures| {
            let v = &c[1];
            let n = if let Some(h) = v.strip_prefix('x') { u32::from_str_radix(h, 16).ok() } else { v.parse::<u32>().ok() };
            n.and_then(char::from_u32).map(|ch| ch.to_string()).unwrap_or_default()
        })
        .to_string();
    let s = s
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&amp;", "&");
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn first(block: &str, pattern: &str) -> Option<String> {
    re(pattern).captures(block).and_then(|c| c.get(1)).map(|m| xml_text(m.as_str())).filter(|s| !s.is_empty())
}

/// The items of an RSS 2.0 / RSS 1.0 / Atom document, newest as the feed orders them.
///
/// A pattern reader, not an XML parser: a trigger needs four fields per item and the `regex`
/// crate runs in linear time, so a hostile feed cannot make this slow. What a real parser
/// would add is strictness, and a feed reader that refuses slightly broken feeds is one that
/// misses the items people wanted.
pub fn parse_feed(xml: &str) -> Vec<FeedItem> {
    let item = re(r"(?is)<(?:[a-z0-9]+:)?(item|entry)\b[^>]*>(.*?)</(?:[a-z0-9]+:)?(?:item|entry)\s*>");
    let mut out = Vec::new();
    for c in item.captures_iter(xml) {
        let block = c.get(2).map(|m| m.as_str()).unwrap_or("");
        let title = first(block, r"(?is)<title\b[^>]*>(.*?)</title\s*>").unwrap_or_default();
        // Atom: <link href="…"/> (the alternate one when several); RSS: <link>…</link>.
        let link = re(r#"(?is)<link\b([^>]*)/?>"#)
            .captures_iter(block)
            .filter_map(|l| {
                let attrs = l.get(1)?.as_str();
                let href = re(r#"href\s*=\s*["']([^"']+)["']"#).captures(attrs)?.get(1)?.as_str().to_string();
                let rel = re(r#"rel\s*=\s*["']([^"']+)["']"#).captures(attrs).and_then(|r| r.get(1)).map(|r| r.as_str().to_string());
                Some((rel, href))
            })
            .min_by_key(|(rel, _)| match rel.as_deref() { None | Some("alternate") => 0, _ => 1 })
            .map(|(_, h)| xml_text(&h))
            .or_else(|| first(block, r"(?is)<link\b[^>]*>(.*?)</link\s*>"))
            .unwrap_or_default();
        let id = first(block, r"(?is)<guid\b[^>]*>(.*?)</guid\s*>")
            .or_else(|| first(block, r"(?is)<id\b[^>]*>(.*?)</id\s*>"))
            .unwrap_or_else(|| if link.is_empty() { title.clone() } else { link.clone() });
        let published = first(block, r"(?is)<pubDate\b[^>]*>(.*?)</pubDate\s*>")
            .or_else(|| first(block, r"(?is)<published\b[^>]*>(.*?)</published\s*>"))
            .or_else(|| first(block, r"(?is)<updated\b[^>]*>(.*?)</updated\s*>"))
            .or_else(|| first(block, r"(?is)<dc:date\b[^>]*>(.*?)</dc:date\s*>"))
            .unwrap_or_default();
        if id.is_empty() {
            continue;
        }
        out.push(FeedItem {
            id: id.chars().take(500).collect(),
            title: title.chars().take(500).collect(),
            link: if safe_link(&link) { link.chars().take(2000).collect() } else { String::new() },
            published: published.chars().take(80).collect(),
        });
        if out.len() >= FEED_MAX_ITEMS {
            break;
        }
    }
    out
}

/// A link a task may put in a variable or a feed: http(s) or nothing. A `javascript:` link
/// from a stranger's feed must not become something a later step opens.
pub fn safe_link(link: &str) -> bool {
    let l = link.trim().to_ascii_lowercase();
    l.starts_with("https://") || l.starts_with("http://")
}

pub async fn fetch_feed(url: &str, allow_lan: bool, timeout_ms: Option<u64>) -> Result<Vec<FeedItem>, String> {
    let (status, bytes) = get_checked(url, allow_lan, timeout_of(timeout_ms), FEED_MAX_BYTES).await?;
    if !(200..300).contains(&status) {
        return Err(format!("sched.net.status|{status}"));
    }
    let text = String::from_utf8_lossy(&bytes);
    let lower = text.chars().take(4096).collect::<String>().to_ascii_lowercase();
    if !(lower.contains("<rss") || lower.contains("<feed") || lower.contains("<rdf")) {
        return Err("sched.feed.notFeed".to_string());
    }
    Ok(parse_feed(&text))
}

/// Read a feed for the `rss` trigger (and for the Test button of one).
#[tauri::command]
pub async fn sched_feed_fetch(url: String, allow_lan: Option<bool>, timeout_ms: Option<u64>) -> Result<Vec<FeedItem>, String> {
    fetch_feed(&url, allow_lan == Some(true), timeout_ms).await
}

// ── Feeds: writing ───────────────────────────────────────────────────────────────────────────

/// Escape text for an XML element or attribute.
pub fn xml_escape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&apos;"),
            // XML 1.0 has no representation for most control characters, escaped or not.
            c if (c as u32) < 0x20 && c != '\n' && c != '\r' && c != '\t' => {}
            c => out.push(c),
        }
    }
    out
}

/// The generator line that marks a file as one BMM keeps. A file without it is somebody
/// else's and is never rewritten.
const GENERATOR: &str = "<generator>BetterModsManager</generator>";

pub struct FeedEntry<'a> {
    pub title: &'a str,
    pub body: &'a str,
    pub link: &'a str,
    pub id: &'a str,
}

/// The feed file with `entry` added at the top, keeping at most `max` entries.
pub fn feed_with_entry(existing: Option<&str>, feed_title: &str, feed_id: &str, entry: FeedEntry, now: &str, max: usize) -> Result<String, String> {
    let mut kept: Vec<String> = Vec::new();
    if let Some(old) = existing.filter(|s| !s.trim().is_empty()) {
        if !old.contains(GENERATOR) {
            return Err("task.feed.notOurs".to_string());
        }
        for m in re(r"(?s)<entry>.*?</entry>").find_iter(old) {
            kept.push(m.as_str().to_string());
        }
    }
    let title: String = entry.title.chars().take(300).collect();
    let body: String = entry.body.chars().take(20_000).collect();
    let link = if safe_link(entry.link) { format!("\n    <link href=\"{}\"/>", xml_escape(entry.link.trim())) } else { String::new() };
    let fresh = format!(
        "<entry>\n    <title>{}</title>\n    <id>{}</id>\n    <updated>{}</updated>{}\n    <content type=\"text\">{}</content>\n  </entry>",
        xml_escape(if title.trim().is_empty() { "(untitled)" } else { title.trim() }),
        xml_escape(entry.id),
        xml_escape(now),
        link,
        xml_escape(&body),
    );
    let max = max.clamp(1, 500);
    let mut entries = vec![fresh];
    entries.extend(kept.into_iter().take(max - 1));
    Ok(format!(
        "<?xml version=\"1.0\" encoding=\"utf-8\"?>\n<feed xmlns=\"http://www.w3.org/2005/Atom\">\n  <title>{}</title>\n  <id>{}</id>\n  <updated>{}</updated>\n  {}\n  {}\n</feed>\n",
        xml_escape(if feed_title.trim().is_empty() { "BMM task feed" } else { feed_title.trim() }),
        xml_escape(feed_id),
        xml_escape(now),
        GENERATOR,
        entries.join("\n  "),
    ))
}

/// Add an entry to a task's own Atom feed. The path follows `task_write_file`'s rule: relative
/// lands in the task's output folder and may not climb out of it.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn task_feed_append(
    app: tauri::AppHandle,
    state: tauri::State<'_, crate::state::AppState>,
    task_id: String,
    output_dir: Option<String>,
    path: Option<String>,
    feed_title: Option<String>,
    title: String,
    body: Option<String>,
    link: Option<String>,
    max_entries: Option<u32>,
) -> Result<String, String> {
    let root = match output_dir.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        Some(d) if crate::commands::bmm_paths_core::parse_spec(d).is_some() => std::path::PathBuf::from(
            crate::commands::bmm_paths_core::resolve_with(&crate::commands::bmm_paths::roots_now(&app, &state), d)?,
        ),
        Some(d) => std::path::PathBuf::from(d),
        None => crate::commands::task_output::default_output_dir(&app, &task_id)?,
    };
    let rel = path.as_deref().map(str::trim).filter(|s| !s.is_empty()).unwrap_or("feed.xml").to_string();
    if let Some(why) = crate::commands::link_guard::path_refusal(&rel).filter(|w| *w == "network" || *w == "invalid") {
        return Err(format!("task.feed.badPath|{why}"));
    }
    let dest = crate::commands::task_output::destination(&root, &rel)?;
    let now = chrono::Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Secs, true);
    let stamp = chrono::Utc::now().timestamp_millis();
    let feed_id = format!("urn:bmm:feed:{}:{}", crate::commands::plugin_assets_core::safe_component(&task_id), crate::commands::plugin_assets_core::safe_component(&rel));
    let entry_id = format!("urn:bmm:entry:{}:{}", crate::commands::plugin_assets_core::safe_component(&task_id), stamp);
    let feed_title = feed_title.unwrap_or_default();
    let body = body.unwrap_or_default();
    let link = link.unwrap_or_default();
    let max = max_entries.unwrap_or(50) as usize;
    tauri::async_runtime::spawn_blocking(move || -> Result<String, String> {
        let existing = std::fs::read_to_string(&dest).ok();
        let xml = feed_with_entry(
            existing.as_deref(),
            &feed_title,
            &feed_id,
            FeedEntry { title: &title, body: &body, link: &link, id: &entry_id },
            &now,
            max,
        )?;
        if let Some(parent) = dest.parent() {
            std::fs::create_dir_all(parent).map_err(|e| format!("task.out.errWrite|{}", e))?;
        }
        // Written beside and renamed over, so a reader polling the feed never sees half of it.
        let tmp = dest.with_extension("xml.part");
        std::fs::write(&tmp, xml.as_bytes()).map_err(|e| format!("task.out.errWrite|{}", e))?;
        std::fs::rename(&tmp, &dest).map_err(|e| format!("task.out.errWrite|{}", e))?;
        Ok(dest.to_string_lossy().to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    fn ip(s: &str) -> IpAddr {
        s.parse().unwrap()
    }

    #[test]
    fn internal_addresses_are_recognised_in_every_spelling() {
        for s in [
            "127.0.0.1", "10.1.2.3", "172.16.0.1", "172.31.255.255", "192.168.1.10", "169.254.169.254",
            "100.64.0.1", "100.127.255.255", "0.0.0.0", "0.1.2.3", "255.255.255.255", "224.0.0.1",
            "198.18.0.1", "192.0.0.8", "240.0.0.1", "192.0.2.1",
            "::1", "::", "fc00::1", "fd12:3456::1", "fe80::1", "fec0::1", "ff02::1", "2001:db8::1",
            "::ffff:127.0.0.1", "::ffff:10.0.0.1", "64:ff9b::7f00:1", "::127.0.0.1",
        ] {
            assert!(ip_is_internal(ip(s)), "{s} must be internal");
        }
    }

    #[test]
    fn public_addresses_pass() {
        for s in ["1.1.1.1", "8.8.8.8", "93.184.216.34", "100.128.0.1", "172.32.0.1", "2606:4700::1111", "::ffff:8.8.8.8", "64:ff9b::808:808"] {
            assert!(!ip_is_internal(ip(s)), "{s} must pass");
        }
    }

    #[test]
    fn only_plain_http_addresses_are_requested() {
        assert_eq!(url_refusal("file:///etc/passwd"), Some("not-http"));
        assert_eq!(url_refusal("ftp://x.example/a"), Some("not-http"));
        assert_eq!(url_refusal("javascript:alert(1)"), Some("not-http"));
        assert_eq!(url_refusal("https://user:pw@example.com/"), Some("credentials"));
        assert_eq!(url_refusal("https://exa mple.com/"), Some("invalid"));
        assert_eq!(url_refusal(""), Some("empty"));
        assert_eq!(url_refusal("https://example.com/hook?x=1"), None);
        assert_eq!(url_refusal("http://example.com:8080/"), None);
    }

    #[test]
    fn a_chat_webhook_must_be_the_service_it_names() {
        assert_eq!(chat_refusal("discord", "https://discord.com/api/webhooks/1/abc"), None);
        assert_eq!(chat_refusal("discord", "https://discordapp.com/api/webhooks/1/abc"), None);
        assert_eq!(chat_refusal("discord", "http://discord.com/api/webhooks/1/abc"), Some("not-https"));
        assert_eq!(chat_refusal("discord", "https://evil.example/api/webhooks/1/abc"), Some("not-discord"));
        assert_eq!(chat_refusal("discord", "https://discord.com.evil.example/api/webhooks/1"), Some("not-discord"));
        assert_eq!(chat_refusal("slack", "https://hooks.slack.com/services/T/B/x"), None);
        assert_eq!(chat_refusal("slack", "https://hooks.slack.com/other"), Some("not-slack"));
        assert_eq!(chat_refusal("webhook", "https://anything.example/"), None);
    }

    /// A server that answers `n` connections in turn, each with the next canned response,
    /// and hands back what each request looked like.
    fn serve(responses: Vec<String>) -> (u16, std::thread::JoinHandle<Vec<String>>) {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind");
        let port = listener.local_addr().unwrap().port();
        let h = std::thread::spawn(move || {
            let mut seen = Vec::new();
            for resp in responses {
                let Ok((mut sock, _)) = listener.accept() else { break };
                sock.set_read_timeout(Some(Duration::from_secs(5))).ok();
                let mut buf = vec![0u8; 65536];
                let mut got = Vec::new();
                // Read until the headers are in and the declared body has arrived.
                loop {
                    let n = sock.read(&mut buf).unwrap_or(0);
                    if n == 0 { break; }
                    got.extend_from_slice(&buf[..n]);
                    let text = String::from_utf8_lossy(&got).to_string();
                    if let Some(hend) = text.find("\r\n\r\n") {
                        let len = text[..hend].lines()
                            .find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap_or(0)))
                            .unwrap_or(0);
                        if got.len() >= hend + 4 + len { break; }
                    }
                }
                seen.push(String::from_utf8_lossy(&got).to_string());
                let _ = sock.write_all(resp.as_bytes());
                let _ = sock.flush();
            }
            seen
        });
        (port, h)
    }

    fn http(status: &str, body: &str) -> String {
        format!("HTTP/1.1 {status}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len())
    }

    fn req(url: String) -> WebhookReq {
        WebhookReq { url, allow_lan: Some(true), timeout_ms: Some(5_000), ..Default::default() }
    }

    #[tokio::test]
    async fn a_webhook_posts_its_body_and_headers_and_reports_the_answer() {
        let (port, seen) = serve(vec![http("201 Created", "{\"ok\":true}")]);
        let mut r = req(format!("http://127.0.0.1:{port}/hook"));
        r.body = Some("{\"text\":\"hello\"}".into());
        r.headers.insert("X-Plain".into(), "one".into());
        r.secret_headers.insert("Authorization".into(), "Bearer s3cr3t-value".into());
        let out = send_webhook(r).await.expect("sent");
        assert_eq!(out.status, 201);
        assert!(out.ok);
        assert_eq!(out.attempts, 1);
        assert_eq!(out.excerpt, "{\"ok\":true}");
        let got = seen.join().unwrap().remove(0).to_ascii_lowercase();
        assert!(got.starts_with("post /hook "), "{got}");
        assert!(got.contains("x-plain: one"), "{got}");
        assert!(got.contains("authorization: bearer s3cr3t-value"), "the secret header is SENT: {got}");
        assert!(got.contains("content-type: application/json"), "{got}");
        assert!(got.contains("{\"text\":\"hello\"}"), "{got}");
    }

    #[tokio::test]
    async fn a_private_address_is_refused_unless_the_step_allows_the_lan() {
        // No server: the refusal must come before any socket is opened.
        let mut r = req("http://127.0.0.1:9/hook".into());
        r.allow_lan = Some(false);
        let err = send_webhook(r).await.expect_err("loopback must be refused");
        assert_eq!(err, "sched.net.refused|private");
        let mut r = req("http://localhost:9/hook".into());
        r.allow_lan = None;
        assert_eq!(send_webhook(r).await.unwrap_err(), "sched.net.refused|private");
        let mut r = req("http://[::1]:9/hook".into());
        r.allow_lan = Some(false);
        assert_eq!(send_webhook(r).await.unwrap_err(), "sched.net.refused|private");
        let mut r = req("http://169.254.169.254/latest/meta-data/".into());
        r.allow_lan = Some(false);
        assert_eq!(send_webhook(r).await.unwrap_err(), "sched.net.refused|private");
    }

    #[tokio::test]
    async fn a_server_error_is_retried_and_a_client_error_is_not() {
        let (port, seen) = serve(vec![http("503 Service Unavailable", "busy"), http("200 OK", "fine")]);
        let mut r = req(format!("http://127.0.0.1:{port}/hook"));
        r.retries = Some(2);
        let out = send_webhook(r).await.expect("sent");
        assert_eq!((out.status, out.attempts), (200, 2));
        assert_eq!(seen.join().unwrap().len(), 2);

        let (port, seen) = serve(vec![http("400 Bad Request", "no")]);
        let mut r = req(format!("http://127.0.0.1:{port}/hook"));
        r.retries = Some(3);
        let out = send_webhook(r).await.expect("an answer, not an error");
        assert_eq!((out.status, out.attempts, out.ok), (400, 1, false));
        assert_eq!(seen.join().unwrap().len(), 1);
    }

    #[tokio::test]
    async fn a_large_answer_is_cut_not_swallowed() {
        let big = "x".repeat(WEBHOOK_MAX_BYTES + 5000);
        let (port, _seen) = serve(vec![http("200 OK", &big)]);
        let out = send_webhook(req(format!("http://127.0.0.1:{port}/hook"))).await.expect("sent");
        assert!(out.truncated);
        assert!(out.excerpt.chars().count() <= EXCERPT_CHARS + 1);
    }

    #[tokio::test]
    async fn a_silent_server_times_out() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let _keep = std::thread::spawn(move || {
            let _c = listener.accept();
            std::thread::sleep(Duration::from_secs(4));
        });
        let mut r = req(format!("http://127.0.0.1:{port}/hook"));
        r.timeout_ms = Some(1_000);
        let t0 = Instant::now();
        let err = send_webhook(r).await.expect_err("must time out");
        assert_eq!(err, "sched.net.timeout");
        assert!(t0.elapsed() < Duration::from_secs(3), "the timeout is honoured");
    }

    #[tokio::test]
    async fn an_error_never_carries_the_address_or_a_header_value() {
        // Nothing listens on port 9 of loopback: a connect error, whose reqwest text would
        // include the URL — and the URL's query is where the token sits.
        let mut r = req("http://127.0.0.1:9/hook?token=TOPSECRET123".into());
        r.secret_headers.insert("X-Key".into(), "ALSOSECRET".into());
        let err = send_webhook(r).await.expect_err("nothing listens");
        assert!(!err.contains("TOPSECRET123") && !err.contains("ALSOSECRET") && !err.contains("127.0.0.1"), "{err}");
        let mut r = req("http://127.0.0.1:9/hook".into());
        r.secret_headers.insert("X-Key".into(), "bad\nvalue-SECRET".into());
        let err = send_webhook(r).await.expect_err("a bad header value");
        assert_eq!(err, "sched.net.badHeader|X-Key");
    }

    #[tokio::test]
    async fn a_chat_step_refuses_an_address_that_is_not_its_service() {
        let mut r = req("https://example.com/api/webhooks/1/x".into());
        r.kind = Some("discord".into());
        assert_eq!(send_webhook(r).await.unwrap_err(), "sched.net.refused|not-discord");
    }

    const RSS: &str = r#"<?xml version="1.0"?><rss version="2.0"><channel><title>Mods</title>
        <item><title>Version 2 &amp; more</title><link>https://example.com/v2</link><guid isPermaLink="false">v2</guid><pubDate>Sat, 26 Sep 2026 10:00:00 GMT</pubDate></item>
        <item><title><![CDATA[Version <b>1</b>]]></title><link>javascript:alert(1)</link><guid>v1</guid></item>
    </channel></rss>"#;

    const ATOM: &str = r#"<feed xmlns="http://www.w3.org/2005/Atom"><title>T</title>
        <entry><title type="html">Release &#8212; 3.0</title><link rel="self" href="https://x.example/self"/><link href="https://x.example/3"/><id>tag:x,3</id><updated>2026-09-26T00:00:00Z</updated></entry>
    </feed>"#;

    #[test]
    fn rss_and_atom_items_are_read() {
        let items = parse_feed(RSS);
        assert_eq!(items.len(), 2);
        assert_eq!(items[0], FeedItem { id: "v2".into(), title: "Version 2 & more".into(), link: "https://example.com/v2".into(), published: "Sat, 26 Sep 2026 10:00:00 GMT".into() });
        assert_eq!(items[1].title, "Version 1");
        assert_eq!(items[1].link, "", "a javascript: link is dropped");
        let a = parse_feed(ATOM);
        assert_eq!(a.len(), 1);
        assert_eq!(a[0].id, "tag:x,3");
        assert_eq!(a[0].title, "Release \u{2014} 3.0");
        assert_eq!(a[0].link, "https://x.example/3", "the alternate link, not rel=self");
    }

    #[test]
    fn a_hostile_feed_is_read_in_linear_time() {
        // Forty thousand unclosed items: a backtracking reader would be quadratic here.
        let evil = format!("<rss>{}</rss>", "<item><title>a".repeat(40_000));
        let t0 = Instant::now();
        let items = parse_feed(&evil);
        assert!(items.is_empty());
        assert!(t0.elapsed() < Duration::from_secs(2), "took {:?}", t0.elapsed());
    }

    #[tokio::test]
    async fn a_feed_is_fetched_from_a_local_server_when_the_lan_is_allowed() {
        let (port, _seen) = serve(vec![http("200 OK", RSS)]);
        let items = fetch_feed(&format!("http://127.0.0.1:{port}/feed.xml"), true, Some(5_000)).await.expect("read");
        assert_eq!(items.iter().map(|i| i.id.as_str()).collect::<Vec<_>>(), ["v2", "v1"]);
        // …and refused when it is not.
        let err = fetch_feed(&format!("http://127.0.0.1:{port}/feed.xml"), false, Some(5_000)).await.unwrap_err();
        assert_eq!(err, "sched.net.refused|private");
    }

    #[tokio::test]
    async fn a_redirect_is_followed_and_each_hop_is_checked() {
        let (p2, _s2) = serve(vec![http("200 OK", ATOM)]);
        let redirect = format!("HTTP/1.1 302 Found\r\nLocation: http://127.0.0.1:{p2}/atom\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
        let (p1, _s1) = serve(vec![redirect]);
        let items = fetch_feed(&format!("http://127.0.0.1:{p1}/feed"), true, Some(5_000)).await.expect("followed");
        assert_eq!(items[0].id, "tag:x,3");
        let bad = "HTTP/1.1 302 Found\r\nLocation: file:///etc/passwd\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_string();
        let (p3, _s3) = serve(vec![bad]);
        let err = fetch_feed(&format!("http://127.0.0.1:{p3}/feed"), true, Some(5_000)).await.unwrap_err();
        assert_eq!(err, "sched.net.refused|not-http");
    }

    #[tokio::test]
    async fn a_feed_over_the_cap_or_not_a_feed_is_refused() {
        let big = format!("<rss>{}</rss>", "x".repeat(FEED_MAX_BYTES + 10));
        let (port, _s) = serve(vec![http("200 OK", &big)]);
        assert_eq!(fetch_feed(&format!("http://127.0.0.1:{port}/f"), true, Some(10_000)).await.unwrap_err(), "sched.net.tooLarge");
        let (port, _s) = serve(vec![http("200 OK", "<html>hello</html>")]);
        assert_eq!(fetch_feed(&format!("http://127.0.0.1:{port}/f"), true, Some(5_000)).await.unwrap_err(), "sched.feed.notFeed");
    }

    #[test]
    fn a_task_feed_grows_at_the_top_and_is_capped() {
        let e = |t: &'static str, id: &'static str| FeedEntry { title: t, body: "b", link: "https://x.example/r", id };
        let one = feed_with_entry(None, "My feed", "urn:f", e("first <run>", "urn:1"), "2026-09-26T00:00:00Z", 2).unwrap();
        assert!(one.contains("<title>first &lt;run&gt;</title>"), "{one}");
        assert!(one.contains(GENERATOR));
        let two = feed_with_entry(Some(&one), "My feed", "urn:f", e("second", "urn:2"), "2026-09-26T00:01:00Z", 2).unwrap();
        let three = feed_with_entry(Some(&two), "My feed", "urn:f", e("third", "urn:3"), "2026-09-26T00:02:00Z", 2).unwrap();
        let ids: Vec<&str> = re(r"<id>(urn:\d)</id>").captures_iter(&three).map(|c| c.get(1).unwrap().as_str()).collect();
        assert_eq!(ids, ["urn:3", "urn:2"], "newest first, capped at 2");
        // Every item this writes is one the reader above can read back.
        assert_eq!(parse_feed(&three)[0].title, "third");
    }

    #[test]
    fn somebody_elses_file_is_never_rewritten_and_a_script_link_is_dropped() {
        assert_eq!(
            feed_with_entry(Some("<html>my page</html>"), "t", "urn:f", FeedEntry { title: "x", body: "", link: "", id: "urn:1" }, "now", 5).unwrap_err(),
            "task.feed.notOurs"
        );
        let x = feed_with_entry(None, "t", "urn:f", FeedEntry { title: "x", body: "", link: "javascript:alert(1)", id: "urn:1" }, "now", 5).unwrap();
        assert!(!x.contains("javascript"), "{x}");
    }
}
