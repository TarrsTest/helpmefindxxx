import { authenticate } from '@/lib/api/auth';
import {
  MATCH_W1,
  MATCH_W2,
  MATCH_HALF_LIFE_KM,
  MATCH_RELATIVE_CUTOFF,
  MATCH_BASELINE_SAMPLE,
} from '@/lib/config';
import { json, handle } from '@/lib/api/http';

// GET /v1/recommendations — bidirectional-scored recommendations, cursor
// paginated (SPEC §3). Cursor is the composite (score, user_id) so pages
// don't drift (SPEC §3). Response carries handle + match_score + reason
// only — NEVER contact (SPEC §3 / §4).
//   ?limit=20&cursor=<opaque>
//
// Two quality controls sit on top of the raw ranking:
//
//   1. RELATIVE CUTOFF — candidates scoring more than MATCH_RELATIVE_CUTOFF
//      below the best match are dropped. Relative, not absolute, because
//      `match_score` has no meaningful zero (see 005_score_baseline.sql).
//   2. CALIBRATION — the response reports how far the best match sits above
//      the score of a random stranger. The cutoff alone can't catch a page
//      where EVERYTHING is irrelevant (relative-to-a-bad-top is still bad),
//      so this gives the caller's agent the basis to judge that itself.
//
// `match_score` stays in the response unrounded, but it is a RANKING signal
// only — not a probability, not a percentage, and not comparable across
// embedding providers. It is deliberately absent from every human-facing
// surface (/map, /v1/graph); agents get it, people don't.

export const runtime = 'nodejs';

// The cursor also carries the anchor — the top score of the FIRST page — so
// the relative cutoff stays measured against the best match overall. Without
// it, page 2 would re-anchor on its own (weaker) top and let back in exactly
// the candidates page 1 was filtering out.
const encodeCursor = (score: number, id: string, anchor: number): string =>
  Buffer.from(`${score}:${id}:${anchor}`).toString('base64url');

const decodeCursor = (
  cursor: string | null,
): { score: number; id: string; anchor: number | null } | null => {
  if (!cursor) return null;
  try {
    const [score, id, anchor] = Buffer.from(cursor, 'base64url')
      .toString('utf8')
      .split(':');
    if (!id || !Number.isFinite(Number(score))) return null;
    return {
      score: Number(score),
      id,
      anchor: Number.isFinite(Number(anchor)) ? Number(anchor) : null,
    };
  } catch {
    return null;
  }
};

const reason = (simA: number, simB: number): string =>
  `They fit what you're seeking (${simA.toFixed(2)}); ` +
  `you fit what they're seeking (${simB.toFixed(2)}).`;

export const GET = (request: Request) =>
  handle(async () => {
    const { db, userId } = await authenticate(request);

    const url = new URL(request.url);
    const limit = Math.min(50, Math.max(1, Number(url.searchParams.get('limit')) || 20));
    const cursor = decodeCursor(url.searchParams.get('cursor'));

    const { data, error } = await db.rpc('match_recommendations', {
      p_user_id: userId,
      p_w1: MATCH_W1,
      p_w2: MATCH_W2,
      p_limit: limit + 1, // fetch one extra to know if there's a next page
      p_cursor_score: cursor?.score ?? null,
      p_cursor_id: cursor?.id ?? null,
      p_half_life_km: MATCH_HALF_LIFE_KM,
    });
    if (error) throw error;

    const rows = (data ?? []) as {
      user_id: string;
      handle: string;
      match_score: number;
      sim_a: number;
      sim_b: number;
    }[];

    // Anchor = best score in the whole result set: carried from page 1 via
    // the cursor, or established here if this IS page 1.
    const anchor = cursor?.anchor ?? rows[0]?.match_score ?? null;

    // Rows arrive ordered by score desc, so the cutoff always removes a
    // suffix — anything after the first drop scores lower still. That also
    // means a truncated page is the last page.
    const cutoffApplies = MATCH_RELATIVE_CUTOFF > 0 && anchor !== null;
    const kept = cutoffApplies
      ? rows.filter((r) => r.match_score >= anchor - MATCH_RELATIVE_CUTOFF)
      : rows;

    const hasMore = kept.length === rows.length && rows.length > limit;
    const page = kept.slice(0, limit);
    const last = page[page.length - 1];

    const { data: baselineRows } = MATCH_BASELINE_SAMPLE > 0
      ? await db.rpc('score_baseline', {
          p_user_id: userId,
          p_w1: MATCH_W1,
          p_w2: MATCH_W2,
          p_sample: MATCH_BASELINE_SAMPLE,
          p_half_life_km: MATCH_HALF_LIFE_KM,
        })
      : { data: null };

    const stats = (baselineRows ?? [])[0] as
      | { sample_size: number; baseline: number | null; baseline_stddev: number | null }
      | undefined;
    const baseline = stats?.baseline ?? null;
    const stddev = stats?.baseline_stddev ?? null;

    return json({
      recommendations: page.map((r) => ({
        user_id: r.user_id,
        handle: r.handle,
        match_score: r.match_score,
        reason: reason(r.sim_a, r.sim_b),
      })),
      // How to read this: `top_margin` is the signal — how much better the
      // best match is than a random stranger. Near zero means this pool has
      // nobody relevant, however many rows came back.
      //
      // Measured 2026-07-28: a genuine counterpart gives margin ~0.18; a
      // person with nobody relevant in the pool gives ~0.035. Deliberately
      // NOT reported as a z-score — when someone is uniformly far from
      // everyone the baseline spread collapses, so (margin / stddev) reads
      // as a confident 1.9 on exactly the noise this is meant to expose.
      // `baseline_stddev` is here for callers who want the spread; it is
      // not a significance test.
      calibration: {
        baseline,
        baseline_stddev: stddev,
        sample_size: stats?.sample_size ?? 0,
        top_score: anchor,
        top_margin: anchor !== null && baseline !== null ? anchor - baseline : null,
        cutoff: cutoffApplies ? MATCH_RELATIVE_CUTOFF : null,
      },
      next_cursor:
        hasMore && last && anchor !== null
          ? encodeCursor(last.match_score, last.user_id, anchor)
          : null,
    });
  });
