import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    // Tests run the Hono app against an in-process SQLite database that
    // emulates the D1 interface (see tests/helpers/d1.ts). No Cloudflare
    // credentials or live services are required.
  },
});
