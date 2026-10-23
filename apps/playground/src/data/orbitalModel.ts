import type { WorldEdge, WorldNode } from "../types.js";
import { relationshipAffinities } from "./spatialLayout.js";

export interface OrbitalWorld {
  laneNodes: WorldNode[];
  laneEdges: WorldEdge[];
  interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }>;
}
export interface OrbitalScope {
  key: string;
  label: string;
  kind: "volume" | "chapter" | "scenes" | "scene" | "records" | "dialogue";
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
export const isNebula = (node: WorldNode) => node.kind === "character" || node.kind === "location";
export const isSourceRelation = (edge: WorldEdge) => !edge.id.includes(":narrative-order:") && !edge.id.startsWith("view-");
const order = (first: WorldNode, second: WorldNode) => first.chrono - second.chrono || first.id.localeCompare(second.id);

export function representativeScene(nodes: WorldNode[], edges: WorldEdge[], candidates = nodes.filter((node) => node.kind === "scene")): WorldNode | undefined {
  const affinity = relationshipAffinities(nodes, edges.filter(isSourceRelation));
  const scores = new Map<string, number>();
  for (const pair of affinity) for (const id of [pair.from, pair.to]) scores.set(id, (scores.get(id) ?? 0) + pair.strength);
  return [...candidates].filter((node) => node.summary?.trim()).sort((first, second) => (scores.get(second.id) ?? 0) - (scores.get(first.id) ?? 0) || order(first, second))[0];
}

function groupEntries(records: WorldNode[], scope: OrbitalScope, sourceNodes: WorldNode[], sourceEdges: WorldEdge[], kind: "scenes" | "records" | "dialogue", forceGroup = false): OrbitalEntry[] {
  const sorted = [...records].sort(order);
  const individual = (node: WorldNode): OrbitalEntry => ({ node, members: [node.id], ...(node.kind === "scene" ? { scope: { key: `orbital:scene:${node.id}`, label: node.summary ?? node.label, kind: "scene", chapterId: scope.chapterId, sceneId: node.id } as OrbitalScope } : {}) });
  if (!forceGroup && sorted.length <= ORBITAL_PAGE_SIZE) return sorted.map(individual);
  if (!sorted.length) return [];
  const tracks = [...new Set(sorted.map((node) => `${node.lane}:${node.trackId ?? "story"}`))];
  const partitions = tracks.length <= ORBITAL_PAGE_SIZE ? tracks.map((track) => sorted.filter((node) => `${node.lane}:${node.trackId ?? "story"}` === track)) : [sorted];
  const allocations = partitions.map(() => 1);
  const slots = forceGroup ? 1 : ORBITAL_PAGE_SIZE;
  if (forceGroup) partitions.splice(0, partitions.length, sorted);
  for (let remaining = slots - partitions.length; remaining > 0; remaining--) {
    const target = partitions.reduce((best, members, position) => members.length / allocations[position] > partitions[best].length / allocations[best] ? position : best, 0);
    allocations[target]++;
  }
  const entries: OrbitalEntry[] = [];
  for (const [partitionIndex, partition] of partitions.entries()) {
    const count = Math.min(partition.length, allocations[partitionIndex]);
    for (let groupIndex = 0; groupIndex < count; groupIndex++) {
      const members = partition.slice(Math.floor(groupIndex * partition.length / count), Math.floor((groupIndex + 1) * partition.length / count));
      if (members.length === 1 && !forceGroup) { entries.push(individual(members[0])); continue; }
      const memberIds = members.map((node) => node.id);
      const representative = representativeScene(sourceNodes, sourceEdges, members) ?? [...members].filter((node) => node.summary).sort(order)[0] ?? members[0];
      const id = `orbital:group:${scope.key}:${encodeURIComponent(members[0].id)}:${encodeURIComponent(members.at(-1)!.id)}`;
      const sharedTrack = members.every((node) => node.trackId === members[0].trackId && node.lane === members[0].lane);
      const node: WorldNode = {
        ...representative, id, kind: kind === "scenes" ? "scene" : "event", chrono: members[0].chrono, dialogue: undefined,
        label: (representative.summary ?? representative.label).slice(0, 72), summary: representative.summary,
        subLabel: `${members.length} ${kind} · ${members[0].chrono}–${members.at(-1)!.chrono}`,
        state: members.some((entry) => entry.state === "held") ? "held" : members.some((entry) => entry.state === "proposed") ? "proposed" : "canon",
        trackId: sharedTrack ? members[0].trackId : "combined-tracks", trackLabel: sharedTrack ? members[0].trackLabel : "Multiple tracks · reveal to separate",
        cluster: { kind: kind === "scenes" ? "scenes" : "records", ids: memberIds, recordCount: members.length, proposed: members.filter((entry) => entry.state === "proposed").length, held: members.filter((entry) => entry.state === "held").length },
      };
      entries.push({ node, members: memberIds, scope: { ...scope, key: id, label: node.summary ?? node.label, kind, ids: memberIds } });
    }
  }
  return entries.sort((first, second) => order(first.node, second.node));
}

export function orbitalLevel(world: OrbitalWorld, scope: OrbitalScope = volumeScope, activityNodes: WorldNode[] = [], activityEdges: WorldEdge[] = []): OrbitalLevel {
  if (scope.kind === "volume") {
    const main = world.laneNodes.filter((node) => node.kind === "bigEvent").sort(order).map((node): OrbitalEntry => {
      const interior = world.interiors[node.id];
      const source = [...(interior?.nodes ?? []), ...activityNodes.filter((entry) => entry.parent === node.id)];
      const representative = representativeScene(source, interior?.edges ?? []);
      const chapterNode = representative ? { ...node, label: representative.summary!.slice(0, 72), summary: representative.summary, subLabel: node.label } : node;
      return { node: chapterNode, members: [node.id, ...source.map((entry) => entry.id)], ...(source.length ? { scope: { key: `orbital:chapter:${node.id}`, label: node.label, kind: "chapter", chapterId: node.id } as OrbitalScope } : {}) };
    });
    return { scope, main, nebula: [], sourceNodes: [...world.laneNodes, ...Object.values(world.interiors).flatMap((graph) => graph.nodes), ...activityNodes], sourceEdges: [...world.laneEdges, ...Object.values(world.interiors).flatMap((graph) => graph.edges), ...activityEdges] };
  }
  const interior = world.interiors[scope.chapterId ?? ""];
  const sourceNodes = [...new Map([...(interior?.nodes ?? []), ...activityNodes.filter((node) => node.parent === scope.chapterId)].map((node) => [node.id, node])).values()];
  const sourceEdges = [...(interior?.edges ?? []), ...activityEdges.filter((edge) => edge.parent === scope.chapterId)];
  const nebula = sourceNodes.filter(isNebula).sort(order);
  const scenes = sourceNodes.filter((node) => node.kind === "scene");
  let records: WorldNode[];
  let main: OrbitalEntry[];
  if (scope.kind === "scene") {
    const connected = new Set(sourceEdges.filter((edge) => isSourceRelation(edge) && (edge.from === scope.sceneId || edge.to === scope.sceneId)).flatMap((edge) => [edge.from, edge.to]));
    records = sourceNodes.filter((node) => connected.has(node.id) && !isNebula(node) && node.kind !== "scene");
    if (records.some((node) => node.dialogue)) records = records.filter((node) => node.kind !== "dialogue" || node.dialogue);
    main = groupEntries(records, scope, sourceNodes, sourceEdges, "records");
  } else if (scope.ids) {
    const ids = new Set(scope.ids);
    records = sourceNodes.filter((node) => ids.has(node.id) && !isNebula(node));
    main = groupEntries(records, scope, sourceNodes, sourceEdges, scope.kind === "scenes" ? "scenes" : scope.kind === "dialogue" ? "dialogue" : "records");
  } else {
    main = groupEntries(scenes, scope, sourceNodes, sourceEdges, "scenes");
    const sceneIds = new Set(scenes.map((node) => node.id));
    const assigned = new Set(sourceEdges.filter((edge) => isSourceRelation(edge) && (sceneIds.has(edge.from) || sceneIds.has(edge.to))).flatMap((edge) => [edge.from, edge.to]));
    const unassigned = sourceNodes.filter((node) => !isNebula(node) && node.kind !== "scene" && !assigned.has(node.id));
    for (const dialogue of [false, true]) {
      const loose = unassigned.filter((node) => (node.kind === "dialogue") === dialogue);
      main.push(...groupEntries(loose, scope, sourceNodes, sourceEdges, dialogue ? "dialogue" : "records", true));
    }
  }
  return { scope, main, nebula, sourceNodes, sourceEdges };
}
