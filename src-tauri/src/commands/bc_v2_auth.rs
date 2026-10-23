//! BetterCommunity v2 sign-in: the OAuth 2.0 device flow (RFC 8628, ADR 0018 §2).
//!
//! WHAT IT IS
//!   BMM is a public OAuth client of BetterCommunity v2 (`app:provision-bmm`): no secret in the
//!   binary, no redirect address. Signing in shows a short code; the person approves it on the
//!   website; BMM keeps the access token (`bc_at_`) and the rotating refresh token. With them a
//!   report arrives as `account`, the notification poller reads the account's notifications
//!   (`notifications:read`) and Laya's suggest helper answers (`ai:classify`).
//!
//! WHEN
//!   Only in v2 mode (`bc_v2::effective_v2_root`: the switch, then a passing health check). In
//!   v1 mode every command here answers `not_v2` and nothing leaves the machine; the v1 account
//!   link (`/api/link/*`, core/bc-link.ts) keeps working as before.
//!
//! WHERE THE TOKENS LIVE
//!   The same way BMM keeps its other secrets (ai_core.rs): Windows, DPAPI (user scope, BMM's
//!   own entropy for this store) into `bc-v2-auth.json`; macOS / Linux, the OS keyring; when
//!   neither works, this run's memory only (the Settings card says so). A token is never handed
//!   to the webview: the commands below make the calls and return the answers. Tokens are bound
//!   to the v2 root that issued them and are never sent anywhere else.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use tauri::State;

use crate::commands::bc_v2::{effective_v2_root, runtime, v2_client};
use crate::state::AppState;

/// What BMM asks for: only the scopes it uses (feedback, notifications, consents, Laya).
pub const SCOPES: &str = "openid profile offline_access feedback:write feedback:read notifications:read consents:read consents:write ai:classify";
pub const DEVICE_GRANT: &str = "urn:ietf:params:oauth:grant-type:device_code";
pub const AUTH_FILE: &str = "bc-v2-auth.json";
#[cfg(target_os = "windows")]
const ENTROPY: &[u8] = b"BetterModsManager/bc-v2-auth/v1";
#[cfg(not(target_os = "windows"))]
const KEYRING_SERVICE: &str = "BetterModsManager.bc-v2";

/// The stored sign-in. Never serialised towards the webview (see `status_view`).
#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq)]
pub struct Tokens {
    pub access_token: String,
    #[serde(default)]
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
    #[serde(default)]
    pub scope: String,
    /// The v2 root that issued them: they are used against that root only.
    pub root: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub handle: String,
}

fn now() -> i64 {
    chrono::Utc::now().timestamp()
}

// ── Storage ─────────────────────────────────────────────────────────────────────────────────

fn memory() -> &'static Mutex<Option<Tokens>> {
    static M: OnceLock<Mutex<Option<Tokens>>> = OnceLock::new();
    M.get_or_init(|| Mutex::new(None))
}

fn data_dir(state: &AppState) -> PathBuf {
    state.data_path.parent().map(Path::to_path_buf).unwrap_or_else(|| PathBuf::from("."))
}

/// Where a sign-in lives now: `dpapi`, `keyring`, `memory` or `` (none).
pub fn storage_of(dir: &Path) -> &'static str {
    if memory().lock().map(|m| m.is_some()).unwrap_or(false) {
        return "memory";
    }
    #[cfg(target_os = "windows")]
    {
        if dir.join(AUTH_FILE).exists() {
            return "dpapi";
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
        if keyring::Entry::new(KEYRING_SERVICE, "tokens").ok().and_then(|e| e.get_password().ok()).is_some() {
            return "keyring";
        }
    }
    ""
}

pub fn load_tokens(dir: &Path) -> Option<Tokens> {
    if let Some(t) = memory().lock().ok().and_then(|m| m.clone()) {
        return Some(t);
    }
    #[cfg(target_os = "windows")]
    {
        let v: Value = serde_json::from_str(&std::fs::read_to_string(dir.join(AUTH_FILE)).ok()?).ok()?;
        let blob = crate::commands::ai_core::hex_decode(v.get("sealed")?.as_str()?)?;
        let plain = crate::commands::ai_core::dpapi_with(&blob, false, ENTROPY).ok()?;
        serde_json::from_slice(&plain).ok()
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
        let s = keyring::Entry::new(KEYRING_SERVICE, "tokens").ok()?.get_password().ok()?;
        serde_json::from_str(&s).ok()
    }
}

/// Keep a sign-in. Returns where it went.
pub fn store_tokens(dir: &Path, t: &Tokens) -> &'static str {
    let json = serde_json::to_string(t).unwrap_or_default();
    if let Ok(mut m) = memory().lock() {
        *m = None;
    }
    #[cfg(target_os = "windows")]
    {
        if let Ok(blob) = crate::commands::ai_core::dpapi_with(json.as_bytes(), true, ENTROPY) {
            let _ = std::fs::create_dir_all(dir);
            let body = json!({ "sealed": crate::commands::ai_core::hex_encode(&blob) });
            if std::fs::write(dir.join(AUTH_FILE), body.to_string()).is_ok() {
                return "dpapi";
            }
        }
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
        if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, "tokens") {
            if e.set_password(&json).is_ok() {
                return "keyring";
            }
        }
    }
    if let Ok(mut m) = memory().lock() {
        *m = Some(t.clone());
    }
    "memory"
}

pub fn clear_tokens(dir: &Path) {
    if let Ok(mut m) = memory().lock() {
        *m = None;
    }
    #[cfg(target_os = "windows")]
    {
        let _ = std::fs::remove_file(dir.join(AUTH_FILE));
    }
    #[cfg(not(target_os = "windows"))]
    {
        let _ = dir;
        if let Ok(e) = keyring::Entry::new(KEYRING_SERVICE, "tokens") {
            let _ = e.delete_credential();
        }
    }
}

// ── The token endpoint's answers (pure, tested) ─────────────────────────────────────────────

/// One answer of `POST /v2/oauth/token`, as the device flow and the refresh read it.
#[derive(Debug, Clone, PartialEq)]
pub enum TokenAnswer {
    /// Tokens: (access, refresh, expires_in seconds, scope).
    Tokens(String, String, i64, String),
    /// RFC 8628 §3.5: keep polling at the same pace.
    Pending,
    /// RFC 8628 §3.5: keep polling, 5 seconds slower.
    SlowDown,
    /// The person refused on the website.
    Denied,
    /// The code (or the refresh token) is no longer valid: start again / signed out.
    Expired,
    /// Anything else (the error code, or `http_<n>`).
    Failed(String),
}

pub fn token_answer(status: u16, body: &Value) -> TokenAnswer {
    if status == 200 {
        let at = body["access_token"].as_str().unwrap_or("").to_string();
        if at.is_empty() || body["token_type"].as_str().map(|t| !t.eq_ignore_ascii_case("bearer")).unwrap_or(true) {
            return TokenAnswer::Failed("bad_token_response".into());
        }
        return TokenAnswer::Tokens(
            at,
            body["refresh_token"].as_str().unwrap_or("").to_string(),
            body["expires_in"].as_i64().unwrap_or(3600).clamp(30, 60 * 60 * 24 * 30),
            body["scope"].as_str().unwrap_or("").to_string(),
        );
    }
    match body["error"].as_str().unwrap_or("") {
        "authorization_pending" => TokenAnswer::Pending,
        "slow_down" => TokenAnswer::SlowDown,
        "access_denied" => TokenAnswer::Denied,
        "expired_token" | "invalid_grant" => TokenAnswer::Expired,
        "" => TokenAnswer::Failed(format!("http_{status}")),
        e => TokenAnswer::Failed(e.chars().take(60).collect()),
    }
}

/// The access token can be used as it is (a minute of margin).
pub fn fresh(t: &Tokens, at: i64) -> bool {
    !t.access_token.is_empty() && t.expires_at - 60 > at
}

/// The verification page may only be on the v2 root's own host (it is opened in the browser).
pub fn verification_ok(url: &str, root: &str) -> bool {
    let (Ok(u), Ok(r)) = (reqwest::Url::parse(url), reqwest::Url::parse(root)) else { return false };
    (u.scheme() == "https" || (u.scheme() == "http" && r.scheme() == "http")) && u.host_str() == r.host_str() && u.username().is_empty()
}

// ── Device flow ─────────────────────────────────────────────────────────────────────────────

struct DeviceSession {
    device_code: String,
    root: String,
    client_id: String,
    interval: u64,
    expires_at: i64,
}

fn device() -> &'static Mutex<Option<DeviceSession>> {
    static D: OnceLock<Mutex<Option<DeviceSession>>> = OnceLock::new();
    D.get_or_init(|| Mutex::new(None))
}

fn v2_and_client() -> Result<(String, String), String> {
    let root = effective_v2_root().ok_or("not_v2")?;
    let client = runtime().client_id;
    if client.is_empty() {
        return Err("no_client_id".into());
    }
    Ok((root, client))
}

/// Start signing in: ask v2 for a code. The device code stays here; the webview gets the code to
/// show and the page to open.
#[tauri::command]
pub async fn bc_v2_device_start() -> Result<Value, String> {
    let (root, client) = v2_and_client()?;
    let resp = v2_client(10)?
        .post(format!("{root}/v2/oauth/device"))
        .form(&[("client_id", client.as_str()), ("scope", SCOPES)])
        .send()
        .await
        .map_err(|_| "offline".to_string())?;
    let status = resp.status().as_u16();
    let v: Value = resp.json().await.unwrap_or(Value::Null);
    if status != 200 {
        return Err(v["error"].as_str().map(str::to_string).unwrap_or(format!("http_{status}")));
    }
    let device_code = v["device_code"].as_str().unwrap_or("").to_string();
    let user_code = v["user_code"].as_str().unwrap_or("").to_string();
    let page = v["verification_uri_complete"].as_str().or(v["verification_uri"].as_str()).unwrap_or("").to_string();
    if device_code.is_empty() || user_code.is_empty() || !verification_ok(&page, &root) {
        return Err("bad_device_response".into());
    }
    let interval = v["interval"].as_u64().unwrap_or(5).clamp(1, 60);
    let expires_in = v["expires_in"].as_i64().unwrap_or(600).clamp(30, 3600);
    if let Ok(mut d) = device().lock() {
        *d = Some(DeviceSession { device_code, root, client_id: client, interval, expires_at: now() + expires_in });
    }
    Ok(json!({
        "user_code": user_code,
        "verification_uri": v["verification_uri"],
        "verification_uri_complete": page,
        "interval": interval,
        "expires_in": expires_in,
    }))
}

/// Ask once whether the code was approved. `state`: pending · slow_down · approved · denied ·
/// expired · error. The webview waits `interval` seconds between two calls (core/bc-device-flow.ts).
#[tauri::command]
pub async fn bc_v2_device_poll(state: State<'_, AppState>) -> Result<Value, String> {
    let (code, root, client, interval, expires_at) = {
        let d = device().lock().map_err(|_| "lock")?;
        let Some(s) = d.as_ref() else { return Ok(json!({ "state": "expired" })) };
        (s.device_code.clone(), s.root.clone(), s.client_id.clone(), s.interval, s.expires_at)
    };
    if now() > expires_at {
        bc_v2_device_cancel();
        return Ok(json!({ "state": "expired" }));
    }
    let resp = v2_client(10)?
        .post(format!("{root}/v2/oauth/token"))
        .form(&[("grant_type", DEVICE_GRANT), ("device_code", code.as_str()), ("client_id", client.as_str())])
        .send()
        .await;
    let Ok(resp) = resp else { return Ok(json!({ "state": "pending", "interval": interval, "offline": true })) };
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    match token_answer(status, &body) {
        TokenAnswer::Pending => Ok(json!({ "state": "pending", "interval": interval })),
        TokenAnswer::SlowDown => {
            let slower = (interval + 5).min(60);
            if let Ok(mut d) = device().lock() {
                if let Some(s) = d.as_mut() {
                    s.interval = slower;
                }
            }
            Ok(json!({ "state": "slow_down", "interval": slower }))
        }
        TokenAnswer::Denied => {
            bc_v2_device_cancel();
            Ok(json!({ "state": "denied" }))
        }
        TokenAnswer::Expired => {
            bc_v2_device_cancel();
            Ok(json!({ "state": "expired" }))
        }
        TokenAnswer::Failed(e) => Ok(json!({ "state": "error", "error": e })),
        TokenAnswer::Tokens(access, refresh, expires_in, scope) => {
            bc_v2_device_cancel();
            let mut t = Tokens { access_token: access, refresh_token: refresh, expires_at: now() + expires_in, scope, root: root.clone(), ..Default::default() };
            if let Ok(info) = userinfo(&root, &t.access_token).await {
                t.name = info["name"].as_str().unwrap_or("").chars().take(80).collect();
                t.handle = info["preferred_username"].as_str().unwrap_or("").chars().take(40).collect();
            }
            let dir = data_dir(&state);
            let storage = store_tokens(&dir, &t);
            crate::commands::crash::log_line(format!("[BC] signed in to BetterCommunity v2 ({storage})"));
            Ok(json!({ "state": "approved", "account": status_view(Some(&t), storage, Some(&root)) }))
        }
    }
}

/// Stop waiting for a code (the dialog was closed).
#[tauri::command]
pub fn bc_v2_device_cancel() {
    if let Ok(mut d) = device().lock() {
        *d = None;
    }
}

async fn userinfo(root: &str, access: &str) -> Result<Value, String> {
    let resp = v2_client(10)?
        .get(format!("{root}/v2/oauth/userinfo"))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {access}"))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("http_{}", resp.status().as_u16()));
    }
    resp.json().await.map_err(|e| e.to_string())
}

/// What the webview may know of a sign-in: never a token.
fn status_view(t: Option<&Tokens>, storage: &str, root: Option<&str>) -> Value {
    match t {
        None => json!({ "signed_in": false, "v2": root.is_some() }),
        Some(t) => json!({
            "signed_in": true,
            "v2": root.is_some(),
            // a sign-in made against another v2 root is kept but not used
            "here": root.map(|r| r == t.root).unwrap_or(false),
            "name": t.name,
            "handle": t.handle,
            "scope": t.scope,
            "expired": !fresh(t, now()) && t.refresh_token.is_empty(),
            "storage": storage,
        }),
    }
}

/// The sign-in as the Settings card shows it.
#[tauri::command]
pub fn bc_v2_auth_status(state: State<'_, AppState>) -> Value {
    let dir = data_dir(&state);
    let t = load_tokens(&dir);
    status_view(t.as_ref(), storage_of(&dir), effective_v2_root().as_deref())
}

/// Sign out: the refresh token is revoked on v2 (best effort, RFC 7009), then forgotten here.
#[tauri::command]
pub async fn bc_v2_sign_out(state: State<'_, AppState>) -> Result<Value, String> {
    let dir = data_dir(&state);
    let mut revoked = false;
    if let Some(t) = load_tokens(&dir) {
        let client = runtime().client_id;
        let tok = if t.refresh_token.is_empty() { t.access_token.clone() } else { t.refresh_token.clone() };
        let hint = if t.refresh_token.is_empty() { "access_token" } else { "refresh_token" };
        if let Ok(c) = v2_client(8) {
            revoked = c
                .post(format!("{}/v2/oauth/revoke", t.root))
                .form(&[("token", tok.as_str()), ("token_type_hint", hint), ("client_id", client.as_str())])
                .send()
                .await
                .map(|r| r.status().is_success())
                .unwrap_or(false);
        }
    }
    clear_tokens(&dir);
    crate::commands::crash::log_line(format!("[BC] signed out of BetterCommunity v2 (revoked on the server: {revoked})"));
    Ok(json!({ "signed_in": false, "revoked": revoked }))
}

/// A usable access token for this session's v2 root: refreshed (rotating refresh token) when it
/// is about to expire. `Err("not_signed_in")` when there is none, or the refresh was refused (the
/// sign-in is then forgotten: the person signed out on the website or the grant was revoked).
pub async fn access_token(dir: &Path) -> Result<String, String> {
    let root = effective_v2_root().ok_or("not_v2")?;
    let t = load_tokens(dir).ok_or("not_signed_in")?;
    if t.root != root {
        return Err("not_signed_in".into());
    }
    if fresh(&t, now()) {
        return Ok(t.access_token);
    }
    if t.refresh_token.is_empty() {
        return Err("not_signed_in".into());
    }
    let client = runtime().client_id;
    let resp = v2_client(10)?
        .post(format!("{root}/v2/oauth/token"))
        .form(&[("grant_type", "refresh_token"), ("refresh_token", t.refresh_token.as_str()), ("client_id", client.as_str())])
        .send()
        .await
        .map_err(|_| "offline".to_string())?;
    let status = resp.status().as_u16();
    let body: Value = resp.json().await.unwrap_or(Value::Null);
    match token_answer(status, &body) {
        TokenAnswer::Tokens(access, refresh, expires_in, scope) => {
            let next = Tokens {
                access_token: access.clone(),
                // rotating: the new one replaces the old; a server that keeps it sends none
                refresh_token: if refresh.is_empty() { t.refresh_token.clone() } else { refresh },
                expires_at: now() + expires_in,
                scope: if scope.is_empty() { t.scope.clone() } else { scope },
                ..t
            };
            store_tokens(dir, &next);
            Ok(access)
        }
        TokenAnswer::Expired | TokenAnswer::Denied => {
            clear_tokens(dir);
            crate::commands::crash::log_line("[BC] the v2 sign-in was refused at refresh: forgotten".to_string());
            Err("not_signed_in".into())
        }
        TokenAnswer::Failed(e) => Err(e),
        TokenAnswer::Pending | TokenAnswer::SlowDown => Err("refresh_failed".into()),
    }
}

/// The current access token without any network (for the AI helper's synchronous header
/// building), only when it is fresh and was issued by this session's root.
pub fn access_token_now(dir: &Path) -> Option<String> {
    let root = effective_v2_root()?;
    let t = load_tokens(dir)?;
    (t.root == root && fresh(&t, now())).then_some(t.access_token)
}

/// Refresh the access token if needed (the webview calls it before a Laya suggest in v2 mode).
#[tauri::command]
pub async fn bc_v2_ensure_token(state: State<'_, AppState>) -> Result<bool, String> {
    Ok(access_token(&data_dir(&state)).await.is_ok())
}

/// A project slug as v2 takes it.
fn project_ok(p: &str) -> bool {
    (2..=63).contains(&p.len()) && p.chars().all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-') && !p.starts_with('-')
}

/// Send a report to the v2 feedback centre as the signed-in ACCOUNT (`feedback:write`). The body
/// is the v2 contract already (bc-endpoints.ts `feedbackToV2`). Through Rust because the token
/// must not be handed to the webview. Not signed in: `Err("not_signed_in")`, and the webview
/// sends it itself with the publishable app key, as before.
#[tauri::command]
pub async fn bc_v2_feedback_send(state: State<'_, AppState>, project: String, body: Value) -> Result<Value, String> {
    if !project_ok(&project) {
        return Err("bad_project".into());
    }
    let root = effective_v2_root().ok_or("not_v2")?;
    let token = access_token(&data_dir(&state)).await?;
    let resp = v2_client(30)?
        .post(format!("{root}/v2/projects/{project}/feedback"))
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .json(&body)
        .send()
        .await
        .map_err(|_| "offline".to_string())?;
    let status = resp.status().as_u16();
    let answer: Value = resp.json().await.unwrap_or(Value::Null);
    Ok(json!({ "status": status, "body": answer }))
}

/// The account's notifications from v2's compatibility path (ADR 0023: `GET /api/v1/notifications`
/// with a `notifications:read` token), in v1's shape: the poller (bcweb-notifications.ts) reads it
/// unchanged. Errors are the poller's vocabulary: `no_key` (not signed in), `bad_key` (refused).
#[tauri::command]
pub async fn bc_v2_notifications(state: State<'_, AppState>, since: Option<String>) -> Result<String, String> {
    let root = effective_v2_root().ok_or("no_key")?;
    let token = access_token(&data_dir(&state)).await.map_err(|e| if e == "offline" { e } else { "no_key".to_string() })?;
    let mut url = reqwest::Url::parse(&format!("{root}/api/v1/notifications")).map_err(|e| e.to_string())?;
    if let Some(s) = since.as_deref().map(str::trim).filter(|s| !s.is_empty() && s.len() <= 40) {
        url.query_pairs_mut().append_pair("since", s);
    }
    let resp = v2_client(15)?
        .get(url)
        .header(reqwest::header::AUTHORIZATION, format!("Bearer {token}"))
        .send()
        .await
        .map_err(|_| "offline".to_string())?;
    match resp.status().as_u16() {
        200 => resp.text().await.map_err(|e| e.to_string()),
        401 | 403 => Err("bad_key".into()),
        s => Err(format!("http_{s}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_token_endpoint_answers_drive_the_device_flow() {
        let ok = json!({ "access_token": "bc_at_x", "token_type": "Bearer", "expires_in": 900, "scope": "openid", "refresh_token": "bc_rt_y" });
        assert_eq!(token_answer(200, &ok), TokenAnswer::Tokens("bc_at_x".into(), "bc_rt_y".into(), 900, "openid".into()));
        assert_eq!(token_answer(400, &json!({ "error": "authorization_pending" })), TokenAnswer::Pending);
        assert_eq!(token_answer(400, &json!({ "error": "slow_down" })), TokenAnswer::SlowDown);
        assert_eq!(token_answer(400, &json!({ "error": "access_denied" })), TokenAnswer::Denied);
        assert_eq!(token_answer(400, &json!({ "error": "expired_token" })), TokenAnswer::Expired);
        assert_eq!(token_answer(400, &json!({ "error": "invalid_grant" })), TokenAnswer::Expired);
        assert_eq!(token_answer(401, &json!({ "error": "invalid_client" })), TokenAnswer::Failed("invalid_client".into()));
        assert_eq!(token_answer(502, &Value::Null), TokenAnswer::Failed("http_502".into()));
    }

    #[test]
    fn a_token_answer_without_a_bearer_token_is_refused() {
        assert!(matches!(token_answer(200, &json!({ "token_type": "Bearer" })), TokenAnswer::Failed(_)));
        assert!(matches!(token_answer(200, &json!({ "access_token": "x", "token_type": "mac" })), TokenAnswer::Failed(_)));
        // a silly lifetime is bounded
        let TokenAnswer::Tokens(_, _, exp, _) = token_answer(200, &json!({ "access_token": "x", "token_type": "bearer", "expires_in": 1 })) else { panic!() };
        assert_eq!(exp, 30);
    }

    #[test]
    fn a_token_is_refreshed_a_minute_before_it_expires() {
        let t = Tokens { access_token: "a".into(), expires_at: 1_000, ..Default::default() };
        assert!(fresh(&t, 900));
        assert!(!fresh(&t, 950));
        assert!(!fresh(&Tokens { expires_at: 10_000, ..Default::default() }, 0), "no token is not fresh");
    }

    #[test]
    fn the_verification_page_stays_on_the_v2_host() {
        assert!(verification_ok("https://bettercommunity.ch/device?code=ABCD", "https://bettercommunity.ch"));
        assert!(!verification_ok("https://evil.example/device", "https://bettercommunity.ch"));
        assert!(!verification_ok("http://bettercommunity.ch/device", "https://bettercommunity.ch"));
        assert!(!verification_ok("https://user@bettercommunity.ch/device", "https://bettercommunity.ch"));
        assert!(verification_ok("http://localhost:5176/device", "http://localhost:5176"));
    }

    #[test]
    fn the_webview_never_sees_a_token() {
        let t = Tokens { access_token: "bc_at_secret".into(), refresh_token: "bc_rt_secret".into(), expires_at: now() + 600, root: "https://v2".into(), name: "Ann".into(), ..Default::default() };
        let v = status_view(Some(&t), "dpapi", Some("https://v2")).to_string();
        assert!(!v.contains("secret"), "{v}");
        assert!(v.contains("\"here\":true"));
        assert!(status_view(Some(&t), "dpapi", Some("https://other")).to_string().contains("\"here\":false"));
    }

    #[test]
    fn nothing_happens_outside_v2_mode() {
        // the runtime is v1 in tests: no root, no client
        assert_eq!(v2_and_client().unwrap_err(), "not_v2");
        assert_eq!(access_token_now(Path::new(".")), None);
    }

    #[test]
    fn the_project_slug_is_checked() {
        assert!(project_ok("bmm"));
        assert!(!project_ok("b"));
        assert!(!project_ok("../x"));
        assert!(!project_ok("BMM"));
    }

    #[test]
    fn the_scopes_are_the_ones_bmm_uses() {
        for s in ["feedback:write", "notifications:read", "consents:write", "ai:classify", "offline_access"] {
            assert!(SCOPES.split(' ').any(|x| x == s), "{s}");
        }
        assert!(!SCOPES.contains("repos:"), "not asked until BMM reads protected repos with it");
    }
}
