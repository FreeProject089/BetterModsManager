//! BMM Telemetry Dashboard — Axum + Postgres collector & API.
//! Data persists in Postgres, so a server restart keeps every past event.

mod config;
mod db;
mod geo;
mod state;
mod stats;

use axum::{
    extract::{Path, Query, State},
    http::{header, HeaderMap, StatusCode, Uri},
    response::sse::{Event, KeepAlive, Sse},
    response::{Html, IntoResponse},
    routing::{delete, get, post},
    Json, Router,
};
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

    let app = Router::new()
        .route("/batch", post(ingest_handler))
        .route("/batch/", post(ingest_handler))
        .route("/capture/", post(ingest_handler))
        .route("/delete-request", post(delete_request))
        .route("/api/stats", get(get_stats))
        .route("/api/stream", get(stream_handler))
        .route("/api/sessions", get(get_sessions))
        .route("/api/funnel", post(post_funnel))
        .route("/api/goals", get(get_goals).post(post_goal))
        .route("/api/goals/:id", delete(del_goal))
        .route("/api/packet-status", get(packet_status))
        .route("/api/event", get(get_event))
        .route("/api/user", get(get_user))
        .route("/api/admin/deletions", get(admin_deletions))
        .route("/api/admin/decide", post(admin_decide))
        // Static assets + SPA fallback (index.html with HTTP 200) so a hard
        // refresh on /users/:id etc. never 404s.
        .fallback(static_or_spa)
        .layer(CompressionLayer::new())
        .layer(CorsLayer::permissive())
        .with_state(st.clone());

    let addr = format!("0.0.0.0:{}", cfg.port);
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
    // slow heartbeat recompute
    {
        let st = st.clone();
        tokio::spawn(async move {
            let mut iv = tokio::time::interval(Duration::from_secs(15));
            loop {
                iv.tick().await;
                refresh(&st).await;
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
    // run due deletions + purge once at boot
    tokio::spawn(async move {
        db::run_due_deletions(&st.pool).await;
        db::purge_retention(&st.pool, st.cfg.retention_days).await;
    });
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
async fn ingest_handler(State(st): State<Shared>, Json(doc): Json<Value>) -> (StatusCode, Json<Value>) {
    if !ok_key(&st.cfg, doc.get("api_key").and_then(Value::as_str)) {
        return (StatusCode::UNAUTHORIZED, Json(json!({ "error": "bad key" })));
    }
    let pid = doc.get("packet_id").and_then(Value::as_str).unwrap_or("").to_string();
    let batch: Vec<Value> = if let Some(arr) = doc.get("batch").and_then(Value::as_array) {
        arr.clone()
    } else if doc.get("event").is_some() {
        vec![doc.clone()]
    } else {
        vec![]
    };
    let n = batch.len();
    for ev in &batch {
        db::ingest(&st, ev, &pid, true).await;
    }
    st.dirty.store(true, Ordering::Relaxed);
    (StatusCode::OK, Json(json!({ "status": 1, "received": n, "packet_id": pid })))
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
    db::add_goal(&st.pool, name, typ, target).await;
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
