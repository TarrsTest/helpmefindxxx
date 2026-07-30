import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * Magic-link callback. Supabase redirects here after the user clicks the
 * link in their email. We exchange the code for a session, then bounce
 * to /dashboard (or `next` query param if it's a safe relative path).
 *
 * `next` is validated to be a same-origin pathname only — anything that
 * could redirect off-site (//evil.com, http://..., \\evil.com) is
 * rejected to /dashboard. This blocks open-redirect phishing where an
 * attacker reuses our domain in the magic-link URL.
 */
const isSafeNext = (next: string | null): next is string => {
  if (!next) return false;
  // Reject anything that isn't a single leading slash + non-slash path.
  // Catches: //evil.com, /\evil.com, http://..., javascript:, etc.
  if (!next.startsWith('/')) return false;
  if (next.startsWith('//') || next.startsWith('/\\')) return false;
  // Reasonable path length cap.
  if (next.length > 256) return false;
  return true;
};

export const GET = async (request: NextRequest) => {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const rawNext = searchParams.get('next');
  const next = isSafeNext(rawNext) ? rawNext : '/dashboard';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=callback_failed`);
};
