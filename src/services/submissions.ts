/**
 * Public submission processing.
 *
 * Guarantees:
 *  - The ENTIRE submission is validated before anything is persisted.
 *  - Persistence uses a single D1 batch (atomic transaction in D1), so an
 *    invalid or partially failing request can never leave orphaned rows.
 *  - Branching is enforced server-side: answers to questions outside the
 *    participant's derived path are rejected; required questions on the path
 *    must be answered; hidden conditional questions may be omitted.
 */

import type { Env } from '../types';
import { CHOICE_TYPES, TEXT_TYPES } from '../types';
import { db, one, rows } from '../utils/db';
import { badRequest, conflict, notFound, tooManyRequests } from '../utils/errors';
import { generateSubmissionId } from '../utils/ids';
import { nowIso } from '../utils/time';
import { submissionSchema } from '../validators/schemas';
import type { z } from 'zod';
import { buildDetail, getInterviewByPublicId, type InterviewDetail } from './interviews';

export interface StoredAnswerInput {
  questionUid: string;
  optionUids?: string[];
  text?: string | null;
  otherText?: string | null;
}

/** Derive the participant's branch path from the gate answers + rules. */
export function deriveBranchPath(
  detail: InterviewDetail,
  answers: StoredAnswerInput[],
): { path: string[]; applicableQuestionUids: Set<string> } {
  const rules = detail.branchingRules;
  const groups = new Set(
    detail.questions.map((q) => q.branchGroup).filter(Boolean) as string[],
  );
  const path = new Set<string>();
  // Iterate to a fixed point (rules can chain through nested branches).
  let changed = true;
  const answerByQ = new Map(answers.map((a) => [a.questionUid, a]));
  while (changed) {
    changed = false;
    for (const r of rules) {
      if (path.has(r.targetGroup)) continue;
      const a = answerByQ.get(r.questionUid);
      if (a && (a.optionUids ?? []).includes(r.optionUid)) {
        path.add(r.targetGroup);
        changed = true;
      }
    }
  }
  void groups;
  const applicable = new Set<string>();
  for (const q of detail.questions) {
    if (!q.branchGroup || path.has(q.branchGroup)) applicable.add(q.uid);
  }
  return { path: [...path].sort(), applicableQuestionUids: applicable };
}

export interface ValidatedSubmission {
  participant: { name: string; email: string };
  answers: StoredAnswerInput[];
  branchPath: string[];
  idempotencyKey?: string;
}

/** Full server-side validation of a submission against an interview version. */
export function validateSubmission(
  detail: InterviewDetail,
  payload: z.infer<typeof submissionSchema>,
): ValidatedSubmission {
  const qByUid = new Map(detail.questions.map((q) => [q.uid, q]));
  const seen = new Set<string>();
  const normalized: StoredAnswerInput[] = [];

  for (const a of payload.answers) {
    if (seen.has(a.questionUid)) throw badRequest(`Duplicate answer for question "${a.questionUid}".`);
    seen.add(a.questionUid);
    const q = qByUid.get(a.questionUid);
    if (!q) throw badRequest(`Unknown question id "${a.questionUid}".`, 'UNKNOWN_QUESTION');
    normalized.push({
      questionUid: a.questionUid,
      optionUids: a.optionUids ? [...new Set(a.optionUids)] : undefined,
      text: a.text?.trim() || null,
      otherText: a.otherText?.trim() || null,
    });
  }

  const { path, applicableQuestionUids } = deriveBranchPath(detail, normalized);

  for (const a of normalized) {
    const q = qByUid.get(a.questionUid)!;
    if (!applicableQuestionUids.has(a.questionUid)) {
      throw badRequest(
        `Question "${a.questionUid}" does not apply to the participant's path.`,
        'BRANCH_MISMATCH',
      );
    }
    const optByUid = new Map(q.options.map((o) => [o.uid, o]));
    if (CHOICE_TYPES.has(q.type as any)) {
      if (a.text || a.otherText) {
        throw badRequest(`Question "${a.questionUid}" does not accept free-text values.`, 'ANSWER_FORMAT');
      }
      const chosen = a.optionUids ?? [];
      for (const ouid of chosen) {
        if (!optByUid.has(ouid)) {
          throw badRequest(
            `Option "${ouid}" does not belong to question "${a.questionUid}" of this interview version.`,
            'UNKNOWN_OPTION',
          );
        }
      }
      const multi = q.type === 'multi_choice' || q.type === 'multi_choice_other';
      if (!multi && chosen.length > 1) {
        throw badRequest(`Question "${a.questionUid}" accepts exactly one option.`, 'ANSWER_FORMAT');
      }
      if (q.type === 'multi_choice_other') {
        const otherOpt = q.options.find((o) => o.isOther);
        const pickedOther = otherOpt && chosen.includes(otherOpt.uid);
        if (pickedOther && !a.otherText) {
          throw badRequest(`Question "${a.questionUid}": "Other" requires additional text.`, 'OTHER_TEXT_REQUIRED');
        }
        if (!pickedOther && a.otherText) {
          throw badRequest(`Question "${a.questionUid}": unexpected otherText without Other selection.`, 'ANSWER_FORMAT');
        }
      } else if (chosen.length === 0) {
        throw badRequest(`Question "${a.questionUid}" requires at least one option.`, 'ANSWER_FORMAT');
      }
      if (chosen.length === 0 && q.required) {
        throw badRequest(`Question "${a.questionUid}" is required.`, 'REQUIRED_MISSING');
      }
    } else if (TEXT_TYPES.has(q.type as any)) {
      if (a.optionUids && a.optionUids.length > 0) {
        throw badRequest(`Question "${a.questionUid}" does not accept options.`, 'ANSWER_FORMAT');
      }
      if (a.otherText) {
        throw badRequest(`Question "${a.questionUid}" does not accept otherText.`, 'ANSWER_FORMAT');
      }
      const maxLen = q.type === 'short_text' ? 500 : 5000;
      if (a.text && a.text.length > maxLen) {
        throw badRequest(`Question "${a.questionUid}" answer exceeds ${maxLen} characters.`, 'ANSWER_TOO_LONG');
      }
    } else {
      throw badRequest(`Unsupported question type "${q.type}".`);
    }
  }

  // Required questions on the applicable path must be answered.
  for (const q of detail.questions) {
    if (q.required && applicableQuestionUids.has(q.uid) && !seen.has(q.uid)) {
      throw badRequest(`Question "${q.uid}" is required.`, 'REQUIRED_MISSING');
    }
  }

  return {
    participant: { name: payload.participant.name.trim(), email: payload.participant.email.toLowerCase() },
    answers: normalized,
    branchPath: path,
    idempotencyKey: payload.idempotencyKey,
  };
}

/** Persist a fully-validated submission atomically (single D1 batch). */
export async function persistSubmission(
  env: Env,
  detail: InterviewDetail,
  v: ValidatedSubmission,
): Promise<{ submissionId: string }> {
  const d = db(env);
  const ts = nowIso();

  // Idempotency: if a key was supplied and already used for this version,
  // return the original submission instead of creating a duplicate.
  if (v.idempotencyKey) {
    const existing = await one<{ public_id: string }>(
      env,
      `SELECT public_id FROM submissions WHERE interview_id = ? AND idempotency_key = ?`,
      detail.id,
      v.idempotencyKey,
    );
    if (existing) return { submissionId: existing.public_id };
  }

  const submissionId = generateSubmissionId();

  // Build every statement up front, then execute as ONE atomic D1 batch so a
  // failure can never leave orphaned submissions or partial answers.
  const stmts: any[] = [];
  if (v.idempotencyKey) {
    stmts.push(
      d
        .prepare(
          `INSERT INTO submissions (public_id, interview_id, participant_name, participant_email,
            branch_path, submitted_at, idempotency_key)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          submissionId, detail.id, v.participant.name, v.participant.email,
          JSON.stringify(v.branchPath), ts, v.idempotencyKey,
        ),
    );
  } else {
    stmts.push(
      d
        .prepare(
          `INSERT INTO submissions (public_id, interview_id, participant_name, participant_email,
            branch_path, submitted_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          submissionId, detail.id, v.participant.name, v.participant.email,
          JSON.stringify(v.branchPath), ts,
        ),
    );
  }

  // Resolve internal FK ids via correlated subqueries scoped to THIS version,
  // referencing the submission row by its unique public_id (no two-step read).
  for (const a of v.answers) {
    if (a.optionUids && a.optionUids.length > 0) {
      for (const ouid of a.optionUids) {
        stmts.push(
          d.prepare(
            `INSERT INTO answers (submission_id, question_uid, option_id, mapping_code, other_text)
             SELECT s.id, q.uid, o.id, o.code, ?
             FROM submissions s
             JOIN questions q ON q.interview_id = s.interview_id AND q.uid = ?
             JOIN options o ON o.question_id = q.id AND o.uid = ?
             WHERE s.public_id = ? AND s.interview_id = ?`,
          ).bind(a.otherText ?? null, a.questionUid, ouid, submissionId, detail.id),
        );
      }
    } else {
      stmts.push(
        d
          .prepare(
            `INSERT INTO answers (submission_id, question_uid, option_id, mapping_code, text_value)
             SELECT s.id, q.uid, NULL, NULL, ?
             FROM submissions s
             JOIN questions q ON q.interview_id = s.interview_id AND q.uid = ?
             WHERE s.public_id = ? AND s.interview_id = ?`,
          )
          .bind(a.text ?? '', a.questionUid, submissionId, detail.id),
      );
    }
  }
  await d.batch(stmts);
  return { submissionId };
}

/** Handle a public submission end-to-end. */
export async function processPublicSubmission(
  env: Env,
  publicId: string,
  body: unknown,
): Promise<{ submissionId: string; message: string }> {
  const interview = await getInterviewByPublicId(env, publicId);
  if (!interview) throw notFound('Interview not found.');
  if (interview.status === 'inactive') {
    throw conflict('This interview is no longer accepting responses.', 'INTERVIEW_INACTIVE');
  }
  if (interview.status !== 'published') {
    throw notFound('Interview not found.');
  }
  const detail = await buildDetail(env, interview);
  const payload = submissionSchema.parse(body);
  const validated = validateSubmission(detail, payload);
  const res = await persistSubmission(env, detail, validated);
  return { submissionId: res.submissionId, message: 'Your response has been recorded. Thank you!' };
}

void tooManyRequests;
void rows;
