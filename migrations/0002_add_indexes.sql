-- 0002_add_indexes.sql
CREATE INDEX IF NOT EXISTS idx_interviews_created ON interviews(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_recent ON submissions(submitted_at DESC, id DESC);
