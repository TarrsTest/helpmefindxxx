import type { SupabaseClient } from '@supabase/supabase-js';
import { blurGeohash, decodeGeohash } from '@/lib/geohash';

// Graph data for the map (SPEC §5). Coordinates are ALWAYS blurred to the
// node's own loc_precision — precise coords never leave the DB (SPEC §7.1).
// Nodes carry handle only; contact is never part of graph output.

export interface GraphNode {
  id: string;
  handle: string;
  geohash: string; // blurred cell
  lat: number; // center of the blurred cell
  lng: number;
}

export interface GraphEdge {
  source: string;
  target: string;
}

export const loadGraph = async (
  db: SupabaseClient,
): Promise<{ nodes: GraphNode[]; edges: GraphEdge[] }> => {
  const [{ data: users }, { data: edges }] = await Promise.all([
    db.from('users').select('id, handle, geohash, loc_precision'),
    db
      .from('connections')
      .select('requester_id, target_id')
      .eq('status', 'accepted'),
  ]);

  const nodes: GraphNode[] = (users ?? [])
    .filter((u) => u.geohash)
    .map((u) => {
      const cell = blurGeohash(u.geohash as string, u.loc_precision ?? 5);
      const { lat, lng } = decodeGeohash(cell);
      return { id: u.id, handle: u.handle, geohash: cell, lat, lng };
    });

  // Only edges whose BOTH endpoints made it into nodes — a user without a
  // geohash isn't on the map, so an edge to them would dangle.
  const placed = new Set(nodes.map((n) => n.id));

  return {
    nodes,
    edges: (edges ?? [])
      .filter((e) => placed.has(e.requester_id) && placed.has(e.target_id))
      .map((e) => ({ source: e.requester_id, target: e.target_id })),
  };
};
