-- 0001_initial_schema.sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS interviews (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'inactive')),
  version INTEGER NOT NULL DEFAULT 1,
  public_id TEXT UNIQUE,
  parent_version_id TEXT,
  root_version_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  published_at TEXT,
  FOREIGN KEY(parent_version_id) REFERENCES interviews(id),
  FOREIGN KEY(root_version_id) REFERENCES interviews(id)
);

CREATE INDEX IF NOT EXISTS idx_interviews_status ON interviews(status, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_interviews_public_id ON interviews(public_id);

CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL,
  question_text TEXT NOT NULL,
  question_type TEXT NOT NULL CHECK (question_type IN ('single_choice', 'multiple_choice', 'multiple_choice_other', 'dropdown', 'short_text', 'long_text')),
  instructions TEXT,
  is_required INTEGER NOT NULL DEFAULT 0 CHECK (is_required IN (0, 1)),
  display_order INTEGER NOT NULL,
  page_number INTEGER NOT NULL,
  answer_display_preference TEXT NOT NULL DEFAULT 'full' CHECK (answer_display_preference IN ('full', 'mapping')),
  branch_group TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(interview_id, display_order),
  FOREIGN KEY(interview_id) REFERENCES interviews(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_questions_interview ON questions(interview_id, page_number, display_order);

CREATE TABLE IF NOT EXISTS options (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  label TEXT NOT NULL,
  code TEXT NOT NULL,
  display_order INTEGER NOT NULL,
  branch_target TEXT,
  is_other INTEGER NOT NULL DEFAULT 0 CHECK (is_other IN (0, 1)),
  UNIQUE(question_id, code),
  UNIQUE(question_id, display_order),
  FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_options_question ON options(question_id, display_order);

CREATE TABLE IF NOT EXISTS branching_rules (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  option_id TEXT NOT NULL,
  target_group TEXT NOT NULL,
  FOREIGN KEY(interview_id) REFERENCES interviews(id) ON DELETE CASCADE,
  FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE,
  FOREIGN KEY(option_id) REFERENCES options(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_branching_interview ON branching_rules(interview_id, question_id);

CREATE TABLE IF NOT EXISTS submissions (
  id TEXT PRIMARY KEY,
  interview_id TEXT NOT NULL,
  participant_name TEXT NOT NULL,
  participant_email TEXT NOT NULL,
  branch_path TEXT NOT NULL DEFAULT '[]',
  submitted_at TEXT NOT NULL,
  FOREIGN KEY(interview_id) REFERENCES interviews(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS idx_submissions_interview ON submissions(interview_id, submitted_at DESC);
CREATE INDEX IF NOT EXISTS idx_submissions_email ON submissions(participant_email);

CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  question_id TEXT NOT NULL,
  selected_option_ids TEXT DEFAULT '[]',
  selected_option_codes TEXT DEFAULT '[]',
  text_answer TEXT,
  other_text TEXT,
  FOREIGN KEY(submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  FOREIGN KEY(question_id) REFERENCES questions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_answers_submission ON answers(submission_id, question_id);
