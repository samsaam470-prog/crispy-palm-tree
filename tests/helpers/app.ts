/**
 * Test harness: builds the real Hono app with a migrated in-memory D1
 * emulator and provides cookie/bearer auth helpers.
 */

import { app } from '../../src/app';
import type { Env } from '../../src/types';
import { D1TestDb } from './d1';

export const ADMIN_USER = 'admin';
export const ADMIN_PASS = 'correct-horse-battery';
export const JWT_KEY = 'unit-test-signing-key-0123456789-abcdefghij';

export interface Harness {
  env: Env;
  sqlite: D1TestDb;
  request(
    path: string,
    init?: RequestInit & { auth?: AuthMode; token?: string; cookie?: string },
  ): Promise<Response>;
  login(): Promise<{ token: string; cookie: string }>;
}

export type AuthMode = 'none' | 'cookie' | 'bearer' | 'cookie-no-csrf';

export function createHarness(): Harness {
  const sqlite = new D1TestDb();
  sqlite.applyMigrations();
  const env: Env = {
    DB: sqlite as unknown as D1Database,
    ADMIN_USER,
    ADMIN_PASS,
    JWT_KEY,
    PUBLIC_APP_URL: 'http://localhost:5173',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    NODE_ENV: 'test',
  };

  async function request(
    path: string,
    init: RequestInit & { auth?: AuthMode; token?: string; cookie?: string } = {},
  ): Promise<Response> {
    const headers = new Headers(init.headers ?? {});
    if (init.body !== undefined && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
    const mode = init.auth ?? 'none';
    if (mode === 'bearer' && init.token) headers.set('Authorization', `Bearer ${init.token}`);
    if ((mode === 'cookie' || mode === 'cookie-no-csrf') && init.cookie) {
      headers.set('Cookie', init.cookie);
      if (mode === 'cookie') headers.set('X-CSRF-Token', init.cookie.split('=')[1]!);
    }
    const req = new Request(`http://local.test${path}`, { ...init, headers });
    return app.fetch(req, env, { waitUntil: () => {}, passThroughOnException: () => {} });
  }

  async function login(): Promise<{ token: string; cookie: string }> {
    const res = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username: ADMIN_USER, password: ADMIN_PASS }),
    });
    if (!res.ok) throw new Error(`login failed: ${res.status}`);
    const json = (await res.json()) as any;
    const setCookie = res.headers.get('Set-Cookie') ?? '';
    const cookie = setCookie.split(';')[0]!; // name=value
    return { token: json.token, cookie };
  }

  return { env, sqlite, request, login };
}

/** Convenience: authenticated JSON fetcher using bearer tokens. */
export async function api(h: Harness, method: string, path: string, body?: unknown) {
  const { token } = await h.login();
  return h.request(path, {
    method,
    body: body === undefined ? undefined : JSON.stringify(body),
    auth: 'bearer',
    token,
  });
}

export async function jsonOf(res: Response): Promise<any> {
  return res.json().catch(() => null);
}

/** Build a valid interview definition payload for tests. */
export function sampleInterview(overrides: Record<string, unknown> = {}) {
  return {
    title: 'Design Preferences Study',
    description: 'Which design fields interest you?',
    questions: [
      {
        uid: 'q_main',
        type: 'single_choice',
        text: 'Which field do you prefer?',
        required: true,
        pageNumber: 1,
        displayOrder: 1,
        answerDisplay: 'full',
        options: [
          { uid: 'o_web', label: 'Web design', code: 'a', displayOrder: 1, branchTarget: 'web' },
          { uid: 'o_graphic', label: 'Graphic design', code: 'b', displayOrder: 2, branchTarget: 'graphic' },
        ],
      },
      {
        uid: 'q_web_followup',
        type: 'multi_choice_other',
        text: 'Which web topics matter to you?',
        required: false,
        pageNumber: 2,
        displayOrder: 2,
        branchGroup: 'web',
        options: [
          { uid: 'o_ux', label: 'UX', code: 'a', displayOrder: 1 },
          { uid: 'o_perf', label: 'Performance', code: 'b', displayOrder: 2 },
          { uid: 'o_other', label: 'Other', code: 'c', displayOrder: 3, isOther: true },
        ],
      },
      {
        uid: 'q_graphic_followup',
        type: 'short_text',
        text: 'What kind of graphic work?',
        required: false,
        pageNumber: 2,
        displayOrder: 3,
        branchGroup: 'graphic',
      },
      {
        uid: 'q_comments',
        type: 'long_text',
        text: 'Any additional comments?',
        required: false,
        pageNumber: 3,
        displayOrder: 4,
        answerDisplay: 'mapping',
      },
    ],
    branchingRules: [
      { questionUid: 'q_main', optionUid: 'o_web', targetGroup: 'web' },
      { questionUid: 'q_main', optionUid: 'o_graphic', targetGroup: 'graphic' },
    ],
    ...overrides,
  };
}
