import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// An ASYMMETRIC embedding stub, unlike the shared unit-vector one used
// elsewhere. Every text is placed at a chosen angle in the plane spanned by
// dims 0 and 1, so cosine similarity between two texts is exactly the cosine
// of the angle between them — a value this test can predict rather than
// merely observe.
//
// That asymmetry is the point. With a stub where every text maps to the same
// vector, sim_a and sim_b are both 1.0, and a route that computed sim_b as a
// second copy of sim_a — or swapped the two directions — would pass every
// assertion. The whole reason these columns exist is that the two directions
// are different quantities (SPEC §1: the accept is made by the target, so
// sim_b is the interesting one), so a fixture that cannot tell them apart
// would test the wrong thing convincingly.
//
// vi.mock is hoisted above imports, so the factory is self-contained: it
// parses the angle out of the text instead of reading a shared constant.
vi.mock('@/lib/embeddings', () => ({
  embed: async (texts: string[]) =>
    texts.map((t) => {
      const deg = Number(/ANGLE:(-?\d+(?:\.\d+)?)/.exec(t)?.[1] ?? 0);
      const rad = (deg * Math.PI) / 180;
      const v = Array.from({ length: 1024 }, () => 0);
      v[0] = Math.cos(rad);
      v[1] = Math.sin(rad);
      return v;
    }),
  embeddingProviderName: 'test-stub-angular',
}));

import { POST as createUser } from '@/app/api/v1/users/route';
import { POST as updateProfile } from '@/app/api/v1/profile/route';
import {
  GET as listConnections,
  POST as createConnection,
} from '@/app/api/v1/connections/route';
import { POST as respondToConnection } from '@/app/api/v1/connections/[id]/respond/route';
import { GET as getGraph } from '@/app/api/v1/graph/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { cleanupRun, testHandle } from './helpers/testData';

// 007_match_telemetry.sql: a connection records the PARTS its score was built
// from, not just the total, so w1 / w2 can be fitted from accept outcomes
// later (SPEC §1). `match_score` alone is (w1·sim_a + w2·sim_b)·geo — two
// weights already collapsed into one float, which cannot be pulled apart
// again. These tests pin down that the parts are stored, that they are stored
// in the right DIRECTION, and that they still reconstruct the total.

const BASE = 'http://test.local';

// Angles chosen so the two directional similarities are far apart and neither
// is 0 or 1 — a swapped pair is then unmistakable rather than a rounding
// difference.
const ANGLE = {
  requesterSelf: 0,
  requesterSeeking: 30,
  targetSelf: 40,
  targetSeeking: 80,
} as const;

// sim_a = cos(requester.seeking, target.self); sim_b = cos(target.seeking, requester.self).
const EXPECTED_SIM_A = Math.cos(((ANGLE.requesterSeeking - ANGLE.targetSelf) * Math.PI) / 180);
const EXPECTED_SIM_B = Math.cos(((ANGLE.targetSeeking - ANGLE.requesterSelf) * Math.PI) / 180);

interface Party {
  userId: string;
  apiKey: string;
  handle: string;
}

interface TelemetryRow {
  status: string;
  match_score: number | null;
  sim_a: number | null;
  sim_b: number | null;
  geo_factor: number | null;
  w1: number | null;
  w2: number | null;
  responder_kind: string | null;
}

const bearer = (party: Party) => ({ authorization: `Bearer ${party.apiKey}` });

const jsonBody = (headers: Record<string, string>, body: unknown) => ({
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const register = async (name: string, selfDeg: number, seekingDeg: number): Promise<Party> => {
  const handle = testHandle(name);
  const res = await createUser(
    new Request(
      `${BASE}/v1/users`,
      // Both parties sit at the same coordinates, so geo decay is 1.0 by
      // distance regardless of whether MATCH_HALF_LIFE_KM is configured —
      // the reconstruction check then holds either way.
      jsonBody({}, { handle, contact: { email: `${handle}@telemetry.invalid` }, lat: 31.23, lng: 121.47 }),
    ),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user_id: string; api_key: string };

  const profile = await updateProfile(
    new Request(
      `${BASE}/v1/profile`,
      jsonBody({ authorization: `Bearer ${body.api_key}` }, {
        self: `fixture ${name} self ANGLE:${selfDeg}`,
        seeking: `fixture ${name} seeking ANGLE:${seekingDeg}`,
      }),
    ),
  );
  expect(profile.status).toBe(200);

  return { userId: body.user_id, apiKey: body.api_key, handle };
};

/** Requester a → target b, left pending. */
const openRequest = async (label: string) => {
  const a = await register(`${label}_a`, ANGLE.requesterSelf, ANGLE.requesterSeeking);
  const b = await register(`${label}_b`, ANGLE.targetSelf, ANGLE.targetSeeking);

  const res = await createConnection(
    new Request(`${BASE}/v1/connections`, jsonBody(bearer(a), { target_id: b.userId })),
  );
  expect(res.status).toBe(201);
  const { connection } = (await res.json()) as { connection: { id: string } };
  return { a, b, connectionId: connection.id };
};

const respond = async (
  party: Party,
  connectionId: string,
  body: Record<string, unknown>,
): Promise<Response> =>
  respondToConnection(
    new Request(`${BASE}/v1/connections/${connectionId}/respond`, jsonBody(bearer(party), body)),
    { params: Promise.resolve({ id: connectionId }) },
  );

/** Read the stored row directly — these columns are deliberately not on any API. */
const storedRow = async (connectionId: string): Promise<TelemetryRow> => {
  const db = createAdminClient();
  const { data, error } = await db
    .from('connections')
    .select('status, match_score, sim_a, sim_b, geo_factor, w1, w2, responder_kind')
    .eq('id', connectionId)
    .single();
  if (error) throw error;
  return data as TelemetryRow;
};

let scored: Awaited<ReturnType<typeof openRequest>>;
let declaredHuman: Awaited<ReturnType<typeof openRequest>>;
let declaredAgent: Awaited<ReturnType<typeof openRequest>>;
let undeclared: Awaited<ReturnType<typeof openRequest>>;
let rejected: Awaited<ReturnType<typeof openRequest>>;

beforeAll(async () => {
  scored = await openRequest('scored');

  declaredHuman = await openRequest('human');
  expect((await respond(declaredHuman.b, declaredHuman.connectionId, { action: 'accept', responder: 'human' })).status).toBe(200);

  declaredAgent = await openRequest('agent');
  expect((await respond(declaredAgent.b, declaredAgent.connectionId, { action: 'decline', responder: 'agent' })).status).toBe(200);

  undeclared = await openRequest('undeclared');
  expect((await respond(undeclared.b, undeclared.connectionId, { action: 'accept' })).status).toBe(200);

  rejected = await openRequest('rejected');
}, 90_000);

afterAll(async () => {
  await cleanupRun();
});

describe('score components recorded on the edge', () => {
  it('stores both similarities, the geo factor and the weights in effect', async () => {
    const row = await storedRow(scored.connectionId);

    for (const [field, value] of Object.entries({
      sim_a: row.sim_a,
      sim_b: row.sim_b,
      geo_factor: row.geo_factor,
      w1: row.w1,
      w2: row.w2,
      match_score: row.match_score,
    })) {
      expect(typeof value, `${field} should be a number`).toBe('number');
    }
  });

  it('records each similarity in its own direction', async () => {
    const row = await storedRow(scored.connectionId);

    // The assertion that a swapped pair fails: these two differ by ~0.81, so
    // sim_a landing on sim_b's value is not a rounding artefact.
    expect(row.sim_a!).toBeCloseTo(EXPECTED_SIM_A, 5);
    expect(row.sim_b!).toBeCloseTo(EXPECTED_SIM_B, 5);
    expect(Math.abs(row.sim_a! - row.sim_b!)).toBeGreaterThan(0.5);
  });

  it('reconstructs match_score from the stored parts', async () => {
    const row = await storedRow(scored.connectionId);

    // If this drifts, the recorded parts no longer explain the recorded
    // total, and any weight fitted from them describes a ranking that was
    // never actually served.
    const rebuilt = (row.w1! * row.sim_a! + row.w2! * row.sim_b!) * row.geo_factor!;
    expect(Math.abs(rebuilt - row.match_score!)).toBeLessThan(1e-9);
  });
});

describe('responder kind (SPEC §8.2 still open)', () => {
  it('records a declared human responder', async () => {
    const row = await storedRow(declaredHuman.connectionId);
    expect(row.status).toBe('accepted');
    expect(row.responder_kind).toBe('human');
  });

  it('records a declared agent responder', async () => {
    const row = await storedRow(declaredAgent.connectionId);
    expect(row.status).toBe('declined');
    expect(row.responder_kind).toBe('agent');
  });

  it('leaves the kind null when the caller does not declare one', async () => {
    // Undeclared is a third state, distinct from both 'human' and 'agent'.
    // Defaulting it either way would invent a population that was never
    // measured — precisely the contamination the column exists to prevent.
    const row = await storedRow(undeclared.connectionId);
    expect(row.status).toBe('accepted');
    expect(row.responder_kind).toBeNull();
  });

  it('rejects an unknown kind without touching the connection', async () => {
    const res = await respond(rejected.b, rejected.connectionId, {
      action: 'accept',
      responder: 'robot',
    });
    expect(res.status).toBe(400);

    // Validation has to happen BEFORE the state change: a request that is
    // refused must not still have accepted the connection.
    const row = await storedRow(rejected.connectionId);
    expect(row.status).toBe('pending');
    expect(row.responder_kind).toBeNull();
  });
});

describe('telemetry stays off the wire', () => {
  const TELEMETRY_FIELDS = ['sim_a', 'sim_b', 'geo_factor', 'w1', 'w2', 'responder_kind'];

  it('is absent from GET /v1/connections', async () => {
    const res = await listConnections(
      new Request(`${BASE}/v1/connections`, { headers: bearer(scored.a) }),
    );
    expect(res.status).toBe(200);
    const body = (await res.json()) as { connections: Record<string, unknown>[] };

    const row = body.connections.find((c) => c.id === scored.connectionId);
    expect(row, 'the connection under test should be listed').toBeDefined();
    for (const field of TELEMETRY_FIELDS) {
      expect(Object.keys(row!)).not.toContain(field);
    }
  });

  it('carries no score of any kind in GET /v1/graph', async () => {
    // The hard rule (SPEC §3): scores are agent-only instrumentation, and the
    // graph is what the human map renders. match_score is checked alongside
    // the new columns because the map reads this endpoint directly.
    const res = await getGraph(new Request(`${BASE}/v1/graph`, { headers: bearer(scored.a) }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };

    expect(body.nodes.length).toBeGreaterThan(0);
    const raw = JSON.stringify(body);
    for (const field of [...TELEMETRY_FIELDS, 'match_score']) {
      expect(raw, `${field} must not reach the human map`).not.toContain(field);
    }
  });
});
