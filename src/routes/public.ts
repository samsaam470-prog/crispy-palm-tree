import { Hono } from 'hono';
import { z } from 'zod';
import { generateId } from '../utils/ids';
import type { Bindings } from '../types';

const publicRouter = new Hono<{ Bindings: Bindings }>();

// GET /api/public/interviews/:publicId - Retrieve published questionnaire
publicRouter.get('/:publicId', async (c) => {
  const db = c.env.DB;
  const publicId = c.req.param('publicId');

  const interview = await db.prepare(
    `SELECT id, title, description, status, version, public_id, created_at FROM interviews WHERE public_id = ?`
  ).bind(publicId).first() as any;

  if (!interview) {
    return c.json({ error: 'Interview not found' }, 404);
  }

  if (interview.status === 'draft') {
    return c.json({ error: 'Interview is not published' }, 403);
  }

  if (interview.status === 'inactive') {
    return c.json({ error: 'This interview is no longer accepting responses.', inactive: true }, 410);
  }

  const { results: questions } = await db.prepare(
    `SELECT id, question_text, question_type, instructions, is_required, display_order, page_number, answer_display_preference FROM questions WHERE interview_id = ? ORDER BY display_order ASC`
  ).bind(interview.id).all();

  const fullQuestions = [];
  for (const q of questions as any[]) {
    const { results: options } = await db.prepare(
      `SELECT id, label, code, display_order FROM options WHERE question_id = ? ORDER BY display_order ASC`
    ).bind(q.id).all();
    fullQuestions.push({ ...q, options });
  }

  return c.json({ interview: { ...interview, questions: fullQuestions } });
});

const submissionPayloadSchema = z.object({
  participant_name: z.string().min(1, 'Name is required'),
  participant_email: z.string().email('Valid email is required'),
  answers: z.array(z.object({
    question_id: z.string().min(1),
    selected_option_ids: z.array(z.string()).optional().default([]),
    text_answer: z.string().optional().nullable(),
    other_text: z.string().optional().nullable(),
  })).min(1),
});

// POST /api/public/interviews/:publicId/submissions - Submit response
publicRouter.post('/:publicId/submissions', async (c) => {
  const db = c.env.DB;
  const publicId = c.req.param('publicId');

  const interview = await db.prepare(
    `SELECT id, status FROM interviews WHERE public_id = ?`
  ).bind(publicId).first() as any;

  if (!interview) {
    return c.json({ error: 'Interview not found' }, 404);
  }

  if (interview.status === 'inactive') {
    return c.json({ error: 'This interview is no longer accepting responses.' }, 410);
  }

  if (interview.status !== 'published') {
    return c.json({ error: 'Interview is not accepting responses' }, 403);
  }

  try {
    const body = await c.req.json();
    const parsed = submissionPayloadSchema.safeParse(body);
    if (!parsed.success) {
      return c.json({ error: 'Invalid submission data', details: parsed.error.format() }, 400);
    }

    const { participant_name, participant_email, answers } = parsed.data;

    const { results: questions } = await db.prepare(
      `SELECT id, is_required, question_type FROM questions WHERE interview_id = ?`
    ).bind(interview.id).all();

    const questionMap = new Map(questions.map((q: any) => [q.id, q]));

    for (const q of questions as any[]) {
      const userAns = answers.find(a => a.question_id === q.id);
      if (q.is_required) {
        if (!userAns || ((!userAns.selected_option_ids || userAns.selected_option_ids.length === 0) && !userAns.text_answer)) {
          return c.json({ error: `Required question ${q.id} was not answered` }, 400);
        }
      }
    }

    const submissionId = generateId('sub');
    const now = new Date().toISOString();

    const statements = [];

    statements.push(
      db.prepare(
        `INSERT INTO submissions (id, interview_id, participant_name, participant_email, submitted_at) VALUES (?, ?, ?, ?, ?)`
      ).bind(submissionId, interview.id, participant_name, participant_email, now)
    );

    for (const ans of answers) {
      if (!questionMap.has(ans.question_id)) {
        return c.json({ error: `Invalid question ID ${ans.question_id}` }, 400);
      }

      const answerId = generateId('ans');
      const selectedIdsJson = JSON.stringify(ans.selected_option_ids || []);
      const selectedCodesJson = JSON.stringify([]);

      statements.push(
        db.prepare(
          `INSERT INTO answers (id, submission_id, question_id, selected_option_ids, selected_option_codes, text_answer, other_text) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).bind(
          answerId,
          submissionId,
          ans.question_id,
          selectedIdsJson,
          selectedCodesJson,
          ans.text_answer || null,
          ans.other_text || null
        )
      );
    }

    await db.batch(statements);

    return c.json({ success: true, submissionId, message: 'Submission recorded successfully' }, 201);
  } catch (err: any) {
    return c.json({ error: 'Failed to process submission', message: err.message }, 500);
  }
});

export default publicRouter;
