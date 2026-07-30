import { authenticate } from '@/lib/api/auth';
import { embed } from '@/lib/embeddings';
import { json, fail, handle } from '@/lib/api/http';

// POST /v1/profile — agent reports self + seeking; triggers re-embed
// (SPEC §3). Both fields are natural language (SPEC §1).
// Body: { self, seeking }

export const runtime = 'nodejs';

export const POST = (request: Request) =>
  handle(async () => {
    const { db, userId } = await authenticate(request);

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== 'object') return fail(400, 'invalid json body');

    const selfText = String(body.self ?? '').trim().slice(0, 4000);
    const seekingText = String(body.seeking ?? '').trim().slice(0, 4000);
    if (!selfText || !seekingText)
      return fail(400, 'both self and seeking are required');

    const [selfEmb, seekingEmb] = await embed([selfText, seekingText]);

    const { error } = await db
      .from('profiles')
      .update({
        self_text: selfText,
        seeking_text: seekingText,
        self_emb: selfEmb,
        seeking_emb: seekingEmb,
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    if (error) throw error;

    return json({ ok: true });
  });
