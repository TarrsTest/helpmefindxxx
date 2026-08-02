import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Stubbed so /v1/profile never calls a real provider: this group needs
// profiles to EXIST (recommendations only returns users who have embeddings),
// not to be semantically meaningful. Every text maps to the same unit vector,
// so every pair scores 1.0 and the relative cutoff keeps them all — which
// makes the recommendations leak check non-vacuous. 1024 = EMBEDDING_DIM;
// vi.mock is hoisted above imports, so it cannot reference lib/config.
vi.mock('@/lib/embeddings', () => ({
  embed: async (texts: string[]) =>
    texts.map(() => Array.from({ length: 1024 }, (_, i) => (i === 0 ? 1 : 0))),
  embeddingProviderName: 'test-stub',
}));

import { POST as createUser } from '@/app/api/v1/users/route';
import { POST as updateProfile } from '@/app/api/v1/profile/route';
import {
  GET as listConnections,
  POST as createConnection,
} from '@/app/api/v1/connections/route';
import { POST as respondToConnection } from '@/app/api/v1/connections/[id]/respond/route';
import { GET as getRecommendations } from '@/app/api/v1/recommendations/route';
import { GET as getGraph } from '@/app/api/v1/graph/route';
import { createAdminClient } from '@/lib/supabase/admin';
import { cleanupRun, testHandle } from './helpers/testData';

// Contact gating (SPEC §4 / §7.3): contact details are exchanged ONLY after a
// mutual accept. Every other state — pending, declined, expired — must hide
// them from BOTH sides, and the two read-heavy endpoints (recommendations,
// graph) must never carry contact at all.
//
// Every test user's contact is an address at CONTACT_MARKER, a domain that
// appears nowhere else in the system. That turns "did contact leak?" into a
// substring check over the whole serialised response, which catches a leak
// through ANY field — not just the one named `contact`. The accepted case
// asserts the marker DOES appear, so the negative checks can't pass simply
// because the marker never shows up anywhere.

const BASE = 'http://test.local';
const CONTACT_MARKER = 'contact-probe.invalid';

interface Party {
  userId: string;
  apiKey: string;
  handle: string;
  contactEmail: string;
}

interface Pair {
  a: Party; // requester
  b: Party; // target
  connectionId: string;
}

const bearer = (party: Party) => ({ authorization: `Bearer ${party.apiKey}` });

const jsonBody = (headers: Record<string, string>, body: unknown) => ({
  method: 'POST',
  headers: { ...headers, 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

const register = async (name: string): Promise<Party> => {
  const handle = testHandle(name);
  const contactEmail = `${handle}@${CONTACT_MARKER}`;
  const res = await createUser(
    new Request(
      `${BASE}/v1/users`,
      jsonBody(
        {},
        {
          handle,
          contact: { email: contactEmail },
          // A geohash is required to appear as a graph node (lib/graph.ts
          // filters nodes without one), so the graph leak check has data.
          lat: 31.23,
          lng: 121.47,
        },
      ),
    ),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user_id: string; api_key: string };

  const profile = await updateProfile(
    new Request(
      `${BASE}/v1/profile`,
      jsonBody({ authorization: `Bearer ${body.api_key}` }, {
        self: `test fixture ${name}`,
        seeking: `test fixture counterpart for ${name}`,
      }),
    ),
  );
  expect(profile.status).toBe(200);

  return { userId: body.user_id, apiKey: body.api_key, handle, contactEmail };
};

/** Register two users and open a pending request from a → b. */
const makePair = async (label: string): Promise<Pair> => {
  const a = await register(`${label}_a`);
  const b = await register(`${label}_b`);

  const res = await createConnection(
    new Request(`${BASE}/v1/connections`, jsonBody(bearer(a), { target_id: b.userId })),
  );
  expect(res.status).toBe(201);
  const { connection } = (await res.json()) as { connection: { id: string } };

  return { a, b, connectionId: connection.id };
};

const respond = async (party: Party, connectionId: string, action: string) => {
  const res = await respondToConnection(
    new Request(
      `${BASE}/v1/connections/${connectionId}/respond`,
      jsonBody(bearer(party), { action }),
    ),
    { params: Promise.resolve({ id: connectionId }) },
  );
  expect(res.status).toBe(200);
  return (await res.json()) as { status: string; contact: unknown };
};

/** One connection as a given party sees it, plus the whole raw response. */
const seenBy = async (party: Party, connectionId: string) => {
  const res = await listConnections(
    new Request(`${BASE}/v1/connections`, { headers: bearer(party) }),
  );
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    connections: { id: string; status: string; contact: unknown }[];
  };
  const row = body.connections.find((c) => c.id === connectionId);
  expect(row, `connection ${connectionId} missing from ${party.handle}'s list`).toBeDefined();
  return { row: row!, raw: JSON.stringify(body) };
};

let pending: Pair;
let declined: Pair;
let accepted: Pair;
let expired: Pair;
let acceptResponse: { status: string; contact: unknown };

beforeAll(async () => {
  pending = await makePair('pending');

  declined = await makePair('declined');
  await respond(declined.b, declined.connectionId, 'decline');

  accepted = await makePair('accepted');
  acceptResponse = await respond(accepted.b, accepted.connectionId, 'accept');

  expired = await makePair('expired');
  // Set the terminal state directly, scoped to this one row. The real
  // transition is expire_stale_connections(), but that sweeps EVERY pending
  // row older than the cutoff — running it here would expire connections
  // belonging to other people using this shared database.
  const db = createAdminClient();
  const { error } = await db
    .from('connections')
    .update({ status: 'expired' })
    .eq('id', expired.connectionId);
  if (error) throw error;
}, 60_000);

afterAll(async () => {
  await cleanupRun();
});

describe('contact gate by connection state', () => {
  it('hides contact from both parties while pending', async () => {
    const asRequester = await seenBy(pending.a, pending.connectionId);
    expect(asRequester.row.status).toBe('pending');
    expect(asRequester.row.contact).toBeNull();
    expect(asRequester.raw).not.toContain(CONTACT_MARKER);

    const asTarget = await seenBy(pending.b, pending.connectionId);
    expect(asTarget.row.status).toBe('pending');
    expect(asTarget.row.contact).toBeNull();
    expect(asTarget.raw).not.toContain(CONTACT_MARKER);
  });

  it('hides contact from both parties after a decline', async () => {
    const asRequester = await seenBy(declined.a, declined.connectionId);
    expect(asRequester.row.status).toBe('declined');
    expect(asRequester.row.contact).toBeNull();
    expect(asRequester.raw).not.toContain(CONTACT_MARKER);

    const asTarget = await seenBy(declined.b, declined.connectionId);
    expect(asTarget.row.status).toBe('declined');
    expect(asTarget.row.contact).toBeNull();
    expect(asTarget.raw).not.toContain(CONTACT_MARKER);
  });

  it('hides contact from both parties once expired', async () => {
    const asRequester = await seenBy(expired.a, expired.connectionId);
    expect(asRequester.row.status).toBe('expired');
    expect(asRequester.row.contact).toBeNull();
    expect(asRequester.raw).not.toContain(CONTACT_MARKER);

    const asTarget = await seenBy(expired.b, expired.connectionId);
    expect(asTarget.row.status).toBe('expired');
    expect(asTarget.row.contact).toBeNull();
    expect(asTarget.raw).not.toContain(CONTACT_MARKER);
  });

  it('gives each party the other side contact after a mutual accept', async () => {
    // Positive control for every `not.toContain(CONTACT_MARKER)` above: the
    // marker is reachable, so those assertions are testing the gate rather
    // than a value that is simply never returned.
    const asRequester = await seenBy(accepted.a, accepted.connectionId);
    expect(asRequester.row.status).toBe('accepted');
    expect(asRequester.row.contact).toEqual({ email: accepted.b.contactEmail });

    const asTarget = await seenBy(accepted.b, accepted.connectionId);
    expect(asTarget.row.status).toBe('accepted');
    expect(asTarget.row.contact).toEqual({ email: accepted.a.contactEmail });
  });

  it('returns the requester contact in the accept response itself', async () => {
    expect(acceptResponse.status).toBe('accepted');
    expect(acceptResponse.contact).toEqual({ email: accepted.a.contactEmail });
  });
});

describe('incidental leak paths', () => {
  it('never carries contact in GET /v1/recommendations', async () => {
    const res = await getRecommendations(
      new Request(`${BASE}/v1/recommendations`, { headers: bearer(pending.a) }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as {
      recommendations: Record<string, unknown>[];
    };

    // Non-vacuous: there are candidates to leak through in the first place.
    expect(body.recommendations.length).toBeGreaterThan(0);
    for (const rec of body.recommendations) {
      expect(Object.keys(rec)).not.toContain('contact');
    }
    expect(JSON.stringify(body)).not.toContain(CONTACT_MARKER);
  });

  it('never carries contact in GET /v1/graph', async () => {
    const res = await getGraph(
      new Request(`${BASE}/v1/graph`, { headers: bearer(pending.a) }),
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { nodes: Record<string, unknown>[] };

    expect(body.nodes.length).toBeGreaterThan(0);
    for (const node of body.nodes) {
      expect(Object.keys(node)).not.toContain('contact');
    }
    expect(JSON.stringify(body)).not.toContain(CONTACT_MARKER);
  });
});
