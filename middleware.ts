import { type NextRequest } from 'next/server';
import { updateSession } from '@/lib/supabase/middleware';

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    // Run on all routes except static files, images, and the agent API
    // (agents authenticate by Bearer api_key, not a session cookie) — both
    // its real path (api/) and the documented /v1 alias (see next.config).
    '/((?!api/|v1/|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
