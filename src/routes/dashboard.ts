import { Hono } from 'hono';
import { adminAuthMiddleware } from '../middleware/auth';
import type { Bindings } from '../types';

const dashboardRouter = new Hono<{ Bindings: Bindings }>();

dashboardRouter.use('*', adminAuthMiddleware);

// GET /api/dashboard/summary
dashboardRouter.get('/summary', async (c) => {
  const db = c.env.DB;

  const activeCountRes = await db.prepare(`SELECT COUNT(*) as count FROM interviews WHERE status = 'published'`).first() as any;
  const draftCountRes = await db.prepare(`SELECT COUNT(*) as count FROM interviews WHERE status = 'draft'`).first() as any;
  const submissionCountRes = await db.prepare(`SELECT COUNT(*) as count FROM submissions`).first() as any;

  const { results: recentInterviews } = await db.prepare(
    `SELECT id, title, status, version, created_at FROM interviews ORDER BY created_at DESC LIMIT 5`
  ).all();

  const { results: recentSubmissions } = await db.prepare(
    `SELECT s.id, s.participant_name, s.participant_email, s.submitted_at, i.title as interview_title, i.version 
     FROM submissions s 
     JOIN interviews i ON s.interview_id = i.id 
     ORDER BY s.submitted_at DESC LIMIT 5`
  ).all();

  return c.json({
    summary: {
      active_interviews: activeCountRes?.count || 0,
      draft_interviews: draftCountRes?.count || 0,
      total_submissions: submissionCountRes?.count || 0,
    },
    recent_interviews,
    recent_submissions,
  });
});

// GET /api/submissions/recent or /api/submissions/:submissionId
dashboardRouter.get('/recent', async (c) => {
  const db = c.env.DB;
  const { results } = await db.prepare(
    `SELECT s.id, s.participant_name, s.participant_email, s.submitted_at, i.id as interview_id, i.title as interview_title, i.version
     FROM submissions s
     JOIN interviews i ON s.interview_id = i.id
     ORDER BY s.submitted_at DESC LIMIT 20`
  ).all();
  return c.json({ submissions: results });
});

// GET /api/interviews/:id/submissions - Submissions for a specific interview version
dashboardRouter.get('/interviews/:id/submissions', async (c) => {
  const db = c.env.DB;
  const interviewId = c.req.param('id');

  const interview = await db.prepare(`SELECT * FROM interviews WHERE id = ?`).bind(interviewId).first();
  if (!interview) {
    return c.json({ error: 'Interview not found' }, 404);
  }

  const { results: submissions } = await db.prepare(
    `SELECT * FROM submissions WHERE interview_id = ? ORDER BY submitted_at DESC`
  ).bind(interviewId).all();

  const detailedSubmissions = [];
  for (const sub of submissions as any[]) {
    const { results: answers } = await db.prepare(
      `SELECT a.*, q.question_text, q.answer_display_preference FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.submission_id = ?`
    ).bind(sub.id).all();
    detailedSubmissions.push({ ...sub, answers });
  }

  return c.json({ interview, submissions: detailedSubmissions });
});

// GET /api/submissions/:submissionId - Individual submission details
dashboardRouter.get('/:submissionId', async (c) => {
  const db = c.env.DB;
  const submissionId = c.req.param('submissionId');

  const submission = await db.prepare(`SELECT * FROM submissions WHERE id = ?`).bind(submissionId).first() as any;
  if (!submission) {
    return c.json({ error: 'Submission not found' }, 404);
  }

  const interview = await db.prepare(`SELECT * FROM interviews WHERE id = ?`).bind(submission.interview_id).first();
  const { results: answers } = await db.prepare(
    `SELECT a.*, q.question_text, q.question_type FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.submission_id = ?`
  ).bind(submissionId).all();

  return c.json({ submission: { ...submission, interview, answers } });
});

// GET /api/interviews/:id/submissions/export - CSV Export with mapping or full answer modes
dashboardRouter.get('/interviews/:id/submissions/export', async (c) => {
  const db = c.env.DB;
  const interviewId = c.req.param('id');
  const mode = c.req.query('mode') || 'mapping'; // 'mapping' or 'full'

  const interview = await db.prepare(`SELECT * FROM interviews WHERE id = ?`).bind(interviewId).first() as any;
  if (!interview) {
    return c.json({ error: 'Interview not found' }, 404);
  }

  const { results: questions } = await db.prepare(
    `SELECT id, display_order FROM questions WHERE interview_id = ? ORDER BY display_order ASC`
  ).bind(interviewId).all();

  const { results: submissions } = await db.prepare(
    `SELECT * FROM submissions WHERE interview_id = ? ORDER BY submitted_at ASC`
  ).bind(interviewId).all();

  // Build CSV header
  const qHeaders = questions.map((_, idx) => `Q${idx + 1}`);
  const headers = ['Submission ID', 'Participant Name', 'Participant Email', 'Submitted At', ...qHeaders];

  const rows = [headers.join(',')];

  for (const sub of submissions as any[]) {
    const { results: answers } = await db.prepare(
      `SELECT a.*, q.display_order FROM answers a JOIN questions q ON a.question_id = q.id WHERE a.submission_id = ? ORDER BY q.display_order ASC`
    ).bind(sub.id).all();

    const ansMap = new Map();
    for (const ans of answers as any[]) {
      ansMap.set(ans.question_id, ans);
    }

    const qCols = [];
    for (const q of questions as any[]) {
      const ans = ansMap.get(q.id);
      let val = '';
      if (ans) {
        if (ans.text_answer) {
          val = ans.text_answer;
        } else if (ans.selected_options_json) {
          try {
            const opts = JSON.parse(ans.selected_options_json);
            if (mode === 'mapping') {
              val = opts.join(':');
            } else {
              val = opts.join(', ');
            }
          } catch {
            val = '';
          }
        }
        if (ans.other_text) {
          val += ` (Other: ${ans.other_text})`;
        }
      }

      // Formula injection mitigation for CSV
      if (/^[=+\-@\t\r]/.test(val)) {
        val = `'${val}`;
      }
      qCols.push(`"${val.replace(/"/g, '""')}"`);
    }

    const rowData = [
      `"${sub.id}"`,
      `"${sub.participant_name.replace(/"/g, '""')}"`,
      `"${sub.participant_email.replace(/"/g, '""')}"`,
      `"${sub.submitted_at}"`,
      ...qCols,
    ];
    rows.push(rowData.join(','));
  }

  const csvContent = rows.join('\n');
  c.header('Content-Type', 'text/csv; charset=utf-8');
  c.header('Content-Disposition', `attachment; filename="interview-${interviewId}-submissions.csv"`);
  return c.body(csvContent);
});

export default dashboardRouter;
