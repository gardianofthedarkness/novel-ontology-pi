import { scaleOfName } from "../digger/stage/scale.js";
import { mentions, type Chart, type ChartEntity } from "./em.js";
import type { FlowCard, FlowScene } from "./flow.js";
import type { ReadingGraph } from "./readingGraph.js";
import { PLACE_SCALES } from "./typing.js";

/**
 * The place recommender (docs/v2/world-model.md §4; layer 2): code over the stores, no model call. Places are a tree graded
 * by scale, so what is asked of a place is one parent from a few larger places, or which place a description or a scene
 * means; this ranks the candidates and says why, and place EM (layer 4) takes the clear ones and asks Jev the rest, with
 * the context engine (layer 3) composing what Jev sees. The matter recommender (em.ts `recommend`) is its sibling for
 * people and things, whose relations are a graph and are ranked by other evidence.
 */
export const SCALES: readonly string[] = PLACE_SCALES;
export const rankOf = (scale: string | null | undefined) => (scale ? SCALES.indexOf(scale) : -1);
/** The graded law: a place holds only a larger one (a region may hold a region, a building a building); an unknown scale may. */
export const mayHold = (outer: string | null | undefined, inner: string | null | undefined) =>
  rankOf(outer) < 0 || rankOf(inner) < 0 || rankOf(outer) > rankOf(inner) || (outer === inner && (inner === "region" || inner === "building"));

export interface Evidence { kind: "name" | "stated" | "sentence" | "setting" | "adjacent" | "fact" | "scale"; weight: number; count: number; at?: string[] }
export interface Candidate { id: string; score: number; evidence: Evidence[] }
/** How much each kind of evidence weighs, each time it is seen (a cap on how many times counts). */
export const WEIGHTS = { name: [3, 1], stated: [2, 3], sentence: [0.5, 4], setting: [0.5, 4], adjacent: [0.25, 4], fact: [1, 3] } as const;
const NEXT_SCALE = 0.3;
/** Between two named places in a sentence: nothing, 的/之/里/中/内, or a comma: the first holds the second. */
const JOIN = /^(?:的|之|里的|内的|中的|里|内|中|，|、|\s)?$/;

export interface PlaceIndex {
  places: ChartEntity[];
  label: (id: string) => string;
  /** A place's scale as typing or its name says it (null: not said). */
  scale: Map<string, string | null>;
  scaleBy: Map<string, "typing" | "name" | null>;
  /** The sentences that name each place. */
  sentencesOf: Map<string, string[]>;
  /** child → parent → the sentences stating it (X的Y), and child → the places its own name holds. */
  stated: Map<string, Map<string, string[]>>;
  contained: Map<string, Set<string>>;
  /** Two places named in one sentence (not one right after the other), keyed a|b. */
  together: Map<string, string[]>;
  /** Per scene: the places its cards name, how often, in its environment and its action cards. */
  sceneNames: Map<string, Map<string, { any: number; environment: number; action: number }>>;
  sceneOf: Map<string, string>;
}

export function placeIndex(input: { chart: Chart; scenes: FlowScene[]; cards: FlowCard[]; sentences: { id: string; text: string }[] }): PlaceIndex {
  const places = [...input.chart.entities.values()].filter((entity) => entity.category === "place");
  const ids = new Set(places.map((place) => place.id));
  const label = (id: string) => input.chart.entities.get(id)?.proper[0] ?? input.chart.entities.get(id)?.names[0] ?? id;
  const scale = new Map<string, string | null>(), scaleBy = new Map<string, "typing" | "name" | null>();
  for (const place of places) {
    if (SCALES.includes(place.type)) { scale.set(place.id, place.type); scaleBy.set(place.id, "typing"); continue; }
    const named = scaleOfName(label(place.id));
    scale.set(place.id, named && SCALES.includes(named) ? named : null); scaleBy.set(place.id, named && SCALES.includes(named) ? "name" : null);
  }
  const contained = new Map<string, Set<string>>();
  for (const outer of places) for (const inner of places) if (outer !== inner && inner.names.some((a) => outer.names.some((b) => b.length >= 2 && a !== b && a.includes(b)))) contained.set(inner.id, (contained.get(inner.id) ?? new Set()).add(outer.id));
  const names = places.flatMap((place) => place.names.map((name): [string, string] => [name, place.id])).sort((a, b) => b[0].length - a[0].length);
  const sentencesOf = new Map<string, string[]>(), stated = new Map<string, Map<string, string[]>>(), together = new Map<string, string[]>();
  const push = <K>(map: Map<K, string[]>, key: K, sentence: string) => { const list = map.get(key) ?? []; if (!list.includes(sentence)) list.push(sentence); map.set(key, list); };
  for (const sentence of input.sentences) {
    const hits = mentions(sentence.text, names);
    for (const hit of hits) push(sentencesOf, hit.id, sentence.id);
    const right = new Set<string>();
    for (let k = 1; k < hits.length; k++) if (hits[k - 1].id !== hits[k].id && JOIN.test(sentence.text.slice(hits[k - 1].at + hits[k - 1].name.length, hits[k].at))) {
      const of = stated.get(hits[k].id) ?? new Map<string, string[]>(); push(of, hits[k - 1].id, sentence.id); stated.set(hits[k].id, of);
      right.add(`${hits[k - 1].id}|${hits[k].id}`).add(`${hits[k].id}|${hits[k - 1].id}`);
    }
    const seen = [...new Set(hits.map((hit) => hit.id))];
    for (const a of seen) for (const b of seen) if (a < b && !right.has(`${a}|${b}`)) { push(together, `${a}|${b}`, sentence.id); }
  }
  const sceneOf = new Map(input.scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene.id] as const)));
  const sceneNames = new Map<string, Map<string, { any: number; environment: number; action: number }>>();
  for (const card of input.cards) {
    const scene = sceneOf.get(card.first);
    if (!scene) continue;
    const of = sceneNames.get(scene) ?? new Map(), hit = new Set([...card.entities.map((entry) => entry.id), ...card.people.map((person) => person.id)].filter((id) => ids.has(id)));
    for (const id of hit) { const count = of.get(id) ?? { any: 0, environment: 0, action: 0 }; count.any++; if (card.kind === "environment") count.environment++; if (card.kind === "action") count.action++; of.set(id, count); }
    sceneNames.set(scene, of);
  }
  return { places, label, scale, scaleBy, sentencesOf, stated, contained, together, sceneNames, sceneOf };
}

const capped = (kind: keyof typeof WEIGHTS, count: number, at?: string[]): Evidence | null => (count > 0 ? { kind, weight: Number((WEIGHTS[kind][0] * Math.min(count, WEIGHTS[kind][1])).toFixed(3)), count, ...(at?.length ? { at: at.slice(0, 4) } : {}) } : null);

/**
 * The parents a named place may have: every larger place with any evidence, best first, each with why. A place of the same
 * scale is a candidate only on the text's own word (its name holds the other's, or the text states it right before:
 * 东京都，东京西部的学园都市, both typed cities): the text outranks typing there, and the tree raises the parent after. A
 * smaller place never is.
 */
export async function recommendParents(index: PlaceIndex, id: string, graph?: ReadingGraph | null): Promise<Candidate[]> {
  const own = index.scale.get(id) ?? null, out: Candidate[] = [];
  for (const other of index.places) {
    if (other.id === id || rankOf(index.scale.get(other.id)) >= 0 && rankOf(own) >= 0 && rankOf(index.scale.get(other.id)) < rankOf(own)) continue;
    const graded = mayHold(index.scale.get(other.id), own), worded = index.contained.get(id)?.has(other.id) || (index.stated.get(id)?.get(other.id)?.length ?? 0) > 0;
    if (!graded && !worded) continue;
    const pair = id < other.id ? `${id}|${other.id}` : `${other.id}|${id}`;
    const stated = index.stated.get(id)?.get(other.id) ?? [];
    const evidence = [
      index.contained.get(id)?.has(other.id) ? capped("name", 1) : null,
      capped("stated", stated.length, stated),
      capped("sentence", (index.together.get(pair) ?? []).length, index.together.get(pair)),
      ...(graph ? [capped("setting", await graph.sharedSettings(id, other.id)), capped("adjacent", await graph.adjacentScenes(id, other.id)), (async () => { const facts = await graph.factsAboutBoth(id, other.id, 8); return capped("fact", facts.length, facts); })()] : []),
    ];
    let found = (await Promise.all(evidence)).filter((entry): entry is Evidence => !!entry);
    if (!found.length) continue;
    // Weak evidence (talk, nearness, facts) counts half for a place three levels up or more (a school and its country).
    if (rankOf(index.scale.get(other.id)) - rankOf(own) >= 3 && rankOf(own) >= 0) found = found.map((entry) => (entry.kind === "name" || entry.kind === "stated" ? entry : { ...entry, weight: Number((entry.weight / 2).toFixed(3)) }));
    if (rankOf(index.scale.get(other.id)) === rankOf(own) + 1 && rankOf(own) >= 0) found.push({ kind: "scale", weight: NEXT_SCALE, count: 1 });
    out.push({ id: other.id, score: Number(found.reduce((sum, entry) => sum + entry.weight, 0).toFixed(3)), evidence: found });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}

/** With no evidence for any parent: the larger places, the next scale up first, then the most named. */
export function fallbackParents(index: PlaceIndex, id: string, top = 6): Candidate[] {
  const own = rankOf(index.scale.get(id));
  return index.places.filter((other) => other.id !== id && mayHold(index.scale.get(other.id), index.scale.get(id)))
    .sort((a, b) => Math.abs(rankOf(index.scale.get(a.id)) - own - 1) - Math.abs(rankOf(index.scale.get(b.id)) - own - 1) || (index.sentencesOf.get(b.id)?.length ?? 0) - (index.sentencesOf.get(a.id)?.length ?? 0) || a.id.localeCompare(b.id))
    .slice(0, top).map((other) => ({ id: other.id, score: 0, evidence: [] }));
}

/** A scene's setting by tiers: the places its environment cards name, its action cards, any card (each with how often). */
export function settingTiers(index: PlaceIndex, scene: string): { environment: [string, number][]; action: [string, number][]; any: [string, number][] } {
  const of = [...(index.sceneNames.get(scene) ?? new Map<string, { any: number; environment: number; action: number }>())];
  const tier = (key: "any" | "environment" | "action") => of.filter(([, count]) => count[key] > 0).map(([id, count]): [string, number] => [id, count[key]]);
  return { environment: tier("environment"), action: tier("action"), any: tier("any") };
}

/**
 * What a description of a place may mean, if a named place (这座城市, 学区): the named places on the scene's address (its
 * setting and the places holding it) whose scale fits, a place its own words name, and what the same words have meant
 * before (a habit). Best first; empty when none fits.
 */
export function describedCandidates(index: PlaceIndex, description: { text: string; scale: string | null }, address: string[], habits: Map<string, string[]>): Candidate[] {
  const names = index.places.flatMap((place) => place.names.map((name): [string, string] => [name, place.id])).sort((a, b) => b[0].length - a[0].length);
  const inWords = new Set(mentions(description.text, names).map((hit) => hit.id)), before = habits.get(description.text) ?? [];
  const fits = (id: string) => rankOf(description.scale) < 0 || rankOf(index.scale.get(id)) < 0 || Math.abs(rankOf(index.scale.get(id)) - rankOf(description.scale)) <= 1;
  const out: Candidate[] = [];
  for (const id of new Set([...address, ...inWords, ...before])) {
    if (!fits(id)) continue;
    const evidence: Evidence[] = [
      ...(address.includes(id) ? [{ kind: "setting" as const, weight: 1, count: 1 }] : []),
      ...(inWords.has(id) ? [{ kind: "name" as const, weight: 3, count: 1 }] : []),
      ...(before.includes(id) ? [{ kind: "stated" as const, weight: 2, count: before.filter((entry) => entry === id).length }] : []),
      ...(rankOf(index.scale.get(id)) === rankOf(description.scale) ? [{ kind: "scale" as const, weight: 0.5, count: 1 }] : []),
    ];
    out.push({ id, score: Number(evidence.reduce((sum, entry) => sum + entry.weight, 0).toFixed(3)), evidence });
  }
  return out.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
}
