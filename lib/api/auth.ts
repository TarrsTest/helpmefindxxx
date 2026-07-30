import { createHash, randomBytes } from 'crypto';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createAdminClient } from '@/lib/supabase/admin';
import { RATE_LIMIT, RATE_WINDOW_SECONDS } from '@/lib/config';
import { ApiError } from './http';

// Bearer api_key authentication + per-key rate limiting (SPEC §3 / §7).
// We store only the sha256 hash of a key, never the plaintext.

const KEY_PREFIX = 'sk_';

export const hashKey = (plain: string): string =>
  createHash('sha256').update(plain).digest('hex');

/** Generate a fresh key. The plaintext is returned to the caller ONCE. */
export const generateApiKey = (): { plain: string; hash: string } => {
  const plain = KEY_PREFIX + randomBytes(24).toString('hex');
  return { plain, hash: hashKey(plain) };
};

export interface AuthContext {
  db: SupabaseClient;
  userId: string;
  keyId: string;
}

/**
 * Validate the Authorization: Bearer <api_key> header, resolve the user,
 * bump last_used_at, and enforce the per-key rate limit. Throws ApiError
 * on any failure. Returns a service-role client + the caller's identity.
 */
export const authenticate = async (request: Request): Promise<AuthContext> => {
  const header = request.headers.get('authorization') ?? '';
  const match = header.match(/^Bearer\s+(.+)$/i);
  if (!match) throw new ApiError(401, 'missing bearer token');

  const db = createAdminClient();
  const keyHash = hashKey(match[1].trim());

  const { data: key, error } = await db
    .from('api_keys')
    .select('id, user_id, revoked')
    .eq('key_hash', keyHash)
    .maybeSingle();

  if (error) throw new ApiError(500, 'auth lookup failed');
  if (!key || key.revoked) throw new ApiError(401, 'invalid api key');

  const { data: allowed } = await db.rpc('check_rate_limit', {
    p_key_id: key.id,
    p_limit: RATE_LIMIT,
    p_window_seconds: RATE_WINDOW_SECONDS,
  });
  if (allowed === false) throw new ApiError(429, 'rate limit exceeded');

  // Best-effort; don't block the request on the write.
  await db
    .from('api_keys')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', key.id);

  return { db, userId: key.user_id, keyId: key.id };
};
