import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

// Deterministic stub vectors, built inside the factory because vi.mock is
// hoisted above every import and cannot reach module scope.
//
// Shape matters here. Each vector is `e0 + small noise`, so:
//   - any two fixture users score ~0.82 with a spread in the third decimal —
//     distinct, strictly orderable, and (crucially) full-mantissa floats, the
//     kind that exposed the cursor precision bug 006 fixes;
//   - anyone else in this shared database sits near 0 against a vector like
//     this, so the relative cutoff leaves the result set as exactly the
//     fixture population. That isolation is what lets these tests assert "no
//     omission" without counting rows that belong to other people.
vi.mock('@/lib/embeddings', () => {
  const seedOf = (text: string): number => {
    let h = 2166136261;
    for (let i = 0; i < text.length; i += 1) {
      h = Math.imul(h ^ text.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  };

  const vectorFor = (text: string): number[] => {
    let seed = seedOf(text);
    const next = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 2 ** 32;
    };
    // 1024 = EMBEDDING_DIM.
    return Array.from({ length: 1024 }, (_, i) =>
      (i === 0 ? 1 : 0) + 0.05 * (next() - 0.5),
    );
  };

  return {
    embed: async (texts: string[]) => texts.map(vectorFor),
    embeddingProviderName: 'test-stub',
  };
});

import { POST as createUser } from '@/app/api/v1/users/route';
import { POST as updateProfile } from '@/app/api/v1/profile/route';
import { GET as getRecommendations } from '@/app/api/v1/recommendations/route';
import { cleanupRun, testHandle } from './helpers/testData';

// Cursor pagination of GET /v1/recommendations (SPEC §3) plus the relative
// cutoff's anchor (docs/TESTING.md, migration 006).
//
// Every assertion here is about CONTRACT, never about a particular score.
// Absolute scores depend on the embedding provider, on the vectors, and — for
// calibration.baseline — on whoever else happens to be in this shared
// database. Hard-coding numbers would fail while the contract still holds.
// Where scores appear it is only relationally: "this one is >= that one".

const BASE = 'http://test.local';
const POPULATION = 8; // 1 requester + 7 candidates
const PAGE_SIZE = 1; // one row per page = 7 cursor boundaries to get wrong

interface Party {
  userId: string;
  apiKey: string;
  handle: string;
}

interface Page {
  recommendations: { user_id: string; handle: string; match_score: number }[];
  calibration: { top_score: number | null; cutoff: number | null };
  next_cursor: string | null;
}

const register = async (name: string): Promise<Party> => {
  const handle = testHandle(name);
  const res = await createUser(
    new Request(`${BASE}/v1/users`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle }),
    }),
  );
  expect(res.status).toBe(201);
  const body = (await res.json()) as { user_id: string; api_key: string };

  const profile = await updateProfile(
    new Request(`${BASE}/v1/profile`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${body.api_key}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ self: `fixture ${handle}`, seeking: `fixture ${handle}` }),
    }),
  );
  expect(profile.status).toBe(200);

  return { userId: body.user_id, apiKey: body.api_key, handle };
};

const fetchPage = async (party: Party, limit: number, cursor?: string): Promise<Page> => {
  const url = new URL(`${BASE}/v1/recommendations`);
  url.searchParams.set('limit', String(limit));
  if (cursor) url.searchParams.set('cursor', cursor);

  const res = await getRecommendations(
    new Request(url, { headers: { authorization: `Bearer ${party.apiKey}` } }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Page;
};

/**
 * Walk the cursor to exhaustion, bounded so a cursor that never advances
 * can't hang the suite. It REPORTS non-termination rather than throwing:
 * throwing here would abort beforeAll and skip every test, hiding which
 * contract actually broke. A stuck cursor is itself one of the assertions.
 */
const walkAllPages = async (
  party: Party,
  limit: number,
): Promise<{ pages: Page[]; terminated: boolean }> => {
  const pages: Page[] = [];
  let cursor: string | undefined;

  for (let i = 0; i < POPULATION * 3; i += 1) {
    const page = await fetchPage(party, limit, cursor);
    pages.push(page);
    if (!page.next_cursor) return { pages, terminated: true };
    cursor = page.next_cursor;
  }

  return { pages, terminated: false };
};

const idsOf = (pages: Page[]): string[] =>
  pages.flatMap((p) => p.recommendations.map((r) => r.user_id));

const scoresOf = (pages: Page[]): number[] =>
  pages.flatMap((p) => p.recommendations.map((r) => r.match_score));

let requester: Party;
let candidateIds: string[];
let pages: Page[];
let terminated: boolean;

beforeAll(async () => {
  const people: Party[] = [];
  for (let i = 0; i < POPULATION; i += 1) {
    // Serial on purpose: each registration is two round trips to the shared
    // database, and the suite is not trying to load-test it.
    people.push(await register(`page_${i}`));
  }

  requester = people[0];
  candidateIds = people.slice(1).map((p) => p.userId);

  ({ pages, terminated } = await walkAllPages(requester, PAGE_SIZE));
}, 120_000);

afterAll(async () => {
  await cleanupRun();
});

describe('cursor pagination', () => {
  it('advances the cursor until it runs out of rows', () => {
    // A cursor that keeps handing back a row it already returned never
    // reaches the end. Asserted separately so the duplicate check below still
    // runs (and points at the real defect) when this one fails.
    expect(terminated).toBe(true);
  });

  it('returns no duplicate user_id across pages', () => {
    // Regression for migration 006. Before it, the score round-tripped
    // through JSON at 15 significant digits and came back marginally LARGER
    // than the value the SQL expression recomputed, so `score < cursor_score`
    // matched the boundary row and every page repeated its predecessor's last
    // row. PAGE_SIZE of 1 puts a boundary at every single row.
    const ids = idsOf(pages);

    expect(ids).toHaveLength(new Set(ids).size);
  });

  it('omits nobody across pages', () => {
    const ids = new Set(idsOf(pages));

    for (const id of candidateIds) {
      expect(ids.has(id)).toBe(true);
    }
  });

  it('paginates the same result set an unpaginated request returns', async () => {
    // The strongest statement of both properties at once: paging is a
    // partition of the single-page answer, in the same order. Independent of
    // how many rows there are or who else is in the database.
    const single = await fetchPage(requester, 50);

    expect(single.next_cursor).toBeNull();
    expect(idsOf(pages)).toEqual(idsOf([single]));
  });

  it('orders results by descending score', () => {
    const scores = scoresOf(pages);

    expect(scores.length).toBeGreaterThan(1);
    for (let i = 1; i < scores.length; i += 1) {
      expect(scores[i]).toBeLessThanOrEqual(scores[i - 1]);
    }
  });
});

describe('relative cutoff anchor', () => {
  it('reports the same calibration.top_score on every page', () => {
    expect(pages.length).toBeGreaterThan(1);

    const anchors = pages.map((p) => p.calibration.top_score);
    for (const anchor of anchors) {
      expect(anchor).toBe(anchors[0]);
    }
  });

  it('keeps page 1 as the anchor instead of re-anchoring per page', () => {
    // Each page holds one row, and the rows strictly descend, so a handler
    // that re-anchored would report page N's own (lower) score as top_score.
    // Comparing against page 2's own row is what distinguishes "carried" from
    // "recomputed" — asserting equality with page 1 alone would also pass if
    // every page happened to hold the top row.
    expect(pages.length).toBeGreaterThan(1);

    const firstPageTop = pages[0].recommendations[0].match_score;
    const secondPageOwnTop = pages[1].recommendations[0].match_score;

    expect(secondPageOwnTop).toBeLessThan(firstPageTop);
    expect(pages[1].calibration.top_score).toBe(firstPageTop);
    expect(pages[1].calibration.top_score).not.toBe(secondPageOwnTop);
  });

  it('keeps every returned row within the cutoff of the anchor', () => {
    const cutoff = pages[0].calibration.cutoff;
    const anchor = pages[0].calibration.top_score;

    expect(cutoff).not.toBeNull();
    expect(anchor).not.toBeNull();

    for (const score of scoresOf(pages)) {
      expect(score).toBeGreaterThanOrEqual(anchor! - cutoff!);
    }
  });
});
