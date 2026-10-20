-- 0002_add_indexes.sql
-- Additional indexes for dashboard query patterns.
-- (Most indexes already ship with 0001; this file exists as the numbered
-- migration point for future index additions and is safe to re-run.)

-- Dashboard "recently created interviews" ordering.
CREATE INDEX IF NOT EXISTS idx_interviews_created ON interviews(created_at DESC, id DESC);

-- Dashboard summary counts by status.
CREATE INDEX IF NOT EXISTS idx_interviews_status_created ON interviews(status, created_at DESC);

-- Recent submissions feed across all versions.
CREATE INDEX IF NOT EXISTS idx_submissions_recent ON submissions(submitted_at DESC, id DESC);
