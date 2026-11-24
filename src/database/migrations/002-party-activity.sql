ALTER TABLE parties
ADD COLUMN last_activity_at TEXT NOT NULL DEFAULT '';

UPDATE parties
SET last_activity_at = COALESCE(updated_at, created_at, datetime('now'));

CREATE INDEX IF NOT EXISTS idx_parties_idle
ON parties(status, last_activity_at);
