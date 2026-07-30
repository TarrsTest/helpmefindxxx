-- Example resource so /posts works on first run.
-- Apply via Supabase SQL editor or `supabase db push`.

create table if not exists posts (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  body text not null,
  author_id uuid references auth.users(id) on delete cascade,
  created_at timestamptz not null default now()
);

alter table posts enable row level security;

-- Anyone signed in can read all posts.
create policy "posts: read for authed users"
  on posts for select
  using (auth.uid() is not null);

-- Authed users can create their own posts.
create policy "posts: insert own"
  on posts for insert
  with check (auth.uid() = author_id);

-- Authors can update / delete their own.
create policy "posts: update own"
  on posts for update
  using (auth.uid() = author_id);

create policy "posts: delete own"
  on posts for delete
  using (auth.uid() = author_id);
