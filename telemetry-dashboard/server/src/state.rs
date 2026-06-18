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
        })
    }
}
