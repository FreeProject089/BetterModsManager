//! Shared application state.

use crate::config::Config;
use serde_json::{json, Value};
use sqlx::PgPool;
use std::collections::HashSet;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use tokio::sync::{broadcast, Mutex, RwLock};

pub type Shared = Arc<AppState>;

pub struct AppState {
    pub pool: PgPool,
    pub cfg: Config,
    /// SSE fan-out: each refresh pushes the serialized stats payload.
    pub tx: broadcast::Sender<String>,
    /// Latest computed stats (served by GET /api/stats and on SSE connect).
    pub cache: RwLock<Value>,
    /// Set when new data arrives → a prompt refresh follows (≤1.2s).
    pub dirty: AtomicBool,
    /// De-dupes concurrent geo lookups.
    pub geo_inflight: Arc<Mutex<HashSet<String>>>,
    /// Per-IP token bucket for ingest rate limiting (tokens, last refill).
    pub rate: std::sync::Mutex<std::collections::HashMap<String, (f64, std::time::Instant)>>,
}

impl AppState {
    /// Token-bucket: returns false when the IP has exceeded `per_min` req/min.
    pub fn allow(&self, key: &str, per_min: i64) -> bool {
        let burst = (per_min as f64).max(1.0);
        let refill = burst / 60.0; // tokens per second
        let now = std::time::Instant::now();
        let mut m = self.rate.lock().unwrap();
        if m.len() > 20_000 {
            m.clear(); // crude cap so the map can't grow unbounded
        }
        let e = m.entry(key.to_string()).or_insert((burst, now));
        let elapsed = now.duration_since(e.1).as_secs_f64();
        e.0 = (e.0 + elapsed * refill).min(burst);
        e.1 = now;
        if e.0 >= 1.0 {
            e.0 -= 1.0;
            true
        } else {
            false
        }
    }
}

impl AppState {
    pub fn new(pool: PgPool, cfg: Config) -> Shared {
        let (tx, _rx) = broadcast::channel(16);
        Arc::new(AppState {
            pool,
            cfg,
            tx,
            cache: RwLock::new(json!({ "updated": 0 })),
            dirty: AtomicBool::new(false),
            geo_inflight: Arc::new(Mutex::new(HashSet::new())),
            rate: std::sync::Mutex::new(std::collections::HashMap::new()),
        })
    }
}
