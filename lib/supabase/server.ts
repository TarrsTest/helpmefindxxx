import { createServerClient, type CookieOptions } from '@supabase/ssr';
import { cookies } from 'next/headers';

/**
 * Supabase client for use in Server Components / Route Handlers / Server
 * Actions. Reads cookies for the user session.
 *
 * Auth-cookie security: @supabase/ssr writes session cookies with
 * httpOnly=true, secure=true (prod), and sameSite='lax' by default.
 * Don't override those in `setAll` — losing httpOnly puts the JWT in
 * reach of any XSS, and losing secure leaks it on http downgrade.
 */
export const createClient = async () => {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options: CookieOptions;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // setAll called from a Server Component — ignore. Middleware
            // refreshes sessions, so missing this here is fine.
          }
        },
      },
    },
  );
};
