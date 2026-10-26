import type { CanonState, CausalLink } from "../types.js";
import type { OrbitalLevel, OrbitalWorld } from "./orbitalModel.js";
import type { OrbitalDraw } from "./orbitalLayout.js";
import { sceneIndex } from "./sceneHierarchy.js";
import type { LibraryView } from "./libraryModel.js";

type UniverseCausalLink = NonNullable<LibraryView["causal"]>["links"][number];

/**
 * Stored CAUSES links drawn on the current orbital level. An endpoint event
 * is shown on its own sphere when that record is visible; otherwise on the
 * smallest visible sphere containing it (its scene, scene group or chapter).
 * Such arrows are PROJECTIONS: the containers themselves are not causal
 * facts, and each arrow keeps the event links it stands for.
 */
export interface CausalArrow {
  id: string;
  from: string;
  to: string;
  links: (CausalLink | UniverseCausalLink)[];
  /** True when either end is a container rather than the event itself. */
  projected: boolean;
  state: CanonState;
  /** Where the curve's middle bends, from the chord's midpoint (world units);
   * absent: straight up. Set by collision-free routing (orbital Story time). */
  bend?: [number, number, number];
}
export interface CausalProjection {
  arrows: CausalArrow[];
  /** Links whose two events sit inside the same visible sphere. */
  inside: number;
  /** Per visible sphere: stored links between two events inside it. */
  insideBy: Map<string, number>;
  /** Links with an endpoint outside this level (e.g. another chapter). */
  elsewhere: number;
}

/** The world's stored CAUSES links. Older snapshots without `causal` still
 * carry same-chapter CAUSES edges (typed, or named `<chapter>:CAUSES:…`). */
export function worldCausalLinks(world: OrbitalWorld): CausalLink[] {
  if (world.causal) return world.causal.links;
  return Object.entries(world.interiors).flatMap(([chapterId, interior]) => interior.edges
    .filter((edge) => edge.relationType === "CAUSES" || edge.id.startsWith(`${chapterId}:CAUSES:`))
    .map((edge): CausalLink => ({ id: `causes:${edge.from}:${edge.to}`, from: edge.from, to: edge.to, fromChapter: chapterId, toChapter: chapterId, state: edge.state })));
}

const size = (draw: OrbitalDraw) => draw.entry?.members.length ?? draw.node.cluster?.ids.length ?? 1;
const weakest = (states: CanonState[]): CanonState => states.includes("held") ? "held" : states.includes("proposed") ? "proposed" : "canon";

export function libraryCausalProjection(level: OrbitalLevel, draws: OrbitalDraw[], library: LibraryView | undefined): CausalProjection {
  const result: CausalProjection = { arrows: [], inside: 0, insideBy: new Map(), elsewhere: 0 };
  if (!library || level.scope.planId || !["library", "series"].includes(level.scope.kind)) return result;
  const confirmed = new Set(library.organization.assignments.filter(entry => entry.status === "confirmed").map(entry => entry.sourceId));
  const candidates = draws.filter(draw => (draw.role === "main" || draw.role === "preview") && draw.node.library && !draw.node.library.planId).sort((first, second) => size(first) - size(second));
  const holder = (sourceId: string) => candidates.find(draw => draw.entry?.members.includes(sourceId));
  const arrows = new Map<string, CausalArrow>();
  for (const link of library.causal?.links ?? []) {
    if (link.stale || !confirmed.has(link.from.sourceId) || !confirmed.has(link.to.sourceId)) continue;
    const from = holder(link.from.sourceId), to = holder(link.to.sourceId);
    if (!from || !to) { result.elsewhere++; continue; }
    if (from.node.id === to.node.id) {
      result.inside++;
      result.insideBy.set(from.node.id, (result.insideBy.get(from.node.id) ?? 0) + 1);
      continue;
    }
    const id = `universe-causal:${from.node.id}>${to.node.id}`;
    const arrow = arrows.get(id) ?? { id, from: from.node.id, to: to.node.id, links: [], projected: true, state: "canon" as CanonState };
    arrow.links.push(link);
    arrow.state = weakest(arrow.links.map(entry => entry.state));
    arrows.set(id, arrow);
  }
  result.arrows = [...arrows.values()];
  return result;
}

export function causalProjection(level: OrbitalLevel, draws: OrbitalDraw[], links: CausalLink[] = [], dialogueScenes: Record<string, string> = {}): CausalProjection {
  const chapterId = level.scope.chapterId;
  const relevant = chapterId ? links.filter((link) => link.fromChapter === chapterId || link.toChapter === chapterId) : links;
  if (!relevant.length) return { arrows: [], inside: 0, insideBy: new Map(), elsewhere: 0 };
  const owner = sceneIndex(level.sourceNodes, level.sourceEdges).owner;
  const candidates = draws.filter((draw) => draw.role === "main" || draw.role === "preview");
  const holder = (eventId: string, chapter: string): OrbitalDraw | undefined => {
    const exact = candidates.find((draw) => draw.node.id === eventId);
    if (exact) return exact;
    // Dialogue-card endpoints are not world nodes: project them onto
    // their owning scene's sphere (same idea as hidden-event arrows).
    const chain = new Set([eventId, owner.get(eventId), dialogueScenes[eventId], chapter].filter((id): id is string => !!id));
    return candidates
      .filter((draw) => chain.has(draw.node.id) || draw.entry?.members.some((id) => chain.has(id)) || draw.node.cluster?.ids.some((id) => chain.has(id)))
      .sort((first, second) => size(first) - size(second))[0];
  };
  const arrows = new Map<string, CausalArrow>();
  const insideBy = new Map<string, number>();
  let inside = 0, elsewhere = 0;
  for (const link of relevant) {
    const from = holder(link.from, link.fromChapter), to = holder(link.to, link.toChapter);
    if (!from || !to) { elsewhere++; continue; }
    if (from === to) { inside++; insideBy.set(from.node.id, (insideBy.get(from.node.id) ?? 0) + 1); continue; }
    const id = `causal:${from.node.id}>${to.node.id}`;
    const arrow = arrows.get(id) ?? { id, from: from.node.id, to: to.node.id, links: [], projected: false, state: "canon" as CanonState };
    arrow.links.push(link);
    arrow.projected ||= from.node.id !== link.from || to.node.id !== link.to;
    arrow.state = weakest(arrow.links.map((entry) => entry.state));
    arrows.set(id, arrow);
  }
  return { arrows: [...arrows.values()], inside, insideBy, elsewhere };
}
