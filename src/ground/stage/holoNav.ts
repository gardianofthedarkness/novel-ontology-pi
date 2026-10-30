import type { ArchitectureKind } from "./placeArchitecture.js";

/**
 * Nav grids for the holo stage: the named spots inside and around each kind
 * of building and the ways between them, so a scene's movement can be told as
 * "who goes where, how" (a decision model picks from these spots) and drawn as
 * a walk through the hologram. Spots sit in the building's own box: u and w
 * across its width and depth (−0.5 … 0.5), v up its height (0 … 1); `out`
 * reaches past the walls (stage units) for the street, an alley, a garden —
 * the ways in and out of the place. `outdoor` marks open-air spots inside the
 * place (a district's plaza and streets): leaving a building for one of them
 * is going out too.
 */
export interface NavSpot { id: string; label: string; hint: string; u: number; v: number; w: number; out?: [number, number]; outdoor?: boolean }
export interface NavGrid { spots: NavSpot[]; links: [string, string][] }
export interface NavBox { x: number; z: number; width: number; depth: number; height: number }
export const MANNERS = ["walk", "run", "sneak", "climb up", "go down", "fall", "teleport", "dragged"] as const;
export type Manner = typeof MANNERS[number];
/** Stage units per second along the way. */
export const MANNER_SPEED: Record<Manner, number> = { walk: 120, run: 260, sneak: 60, "climb up": 80, "go down": 120, fall: 420, teleport: 1e6, dragged: 90 };

const spot = (id: string, label: string, hint: string, u: number, v: number, w: number, out?: [number, number]): NavSpot => ({ id, label, hint, u, v, w, out });
const open = (entry: NavSpot): NavSpot => ({ ...entry, outdoor: true });

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
  spots.push(spot("roof", "Roof", "the rooftop", 0, 1, 0), spot("back-door", "Back door", "a rear exit", -0.1, 0, -0.5), spot("alley", "Back alley", `outside, behind the ${name}`, 0, 0, -0.5, [0, -120]),
    spot("basement", "Basement", "underground, below the ground floor", -0.3, -0.12, -0.25));
  links.push([`stairs-${floors}`, "roof"], ["floor-1", "back-door"], ["back-door", "alley"], ["alley", "street"], ["stairs-1", "basement"]);
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
    spots: [spot("avenue", "Avenue", "the avenue into the district", 0, 0, 0.5, [0, 120]), open(spot("plaza", "Plaza", "the open plaza in the middle", 0, 0, 0)), spot("west", "West towers", "among the towers on the west side", -0.42, 0, 0),
      spot("east", "East towers", "among the towers on the east side", 0.42, 0, 0), open(spot("north", "North street", "the street at the back", 0, 0, -0.42)), spot("rooftop", "Rooftop", "on a rooftop above the streets", 0.3, 0.75, -0.25)],
    links: [["avenue", "plaza"], ["plaza", "west"], ["plaza", "east"], ["plaza", "north"], ["east", "rooftop"], ["west", "north"], ["east", "north"]],
  }),
};

/**
 * Under every place, the levels the world builds below the street (world.ts): the subway level (tunnels, platforms, a
 * concourse, an underground mall), a building's underground floors, the storm-water channels, and a super-deep one,
 * reached from the basement, else the first way out.
 */
const UNDERGROUND = [spot("subway", "Subway", "underground at the subway level: its tunnels, platforms and concourse", 0, -0.25, 0.3), spot("arcade", "Underground mall", "the underground shopping street under the commercial streets", -0.2, -0.25, 0.3), spot("underground", "Underground floors", "a building's underground floors: a car park, storage, machine rooms", 0.2, -0.4, -0.2), spot("water", "Storm-water channels", "the storm-water channels and tanks far under the roads", -0.2, -0.5, 0), spot("deep", "Deep underground", "far underground: a military bunker, an experiment lab, a quantum facility, a shelter", 0, -0.6, 0)];
export function navGrid(kind: ArchitectureKind): NavGrid {
  const grid = GRIDS[kind](), from = grid.spots.find((entry) => entry.id === "basement") ?? grid.spots.find((entry) => entry.out || entry.outdoor) ?? grid.spots[0];
  return { spots: [...grid.spots, ...UNDERGROUND], links: [...grid.links, [from.id, "subway"], ["subway", "arcade"], [from.id, "underground"], [from.id, "water"], ["underground", "deep"]] };
}

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
  /** A move's spot is the chain's; `jev` is Jev's own pick when the chain overruled it. */
  moves: Record<string, { actor: string; to: string; how: Manner; p: number; jev?: string; revised?: boolean }[]>;
  /** Per scene and person: did the scene say where they start, was the start assumed (the centre), revised by the chain, and why. */
  notes?: Record<string, Record<string, StartNote>>;
}
export interface StartNote { stated: number; assumed: boolean; revised: boolean; why?: string }

export const DIRECTIONS = ["up", "down", "same level", "out of the building", "into the building"] as const;
export type Direction = typeof DIRECTIONS[number];
/** Which way a mover goes, as asked of the decision model. */
export const DIRECTION_HINT: Record<Direction, string> = {
  up: "goes up: stairs up, climbing, to an upper floor or the roof", down: "goes down: stairs down, dropping, falling, to a lower floor or underground",
  "same level": "moves on the same floor or level", "out of the building": "leaves the building for the outside", "into the building": "comes in from outside",
};

const isInside = (entry: NavSpot) => !entry.out;
/** Under a roof: neither a way out of the place nor open air inside it. */
const isIndoor = (entry: NavSpot) => !entry.out && !entry.outdoor;
const destinations = (grid: NavGrid) => grid.spots.filter((entry) => !entry.id.startsWith("stairs-"));

/** "Somewhere in the building" when a scene does not say: the middle inside — halfway up its inside spots, nearest the centre of the floor plan. */
export function centreSpot(grid: NavGrid): string {
  const inside = destinations(grid).filter((entry) => isInside(entry) && entry.v >= 0 && entry.v < 1);
  const heights = inside.map((entry) => entry.v), middle = (Math.min(...heights) + Math.max(...heights)) / 2;
  const off = (entry: NavSpot) => entry.u ** 2 + entry.w ** 2 + 4 * (entry.v - middle) ** 2;
  return inside.sort((a, b) => off(a) - off(b))[0]?.id ?? grid.spots[0].id;
}

/** One person's moves in one scene, as the decision model saw them: probabilities over spots and directions. */
export interface ChainStep {
  to: Record<string, number>; how: Manner; direction?: Partial<Record<Direction, number>>;
  /** How sure the model is that the person moves at all (a move that cannot physically happen is dropped instead). */
  p?: number;
}
export interface ChainInput { start: Record<string, number>; stated: number; steps: ChainStep[] }
export interface ChainResult { start: string; assumed: boolean; revised: boolean; spots: string[]; overruled: boolean[]; dropped: boolean[]; why?: string }

const top = (probabilities: Record<string, number>) => Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]?.[0];

/** How well going from one spot to another fits a step's direction and manner (1: fits; small: physically unlikely), and why not. */
function fits(grid: NavGrid, from: string, to: string, step: ChainStep): { score: number; why?: string } {
  if (from === to) return { score: 0.03, why: "a mover ends somewhere else" };
  const a = grid.spots.find((entry) => entry.id === from)!, b = grid.spots.find((entry) => entry.id === to)!;
  const rise = b.v - a.v, way = rise > 0.03 ? "up" : rise < -0.03 ? "down" : "level";
  // Out: from under a roof into the open, or out of the place by its way out; in: the reverse.
  const out = isIndoor(a) && !isIndoor(b) || !a.out && !!b.out, into = !isIndoor(a) && isIndoor(b) || !!a.out && !b.out;
  const match: Record<Direction, number> = { up: way === "up" ? 1 : 0.04, down: way === "down" ? 1 : 0.04, "same level": way === "level" ? 1 : 0.15, "out of the building": out ? 1 : 0.1, "into the building": into ? 1 : 0.1 };
  const weights = Object.entries(step.direction ?? {}) as [Direction, number][], total = weights.reduce((sum, [, value]) => sum + value, 0);
  const direction = total > 0 ? weights.reduce((sum, [key, value]) => sum + (value / total) * match[key], 0) : 1;
  const manner = step.how === "climb up" ? (way === "up" ? 1 : 0.05) : step.how === "go down" || step.how === "fall" ? (way === "down" ? 1 : 0.05) : 1;
  const score = direction * manner;
  if (score >= 0.5) return { score };
  const said = step.how === "climb up" || step.how === "go down" || step.how === "fall" ? step.how : total > 0 ? top(Object.fromEntries(weights)) : step.how;
  const needs = said === "climb up" || said === "up" ? "lower" : said === "into the building" ? "outside" : said === "out of the building" ? "inside" : said === "same level" ? `on ${b.label}'s level` : "higher";
  return { score, why: `${said} to ${b.label} needs a start ${needs}` };
}

/**
 * The likeliest chain of spots for one person in one scene (Viterbi over the
 * nav grid). The start is the centre of the building unless the scene says
 * where they are; each move's spot comes from the decision model, weighed by
 * whether it physically follows from the spot before: going down or falling
 * needs height, climbing needs to start lower, leaving needs to start inside.
 * When later moves cannot follow from the assumed start, the start is revised
 * backwards. Underground is unlikely unless a step says so outright. A move
 * that cannot physically follow from anywhere likely is dropped (they did not
 * move), weighed by how sure the model was that they moved at all.
 */
export function solveChain(grid: NavGrid, input: ChainInput): ChainResult {
  const ids = destinations(grid).map((entry) => entry.id), centre = centreSpot(grid);
  const spotOf = (id: string) => grid.spots.find((entry) => entry.id === id)!;
  const distance = new Map(ids.map((id) => [id, navPath(grid, centre, id).length - 1]));
  // A soft default: likeliest at the centre, then fading with distance through the grid; evidence overturns it.
  const near = (id: string) => Math.exp(-0.35 * (distance.get(id) ?? 9)) * (spotOf(id).out ? 0.3 : 1);
  const spread = ids.filter((id) => id !== centre).reduce((sum, id) => sum + near(id), 0);
  const centred = (id: string) => (id === centre ? 0.35 : (0.65 * near(id)) / spread);
  const prior = (id: string) => input.stated * Math.max(0.01, input.start[id] ?? 0) + (1 - input.stated) * centred(id);
  const underground = (id: string, said: Record<string, number>) => (spotOf(id).v < 0 && (said[id] ?? 0) < 0.5 ? 0.15 : 1);
  let score = new Map(ids.map((id) => [id, Math.log(prior(id) * underground(id, input.start))]));
  const back: Map<string, string>[] = [];
  for (const step of input.steps) {
    const next = new Map<string, number>(), from = new Map<string, string>();
    for (const to of ids) {
      let best = -Infinity, arg = ids[0];
      // Moving here from elsewhere (how sure they move × how physically it follows × where the model says), or not having moved at all.
      const moving = Math.log((step.p ?? 0.9) * Math.max(0.002, step.to[to] ?? 0) * underground(to, step.to));
      for (const at of ids) {
        const value = score.get(at)! + (at === to ? Math.log(Math.max(0.02, 1 - (step.p ?? 0.9)) * 0.5) : moving + Math.log(fits(grid, at, to, step).score));
        if (value > best) { best = value; arg = at; }
      }
      next.set(to, best);
      from.set(to, arg);
    }
    back.push(from);
    score = next;
  }
  let last = [...score].sort((a, b) => b[1] - a[1])[0][0];
  const spots = [last];
  for (let index = back.length - 1; index >= 0; index--) { last = back[index].get(last)!; spots.unshift(last); }
  const expected = input.stated >= 0.5 ? top(input.start) ?? centre : centre;
  let why: string | undefined;
  // Why the start moved: the first step that could not follow had they started where expected.
  if (spots[0] !== expected) for (const [index, step] of input.steps.entries()) { const reason = fits(grid, index === 0 ? expected : spots[index], spots[index + 1], step).why; if (reason) { why = reason; break; } }
  const dropped = input.steps.map((_, index) => spots[index + 1] === spots[index]);
  return { start: spots[0], assumed: input.stated < 0.5, revised: spots[0] !== expected, spots, overruled: input.steps.map((step, index) => !dropped[index] && spots[index + 1] !== top(step.to)), dropped, why };
}

/** Where everyone stands after a beat: scene start spots, then each move up to and including it. */
export function spotsAfter(plan: MovePlan, beats: { id: string; sceneId: string }[], index: number): Map<string, string> {
  const at = new Map<string, string>();
  const sceneId = beats[index]?.sceneId;
  for (const [actor, where] of Object.entries(plan.starts[sceneId] ?? {})) at.set(actor, where);
  for (let step = 0; step <= index; step++) if (beats[step].sceneId === sceneId) for (const move of plan.moves[beats[step].id] ?? []) at.set(move.actor, move.to);
  return at;
}
