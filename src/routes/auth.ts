import { Hono } from 'hono';
import { z } from 'zod';
import { createAdminToken, SESSION_COOKIE } from '../middleware/auth';
import { timingSafeEqualStr } from '../utils/ids';
import type { Bindings } from '../types';

const authRouter = new Hono<{ Bindings: Bindings }>();

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

authRouter.post('/login', async (c) => {
  const env = c.env;
  const adminUser = env.ADMIN_USER ?? '';
  const adminPass = env.ADMIN_PASS ?? '';
  const jwtKey = env.JWT_KEY ?? '';

  if (!adminUser || !adminPass || !jwtKey) {
    return c.json({ error: 'config_error', message: 'Authentication is not configured.' }, 500);
  }

  const body = await c.req.json().catch(() => ({}));
  const parsed = loginSchema.safeParse(body);
  if (!parsed.success) {
    return c.json({ error: 'invalid_payload', details: parsed.error.format() }, 400);
  }

  const { username, password } = parsed.data;
  const validUser = timingSafeEqualStr(username, adminUser);
  const validPass = timingSafeEqualStr(password, adminPass);

  if (!validUser || !validPass) {
    return c.json({ error: 'invalid_credentials', message: 'The supplied credentials are invalid.' }, 401);
  }

  const token = await createAdminToken(username, jwtKey);
  const isSecure = (c.env.NODE_ENV ?? 'development') === 'production';
  c.header('Set-Cookie', `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Lax; ${isSecure ? 'Secure;' : ''} Max-Age=43200`);

  return c.json({ success: true, token, user: username }, 200);
});

authRouter.post('/logout', (c) => {
  const isSecure = (c.env.NODE_ENV ?? 'development') === 'production';
  c.header('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Path=/; SameSite=Lax; ${isSecure ? 'Secure;' : ''} Max-Age=0`);
  return c.json({ success: true, message: 'Logged out successfully.' });
});

authRouter.get('/me', async (c) => {
  const token = c.req.header('Authorization')?.startsWith('Bearer ') ? c.req.header('Authorization')!.slice(7).trim() : '';
  if (!token) {
    return c.json({ authenticated: false }, 401);
  }

  try {
    const jwtKey = c.env.JWT_KEY;
    if (!jwtKey) {
      return c.json({ error: 'config_error', message: 'Authentication is not configured.' }, 500);
    }
    const result = await import('jose').then(({ jwtVerify }) => jwtVerify(token, new TextEncoder().encode(jwtKey)));
    const username = typeof result.payload.sub === 'string' ? result.payload.sub : '';
    if (!username || !timingSafeEqualStr(username, c.env.ADMIN_USER ?? '')) {
      return c.json({ authenticated: false }, 401);
    }
    return c.json({ authenticated: true, user: username });
  } catch {
    return c.json({ authenticated: false }, 401);
  }
});

export default authRouter;
