import { jwtVerify, SignJWT } from 'jose';
import type { Context, Next } from 'hono';
import type { Bindings } from '../types';

export async function createAdminToken(username: string, secretKey: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = encoder.encode(secretKey);
  return new SignJWT({ sub: username, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(key);
}

export async function adminAuthMiddleware(c: Context<{ Bindings: Bindings }>, next: Next) {
  const authHeader = c.req.header('Authorization');
  let token = '';

  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.substring(7);
  } else {
    const cookieHeader = c.req.header('Cookie');
    if (cookieHeader) {
      const match = cookieHeader.match(/admin_token=([^;]+)/);
      if (match) {
        token = match[1];
      }
    }
  }

  if (!token) {
    return c.json({ error: 'Missing authentication credentials' }, 401);
  }

  try {
    const jwtKey = c.env.JWT_KEY;
    if (!jwtKey) {
      return c.json({ error: 'Server authentication configuration error' }, 500);
    }
    const encoder = new TextEncoder();
    const key = encoder.encode(jwtKey);
    await jwtVerify(token, key);
    await next();
  } catch (err) {
    return c.json({ error: 'Invalid or expired session token' }, 401);
  }
}
