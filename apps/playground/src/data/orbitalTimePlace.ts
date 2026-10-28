import type { CausalLink, CausalSummary, WorldEdge, WorldNode } from "../types.js";
import type { CausalArrow } from "./causalProjection.js";
import type { Position3 } from "./spatialLayout.js";
import { helixPoint, nebulaRadius, type OrbitalDraw, type OrbitalPath } from "./orbitalLayout.js";
import { storyStrands, type StrandCheck, type StrandEdge } from "./storyStrands.js";
import { calendarDay, calendarDayKey, dateLine, sceneDays, type SpiralView, placeLinks, placePathLabel, placeTreeLayout, scenePeriod, type StoryScene, type TimePlaceProjection } from "./timePlace.js";

/**
 * Orbital Story time and Places (time-place phase 1, view only). Each is the
 * book's world regrouped so the orbit can draw it unchanged: Story time
 * puts one sphere per story period on the string in story order (flashbacks
 * on a raised track, threaded back to when they were told). Entering a
 * period shows its scenes in reading order, then their records, exactly as a
 * chapter does. Places is a space-time view: the schematic map lies flat on
 * the floor and the scenes of the chosen story periods float above their
 * place, rising in story order, so the timeline and a character's path run
 * through the air over the map. Nothing here is written back to the ontology.
 */
interface WorldLike {
  laneNodes: WorldNode[];
  interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }>;
}
export interface RegroupedWorld {
  laneNodes: WorldNode[];
  laneEdges: WorldEdge[];
  interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }>;
  bigEventLabels: Record<string, string>;
  causal?: CausalSummary;
  /** Other volumes this book's cross-volume causal links reach (Story time). */
  portals?: VolumePortal[];
}
export interface VolumePortal { id: string; sourceId: string; label: string; before: boolean; links: number }
interface LibraryLike {
  sources: { id: string; title: string; filename: string }[];
  causal?: { links: { id: string; universeId: string; from: { sourceId: string; unitId: string }; to: { sourceId: string; unitId: string }; state: CausalLink["state"]; stale: boolean }[] };
}
export const portalNodeId = (sourceId: string) => `volume:${sourceId}`;
/** Volume-level arrangement handed to the orbital explorer. */
export interface OrbitalArrangement {
  /** Anchor positions (layout units, before the orbit's ×3 scale). */
  anchors?: Map<string, Position3>;
  /** Replaces the volume level's strings; gets the drawn spheres and the selection. */
  paths?: (draws: OrbitalDraw[], selectedId: string | null) => OrbitalPath[];
  /** What to frame when a sphere is selected, instead of the sphere alone. */
  focusFor?: (selectedId: string, draws: OrbitalDraw[]) => Position3[] | null;
  /** Extra fixed spheres (world units), e.g. place pins on the map. */
  extraDraws?: OrbitalDraw[];
  /** Flat marks on the floor (world units): the 2D map. */
  floor?: FloorMark[];
  /** Giant calendar pins behind the story (world units): where each calendar day starts. */
  pins?: CalendarPin[];
  /** Rulers on the same backdrop showing how story time is compressed (a stored spiral). */
  meters?: TimeMeter[];
  /** A tap on a strand's axis (path id, sample index): the scenes it lights (that strand on the tapped calendar day, or all
   * of it when that stretch has no date), with a line saying what is lit, in the strand's colour. */
  strandPeriod?: (pathId: string, index: number) => { ids: string[]; strandId: string; label: string; book?: number } | null;
  /** A lit strand's cast (strandCast) for its scene ids, nearest the tap first. */
  strandCast?: (scenes: string[], draws: OrbitalDraw[]) => StrandCast;
  /** Main sphere size factor and camera direction for this arrangement. */
  radiusScale?: number;
  direction?: Position3;
  /** A selected character's path stands in for their link fan. */
  pathReplacesLinks?: boolean;
  /** Draw the book's stored causal links on this level, routed by routeCausal. */
  causal?: boolean;
  routeCausal?: (arrows: CausalArrow[], draws: OrbitalDraw[]) => CausalArrow[];
  /** What the camera frames on arrival (default: every main sphere). */
  initialFrame?: (draws: OrbitalDraw[]) => Position3[];
  /** Main spheres as transparent envelopes around their records ("shell"), or not drawn ("hidden"). */
  envelope?: "shell" | "hidden";
  /** Universe views: what to frame for the book being read; the camera flies there when the book changes. */
  bookFrame?: (draws: OrbitalDraw[]) => Position3[] | null;
  /** Which book `bookFrame` frames (a change triggers the flight). */
  bookKey?: string;
  /** Minecraft-style render distance (world units) around where the camera looks: farther things fade and are not drawn. */
  renderDistance?: number;
  timeKey: { label: string; detail: string };
  /** The shape of the layout: when it changes on the same level, spheres glide to their new places. */
  morphKey?: string;
  /** Per-sphere start delays (ms) for that glide, e.g. the line shredding into strands in story order. */
  morphDelays?: (draws: OrbitalDraw[]) => Map<string, number>;
}
/** A calendar day behind the story like a backdrop: a big date high up and far back where the day's first scene sits, a faint pole down to the floor. */
export interface CalendarPin { id: string; x: number; z: number; top: number; card: number; label: string; detail: string }
/** A ruler on the date backdrop over one book's stretch (world units): a tick per story moment, bunching where quiet time
 * is compressed, and where the pace changes, how much ("time ×0.4"). */
export interface TimeMeter { id: string; y: number; z: number; ticks: number[]; zones: { x: number; label: string }[] }
/** A place's disc on the floor; a region (a place containing others) is a wider, fainter disc under its children. */
export interface FloorMark { id: string; x: number; z: number; radius: number; active: boolean; depth?: number; region?: boolean; proposed?: boolean }


/** A scene with everything around it in its chapter: records it covers and
 * the characters and places linked to either. */
function sceneBundles(world: WorldLike) {
  const bundles = new Map<string, { nodes: WorldNode[]; edges: WorldEdge[] }>();
  for (const interior of Object.values(world.interiors)) {
    const byId = new Map(interior.nodes.map((node) => [node.id, node]));
    for (const scene of interior.nodes.filter((node) => node.kind === "scene")) {
      const members = new Set([scene.id]);
      for (const edge of interior.edges) if (edge.kind === "contains" && edge.from === scene.id && byId.get(edge.to) && byId.get(edge.to)!.kind !== "character" && byId.get(edge.to)!.kind !== "location") members.add(edge.to);
      for (const edge of interior.edges) {
        for (const [here, there] of [[edge.from, edge.to], [edge.to, edge.from]]) {
          const other = byId.get(there);
          if (members.has(here) && other && (other.kind === "character" || other.kind === "location")) members.add(there);
        }
      }
      bundles.set(scene.id, {
        nodes: [...members].map((id) => byId.get(id)!).filter(Boolean),
        edges: interior.edges.filter((edge) => members.has(edge.from) && members.has(edge.to)),
      });
    }
  }
  return bundles;
}

/** The reader's book's own id for a scene (universe ids are `<volume>:<id>`); other books' scenes have no records here. */
const localScene = (scene: StoryScene, volume: number | null | undefined) => scene.book === undefined ? scene.id : volume !== null && volume !== undefined && scene.book === volume ? scene.id.slice(scene.id.indexOf(":") + 1) : null;

function regroup(bundles: Map<string, { nodes: WorldNode[]; edges: WorldEdge[] }>, groupId: string, scenes: StoryScene[], volume?: number | null) {
  const nodes = new Map<string, WorldNode>(), edges = new Map<string, WorldEdge>();
  for (const scene of scenes) {
    const local = localScene(scene, volume);
    const bundle = local ? bundles.get(local) : undefined;
    if (!bundle) continue;
    // Reading order across chapters: the scene's book-wide index.
    for (const node of bundle.nodes) if (!nodes.has(node.id)) nodes.set(node.id, { ...node, parent: groupId, ...(node.id === local ? { chrono: scene.index } : {}) });
    for (const edge of bundle.edges) edges.set(edge.id, { ...edge, parent: groupId });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

const groupNode = (id: string, label: string, viewKind: string, chrono: number, trackId: string, summary: string, proposed = false): WorldNode => ({
  id, label, viewKind, kind: "bigEvent", state: proposed ? "proposed" : "canon", parent: null, lane: "canon", chrono, trackId, trackLabel: viewKind, summary, subLabel: summary, lanePos: [0, 0, 0], interiorPos: [0, 0, 0],
});

/**
 * Before the time-place faculty has run there is no story order yet: the
 * book's scenes in reading order stand in (no periods, places or
 * flashbacks), so the spiral and its causal arrows still show.
 */
export function readingOrderProjection(world: WorldLike): TimePlaceProjection {
  const chapters = world.laneNodes.filter((node) => node.kind === "bigEvent").sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));
  let index = 0;
  const scenes: StoryScene[] = chapters.flatMap((chapter, chapterIndex) => (world.interiors[chapter.id]?.nodes ?? [])
    .filter((node) => node.kind === "scene")
    .sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id))
    .map((node) => ({ id: node.id, index: index++, chapterIndex, label: node.summary ?? node.label, times: [], flashback: false, placeIds: [], placeCarried: false, characterIds: [] })));
  return { available: false, times: [], scenes, places: [], characters: [], names: {} };
}

/** Scenes in story order: by period (estimated story order), then reading order; scenes before the first time word lead.
 * In a universe, each continuity keeps its own clock: continuities in turn, each in its own story order. */
export function storyOrderScenes(data: TimePlaceProjection): StoryScene[] {
  const rank = new Map(data.times.map((time) => [time.id, time.storyIndex]));
  const lane = new Map((data.continuities ?? []).map((continuity, index) => [continuity.id, index]));
  const laneOf = (scene: StoryScene) => scene.continuityId ? lane.get(scene.continuityId) ?? lane.size : 0;
  return [...data.scenes].sort((first, second) => laneOf(first) - laneOf(second) || (rank.get(scenePeriod(first) ?? "") ?? -1) - (rank.get(scenePeriod(second) ?? "") ?? -1) || first.index - second.index);
}
/** Universe: which continuity lane each scene's spiral runs in (0 for a single book). */
export function continuityLanes(data: TimePlaceProjection): (scene: StoryScene) => number {
  const lane = new Map((data.continuities ?? []).map((continuity, index) => [continuity.id, index]));
  return (scene) => scene.continuityId ? lane.get(scene.continuityId) ?? lane.size : 0;
}
export const bookNodeId = (volume: number) => `book:${volume}`;
export const spiralNodeId = (sceneId: string) => `spiral:${sceneId}`;
export const sceneOfSpiral = (id: string) => id.startsWith("spiral:") ? id.slice(7) : null;

function causalContainers(world: RegroupedWorld): void {
  if (!world.causal) return;
  const owners = new Map(Object.entries(world.interiors).flatMap(([id, interior]) => interior.nodes.map(node => [node.id, id] as const)));
  world.causal = { ...world.causal, links: world.causal.links.map(link => ({ ...link, fromChapter: owners.get(link.from) ?? link.fromChapter, toChapter: owners.get(link.to) ?? link.toChapter })) };
}

/** Story time: every scene of the book on one spiral in story order. Each
 * sphere is a scene (inside: its events and dialogue); its code line names
 * its period. The book's stored causal links come along for the arrows. */
export function spiralWorld(world: WorldLike & { causal?: CausalSummary; library?: LibraryLike; sourceId?: string | null }, data: TimePlaceProjection, volume?: number | null): RegroupedWorld {
  const bundles = sceneBundles(world);
  const timeById = new Map(data.times.map((time) => [time.id, time]));
  const result: RegroupedWorld = { laneNodes: [], laneEdges: [], interiors: {}, bigEventLabels: {}, causal: world.causal };
  storyOrderScenes(data).forEach((scene, rank) => {
    const id = spiralNodeId(scene.id);
    const time = timeById.get(scenePeriod(scene) ?? "");
    const host = time?.toldFromId ? timeById.get(time.toldFromId) : undefined;
    const period = time ? `${time.flashback ? "↶ " : ""}${time.label}${dateLine(time) ? ` · ${dateLine(time)}` : ""}` : data.available ? "Time not stated" : `Chapter ${scene.chapterIndex} · reading order`;
    const place = scene.placeIds[0] ? data.names[scene.placeIds[0]] ?? scene.placeIds[0] : null;
    const book = scene.book !== undefined ? data.books?.find((entry) => entry.volume === scene.book)?.title : undefined;
    const summary = `${book ? `${book} · ` : ""}${period}${time?.flashback ? ` · flashback${host ? ` told during ${host.label}` : ""}` : ""}${place ? ` · ⌖ ${place}${scene.placeCarried ? " (carried over)" : ""}` : ""} · scene ${scene.index + 1} in reading order, chapter ${scene.chapterIndex}`;
    result.laneNodes.push({ ...groupNode(id, scene.label, period, rank, time?.flashback ? "flashback" : "present", summary, !!time?.proposed), albumSceneId: scene.id });
    result.bigEventLabels[id] = scene.label;
    const bundle = regroup(bundles, id, [scene], volume);
    const local = localScene(scene, volume);
    result.interiors[id] = { nodes: bundle.nodes.filter((node) => node.id !== local), edges: bundle.edges.filter((edge) => edge.from !== local && edge.to !== local) };
  });
  causalContainers(result);
  // Cross-volume causes (the universe ledger): one end here, the other at a
  // portal for the other volume, before or after the spiral by reading order.
  const here = world.sourceId, sources = world.library?.sources ?? [];
  const crossing = here ? (world.library?.causal?.links ?? []).filter((link) => !link.stale && (link.from.sourceId === here) !== (link.to.sourceId === here)) : [];
  if (crossing.length) {
    const position = (sourceId: string) => sources.findIndex((source) => source.id === sourceId);
    const portals = new Map<string, VolumePortal>();
    const links = crossing.map((link): CausalLink => {
      const other = link.from.sourceId === here ? link.to : link.from;
      const portal = portals.get(other.sourceId) ?? { id: portalNodeId(other.sourceId), sourceId: other.sourceId, label: sources[position(other.sourceId)]?.title ?? other.sourceId, before: position(other.sourceId) < position(here!), links: 0 };
      portal.links++;
      portals.set(other.sourceId, portal);
      return { id: `universe:${link.id}`, from: link.from.sourceId === here ? link.from.unitId : portal.id, to: link.to.sourceId === here ? link.to.unitId : portal.id, fromChapter: "", toChapter: "", state: link.state, universeId: link.universeId };
    });
    result.causal = { unresolved: result.causal?.unresolved ?? 0, dialogueScenes: result.causal?.dialogueScenes, links: [...(result.causal?.links ?? []), ...links] };
    result.portals = [...portals.values()];
  }
  return result;
}

/** Scenes per turn, radius and step along the axis (layout units). */
const SPIRAL = { perTurn: 14, radius: 260, step: 40, laneGap: 1400 };
/** Render distance for a universe spiral: about two books' stretch of spiral (world units). */
const renderReach = (order: StoryScene[]) => {
  const perBook = new Map<number, number>();
  for (const scene of order) perBook.set(scene.book ?? 0, (perBook.get(scene.book ?? 0) ?? 0) + 1);
  const typical = [...perBook.values()].sort((first, second) => first - second)[Math.floor(perBook.size / 2)] ?? order.length;
  return Math.max(4500, typical * SPIRAL.step * 3 * 1.6);
};
export type StoryShape = "line" | "strands";
/** Strands as parallel coils: each strand its own spiral around its own axis, the busiest where the
 * line was and the others stacked above it (all above the floor), far enough apart to tell at a
 * glance. One story position is one angle on every coil (a vertical rung joins the scenes of one
 * moment); where strands split or meet, an S-curve crosses between coils. */
const COILS = { gap: 1100 };
function coilHeights(strands: { lane: Map<string, number> }): Map<number, number> {
  const counts = new Map<number, number>();
  for (const lane of strands.lane.values()) counts.set(lane, (counts.get(lane) ?? 0) + 1);
  return new Map([...counts].sort((first, second) => second[1] - first[1] || first[0] - second[0]).map(([lane], rank) => [lane, rank * COILS.gap]));
}
/** A change of the Story time shape: the user's switch (shredding or weaving, framed like the view
 * opens) or new evidence moving scenes within one shape. Null: nothing moved. */
export function shapeChange(previous: string | undefined, next: string | undefined): { caption: string; reframe: boolean } | null {
  if (!previous || !next || previous === next) return null;
  const shape = (key: string) => key.slice(0, key.indexOf(":"));
  if (shape(previous) !== shape(next)) return { caption: shape(next) === "strands" ? "Shredding the story line into strands…" : "Weaving the strands back into one line…", reframe: true };
  return { caption: shape(next) === "strands" ? "Strands moving to new evidence…" : "Story line moving to new evidence…", reframe: false };
}
/** A point on a strand's coil (layout units): story position along the axis, the coil's height above the middle one. */
const coilPoint = (layer: number, total: number, height: number, continuity: number): Position3 => {
  const angle = layer / SPIRAL.perTurn * Math.PI * 2;
  return [(layer - (total - 1) / 2) * SPIRAL.step, Math.cos(angle) * SPIRAL.radius + height, Math.sin(angle) * SPIRAL.radius + continuity * SPIRAL.laneGap];
};
const smoothstep = (t: number) => t * t * (3 - 2 * t);
/** How long the line takes to shred into strands, first scene to last (ms). */
const SHRED_MS = 1600;
/** The place checks in one line: splits and merges with and without place evidence, open ends, conflicts. */
export function strandSummary(checks: StrandCheck[]): string {
  const count = (kind: StrandCheck["kind"], status?: string) => checks.filter((check) => check.kind === kind && (!status || check.status === status)).length;
  const list = (entries: [number, string][]) => entries.filter(([value]) => value).map(([value, text]) => `${value} ${text}`).join(", ");
  const splits = list([[count("split", "places differ"), "at different places"], [count("split", "same place"), "at one place (doubtful)"], [count("split", "unplaced"), "with no place"]]);
  const meetings = list([[count("merge", "joins"), "at one strand's place"], [count("merge", "meets"), "at a new place"], [count("merge", "unplaced"), "with no place"]]);
  const apart = count("apart"), conflicts = count("conflict");
  const parts = [
    splits ? `splits: ${splits}` : "no splits",
    meetings ? `meetings: ${meetings}` : "no meetings",
    ...(apart ? [`${apart} chapter${apart === 1 ? " ends" : "s end"} with strands apart`] : []),
    ...(conflicts ? [`${conflicts} conflict${conflicts === 1 ? "" : "s"}: one person at two places at one stated moment`] : []),
  ];
  return parts.join(" · ");
}
/** Strands per book (a universe stacks its books in reading order along each continuity's axis). */
function strandLayout(data: TimePlaceProjection, lanes: Map<number, StoryScene[]>) {
  const anchors = new Map<string, Position3>(), layer = new Map<string, number>(), continues = new Map<string, string | null>();
  /** Where each scene sits on its coil, so strands can be drawn as curves along it. */
  const place = new Map<string, { height: number; total: number; continuity: number }>();
  const edges: StrandEdge[] = [];
  const checks: StrandCheck[] = [];
  // Books in reading order (scenes before a book's first time word would otherwise put a later book first).
  const reading = new Map((data.books ?? []).map((book) => [book.volume, book.readingOrder ?? Infinity]));
  for (const [lane, scenes] of lanes) {
    const books = [...new Set(scenes.map((scene) => scene.book ?? 0))].sort((first, second) => (reading.get(first) ?? Infinity) - (reading.get(second) ?? Infinity) || first - second);
    const sets = books.map((book) => storyStrands({ ...data, scope: "book", scenes: scenes.filter((scene) => (scene.book ?? 0) === book) }));
    const total = sets.reduce((sum, set) => sum + set.layers, 0);
    let offset = 0;
    sets.forEach((set) => {
      const heights = coilHeights(set);
      for (const [id, at] of set.layer) {
        const height = heights.get(set.lane.get(id)!) ?? 0;
        anchors.set(id, coilPoint(offset + at, total, height, lane));
        layer.set(id, offset + at);
        place.set(id, { height, total, continuity: lane });
        continues.set(id, set.continues.get(id) ?? null);
      }
      edges.push(...set.edges);
      checks.push(...set.checks);
      offset += set.layers;
    });
  }
  /** World-unit samples between two scenes along their coils; the coil height eases across (an S-curve). */
  const curve = (from: string, to: string, steps: number): Position3[] => {
    const a = place.get(from), b = place.get(to), la = layer.get(from), lb = layer.get(to);
    if (!a || !b || la === undefined || lb === undefined || a.continuity !== b.continuity) return [];
    return Array.from({ length: steps - 1 }, (_, index) => {
      const t = (index + 1) / steps;
      return coilPoint(la + (lb - la) * t, a.total, a.height + (b.height - a.height) * smoothstep(t), a.continuity).map((value) => value * 3) as Position3;
    });
  };
  return { anchors, layer, continues, edges, checks, curve };
}
/**
 * Rough calendar marks for the story axis: in each book's stretch of a
 * continuity, a pin where each calendar day's first (non-flashback) scene
 * sits. Days that would stand behind an earlier day's pin (a day only seen
 * out of order) get none. Layout anchors in, world units out (the orbit draws
 * anchors ×3).
 */
/** How far behind the story the calendar stands, and how far apart two dates must start to keep their own labels (layout units). */
const PIN_BACK = 2000, PIN_SPACING = 1400;
export function calendarPins(data: TimePlaceProjection, anchors: Map<string, Position3>, laneOf: (scene: StoryScene) => number): CalendarPin[] {
  const entries = new Map((data.calendar?.entries ?? []).filter((entry) => entry.placed !== "between" && entry.year !== null).map((entry) => [entry.id, entry]));
  if (!entries.size) return [];
  type First = { lane: number; book: number | null; day: { year: number; month: number; day: number }; start: number; x: number };
  const firsts = new Map<string, First>();
  /** How high each book's stretch of strands reaches: its pins rise that far. */
  const tops = new Map<string, number>();
  for (const scene of data.scenes) {
    const anchor = anchors.get(spiralNodeId(scene.id));
    if (!anchor) continue;
    const stretch = `${laneOf(scene)}|${scene.book ?? ""}`;
    tops.set(stretch, Math.max(tops.get(stretch) ?? -Infinity, anchor[1]));
    const entry = scene.flashback ? undefined : scene.times.map((time) => entries.get(time.id)).find(Boolean);
    if (!entry) continue;
    const day = { year: entry.year!, month: entry.month!, day: entry.day! };
    const key = `${laneOf(scene)}|${scene.book ?? ""}|${calendarDayKey(day)}`;
    const known = firsts.get(key);
    if (!known || anchor[0] < known.x) firsts.set(key, { lane: laneOf(scene), book: scene.book ?? null, day, start: Math.floor(entry.span.start / 1440), x: anchor[0] });
  }
  const pins: CalendarPin[] = [];
  const stretches = new Map<string, First[]>();
  for (const first of firsts.values()) stretches.set(`${first.lane}|${first.book ?? ""}`, [...(stretches.get(`${first.lane}|${first.book ?? ""}`) ?? []), first]);
  for (const [stretch, days] of stretches) {
    let last = -Infinity, kept: { pin: CalendarPin; first: First } | null = null;
    for (const first of days.sort((a, b) => a.start - b.start)) {
      if (first.x <= last) continue;
      last = first.x;
      // Days that start closer than one date's width share a label ("12月24–25日").
      if (kept && first.x - kept.first.x < PIN_SPACING) {
        kept.pin.label = `${kept.first.day.month}月${kept.first.day.day}–${first.day.month === kept.first.day.month ? "" : `${first.day.month}月`}${first.day.day}日`;
        continue;
      }
      const date = calendarDay(first.start * 1440);
      const pin: CalendarPin = { id: `calendar:${first.lane}:${first.book ?? ""}:${calendarDayKey(date)}`, x: (first.x - SPIRAL.step / 2) * 3, z: (first.lane * SPIRAL.laneGap - SPIRAL.radius - PIN_BACK) * 3, top: ((tops.get(stretch) ?? 0) + 220) * 3,
        // The date floats above the book's strands, far behind the scenes: a backdrop, not a record.
        card: ((tops.get(stretch) ?? 0) + 520) * 3,
        label: `${first.day.month}月${first.day.day}日`, detail: `Year ${first.day.year}${first.book !== null ? ` · Book ${first.book}` : ""}` };
      pins.push(pin);
      kept = { pin, first };
    }
  }
  return pins;
}

/**
 * The stored spiral (precomputed offline by `novel calendar build`): scene
 * spheres on the knots, all in the design's cyan: each strand's axis (its
 * skeleton, tappable) and coil glow by how much the strand matters (the
 * square root of its share of the busiest strand's scenes), so main strands
 * stand out and minor ones stay dim; all on the floor box it was solved in. Drawn as solved at one uniform scale (a quiet
 * story layer is one step); no optimisation happens here.
 */
function storedSpiral(spiral: SpiralView) {
  const along = SPIRAL.step / spiral.scale.dx, across = along, laneGap = Math.max(SPIRAL.laneGap, (spiral.scale.width + 2 * spiral.scale.dx * 10) * along);
  const xs = spiral.runs.flatMap((run) => run.knots.map((knot) => knot.x)), middle = (Math.min(...xs) + Math.max(...xs)) / 2;
  const layout = (x: number, y: number, z: number, lane: number): Position3 => [(x - middle) * along, y * across, z * across + lane * laneGap];
  const anchors = new Map<string, Position3>(), layer = new Map<string, number>();
  for (const run of spiral.runs) for (const knot of run.knots) { anchors.set(knot.id, layout(knot.x, knot.q[0], knot.q[1], run.lane)); layer.set(knot.id, knot.x / spiral.scale.dx); }
  const world = (point: Position3) => point.map((value) => value * 3) as Position3;
  const busiest = Math.max(1, ...spiral.runs.map((run) => run.knots.length)), weight = (run: SpiralView["runs"][number]) => Math.sqrt(run.knots.length / busiest);
  const tracks = spiral.runs.filter((run) => run.track.length > 1).map((run): OrbitalPath => ({ id: `spiral-track:${run.id}`, tone: "coil", strandId: run.id, weight: weight(run), points: run.track.map(([x, y, z]) => world(layout(x, y, z, run.lane))) }));
  const axes = spiral.runs.filter((run) => run.axis.length > 1).map((run): OrbitalPath => ({ id: `spiral-axis:${run.id}`, strand: true, strandId: run.id, weight: weight(run), points: run.axis.map(([x, y, z]) => world(layout(x, y, z, run.lane))) }));
  return { anchors, layer, tracks, axes, links: spiral.links, built: spiral.builtAt, bottom: -120, layout, depth: world([0, 0, spiral.scale.width * across])[2] };
}

const spiralPoint = (rank: number, total: number): Position3 => {
  const angle = rank / SPIRAL.perTurn * Math.PI * 2;
  return [(rank - (total - 1) / 2) * SPIRAL.step, Math.cos(angle) * SPIRAL.radius, Math.sin(angle) * SPIRAL.radius];
};

/**
 * The time meter of a stored spiral. The build compresses quiet story time
 * (spiral.ts compressTime), so each book's stretch gets a ruler on the date
 * backdrop, just under the dates: a tick per story moment (every fifth
 * taller), packed closer where time is compressed, and a note where the pace
 * changes. A step's pace is its length over a full step (scale.dx), averaged
 * over five moments; a note appears where that moves by 0.2 or more and has
 * settled (the next six moments within 0.2, noted at their middle value), well
 * clear of the last note.
 */
function timeMeters(data: TimePlaceProjection, spiral: SpiralView, layout: (x: number, y: number, z: number, lane: number) => Position3): TimeMeter[] {
  const bookOf = new Map(data.scenes.map((scene) => [scene.id, scene.book ?? null]));
  const stretches = new Map<string, { lane: number; book: number | null; xs: Set<number>; top: number }>();
  for (const run of spiral.runs) for (const knot of run.knots) {
    const book = bookOf.get(knot.id) ?? null, key = `${run.lane}|${book ?? ""}`;
    const stretch = stretches.get(key) ?? { lane: run.lane, book, xs: new Set<number>(), top: -Infinity };
    stretch.xs.add(knot.x);
    stretch.top = Math.max(stretch.top, layout(knot.x, knot.q[0], knot.q[1], run.lane)[1]);
    stretches.set(key, stretch);
  }
  return [...stretches.values()].flatMap((stretch): TimeMeter[] => {
    const xs = [...stretch.xs].sort((first, second) => first - second);
    if (xs.length < 2) return [];
    const ticks = xs.map((x) => layout(x, 0, 0, stretch.lane)[0] * 3);
    const pace = xs.slice(1).map((x, index) => (x - xs[index]) / spiral.scale.dx);
    const smooth = pace.map((_, index) => { const window = pace.slice(Math.max(0, index - 2), index + 3); return Math.round(10 * window.reduce((sum, value) => sum + value, 0) / window.length) / 10; });
    const zones: TimeMeter["zones"] = [];
    let current = Infinity, last = -Infinity;
    smooth.forEach((value, index) => {
      if (Math.abs(value - current) < 0.2 || ticks[index] - last < METER.gap) return;
      // Noted once it has settled: the next six moments within 0.2 of each other, at their middle value.
      const ahead = smooth.slice(index, index + 6).sort((first, second) => first - second);
      if (ahead.at(-1)! - ahead[0] >= 0.2) return;
      const level = ahead[Math.floor(ahead.length / 2)];
      zones.push({ x: ticks[index], label: level >= 0.95 ? "time ×1" : `time ×${level.toFixed(1)}` });
      current = level; last = ticks[index];
    });
    // Just under the dates (pin cards rise 520 above the stretch's top; their lettering hangs about 615 below the card centre).
    return [{ id: `meter:${stretch.lane}:${stretch.book ?? ""}`, y: (stretch.top + 520) * 3 - 615 - METER.under, z: (stretch.lane * SPIRAL.laneGap - SPIRAL.radius - PIN_BACK) * 3, ticks, zones }];
  });
}
/** The meter's notes keep this far apart; the ruler sits this far under the dates (world units). */
const METER = { gap: 3200, under: 560 };

/**
 * Curved causal arcs that do not collide. Every arc bends outward, away from
 * the spiral's axis. Arcs whose story spans overlap take different lanes
 * (interval colouring, shortest spans lowest), so two arcs share a lane only
 * when their spans are apart — arcs between the same pair of records too.
 * Links inside one scene stay small, inside its bubble; links between scenes
 * arc out past the spiral.
 */
/** The lowest lane whose spans this one stays a gap apart from (interval colouring); taken lanes grow as needed. */
function takeLane(taken: { low: number; high: number }[][], low: number, high: number, gap: number): number {
  let lane = taken.findIndex((spans) => spans.every((other) => high + gap < other.low || low - gap > other.high));
  if (lane < 0) { lane = taken.length; taken.push([]); }
  taken[lane].push({ low, high });
  return lane;
}
/** The direction an arc between two points bends: outward, away from the time axis (perpendicular when they face each other across it). */
function outward(from: Position3, to: Position3): Position3 {
  const radial = (point: Position3) => { const length = Math.hypot(point[1], point[2]) || 1; return [0, point[1] / length, point[2] / length]; };
  const sum = radial(from).map((value, axis) => value + radial(to)[axis]);
  const length = Math.hypot(...sum);
  return (length > 0.2 ? sum.map((value) => value / length) : [0, -radial(from)[2], radial(from)[1]]) as Position3;
}

export function routeCausalArcs(arrows: CausalArrow[], draws: OrbitalDraw[]): CausalArrow[] {
  const at = new Map(draws.filter((draw) => draw.role === "main" || draw.role === "preview").map((draw) => [draw.node.id, draw]));
  const key = (draw: OrbitalDraw) => draw.order ?? draw.node.chrono;
  const spans = arrows.flatMap((arrow) => {
    const from = at.get(arrow.from), to = at.get(arrow.to);
    if (!from || !to) return [];
    const local = !!from.previewParentId && from.previewParentId === to.previewParentId;
    return [{ arrow, from, to, local, group: local ? from.previewParentId! : "", low: Math.min(key(from), key(to)), high: Math.max(key(from), key(to)) }];
  }).sort((first, second) => (first.high - first.low) - (second.high - second.low) || first.low - second.low);
  const lanes = new Map<string, { low: number; high: number }[][]>();
  const routed = new Map<string, CausalArrow>();
  for (const span of spans) {
    const taken = lanes.get(span.group) ?? [];
    lanes.set(span.group, taken);
    const lane = takeLane(taken, span.low, span.high, span.local ? 0.002 : 0.5);
    const out = outward(span.from.position, span.to.position);
    const chord = Math.hypot(...span.to.position.map((value, axis) => value - span.from.position[axis]));
    const reach = span.local ? 16 + 0.5 * chord + 7 * lane : SPIRAL.radius * 3 * 0.55 + 110 * lane + 0.08 * Math.abs(span.to.position[0] - span.from.position[0]);
    routed.set(span.arrow.id, { ...span.arrow, bend: out.map((value) => value * reach) as Position3 });
  }
  return arrows.map((arrow) => routed.get(arrow.id) ?? arrow);
}

/** A lit strand's cast: records to add, characters to move (or add) next to it, and their participation arcs. */
export interface StrandCast { draws: OrbitalDraw[]; moves: Map<string, Position3>; arcs: CausalArrow[]; ids: string[] }
/** At most this many records and characters (the scenes nearest the tap first); the characters' rows above and behind the lit
 * stretch (world units, the lift a share of the stretch's length), so a camera looking down sees them clear of the strand. */
const CAST = { records: 120, characters: 24, lift: [1500, 0.3, 6000], spacing: 340, row: 260, forward: -500 };
/**
 * A lit strand's cast, drawn next to it: the events and dialogues inside its
 * lit scenes (a small ring inside each scene), and the characters taking part
 * in them, gathered in two staggered rows just above the lit stretch, each
 * near the scenes it is in (a universe-wide view would otherwise leave them
 * far away). Each character joins each record it takes part in by a dim arc
 * routed like the causal arcs: bent outward, a character's arcs in lanes so
 * overlapping ones do not run together. `scenes` are spiral node ids,
 * nearest the tap first.
 */
export function strandCast(world: Pick<RegroupedWorld, "interiors">, scenes: string[], draws: OrbitalDraw[]): StrandCast {
  const drawn = new Map(draws.map((draw) => [draw.node.id, draw]));
  const added: OrbitalDraw[] = [], at = new Map<string, OrbitalDraw>(), cast = new Map<string, { node: WorldNode; records: Set<string> }>();
  for (const sceneId of scenes) {
    const scene = drawn.get(sceneId), interior = world.interiors[sceneId];
    if (!scene || !interior) continue;
    const nodes = new Map(interior.nodes.map((node) => [node.id, node]));
    const takers = new Map<string, Set<string>>();
    const join = (record: string, character: string) => { if (nodes.get(character)?.kind === "character") takers.set(record, (takers.get(record) ?? new Set()).add(character)); };
    for (const edge of interior.edges) if (edge.relationType === "PARTICIPATES_IN") join(edge.to, edge.from);
    for (const node of interior.nodes) if (node.kind === "dialogue") for (const id of [...(node.dialogue?.participantIds ?? []), ...(node.dialogue?.speakerId ? [node.dialogue.speakerId] : [])]) join(node.id, id);
    const inside = interior.nodes.filter((node) => (node.kind === "event" || node.kind === "dialogue") && takers.has(node.id)).sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));
    if (!inside.length) continue;
    if (at.size && at.size + inside.length > CAST.records) break;
    inside.forEach((node, index) => {
      const local = helixPoint(inside.length > 1 ? index / (inside.length - 1) : 0.5, 0, 1, scene.radius * 2.4);
      const record = drawn.get(node.id) ?? { node, position: scene.position.map((value, axis) => value + local[axis]) as Position3, radius: node.kind === "dialogue" ? 4 : 5, role: "connection" as const, previewParentId: sceneId, order: (scene.order ?? scene.node.chrono) + (index + 1) / (inside.length + 1) };
      if (!drawn.has(node.id)) added.push(record);
      at.set(node.id, record);
      for (const character of takers.get(node.id)!) { const entry = cast.get(character) ?? { node: nodes.get(character)!, records: new Set<string>() }; entry.records.add(node.id); cast.set(character, entry); }
    });
  }
  if (!at.size) return { draws: [], moves: new Map(), arcs: [], ids: [] };
  // The characters in most of these records, each placed over the middle of its records, spread so none overlap.
  const chosen = [...cast.entries()].sort((first, second) => second[1].records.size - first[1].records.size || first[0].localeCompare(second[0])).slice(0, CAST.characters);
  const lit = [...at.values()].map((record) => record.position);
  const stretch = Math.max(...lit.map((point) => point[0])) - Math.min(...lit.map((point) => point[0]));
  const top = Math.max(...lit.map((point) => point[1])) + Math.min(CAST.lift[2], Math.max(CAST.lift[0], CAST.lift[1] * stretch)), depth = lit.reduce((sum, point) => sum + point[2], 0) / lit.length + CAST.forward;
  const wanted = chosen.map(([id, entry]) => ({ id, entry, x: [...entry.records].reduce((sum, record) => sum + at.get(record)!.position[0], 0) / entry.records.size })).sort((first, second) => first.x - second.x || first.id.localeCompare(second.id));
  const xs: number[] = [];
  wanted.forEach((entry, index) => xs.push(index < 2 ? entry.x : Math.max(entry.x, xs[index - 2] + CAST.spacing)));
  const shift = wanted.reduce((sum, entry, index) => sum + entry.x - xs[index], 0) / Math.max(1, wanted.length);
  const moves = new Map<string, Position3>();
  wanted.forEach((entry, index) => {
    const position: Position3 = [xs[index] + shift, top + (index % 2) * CAST.row, depth];
    if (drawn.has(entry.id)) moves.set(entry.id, position);
    else added.push({ node: entry.entry.node, position, radius: nebulaRadius(entry.entry.node, 0.5), prominence: 0.5, role: "nebula" });
  });
  // Arcs: a character's arcs nest in lanes by how far apart their ends are along time (shortest lowest), all bent outward.
  const arcs: CausalArrow[] = [];
  wanted.forEach((entry, index) => {
    const from: Position3 = [xs[index] + shift, top + (index % 2) * CAST.row, depth], taken: { low: number; high: number }[][] = [];
    const ends = [...entry.entry.records].map((record) => ({ record, to: at.get(record)!.position })).sort((first, second) => Math.abs(first.to[0] - from[0]) - Math.abs(second.to[0] - from[0]) || first.record.localeCompare(second.record));
    for (const end of ends) {
      const lane = takeLane(taken, Math.min(from[0], end.to[0]), Math.max(from[0], end.to[0]), CAST.spacing / 4);
      const reach = 120 + 70 * lane + 0.06 * Math.abs(end.to[0] - from[0]);
      arcs.push({ id: `cast:${entry.id}:${end.record}`, from: entry.id, to: end.record, links: [], projected: false, state: "canon", participation: true, bend: outward(from, end.to).map((value) => value * reach) as Position3 });
    }
  });
  return { draws: added, moves, arcs, ids: [...at.keys(), ...wanted.map((entry) => entry.id)] };
}

/** A scene's records that some stored causal link starts or ends at, in order. */
const causalRecords = (nodes: WorldNode[], ends: ReadonlySet<string>) => nodes
  .filter((node) => (node.kind === "event" || node.kind === "dialogue") && ends.has(node.id))
  .sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));

/** The spiral string through every scene in story order; each scene a clear
 * bubble around the events and dialogue its causal arrows start or end at
 * (entering the scene shows all its records); an amber thread from each
 * flashback scene to the scene it was told after. */
export function spiralArrangement(data: TimePlaceProjection, world?: RegroupedWorld, focusBook?: number | null, shape: StoryShape = "line", focusDay?: string | null, aspect = 1.6): OrbitalArrangement {
  const order = storyOrderScenes(data);
  // A universe: one spiral per continuity, side by side (alternate lines do not share a clock).
  const laneOf = continuityLanes(data);
  const lanes = new Map<number, StoryScene[]>();
  for (const scene of order) lanes.set(laneOf(scene), [...(lanes.get(laneOf(scene)) ?? []), scene]);
  const anchors = new Map<string, Position3>();
  /** Story position of a spiral sphere: its rank on the line, or its strand layer. */
  const position = new Map<string, number>();
  // A precomputed spiral is drawn as stored; without one, strands are laid out here as before.
  const stored = shape === "strands" && data.available && data.spiral?.runs.length ? storedSpiral(data.spiral) : null;
  const strands = !stored && shape === "strands" && data.available ? strandLayout(data, lanes) : null;
  if (stored) {
    for (const [id, point] of stored.anchors) { anchors.set(spiralNodeId(id), point); position.set(spiralNodeId(id), stored.layer.get(id)!); }
    // Scenes newer than the last build wait on a faint line under the spiral, in story order, until it is rebuilt.
    const known = [...stored.layer.values()], last = known.length ? Math.max(...known) : 0;
    order.filter((scene) => !stored.anchors.has(scene.id)).forEach((scene, rank) => { const point = stored.layout((last + 2 + rank) * (data.spiral!.scale.dx), 0, 0, laneOf(scene)); anchors.set(spiralNodeId(scene.id), [point[0], stored.bottom, point[2]]); position.set(spiralNodeId(scene.id), last + 2 + rank); });
  }
  else if (strands) for (const [id, point] of strands.anchors) { anchors.set(spiralNodeId(id), point); position.set(spiralNodeId(id), strands.layer.get(id)!); }
  else for (const [lane, scenes] of lanes) scenes.forEach((scene, rank) => { const point = spiralPoint(rank, scenes.length); anchors.set(spiralNodeId(scene.id), [point[0], point[1], point[2] + lane * SPIRAL.laneGap]); position.set(spiralNodeId(scene.id), rank); });
  const universe = data.scope === "universe";
  const reading = [...data.scenes].sort((first, second) => first.index - second.index);
  const sceneById = new Map(data.scenes.map((scene) => [scene.id, scene]));
  /** A book's scenes on the spiral (universe ids carry the book). */
  const bookPositions = (volume: number, draws: OrbitalDraw[]) => { const points = draws.filter((draw) => draw.role === "main" && sceneById.get(sceneOfSpiral(draw.node.id) ?? "")?.book === volume).map((draw) => draw.position); return points.length ? points : null; };
  /** The scenes of the chosen calendar day, in every book (the calendar, not a file, is what the view focuses). */
  const dayOf = sceneDays(data);
  const dayPositions = (draws: OrbitalDraw[]) => { if (!focusDay) return null; const points = draws.filter((draw) => draw.role === "main" && dayOf.get(sceneOfSpiral(draw.node.id) ?? "") === focusDay).map((draw) => draw.position); return points.length ? points : null; };
  /** On a stored spiral a book or the opening frame shows a stretch of time from its first scene about as long as the floor
   * box is deep, longer on a wide screen: the whole book across a phone would squeeze the cross-section to a thread. */
  const windowed = (points: Position3[] | null) => {
    if (!stored || !points?.length) return points;
    const start = Math.min(...points.map((point) => point[0])), reach = stored.depth * Math.max(0.8, 1.3 * aspect);
    return points.filter((point) => point[0] <= start + reach);
  };
  const focusFrame = (draws: OrbitalDraw[]) => dayPositions(draws) ?? (universe && focusBook !== null && focusBook !== undefined ? windowed(bookPositions(focusBook, draws)) : null);
  const toldAfter = new Map<string, string>();
  for (let index = 1; index < reading.length; index++) {
    const scene = reading[index], previous = reading[index - 1];
    if (scene.flashback && !previous.flashback) toldAfter.set(spiralNodeId(scene.id), spiralNodeId(previous.id));
  }
  const bubble = 0.42 * 165;
  const ends = new Set((world?.causal?.links ?? []).flatMap((link) => [link.from, link.to]));
  const records: OrbitalDraw[] = world ? order.flatMap((scene, rank) => {
    const id = spiralNodeId(scene.id), anchor = anchors.get(id)!;
    const inside = causalRecords(world.interiors[id]?.nodes ?? [], ends);
    return inside.map((record, index): OrbitalDraw => {
      const local = helixPoint(inside.length > 1 ? index / (inside.length - 1) : 0.5, 0, 1, bubble * 1.25);
      return { node: { ...record, viewKind: record.kind === "dialogue" ? "Dialogue" : "Event" }, position: anchor.map((value, axis) => value * 3 + local[axis]) as Position3, radius: record.kind === "dialogue" ? 5 : 7, role: "preview", previewParentId: id, order: rank + (index + 1) / (inside.length + 1) };
    });
  }) : [];
  // Universe: a marker above where each book begins on its continuity's spiral.
  if (universe) for (const book of data.books ?? []) {
    const first = order.find((scene) => scene.book === book.volume);
    const anchor = first && anchors.get(spiralNodeId(first.id));
    if (!anchor) continue;
    const count = order.filter((scene) => scene.book === book.volume).length;
    records.push({ node: { id: bookNodeId(book.volume), label: book.title, viewKind: "Book", kind: "bigEvent", state: "canon", parent: null, lane: "canon", chrono: 0, summary: `${count} scene${count === 1 ? "" : "s"} · ${data.continuities?.find((entry) => entry.id === book.continuityId)?.title ?? "no continuity"} · reading order ${book.readingOrder ?? "?"}`, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] },
      position: [anchor[0] * 3, (SPIRAL.radius + 160) * 3, anchor[2] * 3], radius: 60, role: "preview", order: -1 });
  }
  // Other volumes, past either end of the spiral; their arcs are the cross-volume causes (a universe already shows them).
  const reach = ((order.length - 1) / 2 * SPIRAL.step + 4 * SPIRAL.step) * 3;
  for (const portal of universe ? [] : world?.portals ?? []) records.push({
    node: { id: portal.id, label: portal.label, viewKind: "Other volume", kind: "bigEvent", state: "canon", parent: null, lane: "canon", chrono: 0, summary: `${portal.links} cross-volume causal link${portal.links === 1 ? "" : "s"} with this book (universe ledger) · ${portal.before ? "read before" : "read after"} this volume`, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] },
    position: [portal.before ? -reach : reach, 0, 0], radius: 70, role: "preview", order: portal.before ? -1 : order.length + 1,
  });
  const pins = calendarPins(data, anchors, laneOf);
  const meters = stored ? timeMeters(data, data.spiral!, stored.layout) : [];
  const pinNote = pins.length ? " · tall pins behind: where each calendar day starts (the universe calendar)" : "";
  return {
    // On a stored spiral the scenes are beads on the coils: a little smaller so the coils read.
    anchors, radiusScale: stored ? 0.34 : 0.42, causal: true,
    // Strands: seen from the side, coils stacked like the rows of a braid.
    // The stored spiral spreads over the floor, so the camera looks down on it; stacked strands are seen from the front.
    ...(stored ? { direction: [0, 1.1, 1] as Position3 } : strands ? { direction: [0, 0.22, 1] as Position3 } : {}), ...(stored ? { strandPeriod: (pathId: string, index: number) => {
      const run = data.spiral!.runs.find((entry) => `spiral-axis:${entry.id}` === pathId);
      if (!run?.knots.length) return null;
      const x = run.axis[Math.max(0, Math.min(index, run.axis.length - 1))][0];
      const nearest = run.knots.reduce((best, knot) => Math.abs(knot.x - x) < Math.abs(best.x - x) ? knot : best);
      const day = dayOf.get(nearest.id), knots = (day ? run.knots.filter((knot) => dayOf.get(knot.id) === day) : run.knots).slice().sort((first, second) => Math.abs(first.x - x) - Math.abs(second.x - x));
      const [, month, date] = day ? day.split("-") : [];
      return { ids: knots.map((knot) => spiralNodeId(knot.id)), strandId: run.id, book: sceneById.get(nearest.id)?.book, label: `${day ? `${month}月${date}日 · ` : ""}${knots.length} scene${knots.length === 1 ? "" : "s"} on this strand` };
    }, ...(world ? { strandCast: (scenes: string[], draws: OrbitalDraw[]) => strandCast(world, scenes, draws) } : {}) } : {}), extraDraws: records, envelope: records.some((draw) => draw.previewParentId) ? "shell" : undefined,
    morphKey: `${stored ? "spiral" : strands ? "strands" : "line"}:${[...anchors].map(([id, point]) => `${id}@${point.map(Math.round).join("/")}`).join(",")}`,
    // The calendar behind the story: a giant pin where each day starts.
    pins, meters,
    // Shredding: in story order, each scene peels off the one line onto its strand.
    morphDelays: (draws) => { const last = Math.max(1, ...position.values()); return new Map(draws.map((draw) => [draw.node.id, Math.round(((position.get(draw.previewParentId ?? draw.node.id) ?? 0) / last) * SHRED_MS)])); },
    timeKey: stored
      ? { label: "STORY SPIRAL →", detail: `Story time as a precomputed spiral (built ${stored.built.slice(0, 16).replace("T", " ")}): each strand a glowing cyan axis, brighter the more scenes it holds (tap one to light it for that day and gather its characters), with a coil that winds once per few scenes, tight where scenes are dense and almost straight where there are none,; forks and merges joined smoothly; busy strands low in the middle and the rest spread over the floor before they stack up; quiet time is compressed (the ruler under the dates: a tick per story moment, packed closer where time is squeezed, its notes the pace)${anchors.size > stored.anchors.size ? ` · ${anchors.size - stored.anchors.size} newer scene${anchors.size - stored.anchors.size === 1 ? "" : "s"} wait under it until \`novel calendar build\`` : ""} · amber: a flashback, threaded to where it is told${pinNote}` }
      : strands
      ? { label: "STORY STRANDS →", detail: `Story time as strands, estimated from who is in each scene (a guess where a scene names no one): each coil follows the same characters · S-curves: strands splitting and meeting · a faint rung: scenes nothing orders, side by side at one moment · amber: a flashback, threaded to where it is told · orange arcs: causes between the records inside the bubbles, judged in this order · place check: ${strandSummary(strands.checks)}${pinNote}` }
      : data.available
      ? { label: "STORY TIME →", detail: `Every scene in story order (estimated) · inside each bubble, the records its stored causes join (orange arcs)${world?.portals?.length ? " · violet arcs: causes to and from other volumes" : ""} · amber: a flashback, threaded to where it is told${pinNote}` }
      : { label: "READING ORDER →", detail: `Story time not computed yet (run the time-place faculty): scenes in reading order · orange arcs: stored causes${world?.portals?.length ? " · violet arcs: causes to and from other volumes" : ""}` },
    initialFrame: (draws) => focusFrame(draws) ?? (stored ? windowed(draws.filter((draw) => draw.role === "main").map((draw) => draw.position))! : draws.filter((draw) => draw.role === "main" && (position.get(draw.node.id) ?? draw.node.chrono) < SPIRAL.perTurn * 1.5).map((draw) => draw.position)),
    // The camera flies to the chosen day (or, with none, the book being read) whenever the choice changes.
    ...(universe || focusDay ? { bookFrame: focusFrame, bookKey: focusDay ? `story:day:${focusDay}` : `story:${focusBook ?? ""}` } : {}),
    ...(universe ? { renderDistance: renderReach(order) } : {}),
    // A selected scene is framed with its neighbours on the spiral (about half a turn); a book marker frames its book.
    focusFor: (selectedId, draws) => {
      if (selectedId.startsWith("book:")) return bookPositions(Number(selectedId.slice(5)), draws);
      const self = draws.find((draw) => draw.role === "main" && draw.node.id === selectedId);
      if (!self) return null;
      const here = position.get(self.node.id) ?? self.node.chrono;
      return draws.filter((draw) => draw.role === "main" && Math.abs((position.get(draw.node.id) ?? draw.node.chrono) - here) <= 3).map((draw) => draw.position);
    },
    routeCausal: routeCausalArcs,
    paths: (draws) => {
      const main = draws.filter((draw) => draw.role === "main").sort((first, second) => first.node.chrono - second.node.chrono);
      if (!main.length) return [];
      const at = new Map(main.map((draw) => [draw.node.id, draw.position]));
      const threads = [...toldAfter].flatMap(([flashback, teller]): OrbitalPath[] => at.get(flashback) && at.get(teller) ? [{ id: `told:${flashback}`, tone: "thread", points: [at.get(teller)!, at.get(flashback)!] }] : []);
      if (stored) {
        // As stored: cyan coils around coloured axes; faint links where a character crosses strands mid-way.
        const crossings = stored.links.flatMap((link): OrbitalPath[] => { const from = at.get(spiralNodeId(link.from)), to = at.get(spiralNodeId(link.to)); return from && to ? [{ id: `spiral-cross:${link.from}:${link.to}`, tone: "link", points: [from, to] }] : []; });
        return [...stored.tracks, ...stored.axes, ...crossings, ...threads];
      }
      if (strands) {
        // The skeleton: one curve per strand run along its coil, S-curves where strands split and meet.
        const runOf = new Map<string, string>();
        const run = (id: string): string => runOf.get(id) ?? (() => { const previous = strands.continues.get(id); const value = previous ? run(previous) : id; runOf.set(id, value); return value; })();
        const runs = new Map<string, string[]>();
        for (const scene of [...order].sort((first, second) => strands.layer.get(first.id)! - strands.layer.get(second.id)!)) if (at.get(spiralNodeId(scene.id))) runs.set(run(scene.id), [...(runs.get(run(scene.id)) ?? []), scene.id]);
        const along = (ids: string[]) => ids.flatMap((id, index) => [...(index ? strands.curve(ids[index - 1], id, 8) : []), at.get(spiralNodeId(id))!]);
        const skeleton = [...runs].filter(([, ids]) => ids.length > 1).map(([id, ids]): OrbitalPath => ({ id: `strand:${id}`, points: along(ids) }));
        const forks = strands.edges.filter((edge) => (edge.kind === "worldline" || edge.kind === "carried") && strands.continues.get(edge.to) !== edge.from).flatMap((edge): OrbitalPath[] => {
          const from = at.get(spiralNodeId(edge.from)), to = at.get(spiralNodeId(edge.to));
          return from && to ? [{ id: `strand-join:${edge.from}:${edge.to}`, points: [from, ...strands.curve(edge.from, edge.to, 14), to] }] : [];
        });
        // Rungs: the ruling at each story position that holds parallel scenes (one moment, several places).
        const moments = new Map<string, Position3[]>();
        for (const draw of main) {
          const layer = position.get(draw.node.id), scene = sceneById.get(sceneOfSpiral(draw.node.id) ?? "");
          if (layer === undefined || !scene) continue;
          const key = `${laneOf(scene)}:${layer}`;
          moments.set(key, [...(moments.get(key) ?? []), draw.position]);
        }
        const rungs = [...moments].filter(([, points]) => points.length > 1).map(([key, points]): OrbitalPath => ({ id: `moment:${key}`, tone: "link", points: points.sort((first, second) => first[1] - second[1]) }));
        return [...skeleton, ...forks, ...rungs, ...threads];
      }
      // One string per continuity (a universe's alternate lines are separate spirals).
      const strings = new Map<number, Position3[]>();
      for (const draw of main) { const scene = sceneById.get(sceneOfSpiral(draw.node.id) ?? ""); const lane = scene ? laneOf(scene) : 0; strings.set(lane, [...(strings.get(lane) ?? []), draw.position]); }
      return [...[...strings].map(([lane, points]): OrbitalPath => ({ id: lane ? `story-order:${lane}` : "story-order", points })), ...threads];
    },
  };
}

/** World units: the orbit draws layout anchors ×3 and lays its grid floor at y = −950. */
const FLOOR_Y = -945;
export const atlasNodeId = (sceneId: string) => `atlas:${sceneId}`;
export const pinNodeId = (placeId: string) => `pin:${placeId}`;

/** What floats above the map. */
export interface AtlasFilter {
  /** Story periods to show (null: all). */
  periods: ReadonlySet<string> | null;
  /** Only these scenes, e.g. the stretch of the spiral that was in view in Story time (null: no limit). */
  sceneIds?: ReadonlySet<string> | null;
  /** Scene spheres, event and dialogue records. With records on, scenes become
   * transparent envelopes around them (or vanish when scenes are off). */
  levels?: AtlasLevels;
}
export interface AtlasLevels { scene: boolean; event: boolean; dialogue: boolean }
export const SCENE_LEVEL: AtlasLevels = { scene: true, event: false, dialogue: false };

/** Placed scenes passing the filter, in story order (period, then reading order). */
export function atlasScenes(data: TimePlaceProjection, filter: AtlasFilter): StoryScene[] {
  return storyOrderScenes(data).filter((scene) => scene.placeIds.length && (!filter.periods || filter.periods.has(scenePeriod(scene) ?? "")) && (!filter.sceneIds || filter.sceneIds.has(scene.id)));
}

/** Places (space-time): one sphere per placed scene passing the filter;
 * entering it shows the scene's events and dialogue. */
export function atlasWorld(world: WorldLike & { causal?: CausalSummary }, data: TimePlaceProjection, filter: AtlasFilter, volume?: number | null): RegroupedWorld {
  const bundles = sceneBundles(world);
  const timeById = new Map(data.times.map((time) => [time.id, time]));
  const result: RegroupedWorld = { laneNodes: [], laneEdges: [], interiors: {}, bigEventLabels: {}, causal: world.causal };
  atlasScenes(data, filter).forEach((scene, rank) => {
    const id = atlasNodeId(scene.id);
    const time = timeById.get(scenePeriod(scene) ?? "");
    const place = data.names[scene.placeIds[0]] ?? scene.placeIds[0];
    const book = scene.book !== undefined ? data.books?.find((entry) => entry.volume === scene.book)?.title : undefined;
    const summary = `${book ? `${book} · ` : ""}⌖ ${place}${scene.placeCarried ? " (carried over from the scene before)" : ""} · ${time ? `${time.flashback ? "↶ " : ""}${time.label}${dateLine(time) ? ` · ${dateLine(time)}` : ""}` : "time not stated"} · scene ${scene.index + 1}, chapter ${scene.chapterIndex}`;
    const proposed = !!time?.proposed || !!data.places.find((place) => place.id === scene.placeIds[0])?.proposed;
    result.laneNodes.push(groupNode(id, scene.label, "Scene", rank, "atlas", summary, proposed));
    result.bigEventLabels[id] = scene.label;
    const bundle = regroup(bundles, id, [scene], volume);
    const local = localScene(scene, volume);
    // The sphere is the scene: inside are its records (and the people and places around them).
    result.interiors[id] = { nodes: bundle.nodes.filter((node) => node.id !== local), edges: bundle.edges.filter((edge) => edge.from !== local && edge.to !== local) };
  });
  causalContainers(result);
  return result;
}

/** A scene's records at the chosen levels, in order (dialogue: exchange cards). */
const recordsAt = (nodes: WorldNode[], levels: AtlasLevels) => nodes
  .filter((node) => (levels.event && node.kind === "event") || (levels.dialogue && node.kind === "dialogue" && !!node.dialogue))
  .sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));

/** The map (schematic, not geography) on the floor, nested by the place
 * tree (a region's disc holds its places); each scene above its
 * place at a height set by its story rank; a thread from each scene down to
 * its place; the story-order string through the air; a selected character's
 * path through their scenes. With event or dialogue levels on, each scene's
 * records float inside it on a small helix. */
export function atlasArrangement(data: TimePlaceProjection, filter: AtlasFilter, world?: RegroupedWorld, focusBook?: number | null): OrbitalArrangement {
  const universe = data.scope === "universe";
  const levels = filter.levels ?? SCENE_LEVEL;
  const links = placeLinks(data);
  const layout = placeTreeLayout(data.places, links, 600);
  const SCALE = 6;
  /** Where each place's scenes, pin and moves attach (a region's spot is inside its upper rim). */
  const map = new Map<string, { x: number; z: number }>();
  for (const place of data.places) {
    const point = layout.get(place.id);
    if (point) map.set(place.id, { x: (point.spotX - 300) * SCALE, z: (point.spotY - 300) * SCALE });
  }
  const placePaths = new Map(data.places.map((place) => [place.id, place.path ?? [place.id]]));
  const inside = (placeId: string | undefined, ancestor: string) => !!placeId && (placePaths.get(placeId) ?? [placeId]).includes(ancestor);
  const scenes = atlasScenes(data, filter);
  const shown = new Set(scenes.flatMap((scene) => scene.placeIds.slice(0, 1).flatMap((id) => placePaths.get(id) ?? [id])));
  const step = Math.max(12, Math.min(70, 900 / Math.max(1, scenes.length)));
  const anchors = new Map<string, Position3>();
  scenes.forEach((scene, rank) => {
    const spot = map.get(scene.placeIds[0]);
    if (spot) anchors.set(atlasNodeId(scene.id), [spot.x / 3, (FLOOR_Y + 260) / 3 + rank * step, spot.z / 3]);
  });
  const floor: FloorMark[] = data.places.flatMap((place): FloorMark[] => {
    const point = layout.get(place.id);
    // In a universe, the reader's book's places stay bright; the others' recede.
    const inBook = !universe || focusBook === null || focusBook === undefined || !!place.books?.includes(focusBook) || data.scenes.some((scene) => scene.book === focusBook && scene.placeIds.some((id) => (placePaths.get(id) ?? [id]).includes(place.id)));
    return point ? [{ id: place.id, x: (point.x - 300) * SCALE, z: (point.y - 300) * SCALE, radius: Math.max(40, point.r * SCALE), active: shown.has(place.id) && inBook, depth: point.depth, region: point.region, proposed: !!place.parentProposed }] : [];
  }).sort((first, second) => (first.depth ?? 0) - (second.depth ?? 0));
  const pins: OrbitalDraw[] = data.places.flatMap((place): OrbitalDraw[] => {
    const spot = map.get(place.id);
    return spot ? [{ node: { id: pinNodeId(place.id), label: place.label, viewKind: "Place", kind: "location", state: place.proposed ? "proposed" : "canon", parent: null, lane: "canon", chrono: 0, summary: `${(place.path?.length ?? 1) > 1 ? `${placePathLabel(place, data.names)} · ` : ""}${place.sceneIds.length} scene${place.sceneIds.length === 1 ? "" : "s"} here (${place.statedScenes} name it)${(place.totalScenes ?? 0) > place.sceneIds.length ? ` · ${place.totalScenes} inside` : ""}${place.parentProposed ? " · inside-link proposed" : ""} · ${place.characterIds.length} character${place.characterIds.length === 1 ? "" : "s"}`, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }, position: [spot.x, FLOOR_Y + 30, spot.z], radius: 30, role: "nebula", prominence: shown.has(place.id) ? 1 : 0.2 }] : [];
  });
  const withRecords = levels.event || levels.dialogue;
  /** Records sit inside their scene, whose sphere (scaled like the main
   * spheres: radiusScale × base) envelops them. */
  const envelopeRadius = 0.36 * 165;
  const records: OrbitalDraw[] = withRecords && world ? scenes.flatMap((scene) => {
    const id = atlasNodeId(scene.id), anchor = anchors.get(id);
    if (!anchor) return [];
    const inside = recordsAt(world.interiors[id]?.nodes ?? [], levels);
    return inside.map((record, index): OrbitalDraw => {
      // Without scene bubbles the records are the subject: larger, on a wider helix.
      const spread = levels.scene ? 1.25 : 2.2;
      const local = helixPoint(inside.length > 1 ? index / (inside.length - 1) : 0.5, 0, 1, envelopeRadius * spread);
      const size = (record.kind === "dialogue" ? 0.1 : 0.13) * (levels.scene ? 1 : 2.4);
      return { node: { ...record, viewKind: record.kind === "dialogue" ? "Dialogue" : "Event" }, position: anchor.map((value, axis) => value * 3 + local[axis]) as Position3, radius: Math.max(5, envelopeRadius * size), role: "preview", previewParentId: id };
    });
  }) : [];
  const sceneOf = new Map(scenes.map((scene) => [atlasNodeId(scene.id), scene]));
  const pathOf = (characterId: string, draws: OrbitalDraw[]) => draws
    .filter((draw) => draw.role === "main" && sceneOf.get(draw.node.id)?.characterIds.includes(characterId))
    .sort((first, second) => first.node.chrono - second.node.chrono)
    .map((draw) => draw.position);
  const characters = new Set(data.characters.map((character) => character.id));
  return {
    anchors, floor, extraDraws: [...pins, ...records], radiusScale: withRecords ? 0.36 : 0.32, direction: [0.12, 0.62, 1], pathReplacesLinks: true,
    ...(universe ? {
      // The reader's book: its scene columns and the map beneath them.
      bookFrame: (draws: OrbitalDraw[]) => {
        if (focusBook === null || focusBook === undefined) return null;
        const columns = draws.filter((draw) => draw.role === "main" && sceneOf.get(draw.node.id)?.book === focusBook).map((draw) => draw.position);
        const ground = data.places.filter((place) => place.books?.includes(focusBook)).flatMap((place) => { const spot = map.get(place.id); return spot ? [[spot.x, FLOOR_Y, spot.z] as Position3] : []; });
        return columns.length + ground.length ? [...columns, ...ground] : null;
      },
      bookKey: `places:${focusBook ?? ""}`, renderDistance: 9000,
    } : {}),
    envelope: withRecords ? levels.scene ? "shell" : "hidden" : undefined,
    timeKey: { label: "PLACES · SPACE-TIME", detail: `Map on the floor (schematic) · ${withRecords ? `${[levels.event && "events", levels.dialogue && "dialogue"].filter(Boolean).join(" and ")} inside ${levels.scene ? "each scene" : "their scene's spot"}` : "scenes"} rise in story order above their place · select a character for their path` },
    focusFor: (selectedId, draws) => {
      const self = draws.find((draw) => draw.node.id === selectedId)?.position;
      // A place or one of its scenes: frame the whole column above that place, down to the map.
      const placeId = selectedId.startsWith("pin:") ? selectedId.slice(4) : sceneOf.get(selectedId)?.placeIds[0];
      if (placeId && !characters.has(selectedId)) {
        const spot = map.get(placeId);
        // A region frames every column inside it.
        const column = draws.filter((draw) => draw.role === "main" && inside(sceneOf.get(draw.node.id)?.placeIds[0], placeId)).map((draw) => draw.position);
        const span = [...column, ...(spot ? [[spot.x, FLOOR_Y, spot.z] as Position3] : [])];
        return span.length > 1 ? span : null;
      }
      if (!characters.has(selectedId)) return null;
      // Frame the character with every scene of theirs in the window (their path).
      const span = [...pathOf(selectedId, draws), ...(self ? [self] : [])];
      return span.length > 1 ? span : null;
    },
    paths: (draws, selectedId) => {
      const main = draws.filter((draw) => draw.role === "main").sort((first, second) => first.node.chrono - second.node.chrono);
      const result: OrbitalPath[] = [];
      for (const link of links) {
        const from = map.get(link.from), to = map.get(link.to);
        if (from && to) result.push({ id: `move:${link.from}:${link.to}`, tone: "link", points: [[from.x, FLOOR_Y + 4, from.z], [to.x, FLOOR_Y + 4, to.z]] });
      }
      for (const draw of main) {
        const spot = map.get(sceneOf.get(draw.node.id)?.placeIds[0] ?? "");
        if (spot) result.push({ id: `drop:${draw.node.id}`, tone: "link", points: [draw.position, [spot.x, FLOOR_Y + 4, spot.z]] });
      }
      if (main.length > 1) result.unshift({ id: "story-order", points: main.map((draw) => draw.position) });
      if (selectedId && characters.has(selectedId)) {
        const route = pathOf(selectedId, draws);
        if (route.length > 1) result.push({ id: `route:${selectedId}`, tone: "route", points: route });
      }
      return result;
    },
  };
}
