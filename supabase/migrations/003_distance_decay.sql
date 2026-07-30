-- Distance decay for matching (SPEC §1: score = w1·sim_a + w2·sim_b, the
-- whole thing × distance_decay(loc)). 002 shipped the embedding half of
-- that formula; this migration adds the geographic half.
--
-- Location stays OPTIONAL and privacy-preserving: the decay is computed
-- server-side from the full-precision `users.geohash` (which never leaves
-- the DB — SPEC §7.1), and when either party has no geohash (or no
-- half-life is configured) the decay is a neutral 1.0, so matching is
-- identical to 002 until an operator opts in via MATCH_HALF_LIFE_KM.
--
-- Idempotent: create-or-replace helpers; drop+recreate the two scoring
-- RPCs because they gain a parameter (a new signature, not an in-place
-- replace).

-- ---------------------------------------------------------------------
-- Geo helpers
-- ---------------------------------------------------------------------

-- Decode a geohash to its cell-center lat/lng. SQL mirror of the JS
-- decodeGeohash in lib/geohash.ts so scoring can use precise coords that
-- never get returned to a caller.
create or replace function geohash_decode(p_hash text)
returns table(lat float, lng float) language plpgsql immutable as $$
declare
  base32  text  := '0123456789bcdefghjkmnpqrstuvwxyz';
  lat_min float := -90;  lat_max float := 90;
  lng_min float := -180; lng_max float := 180;
  even    boolean := true;
  i int; idx int; mask int; mid float;
begin
  if p_hash is null or length(p_hash) = 0 then
    return;                              -- no rows → caller treats as "no loc"
  end if;
  for i in 1..length(p_hash) loop
    idx := position(substr(p_hash, i, 1) in base32) - 1;
    if idx < 0 then continue; end if;    -- skip any stray char
    mask := 16;
    while mask >= 1 loop
      if even then
        mid := (lng_min + lng_max) / 2;
        if (idx & mask) <> 0 then lng_min := mid; else lng_max := mid; end if;
      else
        mid := (lat_min + lat_max) / 2;
        if (idx & mask) <> 0 then lat_min := mid; else lat_max := mid; end if;
      end if;
      even := not even;
      mask := mask >> 1;
    end loop;
  end loop;
  lat := (lat_min + lat_max) / 2;
  lng := (lng_min + lng_max) / 2;
  return next;
end;
$$;

-- Distance decay in (0,1]: 1.0 at zero separation, halving every
-- p_half_life_km. Neutral 1.0 when either geohash is absent or no
-- half-life is set — location is a soft bonus, never a hard filter, and
-- users without a location are never penalised out of results.
create or replace function geo_decay(
  p_hash_a text, p_hash_b text, p_half_life_km float
) returns float language plpgsql immutable as $$
declare
  a record; b record;
  dlat float; dlng float; hav float; dist_km float;
  r float := 6371;                       -- earth radius, km
begin
  if p_half_life_km is null or p_half_life_km <= 0
     or p_hash_a is null or p_hash_b is null
     or length(p_hash_a) = 0 or length(p_hash_b) = 0 then
    return 1.0;
  end if;
  select * into a from geohash_decode(p_hash_a);
  select * into b from geohash_decode(p_hash_b);
  if a is null or b is null then
    return 1.0;
  end if;
  dlat := radians(b.lat - a.lat);
  dlng := radians(b.lng - a.lng);
  hav  := sin(dlat / 2) ^ 2
        + cos(radians(a.lat)) * cos(radians(b.lat)) * sin(dlng / 2) ^ 2;
  dist_km := 2 * r * asin(least(1, sqrt(hav)));
  return power(0.5, dist_km / p_half_life_km);
end;
$$;

-- ---------------------------------------------------------------------
-- Re-declare the scoring RPCs with a distance-decay parameter.
-- ---------------------------------------------------------------------

drop function if exists match_recommendations(uuid, float, float, int, float, uuid);

create function match_recommendations(
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
      ((p_w1 * (1 - (me.seeking_emb <=> pr.self_emb))
        + p_w2 * (1 - (pr.seeking_emb <=> me.self_emb)))
       * geo_decay(me.geohash, u.geohash, p_half_life_km))::float as score
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

drop function if exists pair_score(uuid, uuid, float, float);

create function pair_score(
  p_a uuid, p_b uuid, p_w1 float, p_w2 float, p_half_life_km float default null
) returns float language sql stable as $$
  select ((p_w1 * (1 - (a.seeking_emb <=> b.self_emb))
         + p_w2 * (1 - (b.seeking_emb <=> a.self_emb)))
        * geo_decay(ua.geohash, ub.geohash, p_half_life_km))::float
  from profiles a, profiles b, users ua, users ub
  where a.user_id = p_a and b.user_id = p_b
    and ua.id = p_a and ub.id = p_b
    and a.self_emb is not null and a.seeking_emb is not null
    and b.self_emb is not null and b.seeking_emb is not null;
$$;
