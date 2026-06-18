-- Latest source IP seen per user, captured server-side from the ingest request
-- (X-Forwarded-For / socket). Geo is resolved from this so we never depend on
-- the client self-reporting its IP. Only the IP is stored; geo (country/region/
-- city, approximate) lives in the `geo` table keyed by IP.
CREATE TABLE IF NOT EXISTS user_ips (
  distinct_id TEXT PRIMARY KEY,
  ip          TEXT,
  at          BIGINT
);
