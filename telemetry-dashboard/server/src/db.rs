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

// ── Retention + per-packet erasure ──────────────────────────────────────────
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
    a + b
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
    a + b
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
            "view": p.get("view"),
            "from": p.get("from"),
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
    let rows: Vec<(i64, Option<String>, Option<String>, Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT id,name,type,target,created_at FROM goals ORDER BY created_at DESC",
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
    for (id, name, typ, target, created_at) in rows {
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
        out.push(json!({
            "id": id, "name": name, "type": typ, "target": target, "created_at": created_at,
            "conversions": conv, "rate": (conv as f64 / users as f64 * 1000.0).round() / 10.0,
        }));
    }
    out
}
pub async fn add_goal(pool: &PgPool, name: &str, typ: &str, target: &str) {
    let _ = sqlx::query("INSERT INTO goals(name,type,target,created_at) VALUES($1,$2,$3,$4)")
        .bind(name)
        .bind(typ)
        .bind(target)
        .bind(now_ms())
        .execute(pool)
        .await;
}
pub async fn del_goal(pool: &PgPool, id: i64) {
    let _ = sqlx::query("DELETE FROM goals WHERE id=$1")
        .bind(id)
        .execute(pool)
        .await;
}

// ── Weekly cohort retention ─────────────────────────────────────────────────
pub async fn retention_cohorts(pool: &PgPool, weeks: i64) -> Vec<Value> {
    const WK: i64 = 604_800_000;
    let since = now_ms() - weeks * WK;
    let rows: Vec<(Option<String>, Option<i64>)> = sqlx::query_as(
        "SELECT distinct_id, (ts_ms/604800000) wk FROM events WHERE ts_ms>=$1 GROUP BY distinct_id, wk",
    )
    .bind(since)
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
    let now_wk = now_ms() / WK;
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
        let max_k = span.min(weeks - 1);
        for k in 0..=max_k {
            let retained = members.iter().filter(|set| set.contains(&(cw + k))).count();
            cells.push(json!({
                "week": k,
                "pct": if size > 0 { (retained as f64 / size as f64 * 1000.0).round() / 10.0 } else { 0.0 },
                "count": retained,
            }));
        }
        let date = chrono::DateTime::from_timestamp_millis(cw * WK)
            .map(|d| d.format("%Y-%m-%d").to_string())
            .unwrap_or_default();
        result.push(json!({ "cohort_start": date, "size": size, "cells": cells }));
    }
    result.reverse();
    result
}
