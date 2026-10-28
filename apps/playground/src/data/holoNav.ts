import type { ArchitectureKind } from "./placeArchitecture.js";

/**
 * Nav grids for the holo stage: the named spots inside and around each kind
 * of building and the ways between them, so a scene's movement can be told as
 * "who goes where, how" (a decision model picks from these spots) and drawn as
 * a walk through the hologram. Spots sit in the building's own box: u and w
 * across its width and depth (−0.5 … 0.5), v up its height (0 … 1); `out`
 * reaches past the walls (stage units) for the street, an alley, a garden.
 */
export interface NavSpot { id: string; label: string; hint: string; u: number; v: number; w: number; out?: [number, number] }
export interface NavGrid { spots: NavSpot[]; links: [string, string][] }
export interface NavBox { x: number; z: number; width: number; depth: number; height: number }
export const MANNERS = ["walk", "run", "sneak", "climb up", "go down", "fall", "teleport", "dragged"] as const;
export type Manner = typeof MANNERS[number];
/** Stage units per second along the way. */
export const MANNER_SPEED: Record<Manner, number> = { walk: 120, run: 260, sneak: 60, "climb up": 80, "go down": 120, fall: 420, teleport: 1e6, dragged: 90 };

const spot = (id: string, label: string, hint: string, u: number, v: number, w: number, out?: [number, number]): NavSpot => ({ id, label, hint, u, v, w, out });

/** A building of storeys: street, doors, a stairwell up through each floor, the roof. */
function storeys(floors: number, name: string): NavGrid {
  const spots = [
    spot("street", "Street", `outside, in front of the ${name}`, 0, 0, 0.5, [0, 120]),
    spot("front-door", "Front door", "the main entrance", 0.18, 0, 0.5),
    spot("floor-1", "1F", "the ground floor inside", 0.12, 0.02, 0.1),
    spot("stairs-1", "Stairs 1F", "the stairwell on the ground floor", -0.3, 0.02, -0.25),
  ];
  const links: [string, string][] = [["street", "front-door"], ["front-door", "floor-1"], ["floor-1", "stairs-1"]];
  for (let floor = 2; floor <= floors; floor++) {
    const v = ((floor - 1) / floors) * 0.94;
    const top = floor === floors;
    spots.push(spot(`stairs-${floor}`, `Stairs ${floor}F`, `the stairwell on floor ${floor}`, -0.3, v, -0.25), spot(`floor-${floor}`, `${floor}F`, top ? `the top floor (${floor}F)` : `an upper floor (${floor}F)`, 0.12, v, 0.05));
    links.push([`stairs-${floor - 1}`, `stairs-${floor}`], [`stairs-${floor}`, `floor-${floor}`]);
  }
  spots.push(spot("roof", "Roof", "the rooftop", 0, 1, 0), spot("back-door", "Back door", "a rear exit", -0.1, 0, -0.5), spot("alley", "Back alley", `outside, behind the ${name}`, 0, 0, -0.5, [0, -120]));
  links.push([`stairs-${floors}`, "roof"], ["floor-1", "back-door"], ["back-door", "alley"], ["alley", "street"]);
  return { spots, links };
}

const GRIDS: Record<ArchitectureKind, () => NavGrid> = {
  skyscraper: () => storeys(6, "tower"),
  office: () => storeys(4, "building"),
  hospital: () => storeys(3, "hospital"),
  school: () => storeys(3, "school"),
  home: () => storeys(2, "house"),
  church: () => ({
    spots: [spot("street", "Street", "outside, in front of the church", 0, 0, 0.5, [0, 110]), spot("front-door", "Front door", "the door under the bell tower", 0, 0, 0.46), spot("nave", "Nave", "inside, among the pews", 0, 0.02, -0.05),
      spot("altar", "Altar", "the altar at the far end", 0, 0.02, -0.4), spot("bell-tower", "Bell tower", "up in the bell tower", 0, 0.62, 0.36), spot("side-door", "Side door", "a door on the side", 0.5, 0, -0.1), spot("garden", "Garden", "outside, beside the church", 0.5, 0, -0.1, [110, 0])],
    links: [["street", "front-door"], ["front-door", "nave"], ["nave", "altar"], ["front-door", "bell-tower"], ["nave", "side-door"], ["side-door", "garden"], ["garden", "street"]],
  }),
  station: () => ({
    spots: [spot("street", "Street", "outside the station", 0.3, 0, 0.5, [0, 110]), spot("entrance", "Entrance", "the entrance under the clock tower", 0.42, 0, 0.35), spot("concourse", "Concourse", "inside the hall", 0, 0.08, 0.1),
      spot("platform", "Platform", "on the platform", -0.2, 0.08, -0.25), spot("tracks", "Tracks", "down on the tracks", -0.2, 0, -0.5, [0, -70]), spot("roof", "Roof", "on top of the roof", 0, 0.6, 0)],
    links: [["street", "entrance"], ["entrance", "concourse"], ["concourse", "platform"], ["platform", "tracks"], ["entrance", "roof"]],
  }),
  market: () => ({
    spots: [spot("street", "Street", "the street in front of the market", 0, 0, 0.5, [0, 100]), spot("stall-a", "Left stall", "at a stall on the left", -0.3, 0, 0), spot("stall-b", "Right stall", "at a stall on the right", 0.3, 0, 0),
      spot("stall-c", "Back stall", "at a stall at the back", 0, 0, -0.3), spot("cart", "Cart", "by the cart", 0.42, 0, 0.35), spot("alley", "Alley", "the alley behind the stalls", 0, 0, -0.5, [0, -100])],
    links: [["street", "stall-a"], ["street", "stall-b"], ["street", "cart"], ["stall-a", "stall-c"], ["stall-b", "stall-c"], ["stall-c", "alley"]],
  }),
  park: () => ({
    spots: [spot("gate", "Gate", "the park gate", 0, 0, 0.5, [0, 90]), spot("path", "Path", "on the path", 0.2, 0, 0.25), spot("fountain", "Fountain", "by the fountain", 0, 0, 0),
      spot("trees", "Trees", "among the trees", -0.38, 0, -0.25), spot("bench", "Bench", "on a bench", 0.38, 0, -0.2)],
    links: [["gate", "path"], ["path", "fountain"], ["fountain", "trees"], ["fountain", "bench"], ["path", "bench"]],
  }),
  village: () => ({
    spots: [spot("road", "Road", "the road into the village", 0, 0, 0.5, [0, 100]), spot("cottage-a", "Cottage", "by the front cottage", -0.3, 0, 0.2), spot("cottage-b", "Back cottage", "by the back cottage", -0.3, 0, -0.25),
      spot("mill", "Mill", "at the foot of the mill", 0.2, 0, 0), spot("mill-top", "Mill top", "up in the mill", 0.2, 0.75, 0), spot("field", "Field", "out in the field", 0.5, 0, 0, [110, 0])],
    links: [["road", "cottage-a"], ["cottage-a", "cottage-b"], ["road", "mill"], ["mill", "mill-top"], ["mill", "field"]],
  }),
  castle: () => ({
    spots: [spot("gate", "Gate", "the castle gate", 0.1, 0, 0.5, [0, 100]), spot("courtyard", "Courtyard", "the courtyard", 0.1, 0, 0.2), spot("keep", "Keep", "inside the keep", -0.2, 0.05, -0.05),
      spot("keep-top", "Keep top", "the top of the keep", -0.2, 0.9, -0.05), spot("tower-top", "Tower top", "the top of the round tower", 0.38, 0.55, 0.1), spot("wall", "Wall walk", "on the walls", 0.2, 0.3, 0.42)],
    links: [["gate", "courtyard"], ["courtyard", "keep"], ["keep", "keep-top"], ["courtyard", "tower-top"], ["courtyard", "wall"], ["wall", "tower-top"]],
  }),
  city: () => ({
    spots: [spot("avenue", "Avenue", "the avenue into the district", 0, 0, 0.5, [0, 120]), spot("plaza", "Plaza", "the open plaza in the middle", 0, 0, 0), spot("west", "West towers", "among the towers on the west side", -0.42, 0, 0),
      spot("east", "East towers", "among the towers on the east side", 0.42, 0, 0), spot("north", "North street", "the street at the back", 0, 0, -0.42), spot("rooftop", "Rooftop", "on a rooftop above the streets", 0.3, 0.75, -0.25)],
    links: [["avenue", "plaza"], ["plaza", "west"], ["plaza", "east"], ["plaza", "north"], ["east", "rooftop"], ["west", "north"], ["east", "north"]],
  }),
};

export function navGrid(kind: ArchitectureKind): NavGrid { return GRIDS[kind](); }

/** Spot positions on the stage for a building of this box. */
export function navPositions(grid: NavGrid, box: NavBox, floor: number): Map<string, [number, number, number]> {
  return new Map(grid.spots.map((entry) => [entry.id, [box.x + entry.u * box.width + (entry.out?.[0] ?? 0), floor + entry.v * box.height, box.z + entry.w * box.depth + (entry.out?.[1] ?? 0)]]));
}

/** The way from one spot to another through the grid (both ends included); just the two when unconnected. */
export function navPath(grid: NavGrid, from: string, to: string): string[] {
  if (from === to) return [to];
  const next = new Map<string, string[]>();
  for (const [a, b] of grid.links) { next.set(a, [...(next.get(a) ?? []), b]); next.set(b, [...(next.get(b) ?? []), a]); }
  const previous = new Map<string, string>([[from, from]]), queue = [from];
  while (queue.length) {
    const at = queue.shift()!;
    if (at === to) break;
    for (const neighbour of next.get(at) ?? []) if (!previous.has(neighbour)) { previous.set(neighbour, at); queue.push(neighbour); }
  }
  if (!previous.has(to)) return [from, to];
  const path = [to];
  while (path[0] !== from) path.unshift(previous.get(path[0])!);
  return path;
}

/** A place's movement plan: where each person starts each scene, and who moves where, how, in each beat (from a decision model). */
export interface MovePlan {
  place: string; kind: ArchitectureKind;
  starts: Record<string, Record<string, string>>;
  moves: Record<string, { actor: string; to: string; how: Manner; p: number }[]>;
}

/** Where everyone stands after a beat: scene start spots, then each move up to and including it. */
export function spotsAfter(plan: MovePlan, beats: { id: string; sceneId: string }[], index: number): Map<string, string> {
  const at = new Map<string, string>();
  const sceneId = beats[index]?.sceneId;
  for (const [actor, where] of Object.entries(plan.starts[sceneId] ?? {})) at.set(actor, where);
  for (let step = 0; step <= index; step++) if (beats[step].sceneId === sceneId) for (const move of plan.moves[beats[step].id] ?? []) at.set(move.actor, move.to);
  return at;
}
