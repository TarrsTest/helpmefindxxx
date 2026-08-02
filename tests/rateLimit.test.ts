import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { POST as createUser } from '@/app/api/v1/users/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { cleanupRun, testHandle } from './helpers/testData';

// Per-key fixed-window rate limiting (SPEC §7.2), enforced by
// check_rate_limit() in 002_social_graph.sql and called from
// lib/api/auth.ts on every authenticated request.
//
// TIME IS CONTROLLED THROUGH STATE, NOT THE CLOCK. The limiter buckets by
// `floor(now / window) * window` and stores the counter at that bucket, so
// "the window rolled over" is fully expressed by which bucket a row sits in.
// The tests move rows between buckets instead of sleeping: a sleep-based test
// would have to exhaust the limit inside a window narrow enough to wait out,
// and a few database round trips straddling that boundary is exactly the
// flake we refuse to ship. vi.useFakeTimers is no help either — the clock
// that matters is Postgres's now(), not the test process's.
//
// The window is an hour so no test can accidentally cross a real boundary,
// and the limit is stubbed down to 3 so exhausting it costs 4 requests
// instead of 61.

const BASE = 'http://test.local';
const LIMIT = 3;
const WINDOW_SECONDS = 3600;

// lib/config.ts reads process.env at import time, so the env has to be
// stubbed and the module graph reset BEFORE the route is imported. A plain
// static import would capture the real defaults and silently test nothing.
let listConnections: (request: Request) => Promise<Response>;
let config: typeof import('@/lib/config');

interface Party {
  userId: string;
  apiKey: string;
  keyId: string;
}

const db = () => createAdminClient();

const register = async (name: string): Promise<Party> => {
  const res = await createUser(
    new Request(`${BASE}/v1/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: testHandle(name) }),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user_id: string; api_key: string };

  const { data, error } = await db()
    .from('api_keys')
    .select('id')
    .eq('user_id', body.user_id)
    .single();
  if (error) throw error;

  return { userId: body.user_id, apiKey: body.api_key, keyId: data.id as string };
};

const call = (party: Party) =>
  listConnections(
    new Request(`${BASE}/v1/connections`, {
      headers: { authorization: `Bearer ${party.apiKey}` },
    }),
  );

/** Spend the whole allowance. Every one of these must be allowed. */
const exhaust = async (party: Party) => {
  for (let i = 0; i < LIMIT; i += 1) {
    const res = await call(party);
    expect(res.status, `request ${i + 1} of ${LIMIT} should be allowed`).toBe(200);
  }
};

const bucketOf = (epochSeconds: number) =>
  Math.floor(epochSeconds / WINDOW_SECONDS) * WINDOW_SECONDS;

const currentBucket = () => bucketOf(Date.now() / 1000);

const counterRows = async (party: Party) => {
  const { data, error } = await db()
    .from('rate_limits')
    .select('window_start, count')
    .eq('key_id', party.keyId);
  if (error) throw error;
  return (data ?? []) as { window_start: string; count: number }[];
};

/** Plant a counter in an arbitrary bucket — used to stand in for history. */
const seedCounter = async (party: Party, bucketEpoch: number, count: number) => {
  const { error } = await db().from('rate_limits').insert({
    key_id: party.keyId,
    window_start: new Date(bucketEpoch * 1000).toISOString(),
    count,
  });
  if (error) throw error;
};

/**
 * Move this key's counters one window into the past. From the limiter's point
 * of view that is indistinguishable from the clock having crossed into the
 * next window: it only ever looks up (key_id, current_bucket), and that row
 * is now gone. Scoped to one key — no other key's counters are touched.
 */
const rollWindowOver = async (party: Party) => {
  const rows = await counterRows(party);
  expect(rows.length).toBeGreaterThan(0);

  for (const row of rows) {
    const shifted = new Date(Date.parse(row.window_start) - WINDOW_SECONDS * 1000);
    const { error } = await db()
      .from('rate_limits')
      .update({ window_start: shifted.toISOString() })
      .eq('key_id', party.keyId)
      .eq('window_start', row.window_start);
    if (error) throw error;
  }
};

beforeAll(async () => {
  vi.stubEnv('RATE_LIMIT', String(LIMIT));
  vi.stubEnv('RATE_WINDOW_SECONDS', String(WINDOW_SECONDS));
  vi.resetModules();

  ({ GET: listConnections } = await import('@/app/api/v1/connections/route'));
  config = await import('@/lib/config');
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await cleanupRun();
});

describe('rate limit', () => {
  it('exercises the stubbed limit rather than the configured default', () => {
    // Without this, a broken env stub would quietly fall back to 60/minute:
    // every "over the limit" case below would then pass 200 where it expects
    // 429 and the failure would look like a limiter bug instead of a test
    // harness bug.
    expect(config.RATE_LIMIT).toBe(LIMIT);
    expect(config.RATE_WINDOW_SECONDS).toBe(WINDOW_SECONDS);
  });

  it('allows every request up to the limit', async () => {
    const party = await register('rl_under');

    await exhaust(party);
  });

  it('rejects the request that goes past the limit', async () => {
    const party = await register('rl_over');
    await exhaust(party);

    const res = await call(party);

    expect(res.status).toBe(429);
    await expect(res.json()).resolves.toEqual({ error: 'rate limit exceeded' });
  });

  it('counts per key, so one exhausted key cannot block another', async () => {
    const spender = await register('rl_spender');
    const bystander = await register('rl_bystander');

    await exhaust(spender);
    expect((await call(spender)).status).toBe(429);

    // Same window, different key_id — its own bucket, untouched.
    expect((await call(bystander)).status).toBe(200);

    const rows = await counterRows(bystander);
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(1);
  });

  it('ignores a counter left over from an earlier window', async () => {
    const party = await register('rl_stale');
    // Far past any limit — if the lookup were not scoped to the current
    // window, this alone would lock the key out.
    await seedCounter(party, currentBucket() - WINDOW_SECONDS, 999);

    expect((await call(party)).status).toBe(200);
  });

  it('starts a fresh count once the window rolls over', async () => {
    const party = await register('rl_rollover');
    await exhaust(party);
    expect((await call(party)).status).toBe(429);

    await rollWindowOver(party);

    expect((await call(party)).status).toBe(200);
  });

  it('records the counter in the current fixed-window bucket', async () => {
    const party = await register('rl_bucket');
    await call(party);

    const rows = await counterRows(party);
    expect(rows).toHaveLength(1);

    const stored = Date.parse(rows[0].window_start) / 1000;
    // Aligned to the window grid, and recent — a limiter that dropped the
    // bucket arithmetic and pinned every counter to one constant timestamp
    // would still count correctly but would never roll over.
    expect(stored % WINDOW_SECONDS).toBe(0);
    expect(Date.now() / 1000 - stored).toBeLessThan(WINDOW_SECONDS);
    expect(Date.now() / 1000 - stored).toBeGreaterThanOrEqual(0);
  });
});
