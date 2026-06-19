-- Session replay (rrweb) chunks. Kept in a dedicated table — not in `events` —
-- because the payloads are large DOM blobs fetched only on demand for a single
-- session, and we don't want them polluting any of the event aggregations.
-- packet_id ties each chunk to the ingest packet, so per-packet GDPR erasure and
-- retention cover replay data exactly like everything else.
CREATE TABLE IF NOT EXISTS replay_chunks (
  id          BIGSERIAL PRIMARY KEY,
  packet_id   TEXT,
  distinct_id TEXT,
  session_id  TEXT,
  seq         INTEGER,
  ts_ms       BIGINT,
  data        JSONB        -- array of rrweb events
);
CREATE INDEX IF NOT EXISTS idx_replay_session ON replay_chunks (session_id, ts_ms, seq);
CREATE INDEX IF NOT EXISTS idx_replay_packet  ON replay_chunks (packet_id);
CREATE INDEX IF NOT EXISTS idx_replay_ts      ON replay_chunks (ts_ms);
