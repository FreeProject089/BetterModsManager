//! IP geolocation (ip-api.com), cached in the `geo` table.
//! We only ever keep country / region / city / lat / lon — and the dashboard
//! shows them APPROXIMATELY (rounded + jittered) so no precise home location
//! is ever derivable.

use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::HashMap;

pub fn is_private_host(h: &str) -> bool {
    if h.is_empty() {
        return true;
    }
    let host = h.split(':').next().unwrap_or("").to_lowercase();
    if host == "localhost" || host.ends_with(".local") {
        return true;
    }
    if host.starts_with("127.") || host.starts_with("10.") || host.starts_with("192.168.") {
        return true;
    }
    // 172.16.0.0 – 172.31.255.255
    if let Some(rest) = host.strip_prefix("172.") {
        if let Some(oct) = rest.split('.').next() {
            if let Ok(n) = oct.parse::<u32>() {
                if (16..=31).contains(&n) {
                    return true;
                }
            }
        }
    }
    if host == "::1" || host.starts_with("fc") || host.starts_with("fd") {
        return true;
    }
    false
}

fn clean(key: &str) -> String {
    key.split(':').next().unwrap_or("").to_string()
}

/// Load the whole geo cache into a map for one stats pass (`key -> data`).
pub async fn load_geo_map(pool: &PgPool) -> HashMap<String, Value> {
    let mut m = HashMap::new();
    if let Ok(rows) = sqlx::query_as::<_, (String, Value)>("SELECT key, data FROM geo")
        .fetch_all(pool)
        .await
    {
        for (k, v) in rows {
            m.insert(k, v);
        }
    }
    m
}

/// Resolve an IP/host to geo and cache it. De-duped via the shared in-flight set.
/// Fire-and-forget: spawns its own task.
pub fn resolve_geo(
    pool: PgPool,
    inflight: std::sync::Arc<tokio::sync::Mutex<std::collections::HashSet<String>>>,
    key: &str,
) {
    let k = clean(key);
    if k.is_empty() || is_private_host(&k) {
        return;
    }
    tokio::spawn(async move {
        {
            let mut set = inflight.lock().await;
            if set.contains(&k) {
                return;
            }
            set.insert(k.clone());
        }
        // already cached?
        let cached: Option<(String,)> = sqlx::query_as("SELECT key FROM geo WHERE key=$1")
            .bind(&k)
            .fetch_optional(&pool)
            .await
            .unwrap_or(None);
        if cached.is_some() {
            inflight.lock().await.remove(&k);
            return;
        }
        // ipwho.is — free HTTPS geolocation, no API key. (ip-api.com's HTTPS is a
        // paid feature; its free tier is HTTP-only, which we won't use server-side.)
        let url = format!("https://ipwho.is/{}", urlencoding(&k));
        let res = reqwest::Client::new()
            .get(&url)
            .timeout(std::time::Duration::from_secs(8))
            .send()
            .await;
        if let Ok(resp) = res {
            if let Ok(j) = resp.json::<Value>().await {
                if j.get("success").and_then(Value::as_bool) == Some(true) {
                    let data = json!({
                        "country": j.get("country"),
                        "cc": j.get("country_code"),
                        "region": j.get("region"),
                        "city": j.get("city"),
                        "lat": j.get("latitude"),
                        "lon": j.get("longitude"),
                    });
                    let _ = sqlx::query(
                        "INSERT INTO geo(key,data,at) VALUES($1,$2,$3)
                         ON CONFLICT(key) DO UPDATE SET data=excluded.data, at=excluded.at",
                    )
                    .bind(&k)
                    .bind(&data)
                    .bind(chrono::Utc::now().timestamp_millis())
                    .execute(&pool)
                    .await;
                }
            }
        }
        inflight.lock().await.remove(&k);
    });
}

fn urlencoding(s: &str) -> String {
    s.chars()
        .map(|c| match c {
            'A'..='Z' | 'a'..='z' | '0'..='9' | '.' | '-' | '_' | '~' | ':' => c.to_string(),
            _ => format!("%{:02X}", c as u32),
        })
        .collect()
}
