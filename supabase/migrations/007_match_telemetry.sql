-- Record what a connection was scored on, so w1 / w2 can be fitted from
-- real accept rates instead of staying at the v0 guess (SPEC §1: "之后按
-- 实际建联成功率反向调权重").
--
-- WHY THIS IS NEEDED: `connections.match_score` already stores a number,
-- but it is the COMPOSED score — (w1·sim_a + w2·sim_b) · geo. Two weights
-- collapsed into one float cannot be pulled apart again, so every edge
-- recorded so far is useless for fitting. Storing the raw components makes
-- any candidate (w1, w2) re-scorable after the fact, from data collected
-- once.
--
-- WHY sim_a AND sim_b SEPARATELY, and why this is the interesting question:
-- the accept decision is made by the TARGET, not the requester. sim_b is
-- "the requester fits what the target is seeking" — the target's own
-- interest — while sim_a is the requester's. If accepts turn out to track
-- sim_b more strongly, then w1 = w2 = 0.5 is not merely untuned, it is the
-- wrong shape, and the ranking a requester sees should weight the other
-- person's wants above its own. That hypothesis is untestable without these
-- two columns.
--
-- WHAT THIS DELIBERATELY DOES NOT LOG: impressions. Fitting the full
-- funnel (shown → requested → accepted) would need a row per recommendation
-- served, which is a write on every GET and a standing record of who was
-- shown to whom. SPEC §1 asks for 建联成功率 — accept rate GIVEN a request —
-- and that is exactly what an edge row measures. Note the resulting bias
-- when reading a fit: requests are only ever sent for candidates that
-- already ranked well, so the fitted weights describe how to order the
-- shortlist, not how to separate matches from strangers (top_margin does
-- that job).
--
-- Scores stay agent-only: these columns feed offline fitting, and are not
-- selected by GET /v1/connections, /v1/graph, or /map.

alter table connections
  add column if not exists sim_a          float,
  add column if not exists sim_b          float,
  add column if not exists geo_factor     float,
  add column if not exists w1             float,
  add column if not exists w2             float,
  add column if not exists responder_kind text;

-- Who actually made the accept/decline call. The server cannot observe
-- this — every /v1 request arrives with an api_key, so from here an agent
-- and a human-confirmed agent look identical. The value is therefore
-- SELF-DECLARED by the caller and null when it declines to say.
--
-- Kept deliberately weak (nullable, no default) because SPEC §8.2 — whether
-- an agent may accept unattended — is still open. Whichever way it lands,
-- the two populations stay separable in the data collected meanwhile: if
-- agents may auto-accept, an accept rate pooled across both kinds measures
-- agent policy rather than human preference, and fitting w1 / w2 on it
-- would tune the ranking to a machine's habits. Recording the kind now
-- means that mistake is detectable later instead of baked in.
alter table connections
  drop constraint if exists connections_responder_kind_check;
alter table connections
  add constraint connections_responder_kind_check
  check (responder_kind is null or responder_kind in ('human', 'agent'));

comment on column connections.sim_a is
  'cos(requester.seeking, target.self) at request time — target fits what the requester sought';
comment on column connections.sim_b is
  'cos(target.seeking, requester.self) at request time — requester fits what the target sought';
comment on column connections.geo_factor is
  'distance decay applied at request time; 1.0 when MATCH_HALF_LIFE_KM is unset';
comment on column connections.w1 is 'MATCH_W1 in effect when this edge was scored';
comment on column connections.w2 is 'MATCH_W2 in effect when this edge was scored';
comment on column connections.responder_kind is
  'self-declared human | agent on respond; null = not declared (SPEC §8.2 open)';

-- One RPC returning the score AND its parts, so POST /v1/connections
-- records components and total from a single consistent read. Replaces the
-- two-call shape (pair_score, then nothing else) — pair_score stays for
-- callers that only want the number.
create or replace function pair_scoring(
  p_a uuid,
  p_b uuid,
  p_w1 float,
  p_w2 float,
  p_half_life_km float default null
) returns table(
  match_score float,
  sim_a float,
  sim_b float,
  geo_factor float
) language sql stable as $$
  select
    round(
      ((p_w1 * (1 - (a.seeking_emb <=> b.self_emb))
        + p_w2 * (1 - (b.seeking_emb <=> a.self_emb)))
       * geo_decay(ua.geohash, ub.geohash, p_half_life_km))::numeric,
      12
    )::float                                          as match_score,
    (1 - (a.seeking_emb <=> b.self_emb))::float       as sim_a,
    (1 - (b.seeking_emb <=> a.self_emb))::float       as sim_b,
    geo_decay(ua.geohash, ub.geohash, p_half_life_km) as geo_factor
  from profiles a, profiles b, users ua, users ub
  where a.user_id = p_a and b.user_id = p_b
    and ua.id = p_a and ub.id = p_b
    and a.self_emb is not null and a.seeking_emb is not null
    and b.self_emb is not null and b.seeking_emb is not null;
$$;

-- Backfill edges recorded before these columns existed.
--
-- The components are recomputed from TODAY's embeddings, which are not
-- necessarily the ones the edge was scored against — a profile edited since
-- would give a different answer. So the backfill VERIFIES itself: it only
-- writes where the recomputed total reproduces the stored match_score. A
-- mismatch means the embeddings moved, and those rows keep their nulls
-- rather than gaining plausible-looking numbers that never happened.
--
-- Weights are assumed to be the v0 0.5 / 0.5, which is what every edge so
-- far was scored under; if that were wrong the totals would not reconcile
-- and the row would be skipped anyway.
with recomputed as (
  select
    c.id,
    c.match_score as stored,
    s.match_score as recalc,
    s.sim_a,
    s.sim_b,
    s.geo_factor
  from connections c
  cross join lateral pair_scoring(c.requester_id, c.target_id, 0.5, 0.5, null) s
  where c.match_score is not null
    and c.sim_a is null
)
update connections c
   set sim_a = r.sim_a,
       sim_b = r.sim_b,
       geo_factor = r.geo_factor,
       w1 = 0.5,
       w2 = 0.5
  from recomputed r
 where c.id = r.id
   and abs(r.stored - r.recalc) < 1e-9;
