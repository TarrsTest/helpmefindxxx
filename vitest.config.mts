import { defineConfig } from 'vitest/config';

// Tests call the /v1 route handlers IN-PROCESS — no dev server. That works
// because agent auth lives in lib/api/auth.ts (called at the top of every
// handler), not in middleware.ts: middleware's matcher deliberately excludes
// `api/` and `v1/`, so importing a handler skips nothing that matters.
//
// See docs/TESTING.md for what this harness does NOT cover.

export default defineConfig({
  // Resolve tsconfig's `@/*` paths, so tests import the same specifiers the
  // app does. Native since Vite 7 — no vite-tsconfig-paths plugin needed.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // The suite talks to the SHARED dev Supabase. Running files in parallel
    // would interleave writes from different tests against one database, so
    // keep it serial until (if ever) each test owns an isolated schema.
    fileParallelism: false,
  },
});
