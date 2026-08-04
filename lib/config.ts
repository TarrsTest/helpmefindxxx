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
// LOWERED 0.15 → 0.10 on 2026-08-04. THIS VALUE IS POOL-SIZE DEPENDENT, which
// is the most important thing to know about it — see the last paragraph before
// changing it.
//
// Measured with `node scripts/validate-cutoff.mjs` (w1 = w2 = 0.5), first on
// the 18-profile ground-truth cast and then again after scripts/fillers.mjs
// took the pool to 138. The true counterpart ranked #1 for 10/10 probands both
// times, but its distance from the best impostor shrank:
//
//   pool   separation (min-max)   rows on a match page at 0.15
//     18   0.1201 - 0.2452        2.6
//    138   0.0814 - 0.2071        12.1
//
// More strangers means a better best-stranger, so the gap the cutoff has to
// fit inside closes as the pool grows. At 138 people, 0.15 was letting about
// eleven impostors ride along with each real match, and the "short page means
// a real match" property — a match page of 12 against a noise page of 137 —
// had lost most of its contrast. At 0.10 a match page is 1.2 rows against 125.
//
// 0.10 rather than 0.08: 0.08 isolates the counterpart perfectly here, but the
// smallest separation measured was 0.0814, so 0.08 is fitted to the exact edge
// of one sample. 0.10 keeps a margin above that edge while still costing only
// ~0.2 impostor rows per page.
//
// The unmeasured risk is unchanged and still argues against going tighter:
// every proband in this population has exactly ONE counterpart and it always
// ranked first, so nothing here can show what a tight cutoff costs when
// someone has two plausible matches or the real one lands at rank 2. Dropping
// a genuine match is the worse failure.
//
// THE STRUCTURAL POINT: separation fell by a third when the pool grew 8×, and
// there is no reason to expect it to stop. Any fixed constant here is tuned to
// the pool it was measured on and will be wrong at the next order of
// magnitude. The durable fix is to derive the cutoff from something that
// scales with the population — the baseline spread from score_baseline is
// already computed on every request and is the obvious candidate — rather than
// re-deriving this number by hand each time the pool grows. Treat 0.10 as the
// current best fixed value, not as settled.
export const MATCH_RELATIVE_CUTOFF = Number(
  process.env.MATCH_RELATIVE_CUTOFF ?? 0.1,
);

// How many random profiles to score for the calibration baseline returned
// with each recommendations page. Bigger = steadier baseline, more work per
// request; the pool is scored in one RPC, so this is one extra query either
// way. Set to 0 to skip the baseline entirely.
//
// VALIDATED 2026-08-04 at 138 profiles — keep 50.
//
// This could not be measured while the pool was 18: `score_baseline` does
// `limit <sample>`, so every sample size at or above the pool size drew the
// same 17 rows and returned an identical number. scripts/fillers.mjs took the
// pool to 138, which makes 50 a real sample again.
//
// The question is not "what is the baseline" — one call answers that — but
// how far the answer MOVES between calls, since each draws a different sample.
// That spread is the error bar on every top_margin the API reports.
// `node scripts/baseline-convergence.mjs`, 25 repeats per size:
//
//   sample     5       10       25       50      100      137
//   spread  0.0138   0.0078   0.0045   0.0028   0.0016   0.0000
//
// Textbook 1/√n, and the 137 column is saturation (nothing left to draw), not
// accuracy. The distance this number has to resolve is the gap between the
// weakest true match and the strongest noise case, measured at 0.0755 on this
// pool. At a sample of 50 the spread is 27× smaller than that gap; at 100 it
// is 47× for double the work. 50 is comfortably past the point where more
// sampling buys anything worth having.
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
