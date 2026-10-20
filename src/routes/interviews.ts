import { Hono } from 'hono';
import { z } from 'zod';
import { adminAuthMiddleware } from '../middleware/auth';
import { generateId, generatePublicId } from '../utils/ids';
import type { Bindings } from '../types';

const interviewsRouter = new Hono<{ Bindings: Bindings }>();

// All interview routes require admin authentication
interviewsRouter.use('*', adminAuthMiddleware);

const optionSchema = z.object({
  id: z.string().optional(),
  label: z.string().min(1),
  code: z.string().min(1),
  display_order: z.number().int().nonnegative(),
});

const questionSchema = z.object({
  id: z.string().optional(),
  question_text: z.string().min(1),
  question_type: z.enum(['single_choice', 'multiple_choice', 'multiple_choice_other', 'dropdown', 'short_text', 'long_text']),
  instructions: z.string().optional().nullable(),
  is_required: z.boolean().default(true),
  display_order: z.number().int().nonnegative(),
  page_number: z.number().int().positive().default(1),
  answer_display_preference: z.enum(['full', 'mapping']).default('full'),
  options: z.array(optionSchema).optional().default([]),
});

const interviewPayloadSchema = z.object({
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  questions: z.array(questionSchema).min(1),
});

// GET /api/interviews - List all interviews and their latest versions
interviewsRouter.get('/', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT * FROM interviews ORDER BY created_at DESC`
  ).all();
  return c.json({ interviews: results });
});

// POST /api/interviews - Create a new interview (draft)
interviewsRouter.post('/', async (c) => {
  const db = c.env.DB;
  try {
    const body = await c.req.json();
    const parsed = interviewPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid interview payload', details: parsed.error.format() }, 400);
    }

    const { title, description, questions } = parsed.data;
    const interviewId = generateId('int');
    const version = 1;
    const now = new Date().toISOString();

    // Insert interview record
    await db.prepare(
      `INSERT INTO interviews (id, title, description, status, version, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?)`
    ).bind(interviewId, title, description || null, version, now, now).run();

    // Insert questions and options
    for (const q of questions) {
      const qId = q.id || generateId('q');
      await db.prepare(
        `INSERT INTO questions (id, interview_id, question_text, question_type, instructions, is_required, display_order, page_number, answer_display_preference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).bind(
        qId,
        interviewId,
        q.question_text,
        q.question_type,
        q.instructions || null,
        q.is_required ? 1 : 0,
        q.display_order,
        q.page_number,
        q.answer_display_preference
      ).run();

      if (q.options && q.options.length > 0) {
        for (const opt of q.options) {
          const optId = opt.id || generateId('opt');
          await db.prepare(
            `INSERT INTO question_options (id, question_id, label, code, display_order) VALUES (?, ?, ?, ?, ?)`
          ).bind(optId, qId, opt.label, opt.code, opt.display_order).run();
        }
      }
    }

    return c.json({ success: true, interviewId, version }, 201);
  } catch (err: any) {
    return c.json({ error: 'Failed to create interview', message: err.message }, 500);
  }
});

// GET /api/interviews/:id - Get specific interview version with questions and options
interviewsRouter.get('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const interview = await db.prepare(`SELECT * FROM interviews WHERE id = ?`).bind(id).first();
  if (!interview) {
    return c.json({ error: 'Interview not found' }, 404);
  }

  const { results: questions } = await db.prepare(`SELECT * FROM questions WHERE interview_id = ? ORDER BY display_order ASC`).bind(id).all();

  const fullQuestions = [];
  for (const q of questions) {
    const { results: options } = await db.prepare(`SELECT * FROM question_options WHERE question_id = ? ORDER BY display_order ASC`).bind((q as any).id).all();
    fullQuestions.push({ ...q, options });
  }

  return c.json({ interview: { ...interview, questions: fullQuestions } });
});

// PUT /api/interviews/:id - Edit an interview version (creates a new version or updates draft)
interviewsRouter.put('/:id', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const existing = await db.prepare(`SELECT * FROM interviews WHERE id = ?`).bind(id).first() as any;
  if (!existing) {
    return c.json({ error: 'Interview not found' }, 404);
  }

  // If the interview is published, editing creates a new version (immutable versioning requirement)
  try {
    const body = await c.req.json();
    const parsed = interviewPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid payload', details: parsed.error.format() }, 400);
    }

    const { title, description, questions } = parsed.data;
    const now = new Date().toISOString();

    if (existing.status === 'published') {
      // Create new version
      const newId = generateId('int');
      const newVersion = existing.version + 1;

      await db.prepare(
        `INSERT INTO interviews (id, title, description, status, version, previous_version_id, created_at, updated_at) VALUES (?, ?, ?, 'draft', ?, ?, ?, ?)`
      ).bind(newId, title, description || null, newVersion, existing.id, now, now).run();

      for (const q of questions) {
        const qId = generateId('q');
        await db.prepare(
          `INSERT INTO questions (id, interview_id, question_text, question_type, instructions, is_required, display_order, page_number, answer_display_preference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          qId,
          newId,
          q.question_text,
          q.question_type,
          q.instructions || null,
          q.is_required ? 1 : 0,
          q.display_order,
          q.page_number,
          q.answer_display_preference
        ).run();

        if (q.options) {
          for (const opt of q.options) {
            const optId = generateId('opt');
            await db.prepare(
              `INSERT INTO question_options (id, question_id, label, code, display_order) VALUES (?, ?, ?, ?, ?)`
            ).bind(optId, qId, opt.label, opt.code, opt.display_order).run();
          }
        }
      }

      return c.json({ success: true, interviewId: newId, version: newVersion, message: 'New version created from edit' });
    } else {
      // Update existing draft
      await db.prepare(`UPDATE interviews SET title = ?, description = ?, updated_at = ? WHERE id = ?`)
        .bind(title, description || null, now, id).run();

      // Replace questions and options
      await db.prepare(`DELETE FROM questions WHERE interview_id = ?`).bind(id).run();

      for (const q of questions) {
        const qId = q.id || generateId('q');
        await db.prepare(
          `INSERT INTO questions (id, interview_id, question_text, question_type, instructions, is_required, display_order, page_number, answer_display_preference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          qId,
          id,
          q.question_text,
          q.question_type,
          q.instructions || null,
          q.is_required ? 1 : 0,
          q.display_order,
          q.page_number,
          q.answer_display_preference
        ).run();

        if (q.options) {
          for (const opt of q.options) {
            const optId = opt.id || generateId('opt');
            await db.prepare(
              `INSERT INTO question_options (id, question_id, label, code, display_order) VALUES (?, ?, ?, ?, ?)`
            ).bind(optId, qId, opt.label, opt.code, opt.display_order).run();
          }
        }
      }

      return c.json({ success: true, interviewId: id, version: existing.version });
    }
  } catch (err: any) {
    return c.json({ error: 'Failed to update interview', message: err.message }, 500);
  }
});

// POST /api/interviews/:id/duplicate - Duplicate interview
interviewsRouter.post('/:id/duplicate', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const existing = await db.prepare(`SELECT * FROM interviews WHERE id = ?`).bind(id).first() as any;
  if (!existing) {
    return c.json({ error: 'Interview not found' }, 404);
  }

  const newId = generateId('int');
  const now = new Date().toISOString();
  await db.prepare(
    `INSERT INTO interviews (id, title, description, status, version, created_at, updated_at) VALUES (?, ?, ?, 'draft', 1, ?, ?)`
  ).bind(newId, `${existing.title} (Copy)`, existing.description, now, now).run();

  const { results: questions } = await db.prepare(`SELECT * FROM questions WHERE interview_id = ?`).bind(id).all();
  for (const q of questions as any[]) {
    const newQId = generateId('q');
    await db.prepare(
      `INSERT INTO questions (id, interview_id, question_text, question_type, instructions, is_required, display_order, page_number, answer_display_preference) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(newQId, newId, q.question_text, q.question_type, q.instructions, q.is_required, q.display_order, q.page_number, q.answer_display_preference).run();

    const { results: options } = await db.prepare(`SELECT * FROM question_options WHERE question_id = ?`).bind(q.id).all();
    for (const opt of options as any[]) {
      const newOptId = generateId('opt');
      await db.prepare(
        `INSERT INTO question_options (id, question_id, label, code, display_order) VALUES (?, ?, ?, ?, ?)`
      ).bind(newOptId, newQId, opt.label, opt.code, opt.display_order).run();
    }
  }

  return c.json({ success: true, interviewId: newId });
});

// POST /api/interviews/:id/publish - Publish interview and generate public ID
interviewsRouter.post('/:id/publish', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');

  const existing = await db.prepare(`SELECT * FROM interviews WHERE id = ?`).bind(id).first() as any;
  if (!existing) {
    return c.json({ error: 'Interview not found' }, 404);
  }

  const publicId = existing.public_id || generatePublicId();
  const now = new Date().toISOString();

  await db.prepare(
    `UPDATE interviews SET status = 'published', public_id = ?, updated_at = ? WHERE id = ?`
  ).bind(publicId, now, id).run();

  return c.json({ success: true, interviewId: id, public_id: publicId, status: 'published' });
});

// POST /api/interviews/:id/deactivate
interviewsRouter.post('/:id/deactivate', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  await db.prepare(`UPDATE interviews SET status = 'inactive', updated_at = ? WHERE id = ?`).bind(now, id).run();
  return c.json({ success: true, status: 'inactive' });
});

// POST /api/interviews/:id/activate
interviewsRouter.post('/:id/activate', async (c) => {
  const db = c.env.DB;
  const id = c.req.param('id');
  const now = new Date().toISOString();

  await db.prepare(`UPDATE interviews SET status = 'published', updated_at = ? WHERE id = ?`).bind(now, id).run();
  return c.json({ success: true, status: 'published' });
});

export default interviewsRouter;
