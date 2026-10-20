import { describe, expect, it } from 'vitest';
import { ADMIN_PASS, ADMIN_USER, createHarness } from './helpers/app';

describe('auth', () => {
  it('logs in with correct credentials and sets an HttpOnly cookie', async () => {
    const h = createHarness();
    const res = await h.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(typeof json.token).toBe('string');
    const sc = res.headers.get('Set-Cookie') ?? '';
    expect(sc).toContain('HttpOnly');
    expect(sc).toContain('SameSite=Lax');
    // Never leak the signing key or password.
    expect(JSON.stringify(json)).not.toContain(ADMIN_PASS);
  });

  it('rejects wrong credentials with a generic 401', async () => {
    const h = createHarness();
    const res = await h.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: ADMIN_USER, password: 'wrong-password' }),
    });
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.error.message).toBe('Invalid credentials.');
    expect(JSON.stringify(json)).not.toContain('JWT_KEY');
  });

  it('rejects malformed login bodies safely', async () => {
    const h = createHarness();
    const res = await h.request('/api/auth/login', { method: 'POST', body: 'not-json' });
    expect([400, 401]).toContain(res.status);
  });

  it('protects private endpoints without a session (401)', async () => {
    const h = createHarness();
    for (const p of ['/api/interviews', '/api/dashboard/summary', '/api/submissions/recent']) {
      const res = await h.request(p);
      expect(res.status).toBe(401);
    }
  });

  it('GET /api/auth/me works with bearer token', async () => {
    const h = createHarness();
    const { token } = await h.login();
    const res = await h.request('/api/auth/me', { auth: 'bearer', token });
    expect(res.status).toBe(200);
    expect((await res.json()).user.username).toBe(ADMIN_USER);
  });

  it('GET /api/auth/me works with cookie + CSRF header, blocked without CSRF', async () => {
    const h = createHarness();
    const { cookie } = await h.login();
    const ok = await h.request('/api/auth/me', { auth: 'cookie', cookie });
    expect(ok.status).toBe(200);
    const noCsrf = await h.request('/api/auth/me', { auth: 'cookie-no-csrf', cookie });
    expect(noCsrf.status).toBe(403);
  });

  it('rejects forged tokens signed with another key', async () => {
    const h = createHarness();
    // Build an HS256 JWT with a different secret via jose.
    const { SignJWT } = await import('jose');
    const forged = await new SignJWT({})
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(ADMIN_USER)
      .setJti('x')
      .setIssuedAt()
      .setExpirationTime('60s')
      .sign(new TextEncoder().encode('attacker-key-attacker-key-attacker-key'));
    const res = await h.request('/api/auth/me', { auth: 'bearer', token: forged });
    expect(res.status).toBe(401);
  });

  it('rejects alg=none tokens', async () => {
    const h = createHarness();
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const none = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: ADMIN_USER, jti: 'x', exp: Math.floor(Date.now() / 1000) + 60 })}.`;
    const res = await h.request('/api/auth/me', { auth: 'bearer', token: none });
    expect(res.status).toBe(401);
  });

  it('logout clears the session cookie', async () => {
    const h = createHarness();
    const { cookie } = await h.login();
    const res = await h.request('/api/auth/logout', { method: 'POST', auth: 'cookie', cookie });
    expect(res.status).toBe(200);
    const sc = res.headers.get('Set-Cookie') ?? '';
    expect(sc).toMatch(/Max-Age=0/);
  });

  it('returns 401 when server config is incomplete (no credential bypass)', async () => {
    const h = createHarness();
    delete (h.env as any).JWT_KEY;
    const res = await h.request('/api/interviews');
    expect(res.status).toBe(401);
    const body = JSON.stringify(await res.json());
    expect(body).not.toContain('JWT_KEY'); // message must not name the variable
  });

  it('public endpoints stay accessible without auth', async () => {
    const h = createHarness();
    const res = await h.request('/api/public/interviews/nonexistent12');
    expect(res.status).toBe(404); // route reachable, just not found — not 401
  });
});
