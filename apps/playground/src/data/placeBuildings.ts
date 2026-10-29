import { dateLine, scenePeriod, type SimulationLot, type StoryTime, type TimePlaceProjection } from "./timePlace.js";

/**
 * The buildings a story names at its places (the building log the viewer
 * builds from `novel stage objects`), seen as of a moment of story time. A
 * named building stands from the scene that first names it (earliest in story
 * order) and stays. The generic buildings each place draws by its kind are
 * not in the log: they always stand. Not canon: the names come from a work
 * model reading event summaries.
 */
export interface NamedBuilding {
  id: string; name: string; placeId: string;
  /** The kind of building the stage draws it as, when it matched one. */
  model: string | null;
  /** Standing at the chosen moment (named by then); otherwise it comes later. */
  standing: boolean;
  /** The story moment it first appears (period id, or null before any time word) and that moment's label. */
  since: string | null; sinceLabel: string;
  /** Reviewed into the ontology (stage objects); otherwise a model's reading. */
  reviewed: boolean;
}
export interface BuildingMoment { id: string; label: string; storyIndex: number }

const timeLabel = (time: StoryTime) => dateLine(time) || time.label;

/** The moments a reader can view the places at: every period not told as a flashback, in story order. */
export function buildingMoments(data: TimePlaceProjection): BuildingMoment[] {
  return data.times.filter((time) => !time.flashback).sort((first, second) => first.storyIndex - second.storyIndex).map((time) => ({ id: time.id, label: timeLabel(time), storyIndex: time.storyIndex }));
}

/** Each place's named buildings as of `at` (a period id; null: the end of the story, everything standing). */
export function buildingsAt(data: TimePlaceProjection, at: string | null): Map<string, NamedBuilding[]> {
  const times = new Map(data.times.map((time) => [time.id, time]));
  const scenes = new Map(data.scenes.map((scene) => [scene.id, scene]));
  const cutoff = at && times.has(at) ? times.get(at)!.storyIndex : Infinity;
  const byPlace = new Map<string, NamedBuilding[]>();
  for (const building of data.buildings ?? []) {
    // Its first appearance: the earliest of its scenes in story order (a scene before any time word comes first).
    const first = building.sceneIds.map((id) => { const scene = scenes.get(id), period = scene ? scenePeriod(scene) : null; return { period, index: period ? times.get(period)?.storyIndex ?? -1 : -1 }; })
      .sort((a, b) => a.index - b.index)[0];
    if (!first) continue;
    const since = first.period, sinceTime = since ? times.get(since) : undefined;
    const entry: NamedBuilding = { id: building.id, name: building.name, placeId: building.placeId, model: building.model, standing: first.index <= cutoff, since, sinceLabel: sinceTime ? timeLabel(sinceTime) : "before the first time word", reviewed: !!building.reviewed };
    byPlace.set(building.placeId, [...byPlace.get(building.placeId) ?? [], entry]);
  }
  return byPlace;
}

/** A lot of a simulated place as of a moment: it always stands; the story may not have named it yet, and the hits so far took parts of it. */
export interface SimulatedLot extends Omit<SimulationLot, "since"> {
  index: number;
  /** Named in a scene by the moment. */
  named: boolean;
  /**
   * What the hits so far left: skeleton cells gone (destroyed or fallen), cells and rooms cut off from the ground (as the latest
   * hit on it left them), structural units gone ("kind|i|j|k") and the fallen ones lying as rubble.
   */
  lost: number[]; cutOff: number[]; cutRooms: number[]; gone: string[]; rubble: number[][];
  /** A hit has reached it: its walls and roof show unit by unit instead of its shell. */
  struck: boolean;
  /** The share of its corridor and stair cells lost or cut off. */
  damage: number;
}
/** A simulated place as of a moment (the stage simulation records): its lots, the things placed there and the hits so far. */
export interface SimulatedPlace {
  strand: string; title: string;
  /** Grid size in 2 m cells. */
  grid: { nx: number; nz: number };
  lots: SimulatedLot[];
  /** Each thing where it last stood by the moment (or, if it comes later, where it first stands), in metres. */
  things: { id: string; name: string; model: string | null; shape: string | null; x: number; y: number; z: number; w: number; h: number; d: number; turn: number; standing: boolean; broken: boolean }[];
  hits: { x: number; y: number; z: number; r: number; strength: number; standing: boolean }[];
}

/** Each simulated place as of `at` (a period id; null: the end of the story). A scene's story position decides what has happened by then. */
export function simulationAt(data: TimePlaceProjection, at: string | null): Map<string, SimulatedPlace> {
  const simulation = data.simulation, places = new Map<string, SimulatedPlace>();
  if (!simulation) return places;
  const { index, cutoff } = storyClock(data, at);
  const happened = (sceneId: string | null) => sceneId === null || index(sceneId) <= cutoff;
  // A strand's title says which of its runs is drawn: the accepted one.
  const titles = new Map(simulation.strands.map((strand) => [strand.id, `${strand.title}${strand.run ? `, accepted run ${strand.run.id}${(strand.runs ?? 1) > 1 ? ` of ${strand.runs}` : ""}` : ""}`]));
  const hitsByPlace = new Map<string, typeof simulation.hits>();
  for (const hit of simulation.hits) hitsByPlace.set(hit.place, [...hitsByPlace.get(hit.place) ?? [], hit]);
  for (const [placeId, place] of Object.entries(simulation.places)) {
    const hits = hitsByPlace.get(placeId) ?? [];
    const state = place.lots.map(() => ({ lost: new Set<number>(), cutOff: [] as number[], cutRooms: [] as number[], gone: new Set<string>(), rubble: [] as number[][], struck: false }));
    // The hits so far in the strand's order; what is cut off is the latest hit's word on it.
    for (const hit of hits) if (happened(hit.scene)) for (const part of hit.lots) {
      const lot = state[part.lot];
      if (!lot) continue;
      for (const cell of [...part.destroyed, ...part.fell]) lot.lost.add(cell);
      for (const unit of [...part.blasted, ...part.fallen]) lot.gone.add(unit.slice(0, 4).join("|"));
      lot.rubble.push(...part.fallen);
      Object.assign(lot, { cutOff: part.cutOff, cutRooms: part.cutRooms, struck: true });
    }
    places.set(placeId, { strand: place.strand, title: titles.get(place.strand) ?? place.strand, grid: place.grid,
      lots: place.lots.map(({ since, ...lot }, lotIndex) => {
        const now = state[lotIndex], walkable = [...lot.skeleton].filter((cell) => cell !== "0").length;
        return { ...lot, index: lotIndex, named: !!lot.name && happened(since), lost: [...now.lost], cutOff: now.cutOff, cutRooms: now.cutRooms, gone: [...now.gone], rubble: now.rubble, struck: now.struck,
          damage: Math.min(1, new Set([...now.lost, ...now.cutOff]).size / Math.max(1, walkable)) };
      }),
      things: [], hits: hits.map((hit) => ({ x: hit.x, y: hit.y, z: hit.z, r: hit.r, strength: hit.strength, standing: happened(hit.scene) })) });
  }
  const broken = new Set(simulation.hits.filter((hit) => happened(hit.scene)).flatMap((hit) => hit.things));
  for (const thing of simulation.things) {
    // Things move with the story: where it last stood by the moment, else where it first stands (later).
    const placements = [...thing.placements].sort((first, second) => index(first.scene) - index(second.scene));
    const now = placements.filter((placement) => happened(placement.scene)).at(-1), shown = now ?? placements[0];
    const place = shown && places.get(shown.place);
    if (!shown || !place) continue;
    place.things.push({ id: thing.id, name: thing.name, model: thing.model, shape: thing.shape, x: shown.x, y: shown.y, z: shown.z, w: shown.w, h: shown.h, d: shown.d, turn: shown.turn, standing: !!now, broken: broken.has(thing.id) });
  }
  return places;
}

/** People who moved from one place to another together in a scene (the records' migrations), as of `at`: later ones are marked. */
export function migrationsAt(data: TimePlaceProjection, at: string | null): { scene: string; from: string; to: string; people: string[]; standing: boolean }[] {
  const { index, cutoff } = storyClock(data, at), groups = new Map<string, { scene: string; from: string; to: string; people: string[]; standing: boolean }>();
  for (const move of data.simulation?.migrations ?? []) {
    const key = `${move.scene}|${move.from}|${move.to}`;
    const group = groups.get(key) ?? { scene: move.scene, from: move.from, to: move.to, people: [], standing: index(move.scene) <= cutoff };
    if (!group.people.includes(move.person)) group.people.push(move.person);
    groups.set(key, group);
  }
  return [...groups.values()];
}

/** A scene's story position (its period's story index; before any time word: −1) and the moment's cutoff (null: the end, everything). */
function storyClock(data: TimePlaceProjection, at: string | null) {
  const times = new Map(data.times.map((time) => [time.id, time])), scenes = new Map(data.scenes.map((scene) => [scene.id, scene]));
  const index = (sceneId: string) => { const scene = scenes.get(sceneId), period = scene ? scenePeriod(scene) : null; return period ? times.get(period)?.storyIndex ?? -1 : -1; };
  return { index, cutoff: at && times.has(at) ? times.get(at)!.storyIndex : Infinity };
}
