-- Goals can now carry a numeric objective (e.g. "reach 100 conversions").
ALTER TABLE goals ADD COLUMN IF NOT EXISTS target_count BIGINT NOT NULL DEFAULT 1;
