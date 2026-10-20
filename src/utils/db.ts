/**
 * D1-compatible database helpers. All application code uses this interface so
 * the same queries run against Cloudflare D1 in production and against the
 * SQLite-backed test adapter (tests/helpers/d1.ts) locally.
 */

import type { Env } from '../types';

export interface D1Result<T = Record<string, unknown>> {
  results: T[];
  success?: boolean;
  meta?: { changes?: number };
}

export interface Database {
  prepare(query: string): {
    bind(...values: unknown[]): {
      first<T = Record<string, unknown>>(colName?: string | null): Promise<T | null>;
      all<T = Record<string, unknown>>(): Promise<D1Result<T>>;
      run<T = Record<string, unknown>>(): Promise<D1Result<T>>;
    };
  };
  batch<T = unknown>(statements: Array<{ bind(...v: unknown[]): any }>): Promise<T[]>;
}

export function db(env: Env): Database {
  return env.DB as unknown as Database;
}

/** Shorthand for a single-row SELECT. */
export async function one<T>(env: Env, sql: string, ...vals: unknown[]): Promise<T | null> {
  return (await db(env).prepare(sql).bind(...vals).first<T>(null)) as T | null;
}

/** Shorthand for a multi-row SELECT. */
export async function rows<T>(env: Env, sql: string, ...vals: unknown[]): Promise<T[]> {
  const r = await db(env).prepare(sql).bind(...vals).all<T>();
  return r.results ?? [];
}

/** Shorthand for INSERT/UPDATE/DELETE. Returns number of changed rows. */
export async function run(env: Env, sql: string, ...vals: unknown[]): Promise<number> {
  const r = await db(env).prepare(sql).bind(...vals).run();
  return r.meta?.changes ?? 0;
}
