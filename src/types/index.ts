/**
 * Shared domain types and Cloudflare binding declarations.
 */

export interface Env {
  /** D1 database binding (see wrangler.toml [[d1_databases]], binding = "DB"). */
  DB: D1Database;
  /** Rate-limit namespace (wrangler.toml [[kv_namespaces]] binding = "RATE_LIMIT_KV"). */
  RATE_LIMIT_KV?: KVNamespace;

  // ---- Secrets (configure with `wrangler secret put`) ----
  ADMIN_USER: string;   // administrator login name
  ADMIN_PASS: string;   // administrator password
  JWT_KEY: string;      // HS256 signing key (>= 32 chars recommended)

  // ---- Non-secret configuration (wrangler.toml [vars] or plain vars) ----
  PUBLIC_APP_URL?: string;   // e.g. https://your-frontend.example.com
  ALLOWED_ORIGINS?: string;  // comma-separated CORS origins
  NODE_ENV?: string;         // 'production' | 'development' | 'test'
}

export type InterviewStatus = 'draft' | 'published' | 'inactive';

export type QuestionType =
  | 'single_choice'
  | 'multi_choice'
  | 'multi_choice_other'
  | 'dropdown'
  | 'short_text'
  | 'long_text';

export type AnswerDisplay = 'full' | 'mapping';

export const CHOICE_TYPES: ReadonlySet<QuestionType> = new Set([
  'single_choice',
  'multi_choice',
  'multi_choice_other',
  'dropdown',
]);

export const TEXT_TYPES: ReadonlySet<QuestionType> = new Set(['short_text', 'long_text']);

export interface InterviewRow {
  id: number;
  title: string;
  description: string;
  status: InterviewStatus;
  public_id: string | null;
  parent_interview_id: number | null;
  root_interview_id: number | null;
  config_json: string;
  created_at: string;
  updated_at: string;
  published_at: string | null;
}

export interface QuestionRow {
  id: number;
  interview_id: number;
  uid: string;
  type: QuestionType;
  text: string;
  instructions: string | null;
  required: number; // 0 | 1
  display_order: number;
  page_number: number;
  answer_display: AnswerDisplay;
  branch_group: string | null;
}

export interface OptionRow {
  id: number;
  question_id: number;
  uid: string;
  label: string;
  code: string;
  display_order: number;
  branch_target: string | null;
  is_other: number; // 0 | 1
}

export interface BranchingRuleRow {
  id: number;
  interview_id: number;
  question_uid: string;
  option_uid: string;
  target_group: string;
}

export interface SubmissionRow {
  id: number;
  public_id: string;
  interview_id: number;
  participant_name: string;
  participant_email: string;
  branch_path: string; // JSON array
  submitted_at: string;
}

export interface AnswerRow {
  id: number;
  submission_id: number;
  question_uid: string;
  option_id: number | null;
  mapping_code: string | null;
  text_value: string | null;
  other_text: string | null;
}

/** Authenticated principal attached to private requests. */
export interface AuthPrincipal {
  sub: string; // admin username
}
