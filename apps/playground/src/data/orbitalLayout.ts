import type { WorldEdge, WorldNode } from "../types.js";
import { arrangeRelationships, type Position3 } from "./spatialLayout.js";
import { isNebula, isSourceRelation, type OrbitalEntry, type OrbitalLevel } from "./orbitalModel.js";
import { sceneIndex } from "./sceneHierarchy.js";

export interface OrbitalDraw {
  node: WorldNode;
  entry?: OrbitalEntry;
  position: Position3;
  radius: number;
  /** "preimage": a transient, view-only stand-in for an entity an EM merge just removed. */
  role: "main" | "nebula" | "preview" | "connection" | "preimage";
  /** 0–1 visual weight: child count for main spheres, scoped link strength for the nebula. */
  prominence?: number;
  previewParentId?: string;
  /** A container drawn as a clear shell around its records, or not drawn at all (orbital Places levels). */
  envelope?: "shell" | "hidden";
  /** Story-order key for records drawn inside a container (container rank + position inside). */
  order?: number;
  /** Direction the glyph's +Z faces (picture cards: the timeline tangent,
   * so the card plane stands perpendicular to the timeline). When absent,
   * glyphs fall back to camera billboarding. */
  facing?: Position3;
  asset?: string;
}
/** tone: "thread" (amber, flashback → told during), "route" (a character's
 * path through places), "link" (faint move between places); default the time string. */
export interface OrbitalPath { id: string; points: Position3[]; preview?: boolean; fromPoints?: Position3[]; tone?: "thread" | "route" | "link" | "coil" | "trip";
  /** A story strand's axis: drawn as a glowing cyan tube; tapping it lights the strand. */
  strand?: boolean;
  /** How much a strand matters (0–1, by its scenes): its axis and coil glow stronger, minor ones stay dim. */
  weight?: number;
  /** The strand this path belongs to (its axis and its coil), so another strand's light can fade it. */
  strandId?: string;
  /** A path between strands (a group trip): lit with either strand, faded by any other. */
  strandIds?: string[];
  /** Drawn faint: it rests on a guess (a trip whose place one end borrows). */
  faint?: boolean;
  /** Faded while another strand is lit. */
  dim?: boolean }
export interface OrbitalPose { position: Position3; radius: number }
/** A transition from `from` poses to the current layout. The opening
 * sequence uses a longer `durationMs` and per-record start `delays` (ms). */
export interface OrbitalMorph { startedAt: number; from: Map<string, OrbitalPose>; durationMs?: number; delays?: Map<string, number> }
/** Raw progress (unclamped) of one record's morph at `nowMs`. */
export const morphProgress = (morph: OrbitalMorph, id: string, nowMs: number, fallbackMs: number) => (nowMs - morph.startedAt - (morph.delays?.get(id) ?? 0)) / (morph.durationMs ?? fallbackMs);
/** How long the whole morph runs, including the latest delayed start. */
export const morphSpan = (morph: OrbitalMorph, fallbackMs: number) => (morph.durationMs ?? fallbackMs) + Math.max(0, ...(morph.delays?.values() ?? []));
export const uncoilEase = (progress: number) => { const bounded = Math.min(1, Math.max(0, progress)); return bounded * bounded * (3 - 2 * bounded); };
export const interpolatePose = (from: OrbitalPose, to: OrbitalPose, progress: number): OrbitalPose => {
  const amount = uncoilEase(progress);
  return { position: to.position.map((value, axis) => from.position[axis] + (value - from.position[axis]) * amount) as Position3, radius: from.radius + (to.radius - from.radius) * amount };
};
/**
 * Interruptible transitions: `carryPose` is interpolatePose plus a Hermite
 * start tangent, so a sphere interrupted mid-flight leaves with the momentum it
 * had instead of stopping dead, and still settles at rest on `to`. With no
 * tangent it is exactly interpolatePose.
 */
export const carryPose = (from: OrbitalPose, to: OrbitalPose, progress: number, tangent?: Position3): OrbitalPose => {
  const base = interpolatePose(from, to, progress);
  if (!tangent) return base;
  const u = Math.min(1, Math.max(0, progress)), carry = u * (1 - u) * (1 - u);
  return { position: base.position.map((value, axis) => value + carry * tangent[axis]) as Position3, radius: base.radius };
};
/** Start tangent from a velocity (units per second) over a transition of
 * `seconds`, capped so a fast sphere doesn't overshoot wildly. */
export function carryTangent(velocity: Position3, seconds: number, from: OrbitalPose, to: OrbitalPose): Position3 | undefined {
  const tangent = velocity.map((value) => value * seconds) as Position3;
  const length = Math.hypot(...tangent);
  if (length < 1e-3) return undefined;
  const cap = 1.5 * Math.max(Math.hypot(...to.position.map((value, axis) => value - from.position[axis])), to.radius);
  return length > cap ? tangent.map((value) => value * cap / length) as Position3 : tangent;
}
/**
 * Opening sequence: every record starts folded into one point at the head of
 * the spine and uncoils into place, earlier records first (by time, x).
 */
export const OPENING_MS = 1400;
export const OPENING_STAGGER_MS = 900;
export function openingMorph(draws: OrbitalDraw[], startedAt: number): OrbitalMorph | null {
  const spine = draws.filter((draw) => draw.role === "main");
  if (!spine.length) return null;
  const xs = draws.map((draw) => draw.position[0]);
  const minX = Math.min(...xs), span = Math.max(1, Math.max(...xs) - minX);
  const head = [...spine].sort((first, second) => first.position[0] - second.position[0])[0].position;
  const from = new Map<string, OrbitalPose>(), delays = new Map<string, number>();
  for (const draw of draws) {
    from.set(draw.node.id, { position: head, radius: draw.radius * 0.04 });
    delays.set(draw.node.id, Math.round((draw.position[0] - minX) / span * OPENING_STAGGER_MS + (draw.role === "main" ? 0 : 160)));
  }
  return { startedAt, from, durationMs: OPENING_MS, delays };
}
export function helixPoint(progress: number, track: number, tracks: number, radius: number): Position3 {
  const orbit = radius * Math.min(0.28, 0.52 / Math.max(1, tracks));
  const phase = progress * Math.PI * 2.5 - Math.PI / 2;
  return [(progress - 0.5) * radius * 1.2, (track - (tracks - 1) / 2) * orbit * 2.4 + Math.sin(phase) * orbit, Math.cos(phase) * orbit];
}
const trackKey = (node: WorldNode) => `${node.lane}:${node.trackId ?? "story"}`;
/** Bounded radii: main spheres stay well inside the 600-unit spine spacing,
 * nebula spheres stay small enough for a phone to draw hundreds. */
export const mainRadius = (node: WorldNode, prominence?: number) => {
  const base = node.kind === "bigEvent" ? 165 : node.kind === "dialogue" ? 72 : 115;
  return prominence === undefined ? base : Math.round(base * (0.7 + 0.55 * Math.min(1, Math.max(0, prominence))));
};
export const nebulaRadius = (node: WorldNode, prominence?: number) => {
  const base = node.kind === "character" ? 48 : 42;
  return prominence === undefined ? base : Math.round(base * (0.55 + 0.75 * Math.min(1, Math.max(0, prominence))));
};

export function layoutOrbitalLevel(level: OrbitalLevel, contextNebula = level.nebula, weights: { main?: Map<string, number>; nebula?: Map<string, number>; anchors?: Map<string, Position3>; radiusScale?: number } = {}): { draws: OrbitalDraw[]; paths: OrbitalPath[] } {
  const tracks = [...new Set(level.main.map((entry) => trackKey(entry.node)))].sort();
  const times = [...new Set(level.main.map((entry) => entry.node.chrono))].sort((first, second) => first - second);
  const anchors = new Map<string, Position3>();
  for (const entry of level.main) anchors.set(entry.node.id, weights.anchors?.get(entry.node.id) ?? [(times.indexOf(entry.node.chrono) - (times.length - 1) / 2) * 200, ((tracks.length - 1) / 2 - tracks.indexOf(trackKey(entry.node))) * 240, 0]);
  const mapped = new Map<string, string>();
  const entityIds = new Set(contextNebula.map((node) => node.id));
  for (const entry of level.main) for (const member of entry.members) if (!entityIds.has(member)) mapped.set(member, entry.node.id);
  const ownership = sceneIndex(level.sourceNodes, level.sourceEdges).owner;
  for (const node of level.sourceNodes) {
    if (isNebula(node)) continue;
    const owner = ownership.get(node.id);
    if (!mapped.has(node.id) && owner && mapped.has(owner)) mapped.set(node.id, mapped.get(owner)!);
  }
  for (const node of contextNebula) mapped.set(node.id, node.id);
  const gravityEdges = level.sourceEdges.filter(isSourceRelation).flatMap((edge): WorldEdge[] => {
    const from = mapped.get(edge.from), to = mapped.get(edge.to);
    return from && to && from !== to ? [{ ...edge, from, to }] : [];
  });
  const positions = arrangeRelationships([...level.main.map((entry) => entry.node), ...contextNebula], gravityEdges, anchors);
  for (const node of contextNebula) {
    const neighbors = gravityEdges.filter((edge) => edge.from === node.id || edge.to === node.id).flatMap((edge) => {
      const position = anchors.get(edge.from === node.id ? edge.to : edge.from);
      return position ? [{ position, weight: Math.max(0.1, edge.weight ?? 1) }] : [];
    });
    const strength = neighbors.reduce((sum, entry) => sum + entry.weight, 0);
    const center = [0, 1, 2].map((axis) => strength ? neighbors.reduce((sum, entry) => sum + entry.position[axis] * entry.weight, 0) / strength : 0);
    let hash = 2166136261;
    for (const character of node.id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
    const vertical = (hash % 2001) / 1000 - 1;
    const angle = hash * 2.399963229728653;
    const radial = Math.sqrt(1 - vertical * vertical);
    const direction = [Math.cos(angle) * radial, vertical, Math.sin(angle) * radial];
    const old = positions.get(node.id)!;
    const offset = old.map((value, axis) => value - center[axis]);
    const distance = Math.max(1, Math.hypot(...offset));
    const spread = direction.map((value, axis) => value * 0.85 + offset[axis] / distance * 0.35);
    const length = Math.max(0.1, Math.hypot(...spread));
    const radius = 270 + Math.sqrt(contextNebula.length) * 24 + 180 / (1 + Math.log1p(strength));
    positions.set(node.id, center.map((value, axis) => value + spread[axis] / length * radius) as Position3);
  }
  const draws: OrbitalDraw[] = level.main.map((entry) => ({ node: entry.node, entry, position: anchors.get(entry.node.id)!.map((value) => value * 3) as Position3, radius: Math.round(mainRadius(entry.node, weights.main?.get(entry.node.id)) * (weights.radiusScale ?? 1)), prominence: weights.main?.get(entry.node.id), role: "main" }));
  draws.push(...contextNebula.map((node): OrbitalDraw => ({ node, position: positions.get(node.id)!.map((value) => value * 3) as Position3, radius: nebulaRadius(node, weights.nebula?.get(node.id)), prominence: weights.nebula?.get(node.id), role: "nebula" })));
  const paths = tracks.flatMap((track): OrbitalPath[] => {
    const members = draws.filter((draw) => draw.role === "main" && trackKey(draw.node) === track && (!draw.node.library || draw.node.library.type === "file" && draw.node.library.readingOrder !== null));
    if (!members.length || members[0].node.library && members.length < 2) return [];
    const first = members[0].position, last = members.at(-1)!.position;
    return [{ id: `${members[0].node.library ? "reading-order" : "time"}:${track}`, points: [[first[0] - 260, first[1], first[2]], ...members.map((draw) => draw.position), [last[0] + 260, last[1], last[2]]] }];
  });
  return { draws, paths };
}

export function layoutOrbitalPreview(parent: OrbitalDraw, level: OrbitalLevel): { draws: OrbitalDraw[]; paths: OrbitalPath[] } {
  const tracks = [...new Set(level.main.map((entry) => trackKey(entry.node)))].sort();
  const largestTrack = Math.max(1, ...tracks.map((track) => level.main.filter((entry) => trackKey(entry.node) === track).length));
  const times = [...new Set(level.main.map((entry) => entry.node.chrono))].sort((first, second) => first - second);
  const progress = (node: WorldNode) => times.length <= 1 ? 0.5 : times.indexOf(node.chrono) / (times.length - 1);
  const draws = level.main.map((entry): OrbitalDraw => {
    const local = helixPoint(progress(entry.node), tracks.indexOf(trackKey(entry.node)), tracks.length, parent.radius);
    return { node: entry.node, entry, role: "preview", previewParentId: parent.node.id, position: local.map((value, axis) => parent.position[axis] + value) as Position3, radius: Math.max(3, Math.min(13, parent.radius * 0.075, parent.radius * 0.9 / largestTrack)) };
  });
  const paths = tracks.flatMap((track, trackIndex): OrbitalPath[] => {
    const entries = level.main.filter(entry => trackKey(entry.node) === track);
    if (entries[0]?.node.library && (entries.length < 2 || entries.some(entry => entry.node.library?.readingOrder === null))) return [];
    return [{ id: `orbit:${parent.node.id}:${track}`, preview: true, points: Array.from({ length: 81 }, (_, index) => helixPoint(index / 80, trackIndex, tracks.length, parent.radius).map((value, axis) => parent.position[axis] + value) as Position3) }];
  });
  return { draws, paths };
}

export interface BackdropGhost { id: string; position: Position3; radius: number; current: boolean; state: WorldNode["state"] }
/**
 * The previous level, seen from inside the entered sphere: the inverse of the
 * entry uncoil. Entering straightened a helix inside the parent; here the
 * parent's straight spine is recoiled onto the same helix form, scaled up so
 * the entered sphere's ghost encloses the current world and its siblings
 * continue the spiral beyond it (parallel tracks keep their offsets). View
 * geometry only: no labels, picking, focus or framing use these.
 */
export function layoutParentBackdrop(parentDraws: OrbitalDraw[], enteredId: string, childDraws: OrbitalDraw[]): { ghosts: BackdropGhost[]; path: Position3[] } {
  const parents = parentDraws.filter((draw) => draw.role === "main");
  const entered = parents.find((draw) => draw.node.id === enteredId);
  const children = childDraws.filter((draw) => draw.role === "main");
  if (!entered || !children.length) return { ghosts: [], path: [] };
  const tracks = [...new Set(parents.map((draw) => trackKey(draw.node)))].sort();
  const times = [...new Set(parents.map((draw) => draw.node.chrono))].sort((first, second) => first - second);
  const progress = (node: WorldNode) => times.length <= 1 ? 0.5 : times.indexOf(node.chrono) / (times.length - 1);
  const center = [0, 1, 2].map((axis) => children.reduce((sum, draw) => sum + draw.position[axis], 0) / children.length) as Position3;
  const extent = Math.max(...children.map((draw) => Math.abs(draw.position[0] - center[0]) + draw.radius));
  const enclosing = Math.max(900, extent * 1.25);
  const giant = enclosing * 2.6 * Math.max(1, times.length - 1) / 1.2;
  const origin = helixPoint(progress(entered.node), tracks.indexOf(trackKey(entered.node)), tracks.length, giant);
  const place = (point: Position3) => point.map((value, axis) => center[axis] + value - origin[axis]) as Position3;
  const ghosts = parents.map((draw): BackdropGhost => ({
    id: draw.node.id,
    position: place(helixPoint(progress(draw.node), tracks.indexOf(trackKey(draw.node)), tracks.length, giant)),
    radius: Math.round(enclosing * Math.min(1.6, Math.max(0.4, draw.radius / entered.radius))),
    current: draw.node.id === enteredId,
    state: draw.node.state,
  }));
  const path = Array.from({ length: 121 }, (_, index) => place(helixPoint(index / 120, tracks.indexOf(trackKey(entered.node)), tracks.length, giant)));
  return { ghosts, path };
}

/** Entry framing: the entered sphere and its nearest neighbours on the new
 * local timeline (up to ENTRY_WINDOW main spheres), so the first view sits
 * near the ground with readable spheres. The rest of the spine and the
 * surrounding nebula continue off-screen; Frame view still shows it all.
 * Without an entered sphere (first load, Back) the whole timeline is framed. */
const ENTRY_WINDOW = 5;
export function entryFrame(draws: OrbitalDraw[], selectedId: string | null, window = ENTRY_WINDOW): Position3[] {
  const main = draws.filter((draw) => draw.role === "main").sort((first, second) => first.position[0] - second.position[0] || first.position[1] - second.position[1]);
  const found = main.findIndex((draw) => draw.node.id === selectedId);
  if (found < 0 || main.length <= window) return main.map((draw) => draw.position);
  const start = Math.max(0, Math.min(main.length - window, found - Math.floor(window / 2)));
  return main.slice(start, start + window).map((draw) => draw.position);
}

export function visibleOrbitalEdges(edges: WorldEdge[], draws: OrbitalDraw[], selectedId: string | null): WorldEdge[] {
  if (!selectedId) return [];
  const ids = new Set(draws.map((draw) => draw.node.id));
  return edges.filter((edge) => isSourceRelation(edge) && ids.has(edge.from) && ids.has(edge.to) && (edge.from === selectedId || edge.to === selectedId));
}

export function nestedEntityConnections(level: OrbitalLevel, draws: OrbitalDraw[], selectedId: string | null): { draws: OrbitalDraw[]; edges: WorldEdge[] } {
  if (!level.nebula.some((node) => node.id === selectedId)) return { draws: [], edges: visibleOrbitalEdges(level.sourceEdges, draws, selectedId) };
  const byId = new Map(level.sourceNodes.map((node) => [node.id, node]));
  const ownership = sceneIndex(level.sourceNodes, level.sourceEdges).owner;
  const ports = new Map<string, OrbitalDraw>();
  const edges = new Map<string, WorldEdge>();
  const visible = new Set(draws.map((draw) => draw.node.id));
  for (const edge of level.sourceEdges.filter(isSourceRelation)) {
    if (edge.from !== selectedId && edge.to !== selectedId) continue;
    const other = edge.from === selectedId ? edge.to : edge.from;
    const source = byId.get(other);
    if (!source) continue;
    const scenes = level.sourceEdges.filter((entry) => entry.kind === "contains" && isSourceRelation(entry) && (entry.from === other || entry.to === other)).flatMap((entry) => {
      const endpoint = entry.from === other ? entry.to : entry.from;
      return byId.get(endpoint)?.kind === "scene" ? [endpoint] : [];
    });
    const targets = visible.has(other) || isNebula(source) || source.kind === "scene" ? [source.id] : scenes.length ? [...new Set(scenes)] : [ownership.get(source.id) ?? source.id];
    for (const target of targets) {
      if (!visible.has(target) && !ports.has(target)) {
        const container = draws.find((draw) => draw.role === "main" && draw.entry?.members.includes(target));
        const record = byId.get(target);
        if (!container || !record || isNebula(record)) continue;
        const members = level.sourceNodes.filter((node) => container.entry!.members.includes(node.id) && node.kind === record.kind).sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));
        const index = members.findIndex((node) => node.id === target);
        const local = helixPoint(members.length > 1 ? index / (members.length - 1) : 0.5, 0, 1, container.radius);
        ports.set(target, { node: record, position: local.map((value, axis) => value + container.position[axis]) as Position3, radius: 3, role: "connection", previewParentId: container.node.id });
      }
      if (!visible.has(target) && !ports.has(target)) continue;
      const key = `${selectedId}:${target}`;
      const previous = edges.get(key);
      edges.set(key, { ...edge, id: `orbital-link:${key}`, from: selectedId!, to: target, derived: target !== other || edge.derived, weight: (previous?.weight ?? 0) + (edge.weight ?? 1), relationLabel: target === other ? edge.relationLabel : "Scene connection via recorded event (not a presence claim)" });
    }
  }
  return { draws: [...ports.values()], edges: [...edges.values()] };
}
