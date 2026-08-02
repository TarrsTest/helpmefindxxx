import { randomUUID } from 'crypto';
import { createAdminClient } from '@/lib/supabase/admin';

// The suite runs against the SHARED dev Supabase — the same database JQ, Quan
// and the running dev server are using. So two rules hold everywhere:
//
//   1. Everything a test creates is tagged with this run's prefix.
//   2. Cleanup deletes BY THAT PREFIX ONLY. There is no unconditional delete
//      in this repo's tests, and there must never be one — a bare
//      `delete from users` would take someone else's work with it.
//
// The corollary for assertions: never assert on a global count
// ("expect 3 users"). Someone else's row appearing mid-run would fail a test
// that has nothing to do with them. Assert only over rows matching
// RUN_PREFIX, or over ids this test created.

export const TEST_HANDLE_PREFIX = 'test_';

/** Unique per `vitest` process, so parallel runs can't collide or delete each other's rows. */
export const RUN_PREFIX = `${TEST_HANDLE_PREFIX}${randomUUID().slice(0, 8)}_`;

/** Build a handle owned by this run. `users.handle` is capped at 64 chars. */
export const testHandle = (name: string): string =>
  `${RUN_PREFIX}${name}`.slice(0, 64);

/** Rows this run created, for scoped assertions (never a global count). */
export const findRunUsers = async (): Promise<{ id: string; handle: string }[]> => {
  const db = createAdminClient();
  const { data, error } = await db
    .from('users')
    .select('id, handle')
    .like('handle', `${RUN_PREFIX}%`);
  if (error) throw error;
  return data ?? [];
};

/**
 * Delete only what this run created. Safe to call twice (idempotent), and
 * refuses to run if the prefix ever came out empty — that guard is the whole
 * point: a scoped delete with an empty filter IS an unconditional delete.
 * Rows in other tables (profiles, connections, api_keys) go with the user via
 * their foreign keys.
 */
export const cleanupRun = async (): Promise<number> => {
  if (!RUN_PREFIX.startsWith(TEST_HANDLE_PREFIX) || RUN_PREFIX.length < 10) {
    throw new Error(`refusing to delete with an unsafe prefix: "${RUN_PREFIX}"`);
  }
  const db = createAdminClient();
  const { data, error } = await db
    .from('users')
    .delete()
    .like('handle', `${RUN_PREFIX}%`)
    .select('id');
  if (error) throw error;
  return (data ?? []).length;
};
