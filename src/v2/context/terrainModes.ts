import type { DecisionQuestion } from "../../ground/connectors/jev.js";
import { ReadingGraph } from "../readingGraph.js";
import type { Item, Mode, Source } from "./engine.js";

/**
 * The context engine's terrain modes (docs/v2/visual-context-engine.md §5.6; layer 3 of docs/v2/world-model.md): what Jev
 * sees when terrain spawning asks which city a part is in (`terrain-member`), where a part lies and what its ground is
 * (`terrain-ground`), where it lies closer up (`terrain-zoom`) and at what height (`terrain-height`). A part's ground is read
 * from what the text says of it and of the places around it: what stands there (the unnamed places place EM holds in it,
 * in the place that holds it and in its city), the facts about them by Cypher, and the surroundings of the scenes set in
 * them. Before, only the sentences naming the part were given, and 学园都市's towers of fifty floors never reached its
 * districts (2026-10-31).
 */
export interface TerrainStores {
  graph: ReadingGraph | null;
  label: (id: string) => string;
  /** Whether `id` is `top` or in it, by the tree. */
  inside: (id: string, top: string) => boolean;
  fact: (id: string) => { text: string; sentences: string[] } | undefined;
  /** What stands in a place: the unnamed places the reading holds there (no rooms: they are inside buildings). */
  standing: (place: string) => { label: string; kind: string }[];
  /** The environment cards of every scene, with the place it is set in, in reading order. */
  cards: { id: string; first: string; text: string; setting: string | null }[];
  /** The sentences naming a place, in reading order. */
  naming: (label: string) => { id: string; text: string }[];
  /** The named places. */
  places: { id: string; label: string }[];
}
export interface TerrainReading {
  entities: { id: string; name: string; kind: string }[];
  facts: { id: string; order: number; sentences: string[]; about: { id: string }[] }[];
  slots: { label: string; kind: string; in: string | null }[];
  settings: { scene: string; place: string | null }[];
  scenes: { id: string; index: number; environment?: { id: string; first: string; text: string }[] }[];
}

/** The terrain stores from a reading: its graph (built once), what stands where, the scenes' surroundings. */
export async function terrainStores(reading: TerrainReading, sentences: { id: string; text: string }[], parentOf: (id: string) => string | null, label: (id: string) => string): Promise<TerrainStores> {
  const graph = await ReadingGraph.build({
    entities: reading.entities,
    scenes: reading.scenes.map((scene) => ({ id: scene.id, index: scene.index })),
    names: [],
    facts: reading.facts.map((fact) => ({ id: fact.id, at: fact.order, scene: null, about: fact.about.map((entry) => entry.id) })),
  });
  const text = new Map(sentences.map((sentence) => [sentence.id, sentence.text])), facts = new Map(reading.facts.map((fact) => [fact.id, fact]));
  const settingOf = new Map(reading.settings.map((entry) => [entry.scene, entry.place]));
  const inside = (id: string, top: string) => { for (let at: string | null = id, n = 0; at && n < 16; at = parentOf(at), n++) if (at === top) return true; return false; };
  return {
    graph, label, inside,
    fact: (id) => { const fact = facts.get(id); return fact && { text: fact.sentences.map((sentence) => text.get(sentence) ?? "").join(""), sentences: fact.sentences }; },
    standing: (place) => reading.slots.filter((slot) => slot.in === place && slot.kind !== "room").map((slot) => ({ label: slot.label, kind: slot.kind })),
    cards: [...reading.scenes].sort((a, b) => a.index - b.index).flatMap((scene) => (scene.environment ?? []).map((card) => ({ ...card, setting: settingOf.get(scene.id) ?? null }))),
    naming: (name) => sentences.filter((sentence) => sentence.text.includes(name)),
    places: reading.entities.filter((entity) => entity.kind === "place").map((entity) => ({ id: entity.id, label: label(entity.id) })),
  };
}

export interface TerrainPart { id: string; label: string; scale: string }
/**
 * `within`: the terrain already kept for the places holding the part (its city, then the place between), by their labels:
 * the larger level comes first (the user's call: city, then district, then street), and its manifold frames the part's.
 * A city is its own holder and city.
 */
export interface PartFocus { part: TerrainPart; holder: { id: string; label: string }; city: { id: string; label: string }; pictures: Record<string, string>; kind?: string; within?: Record<string, string> }
/** `shapes`: the basic shapes of ground, at every level, besides the level's kinds. */
export interface GroundFocus extends PartFocus { shapes: Record<string, string> }
export interface ZoomFocus extends PartFocus { kind: string; reasons: string[] }
/** `tops`: the lettered slices, each a height the terrain may rise to. */
/** `measure`: a built kind's median (its manifold makes the rest), or natural ground's or a shape's top; `slices` the heights offered. */
export interface HeightFocus extends PartFocus { kind: string; measure: "median" | "top"; slices: { letter: string; y: number; said: string }[] }
export interface MemberFocus { city: { id: string; label: string }; parts: { key: string; label: string; scale: string }[] }

const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
const BUDGET = 9000;

/** A manifold (src/ground/stage/landscape.ts): gradient, core, spread, tail share, tail index. */
const M = (gradient: number, spread: number, tail = 0) => ({ gradient, core: 0.3, spread, tail, index: 5 });
/**
 * The kinds of terrain a part may be, by its level (the user's calls, 2026-10-31): a city is what kind of city it is; a
 * district what a whole quarter is built as; a commercial centre, a park or a stadium is a street's. A built kind is the
 * engine's ground (a landscape type) with its own manifold (docs/v2/visual-context-engine.md §5.8): Jev gives its median
 * (`medians`, the slices it is offered), the engine draws the spread, with no cap. Natural ground and shapes are asked
 * their top (`tops`). The old-world kinds stay for older worlds. The gradients follow the research: about 0.3 city-wide,
 * steeper for a commercial core; the spreads are wide where heights vary most (a CBD, a city's whole skyline).
 */
export interface TerrainKind { hint: string; ground?: string; shape?: string; manifold?: { gradient: number; core: number; spread: number; tail: number; index: number }; medians?: number[]; tops?: number[] }
export const TERRAIN_KINDS: Record<string, Record<string, TerrainKind>> = {
  city: {
    metropolis: { hint: "a metropolis: a big modern city round one centre, towers at its heart", ground: "skyscrapers", manifold: M(0.3, 0.7, 0.05), medians: [6, 10, 15, 25, 40, 60] },
    city: { hint: "a city: flats, offices and shops round a modest centre", ground: "residential", manifold: M(0.25, 0.45, 0.03), medians: [6, 9, 12, 18, 25] },
    town: { hint: "a town: low houses along a main street", ground: "residential", manifold: M(0.15, 0.3), medians: [4, 6, 8, 11] },
    oldcity: { hint: "an old city of an older world: walls, a keep, crowded lanes", ground: "castle", manifold: M(0.2, 0.3, 0.02), medians: [5, 8, 11, 15] },
  },
  district: {
    cbd: { hint: "a CBD: a dense core of high-rise towers (offices, hotels, malls and flats in towers)", ground: "skyscrapers", manifold: M(0.5, 0.5, 0.1), medians: [30, 50, 80, 120, 180, 250] },
    dwelling: { hint: "a dwelling area: apartment blocks and houses with their schools, shops and stations; the city, not so tall", ground: "residential", manifold: M(0.1, 0.25, 0.02), medians: [8, 12, 18, 25, 35, 50] },
    industrial: { hint: "an industrial area: factories, warehouses, plants and yards on large plots", ground: "industrial", manifold: M(0, 0.2, 0.02), medians: [6, 9, 12, 18, 25] },
    harbour: { hint: "a harbour or a port: docks, piers, cranes and warehouses by the water", ground: "harbour", manifold: M(0, 0.3, 0.03), medians: [6, 9, 12, 18, 25] },
    mountain: { hint: "a mountain or high hills: natural ground rising, wooded or bare", shape: "mountain", tops: [80, 200, 400, 600, 800] },
    oldtown: { hint: "an old town of an older world: a castle's keep within walls and a crowded town round it", ground: "castle", manifold: M(0.2, 0.3, 0.02), medians: [5, 8, 11, 15] },
    village: { hint: "a village of an older world: scattered low houses with gardens", ground: "village", manifold: M(0, 0.2), medians: [3, 4, 6, 8] },
    farmland: { hint: "farmland: wide fields with a few farmhouses", ground: "farm", manifold: M(0, 0.15), medians: [3, 4, 6] },
  },
  street: {
    commercial: { hint: "a modern commercial centre: a mall podium with towers over it, a plaza with screens, wide roads round it", ground: "commercial", manifold: M(0.4, 0.6, 0.1), medians: [12, 20, 30, 45, 70, 100] },
    park: { hint: "a park or an amusement park: lawns, gardens, rides, with a few pavilions", ground: "park", manifold: M(0, 0.4, 0.02), medians: [3, 5, 8, 12, 20] },
    stadium: { hint: "a stadium or a sports ground: a bowl with parking and a few halls round it", ground: "stadium", manifold: M(0, 0.2), medians: [15, 25, 35, 50] },
  },
};
/** The heights a basic shape of ground may rise to (metres). */
const SHAPE_TOPS = [3, 6, 12, 25, 50, 100];
/** Natural ground by its height. */
const natural = (y: number) => (y <= 30 ? "a low rise" : y <= 100 ? "a hill" : y <= 250 ? "a high hill" : y <= 500 ? "a mountain" : "a high mountain");
/** A part's level's kinds (a level without its own, a district's). */
const levelOf = (scale: string) => TERRAIN_KINDS[scale] ?? TERRAIN_KINDS.district;
export const terrainKind = (scale: string, kind: string): TerrainKind | undefined => levelOf(scale)[kind];
/** A manifold in Jev's words, from the same numbers the engine draws with. */
export function manifoldWords(manifold: NonNullable<TerrainKind["manifold"]>): string {
  const ratio = ((1 + manifold.core) / manifold.core) ** manifold.gradient, high = Math.exp(1.2816 * manifold.spread);
  return [ratio >= 1.15 ? `highest at its core (about ${ratio.toFixed(1)} times its edge)` : "about as high across it",
    high >= 1.6 ? `a wide spread (one building in ten over ${high.toFixed(1)} times the median)` : high >= 1.3 ? `some spread (one in ten over ${high.toFixed(1)} times the median)` : "even heights",
    ...(manifold.tail ? [`one in ${Math.round(1 / manifold.tail)} far above the rest`] : [])].join("; ");
}
/**
 * The question's slices for a part of a kind: a built kind's medians (the median roof: the engine draws the spread from
 * its manifold), natural ground's or a shape's tops; each said in floors, or as natural ground.
 */
export function terrainHeights(scale: string, kind: string): { measure: "median" | "top"; slices: { letter: string; y: number; said: string }[] } {
  const entry = terrainKind(scale, kind), median = !!entry?.ground && !!entry.medians;
  const heights = median ? entry!.medians! : entry?.tops ?? SHAPE_TOPS;
  return { measure: median ? "median" : "top", slices: heights.map((y, k) => ({ letter: "ABCDEFGHIJ"[k], y, said: median ? `about ${Math.max(1, Math.round(y / 3))} floors` : natural(y) })) };
}
/** A part's options: its level's kinds (each with its manifold in words), then the basic shapes. */
export const terrainKinds = (scale: string, shapes: Record<string, string>): Record<string, string> => ({ ...Object.fromEntries(Object.entries(levelOf(scale)).map(([kind, entry]) => [kind, entry.manifold ? `${entry.hint}. Its heights: ${manifoldWords(entry.manifold)}` : entry.hint])), ...shapes });
/** Characters a fact needs to say something of a place (a sentence, not the name and a full stop). */
const SAYS = 16;
/** How near a place is to the part: itself, the place that holds it, its city (the farther, the weaker). */
const nearness = (focus: PartFocus, place: string) => (place === focus.part.id ? 3 : place === focus.holder.id && focus.holder.id !== focus.city.id ? 2 : 1);
const around = (focus: PartFocus) => [...new Set([focus.part.id, focus.holder.id, focus.city.id])];
/** The part's own sentences (as many as the old evidence gave): what is asked about. */
const ownText = (focus: PartFocus, stores: TerrainStores) => stores.naming(focus.part.label).filter((sentence) => sentence.text.length >= focus.part.label.length + 6);
const fixed = (name: string, key: string, of: (focus: never) => Record<string, unknown>): Source<never, TerrainStores> => ({ name, key, quota: 0, keep: true, collect: (focus) => Object.entries(of(focus)).map(([id, fields]) => ({ id, score: 1, fields })) });

function sources<F extends PartFocus>(use: { standing?: boolean; environment: "city" | "part"; facts?: boolean }): Source<F, TerrainStores>[] {
  const list: Source<F, TerrainStores>[] = [
    fixed("part", "part", (focus: F) => ({ name: focus.part.label, scale: focus.part.scale, in: focus.holder.label, ...(focus.holder.id !== focus.city.id ? { city: focus.city.label } : {}), ...(focus.kind ? { ground: focus.kind } : {}) })) as Source<F, TerrainStores>,
    fixed("within", "within", (focus: F) => focus.within ?? {}) as Source<F, TerrainStores>,
    { name: "text", key: "text", quota: 4, ranked: true, collect: (focus, stores) => ownText(focus, stores).map((sentence) => ({ id: sentence.id, score: 1, fields: clip(sentence.text, 160) })) },
  ];
  if (use.standing) list.push({
    name: "standing", key: "standing", quota: 30,
    // One item a description, at the nearest place that has it; how often the text says it, and the longer words, first.
    collect: (focus, stores) => {
      const items = new Map<string, Item & { place: string; times: number; kind: string }>();
      for (const place of around(focus)) for (const slot of stores.standing(place)) {
        const had = items.get(slot.label);
        if (had && had.place !== place) continue;
        const times = (had?.times ?? 0) + 1, score = nearness(focus, place) + Math.min(times, 5) / 10 + slot.label.length / 100;
        items.set(slot.label, { id: slot.label, place, times, kind: slot.kind, score, fields: "" });
      }
      return [...items.values()].map(({ place, times, kind, ...item }) => ({ ...item, fields: `${kind === "place" ? "a place" : `a ${kind}`}${place !== focus.part.id ? ` in ${stores.label(place)}` : ""}${times > 1 ? `, ${times} times` : ""}` }));
    },
  });
  if (use.facts) list.push({
    name: "facts", key: "facts", quota: 6,
    // By Cypher: the facts about the part, the place holding it and its city; those about one thing alone describe it, and
    // a fact of a few characters (the name and a full stop) says nothing of it.
    collect: async (focus, stores) => {
      if (!stores.graph) return [];
      const own = new Set(ownText(focus, stores).map((sentence) => sentence.id)), items = new Map<string, Item>();
      for (const place of around(focus)) for (const { id, subjects } of await stores.graph.factsOf(place, 40)) {
        const fact = stores.fact(id), score = fact ? nearness(focus, place) + Math.min(1, fact.text.length / SAYS) / Math.max(1, subjects) : 0;
        if (!fact || fact.sentences.every((sentence) => own.has(sentence)) || (items.get(id)?.score ?? 0) >= score) continue;
        items.set(id, { id, score, fields: clip(fact.text, 160), why: `about ${stores.label(place)}${subjects > 1 ? ` and ${subjects - 1} more` : ""}` });
      }
      return [...items.values()];
    },
  });
  list.push({
    name: "environment", key: "environment", quota: use.environment === "city" ? 5 : 3,
    // The surroundings of the scenes set in the part (then in what holds it, then anywhere in its city); a card naming what
    // stands there says more of the ground.
    collect: (focus, stores) => {
      const own = new Set(ownText(focus, stores).map((sentence) => sentence.id)), words = around(focus).flatMap((place) => stores.standing(place).map((slot) => slot.label)).filter((word) => word.length >= 2);
      // A card naming another of the city's places is that place's surroundings (第七学区's station front is not 第六学区's).
      const others = stores.places.filter((place) => !around(focus).includes(place.id) && place.id !== focus.city.id && stores.inside(place.id, focus.city.id)).map((place) => place.label);
      return stores.cards.flatMap((card) => {
        const at = card.setting && around(focus).filter((place) => stores.inside(card.setting!, place)).sort((a, b) => nearness(focus, b) - nearness(focus, a))[0];
        // Closer up and for the height, only the part's own scenes (and those of the place holding it, short of the city).
        if (!at || own.has(card.first) || (use.environment === "part" && nearness(focus, at) === 1) || others.some((other) => card.text.includes(other))) return [];
        return [{ id: card.id, score: nearness(focus, at) + 0.25 * new Set(words.filter((word) => card.text.includes(word))).size, fields: clip(card.text, 160) }];
      });
    },
  });
  return list;
}

const probe = (focus: PartFocus, stores: TerrainStores) => ({ own: 1 - Math.min(1, ownText(focus, stores).length / 6) });
const box = (focus: PartFocus): DecisionQuestion => ({ key: "box", primitive: "box", instructions: `Box where ${focus.part.label} lies on picture "map", as large as its ground is.` });

export const terrainGroundMode: Mode<GroundFocus, TerrainStores> = {
  name: "terrain-ground",
  task: (focus) => `${focus.part.scale === "city" ? `What kind of city is ${focus.part.label}?` : `Where does ${focus.part.label} lie in ${focus.city.label}, and what kind of ${focus.part.scale} is it?`} Terrain only: a kind of ${focus.part.scale} (each with its manifold: how its heights spread; the engine fills in its buildings) or a basic shape of ground, never a building. Read it from what the text says of it and of the places around it: what stands there (standing), the facts (facts), the surroundings of its scenes (environment), and the terrain kept for the places holding it (within).`,
  // The options are the part's level's kinds (TERRAIN_KINDS, each with its manifold), composed with the evidence.
  sources: [...sources<GroundFocus>({ standing: true, facts: true, environment: "city" }), fixed("kinds", "kinds", (focus: GroundFocus) => terrainKinds(focus.part.scale, focus.shapes)) as Source<GroundFocus, TerrainStores>, fixed("pictures", "pictures", (focus: GroundFocus) => focus.pictures) as Source<GroundFocus, TerrainStores>],
  cutOrder: ["environment", "facts", "standing", "text"],
  probe,
  // A city is the map itself: it is asked its kind, not where it lies.
  questions: (focus, kept) => [...(focus.part.scale === "city" ? [] : [box(focus)]), { key: "kind", primitive: "choice", instructions: `What kind of ${focus.part.scale} is ${focus.part.label} (the kinds are in kinds)?`, options: kept.kinds.map((item) => item.id), optionHints: Object.fromEntries(kept.kinds.map((item) => [item.id, String(item.fields)])) }],
  budget: BUDGET,
};

export const terrainZoomMode: Mode<ZoomFocus, TerrainStores> = {
  name: "terrain-zoom",
  task: (focus) => `Where does ${focus.part.label} lie, closer up? The red box is the last answer: ${focus.reasons.join("; ")}.`,
  sources: [...sources<ZoomFocus>({ environment: "part" }), fixed("pictures", "pictures", (focus: ZoomFocus) => focus.pictures) as Source<ZoomFocus, TerrainStores>],
  cutOrder: ["environment", "text"],
  questions: (focus) => [box(focus)],
  budget: BUDGET,
};

// How high the terrain stands (the user's calls, 2026-10-31: the ground is at 0, always; Jev gives a built kind's median,
// its manifold makes the spread): the median roof, or natural ground's top; what the text says of the part and its city says it.
export const terrainHeightMode: Mode<HeightFocus, TerrainStores> = {
  name: "terrain-height",
  task: (focus) => `${focus.measure === "median"
    ? `What is the median height of ${focus.part.label}'s roofs (${focus.kind}): the height half its buildings stand below? Its manifold makes the rest (${manifoldWords(terrainKind(focus.part.scale, focus.kind)!.manifold!)}), so give the median, not the tallest.`
    : `How high does ${focus.part.label} (${focus.kind}) rise: the top of its ground?`} Its ground is at the street. The picture shows a core of its area with a lettered ghost slice at each height; red dotted lines are where a slice cuts a building the engine stands there for now. Read it from what the text says of it and of the places around it: what stands there (standing), the facts (facts), the surroundings of its scenes (environment), the terrain kept for the places holding it (within).`,
  sources: [...sources<HeightFocus>({ standing: true, facts: true, environment: "city" }), fixed("heights", "heights", (focus: HeightFocus) => Object.fromEntries(focus.slices.map((slice) => [slice.letter, `${slice.y} m: ${slice.said}`]))) as Source<HeightFocus, TerrainStores>, fixed("pictures", "pictures", (focus: HeightFocus) => focus.pictures) as Source<HeightFocus, TerrainStores>],
  cutOrder: ["environment", "facts", "standing", "text"],
  probe,
  questions: (focus) => [{ key: "height", primitive: "choice", instructions: `Which lettered slice is ${focus.measure === "median" ? `the median of ${focus.part.label}'s roofs` : `the top of ${focus.part.label}'s ground`}?`, options: focus.slices.map((slice) => slice.letter), optionHints: Object.fromEntries(focus.slices.map((slice) => [slice.letter, `${slice.letter}: ${slice.y} m, ${slice.said}`])) }],
  budget: BUDGET,
};

export const terrainMemberMode: Mode<MemberFocus, TerrainStores> = {
  name: "terrain-member",
  task: (focus) => `Places a novel names. For each, say whether it is part of ${focus.city.label} (a district or a street of it).`,
  sources: [
    { name: "parts", key: "parts", quota: 0, keep: true, collect: (focus, stores) => focus.parts.map((part) => ({ id: part.key, score: 1, fields: { name: part.label, scale: part.scale, text: stores.naming(part.label).slice(0, 2).map((sentence) => clip(sentence.text, 120)) } })) },
    { name: "facts", key: "facts", quota: 3, collect: async (focus, stores) => (stores.graph ? await stores.graph.factsOf(focus.city.id, 12) : []).flatMap(({ id, subjects }) => { const fact = stores.fact(id); return fact ? [{ id, score: 1 / Math.max(1, subjects), fields: clip(fact.text, 160) }] : []; }) },
  ],
  cutOrder: ["facts"],
  questions: (focus) => focus.parts.map((part) => ({ key: `in:${part.key}`, primitive: "noul", instructions: `Is parts.${part.key} (${part.label}) part of ${focus.city.label}?`, noulCriteria: { true: `it lies in ${focus.city.label}`, false: `it lies elsewhere, or the text does not put it in ${focus.city.label}` } })),
  budget: BUDGET,
};
