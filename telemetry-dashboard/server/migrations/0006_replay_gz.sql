-- Store rrweb replay chunks COMPRESSED at rest (gzip bytes) instead of the
-- inflated JSON array. The data column stays for any legacy rows; new chunks go
-- into `gz` and are only decompressed when a session is actually replayed.
ALTER TABLE replay_chunks ADD COLUMN IF NOT EXISTS gz BYTEA;
