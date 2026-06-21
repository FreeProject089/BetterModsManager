//! BMM Telemetry Dashboard — Axum + Postgres collector & API.
//! Data persists in Postgres, so a server restart keeps every past event.
#![recursion_limit = "512"]

mod config;
mod db;
mod geo;
mod state;
mod stats;

use axum::{
    extract::{ConnectInfo, DefaultBodyLimit, Path, Query, State},
    http::{header, HeaderMap, StatusCode, Uri},
    middleware::Next,
    response::sse::{Event, KeepAlive, Sse},
    response::{Html, IntoResponse, Response},
    routing::{delete, get, post},
    Json, Router,
};
use std::net::SocketAddr;
use config::Config;
use futures::stream::{self, Stream, StreamExt};
use serde_json::{json, Value};
use state::{AppState, Shared};
use std::collections::HashMap;
use std::convert::Infallible;
use std::sync::atomic::Ordering;
use std::time::Duration;
use tokio_stream::wrappers::BroadcastStream;
use tower_http::compression::CompressionLayer;
use tower_http::cors::CorsLayer;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,sqlx=warn".into()),
        )
        .init();

    let cfg = Config::from_env();
    let pool = sqlx::postgres::PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(10))
        .connect(&cfg.database_url)
        .await?;
    sqlx::migrate!("./migrations").run(&pool).await?;

    let st = AppState::new(pool, cfg.clone());

    // initial compute
    refresh(&st).await;

    // background loops
    spawn_loops(st.clone());

    // Viewer routes expose collected data → gated behind the PRIVATE admin key
    // (header X-Admin-Key or ?key=). Without it, nothing can be read.
    let viewer = Router::new()
        .route("/api/stats", get(get_stats))
        .route("/api/stream", get(stream_handler))
        .route("/api/sessions", get(get_sessions))
        .route("/api/funnel", post(post_funnel))
        .route("/api/journeys", post(post_journeys))
        .route("/api/goals", get(get_goals).post(post_goal))
        .route("/api/goals/:id", delete(del_goal))
        .route("/api/event", get(get_event))
        .route("/api/user", get(get_user))
        .route("/api/replay", get(get_replay))
        .route("/api/admin/deletions", get(admin_deletions))
        .route("/api/admin/decide", post(admin_decide))
        .route("/api/admin/storage", get(admin_storage))
        .route("/api/admin/storage-limit", post(admin_storage_limit))
        .route("/api/admin/audit", get(admin_audit))
        .route("/api/admin/replay/download", get(admin_replay_download))
        .route("/api/admin/replay", delete(admin_replay_delete))
        .route("/api/admin/packet/delete", post(admin_packet_delete))
        .route("/api/admin/backup", get(admin_backup))
        .route("/api/admin/import", post(admin_import))
        .route("/api/admin/recap", get(admin_recap_gen).delete(admin_recap_delete))
        .route("/api/admin/recaps", get(admin_recaps_list))
        .route("/api/admin/recap/get", get(admin_recap_get))
        .route("/api/admin/recap/import", post(admin_recap_import))
        .route("/api/admin/data-requests", get(admin_data_requests))
        .route("/api/admin/data-request/decide", post(admin_data_request_decide))
        .route_layer(axum::middleware::from_fn_with_state(st.clone(), require_viewer));

    // Public routes: ingest (public api_key) + client-facing helpers + the SPA
    // shell. These expose no collected data.
    let public = Router::new()
        .route("/batch", post(ingest_handler))
        .route("/batch/", post(ingest_handler))
        .route("/capture/", post(ingest_handler))
        .route("/delete-request", post(delete_request))
        .route("/data-request", post(data_request))
        .route("/api/packet-status", get(packet_status))
        .fallback(static_or_spa);

    let app = viewer
        .merge(public)
        .layer(DefaultBodyLimit::max(32 * 1024 * 1024)) // rrweb full snapshots can be large
        .layer(tower_http::decompression::RequestDecompressionLayer::new()) // accept gzip'd uploads
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
        .with_state(st.clone());

    let addr = format!("0.0.0.0:{}", cfg.port);
    let app = app.into_make_service_with_connect_info::<SocketAddr>();
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    println!("\n  BMM Telemetry Dashboard (Axum + Postgres)");
    println!("  ──────────────────────────────────────────");
    println!("  Listening : http://localhost:{}", cfg.port);
    println!("  Ingest    : POST /batch/");
    println!("  Retention : {}d · erase delay {}h", cfg.retention_days, cfg.delete_delay_h);
    println!(
        "  Admin     : {}\n",
        if cfg.admin_key.is_empty() { "set ADMIN_KEY to enable approvals" } else { "enabled (X-Admin-Key)" }
    );
    axum::serve(listener, app).await?;
    Ok(())
}

async fn refresh(st: &Shared) {
    let payload = stats::compute_stats(&st.pool, &st.cfg).await;
    {
        let mut c = st.cache.write().await;
        *c = payload.clone();
    }
    let _ = st.tx.send(payload.to_string());
}

fn spawn_loops(st: Shared) {
    // slow heartbeat recompute — only refreshes the time-relative fields (live
    // status, "x ago") for connected viewers. Skipped when nobody is watching the
    // SSE stream: new ingested data still refreshes via the 1.2s `dirty` loop, so
    // pollers get fresh data, and an idle server stops rebuilding the big payload
    // every 15s (saves CPU + transient allocations / RAM).
    {
        let st = st.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(15));
            loop {
                iv.tick().await;
                if st.tx.receiver_count() > 0 { refresh(&st).await; }
            }
        });
    }
    // prompt refresh after new data (≤1.2s)
    {
        let st = st.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_millis(1200));
            loop {
                iv.tick().await;
                if st.dirty.swap(false, Ordering::Relaxed) {
                    refresh(&st).await;
                }
            }
        });
    }
    // maintenance: due deletions, retention purge, crash sweep
    {
        let st = st.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(3600));
            loop {
                iv.tick().await;
                db::run_due_deletions(&st.pool).await;
                db::purge_retention(&st.pool, st.cfg.retention_days).await;
                db::sweep_crashes(&st.pool, 180_000).await;
                db::compact_replays(&st.pool).await; // merge closed sessions' chunks
            }
        });
    }
    // fast crash sweep so a hung/crashed instance flips status quickly
    {
        let st = st.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(30));
            loop {
                iv.tick().await;
                db::sweep_crashes(&st.pool, 180_000).await;
            }
        });
    }
    // storage hard-cap guard: enforce the size limit every 5 min (not hourly), so
    // a burst can't blow past the cap and sit there until the next retention pass.
    {
        let st = st.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(300));
            loop {
                iv.tick().await;
                // Soft = the admin-set limit (persisted); hard = soft +20% trigger,
                // so a burst is purged back to the limit within minutes — not at the
                // next hourly retention pass.
                let soft = db::get_meta_i64(&st.pool, "storage_limit_mb", st.cfg.soft_db_mb).await;
                let hard = soft + soft / 5;
                let n = db::enforce_size_cap(&st.pool, soft, hard).await;
                if n > 0 { st.dirty.store(true, Ordering::Relaxed); }
            }
        });
    }
    // run due deletions + purge once at boot
    tokio::spawn(async move {
        db::run_due_deletions(&st.pool).await;
        db::purge_retention(&st.pool, st.cfg.retention_days).await;
    });
}

// Gate for data-viewing routes: requires the private admin key (X-Admin-Key
// header or ?key=/?admin_key= query). If ADMIN_KEY is unset, the dashboard runs
// open (dev only) — set it in production to make the dashboard fully private.
async fn require_viewer(State(st): State<Shared>, req: axum::extract::Request, next: Next) -> Response {
    if st.cfg.admin_key.is_empty() {
        return next.run(req).await;
    }
    let header_ok = req.headers().get("X-Admin-Key").and_then(|v| v.to_str().ok()) == Some(st.cfg.admin_key.as_str());
    let query_ok = req.uri().query().map(|q| {
        q.split('&').any(|kv| {
            let mut it = kv.splitn(2, '=');
            matches!((it.next(), it.next()), (Some("key") | Some("admin_key"), Some(v)) if v == st.cfg.admin_key)
        })
    }).unwrap_or(false);
    if header_ok || query_ok {
        next.run(req).await
    } else {
        (StatusCode::UNAUTHORIZED, Json(json!({ "error": "unauthorized" }))).into_response()
    }
}

// ── helpers ─────────────────────────────────────────────────────────────────
fn ok_key(cfg: &Config, k: Option<&str>) -> bool {
    cfg.api_key.is_empty() || k == Some(cfg.api_key.as_str())
}
fn is_admin(cfg: &Config, headers: &HeaderMap, q: &HashMap<String, String>, body: &Value) -> bool {
    if cfg.admin_key.is_empty() {
        return false;
    }
    let h = headers.get("X-Admin-Key").and_then(|v| v.to_str().ok());
    h == Some(cfg.admin_key.as_str())
        || q.get("admin_key").map(String::as_str) == Some(cfg.admin_key.as_str())
        || body.get("admin_key").and_then(Value::as_str) == Some(cfg.admin_key.as_str())
}

// ── handlers ────────────────────────────────────────────────────────────────
async fn ingest_handler(
    State(st): State<Shared>,
    ConnectInfo(addr): ConnectInfo<SocketAddr>,
    headers: HeaderMap,
    Json(doc): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if !ok_key(&st.cfg, doc.get("api_key").and_then(Value::as_str)) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "bad key" })));
    }
    let ip = client_ip(&headers, addr);
    // Per-IP rate limit so a single client can't spam / exhaust resources.
    if let Some(ip) = &ip {
        if !st.allow(ip, st.cfg.rate_per_min) {
            return (StatusCode::TOO_MANY_REQUESTS, Json(json!({ "error": "rate limited", "retry_after_s": 1 })));
        }
    }
    let pid = doc.get("packet_id").and_then(Value::as_str).unwrap_or("").to_string();
    let batch: Vec<Value> = if let Some(arr) = doc.get("batch").and_then(Value::as_array) {
        arr.clone()
    } else if doc.get("event").is_some() {
        vec![doc.clone()]
    } else {
        vec![]
    };
    // Reject oversized batches (cheap protection against memory abuse).
    if batch.len() > st.cfg.max_batch {
        return (StatusCode::PAYLOAD_TOO_LARGE, Json(json!({ "error": "batch too large", "max": st.cfg.max_batch })));
    }
    let n = batch.len();
    for ev in &batch {
        db::ingest(&st, ev, &pid, true).await;
    }
    // Capture the request IP server-side and resolve geo from it (no reliance on
    // the client self-reporting its IP).
    if let Some(ip) = ip {
        let mut seen = std::collections::HashSet::new();
        for ev in &batch {
            if let Some(d) = ev.get("distinct_id").and_then(Value::as_str) {
                if seen.insert(d.to_string()) {
                    db::record_user_ip(&st, d, &ip).await;
                }
            }
        }
    }
    st.dirty.store(true, Ordering::Relaxed);
    (StatusCode::OK, Json(json!({ "status": 1, "received": n, "packet_id": pid })))
}

// Best source IP for the request: first X-Forwarded-For hop (ngrok/proxy), then
// X-Real-IP, then the socket peer.
fn client_ip(headers: &HeaderMap, addr: SocketAddr) -> Option<String> {
    if let Some(xff) = headers.get("x-forwarded-for").and_then(|v| v.to_str().ok()) {
        if let Some(first) = xff.split(',').next() {
            let ip = first.trim();
            if !ip.is_empty() {
                return Some(ip.to_string());
            }
        }
    }
    if let Some(xr) = headers.get("x-real-ip").and_then(|v| v.to_str().ok()) {
        if !xr.trim().is_empty() {
            return Some(xr.trim().to_string());
        }
    }
    Some(addr.ip().to_string())
}

async fn post_journeys(State(st): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let steps = body.get("steps").and_then(Value::as_u64).unwrap_or(4) as usize;
    let limit = body.get("limit").and_then(Value::as_u64).unwrap_or(50) as usize;
    let filters: Vec<String> = body
        .get("filters")
        .and_then(Value::as_array)
        .map(|a| a.iter().map(|v| v.as_str().unwrap_or("").to_string()).collect())
        .unwrap_or_default();
    Json(db::journeys(&st.pool, steps, limit, &filters).await)
}

async fn delete_request(State(st): State<Shared>, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    if !ok_key(&st.cfg, body.get("api_key").and_then(Value::as_str)) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "bad key" })));
    }
    let pid = match body.get("packet_id").and_then(Value::as_str) {
        Some(p) if !p.is_empty() => p.to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "missing packet_id" }))),
    };
    let row = db::request_deletion(&st.pool, &pid, st.cfg.delete_delay_h).await;
    (StatusCode::OK, Json(json!({ "status": 1, "scheduled_at": row["scheduled_at"], "delay_hours": st.cfg.delete_delay_h })))
}

// Public: a user files a GDPR data-access request (admin reviews + e-mails manually).
async fn data_request(State(st): State<Shared>, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    if !ok_key(&st.cfg, body.get("api_key").and_then(Value::as_str)) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "bad key" })));
    }
    let creator = body.get("creator_id").and_then(Value::as_str).unwrap_or("").to_string();
    let email = match body.get("email").and_then(Value::as_str) {
        Some(e) if e.contains('@') && e.len() >= 5 => e.to_string(),
        _ => return (StatusCode::BAD_REQUEST, Json(json!({ "error": "missing/invalid email" }))),
    };
    let row = db::insert_data_request(&st.pool, &creator, &email).await;
    (StatusCode::OK, Json(json!({ "status": 1, "id": row["id"] })))
}

// Admin: list pending data-access requests.
async fn admin_data_requests(State(st): State<Shared>) -> Json<Value> {
    Json(db::list_data_requests(&st.pool).await)
}
// Admin: mark a data-access request done/rejected.
async fn admin_data_request_decide(State(st): State<Shared>, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    let id = body.get("id").and_then(Value::as_i64).unwrap_or(0);
    let status = body.get("status").and_then(Value::as_str).unwrap_or("done");
    let status = if status == "rejected" { "rejected" } else { "done" };
    let ok = db::decide_data_request(&st.pool, id, status).await;
    (StatusCode::OK, Json(json!({ "ok": ok })))
}

async fn get_stats(State(st): State<Shared>) -> Json<Value> {
    Json(st.cache.read().await.clone())
}

// Serve a static asset if it exists, otherwise return index.html (HTTP 200) so
// client-side routes survive a hard refresh. Replaces ServeDir so we fully
// control the status code (ServeDir forces 404 on its not-found service).
async fn static_or_spa(State(st): State<Shared>, uri: Uri) -> impl IntoResponse {
    let dir = st.cfg.static_dir.trim_end_matches('/');
    let rel = uri.path().trim_start_matches('/');
    // refuse path traversal
    if rel.split('/').any(|seg| seg == "..") {
        return (StatusCode::BAD_REQUEST, "bad path").into_response();
    }
    if !rel.is_empty() {
        let candidate = format!("{}/{}", dir, rel);
        if let Ok(bytes) = tokio::fs::read(&candidate).await {
            let mime = mime_for(&candidate);
            return ([(header::CONTENT_TYPE, mime)], bytes).into_response();
        }
    }
    match tokio::fs::read_to_string(format!("{}/index.html", dir)).await {
        Ok(html) => Html(html).into_response(),
        Err(_) => (StatusCode::NOT_FOUND, "not found").into_response(),
    }
}

fn mime_for(path: &str) -> &'static str {
    match path.rsplit('.').next().unwrap_or("") {
        "html" => "text/html; charset=utf-8",
        "js" | "mjs" => "text/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "json" | "map" => "application/json; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "ico" => "image/x-icon",
        "woff2" => "font/woff2",
        "woff" => "font/woff",
        "wasm" => "application/wasm",
        _ => "application/octet-stream",
    }
}

async fn stream_handler(State(st): State<Shared>) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let initial = st.cache.read().await.clone();
    let rx = st.tx.subscribe();
    let head = stream::once(async move { Ok(Event::default().data(initial.to_string())) });
    let tail = BroadcastStream::new(rx).filter_map(|msg| async move {
        match msg {
            Ok(s) => Some(Ok(Event::default().data(s))),
            Err(_) => None,
        }
    });
    Sse::new(head.chain(tail)).keep_alive(KeepAlive::new().interval(Duration::from_secs(15)))
}

async fn get_sessions(State(st): State<Shared>) -> Json<Value> {
    Json(json!({ "sessions": db::sessions_list(&st.pool, 80).await }))
}

async fn get_replay(State(st): State<Shared>, Query(q): Query<HashMap<String, String>>) -> (StatusCode, Json<Value>) {
    let sid = q.get("session_id").cloned().unwrap_or_default();
    if sid.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "session_id required" })));
    }
    (StatusCode::OK, Json(db::replay_events(&st.pool, &sid).await))
}

// Admin identity for the audit trail: request IP (server-observed) + the
// dashboard-supplied browser fingerprint header.
fn admin_identity(headers: &HeaderMap, addr: SocketAddr) -> (String, String) {
    let ip = client_ip(headers, addr).unwrap_or_default();
    let fp = headers.get("x-admin-fp").and_then(|v| v.to_str().ok()).unwrap_or("").to_string();
    (ip, fp)
}

async fn admin_storage(State(st): State<Shared>) -> Json<Value> {
    Json(db::storage_overview(&st.pool).await)
}

async fn admin_storage_limit(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<Value>,
) -> Json<Value> {
    let mb = body.get("limit_mb").and_then(Value::as_i64).unwrap_or(0).max(128);
    db::set_meta(&st.pool, "storage_limit_mb", &mb.to_string()).await;
    // Apply NOW: purge straight down to the new limit (no waiting for a loop).
    let deleted = db::enforce_size_cap(&st.pool, mb, mb).await;
    let (ip, fp) = admin_identity(&headers, addr);
    db::audit(&st.pool, "storage_limit", &format!("{mb} MB"), &ip, &fp, json!({ "deleted_rows": deleted })).await;
    st.dirty.store(true, Ordering::Relaxed);
    Json(json!({ "status": 1, "limit_mb": mb, "deleted_rows": deleted }))
}

async fn admin_audit(State(st): State<Shared>) -> Json<Value> {
    Json(json!({ "audit": db::list_audit(&st.pool, 500).await }))
}

async fn admin_replay_download(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(q): Query<HashMap<String, String>>,
) -> (StatusCode, Json<Value>) {
    let sid = q.get("session_id").cloned().unwrap_or_default();
    if sid.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "session_id required" })));
    }
    let (ip, fp) = admin_identity(&headers, addr);
    db::audit(&st.pool, "replay_download", &sid, &ip, &fp, json!({})).await;
    (StatusCode::OK, Json(db::replay_events(&st.pool, &sid).await))
}

async fn admin_replay_delete(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(q): Query<HashMap<String, String>>,
) -> (StatusCode, Json<Value>) {
    let sid = q.get("session_id").cloned().unwrap_or_default();
    if sid.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "session_id required" })));
    }
    let n = db::delete_replay_session(&st.pool, &sid).await;
    let (ip, fp) = admin_identity(&headers, addr);
    db::audit(&st.pool, "replay_delete", &sid, &ip, &fp, json!({ "chunks": n })).await;
    st.dirty.store(true, Ordering::Relaxed);
    (StatusCode::OK, Json(json!({ "ok": true, "deleted_chunks": n })))
}

async fn admin_packet_delete(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let pid = body.get("packet_id").and_then(Value::as_str).unwrap_or("").to_string();
    if pid.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "packet_id required" })));
    }
    let n = db::erase_packet(&st.pool, &pid).await;
    let (ip, fp) = admin_identity(&headers, addr);
    db::audit(&st.pool, "packet_delete", &pid, &ip, &fp, json!({ "rows": n })).await;
    st.dirty.store(true, Ordering::Relaxed);
    (StatusCode::OK, Json(json!({ "ok": true, "erased": n })))
}

async fn admin_backup(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
) -> Json<Value> {
    let (ip, fp) = admin_identity(&headers, addr);
    db::audit(&st.pool, "backup_export", "database", &ip, &fp, json!({})).await;
    Json(db::export_backup(&st.pool).await)
}

async fn admin_import(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    let res = db::import_backup(&st.pool, &body).await;
    let (ip, fp) = admin_identity(&headers, addr);
    db::audit(&st.pool, "backup_import", "database", &ip, &fp, res.clone()).await;
    st.dirty.store(true, Ordering::Relaxed);
    (StatusCode::OK, Json(res))
}

// ── Monthly recaps ─────────────────────────────────────────────────────────────
async fn admin_recap_gen(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(q): Query<HashMap<String, String>>,
) -> Json<Value> {
    let month = q.get("month").cloned().filter(|m| !m.is_empty())
        .unwrap_or_else(|| chrono::Utc::now().format("%Y-%m").to_string());
    let anon = matches!(q.get("anon").map(String::as_str), Some("1") | Some("true"));
    let recap = db::generate_recap(&st.pool, &month, anon).await;
    // Persist unless save=0; record who generated it.
    let saved_id = if q.get("save").map(String::as_str) != Some("0") {
        db::save_recap(&st.pool, &recap, "generated").await
    } else { 0 };
    let (ip, fp) = admin_identity(&headers, addr);
    db::audit(&st.pool, "recap_export", &month, &ip, &fp, json!({ "anon": anon, "saved_id": saved_id })).await;
    Json(json!({ "ok": true, "id": saved_id, "recap": recap }))
}

async fn admin_recaps_list(State(st): State<Shared>) -> Json<Value> {
    Json(json!({ "recaps": db::list_recaps(&st.pool).await }))
}

async fn admin_recap_get(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(q): Query<HashMap<String, String>>,
) -> (StatusCode, Json<Value>) {
    let id: i64 = q.get("id").and_then(|s| s.parse().ok()).unwrap_or(0);
    match db::get_recap(&st.pool, id).await {
        Some(data) => {
            let (ip, fp) = admin_identity(&headers, addr);
            db::audit(&st.pool, "recap_export", &format!("recap#{id}"), &ip, &fp, json!({})).await;
            (StatusCode::OK, Json(data))
        }
        None => (StatusCode::NOT_FOUND, Json(json!({ "error": "not found" }))),
    }
}

async fn admin_recap_import(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Json(body): Json<Value>,
) -> (StatusCode, Json<Value>) {
    if body.get("month").is_none() && body.get("totals").is_none() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "not a recap document" })));
    }
    let id = db::import_recap(&st.pool, &body).await;
    let (ip, fp) = admin_identity(&headers, addr);
    db::audit(&st.pool, "recap_import", &body.get("month").and_then(Value::as_str).unwrap_or("?").to_string(), &ip, &fp, json!({ "id": id })).await;
    (StatusCode::OK, Json(json!({ "ok": true, "id": id })))
}

async fn admin_recap_delete(
    State(st): State<Shared>, headers: HeaderMap, ConnectInfo(addr): ConnectInfo<SocketAddr>,
    Query(q): Query<HashMap<String, String>>,
) -> (StatusCode, Json<Value>) {
    let id: i64 = q.get("id").and_then(|s| s.parse().ok()).unwrap_or(0);
    let n = db::delete_recap(&st.pool, id).await;
    let (ip, fp) = admin_identity(&headers, addr);
    db::audit(&st.pool, "recap_delete", &format!("recap#{id}"), &ip, &fp, json!({})).await;
    (StatusCode::OK, Json(json!({ "ok": true, "deleted": n })))
}

async fn post_funnel(State(st): State<Shared>, Json(body): Json<Value>) -> Json<Value> {
    let steps: Vec<String> = body
        .get("steps")
        .and_then(Value::as_array)
        .map(|a| a.iter().filter_map(|v| v.as_str().map(String::from)).collect())
        .unwrap_or_default();
    Json(db::funnel(&st.pool, &steps).await)
}

async fn get_goals(State(st): State<Shared>) -> Json<Value> {
    Json(json!({ "goals": db::list_goals(&st.pool).await }))
}
async fn post_goal(State(st): State<Shared>, headers: HeaderMap, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    if !is_admin(&st.cfg, &headers, &HashMap::new(), &body) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "admin key required" })));
    }
    let name = body.get("name").and_then(Value::as_str).unwrap_or("");
    let target = body.get("target").and_then(Value::as_str).unwrap_or("");
    if name.is_empty() || target.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad" })));
    }
    let typ = match body.get("type").and_then(Value::as_str) {
        Some("page") => "page",
        Some("modal") => "modal",
        Some("feature") => "feature",
        _ => "event",
    };
    let target_count = body.get("target_count").and_then(Value::as_i64).unwrap_or(1).max(1);
    db::add_goal(&st.pool, name, typ, target, target_count).await;
    refresh(&st).await;
    (StatusCode::OK, Json(json!({ "status": 1 })))
}
async fn del_goal(State(st): State<Shared>, headers: HeaderMap, Path(id): Path<i64>) -> (StatusCode, Json<Value>) {
    if !is_admin(&st.cfg, &headers, &HashMap::new(), &Value::Null) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "admin key required" })));
    }
    db::del_goal(&st.pool, id).await;
    refresh(&st).await;
    (StatusCode::OK, Json(json!({ "status": 1 })))
}

async fn packet_status(State(st): State<Shared>, Query(q): Query<HashMap<String, String>>) -> Json<Value> {
    let ids: Vec<String> = q
        .get("ids")
        .map(|s| s.split(',').map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).take(200).collect())
        .unwrap_or_default();
    Json(json!({ "statuses": db::packet_statuses(&st.pool, &ids).await }))
}

async fn get_event(State(st): State<Shared>, Query(q): Query<HashMap<String, String>>) -> (StatusCode, Json<Value>) {
    let name = q.get("name").cloned().unwrap_or_default();
    if name.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "name required" })));
    }
    let limit = q.get("limit").and_then(|s| s.parse().ok()).unwrap_or(60);
    (StatusCode::OK, Json(json!({ "event": name, "occurrences": db::event_occurrences(&st.pool, &name, limit).await })))
}

async fn get_user(State(st): State<Shared>, Query(q): Query<HashMap<String, String>>) -> (StatusCode, Json<Value>) {
    let id = q.get("id").cloned().unwrap_or_default();
    if id.is_empty() {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "id required" })));
    }
    (StatusCode::OK, Json(json!({ "id": id, "sessions": db::user_journey(&st.pool, &id).await })))
}

async fn admin_deletions(State(st): State<Shared>, headers: HeaderMap) -> (StatusCode, Json<Value>) {
    if !is_admin(&st.cfg, &headers, &HashMap::new(), &Value::Null) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "admin key required" })));
    }
    (StatusCode::OK, Json(json!({ "deletions": db::list_deletions(&st.pool).await, "delay_hours": st.cfg.delete_delay_h })))
}
async fn admin_decide(State(st): State<Shared>, headers: HeaderMap, Json(body): Json<Value>) -> (StatusCode, Json<Value>) {
    if !is_admin(&st.cfg, &headers, &HashMap::new(), &body) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "admin key required" })));
    }
    let pid = body.get("packet_id").and_then(Value::as_str).unwrap_or("");
    let action = body.get("action").and_then(Value::as_str).unwrap_or("");
    if pid.is_empty() || !["approve", "reject"].contains(&action) {
        return (StatusCode::BAD_REQUEST, Json(json!({ "error": "bad request" })));
    }
    let row = db::decide_deletion(&st.pool, pid, action, "dashboard").await;
    refresh(&st).await;
    (StatusCode::OK, Json(json!({ "status": 1, "deletion": row })))
}
