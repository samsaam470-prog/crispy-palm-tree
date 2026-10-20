-- 0001_initial_schema.sql
-- Interview Research Platform - initial D1 (SQLite) schema.
-- Compatible with Cloudflare D1. Run migrations in numeric order.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- interviews: one ROW PER VERSION. `id` is the sequential internal interview
-- ID shown in the dashboard (formatted as a 3-digit string, e.g. 001).
-- SQLite AUTOINCREMENT guarantees ids are never reused, even after deletions.
-- `public_id` is a random, unguessable token created only at publish time.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS interviews (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  title           TEXT    NOT NULL,
  description     TEXT    NOT NULL DEFAULT '',
  status          TEXT    NOT NULL DEFAULT 'draft'
                    CHECK (status IN ('draft', 'published', 'inactive')),
  public_id       TEXT,                    -- NULL until published; UNIQUE when set
  parent_interview_id INTEGER,             -- version lineage (duplicated-from)
  root_interview_id   INTEGER,             -- first version of this lineage
  config_json     TEXT    NOT NULL DEFAULT '{}',  -- interview-level display config
  created_at      TEXT    NOT NULL,        -- ISO-8601 UTC
  updated_at      TEXT    NOT NULL,        -- ISO-8601 UTC
  published_at    TEXT,                    -- ISO-8601 UTC of first publication
  FOREIGN KEY (parent_interview_id) REFERENCES interviews(id) ON DELETE SET NULL,
  FOREIGN KEY (root_interview_id)   REFERENCES interviews(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_interviews_public_id
  ON interviews(public_id) WHERE public_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status);
CREATE INDEX IF NOT EXISTS idx_interviews_root   ON interviews(root_interview_id);

-- ---------------------------------------------------------------------------
-- questions: definitions belonging to ONE interview version. Never shared
-- across versions - editing a published interview creates a new version with
-- copied question rows, so historical answers always resolve to the original
-- wording. `uid` is the stable client-visible question identifier used by
-- the frontend and submissions.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS questions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id      INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  uid               TEXT    NOT NULL,               -- stable question id (e.g. q_ab12cd34)
  type              TEXT    NOT NULL CHECK (type IN
                      ('single_choice','multi_choice','multi_choice_other',
                       'dropdown','short_text','long_text')),
  text              TEXT    NOT NULL,
  instructions      TEXT,
  required          INTEGER NOT NULL DEFAULT 0 CHECK (required IN (0, 1)),
  display_order     INTEGER NOT NULL,
  page_number       INTEGER NOT NULL,
  answer_display    TEXT    NOT NULL DEFAULT 'full' CHECK (answer_display IN ('full', 'mapping')),
  branch_group      TEXT,                            -- NULL = asked on every path
  created_at        TEXT    NOT NULL,
  updated_at        TEXT    NOT NULL,
  UNIQUE (interview_id, uid),
  UNIQUE (interview_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_questions_interview ON questions(interview_id, page_number, display_order);

-- ---------------------------------------------------------------------------
-- options: choices for choice-type questions. `code` is the compact mapping
-- code (a, b, c...) unique within its question. `branch_target` optionally
-- routes the participant to a branch group when this option is chosen.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS options (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id   INTEGER NOT NULL REFERENCES questions(id) ON DELETE CASCADE,
  uid           TEXT    NOT NULL,                   -- stable option id (e.g. o_9k2m...)
  label         TEXT    NOT NULL,
  code          TEXT    NOT NULL,                   -- mapping code: a, b, c ...
  display_order INTEGER NOT NULL,
  branch_target TEXT,                               -- branch group activated by this option
  is_other      INTEGER NOT NULL DEFAULT 0 CHECK (is_other IN (0, 1)),
  UNIQUE (question_id, uid),
  UNIQUE (question_id, code),
  UNIQUE (question_id, display_order)
);

CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id, display_order);

-- ---------------------------------------------------------------------------
-- branching_rules: configurable per-question branching (not hardcoded).
-- When `option_uid` is selected on `question_uid`, the participant's path
-- gains `target_group`. A question whose branch_group is not in the derived
-- path is not applicable and its answers are rejected.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS branching_rules (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  interview_id INTEGER NOT NULL REFERENCES interviews(id) ON DELETE CASCADE,
  question_uid TEXT    NOT NULL,
  option_uid   TEXT    NOT NULL,
  target_group TEXT    NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_branching_interview ON branching_rules(interview_id, question_uid);

-- ---------------------------------------------------------------------------
-- submissions: one row per participant submission, always tied to the exact
-- interview version it answered. Repeat submissions from the same person are
-- independent rows. `public_id` is the Submission ID exposed in the dashboard.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS submissions (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  public_id      TEXT    NOT NULL UNIQUE,           -- sub_<random> submission id
  interview_id   INTEGER NOT NULL REFERENCES interviews(id),  -- NO cascade: history preserved
  participant_name  TEXT NOT NULL,
  participant_email TEXT NOT NULL,
  branch_path    TEXT    NOT NULL DEFAULT '[]',     -- JSON array of branch groups used
  submitted_at   TEXT    NOT NULL                   -- ISO-8601 UTC
);

CREATE INDEX IF NOT EXISTS idx_submissions_interview ON submissions(interview_id, submitted_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_public_id ON submissions(public_id);

-- ---------------------------------------------------------------------------
-- answers: normalized, one row per selected OPTION (choice questions) or one
-- row for the whole TEXT answer. Question text is never duplicated here.
--   * option_id    -> FK into options of THIS version (authoritative id)
--   * mapping_code -> denormalized copy of the option code at submit time
--   * text_value   -> short/long text answers
--   * other_text   -> "Other" free text accompanying an option selection
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS answers (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  submission_id INTEGER NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
  question_uid TEXT    NOT NULL,                    -- questions.uid within the version
  option_id    INTEGER REFERENCES options(id),      -- NULL for pure text answers
  mapping_code TEXT,                                -- 'a','b',... snapshot of option code
  text_value   TEXT,
  other_text   TEXT
);

-- At most one row per (submission, question, option); exactly one row per
-- (submission, question) for text answers (option_id IS NULL).
CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_unique_option
  ON answers(submission_id, question_uid, option_id) WHERE option_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_answers_unique_text
  ON answers(submission_id, question_uid) WHERE option_id IS NULL;
CREATE INDEX IF NOT EXISTS idx_answers_submission ON answers(submission_id);
CREATE INDEX IF NOT EXISTS idx_answers_question   ON answers(submission_id, question_uid);
