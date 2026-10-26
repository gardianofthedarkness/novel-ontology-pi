import type { WorldEdge, WorldNode } from "../types.js";
import type { OrbitalEntry, OrbitalLevel, OrbitalScope, OrbitalWorld } from "./orbitalModel.js";

export interface LibraryOrganizationView {
  universes: { id: string; title: string }[];
  continuities: { id: string; title: string; universeId: string }[];
  series: { id: string; title: string }[];
  assignments: { sourceId: string; seriesId: string | null; continuityId: string | null; readingOrder: number | null; status: "confirmed" | "unresolved" }[];
}
export interface LibraryView {
  causal?: { links: { id: string; universeId: string; from: { sourceId: string; unitId: string }; to: { sourceId: string; unitId: string }; state: "canon" | "proposed" | "held"; stale: boolean }[]; invalidPackets: number; omittedPackets: number };
  revision: string;
  sources: { id: string; title: string; filename: string }[];
  organization: LibraryOrganizationView;
  plans: { id: string; state: "proposed" | "held"; organization: LibraryOrganizationView }[];
  events: { id: string; type: string; timestamp: string; planId?: string; sourceIds: string[] }[];
  bindings: { sourceId: string; volume: number }[];
  omittedPlans: number;
  totalEvents: number;
}

export const libraryScope: OrbitalScope = { key: "orbital:library", kind: "library", label: "Series library" };
const groupKey = (seriesId: string | null, continuityId: string | null) => `${seriesId ?? "unassigned"}:${continuityId ?? "unknown"}`;
const groupId = (group: string, planId?: string) => `library:${planId ?? "canon"}:series:${group}`;
const fileId = (sourceId: string, planId?: string) => `library:${planId ?? "canon"}:file:${sourceId}`;

function causalEdges(view: LibraryView, scope: OrbitalScope): WorldEdge[] {
  if (scope.planId) return [];
  return (view.causal?.links ?? []).flatMap(link => {
    if (link.stale) return [];
    const sourceNode = (sourceId: string) => {
      const assignment = view.organization.assignments.find(entry => entry.sourceId === sourceId && entry.status === "confirmed");
      if (!assignment) return null;
      return scope.kind === "library" ? groupId(groupKey(assignment.seriesId, assignment.continuityId)) : groupKey(assignment.seriesId, assignment.continuityId) === scope.libraryGroup ? fileId(sourceId) : null;
    };
    const from = sourceNode(link.from.sourceId), to = sourceNode(link.to.sourceId);
    return from && to && from !== to ? [{ id: link.id, from, to, kind: "cross" as const, state: link.state, parent: null, relationType: "CAUSES", relationLabel: "CAUSES · projected from source-qualified event/dialogue endpoints", derived: true }] : [];
  });
}

function groups(view: LibraryView) {
  return [{ organization: view.organization, state: "canon" as const, planId: undefined as string | undefined },
    ...view.plans.map(plan => ({ organization: plan.organization, state: plan.state, planId: plan.id }))];
}

function seriesEntries(view: LibraryView): OrbitalEntry[] {
  return groups(view).flatMap(({ organization, state, planId }) => {
    const keys = [...new Set(organization.assignments.map(entry => groupKey(entry.seriesId, entry.continuityId)))];
    return keys.map((key, index) => {
      const members = organization.assignments.filter(entry => groupKey(entry.seriesId, entry.continuityId) === key);
      const series = organization.series.find(entry => entry.id === members[0].seriesId);
      const continuity = organization.continuities.find(entry => entry.id === members[0].continuityId);
      const universe = organization.universes.find(entry => entry.id === continuity?.universeId);
      const label = series?.title ?? "Unassigned files";
      const id = groupId(key, planId);
      const scope: OrbitalScope = { key: id, label, kind: "series", libraryGroup: key, planId };
      const node: WorldNode = { id, label, kind: "bigEvent", state: state === "canon" && !series ? "held" : state,
        summary: `${label} · ${universe?.title ?? "Universe unknown"} · ${continuity?.title ?? "Continuity unknown"}`,
        subLabel: `${members.length} files · ${planId ? `${state} organization` : "reviewed organization / unresolved files"}`,
        parent: null, lane: "canon", chrono: index, lanePos: [0, 0, 0], interiorPos: [0, 0, 0],
        library: { type: "series", group: key, planId, readingOrder: null } };
      return { node, members: members.map(entry => entry.sourceId), scope };
    });
  }).map((entry, index) => ({ ...entry, node: { ...entry.node, chrono: index } }));
}

export function libraryLevel(world: OrbitalWorld, scope: OrbitalScope): OrbitalLevel {
  const view = world.library!;
  const roots = seriesEntries(view);
  const selected = groups(view).find(entry => entry.planId === scope.planId);
  const assignments = selected?.organization.assignments.filter(entry => groupKey(entry.seriesId, entry.continuityId) === scope.libraryGroup) ?? [];
  const ordered = [...assignments].sort((left, right) => (left.readingOrder ?? Infinity) - (right.readingOrder ?? Infinity) || left.sourceId.localeCompare(right.sourceId));
  const files: OrbitalEntry[] = ordered.flatMap((assignment, index) => {
    const source = view.sources.find(entry => entry.id === assignment.sourceId);
    if (!source) return [];
    const volume = view.bindings.find(entry => entry.sourceId === source.id)?.volume;
    const id = fileId(source.id, scope.planId);
    const uncertain = assignment.status !== "confirmed";
    const node: WorldNode = { id, label: source.filename, summary: source.title,
      subLabel: `${assignment.readingOrder === null ? "Order unknown" : `Reading order ${assignment.readingOrder}`} · ${volume ? "Double-click to open" : "Not attached to viewer"}${uncertain ? " · membership unresolved" : ""}`,
      kind: "bigEvent", state: selected?.state === "canon" && uncertain ? "held" : selected?.state ?? "held",
      parent: groupId(scope.libraryGroup ?? "", scope.planId), lane: "canon", chrono: assignment.readingOrder ?? index,
      trackId: assignment.readingOrder === null || uncertain ? `unknown:${source.id}` : `reading:${scope.key}`,
      lanePos: [0, 0, 0], interiorPos: [0, 0, 0],
      library: { type: "file", sourceId: source.id, volume, planId: scope.planId, readingOrder: uncertain ? null : assignment.readingOrder } };
    return [{ node, members: [source.id], ...(volume ? { scope: { key: "orbital:volume", label: source.filename, kind: "volume" as const, sourceId: source.id } } : {}) }];
  });
  if (scope.kind === "library") {
    const children = roots.flatMap(entry => libraryLevel(world, entry.scope!).main.map(file => file.node));
    return { scope, main: roots, nebula: [], sourceNodes: [...roots.map(entry => entry.node), ...children], sourceEdges: [...children.map(node => ({ id: `library:contains:${node.id}`, from: node.parent!, to: node.id, kind: "contains" as const, state: node.state, parent: null })), ...causalEdges(view, scope)] };
  }
  const root = roots.find(entry => entry.scope?.key === scope.key);
  const fileNodes = files.map(entry => entry.node);
  const sourceEdges = fileNodes.map(node => ({ id: `library:contains:${node.id}`, from: root?.node.id ?? scope.key, to: node.id, kind: "contains" as const, state: node.state, parent: null }));
  return { scope, main: files, nebula: [], sourceNodes: [...(root ? [root.node] : []), ...fileNodes], sourceEdges: [...sourceEdges, ...causalEdges(view, scope)] };
}

export function libraryReadingPrefix(world: OrbitalWorld): OrbitalScope[] {
  if (!world.library) return [];
  const root = seriesEntries(world.library).find(entry => !entry.scope?.planId && entry.members.includes(world.sourceId ?? ""));
  return [libraryScope, ...(root?.scope ? [root.scope] : [])];
}

export function libraryActivityPath(world: OrbitalWorld, event: LibraryView["events"][number]): OrbitalScope[] {
  if (!world.library) return [];
  const roots = seriesEntries(world.library);
  const proposed = world.library.plans.some(plan => plan.id === event.planId);
  const root = roots.find(entry => (proposed ? entry.scope?.planId === event.planId : !entry.scope?.planId)
    && event.sourceIds.length > 0 && event.sourceIds.every(id => entry.members.includes(id)));
  return [libraryScope, ...(root?.scope ? [root.scope] : [])];
}
