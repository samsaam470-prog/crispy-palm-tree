import { jwtVerify, SignJWT } from 'jose';
import type { Context, Next } from 'hono';
import { timingSafeEqualStr } from '../utils/ids';
import type { Bindings } from '../types';

export const SESSION_COOKIE = 'admin_token';
export const JWT_TTL_SECONDS = 12 * 60 * 60;

export async function createAdminToken(username: string, secretKey: string): Promise<string> {
  const enc = new TextEncoder();
  return new SignJWT({ sub: username, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('12h')
    .sign(enc.encode(secretKey));
}

function getBearerToken(c: Context<{ Bindings: Bindings }>): string {
  const header = c.req.header('Authorization');
  if (header?.startsWith('Bearer ')) {
    return header.slice('Bearer '.length).trim();
  }

  const cookieHeader = c.req.header('Cookie') ?? '';
  const match = cookieHeader.match(/(?:^|;\s*)admin_token=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : '';
}

export async function adminAuthMiddleware(c: Context<{ Bindings: Bindings }>, next: Next) {
  const token = getBearerToken(c);
  if (!token) {
    return c.json({ error: 'missing_auth', message: 'Authentication required.' }, 401);
  }

  const jwtKey = c.env.JWT_KEY;
  if (!jwtKey) {
    return c.json({ error: 'config_error', message: 'Authentication is not configured.' }, 500);
  }

  try {
    const { payload } = await jwtVerify(token, new TextEncoder().encode(jwtKey));
    const sub = typeof payload.sub === 'string' ? payload.sub : '';
    const role = typeof payload.role === 'string' ? payload.role : '';
    if (role !== 'admin' || !sub || !timingSafeEqualStr(sub, c.env.ADMIN_USER ?? '')) {
      return c.json({ error: 'invalid_token', message: 'Invalid admin session.' }, 401);
    }
    await next();
  } catch {
    return c.json({ error: 'invalid_token', message: 'Invalid or expired session token.' }, 401);
  }
}
