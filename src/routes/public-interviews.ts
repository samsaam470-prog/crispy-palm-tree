/**
 * Public interview retrieval + submission routes (no admin auth required).
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { notFound } from '../utils/errors';
import { enforceRateLimit } from '../services/rate-limit';
import { getInterviewByPublicId, buildDetail } from '../services/interviews';
import { processPublicSubmission } from '../services/submissions';
import { publicAppUrl } from '../config/env';

export const publicRoutes = new Hono<{ Bindings: Env }>();

/** Shape returned to participants — admin-only fields are never included. */
function publicQuestionnaire(env: Env, detail: Awaited<ReturnType<typeof buildDetail>>) {
  return {
    publicId: detail.publicId,
    title: detail.title,
    description: detail.description,
    status: detail.status, // 'published' | 'inactive'
    acceptingResponses: detail.status === 'published',
    message:
      detail.status === 'inactive'
        ? 'This interview is no longer accepting responses.'
        : null,
    shareUrl: detail.publicId ? `${publicAppUrl(env)}/share/${detail.publicId}` : null,
    questions: detail.questions.map((q, idx) => ({
      uid: q.uid,
      number: idx + 1,
      type: q.type,
      text: q.text,
      instructions: q.instructions,
      required: q.required,
      pageNumber: q.pageNumber,
      displayOrder: q.displayOrder,
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
    branchingRules: detail.branchingRules,
  };
}

publicRoutes.get('/interviews/:publicId', async (c) => {
  const publicId = c.req.param('publicId');
  if (!/^[A-Za-z0-9]{8,64}$/.test(publicId)) throw notFound('Interview not found.');
  const interview = await getInterviewByPublicId(c.env, publicId);
  if (!interview) throw notFound('Interview not found.'); // drafts & unknown ids -> 404
  const detail = await buildDetail(c.env, interview);
  return c.json({ interview: publicQuestionnaire(c.env, detail) });
});

publicRoutes.post('/interviews/:publicId/submissions', async (c) => {
  const publicId = c.req.param('publicId');
  if (!/^[A-Za-z0-9]{8,64}$/.test(publicId)) throw notFound('Interview not found.');
  await enforceRateLimit(c.env, c.req.raw, `submit:${publicId.slice(0, 12)}`);
  const len = Number(c.req.header('Content-Length') ?? '0');
  if (len > 256 * 1024) {
    return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large.' } }, 413);
  }
  const body = await c.req.json().catch(() => null);
  if (body === null) {
    return c.json({ error: { code: 'VALIDATION_ERROR', message: 'Request body must be valid JSON.' } }, 400);
  }
  const result = await processPublicSubmission(c.env, publicId, body);
  return c.json({ ok: true, submissionId: result.submissionId, message: result.message }, 201);
});
