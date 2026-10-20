/**
 * Authentication routes (fixed single administrator from env secrets).
 * Session transport: HttpOnly SameSite=Lax cookie AND a bearer token returned
 * in the login response. The frontend must NOT store the token in
 * localStorage; preferred flow is the cookie plus the X-CSRF-Token
 * double-submit header (see docs/API.md).
 */

import { Hono } from 'hono';
import type { Env } from '../types';
import { assertConfig } from '../config/env';
import { requireAuth } from '../middleware/auth';
import { clearedSessionCookie, createSessionToken, sessionCookie } from '../services/auth';
import { timingSafeEqualStr } from '../utils/ids';
import { unauthorized } from '../utils/errors';
import { loginSchema } from '../validators/schemas';

type Variables = { admin: { sub: string } };

export const authRoutes = new Hono<{ Bindings: Env; Variables: Variables }>();

authRoutes.post('/login', async (c) => {
  assertConfig(c.env); // safe error if secrets missing — never permits access
  const body = await c.req.json().catch(() => null);
  if (body === null) throw unauthorized('Invalid request.', 'BAD_JSON');
  const { username, password } = loginSchema.parse(body);
  const okUser = timingSafeEqualStr(username, c.env.ADMIN_USER);
  const okPass = timingSafeEqualStr(password, c.env.ADMIN_PASS);
  if (!(okUser && okPass)) {
    // Generic message: never reveal which field was wrong.
    throw unauthorized('Invalid credentials.', 'AUTH_FAILED');
  }
  const token = await createSessionToken(c.env, c.env.ADMIN_USER);
  return c.json(
    {
      ok: true,
      user: { username: c.env.ADMIN_USER },
      token, // for Authorization: Bearer usage (documented alternative)
      csrfHint: 'For cookie auth, send this same token in the X-CSRF-Token header on mutating requests.',
    },
    200,
    { 'Set-Cookie': sessionCookie(c.env, token) },
  );
});

authRoutes.post('/logout', (c) => {
  // Stateless JWT limitation: logout clears the cookie server-side and the
  // client should discard any bearer copy. A stolen token remains valid until
  // it expires (12h max) — documented tradeoff of stateless sessions.
  return c.json({ ok: true }, 200, { 'Set-Cookie': clearedSessionCookie(c.env) });
});

authRoutes.get('/me', requireAuth, (c) => {
  const admin = c.get('admin');
  return c.json({ ok: true, user: { username: admin.sub } });
});
