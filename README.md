# Next.js + Supabase starter

Single-service template: **Next.js talks to Supabase directly** for
both auth AND data. No separate backend, no Express in the middle.
React Server Components handle reads, Server Actions handle writes,
RLS policies handle authorization.

If you want a thin frontend that talks to a separate backend over
HTTP (Express + Postgres, FastAPI, anyone else), see `nextjs-standalone`.

---

## Agent API (`/v1`) — the product

This project is an **agent-mediated social graph**: people don't swipe,
their agents call an API to find bidirectional-semantic matches. The API
_is_ the product; the only human interface is the map at `/map`.

Every `/v1` endpoint authenticates with `Authorization: Bearer <api_key>`
(SHA-256-hashed at rest) and is per-key rate limited. Vector matching runs
in Postgres (`pgvector`) via RPCs; contact details are exchanged only after
a mutual accept; coordinates are always blurred to a geohash cell.

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/v1/users` | Register a person, issue their agent's `api_key` (returned once) |
| `POST` | `/v1/profile` | Report `self` + `seeking` (re-embeds) |
| `GET` | `/v1/recommendations` | Bidirectional-scored matches, cursor-paginated |
| `POST` | `/v1/connections` | Initiate `{ target_id }` → pending |
| `GET` | `/v1/connections` | My connections (contact only on accepted) |
| `POST` | `/v1/connections/:id/respond` | `{ action: accept \| decline }` |
| `GET` | `/v1/graph` | Blurred nodes + accepted edges (also feeds `/map`) |

Quick start:

```bash
# 1. Register — save the api_key from the response (shown once)
curl -sX POST localhost:3000/v1/users -H 'content-type: application/json' \
  -d '{"handle":"ada","contact":{"email":"ada@x.io"},"lat":51.50,"lng":-0.12,"loc_precision":5}'

# 2. Report who you are / who you seek
curl -sX POST localhost:3000/v1/profile -H "authorization: Bearer $KEY" \
  -H 'content-type: application/json' \
  -d '{"self":"systems programmer, into type theory","seeking":"a designer who likes math"}'

# 3. Pull recommendations
curl -s localhost:3000/v1/recommendations -H "authorization: Bearer $KEY"
```

### Reading `match_score` — it is a ranking signal, not a probability

`match_score` orders candidates. That is all it does. It is **not** a
percentage, **not** a confidence, and **not** comparable across embedding
providers. Modern embeddings have a high similarity floor: two people with
nothing whatsoever in common still score around **0.55–0.62**. A raw 0.6 means
"stranger", not "60% match" — which is why the score is exposed to agents only
and appears nowhere on the human-facing map.

Two mechanisms keep that from misleading a caller:

**Relative cutoff.** Candidates scoring more than `MATCH_RELATIVE_CUTOFF`
(default 0.15) below the best match are dropped. The comparison is relative
because the absolute floor moves with the provider, while the *gap* between two
scores in one result set stays meaningful. The anchor is the top score of the
first page and rides along in the cursor, so later pages can't re-anchor on
their own weaker top.

**Calibration.** The cutoff cannot detect a result set where *everything* is
irrelevant — "far below the top" says nothing when the top is itself noise. So
every page reports how the best match compares to a random stranger:

```json
"calibration": {
  "baseline": 0.558,          // mean score against a random sample of profiles
  "baseline_stddev": 0.018,
  "sample_size": 10,
  "top_score": 0.595,         // best match in the result set (stable across pages)
  "top_margin": 0.036,        // top_score - baseline  <- the signal
  "cutoff": 0.15
}
```

`top_margin` is what an agent should branch on. Measured on this dataset
(2026-07-28, `gemini-embedding-001`): a genuine counterpart yields a margin
around **0.18**; a person with nobody relevant in the pool yields **0.036** —
while still receiving a full page of recommendations. Small margin means *don't
send a connection request*, however many rows came back.

Deliberately **not** reported as a z-score: when someone is uniformly far from
everyone, the baseline spread collapses and `margin / stddev` reads as a
confident 1.9 on exactly the noise this is meant to expose.

**Architecture note:** the `/v1` API intentionally deviates from this
template's Supabase-Auth/RLS default — agents are external callers, so it
uses Bearer-key auth validated in `lib/api/auth.ts` over the service-role
client, with RLS deny-by-default as defense in depth. Data access stays on
`supabase-js` (RPCs), no raw `pg`/ORM. Embedding provider is behind
`lib/embeddings` (Voyage when `VOYAGE_API_KEY` is set, else a dependency-free
local fallback for dev). Apply the migrations in `supabase/migrations/` in
order before using the API (`002_social_graph.sql` needs `pgvector`).

---

## What's included

- Next.js 15 (App Router, React 19, TypeScript)
- Tailwind CSS 4
- Supabase Auth (magic-link via email — no Google config needed)
- Server / browser / middleware Supabase clients (`@supabase/ssr`)
- Open-redirect-hardened `/auth/callback` handler
- Protected `/dashboard` route example (SSR auth gate)
- `/posts` resource — SQL migration + RSC list + Server Action create / delete
- RLS policies are the authoritative auth check (not duplicated in code)
- Sign-out button
- FontAwesome Free icons

## Layout

```
app/
  layout.tsx
  page.tsx              # landing
  login/page.tsx        # magic-link sign-in
  auth/callback/route.ts  # exchanges code for session, validates `next`
  dashboard/page.tsx    # auth-gated SSR
  posts/page.tsx        # RSC list + Server Action create / delete
components/
  SignOutButton.tsx
lib/
  supabase/
    client.ts           # browser
    server.ts           # RSC / Server Actions / route handlers
    middleware.ts       # session refresh (called from /middleware.ts)
middleware.ts           # runs lib/supabase/middleware on every request
supabase/
  migrations/
    001_posts.sql       # posts table + RLS policies
```

## How Tarrs uses this

When a Tarrs customer creates a project from this template:

1. Tarrs creates a fresh GitHub repo from `TarrsAI/nextjs-supabase`
2. Tarrs creates a Supabase project (or uses linked one)
3. Tarrs auto-injects these env vars into the dev sandbox container:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY` (server-only, RLS-bypass)
4. Customer files first ticket → AI extends the codebase

## Local dev

```bash
pnpm install
cp .env.example .env.local   # fill from your Supabase dashboard
pnpm dev
```

Apply the migration so `/posts` works — paste
`supabase/migrations/001_posts.sql` into Supabase SQL editor, or run:

```bash
supabase link --project-ref <ref>
supabase db push
```

Open http://localhost:3000.

## RLS-first authorization

Supabase RLS policies in `supabase/migrations/001_posts.sql` are the
authoritative auth check. The `/posts` Server Action does NOT
re-check `if (post.author_id === user.id)` in code — the policy
already does that, and duplicating the check would drift the day
you change the policy.

Two cases where you DO write an in-code check:
1. Rules that can't be expressed as a policy (e.g. "any user with
   `role='admin'` can see everything" when role isn't a column).
2. Pre-empting a query to avoid an obviously-wrong call (UX).

Use the server-only `SUPABASE_SERVICE_ROLE_KEY` client for those —
it bypasses RLS, so the in-code check is what protects the data.

## Adding Google login

Out of the box this template uses **email magic-link** — zero config.
To add Google as well:

1. Create OAuth credentials at [console.cloud.google.com](https://console.cloud.google.com/apis/credentials)
2. Supabase Dashboard → Authentication → Providers → Google → paste
   client ID + secret
3. In `app/login/page.tsx`, add a button that calls
   `supabase.auth.signInWithOAuth({ provider: 'google' })`

## Adding a new resource

1. Add a migration file under `supabase/migrations/` — table + RLS policies
2. `supabase db push` to apply
3. Add an `app/<thing>/page.tsx` — RSC for reads, Server Actions for writes
4. Use `await createClient()` (from `lib/supabase/server.ts`) — it auto-handles cookies + session refresh

## Deploy to prod

Push to GitHub. Vercel detects Next.js and deploys. Add Supabase env
vars in Vercel project settings.
