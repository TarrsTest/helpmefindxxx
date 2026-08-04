import { defineConfig } from 'vitest/config';

// Contract checks that need a REAL deployment — currently just the /v1 rewrite
// (tests/contract/rewrite.test.ts). Kept out of `pnpm test` and run on its own
// with `pnpm test:rewrite`.
//
// Separate config rather than a flag on the main one, for two reasons: these
// tests must never be swept into the default run by a glob change, and they
// deliberately do NOT load tests/setup.ts — they need no Supabase credentials,
// so this suite can run anywhere, including CI without secrets.

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/contract/**/*.test.ts'],
    // Real network round trips against a deployed server.
    testTimeout: 30_000,
  },
});
