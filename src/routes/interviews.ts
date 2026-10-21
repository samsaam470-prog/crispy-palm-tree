import { Hono } from 'hono';
import { z } from 'zod';
import { adminAuthMiddleware } from '../middleware/auth';
import { generateId, generatePublicId, generateUid } from '../utils/ids';
import type { Bindings } from '../types';

const interviewsRouter = new Hono<{ Bindings: Bindings }>();
interviewsRouter.use('*', adminAuthMiddleware);

const optionSchema = z.object({
  id: z.string().optional(),
  label: z.string().trim().min(1),
  code: z.string().trim().min(1),
  display_order: z.number().int().nonnegative(),
  branch_target: z.string().optional().nullable(),
  is_other: z.boolean().optional(),
});

const questionSchema = z.object({
  id: z.string().optional(),
  question_text: z.string().trim().min(1),
  question_type: z.enum(['single_choice', 'multiple_choice', 'multiple_choice_other', 'dropdown', 'short_text', 'long_text']),
  instructions: z.string().optional().nullable(),
  is_required: z.boolean().default(true),
  display_order: z.number().int().nonnegative(),
  page_number: z.number().int().positive().default(1),
  answer_display_preference: z.enum(['full', 'mapping']).default('full'),
  options: z.array(optionSchema).default([]),
  branch_group: z.string().optional().nullable(),
});

const interviewSchema = z.object({
  title: z.string().trim().min(1),
  description: z.string().optional().nullable(),
  questions: z.array(questionSchema).min(1),
});

function mapQuestionRow(row: any) {
  return {
    id: row.id,
    interview_id: row.interview_id,
    question_text: row.question_text,
    question_type: row.question_type,
    instructions: row.instructions ?? null,
    is_required: Boolean(row.is_required),
    display_order: row.display_order,
    page_number: row.page_number,
    answer_display_preference: row.answer_display_preference,
    branch_group: row.branch_group ?? null,
  };
}

async function fetchQuestionOptions(db: D1Database, questionId: string) {
  const { results } = await db.prepare('SELECT * FROM options WHERE question_id = ? ORDER BY display_order ASC').bind(questionId).all();
  return results as any[];
}

async function insertQuestion(db: D1Database, interviewId: string, question: z.infer<typeof questionSchema>) {
  const id = question.id ?? generateUid('q');
  await db.prepare(
    `INSERT INTO questions (id, interview_id, question_text, question_type, instructions, is_required, display_order, page_number, answer_display_preference, branch_group, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id,
    interviewId,
    question.question_text,
    question.question_type,
    question.instructions ?? null,
    question.is_required ? 1 : 0,
    question.display_order,
    question.page_number,
    question.answer_display_preference,
    question.branch_group ?? null,
    new Date().toISOString(),
    new Date().toISOString(),
  ).run();

  for (const option of question.options ?? []) {
    const optionId = option.id ?? generateUid('opt');
    await db.prepare(
      `INSERT INTO options (id, question_id, label, code, display_order, branch_target, is_other) VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).bind(
      optionId,
      id,
      option.label,
      option.code,
      option.display_order,
      option.branch_target ?? null,
      option.is_other ? 1 : 0,
    ).run();
  }

  return id;
}

interviewsRouter.get('/', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM interviews ORDER BY created_at DESC LIMIT 100').all();
  return c.json({ interviews: results });
});

interviewsRouter.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const parsed = interviewSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_payload', details: parsed.error.format() }, 400);
  }

  const db = c.env.DB;
  const interviewId = generateId('int');
  const now = new Date().toISOString();

  await db.prepare(
    `INSERT INTO interviews (id, title, description, status, version, public_id, created_at, updated_at)
     VALUES (?, ?, ?, 'draft', 1, NULL, ?, ?)`
  ).bind(interviewId, parsed.data.title, parsed.data.description ?? null, now, now).run();

  for (const question of parsed.data.questions) {
    await insertQuestion(db, interviewId, question);
  }

  return c.json({ success: true, interview_id: interviewId, version: 1 }, 201);
});

interviewsRouter.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const interview = await db.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
  if (!interview) return c.json({ error: 'Interview not found.' }, 404);

  const { results: rawQuestions } = await db.prepare('SELECT * FROM questions WHERE interview_id = ? ORDER BY display_order ASC').bind(id).all();
  const questions = [] as any[];
  for (const row of rawQuestions as any[]) {
    const options = await fetchQuestionOptions(db, row.id);
    questions.push({ ...mapQuestionRow(row), options });
  }

  return c.json({ interview: { ...interview, questions } });
});

interviewsRouter.put('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Interview not found.' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const parsed = interviewSchema.safeParse(body);
  if (!parsed.success) return c.json({ error: 'invalid_payload', details: parsed.error.format() }, 400);

  const now = new Date().toISOString();
  if ((existing as any).status === 'published') {
    const newInterviewId = generateId('int');
    const nextVersion = Number((existing as any).version) + 1;
    await db.prepare(
      `INSERT INTO interviews (id, title, description, status, version, public_id, parent_version_id, root_version_id, created_at, updated_at)
       VALUES (?, ?, ?, 'draft', ?, NULL, ?, ?, ?, ?)`
    ).bind(newInterviewId, parsed.data.title, parsed.data.description ?? null, nextVersion, (existing as any).root_version_id ?? (existing as any).id, (existing as any).root_version_id ?? (existing as any).id, now, now).run();

    for (const question of parsed.data.questions) {
      await insertQuestion(db, newInterviewId, question);
    }

    return c.json({ success: true, interview_id: newInterviewId, version: nextVersion }, 201);
  }

  await db.prepare('UPDATE interviews SET title = ?, description = ?, updated_at = ? WHERE id = ?').bind(parsed.data.title, parsed.data.description ?? null, now, id).run();
  await db.prepare('DELETE FROM questions WHERE interview_id = ?').bind(id).run();
  await db.prepare('DELETE FROM options WHERE question_id IN (SELECT id FROM questions WHERE interview_id = ?)').bind(id).run();

  for (const question of parsed.data.questions) {
    await insertQuestion(db, id, question);
  }

  return c.json({ success: true, interview_id: id, version: (existing as any).version });
});

interviewsRouter.post('/:id/duplicate', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const existing = await db.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
  if (!existing) return c.json({ error: 'Interview not found.' }, 404);

  const newId = generateId('int');
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO interviews (id, title, description, status, version, public_id, created_at, updated_at)
    VALUES (?, ?, ?, 'draft', 1, NULL, ?, ?)`
  ).bind(newId, `${(existing as any).title} (Copy)`, (existing as any).description ?? null, now, now).run();

  const { results: questions } = await db.prepare('SELECT * FROM questions WHERE interview_id = ? ORDER BY display_order ASC').bind(id).all();
  for (const question of questions as any[]) {
    const qId = generateUid('q');
    await db.prepare(
      `INSERT INTO questions (id, interview_id, question_text, question_type, instructions, is_required, display_order, page_number, answer_display_preference, branch_group, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(qId, newId, question.question_text, question.question_type, question.instructions ?? null, question.is_required, question.display_order, question.page_number, question.answer_display_preference, question.branch_group ?? null, now, now).run();

    const { results: options } = await db.prepare('SELECT * FROM options WHERE question_id = ? ORDER BY display_order ASC').bind(question.id).all();
    for (const option of options as any[]) {
      const optId = generateUid('opt');
      await db.prepare('INSERT INTO options (id, question_id, label, code, display_order, branch_target, is_other) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(optId, qId, option.label, option.code, option.display_order, option.branch_target ?? null, option.is_other ?? 0).run();
    }
  }

  return c.json({ success: true, interview_id: newId }, 201);
});

interviewsRouter.post('/:id/validate', async (c) => {
  const id = c.req.param('id');
  const db = c.env.DB;
  const item = await db.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
  if (!item) return c.json({ error: 'Interview not found.' }, 404);
  const { results: questions } = await db.prepare('SELECT * FROM questions WHERE interview_id = ? ORDER BY display_order ASC').bind(id).all();
  const errors: string[] = [];
  for (const question of questions as any[]) {
    if (question.page_number < 1) errors.push(`Question ${question.id} has invalid page_number.`);
    if ((question.question_type === 'single_choice' || question.question_type === 'dropdown') && question.is_required === 1) {
      const { count } = await db.prepare('SELECT COUNT(*) AS count FROM options WHERE question_id = ?').bind(question.id).first() as any;
      if (Number(count) === 0) errors.push(`Question ${question.id} requires options.`);
    }
  }
  return c.json({ valid: errors.length === 0, errors }, errors.length === 0 ? 200 : 400);
});

interviewsRouter.post('/:id/publish', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const interview = await db.prepare('SELECT * FROM interviews WHERE id = ?').bind(id).first();
  if (!interview) return c.json({ error: 'Interview not found.' }, 404);

  const publicId = (interview as any).public_id ?? generatePublicId();
  const now = new Date().toISOString();
  await db.prepare('UPDATE interviews SET status = "published", public_id = ?, published_at = ?, updated_at = ? WHERE id = ?')
    .bind(publicId, now, now, id)
    .run();

  return c.json({ success: true, interview_id: id, public_id: publicId, status: 'published' });
});

interviewsRouter.post('/:id/deactivate', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.prepare('UPDATE interviews SET status = "inactive", updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
  return c.json({ success: true, status: 'inactive' });
});

interviewsRouter.post('/:id/activate', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  await db.prepare('UPDATE interviews SET status = "published", updated_at = ? WHERE id = ?').bind(new Date().toISOString(), id).run();
  return c.json({ success: true, status: 'published' });
});

export default interviewsRouter;
