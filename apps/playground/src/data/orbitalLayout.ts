import type { WorldEdge, WorldNode } from "../types.js";
import { arrangeRelationships, type Position3 } from "./spatialLayout.js";
import { isNebula, isSourceRelation, type OrbitalEntry, type OrbitalLevel } from "./orbitalModel.js";
import { sceneIndex } from "./sceneHierarchy.js";

export interface OrbitalDraw {
  node: WorldNode;
  entry?: OrbitalEntry;
  position: Position3;
  radius: number;
  role: "main" | "nebula" | "preview";
  previewParentId?: string;
}
export interface OrbitalPath { id: string; points: Position3[]; preview?: boolean; fromPoints?: Position3[] }
export interface OrbitalPose { position: Position3; radius: number }
export interface OrbitalMorph { startedAt: number; from: Map<string, OrbitalPose> }
export const uncoilEase = (progress: number) => { const bounded = Math.min(1, Math.max(0, progress)); return bounded * bounded * (3 - 2 * bounded); };
export const interpolatePose = (from: OrbitalPose, to: OrbitalPose, progress: number): OrbitalPose => {
  const amount = uncoilEase(progress);
  return { position: to.position.map((value, axis) => from.position[axis] + (value - from.position[axis]) * amount) as Position3, radius: from.radius + (to.radius - from.radius) * amount };
};
export function helixPoint(progress: number, track: number, tracks: number, radius: number): Position3 {
  const orbit = radius * Math.min(0.28, 0.52 / Math.max(1, tracks));
  const phase = progress * Math.PI * 2.5 - Math.PI / 2;
  return [(progress - 0.5) * radius * 1.2, (track - (tracks - 1) / 2) * orbit * 2.4 + Math.sin(phase) * orbit, Math.cos(phase) * orbit];
}
const trackKey = (node: WorldNode) => `${node.lane}:${node.trackId ?? "story"}`;
export function layoutOrbitalLevel(level: OrbitalLevel, contextNebula = level.nebula): { draws: OrbitalDraw[]; paths: OrbitalPath[] } {
  const tracks = [...new Set(level.main.map((entry) => trackKey(entry.node)))].sort();
  const times = [...new Set(level.main.map((entry) => entry.node.chrono))].sort((first, second) => first - second);
  const anchors = new Map<string, Position3>();
  for (const entry of level.main) anchors.set(entry.node.id, [(times.indexOf(entry.node.chrono) - (times.length - 1) / 2) * 200, ((tracks.length - 1) / 2 - tracks.indexOf(trackKey(entry.node))) * 240, 0]);
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
  const draws: OrbitalDraw[] = level.main.map((entry) => ({ node: entry.node, entry, position: anchors.get(entry.node.id)!.map((value) => value * 3) as Position3, radius: entry.node.kind === "bigEvent" ? 165 : entry.node.kind === "dialogue" ? 72 : 115, role: "main" }));
  draws.push(...contextNebula.map((node): OrbitalDraw => ({ node, position: positions.get(node.id)!.map((value) => value * 3) as Position3, radius: node.kind === "character" ? 48 : 42, role: "nebula" })));
  const paths = tracks.map((track): OrbitalPath => {
    const members = draws.filter((draw) => draw.role === "main" && trackKey(draw.node) === track);
    const first = members[0].position, last = members.at(-1)!.position;
    return { id: `time:${track}`, points: [[first[0] - 260, first[1], first[2]], ...members.map((draw) => draw.position), [last[0] + 260, last[1], last[2]]] };
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
  const paths = tracks.map((track, trackIndex): OrbitalPath => ({ id: `orbit:${parent.node.id}:${track}`, preview: true, points: Array.from({ length: 81 }, (_, index) => helixPoint(index / 80, trackIndex, tracks.length, parent.radius).map((value, axis) => parent.position[axis] + value) as Position3) }));
  return { draws, paths };
}

export function visibleOrbitalEdges(edges: WorldEdge[], draws: OrbitalDraw[], selectedId: string | null): WorldEdge[] {
  if (!selectedId) return [];
  const ids = new Set(draws.map((draw) => draw.node.id));
  return edges.filter((edge) => isSourceRelation(edge) && ids.has(edge.from) && ids.has(edge.to) && (edge.from === selectedId || edge.to === selectedId));
}
