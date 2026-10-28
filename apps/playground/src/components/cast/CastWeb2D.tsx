import { useEffect, useMemo, useRef, useState } from "react";
import { RING_RADIUS, TIERS, TIER_LABEL, webLayout, type CharacterWeb, type Placed, type WebEdge } from "../../data/castWeb";

const SIZE = 1000, HALF = SIZE / 2, SCALE = HALF * 0.78, LABEL_ANGLE = (-125 * Math.PI) / 180;

/** Glides from the last drawn layout to the new one, so scope changes read as motion, not jumps. */
function useTweened(target: Map<string, Placed>, still: boolean, duration = 650) {
  const [shown, setShown] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (still) { from.current = target; setShown(target); return; }
    const start = performance.now(), origin = from.current;
    let frame = 0;
    const ease = (t: number) => 1 - Math.pow(1 - t, 3);
    const step = (now: number) => {
      // A frame timestamp can precede the effect's clock reading; clamp so the ease never runs backwards.
      const t = ease(Math.min(1, Math.max(0, (now - start) / duration)));
      const next = new Map<string, Placed>();
      for (const [id, to] of target) {
        const was = origin.get(id) ?? { x: to.x * 1.15, y: to.y * 1.15, r: 0 };
        next.set(id, { x: was.x + (to.x - was.x) * t, y: was.y + (to.y - was.y) * t, r: was.r + (to.r - was.r) * t });
      }
      from.current = next;
      setShown(next);
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [target, still, duration]);
  return shown;
}

interface Props {
  web: CharacterWeb;
  selected: string[];
  reducedMotion: boolean;
  /** The watched pair's tie: it flows while their story plays. */
  pulse?: string;
  onPick: (id: string, additive: boolean) => void;
  /** Double-click: follow this character's journey. */
  onOpen?: (id: string) => void;
}

export function CastWeb2D({ web, selected, reducedMotion, pulse, onPick, onOpen }: Props) {
  const layout = useMemo(() => webLayout(web), [web]);
  const shown = useTweened(layout, reducedMotion);
  const [hover, setHover] = useState<string | null>(null);
  const focus = hover ?? (selected.length === 1 ? selected[0] : null);
  const strongest = Math.max(1, ...web.edges.map((edge) => edge.weight));
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of web.edges) {
      map.set(edge.a, new Set([...map.get(edge.a) ?? [], edge.b]));
      map.set(edge.b, new Set([...map.get(edge.b) ?? [], edge.a]));
    }
    return map;
  }, [web]);
  const pairEdge = selected.length === 2 ? web.edges.find((edge) => selected.includes(edge.a) && selected.includes(edge.b))?.id : undefined;
  const lit = (edge: WebEdge) => pairEdge ? edge.id === pairEdge : focus ? edge.a === focus || edge.b === focus : true;
  const crowded = web.nodes.filter((node) => node.tier === "cameo").length > 28;
  const point = (id: string) => { const p = shown.get(id); return p ? { x: HALF + p.x * SCALE, y: HALF + p.y * SCALE, r: p.r * SCALE } : null; };

  return (
    <svg className="web" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Relation web of ${web.nodes.length} characters`}
      onMouseLeave={() => setHover(null)}>
      <defs>
        {web.nodes.filter((node) => node.portrait).map((node) => (
          <pattern key={node.id} id={`p-${cssId(node.id)}`} width="1" height="1" patternContentUnits="objectBoundingBox">
            <image href={node.portrait} width="1" height="1" preserveAspectRatio="xMidYMid slice" />
          </pattern>
        ))}
      </defs>
      {TIERS.map((tier) => (
        <g key={tier} className={`ring ring-${tier}`}>
          <circle cx={HALF} cy={HALF} r={RING_RADIUS[tier] * SCALE} />
          {/* Labels sit at about 10 o'clock, where the rings are least crowded. */}
          <text x={HALF + Math.cos(LABEL_ANGLE) * RING_RADIUS[tier] * SCALE} y={HALF + Math.sin(LABEL_ANGLE) * RING_RADIUS[tier] * SCALE}
            transform={`rotate(${(LABEL_ANGLE * 180) / Math.PI + 90} ${HALF + Math.cos(LABEL_ANGLE) * RING_RADIUS[tier] * SCALE} ${HALF + Math.sin(LABEL_ANGLE) * RING_RADIUS[tier] * SCALE})`} dy="-6">{TIER_LABEL[tier]}</text>
        </g>
      ))}
      <g className="edges">
        {web.edges.map((edge) => {
          const a = point(edge.a), b = point(edge.b);
          if (!a || !b) return null;
          // Ties bow toward the centre, so they pass inside the rings rather than along them.
          const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          const cx = mx + (HALF - mx) * 0.35, cy = my + (HALF - my) * 0.35;
          const width = 0.6 + 5.4 * (Math.log1p(edge.weight) / Math.log1p(strongest));
          const on = lit(edge);
          return <path key={edge.id} className={`tie tone-${edge.tone}${edge.id === pulse ? " is-pulse" : ""}${on ? " is-lit" : ""}${focus || pairEdge ? (on ? " is-focus" : " is-dim") : ""}`}
            d={`M${a.x},${a.y} Q${cx},${cy} ${b.x},${b.y}`} strokeWidth={width}
            style={{ opacity: focus || pairEdge ? (on ? 0.95 : 0.04) : 0.12 + 0.6 * (edge.weight / strongest) ** 0.5 }} />;
        })}
      </g>
      <g className="nodes">
        {web.nodes.map((node) => {
          const p = point(node.id);
          if (!p) return null;
          const chosen = selected.includes(node.id);
          const near = !focus || node.id === focus || neighbours.get(focus)?.has(node.id);
          // Inner rings label below the disc; outer rings label outward, away from the ties.
          const dx = p.x - HALF, dy = p.y - HALF, out = Math.hypot(dx, dy);
          const outward = node.tier === "connector" || node.tier === "cameo";
          // A crowded outer ring names only what is in play; hovering names anyone.
          const named = !(node.tier === "cameo" && crowded) || chosen || node.id === focus || !!(focus && neighbours.get(focus)?.has(node.id));
          const lx = outward && out ? (dx / out) * (p.r + 10) : 0, ly = outward && out ? (dy / out) * (p.r + 10) : p.r + 16;
          return (
            <g key={node.id} className={`node tier-${node.tier}${chosen ? " is-chosen" : ""}${near ? "" : " is-far"}`} transform={`translate(${p.x} ${p.y})`}
              tabIndex={0} role="button" aria-label={`${node.name}, ${TIER_LABEL[node.tier]}, rank ${node.rank}`}
              onMouseEnter={() => setHover(node.id)} onFocus={() => setHover(node.id)} onBlur={() => setHover(null)}
              onClick={(event) => onPick(node.id, event.shiftKey || event.metaKey)}
              onDoubleClick={() => onOpen?.(node.id)}
              onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); onPick(node.id, event.shiftKey); } }}>
              <circle className="halo" r={p.r + 7} />
              <circle className="disc" r={p.r} style={node.portrait ? { fill: `url(#p-${cssId(node.id)})` } : undefined} />
              {!node.portrait && <text className="glyph" dy="0.35em" style={{ fontSize: Math.max(11, p.r * 0.9) }}>{[...node.name][0]}</text>}
              {named && <text className={`name${outward ? " is-outer" : ""}`} x={lx} y={ly} dy={outward ? "0.35em" : undefined}
                textAnchor={outward ? (Math.abs(dx) < 12 ? "middle" : dx > 0 ? "start" : "end") : "middle"}>{node.name}</text>}
            </g>
          );
        })}
      </g>
    </svg>
  );
}

const cssId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");
