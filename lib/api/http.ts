import { NextResponse } from 'next/server';

// Small shared helpers for the /v1 API. Errors are thrown as ApiError and
// caught by withAuth / the handler wrapper into a uniform JSON body.

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (data: unknown, status = 200) =>
  NextResponse.json(data, { status });

export const fail = (status: number, message: string) =>
  NextResponse.json({ error: message }, { status });

/** Wrap a handler so thrown ApiErrors become clean JSON responses. */
export const handle = (
  fn: () => Promise<NextResponse>,
): Promise<NextResponse> =>
  fn().catch((err) => {
    if (err instanceof ApiError) return fail(err.status, err.message);
    console.error('[api] unhandled', err);
    return fail(500, 'internal error');
  });
