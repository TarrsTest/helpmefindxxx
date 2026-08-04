import { readFileSync } from 'fs';
import { resolve } from 'path';
import { describe, expect, it } from 'vitest';

// Does the PUBLIC path surface actually exist?
//
// Everything in tests/*.test.ts calls route handlers in-process, importing
// them from app/api/v1/…. That is fast and hermetic, and it is structurally
// blind to one thing: the handlers are only reachable at /v1/* because of a
// rewrite in next.config.ts. Break that rewrite and the whole main suite stays
// green while every documented path 404s in production.
//
// So this file does the opposite of the rest of the suite: real HTTP, against
// a deployed server, asserting the paths docs/openapi.yaml promises.
//
// It is NOT part of `pnpm test`. Run it explicitly:
//
//   pnpm test:rewrite
//
// and it fails — loudly — if the target is unreachable. It is deliberately not
// written to skip when no server is around: a check that silently disappears
// when the environment is inconvenient is how coverage quietly goes to zero,
// and this is the only check standing between a broken rewrite and a 404 in
// production.
//
// Every request here is an unauthenticated GET. Nothing is created, and no
// credential is needed — which also means this can run in CI without secrets.

const BASE_URL = process.env.REWRITE_BASE_URL ?? 'https://helpmefindxxx.vercel.app';
const TIMEOUT_MS = 20_000;

/**
 * The paths this API documents, read straight from the OpenAPI file so the two
 * cannot drift: document a new endpoint and it is probed here automatically.
 */
const documentedPaths = (): string[] => {
  const spec = readFileSync(resolve(__dirname, '../../docs/openapi.yaml'), 'utf8');
  const paths = [...spec.matchAll(/^ {2}(\/v1[^\s:]*):$/gm)].map((m) => m[1]);

  if (paths.length === 0) {
    throw new Error('no /v1 paths found in docs/openapi.yaml — did its shape change?');
  }
  return paths;
};

// Templated segments need a syntactically valid stand-in. It never has to
// exist: a GET on a POST-only route is rejected on the method, before any
// handler looks the id up.
const concrete = (path: string) =>
  path.replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000000');

const get = async (path: string) => {
  const url = `${BASE_URL}${path}`;
  try {
    return await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (cause) {
    throw new Error(
      `could not reach ${url}. This check needs a running deployment — set ` +
        `REWRITE_BASE_URL to point somewhere else (e.g. http://localhost:3000 ` +
        `with the dev server up). It does not skip.`,
      { cause },
    );
  }
};

describe(`public /v1 path surface at ${BASE_URL}`, () => {
  it.each(documentedPaths())('resolves %s', async (path) => {
    const res = await get(concrete(path));

    // 404 is the signature of a missing rewrite. Anything else — 401 from the
    // auth gate, 405 from a POST-only route — means the path reached a
    // handler, which is all this file is asserting.
    expect(res.status, `${path} returned 404: the /v1 rewrite is not resolving`).not.toBe(404);
  });

  it('reaches a real handler through the rewrite, not just some route', async () => {
    // GET /v1/graph is a documented GET endpoint behind the auth gate, so a
    // 401 with this exact body proves the request travelled the whole way:
    // rewrite → route handler → lib/api/auth.ts.
    const res = await get('/v1/graph');

    expect(res.status).toBe(401);
    await expect(res.json()).resolves.toEqual({ error: 'missing bearer token' });
  });

  it('still 404s a path that does not exist', async () => {
    // The control. Without it, a catch-all that answered 401 to everything
    // would satisfy every assertion above while the real routes were gone.
    const res = await get('/v1/definitely-not-a-real-endpoint');

    expect(res.status).toBe(404);
  });
});
