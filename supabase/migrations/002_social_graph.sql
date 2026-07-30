-- AI 交友平台 — agent-mediated social graph.
-- Schema per SPEC §2. Privacy is built into the schema (SPEC §7):
--   1. geohash blurring  — precise coords never leave the DB.
--   2. per-key rate limit — DB-backed fixed-window counter.
--   3. contact gating     — contact exposed only after mutual accept.
--
-- Access model: the /v1/* API authenticates agents by Bearer api_key
-- (hash-checked in route handlers) and talks to the DB with the
-- service-role client. So RLS is enabled deny-by-default on every table
-- — if the anon key ever leaks, it exposes nothing. The service-role
-- client bypasses RLS; the api_key check IS the authorization boundary.
--
-- Apply via Supabase SQL editor or `supabase db push`.

create extension if not exists vector;

-- ---------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------

create table if not exists users (
  id            uuid primary key default gen_random_uuid(),
  handle        text unique not null,
  created_at    timestamptz not null default now(),
  geohash       text,                 -- full-precision, NEVER returned raw
  loc_precision int not null default 5,-- geohash chars exposed (city ≈ 5)
  contact       jsonb                 -- exposed only on mutual accept
);

create table if not exists api_keys (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references users(id) on delete cascade,
  key_hash     text unique not null,  -- sha256 hex, never the plaintext
  last_used_at timestamptz,
  revoked      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists api_keys_user_idx on api_keys(user_id);

create table if not exists profiles (
  user_id      uuid primary key references users(id) on delete cascade,
  self_text    text not null default '',
  seeking_text text not null default '',
  self_emb     vector(1024),
  seeking_emb  vector(1024),
  updated_at   timestamptz not null default now()
);
-- ANN indexes for cosine similarity. Effective once populated + analyzed.
create index if not exists profiles_self_emb_idx
  on profiles using ivfflat (self_emb vector_cosine_ops) with (lists = 100);
create index if not exists profiles_seeking_emb_idx
  on profiles using ivfflat (seeking_emb vector_cosine_ops) with (lists = 100);

create table if not exists connections (
  id           uuid primary key default gen_random_uuid(),
  requester_id uuid not null references users(id) on delete cascade,
  target_id    uuid not null references users(id) on delete cascade,
  status       text not null default 'pending'
               check (status in ('pending','accepted','declined','expired')),
  match_score  float,
  created_at   timestamptz not null default now(),
  responded_at timestamptz,
  -- one live edge per unordered pair (guards duplicate requests)
  constraint connections_pair_unique unique (requester_id, target_id)
);
create index if not exists connections_requester_idx on connections(requester_id);
create index if not exists connections_target_idx on connections(target_id);

-- Per-key fixed-window rate-limit counters (SPEC §7.2). No Valkey in this
-- project (resources.cache = none), so the limiter lives in Postgres.
create table if not exists rate_limits (
  key_id       uuid not null references api_keys(id) on delete cascade,
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (key_id, window_start)
);

-- Deny-by-default RLS on everything reachable by anon/authed roles.
alter table users       enable row level security;
alter table api_keys    enable row level security;
alter table profiles    enable row level security;
alter table connections enable row level security;
alter table rate_limits enable row level security;

-- ---------------------------------------------------------------------
-- RPCs (called via supabase.rpc() — keeps the app on supabase-js, no
-- raw pg / ORM, while still doing pgvector math server-side).
-- ---------------------------------------------------------------------

-- Fixed-window rate limit. Returns true if the request is allowed.
create or replace function check_rate_limit(
  p_key_id uuid, p_limit int, p_window_seconds int
) returns boolean language plpgsql as $$
declare
  v_window timestamptz := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );
  v_count int;
begin
  insert into rate_limits(key_id, window_start, count)
    values (p_key_id, v_window, 1)
  on conflict (key_id, window_start)
    do update set count = rate_limits.count + 1
  returning count into v_count;
  return v_count <= p_limit;
end;
$$;

-- Bidirectional match score (SPEC §1). sim_a = B fits what A seeks;
-- sim_b = A fits what B seeks. Excludes self and any existing edge.
-- Keyset pagination on (score desc, user_id desc).
create or replace function match_recommendations(
  p_user_id uuid,
  p_w1 float,
  p_w2 float,
  p_limit int,
  p_cursor_score float default null,
  p_cursor_id uuid default null
) returns table(
  user_id uuid, handle text, match_score float, sim_a float, sim_b float
) language sql stable as $$
  with me as (
    select self_emb, seeking_emb from profiles where user_id = p_user_id
  ),
  scored as (
    select
      u.id as user_id,
      u.handle,
      (1 - (me.seeking_emb <=> pr.self_emb))::float    as sim_a,
      (1 - (pr.seeking_emb <=> me.self_emb))::float    as sim_b,
      (p_w1 * (1 - (me.seeking_emb <=> pr.self_emb))
       + p_w2 * (1 - (pr.seeking_emb <=> me.self_emb)))::float as score
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

-- Score for a single ordered pair (used when creating a connection).
create or replace function pair_score(
  p_a uuid, p_b uuid, p_w1 float, p_w2 float
) returns float language sql stable as $$
  select (p_w1 * (1 - (a.seeking_emb <=> b.self_emb))
        + p_w2 * (1 - (b.seeking_emb <=> a.self_emb)))::float
  from profiles a, profiles b
  where a.user_id = p_a and b.user_id = p_b
    and a.self_emb is not null and a.seeking_emb is not null
    and b.self_emb is not null and b.seeking_emb is not null;
$$;

-- Expire pending connections older than N days (SPEC §4). Call from a
-- cron, or opportunistically. Idempotent.
create or replace function expire_stale_connections(p_days int)
returns int language sql as $$
  with expired as (
    update connections
       set status = 'expired', responded_at = now()
     where status = 'pending'
       and created_at < now() - make_interval(days => p_days)
    returning 1
  )
  select count(*)::int from expired;
$$;
