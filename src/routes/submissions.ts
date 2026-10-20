/**
 * Dashboard + submission listing + CSV export routes (admin only).
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { one, rows } from '../utils/db';
import { badRequest, notFound } from '../utils/errors';
import { buildCsv } from '../utils/csv';
import { formatInterviewId, parseInterviewId } from '../utils/time';
import { getInterviewById, loadInterviewDetail } from '../services/interviews';
import { displayValue, loadAnswersForSubmission, reconstructAnswers } from '../services/answers';
import { paginationSchema, exportModeSchema } from '../validators/schemas';

type Variables = { admin: { sub: string } };

export const dashboardRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
export const submissionRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

dashboardRoutes.use('*', requireAuth);
submissionRoutes.use('*', requireAuth);

interface SubmissionListItem {
  id: number;
  submissionId: string;
  interviewId: number;
  interviewDisplayId: string;
  interviewTitle: string;
  participantName: string;
  participantEmail: string;
  submittedAt: string;
}

async function listSubmissions(
  env: Env,
  opts: { interviewVersionId?: number; limit: number; offset: number },
): Promise<{ items: SubmissionListItem[]; total: number }> {
  const where = opts.interviewVersionId ? 'WHERE s.interview_id = ?' : '';
  const bindBase = opts.interviewVersionId ? [opts.interviewVersionId] : [];
  const countRow = await one<{ c: number }>(
    env,
    `SELECT COUNT(*) AS c FROM submissions s ${where}`,
    ...bindBase,
  );
  const items = await rows<any>(
    env,
    `SELECT s.id, s.public_id, s.interview_id, i.title, i.id AS ivid,
            s.participant_name, s.participant_email, s.submitted_at
     FROM submissions s JOIN interviews i ON i.id = s.interview_id
     ${where}
     ORDER BY s.submitted_at DESC, s.id DESC
     LIMIT ? OFFSET ?`,
    ...bindBase,
    opts.limit,
    opts.offset,
  );
  return {
    items: items.map((r) => ({
      id: r.id,
      submissionId: r.public_id,
      interviewId: r.ivid,
      interviewDisplayId: formatInterviewId(r.ivid),
      interviewTitle: r.title,
      participantName: r.participant_name,
      participantEmail: r.participant_email,
      submittedAt: r.submitted_at,
    })),
    total: countRow?.c ?? 0,
  };
}

// ---------------- Dashboard ----------------

dashboardRoutes.get('/summary', async (c) => {
  const activeCount = await one<{ c: number }>(
    c.env,
    "SELECT COUNT(*) AS c FROM interviews WHERE status = 'published'",
  );
  const draftCount = await one<{ c: number }>(
    c.env,
    "SELECT COUNT(*) AS c FROM interviews WHERE status = 'draft'",
  );
  const inactiveCount = await one<{ c: number }>(
    c.env,
    "SELECT COUNT(*) AS c FROM interviews WHERE status = 'inactive'",
  );
  const submissionCount = await one<{ c: number }>(c.env, 'SELECT COUNT(*) AS c FROM submissions');
  const recentInterviews = await rows<any>(
    c.env,
    'SELECT id, title, status, created_at FROM interviews ORDER BY id DESC LIMIT 5',
  );
  const recent = await listSubmissions(c.env, { limit: 5, offset: 0 });
  return c.json({
    counts: {
      activeInterviews: activeCount?.c ?? 0,
      draftInterviews: draftCount?.c ?? 0,
      inactiveInterviews: inactiveCount?.c ?? 0,
      totalSubmissions: submissionCount?.c ?? 0,
    },
    recentlyCreatedInterviews: recentInterviews.map((i) => ({
      id: i.id,
      interviewId: formatInterviewId(i.id),
      title: i.title,
      status: i.status,
      createdAt: i.created_at,
    })),
    recentSubmissions: recent.items,
  });
});

// ---------------- Submissions ----------------

submissionRoutes.get('/recent', async (c) => {
  const p = paginationSchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const { items, total } = await listSubmissions(c.env, {
    limit: p.perPage,
    offset: (p.page - 1) * p.perPage,
  });
  return c.json({ submissions: items, page: p.page, perPage: p.perPage, total });
});

// GET /api/interviews/:id/submissions and .../export live on a separate
// mounted router so paths nest under /api/interviews (see app.ts).
export const interviewSubmissionsRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();
interviewSubmissionsRoutes.use('*', requireAuth);

function readVersionId(raw: string): number {
  const id = parseInterviewId(raw);
  if (id === null) throw badRequest('Interview ID must be a positive integer.');
  return id;
}

interviewSubmissionsRoutes.get('/:id/submissions', async (c) => {
  const id = readVersionId(c.req.param('id'));
  const interview = await getInterviewById(c.env, id);
  if (!interview) throw notFound('Interview not found.');
  const p = paginationSchema.parse(Object.fromEntries(new URL(c.req.url).searchParams));
  const { items, total } = await listSubmissions(c.env, {
    interviewVersionId: id,
    limit: p.perPage,
    offset: (p.page - 1) * p.perPage,
  });
  return c.json({
    interview: { id: interview.id, interviewId: formatInterviewId(interview.id), title: interview.title, status: interview.status },
    submissions: items,
    page: p.page,
    perPage: p.perPage,
    total,
  });
});

// Single submission detail with answers reconstructed from its OWN version.
submissionRoutes.get('/:submissionId', async (c) => {
  const sid = c.req.param('submissionId');
  if (!/^sub_[A-Za-z0-9]{8,64}$/.test(sid)) throw notFound('Submission not found.');
  const row = await rows<any>(
    c.env,
    `SELECT s.*, i.title AS interview_title FROM submissions s
     JOIN interviews i ON i.id = s.interview_id WHERE s.public_id = ?`,
    sid,
  );
  const sub = row[0];
  if (!sub) throw notFound('Submission not found.');
  const detail = await loadInterviewDetail(c.env, sub.interview_id);
  const answerRows = await loadAnswersForSubmission(c.env, sub.id);
  const answers = reconstructAnswers(detail, answerRows).map((a) => ({
    questionUid: a.questionUid,
    questionNumber: a.questionNumber,
    questionText: detail.questions[a.questionNumber - 1]?.text ?? '',
    answerDisplay: a.answerDisplay,
    mapping: a.mapping,
    readable: a.readable,
    displayed: displayValue(a, 'auto'),
  }));
  return c.json({
    submission: {
      submissionId: sub.public_id,
      interviewId: sub.interview_id,
      interviewDisplayId: formatInterviewId(sub.interview_id),
      interviewTitle: sub.interview_title,
      participantName: sub.participant_name,
      participantEmail: sub.participant_email,
      submittedAt: sub.submitted_at,
      branchPath: JSON.parse(sub.branch_path || '[]'),
    },
    answers,
  });
});

// ---------------- CSV export ----------------

interviewSubmissionsRoutes.get('/:id/submissions/export', async (c) => {
  const id = readVersionId(c.req.param('id'));
  const interview = await getInterviewById(c.env, id);
  if (!interview) throw notFound('Interview not found.');
  const mode = exportModeSchema.parse(c.req.query('mode') ?? 'readable');
  const detail = await loadInterviewDetail(c.env, id);

  const header = ['Submission ID', 'Interview ID', 'Participant Name', 'Participant Email', 'Submitted At'];
  detail.questions.forEach((_, idx) => header.push(`Q${idx + 1}`));

  const outRows: string[][] = [];
  const PAGE = 100;
  let offset = 0;
  for (;;) {
    const batch = await rows<any>(
      c.env,
      `SELECT id, public_id, participant_name, participant_email, submitted_at
       FROM submissions WHERE interview_id = ?
       ORDER BY submitted_at ASC, id ASC LIMIT ? OFFSET ?`,
      id, PAGE, offset,
    );
    if (batch.length === 0) break;
    for (const s of batch) {
      const answerRows = await loadAnswersForSubmission(c.env, s.id);
      const rec = reconstructAnswers(detail, answerRows);
      const cells = rec.map((a) => displayValue(a, mode as 'mapping' | 'readable'));
      outRows.push([s.public_id, formatInterviewId(id), s.participant_name, s.participant_email, s.submitted_at, ...cells]);
    }
    offset += PAGE;
    if (offset >= 50_000) break; // bounded export safety cap
  }

  const csv = '\uFEFF' + buildCsv(header, outRows); // UTF-8 BOM for spreadsheets
  const filename = `interview-${formatInterviewId(id)}-${mode}.csv`;
  return new Response(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
    },
  });
});

void one;
