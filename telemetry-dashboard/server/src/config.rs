//! Runtime configuration, loaded from environment / .env.

#[derive(Clone)]
pub struct Config {
    pub port: u16,
    pub api_key: String,
    pub admin_key: String,
    pub retention_days: i64,
    pub delete_delay_h: i64,
    pub database_url: String,
    pub static_dir: String,
    /// Max ingest requests per minute per client IP (token bucket).
    pub rate_per_min: i64,
    /// Max events accepted in a single batch (oversized batches are rejected).
    pub max_batch: usize,
    /// Default storage limit (MB) when none has been set in the `meta` table. The
    /// fast guard loop trims back down to this whenever the DB grows ~20% past it
    /// (immediately — no waiting for the hourly retention pass).
    pub soft_db_mb: i64,
}

fn env_or(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

impl Config {
    pub fn from_env() -> Self {
        Config {
            port: env_or("PORT", "8900").parse().unwrap_or(8900),
            api_key: env_or("API_KEY", ""),
            admin_key: env_or("ADMIN_KEY", ""),
            retention_days: env_or("RETENTION_DAYS", "180").parse().unwrap_or(180),
            delete_delay_h: env_or("DELETE_DELAY_H", "72").parse().unwrap_or(72),
            database_url: env_or(
                "DATABASE_URL",
                "postgres://bmm:bmm@localhost:5432/telemetry",
            ),
            static_dir: env_or("STATIC_DIR", "public"),
            rate_per_min: env_or("RATE_PER_MIN", "240").parse().unwrap_or(240),
            max_batch: env_or("MAX_BATCH", "1000").parse().unwrap_or(1000),
            soft_db_mb: env_or("SOFT_DB_MB", "5120").parse().unwrap_or(5120),
        }
    }
}
