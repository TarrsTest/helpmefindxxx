# Next.js + Supabase starter

Single-service template: **Next.js talks to Supabase directly** for
both auth AND data. No separate backend, no Express in the middle.
React Server Components handle reads, Server Actions handle writes,
RLS policies handle authorization.

If you want a thin frontend that talks to a separate backend over
HTTP (Express + Postgres, FastAPI, anyone else), see `nextjs-standalone`.

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
