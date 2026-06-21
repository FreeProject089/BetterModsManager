-- GDPR "right to access": users can request a copy of their data; an admin
-- reviews each request and e-mails the export back manually.
CREATE TABLE IF NOT EXISTS data_requests (
    id          BIGSERIAL PRIMARY KEY,
    creator_id  TEXT NOT NULL,
    email       TEXT NOT NULL,
    status      TEXT NOT NULL DEFAULT 'pending',   -- pending | done | rejected
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
    decided_at  TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_data_requests_status ON data_requests(status);
