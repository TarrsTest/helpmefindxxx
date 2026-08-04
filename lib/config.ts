// Tunables for the social graph. SPEC §1 sets w1 = w2 = 0.5 for v0
// ("之后按实际建联成功率反向调权重"). Everything else is a sensible v0
// default, overridable by env without touching business code.

export const MATCH_W1 = Number(process.env.MATCH_W1 ?? 0.5);
export const MATCH_W2 = Number(process.env.MATCH_W2 ?? 0.5);

// Distance decay (SPEC §1: score × distance_decay(loc)). Half-life in km —
// the score halves for every this-many km between two users. Unset/empty
// → location is ignored (neutral factor 1.0), so matching stays purely
// semantic until an operator opts in. Users without a geohash are never
// penalised either way (see geo_decay in 003_distance_decay.sql).
export const MATCH_HALF_LIFE_KM = process.env.MATCH_HALF_LIFE_KM
  ? Number(process.env.MATCH_HALF_LIFE_KM)
  : null;

// Relative cutoff for /v1/recommendations. A candidate is dropped when it
// scores more than this far below the best match in the result set. It is
// RELATIVE because absolute scores aren't meaningful: unrelated people still
// score ~0.6 (see 005_score_baseline.sql), and the floor moves if the
// embedding provider changes — but the *gap* between two scores in one
// result set is comparable either way.
// Set to 0 (or a negative number) to return the full ranked list.
//
// Re-validated 2026-08-04 on the 18-profile ground-truth population
// (`node scripts/validate-cutoff.mjs`, w1 = w2 = 0.5). The true counterpart
// ranked #1 for 10/10 probands, standing 0.1201-0.2452 above the best
// impostor — reproducing the 0.12-0.24 range the original 2026-07-28 figure
// came from, on an independent ground-truth set.
//
// KEPT AT 0.15 rather than tightened, deliberately. 0.15 sits INSIDE that
// separation range, so on the two lowest-separation probands a stranger or
// two rides along with the real match: a match page averages 2.6 rows at
// 0.15 versus 1.0 at any cutoff below 0.1201. Tightening to ~0.12 would
// isolate the true match perfectly on this dataset — and that is exactly why
// it isn't done. Every proband here has exactly ONE counterpart and it always
// ranked first, so this population is structurally unable to show what a
// tight cutoff costs when someone has two plausible matches or the real one
// lands at rank 2. Dropping a genuine match is a worse failure than showing
// one extra stranger the agent can rank past, so the cutoff keeps its
// headroom until a population with multi-counterpart people can measure it.
//
// What the measurement DOES pin down: noise pages stay full (17 rows) at
// every cutoff at or above 0.08, while match pages stay short. Page length
// is therefore itself a signal, and that property holds across the range —
// it is not what the exact value is buying.
export const MATCH_RELATIVE_CUTOFF = Number(
  process.env.MATCH_RELATIVE_CUTOFF ?? 0.15,
);

// How many random profiles to score for the calibration baseline returned
// with each recommendations page. Bigger = steadier baseline, more work per
// request; the pool is scored in one RPC, so this is one extra query either
// way. Set to 0 to skip the baseline entirely.
//
// STILL UNVALIDATED, and not validatable yet — stated plainly so nobody
// mistakes it for a measured number. `score_baseline` takes `limit
// <sample>` over the whole profiles table, so once the sample reaches the
// pool size it is scoring everyone and further increases change nothing.
// Measured 2026-08-04 against the 18-profile dev pool:
//
//   requested   5      10      18      50     200
//   actual      5      10      17      17      17
//   baseline    0.5488 0.5328  0.5223  0.5223  0.5223
//   stddev      0.0705 0.0545  0.0448  0.0448  0.0448
//
// 18, 50 and 200 are the same measurement. Whether 50 is the right number
// is a question about how fast the baseline converges in a pool of
// thousands, and it cannot be answered by a pool of 18 — it needs a filler
// population several times larger than the sample, which costs one
// embedding call per profile. Until then 50 is a guess that is cheap and
// has not misbehaved, not a validated default.
export const MATCH_BASELINE_SAMPLE = Number(
  process.env.MATCH_BASELINE_SAMPLE ?? 50,
);

// Per-key rate limit (SPEC §7.2): requests per window.
export const RATE_LIMIT = Number(process.env.RATE_LIMIT ?? 60);
export const RATE_WINDOW_SECONDS = Number(process.env.RATE_WINDOW_SECONDS ?? 60);

// Pending connections auto-expire after this many days (SPEC §4).
export const CONNECTION_EXPIRY_DAYS = Number(
  process.env.CONNECTION_EXPIRY_DAYS ?? 7,
);

// Embedding dimensionality — must match vector(1024) in the migration.
export const EMBEDDING_DIM = 1024;
