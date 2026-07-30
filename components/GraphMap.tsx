'use client';

import { useMemo, useState } from 'react';
import type { GraphNode, GraphEdge } from '@/lib/graph';

// Zero-dependency SVG map of the social graph (SPEC §5). Coordinates
// arrive already blurred to each node's geohash cell — this component
// only projects + draws them, it never sees precise positions.

const W = 900;
const H = 560;
const PAD = 48;

export default function GraphMap({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const [hover, setHover] = useState<string | null>(null);

  const positioned = useMemo(() => {
    if (nodes.length === 0) return { pts: new Map<string, { x: number; y: number }>(), pts2: [] as (GraphNode & { x: number; y: number })[] };
    const lats = nodes.map((n) => n.lat);
    const lngs = nodes.map((n) => n.lng);
    const minLat = Math.min(...lats),
      maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs),
      maxLng = Math.max(...lngs);
    const spanLat = maxLat - minLat || 1;
    const spanLng = maxLng - minLng || 1;

    const pts = new Map<string, { x: number; y: number }>();
    const pts2 = nodes.map((n) => {
      const x = PAD + ((n.lng - minLng) / spanLng) * (W - 2 * PAD);
      // invert lat so north is up
      const y = PAD + ((maxLat - n.lat) / spanLat) * (H - 2 * PAD);
      pts.set(n.id, { x, y });
      return { ...n, x, y };
    });
    return { pts, pts2 };
  }, [nodes]);

  if (nodes.length === 0) {
    return (
      <div className="flex items-center justify-center h-[560px] text-zinc-500">
        No nodes yet — register an agent and set a location to appear here.
      </div>
    );
  }

  const hovered = positioned.pts2.find((n) => n.id === hover);

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="w-full rounded-xl bg-zinc-950 border border-zinc-800"
      >
        {edges.map((e, i) => {
          const a = positioned.pts.get(e.source);
          const b = positioned.pts.get(e.target);
          if (!a || !b) return null;
          return (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#3f3f6e"
              strokeWidth={1.5}
            />
          );
        })}
        {positioned.pts2.map((n) => (
          <g
            key={n.id}
            onMouseEnter={() => setHover(n.id)}
            onMouseLeave={() => setHover(null)}
            className="cursor-pointer"
          >
            <circle
              cx={n.x}
              cy={n.y}
              r={hover === n.id ? 9 : 6}
              fill={hover === n.id ? '#a78bfa' : '#7c5cff'}
              stroke="#0a0a0a"
              strokeWidth={2}
            />
          </g>
        ))}
      </svg>
      {hovered && (
        <div
          className="pointer-events-none absolute px-2 py-1 rounded-md bg-white text-zinc-900 text-xs font-medium shadow"
          style={{
            left: `${(hovered.x / W) * 100}%`,
            top: `${(hovered.y / H) * 100}%`,
            transform: 'translate(-50%, -140%)',
          }}
        >
          @{hovered.handle} · {hovered.geohash}
        </div>
      )}
    </div>
  );
}
