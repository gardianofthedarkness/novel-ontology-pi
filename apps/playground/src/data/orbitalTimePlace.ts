import type { CausalLink, CausalSummary, WorldEdge, WorldNode } from "../types.js";
import type { CausalArrow } from "./causalProjection.js";
import type { Position3 } from "./spatialLayout.js";
import { helixPoint, type OrbitalDraw, type OrbitalPath } from "./orbitalLayout.js";
import { storyStrands, type StrandCheck, type StrandEdge } from "./storyStrands.js";
import { BRAID, braidLayout, type BraidRun } from "./braidLayout.js";
import { calendarDay, calendarDayKey, dateLine, sceneDays, placeLinks, placePathLabel, placeTreeLayout, scenePeriod, type StoryScene, type TimePlaceProjection } from "./timePlace.js";

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
  /** Story strands: the envelope tube around each continuity's braid. */
  tubes?: StrandTube[];
  /** Tapping a strand axis at a point: the scenes of that strand's period (spiral ids) to light up. */
  strandPeriod?: (pathId: string, index: number) => { ids: string[]; label: string; color: string } | null;
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
export interface CalendarPin { id: string; x: number; z: number; top: number; card: number; label: string; detail: string; /** Where the pole starts (world y); the floor when absent. */ floor?: number }
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
/** A change of the Story time shape: the user's switch (shredding or weaving, framed like the view
 * opens) or new evidence moving scenes within one shape. Null: nothing moved. */
export function shapeChange(previous: string | undefined, next: string | undefined): { caption: string; reframe: boolean } | null {
  if (!previous || !next || previous === next) return null;
  const shape = (key: string) => key.slice(0, key.indexOf(":"));
  if (shape(previous) !== shape(next)) return { caption: shape(next) === "strands" ? "Shredding the story line into strands…" : "Weaving the strands back into one line…", reframe: true };
  return { caption: shape(next) === "strands" ? "Strands moving to new evidence…" : "Story line moving to new evidence…", reframe: false };
}
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
/** A strand's coloured axis through the braid (world units), the layer each point sits at, and its scenes. */
export interface StrandAxis { id: string; run: string; color: string; points: Position3[]; layers: number[]; scenes: string[] }
/** The envelope tube of one continuity: rings along its folded axis (world units). */
export interface StrandTube { id: string; rings: { center: Position3; normal: Position3; binormal: Position3; radius: number }[] }

/** Colours for strands: 12 OKLCH hues; strands that come near each other (or split from each other) get the most different ones. */
const STRAND_HUES = Array.from({ length: 12 }, (_, index) => 25 + index * 30);
function oklch(lightness: number, chroma: number, hue: number): string {
  const a = chroma * Math.cos((hue * Math.PI) / 180), b = chroma * Math.sin((hue * Math.PI) / 180);
  const l = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3, m = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3, s = (lightness - 0.0894841775 * a - 1.2914855480 * b) ** 3;
  const linear = [4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s, -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s, -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s];
  return `#${linear.map((value) => { const v = Math.min(1, Math.max(0, value)); const gamma = v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055; return Math.round(gamma * 255).toString(16).padStart(2, "0"); }).join("")}`;
}
export function strandColours(runs: string[], conflicts: Map<string, Set<string>>): Map<string, string> {
  const hueDistance = (a: number, b: number) => { const d = Math.abs(STRAND_HUES[a] - STRAND_HUES[b]) % 360; return Math.min(d, 360 - d); };
  const chosen = new Map<string, number>(), used = new Array(STRAND_HUES.length).fill(0);
  for (const run of [...runs].sort((first, second) => (conflicts.get(second)?.size ?? 0) - (conflicts.get(first)?.size ?? 0) || first.localeCompare(second))) {
    const near = [...(conflicts.get(run) ?? [])].flatMap((other) => chosen.has(other) ? [chosen.get(other)!] : []);
    let best = 0, score = -Infinity;
    STRAND_HUES.forEach((_, index) => { const value = (near.length ? Math.min(...near.map((other) => hueDistance(index, other))) : 180) * 100 - used[index]; if (value > score) { score = value; best = index; } });
    chosen.set(run, best); used[best]++;
  }
  return new Map(runs.map((run) => [run, oklch(0.72, 0.14, STRAND_HUES[chosen.get(run) ?? 0])]));
}

/**
 * Strands as one braided tube per continuity (braidLayout.ts): books in
 * reading order along the axis, folded into rows to fit the screen. Each
 * strand run (a `continues` chain) is a coloured axis; scenes are beads on it.
 */
function strandLayout(data: TimePlaceProjection, lanes: Map<number, StoryScene[]>, aspect = 16 / 9) {
  const anchors = new Map<string, Position3>(), layer = new Map<string, number>(), continues = new Map<string, string | null>();
  const edges: StrandEdge[] = [], checks: StrandCheck[] = [], cross: StrandEdge[] = [];
  const axes: StrandAxis[] = [], tubes: StrandTube[] = [];
  const runOf = new Map<string, string>(), rowTop = new Map<string, number>(), rowKey = new Map<string, string>();
  const events = new Map<string, number[]>();
  const days = sceneDays(data);
  const allRuns: string[] = [], conflicts = new Map<string, Set<string>>();
  const conflict = (a: string, b: string) => { conflicts.set(a, (conflicts.get(a) ?? new Set()).add(b)); conflicts.set(b, (conflicts.get(b) ?? new Set()).add(a)); };
  // Books in reading order (scenes before a book's first time word would otherwise put a later book first).
  const reading = new Map((data.books ?? []).map((book) => [book.volume, book.readingOrder ?? Infinity]));
  for (const [lane, scenes] of lanes) {
    const books = [...new Set(scenes.map((scene) => scene.book ?? 0))].sort((first, second) => (reading.get(first) ?? Infinity) - (reading.get(second) ?? Infinity) || first - second);
    const sets = books.map((book) => storyStrands({ ...data, scope: "book", scenes: scenes.filter((scene) => (scene.book ?? 0) === book) }));
    const total = sets.reduce((sum, set) => sum + set.layers, 0);
    let offset = 0;
    const laneEdges: StrandEdge[] = [];
    sets.forEach((set) => {
      for (const [id, at] of set.layer) { layer.set(id, offset + at); continues.set(id, set.continues.get(id) ?? null); }
      edges.push(...set.edges); laneEdges.push(...set.edges); checks.push(...set.checks);
      offset += set.layers;
    });
    // Runs: each `continues` chain is one strand.
    const root = (id: string): string => { const previous = continues.get(id); return previous ? root(previous) : id; };
    const members = new Map<string, { id: string; layer: number }[]>();
    for (const scene of scenes) {
      if (!layer.has(scene.id)) continue;
      const run = `${lane}:${root(scene.id)}`;
      runOf.set(scene.id, run);
      members.set(run, [...(members.get(run) ?? []), { id: scene.id, layer: layer.get(scene.id)! }]);
    }
    for (const list of members.values()) list.sort((first, second) => first.layer - second.layer);
    const braidRuns = new Map<string, BraidRun>([...members].map(([id, list]) => [id, { id, scenes: list }]));
    // Splits and merges: a strand starting from another one's scene, or ending into one; other links cross between strands.
    for (const edge of laneEdges) {
      if ((edge.kind !== "worldline" && edge.kind !== "carried") || continues.get(edge.to) === edge.from) continue;
      const from = runOf.get(edge.from), to = runOf.get(edge.to);
      if (!from || !to || from === to) continue;
      const child = braidRuns.get(to)!, parent = braidRuns.get(from)!;
      if (child.scenes[0].id === edge.to) { if (!child.from || child.from.layer < layer.get(edge.from)!) child.from = { run: from, layer: layer.get(edge.from)! }; }
      else if (parent.scenes.at(-1)!.id === edge.from) { if (!parent.into || parent.into.layer > layer.get(edge.to)!) parent.into = { run: to, layer: layer.get(edge.to)! }; }
      else cross.push(edge);
    }
    // Row breaks prefer the layers where a new calendar day starts.
    const breaks: number[] = [];
    let previousDay: string | undefined;
    for (const scene of [...scenes].filter((entry) => layer.has(entry.id)).sort((first, second) => layer.get(first.id)! - layer.get(second.id)!)) {
      const day = days.get(scene.id);
      if (day && previousDay && day !== previousDay) breaks.push(layer.get(scene.id)!);
      if (day) previousDay = day;
    }
    const braid = braidLayout([...braidRuns.values()], Math.max(1, total), { aspect, breaks });
    const depth = lane * SPIRAL.laneGap;
    const world = (point: Position3): Position3 => [point[0] * 3, point[1] * 3, (point[2] + depth) * 3];
    for (const scene of scenes) {
      const at = layer.get(scene.id), run = runOf.get(scene.id);
      if (at === undefined || !run) continue;
      const point = braid.place(at, braid.at.get(run)?.get(at) ?? [0, 0]);
      anchors.set(scene.id, [point[0], point[1], point[2] + depth]);
      rowTop.set(scene.id, braid.frame(at).center[1] + braid.band / 2);
      rowKey.set(scene.id, `${lane}:${braid.rowOf(at)}`);
    }
    for (const run of braidRuns.values()) {
      allRuns.push(run.id);
      const span = braid.span.get(run.id)!;
      events.set(run.id, [...(events.get(run.id) ?? []), span[0], span[1]]);
      for (const other of [run.from, run.into]) if (other) { conflict(run.id, other.run); events.set(other.run, [...(events.get(other.run) ?? []), other.layer]); }
      const axis = braid.axis(run.id);
      if (axis.points.length > 1) axes.push({ id: `strand:${run.id}`, run: run.id, color: "", points: axis.points.map(world), layers: axis.layers, scenes: run.scenes.map((scene) => scene.id) });
    }
    // Strands that pass within two spacings of each other must not look alike.
    const ids = [...braidRuns.keys()];
    for (let k = 0; k < braid.layers; k++) {
      const live = ids.filter((id) => braid.at.get(id)?.has(k));
      for (let a = 0; a < live.length; a++) for (let b = a + 1; b < live.length; b++) {
        const p = braid.at.get(live[a])!.get(k)!, q = braid.at.get(live[b])!.get(k)!;
        if (Math.hypot(q[0] - p[0], q[1] - p[1]) < 2 * BRAID.spacing) conflict(live[a], live[b]);
      }
    }
    // The envelope: rings every half layer, finer through the turns.
    const turns = new Set(braid.rows.slice(0, -1).map((row) => row[1]));
    const rings: StrandTube["rings"] = [];
    for (let k = 0; k < braid.layers; k++) {
      const subs = turns.has(k) ? 16 : 2;
      for (let sub = 0; sub < (k + 1 < braid.layers ? subs : 1); sub++) {
        const u = k + sub / subs, frame = braid.frame(u), next = braid.radius[Math.min(braid.layers - 1, k + 1)] ?? braid.radius[k];
        rings.push({ center: world(frame.center), normal: frame.normal, binormal: frame.binormal, radius: (braid.radius[k] + (next - braid.radius[k]) * (sub / subs)) * 3 });
      }
    }
    if (rings.length > 1) tubes.push({ id: `tube:${lane}`, rings });
  }
  const colours = strandColours(allRuns, conflicts);
  for (const axis of axes) axis.color = colours.get(axis.run)!;
  /** A strand's scenes for one period: between its splits and merges around `at`, within the calendar day of the scene nearest it. */
  const period = (run: string, at: number): string[] => {
    const scenes = axes.find((axis) => axis.run === run)?.scenes ?? [];
    const marks = [...new Set(events.get(run) ?? [])].sort((first, second) => first - second);
    const low = Math.max(-Infinity, ...marks.filter((mark) => mark <= at)), high = Math.min(Infinity, ...marks.filter((mark) => mark > at));
    const inside = scenes.filter((id) => layer.get(id)! >= low && layer.get(id)! <= high);
    const nearest = [...inside].sort((first, second) => Math.abs(layer.get(first)! - at) - Math.abs(layer.get(second)! - at))[0];
    const day = nearest ? days.get(nearest) : undefined;
    return day ? inside.filter((id) => days.get(id) === day) : inside;
  };
  return { anchors, layer, continues, edges, checks, cross, axes, tubes, rowTop, rowKey, period, days };
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
/** In a folded braid the axis reverses each row: pins follow story order (`order`), stay in their row (`row`) and sit above it (`card`, layout y). */
export interface PinPlacement { order: (sceneId: string) => number | undefined; row: (sceneId: string) => string | undefined; card: (sceneId: string) => number | undefined }
export function calendarPins(data: TimePlaceProjection, anchors: Map<string, Position3>, laneOf: (scene: StoryScene) => number, placement?: PinPlacement): CalendarPin[] {
  const entries = new Map((data.calendar?.entries ?? []).filter((entry) => entry.placed !== "between" && entry.year !== null).map((entry) => [entry.id, entry]));
  if (!entries.size) return [];
  type First = { lane: number; book: number | null; day: { year: number; month: number; day: number }; start: number; x: number; at: number; scene: string };
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
    const known = firsts.get(key), at = placement?.order(scene.id) ?? anchor[0] / SPIRAL.step;
    if (!known || at < known.at) firsts.set(key, { lane: laneOf(scene), book: scene.book ?? null, day, start: Math.floor(entry.span.start / 1440), x: anchor[0], at, scene: scene.id });
  }
  const pins: CalendarPin[] = [];
  const stretches = new Map<string, First[]>();
  for (const first of firsts.values()) stretches.set(`${first.lane}|${first.book ?? ""}`, [...(stretches.get(`${first.lane}|${first.book ?? ""}`) ?? []), first]);
  for (const [stretch, days] of stretches) {
    let last = -Infinity, kept: { pin: CalendarPin; first: First } | null = null;
    for (const first of days.sort((a, b) => a.start - b.start)) {
      if (first.at <= last) continue;
      last = first.at;
      // Days that start closer than one date's width share a label ("12月24–25日"), within one row.
      if (kept && (first.at - kept.first.at) * SPIRAL.step < PIN_SPACING && placement?.row(first.scene) === placement?.row(kept.first.scene)) {
        kept.pin.label = `${kept.first.day.month}月${kept.first.day.day}–${first.day.month === kept.first.day.month ? "" : `${first.day.month}月`}${first.day.day}日`;
        continue;
      }
      const date = calendarDay(first.start * 1440);
      const above = placement?.card(first.scene);
      const pin: CalendarPin = { id: `calendar:${first.lane}:${first.book ?? ""}:${calendarDayKey(date)}`, x: (placement ? first.x : first.x - SPIRAL.step / 2) * 3, z: (first.lane * SPIRAL.laneGap - SPIRAL.radius - PIN_BACK) * 3, top: ((above ?? tops.get(stretch) ?? 0) + 220) * 3,
        // The date floats above its strands (in a folded braid, above its row), far behind the scenes: a backdrop, not a record.
        card: ((above ?? tops.get(stretch) ?? 0) + 520) * 3, ...(above !== undefined ? { floor: (above - 2 * BRAID.spacing) * 3 } : {}),
        label: `${first.day.month}月${first.day.day}日`, detail: `Year ${first.day.year}${first.book !== null ? ` · Book ${first.book}` : ""}` };
      pins.push(pin);
      kept = { pin, first };
    }
  }
  return placement ? separatePins(pins) : pins;
}

/** In a folded braid, books share rows: date cards that would overlap there become one card (the date range, the books). */
function separatePins(pins: CalendarPin[]): CalendarPin[] {
  const width = PIN_SPACING * 3, merged: { pin: CalendarPin; days: string[]; books: Set<string>; year: string }[] = [];
  for (const pin of [...pins].sort((first, second) => second.card - first.card || first.x - second.x)) {
    const near = merged.find((entry) => Math.abs(entry.pin.card - pin.card) < 1 && Math.abs(entry.pin.x - pin.x) < width && entry.pin.z === pin.z);
    const [year, book] = pin.detail.split(" · ");
    if (!near) { merged.push({ pin: { ...pin }, days: [pin.label], books: new Set(book ? [book.replace("Book ", "")] : []), year }); continue; }
    near.days.push(pin.label);
    if (book) near.books.add(book.replace("Book ", ""));
  }
  return merged.map(({ pin, days, books, year }) => {
    const bounds = days.flatMap((label) => [...label.matchAll(/(?:(\d+)月)?(\d+)日?/g)].map((match) => ({ month: match[1] ? Number(match[1]) : null, day: Number(match[2]) })));
    let month = 0;
    const dates = bounds.map((entry) => { month = entry.month ?? month; return { month, day: entry.day }; }).sort((first, second) => first.month - second.month || first.day - second.day);
    const low = dates[0], high = dates.at(-1)!;
    const label = !low || (low.month === high.month && low.day === high.day) ? pin.label : `${low.month}月${low.day}–${high.month === low.month ? "" : `${high.month}月`}${high.day}日`;
    const list = [...books].sort((first, second) => Number(first) - Number(second));
    return { ...pin, label, detail: list.length ? `${year} · Book${list.length > 1 ? "s" : ""} ${list.join(", ")}` : year };
  });
}

const spiralPoint = (rank: number, total: number): Position3 => {
  const angle = rank / SPIRAL.perTurn * Math.PI * 2;
  return [(rank - (total - 1) / 2) * SPIRAL.step, Math.cos(angle) * SPIRAL.radius, Math.sin(angle) * SPIRAL.radius];
};

/**
 * Curved causal arcs that do not collide. Every arc bends outward, away from
 * the spiral's axis. Arcs whose story spans overlap take different lanes
 * (interval colouring, shortest spans lowest), so two arcs share a lane only
 * when their spans are apart — arcs between the same pair of records too.
 * Links inside one scene stay small, inside its bubble; links between scenes
 * arc out past the spiral.
 */
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
  const radial = (point: Position3) => { const length = Math.hypot(point[1], point[2]) || 1; return [0, point[1] / length, point[2] / length]; };
  for (const span of spans) {
    const taken = lanes.get(span.group) ?? [];
    lanes.set(span.group, taken);
    const gap = span.local ? 0.002 : 0.5;
    let lane = taken.findIndex((spans) => spans.every((other) => span.high + gap < other.low || span.low - gap > other.high));
    if (lane < 0) { lane = taken.length; taken.push([]); }
    taken[lane].push({ low: span.low, high: span.high });
    const sum = radial(span.from.position).map((value, axis) => value + radial(span.to.position)[axis]);
    const length = Math.hypot(...sum);
    // Endpoints on opposite sides of the spiral: bend perpendicular to them.
    const out = length > 0.2 ? sum.map((value) => value / length) : [0, -radial(span.from.position)[2], radial(span.from.position)[1]];
    const chord = Math.hypot(...span.to.position.map((value, axis) => value - span.from.position[axis]));
    const reach = span.local ? 16 + 0.5 * chord + 7 * lane : SPIRAL.radius * 3 * 0.55 + 110 * lane + 0.08 * Math.abs(span.to.position[0] - span.from.position[0]);
    routed.set(span.arrow.id, { ...span.arrow, bend: out.map((value) => value * reach) as Position3 });
  }
  return arrows.map((arrow) => routed.get(arrow.id) ?? arrow);
}

/** A scene's records that some stored causal link starts or ends at, in order. */
const causalRecords = (nodes: WorldNode[], ends: ReadonlySet<string>) => nodes
  .filter((node) => (node.kind === "event" || node.kind === "dialogue") && ends.has(node.id))
  .sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));

/** The spiral string through every scene in story order; each scene a clear
 * bubble around the events and dialogue its causal arrows start or end at
 * (entering the scene shows all its records); an amber thread from each
 * flashback scene to the scene it was told after. */
export function spiralArrangement(data: TimePlaceProjection, world?: RegroupedWorld, focusBook?: number | null, shape: StoryShape = "line", focusDay?: string | null, aspect = 16 / 9): OrbitalArrangement {
  const order = storyOrderScenes(data);
  // A universe: one spiral per continuity, side by side (alternate lines do not share a clock).
  const laneOf = continuityLanes(data);
  const lanes = new Map<number, StoryScene[]>();
  for (const scene of order) lanes.set(laneOf(scene), [...(lanes.get(laneOf(scene)) ?? []), scene]);
  const anchors = new Map<string, Position3>();
  /** Story position of a spiral sphere: its rank on the line, or its strand layer. */
  const position = new Map<string, number>();
  const strands = shape === "strands" && data.available ? strandLayout(data, lanes, aspect) : null;
  if (strands) for (const [id, point] of strands.anchors) { anchors.set(spiralNodeId(id), point); position.set(spiralNodeId(id), strands.layer.get(id)!); }
  else for (const [lane, scenes] of lanes) scenes.forEach((scene, rank) => { const point = spiralPoint(rank, scenes.length); anchors.set(spiralNodeId(scene.id), [point[0], point[1], point[2] + lane * SPIRAL.laneGap]); position.set(spiralNodeId(scene.id), rank); });
  const universe = data.scope === "universe";
  const reading = [...data.scenes].sort((first, second) => first.index - second.index);
  const sceneById = new Map(data.scenes.map((scene) => [scene.id, scene]));
  /** A book's scenes on the spiral (universe ids carry the book). */
  const bookPositions = (volume: number, draws: OrbitalDraw[]) => { const points = draws.filter((draw) => draw.role === "main" && sceneById.get(sceneOfSpiral(draw.node.id) ?? "")?.book === volume).map((draw) => draw.position); return points.length ? points : null; };
  /** The scenes of the chosen calendar day, in every book (the calendar, not a file, is what the view focuses). */
  const dayOf = sceneDays(data);
  const dayPositions = (draws: OrbitalDraw[]) => { if (!focusDay) return null; const points = draws.filter((draw) => draw.role === "main" && dayOf.get(sceneOfSpiral(draw.node.id) ?? "") === focusDay).map((draw) => draw.position); return points.length ? points : null; };
  const focusFrame = (draws: OrbitalDraw[]) => dayPositions(draws) ?? (universe && focusBook !== null && focusBook !== undefined ? bookPositions(focusBook, draws) : null);
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
  const pins = calendarPins(data, anchors, laneOf, strands ? { order: (id) => strands.layer.get(id), row: (id) => strands.rowKey.get(id), card: (id) => strands.rowTop.get(id) } : undefined);
  const pinNote = pins.length ? " · tall pins behind: where each calendar day starts (the universe calendar)" : "";
  return {
    anchors, radiusScale: 0.42, causal: true,
    // Strands: seen from the front, the braid's rows stacked down the screen; the envelope tube around each continuity.
    ...(strands ? { direction: [0, 0.22, 1] as Position3, tubes: strands.tubes, strandPeriod: (pathId: string, index: number) => {
      const axis = strands.axes.find((entry) => entry.id === pathId);
      if (!axis) return null;
      const ids = strands.period(axis.run, axis.layers[Math.min(axis.layers.length - 1, Math.max(0, index))] ?? 0);
      if (!ids.length) return null;
      const day = strands.days.get(ids[0]), [, month, date] = day?.split("-") ?? [];
      return { ids: ids.map(spiralNodeId), label: `${day ? `${month}月${date}日 · ` : ""}${ids.length} scene${ids.length === 1 ? "" : "s"} on this strand`, color: axis.color };
    } } : {}), extraDraws: records, envelope: records.some((draw) => draw.previewParentId) ? "shell" : undefined,
    morphKey: `${strands ? "strands" : "line"}:${[...anchors].map(([id, point]) => `${id}@${point.map(Math.round).join("/")}`).join(",")}`,
    // The calendar behind the story: a giant pin where each day starts.
    pins,
    // Shredding: in story order, each scene peels off the one line onto its strand.
    morphDelays: (draws) => { const last = Math.max(1, ...position.values()); return new Map(draws.map((draw) => [draw.node.id, Math.round(((position.get(draw.previewParentId ?? draw.node.id) ?? 0) / last) * SHRED_MS)])); },
    timeKey: strands
      ? { label: "STORY STRANDS →", detail: `Story time as one braided tube, folded into rows to fit the screen: each coloured axis is a strand (estimated from who is in each scene; a guess where a scene names no one), its scenes beads on it · the tube swells where strands run in parallel · smooth S-curves where strands split and merge · tap a strand to light up its stretch for that day · amber: a flashback, threaded to where it is told · orange arcs: causes between the records inside the bubbles · place check: ${strandSummary(strands.checks)}${pinNote}` }
      : data.available
      ? { label: "STORY TIME →", detail: `Every scene in story order (estimated) · inside each bubble, the records its stored causes join (orange arcs)${world?.portals?.length ? " · violet arcs: causes to and from other volumes" : ""} · amber: a flashback, threaded to where it is told${pinNote}` }
      : { label: "READING ORDER →", detail: `Story time not computed yet (run the time-place faculty): scenes in reading order · orange arcs: stored causes${world?.portals?.length ? " · violet arcs: causes to and from other volumes" : ""}` },
    // A folded braid fits the screen whole; the line opens on its first turns.
    initialFrame: (draws) => focusFrame(draws) ?? draws.filter((draw) => draw.role === "main" && (strands || (position.get(draw.node.id) ?? draw.node.chrono) < SPIRAL.perTurn * 1.5)).map((draw) => draw.position),
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
      if (strands) {
        // One coloured axis per strand (it already bends out of its parent and into its merge); faint links where a character crosses between strands mid-way.
        const axes = strands.axes.map((axis): OrbitalPath => ({ id: axis.id, points: axis.points, color: axis.color, strand: true }));
        const crossings = strands.cross.flatMap((edge): OrbitalPath[] => { const from = at.get(spiralNodeId(edge.from)), to = at.get(spiralNodeId(edge.to)); return from && to ? [{ id: `strand-cross:${edge.from}:${edge.to}`, tone: "link", points: [from, to] }] : []; });
        return [...axes, ...crossings, ...threads];
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
