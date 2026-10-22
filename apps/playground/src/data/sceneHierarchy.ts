import type { WorldEdge, WorldNode } from "../types.js";

export type StructureMode = "cloud" | "chronology";
export interface SceneScope {
  key: string;
  label: string;
  sceneIds?: string[];
  recordIds?: string[];
  focusSceneId?: string;
}

const ordered = (first: WorldNode, second: WorldNode) => first.chrono - second.chrono || first.id.localeCompare(second.id);
const semantic = (edge: WorldEdge) => !edge.id.includes(":narrative-order:");

export const SCENE_PAGE_SIZE = 20;

export function sceneIndex(nodes: WorldNode[], edges: WorldEdge[]) {
  const scenes = nodes.filter((node) => node.kind === "scene" && !node.cluster).sort(ordered);
  const rank = new Map(scenes.map((node, index) => [node.id, index + 1]));
  const owner = new Map(scenes.map((node) => [node.id, node.id]));
  const neighbors = new Map<string, Set<string>>(scenes.map((node) => [node.id, new Set<string>()]));
  const ids = new Set(nodes.map((node) => node.id));
  for (const edge of edges) {
    if (!semantic(edge) || !ids.has(edge.from) || !ids.has(edge.to)) continue;
    for (const [sceneId, recordId] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      if (!rank.has(sceneId) || rank.has(recordId)) continue;
      neighbors.get(sceneId)!.add(recordId);
      const previous = owner.get(recordId);
      if (!previous || rank.get(sceneId)! < rank.get(previous)!) owner.set(recordId, sceneId);
    }
  }
  return { scenes, rank, owner, neighbors };
}

export function scopeForNode(node: WorldNode, scope?: SceneScope): SceneScope | null {
  if (node.cluster) return {
    key: node.id, label: node.label,
    ...(node.cluster.kind === "scenes" ? { sceneIds: node.cluster.ids } : { recordIds: node.cluster.ids, focusSceneId: node.cluster.focusSceneId ?? scope?.focusSceneId }),
  };
  if (node.kind === "scene" && scope?.focusSceneId !== node.id) return { key: node.id, label: node.label, focusSceneId: node.id };
  return null;
}

export function projectSceneGraph(nodes: WorldNode[], edges: WorldEdge[], scope: SceneScope | undefined = undefined, requestedBudget = 20) {
  const budget = Math.max(3, Math.min(20, Math.floor(requestedBudget) || 20));
  const index = sceneIndex(nodes, edges);
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const focus = scope?.focusSceneId ? byId.get(scope.focusSceneId) : undefined;
  const sourceIds = scope?.recordIds ? new Set(scope.recordIds) : scope?.sceneIds ? new Set(scope.sceneIds) : undefined;
  const characters = nodes.filter((node) => node.kind === "character").sort(ordered);
  const records = nodes.filter((node) => node.kind !== "character" && (sourceIds ? sourceIds.has(node.id) : focus ? index.neighbors.get(focus.id)?.has(node.id) : node.kind === "scene")).sort(ordered);
  const loose = !scope ? nodes.filter((node) => node.kind !== "character" && !index.owner.has(node.id)).sort(ordered) : [];
  const visible: WorldNode[] = focus ? [focus] : [];
  const mapping = new Map<string, string>([...characters, ...visible].map((node) => [node.id, node.id]));
  const slots = budget;
  const sceneLevel = !scope?.recordIds && !focus;
  const cluster = (members: WorldNode[], kind: "scenes" | "records", looseGroup = false) => {
    const first = members[0];
    const last = members[members.length - 1];
    const memberIds = new Set(members.map((node) => node.id));
    const represented = kind === "scenes" ? nodes.filter((node) => node.kind !== "character" && memberIds.has(index.owner.get(node.id) ?? "")) : members;
    const proposed = represented.filter((node) => node.state === "proposed").length;
    const held = represented.filter((node) => node.state === "held").length;
    const label = looseGroup ? `Other records · ${members.length}` : kind === "scenes" ? `Scenes ${index.rank.get(first.id)}–${index.rank.get(last.id)}` : `Records ${members.length} · ${first.label}`;
    const node: WorldNode = {
      ...first,
      id: `view-group:${kind}:${focus ? `${encodeURIComponent(focus.id)}:` : ""}${encodeURIComponent(first.id)}:${encodeURIComponent(last.id)}`,
      kind: kind === "scenes" ? "scene" : "event",
      label, subLabel: kind === "scenes" ? first.label : `${members.length} records · expand`,
      summary: undefined, relatedSummaries: undefined,
      trackId: members.every((record) => record.lane === first.lane && record.trackId === first.trackId) ? first.trackId : "combined-tracks",
      trackLabel: members.every((record) => record.lane === first.lane && record.trackId === first.trackId) ? first.trackLabel : "Multiple tracks · expand to separate",
      state: held ? "held" : proposed ? "proposed" : "canon",
      cluster: { kind, ids: members.map((record) => record.id), recordCount: represented.length, proposed, held, focusSceneId: focus?.id },
    };
    visible.push(node);
    for (const member of members) mapping.set(member.id, node.id);
  };
  if (records.length <= slots) {
    visible.push(...records);
    for (const record of records) mapping.set(record.id, record.id);
  } else {
    const tracks = sceneLevel ? [...new Set(records.map((node) => `${node.lane}:${node.trackId ?? "story"}`))] : [];
    const partitions = tracks.length && tracks.length <= slots ? tracks.map((track) => records.filter((node) => `${node.lane}:${node.trackId ?? "story"}` === track)) : [records];
    const allocations = partitions.map(() => 1);
    for (let remaining = slots - partitions.length; remaining > 0; remaining--) {
      const target = partitions.reduce((best, members, position) => members.length / allocations[position] > partitions[best].length / allocations[best] ? position : best, 0);
      allocations[target]++;
    }
    for (const [position, partition] of partitions.entries()) {
      for (let groupIndex = 0; groupIndex < allocations[position]; groupIndex++) {
        const start = Math.floor(groupIndex * partition.length / allocations[position]);
        const end = Math.floor((groupIndex + 1) * partition.length / allocations[position]);
        const members = partition.slice(start, end);
        if (members.length === 1) { visible.push(members[0]); mapping.set(members[0].id, members[0].id); }
        else cluster(members, sceneLevel ? "scenes" : "records");
      }
    }
  }
  if (loose.length) cluster(loose, "records", true);
  visible.push(...characters);
  if (sceneLevel) for (const node of nodes) {
    if (mapping.has(node.id)) continue;
    const scene = index.owner.get(node.id);
    const target = scene && mapping.get(scene);
    if (target) mapping.set(node.id, target);
  }
  return { nodes: visible, edges: projectEdges(edges, mapping), representatives: mapping, totalScenes: index.scenes.length, totalRecords: nodes.length, scopeCount: records.length + loose.length, budget };
}

function projectEdges(edges: WorldEdge[], mapping: Map<string, string>) {
  const projected = new Map<string, WorldEdge>();
  const counts = new Map<string, number>();
  for (const edge of edges) {
    if (!semantic(edge)) continue;
    const from = mapping.get(edge.from);
    const to = mapping.get(edge.to);
    if (!from || !to || from === to) continue;
    if (from === edge.from && to === edge.to) { projected.set(edge.id, edge); continue; }
    const key = `view-relation:${JSON.stringify([from, to, edge.kind, edge.state])}`;
    const previous = projected.get(key);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    projected.set(key, { ...edge, id: key, from, to, weight: (previous?.weight ?? 0) + (Number.isFinite(edge.weight) && edge.weight! > 0 ? edge.weight! : 1), derived: true, relationLabel: `${count} projected relationships` });
  }
  return [...projected.values()];
}

export interface ExpansionStep { parentId: string; childIds: string[] }

export function expandSceneGraph(nodes: WorldNode[], edges: WorldEdge[], requests: SceneScope[], budget = SCENE_PAGE_SIZE) {
  const base = projectSceneGraph(nodes, edges, undefined, budget);
  const visible = new Map(base.nodes.map((node) => [node.id, node]));
  const representatives = new Map(base.representatives);
  const membership: WorldEdge[] = [];
  const steps: ExpansionStep[] = [];
  const expanded: SceneScope[] = [];
  for (const request of requests) {
    const parent = visible.get(request.key);
    if (!parent || expanded.some((scope) => scope.key === request.key)) continue;
    const level = projectSceneGraph(nodes, edges, request, budget);
    const children = level.nodes.filter((node) => !visible.has(node.id));
    for (const node of children) visible.set(node.id, node);
    for (const [id, target] of level.representatives) representatives.set(id, visible.has(id) ? id : target);
    if (parent.cluster) for (const node of level.nodes) {
      if (node.kind === "character" || node.id === parent.id || node.id === request.focusSceneId) continue;
      membership.push({ id: `view-membership:${JSON.stringify([parent.id, node.id])}`, from: parent.id, to: node.id, kind: "contains", state: node.state, parent: parent.parent, derived: true, weight: 0.4, relationLabel: "View group membership · not a canonical relation" });
    }
    steps.push({ parentId: parent.id, childIds: children.map((node) => node.id) });
    expanded.push(request);
  }
  for (const node of nodes) if (visible.has(node.id)) representatives.set(node.id, node.id);
  return { ...base, nodes: [...visible.values()], edges: [...projectEdges(edges, representatives), ...membership], rootIds: base.nodes.map((node) => node.id), rootEdges: base.edges, steps, expanded };
}

export function revealSceneNode(nodes: WorldNode[], edges: WorldEdge[], requests: SceneScope[], target: WorldNode) {
  const next = [...requests];
  const index = sceneIndex(nodes, edges);
  const ownerId = target.kind === "scene" ? target.id : index.owner.get(target.id);
  for (let attempt = 0; attempt < 64; attempt++) {
    const view = expandSceneGraph(nodes, edges, next);
    const expanded = new Set(view.expanded.map((scope) => scope.key));
    if (view.nodes.some((node) => node.id === target.id)) {
      if (target.kind === "scene" && !expanded.has(target.id)) next.push(scopeForNode(target)!);
      return next;
    }
    const candidate = view.nodes.find((node) => node.cluster?.ids.includes(target.id) && !expanded.has(node.id))
      ?? view.nodes.find((node) => node.cluster?.ids.includes(ownerId ?? "") && !expanded.has(node.id))
      ?? view.nodes.find((node) => node.id === ownerId && !expanded.has(node.id));
    const scope = candidate && scopeForNode(candidate);
    if (!scope) return next;
    next.push(scope);
  }
  return next;
}
