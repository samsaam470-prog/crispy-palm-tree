/**
 * Admin interview-management routes. All protected by requireAuth.
 * Editing a published/inactive version NEVER mutates it — PUT creates a new
 * draft version carrying the submitted definition (immutable history).
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { requireAuth } from '../middleware/auth';
import { db, rows } from '../utils/db';
import { badRequest, conflict, notFound } from '../utils/errors';
import { formatInterviewId, parseInterviewId } from '../utils/time';
import {
  createDraft,
  duplicateToNewDraft,
  getInterviewById,
  loadInterviewDetail,
  publishInterview,
  replaceDraftDefinition,
  setStatus,
} from '../services/interviews';
import { duplicateSchema, interviewUpsertSchema } from '../validators/schemas';

type Variables = { admin: { sub: string } };

export const interviewRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

interviewRoutes.use('*', requireAuth);

function readIdParam(raw: string): number {
  const id = parseInterviewId(raw);
  if (id === null) throw badRequest('Interview ID must be a positive integer (e.g. "001" or 1).');
  return id;
}

// List all versions (newest first), with pagination-free bounded output.
interviewRoutes.get('/', async (c) => {
  const items = await rows<any>(
    c.env,
    `SELECT id, title, status, public_id, created_at, updated_at, published_at,
            parent_interview_id, root_interview_id
     FROM interviews ORDER BY id DESC LIMIT 500`,
  );
  return c.json({
    interviews: items.map((i) => ({
      id: i.id,
      interviewId: formatInterviewId(i.id),
      title: i.title,
      status: i.status,
      publicId: i.public_id,
      createdAt: i.created_at,
      updatedAt: i.updated_at,
      publishedAt: i.published_at,
      parentInterviewId: i.parent_interview_id,
      rootInterviewId: i.root_interview_id,
    })),
  });
});

// Create a blank draft. Body may include an initial definition or be minimal.
interviewRoutes.post('/', async (c) => {
  const sizeCheck = checkSize(c);
  if (sizeCheck) return sizeCheck;
  const body = await c.req.json().catch(() => null);
  if (!body || typeof body.title !== 'string') throw badRequest('A "title" is required.');
  const input = {
    title: body.title,
    description: body.description ?? '',
    questions: body.questions ?? [
      // Minimal placeholder question so drafts are structurally valid; the
      // publish endpoint refuses to publish without a real definition anyway.
      { type: 'short_text', text: 'Untitled question', pageNumber: 1 },
    ],
    branchingRules: body.branchingRules ?? [],
  };
  const parsed = interviewUpsertSchema.parse(input);
  const detail = await createDraft(c.env, parsed);
  return c.json({ interview: detail }, 201);
});

interviewRoutes.get('/:id', async (c) => {
  const id = readIdParam(c.req.param('id'));
  const detail = await loadInterviewDetail(c.env, id);
  return c.json({ interview: detail });
});

// Update. Draft → in-place replacement. Published/inactive → NEW DRAFT VERSION.
interviewRoutes.put('/:id', async (c) => {
  const sizeCheck = checkSize(c);
  if (sizeCheck) return sizeCheck;
  const id = readIdParam(c.req.param('id'));
  const interview = await getInterviewById(c.env, id);
  if (!interview) throw notFound('Interview not found.');
  const body = await c.req.json().catch(() => null);
  if (!body) throw badRequest('Request body must be valid JSON.');
  const parsed = interviewUpsertSchema.parse(body);

  if (interview.status === 'draft') {
    const detail = await replaceDraftDefinition(c.env, interview, parsed);
    return c.json({ mode: 'updated-draft', interview: detail }, 200);
  }
  // Immutability rule: never modify a published/inactive version.
  const root = interview.root_interview_id ?? interview.id;
  const detail = await createDraft(c.env, parsed, { parentId: interview.id, rootId: root });
  return c.json(
    {
      mode: 'created-new-version',
      notice: 'The edited version was published/inactive; a new draft version was created. The original is unchanged.',
      previousInterviewId: formatInterviewId(interview.id),
      interview: detail,
    },
    201,
  );
});

interviewRoutes.post('/:id/duplicate', async (c) => {
  const id = readIdParam(c.req.param('id'));
  const interview = await getInterviewById(c.env, id);
  if (!interview) throw notFound('Interview not found.');
  const body = (await c.req.json().catch(() => ({}))) ?? {};
  const { title, description } = duplicateSchema.parse(body);
  const detail = await duplicateToNewDraft(c.env, interview, { title, description });
  return c.json({ interview: detail }, 201);
});

interviewRoutes.post('/:id/publish', async (c) => {
  const id = readIdParam(c.req.param('id'));
  const interview = await getInterviewById(c.env, id);
  if (!interview) throw notFound('Interview not found.');
  if (interview.status === 'inactive') {
    throw conflict('Use /activate to bring an inactive version back online.', 'INVALID_STATE');
  }
  const detail = await publishInterview(c.env, interview);
  return c.json({ interview: detail });
});

interviewRoutes.post('/:id/deactivate', async (c) => {
  const id = readIdParam(c.req.param('id'));
  const interview = await getInterviewById(c.env, id);
  if (!interview) throw notFound('Interview not found.');
  const detail = await setStatus(c.env, interview, 'inactive');
  return c.json({ interview: detail });
});

interviewRoutes.post('/:id/activate', async (c) => {
  const id = readIdParam(c.req.param('id'));
  const interview = await getInterviewById(c.env, id);
  if (!interview) throw notFound('Interview not found.');
  const detail = await setStatus(c.env, interview, 'published');
  return c.json({ interview: detail });
});

function checkSize(c: any): Response | undefined {
  const len = Number(c.req.header('Content-Length') ?? '0');
  if (len > 256 * 1024) throw badRequest('Request body too large.', 'PAYLOAD_TOO_LARGE');
  return undefined;
}

void db;
