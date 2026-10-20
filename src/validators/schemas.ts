/**
 * Zod validation schemas shared by admin and public routes.
 * Field names here match the migration schema columns exactly
 * (text / type / required / answer_display / page_number / display_order).
 */

import { z } from 'zod';

export const QUESTION_TYPES = [
  'single_choice',
  'multi_choice',
  'multi_choice_other',
  'dropdown',
  'short_text',
  'long_text',
] as const;

const CHOICE_TYPE_SET = new Set(['single_choice', 'multi_choice', 'multi_choice_other', 'dropdown']);
const TEXT_TYPE_SET = new Set(['short_text', 'long_text']);

export const MAX_TEXT_LEN = 5000; // long text answers / question text
export const MAX_SHORT_LEN = 500; // short text answers / titles
export const MAX_INSTRUCTIONS_LEN = 2000;
export const MAX_QUESTIONS = 60;
export const MAX_OPTIONS = 40;
export const MAX_RULES = 80;
export const MAX_BODY_BYTES = 256 * 1024;

const trimmed = (max: number) => z.string().trim().min(1).max(max);

export const optionSchema = z.object({
  uid: z.string().trim().min(1).max(64).optional(),
  label: trimmed(300),
  code: z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9]{1,4}$/, 'Option mapping code must be 1-4 alphanumeric characters.'),
  displayOrder: z.number().int().min(1).optional(),
  branchTarget: z.string().trim().min(1).max(64).nullable().optional(),
  isOther: z.boolean().optional(),
});

export const questionSchema = z
  .object({
    uid: z.string().trim().min(1).max(64).optional(),
    type: z.enum(QUESTION_TYPES),
    text: trimmed(MAX_TEXT_LEN),
    instructions: z.string().trim().max(MAX_INSTRUCTIONS_LEN).nullable().optional(),
    required: z.boolean().optional(),
    displayOrder: z.number().int().min(1).optional(),
    pageNumber: z.number().int().min(1).max(100),
    answerDisplay: z.enum(['full', 'mapping']).optional(),
    branchGroup: z.string().trim().min(1).max(64).nullable().optional(),
    options: z.array(optionSchema).max(MAX_OPTIONS).optional(),
  })
  .superRefine((q, ctx) => {
    const hasOptions = CHOICE_TYPE_SET.has(q.type);
    if (hasOptions && (!q.options || q.options.length === 0)) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: `Question type "${q.type}" requires at least one option.`,
      });
    }
    if (!hasOptions && q.options && q.options.length > 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: `Question type "${q.type}" must not define options.`,
      });
    }
    if (q.type === 'multi_choice_other') {
      const others = (q.options ?? []).filter((o) => o.isOther);
      if (others.length !== 1) {
        ctx.addIssue({
          code: 'custom',
          path: ['options'],
          message: 'multi_choice_other requires exactly one option with isOther=true.',
        });
      }
    } else if ((q.options ?? []).some((o) => o.isOther)) {
      ctx.addIssue({
        code: 'custom',
        path: ['options'],
        message: 'isOther is only valid for multi_choice_other questions.',
      });
    }
    void TEXT_TYPE_SET;
  });

export const branchRuleSchema = z.object({
  questionUid: z.string().trim().min(1).max(64),
  optionUid: z.string().trim().min(1).max(64),
  targetGroup: z.string().trim().min(1).max(64),
});

export const interviewUpsertSchema = z.object({
  title: trimmed(MAX_SHORT_LEN),
  description: z.string().trim().max(MAX_TEXT_LEN).optional(),
  questions: z.array(questionSchema).min(1).max(MAX_QUESTIONS),
  branchingRules: z.array(branchRuleSchema).max(MAX_RULES).optional(),
});

export const duplicateSchema = z
  .object({
    title: trimmed(MAX_SHORT_LEN).optional(),
    description: z.string().trim().max(MAX_TEXT_LEN).optional(),
  })
  .default({});

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  perPage: z.coerce.number().int().min(1).max(100).default(20),
});

export const exportModeSchema = z.enum(['mapping', 'readable']).default('readable');

// ---------------- Public submission payload ----------------

export const loginSchema = z.object({
  username: z.string().min(1).max(200),
  password: z.string().min(1).max(500),
});

export const submissionAnswerSchema = z.object({
  questionUid: z.string().trim().min(1).max(64),
  optionUids: z.array(z.string().trim().min(1).max(64)).max(MAX_OPTIONS).optional(),
  text: z.string().max(MAX_TEXT_LEN).nullable().optional(),
  otherText: z.string().max(MAX_TEXT_LEN).nullable().optional(),
});

export const submissionSchema = z.object({
  participant: z.object({
    name: z.string().trim().min(1).max(200),
    email: z.string().trim().min(3).max(254).email(),
  }),
  answers: z.array(submissionAnswerSchema).min(1).max(MAX_QUESTIONS),
  idempotencyKey: z.string().trim().min(8).max(128).optional(),
});
