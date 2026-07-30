import { createAdminClient } from '@/lib/supabase/admin';
import { generateApiKey } from '@/lib/api/auth';
import { encodeGeohash } from '@/lib/geohash';
import { json, fail, handle } from '@/lib/api/http';

// POST /v1/users — register a person and issue their agent's api_key.
// Not in the SPEC §3 table, but SPEC §9 requires "API key 签发"; this is
// the bootstrap endpoint an agent calls once. The plaintext key is
// returned ONCE and only its hash is stored.
//
// Body: { handle, contact?, lat?, lng?, loc_precision? }
//   - contact (jsonb) is exposed only after a mutual accept (SPEC §4).
//   - lat/lng are encoded to a full-precision geohash; only a blurred
//     cell is ever returned to anyone (SPEC §7.1).

export const runtime = 'nodejs';

export const POST = (request: Request) =>
  handle(async () => {
    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return fail(400, 'invalid json body');

    const handleName = String(body.handle ?? '').trim().slice(0, 64);
    if (!handleName) return fail(400, 'handle is required');

    const locPrecision = Math.min(
      9,
      Math.max(1, Number(body.loc_precision) || 5),
    );

    let geohash: string | null = null;
    if (body.lat != null && body.lng != null) {
      const lat = Number(body.lat);
      const lng = Number(body.lng);
      if (Number.isFinite(lat) && Number.isFinite(lng)) {
        geohash = encodeGeohash(lat, lng, 9);
      }
    }

    const db = createAdminClient();

    const { data: user, error: userErr } = await db
      .from('users')
      .insert({
        handle: handleName,
        contact: body.contact ?? null,
        geohash,
        loc_precision: locPrecision,
      })
      .select('id, handle')
      .single();

    if (userErr) {
      if (userErr.code === '23505') return fail(409, 'handle already taken');
      throw userErr;
    }

    // Empty profile row so re-embed / matching has a home.
    await db.from('profiles').insert({ user_id: user.id });

    const { plain, hash } = generateApiKey();
    const { error: keyErr } = await db
      .from('api_keys')
      .insert({ user_id: user.id, key_hash: hash });
    if (keyErr) throw keyErr;

    return json(
      {
        user_id: user.id,
        handle: user.handle,
        // Shown once — the server only stores the hash. Store it safely.
        api_key: plain,
      },
      201,
    );
  });
