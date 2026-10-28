import type { WorldEdge, WorldNode } from "../types.js";
import { BREAKDOWN_LABEL, RING_RADIUS, TIERS, TIER_LABEL, webLayout3d, type Breakdown, type CharacterWeb, type WebEdge } from "./castWeb.js";
import type { OrbitalDraw, OrbitalPath } from "./orbitalLayout.js";
import type { FloorMark, OrbitalArrangement, RegroupedWorld } from "./orbitalTimePlace.js";
import type { Position3 } from "./spatialLayout.js";

/**
 * Orbital Characters (view only), the third regrouping beside Story time and
 * Places: one sphere per character, holding the scenes they are in, so
 * entering a character shows their own line through the book in reading
 * order, exactly as entering a chapter does. The arrangement stands the
 * spheres on an amphitheater (protagonists on the top step, groups on one
 * side), lays the tier rings on the floor and draws ties as orbit paths.
 * Nothing here is written back to the ontology.
 */
interface WorldLike { interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }> }

export const castNodeId = (characterId: string) => `cast:${characterId}`;
export const castCharacterId = (nodeId: string) => nodeId.startsWith("cast:") ? nodeId.slice(5) : null;
/** The world's own scene id for a cast scene (`v1:scene_001` → `scene_001`). */
const worldScene = (sceneId: string) => sceneId.slice(sceneId.indexOf(":") + 1);

const PARTS = Object.keys(BREAKDOWN_LABEL) as (keyof Breakdown)[];

export function castWorld(world: WorldLike, web: CharacterWeb): RegroupedWorld {
  // Each scene with its records and the people and places around them, by the world's scene id.
  const bundles = new Map<string, { nodes: WorldNode[]; edges: WorldEdge[] }>();
  for (const interior of Object.values(world.interiors)) {
    const byId = new Map(interior.nodes.map((node) => [node.id, node]));
    for (const scene of interior.nodes.filter((node) => node.kind === "scene")) {
      const members = new Set([scene.id]);
      for (const edge of interior.edges) if (edge.kind === "contains" && edge.from === scene.id && byId.has(edge.to)) members.add(edge.to);
      bundles.set(scene.id, { nodes: [...members].map((id) => byId.get(id)!), edges: interior.edges.filter((edge) => members.has(edge.from) && members.has(edge.to)) });
    }
  }
  const result: RegroupedWorld = { laneNodes: [], laneEdges: [], interiors: {}, bigEventLabels: {} };
  for (const node of web.nodes) {
    const id = castNodeId(node.id);
    const parts = PARTS.map((part) => `${BREAKDOWN_LABEL[part].toLowerCase()} ${Math.round(node.breakdown[part] * 100)}`).join(" · ");
    const summary = `${TIER_LABEL[node.tier].replace(/s$/, "")} · #${node.rank} · connection ${Math.round(node.score * 100)} — ${node.raw.scenes} scene${node.raw.scenes === 1 ? "" : "s"}, ${node.raw.partners} tie${node.raw.partners === 1 ? "" : "s"} (${parts})`;
    result.laneNodes.push({ id, label: node.name, viewKind: "Character", kind: "bigEvent", state: "canon", parent: null, lane: "canon", chrono: node.rank, trackId: `cast:${node.tier}`, trackLabel: TIER_LABEL[node.tier], summary, subLabel: summary, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
    result.bigEventLabels[id] = node.name;
    // Inside: their scenes in reading order, each with its records.
    const nodes = new Map<string, WorldNode>(), edges = new Map<string, WorldEdge>();
    for (const scene of web.scenes.filter((entry) => entry.present.includes(node.id))) {
      const local = worldScene(scene.id), bundle = bundles.get(local);
      if (!bundle) continue;
      for (const member of bundle.nodes) if (!nodes.has(member.id)) nodes.set(member.id, { ...member, parent: id, ...(member.id === local ? { chrono: scene.reading } : {}) });
      for (const edge of bundle.edges) edges.set(edge.id, { ...edge, parent: id });
    }
    result.interiors[id] = { nodes: [...nodes.values()], edges: [...edges.values()] };
  }
  return result;
}

/** Layout units per unit of the web's plan (the orbit scales anchors ×3 into world units). */
const UNIT = 430;

/** A tie bowed over the floor toward the heart, so crossings part in height. */
function arc(a: Position3, b: Position3, segments = 18): Position3[] {
  const mid: Position3 = [(a[0] + b[0]) / 2 * 0.62, Math.max(a[1], b[1]) + 120 + 0.12 * Math.hypot(a[0] - b[0], a[2] - b[2]), (a[2] + b[2]) / 2 * 0.62];
  return Array.from({ length: segments + 1 }, (_, index) => {
    const t = index / segments, u = 1 - t;
    return [0, 1, 2].map((axis) => u * u * a[axis] + 2 * u * t * mid[axis] + t * t * b[axis]) as Position3;
  });
}

export interface CastFocus {
  /** The pair being compared; its tie is drawn as a thread, or as a moving route while watched. */
  pair?: [string, string] | null;
  watching?: boolean;
  /** How many of the strongest ties stand when nobody is selected. */
  ties?: number;
}

export function castArrangement(web: CharacterWeb, focus: CastFocus = {}): OrbitalArrangement {
  const plan = webLayout3d(web);
  const anchors = new Map<string, Position3>();
  for (const [id, point] of plan) anchors.set(castNodeId(id), [point.x * UNIT, point.y * UNIT * 1.6, point.z * UNIT]);
  const floor: FloorMark[] = [...TIERS].reverse().map((tier, depth) => ({
    id: `cast-ring:${tier}`, x: 0, z: 0, radius: (RING_RADIUS[tier] + 0.09) * UNIT * 3, active: web.nodes.some((node) => node.tier === tier), depth, region: true,
  }));
  const pairKey = focus.pair ? [...focus.pair].sort().join("|") : null;
  const tieOf = (edge: WebEdge) => [castNodeId(edge.a), castNodeId(edge.b)];
  const strongest = web.edges.slice(0, focus.ties ?? 24);
  return {
    anchors,
    floor,
    radiusScale: 0.8,
    direction: [0.32, 0.62, 1],
    // Low, wide and in front: an audience's view of the steps.
    paths: (draws: OrbitalDraw[], selectedId: string | null) => {
      const at = new Map(draws.map((draw) => [draw.node.id, draw.position]));
      const selected = selectedId && castCharacterId(selectedId);
      const shown = selected ? web.edges.filter((edge) => edge.a === selected || edge.b === selected) : strongest;
      const paths: OrbitalPath[] = [];
      for (const edge of shown) {
        const [a, b] = tieOf(edge).map((id) => at.get(id));
        if (!a || !b || edge.id === pairKey) continue;
        paths.push({ id: `tie:${edge.id}`, points: arc(a, b), tone: selected ? "route" : "link" });
      }
      const pair = pairKey ? web.edges.find((edge) => edge.id === pairKey) : undefined;
      const [a, b] = pair ? tieOf(pair).map((id) => at.get(id)) : [];
      if (pair && a && b) paths.push({ id: `pair:${pair.id}`, points: arc(a, b), tone: focus.watching ? "route" : "thread" });
      return paths;
    },
    pathReplacesLinks: true,
    focusFor: (selectedId: string, draws: OrbitalDraw[]) => {
      const selected = castCharacterId(selectedId);
      if (!selected) return null;
      const near = new Set([selected, ...web.edges.filter((edge) => edge.a === selected || edge.b === selected).slice(0, 8).flatMap((edge) => [edge.a, edge.b])]);
      const points = draws.filter((draw) => near.has(castCharacterId(draw.node.id) ?? "")).map((draw) => draw.position);
      return points.length ? points : null;
    },
    timeKey: { label: "Characters", detail: "Steps by storyline connection: protagonists on top, then pillars, connectors and cameos; ties are shared scenes, exchanges and actions. Enter a character to walk their scenes." },
  };
}
