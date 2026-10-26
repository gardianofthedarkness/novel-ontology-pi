import type { WorldEdge, WorldNode } from "../types.js";
import type { Position3 } from "./spatialLayout.js";
import type { OrbitalDraw, OrbitalPath } from "./orbitalLayout.js";
import { dateLine, placeLayout, placeLinks, scenePeriod, storyRows, type StoryScene, type TimePlaceProjection } from "./timePlace.js";

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
}
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
  /** Main sphere size factor and camera direction for this arrangement. */
  radiusScale?: number;
  direction?: Position3;
  /** A selected character's path stands in for their link fan. */
  pathReplacesLinks?: boolean;
  timeKey: { label: string; detail: string };
}
export interface FloorMark { id: string; x: number; z: number; radius: number; active: boolean }

export const periodNodeId = (timeId: string) => `story:${timeId}`;
export const placeNodeId = (placeId: string) => `place:${placeId}`;
const UNPLACED = "story:unplaced";

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

function regroup(bundles: Map<string, { nodes: WorldNode[]; edges: WorldEdge[] }>, groupId: string, scenes: StoryScene[]) {
  const nodes = new Map<string, WorldNode>(), edges = new Map<string, WorldEdge>();
  for (const scene of scenes) {
    const bundle = bundles.get(scene.id);
    if (!bundle) continue;
    // Reading order across chapters: the scene's book-wide index.
    for (const node of bundle.nodes) if (!nodes.has(node.id)) nodes.set(node.id, { ...node, parent: groupId, ...(node.id === scene.id ? { chrono: scene.index } : {}) });
    for (const edge of bundle.edges) edges.set(edge.id, { ...edge, parent: groupId });
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()] };
}

const groupNode = (id: string, label: string, viewKind: string, chrono: number, trackId: string, summary: string): WorldNode => ({
  id, label, viewKind, kind: "bigEvent", state: "canon", parent: null, lane: "canon", chrono, trackId, trackLabel: viewKind, summary, subLabel: summary, lanePos: [0, 0, 0], interiorPos: [0, 0, 0],
});

/** Story time: periods in story order; flashbacks on their own raised track. */
export function storyWorld(world: WorldLike, data: TimePlaceProjection): RegroupedWorld {
  const bundles = sceneBundles(world);
  const timeById = new Map(data.times.map((time) => [time.id, time]));
  const result: RegroupedWorld = { laneNodes: [], laneEdges: [], interiors: {}, bigEventLabels: {} };
  for (const { time, scenes } of storyRows(data)) {
    const id = time ? periodNodeId(time.id) : UNPLACED;
    const host = time?.toldFromId ? timeById.get(time.toldFromId) : undefined;
    const when = time ? dateLine(time) || time.gloss : "Before the first time word in the text";
    const summary = time?.flashback
      ? `Flashback${host ? ` told during ${host.label} (chapter ${host.chapterIndex})` : ""} · Jev ${Math.round(time.flashbackProbability * 100)}% sure it goes back in time · ${when} · ${scenes.length} scene${scenes.length === 1 ? "" : "s"}`
      : `${when} · ${scenes.length} scene${scenes.length === 1 ? "" : "s"}`;
    const label = time ? `${time.flashback ? "↶ " : ""}${time.label}` : "Time not stated";
    result.laneNodes.push(groupNode(id, label, time?.flashback ? "Flashback" : "Story period", time ? time.storyIndex : -1, time?.flashback ? "flashback" : "present", summary));
    result.bigEventLabels[id] = label;
    result.interiors[id] = regroup(bundles, id, scenes);
    if (time?.flashback && host) result.laneEdges.push({ id: `story:told:${time.id}`, from: id, to: periodNodeId(host.id), kind: "cross", state: "canon", parent: null, relationLabel: "Told during (flashback)" });
  }
  return result;
}

/** Story order through every period (raised flashbacks included), plus an
 * amber thread from each flashback down to the period it was told during. */
export function storyArrangement(world: RegroupedWorld): OrbitalArrangement {
  const told = new Map(world.laneEdges.map((edge) => [edge.from, edge.to]));
  return {
    timeKey: { label: "STORY TIME →", detail: "Story order (estimated) · ↑ flashbacks, amber thread to when each was told" },
    paths: (draws) => {
      const main = draws.filter((draw) => draw.role === "main").sort((first, second) => first.node.chrono - second.node.chrono);
      if (!main.length) return [];
      const first = main[0].position, last = main.at(-1)!.position;
      const spine: OrbitalPath = { id: "story-order", points: [[first[0] - 260, first[1], first[2]], ...main.map((draw) => draw.position), [last[0] + 260, last[1], last[2]]] };
      const at = new Map(main.map((draw) => [draw.node.id, draw.position]));
      const threads = [...told].flatMap(([flashback, host]): OrbitalPath[] => at.get(flashback) && at.get(host) ? [{ id: `told:${flashback}`, tone: "thread", points: [at.get(host)!, at.get(flashback)!] }] : []);
      return [spine, ...threads];
    },
  };
}

/** World units: the orbit draws layout anchors ×3 and lays its grid floor at y = −950. */
const FLOOR_Y = -945;
export const atlasNodeId = (sceneId: string) => `atlas:${sceneId}`;
export const pinNodeId = (placeId: string) => `pin:${placeId}`;

/** Placed scenes of the chosen periods, in story order (period, then reading order). */
export function atlasScenes(data: TimePlaceProjection, periodIds: ReadonlySet<string> | null): StoryScene[] {
  const rank = new Map(data.times.map((time) => [time.id, time.storyIndex]));
  return data.scenes
    .filter((scene) => scene.placeIds.length && (!periodIds || periodIds.has(scenePeriod(scene) ?? "")))
    .sort((first, second) => (rank.get(scenePeriod(first) ?? "") ?? -1) - (rank.get(scenePeriod(second) ?? "") ?? -1) || first.index - second.index);
}

/** Places (space-time): one sphere per placed scene of the chosen periods;
 * entering it shows the scene's events and dialogue. */
export function atlasWorld(world: WorldLike, data: TimePlaceProjection, periodIds: ReadonlySet<string> | null): RegroupedWorld {
  const bundles = sceneBundles(world);
  const timeById = new Map(data.times.map((time) => [time.id, time]));
  const result: RegroupedWorld = { laneNodes: [], laneEdges: [], interiors: {}, bigEventLabels: {} };
  atlasScenes(data, periodIds).forEach((scene, rank) => {
    const id = atlasNodeId(scene.id);
    const time = timeById.get(scenePeriod(scene) ?? "");
    const place = data.names[scene.placeIds[0]] ?? scene.placeIds[0];
    const summary = `⌖ ${place}${scene.placeCarried ? " (carried over from the scene before)" : ""} · ${time ? `${time.flashback ? "↶ " : ""}${time.label}${dateLine(time) ? ` · ${dateLine(time)}` : ""}` : "time not stated"} · scene ${scene.index + 1}, chapter ${scene.chapterIndex}`;
    result.laneNodes.push(groupNode(id, scene.label, "Scene", rank, "atlas", summary));
    result.bigEventLabels[id] = scene.label;
    const bundle = regroup(bundles, id, [scene]);
    // The sphere is the scene: inside are its records (and the people and places around them).
    result.interiors[id] = { nodes: bundle.nodes.filter((node) => node.id !== scene.id), edges: bundle.edges.filter((edge) => edge.from !== scene.id && edge.to !== scene.id) };
  });
  return result;
}

/** The map (schematic, not geography) on the floor; each scene above its
 * place at a height set by its story rank; a thread from each scene down to
 * its place; the story-order string through the air; a selected character's
 * path through their scenes. */
export function atlasArrangement(data: TimePlaceProjection, periodIds: ReadonlySet<string> | null): OrbitalArrangement {
  const links = placeLinks(data);
  const layout = placeLayout(data.places, links, 600);
  const map = new Map<string, { x: number; z: number }>();
  for (const place of data.places) {
    const point = layout.get(place.id);
    if (point) map.set(place.id, { x: (point.x - 300) * 7, z: (point.y - 300) * 5 });
  }
  const scenes = atlasScenes(data, periodIds);
  const shown = new Set(scenes.flatMap((scene) => scene.placeIds.slice(0, 1)));
  const step = Math.max(12, Math.min(70, 900 / Math.max(1, scenes.length)));
  const anchors = new Map<string, Position3>();
  scenes.forEach((scene, rank) => {
    const spot = map.get(scene.placeIds[0]);
    if (spot) anchors.set(atlasNodeId(scene.id), [spot.x / 3, (FLOOR_Y + 260) / 3 + rank * step, spot.z / 3]);
  });
  const counts = new Map(data.places.map((place) => [place.id, place.sceneIds.length]));
  const most = Math.max(1, ...counts.values());
  const radiusOf = (placeId: string) => 70 + 150 * Math.sqrt((counts.get(placeId) ?? 0) / most);
  const floor: FloorMark[] = [...map].map(([id, spot]) => ({ id, x: spot.x, z: spot.z, radius: radiusOf(id), active: shown.has(id) }));
  const pins: OrbitalDraw[] = data.places.flatMap((place): OrbitalDraw[] => {
    const spot = map.get(place.id);
    return spot ? [{ node: { id: pinNodeId(place.id), label: place.label, viewKind: "Place", kind: "location", state: "canon", parent: null, lane: "canon", chrono: 0, summary: `${place.sceneIds.length} scene${place.sceneIds.length === 1 ? "" : "s"} here (${place.statedScenes} name it) · ${place.characterIds.length} character${place.characterIds.length === 1 ? "" : "s"}`, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }, position: [spot.x, FLOOR_Y + 30, spot.z], radius: 30, role: "nebula", prominence: shown.has(place.id) ? 1 : 0.2 }] : [];
  });
  const sceneOf = new Map(scenes.map((scene) => [atlasNodeId(scene.id), scene]));
  const pathOf = (characterId: string, draws: OrbitalDraw[]) => draws
    .filter((draw) => draw.role === "main" && sceneOf.get(draw.node.id)?.characterIds.includes(characterId))
    .sort((first, second) => first.node.chrono - second.node.chrono)
    .map((draw) => draw.position);
  const characters = new Set(data.characters.map((character) => character.id));
  return {
    anchors, floor, extraDraws: pins, radiusScale: 0.32, direction: [0.12, 0.62, 1], pathReplacesLinks: true,
    timeKey: { label: "PLACES · SPACE-TIME", detail: "Map on the floor (schematic) · scenes rise in story order above their place · select a character for their path" },
    focusFor: (selectedId, draws) => {
      if (!characters.has(selectedId)) return null;
      // Frame the character with every scene of theirs in the window (their path).
      const self = draws.find((draw) => draw.node.id === selectedId)?.position;
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
