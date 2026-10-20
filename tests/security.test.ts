import { describe, expect, it } from 'vitest';
import { createHarness } from './helpers/app';

describe('security + reliability', () => {
  it('CORS: allowed origin gets credentials headers; others do not', async () => {
    const h = createHarness();
    const allowed = await h.request('/api/health', {
      headers: { Origin: 'http://localhost:5173' },
    });
    expect(allowed.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    expect(allowed.headers.get('Access-Control-Allow-Credentials')).toBe('true');
    expect(allowed.headers.get('Vary')).toContain('Origin');

    const evil = await h.request('/api/health', { headers: { Origin: 'https://evil.example' } });
    expect(evil.headers.get('Access-Control-Allow-Origin')).toBeNull();
    // Never a wildcard with credentials.
    for (const res of [allowed, evil]) {
      expect(res.headers.get('Access-Control-Allow-Origin')).not.toBe('*');
    }
  });

  it('preflight advertises only needed methods/headers', async () => {
    const h = createHarness();
    const pre = await h.request('/api/auth/login', {
      method: 'OPTIONS',
      headers: { Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('Access-Control-Allow-Headers')).toContain('X-CSRF-Token');
  });

  it('SQL injection attempts are treated as data, never executed', async () => {
    const h = createHarness();
    const res = await h.request('/api/public/interviews/x`; DROP TABLE interviews;--');
    // Path param fails the format guard -> 404 (no crash, no injection).
    expect(res.status).toBe(404);
    const tables = h.sqlite
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='interviews'")
      .all();
    expect(tables.length).toBe(1);
    // Injection via JSON body values also stays inert.
    const login = await h.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: "admin' OR '1'='1", password: "x' OR '1'='1" }),
    });
    expect(login.status).toBe(401);
  });

  it('error responses never leak internals (SQL, stack, env)', async () => {
    const h = createHarness();
    // Unauthenticated access to an admin route: must be a safe JSON 401.
    const res = await h.request('/api/interviews/999999');
    expect(res.status).toBe(401);
    const text = await res.text();
    for (const needle of ['TypeError', 'SELECT', 'better-sqlite', 'JWT_KEY', 'ADMIN_PASS']) {
      expect(text.toLowerCase()).not.toContain(needle.toLowerCase());
    }
    // Authenticated lookup of a missing resource: safe JSON 404.
    const { token } = await h.login();
    const missing = await h.request('/api/interviews/999999', { auth: 'bearer', token });
    expect(missing.status).toBe(404);
    const mtext = await missing.text();
    expect(mtext).not.toContain('stack');
    expect(mtext).not.toContain('SELECT');
  });

  it('oversized bodies rejected before parsing', async () => {
    const h = createHarness();
    const big = 'a'.repeat(300 * 1024);
    const res = await h.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: big, password: big }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 413]).toContain(res.status);
  });

  it('unknown routes return JSON 404, not HTML stack traces', async () => {
    const h = createHarness();
    const res = await h.request('/api/does-not-exist');
    expect(res.status).toBe(404);
    expect(await res.json()).toHaveProperty('error');
  });

  it('secure headers present', async () => {
    const h = createHarness();
    const res = await h.request('/api/health');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(res.headers.get('X-Frame-Options')).toBeTruthy();
  });

  it('oversized bodies rejected before parsing', async () => {
    const h = createHarness();
    const big = 'a'.repeat(300 * 1024);
    const res = await h.request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: big, password: big }),
      headers: { 'Content-Type': 'application/json' },
    });
    expect([400, 413]).toContain(res.status);
  });
});
