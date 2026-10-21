export interface Bindings {
  DB: D1Database;
  ADMIN_USER?: string;
  ADMIN_PASS?: string;
  JWT_KEY?: string;
  FRONTEND_ORIGIN?: string;
  PUBLIC_APP_URL?: string;
  ALLOWED_ORIGINS?: string;
  NODE_ENV?: string;
}

export type InterviewStatus = 'draft' | 'published' | 'inactive';
export type QuestionType =
  | 'single_choice'
  | 'multiple_choice'
  | 'multiple_choice_other'
  | 'dropdown'
  | 'short_text'
  | 'long_text';
export type AnswerDisplayPreference = 'full' | 'mapping';

export interface Interview {
  id: string;
  title: string;
  description?: string | null;
  status: InterviewStatus;
  version: number;
  public_id?: string | null;
  parent_version_id?: string | null;
  root_version_id?: string | null;
  created_at: string;
  updated_at: string;
  published_at?: string | null;
  questions?: Question[];
}

export interface Question {
  id: string;
  interview_id: string;
  question_text: string;
  question_type: QuestionType;
  instructions?: string | null;
  is_required: boolean;
  display_order: number;
  page_number: number;
  answer_display_preference: AnswerDisplayPreference;
  branch_group?: string | null;
  options?: QuestionOption[];
}

export interface QuestionOption {
  id: string;
  question_id: string;
  label: string;
  code: string;
  display_order: number;
  branch_target?: string | null;
  is_other?: boolean;
}

export interface Submission {
  id: string;
  interview_id: string;
  participant_name: string;
  participant_email: string;
  branch_path?: string | null;
  submitted_at: string;
  answers?: SubmissionAnswer[];
}

export interface SubmissionAnswer {
  id: string;
  submission_id: string;
  question_id: string;
  selected_option_ids?: string | null;
  selected_option_codes?: string | null;
  text_answer?: string | null;
  other_text?: string | null;
  option_code?: string | null;
}

export interface BranchingRule {
  id: string;
  interview_id: string;
  question_id: string;
  option_id: string;
  target_group: string;
}
