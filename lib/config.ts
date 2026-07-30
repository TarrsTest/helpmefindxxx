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
// result set is comparable either way. Default 0.15 comes from the 2026-07-28
// probe: intended matches sat 0.12-0.24 above the best unrelated candidate.
// Set to 0 (or a negative number) to return the full ranked list.
export const MATCH_RELATIVE_CUTOFF = Number(
  process.env.MATCH_RELATIVE_CUTOFF ?? 0.15,
);

// How many random profiles to score for the calibration baseline returned
// with each recommendations page. Bigger = steadier baseline, more work per
// request; the pool is scored in one RPC, so this is one extra query either
// way. Set to 0 to skip the baseline entirely.
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
