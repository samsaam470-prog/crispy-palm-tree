export interface Bindings {
  DB: D1Database;
  ADMIN_USER: string;
  ADMIN_PASS: string;
  JWT_KEY: string;
  FRONTEND_ORIGIN?: string;
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

export interface QuestionOption {
  id: string;
  question_id: string;
  label: string;
  code: string;
  display_order: number;
}

export interface Question {
  id: string;
  interview_id: string;
  question_text: string;
  question_type: QuestionType;
  instructions?: string | null;
  is_required: number | boolean;
  display_order: number;
  page_number: number;
  answer_display_preference: AnswerDisplayPreference;
  options?: QuestionOption[];
}

export interface Interview {
  id: string;
  title: string;
  description?: string | null;
  status: InterviewStatus;
  version: number;
  previous_version_id?: string | null;
  public_id?: string | null;
  created_at: string;
  updated_at: string;
  questions?: Question[];
}

export interface SubmissionAnswer {
  id: string;
  submission_id: string;
  question_id: string;
  selected_options_json?: string | null;
  text_answer?: string | null;
  other_text?: string | null;
}

export interface Submission {
  id: string;
  interview_id: string;
  participant_name: string;
  participant_email: string;
  submitted_at: string;
  answers?: SubmissionAnswer[];
}
