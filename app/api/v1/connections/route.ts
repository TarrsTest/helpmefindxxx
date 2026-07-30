import { authenticate } from '@/lib/api/auth';
import { MATCH_W1, MATCH_W2, MATCH_HALF_LIFE_KM } from '@/lib/config';
import { json, fail, handle, ApiError } from '@/lib/api/http';

// GET  /v1/connections — all my connections incl. pending (SPEC §3).
//   contact is included ONLY on accepted edges (SPEC §4).
// POST /v1/connections — initiate a request { target_id } → pending.

export const runtime = 'nodejs';

export const GET = (request: Request) =>
  handle(async () => {
    const { db, userId } = await authenticate(request);

    const { data, error } = await db
      .from('connections')
      .select(
        'id, requester_id, target_id, status, match_score, created_at, responded_at, ' +
          'requester:requester_id(handle, contact), target:target_id(handle, contact)',
      )
      .or(`requester_id.eq.${userId},target_id.eq.${userId}`)
      .order('created_at', { ascending: false });
    if (error) throw error;

    type Party = { handle: string; contact: unknown } | null;
    type Row = {
      id: string;
      requester_id: string;
      target_id: string;
      status: string;
      match_score: number | null;
      created_at: string;
      responded_at: string | null;
      requester: Party;
      target: Party;
    };

    const connections = (data as unknown as Row[]).map((c) => {
      const outgoing = c.requester_id === userId;
      const other = outgoing ? c.target : c.requester;
      const accepted = c.status === 'accepted';
      return {
        id: c.id,
        direction: outgoing ? 'outgoing' : 'incoming',
        status: c.status,
        match_score: c.match_score,
        other_id: outgoing ? c.target_id : c.requester_id,
        other_handle: other?.handle ?? null,
        // Contact gate: exposed only on mutual accept (SPEC §4 / §7.3).
        contact: accepted ? (other?.contact ?? null) : null,
        created_at: c.created_at,
        responded_at: c.responded_at,
      };
    });

    return json({ connections });
  });

export const POST = (request: Request) =>
  handle(async () => {
    const { db, userId } = await authenticate(request);

    const body = await request.json().catch(() => null);
    const targetId = String(body?.target_id ?? '').trim();
    if (!targetId) return fail(400, 'target_id is required');
    if (targetId === userId) return fail(400, 'cannot connect to yourself');

    const { data: target } = await db
      .from('users')
      .select('id')
      .eq('id', targetId)
      .maybeSingle();
    if (!target) return fail(404, 'target not found');

    // No live edge already in either direction.
    const { data: existing } = await db
      .from('connections')
      .select('id')
      .or(
        `and(requester_id.eq.${userId},target_id.eq.${targetId}),` +
          `and(requester_id.eq.${targetId},target_id.eq.${userId})`,
      )
      .maybeSingle();
    if (existing) throw new ApiError(409, 'connection already exists');

    const { data: score } = await db.rpc('pair_score', {
      p_a: userId,
      p_b: targetId,
      p_w1: MATCH_W1,
      p_w2: MATCH_W2,
      p_half_life_km: MATCH_HALF_LIFE_KM,
    });

    const { data: conn, error } = await db
      .from('connections')
      .insert({
        requester_id: userId,
        target_id: targetId,
        status: 'pending',
        match_score: score ?? null,
      })
      .select('id, status, match_score, created_at')
      .single();
    if (error) {
      if (error.code === '23505') return fail(409, 'connection already exists');
      throw error;
    }

    return json({ connection: conn }, 201);
  });
