-- BMM telemetry — Postgres schema.
-- Everything is DERIVED from the `events` table, so retention and per-packet
-- erasure are exact: delete the rows and every stat reflects it.

CREATE TABLE IF NOT EXISTS events (
  id          BIGSERIAL PRIMARY KEY,
  packet_id   TEXT,
  distinct_id TEXT,
  event       TEXT,
  ts          TEXT,
  ts_ms       BIGINT,
  props       JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_ev_did   ON events(distinct_id);
CREATE INDEX IF NOT EXISTS ix_ev_evt   ON events(event);
CREATE INDEX IF NOT EXISTS ix_ev_ts    ON events(ts_ms);
CREATE INDEX IF NOT EXISTS ix_ev_pkt   ON events(packet_id);
CREATE INDEX IF NOT EXISTS ix_ev_props ON events USING GIN (props jsonb_path_ops);

CREATE TABLE IF NOT EXISTS benchmarks (
  id            BIGSERIAL PRIMARY KEY,
  packet_id     TEXT,
  distinct_id   TEXT,
  ts            TEXT,
  ts_ms         BIGINT,
  total_ms      DOUBLE PRECISION,
  dataset_bytes BIGINT,
  source        TEXT,
  ops           JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_b_did ON benchmarks(distinct_id);
CREATE INDEX IF NOT EXISTS ix_b_pkt ON benchmarks(packet_id);

CREATE TABLE IF NOT EXISTS geo (
  key  TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  at   BIGINT
);

CREATE TABLE IF NOT EXISTS deletions (
  packet_id    TEXT PRIMARY KEY,
  requested_at BIGINT,
  scheduled_at BIGINT,
  status       TEXT,
  decided_at   BIGINT,
  decided_by   TEXT
);

CREATE TABLE IF NOT EXISTS goals (
  id         BIGSERIAL PRIMARY KEY,
  name       TEXT,
  type       TEXT,
  target     TEXT,
  created_at BIGINT
);

-- Live instances are PERSISTED (survive a server restart) and carry a status
-- so the dashboard can show online / away / offline / crashed per instance.
CREATE TABLE IF NOT EXISTS live_instances (
  distinct_id TEXT PRIMARY KEY,
  last_seen   BIGINT,
  started_at  BIGINT,
  session_id  TEXT,
  clean_exit  BOOLEAN NOT NULL DEFAULT FALSE,
  crashed     BOOLEAN NOT NULL DEFAULT FALSE,
  data        JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_live_seen ON live_instances(last_seen);
