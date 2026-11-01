import type { DecisionQuestion } from "../../ground/connectors/jev.js";
import { ReadingGraph } from "../extraction/readingGraph.js";
import { LANGUAGE } from "../rules/language.js";
import type { Item, Mode, Source } from "./engine.js";

/**
 * The context engine's terrain modes (docs/v2/visual-context-engine.md §5.6; layer 3 of docs/v2/world-model.md): what Jev
 * sees when terrain spawning asks which city a part is in (`terrain-member`), where a part lies and what its ground is
 * (`terrain-ground`), where it lies closer up (`terrain-zoom`) and at what height (`terrain-height`). A part's ground is read
 * from the raw text of the scenes it is in (the user's call, 2026-11-01). Before, the things standing round it, the facts
 * about it and its scenes' surroundings were ranked by the place tree; where the tree held nothing under a part, they were
 * all its city's, and the part's own words were lost among them (run 7's 第十五学区).
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
  /** A place's own sentences where the text gives it no name to find it by (a pool's member: place EM's unnamed place). */
  own: (id: string) => { id: string; text: string }[];
  /** The named places. */
  places: { id: string; label: string }[];
  /** Every scene's raw text, with its sentences and the place it is set in. */
  scenes: { id: string; index: number; lines: { id: string; text: string }[]; text: string; setting: string | null }[];
}
export interface TerrainReading {
  entities: { id: string; name: string; kind: string }[];
  facts: { id: string; order: number; sentences: string[]; about: { id: string }[] }[];
  slots: { id?: string; label: string; kind: string; in: string | null; sentences?: string[] }[];
  settings: { scene: string; place: string | null }[];
  scenes: { id: string; index: number; sentences?: string[]; environment?: { id: string; first: string; text: string }[] }[];
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
    own: (id) => (reading.slots.find((slot) => slot.id && `unnamed:${slot.id}` === id)?.sentences ?? []).map((sentence) => ({ id: sentence, text: text.get(sentence) ?? "" })).filter((sentence) => sentence.text),
    places: reading.entities.filter((entity) => entity.kind === "place").map((entity) => ({ id: entity.id, label: label(entity.id) })),
    scenes: [...reading.scenes].sort((a, b) => a.index - b.index).map((scene) => {
      const lines = (scene.sentences ?? []).map((sentence) => ({ id: sentence, text: text.get(sentence) ?? "" }));
      return { id: scene.id, index: scene.index, lines, text: lines.map((line) => line.text).join(""), setting: settingOf.get(scene.id) ?? null };
    }),
  };
}

export interface TerrainPart { id: string; label: string; scale: string }
/**
 * `within`: the terrain already kept for the places holding the part (its city, then the place between), by their labels:
 * the larger level comes first (the user's call: city, then district, then street), and its manifold frames the part's.
 * A city is its own holder and city.
 */
export interface PartFocus { part: TerrainPart; holder: { id: string; label: string }; city: { id: string; label: string }; pictures: Record<string, string>; kind?: string; within?: Record<string, string>; sampled?: boolean }
/** `shapes`: the basic shapes, at every level, besides the level's kinds. */
export interface GroundFocus extends PartFocus { shapes: Record<string, string> }
export interface ZoomFocus extends PartFocus { kind: string; reasons: string[] }
/** `tops`: the lettered slices, each a height the terrain may rise to. */
/** `measure`: a built kind's median (its manifold makes the rest), or natural ground's or a shape's top; `slices` the heights offered. */
export interface HeightFocus extends PartFocus { kind: string; measure: "median" | "top" | "average" | "elevation" | "thickness"; slices: { letter: string; y: number; said: string; offset?: number }[]; standard?: number; addition?: boolean }
export interface MemberFocus { city: { id: string; label: string }; parts: { key: string; label: string; scale: string }[] }

const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
/*
 * A terrain question carries the raw text of the scenes its place is in (the user's calls, 2026-11-01, after run 7: the
 * standing things, the facts and the surroundings ranked by the tree gave 第十五学区's height question the city's filler and
 * two sentences of the district): of the scenes naming it (an unnamed place: its own sentences' scene), the five that best
 * answer the question asked (its words told beside the place's mentions: floors and towers for its height), and of those
 * only the sentences naming it exactly and their neighbours, fifteen in all: each scene's first mention with a sentence
 * either side (the best scene first), then the second mentions so, then wider rings round every mention. Facts, surroundings and what stands there come only when
 * they are about the place itself; with none, nothing is put in their stead.
 */
// Jev 1.14 takes 32k tokens of state with one question, and Chinese runs near a token a character (more at times): 16,000
// characters hold the longest scene of vol 1 (11,754) whole, with room left; 40,000 was refused (max_tokens_exceeded).
const BUDGET = 16000;
/** The scenes a terrain question draws on: the best five for the question. */
const SCENES = 5;
/** The sentences it carries from them in all: each mention with a sentence either side, then wider rings. */
const SENTENCES = 15;

/** A manifold (src/ground/stage/landscape.ts): gradient, core, spread, tail share, tail index. */
const M = (gradient: number, spread: number, tail = 0) => ({ gradient, core: 0.3, spread, tail, index: 5 });
/**
 * The kinds of terrain a part may be, by its level (the user's calls, 2026-10-31): a city is what kind of city it is; a
 * district what a whole quarter is built as; a commercial centre, a park or a stadium is a street's. A built kind is the
 * engine's ground (a landscape type) with its own manifold (docs/v2/visual-context-engine.md §5.8): Jev gives its median
 * (`medians`, the slices it is offered), the engine draws the spread, with no cap. Natural ground and shapes are asked
 * their top (`tops`). The old-world kinds stay for older worlds. The gradients follow the research: about 0.3 city-wide,
 * steeper for a commercial core; the spreads are wide where heights vary most (a CBD, a city's whole skyline). Living
 * areas are an East Asian megacity's (the user's call, 2026-11-01; docs/v2/living-areas.md): a city's, a dwelling area's and a
 * residential street's heights start at three or four floors, with a tail of residential towers; another region's living
 * areas are an option for later.
 */
export interface TerrainKind { hint: string; ground?: string; shape?: string; manifold?: { gradient: number; core: number; spread: number; tail: number; index: number }; medians?: number[]; tops?: number[] }
export const TERRAIN_KINDS: Record<string, Record<string, TerrainKind>> = {
  city: {
    metropolis: { hint: "a metropolis: a big modern city round one centre, towers at its heart", ground: "skyscrapers", manifold: M(0.3, 0.7, 0.05), medians: [12, 18, 25, 35, 50, 70] },
    city: { hint: "a city: flats, offices and shops round a modest centre", ground: "residential", manifold: M(0.25, 0.45, 0.03), medians: [9, 12, 18, 25, 35] },
    town: { hint: "a town: low houses along a main street", ground: "residential", manifold: M(0.15, 0.3), medians: [4, 6, 8, 11] },
    oldcity: { hint: "an old city of an older world: walls, a keep, crowded lanes", ground: "castle", manifold: M(0.2, 0.3, 0.02), medians: [5, 8, 11, 15] },
  },
  district: {
    cbd: { hint: "a CBD: a dense core of high-rise towers (offices, hotels, malls and flats in towers)", ground: "skyscrapers", manifold: M(0.5, 0.5, 0.1), medians: [30, 50, 80, 120, 180, 250] },
    dwelling: { hint: "a dwelling area: blocks of flats and residential towers, low houses between them, with their schools, shops and stations", ground: "residential", manifold: M(0.1, 0.4, 0.06), medians: [12, 18, 25, 35, 50, 70] },
    industrial: { hint: "an industrial area: factories, warehouses, plants and yards on large plots", ground: "industrial", manifold: M(0, 0.2, 0.02), medians: [6, 9, 12, 18, 25] },
    harbour: { hint: "a harbour or a port: docks, piers, cranes and warehouses by the water", ground: "harbour", manifold: M(0, 0.3, 0.03), medians: [6, 9, 12, 18, 25] },
    mountain: { hint: "a mountain or high hills: natural ground rising, wooded or bare", shape: "mountain", tops: [80, 200, 400, 600, 800] },
    oldtown: { hint: "an old town of an older world: a castle's keep within walls and a crowded town round it", ground: "castle", manifold: M(0.2, 0.3, 0.02), medians: [5, 8, 11, 15] },
    village: { hint: "a village of an older world: scattered low houses with gardens", ground: "village", manifold: M(0, 0.2), medians: [3, 4, 6, 8] },
    farmland: { hint: "farmland: wide fields with a few farmhouses", ground: "farm", manifold: M(0, 0.15), medians: [3, 4, 6] },
  },
  // The street level's own kinds (docs/v2/world-engine-v2.md §2.0.12, §2.0.13): the street-level land use, each built as its
  // own street form (landscape.ts STREET_TYPES) on its own manifold. A crossing is a square; an underground passage is spatial, no street.
  street: {
    shopping: { hint: "a shopping street: shops of a few storeys on both sides, signs, a tower at a corner", ground: "shopping", manifold: M(0, 0.35, 0.05), medians: [6, 9, 12, 18, 25] },
    centre: { hint: "a modern commercial centre: a mall podium with towers over it, a plaza with screens, wide roads round it", ground: "centre", manifold: M(0.4, 0.6, 0.1), medians: [12, 20, 30, 45, 70, 100] },
    avenue: { hint: "an avenue: a wide road lined with offices and towers", ground: "avenue", manifold: M(0.1, 0.5, 0.08), medians: [20, 35, 50, 80, 120] },
    square: { hint: "a square or a crossing: open ground with buildings round it", ground: "square", manifold: M(0, 0.3, 0.03), medians: [6, 10, 15, 25, 40] },
    station: { hint: "a station front: the station, a plaza, bus stops, shops round it", ground: "station", manifold: M(0.3, 0.4, 0.05), medians: [10, 15, 25, 40, 60] },
    alley: { hint: "an alley or a lane: narrow, low and dense", ground: "alley", manifold: M(0, 0.2), medians: [3, 5, 7, 10] },
    residential: { hint: "a residential street: blocks of flats along it, a few houses between them", ground: "terrace", manifold: M(0, 0.35, 0.05), medians: [9, 12, 18, 25, 35, 50] },
    waterfront: { hint: "a waterfront or a bridge: water, a deck, warehouses and walks by it", ground: "waterfront", manifold: M(0, 0.3), medians: [4, 6, 10, 15] },
    park: { hint: "a park or an amusement park: lawns, gardens, rides, with a few pavilions", ground: "park", manifold: M(0, 0.4, 0.02), medians: [3, 5, 8, 12, 20] },
    stadium: { hint: "a stadium or a sports ground: a bowl with parking and a few halls round it", ground: "stadium", manifold: M(0, 0.2), medians: [15, 25, 35, 50] },
  },
};
/**
 * Which kinds of a level a part may adjoin (docs/v2/world-engine-v2.md §2.0.15, §2.0.20): a first map at the street level,
 * each level's to be worked out later. Either side may name the other. Adjoining is touching, not lying over: a box mostly
 * over a compatible kept place is asked again, and compatible parts still overlapping are moved beside each other by the
 * export. What lies below the street (a cut, a basin, a part answered underground) lies under anything; a square, a park,
 * a stadium adjoin nothing else of their level.
 */
export const OVERLAPS: Record<string, string[]> = {
  avenue: ["shopping", "station", "alley", "waterfront", "platform", "ramp"],
  shopping: ["alley", "centre"],
  centre: ["platform"],
  station: ["platform", "ramp"],
  alley: ["residential"],
};
const BELOW = new Set(["cut", "basin"]);
/** Whether two parts of one level may overlap, by their kinds (a part below the street, `below`, overlaps any). */
export const mayOverlap = (a: string | null | undefined, b: string | null | undefined, below = false): boolean =>
  below || BELOW.has(a ?? "") || BELOW.has(b ?? "") || !!(a && b && (OVERLAPS[a]?.includes(b) || OVERLAPS[b]?.includes(a)));
/** The heights a basic shape may rise to (metres). */
const SHAPE_TOPS = [3, 6, 12, 25, 50, 100];
/**
 * Floating objects (docs/v2/borrow-and-spawn.md §8.9; the user's idea): a platform, a sphere, a ring, a cavern neither stands
 * on the ground nor fills a manifold. Each is asked twice: how far it is from the ground (its underside above the street;
 * under it, how deep its top lies), and how thick it is. None of them takes part in a manifold's average or in unification.
 */
export const FLOATING = new Set(["platform", "sphere", "donut", "cut"]);
const ELEVATIONS = [0, 3, 6, 12, 25, 50, 100], THICKNESSES = [1, 3, 6, 12, 25, 50];
/** A floating object's thickness slices, each said as what it would be. */
export const terrainThickness = (): { letter: string; y: number; said: string }[] =>
  THICKNESSES.map((y, k) => ({ letter: "ABCDEFGHIJKLMN"[k], y, said: y <= 1 ? "a deck" : y <= 3 ? "a floor" : y <= 6 ? "two floors" : `about ${Math.round(y / 3)} floors` }));
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
 * Below the street, every part may lie (the user's call, 2026-10-31: the underground is sliced and offered too): the
 * ground stays at 0, and a part answered below it is underground (an underground passage, a mall under the street), its
 * floors that deep; the engine builds it as a hall there (underground.ts) and leaves its surface open.
 */
export const UNDERGROUND: [number, string][] = [[-60, "deep underground"], [-30, "a deep hall"], [-12, "the subway's level"], [-6, "just under the street"]];
/**
 * The question's slices for a part of a kind: the underground's, then a built kind's medians (the median roof: the engine
 * draws the spread from its manifold), or natural ground's or a shape's tops; each said in floors, or as natural ground.
 */
export function terrainHeights(scale: string, kind: string, average?: { factor: number; underground?: boolean }): { measure: "median" | "top" | "average" | "elevation"; slices: { letter: string; y: number; said: string; offset?: number }[]; standard?: number } {
  const entry = terrainKind(scale, kind), median = !!entry?.ground && !!entry.medians;
  // A floating object is asked first how far it is from the ground (then its thickness: terrainThickness).
  if (!entry && FLOATING.has(kind))
    return { measure: "elevation", slices: [...UNDERGROUND.map(([y, under]): [number, string] => [y, `underground: its top ${-y} m down, ${under}`]), ...ELEVATIONS.map((y): [number, string] => [y, y === 0 ? "on the ground" : `its underside about ${Math.max(1, Math.round(y / 3))} floors up`])].map(([y, said], k) => ({ letter: "ABCDEFGHIJKLMN"[k], y, said })) };
  // As averages (docs/v2/borrow-and-spawn.md §8.9; `factor`: the kind's manifold's average over its median), the kind's
  // least average its minimum, a hard gate (the user, 2026-11-01): no slice below it. Under the street only where an area of
  // the level may lie there (`underground`: a passage at the street level, not a city or a district). Each slice keeps its
  // addition to the minimum (`offset`), for the question asked as one (the height probe).
  if (average && median) {
    const ys = entry!.medians!.map((m) => Math.round(m * average.factor)), standard = ys[0];
    const slices = [...(average.underground === false ? [] : UNDERGROUND).map(([y, under]) => ({ y, offset: y, said: `underground: ${under}` })), ...ys.map((y) => ({ y, offset: y - standard, said: `about ${Math.max(1, Math.round(y / 3))} floors on average` }))];
    return { measure: "average", standard, slices: slices.map((slice, k) => ({ letter: "ABCDEFGHIJKLMN"[k], ...slice })) };
  }
  const heights = median ? entry!.medians! : entry?.tops ?? SHAPE_TOPS;
  const said = (y: number) => (median ? `about ${Math.max(1, Math.round(y / 3))} floors` : natural(y));
  return { measure: median ? "median" : "top", slices: [...UNDERGROUND.map(([y, under]): [number, string] => [y, `underground: ${under}`]), ...heights.map((y): [number, string] => [y, said(y)])].map(([y, words], k) => ({ letter: "ABCDEFGHIJKLMN"[k], y, said: words })) };
}
/** A part's options: its level's kinds (each with its manifold in words), then the basic shapes. */
export const terrainKinds = (scale: string, shapes: Record<string, string>): Record<string, string> => ({ ...Object.fromEntries(Object.entries(levelOf(scale)).map(([kind, entry]) => [kind, entry.manifold ? `${entry.hint}. Its heights: ${manifoldWords(entry.manifold)}` : entry.hint])), ...shapes });
/** The part's own sentences (as many as the old evidence gave): what is asked about. */
const ownText = (focus: PartFocus, stores: TerrainStores) => { const own = stores.own(focus.part.id); return own.length ? own : stores.naming(focus.part.label).filter((sentence) => sentence.text.length >= focus.part.label.length + 6); };
const fixed = (name: string, key: string, of: (focus: never) => Record<string, unknown>): Source<never, TerrainStores> => ({ name, key, quota: 0, keep: true, collect: (focus) => Object.entries(of(focus)).map(([id, fields]) => ({ id, score: 1, fields })) });

/** The question a mode asks of a place's scenes: their words for it (the language profile's). */
type Asked = keyof typeof LANGUAGE.questionWords;
/** How well a scene answers the question about the part: its mentions, the question's words beside them, the rest a little. */
function sceneScore(scene: TerrainStores["scenes"][number], focus: PartFocus, own: Set<string>, asked: Asked, setIn: boolean): number {
  const words = LANGUAGE.questionWords[asked], count = (text: string) => text.match(words)?.length ?? 0;
  const naming = scene.lines.flatMap((line, n) => (line.text.includes(focus.part.label) || own.has(line.id) ? [n] : []));
  const beside = new Set(naming.flatMap((n) => [n - 1, n, n + 1]).filter((n) => n >= 0 && n < scene.lines.length));
  return (own.size && naming.some((n) => own.has(scene.lines[n].id)) ? 100 : 0) + (setIn ? 20 : 0) + 2 * naming.length + 3 * [...beside].reduce((sum, n) => sum + count(scene.lines[n].text), 0) + 0.05 * count(scene.text);
}

function sources<F extends PartFocus>(asked: Asked): Source<F, TerrainStores>[] {
  return [
    fixed("part", "part", (focus: F) => ({ name: focus.part.label, scale: focus.part.scale, in: focus.holder.label, ...(focus.holder.id !== focus.city.id ? { city: focus.city.label } : {}), ...(focus.kind ? { ground: focus.kind } : {}) })) as Source<F, TerrainStores>,
    fixed("within", "within", (focus: F) => focus.within ?? {}) as Source<F, TerrainStores>,
    {
      // It picks its own five scenes and fifteen sentences: kept as given (a scaled quota would drop a scene after the
      // fifteen were shared), and small enough never to need cutting.
      name: "scenes", key: "scenes", quota: SCENES, keep: true,
      // The five scenes that best answer the question, and from them only the sentences around the place's exact name
      // (the user's call, 2026-11-01), fifteen in all, each scene's in reading order with a break where they skip.
      collect: (focus, stores) => {
        const own = new Set(stores.own(focus.part.id).map((sentence) => sentence.id)), names = (line: { id: string; text: string }) => line.text.includes(focus.part.label) || own.has(line.id);
        const best = stores.scenes.flatMap((scene) => {
          const mentions = scene.lines.flatMap((line, n) => (names(line) ? [n] : []));
          return mentions.length ? [{ scene, mentions, score: Math.round(sceneScore(scene, focus, own, asked, !!scene.setting && stores.inside(scene.setting, focus.part.id)) * 100) / 100 }] : [];
        }).sort((a, b) => b.score - a.score).slice(0, SCENES);
        // Shared fairly: each scene's first mention with a sentence either side, best scene first, then its second
        // mentions so, then wider rings round every mention; a place named often never fills the fifteen with its first scene.
        const order = best.flatMap(({ scene, mentions }, k) => mentions.flatMap((n, i) => Array.from({ length: Math.max(n, scene.lines.length - 1 - n) + 1 }, (_, ring) => ring).flatMap((ring) =>
          (ring ? [n - ring, n + ring] : [n]).filter((at) => at >= 0 && at < scene.lines.length).map((at) => ({ k, at, key: [ring <= 1 ? 0 : ring, ring <= 1 ? i : 0, ring <= 1 ? k : i, ring <= 1 ? ring : k] })))))
          .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2] - b.key[2] || a.key[3] - b.key[3]);
        const taken = best.map(() => new Set<number>());
        let count = 0;
        for (const { k, at } of order) { if (count >= SENTENCES) break; if (!taken[k].has(at)) { taken[k].add(at); count++; } }
        return best.flatMap(({ scene, score }, k) => (taken[k].size ? [{ id: scene.id, score, fields: [...taken[k]].sort((a, b) => a - b).map((at, i, all) => (i && at > all[i - 1] + 1 ? "……" : "") + scene.lines[at].text).join("") }] : []));
      },
    },
    // The facts the graph holds about the place itself (none: none given).
    { name: "facts", key: "facts", quota: 6, collect: async (focus, stores) => (stores.graph ? await stores.graph.factsOf(focus.part.id, 20) : []).flatMap(({ id }, n) => { const fact = stores.fact(id); return fact ? [{ id, score: 1 - n / 100, fields: clip(fact.text, 200) }] : []; }) },
    // The surroundings of the scenes set in it, or naming it (none: none given).
    { name: "environment", key: "environment", quota: 5, collect: (focus, stores) => stores.cards.filter((card) => (card.setting && stores.inside(card.setting, focus.part.id)) || card.text.includes(focus.part.label)).map((card, n) => ({ id: card.id, score: 1 - n / 1000, fields: clip(card.text, 200) })) },
    // What the tree holds in it (none: none given).
    { name: "standing", key: "standing", quota: 20, collect: (focus, stores) => stores.standing(focus.part.id).map((slot, n) => ({ id: slot.label, score: 1 - n / 1000, fields: `a ${slot.kind}` })) },
  ];
}

const probe = (focus: PartFocus, stores: TerrainStores) => ({ own: 1 - Math.min(1, ownText(focus, stores).length / 6) });
const box = (focus: PartFocus): DecisionQuestion => ({ key: "box", primitive: "box", instructions: `Box where ${focus.part.label} lies on picture "map", as large as its ground is.` });

export const terrainGroundMode: Mode<GroundFocus, TerrainStores> = {
  name: "terrain-ground",
  task: (focus) => `${focus.part.scale === "city" ? `What kind of city is ${focus.part.label}?` : focus.sampled ? `What kind of ${focus.part.scale} is ${focus.part.label}? The text gives it no name of its own; it stands where sampling put it, in ${focus.holder.label}.` : `What kind of ${focus.part.scale} is ${focus.part.label}, in ${focus.city.label}?`} Terrain only: a kind of ${focus.part.scale} (each with its manifold: how its heights spread; the engine fills in its buildings) or a basic shape, never a building. Read it from the scenes it is in, as the text tells them, the most telling first (scenes); where given, the facts about it (facts), its surroundings (environment) and what stands in it (standing); and the terrain kept for the places holding it (within). Where the text says little of it or you are unsure, use common sense: what anyone knows of a real place (a world city's centre stands tall), and what a place of its kind usually is.`,
  // The options are the part's level's kinds (TERRAIN_KINDS, each with its manifold), composed with the evidence.
  sources: [...sources<GroundFocus>("ground"), fixed("kinds", "kinds", (focus: GroundFocus) => terrainKinds(focus.part.scale, focus.shapes)) as Source<GroundFocus, TerrainStores>, fixed("pictures", "pictures", (focus: GroundFocus) => focus.pictures) as Source<GroundFocus, TerrainStores>],
  cutOrder: ["environment", "standing", "facts"],
  probe,
  // Its kind only (docs/v2/world-engine-v2.md §2.0.21): where an area lies and how large it is are the program's (its pins,
  // its ties, free ground); a city is the map itself.
  questions: (focus, kept) => [{ key: "kind", primitive: "choice", instructions: `What kind of ${focus.part.scale} is ${focus.part.label} (the kinds are in kinds)?`, options: kept.kinds.map((item) => item.id), optionHints: Object.fromEntries(kept.kinds.map((item) => [item.id, String(item.fields)])) }],
  budget: BUDGET,
};

/**
 * Where a pool's member lies and how large it is (docs/v2/world-engine-v2.md §2.0.13): asked between its kind and its
 * height, on a map of its pool close up (where sampling put it, a grey pin; the members already kept outlined in white;
 * a pin is a point, never a size), with what the text says of it and of the places holding it.
 */
export interface AreaFocus extends PartFocus { kind: string; district?: string; tied?: string[] }
export const terrainAreaMode: Mode<AreaFocus, TerrainStores> = {
  name: "terrain-area",
  // The pin is a suggestion (the user's call, §2.0.15): where continuity would put it; Jev may box it anywhere in its district.
  task: (focus) => `Where does ${focus.part.label} (${focus.kind}) lie in ${focus.district ?? focus.holder.label}, and how large is it? The text gives it no name of its own. The grey pin is only a suggestion, a point and not a size: where the characters going between it and the places it is tied to would put it${focus.tied?.length ? ` (${focus.tied.join(", ")})` : ""}. Put it anywhere in ${focus.district ?? focus.holder.label} that suits what it is (an airfield is not in the middle of towers). Box its ground on picture "map": where it lies and as large as it is, from what the text says of it (text) and of the places around it (standing, facts, environment), and the terrain kept for the places holding it (within). Where the text says little of it or you are unsure, use common sense: what anyone knows of a real place (a world city's centre stands tall), and what a place of its kind usually is.`,
  sources: [...sources<AreaFocus>("where"), fixed("pictures", "pictures", (focus: AreaFocus) => focus.pictures) as Source<AreaFocus, TerrainStores>],
  cutOrder: ["environment", "standing", "facts"],
  probe,
  questions: (focus) => [box(focus)],
  budget: BUDGET,
};

export const terrainZoomMode: Mode<ZoomFocus, TerrainStores> = {
  name: "terrain-zoom",
  task: (focus) => `Where does ${focus.part.label} lie, closer up? The red box is the last answer: ${focus.reasons.join("; ")}.`,
  sources: [...sources<ZoomFocus>("where"), fixed("pictures", "pictures", (focus: ZoomFocus) => focus.pictures) as Source<ZoomFocus, TerrainStores>],
  cutOrder: ["environment", "standing", "facts"],
  questions: (focus) => [box(focus)],
  budget: BUDGET,
};

// How high the terrain stands (the user's calls, 2026-10-31: the ground is at 0, always; Jev gives a built kind's median,
// its manifold makes the spread): the median roof, or natural ground's top; what the text says of the part and its city says it.
export const terrainHeightMode: Mode<HeightFocus, TerrainStores> = {
  name: "terrain-height",
  task: (focus) => `${focus.measure === "average" && !focus.addition
    ? `What is the average height of ${focus.part.label}'s buildings (${focus.kind}), over all of it? Its manifold spreads them round that average (${manifoldWords(terrainKind(focus.part.scale, focus.kind)!.manifold!)}).${focus.standard !== undefined ? ` No ${focus.kind} is built lower than an average of ${focus.standard} m: that is its lowest slice.` : ""}${focus.slices.some((slice) => slice.y < 0) ? " If it lies underground (an underground passage, a mall under the street), how deep: the slices below the street." : ""}`
    : focus.measure === "average"
    ? `Every ${focus.kind} is built at least at its standard height: an average of ${focus.standard} m for its buildings. How many metres must be added to that standard for ${focus.part.label}: +0 m if it is just the standard, more if its buildings are taller on average (its manifold makes the rest: ${manifoldWords(terrainKind(focus.part.scale, focus.kind)!.manifold!)}). If it lies underground (an underground passage, a mall under the street), pick the slice below the street instead (a negative addition).`
    : focus.measure === "median"
    ? `What is the median height of ${focus.part.label}'s roofs (${focus.kind}): the height half its buildings stand below? Its manifold makes the rest (${manifoldWords(terrainKind(focus.part.scale, focus.kind)!.manifold!)}), so give the median, not the tallest. If it lies underground (an underground passage, a mall under the street), give how deep its floors lie: the slices below the street.`
    : focus.measure === "elevation"
    ? `How far is ${focus.part.label} (${focus.kind}) from the ground? It floats or is held up on its own, so give the height of its underside above the street (on the ground: 0 m); if it lies under the ground (a cavern), how deep its top lies: the slices below the street. Its thickness is asked next.`
    : focus.measure === "thickness"
    ? `How thick is ${focus.part.label} (${focus.kind}), from its underside to its top (a cavern: from its top down)? A deck is a metre or so, a sky garden a floor or two with its planting, a cavern as tall as its hall.`
    : `How high does ${focus.part.label} (${focus.kind}) rise: the height of its top? If it lies underground, how deep it goes: the slices below the street.`} The picture shows a core of its area with a lettered ghost slice at each height; red dotted lines are where a slice cuts a building the engine stands there for now. Read it from the scenes it is in, as the text tells them, the most telling first (scenes); where given, the facts about it (facts), its surroundings (environment) and what stands in it (standing); and the terrain kept for the places holding it (within). Where the text says little of it or you are unsure, use common sense: what anyone knows of a real place (a world city's centre stands tall), and what a place of its kind usually is.`,
  sources: [...sources<HeightFocus>("height"), fixed("heights", "heights", (focus: HeightFocus) => Object.fromEntries(focus.slices.map((slice) => [slice.letter, focus.addition ? `${(slice.offset ?? 0) >= 0 ? "+" : ""}${slice.offset} m${(slice.offset ?? 0) >= 0 ? ` (an average of ${slice.y} m)` : ""}: ${slice.said}` : `${slice.y} m: ${slice.said}`]))) as Source<HeightFocus, TerrainStores>, fixed("pictures", "pictures", (focus: HeightFocus) => focus.pictures) as Source<HeightFocus, TerrainStores>],
  cutOrder: ["environment", "standing", "facts"],
  probe,
  questions: (focus) => [{ key: "height", primitive: "choice", instructions: `Which lettered slice is ${focus.measure === "average" && !focus.addition ? `the average of ${focus.part.label}'s buildings` : focus.measure === "average" ? `the standard plus what must be added for ${focus.part.label}'s buildings on average` : focus.measure === "median" ? `the median of ${focus.part.label}'s roofs` : focus.measure === "elevation" ? `${focus.part.label}'s distance from the ground` : focus.measure === "thickness" ? `${focus.part.label}'s thickness` : `the top of ${focus.part.label}'s ground`}?`, options: focus.slices.map((slice) => slice.letter), optionHints: Object.fromEntries(focus.slices.map((slice) => [slice.letter, focus.addition ? `${slice.letter}: ${(slice.offset ?? 0) >= 0 ? `the standard +${slice.offset} m` : `${slice.offset} m, below the street`}, ${slice.said}` : `${slice.letter}: ${slice.y} m, ${slice.said}`])) }],
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
