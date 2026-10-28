import type { WorldEdge, WorldNode } from "../types.js";
import type { WebData } from "./castWeb.js";
import type { OrbitalDraw, OrbitalPath } from "./orbitalLayout.js";
import type { OrbitalArrangement, RegroupedWorld } from "./orbitalTimePlace.js";
import type { Position3 } from "./spatialLayout.js";

/**
 * A character's journey as a time-space tunnel (view only). Along the
 * tunnel's axis is time: the scenes they are in, in story order (reading
 * order until story time is recorded). Around it is space: each place gets
 * its own bearing, so a return to a place comes back on the same side of the
 * tunnel. Chapter rings make its wall; their route threads the scenes in
 * order. Each scene sphere holds its records, as everywhere in the orbit.
 */
interface WorldLike { interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }> }

export const journeyNodeId = (sceneId: string) => `journey:${sceneId}`;
const worldScene = (sceneId: string) => sceneId.slice(sceneId.indexOf(":") + 1);

export interface JourneyScene { id: string; worldId: string; chapter: number; title: string; place: string; others: string[]; events: string[] }

/** The character's scenes in story order, each with where it happens and who else is there. */
export function journeyScenes(data: WebData, characterId: string, storyRank?: (worldSceneId: string) => number | undefined): JourneyScene[] {
  const names = new Map(data.characters.map((character) => [character.id, character.name]));
  const eventsOf = new Map<string, string[]>();
  for (const event of data.events) if (event.actors.includes(characterId) || event.affected.includes(characterId)) eventsOf.set(event.sceneId, [...eventsOf.get(event.sceneId) ?? [], event.summary]);
  return data.scenes
    .filter((scene) => scene.present.includes(characterId))
    .map((scene) => ({ scene, rank: storyRank?.(worldScene(scene.id)) ?? scene.story }))
    .sort((x, y) => x.rank - y.rank || x.scene.reading - y.scene.reading)
    .map(({ scene }) => ({
      id: scene.id, worldId: worldScene(scene.id), chapter: scene.chapter, title: scene.title, place: scene.place,
      others: scene.present.filter((id) => id !== characterId).map((id) => names.get(id) ?? id),
      events: eventsOf.get(scene.id) ?? [],
    }));
}

export function journeyWorld(world: WorldLike, scenes: JourneyScene[], label: string): RegroupedWorld {
  const result: RegroupedWorld = { laneNodes: [], laneEdges: [], interiors: {}, bigEventLabels: {} };
  const byScene = new Map<string, { nodes: WorldNode[]; edges: WorldEdge[] }>();
  for (const interior of Object.values(world.interiors)) {
    const byId = new Map(interior.nodes.map((node) => [node.id, node]));
    for (const scene of interior.nodes.filter((node) => node.kind === "scene")) {
      const members = new Set([scene.id]);
      for (const edge of interior.edges) if (edge.kind === "contains" && edge.from === scene.id && byId.has(edge.to)) members.add(edge.to);
      byScene.set(scene.id, { nodes: [...members].map((id) => byId.get(id)!), edges: interior.edges.filter((edge) => members.has(edge.from) && members.has(edge.to)) });
    }
  }
  scenes.forEach((scene, step) => {
    const id = journeyNodeId(scene.id);
    const summary = `${label} · step ${step + 1} of ${scenes.length} · ch ${scene.chapter + 1}${scene.place ? ` · ⌖ ${scene.place}` : ""}${scene.others.length ? ` · with ${scene.others.slice(0, 4).join(", ")}${scene.others.length > 4 ? ` +${scene.others.length - 4}` : ""}` : ""}${scene.events[0] ? ` — ${scene.events[0]}` : ""}`;
    result.laneNodes.push({ id, label: scene.title, viewKind: "Journey", kind: "bigEvent", state: "canon", parent: null, lane: "canon", chrono: step, trackId: "journey", trackLabel: label, summary, subLabel: summary, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
    result.bigEventLabels[id] = scene.title;
    // Inside: the scene's records, without the scene itself (the sphere is the scene).
    const bundle = byScene.get(scene.worldId);
    result.interiors[id] = bundle
      ? { nodes: bundle.nodes.filter((node) => node.id !== scene.worldId).map((node) => ({ ...node, parent: id })), edges: bundle.edges.filter((edge) => edge.from !== scene.worldId && edge.to !== scene.worldId).map((edge) => ({ ...edge, parent: id })) }
      : { nodes: [], edges: [] };
  });
  return result;
}

const RADIUS = 300, STEP = 150;

/** Each place's bearing around the tunnel, in order of first visit; unplaced scenes wind slowly so the tunnel still turns. */
export function placeBearings(scenes: JourneyScene[]): Map<string, number> {
  const places = [...new Set(scenes.map((scene) => scene.place).filter(Boolean))];
  return new Map(places.map((place, index) => [place, -Math.PI / 2 + (2 * Math.PI * index) / Math.max(1, places.length)]));
}

export function journeyArrangement(scenes: JourneyScene[], label: string, options: { watching?: boolean } = {}): OrbitalArrangement {
  const bearings = placeBearings(scenes);
  const anchors = new Map<string, Position3>();
  const visits = new Map<string, number>();
  scenes.forEach((scene, step) => {
    // Repeat visits to one place lean a little apart, so they never sit on top of each other.
    const visit = visits.get(scene.place) ?? 0;
    visits.set(scene.place, visit + 1);
    const angle = scene.place ? bearings.get(scene.place)! + (visit % 2 ? 0.16 : -0.16) * Math.min(1, visit) : -Math.PI / 2 + step * 0.55;
    anchors.set(journeyNodeId(scene.id), [Math.cos(angle) * RADIUS, Math.sin(angle) * RADIUS, -step * STEP]);
  });
  const ring = (z: number): Position3[] => Array.from({ length: 33 }, (_, index) => {
    const angle = (index / 32) * Math.PI * 2;
    return [Math.cos(angle) * RADIUS * 3 * 1.18, Math.sin(angle) * RADIUS * 3 * 1.18, z * 3];
  });
  return {
    anchors,
    radiusScale: 0.7,
    // Looking in at the tunnel's mouth, a little from above and aside.
    direction: [0.28, 0.32, 1],
    paths: (draws: OrbitalDraw[]) => {
      const at = new Map(draws.map((draw) => [draw.node.id, draw.position]));
      const route = scenes.map((scene) => at.get(journeyNodeId(scene.id))).filter((point): point is Position3 => !!point);
      // The tunnel's wall: a ring where each chapter begins.
      const walls: OrbitalPath[] = scenes.flatMap((scene, step) => step === 0 || scene.chapter !== scenes[step - 1].chapter ? [{ id: `journey-ring:${scene.chapter}`, points: ring(-step * STEP), tone: "link" as const }] : []);
      return [...walls, ...(route.length > 1 ? [{ id: "journey-route", points: route, tone: options.watching === false ? "thread" as const : "route" as const }] : [])];
    },
    pathReplacesLinks: true,
    focusFor: (selectedId: string, draws: OrbitalDraw[]) => {
      const index = scenes.findIndex((scene) => journeyNodeId(scene.id) === selectedId);
      if (index < 0) return null;
      const near = new Set(scenes.slice(Math.max(0, index - 1), index + 2).map((scene) => journeyNodeId(scene.id)));
      return draws.filter((draw) => near.has(draw.node.id)).map((draw) => draw.position);
    },
    timeKey: { label: `Journey · ${label}`, detail: `${scenes.length} scenes along the tunnel in story order (reading order until story time is recorded); around it, each place keeps its own side. Enter a scene to see its records.` },
  };
}
