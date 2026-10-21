import { describe, expect, it } from 'vitest';
import { assertConfig, ConfigError } from '../src/config/env';
import { createAdminToken } from '../src/middleware/auth';
import { generatePublicId, timingSafeEqualStr } from '../src/utils/ids';

describe('security helpers', () => {
  it('detects valid string equality without timing issues', () => {
    expect(timingSafeEqualStr('abc123', 'abc123')).toBe(true);
    expect(timingSafeEqualStr('abc123', 'def456')).toBe(false);
  });

  it('generates a public ID of the requested length', () => {
    expect(generatePublicId(22)).toHaveLength(22);
  });

  it('creates a JWT token for the admin identity', async () => {
    const token = await createAdminToken('admin', 'super_secure_jwt_key_for_tests_123');
    expect(token).toContain('.');
  });

  it('requires configuration for admin auth', () => {
    expect(() =>
      assertConfig({
        DB: {} as D1Database,
        ADMIN_USER: 'admin',
        ADMIN_PASS: 'short',
        JWT_KEY: 'too-short',
      } as any),
    ).toThrow(ConfigError);
  });
});
