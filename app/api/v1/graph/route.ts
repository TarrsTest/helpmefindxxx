import { authenticate } from '@/lib/api/auth';
import { loadGraph } from '@/lib/graph';
import { json, handle } from '@/lib/api/http';

// GET /v1/graph — map data: nodes + accepted edges, coordinates blurred
// (SPEC §3 / §5). Precise coordinates never leave the DB (SPEC §7.1).
// Contact is never part of graph output.

export const runtime = 'nodejs';

export const GET = (request: Request) =>
  handle(async () => {
    const { db } = await authenticate(request);
    const graph = await loadGraph(db);
    return json(graph);
  });
