-- Admin audit trail: who downloaded / deleted / exported / imported what, when,
-- from which IP + browser fingerprint. Append-only history for accountability.
CREATE TABLE IF NOT EXISTS audit_log (
  id        BIGSERIAL PRIMARY KEY,
  at        BIGINT,
  action    TEXT,        -- replay_download | replay_delete | packet_delete | backup_export | backup_import | deletion_decide
  target    TEXT,        -- session_id / packet_id / 'database' / …
  admin_ip  TEXT,
  admin_fp  TEXT,        -- dashboard-supplied browser fingerprint
  detail    JSONB NOT NULL DEFAULT '{}'::jsonb
);
CREATE INDEX IF NOT EXISTS ix_audit_at ON audit_log(at DESC);
