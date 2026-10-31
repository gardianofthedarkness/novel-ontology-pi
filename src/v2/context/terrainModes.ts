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
export interface PartFocus { part: TerrainPart; holder: { id: string; label: string }; city: { id: string; label: string }; pictures: Record<string, string>; kind?: string }
export interface GroundFocus extends PartFocus { kinds: Record<string, string> }
export interface ZoomFocus extends PartFocus { kind: string; reasons: string[] }
export interface HeightFocus extends PartFocus { kind: string; levels: { letter: string; y: number; said: string }[] }
export interface MemberFocus { city: { id: string; label: string }; parts: { key: string; label: string; scale: string }[] }

const clip = (text: string, size: number) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
const BUDGET = 9000;
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
  task: (focus) => `Where does ${focus.part.label} lie in ${focus.city.label}, and what is its ground? Terrain only: a manifold (a landscape type; the engine fills in its buildings) or a basic shape of ground, never a building. Read its ground from what the text says of it and of the places around it: what stands there (standing), the facts (facts), the surroundings of its scenes (environment).`,
  sources: [...sources<GroundFocus>({ standing: true, facts: true, environment: "city" }), fixed("kinds", "kinds", (focus: GroundFocus) => focus.kinds) as Source<GroundFocus, TerrainStores>, fixed("pictures", "pictures", (focus: GroundFocus) => focus.pictures) as Source<GroundFocus, TerrainStores>],
  cutOrder: ["environment", "facts", "standing", "text"],
  probe,
  questions: (focus) => [box(focus), { key: "kind", primitive: "choice", instructions: `What is ${focus.part.label}'s ground (the kinds are in kinds)?`, options: Object.keys(focus.kinds), optionHints: focus.kinds }],
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

export const terrainHeightMode: Mode<HeightFocus, TerrainStores> = {
  name: "terrain-height",
  task: (focus) => `At what height is ${focus.part.label}'s ground (${focus.kind})? The picture shows a core of its area with a lettered ghost slice at each height the world has; red dotted lines are where a slice cuts a building.`,
  sources: [...sources<HeightFocus>({ environment: "part" }), fixed("heights", "heights", (focus: HeightFocus) => Object.fromEntries(focus.levels.map((level) => [level.letter, `${level.y} m: ${level.said}`]))) as Source<HeightFocus, TerrainStores>, fixed("pictures", "pictures", (focus: HeightFocus) => focus.pictures) as Source<HeightFocus, TerrainStores>],
  cutOrder: ["environment", "text"],
  questions: (focus) => [{ key: "height", primitive: "choice", instructions: `Which lettered slice is the height of ${focus.part.label}'s ground?`, options: focus.levels.map((level) => level.letter), optionHints: Object.fromEntries(focus.levels.map((level) => [level.letter, `${level.letter}: ${level.y} m, ${level.said}`])) }],
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
