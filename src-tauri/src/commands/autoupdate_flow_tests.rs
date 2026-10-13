//! The whole update path, step by step, against a local HTTP server on the loopback:
//! release check (channels, drafts, a "latest" that is a pre-release) → asset naming →
//! manifest fetch + signature → download (resume, interruption, wrong hash, oversize) →
//! staged « install on next launch » → the folder the installer is launched from.
//!
//! The server is plain HTTP on 127.0.0.1, which `is_https` accepts under `cfg(test)` only.
//! Test keys only (seed 07 x 32, as in autoupdate_manifest_tests.rs).
use super::*;
use chrono::{DateTime, Duration, TimeZone, Utc};
use ed25519_dalek::{Signer, SigningKey};
use std::collections::HashMap;
use std::io::Read as _;
use std::net::TcpListener;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

// ── A tiny HTTP/1.1 server ──────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Route {
    status: u16,
    body: Vec<u8>,
    /// Answer `Range: bytes=N-` with 206 (or 416 past the end); otherwise always 200 + the whole body.
    honor_range: bool,
    /// Announce the full length but close the connection after this many bytes, on the FIRST
    /// request to this route only (a dropped connection, then a working retry).
    cut_first_after: Option<usize>,
}

fn ok(body: impl Into<Vec<u8>>) -> Route {
    Route { status: 200, body: body.into(), honor_range: true, cut_first_after: None }
}

struct Server {
    base: String,
    /// One line per request: `<path> range=<from>`.
    log: Arc<Mutex<Vec<String>>>,
}

fn serve(routes: Vec<(&str, Route)>) -> Server {
    let listener = TcpListener::bind("127.0.0.1:0").expect("bind the loopback");
    let base = format!("http://{}", listener.local_addr().unwrap());
    let routes: HashMap<String, (Route, Arc<AtomicUsize>)> =
        routes.into_iter().map(|(p, r)| (p.to_string(), (r, Arc::new(AtomicUsize::new(0))))).collect();
    let log = Arc::new(Mutex::new(Vec::new()));
    let log2 = log.clone();
    std::thread::spawn(move || {
        for stream in listener.incoming() {
            let Ok(mut s) = stream else { continue };
            let mut buf = Vec::new();
            let mut tmp = [0u8; 2048];
            loop {
                let n = s.read(&mut tmp).unwrap_or(0);
                if n == 0 {
                    break;
                }
                buf.extend_from_slice(&tmp[..n]);
                if buf.windows(4).any(|w| w == b"\r\n\r\n") {
                    break;
                }
            }
            let req = String::from_utf8_lossy(&buf).to_string();
            let path = req.split_whitespace().nth(1).unwrap_or("/").to_string();
            let range = req.lines().find_map(|l| {
                l.to_ascii_lowercase()
                    .strip_prefix("range: bytes=")
                    .and_then(|r| r.trim().trim_end_matches('-').parse::<usize>().ok())
            });
            log2.lock().unwrap().push(format!("{path} range={range:?}"));
            let Some((r, hits)) = routes.get(&path) else {
                let _ = s.write_all(b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n");
                continue;
            };
            let first = hits.fetch_add(1, Ordering::SeqCst) == 0;
            let (status, body) = match (r.honor_range, range) {
                (true, Some(from)) if from >= r.body.len() => (416, Vec::new()),
                (true, Some(from)) => (206, r.body[from..].to_vec()),
                _ => (r.status, r.body.clone()),
            };
            let head = format!(
                "HTTP/1.1 {status} X\r\nContent-Length: {}\r\nContent-Type: application/octet-stream\r\nConnection: close\r\n\r\n",
                body.len()
            );
            let _ = s.write_all(head.as_bytes());
            let send = match (first, r.cut_first_after) {
                (true, Some(c)) => c.min(body.len()),
                _ => body.len(),
            };
            let _ = s.write_all(&body[..send]);
            let _ = s.flush();
        }
    });
    Server { base, log }
}

fn fresh_dir(tag: &str) -> std::path::PathBuf {
    let d = std::env::temp_dir().join(format!("bmm_upd_test_{tag}_{}", uuid::Uuid::new_v4()));
    std::fs::create_dir_all(&d).unwrap();
    d
}

// ── Signing fixtures ────────────────────────────────────────────────────────────────────────

fn test_key() -> SigningKey {
    SigningKey::from_bytes(&[7u8; 32])
}
fn t0() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 1, 1, 0, 0, 0).unwrap()
}
fn rfc(t: DateTime<Utc>) -> String {
    t.to_rfc3339_opts(chrono::SecondsFormat::Secs, true)
}
fn sha_hex(b: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    format!("{:x}", Sha256::digest(b))
}
/// A signed manifest offering `version` with ONE installer at `url`.
fn signed_manifest(version: &str, name: &str, url: &str, bytes: &[u8], issued: DateTime<Utc>) -> String {
    let body = serde_json::json!({
        "app_id": MANIFEST_APP_ID, "version": version, "files": [],
        "installers": [{ "path": name, "sha256": sha_hex(bytes), "download_url": url, "size": bytes.len() }],
        "issued": rfc(issued), "expires": rfc(issued + Duration::days(7)),
    })
    .to_string();
    let mut msg = MANIFEST_SIG_CONTEXT.to_vec();
    msg.extend_from_slice(body.as_bytes());
    let sig = hex::encode(test_key().sign(&msg).to_bytes());
    serde_json::json!({ "version": version, "signed": body, "signature": sig }).to_string()
}
fn installer_bytes() -> Vec<u8> {
    // Big enough to arrive in several chunks.
    (0..300_000u32).map(|i| (i % 251) as u8).collect()
}
fn entry_for(url: &str, bytes: &[u8]) -> ManifestFile {
    ManifestFile { path: "BMM-Setup.exe".into(), sha256: sha_hex(bytes), download_url: url.into(), size: bytes.len() as u64 }
}

// ── 1. The release check ────────────────────────────────────────────────────────────────────

fn release(tag: &str, pre: bool, draft: bool) -> serde_json::Value {
    serde_json::json!({
        "tag_name": tag, "prerelease": pre, "draft": draft,
        "html_url": format!("https://github.com/o/r/releases/tag/{tag}"), "body": format!("notes {tag}"),
        "assets": [
            { "name": "BMM-Setup.exe", "size": 62_000_000u64,
              "browser_download_url": format!("https://github.com/o/r/releases/download/{tag}/BMM-Setup.exe") },
            { "name": "update-manifest.json", "size": 900,
              "browser_download_url": format!("https://github.com/o/r/releases/download/{tag}/update-manifest.json") },
        ],
    })
}

/// GitHub's order: by creation date, newest first. A 1.0.3 hot-fix published after
/// 1.1.0-beta.1 comes first.
fn release_list() -> serde_json::Value {
    serde_json::json!([
        release("v1.2.0", false, true), // a draft: nobody can download it
        release("v1.0.3", false, false),
        release("v1.1.0-beta.1", true, false),
        release("v1.0.2", false, false),
    ])
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().user_agent("BetterModManager-test").build().unwrap()
}

#[tokio::test]
async fn the_stable_channel_reads_latest_and_the_prerelease_channel_the_highest_version() {
    let s = serve(vec![
        ("/repos/o/r/releases/latest", ok(release("v1.0.3", false, false).to_string())),
        ("/repos/o/r/releases?per_page=20", ok(release_list().to_string())),
    ]);
    let base = format!("{}/repos/o/r/releases", s.base);

    let stable = fetch_release(&client(), &base, false).await.expect("stable");
    assert_eq!(stable["tag_name"], "v1.0.3");

    let pre = fetch_release(&client(), &base, true).await.expect("pre-release channel");
    assert_eq!(pre["tag_name"], "v1.1.0-beta.1", "the highest non-draft, not the first of the list");

    let info = release_to_info(&pre, "1.0.2", true);
    assert!(info.has_update && info.is_prerelease);
    assert_eq!(info.channel, "prerelease");
    let info = release_to_info(&stable, "1.0.2", false);
    assert!(info.has_update && !info.is_prerelease);
    assert_eq!(info.channel, "stable");
}

#[tokio::test]
async fn a_latest_that_points_at_a_pre_release_is_not_followed_on_the_stable_channel() {
    // A mirror (or a GitHub "latest" ticked by hand) answering /latest with a pre-release.
    let s = serve(vec![
        ("/repos/o/r/releases/latest", ok(release("v1.1.0-beta.1", true, false).to_string())),
        ("/repos/o/r/releases?per_page=20", ok(release_list().to_string())),
    ]);
    let base = format!("{}/repos/o/r/releases", s.base);
    let r = fetch_release(&client(), &base, false).await.expect("falls back to the list");
    assert_eq!(r["tag_name"], "v1.0.3", "the newest STABLE release");
    assert!(s.log.lock().unwrap().iter().any(|l| l.contains("per_page")), "the list was read");
}

#[tokio::test]
async fn no_release_and_rate_limits_keep_their_vocabulary() {
    let s = serve(vec![(
        "/limited/latest",
        Route { status: 403, body: b"{}".to_vec(), honor_range: false, cut_first_after: None },
    )]);
    assert_eq!(fetch_release(&client(), &format!("{}/nothing", s.base), false).await.unwrap_err(), "NO_RELEASE");
    assert_eq!(fetch_release(&client(), &format!("{}/limited", s.base), false).await.unwrap_err(), "RATE_LIMITED");
    // Only drafts and pre-releases on the stable list: nothing to offer.
    let only_pre = serde_json::json!([release("v2.0.0", false, true), release("v1.9.0-rc.1", true, false)]);
    assert!(select_release(only_pre.as_array().unwrap(), false).is_none());
}

#[test]
fn a_pre_release_build_follows_the_pre_release_channel() {
    assert!(effective_include_pre(false, "1.1.0-beta.1"), "a beta build hears of the next beta");
    assert!(!effective_include_pre(false, "1.0.2"));
    assert!(effective_include_pre(true, "1.0.2"));
    // And it is offered the final release of its own line.
    let list = serde_json::json!([release("v1.1.0", false, false), release("v1.1.0-beta.2", true, false)]);
    let best = select_release(list.as_array().unwrap(), true).unwrap();
    assert_eq!(best["tag_name"], "v1.1.0");
    assert!(release_to_info(&best, "1.1.0-beta.2", true).has_update);
}

// ── 2. Asset naming ─────────────────────────────────────────────────────────────────────────

/// What `BetterInstaller/examples/bmm/release.ps1` uploads, in its order.
fn release_ps1_assets(tag: &str) -> serde_json::Value {
    let a = |name: &str, size: u64| {
        serde_json::json!({ "name": name, "size": size,
            "browser_download_url": format!("https://github.com/FreeProject089/BetterModsManager/releases/download/{tag}/{name}") })
    };
    serde_json::json!({
        "tag_name": tag, "prerelease": false, "draft": false, "html_url": "https://github.com/x", "body": "",
        "assets": [a("BMM-Setup.exe", 62_000_000), a("bmm.bpkg", 88_000_000), a("update.json", 2_000),
                   a("1.0.1-to-1.0.2.patch", 9_000_000), a("update-manifest.json", 3_000),
                   a("lang-en.json", 90_000), a("lang-fr.json", 95_000), a("links.json", 1_000)],
    })
}

/// BMM 0.9.11's picker, verbatim in behaviour (src-tauri/src/commands/autoupdate.rs at 74d7fa95):
/// the first asset ending in ".msi", else the first ending in ".exe" or ".zip" — case-sensitive.
fn picker_0_9_11(release: &serde_json::Value) -> Option<String> {
    let assets = release["assets"].as_array()?;
    let name = |a: &serde_json::Value| a["name"].as_str().unwrap_or("").to_string();
    assets
        .iter()
        .find(|a| name(a).ends_with(".msi"))
        .or_else(|| assets.iter().find(|a| name(a).ends_with(".exe") || name(a).ends_with(".zip")))
        .and_then(|a| a["browser_download_url"].as_str().map(str::to_string))
}

#[test]
fn every_generation_picks_bmm_setup_from_a_release_ps1_release() {
    let rel = release_ps1_assets("v1.0.2");
    let setup = "https://github.com/FreeProject089/BetterModsManager/releases/download/v1.0.2/BMM-Setup.exe";
    assert_eq!(picker_0_9_11(&rel).as_deref(), Some(setup), "0.9.11 runs BMM-Setup.exe");
    let info = release_to_info(&rel, "1.0.1", false);
    assert_eq!(info.download_url, setup, "1.0.2's hint");
    assert_eq!(info.download_size, 62_000_000);
    assert_eq!(
        info.manifest_url.as_deref(),
        Some("https://github.com/FreeProject089/BetterModsManager/releases/download/v1.0.2/update-manifest.json")
    );
    // The URL gen-update-manifest.mjs signs is the very one both pickers chose, so the signed
    // entry is found by URL, not only by the BMM-Setup.exe fallback.
    let bytes = b"setup".to_vec();
    let doc = signed_manifest("1.0.2", "BMM-Setup.exe", setup, &bytes, t0());
    let m = verify_manifest_text(&doc, &test_key().verifying_key(), "1.0.1", t0() + Duration::hours(1)).unwrap();
    assert_eq!(installer_for(&m, &info.download_url).unwrap().path, "BMM-Setup.exe");
}

#[test]
fn older_releases_and_odd_names_still_resolve() {
    let mk = |names: &[&str]| {
        serde_json::json!({ "tag_name": "v0.9.11", "assets": names.iter().map(|n| serde_json::json!({
            "name": n, "size": 1, "browser_download_url": format!("https://h/{n}") })).collect::<Vec<_>>() })
    };
    assert_eq!(release_to_info(&mk(&["BMM_0.9.11_x64_en-US.msi"]), "0.9.10", false).download_url, "https://h/BMM_0.9.11_x64_en-US.msi");
    assert_eq!(release_to_info(&mk(&["a.msi", "Other.exe"]), "0.9.10", false).download_url, "https://h/Other.exe", ".exe before .msi");
    assert_eq!(release_to_info(&mk(&["x.exe", "bmm-setup.EXE"]), "0.9.10", false).download_url, "https://h/bmm-setup.EXE");
    // No installer at all: the release page, never an empty URL.
    let none = serde_json::json!({ "tag_name": "v1.0.0", "html_url": "https://page", "assets": [] });
    let info = release_to_info(&none, "0.9.11", false);
    assert_eq!(info.download_url, "https://page");
    assert!(info.manifest_url.is_none() && info.major_bump);
}

// ── 3. Manifest fetch + signature ───────────────────────────────────────────────────────────

#[tokio::test]
async fn the_manifest_is_fetched_then_verified_and_tampering_is_refused() {
    let bytes = installer_bytes();
    let good = signed_manifest("1.2.0", "BMM-Setup.exe", "https://h/BMM-Setup.exe", &bytes, t0());
    let tampered = good.replace("1.2.0", "9.9.9"); // the signed body changes, the signature does not
    let s = serve(vec![("/good.json", ok(good.clone())), ("/tampered.json", ok(tampered)), ("/big.json", ok(vec![b' '; 2 * 1024 * 1024]))]);
    let key = test_key().verifying_key();
    let now = t0() + Duration::hours(1);

    let doc = fetch_manifest_document(&format!("{}/good.json", s.base)).await.expect("fetch");
    assert_eq!(doc, good, "served exactly as signed");
    assert_eq!(verify_manifest_text(&doc, &key, "1.1.0", now).unwrap().version, "1.2.0");

    let doc = fetch_manifest_document(&format!("{}/tampered.json", s.base)).await.unwrap();
    assert!(verify_manifest_text(&doc, &key, "1.1.0", now).unwrap_err().contains("signature does not match"));

    // Expired (the publisher stopped re-signing), and the wrong key.
    assert!(verify_manifest_text(&good, &key, "1.1.0", t0() + Duration::days(8)).unwrap_err().contains("expired"));
    let other = SigningKey::from_bytes(&[9u8; 32]).verifying_key();
    assert!(verify_manifest_text(&good, &other, "1.1.0", now).is_err());

    // Size cap, a missing file, and a non-https, non-loopback URL.
    assert!(fetch_manifest_document(&format!("{}/big.json", s.base)).await.unwrap_err().contains("too large"));
    assert!(fetch_manifest_document(&format!("{}/missing.json", s.base)).await.unwrap_err().contains("404"));
    assert!(fetch_manifest_document("http://example.com/update-manifest.json").await.unwrap_err().contains("not https"));
}

// ── 4. The download ─────────────────────────────────────────────────────────────────────────

type Seen = Arc<Mutex<Vec<DownloadProgress>>>;
fn recorder() -> (Seen, impl FnMut(DownloadProgress) + Send) {
    let seen: Seen = Arc::new(Mutex::new(Vec::new()));
    let s2 = seen.clone();
    (seen, move |p: DownloadProgress| s2.lock().unwrap().push(p))
}

#[tokio::test]
async fn a_download_reports_progress_and_returns_only_verified_bytes() {
    let bytes = installer_bytes();
    let s = serve(vec![("/BMM-Setup.exe", ok(bytes.clone()))]);
    let dir = fresh_dir("full");
    let entry = entry_for(&format!("{}/BMM-Setup.exe", s.base), &bytes);
    let (seen, mut rec) = recorder();
    let got = download_installer_into(&dir, &entry, &mut rec).await.expect("download");
    assert_eq!(got, bytes);
    let seen = seen.lock().unwrap();
    assert!(seen.iter().any(|p| p.phase == "downloading"));
    let last_dl = seen.iter().filter(|p| p.phase == "downloading").last().unwrap();
    assert_eq!((last_dl.received, last_dl.total), (bytes.len() as u64, bytes.len() as u64), "ends at 100%");
    assert_eq!(seen.last().unwrap().phase, "verifying");
    assert!(seen.iter().all(|p| !p.resumed));
    assert!(!dir.join(format!("{}.part", entry.sha256)).exists(), "the partial file is gone");
}

#[tokio::test]
async fn a_wrong_hash_is_refused_and_nothing_is_kept() {
    let bytes = installer_bytes();
    let s = serve(vec![("/BMM-Setup.exe", ok(bytes.clone()))]);
    let dir = fresh_dir("hash");
    let mut entry = entry_for(&format!("{}/BMM-Setup.exe", s.base), &bytes);
    entry.sha256 = sha_hex(b"something else");
    let (_seen, mut rec) = recorder();
    let e = download_installer_into(&dir, &entry, &mut rec).await.unwrap_err();
    assert!(e.contains("does not match the signed manifest"), "{e}");
    assert!(std::fs::read_dir(&dir).unwrap().next().is_none(), "no file left to run");
}

#[tokio::test]
async fn an_interrupted_download_resumes_where_it_stopped() {
    let bytes = installer_bytes();
    let s = serve(vec![(
        "/BMM-Setup.exe",
        Route { status: 200, body: bytes.clone(), honor_range: true, cut_first_after: Some(100_000) },
    )]);
    let dir = fresh_dir("resume");
    let entry = entry_for(&format!("{}/BMM-Setup.exe", s.base), &bytes);
    let (_seen, mut rec) = recorder();
    let e = download_installer_into(&dir, &entry, &mut rec).await.unwrap_err();
    assert!(e.contains("resumes where it stopped"), "{e}");
    let part = dir.join(format!("{}.part", entry.sha256));
    let kept = std::fs::metadata(&part).map(|m| m.len()).unwrap_or(0);
    assert!(kept > 0 && kept <= 100_000, "what arrived is kept ({kept})");

    let (seen, mut rec) = recorder();
    let got = download_installer_into(&dir, &entry, &mut rec).await.expect("resumed download");
    assert_eq!(got, bytes);
    assert!(seen.lock().unwrap().iter().any(|p| p.resumed), "reported as resumed");
    assert!(s.log.lock().unwrap().iter().any(|l| l.contains(&format!("range=Some({kept})"))), "{:?}", s.log.lock().unwrap());
}

#[tokio::test]
async fn a_server_that_ignores_ranges_restarts_cleanly() {
    let bytes = installer_bytes();
    let s = serve(vec![(
        "/BMM-Setup.exe",
        Route { status: 200, body: bytes.clone(), honor_range: false, cut_first_after: None },
    )]);
    let dir = fresh_dir("norange");
    let entry = entry_for(&format!("{}/BMM-Setup.exe", s.base), &bytes);
    std::fs::write(dir.join(format!("{}.part", entry.sha256)), &bytes[..50_000]).unwrap();
    let (seen, mut rec) = recorder();
    let got = download_installer_into(&dir, &entry, &mut rec).await.expect("whole file again");
    assert_eq!(got, bytes, "not appended to the old half");
    assert!(seen.lock().unwrap().iter().all(|p| !p.resumed), "a 200 is not a resume");
}

#[tokio::test]
async fn a_corrupt_partial_file_is_retried_from_zero() {
    let bytes = installer_bytes();
    let s = serve(vec![("/BMM-Setup.exe", ok(bytes.clone()))]);
    let dir = fresh_dir("corrupt");
    let entry = entry_for(&format!("{}/BMM-Setup.exe", s.base), &bytes);
    std::fs::write(dir.join(format!("{}.part", entry.sha256)), vec![0xAAu8; 50_000]).unwrap();
    let (_seen, mut rec) = recorder();
    let got = download_installer_into(&dir, &entry, &mut rec).await.expect("second attempt from zero");
    assert_eq!(got, bytes);
}

#[tokio::test]
async fn more_bytes_than_signed_are_refused() {
    let bytes = installer_bytes();
    let mut longer = bytes.clone();
    longer.extend_from_slice(&[1u8; 70_000]);
    let s = serve(vec![("/BMM-Setup.exe", Route { status: 200, body: longer, honor_range: false, cut_first_after: None })]);
    let dir = fresh_dir("oversize");
    let entry = entry_for(&format!("{}/BMM-Setup.exe", s.base), &bytes);
    let (_seen, mut rec) = recorder();
    let e = download_installer_into(&dir, &entry, &mut rec).await.unwrap_err();
    assert!(e.contains("more than the"), "{e}");
    assert!(!dir.join(format!("{}.part", entry.sha256)).exists());
}

#[tokio::test]
async fn a_missing_asset_is_an_error_not_a_file() {
    let s = serve(vec![]);
    let bytes = installer_bytes();
    let entry = entry_for(&format!("{}/BMM-Setup.exe", s.base), &bytes);
    let (_seen, mut rec) = recorder();
    let e = download_installer_into(&fresh_dir("404"), &entry, &mut rec).await.unwrap_err();
    assert!(e.contains("404"), "{e}");
}

// ── 5. « Install on next launch » ───────────────────────────────────────────────────────────

fn staged(bytes: &[u8], staged_at: DateTime<Utc>) -> StagedRecord {
    StagedRecord {
        version: "1.2.0".into(),
        document: signed_manifest("1.2.0", "BMM-Setup.exe", "https://h/BMM-Setup.exe", bytes, t0()),
        file: "BMM-Setup.exe".into(),
        staged_at: rfc(staged_at),
    }
}

#[test]
fn a_staged_installer_runs_only_while_it_still_verifies() {
    let key = test_key().verifying_key();
    let bytes = installer_bytes();
    let rec = staged(&bytes, t0() + Duration::hours(2));

    // The next day, and three weeks later (the manifest expired, but it was staged in time).
    assert!(verify_staged(&rec, &bytes, &key, "1.1.0", t0() + Duration::days(1)).is_ok());
    assert!(verify_staged(&rec, &bytes, &key, "1.1.0", t0() + Duration::days(21)).is_ok());

    // A swapped installer, a renamed one, a forged manifest, a version already installed.
    let mut evil = bytes.clone();
    evil[10] ^= 1;
    assert!(verify_staged(&rec, &evil, &key, "1.1.0", t0() + Duration::days(1)).unwrap_err().contains("does not match"));
    let renamed = StagedRecord { file: "Other.exe".into(), ..rec.clone() };
    assert!(verify_staged(&renamed, &bytes, &key, "1.1.0", t0() + Duration::days(1)).unwrap_err().contains("not an installer"));
    let forged = StagedRecord { document: rec.document.replace("1.2.0", "1.3.0"), ..rec.clone() };
    assert!(verify_staged(&forged, &bytes, &key, "1.1.0", t0() + Duration::days(1)).is_err());
    assert!(verify_staged(&rec, &bytes, &key, "1.2.0", t0() + Duration::days(1)).unwrap_err().contains("only a newer"));

    // The relaxed expiry holds only for a staging time inside the validity, and never one in
    // the future.
    let late = staged(&bytes, t0() + Duration::days(10));
    assert!(verify_staged(&late, &bytes, &key, "1.1.0", t0() + Duration::days(21)).unwrap_err().contains("expired"));
    let future = staged(&bytes, t0() + Duration::days(30));
    assert!(verify_staged(&future, &bytes, &key, "1.1.0", t0() + Duration::days(21)).unwrap_err().contains("future"));
}

// ── 6. The launch folder ────────────────────────────────────────────────────────────────────

#[test]
fn each_launch_gets_a_fresh_folder_and_the_signed_name() {
    let bytes = b"MZ installer".to_vec();
    let entry = entry_for("https://h/BMM-Setup.exe", &bytes);
    let a = write_installer_to_fresh_dir(&entry, &bytes).unwrap();
    let b = write_installer_to_fresh_dir(&entry, &bytes).unwrap();
    assert_ne!(a.parent(), b.parent(), "never a fixed, plantable path");
    assert_eq!(a.file_name().unwrap(), "BMM-Setup.exe");
    assert_eq!(std::fs::read(&a).unwrap(), bytes);
    let bad = ManifestFile { path: "..\\evil.exe".into(), ..entry };
    assert!(write_installer_to_fresh_dir(&bad, &bytes).is_err());
    for p in [a, b] {
        let _ = std::fs::remove_dir_all(p.parent().unwrap());
    }
}

// ── 7. Releases without a signed manifest: update.json, then the person's choice ───────────

/// BetterInstaller's update.json (its context string), signed with the test key, listing
/// `installers` in the signed body.
fn bi_update_json(version: &str, issued: DateTime<Utc>, installers: serde_json::Value) -> String {
    let body = serde_json::json!({
        "app_id": MANIFEST_APP_ID, "version": version, "url": "https://h/bmm.bpkg", "sha256": "ab".repeat(32),
        "installers": installers, "issued": rfc(issued), "expires": rfc(issued + Duration::days(7)),
    })
    .to_string();
    let mut msg = BI_MANIFEST_SIG_CONTEXT.to_vec();
    msg.extend_from_slice(body.as_bytes());
    let sig = hex::encode(test_key().sign(&msg).to_bytes());
    serde_json::json!({ "version": version, "signed": body, "signature": sig }).to_string()
}

/// A release as GitHub's API serves it, its assets on the test server under `/dl/<tag>/`.
fn gh_release(base: &str, tag: &str, pre: bool, assets: &[(&str, u64, Option<String>)]) -> serde_json::Value {
    serde_json::json!({
        "tag_name": tag, "prerelease": pre, "draft": false, "html_url": "https://github.com/x", "body": "",
        "assets": assets.iter().map(|(n, size, digest)| {
            let mut a = serde_json::json!({ "name": n, "size": size, "browser_download_url": format!("{base}/dl/{tag}/{n}") });
            if let Some(d) = digest { a["digest"] = serde_json::Value::String(format!("sha256:{d}")); }
            a
        }).collect::<Vec<_>>(),
    })
}

struct ReleaseCase {
    server: Server,
    by_tag: String,
    prefix: String,
}

/// Serves release `tag` (assets: BMM-Setup.exe with `served` bytes, and `update_json` when
/// given) on two loopback servers, one for the API and one for the downloads, and returns where
/// to point [`fetch_and_assess`].
fn release_case(tag: &str, pre: bool, served: &[u8], update_json: Option<String>, digest: Option<String>) -> ReleaseCase {
    let mut assets: Vec<(&str, u64, Option<String>)> = vec![("BMM-Setup.exe", served.len() as u64, digest)];
    let setup_path = format!("/dl/{tag}/BMM-Setup.exe");
    let uj_path = format!("/dl/{tag}/update.json");
    let mut routes: Vec<(&str, Route)> = vec![(setup_path.as_str(), ok(served.to_vec()))];
    if let Some(u) = update_json {
        assets.push(("update.json", u.len() as u64, None));
        routes.push((uj_path.as_str(), ok(u)));
    }
    let downloads = serve(routes);
    let release = gh_release(&downloads.base, tag, pre, &assets);
    let rel_path = format!("/repos/o/r/releases/tags/{tag}");
    let api = serve(vec![(rel_path.as_str(), ok(release.to_string()))]);
    ReleaseCase {
        by_tag: format!("{}/repos/o/r/releases/tags/", api.base),
        prefix: format!("{}/dl/", downloads.base),
        server: downloads,
    }
}

async fn assess_case(c: &ReleaseCase, tag: &str, current: &str, now: DateTime<Utc>) -> Result<(ReleaseAsset, Vec<u8>, Result<String, UnverifiedInstaller>), String> {
    let src = ReleaseSource { by_tag_api: &c.by_tag, download_prefix: &c.prefix };
    let (_seen, mut rec) = recorder();
    fetch_and_assess(&src, tag, current, &test_key().verifying_key(), now, &mut rec).await
}

#[tokio::test]
async fn a_release_without_manifest_installs_when_update_json_matches() {
    let bytes = installer_bytes();
    let uj = bi_update_json("1.0.1", t0(), serde_json::json!([{ "path": "BMM-Setup.exe", "sha256": sha_hex(&bytes) }]));
    let c = release_case("v1.0.1", true, &bytes, Some(uj), Some(sha_hex(&bytes)));
    let (asset, got, verdict) = assess_case(&c, "v1.0.1", "1.0.0", t0() + Duration::hours(1)).await.expect("assessed");
    assert_eq!(asset.name, "BMM-Setup.exe");
    assert_eq!(got, bytes);
    assert_eq!(verdict.as_deref().unwrap(), sha_hex(&bytes));
    assert!(may_launch(&verdict, None), "vouched for: launched without asking");
}

#[tokio::test]
async fn a_mismatch_is_the_serious_case_and_runs_only_on_confirmation_of_those_bytes() {
    let bytes = installer_bytes();
    let uj = bi_update_json("1.0.1", t0(), serde_json::json!([{ "path": "BMM-Setup.exe", "sha256": sha_hex(b"the real one") }]));
    let c = release_case("v1.0.1", false, &bytes, Some(uj), None);
    let (_a, _b, verdict) = assess_case(&c, "v1.0.1", "1.0.0", t0() + Duration::hours(1)).await.unwrap();
    let u = verdict.clone().unwrap_err();
    assert_eq!(u.kind, "mismatch");
    assert!(u.detail.contains("corrupted or tampered"), "{}", u.detail);
    assert_eq!(u.sha256, sha_hex(&bytes));
    assert!(!may_launch(&verdict, None), "never without the explicit confirmation");
    assert!(!may_launch(&verdict, Some(&sha_hex(b"the real one"))), "a confirmation of other bytes does not count");
    assert!(may_launch(&verdict, Some(&sha_hex(&bytes))), "« Install anyway » for exactly these bytes");
    // The message the dialog parses.
    let msg = format!("{UNVERIFIED_PREFIX}{}", serde_json::to_string(&u).unwrap());
    let back: serde_json::Value = serde_json::from_str(msg.strip_prefix(UNVERIFIED_PREFIX).unwrap()).unwrap();
    assert_eq!(back["kind"], "mismatch");
    assert_eq!(back["sha256"], sha_hex(&bytes));
}

#[tokio::test]
async fn no_update_json_an_invalid_one_or_no_entry_asks_the_person() {
    let bytes = installer_bytes();
    let now = t0() + Duration::hours(1);
    // None at all; GitHub's digest is reported as extra information.
    let c = release_case("v1.0.1", false, &bytes, None, Some(sha_hex(&bytes)));
    let (_a, _b, v) = assess_case(&c, "v1.0.1", "1.0.0", now).await.unwrap();
    let u = v.clone().unwrap_err();
    assert_eq!((u.kind.as_str(), u.github_matches), ("missing", Some(true)));
    assert!(!may_launch(&v, None));
    // Expired.
    let uj = bi_update_json("1.0.1", t0(), serde_json::json!([{ "path": "BMM-Setup.exe", "sha256": sha_hex(&bytes) }]));
    let c = release_case("v1.0.1", false, &bytes, Some(uj), None);
    let (_a, _b, v) = assess_case(&c, "v1.0.1", "1.0.0", t0() + Duration::days(8)).await.unwrap();
    let u = v.unwrap_err();
    assert_eq!(u.kind, "invalid");
    assert!(u.detail.contains("expired"), "{}", u.detail);
    // Signed with another key.
    let mut doc: serde_json::Value = serde_json::from_str(&bi_update_json("1.0.1", t0(), serde_json::json!([]))).unwrap();
    doc["signed"] = serde_json::Value::String(doc["signed"].as_str().unwrap().replace("1.0.1", "1.0.9"));
    let c = release_case("v1.0.1", false, &bytes, Some(doc.to_string()), None);
    let (_a, _b, v) = assess_case(&c, "v1.0.1", "1.0.0", now).await.unwrap();
    assert!(v.unwrap_err().detail.contains("does not match the publisher"));
    // Not newer than this version.
    let uj = bi_update_json("1.0.0", t0(), serde_json::json!([{ "path": "BMM-Setup.exe", "sha256": sha_hex(&bytes) }]));
    let c = release_case("v1.0.1", false, &bytes, Some(uj), None);
    let (_a, _b, v) = assess_case(&c, "v1.0.1", "1.0.0", now).await.unwrap();
    assert!(v.unwrap_err().detail.contains("not newer"));
    // No entry for the installer (BetterInstaller's update.json today).
    let uj = bi_update_json("1.0.1", t0(), serde_json::json!([]));
    let c = release_case("v1.0.1", false, &bytes, Some(uj), None);
    let (_a, _b, v) = assess_case(&c, "v1.0.1", "1.0.0", now).await.unwrap();
    assert_eq!(v.unwrap_err().kind, "no-entry");
    // A GitHub digest that differs turns any of these into a mismatch.
    let c = release_case("v1.0.1", false, &bytes, None, Some("00".repeat(32)));
    let (_a, _b, v) = assess_case(&c, "v1.0.1", "1.0.0", now).await.unwrap();
    assert_eq!(v.unwrap_err().kind, "mismatch");
}

#[tokio::test]
async fn foreign_hosts_ambiguous_assets_and_odd_tags_are_refused_before_any_download() {
    let bytes = installer_bytes();
    // The release names an installer on another host: refused, nothing downloaded from it.
    let assets_server = serve(vec![("/dl/v1.0.1/BMM-Setup.exe", ok(bytes.clone()))]);
    let mut rel = gh_release(&assets_server.base, "v1.0.1", false, &[("BMM-Setup.exe", bytes.len() as u64, None)]);
    let api = serve(vec![("/repos/o/r/releases/tags/v1.0.1", ok(rel.to_string()))]);
    let by_tag = format!("{}/repos/o/r/releases/tags/", api.base);
    let src = ReleaseSource { by_tag_api: &by_tag, download_prefix: "https://github.com/FreeProject089/BetterModsManager/releases/download/" };
    let (_s, mut rec) = recorder();
    let e = fetch_and_assess(&src, "v1.0.1", "1.0.0", &test_key().verifying_key(), t0(), &mut rec).await.unwrap_err();
    assert!(e.contains("not a download from BMM"), "{e}");
    assert!(assets_server.log.lock().unwrap().is_empty(), "nothing fetched from the foreign host");
    // Two .exe, no BMM-Setup.exe: which one would be a guess.
    rel["assets"] = serde_json::json!([
        { "name": "a.exe", "size": 5, "browser_download_url": format!("{}/dl/v1.0.1/a.exe", assets_server.base) },
        { "name": "b.exe", "size": 5, "browser_download_url": format!("{}/dl/v1.0.1/b.exe", assets_server.base) },
    ]);
    assert!(pick_release_installer(&rel, &format!("{}/dl/", assets_server.base)).unwrap_err().contains("guess"));
    // Tags that cannot go into the API path, and an answer for another release.
    let (_s, mut rec) = recorder();
    let src = ReleaseSource { by_tag_api: &by_tag, download_prefix: "x" };
    assert!(fetch_and_assess(&src, "../latest", "1.0.0", &test_key().verifying_key(), t0(), &mut rec).await.unwrap_err().contains("tag"));
    let other = serve(vec![("/repos/o/r/releases/tags/v1.0.2", ok(gh_release("http://x", "v1.0.1", false, &[]).to_string()))]);
    let by_tag2 = format!("{}/repos/o/r/releases/tags/", other.base);
    let src = ReleaseSource { by_tag_api: &by_tag2, download_prefix: "http://x/dl/" };
    let e = fetch_and_assess(&src, "v1.0.2", "1.0.0", &test_key().verifying_key(), t0(), &mut rec).await.unwrap_err();
    assert!(e.contains("another release"), "{e}");
}

#[tokio::test]
async fn a_pre_release_is_offered_and_installable_and_the_signed_path_is_preferred() {
    let bytes = installer_bytes();
    let uj = bi_update_json("1.1.0-beta.1", t0(), serde_json::json!([{ "path": "BMM-Setup.exe", "sha256": sha_hex(&bytes) }]));
    let c = release_case("v1.1.0-beta.1", true, &bytes, Some(uj), None);
    let (_a, _b, v) = assess_case(&c, "v1.1.0-beta.1", "1.0.2", t0() + Duration::hours(1)).await.unwrap();
    assert!(may_launch(&v, None), "a pre-release with a matching update.json installs");
    assert!(c.server.log.lock().unwrap().iter().any(|l| l.contains("/dl/v1.1.0-beta.1/BMM-Setup.exe")), "its tag is kept");

    // Offered on the pre-release channel, its tag kept as published.
    let mut pre = release("v1.1.0-beta.1", true, false);
    pre["assets"] = serde_json::json!([{ "name": "BMM-Setup.exe", "size": 5, "browser_download_url": "https://github.com/o/r/releases/download/v1.1.0-beta.1/BMM-Setup.exe" }]);
    let info = release_to_info(&pre, "1.0.2", true);
    assert!(info.has_update && info.is_prerelease && info.manifest_url.is_none());
    assert_eq!((info.release_tag.as_str(), info.verification.as_str()), ("v1.1.0-beta.1", "unverified"));
    // A release with update-manifest.json (and update.json) goes the signed way.
    let both = release_ps1_assets("v1.0.2");
    assert_eq!(release_to_info(&both, "1.0.1", false).verification, "signed");
}

#[tokio::test]
async fn an_installer_larger_or_shorter_than_announced_is_refused() {
    let bytes = installer_bytes();
    let s = serve(vec![("/dl/v1/BMM-Setup.exe", ok(bytes.clone()))]);
    let (_seen, mut rec) = recorder();
    let mut a = ReleaseAsset { name: "BMM-Setup.exe".into(), url: format!("{}/dl/v1/BMM-Setup.exe", s.base), size: 1000, github_sha256: None };
    assert!(download_asset(&a, &mut rec).await.unwrap_err().contains("more than"));
    a.size = bytes.len() as u64 + 10;
    assert!(download_asset(&a, &mut rec).await.unwrap_err().contains("incomplete"));
    a.size = bytes.len() as u64;
    let (seen, mut rec) = recorder();
    assert_eq!(download_asset(&a, &mut rec).await.unwrap(), bytes);
    let seen = seen.lock().unwrap();
    assert_eq!(seen.last().unwrap().phase, "verifying");
    assert!(seen.iter().any(|p| p.phase == "downloading" && p.received == bytes.len() as u64));
}

/// The update.json published with v1.0.1, verbatim: signed with the publisher key this build
/// pins (so the right signature check is used), and listing no installer checksum.
#[test]
fn the_published_v1_0_1_update_json_verifies_but_names_no_installer() {
    let doc = r#"{"notes":"Better Mods Manager 1.0.0","signature":"e61d2988034b0276da4687904866261799b02ad961b7eaf16c79ba2b1f53f90ad6d707f75b1c6aec4ba2c7d74d727f75e0c4a928734a80fb9452aa47d82ff30c","signed":"{\"app_id\":\"com.bettermm.desktop\",\"version\":\"1.0.0\",\"url\":\"https://github.com/FreeProject089/BetterModsManager/releases/latest/download/bmm.bpkg\",\"urls\":[\"https://bettercommunity.ch/api/assets/bmm-bpkg\"],\"notes\":\"Better Mods Manager 1.0.0\",\"sha256\":\"578fe3f7357808902de46e080d8abed5ed583d605a537218c0a0b4994009a681\",\"config_sha256\":\"7c2e11311f0f6097377edb547bd586a94b3324f000cbb19e9f5e8f4bfacb547e\",\"issued\":\"2026-10-08T21:00:18Z\",\"expires\":\"2026-10-15T21:00:18Z\"}","url":"https://github.com/FreeProject089/BetterModsManager/releases/latest/download/bmm.bpkg","version":"1.0.0"}"#;
    let now = Utc.with_ymd_and_hms(2026, 10, 13, 12, 0, 0).unwrap();
    let r = update_json_checksum(doc, &publisher_key().unwrap(), "0.9.12", now, "BMM-Setup.exe");
    assert_eq!(r.unwrap_err().0, "no-entry", "signature, app, dates and version pass; only the entry is missing");
}

#[test]
fn the_installer_arguments_update_a_betterinstaller_install_in_place_only() {
    assert_eq!(installer_args(true, "BMM-Setup.exe", 4242).as_deref(), Some("--update --wait-pid 4242 --launch"));
    assert_eq!(installer_args(true, "bmm-setup.EXE", 7).as_deref(), Some("--update --wait-pid 7 --launch"));
    assert_eq!(installer_args(false, "BMM-Setup.exe", 7), None, "not a BetterInstaller install: interactive");
    assert_eq!(installer_args(true, "Better.Mod.Manager_1.0.0_x64_en-US.msi", 7), None, "not BetterInstaller's setup");
    let args = installer_args(true, "BMM-Setup.exe", 7);
    assert!(retry_interactively(&args, Some(INSTALLER_EXIT_NO_EXISTING_INSTALL)));
    assert!(!retry_interactively(&args, Some(1)), "another failure is reported, not retried");
    assert!(!retry_interactively(&None, Some(INSTALLER_EXIT_NO_EXISTING_INSTALL)), "already interactive");
}
