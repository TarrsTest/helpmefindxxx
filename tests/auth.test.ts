import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { randomBytes } from 'crypto';
import { POST as createUser } from '@/app/api/v1/users/route';
import { GET as getRecommendations } from '@/app/api/v1/recommendations/route';
import { GET as getGraph } from '@/app/api/v1/graph/route';
import { POST as updateProfile } from '@/app/api/v1/profile/route';
import {
  GET as listConnections,
  POST as createConnection,
} from '@/app/api/v1/connections/route';
import { POST as respondToConnection } from '@/app/api/v1/connections/[id]/respond/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { cleanupRun, testHandle } from './helpers/testData';

// Bearer api_key authentication (SPEC §3 / §7). Every case below runs against
// EVERY /v1 endpoint that has an auth gate — six handlers across five route
// files, i.e. all of them. The gate lives in lib/api/auth.ts and is invoked at
// the top of each handler, so an endpoint added later without that call would
// simply be missing from this table: keep ENDPOINTS in sync when adding routes.
//
// These tests deliberately assert ONLY on the auth gate. For the valid-key
// case they check "not rejected", not a specific success body — each
// endpoint's own semantics belong to its own test group. That is also why the
// POST bodies are empty: profile/connections/respond all validate the body
// AFTER authenticating, so an empty body proves the gate opened without
// reaching the embedding provider or writing anything to the database.

const BASE = 'http://test.local';

interface Endpoint {
  name: string;
  call: (headers: Record<string, string>) => Promise<Response>;
}

const jsonPost = (headers: Record<string, string>) => ({
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: '{}',
});

// Any syntactically valid uuid — respond rejects the body before it ever
// looks this id up, so it never needs to exist.
const UNUSED_ID = '00000000-0000-4000-8000-000000000000';

const ENDPOINTS: Endpoint[] = [
  {
    name: 'GET /v1/recommendations',
    call: (h) => getRecommendations(new Request(`${BASE}/v1/recommendations`, { headers: h })),
  },
  {
    name: 'GET /v1/graph',
    call: (h) => getGraph(new Request(`${BASE}/v1/graph`, { headers: h })),
  },
  {
    name: 'GET /v1/connections',
    call: (h) => listConnections(new Request(`${BASE}/v1/connections`, { headers: h })),
  },
  {
    name: 'POST /v1/profile',
    call: (h) => updateProfile(new Request(`${BASE}/v1/profile`, jsonPost(h))),
  },
  {
    name: 'POST /v1/connections',
    call: (h) => createConnection(new Request(`${BASE}/v1/connections`, jsonPost(h))),
  },
  {
    name: 'POST /v1/connections/:id/respond',
    call: (h) =>
      respondToConnection(
        new Request(`${BASE}/v1/connections/${UNUSED_ID}/respond`, jsonPost(h)),
        { params: Promise.resolve({ id: UNUSED_ID }) },
      ),
  },
];

let validKey: string;
let revokedKey: string;

const register = async (name: string): Promise<{ userId: string; apiKey: string }> => {
  const res = await createUser(
    new Request(`${BASE}/v1/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: testHandle(name) }),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user_id: string; api_key: string };
  return { userId: body.user_id, apiKey: body.api_key };
};

beforeAll(async () => {
  const ok = await register('auth_ok');
  validKey = ok.apiKey;

  const revoked = await register('auth_revoked');
  revokedKey = revoked.apiKey;

  const db = createAdminClient();
  const { error } = await db
    .from('api_keys')
    .update({ revoked: true })
    .eq('user_id', revoked.userId);
  if (error) throw error;
});

afterAll(async () => {
  await cleanupRun();
});

describe.each(ENDPOINTS)('$name', ({ call }) => {
  it('rejects a request with no Authorization header', async () => {
    const res = await call({});

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'missing bearer token' });
  });

  it('rejects a header missing the Bearer prefix, even with a real key', async () => {
    // The key itself is valid — only the scheme is missing. Rejecting here
    // proves the gate parses the header rather than scanning it for anything
    // that looks like a key.
    const res = await call({ authorization: validKey });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'missing bearer token' });
  });

  it('rejects a Bearer header with no key after it', async () => {
    const res = await call({ authorization: 'Bearer' });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'missing bearer token' });
  });

  it('rejects a well-formed key that does not exist (forged)', async () => {
    // Same shape the real generator produces: sk_ + 48 hex chars. It is the
    // sha256 lookup that fails, not the format — a forger who knows the shape
    // still gets nothing. Distinct error message from the malformed cases.
    const forged = `sk_${randomBytes(24).toString('hex')}`;
    const res = await call({ authorization: `Bearer ${forged}` });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'invalid api key' });
  });

  it('rejects a key that exists but has been revoked', async () => {
    const res = await call({ authorization: `Bearer ${revokedKey}` });

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'invalid api key' });
  });

  it('lets a valid, unrevoked key through', async () => {
    const res = await call({ authorization: `Bearer ${validKey}` });

    // Not 401: the gate opened. The status may legitimately be 200 (GETs) or
    // 400 (POSTs rejecting the empty body) — both mean authentication passed.
    expect(res.status).not.toBe(401);
    // 429 would also be "not 401" while proving nothing about auth, so rule
    // the rate limiter out explicitly.
    expect(res.status).not.toBe(429);
  });
});
