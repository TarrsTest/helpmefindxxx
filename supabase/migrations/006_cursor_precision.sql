-- Fix duplicate rows at every /v1/recommendations page boundary.
--
-- The keyset cursor is the composite (score, user_id), so paging works by
-- asking for `score < cursor_score OR (score = cursor_score AND user_id <
-- cursor_id)`. That equality never held: the score leaves Postgres as a
-- float8, gets serialised to JSON with 15 significant digits, and comes back
-- a hair LARGER than the value the expression recomputes —
--
--   actual float8   0.5603403151035309
--   after JSON      0.560340315103531   (> actual)
--
-- — so the row the cursor pointed at satisfied `score < cursor_score` and was
-- returned again as the first row of the next page. Every page after the
-- first repeated its predecessor's last row.
--
-- Fix: quantise the score to 12 decimal places inside the function. A
-- 12-decimal value below 1.0 has at most 12 significant digits, well inside
-- what JSON serialisation preserves, so the number the client sends back is
-- bit-identical to the one the expression produces and the equality holds.
-- Ordering, the cursor comparison, and the returned value all use the same
-- quantised score, so they can't disagree.
--
-- An epsilon comparison (`abs(score - cursor) < 1e-9`) was the other option
-- and was rejected: it can SKIP a row when two candidates' true scores differ
-- by less than the epsilon but their ids sort the opposite way — trading a
-- duplicate for a silently dropped person.
--
-- Signature is unchanged from 003, so this is a plain create-or-replace.
-- sim_a / sim_b are left raw; they only feed the human-readable reason string.

create or replace function match_recommendations(
  p_user_id uuid,
  p_w1 float,
  p_w2 float,
  p_limit int,
  p_cursor_score float default null,
  p_cursor_id uuid default null,
  p_half_life_km float default null
) returns table(
  user_id uuid, handle text, match_score float, sim_a float, sim_b float
) language sql stable as $$
  with me as (
    select p.self_emb, p.seeking_emb, u.geohash
    from profiles p join users u on u.id = p.user_id
    where p.user_id = p_user_id
  ),
  scored as (
    select
      u.id as user_id,
      u.handle,
      (1 - (me.seeking_emb <=> pr.self_emb))::float as sim_a,
      (1 - (pr.seeking_emb <=> me.self_emb))::float as sim_b,
      round(
        ((p_w1 * (1 - (me.seeking_emb <=> pr.self_emb))
          + p_w2 * (1 - (pr.seeking_emb <=> me.self_emb)))
         * geo_decay(me.geohash, u.geohash, p_half_life_km))::numeric,
        12
      )::float as score
    from profiles pr
    join users u on u.id = pr.user_id
    cross join me
    where pr.user_id <> p_user_id
      and pr.self_emb is not null
      and pr.seeking_emb is not null
      and me.self_emb is not null
      and me.seeking_emb is not null
      and not exists (
        select 1 from connections c
        where (c.requester_id = p_user_id and c.target_id = pr.user_id)
           or (c.requester_id = pr.user_id and c.target_id = p_user_id)
      )
  )
  select user_id, handle, score, sim_a, sim_b
  from scored
  where p_cursor_score is null
     or score < p_cursor_score
     or (score = p_cursor_score and user_id < p_cursor_id)
  order by score desc, user_id desc
  limit p_limit;
$$;
