-- 0003_submission_idempotency.sql
-- Optional idempotency key for public submissions (prevents accidental
-- double-processing of the same request; legitimate repeat submissions from
-- the same participant simply use a new/no key).
-- Apply AFTER 0001 and 0002, in numeric order.

ALTER TABLE submissions ADD COLUMN idempotency_key TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS idx_submissions_idempotency
  ON submissions(interview_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
