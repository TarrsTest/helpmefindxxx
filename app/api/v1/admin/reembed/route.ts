import { createAdminClient } from '@/lib/supabase/admin';
import { embed, embeddingProviderName } from '@/lib/embeddings';
import { json, fail, handle } from '@/lib/api/http';

// POST /v1/admin/reembed — recompute self_emb / seeking_emb for every
// profile that has text, using the CURRENTLY configured provider.
//
// Why this exists: the local fallback and Voyage produce vectors in
// DIFFERENT spaces (embeddings/index.ts), so the moment you set
// VOYAGE_API_KEY the rows embedded under the old provider stop matching
// correctly. Run this once after switching providers to backfill the
// whole table into one consistent space. Idempotent — safe to re-run.
//
// Auth: this is a server-owned, RLS-bypassing admin op, so it is gated by
// a dedicated ADMIN_TOKEN (Bearer), NOT a user api_key. If ADMIN_TOKEN is
// unset the endpoint is disabled (503) rather than open.

export const runtime = 'nodejs';
export const maxDuration = 300;

// Profiles updated per Voyage call. embed() sends self+seeking per row, so
// this is 2× texts per request — well under Voyage's 128-input cap.
const CHUNK = 50;

export const POST = (request: Request) =>
  handle(async () => {
    const adminToken = process.env.ADMIN_TOKEN;
    if (!adminToken) return fail(503, 'admin endpoint disabled (ADMIN_TOKEN unset)');

    const header = request.headers.get('authorization') ?? '';
    const match = header.match(/^Bearer\s+(.+)$/i);
    if (!match || match[1].trim() !== adminToken)
      return fail(401, 'invalid admin token');

    const db = createAdminClient();

    // Only rows with real content — empty profiles have nothing to embed
    // and would just waste provider calls.
    const { data: rows, error } = await db
      .from('profiles')
      .select('user_id, self_text, seeking_text')
      .or('self_text.neq.,seeking_text.neq.');
    if (error) throw error;

    const profiles = rows ?? [];
    let updated = 0;

    for (let i = 0; i < profiles.length; i += CHUNK) {
      const batch = profiles.slice(i, i + CHUNK);
      // Flatten to [self, seeking, self, seeking, ...] for one embed call.
      const texts = batch.flatMap((p) => [p.self_text ?? '', p.seeking_text ?? '']);
      const vecs = await embed(texts);

      for (let j = 0; j < batch.length; j++) {
        const { error: upErr } = await db
          .from('profiles')
          .update({
            self_emb: vecs[j * 2],
            seeking_emb: vecs[j * 2 + 1],
            updated_at: new Date().toISOString(),
          })
          .eq('user_id', batch[j].user_id);
        if (upErr) throw upErr;
        updated++;
      }
    }

    return json({ ok: true, provider: embeddingProviderName, reembedded: updated });
  });
