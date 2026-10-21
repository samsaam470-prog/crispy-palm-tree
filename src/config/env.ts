import { Hono } from 'hono';
import { z } from 'zod';
import { assertConfig, allowedOrigins, SESSION_COOKIE } from './config/env';
import type { Bindings } from './types';

export class ConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConfigError';
  }
}

export function assertConfig(env: Bindings): void {
  const problems: string[] = [];
  if (!env.ADMIN_USER || env.ADMIN_USER.trim().length === 0) problems.push('ADMIN_USER');
  if (!env.ADMIN_PASS || env.ADMIN_PASS.length < 8) problems.push('ADMIN_PASS');
  if (!env.JWT_KEY || env.JWT_KEY.length < 32) problems.push('JWT_KEY');
  if (!env.DB) problems.push('DB');
  if (problems.length > 0) {
    throw new ConfigError(`Missing or invalid configuration: ${problems.join(', ')}`);
  }
}

export function allowedOriginsList(env: Bindings): string[] {
  return allowedOrigins(env);
}

export const SESSION_COOKIE_NAME = SESSION_COOKIE;

export const JWT_TTL_SECONDS = 12 * 60 * 60;

export function publicAppUrl(env: Bindings): string {
  return (env.PUBLIC_APP_URL ?? 'http://localhost:5173').replace(/\/+$/, '');
}

export function isProduction(env: Bindings): boolean {
  return (env.NODE_ENV ?? 'development') === 'production';
}

export const appConfigSchema = z.object({
  ADMIN_USER: z.string().min(1),
  ADMIN_PASS: z.string().min(8),
  JWT_KEY: z.string().min(32),
  FRONTEND_ORIGIN: z.string().optional(),
  PUBLIC_APP_URL: z.string().optional(),
  ALLOWED_ORIGINS: z.string().optional(),
  NODE_ENV: z.string().optional(),
});

export default appConfigSchema;
