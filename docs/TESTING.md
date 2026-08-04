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
| The `/v1/*` → `/api/v1/*` rewrite | Tests import `app/api/v1/…` directly, so the public path the SPEC promises is never resolved by `pnpm test`. Covered instead by `pnpm test:rewrite`, which is a **separate command** — see below. |
| `middleware.ts` | Excluded by design for `/v1`, but the human pages (`/`, `/map`, `/dashboard`) do run through it. None of that is tested. |
| RLS policies | Tests use the **service-role** client, which BYPASSES RLS. A policy that wrongly exposes data cannot fail these tests. |
| Security headers / CSP | `next.config.ts` `headers()` is build/serve-time only. |
| The map UI | `/map` and `components/GraphMap.tsx` have no tests. |
| Vercel build & deploy | Verified separately with `pnpm build`; not part of this suite. |
| A clean database | See below. |

### The one thing checked outside `pnpm test`

```bash
pnpm test:rewrite
```

`tests/contract/rewrite.test.ts` makes real HTTP requests against a deployed
server and asserts that every path `docs/openapi.yaml` documents actually
resolves — that the `/v1/*` → `/api/v1/*` rewrite in `next.config.ts` is
working. It is the only check standing between a broken rewrite and a 404 in
production, because the in-process suite is structurally blind to it.

Notes on how it is wired, all deliberate:

- **It is not part of `pnpm test`.** `vitest.config.mts` excludes
  `tests/contract/**`; the check has its own `vitest.contract.config.mts`. A
  glob change cannot sweep it into the default run, and the default run stays
  hermetic and offline.
- **It does not skip when there is no server.** If the target is unreachable
  every case fails with an explanatory error. A check that quietly disappears
  when the environment is inconvenient is how coverage goes to zero without
  anyone noticing.
- **It needs no credentials.** Every request is an unauthenticated GET, so it
  writes nothing and can run in CI without secrets. It does not load
  `tests/setup.ts`.
- **The path list is read out of `docs/openapi.yaml`,** not duplicated, so
  documenting a new endpoint automatically probes it.
- Default target is the production deployment; override with
  `REWRITE_BASE_URL` (e.g. `http://localhost:3000` with `pnpm dev` running).

Three things are asserted: every documented path is not a 404; `GET /v1/graph`
returns exactly `401 {"error":"missing bearer token"}`, proving a request
travels rewrite → handler → `lib/api/auth.ts`; and an undocumented path still
404s, which is the control that stops a catch-all from satisfying everything
above.

### Business coverage so far

| Group | File | State |
|---|---|---|
| Bearer authentication | `tests/auth.test.ts` | ✅ done — 6 cases × all 6 authenticated handlers |
| Contact gating | `tests/contact.test.ts` | ✅ done — 4 connection states + 2 leak paths |
| Pagination & anchor | `tests/pagination.test.ts` | ✅ done — cursor invariants + cutoff anchor |
| Rate limiting | `tests/rateLimit.test.ts` | ✅ done — threshold, window bucket, per-key isolation |

`tests/auth.test.ts` covers the auth gate only: absent header, header without
the `Bearer` prefix, `Bearer` with no key, a well-formed but forged key, a
revoked key, and a valid key. It runs every case against **every `/v1`
endpoint that has an auth gate** — six handlers across five route files. Add a
new authenticated route and it is NOT covered until you add it to the
`ENDPOINTS` table in that file.

For the valid-key case the tests assert only "not 401" — the gate opened.
Whether the endpoint then does the right thing is the business of the group
that covers it, which for two of the four is still nothing.

`tests/contact.test.ts` covers the contact gate (SPEC §4/§7.3) across all four
connection states — pending, declined, expired hide contact from **both**
parties; accepted exposes it to both — plus the two incidental leak paths,
`GET /v1/recommendations` and `GET /v1/graph`.

Every test user's contact is an address at a marker domain that exists nowhere
else, so each assertion is a substring check over the entire serialised
response and catches a leak through *any* field, not just one named `contact`.
The accepted case asserts the marker **is** present, so the negative checks
can't pass merely because the marker never appears.

The expired state is set by a scoped `UPDATE` on the one row under test rather
than by calling `expire_stale_connections()`, which sweeps every pending row
older than the cutoff and would expire other people's connections on this
shared database.

`tests/pagination.test.ts` covers cursor paging and the relative cutoff's
anchor: no duplicate `user_id` across pages (the regression for migration
006), nobody omitted, the cursor terminates, results descend by score, the
paginated walk equals the unpaginated response, and `calibration.top_score`
stays the page-1 anchor instead of being recomputed per page.

**Assert contracts, not score values.** Absolute scores depend on the
embedding provider, on the vectors, and — for `calibration.baseline` — on
whoever else is in the shared database. A test pinned to `0.8241` fails on a
provider swap or a reembed while the contract is perfectly intact. Where these
tests touch scores at all it is relational: `a >= b`, or "within cutoff of the
anchor".

The stub vectors are `e0 + small noise`, chosen so fixture users score ~0.82
against each other with a spread in the third decimal — distinct, strictly
orderable, and full-mantissa floats of the kind that exposed the 006 bug —
while anyone else in the database sits near 0 and is dropped by the cutoff.
That isolation is what lets the "omits nobody" assertion mean something
without counting other people's rows.

`tests/rateLimit.test.ts` covers the per-key fixed window: requests up to the
limit pass, the next one is 429, an exhausted key does not affect any other
key, a counter from an earlier window is ignored, the count starts fresh once
the window rolls over, and the counter is stored in the correctly aligned
bucket.

**Time is controlled through state, never the clock.** The limiter buckets by
`floor(now / window) * window`, so "the window rolled over" is entirely
expressed by which bucket a row sits in — the tests move rows between buckets
instead of sleeping. A sleep-based test would have to exhaust the limit inside
a window narrow enough to wait out, and a few database round trips straddling
that boundary is precisely the flake worth refusing. `vi.useFakeTimers` is no
help: the clock that matters is Postgres's `now()`, not the test process's.

`RATE_LIMIT` and `RATE_WINDOW_SECONDS` are read at import time, so the file
stubs the env and calls `vi.resetModules()` **before** dynamically importing
the route. One test asserts the stub took effect — otherwise a broken stub
falls back to 60/minute and every over-limit case fails looking like a
limiter bug rather than a harness bug.

The bucket-alignment test is the one deliberately white-box assertion in the
suite. It exists because a limiter that dropped the bucket arithmetic and
pinned every counter to one constant timestamp still counts correctly and
still passes every black-box case here — it simply never rolls over. Nothing
observable through the API distinguishes that within a single window, so the
storage layout has to be asserted directly.

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
