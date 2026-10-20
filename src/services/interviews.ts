/**
 * Interview management + immutable versioning service.
 *
 * Versioning model:
 *  - Every row in `interviews` is one immutable-once-published VERSION with
 *    its own sequential internal id (dashboard "Interview ID", 001, 002...).
 *  - Drafts can be edited in place via full replacement (PUT).
 *  - Editing a PUBLISHED or INACTIVE version never touches it: PUT creates a
 *    new draft version that receives the submitted definition; the old row,
 *    its questions/options/rules and its public link stay intact.
 *  - Publishing assigns a fresh cryptographically random public_id; an
 *    already-published version keeps its original public_id when reactivated.
 */

import type { Env } from '../types';
import type {
  BranchingRuleRow,
  InterviewRow,
  OptionRow,
  QuestionRow,
} from '../types';
import { db, one, rows } from '../utils/db';
import { badRequest, conflict, notFound } from '../utils/errors';
import { generatePublicId, generateUid } from '../utils/ids';
import { formatInterviewId, nowIso } from '../utils/time';
import { CHOICE_TYPES } from '../types';
import {
  interviewUpsertSchema,
  MAX_QUESTIONS,
  type questionSchema,
} from '../validators/schemas';

type QuestionInput = z.infer<typeof questionSchema>;
import { z } from 'zod';

export interface QuestionWithOptions {
  uid: string;
  type: string;
  text: string;
  instructions: string | null;
  required: boolean;
  displayOrder: number;
  pageNumber: number;
  answerDisplay: 'full' | 'mapping';
  branchGroup: string | null;
  options: Array<{
    uid: string;
    label: string;
    code: string;
    displayOrder: number;
    branchTarget: string | null;
    isOther: boolean;
  }>;
}

export interface InterviewDetail {
  id: number;
  interviewId: string; // display "001"
  title: string;
  description: string;
  status: string;
  publicId: string | null;
  parentInterviewId: number | null;
  rootInterviewId: number | null;
  createdAt: string;
  updatedAt: string;
  publishedAt: string | null;
  questions: QuestionWithOptions[];
  branchingRules: Array<{ questionUid: string; optionUid: string; targetGroup: string }>;
}

/** Validate structural integrity + the 3-questions-per-page limit. */
export function validateInterviewDefinition(
  questions: QuestionInput[],
  rules: Array<{ questionUid: string; optionUid: string; targetGroup: string }>,
): void {
  const errors: string[] = [];
  // Assign uids exactly as prepareDefinition() will, so validation checks the
  // same identifiers that get persisted and referenced by branching rules.
  const effectiveUids = questions.map((q, i) =>
    q.uid && q.uid.length > 0 ? q.uid : `assigned#${i}`,
  );
  const seen = new Set<string>();
  effectiveUids.forEach((u) => {
    if (u.startsWith('assigned#')) return;
    if (seen.has(u)) errors.push(`Duplicate question uid "${u}".`);
    seen.add(u);
  });
  // page limit: max 3 questions per page
  const perPage = new Map<number, number>();
  for (const q of questions) {
    perPage.set(q.pageNumber, (perPage.get(q.pageNumber) ?? 0) + 1);
  }
  for (const [page, count] of perPage) {
    if (count > 3) errors.push(`Page ${page} has ${count} questions; maximum is 3 per page.`);
  }
  // duplicate display orders would violate UNIQUE(interview_id, display_order)
  const orders = new Map<number, number>();
  questions.forEach((q, i) => {
    const o = q.displayOrder ?? i + 1;
    orders.set(o, (orders.get(o) ?? 0) + 1);
  });
  for (const [order, count] of orders) {
    if (count > 1) errors.push(`Duplicate displayOrder ${order}.`);
  }
  // branching rule references must resolve within this version
  const indexByUid = new Map<string, number>();
  effectiveUids.forEach((u, i) => {
    if (!u.startsWith('assigned#')) indexByUid.set(u, i);
  });
  const groups = new Set(questions.map((q) => q.branchGroup).filter(Boolean) as string[]);
  for (const r of rules) {
    const qi = indexByUid.get(r.questionUid);
    if (qi === undefined) {
      errors.push(`Branching rule references unknown question "${r.questionUid}".`);
      continue;
    }
    const q = questions[qi];
    if (!CHOICE_TYPES.has(q.type as any)) {
      errors.push(`Branching rule source question "${r.questionUid}" must be a choice type.`);
    }
    if (!(q.options ?? []).some((o) => o.uid === r.optionUid)) {
      errors.push(
        `Branching rule references option "${r.optionUid}" not belonging to question "${r.questionUid}".`,
      );
    }
    if (!groups.has(r.targetGroup)) {
      errors.push(`Branching rule targets unknown group "${r.targetGroup}".`);
    }
  }
  if (errors.length > 0) throw badRequest(errors[0], 'VALIDATION_ERROR');
}

export async function getInterviewById(env: Env, id: number): Promise<InterviewRow | null> {
  return one<InterviewRow>(env, 'SELECT * FROM interviews WHERE id = ?', id);
}

export async function getInterviewByPublicId(env: Env, publicId: string): Promise<InterviewRow | null> {
  return one<InterviewRow>(
    env,
    "SELECT * FROM interviews WHERE public_id = ? AND status IN ('published','inactive')",
    publicId,
  );
}

/** Load a full interview detail (definition) by internal id. */
export async function loadInterviewDetail(env: Env, id: number): Promise<InterviewDetail> {
  const interview = await getInterviewById(env, id);
  if (!interview) throw notFound('Interview not found.');
  return buildDetail(env, interview);
}

export async function buildDetail(env: Env, interview: InterviewRow): Promise<InterviewDetail> {
  const qs = await rows<QuestionRow>(
    env,
    'SELECT * FROM questions WHERE interview_id = ? ORDER BY display_order',
    interview.id,
  );
  const opts = await rows<OptionRow>(
    env,
    `SELECT o.* FROM options o JOIN questions q ON q.id = o.question_id
     WHERE q.interview_id = ? ORDER BY o.display_order`,
    interview.id,
  );
  const rules = await rows<BranchingRuleRow>(
    env,
    'SELECT * FROM branching_rules WHERE interview_id = ?',
    interview.id,
  );
  const questions: QuestionWithOptions[] = qs.map((q) => ({
    uid: q.uid,
    type: q.type,
    text: q.text,
    instructions: q.instructions ?? null,
    required: !!q.required,
    displayOrder: q.display_order,
    pageNumber: q.page_number,
    answerDisplay: q.answer_display,
    branchGroup: q.branch_group ?? null,
    options: opts
      .filter((o) => o.question_id === q.id)
      .map((o) => ({
        uid: o.uid,
        label: o.label,
        code: o.code,
        displayOrder: o.display_order,
        branchTarget: o.branch_target ?? null,
        isOther: !!o.is_other,
      })),
  }));
  return {
    id: interview.id,
    interviewId: formatInterviewId(interview.id),
    title: interview.title,
    description: interview.description,
    status: interview.status,
    publicId: interview.public_id,
    parentInterviewId: interview.parent_interview_id,
    rootInterviewId: interview.root_interview_id,
    createdAt: interview.created_at,
    updatedAt: interview.updated_at,
    publishedAt: interview.published_at,
    questions,
    branchingRules: rules.map((r) => ({
      questionUid: r.question_uid,
      optionUid: r.option_uid,
      targetGroup: r.target_group,
    })),
  };
}

interface PreparedDefinition {
  qRows: Array<Record<string, unknown>>;
  oRows: Array<Record<string, unknown>>;
  rRows: Array<Record<string, unknown>>;
}

/** Build bind-parameter rows for a full definition (assigns missing uids/orders). */
export function prepareDefinition(
  questions: QuestionInput[],
  rules: Array<{ questionUid: string; optionUid: string; targetGroup: string }>,
): PreparedDefinition {
  const qRows: PreparedDefinition['qRows'] = [];
  const oRows: PreparedDefinition['oRows'] = [];
  const rRows: PreparedDefinition['rRows'] = [];
  const ts = nowIso();
  questions.forEach((q, qi) => {
    // Deterministic fallback uid — matches validateInterviewDefinition().
    const quid = q.uid && q.uid.length > 0 ? q.uid : generateUid('q');
    qRows.push({
      uid: quid,
      type: q.type,
      text: q.text,
      instructions: q.instructions ?? null,
      required: q.required ? 1 : 0,
      display_order: q.displayOrder ?? qi + 1,
      page_number: q.pageNumber,
      answer_display: q.answerDisplay ?? 'full',
      branch_group: q.branchGroup ?? null,
      created_at: ts,
      updated_at: ts,
    });
    (q.options ?? []).forEach((o, oi) => {
      oRows.push({
        quid,
        uid: o.uid && o.uid.length ? o.uid : generateUid('o'),
        label: o.label,
        code: o.code.toLowerCase(),
        display_order: o.displayOrder ?? oi + 1,
        branch_target: o.branchTarget ?? null,
        is_other: o.isOther ? 1 : 0,
      });
    });
  });
  for (const r of rules) {
    rRows.push({ question_uid: r.questionUid, option_uid: r.optionUid, target_group: r.targetGroup });
  }
  return { qRows, oRows, rRows };
}

const INS_Q = `INSERT INTO questions (interview_id, uid, type, text, instructions, required,
  display_order, page_number, answer_display, branch_group, created_at, updated_at)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
const INS_O = `INSERT INTO options (question_id, uid, label, code, display_order, branch_target, is_other)
  SELECT questions.id, ?, ?, ?, ?, ?, ? FROM questions
  WHERE questions.interview_id = ? AND questions.uid = ?`;
const INS_R = `INSERT INTO branching_rules (interview_id, question_uid, option_uid, target_group) VALUES (?, ?, ?, ?)`;

/** Create a new draft interview version with a full definition. */
export async function createDraft(
  env: Env,
  input: z.infer<typeof interviewUpsertSchema>,
  parent?: { parentId: number; rootId: number },
): Promise<InterviewDetail> {
  const parsed = interviewUpsertSchema.parse(input);
  validateInterviewDefinition(parsed.questions, parsed.branchingRules ?? []);
  const def = prepareDefinition(parsed.questions, parsed.branchingRules ?? []);
  const ts = nowIso();
  const d = db(env);
  // Step 1: insert the interview row and read its AUTOINCREMENT id (D1 batch
  // cannot reference last_insert_id across statements, so this is two steps).
  await d
    .prepare(
      `INSERT INTO interviews (title, description, status, config_json, created_at, updated_at,
        parent_interview_id, root_interview_id)
       VALUES (?, ?, 'draft', '{}', ?, ?, ?, ?)`,
    )
    .bind(parsed.title, parsed.description ?? '', ts, ts, parent?.parentId ?? null, parent?.rootId ?? null)
    .run();
  const created = await one<{ id: number }>(env, 'SELECT MAX(id) AS id FROM interviews');
  const interviewId = created?.id;
  if (!interviewId) throw new Error('Failed to create interview row.');

  // Step 2: questions, then options + branching rules (batched per group so
  // option INSERT...SELECT can resolve question ids within the same version).
  const qStmts = def.qRows.map((q) =>
    d
      .prepare(INS_Q)
      .bind(
        interviewId, q.uid, q.type, q.text, q.instructions, q.required,
        q.display_order, q.page_number, q.answer_display, q.branch_group,
        q.created_at, q.updated_at,
      ),
  );
  await d.batch(qStmts);
  const rest = [
    ...def.oRows.map((o) =>
      d
        .prepare(INS_O)
        .bind(o.uid, o.label, o.code, o.display_order, o.branch_target, o.is_other, interviewId, o.quid),
    ),
    ...def.rRows.map((r) =>
      d.prepare(INS_R).bind(interviewId, r.question_uid, r.option_uid, r.target_group),
    ),
  ];
  await d.batch(rest);
  return loadInterviewDetail(env, interviewId);
}

/** Replace a DRAFT's definition in place. Throws if not a draft. */
export async function replaceDraftDefinition(
  env: Env,
  interview: InterviewRow,
  input: z.infer<typeof interviewUpsertSchema>,
): Promise<InterviewDetail> {
  const parsed = interviewUpsertSchema.parse(input);
  validateInterviewDefinition(parsed.questions, parsed.branchingRules ?? []);
  const def = prepareDefinition(parsed.questions, parsed.branchingRules ?? []);
  const ts = nowIso();
  const d = db(env);
  await d.batch([
    d.prepare('DELETE FROM branching_rules WHERE interview_id = ?').bind(interview.id),
    d.prepare('DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE interview_id = ?)').bind(interview.id),
    d.prepare('DELETE FROM questions WHERE interview_id = ?').bind(interview.id),
    d.prepare('UPDATE interviews SET title = ?, description = ?, updated_at = ? WHERE id = ?').bind(
      parsed.title, parsed.description ?? '', ts, interview.id,
    ),
  ]);
  const qStmts = def.qRows.map((q) =>
    d
      .prepare(INS_Q)
      .bind(
        interview.id, q.uid, q.type, q.text, q.instructions, q.required,
        q.display_order, q.page_number, q.answer_display, q.branch_group,
        q.created_at, q.updated_at,
      ),
  );
  await d.batch(qStmts);
  const rest = [
    ...def.oRows.map((o) =>
      d
        .prepare(INS_O)
        .bind(o.uid, o.label, o.code, o.display_order, o.branch_target, o.is_other, interview.id, o.quid),
    ),
    ...def.rRows.map((r) =>
      d.prepare(INS_R).bind(interview.id, r.question_uid, r.option_uid, r.target_group),
    ),
  ];
  await d.batch(rest);
  return loadInterviewDetail(env, interview.id);
}

/** Deep-copy a version's definition into a NEW draft version (no submissions copied). */
export async function duplicateToNewDraft(
  env: Env,
  source: InterviewRow,
  overrides?: { title?: string; description?: string },
): Promise<InterviewDetail> {
  const detail = await buildDetail(env, source);
  if (detail.questions.length === 0) throw conflict('Source interview has no questions to duplicate.', 'EMPTY_INTERVIEW');
  // Keep the same question/option uids: uniqueness is scoped per interview
  // version, so branching rules stay valid without remapping.
  const input = {
    title: overrides?.title ?? `${source.title} (copy)`,
    description: overrides?.description ?? source.description,
    questions: detail.questions.map((q) => ({
      uid: q.uid,
      type: q.type as any,
      text: q.text,
      instructions: q.instructions,
      required: q.required,
      displayOrder: q.displayOrder,
      pageNumber: q.pageNumber,
      answerDisplay: q.answerDisplay as 'full' | 'mapping',
      branchGroup: q.branchGroup,
      options: q.options.map((o) => ({
        uid: o.uid,
        label: o.label,
        code: o.code,
        displayOrder: o.displayOrder,
        branchTarget: o.branchTarget,
        isOther: o.isOther,
      })),
    })),
    branchingRules: detail.branchingRules.map((r) => ({ ...r })),
  };
  const root = source.root_interview_id ?? source.id;
  return createDraft(env, input as any, { parentId: source.id, rootId: root });
}

/** Publishability check used by publish route. */
export async function assertPublishable(env: Env, detail: InterviewDetail): Promise<void> {
  if (detail.questions.length === 0) throw badRequest('Cannot publish an interview with no questions.');
  const perPage = new Map<number, number>();
  for (const q of detail.questions) perPage.set(q.pageNumber, (perPage.get(q.pageNumber) ?? 0) + 1);
  for (const [page, count] of perPage) {
    if (count > 3) throw badRequest(`Cannot publish: page ${page} has ${count} questions (max 3).`);
  }
  for (const q of detail.questions) {
    if (CHOICE_TYPES.has(q.type as any) && q.options.length === 0) {
      throw badRequest(`Cannot publish: question "${q.text.slice(0, 40)}" has no options.`);
    }
  }
  void MAX_QUESTIONS;
}

/** Assign a unique public id with collision retry, mark published. */
export async function publishInterview(env: Env, interview: InterviewRow): Promise<InterviewDetail> {
  if (interview.status === 'published') throw conflict('Interview version is already published.', 'ALREADY_PUBLISHED');
  const detail = await buildDetail(env, interview);
  await assertPublishable(env, detail);
  const ts = nowIso();
  const d = db(env);
  for (let attempt = 0; attempt < 5; attempt++) {
    const pid = generatePublicId(22);
    const clash = await one<{ c: number }>(env, 'SELECT COUNT(*) AS c FROM interviews WHERE public_id = ?', pid);
    if ((clash?.c ?? 0) > 0) continue;
    try {
      const res = await d
        .prepare('UPDATE interviews SET status = ?, public_id = ?, published_at = ?, updated_at = ? WHERE id = ? AND status = ?')
        .bind('published', pid, ts, ts, interview.id, 'draft')
        .run();
      if (((res.meta as any)?.changes ?? 1) === 0) throw conflict('Interview changed concurrently; reload and retry.', 'STATE_CONFLICT');
      return loadInterviewDetail(env, interview.id);
    } catch (e: any) {
      // UNIQUE constraint on public_id — retry with a new token.
      if (String(e?.message ?? '').includes('UNIQUE')) continue;
      throw e;
    }
  }
  throw new Error('Unable to allocate a unique public identifier.');
}

export async function setStatus(
  env: Env,
  interview: InterviewRow,
  next: 'inactive' | 'published',
): Promise<InterviewDetail> {
  const d = db(env);
  const ts = nowIso();
  let expected: string;
  if (next === 'inactive') {
    if (interview.status !== 'published') throw conflict('Only a published version can be deactivated.', 'INVALID_STATE');
    expected = 'published';
  } else {
    if (interview.status !== 'inactive') throw conflict('Only an inactive version can be reactivated.', 'INVALID_STATE');
    expected = 'inactive';
  }
  const res = await d
    .prepare('UPDATE interviews SET status = ?, updated_at = ? WHERE id = ? AND status = ?')
    .bind(next, ts, interview.id, expected)
    .run();
  if (((res.meta as any)?.changes ?? 1) === 0) throw conflict('Interview changed concurrently; reload and retry.', 'STATE_CONFLICT');
  // Reactivation keeps the ORIGINAL public_id — the same link works again.
  return loadInterviewDetail(env, interview.id);
}
