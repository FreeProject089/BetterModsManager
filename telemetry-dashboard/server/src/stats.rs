//! Derives the full dashboard payload from the events table (SQL + light Rust).
//! Port of the original `stats.mjs`, extended with per-page web-vitals,
//! a 24h web-vitals series (for the trend graphs), and live-instance status.

use crate::config::Config;
use crate::db;
use crate::geo::{is_private_host, load_geo_map};
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};

fn r1(n: f64) -> f64 {
    (n * 10.0).round() / 10.0
}
fn r2(n: f64) -> f64 {
    (n * 100.0).round() / 100.0
}
fn gpu_vendor(g: &str) -> &'static str {
    let l = g.to_lowercase();
    if ["nvidia", "geforce", "rtx", "gtx", "quadro"].iter().any(|k| l.contains(k)) {
        "NVIDIA"
    } else if ["radeon", "amd", "firepro"].iter().any(|k| l.contains(k)) {
        "AMD"
    } else if ["intel", "iris", "uhd"].iter().any(|k| l.contains(k)) {
        "Intel"
    } else if g.is_empty() {
        "Unknown"
    } else {
        "Other"
    }
}
fn os_family(o: &str) -> String {
    let l = o.to_lowercase();
    if l.contains("windows 11") {
        "Windows 11".into()
    } else if l.contains("windows 10") {
        "Windows 10".into()
    } else if l.contains("windows") {
        "Windows".into()
    } else if l.contains("mac") {
        "macOS".into()
    } else if l.contains("linux") {
        "Linux".into()
    } else if o.is_empty() {
        "Unknown".into()
    } else {
        o.into()
    }
}
fn tally(items: impl IntoIterator<Item = String>) -> Vec<Value> {
    let mut m: HashMap<String, i64> = HashMap::new();
    for k in items {
        if !k.is_empty() {
            *m.entry(k).or_insert(0) += 1;
        }
    }
    let mut v: Vec<(String, i64)> = m.into_iter().collect();
    v.sort_by(|a, b| b.1.cmp(&a.1));
    v.into_iter().map(|(k, c)| json!({ "k": k, "v": c })).collect()
}

// tiny xorshift so map jitter doesn't need a rand dep
static SEED: AtomicU64 = AtomicU64::new(0x9E3779B97F4A7C15);
fn jitter() -> f64 {
    let mut x = SEED.load(Ordering::Relaxed);
    x ^= x << 13;
    x ^= x >> 7;
    x ^= x << 17;
    SEED.store(x, Ordering::Relaxed);
    ((x as f64 / u64::MAX as f64) - 0.5) * 0.15
}
fn approx(v: f64) -> f64 {
    (v * 4.0).round() / 4.0 + jitter()
}

fn s_str<'a>(v: &'a Value, k: &str) -> &'a str {
    v.get(k).and_then(Value::as_str).unwrap_or("")
}
fn s_f64(v: &Value, k: &str) -> Option<f64> {
    v.get(k).and_then(|x| x.as_f64().or_else(|| x.as_str().and_then(|s| s.parse().ok())))
}

struct User {
    creator_id: String,
    config: Value,
    versions: Vec<String>,
    names: Vec<String>,
    ips: Vec<String>,
    sessions: i64,
    session_ms: i64,
    first_seen: Option<String>,
    last_seen: Option<String>,
    benchmarks: Vec<Value>,
    ip: Option<String>,
    geo: Option<Value>,
}

pub async fn compute_stats(pool: &PgPool, cfg: &Config) -> Value {
    let geo_map = load_geo_map(pool).await;
    let geo_of = |key: &Option<String>| -> Option<Value> {
        let k = key.as_ref()?.split(':').next()?.to_string();
        geo_map.get(&k).cloned()
    };

    let mut users: HashMap<String, User> = HashMap::new();

    // latest $identify per user → config
    let idrows: Vec<(Option<String>, Value)> =
        sqlx::query_as("SELECT distinct_id, props FROM events WHERE event='$identify' ORDER BY ts_ms ASC")
            .fetch_all(pool)
            .await
            .unwrap_or_default();
    for (did, props) in idrows {
        let did = did.unwrap_or_else(|| "anon".into());
        let s = props.get("$set").cloned().unwrap_or_else(|| json!({}));
        let u = users.entry(did.clone()).or_insert_with(|| User {
            creator_id: did.clone(),
            config: json!({}),
            versions: vec![],
            names: vec![],
            ips: vec![],
            sessions: 0,
            session_ms: 0,
            first_seen: None,
            last_seen: None,
            benchmarks: vec![],
            ip: None,
            geo: None,
        });
        u.config = json!({
            "os": s.get("os_caption").or_else(|| s.get("os")),
            "cpu": s.get("cpu"), "cores": s.get("cpu_cores"), "ram_gb": s.get("ram_gb"),
            "gpu": s.get("gpu"), "gpus": s.get("gpus"), "is_vm": s.get("is_vm"),
            "disk_count": s.get("disk_count"), "disk_total_gb": s.get("disk_total_gb"),
            "disks": s.get("disks"), "locale": s.get("locale").or_else(|| s.get("language")),
            "motherboard": s.get("motherboard"),
            "profiles": s.get("profiles_summary"), "private_ip": s.get("private_ip"),
            "theme": s.get("theme"), "theme_kind": s.get("theme_kind"), "theme_name": s.get("theme_name"), "tasky": s.get("tasky"),
            // BMM content counts + how the app accesses the filesystem
            "counts": s.get("counts"), "access": s.get("fs_security_mode").or_else(|| s.get("access")),
            // displays / peripherals (EDID identity + active resolution)
            "monitors": s.get("monitors"), "monitor_count": s.get("monitor_count"),
            "primary_resolution": s.get("primary_resolution"), "resolutions": s.get("resolutions"),
            // Extra precise hardware identity (only present if the user opted in)
            "hw_extra": s.get("hw_extra"),
        });
        if let Some(v) = s.get("app_version").and_then(Value::as_str) {
            if !u.versions.iter().any(|x| x == v) {
                u.versions.push(v.to_string());
            }
        }
        if let Some(ip) = s.get("public_ip").and_then(Value::as_str) {
            if !u.ips.iter().any(|x| x == ip) {
                u.ips.push(ip.to_string());
            }
            u.ip = Some(ip.to_string());
        }
    }

    // session counts + spans
    let srows: Vec<(Option<String>, Option<String>, Option<String>, i64, Option<f64>)> = sqlx::query_as(
        "SELECT distinct_id, MIN(ts), MAX(ts),
                COUNT(*) FILTER (WHERE event='session_start'),
                SUM(CASE WHEN event='session_end' THEN COALESCE((props->>'duration_sec')::float,0) ELSE 0 END)
         FROM events GROUP BY distinct_id",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for (did, fs, ls, ss, secs) in srows {
        let did = did.unwrap_or_else(|| "anon".into());
        let u = users.entry(did.clone()).or_insert_with(|| empty_user(&did));
        u.first_seen = fs;
        u.last_seen = ls;
        u.sessions = ss;
        u.session_ms = (secs.unwrap_or(0.0) * 1000.0) as i64;
    }

    // creator names
    let nrows: Vec<(Option<String>, Option<String>)> = sqlx::query_as(
        "SELECT distinct_id, props->>'creator_name' FROM events WHERE props->>'creator_name' IS NOT NULL",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for (did, nm) in nrows {
        if let (Some(did), Some(nm)) = (did, nm) {
            let u = users.entry(did.clone()).or_insert_with(|| empty_user(&did));
            let n: String = nm.chars().take(25).collect();
            if !u.names.iter().any(|x| x == &n) {
                u.names.push(n);
            }
        }
    }

    // benchmarks (last 3 per user)
    let brows: Vec<(Option<String>, Option<String>, Option<f64>, Option<i64>, Option<String>, Value)> =
        sqlx::query_as(
            "SELECT distinct_id, ts, total_ms, dataset_bytes, source, ops FROM benchmarks ORDER BY ts_ms DESC",
        )
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    for (did, ts, total_ms, dataset_bytes, source, ops) in &brows {
        let did = did.clone().unwrap_or_else(|| "anon".into());
        let u = users.entry(did.clone()).or_insert_with(|| empty_user(&did));
        if u.benchmarks.len() < 3 {
            u.benchmarks.push(json!({
                "ts": ts, "total_ms": total_ms, "dataset_bytes": dataset_bytes,
                "source": source, "ops": ops,
            }));
        }
    }

    // Fill any missing IP from the server-side capture (request IP), then geo.
    let user_ips = db::load_user_ips(pool).await;
    for (did, u) in users.iter_mut() {
        if u.ip.is_none() {
            if let Some(ip) = user_ips.get(did) {
                u.ip = Some(ip.clone());
                if !u.ips.iter().any(|x| x == ip) {
                    u.ips.push(ip.clone());
                }
            }
        }
    }
    for u in users.values_mut() {
        u.geo = geo_of(&u.ip);
    }

    let uarr: Vec<&User> = users.values().collect();
    let tot_sessions: i64 = uarr.iter().map(|u| u.sessions).sum();
    let tot_sess_ms: i64 = uarr.iter().map(|u| u.session_ms).sum();

    // totals
    let ev_total = scalar(pool, "SELECT COUNT(*) FROM events").await;
    let pageviews = scalar(pool, "SELECT COUNT(*) FROM events WHERE event='page_enter'").await;
    let bench_total = scalar(pool, "SELECT COUNT(*) FROM benchmarks").await;

    // 24h hourly series
    let now = chrono::Utc::now().timestamp_millis();
    let since = now - 24 * 3_600_000;
    let mut smap: HashMap<String, Value> = HashMap::new();
    let hr: Vec<(Option<String>, i64, i64, i64)> = sqlx::query_as(
        "SELECT substr(ts,1,13), COUNT(*), COUNT(*) FILTER (WHERE event='session_start'),
                COUNT(*) FILTER (WHERE event='page_enter')
         FROM events WHERE ts_ms>=$1 GROUP BY substr(ts,1,13)",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for (h, e, ss, pv) in hr {
        if let Some(h) = h {
            smap.insert(h.clone(), json!({ "hour": h, "events": e, "sessions": ss, "pageviews": pv, "users": 0 }));
        }
    }
    let hu: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT substr(ts,1,13), COUNT(DISTINCT distinct_id) FROM events WHERE ts_ms>=$1 GROUP BY substr(ts,1,13)",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for (h, u) in hu {
        if let Some(h) = h {
            if let Some(slot) = smap.get_mut(&h) {
                slot["users"] = json!(u);
            }
        }
    }
    let mut series: Vec<Value> = smap.into_values().collect();
    series.sort_by(|a, b| a["hour"].as_str().cmp(&b["hour"].as_str()));
    let series: Vec<Value> = series.into_iter().rev().take(24).rev().collect();

    // events / pages / funnels / perf
    let events = kv_rows(pool, "SELECT event, COUNT(*) FROM events GROUP BY event ORDER BY COUNT(*) DESC", "event").await;
    let enters: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT props->>'view', COUNT(*) FROM events WHERE event='page_enter' GROUP BY props->>'view'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let dwell: Vec<(Option<String>, Option<f64>)> = sqlx::query_as(
        "SELECT props->>'view', AVG((props->>'dwell_ms')::float) FROM events WHERE event='page_leave' GROUP BY props->>'view'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let dwell_map: HashMap<String, f64> = dwell.into_iter().filter_map(|(k, v)| Some((k?, v.unwrap_or(0.0)))).collect();
    let mut pages: Vec<Value> = enters
        .iter()
        .filter_map(|(v, c)| {
            let v = v.clone()?;
            Some(json!({ "view": v, "enters": c, "avg_dwell_ms": dwell_map.get(&v).copied().unwrap_or(0.0).round() }))
        })
        .collect();
    pages.sort_by(|a, b| b["enters"].as_i64().cmp(&a["enters"].as_i64()));

    let funnels: Vec<Value> = sqlx::query_as::<_, (Option<String>, Option<String>, i64)>(
        "SELECT props->>'from', props->>'view', COUNT(*) FROM events
         WHERE event='page_enter' AND props->>'from' IS NOT NULL
         GROUP BY props->>'from', props->>'view' ORDER BY COUNT(*) DESC LIMIT 20",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|(f, v, c)| json!({ "path": format!("{}→{}", f.unwrap_or_default(), v.unwrap_or_default()), "count": c }))
    .collect();

    let pf: (Option<f64>, Option<f64>, Option<f64>, Option<f64>) = sqlx::query_as(
        "SELECT AVG((props->>'fps_avg')::float), AVG((props->>'frametime_avg_ms')::float),
                MAX((props->>'frametime_worst_ms')::float), AVG((props->>'js_heap_mb')::float)
         FROM events WHERE event='perf'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or((None, None, None, None));
    let mut by_view: Vec<Value> = sqlx::query_as::<_, (Option<String>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, i64)>(
        "SELECT props->>'view', AVG((props->>'fps_avg')::float), AVG((props->>'frametime_avg_ms')::float),
                MAX((props->>'frametime_worst_ms')::float), AVG((props->>'js_heap_mb')::float), COUNT(*)
         FROM events WHERE event='perf' GROUP BY props->>'view'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|(v, fps, ft, worst, heap, n)| {
        let v = v?;
        Some(json!({ "view": v, "fps": r1(fps.unwrap_or(0.0)), "ft": r2(ft.unwrap_or(0.0)),
                     "worst": r2(worst.unwrap_or(0.0)), "heap": r1(heap.unwrap_or(0.0)), "n": n }))
    })
    .collect();
    by_view.sort_by(|a, b| a["fps"].as_f64().partial_cmp(&b["fps"].as_f64()).unwrap());

    // repos (public only)
    let repos: Vec<Value> = sqlx::query_as::<_, (Option<String>, i64, Option<String>, Option<String>, Option<String>)>(
        "SELECT lower(props->>'host'), COUNT(*), MAX(props->>'url'), MAX(props->>'repo_name'), MAX(ts)
         FROM events WHERE event='repo_connect' GROUP BY lower(props->>'host')",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|(host, count, url, repo, last)| {
        let host = host?;
        if host.is_empty() || is_private_host(&host) {
            return None;
        }
        let g = geo_map.get(host.split(':').next().unwrap_or("")).cloned();
        Some(json!({ "host": host, "count": count, "sample_url": url, "repo_name": repo, "last_seen": last, "geo": g }))
    })
    .collect();

    // geo / hardware
    let country_tally = tally(uarr.iter().filter_map(|u| u.geo.as_ref().and_then(|g| g.get("country")).and_then(Value::as_str).map(String::from)));
    let mut country_cc = serde_json::Map::new();
    for u in &uarr {
        if let Some(g) = &u.geo {
            if let (Some(c), Some(cc)) = (g.get("country").and_then(Value::as_str), g.get("cc").and_then(Value::as_str)) {
                country_cc.insert(c.into(), json!(cc));
            }
        }
    }
    let regions: Vec<Value> = tally(uarr.iter().filter_map(|u| {
        let g = u.geo.as_ref()?;
        let c = g.get("country").and_then(Value::as_str)?;
        let r = g.get("region").and_then(Value::as_str)?;
        Some(format!("{} · {}", c, r))
    }))
    .into_iter()
    .take(12)
    .map(|x| json!({ "region": x["k"], "count": x["v"] }))
    .collect();
    let os = tally(uarr.iter().map(|u| os_family(s_str(&u.config, "os"))));
    let gpu = tally(uarr.iter().map(|u| gpu_vendor(s_str(&u.config, "gpu")).to_string()));
    let vm_count = uarr.iter().filter(|u| u.config.get("is_vm").and_then(Value::as_bool).unwrap_or(false)).count();

    // benchmarks recent + per-op. Keep at most 2 per creator (newest first) so
    // each creator's last two runs are visible side-by-side for comparison,
    // with exact values: total time, throughput (MB/s), and every op.
    let mut per_creator: HashMap<String, i64> = HashMap::new();
    let mut benchmarks_recent: Vec<Value> = Vec::new();
    for (did, ts, total_ms, dbytes, source, ops) in &brows {
        let id = did.clone().unwrap_or_default();
        let c = per_creator.entry(id.clone()).or_insert(0);
        if *c >= 2 {
            continue;
        }
        *c += 1;
        let mbps = match (dbytes, total_ms) {
            (Some(b), Some(t)) if *t > 0.0 => Some(r2((*b as f64 / 1_048_576.0) / (*t / 1000.0))),
            _ => None,
        };
        benchmarks_recent.push(json!({
            "creator_id": id, "ts": ts, "total_ms": total_ms, "dataset_bytes": dbytes,
            "throughput_mbps": mbps, "source": source, "ops": ops,
        }));
    }
    let mut op_sum: HashMap<String, f64> = HashMap::new();
    let mut op_n: HashMap<String, i64> = HashMap::new();
    for (_, _, _, _, _, ops) in &brows {
        if let Some(obj) = ops.as_object() {
            for (k, v) in obj {
                if let Some(n) = v.as_f64() {
                    *op_sum.entry(k.clone()).or_insert(0.0) += n;
                    *op_n.entry(k.clone()).or_insert(0) += 1;
                }
            }
        }
    }
    let mut benchmarks_ops: Vec<Value> = op_sum
        .iter()
        .map(|(k, sum)| {
            let n = op_n[k];
            json!({ "op": k, "avg_ms": r2(sum / n as f64), "n": n })
        })
        .collect();
    benchmarks_ops.sort_by(|a, b| b["avg_ms"].as_f64().partial_cmp(&a["avg_ms"].as_f64()).unwrap());
    // average benchmark throughput (MB/s) across all runs that reported a dataset size
    let (mut mbps_sum, mut mbps_n) = (0.0f64, 0i64);
    for (_, _, total_ms, dbytes, _, _) in &brows {
        if let (Some(t), Some(b)) = (total_ms, dbytes) {
            if *t > 0.0 {
                mbps_sum += (*b as f64 / 1_048_576.0) / (*t / 1000.0);
                mbps_n += 1;
            }
        }
    }
    let bench_mbps_avg = if mbps_n > 0 { r2(mbps_sum / mbps_n as f64) } else { 0.0 };

    // ── Live instances (persisted, with status + crash) ─────────────────────
    let live_rows: Vec<(String, Option<i64>, Option<i64>, Option<String>, bool, bool, Value)> = sqlx::query_as(
        "SELECT distinct_id, last_seen, started_at, session_id, clean_exit, crashed, data
         FROM live_instances ORDER BY last_seen DESC",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let mut live: Vec<Value> = Vec::new();
    for (did, last_seen, started_at, session_id, clean_exit, crashed, data) in live_rows {
        let last = last_seen.unwrap_or(0);
        let age = now - last;
        let status = if crashed {
            "crashed"
        } else if clean_exit && age > 60_000 {
            "offline"
        } else if age < 60_000 {
            "online"
        } else if age < 180_000 {
            "away"
        } else {
            "offline"
        };
        // keep visible: active instances, or recently crashed (6h)
        let keep = age < 180_000 || (crashed && age < 6 * 3_600_000);
        if !keep {
            continue;
        }
        let g = geo_of(&data.get("public_ip").and_then(Value::as_str).map(String::from));
        live.push(json!({
            "creator_id": did,
            "status": status,
            "country": g.as_ref().and_then(|g| g.get("country")),
            "cc": g.as_ref().and_then(|g| g.get("cc")),
            "version": data.get("version"), "view": data.get("view"),
            "fps": data.get("fps"), "ft": data.get("ft"), "heap": data.get("heap"),
            "ago_s": age / 1000, "started_at": started_at, "session_id": session_id,
            "cpu": data.get("cpu"), "gpu": data.get("gpu"), "ram_gb": data.get("ram_gb"),
            "os": data.get("os"), "is_vm": data.get("is_vm"),
        }));
    }
    let live_count = live.iter().filter(|l| l["status"] == "online" || l["status"] == "away").count();

    // Map — APPROXIMATE only, ONE point per user, with a deterministic
    // sunflower-spiral spread so two users near the same place NEVER share the
    // exact same coordinate (0 collision) and the layout is stable across
    // refreshes. The base is rounded to ~0.25° (privacy), the offset is synthetic.
    let mut by_cell: HashMap<String, Vec<&User>> = HashMap::new();
    for u in &uarr {
        if let Some(g) = &u.geo {
            if let (Some(lat), Some(lon)) = (g.get("lat").and_then(Value::as_f64), g.get("lon").and_then(Value::as_f64)) {
                let key = format!("{:.2},{:.2}", (lat * 4.0).round() / 4.0, (lon * 4.0).round() / 4.0);
                by_cell.entry(key).or_default().push(u);
            }
        }
    }
    let golden = std::f64::consts::PI * (3.0 - 5.0_f64.sqrt()); // ~2.39996 rad
    let mut map_users: Vec<Value> = Vec::new();
    for users in by_cell.values() {
        for (i, u) in users.iter().enumerate() {
            let g = u.geo.as_ref().unwrap();
            let base_lat = (g.get("lat").and_then(Value::as_f64).unwrap_or(0.0) * 4.0).round() / 4.0;
            let base_lon = (g.get("lon").and_then(Value::as_f64).unwrap_or(0.0) * 4.0).round() / 4.0;
            // first user sits at the cell centre; the rest spread on a sunflower
            let (lat, lon) = if i == 0 {
                (base_lat, base_lon)
            } else {
                let r = 0.11 * (i as f64).sqrt(); // degrees — grows slowly
                let a = i as f64 * golden;
                let lon_scale = base_lat.to_radians().cos().abs().max(0.2); // keep dx visually even
                (base_lat + r * a.sin(), base_lon + (r * a.cos()) / lon_scale)
            };
            map_users.push(json!({
                "creator_id": u.creator_id, "lat": lat, "lon": lon,
                "country": g.get("country"), "count": 1, "kind": "user",
            }));
            if map_users.len() >= 800 { break; }
        }
        if map_users.len() >= 800 { break; }
    }
    let map_repos: Vec<Value> = repos
        .iter()
        .filter_map(|r| {
            let g = r.get("geo")?;
            let lat = g.get("lat").and_then(Value::as_f64)?;
            let lon = g.get("lon").and_then(Value::as_f64)?;
            Some(json!({ "lat": approx(lat), "lon": approx(lon), "country": g.get("country"), "host": r.get("host"), "count": r.get("count"), "kind": "repo" }))
        })
        .collect();

    // per-minute activity (60 min)
    let min_since = now - 60 * 60_000;
    let mut min_map: Vec<Value> = Vec::new();
    let mut idx: HashMap<String, usize> = HashMap::new();
    for i in (0..60).rev() {
        let d = chrono::DateTime::from_timestamp_millis(now - i * 60_000).unwrap();
        let key = d.format("%Y-%m-%dT%H:%M").to_string();
        idx.insert(key.clone(), min_map.len());
        min_map.push(json!({ "t": d.format("%H:%M").to_string(), "events": 0, "users": 0, "pageviews": 0, "sessions": 0 }));
    }
    let ma: Vec<(Option<String>, i64, i64, i64)> = sqlx::query_as(
        "SELECT substr(ts,1,16), COUNT(*), COUNT(*) FILTER (WHERE event='page_enter'), COUNT(*) FILTER (WHERE event='session_start')
         FROM events WHERE ts_ms>=$1 GROUP BY substr(ts,1,16)",
    )
    .bind(min_since)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for (m, e, pv, ss) in ma {
        if let Some(m) = m {
            if let Some(&i) = idx.get(&m) {
                min_map[i]["events"] = json!(e);
                min_map[i]["pageviews"] = json!(pv);
                min_map[i]["sessions"] = json!(ss);
            }
        }
    }
    let mu: Vec<(Option<String>, i64)> = sqlx::query_as(
        "SELECT substr(ts,1,16), COUNT(DISTINCT distinct_id) FROM events WHERE ts_ms>=$1 GROUP BY substr(ts,1,16)",
    )
    .bind(min_since)
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    for (m, u) in mu {
        if let Some(m) = m {
            if let Some(&i) = idx.get(&m) {
                min_map[i]["users"] = json!(u);
            }
        }
    }

    // BMM-specific aggregations
    // Prefer the human theme name (falls back to the id) so custom themes show a
    // readable label in "Top themes" instead of an opaque id.
    let themes = tally(uarr.iter().filter_map(|u|
        u.config.get("theme_name").and_then(Value::as_str)
            .or_else(|| u.config.get("theme").and_then(Value::as_str))
            .map(String::from)));
    let theme_kind = tally(uarr.iter().filter_map(|u| u.config.get("theme_kind").and_then(Value::as_str).map(String::from)));
    let languages = tally(uarr.iter().filter_map(|u| u.config.get("locale").and_then(Value::as_str).map(String::from)));
    let tasky = json!({
        "visible": uarr.iter().filter(|u| u.config.get("tasky").and_then(|t| t.get("visible")).and_then(Value::as_bool).unwrap_or(false)).count(),
        "hidden": uarr.iter().filter(|u| matches!(u.config.get("tasky").and_then(|t| t.get("visible")).and_then(Value::as_bool), Some(false))).count(),
        "animations": uarr.iter().filter(|u| u.config.get("tasky").and_then(|t| t.get("animations")).and_then(Value::as_bool).unwrap_or(false)).count(),
        "tooltips": uarr.iter().filter(|u| u.config.get("tasky").and_then(|t| t.get("tooltips")).and_then(Value::as_bool).unwrap_or(false)).count(),
    });

    // BMM content counts — sum across users + how many users reported each.
    let mut content_sum: HashMap<String, f64> = HashMap::new();
    let mut content_users: HashMap<String, i64> = HashMap::new();
    for u in &uarr {
        if let Some(obj) = u.config.get("counts").and_then(Value::as_object) {
            for (k, v) in obj {
                if let Some(n) = v.as_f64() {
                    *content_sum.entry(k.clone()).or_insert(0.0) += n;
                    *content_users.entry(k.clone()).or_insert(0) += 1;
                }
            }
        }
    }
    let content: Vec<Value> = {
        let mut v: Vec<Value> = content_sum
            .iter()
            .map(|(k, sum)| {
                let users = content_users.get(k).copied().unwrap_or(0);
                json!({ "key": k, "total": *sum as i64, "users": users,
                        "avg": if users > 0 { r1(sum / users as f64) } else { 0.0 } })
            })
            .collect();
        v.sort_by(|a, b| b["total"].as_i64().cmp(&a["total"].as_i64()));
        v
    };
    let access = tally(uarr.iter().filter_map(|u| u.config.get("access").and_then(Value::as_str).map(String::from)));

    // per-modal: opens + average perf while that modal was open
    let modal_perf: HashMap<String, Value> = sqlx::query_as::<_, (Option<String>, Option<f64>, Option<f64>, i64)>(
        "SELECT props->>'modal', AVG((props->>'fps_avg')::float), AVG((props->>'frametime_avg_ms')::float), COUNT(*)
         FROM events WHERE event='perf' AND props->>'modal' IS NOT NULL GROUP BY props->>'modal'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|(m, fps, ft, n)| {
        let m = m?;
        Some((m, json!({ "fps": r1(fps.unwrap_or(0.0)), "ft": r2(ft.unwrap_or(0.0)), "perf_n": n })))
    })
    .collect();

    // web vitals (app-level)
    let wv: (Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, i64) = sqlx::query_as(
        "SELECT AVG((props->>'lcp')::float), AVG((props->>'cls')::float), AVG((props->>'inp')::float),
                AVG((props->>'fcp')::float), AVG((props->>'ttfb')::float), COUNT(*)
         FROM events WHERE event='webvitals'",
    )
    .fetch_one(pool)
    .await
    .unwrap_or((None, None, None, None, None, 0));
    let webvitals = json!({
        "lcp": r2(wv.0.unwrap_or(0.0)), "cls": (wv.1.unwrap_or(0.0) * 1000.0).round() / 1000.0,
        "inp": r2(wv.2.unwrap_or(0.0)), "fcp": r2(wv.3.unwrap_or(0.0)), "ttfb": r2(wv.4.unwrap_or(0.0)), "n": wv.5,
    });
    // 24h web-vitals series (for the trend graphs)
    let wv_series: Vec<Value> = sqlx::query_as::<_, (Option<String>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, i64)>(
        "SELECT substr(ts,1,13), AVG((props->>'lcp')::float), AVG((props->>'cls')::float), AVG((props->>'inp')::float),
                AVG((props->>'fcp')::float), AVG((props->>'ttfb')::float), COUNT(*)
         FROM events WHERE event='webvitals' AND ts_ms>=$1 GROUP BY substr(ts,1,13) ORDER BY substr(ts,1,13)",
    )
    .bind(since)
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .map(|(h, lcp, cls, inp, fcp, ttfb, n)| json!({
        "hour": h, "lcp": r2(lcp.unwrap_or(0.0)), "cls": (cls.unwrap_or(0.0)*1000.0).round()/1000.0,
        "inp": r2(inp.unwrap_or(0.0)), "fcp": r2(fcp.unwrap_or(0.0)), "ttfb": r2(ttfb.unwrap_or(0.0)), "n": n,
    }))
    .collect();
    // per-page web vitals (if webvitals events carry a 'view')
    let pv_detail: Vec<Value> = sqlx::query_as::<_, (Option<String>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>, i64)>(
        "SELECT props->>'view', AVG((props->>'lcp')::float), AVG((props->>'cls')::float), AVG((props->>'inp')::float),
                AVG((props->>'fcp')::float), AVG((props->>'ttfb')::float), COUNT(*)
         FROM events WHERE event='webvitals' AND props->>'view' IS NOT NULL GROUP BY props->>'view'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|(v, lcp, cls, inp, fcp, ttfb, n)| {
        let v = v?;
        Some(json!({ "view": v, "lcp": r2(lcp.unwrap_or(0.0)), "cls": (cls.unwrap_or(0.0)*1000.0).round()/1000.0,
                     "inp": r2(inp.unwrap_or(0.0)), "fcp": r2(fcp.unwrap_or(0.0)), "ttfb": r2(ttfb.unwrap_or(0.0)), "n": n }))
    })
    .collect();
    let pv_map: HashMap<String, Value> = pv_detail.iter().filter_map(|d| Some((d["view"].as_str()?.to_string(), d.clone()))).collect();
    // merge vitals + perf + events count into the pages table
    let perf_by_view: HashMap<String, Value> = by_view.iter().filter_map(|d| Some((d["view"].as_str()?.to_string(), d.clone()))).collect();
    let ev_by_view: HashMap<String, i64> = sqlx::query_as::<_, (Option<String>, i64)>(
        "SELECT props->>'view', COUNT(*) FROM events WHERE event='feature' AND props->>'view' IS NOT NULL GROUP BY props->>'view'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default()
    .into_iter()
    .filter_map(|(v, c)| Some((v?, c)))
    .collect();
    for p in pages.iter_mut() {
        let view = p["view"].as_str().unwrap_or("").to_string();
        if let Some(wv) = pv_map.get(&view) {
            p["lcp"] = wv["lcp"].clone();
            p["cls"] = wv["cls"].clone();
            p["inp"] = wv["inp"].clone();
            p["fcp"] = wv["fcp"].clone();
            p["ttfb"] = wv["ttfb"].clone();
        }
        if let Some(pf) = perf_by_view.get(&view) {
            p["fps"] = pf["fps"].clone();
            p["ft"] = pf["ft"].clone();
        }
        p["events"] = json!(ev_by_view.get(&view).copied().unwrap_or(0));
    }

    let modals = kv_rows(pool, "SELECT props->>'name', COUNT(*) FROM events WHERE event='modal_open' AND props->>'name' IS NOT NULL GROUP BY props->>'name' ORDER BY COUNT(*) DESC LIMIT 50", "k2").await;
    let modals_detail: Vec<Value> = modals
        .iter()
        .map(|m| {
            let name = m["k"].as_str().unwrap_or("");
            let perf = modal_perf.get(name);
            json!({ "name": name, "opens": m["v"],
                    "fps": perf.map(|p| p["fps"].clone()).unwrap_or(Value::Null),
                    "ft": perf.map(|p| p["ft"].clone()).unwrap_or(Value::Null),
                    "perf_n": perf.map(|p| p["perf_n"].clone()).unwrap_or(json!(0)) })
        })
        .collect();
    let features = kv_rows(pool, "SELECT props->>'name', COUNT(*) FROM events WHERE event='feature' AND props->>'name' IS NOT NULL GROUP BY props->>'name' ORDER BY COUNT(*) DESC LIMIT 40", "k2").await;
    let tutorial = kv_rows(pool, "SELECT props->>'id', COUNT(*) FROM events WHERE event='tutorial' AND props->>'id' IS NOT NULL GROUP BY props->>'id' ORDER BY COUNT(*) DESC LIMIT 30", "k2").await;

    let wv_pct = webvitals_percentiles(pool).await;

    // All modals the app exposes — union of opened modals + the client's modal
    // catalog (so funnels/goals can target modals that were never opened yet).
    let mut modal_names: std::collections::HashSet<String> = modals
        .iter()
        .filter_map(|m| m["k"].as_str().map(String::from))
        .collect();
    let cat: Vec<(Option<Value>,)> = sqlx::query_as("SELECT props->'names' FROM events WHERE event='modal_catalog'")
        .fetch_all(pool)
        .await
        .unwrap_or_default();
    for (names,) in cat {
        if let Some(arr) = names.and_then(|v| v.as_array().cloned()) {
            for n in arr {
                if let Some(s) = n.as_str() {
                    modal_names.insert(s.to_string());
                }
            }
        }
    }

    // Full auto-reported catalog (pages / tabs / modals / diagrams / guides) — the
    // client enumerates these from its DOM + registries, so the dashboard never
    // needs hand-maintained lists. Union across every app_catalog event.
    let mut cat_pages = std::collections::HashSet::<String>::new();
    let mut cat_tabs = std::collections::HashSet::<String>::new();
    let mut cat_diagrams = std::collections::HashSet::<String>::new();
    let mut cat_guides = std::collections::HashSet::<String>::new();
    // pages already-observed seed the page list too.
    for p in &pages { if let Some(v) = p["view"].as_str() { cat_pages.insert(v.to_string()); } }
    let appcat: Vec<(Value,)> = sqlx::query_as("SELECT props FROM events WHERE event='app_catalog'")
        .fetch_all(pool).await.unwrap_or_default();
    let merge = |set: &mut std::collections::HashSet<String>, props: &Value, key: &str| {
        if let Some(arr) = props.get(key).and_then(|v| v.as_array()) {
            for n in arr { if let Some(s) = n.as_str() { if !s.is_empty() { set.insert(s.to_string()); } } }
        }
    };
    // Human labels for every destination (id → label), so the dashboard can build
    // a documentation page automatically. Last non-empty label wins.
    let mut cat_labels = serde_json::Map::new();
    for (props,) in &appcat {
        merge(&mut cat_pages, props, "pages");
        merge(&mut cat_tabs, props, "tabs");
        merge(&mut modal_names, props, "modals");
        merge(&mut cat_diagrams, props, "diagrams");
        merge(&mut cat_guides, props, "guides");
        if let Some(obj) = props.get("labels").and_then(|v| v.as_object()) {
            for (k, v) in obj {
                if let Some(s) = v.as_str() { if !s.is_empty() { cat_labels.insert(k.clone(), json!(s)); } }
            }
        }
    }

    let mut modals_all: Vec<String> = modal_names.into_iter().collect();
    modals_all.sort();
    let sorted = |s: std::collections::HashSet<String>| { let mut v: Vec<String> = s.into_iter().collect(); v.sort(); v };
    let catalog = json!({
        "pages": sorted(cat_pages),
        "tabs": sorted(cat_tabs),
        "modals": modals_all.clone(),
        "diagrams": sorted(cat_diagrams),
        "guides": sorted(cat_guides),
        "labels": Value::Object(cat_labels),
    });

    let goals = db::list_goals(pool).await;
    let retention = db::retention_cohorts(pool, 8).await;
    let retention_daily = db::retention_cohorts_daily(pool, 30).await;
    // Bucketed activity for the overview granularity selector.
    // Each granularity keeps ~24-30 well-spread points over a sensible window so
    // the chart never bunches everything against one edge.
    let buckets = json!({
        "15m": db::timeseries(pool, 900_000, 24).await,    // last 6h
        "30m": db::timeseries(pool, 1_800_000, 24).await,  // last 12h
        "1h": db::timeseries(pool, 3_600_000, 24).await,   // last 24h
        "1d": db::timeseries(pool, 86_400_000, 30).await,  // last 30d
    });
    let pending = db::pending_deletion_count(pool).await;

    let users_out: Vec<Value> = {
        let mut v: Vec<Value> = uarr
            .iter()
            .map(|u| {
                let g = u.geo.as_ref();
                json!({
                    "creator_id": u.creator_id, "versions": u.versions, "ips": u.ips, "names": u.names,
                    "country": g.and_then(|g| g.get("country")), "city": g.and_then(|g| g.get("city")),
                    "region": g.and_then(|g| g.get("region")), "cc": g.and_then(|g| g.get("cc")),
                    "lat": g.and_then(|g| g.get("lat")), "lon": g.and_then(|g| g.get("lon")),
                    "config": u.config, "sessions": u.sessions, "first_seen": u.first_seen,
                    "last_seen": u.last_seen, "benchmarks": u.benchmarks,
                })
            })
            .collect();
        v.sort_by(|a, b| b["last_seen"].as_str().cmp(&a["last_seen"].as_str()));
        v
    };

    // When do people use BMM? Activity by hour-of-day (UTC) + per-user/session averages.
    let hod_rows: Vec<(Option<String>, i64, i64)> = sqlx::query_as(
        "SELECT substr(ts,12,2), COUNT(*) FILTER (WHERE event='session_start'), COUNT(*)
         FROM events GROUP BY substr(ts,12,2)",
    ).fetch_all(pool).await.unwrap_or_default();
    let mut hod: Vec<Value> = (0..24).map(|h| json!({ "hour": h, "sessions": 0, "events": 0 })).collect();
    for (h, ss, ev) in hod_rows {
        if let Some(h) = h.and_then(|s| s.trim().parse::<usize>().ok()) {
            if h < 24 { hod[h] = json!({ "hour": h, "sessions": ss, "events": ev }); }
        }
    }
    let peak_hour = hod.iter().max_by_key(|x| x["sessions"].as_i64().unwrap_or(0))
        .and_then(|x| x["hour"].as_i64()).unwrap_or(0);
    let avg_events_per_session = if tot_sessions > 0 { r1(ev_total as f64 / tot_sessions as f64) } else { 0.0 };
    let avg_sessions_per_user = if !uarr.is_empty() { r1(tot_sessions as f64 / uarr.len() as f64) } else { 0.0 };

    json!({
        "totals": {
            "users": uarr.len(), "events": ev_total, "sessions": tot_sessions, "pageviews": pageviews,
            "avg_session_min": if tot_sessions > 0 { r1(tot_sess_ms as f64 / tot_sessions as f64 / 60000.0) } else { 0.0 },
            "pages_per_session": if tot_sessions > 0 { r1(pageviews as f64 / tot_sessions as f64) } else { 0.0 },
            "avg_events_per_session": avg_events_per_session,
            "avg_sessions_per_user": avg_sessions_per_user,
            "peak_hour": peak_hour,
            "valid_repos": repos.len(),
            "repo_connections": repos.iter().map(|r| r["count"].as_i64().unwrap_or(0)).sum::<i64>(),
            "benchmarks": bench_total,
            "live": live_count,
        },
        "hour_of_day": hod, "peak_hour": peak_hour,
        "series": series, "buckets": buckets, "events": events, "pages": pages, "funnels": funnels,
        "perf": { "fps_avg": r1(pf.0.unwrap_or(0.0)), "frametime_avg_ms": r2(pf.1.unwrap_or(0.0)),
                  "frametime_worst_ms": r2(pf.2.unwrap_or(0.0)), "heap_avg_mb": r1(pf.3.unwrap_or(0.0)),
                  "bench_mbps_avg": bench_mbps_avg, "byView": by_view },
        "geo": country_tally.iter().map(|x| json!({ "country": x["k"], "count": x["v"] })).collect::<Vec<_>>(),
        "country_cc": country_cc, "regions": regions,
        "os": os, "gpu": gpu, "vm_count": vm_count,
        "repos": repos, "map": { "users": map_users, "repos": map_repos }, "activity_min": min_map,
        "retention": retention, "retention_daily": retention_daily,
        "themes": themes, "theme_kind": theme_kind, "languages": languages, "tasky": tasky,
        "content": content, "access": access,
        "modals": modals, "modals_detail": modals_detail, "modals_all": modals_all, "catalog": catalog,
        "features": features, "tutorial": tutorial,
        "webvitals": webvitals, "webvitals_pct": wv_pct, "webvitals_series": wv_series, "pages_vitals": pv_detail,
        "goals": goals,
        "live": live, "live_count": live_count,
        "benchmarks_recent": benchmarks_recent, "benchmarks_ops": benchmarks_ops,
        "users": users_out,
        "privacy": { "retention_days": cfg.retention_days, "delete_delay_h": cfg.delete_delay_h, "pending_deletions": pending },
        "updated": now,
    })
}

fn empty_user(id: &str) -> User {
    User {
        creator_id: id.to_string(),
        config: json!({}),
        versions: vec![],
        names: vec![],
        ips: vec![],
        sessions: 0,
        session_ms: 0,
        first_seen: None,
        last_seen: None,
        benchmarks: vec![],
        ip: None,
        geo: None,
    }
}

// Percentiles (P50/P75/P90/P99) of each web vital, from raw samples.
async fn webvitals_percentiles(pool: &PgPool) -> Value {
    let rows: Vec<(Option<f64>, Option<f64>, Option<f64>, Option<f64>, Option<f64>)> = sqlx::query_as(
        "SELECT (props->>'lcp')::float,(props->>'cls')::float,(props->>'inp')::float,(props->>'fcp')::float,(props->>'ttfb')::float
         FROM events WHERE event='webvitals'",
    )
    .fetch_all(pool)
    .await
    .unwrap_or_default();
    let (mut lcp, mut cls, mut inp, mut fcp, mut ttfb) = (vec![], vec![], vec![], vec![], vec![]);
    for (a, b, c, d, e) in rows {
        if let Some(x) = a { lcp.push(x) }
        if let Some(x) = b { cls.push(x) }
        if let Some(x) = c { inp.push(x) }
        if let Some(x) = d { fcp.push(x) }
        if let Some(x) = e { ttfb.push(x) }
    }
    json!({ "lcp": pct(&mut lcp), "cls": pct(&mut cls), "inp": pct(&mut inp), "fcp": pct(&mut fcp), "ttfb": pct(&mut ttfb) })
}
fn pct(v: &mut [f64]) -> Value {
    if v.is_empty() {
        return json!({ "p50": null, "p75": null, "p90": null, "p99": null, "n": 0 });
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let q = |p: f64| -> f64 {
        let idx = (((v.len() - 1) as f64) * p).round() as usize;
        v[idx]
    };
    json!({ "p50": r2(q(0.5)), "p75": r2(q(0.75)), "p90": r2(q(0.90)), "p99": r2(q(0.99)), "n": v.len() })
}

async fn scalar(pool: &PgPool, sql: &str) -> i64 {
    sqlx::query_as::<_, (i64,)>(sql).fetch_one(pool).await.map(|r| r.0).unwrap_or(0)
}

// rows of (key, count) → [{event|k: key, count|v: count}]
async fn kv_rows(pool: &PgPool, sql: &str, shape: &str) -> Vec<Value> {
    let rows: Vec<(Option<String>, i64)> = sqlx::query_as(sql).fetch_all(pool).await.unwrap_or_default();
    rows.into_iter()
        .filter_map(|(k, v)| {
            let k = k?;
            Some(match shape {
                "event" => json!({ "event": k, "count": v }),
                _ => json!({ "k": k, "v": v }),
            })
        })
        .collect()
}

// silence unused helper warnings if a path drops out
#[allow(dead_code)]
fn _unused(v: &Value) -> Option<f64> {
    s_f64(v, "x")
}
