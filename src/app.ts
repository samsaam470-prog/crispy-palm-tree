/**
 * Hono application assembly: security headers, CORS allow-list, routes,
 * centralized error handling. Exported `app` is the Worker fetch handler.
 */

import { Hono } from 'hono';
import { secureHeaders } from 'hono/secure-headers';
import type { Env } from './types';
import { allowedOrigins } from './config/env';
import { installErrorHandler, requireAuth } from './middleware/auth';
import { authRoutes } from './routes/auth';
import { interviewRoutes } from './routes/interviews';
import { publicRoutes } from './routes/public-interviews';
import {
  dashboardRoutes,
  interviewSubmissionsRoutes,
  submissionRoutes,
} from './routes/submissions';

type Variables = { admin: { sub: string } };

export const app = new Hono<{ Bindings: Env; Variables: Variables }>();

// ---- Security middleware -------------------------------------------------

app.use('*', secureHeaders());

app.use('*', async (c, next) => {
  // CORS: strict origin allow-list. Wildcard + credentials is never used.
  const origin = c.req.header('Origin');
  const list = allowedOrigins(c.env);
  if (origin && list.includes(origin)) {
    c.header('Access-Control-Allow-Origin', origin);
    c.header('Access-Control-Allow-Credentials', 'true');
    c.header('Vary', 'Origin');
  }
  if (c.req.method === 'OPTIONS') {
    c.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
    c.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-CSRF-Token, Idempotency-Key');
    c.header('Access-Control-Max-Age', '600');
    return c.body(null, 204);
  }
  await next();
});

// Basic request-size guard for JSON bodies (public POSTs check again).
app.use('/api/*', async (c, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(c.req.method)) {
    const len = Number(c.req.header('Content-Length') ?? '0');
    if (len > 256 * 1024) {
      return c.json({ error: { code: 'PAYLOAD_TOO_LARGE', message: 'Request body too large.' } }, 413);
    }
  }
  await next();
});

// ---- Routes ---------------------------------------------------------------

app.get('/api/health', (c) => c.json({ ok: true, service: 'interview-research-backend' }));

app.route('/api/auth', authRoutes);
app.route('/api/public/interviews', publicRoutes);

// Admin interview CRUD (auth enforced inside interviewRoutes) …
app.route('/api/interviews', interviewRoutes);
// … plus nested per-version submissions/export (auth enforced inside).
app.route('/api/interviews', interviewSubmissionsRoutes);

app.route('/api/dashboard', dashboardRoutes);
app.route('/api/submissions', submissionRoutes);

installErrorHandler(app);

export default {
  fetch: app.fetch,
};

void requireAuth;
