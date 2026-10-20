/**
 * Cloudflare Worker entry point.
 * Configuration problems fail loudly at startup instead of silently allowing
 * access; individual requests re-validate via assertConfig in requireAuth.
 */

import { app } from './app';
import type { Env } from './types';
import { assertConfig } from './config/env';

export default {
  fetch: app.fetch,

  async initialize(state: { waitUntil(p: Promise<any>): void }, env: Env): Promise<void> {
    try {
      assertConfig(env);
    } catch (e) {
      // Log the variable NAMES only (never values) and keep serving — every
      // protected route will return a safe configuration error until fixed.
      console.error('Worker initialization: invalid configuration:', (e as Error).message);
    }
    state.waitUntil(Promise.resolve());
  },
};
