'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import type { GraphNode, GraphEdge } from '@/lib/graph';

// Zero-dependency SVG map of the social graph (SPEC §5). Coordinates
// arrive already blurred to each node's geohash cell — this component
// only projects + draws them, it never sees precise positions.
//
// This is a HUMAN surface, so it shows no match scores of any kind, by
// design (they aren't in GraphNode/GraphEdge and must not be added).
//
// Interaction is hand-rolled on pointer events so the whole thing stays
// dependency-free: drag to pan, wheel or pinch to zoom, tap to select.
// Nodes that land within CLUSTER_PX of each other merge into one bubble —
// necessary because blurring puts everyone in a city on identical
// coordinates, which would otherwise render as a single dot.

const W = 900;
const H = 560;
const PAD = 56;

const MIN_K = 1;
const MAX_K = 12;
const CLUSTER_PX = 44; // merge radius in screen px, constant across zoom
const NODE_R = 6;

type Pt = { x: number; y: number };
type View = { x: number; y: number; k: number };

type Cluster = {
  id: string;
  x: number;
  y: number;
  members: (GraphNode & Pt)[];
};

const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

export default function GraphMap({
  nodes,
  edges,
}: {
  nodes: GraphNode[];
  edges: GraphEdge[];
}) {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [selected, setSelected] = useState<string | null>(null);

  // Live pointer bookkeeping for pan + pinch. Refs, not state — these
  // change on every move and must not trigger re-renders.
  const pointers = useRef(new Map<number, Pt>());
  const panFrom = useRef<{ p: Pt; view: View } | null>(null);
  const pinchFrom = useRef<{ dist: number; mid: Pt; view: View } | null>(null);
  const moved = useRef(false);

  // --- projection: lat/lng -> the fixed W×H canvas (zoom-independent) ---
  const projected = useMemo(() => {
    if (nodes.length === 0) return [] as (GraphNode & Pt)[];
    const lats = nodes.map((n) => n.lat);
    const lngs = nodes.map((n) => n.lng);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    const spanLat = maxLat - minLat;
    const spanLng = maxLng - minLng;

    return nodes.map((n) => ({
      ...n,
      // A zero span means every node shares a coordinate — centre them
      // rather than pinning the whole graph to the padding corner.
      x: PAD + (spanLng ? (n.lng - minLng) / spanLng : 0.5) * (W - 2 * PAD),
      // invert lat so north is up
      y: PAD + (spanLat ? (maxLat - n.lat) / spanLat : 0.5) * (H - 2 * PAD),
    }));
  }, [nodes]);

  // --- clustering: grid cells sized in screen px, so zooming in splits
  // clusters apart naturally ---
  const clusters = useMemo(() => {
    const cell = CLUSTER_PX / view.k;
    const buckets = new Map<string, (GraphNode & Pt)[]>();
    for (const n of projected) {
      const key = `${Math.floor(n.x / cell)}:${Math.floor(n.y / cell)}`;
      const bucket = buckets.get(key);
      if (bucket) bucket.push(n);
      else buckets.set(key, [n]);
    }
    const out: Cluster[] = [];
    for (const members of buckets.values()) {
      const x = members.reduce((s, m) => s + m.x, 0) / members.length;
      const y = members.reduce((s, m) => s + m.y, 0) / members.length;
      // Stable id: the lowest member id, so selection survives a re-cluster
      // as long as the same members are grouped.
      const id = members.map((m) => m.id).sort()[0];
      out.push({ id, x, y, members });
    }
    return out;
  }, [projected, view.k]);

  const clusterOf = useMemo(() => {
    const m = new Map<string, Cluster>();
    for (const c of clusters) for (const n of c.members) m.set(n.id, c);
    return m;
  }, [clusters]);

  // Edges collapse to cluster-to-cluster links; drop intra-cluster edges
  // (both ends already merged into one bubble) and de-dupe parallels.
  const clusterEdges = useMemo(() => {
    const seen = new Set<string>();
    const out: { a: Cluster; b: Cluster }[] = [];
    for (const e of edges) {
      const a = clusterOf.get(e.source);
      const b = clusterOf.get(e.target);
      if (!a || !b || a.id === b.id) continue;
      const key = a.id < b.id ? `${a.id}|${b.id}` : `${b.id}|${a.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ a, b });
    }
    return out;
  }, [edges, clusterOf]);

  // --- zoom helpers ---

  // Convert a client (screen) point into viewBox coordinates.
  const toLocal = useCallback((clientX: number, clientY: number): Pt => {
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect || rect.width === 0) return { x: 0, y: 0 };
    const s = W / rect.width; // uniform: viewBox aspect == rendered aspect
    return { x: (clientX - rect.left) * s, y: (clientY - rect.top) * s };
  }, []);

  // Zoom by `factor` while keeping the world point under `focus` fixed.
  const zoomAt = useCallback((focus: Pt, factor: number, from?: View) => {
    setView((cur) => {
      const base = from ?? cur;
      const k = clamp(base.k * factor, MIN_K, MAX_K);
      const world = { x: (focus.x - base.x) / base.k, y: (focus.y - base.y) / base.k };
      return { k, x: focus.x - world.x * k, y: focus.y - world.y * k };
    });
  }, []);

  const zoomCentre = (factor: number) =>
    zoomAt({ x: W / 2, y: H / 2 }, factor);

  const reset = () => {
    setView({ x: 0, y: 0, k: 1 });
    setSelected(null);
  };

  // --- pointer handling: 1 pointer = pan, 2 = pinch ---

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    (e.target as Element).setPointerCapture?.(e.pointerId);
    pointers.current.set(e.pointerId, toLocal(e.clientX, e.clientY));
    moved.current = false;

    if (pointers.current.size === 1) {
      panFrom.current = { p: toLocal(e.clientX, e.clientY), view };
      pinchFrom.current = null;
    } else if (pointers.current.size === 2) {
      const [p1, p2] = [...pointers.current.values()];
      pinchFrom.current = {
        dist: Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1,
        mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
        view,
      };
      panFrom.current = null;
    }
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pointers.current.has(e.pointerId)) return;
    const p = toLocal(e.clientX, e.clientY);
    pointers.current.set(e.pointerId, p);

    if (pinchFrom.current && pointers.current.size >= 2) {
      const [p1, p2] = [...pointers.current.values()];
      const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1;
      moved.current = true;
      zoomAt(pinchFrom.current.mid, dist / pinchFrom.current.dist, pinchFrom.current.view);
      return;
    }

    if (panFrom.current) {
      const dx = p.x - panFrom.current.p.x;
      const dy = p.y - panFrom.current.p.y;
      if (Math.abs(dx) > 2 || Math.abs(dy) > 2) moved.current = true;
      setView({
        k: panFrom.current.view.k,
        x: panFrom.current.view.x + dx,
        y: panFrom.current.view.y + dy,
      });
    }
  };

  const onPointerUp = (e: React.PointerEvent<SVGSVGElement>) => {
    pointers.current.delete(e.pointerId);
    if (pointers.current.size < 2) pinchFrom.current = null;
    if (pointers.current.size === 0) panFrom.current = null;
  };

  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => {
    // Trackpad/mouse zoom about the cursor. Not passive-safe to
    // preventDefault here, so the container also sets overscroll rules.
    const focus = toLocal(e.clientX, e.clientY);
    zoomAt(focus, e.deltaY < 0 ? 1.15 : 1 / 1.15);
  };

  if (nodes.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-zinc-700 bg-zinc-950/50 px-6 py-16 text-center sm:py-24">
        <svg width="34" height="34" viewBox="0 0 24 24" fill="none" aria-hidden>
          <circle cx="7" cy="8" r="2.5" stroke="#52525b" strokeWidth="1.5" />
          <circle cx="17" cy="15" r="2.5" stroke="#52525b" strokeWidth="1.5" />
          <path d="M9 9.5 15 13.5" stroke="#3f3f46" strokeWidth="1.5" strokeDasharray="2 2" />
        </svg>
        <p className="text-sm font-medium text-zinc-300">Nobody on the map yet</p>
        <p className="max-w-xs text-xs text-zinc-500">
          People appear once their agent registers them with a location.
          Connections appear once both sides accept.
        </p>
      </div>
    );
  }

  const sel = selected ? clusters.find((c) => c.id === selected) ?? null : null;

  return (
    <div className="relative select-none">
      <svg
        ref={svgRef}
        viewBox={`0 0 ${W} ${H}`}
        className="w-full touch-none rounded-xl border border-zinc-800 bg-zinc-950"
        style={{ cursor: panFrom.current ? 'grabbing' : 'grab' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
        role="img"
        aria-label={`Social graph map: ${nodes.length} people, ${edges.length} connections`}
      >
        {/* Background catches taps that aren't on a node, to deselect. */}
        <rect
          width={W}
          height={H}
          fill="transparent"
          onClick={() => {
            if (!moved.current) setSelected(null);
          }}
        />

        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {clusterEdges.map(({ a, b }, i) => (
            <line
              key={i}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke="#3f3f6e"
              strokeWidth={1.5 / view.k}
            />
          ))}

          {clusters.map((c) => {
            const many = c.members.length > 1;
            const isSel = sel?.id === c.id;
            // Radii/strokes are divided by k so they stay a constant size
            // on screen no matter how far the user has zoomed.
            const r = (many ? Math.min(16, 7 + c.members.length) : NODE_R) / view.k;
            return (
              <g
                key={c.id}
                className="cursor-pointer"
                onClick={() => {
                  if (!moved.current) setSelected(isSel ? null : c.id);
                }}
              >
                {/* Invisible, generous hit area — thumb-sized on mobile. */}
                <circle cx={c.x} cy={c.y} r={18 / view.k} fill="transparent" />
                <circle
                  cx={c.x}
                  cy={c.y}
                  r={r}
                  fill={isSel ? '#a78bfa' : '#7c5cff'}
                  stroke="#0a0a0a"
                  strokeWidth={2 / view.k}
                />
                {many && (
                  <text
                    x={c.x}
                    y={c.y}
                    textAnchor="middle"
                    dominantBaseline="central"
                    fontSize={11 / view.k}
                    fontWeight={600}
                    fill="#0a0a0a"
                    pointerEvents="none"
                  >
                    {c.members.length}
                  </text>
                )}
              </g>
            );
          })}

          {/* Label drawn inside the SVG (counter-scaled) so it tracks the
              node through pan/zoom without any HTML overlay math. */}
          {sel && (
            <g
              transform={`translate(${sel.x} ${sel.y}) scale(${1 / view.k})`}
              pointerEvents="none"
            >
              {(() => {
                const many = sel.members.length > 1;
                const title = many
                  ? `${sel.members.length} people`
                  : `@${sel.members[0].handle}`;
                // Blurring puts everyone in a cell on identical coordinates,
                // so a co-located cluster never splits on zoom — list the
                // members here or there'd be no way to see who is in it.
                const subs = many
                  ? [
                      ...sel.members.slice(0, 3).map((m) => `@${m.handle}`),
                      ...(sel.members.length > 3
                        ? [`+${sel.members.length - 3} more`]
                        : []),
                      sel.members[0].geohash,
                    ]
                  : [sel.members[0].geohash];

                const lineH = 13;
                const boxH = 21 + subs.length * lineH;
                const wpx =
                  Math.max(title.length, ...subs.map((s) => s.length)) * 6.6 + 18;
                const top = -boxH - 12;
                return (
                  <>
                    <rect
                      x={-wpx / 2}
                      y={top}
                      width={wpx}
                      height={boxH}
                      rx={7}
                      fill="#ffffff"
                    />
                    <text
                      x={0}
                      y={top + 15}
                      textAnchor="middle"
                      fontSize={12}
                      fontWeight={600}
                      fill="#18181b"
                    >
                      {title}
                    </text>
                    {subs.map((s, i) => (
                      <text
                        key={i}
                        x={0}
                        y={top + 28 + i * lineH}
                        textAnchor="middle"
                        fontSize={10}
                        fill="#71717a"
                      >
                        {s}
                      </text>
                    ))}
                  </>
                );
              })()}
            </g>
          )}
        </g>
      </svg>

      {/* Zoom controls — the touch-accessible path to zoom, and the only
          way to reset after wandering off. */}
      <div className="absolute right-2 top-2 flex flex-col gap-1">
        {[
          { label: '+', title: 'Zoom in', fn: () => zoomCentre(1.4) },
          { label: '−', title: 'Zoom out', fn: () => zoomCentre(1 / 1.4) },
          { label: '⟲', title: 'Reset view', fn: reset },
        ].map((b) => (
          <button
            key={b.label}
            type="button"
            onClick={b.fn}
            title={b.title}
            aria-label={b.title}
            className="h-9 w-9 rounded-lg border border-zinc-700 bg-zinc-900/90 text-base text-zinc-300 backdrop-blur transition-colors hover:bg-zinc-800 hover:text-white active:bg-zinc-700"
          >
            {b.label}
          </button>
        ))}
      </div>

      <p className="mt-2 text-center text-[11px] text-zinc-600 sm:text-left">
        Drag to pan · scroll or pinch to zoom · tap a dot for details
        {view.k > 1 && ` · ${view.k.toFixed(1)}×`}
      </p>
    </div>
  );
}
