/**
 * Application configuration validation.
 * Rejects requests when required secrets are missing or obviously invalid.
 */

import type { Env } from '../types';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

const MIN_JWT_KEY_LENGTH = 32;

/** Throws ConfigError (mapped to HTTP 500-safe message) if config is invalid. */
export function assertConfig(env: Env): void {
  const problems: string[] = [];
  if (!env.ADMIN_USER || env.ADMIN_USER.trim() === '') problems.push('ADMIN_USER');
  if (!env.ADMIN_PASS || env.ADMIN_PASS.length < 8) problems.push('ADMIN_PASS');
  if (!env.JWT_KEY || env.JWT_KEY.length < MIN_JWT_KEY_LENGTH) problems.push('JWT_KEY');
  if (!env.DB) problems.push('DB binding');
  if (problems.length > 0) {
    // Never include values — only variable names.
    throw new ConfigError(
      `Server configuration incomplete. Missing/invalid: ${problems.join(', ')}.`,
    );
  }
}

export function isProduction(env: Env): boolean {
  return env.NODE_ENV === 'production';
}

/** Cookie name for the admin session. */
export const SESSION_COOKIE = 'admin_session';

/** JWT lifetime in seconds (12 hours). */
export const JWT_TTL_SECONDS = 12 * 60 * 60;

export function publicAppUrl(env: Env): string {
  return (env.PUBLIC_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
}

export function allowedOrigins(env: Env): string[] {
  const list: string[] = [];
  if (env.ALLOWED_ORIGINS) {
    for (const o of env.ALLOWED_ORIGINS.split(',')) {
      const t = o.trim();
      if (t) list.push(t.replace(/\/+$/, ''));
    }
  }
  const app = env.PUBLIC_APP_URL?.trim().replace(/\/+$/, '');
  if (app && !list.includes(app)) list.push(app);
  return list;
}
