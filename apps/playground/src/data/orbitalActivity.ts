import type { WorldEdge, WorldNode } from "../types.js";
import { isSourceRelation, orbitalLevel, volumeScope, type OrbitalLevel, type OrbitalScope, type OrbitalWorld } from "./orbitalModel.js";
import type { Position3 } from "./spatialLayout.js";

export interface OrbitalReadingBookmark {
  path: OrbitalScope[];
  selectedId: string | null;
  revealedId: string | null;
  camera: { position: Position3; target: Position3; up: Position3; zoom: number; focalOffset: Position3 } | null;
}

export function copyOrbitalBookmark(bookmark: OrbitalReadingBookmark): OrbitalReadingBookmark {
  return { ...bookmark, path: bookmark.path.map(scope => ({ ...scope, ...(scope.ids ? { ids: [...scope.ids] } : {}) })), camera: bookmark.camera ? { ...bookmark.camera, position: [...bookmark.camera.position], target: [...bookmark.camera.target], up: [...bookmark.camera.up], focalOffset: [...bookmark.camera.focalOffset] } : null };
}

export function orbitalTouchAncestors(nodes: WorldNode[], edges: WorldEdge[], targetId: string): Set<string> {
  const kinds = new Map(nodes.map(node => [node.id, node.kind]));
  const ids = new Set([targetId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const edge of edges) {
      if (edge.kind !== "contains" || !isSourceRelation(edge) || !ids.has(edge.to) || !["scene", "dialogue", "event", "bigEvent"].includes(kinds.get(edge.from) ?? "") || ids.has(edge.from)) continue;
      ids.add(edge.from);
      changed = true;
    }
  }
  return ids;
}

export function orbitalActivityPath(world: OrbitalWorld, targetId: string | null, chapterId: string, activityNodes: WorldNode[] = [], activityEdges: WorldEdge[] = [], preferred: OrbitalScope[] = []): { path: OrbitalScope[]; targetId: string | null } {
  return orbitalActivityBatchPath(world, targetId ? [targetId] : [], chapterId, activityNodes, activityEdges, preferred);
}

export function orbitalActivityBatchPath(world: OrbitalWorld, targetIds: readonly string[], chapterId: string, activityNodes: WorldNode[] = [], activityEdges: WorldEdge[] = [], preferred: OrbitalScope[] = []): { path: OrbitalScope[]; targetId: string | null } {
  const chapterScope = (id: string): OrbitalScope => ({ key: `orbital:chapter:${id}`, kind: "chapter", chapterId: id, label: world.laneNodes.find(node => node.id === id)?.label ?? "Chapter" });
  const hasChapter = (id: string) => !!world.interiors[id] || world.laneNodes.some(node => node.id === id && node.kind === "bigEvent");
  const levels = new Map<string, OrbitalLevel>();
  const levelAt = (scope: OrbitalScope): OrbitalLevel => {
    const key = JSON.stringify([scope.key, scope.kind, scope.chapterId, scope.sceneId, scope.ids]);
    let level = levels.get(key);
    if (!level) {
      level = orbitalLevel(world, scope, activityNodes, activityEdges);
      levels.set(key, level);
    }
    return level;
  };
  const directlyVisible = (level: OrbitalLevel, id: string): boolean => level.nebula.some(node => node.id === id) || level.main.some(entry => entry.node.id === id);
  const visibleTarget = (level: OrbitalLevel, id: string, ancestors: Set<string>): string | null => {
    if (directlyVisible(level, id)) return id;
    return level.main.find(entry => ancestors.has(entry.node.id) || entry.members.some(member => ancestors.has(member)))?.node.id ?? null;
  };
  const locations = new Map<string, string>();
  for (const [id, interior] of Object.entries(world.interiors)) {
    for (const node of interior.nodes) if (!locations.has(node.id) || id === chapterId) locations.set(node.id, id);
  }
  for (const node of activityNodes) if (node.parent) locations.set(node.id, node.parent);
  const routes: { id: string; chapterId: string; ancestors: Set<string>; path: OrbitalScope[] }[] = [];
  for (const id of [...new Set([...targetIds].reverse())].reverse()) {
    const chapterNode = world.laneNodes.find(node => node.id === id && node.kind === "bigEvent");
    const owner = chapterNode?.id ?? locations.get(id);
    if (!owner || !hasChapter(owner)) continue;
    if (chapterNode) {
      routes.push({ id, chapterId: owner, ancestors: new Set([id]), path: [volumeScope] });
      continue;
    }
    const path = [volumeScope, chapterScope(owner)];
    const root = levelAt(path[1]);
    if (!root.sourceNodes.some(node => node.id === id)) continue;
    const ancestors = orbitalTouchAncestors(root.sourceNodes, root.sourceEdges, id);
    const visited = new Set<string>();
    let fallback = [...path];
    for (;;) {
      const scope = path.at(-1)!;
      if (visited.has(scope.key)) break;
      visited.add(scope.key);
      const level = levelAt(scope);
      const visible = visibleTarget(level, id, ancestors);
      if (visible) fallback = [...path];
      if (visible === id) break;
      const container = level.main.find(entry => entry.scope && (ancestors.has(entry.node.id) || entry.members.some(member => ancestors.has(member))));
      if (!container?.scope) break;
      path.push(container.scope);
    }
    routes.push({ id, chapterId: owner, ancestors, path: fallback });
  }
  let path = routes.length ? [...routes[0].path] : hasChapter(chapterId) ? [volumeScope, chapterScope(chapterId)] : [volumeScope];
  for (const route of routes.slice(1)) {
    const shared = path.findIndex((scope, index) => scope.key !== route.path[index]?.key);
    if (shared >= 0) path = path.slice(0, shared);
  }
  const validPreferred: OrbitalScope[] = [];
  for (const scope of preferred) {
    if (scope.kind === "volume") {
      if (validPreferred.length || scope.key !== volumeScope.key) break;
    } else {
      if (!validPreferred.length || validPreferred.at(-1)?.kind === "scene" || !scope.chapterId || !hasChapter(scope.chapterId)) break;
      if (scope.kind === "chapter") {
        if (validPreferred.at(-1)?.kind !== "volume") break;
      } else {
        if (scope.chapterId !== validPreferred.at(-1)?.chapterId) break;
        const root = levelAt(chapterScope(scope.chapterId));
        if (scope.kind === "scene" && !root.sourceNodes.some(node => node.kind === "scene" && node.id === scope.sceneId)) break;
        if (scope.kind === "scenes" && !scope.ids?.some(id => root.sourceNodes.some(node => node.kind === "scene" && node.id === id))) break;
      }
    }
    validPreferred.push(scope);
  }
  for (let index = validPreferred.length - 1; index > 0; index--) {
    const scope = validPreferred[index];
    if (!routes.length ? scope.chapterId !== chapterId : !routes.every(route => route.chapterId === scope.chapterId)) continue;
    const level = levelAt(scope);
    if (routes.every(route => directlyVisible(level, route.id))) {
      path = validPreferred.slice(0, index + 1);
      break;
    }
  }
  const latest = routes.at(-1);
  return { path, targetId: latest ? visibleTarget(levelAt(path.at(-1)!), latest.id, latest.ancestors) : null };
}
