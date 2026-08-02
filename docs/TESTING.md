# Testing

```bash
pnpm test         # one-shot
pnpm test:watch   # watch mode
```

## How the harness works

Tests import a route handler and call it directly with a plain `Request`:

```ts
import { GET } from '@/app/api/v1/recommendations/route';

const res = await GET(new Request('http://test.local/v1/recommendations'));
expect(res.status).toBe(401);
```

No dev server, no HTTP. That is safe **because agent auth lives in
`lib/api/auth.ts`**, called at the top of every `/v1` handler — not in
`middleware.ts`, whose matcher deliberately excludes `api/` and `v1/`
(agents authenticate by Bearer key, not a session cookie). Importing a
handler therefore skips nothing that matters. If auth ever moves into
middleware, this whole approach silently stops testing auth — treat that as
a breaking change to the test strategy, not just a refactor.

`tests/setup.ts` runs `import 'dotenv/config'` first. Vitest does not read
`.env` on its own (Vite only exposes `VITE_`-prefixed vars, and only via
`import.meta.env`), so without it every Supabase call fails with a confusing
error. Setup fails fast and names any missing variable.

Dynamic routes take their params as a Promise in Next 15:

```ts
await POST(req, { params: Promise.resolve({ id }) });
```

## What a green run does NOT mean

All tests passing means **the handler logic that is covered behaved as
expected against the shared dev database**. It does not mean the app works.
Specifically, none of the following is exercised:

| Not covered | Why it matters |
|---|---|
| The `/v1/*` → `/api/v1/*` rewrite | Tests import `app/api/v1/…` directly. The public path the SPEC promises (`/v1`) lives in `next.config.ts` and is never resolved here. A broken rewrite = green tests, 404 in production. |
| `middleware.ts` | Excluded by design for `/v1`, but the human pages (`/`, `/map`, `/dashboard`) do run through it. None of that is tested. |
| RLS policies | Tests use the **service-role** client, which BYPASSES RLS. A policy that wrongly exposes data cannot fail these tests. |
| Security headers / CSP | `next.config.ts` `headers()` is build/serve-time only. |
| The map UI | `/map` and `components/GraphMap.tsx` have no tests. |
| Vercel build & deploy | Verified separately with `pnpm build`; not part of this suite. |
| A clean database | See below. |

### Business coverage so far

| Group | File | State |
|---|---|---|
| Bearer authentication | `tests/auth.test.ts` | ✅ done — 6 cases × all 6 authenticated handlers |
| Rate limiting | — | ❌ not written |
| Pagination | — | ❌ not written |
| Contact exchange | — | ❌ not written |

`tests/auth.test.ts` covers the auth gate only: absent header, header without
the `Bearer` prefix, `Bearer` with no key, a well-formed but forged key, a
revoked key, and a valid key. It runs every case against **every `/v1`
endpoint that has an auth gate** — six handlers across five route files. Add a
new authenticated route and it is NOT covered until you add it to the
`ENDPOINTS` table in that file.

For the valid-key case the tests assert only "not 401" — the gate opened.
Whether the endpoint then does the right thing is the business of the group
that covers it, which for three of the four is still nothing.

## Conventions for new tests

**The database is shared.** These tests hit the real dev Supabase, the same
one the dev server and other people's work are using. Two rules follow:

1. **Tag everything you create.** Use `testHandle()` from
   `tests/helpers/testData.ts`; every handle gets this run's unique
   `test_<runid>_` prefix.
2. **Never delete unconditionally.** `cleanupRun()` deletes only rows
   matching this run's prefix, and refuses to run if the prefix is
   suspiciously short. A bare `delete from users` would destroy a colleague's
   work — there is no such call in this repo, and there must never be one.

**Never assert on global counts.** `expect(users).toHaveLength(3)` is a test
that fails when someone else inserts a row. Assert over rows matching
`RUN_PREFIX`, or over ids the test itself created.

**Keep secrets out of assertions.** A failing `expect(key).toMatch(/^sk_/)`
prints the plaintext api_key into the test output. Compare booleans instead:

```ts
expect(typeof body.api_key).toBe('string');
expect(body.api_key.startsWith('sk_')).toBe(true);
```

**Watch module-load env capture.** `lib/config.ts` reads `process.env` at
import time (`RATE_LIMIT`, `MATCH_RELATIVE_CUTOFF`, …). To test with
different values, set the env *before* the module is imported —
`vi.stubEnv` + `vi.resetModules` + dynamic `import()` — otherwise the
override is ignored. The same applies to `lib/embeddings/index.ts`, which
picks its provider at import time.

**Mock embeddings.** Real embedding calls cost quota, need the network, and
make ranking non-deterministic. `vi.mock('@/lib/embeddings')` with fixed
1024-d vectors makes pagination assertions deterministic.
