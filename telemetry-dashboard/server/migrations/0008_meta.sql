-- Small key/value store for runtime-tunable settings (e.g. the storage limit),
-- so they survive restarts without an env change.
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
