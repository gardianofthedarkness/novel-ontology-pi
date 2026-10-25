import type { WorldNode } from "../types.js";
import { sceneIndex } from "./sceneHierarchy.js";
import { representativeScene, type OrbitalLevel, type OrbitalScope, type OrbitalWorld } from "./orbitalModel.js";
import type { BookEntry } from "./bookCatalog.js";

/**
 * Where the reader is: book file → chapter → entered scene groups, then the
 * explicit selection (scene, or a record with its owning scene). Entered
 * levels carry `pathIndex` for navigation; a selection never claims to be an
 * entered level, and nothing is claimed when nothing is selected.
 */
export interface LocationCrumb { key: string; kind: "book" | "chapter" | "scenes" | "scene" | "record"; label: string; detail?: string; pathIndex?: number; selection?: boolean }

const order = (first: WorldNode, second: WorldNode) => first.chrono - second.chrono || first.id.localeCompare(second.id);
const summary = (node?: WorldNode) => node?.summary?.trim() || undefined;
const RECORD_LABEL: Partial<Record<WorldNode["kind"], string>> = { event: "Event", dialogue: "Dialogue", character: "Character", location: "Location", picture: "Picture", portrait: "Portrait" };

function sceneRange(ordinals: Map<string, number>, ids: string[]): string | undefined {
  const ranks = ids.flatMap((id) => ordinals.get(id) ?? []);
  if (!ranks.length) return undefined;
  const first = Math.min(...ranks), last = Math.max(...ranks);
  return first === last ? `Scene ${first}` : `Scenes ${first}–${last}`;
}

export function orbitalLocation(world: OrbitalWorld, path: OrbitalScope[], level: OrbitalLevel, book: BookEntry | null, selected: WorldNode | null = null): LocationCrumb[] {
  const crumbs: LocationCrumb[] = [{ key: "book", kind: "book", label: book ? book.sourceFile ?? book.title : "Volume", detail: book?.sourceFile && book.title !== book.sourceFile ? book.title : undefined, pathIndex: 0 }];
  const current = path[path.length - 1];
  const chapterId = current.chapterId ?? (selected?.kind === "bigEvent" ? undefined : selected?.parent ?? undefined);
  const scenes = level.sourceNodes.filter((node) => node.kind === "scene" && !node.cluster && (!chapterId || node.parent === chapterId)).sort(order);
  const ordinals = new Map(scenes.map((node, index) => [node.id, index + 1]));
  const byId = new Map(level.sourceNodes.map((node) => [node.id, node]));
  const chapterLabel = (id?: string) => world.laneNodes.find((node) => node.id === id)?.label ?? "Chapter";
  const sceneCrumb = (scene: WorldNode | undefined, id: string, extra: Partial<LocationCrumb>): LocationCrumb => ({ key: `scene:${id}`, kind: "scene", label: sceneRange(ordinals, [id]) ?? "Scene", detail: summary(scene) ?? scene?.label, ...extra });
  path.forEach((scope, index) => {
    if (!index) return;
    if (scope.kind === "chapter") crumbs.push({ key: scope.key, kind: "chapter", label: chapterLabel(scope.chapterId), pathIndex: index });
    else if (scope.kind === "scenes") {
      const ids = scope.ids ?? [];
      const members = ids.flatMap((id) => byId.get(id) ?? []);
      crumbs.push({ key: scope.key, kind: "scenes", label: sceneRange(ordinals, ids) ?? `${ids.length} scenes`, detail: summary(representativeScene(level.sourceNodes, level.sourceEdges, members)) ?? summary(members.find((node) => summary(node))), pathIndex: index });
    } else if (scope.kind === "scene" && scope.sceneId) crumbs.push(sceneCrumb(byId.get(scope.sceneId), scope.sceneId, { pathIndex: index }));
  });
  if (!selected) return crumbs;
  if (selected.kind === "bigEvent") {
    if (current.kind === "volume") crumbs.push({ key: `chapter:${selected.id}`, kind: "chapter", label: chapterLabel(selected.id), detail: summary(selected), selection: true });
  } else if (selected.cluster?.kind === "scenes") {
    crumbs.push({ key: selected.id, kind: "scenes", label: sceneRange(ordinals, selected.cluster.ids) ?? `${selected.cluster.ids.length} scenes`, detail: summary(selected), selection: true });
  } else if (selected.kind === "scene") {
    if (selected.id !== current.sceneId) crumbs.push(sceneCrumb(selected, selected.id, { selection: true }));
  } else {
    if (selected.kind === "event" || selected.kind === "dialogue") {
      const owner = sceneIndex(level.sourceNodes, level.sourceEdges).owner.get(selected.id);
      if (!owner) crumbs.push({ key: `scene:unknown:${selected.id}`, kind: "scene", label: "Scene not recorded", selection: true });
      else if (owner !== current.sceneId) crumbs.push(sceneCrumb(byId.get(owner), owner, { selection: true }));
    }
    crumbs.push({ key: `record:${selected.id}`, kind: "record", label: RECORD_LABEL[selected.kind] ?? "Record", detail: selected.label, selection: true });
  }
  return crumbs;
}
