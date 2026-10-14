//! What the user typed as a repo address, turned into the repo.json URL BMM fetches.
//!
//! People reach a repo the way they reach any machine on their network: by its IP and a
//! port. `192.168.1.20:8000`, `http://192.168.1.20:8000/repo.json`, `[::1]:8000`,
//! `nas.local:8080/mods/` and a bare `myserver` are all the same request — "the repo.json
//! there". [`normalize_repo_input`] turns each into one URL, and says what kind of host it is
//! so the page can explain the transport plainly:
//!
//!  - **https**: nothing to say;
//!  - **http to this machine or the local network**: fine, and said once (« on your network,
//!    plain http is normal »). A LAN repo almost never has a certificate, and refusing http
//!    there would refuse the commonest self-hosted setup;
//!  - **http to the internet**: allowed (many public repos are plain http) with a warning:
//!    a download password crosses the internet readable.
//!
//! # Why there is no private-address block here
//!
//! BMM has SSRF guards, and they stay exactly as they are. They exist for URLs that did NOT
//! come from the person at the keyboard: a scheduled task's webhook or feed (`sched_net`), a
//! task that may have arrived in a shared `.bmmpa`; an AI endpoint (`ai_core`); a custom
//! page's redirects (`custom_pages`). There a private address means "something shared with
//! you is reaching into your network", and refusing it is the point.
//!
//! A repo address is the opposite case: the user typed it, to reach their own server. None
//! of those guards sits on the repo path (`fetch_repo_info`, the follow check) and none is
//! added. What DID get in the way of a typed LAN address was the system proxy: reqwest
//! honours it, and a proxy cannot reach `192.168.1.20`. [`client_builder`] therefore goes
//! direct for loopback and LAN hosts, and keeps the proxy for the internet.

use std::net::IpAddr;

/// Where the host is, as far as the address alone says.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HostKind {
    /// This machine: 127.0.0.0/8, ::1, `localhost`.
    Loopback,
    /// The local network: RFC 1918, link-local, CGNAT, ULA, a `.local` / `.lan` name, a
    /// single-label name (`nas`).
    Lan,
    /// Anything else.
    Public,
}

/// A repo address, normalised.
#[derive(Debug, Clone, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RepoAddr {
    /// The URL BMM fetches: always ends in `repo.json`.
    pub manifest_url: String,
    /// The same without `/repo.json`: what the lists show and store.
    pub base_url: String,
    pub scheme: String,
    /// Without brackets for IPv6.
    pub host: String,
    /// Only when the address names one.
    pub port: Option<u16>,
    pub kind: HostKind,
    /// `None` (https), `"lanHttp"` (plain http on this machine or the LAN: normal) or
    /// `"publicHttp"` (plain http over the internet: a password would travel readable).
    /// The page turns it into `repo.addr.<note>`.
    pub note: Option<&'static str>,
}

/// Classify an IP. Loopback first, then everything an SSRF guard calls internal.
pub fn ip_kind(ip: IpAddr) -> HostKind {
    let loopback = match ip {
        IpAddr::V4(v4) => v4.is_loopback(),
        IpAddr::V6(v6) => v6.is_loopback() || v6.to_ipv4_mapped().map(|v4| v4.is_loopback()).unwrap_or(false),
    };
    if loopback {
        HostKind::Loopback
    } else if crate::commands::sched_net::ip_is_internal(ip) {
        HostKind::Lan
    } else {
        HostKind::Public
    }
}

/// Classify a host as written in a URL (an IPv6 literal may keep its brackets).
pub fn host_kind(host: &str) -> HostKind {
    let h = host.trim().trim_start_matches('[').trim_end_matches(']').trim_end_matches('.').to_ascii_lowercase();
    if let Ok(ip) = h.parse::<IpAddr>() {
        return ip_kind(ip);
    }
    if h == "localhost" || h.ends_with(".localhost") {
        return HostKind::Loopback;
    }
    const LAN_SUFFIXES: [&str; 6] = [".local", ".lan", ".home", ".internal", ".home.arpa", ".intranet"];
    if !h.contains('.') || LAN_SUFFIXES.iter().any(|s| h.ends_with(s)) {
        return HostKind::Lan;
    }
    HostKind::Public
}

/// The note for a scheme + host kind (see [`RepoAddr::note`]).
pub fn transport_note(scheme: &str, kind: HostKind) -> Option<&'static str> {
    if scheme.eq_ignore_ascii_case("https") {
        None
    } else if kind == HostKind::Public {
        Some("publicHttp")
    } else {
        Some("lanHttp")
    }
}

/// Is `s` an IPv6 literal written without brackets (`::1`, `fe80::1`, `2001:db8::5`)?
fn bare_ipv6(s: &str) -> bool {
    s.matches(':').count() >= 2 && !s.contains('[') && s.parse::<std::net::Ipv6Addr>().is_ok()
}

/// Turn what was typed into the repo.json URL. Errors are i18n keys.
///
/// - no scheme: `http://` (what BMM always assumed; a LAN repo rarely has a certificate);
/// - `HTTP://` and `Https://` are the schemes they look like;
/// - an IPv6 address without brackets gets them (it can then carry no port);
/// - the path ends in `repo.json`, added after a folder path, kept when already there;
///   a query string (a share key `?k=…`) is kept, a `#fragment` is dropped;
/// - `ssh://` is not an address for this: it names a saved SSH server (the SSH panel);
/// - any other scheme is refused.
pub fn normalize_repo_input(raw: &str) -> Result<RepoAddr, &'static str> {
    let mut s = raw.trim().trim_matches(|c| c == '"' || c == '\'' || c == '<' || c == '>').trim().to_string();
    if s.is_empty() {
        return Err("repo.addr.errEmpty");
    }
    if s.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("repo.addr.errInvalid");
    }
    match s.find("://") {
        Some(i) => {
            let scheme = s[..i].to_ascii_lowercase();
            match scheme.as_str() {
                "http" | "https" => s = format!("{}{}", scheme, &s[i..]),
                "ssh" | "sftp" => return Err("repo.addr.errSsh"),
                _ => return Err("repo.addr.errScheme"),
            }
        }
        None => {
            // `host:port` parses as a URL with the host as its scheme, so the scheme must be
            // added BEFORE parsing, never inferred by it.
            if s.contains(':') && !s.contains('[') && bare_ipv6(&s) {
                s = format!("[{s}]");
            } else if let Some(end) = s.find('/') {
                let head = &s[..end];
                if bare_ipv6(head) { s = format!("[{head}]{}", &s[end..]); }
            }
            s = format!("http://{s}");
        }
    }
    let mut u = reqwest::Url::parse(&s).map_err(|_| "repo.addr.errInvalid")?;
    // host_str keeps an IPv6 literal's brackets; the field carries the address itself.
    let host = u.host_str().map(|h| h.trim_start_matches('[').trim_end_matches(']').to_string()).unwrap_or_default();
    if host.is_empty() {
        return Err("repo.addr.errNoHost");
    }
    u.set_fragment(None);
    let path = u.path().to_string();
    let manifest_path = if path.to_ascii_lowercase().ends_with("repo.json") {
        path.clone()
    } else {
        format!("{}/repo.json", path.trim_end_matches('/'))
    };
    u.set_path(&manifest_path);
    let manifest_url = u.to_string();
    let mut base = u.clone();
    let base_path = manifest_path[..manifest_path.len() - "repo.json".len()].trim_end_matches('/').to_string();
    base.set_path(if base_path.is_empty() { "/" } else { &base_path });
    let mut base_url = base.to_string();
    if base_path.is_empty() && base.query().is_none() {
        base_url = base_url.trim_end_matches('/').to_string();
    }
    let scheme = u.scheme().to_string();
    let kind = host_kind(&host);
    Ok(RepoAddr { note: transport_note(&scheme, kind), manifest_url, base_url, scheme, host, port: u.port(), kind })
}

/// The repo.json URL for an address, falling back to the old rule (prefix `http://`, append
/// `/repo.json`) for anything the normaliser refuses, so no caller that used to work stops.
pub fn manifest_url(raw: &str) -> String {
    match normalize_repo_input(raw) {
        Ok(a) => a.manifest_url,
        Err(_) => {
            let mut u = raw.trim().to_string();
            if !u.starts_with("http://") && !u.starts_with("https://") { u = format!("http://{u}"); }
            if !u.ends_with("repo.json") { u = format!("{}/repo.json", u.trim_end_matches('/')); }
            u
        }
    }
}

/// Should a request to this URL skip the system proxy? Yes for loopback and LAN hosts: a
/// proxy out on the internet cannot reach `192.168.1.20`, and sending a LAN password to it
/// would be worse than failing.
pub fn bypass_proxy(url: &str) -> bool {
    reqwest::Url::parse(url).ok()
        .and_then(|u| u.host_str().map(host_kind))
        .map(|k| k != HostKind::Public)
        .unwrap_or(false)
}

/// A client builder for a repo request: direct for loopback / LAN, the system's proxy
/// settings for the internet.
pub fn client_builder(url: &str) -> reqwest::ClientBuilder {
    let b = reqwest::Client::builder();
    if bypass_proxy(url) { b.no_proxy() } else { b }
}

/// The page's live check of the address field: the URL BMM will fetch, the host kind, the note.
#[tauri::command]
pub fn repo_addr_normalize(input: String) -> Result<RepoAddr, String> {
    normalize_repo_input(&input).map_err(str::to_string)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn m(s: &str) -> String { normalize_repo_input(s).unwrap().manifest_url }

    #[test]
    fn a_plain_ip_and_port_is_a_repo_json_url() {
        assert_eq!(m("192.168.1.20:8000"), "http://192.168.1.20:8000/repo.json");
        assert_eq!(m("http://192.168.1.20:8000/repo.json"), "http://192.168.1.20:8000/repo.json");
        assert_eq!(m("192.168.1.20"), "http://192.168.1.20/repo.json");
        assert_eq!(m("  192.168.1.20:8000/  "), "http://192.168.1.20:8000/repo.json");
        assert_eq!(m("\"10.0.0.5:9000\""), "http://10.0.0.5:9000/repo.json");
    }

    #[test]
    fn ipv6_with_and_without_brackets() {
        assert_eq!(m("[::1]:8000"), "http://[::1]:8000/repo.json");
        assert_eq!(m("http://[::1]:8000/"), "http://[::1]:8000/repo.json");
        assert_eq!(m("::1"), "http://[::1]/repo.json");
        assert_eq!(m("fe80::1/mods"), "http://[fe80::1]/mods/repo.json");
        let a = normalize_repo_input("[::1]:8000").unwrap();
        assert_eq!(a.host, "::1");
        assert_eq!(a.port, Some(8000));
        assert_eq!(a.kind, HostKind::Loopback);
    }

    #[test]
    fn bare_hosts_folders_and_queries() {
        assert_eq!(m("myserver"), "http://myserver/repo.json");
        assert_eq!(m("nas.local:8080/mods/"), "http://nas.local:8080/mods/repo.json");
        assert_eq!(m("HTTPS://Repo.Example.com/Mods"), "https://repo.example.com/Mods/repo.json");
        assert_eq!(m("https://repo.example.com/repo.json?k=abc#top"), "https://repo.example.com/repo.json?k=abc");
        assert_eq!(m("https://repo.example.com/?k=abc"), "https://repo.example.com/repo.json?k=abc");
        assert_eq!(m("https://repo.example.com/sub/REPO.JSON"), "https://repo.example.com/sub/REPO.JSON");
    }

    #[test]
    fn the_base_url_is_the_manifest_without_its_file() {
        let a = normalize_repo_input("192.168.1.20:8000").unwrap();
        assert_eq!(a.base_url, "http://192.168.1.20:8000");
        let b = normalize_repo_input("https://h.example.com/mods/repo.json").unwrap();
        assert_eq!(b.base_url, "https://h.example.com/mods");
    }

    #[test]
    fn what_is_not_an_http_address_is_refused_with_a_reason() {
        assert_eq!(normalize_repo_input(""), Err("repo.addr.errEmpty"));
        assert_eq!(normalize_repo_input("   "), Err("repo.addr.errEmpty"));
        assert_eq!(normalize_repo_input("ssh://default/repo"), Err("repo.addr.errSsh"));
        assert_eq!(normalize_repo_input("ftp://host/repo.json"), Err("repo.addr.errScheme"));
        assert_eq!(normalize_repo_input("file:///C:/repo.json"), Err("repo.addr.errScheme"));
        assert_eq!(normalize_repo_input("javascript://x"), Err("repo.addr.errScheme"));
        assert_eq!(normalize_repo_input("http://exa mple.com"), Err("repo.addr.errInvalid"));
        assert_eq!(normalize_repo_input("http://"), Err("repo.addr.errInvalid"));
    }

    #[test]
    fn host_kinds() {
        for h in ["127.0.0.1", "::1", "[::1]", "localhost", "dev.localhost", "::ffff:127.0.0.1"] {
            assert_eq!(host_kind(h), HostKind::Loopback, "{h}");
        }
        for h in ["192.168.1.20", "10.0.0.5", "172.16.3.4", "169.254.1.1", "100.64.0.9", "fd00::5", "fe80::1", "nas", "nas.local", "box.lan", "srv.home.arpa"] {
            assert_eq!(host_kind(h), HostKind::Lan, "{h}");
        }
        for h in ["8.8.8.8", "2606:4700::1111", "repo.example.com", "bettercommunity.ch"] {
            assert_eq!(host_kind(h), HostKind::Public, "{h}");
        }
    }

    #[test]
    fn the_transport_note_says_what_plain_http_means_here() {
        assert_eq!(normalize_repo_input("192.168.1.20:8000").unwrap().note, Some("lanHttp"));
        assert_eq!(normalize_repo_input("localhost:8000").unwrap().note, Some("lanHttp"));
        assert_eq!(normalize_repo_input("http://repo.example.com").unwrap().note, Some("publicHttp"));
        assert_eq!(normalize_repo_input("https://repo.example.com").unwrap().note, None);
        assert_eq!(normalize_repo_input("https://192.168.1.20").unwrap().note, None);
    }

    /// The decision this module exists for: a LAN or loopback address the user typed goes
    /// DIRECT (no proxy, and no SSRF refusal on this path), the internet keeps the proxy.
    #[test]
    fn lan_and_loopback_go_direct_the_internet_keeps_the_proxy() {
        assert!(bypass_proxy("http://192.168.1.20:8000/repo.json"));
        assert!(bypass_proxy("http://[::1]:8000/repo.json"));
        assert!(bypass_proxy("http://nas.local/repo.json"));
        assert!(bypass_proxy("http://localhost:8000/repo.json"));
        assert!(!bypass_proxy("https://repo.example.com/repo.json"));
        assert!(!bypass_proxy("not a url"));
    }

    /// The guards that DO refuse private addresses are for URLs the user did not type
    /// (scheduled tasks, shared automations). They still refuse them: this module changes
    /// nothing there.
    #[test]
    fn the_scheduler_guard_still_calls_the_lan_internal() {
        for ip in ["192.168.1.20", "10.0.0.5", "127.0.0.1", "::1", "fd00::5"] {
            assert!(crate::commands::sched_net::ip_is_internal(ip.parse().unwrap()), "{ip}");
        }
        assert!(!crate::commands::sched_net::ip_is_internal("8.8.8.8".parse().unwrap()));
    }

    #[test]
    fn the_fallback_keeps_the_old_rule_for_what_the_normaliser_refuses() {
        assert_eq!(manifest_url("192.168.1.20:8000"), "http://192.168.1.20:8000/repo.json");
        assert_eq!(manifest_url("ftp://x"), "http://ftp://x/repo.json");
    }
}
