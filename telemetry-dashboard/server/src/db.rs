//! Postgres data layer. Mirrors the original SQLite `db.mjs`: everything is
//! derived from the `events` table, so per-packet erasure and retention are exact.

use crate::geo::{is_private_host, resolve_geo};
use crate::state::AppState;
use serde_json::{json, Map, Value};
use sqlx::PgPool;

fn now_ms() -> i64 {
    chrono::Utc::now().timestamp_millis()
}
fn parse_ts_ms(ts: &str) -> i64 {
    chrono::DateTime::parse_from_rfc3339(ts)
        .map(|d| d.timestamp_millis())
        .unwrap_or_else(|_| now_ms())
}

/// Decode a base64'd gzip blob into raw gzip bytes (kept compressed at rest).
fn decode_b64(b64: &str) -> Option<Vec<u8>> {
    use base64::Engine;
    base64::engine::general_purpose::STANDARD.decode(b64).ok()
}
/// Gunzip raw bytes into JSON (used when serving a replay).
fn gunzip_json(raw: &[u8]) -> Option<Value> {
    use std::io::Read;
    let mut gz = flate2::read::GzDecoder::new(raw);
    let mut out = Vec::new();
    gz.read_to_end(&mut out).ok()?;
    serde_json::from_slice(&out).ok()
}
/// Gzip a JSON value into raw bytes (used to compress uncompressed `d` chunks).
fn gzip_json(v: &Value) -> Vec<u8> {
    use std::io::Write;
    let bytes = serde_json::to_vec(v).unwrap_or_default();
    let mut enc = flate2::write::GzEncoder::new(Vec::new(), flate2::Compression::default());
    let _ = enc.write_all(&bytes);
    enc.finish().unwrap_or_default()
}

// ── Ingest ──────────────────────────────────────────────────────────────────
pub async fn ingest(st: &AppState, ev: &Value, packet_id: &str, realtime: bool) {
    let event = match ev.get("event").and_then(Value::as_str) {
        Some(e) if !e.is_empty() => e.to_string(),
        _ => return,
    };
    let id = ev
        .get("distinct_id")
        .and_then(Value::as_str)
        .unwrap_or("anon")
        .to_string();
    let ts = ev
        .get("timestamp")
        .and_then(Value::as_str)
        .map(|s| s.to_string())
        .unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
    let ts_ms = parse_ts_ms(&ts);
    let props = ev.get("properties").cloned().unwrap_or_else(|| json!({}));
    let pid = if packet_id.is_empty() {
        ev.get("_pid").and_then(Value::as_str).unwrap_or("")
    } else {
        packet_id
    };

    // Session replay (rrweb) chunks go to their own table, never to `events`, so
    // they stay out of every aggregation. Each chunk's `props.d` is the rrweb
    // event array; session_id/seq let the viewer reassemble + order the stream.
    if event == "$replay" {
        let sid = props.get("session_id").and_then(Value::as_str).unwrap_or("");
        let seq = props.get("seq").and_then(Value::as_i64).unwrap_or(0);
        // Store COMPRESSED at rest. Chunks already arrive gzip+base64 (`dz`) — keep
        // those bytes as-is; older/fallback clients send a raw array (`d`) which we
        // gzip ourselves.
        let gz: Vec<u8> = if let Some(dz) = props.get("dz").and_then(Value::as_str) {
            decode_b64(dz).unwrap_or_default()
        } else {
            gzip_json(&props.get("d").cloned().unwrap_or_else(|| json!([])))
        };
        let _ = sqlx::query(
            "INSERT INTO replay_chunks(packet_id,distinct_id,session_id,seq,ts_ms,gz) VALUES($1,$2,$3,$4,$5,$6)",
        )
        .bind(pid)
        .bind(&id)
        .bind(sid)
        .bind(seq)
        .bind(ts_ms)
        .bind(&gz)
        .execute(&st.pool)
        .await;
        return;
    }

    let _ = sqlx::query(
        "INSERT INTO events(packet_id,distinct_id,event,ts,ts_ms,props) VALUES($1,$2,$3,$4,$5,$6)",
    )
    .bind(pid)
    .bind(&id)
    .bind(&event)
    .bind(&ts)
    .bind(ts_ms)
    .bind(&props)
    .execute(&st.pool)
    .await;

    // geo resolution triggers
    if event == "$identify" {
        if let Some(ip) = props.get("$set").and_then(|s| s.get("public_ip")).and_then(Value::as_str) {
            resolve_geo(st.pool.clone(), st.geo_inflight.clone(), ip);
        }
    }
    if event == "repo_connect" {
        if let Some(host) = props.get("host").and_then(Value::as_str) {
            if !is_private_host(&host.to_lowercase()) {
                resolve_geo(st.pool.clone(), st.geo_inflight.clone(), host);
            }
        }
    }
    if event == "benchmark" {
        let ops = props.get("ops").cloned().unwrap_or_else(|| json!({}));
        let _ = sqlx::query(
            "INSERT INTO benchmarks(packet_id,distinct_id,ts,ts_ms,total_ms,dataset_bytes,source,ops)
             VALUES($1,$2,$3,$4,$5,$6,$7,$8)",
        )
        .bind(pid)
        .bind(&id)
        .bind(&ts)
        .bind(ts_ms)
        .bind(props.get("total_ms").and_then(Value::as_f64))
        .bind(props.get("dataset_bytes").and_then(Value::as_i64))
        .bind(props.get("source").and_then(Value::as_str))
        .bind(&ops)
        .execute(&st.pool)
        .await;
    }

    if realtime {
        update_live(st, &id, &event, &props, ts_ms).await;
    }
}

/// Persisted live instance with status & crash tracking.
async fn update_live(st: &AppState, id: &str, event: &str, props: &Value, ts_ms: i64) {
    // fields we surface on the live card
    let mut data = Map::new();
    data.insert("creator_id".into(), json!(id));
    if let Some(v) = props.get("view") {
        data.insert("view".into(), v.clone());
    }
    if event == "perf" {
        for k in ["fps_avg", "frametime_avg_ms", "js_heap_mb"] {
            if let Some(v) = props.get(k) {
                let key = match k {
                    "fps_avg" => "fps",
                    "frametime_avg_ms" => "ft",
                    _ => "heap",
                };
                data.insert(key.into(), v.clone());
            }
        }
    }
    if event == "$identify" {
        if let Some(s) = props.get("$set") {
            for (src, dst) in [
                ("gpu", "gpu"),
                ("cpu", "cpu"),
                ("ram_gb", "ram_gb"),
                ("is_vm", "is_vm"),
                ("app_version", "version"),
                ("os_caption", "os"),
                ("public_ip", "public_ip"),
            ] {
                if let Some(v) = s.get(src) {
                    data.insert(dst.into(), v.clone());
                }
            }
        }
    }
    let data_val = Value::Object(data);
    let session_id = props
        .get("session_id")
        .and_then(Value::as_str)
        .map(|s| s.to_string());

    match event {
        "session_start" => {
            let _ = sqlx::query(
                "INSERT INTO live_instances(distinct_id,last_seen,started_at,session_id,clean_exit,crashed,data)
                 VALUES($1,$2,$2,$3,false,false,$4)
                 ON CONFLICT(distinct_id) DO UPDATE SET
                   last_seen=$2, started_at=$2, session_id=$3, clean_exit=false, crashed=false,
                   data = live_instances.data || $4",
            )
            .bind(id)
            .bind(ts_ms)
            .bind(&session_id)
            .bind(&data_val)
            .execute(&st.pool)
            .await;
        }
        "session_end" => {
            let _ = sqlx::query(
                "UPDATE live_instances SET last_seen=$2, clean_exit=true, crashed=false WHERE distinct_id=$1",
            )
            .bind(id)
            .bind(ts_ms)
            .execute(&st.pool)
            .await;
        }
        _ => {
            let _ = sqlx::query(
                "INSERT INTO live_instances(distinct_id,last_seen,session_id,data)
                 VALUES($1,$2,$3,$4)
                 ON CONFLICT(distinct_id) DO UPDATE SET
                   last_seen=$2,
                   session_id=COALESCE($3, live_instances.session_id),
                   data = live_instances.data || $4",
            )
            .bind(id)
            .bind(ts_ms)
            .bind(&session_id)
            .bind(&data_val)
            .execute(&st.pool)
            .await;
        }
    }
}

/// Mark instances that went silent without a clean session_end as crashed.
pub async fn sweep_crashes(pool: &PgPool, crash_after_ms: i64) {
    let cut = now_ms() - crash_after_ms;
    let _ = sqlx::query(
        "UPDATE live_instances SET crashed=true
         WHERE clean_exit=false AND crashed=false AND last_seen < $1",
    )
    .bind(cut)
    .execute(pool)
    .await;
}

// ── Server-side IP capture + geo ────────────────────────────────────────────
pub async fn record_user_ip(st: &AppState, did: &str, ip: &str) {
    if did.is_empty() || ip.is_empty() || is_private_host(ip) {
        return;
    }
    let _ = sqlx::query(
        "INSERT INTO user_ips(distinct_id,ip,at) VALUES($1,$2,$3)
         ON CONFLICT(distinct_id) DO UPDATE SET ip=$2, at=$3",
    )
    .bind(did)
    .bind(ip)
    .bind(now_ms())
    .execute(&st.pool)
    .await;
    resolve_geo(st.pool.clone(), st.geo_inflight.clone(), ip);
}
pub async fn load_user_ips(pool: &PgPool) -> std::collections::HashMap<String, String> {
    let mut m = std::collections::HashMap::new();
    if let Ok(rows) = sqlx::query_as::<_, (String, Option<String>)>("SELECT distinct_id, ip FROM user_ips").fetch_all(pool).await {
        for (d, ip) in rows {
            if let Some(ip) = ip {
                m.insert(d, ip);
            }
        }
    }
    m
}

// ── Generic time-series bucketing (overview granularity) ────────────────────
pub async fn timeseries(pool: &PgPool, bucket_ms: i64, count: i64) -> Vec<Value> {
    let now = now_ms();
    let since = now - bucket_ms * count;
    let now_b = now / bucket_ms;
    let ev: Vec<(Option<i64>, i64, i64, i64)> = sqlx::query_as(
        "SELECT (ts_ms/$1) b, COUNT(*), COUNT(*) FILTER (WHERE event='page_enter'), COUNT(*) FILTER (WHERE event='session_start')
         FROM events WHERE ts_ms>=$2 GROUP BY b",
    )
    .bind(bucket_ms)
    .bind(since)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let us: Vec<(Option<i64>, i64)> = sqlx::query_as(
        "SELECT (ts_ms/$1) b, COUNT(DISTINCT distinct_id) FROM events WHERE ts_ms>=$2 GROUP BY b",
    )
    .bind(bucket_ms)
    .bind(since)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut emap: std::collections::HashMap<i64, (i64, i64, i64)> = std::collections::HashMap::new();
    for (b, e, pv, ss) in ev {
        if let Some(b) = b {
            emap.insert(b, (e, pv, ss));
        }
    }
    let mut umap: std::collections::HashMap<i64, i64> = std::collections::HashMap::new();
    for (b, u) in us {
        if let Some(b) = b {
            umap.insert(b, u);
        }
    }
    let day = bucket_ms >= 86_400_000;
    (0..count)
        .map(|i| {
            let b = now_b - (count - 1 - i);
            let (e, pv, ss) = emap.get(&b).copied().unwrap_or((0, 0, 0));
            let users = umap.get(&b).copied().unwrap_or(0);
            let ms = b * bucket_ms;
            let label = chrono::DateTime::from_timestamp_millis(ms)
                .map(|d| d.format(if day { "%m-%d" } else { "%H:%M" }).to_string())
                .unwrap_or_default();
            json!({ "t": label, "events": e, "pageviews": pv, "sessions": ss, "users": users })
        })
        .collect()
}

// ── Multi-step journeys (layered Sankey) ────────────────────────────────────
pub async fn journeys(pool: &PgPool, steps: usize, limit: usize, filters: &[String]) -> Value {
    let steps = steps.clamp(2, 6);
    let rows: Vec<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT props->>'session_id' sid, props->>'view' v FROM events
         WHERE event='page_enter' AND props->>'session_id' IS NOT NULL ORDER BY ts_ms ASC",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut by_sid: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (sid, v) in rows {
        if let (Some(sid), Some(v)) = (sid, v) {
            let seq = by_sid.entry(sid).or_default();
            // collapse immediate repeats so a refresh isn't a "step"
            if seq.last().map(|l| l != &v).unwrap_or(true) {
                seq.push(v);
            }
        }
    }
    let matches = |view: &str, pat: &str| pat.is_empty() || pat == "*" || pat == view || view.contains(pat);
    // count paths of length `steps`
    let mut paths: std::collections::HashMap<Vec<String>, i64> = std::collections::HashMap::new();
    for seq in by_sid.values() {
        if seq.len() < 2 {
            continue;
        }
        let path: Vec<String> = seq.iter().take(steps).cloned().collect();
        // apply per-step filters
        let ok = filters.iter().enumerate().all(|(i, f)| f.is_empty() || path.get(i).map(|v| matches(v, f)).unwrap_or(false));
        if !ok {
            continue;
        }
        *paths.entry(path).or_insert(0) += 1;
    }
    let mut sorted: Vec<(Vec<String>, i64)> = paths.into_iter().collect();
    sorted.sort_by(|a, b| b.1.cmp(&a.1));
    sorted.truncate(limit.clamp(5, 200));

    // build layered nodes/links: node name = "s{i}\u{1f}{view}", depth = i
    let mut node_set: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut links: std::collections::HashMap<(String, String), i64> = std::collections::HashMap::new();
    for (path, count) in &sorted {
        for i in 0..path.len() {
            node_set.insert(format!("s{}\u{1f}{}", i, path[i]));
            if i + 1 < path.len() {
                let a = format!("s{}\u{1f}{}", i, path[i]);
                let b = format!("s{}\u{1f}{}", i + 1, path[i + 1]);
                *links.entry((a, b)).or_insert(0) += count;
            }
        }
    }
    let nodes: Vec<Value> = node_set
        .iter()
        .map(|n| {
            let mut it = n.splitn(2, '\u{1f}');
            let depth: i64 = it.next().unwrap_or("s0").trim_start_matches('s').parse().unwrap_or(0);
            let view = it.next().unwrap_or("");
            json!({ "name": n, "depth": depth, "label": view })
        })
        .collect();
    let link_arr: Vec<Value> = links.iter().map(|((a, b), v)| json!({ "source": a, "target": b, "value": v })).collect();
    json!({ "nodes": nodes, "links": link_arr, "paths": sorted.len() })
}

// ── Retention + per-packet erasure ──────────────────────────────────────────
// ── Runtime settings (meta key/value) ─────────────────────────────────────────
pub async fn get_meta_i64(pool: &PgPool, key: &str, default: i64) -> i64 {
    sqlx::query_as::<_, (String,)>("SELECT value FROM meta WHERE key=$1")
        .bind(key).fetch_optional(pool).await.ok().flatten()
        .and_then(|r| r.0.parse::<i64>().ok()).unwrap_or(default)
}
pub async fn set_meta(pool: &PgPool, key: &str, value: &str) {
    let _ = sqlx::query("INSERT INTO meta(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2")
        .bind(key).bind(value).execute(pool).await;
}

/// Total on-disk size of the database (bytes).
pub async fn db_size_bytes(pool: &PgPool) -> i64 {
    sqlx::query_as::<_, (Option<i64>,)>("SELECT pg_database_size(current_database())")
        .fetch_optional(pool).await.ok().flatten().and_then(|r| r.0).unwrap_or(0)
}

/// Hard storage cap: if the DB exceeds `hard_mb`, IMMEDIATELY delete the oldest
/// data (replay chunks first — biggest per row — then events) in batches until
/// it's back under `soft_mb`. Returns rows removed. Runs on a fast loop so the
/// cap is enforced within minutes, not at the next hourly retention pass.
pub async fn enforce_size_cap(pool: &PgPool, soft_mb: i64, hard_mb: i64) -> u64 {
    let hard = hard_mb.max(1) * 1024 * 1024;
    let soft = soft_mb.max(1) * 1024 * 1024;
    if db_size_bytes(pool).await <= hard { return 0; }
    let mut removed = 0u64;
    // Bounded loop so a runaway can't spin forever; VACUUM-free size estimate
    // updates between batches.
    for _ in 0..200 {
        if db_size_bytes(pool).await <= soft { break; }
        // Oldest replay chunks are the heaviest — trim those first.
        let r = sqlx::query(
            "DELETE FROM replay_chunks WHERE id IN (SELECT id FROM replay_chunks ORDER BY ts_ms ASC LIMIT 2000)",
        ).execute(pool).await.map(|x| x.rows_affected()).unwrap_or(0);
        let e = sqlx::query(
            "DELETE FROM events WHERE id IN (SELECT id FROM events ORDER BY ts_ms ASC LIMIT 5000)",
        ).execute(pool).await.map(|x| x.rows_affected()).unwrap_or(0);
        removed += r + e;
        if r == 0 && e == 0 { break; } // nothing left to trim
    }
    if removed > 0 {
        let _ = sqlx::query("VACUUM").execute(pool).await; // reclaim space so size reflects the purge
    }
    removed
}

// ── Monthly recaps ────────────────────────────────────────────────────────────
/// Build a lightweight aggregate recap for a month ("YYYY-MM"). All figures are
/// aggregates (no per-user rows). `anon` drops the coarse device/geo breakdowns and
/// rounds the user count to a bucket, for a fully non-identifying summary.
pub async fn generate_recap(pool: &PgPool, month: &str, anon: bool) -> Value {
    let like = format!("{}%", month);
    let one = |sql: &'static str| {
        let p = pool.clone(); let lk = like.clone();
        async move { sqlx::query_as::<_, (i64,)>(sql).bind(lk).fetch_optional(&p).await.ok().flatten().map(|r| r.0).unwrap_or(0) }
    };
    let events = one("SELECT COUNT(*) FROM events WHERE ts LIKE $1").await;
    let sessions = one("SELECT COUNT(*) FROM events WHERE event='session_start' AND ts LIKE $1").await;
    let pageviews = one("SELECT COUNT(*) FROM events WHERE event='page_enter' AND ts LIKE $1").await;
    let users = one("SELECT COUNT(DISTINCT distinct_id) FROM events WHERE ts LIKE $1").await;

    let kv = |sql: &'static str| {
        let p = pool.clone(); let lk = like.clone();
        async move {
            let rows: Vec<(Option<String>, i64)> = sqlx::query_as(sql).bind(lk).fetch_all(&p).await.unwrap_or_default();
            rows.into_iter().map(|(k, v)| json!({ "k": k.unwrap_or_default(), "v": v })).collect::<Vec<_>>()
        }
    };
    let top_events = kv("SELECT event, COUNT(*) FROM events WHERE ts LIKE $1 GROUP BY event ORDER BY COUNT(*) DESC LIMIT 20").await;
    let top_pages = kv("SELECT props->>'view', COUNT(*) FROM events WHERE event='page_enter' AND ts LIKE $1 GROUP BY 1 ORDER BY COUNT(*) DESC LIMIT 20").await;
    let avg_session_min: Option<f64> = sqlx::query_as::<_, (Option<f64>,)>(
        "SELECT AVG((props->>'duration_sec')::float)/60.0 FROM events WHERE event='session_end' AND ts LIKE $1",
    ).bind(&like).fetch_optional(pool).await.ok().flatten().and_then(|r| r.0);

    let mut out = serde_json::Map::new();
    out.insert("version".into(), json!(1));
    out.insert("month".into(), json!(month));
    out.insert("generated_at".into(), json!(now_ms()));
    out.insert("anonymized".into(), json!(anon));
    out.insert("totals".into(), json!({
        "events": events, "sessions": sessions, "pageviews": pageviews,
        // anon → bucket the user count to the nearest 10 so it can't identify a tiny cohort
        "users": if anon { (users / 10) * 10 } else { users },
        "avg_session_min": avg_session_min.map(|v| (v * 10.0).round() / 10.0).unwrap_or(0.0),
        "pages_per_session": if sessions > 0 { (pageviews as f64 / sessions as f64 * 10.0).round() / 10.0 } else { 0.0 },
    }));
    out.insert("top_events".into(), json!(top_events));
    out.insert("top_pages".into(), json!(top_pages));
    if !anon {
        let os = kv("SELECT props->'$set'->>'os_caption', COUNT(DISTINCT distinct_id) FROM events WHERE event='$identify' GROUP BY 1 ORDER BY 2 DESC LIMIT 12").await;
        out.insert("os".into(), json!(os));
    }
    Value::Object(out)
}

pub async fn save_recap(pool: &PgPool, recap: &Value, source: &str) -> i64 {
    let month = recap.get("month").and_then(Value::as_str).unwrap_or("");
    let anon = recap.get("anonymized").and_then(Value::as_bool).unwrap_or(false);
    sqlx::query_as::<_, (i64,)>(
        "INSERT INTO recaps(month,created_at,anon,source,data) VALUES($1,$2,$3,$4,$5) RETURNING id",
    )
    .bind(month).bind(now_ms()).bind(anon).bind(source).bind(recap)
    .fetch_one(pool).await.map(|r| r.0).unwrap_or(0)
}

pub async fn list_recaps(pool: &PgPool) -> Vec<Value> {
    let rows: Vec<(i64, String, i64, bool, String)> = sqlx::query_as(
        "SELECT id, COALESCE(month,''), created_at, anon, COALESCE(source,'') FROM recaps ORDER BY created_at DESC LIMIT 200",
    ).fetch_all(pool).await.unwrap_or_default();
    rows.into_iter().map(|(id, month, at, anon, source)| json!({
        "id": id, "month": month, "created_at": at, "anon": anon, "source": source
    })).collect()
}

pub async fn get_recap(pool: &PgPool, id: i64) -> Option<Value> {
    sqlx::query_as::<_, (Value,)>("SELECT data FROM recaps WHERE id=$1")
        .bind(id).fetch_optional(pool).await.ok().flatten().map(|r| r.0)
}

pub async fn import_recap(pool: &PgPool, doc: &Value) -> i64 { save_recap(pool, doc, "imported").await }

pub async fn delete_recap(pool: &PgPool, id: i64) -> u64 {
    sqlx::query("DELETE FROM recaps WHERE id=$1").bind(id).execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0)
}

pub async fn purge_retention(pool: &PgPool, days: i64) -> u64 {
    let cut = now_ms() - days * 86_400_000;
    let a = sqlx::query("DELETE FROM events WHERE ts_ms < $1")
        .bind(cut)
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    let b = sqlx::query("DELETE FROM benchmarks WHERE ts_ms < $1")
        .bind(cut)
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    let c = sqlx::query("DELETE FROM replay_chunks WHERE ts_ms < $1")
        .bind(cut)
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    a + b + c
}
pub async fn erase_packet(pool: &PgPool, pid: &str) -> u64 {
    let a = sqlx::query("DELETE FROM events WHERE packet_id=$1")
        .bind(pid)
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    let b = sqlx::query("DELETE FROM benchmarks WHERE packet_id=$1")
        .bind(pid)
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    let c = sqlx::query("DELETE FROM replay_chunks WHERE packet_id=$1")
        .bind(pid)
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
    a + b + c
}

// ── Admin audit trail ─────────────────────────────────────────────────────────
pub async fn audit(pool: &PgPool, action: &str, target: &str, ip: &str, fp: &str, detail: Value) {
    let _ = sqlx::query("INSERT INTO audit_log(at,action,target,admin_ip,admin_fp,detail) VALUES($1,$2,$3,$4,$5,$6)")
        .bind(now_ms())
        .bind(action)
        .bind(target)
        .bind(ip)
        .bind(fp)
        .bind(&detail)
        .execute(pool)
        .await;
}

pub async fn list_audit(pool: &PgPool, limit: i64) -> Vec<Value> {
    let rows: Vec<(i64, i64, String, String, String, String, Value)> = sqlx::query_as(
        "SELECT id,at,action,target,COALESCE(admin_ip,''),COALESCE(admin_fp,''),detail FROM audit_log ORDER BY at DESC LIMIT $1",
    )
    .bind(limit)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(|(id, at, action, target, ip, fp, detail)| json!({
            "id": id, "at": at, "action": action, "target": target, "ip": ip, "fp": fp, "detail": detail
        }))
        .collect()
}

// ── Storage management ────────────────────────────────────────────────────────
async fn table_size(pool: &PgPool, table: &str) -> (i64, i64) {
    let rows: Option<(i64,)> = sqlx::query_as(&format!("SELECT COUNT(*) FROM {table}"))
        .fetch_optional(pool).await.ok().flatten();
    let bytes: Option<(Option<i64>,)> = sqlx::query_as("SELECT pg_total_relation_size($1)")
        .bind(table).fetch_optional(pool).await.ok().flatten();
    (rows.map(|r| r.0).unwrap_or(0), bytes.and_then(|b| b.0).unwrap_or(0))
}

/// Storage overview: per-table counts + on-disk size, plus the biggest replay
/// sessions and packets so an admin can manage / prune them.
pub async fn storage_overview(pool: &PgPool) -> Value {
    let tables = ["events", "replay_chunks", "benchmarks", "deletions", "goals", "geo", "user_ips", "live_instances", "audit_log"];
    let mut tinfo = Vec::new();
    for t in tables {
        let (rows, bytes) = table_size(pool, t).await;
        tinfo.push(json!({ "table": t, "rows": rows, "bytes": bytes }));
    }

    let replays: Vec<(String, String, i64, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT session_id, COALESCE(MAX(distinct_id),''), COUNT(*),
                SUM(COALESCE(pg_column_size(gz),0)+COALESCE(pg_column_size(data),0)), MAX(ts_ms)
         FROM replay_chunks GROUP BY session_id ORDER BY MAX(ts_ms) DESC LIMIT 200",
    ).fetch_all(pool).await.unwrap_or_default();
    let replays: Vec<Value> = replays.into_iter().map(|(sid, did, chunks, bytes, ts)| json!({
        "session_id": sid, "distinct_id": did, "chunks": chunks, "bytes": bytes.unwrap_or(0), "last_ms": ts.unwrap_or(0)
    })).collect();

    let packets: Vec<(String, i64, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT packet_id, COUNT(*), SUM(pg_column_size(props)), MAX(ts_ms)
         FROM events WHERE packet_id IS NOT NULL AND packet_id<>'' GROUP BY packet_id ORDER BY MAX(ts_ms) DESC LIMIT 200",
    ).fetch_all(pool).await.unwrap_or_default();
    let packets: Vec<Value> = packets.into_iter().map(|(pid, n, bytes, ts)| json!({
        "packet_id": pid, "events": n, "bytes": bytes.unwrap_or(0), "last_ms": ts.unwrap_or(0)
    })).collect();

    let storage_bytes = db_size_bytes(pool).await;
    let storage_limit_mb = get_meta_i64(pool, "storage_limit_mb", 5120).await;
    json!({ "tables": tinfo, "replays": replays, "packets": packets,
            "storage_bytes": storage_bytes, "storage_limit_mb": storage_limit_mb })
}

pub async fn delete_replay_session(pool: &PgPool, sid: &str) -> u64 {
    sqlx::query("DELETE FROM replay_chunks WHERE session_id=$1")
        .bind(sid).execute(pool).await.map(|r| r.rows_affected()).unwrap_or(0)
}

/// Compact CLOSED replay sessions (idle ≥10 min): merge a session's chunks that
/// share a packet into ONE gzip blob. Re-gzipping the whole stream beats
/// per-chunk ratios and slashes row count. Grouping by packet keeps per-packet
/// GDPR erasure exact. Returns the number of (session,packet) groups compacted.
pub async fn compact_replays(pool: &PgPool) -> u64 {
    let cutoff = now_ms() - 10 * 60_000;
    let groups: Vec<(String, String)> = sqlx::query_as(
        "SELECT session_id, COALESCE(packet_id,'') FROM replay_chunks
         GROUP BY session_id, COALESCE(packet_id,'') HAVING COUNT(*) > 1 AND MAX(ts_ms) < $1 LIMIT 50",
    ).bind(cutoff).fetch_all(pool).await.unwrap_or_default();

    let mut compacted = 0u64;
    for (sid, pid) in groups {
        let rows: Vec<(Option<Vec<u8>>, Option<Value>, String, i64)> = sqlx::query_as(
            "SELECT gz, data, COALESCE(distinct_id,''), ts_ms FROM replay_chunks
             WHERE session_id=$1 AND COALESCE(packet_id,'')=$2 ORDER BY ts_ms ASC, seq ASC",
        ).bind(&sid).bind(&pid).fetch_all(pool).await.unwrap_or_default();
        if rows.len() < 2 { continue; }
        let did = rows.iter().map(|r| r.2.clone()).find(|d| !d.is_empty()).unwrap_or_default();
        let min_ts = rows.iter().map(|r| r.3).min().unwrap_or_else(now_ms);
        let mut all: Vec<Value> = Vec::new();
        for (gz, data, _, _) in &rows {
            let arr = match gz { Some(b) if !b.is_empty() => gunzip_json(b), _ => data.clone() };
            if let Some(a) = arr.as_ref().and_then(|v| v.as_array()) { all.extend(a.iter().cloned()); }
        }
        let blob = gzip_json(&Value::Array(all));
        let mut tx = match pool.begin().await { Ok(t) => t, Err(_) => continue };
        if sqlx::query("DELETE FROM replay_chunks WHERE session_id=$1 AND COALESCE(packet_id,'')=$2")
            .bind(&sid).bind(&pid).execute(&mut *tx).await.is_err() { let _ = tx.rollback().await; continue; }
        if sqlx::query("INSERT INTO replay_chunks(packet_id,distinct_id,session_id,seq,ts_ms,gz) VALUES($1,$2,$3,0,$4,$5)")
            .bind(&pid).bind(&did).bind(&sid).bind(min_ts).bind(&blob).execute(&mut *tx).await.is_err() { let _ = tx.rollback().await; continue; }
        if tx.commit().await.is_ok() { compacted += 1; }
    }
    compacted
}

// ── Full JSON backup (export / import) ────────────────────────────────────────
const BACKUP_TABLES: [&str; 9] = ["events", "replay_chunks", "benchmarks", "geo", "deletions", "goals", "live_instances", "user_ips", "audit_log"];

/// Dump every table to a single JSON document (rows as JSON objects per table).
pub async fn export_backup(pool: &PgPool) -> Value {
    let mut out = Map::new();
    for t in BACKUP_TABLES {
        let row: Option<(Option<Value>,)> = sqlx::query_as(&format!("SELECT to_jsonb(array_agg(x)) FROM {t} x"))
            .fetch_optional(pool).await.ok().flatten();
        let arr = row.and_then(|r| r.0).unwrap_or_else(|| json!([]));
        out.insert(t.to_string(), arr);
    }
    json!({ "version": 1, "exported_at": now_ms(), "tables": Value::Object(out) })
}

/// Restore a backup produced by `export_backup` (additive — existing PKs are kept
/// via ON CONFLICT DO NOTHING). Returns rows inserted per table.
pub async fn import_backup(pool: &PgPool, doc: &Value) -> Value {
    let tables = doc.get("tables").cloned().unwrap_or_else(|| json!({}));
    let mut result = Map::new();
    for t in BACKUP_TABLES {
        let arr = tables.get(t).cloned().unwrap_or_else(|| json!([]));
        if !arr.as_array().map(|a| !a.is_empty()).unwrap_or(false) {
            result.insert(t.to_string(), json!(0));
            continue;
        }
        // jsonb_populate_recordset expands the JSON array into typed table rows.
        let n = sqlx::query(&format!(
            "INSERT INTO {t} SELECT * FROM jsonb_populate_recordset(NULL::{t}, $1) ON CONFLICT DO NOTHING"
        ))
        .bind(&arr)
        .execute(pool)
        .await
        .map(|r| r.rows_affected())
        .unwrap_or(0);
        result.insert(t.to_string(), json!(n));
    }
    // Imported rows carry their original ids, so advance each BIGSERIAL sequence
    // past the max id — otherwise the next ingest would collide on the PK.
    for t in ["events", "replay_chunks", "benchmarks", "goals", "audit_log"] {
        let _ = sqlx::query(&format!(
            "SELECT setval(pg_get_serial_sequence('{t}','id'), GREATEST((SELECT COALESCE(MAX(id),0) FROM {t}), 1))"
        ))
        .execute(pool)
        .await;
    }
    json!({ "imported": Value::Object(result) })
}

/// Reassemble a session's rrweb event stream from its stored chunks (ordered).
/// Chunks are gzip'd at rest (`gz`); legacy rows may still carry JSON in `data`.
pub async fn replay_events(pool: &PgPool, session_id: &str) -> Value {
    let rows: Vec<(Option<Vec<u8>>, Option<Value>)> = sqlx::query_as(
        "SELECT gz, data FROM replay_chunks WHERE session_id=$1 ORDER BY ts_ms ASC, seq ASC",
    )
    .bind(session_id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut out: Vec<Value> = Vec::new();
    for (gz, data) in rows {
        let arr = match gz {
            Some(bytes) if !bytes.is_empty() => gunzip_json(&bytes),
            _ => data,
        };
        if let Some(a) = arr.as_ref().and_then(|v| v.as_array()) {
            out.extend(a.iter().cloned());
        }
    }
    json!({ "session_id": session_id, "events": out })
}

// ── Deletion request lifecycle ──────────────────────────────────────────────
pub async fn request_deletion(pool: &PgPool, pid: &str, delay_h: i64) -> Value {
    let requested = now_ms();
    let scheduled = requested + delay_h * 3_600_000;
    let _ = sqlx::query(
        "INSERT INTO deletions(packet_id,requested_at,scheduled_at,status,decided_at,decided_by)
         VALUES($1,$2,$3,'pending',NULL,NULL)
         ON CONFLICT(packet_id) DO UPDATE SET
           requested_at=$2, scheduled_at=$3, status='pending', decided_at=NULL, decided_by=NULL
         WHERE deletions.status <> 'pending'",
    )
    .bind(pid)
    .bind(requested)
    .bind(scheduled)
    .execute(pool)
    .await;
    json!({ "packet_id": pid, "requested_at": requested, "scheduled_at": scheduled, "status": "pending" })
}

// ── GDPR data-access requests ─────────────────────────────────────────────────
pub async fn insert_data_request(pool: &PgPool, creator_id: &str, email: &str) -> Value {
    let row: Result<(i64,), _> = sqlx::query_as(
        "INSERT INTO data_requests(creator_id,email) VALUES($1,$2) RETURNING id")
        .bind(creator_id).bind(email).fetch_one(pool).await;
    json!({ "id": row.map(|r| r.0).unwrap_or(0) })
}
pub async fn list_data_requests(pool: &PgPool) -> Value {
    let rows: Vec<(i64, String, String, String, i64)> = sqlx::query_as(
        "SELECT id, creator_id, email, status, (EXTRACT(EPOCH FROM created_at)*1000)::bigint \
         FROM data_requests ORDER BY created_at DESC LIMIT 200")
        .fetch_all(pool).await.unwrap_or_default();
    json!(rows.iter().map(|r| json!({
        "id": r.0, "creator_id": r.1, "email": r.2, "status": r.3, "created_ms": r.4
    })).collect::<Vec<_>>())
}
pub async fn decide_data_request(pool: &PgPool, id: i64, status: &str) -> bool {
    sqlx::query("UPDATE data_requests SET status=$2, decided_at=now() WHERE id=$1")
        .bind(id).bind(status).execute(pool).await.map(|r| r.rows_affected() > 0).unwrap_or(false)
}
pub async fn decide_deletion(pool: &PgPool, pid: &str, action: &str, by: &str) -> Option<Value> {
    let exists: Option<(String,)> = sqlx::query_as("SELECT packet_id FROM deletions WHERE packet_id=$1")
        .bind(pid)
        .fetch_optional(pool)
        .await
        .ok()
        .flatten();
    exists.as_ref()?;
    if action == "approve" {
        erase_packet(pool, pid).await;
        let _ = sqlx::query("UPDATE deletions SET status='done', decided_at=$2, decided_by=$3 WHERE packet_id=$1")
            .bind(pid)
            .bind(now_ms())
            .bind(by)
            .execute(pool)
            .await;
    } else if action == "reject" {
        let _ = sqlx::query("UPDATE deletions SET status='rejected', decided_at=$2, decided_by=$3 WHERE packet_id=$1")
            .bind(pid)
            .bind(now_ms())
            .bind(by)
            .execute(pool)
            .await;
    }
    deletion_row(pool, pid).await
}
async fn deletion_row(pool: &PgPool, pid: &str) -> Option<Value> {
    let r: Option<(String, Option<i64>, Option<i64>, Option<String>, Option<i64>, Option<String>)> =
        sqlx::query_as("SELECT packet_id,requested_at,scheduled_at,status,decided_at,decided_by FROM deletions WHERE packet_id=$1")
            .bind(pid)
            .fetch_optional(pool)
            .await
            .ok()
            .flatten();
    r.map(|(packet_id, requested_at, scheduled_at, status, decided_at, decided_by)| {
        json!({ "packet_id": packet_id, "requested_at": requested_at, "scheduled_at": scheduled_at,
                "status": status, "decided_at": decided_at, "decided_by": decided_by })
    })
}
pub async fn run_due_deletions(pool: &PgPool) -> u64 {
    let due: Vec<(String,)> = sqlx::query_as("SELECT packet_id FROM deletions WHERE status='pending' AND scheduled_at <= $1")
        .bind(now_ms())
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    for (pid,) in &due {
        erase_packet(pool, pid).await;
        let _ = sqlx::query("UPDATE deletions SET status='done', decided_at=$2 WHERE packet_id=$1")
            .bind(pid)
            .bind(now_ms())
            .execute(pool)
            .await;
    }
    due.len() as u64
}
pub async fn list_deletions(pool: &PgPool) -> Vec<Value> {
    let rows: Vec<(String, Option<i64>, Option<i64>, Option<String>, Option<i64>, Option<String>)> =
        sqlx::query_as("SELECT packet_id,requested_at,scheduled_at,status,decided_at,decided_by FROM deletions ORDER BY requested_at DESC LIMIT 200")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    rows.into_iter()
        .map(|(packet_id, requested_at, scheduled_at, status, decided_at, decided_by)| {
            json!({ "packet_id": packet_id, "requested_at": requested_at, "scheduled_at": scheduled_at,
                    "status": status, "decided_at": decided_at, "decided_by": decided_by })
        })
        .collect()
}
pub async fn pending_deletion_count(pool: &PgPool) -> i64 {
    sqlx::query_as::<_, (i64,)>("SELECT COUNT(*) FROM deletions WHERE status='pending'")
        .fetch_one(pool)
        .await
        .map(|r| r.0)
        .unwrap_or(0)
}
pub async fn packet_statuses(pool: &PgPool, ids: &[String]) -> Value {
    let mut m = Map::new();
    if ids.is_empty() {
        return Value::Object(m);
    }
    let rows: Vec<(String, Option<String>, Option<i64>, Option<i64>)> = sqlx::query_as(
        "SELECT packet_id,status,decided_at,scheduled_at FROM deletions WHERE packet_id = ANY($1)",
    )
    .bind(ids)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for (pid, status, decided_at, scheduled_at) in rows {
        m.insert(
            pid,
            json!({ "status": status, "decided_at": decided_at, "scheduled_at": scheduled_at }),
        );
    }
    Value::Object(m)
}

// ── Drill-down: event occurrences ───────────────────────────────────────────
pub async fn event_occurrences(pool: &PgPool, name: &str, limit: i64) -> Vec<Value> {
    let limit = limit.clamp(1, 500);
    let rows: Vec<(Option<String>, Option<String>, Value, Option<String>)> = sqlx::query_as(
        "SELECT distinct_id, ts, props, packet_id FROM events WHERE event=$1 ORDER BY ts_ms DESC LIMIT $2",
    )
    .bind(name)
    .bind(limit)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    rows.into_iter()
        .map(|(distinct_id, ts, props, packet_id)| {
            json!({ "distinct_id": distinct_id, "ts": ts, "packet_id": packet_id, "props": props })
        })
        .collect()
}

// ── Drill-down: a user's full session-by-session journey ────────────────────
pub async fn user_journey(pool: &PgPool, id: &str) -> Vec<Value> {
    let rows: Vec<(String, String, Value)> = sqlx::query_as(
        "SELECT event, ts, props FROM events WHERE distinct_id=$1 ORDER BY ts_ms ASC LIMIT 5000",
    )
    .bind(id)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut order: Vec<String> = Vec::new();
    let mut sessions: std::collections::HashMap<String, Value> = std::collections::HashMap::new();
    for (event, ts, p) in rows {
        let sid = p
            .get("session_id")
            .and_then(Value::as_str)
            .unwrap_or("no-session")
            .to_string();
        let s = sessions.entry(sid.clone()).or_insert_with(|| {
            order.push(sid.clone());
            json!({ "session_id": sid, "start": ts, "end": ts, "events": [] })
        });
        s["end"] = json!(ts);
        let ev = json!({
            "event": event,
            "ts": ts,
            "seq": p.get("seq"),
            "view": p.get("view"),
            "from": p.get("from"),
            // Where the action happened + what it targeted, so the dashboard can
            // answer "which button, and on which page / in which modal".
            "modal": p.get("modal"),
            "text": p.get("text"),
            "id": p.get("id"),
            "field": p.get("field"),
            "name": p.get("name"),
            "title": p.get("title"),
            "url": p.get("url"),
            "message": p.get("message"),
            "dwell_ms": p.get("dwell_ms"),
            "fps_avg": p.get("fps_avg"),
            "detail": summarize_props(&event, &p),
        });
        s["events"].as_array_mut().unwrap().push(ev);
    }
    order
        .into_iter()
        .rev()
        .filter_map(|sid| sessions.remove(&sid))
        .collect()
}
fn summarize_props(event: &str, p: &Value) -> String {
    let s = |k: &str| p.get(k).and_then(Value::as_str).unwrap_or("").to_string();
    let n = |k: &str| p.get(k).and_then(Value::as_f64).unwrap_or(0.0);
    match event {
        "page_enter" => {
            let from = s("from");
            if from.is_empty() {
                s("view")
            } else {
                format!("{} → {}", from, s("view"))
            }
        }
        "page_leave" => format!("{} · {}s", s("view"), (n("dwell_ms") / 1000.0).round()),
        "perf" => format!("{} fps · {}ms", n("fps_avg"), n("frametime_avg_ms")),
        "benchmark" => format!(
            "{} {}",
            if n("total_ms") > 0.0 {
                format!("{}ms", n("total_ms").round())
            } else {
                String::new()
            },
            s("source")
        ),
        "repo_connect" => {
            let h = s("host");
            if h.is_empty() {
                s("url")
            } else {
                h
            }
        }
        "session_end" => format!("{}s · {} views", n("duration_sec"), n("views_visited")),
        // autocapture events
        "click" => {
            let t = s("text");
            if t.is_empty() { "button".into() } else { format!("button “{}”", t) }
        }
        "copy" => "copied".into(),
        "form_submit" => {
            let id = s("id");
            if id.is_empty() { "form submitted".into() } else { format!("form “{}” submitted", id) }
        }
        "input_change" => format!("field “{}” changed", s("field")),
        "outbound" => format!("→ {}", s("url")),
        "error" => format!("error: {}", s("message")),
        "modal_open" => {
            let title = s("title");
            if title.is_empty() { s("name") } else { format!("{} · {}", s("name"), title) }
        }
        "feature" => s("name"),
        _ => String::new(),
    }
}

// ── Sessions list (recent, newest first) ────────────────────────────────────
pub async fn sessions_list(pool: &PgPool, limit: i64) -> Vec<Value> {
    let limit = limit.clamp(1, 300);
    let rows: Vec<(String, String, Option<String>, Option<String>, Option<i64>, Option<i64>, i64, i64)> =
        sqlx::query_as(
            "SELECT distinct_id, props->>'session_id' sid, MIN(ts), MAX(ts),
                    MIN(ts_ms), MAX(ts_ms), COUNT(*), COUNT(*) FILTER (WHERE event='page_enter')
             FROM events
             WHERE props->>'session_id' IS NOT NULL AND props->>'session_id' <> 'no-session'
             GROUP BY distinct_id, sid ORDER BY MAX(ts_ms) DESC LIMIT $1",
        )
        .bind(limit)
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    if rows.is_empty() {
        return vec![];
    }
    let sids: Vec<String> = rows.iter().map(|r| r.1.clone()).collect();
    let pe: Vec<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT props->>'session_id' sid, props->>'view' v FROM events
         WHERE event='page_enter' AND props->>'session_id' = ANY($1) ORDER BY ts_ms ASC",
    )
    .bind(&sids)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut first_v: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    let mut last_v: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for (sid, v) in pe {
        if let (Some(sid), Some(v)) = (sid, v) {
            first_v.entry(sid.clone()).or_insert_with(|| v.clone());
            last_v.insert(sid, v);
        }
    }
    rows.into_iter()
        .map(|(did, sid, s, e, sm, em, ev, pv)| {
            json!({
                "distinct_id": did, "session_id": sid, "start": s, "end": e,
                "duration_s": ((em.unwrap_or(0) - sm.unwrap_or(0)) / 1000),
                "events": ev, "pageviews": pv,
                "entry": first_v.get(&sid), "exit": last_v.get(&sid),
            })
        })
        .collect()
}

// ── Funnel ──────────────────────────────────────────────────────────────────
pub async fn funnel(pool: &PgPool, steps: &[String]) -> Value {
    let steps: Vec<String> = steps.iter().map(|s| s.trim().to_string()).filter(|s| !s.is_empty()).collect();
    if steps.len() < 2 {
        return json!({ "steps": [], "total": 0 });
    }
    // Build each session's ordered token stream from page views AND modal opens,
    // so a funnel step can be a page OR a modal.
    let pe: Vec<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT props->>'session_id' sid,
                CASE WHEN event='page_enter' THEN props->>'view' ELSE props->>'name' END tok
         FROM events
         WHERE event IN ('page_enter','modal_open') AND props->>'session_id' IS NOT NULL
         ORDER BY ts_ms ASC",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut by_sid: std::collections::HashMap<String, Vec<String>> = std::collections::HashMap::new();
    for (sid, v) in pe {
        if let (Some(sid), Some(v)) = (sid, v) {
            by_sid.entry(sid).or_default().push(v);
        }
    }
    let matches = |view: &str, pat: &str| pat == "*" || pat == view;
    let mut counts = vec![0i64; steps.len()];
    let mut total = 0i64;
    for seq in by_sid.values() {
        total += 1;
        let mut si = 0usize;
        for v in seq {
            if matches(v, &steps[si]) {
                counts[si] += 1;
                si += 1;
                if si >= steps.len() {
                    break;
                }
            }
        }
    }
    let step_objs: Vec<Value> = steps
        .iter()
        .enumerate()
        .map(|(i, s)| {
            let pct = if total > 0 {
                (counts[i] as f64 / total as f64 * 1000.0).round() / 10.0
            } else {
                0.0
            };
            let drop = if i > 0 { counts[i - 1] - counts[i] } else { 0 };
            json!({ "step": s, "count": counts[i], "pct": pct, "drop": drop })
        })
        .collect();
    json!({ "total": total, "steps": step_objs })
}

// ── Goals ───────────────────────────────────────────────────────────────────
pub async fn list_goals(pool: &PgPool) -> Vec<Value> {
    let rows: Vec<(i64, Option<String>, Option<String>, Option<String>, Option<i64>, i64)> = sqlx::query_as(
        "SELECT id,name,type,target,created_at,target_count FROM goals ORDER BY created_at DESC",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let users: i64 = sqlx::query_as::<_, (i64,)>("SELECT COUNT(DISTINCT distinct_id) FROM events")
        .fetch_one(pool)
        .await
        .map(|r| r.0)
        .unwrap_or(0)
        .max(1);
    let mut out = Vec::new();
    for (id, name, typ, target, created_at, target_count) in rows {
        let target = target.clone().unwrap_or_default();
        // How many distinct users satisfied this goal, by goal type.
        let sql = match typ.as_deref() {
            Some("page") => "SELECT COUNT(DISTINCT distinct_id) FROM events WHERE event='page_enter' AND props->>'view'=$1",
            Some("modal") => "SELECT COUNT(DISTINCT distinct_id) FROM events WHERE event='modal_open' AND props->>'name'=$1",
            Some("feature") => "SELECT COUNT(DISTINCT distinct_id) FROM events WHERE event='feature' AND props->>'name'=$1",
            _ => "SELECT COUNT(DISTINCT distinct_id) FROM events WHERE event=$1",
        };
        let conv: i64 = sqlx::query_as::<_, (i64,)>(sql)
            .bind(&target)
            .fetch_one(pool)
            .await
            .map(|r| r.0)
            .unwrap_or(0);
        let tc = target_count.max(1);
        out.push(json!({
            "id": id, "name": name, "type": typ, "target": target, "created_at": created_at,
            "conversions": conv, "rate": (conv as f64 / users as f64 * 1000.0).round() / 10.0,
            // objective: reach `target_count` conversions
            "target_count": tc, "reached": conv >= tc,
            "progress": ((conv as f64 / tc as f64 * 1000.0).round() / 10.0).min(100.0),
        }));
    }
    out
}
pub async fn add_goal(pool: &PgPool, name: &str, typ: &str, target: &str, target_count: i64) {
    let _ = sqlx::query("INSERT INTO goals(name,type,target,created_at,target_count) VALUES($1,$2,$3,$4,$5)")
        .bind(name)
        .bind(typ)
        .bind(target)
        .bind(now_ms())
        .bind(target_count.max(1))
        .execute(pool)
        .await;
}
pub async fn del_goal(pool: &PgPool, id: i64) {
    let _ = sqlx::query("DELETE FROM goals WHERE id=$1")
        .bind(id)
        .execute(pool)
        .await;
}

// ── Cohort retention (weekly or daily) ──────────────────────────────────────
pub async fn retention_cohorts(pool: &PgPool, weeks: i64) -> Vec<Value> {
    retention_cohorts_period(pool, weeks, 604_800_000).await
}
pub async fn retention_cohorts_daily(pool: &PgPool, days: i64) -> Vec<Value> {
    retention_cohorts_period(pool, days, 86_400_000).await
}
async fn retention_cohorts_period(pool: &PgPool, periods: i64, period_ms: i64) -> Vec<Value> {
    let wk = period_ms;
    let since = now_ms() - periods * wk;
    let rows: Vec<(Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT distinct_id, (ts_ms/$2) wk FROM events WHERE ts_ms>=$1 GROUP BY distinct_id, wk",
    )
    .bind(since)
    .bind(wk)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut user_weeks: std::collections::HashMap<String, std::collections::HashSet<i64>> =
        std::collections::HashMap::new();
    for (did, wk) in rows {
        if let (Some(did), Some(wk)) = (did, wk) {
            user_weeks.entry(did).or_default().insert(wk);
        }
    }
    let now_wk = now_ms() / wk;
    let mut cohorts: std::collections::HashMap<i64, Vec<std::collections::HashSet<i64>>> =
        std::collections::HashMap::new();
    for set in user_weeks.into_values() {
        if let Some(first) = set.iter().min().copied() {
            cohorts.entry(first).or_default().push(set);
        }
    }
    let mut sorted: Vec<i64> = cohorts.keys().copied().collect();
    sorted.sort();
    let mut result = Vec::new();
    for cw in sorted {
        let members = &cohorts[&cw];
        let size = members.len();
        let span = now_wk - cw;
        let mut cells = Vec::new();
        let max_k = span.min(periods - 1);
        for k in 0..=max_k {
            let retained = members.iter().filter(|set| set.contains(&(cw + k))).count();
            cells.push(json!({
                "week": k,
                "pct": if size > 0 { (retained as f64 / size as f64 * 1000.0).round() / 10.0 } else { 0.0 },
                "count": retained,
            }));
        }
        let date = chrono::DateTime::from_timestamp_millis(cw * wk)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        result.push(json!({ "cohort_start": date, "size": size, "cells": cells }));
    }
    result.reverse();
    result
}
