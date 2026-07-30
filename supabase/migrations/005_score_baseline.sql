-- Calibration baseline for /v1/recommendations.
--
-- WHY: cosine similarity from a modern embedding model has a high floor —
-- two people with nothing in common still score ~0.57-0.62 (measured on
-- gemini-embedding-001, 2026-07-28). So `match_score` is a RANKING signal,
-- not a probability, and no absolute threshold ("show matches above 0.7")
-- is meaningful or portable across providers.
--
-- The relative cutoff in the route handler drops candidates that sit far
-- below the best match in a result set — but it cannot tell an agent that
-- the WHOLE set is irrelevant, because "far below the top" says nothing
-- when the top itself is noise. That's what this RPC is for: it scores the
-- requester against a random sample of profiles, giving the mean score of
-- "a stranger". The route returns it so an agent can compare its best match
-- against chance and decide for itself whether anything here is worth a
-- connection request.
--
-- Scoring is deliberately identical to match_recommendations (same weights,
-- same geo decay) so the two numbers live in the same space and can be
-- subtracted. Unlike match_recommendations this does NOT exclude people the
-- requester is already connected to — the baseline should represent a
-- random person, not a random person they haven't met.

create or replace function score_baseline(
  p_user_id uuid,
  p_w1 float,
  p_w2 float,
  p_sample int default 50,
  p_half_life_km float default null
) returns table(
  sample_size int,
  baseline float,
  baseline_stddev float
) language sql stable as $$
  with me as (
    select p.self_emb, p.seeking_emb, u.geohash
    from profiles p
    join users u on u.id = p.user_id
    where p.user_id = p_user_id
      and p.self_emb is not null
      and p.seeking_emb is not null
  ),
  -- `order by random()` is a full scan + sort. Fine at v0 scale (and exact
  -- when the pool is smaller than p_sample, which is the case early on).
  -- Swap for `tablesample system` if the profiles table ever gets large.
  sampled as (
    select pr.self_emb, pr.seeking_emb, u.geohash
    from profiles pr
    join users u on u.id = pr.user_id
    where pr.user_id <> p_user_id
      and pr.self_emb is not null
      and pr.seeking_emb is not null
    order by random()
    limit greatest(coalesce(p_sample, 0), 0)
  ),
  scored as (
    select
      ((p_w1 * (1 - (me.seeking_emb <=> s.self_emb))
        + p_w2 * (1 - (s.seeking_emb <=> me.self_emb)))
       * geo_decay(me.geohash, s.geohash, p_half_life_km))::float as score
    from sampled s
    cross join me
  )
  -- No profile for the requester → `me` is empty → 0 rows, null baseline.
  select count(*)::int, avg(score)::float, stddev_pop(score)::float
  from scored;
$$;
