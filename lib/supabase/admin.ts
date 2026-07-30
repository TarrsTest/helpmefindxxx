import { createClient as createSupabaseClient } from '@supabase/supabase-js';

/**
 * Service-role Supabase client — bypasses RLS. Used ONLY by the agent
 * API (app/api/v1/*), where the authorization boundary is the Bearer
 * api_key check (see lib/api/auth.ts), not a Supabase Auth JWT / RLS.
 *
 * Never import this into a client component or expose the key. The
 * key is server-only (SUPABASE_SERVICE_ROLE_KEY).
 */
export const createAdminClient = () =>
  createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );
