/**
 * Authentication middleware: validates the admin session on private routes.
 * Also enforces CSRF double-submit protection when the session arrives via
 * cookie (the token itself is sent in an X-CSRF-Token header as well).
 */

import { createMiddleware } from 'hono/factory';
import type { Env } from '../../types';
import { SESSION_COOKIE, assertConfig } from '../../config/env';
import { readSession } from '../../services/auth';
import { ApiError, forbidden, unauthorized } from '../../utils/errors';

type Variables = { admin: { sub: string } };

export const requireAuth = createMiddleware<{ Bindings: Env; Variables: Variables }>(async (c, next) => {
  try {
    assertConfig(c.env);
  } catch {
    // Never reveal which variable is missing to clients; log server-side.
    console.error('auth: server configuration incomplete');
    throw unauthorized('Server is not configured for authentication.', 'CONFIG_MISSING');
  }
  const claims = await readSession(c.env, c.req.raw);
  // CSRF: if authenticating by cookie, require the double-submit header to
  // match the token. Bearer-token requests (no cookie) are inherently safe.
  const cookie = c.req.header('Cookie') ?? '';
  const hasSessionCookie = new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=`).test(cookie);
  if (hasSessionCookie) {
    const csrfHeader = c.req.header('X-CSRF-Token') ?? '';
    const bearer = /^Bearer\s/i.test(c.req.header('Authorization') ?? '');
    if (!bearer) {
      const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
      const token = m ? decodeURIComponent(m[1]) : '';
      if (csrfHeader !== token) {
        throw forbidden('CSRF check failed: include the session token in the X-CSRF-Token header.', 'CSRF_FAILED');
      }
    }
  }
  c.set('admin', { sub: claims.sub });
  await next();
});

/** Catch-all error handler: consistent JSON errors, no internal details. */
export function installErrorHandler(app: any): void {
  app.onError((err: Error, c: any) => {
    if (err instanceof ApiError) {
      return c.json({ error: { code: err.code, message: err.message } }, err.status as 400);
    }
    // Zod validation errors → generic 400 with a short field summary.
    if ((err as any)?.name === 'ZodError') {
      const first = (err as any)?.issues?.[0];
      const where = first?.path?.length ? ` Field: ${first.path.join('.')}.` : '';
      return c.json(
        { error: { code: 'VALIDATION_ERROR', message: `The submitted data is invalid.${where}` } },
        400,
      );
    }
    // Never expose stack traces / SQL / internals to clients.
    console.error('unhandled error:', err?.message ?? err);
    return c.json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } }, 500);
  });

  app.notFound((c: any) =>
    c.json({ error: { code: 'NOT_FOUND', message: 'Resource not found.' } }, 404),
  );
}
