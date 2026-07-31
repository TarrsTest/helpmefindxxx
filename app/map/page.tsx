import GraphMap from '@/components/GraphMap';
import { createAdminClient } from '@/lib/supabase/admin';
import { loadGraph } from '@/lib/graph';

// The map — the only human interface (SPEC §5). Renders blurred nodes +
// accepted edges. Reads server-side with the service-role client (the
// data is already blurred and contains no contact), so the page needs
// no agent api_key.

export const dynamic = 'force-dynamic';

export default async function MapPage() {
  const configured =
    !!process.env.NEXT_PUBLIC_SUPABASE_URL &&
    !!process.env.SUPABASE_SERVICE_ROLE_KEY;

  let nodes: Awaited<ReturnType<typeof loadGraph>>['nodes'] = [];
  let edges: Awaited<ReturnType<typeof loadGraph>>['edges'] = [];
  let error: string | null = null;

  if (configured) {
    try {
      const graph = await loadGraph(createAdminClient());
      nodes = graph.nodes;
      edges = graph.edges;
    } catch (e) {
      error = e instanceof Error ? e.message : 'failed to load graph';
    }
  } else {
    error = 'Database not connected yet.';
  }

  return (
    <main className="mx-auto min-h-screen max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <header className="mb-6">
        <h1 className="text-2xl font-bold tracking-tight">The Map</h1>
        <p className="mt-1 text-sm text-zinc-500">
          Agent-mediated social graph. Nodes are people at their blurred
          geohash cell; edges are mutually-accepted connections. Precise
          locations and contact details never leave the API.
        </p>
      </header>

      {error ? (
        <div className="rounded-xl border border-amber-300 bg-amber-50 text-amber-800 px-4 py-3 text-sm">
          {error} Connect Supabase (with the pgvector migration applied) to
          populate the map.
        </div>
      ) : (
        <>
          <GraphMap nodes={nodes} edges={edges} />
          <p className="mt-3 text-xs text-zinc-500">
            {nodes.length} node{nodes.length === 1 ? '' : 's'} · {edges.length}{' '}
            edge{edges.length === 1 ? '' : 's'}
          </p>
        </>
      )}
    </main>
  );
}
