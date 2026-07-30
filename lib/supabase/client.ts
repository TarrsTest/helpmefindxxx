import { createBrowserClient } from '@supabase/ssr';

/**
 * Supabase client for use in React Client Components / browser code.
 * Reads `NEXT_PUBLIC_*` env so it works on the client.
 */
export const createClient = () =>
  createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
