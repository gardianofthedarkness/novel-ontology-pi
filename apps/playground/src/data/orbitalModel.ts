import type { CausalSummary, WorldEdge, WorldNode } from "../types.js";
import { relationshipAffinities } from "./spatialLayout.js";
import { libraryLevel, type LibraryView } from "./libraryModel.js";

export interface OrbitalWorld {
  library?: LibraryView;
  sourceId?: string | null;
  laneNodes: WorldNode[];
  laneEdges: WorldEdge[];
  interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }>;
  causal?: CausalSummary;
}
export interface OrbitalScope {
  key: string;
  label: string;
  kind: "library" | "series" | "volume" | "chapter" | "scenes" | "scene";
  libraryGroup?: string;
  planId?: string;
  sourceId?: string;
  chapterId?: string;
  ids?: string[];
  sceneId?: string;
}
export interface OrbitalEntry {
  node: WorldNode;
  members: string[];
  scope?: OrbitalScope;
}
export interface OrbitalLevel {
  scope: OrbitalScope;
  main: OrbitalEntry[];
  nebula: WorldNode[];
  sourceNodes: WorldNode[];
  sourceEdges: WorldEdge[];
}
export const ORBITAL_PAGE_SIZE = 20;
export const volumeScope: OrbitalScope = { key: "orbital:volume", label: "Volume", kind: "volume" };
export const canEnterOrbitalScope = (scope?: OrbitalScope) => !!scope && scope.kind !== "scene";
export const isNebula = (node: WorldNode) => node.kind === "character" || node.kind === "location";
export const isSourceRelation = (edge: WorldEdge) => !edge.id.includes(":narrative-order:") && !edge.id.startsWith("view-");
const order = (first: WorldNode, second: WorldNode) => first.chrono - second.chrono || first.id.localeCompare(second.id);

function sceneRecords(nodes: WorldNode[], edges: WorldEdge[], sceneIds: string[]): WorldNode[] {
  const records = new Map(nodes.filter((node) => node.kind === "event" || node.kind === "dialogue").map((node) => [node.id, node]));
  const children = new Map<string, string[]>();
  for (const edge of edges) {
    if (edge.kind !== "contains" || !isSourceRelation(edge) || !records.has(edge.to)) continue;
    const ids = children.get(edge.from) ?? [];
    ids.push(edge.to);
    children.set(edge.from, ids);
  }
  const found = new Set<string>();
  const pending = [...sceneIds];
  for (let index = 0; index < pending.length; index++) {
    for (const id of children.get(pending[index]) ?? []) {
      if (found.has(id)) continue;
      found.add(id);
      pending.push(id);
    }
  }
  return [...found].map((id) => records.get(id)!).sort(order);
}

const visibleRecords = (records: WorldNode[]) => records.some((node) => node.dialogue) ? records.filter((node) => node.kind !== "dialogue" || node.dialogue) : records;
const recordEntry = (node: WorldNode): OrbitalEntry => ({ node, members: [node.id] });

export function representativeScene(nodes: WorldNode[], edges: WorldEdge[], candidates = nodes.filter((node) => node.kind === "scene")): WorldNode | undefined {
  const affinity = relationshipAffinities(nodes, edges.filter(isSourceRelation));
  const scores = new Map<string, number>();
  for (const pair of affinity) for (const id of [pair.from, pair.to]) scores.set(id, (scores.get(id) ?? 0) + pair.strength);
  return [...candidates].filter((node) => node.summary?.trim()).sort((first, second) => (scores.get(second.id) ?? 0) - (scores.get(first.id) ?? 0) || order(first, second))[0];
}

export function orbitalContents(node: WorldNode, level: OrbitalLevel): WorldNode[] {
  if (node.library) return level.sourceNodes.filter(entry => entry.parent === node.id);
  if (node.kind === "bigEvent") return level.sourceNodes.filter((entry) => entry.parent === node.id && entry.kind === "scene").sort(order);
  if (node.cluster) {
    const ids = new Set(node.cluster.ids);
    return level.sourceNodes.filter((entry) => ids.has(entry.id)).sort(order);
  }
  if (node.kind !== "scene") return [];
  return visibleRecords(sceneRecords(level.sourceNodes, level.sourceEdges, [node.id]));
}

/** Scoped surroundings: every entity with a direct or bounded two-hop link
 * into this level (plus the selected entity and pending ghosts at volume and
 * chapter scale). Nothing is culled by degree; `prominence` (0–1, log-scaled
 * link strength) drives size and opacity instead. */
export function surroundingEntities(level: OrbitalLevel, selectedId: string | null = null): { nodes: WorldNode[]; prominence: Map<string, number> } {
  const entities = new Map(level.nebula.map((node) => [node.id, node]));
  const targets = new Set(level.main.flatMap((entry) => entry.members).filter((id) => !entities.has(id)));
  if (level.scope.sceneId) targets.add(level.scope.sceneId);
  for (const edge of level.sourceEdges.filter(isSourceRelation)) {
    if (targets.has(edge.from) && !entities.has(edge.to)) targets.add(edge.to);
  }
  const scores = new Map<string, number>();
  for (const pair of relationshipAffinities(level.sourceNodes, level.sourceEdges.filter(isSourceRelation))) {
    for (const [entity, target] of [[pair.from, pair.to], [pair.to, pair.from]]) {
      if (entities.has(entity) && targets.has(target)) scores.set(entity, (scores.get(entity) ?? 0) + pair.strength);
    }
  }
  const nodes = [...entities.values()].filter((node) => (scores.get(node.id) ?? 0) > 0 || node.id === selectedId || node.state !== "canon" && (level.scope.kind === "volume" || level.scope.kind === "chapter")).sort((first, second) => (scores.get(second.id) ?? 0) - (scores.get(first.id) ?? 0) || first.id.localeCompare(second.id));
  const strongest = Math.log1p(Math.max(0, ...nodes.map((node) => scores.get(node.id) ?? 0)));
  return { nodes, prominence: new Map(nodes.map((node) => [node.id, strongest > 0 ? Math.log1p(scores.get(node.id) ?? 0) / strongest : 0])) };
}

/** How many actual children a main sphere holds at the next level. */
export function orbitalChildCount(entry: OrbitalEntry, level: OrbitalLevel): number {
  if (entry.node.cluster) return entry.node.cluster.ids.length;
  if (entry.node.kind === "bigEvent" || entry.node.kind === "scene") return orbitalContents(entry.node, level).length;
  return 0;
}

/** Main-sphere prominence (0–1, square-root of child count) within this level. */
export function mainProminence(level: OrbitalLevel): Map<string, number> {
  const containers = level.main.filter((entry) => entry.node.cluster || entry.node.kind === "bigEvent" || entry.node.kind === "scene");
  const counts = new Map(containers.map((entry) => [entry.node.id, orbitalChildCount(entry, level)]));
  const most = Math.sqrt(Math.max(0, ...counts.values()));
  return most > 0 ? new Map([...counts].map(([id, count]) => [id, Math.sqrt(count) / most])) : new Map();
}

function groupEntries(records: WorldNode[], scope: OrbitalScope, sourceNodes: WorldNode[], sourceEdges: WorldEdge[]): OrbitalEntry[] {
  const sorted = [...records].sort(order);
  const individual = (node: WorldNode): OrbitalEntry => ({ node, members: [node.id], ...(node.kind === "scene" ? { scope: { key: `orbital:scene:${node.id}`, label: node.summary ?? node.label, kind: "scene", chapterId: scope.chapterId, sceneId: node.id } as OrbitalScope } : {}) });
  if (sorted.length <= ORBITAL_PAGE_SIZE) return sorted.map(individual);
  const tracks = [...new Set(sorted.map((node) => `${node.lane}:${node.trackId ?? "story"}`))];
  const partitions = tracks.length <= ORBITAL_PAGE_SIZE ? tracks.map((track) => sorted.filter((node) => `${node.lane}:${node.trackId ?? "story"}` === track)) : [sorted];
  const allocations = partitions.map(() => 1);
  for (let remaining = ORBITAL_PAGE_SIZE - partitions.length; remaining > 0; remaining--) {
    const target = partitions.reduce((best, members, position) => members.length / allocations[position] > partitions[best].length / allocations[best] ? position : best, 0);
    allocations[target]++;
  }
  const entries: OrbitalEntry[] = [];
  for (const [partitionIndex, partition] of partitions.entries()) {
    const count = Math.min(partition.length, allocations[partitionIndex]);
    for (let groupIndex = 0; groupIndex < count; groupIndex++) {
      const members = partition.slice(Math.floor(groupIndex * partition.length / count), Math.floor((groupIndex + 1) * partition.length / count));
      if (members.length === 1) { entries.push(individual(members[0])); continue; }
      const memberIds = members.map((node) => node.id);
      const representative = representativeScene(sourceNodes, sourceEdges, members) ?? [...members].filter((node) => node.summary).sort(order)[0] ?? members[0];
      const id = `orbital:group:${scope.key}:${encodeURIComponent(members[0].id)}:${encodeURIComponent(members.at(-1)!.id)}`;
      const sharedTrack = members.every((node) => node.trackId === members[0].trackId && node.lane === members[0].lane);
      const node: WorldNode = {
        ...representative, id, kind: "scene", chrono: members[0].chrono, dialogue: undefined,
        label: (representative.summary ?? representative.label).slice(0, 72), summary: representative.summary,
        subLabel: `${members.length} scenes · ${members[0].chrono}–${members.at(-1)!.chrono}`,
        state: members.some((entry) => entry.state === "held") ? "held" : members.some((entry) => entry.state === "proposed") ? "proposed" : "canon",
        trackId: sharedTrack ? members[0].trackId : "combined-tracks", trackLabel: sharedTrack ? members[0].trackLabel : "Multiple tracks · reveal to separate",
        cluster: { kind: "scenes", ids: memberIds, recordCount: members.length, proposed: members.filter((entry) => entry.state === "proposed").length, held: members.filter((entry) => entry.state === "held").length },
      };
      entries.push({ node, members: memberIds, scope: { ...scope, key: id, label: node.summary ?? node.label, kind: "scenes", ids: memberIds } });
    }
  }
  return entries.sort((first, second) => order(first.node, second.node));
}

export function orbitalLevel(world: OrbitalWorld, scope: OrbitalScope = volumeScope, activityNodes: WorldNode[] = [], activityEdges: WorldEdge[] = []): OrbitalLevel {
  if (world.library && (scope.kind === "library" || scope.kind === "series")) return libraryLevel(world, scope);
  if (scope.kind === "volume" && scope.sourceId && world.sourceId !== scope.sourceId) return { scope, main: [], nebula: [], sourceNodes: [], sourceEdges: [] };
  if (scope.kind === "volume") {
    const main = world.laneNodes.filter((node) => node.kind === "bigEvent").sort(order).map((node): OrbitalEntry => {
      const interior = world.interiors[node.id];
      const source = [...(interior?.nodes ?? []), ...activityNodes.filter((entry) => entry.parent === node.id)];
      // Chapters wear their most connected scene summary; regrouped spheres (periods, places) keep their own names.
      const representative = node.viewKind ? undefined : representativeScene(source, interior?.edges ?? []);
      const chapterNode = representative ? { ...node, label: representative.summary!.slice(0, 72), summary: representative.summary, subLabel: node.label } : node;
      return { node: chapterNode, members: [node.id, ...source.map((entry) => entry.id)], ...(source.length ? { scope: { key: `orbital:chapter:${node.id}`, label: node.label, kind: "chapter", chapterId: node.id } as OrbitalScope } : {}) };
    });
    const sourceNodes = [...new Map([...world.laneNodes, ...Object.values(world.interiors).flatMap((graph) => graph.nodes), ...activityNodes].map((node) => [node.id, node])).values()];
    return { scope, main, nebula: sourceNodes.filter(isNebula), sourceNodes, sourceEdges: [...world.laneEdges, ...Object.values(world.interiors).flatMap((graph) => graph.edges), ...activityEdges] };
  }
  const interior = world.interiors[scope.chapterId ?? ""];
  const sourceNodes = [...new Map([...(interior?.nodes ?? []), ...activityNodes.filter((node) => node.parent === scope.chapterId)].map((node) => [node.id, node])).values()];
  const sourceEdges = [...(interior?.edges ?? []), ...activityEdges.filter((edge) => edge.parent === scope.chapterId)];
  const nebula = sourceNodes.filter(isNebula).sort(order);
  const scenes = sourceNodes.filter((node) => node.kind === "scene");
  let main: OrbitalEntry[];
  if (scope.kind === "scene") {
    main = visibleRecords(sceneRecords(sourceNodes, sourceEdges, [scope.sceneId ?? ""])).map(recordEntry);
  } else if (scope.ids) {
    const ids = new Set(scope.ids);
    main = groupEntries(scenes.filter((node) => ids.has(node.id)), scope, sourceNodes, sourceEdges);
  } else {
    main = groupEntries(scenes, scope, sourceNodes, sourceEdges);
    const assigned = new Set(sceneRecords(sourceNodes, sourceEdges, scenes.map((node) => node.id)).map((node) => node.id));
    const unassigned = sourceNodes.filter((node) => !isNebula(node) && node.kind !== "scene" && !assigned.has(node.id));
    main.push(...unassigned.map(recordEntry));
    main.sort((first, second) => order(first.node, second.node));
  }
  return { scope, main, nebula, sourceNodes, sourceEdges };
}
