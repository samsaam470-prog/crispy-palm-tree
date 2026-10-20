/**
 * Rate limiting for public endpoints.
 *
 * IMPORTANT: in-memory counters are per-isolate best-effort only — they do NOT
 * provide globally reliable limits across all Worker instances. When the
 * optional RATE_LIMIT_KV binding is configured (see wrangler.toml), a durable
 * fixed-window counter backed by KV is used instead. Cloudflare WAF rate rules
 * can additionally be configured on the dashboard for stronger protection.
 */

import type { Env } from '../types';
import { tooManyRequests } from '../utils/errors';

const WINDOW_MS = 60_000; // one minute
const MAX_REQUESTS_PER_WINDOW = 20;

interface Bucket {
  count: number;
  resetAt: number;
}

// Per-isolate fallback store (documented limitation).
const memBuckets = new Map<string, Bucket>();

function clientKey(req: Request, scope: string): string {
  const ip = req.headers.get('CF-Connecting-IP') ?? 'unknown';
  return `${scope}:${ip}`;
}

export async function enforceRateLimit(env: Env, req: Request, scope: string): Promise<void> {
  const key = clientKey(req, scope);
  const now = Date.now();

  if (env.RATE_LIMIT_KV) {
    // Durable fixed window via KV (eventually consistent; strong enough to
    // deter casual abuse). Window index keeps keys small and self-expiring.
    const win = Math.floor(now / WINDOW_MS);
    const kvKey = `rl:${scope}:${key.slice(-64)}:${win}`;
    try {
      const cur = Number((await env.RATE_LIMIT_KV.get(kvKey)) ?? '0');
      if (cur >= MAX_REQUESTS_PER_WINDOW) throw tooManyRequests();
      await env.RATE_LIMIT_KV.put(kvKey, String(cur + 1), { ttl: 120 });
      return;
    } catch (e) {
      if (e instanceof Error && e.name === 'ApiError') throw e;
      // KV failure: fall through to in-memory so availability is preserved.
    }
  }

  let b = memBuckets.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + WINDOW_MS };
    memBuckets.set(key, b);
  }
  b.count += 1;
  if (b.count > MAX_REQUESTS_PER_WINDOW) throw tooManyRequests();
  // Prevent unbounded memory growth in long-lived isolates.
  if (memBuckets.size > 10_000) {
    for (const [k, v] of memBuckets) if (v.resetAt <= now) memBuckets.delete(k);
  }
}
