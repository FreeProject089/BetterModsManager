-- Monthly recaps: lightweight aggregate snapshots, generated on demand and/or
-- imported. The heavy `data` is only fetched when a recap is downloaded; the list
-- view reads just the metadata columns.
CREATE TABLE IF NOT EXISTS recaps (
  id         BIGSERIAL PRIMARY KEY,
  month      TEXT,
  created_at BIGINT,
  anon       BOOLEAN NOT NULL DEFAULT FALSE,
  source     TEXT,            -- 'generated' | 'imported'
  data       JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS ix_recaps_month ON recaps(month);
