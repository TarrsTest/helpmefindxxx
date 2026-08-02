import { afterAll, describe, expect, it } from 'vitest';
import { GET as getRecommendations } from '@/app/api/v1/recommendations/route';
import { POST as createUser } from '@/app/api/v1/users/route';
import { cleanupRun, findRunUsers, testHandle } from './helpers/testData';

// Smoke test for the HARNESS, not for the product. It proves four things
// work, so that a failure in a business test later means the business logic
// is wrong rather than the plumbing:
//
//   1. vitest runs, resolves `@/…` and can import a Next route handler
//   2. a handler is callable in-process with a plain Request — no dev server
//   3. tests/setup.ts loaded .env, so Supabase is actually reachable
//   4. the run-scoped create/cleanup convention works end to end
//
// Business tests (auth / rate limit / pagination / contact) are NOT here yet.
// docs/TESTING.md lists what green does and does not mean.

afterAll(async () => {
  await cleanupRun();
});

describe('harness', () => {
  it('calls a route handler in-process, with no dev server running', async () => {
    // No Authorization header: authenticate() rejects on the header alone,
    // before it ever builds a Supabase client — so this case is pure
    // in-process, no network, and proves the import/invoke path by itself.
    const res = await getRecommendations(
      new Request('http://test.local/v1/recommendations'),
    );

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'missing bearer token' });
  });

  it('reaches Supabase with the env that tests/setup.ts loaded', async () => {
    const handle = testHandle('smoke');

    const res = await createUser(
      new Request('http://test.local/v1/users', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle }),
      }),
    );

    expect(res.status).toBe(201); // POST /v1/users returns 201 Created

    const body = (await res.json()) as { handle: string; api_key: string };
    expect(body.handle).toBe(handle);

    // Asserted as booleans on purpose: a failed `expect(body.api_key).toMatch()`
    // would print the plaintext key into the test output. The key is shown
    // exactly once by the API and is hashed at rest — keep it out of logs.
    expect(typeof body.api_key).toBe('string');
    expect(body.api_key.startsWith('sk_')).toBe(true);
  });

  it('cleans up only the rows this run created', async () => {
    // Scoped to RUN_PREFIX — never a global count, because JQ and Quan are
    // writing to this same database while these tests run.
    expect(await findRunUsers()).toHaveLength(1);

    const deleted = await cleanupRun();
    expect(deleted).toBe(1);
    expect(await findRunUsers()).toHaveLength(0);
  });
});
