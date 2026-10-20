/**
 * JWT session handling (HS256 via `jose`). Stateless tokens: logout clears
 * the client cookie; see docs/API.md for the documented limitation.
 */

import { SignJWT, jwtVerify } from 'jose';
import type { Env } from '../types';
import { JWT_TTL_SECONDS, SESSION_COOKIE } from '../config/env';
import { unauthorized } from '../utils/errors';

function key(env: Env): Uint8Array {
  return new TextEncoder().encode(env.JWT_KEY);
}

export interface SessionClaims {
  sub: string;
  jti: string;
}

export async function createSessionToken(env: Env, subject: string): Promise<string> {
  const jti = crypto.randomUUID();
  return await new SignJWT({})
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(subject)
    .setJti(jti)
    .setIssuedAt()
    .setExpirationTime(`${JWT_TTL_SECONDS}s`)
    .sign(key(env));
}

export async function verifySessionToken(env: Env, token: string): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(token, key(env), {
      algorithms: ['HS256'],
      issuer: undefined,
    });
    if (typeof payload.sub !== 'string' || typeof payload.jti !== 'string') {
      throw new Error('missing claims');
    }
    // Required-claims check: exp is enforced by jwtVerify; sub/jti above.
    return { sub: payload.sub, jti: payload.jti };
  } catch {
    throw unauthorized('Invalid or expired session.', 'INVALID_TOKEN');
  }
}

export function sessionCookie(env: Env, token: string, maxAge = JWT_TTL_SECONDS): string {
  const parts = [
    `${SESSION_COOKIE}=${token}`,
    'HttpOnly',
    'SameSite=Lax',
    `Path=/`,
    `Max-Age=${maxAge}`,
  ];
  if (env.NODE_ENV === 'production') parts.push('Secure');
  return parts.join('; ');
}

export function clearedSessionCookie(env: Env): string {
  return sessionCookie(env, '', 0);
}

/** Extract + verify the session from Cookie or Authorization: Bearer header. */
export async function readSession(env: Env, req: Request): Promise<SessionClaims> {
  const auth = req.headers.get('Authorization');
  if (auth && /^Bearer\s+/i.test(auth)) {
    return verifySessionToken(env, auth.replace(/^Bearer\s+/i, '').trim());
  }
  const cookie = req.headers.get('Cookie') ?? '';
  const m = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`));
  if (!m) throw unauthorized('Authentication required.');
  return verifySessionToken(env, decodeURIComponent(m[1]));
}
