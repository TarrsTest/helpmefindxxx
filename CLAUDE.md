# Architecture (locked)

When you add or change code in this repo, **follow these rules**. They
are not preferences — they are how this template is supposed to work.
Deviating is a bug.

## Stack — pinned

| Concern | Choice | Don't substitute |
|---|---|---|
| Data access | **`@supabase/ssr` + `@supabase/supabase-js`** (PostgREST) | No Drizzle / Prisma / Sequelize / direct `pg` connection. The data layer is `supabase-js` because this template's value-add is the Supabase platform (RLS, realtime, storage, auth). ORM-on-top defeats that — if you need an ORM-driven stack, pair `nextjs-standalone` with `express-postgres` over HTTP. |
| Authorization | **RLS policies in `supabase/migrations/`** | Do NOT add `if (post.author_id === user.id)` checks in Server Action / RSC code. The policy is the source of truth; an in-code duplicate drifts the day the policy changes. (UI nicety like hiding a delete button for non-authors is fine — actual enforcement is the policy.) |
| Auth | Supabase Auth (magic-link out of the box) via `@supabase/ssr` | Don't add NextAuth / Clerk / Auth.js / a custom bcrypt+JWT stack — if you need that pattern, pair `nextjs-standalone` with `express-postgres`. |
| Migrations | `supabase/migrations/*.sql` via Supabase CLI | No Alembic / Sequelize / dbmate. |
| Validation | Length-cap inline in Server Actions (`String(formData.get(...)).slice(0, 200)`) | Add Zod if a resource gets complex; current scale doesn't justify the dep weight. |
| Mutation surface | **Server Actions only** | Don't add `app/api/*` route handlers for mutations the form-action shape already covers. Add a route handler only when an external service needs to webhook you. |
| Reads | **React Server Components calling `createClient()`** from `lib/supabase/server.ts` | Don't fetch via the browser client + a useEffect — RSC is the canonical pattern, and SSR avoids the FOUC. |
| Cookie security | `@supabase/ssr` defaults: httpOnly, secure (prod), sameSite='lax' | Don't override these in `setAll` — losing httpOnly puts the JWT in reach of any XSS. |

## Folder layout — what each layer is for

```
app/
  layout.tsx
  page.tsx                       landing (RSC checks user via createClient)
  login/page.tsx                 magic-link sign-in (calls supabase.auth.signInWithOtp)
  auth/callback/route.ts         exchanges code -> session, validates `next`
                                 against open-redirect (anything that isn't a
                                 single-leading-slash relative path is rejected)
  dashboard/page.tsx             SSR auth gate via supabase.auth.getUser()
  posts/page.tsx                 RSC list + Server Actions for create / delete
components/
  SignOutButton.tsx              client component (router.refresh after sign-out)
lib/
  supabase/
    server.ts                    createClient() for RSC / Server Actions / route handlers
    client.ts                    createBrowserClient() for client components
    middleware.ts                updateSession() — runs on every request to refresh
                                 the session cookie. Don't override the auth-cookie
                                 defaults from @supabase/ssr.
middleware.ts                    runs lib/supabase/middleware.updateSession on every request
supabase/
  migrations/                    Raw SQL — table DDL + RLS policies. Apply via
                                 `supabase db push`. Schema source of truth.
```

There is no `service/` layer in this template. Server Actions are
small enough that the "controller → service" split would be a
ceremony tax. If you ever grow a complex business operation that
spans multiple tables, add a `lib/services/` folder and move the
logic there — but for the canonical "RSC read + Server Action
create / delete" pattern, inline is fine.

## The 4-step recipe — adding a new resource

1. `supabase/migrations/00X_<thing>.sql` — table + RLS policies. The policies are the authoritative auth check; write them carefully.
2. `supabase db push` to apply.
3. `app/<thing>/page.tsx` — RSC for reads (calls `createClient()`), Server Actions inline for writes. Length-cap inputs before touching the DB.
4. Optional: if the page needs an interactive form, extract a client component (`'use client'`) for the form and pass the Server Action via `action={...}` prop.

The Server Action calls `supabase.auth.getUser()` first, returns early if absent, then performs the query.

## Authorization in detail

```sql
-- Authoritative — in supabase/migrations/
create policy "posts: read for authed users"
  on posts for select using (auth.uid() is not null);

create policy "posts: delete own"
  on posts for delete using (auth.uid() = author_id);
```

```ts
// app/posts/page.tsx — DON'T re-check ownership.
const deletePost = async (formData: FormData) => {
  'use server';
  const id = String(formData.get('id') ?? '');
  if (!id) return;
  const supabase = await createClient();
  // RLS handles "only the author can delete". 0 rows when not yours
  // is the policy's "no, you can't" — same shape as not-found.
  await supabase.from('posts').delete().eq('id', id);
  revalidatePath('/posts');
};
```

## When to reach for the service-role client

Anywhere you need to bypass RLS for a server-owned operation (cron sweepers, system-only inserts, admin endpoints). Use the `SUPABASE_SERVICE_ROLE_KEY` to build a separate client. Write the in-code auth check **directly above** the admin call.

## What NOT to do

- ❌ Don't add Drizzle / Prisma / Sequelize — use `supabase-js`.
- ❌ Don't re-check ownership in Server Actions or RSC code — RLS owns it.
- ❌ Don't fetch in `useEffect` for data that's known at request time — use RSC.
- ❌ Don't add NextAuth / Clerk — use Supabase Auth.
- ❌ Don't add `app/api/foo/route.ts` for mutations a Server Action already covers.
- ❌ Don't override the auth-cookie defaults in `setAll` (httpOnly / secure / sameSite).
- ❌ Don't use the browser client (`createBrowserClient`) for sensitive operations — use the server client from RSC.
- ❌ Don't accept `next` query params on `/auth/callback` without the `isSafeNext` check — open-redirect is real.
- ❌ Don't hand-write a `pnpm-workspace.yaml` / `allowBuilds:` block to silence pnpm's "Ignored build scripts" warning. Native-build approval is already declared in `package.json` → `pnpm.onlyBuiltDependencies` (`sharp`, `unrs-resolver`). If you add another dep with a build script, append its name to that array — don't improvise a workspace file.

## What to do when in doubt

Read `app/posts/page.tsx` + `app/auth/callback/route.ts` — they're the canonical example.
