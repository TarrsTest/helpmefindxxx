import { authenticate } from '@/lib/api/auth';
import { json, fail, handle } from '@/lib/api/http';

// POST /v1/connections/:id/respond
//   { action: 'accept' | 'decline', responder?: 'human' | 'agent' }
// (SPEC §3 / §4). Only the target of a pending request may respond.
//   accept  → status accepted; contacts now exchangeable (SPEC §4).
//   decline → status declined; contact never exposed.
//
// SPEC §8.2 (open): respond by human or agent? v0 lets the agent respond
// via this endpoint — the network can grow unattended. If that boundary
// tightens later (e.g. accept must be human-confirmed), it's enforced
// here, no schema change.
//
// `responder` is optional and SELF-DECLARED — every request here carries an
// api_key, so the server genuinely cannot tell an agent acting alone from
// one relaying its human's decision. It is recorded rather than enforced
// because these outcomes are the data w1 / w2 get fitted on: accepts made
// by an agent on its own measure agent policy, not human preference, and
// pooling the two would tune the ranking to machine habits. Declaring it
// costs a caller nothing and keeps the two populations separable whichever
// way §8.2 is decided.

export const runtime = 'nodejs';

export const POST = (
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) =>
  handle(async () => {
    const { db, userId } = await authenticate(request);
    const { id } = await params;

    const body = await request.json().catch(() => null);
    const action = String(body?.action ?? '');
    if (action !== 'accept' && action !== 'decline')
      return fail(400, "action must be 'accept' or 'decline'");

    // Absent → null (undeclared), which is a distinct and honest state from
    // either 'human' or 'agent'. A bad value is rejected rather than
    // silently dropped: a caller that thinks it is labelling its data
    // should not find out months later that it wasn't.
    const responder = body?.responder === undefined ? null : String(body.responder);
    if (responder !== null && responder !== 'human' && responder !== 'agent')
      return fail(400, "responder must be 'human' or 'agent' when present");

    const { data: conn } = await db
      .from('connections')
      .select('id, requester_id, target_id, status')
      .eq('id', id)
      .maybeSingle();
    if (!conn) return fail(404, 'connection not found');
    if (conn.target_id !== userId)
      return fail(403, 'only the target can respond');
    if (conn.status !== 'pending')
      return fail(409, `connection is already ${conn.status}`);

    const newStatus = action === 'accept' ? 'accepted' : 'declined';
    const { error } = await db
      .from('connections')
      .update({
        status: newStatus,
        responded_at: new Date().toISOString(),
        responder_kind: responder,
      })
      .eq('id', id);
    if (error) throw error;

    // On accept, surface the requester's contact now that it's mutual.
    let contact: unknown = null;
    if (newStatus === 'accepted') {
      const { data: requester } = await db
        .from('users')
        .select('contact')
        .eq('id', conn.requester_id)
        .maybeSingle();
      contact = requester?.contact ?? null;
    }

    return json({ id, status: newStatus, contact });
  });
