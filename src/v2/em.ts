import type { Sentence } from "../digger/intake/sectioning.js";
import { ask } from "./context/engine.js";
import { emMode, ownersMode } from "./context/readingModes.js";
import { factEvidence, FACT_RECENT, type FactLedger } from "./facts.js";
import type { Category, Decide, Detected, EntityType } from "./typing.js";

/**
 * Unified EM (the user's v2 flow, 2026-10-30): who or what each detected string is, one mechanism a category. The chart is
 * every entity so far with every name it goes by, and its smallest unit is the sentence: each entity keeps the sentences it
 * appears in.
 * 1. A time goes to the times (EM for times is the calendar's, later).
 * 2. Any other string that is a name already in the chart (any category: the whole chart) is that entity. Not new; the
 *    sentences that hold it are recorded as its appearances. System 0: string match, no model. Only proper names are names
 *    of the chart (typing asks). A place with no name of its own ("屋顶", "车站", "街上") is a description, as a person's
 *    is: EM² says which place it is where it stands (a named place of the scene, or an unnamed one of the scene) and
 *    which place holds it (places.ts makes the place tree from that). A thing is an entity only when it has a
 *    name of its own (the user's rule, 2026-10-30: only important named things, vehicles and weapons): an unnamed vehicle
 *    or weapon ("那辆车", "手枪") is a description EM² places in its scene, as a person's is; an everyday thing ("手机",
 *    "清扫机器人", or an object with no name) is routine, never an entity. A description of a person
 *    ("少女", "那个刺猬头", "姐姐大人") is no one's name at all: it is kept as a description, and EM² (roles.ts) says who it
 *    means each time it stands (a description that became a person of its own drew every later use of it to that person).
 *    A crowd ("警备员们", "人群") is never a name either: EM² places it in its scene.
 * 3. Otherwise the recommender scores the chart's entities of the string's category: by how near before it, and how often,
 *    each appears (and by the names they share), the best three; and the facts (facts.ts, the source of truth): the latest
 *    ones about each candidate, and the latest ones that hold the string itself.
 * A concept (an ability, a power, a network, a plan: 幻想杀手, 御坂网络) is an entity when the story names it, and it can be
 * someone's (the user's call, 2026-10-30): a concept of the batch with no owner yet is asked whose it is, one request a
 * batch (the people the passage names, many people or a group, or no one's), and keeps its owners with the sentence each
 * was said from. A fact about a concept is about its owner too (facts.ts).
 * 4. Jev decides, one structured request per group of strings (groups of a batch in parallel): the batch's sentences, the
 *    strings, their candidates and the facts, keyed once; each string chooses a candidate, another string of the batch
 *    (two new names of one person born together), or new. Below EM_ACCEPT it is new, with its best candidate kept for the
 *    world engine's second EM (two entities whose boxes are the same).
 */
export const EM_ACCEPT = 0.6;
/** Recommender: how far back (sentences) nearness counts, how many candidates a string gets. */
export const EM_WINDOW = 80, EM_TOP = 3;
/** Strings a Jev request decides (each with up to three candidates and their facts). */
export const EM_GROUP = 16;

/** Whose a concept is: a person, or `many` (many people share it, or a group runs it); from the sentence it was said in. */
export interface Owner { id: string; from: string; confidence: number }
/** `names`: every name EM gave it; `proper`: the ones that are its names anywhere (exact match, the card scan); `owners`: a concept's. */
export interface ChartEntity { id: string; category: Category; type: EntityType; names: string[]; proper: string[]; first: string; seen: string[]; owners?: Owner[] }
export interface TimeNode { id: string; text: string; seen: string[] }
export interface EmResult {
  key: string; text: string; type: EntityType; category: Category | null;
  outcome: "exact" | "alias" | "new" | "time" | "description" | "routine" | "spatial" | "skip";
  entity?: string; confidence?: number; candidates?: { id: string; score: number }[]; answer?: string; unsure?: string;
  /** description: the sentences that hold it (EM² resolves each); spatial: the sentences it says where someone is in. */
  sentences?: string[];
  /** The facts Jev was given for it (fact ids). */
  facts?: string[];
  /** A concept: whose it is, as asked in this batch (a person, many, or none). */
  owner?: { answer: string; confidence: number };
}

/** Ids as the canon's (the chart is the ontology's identity: a v2 workspace's entities are these). */
const PREFIX: Record<Category, string> = { person: "char_", crowd: "crowd_", thing: "item_", place: "loc_", concept: "concept_", time: "time_" };
/** A proper name (typing's answer, at even odds or better). */
const isProper = (detected: Detected) => (detected.proper ?? 1) >= 0.5;

export class Chart {
  readonly entities = new Map<string, ChartEntity>();
  readonly times = new Map<string, TimeNode>();
  private readonly byName = new Map<string, string>();
  private readonly count: Record<Category, number> = { person: 0, crowd: 0, thing: 0, place: 0, concept: 0, time: 0 };

  exact(text: string): ChartEntity | undefined {
    const id = this.byName.get(text);
    return id ? this.entities.get(id) : undefined;
  }

  /**
   * An entity moved to another category (its typings settled on it once EM is done): the same names and appearances under
   * an id of the new category. Returns the new id.
   */
  recategorize(id: string, category: Exclude<Category, "time" | "crowd">, type: EntityType): string {
    const old = this.entities.get(id)!, fresh = `${PREFIX[category]}${String(++this.count[category]).padStart(6, "0")}`;
    this.entities.delete(id);
    this.entities.set(fresh, { ...old, id: fresh, category, type });
    for (const [name, at] of this.byName) if (at === id) this.byName.set(name, fresh);
    return fresh;
  }

  mint(category: Exclude<Category, "time" | "crowd">, type: EntityType, text: string, sentences: string[], proper = true): ChartEntity {
    const id = `${PREFIX[category]}${String(++this.count[category]).padStart(6, "0")}`;
    const entity: ChartEntity = { id, category, type, names: [], proper: [], first: sentences[0] ?? "", seen: [] };
    this.entities.set(id, entity);
    this.name(id, text, proper);
    this.see(id, sentences);
    return entity;
  }

  name(id: string, text: string, proper = true): void {
    const entity = this.entities.get(id)!;
    if (!entity.names.includes(text)) entity.names.push(text);
    if (!proper || this.byName.has(text)) return;
    this.byName.set(text, id);
    entity.proper.push(text);
  }

  see(id: string, sentences: string[]): void {
    const entity = this.entities.get(id)!;
    for (const sentence of sentences) if (!entity.seen.includes(sentence)) entity.seen.push(sentence);
  }

  time(text: string, sentences: string[]): TimeNode {
    const node = this.times.get(text) ?? { id: `${PREFIX.time}${String(++this.count.time).padStart(6, "0")}`, text, seen: [] };
    this.times.set(text, node);
    for (const sentence of sentences) if (!node.seen.includes(sentence)) node.seen.push(sentence);
    return node;
  }

  /** Every name and its entity, longest first (for scanning: a longer name masks the shorter ones inside it). */
  names(): [string, string][] {
    return [...this.byName].sort((a, b) => b[0].length - a[0].length);
  }
}

/** The names a text holds, longest first, each stretch of text counted once (System 0). */
export function mentions(text: string, names: [string, string][]): { name: string; id: string; at: number }[] {
  const taken = new Array<boolean>(text.length).fill(false), found: { name: string; id: string; at: number }[] = [];
  for (const [name, id] of names) {
    for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + name.length)) {
      if (taken.slice(at, at + name.length).some(Boolean)) continue;
      taken.fill(true, at, at + name.length);
      found.push({ name, id, at });
    }
  }
  return found.sort((a, b) => a.at - b.at);
}

/** How much two names share: the characters of the shorter found in the longer, over the shorter's length. */
export function nameOverlap(a: string, b: string): number {
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (!short.length) return 0;
  if (long.includes(short)) return 1;
  return [...short].filter((char) => long.includes(char)).length / short.length;
}

/** The recommender: the chart's entities of the string's category, scored by nearness and frequency before it, and shared names. */
export function recommend(chart: Chart, detected: Detected, position: (sentence: string) => number, top = EM_TOP): { id: string; score: number }[] {
  const at = position(detected.sentences[0] ?? "");
  const scored: { id: string; score: number }[] = [];
  for (const entity of chart.entities.values()) {
    if (entity.category !== detected.category) continue;
    let near = 0;
    for (const sentence of entity.seen) { const distance = at - position(sentence); if (distance >= 0 && distance <= EM_WINDOW) near += 1 / (1 + distance / 10); }
    const named = Math.max(0, ...entity.names.map((name) => nameOverlap(name, detected.text)));
    const score = near + 0.1 * Math.log(1 + entity.seen.length) + 2 * (named >= 0.5 ? named : 0);
    if (score > 0.05) scored.push({ id: entity.id, score: Number(score.toFixed(3)) });
  }
  return scored.sort((a, b) => b.score - a.score).slice(0, top);
}

/** The concepts' owners and the people as a request names them. */
const label = (chart: Chart, id: string) => id === "many" ? "many people, or a group" : chart.entities.get(id)?.proper[0] ?? chart.entities.get(id)?.names[0] ?? id;
const describe = (entity: ChartEntity, chart?: Chart) => entity.names.slice(0, 4).join(" / ") + (chart && entity.owners?.length ? ` (${label(chart, entity.owners[entity.owners.length - 1].id)}'s)` : "");
/** People a concept's owner question offers (the ones the passage names, and the concept's owner so far). */
export const OWNER_PEOPLE = 12;

/** The structured document a group's EM questions are about. */
/**
 * EM for one batch's detected strings, in place on the chart. `position` gives a sentence's place in the book, `text` its
 * text, `facts` the ledger (every fact of the book; only those before a string are ever given for it).
 */
export async function resolveBatch(decide: Decide, chart: Chart, batch: Sentence[], detected: Detected[], context: { position: (sentence: string) => number; text: (sentence: string) => string; facts: FactLedger }): Promise<EmResult[]> {
  const results = new Map<string, EmResult>();
  const pending: { detected: Detected; candidates: string[]; scores: { id: string; score: number }[]; peers: string[] }[] = [];
  for (const entry of detected) {
    const base = { key: entry.key, text: entry.text, type: entry.type, category: entry.category };
    if (!entry.category) { results.set(entry.key, { ...base, ...(entry.type === "spatial" ? { outcome: "spatial", sentences: entry.sentences } : { outcome: entry.type === "routine" ? "routine" : "skip" }) }); continue; }
    if (entry.category === "time") { const node = chart.time(entry.text, entry.sentences); results.set(entry.key, { ...base, outcome: "time", entity: node.id }); continue; }
    const known = chart.exact(entry.text);
    if (known) { chart.see(known.id, entry.sentences); results.set(entry.key, { ...base, outcome: "exact", entity: known.id }); continue; }
    // A place with no name of its own (街上, 大楼, 屋顶) is a description too (the user's call, 2026-10-31): EM² says which
    // place it is where it stands, and what holds it; only named places are places of the chart.
    if (entry.category === "crowd" || (!isProper(entry) && (entry.category === "person" || entry.category === "place" || entry.type === "vehicle" || entry.type === "weapon"))) { results.set(entry.key, { ...base, outcome: "description", sentences: entry.sentences }); continue; }
    if (entry.category === "thing" && !isProper(entry)) { results.set(entry.key, { ...base, outcome: "routine" }); continue; }
    if (entry.category === "concept" && !isProper(entry)) { results.set(entry.key, { ...base, outcome: "skip" }); continue; }
    const scores = recommend(chart, entry, context.position);
    pending.push({ detected: entry, candidates: scores.map((score) => score.id), scores, peers: [] });
  }
  // Two new names of one person born in the same batch ("白井黒子", "黒子"): each is a candidate for the other.
  for (const entry of pending) entry.peers = pending.filter((other) => other !== entry && other.detected.category === entry.detected.category && nameOverlap(other.detected.text, entry.detected.text) === 1).map((other) => other.detected.key);
  const asked = pending.filter((entry) => entry.candidates.length || entry.peers.length);
  const answers = new Map<string, { value: string; confidence: number }>(), given = new Map<string, string[]>();
  const groups = Array.from({ length: Math.ceil(asked.length / EM_GROUP) }, (_, index) => asked.slice(index * EM_GROUP, (index + 1) * EM_GROUP));
  await Promise.all(groups.map(async (group) => {
    const before = Math.min(...group.map((entry) => context.position(entry.detected.sentences[0] ?? "")));
    const found = [
      ...[...new Set(group.flatMap((entry) => entry.candidates))].flatMap((id) => context.facts.about(chart, [id], before, FACT_RECENT).map((fact) => ({ fact, for: id }))),
      ...group.flatMap((entry) => context.facts.holding(entry.detected.text, before, FACT_RECENT).map((fact) => ({ fact, for: `names.${entry.detected.key}` }))),
    ];
    const facts = factEvidence(found);
    for (const entry of group) given.set(entry.detected.key, Object.keys(facts).filter((id) => facts[id].about.some((key) => key === `names.${entry.detected.key}` || entry.candidates.includes(key))));
    const peerText = new Map(pending.map((entry) => [entry.detected.key, entry.detected.text]));
    const { replies } = await ask(decide, emMode, { batch, group, facts, questions: group.map((entry) => ({
      key: `em:${entry.detected.key}`, primitive: "choice" as const,
      instructions: `Who or what is names.${entry.detected.key}? One of its candidates (in candidates), the same as another name of the passage, or new.`,
      options: [...entry.candidates, ...entry.peers, "new"],
      optionHints: Object.fromEntries([...entry.candidates.map((id) => [id, describe(chart.entities.get(id)!, chart)]), ...entry.peers.map((key) => [key, `the same as names.${key} (${peerText.get(key)})`]), ["new", "not one of these: someone or something new"]]),
    })) }, { chart, text: context.text, label: (id) => label(chart, id) });
    for (const entry of group) {
      const reply = replies.find((item) => item.key === `em:${entry.detected.key}`);
      const value = String(reply?.value ?? "new");
      answers.set(entry.detected.key, { value, confidence: Number(reply?.distribution?.[value] ?? reply?.confidence ?? 0) });
    }
  }));
  // Candidates first, then the new ones, then names that are another name of the batch (following the pointers).
  const entityOf = new Map<string, string>();
  for (const entry of pending) {
    const answer = answers.get(entry.detected.key), evidence = given.get(entry.detected.key) ?? [];
    const base = { key: entry.detected.key, text: entry.detected.text, type: entry.detected.type, category: entry.detected.category, candidates: entry.scores, answer: answer?.value, confidence: answer?.confidence, ...(evidence.length ? { facts: evidence } : {}) };
    if (answer && chart.entities.has(answer.value) && answer.confidence >= EM_ACCEPT) {
      chart.name(answer.value, entry.detected.text, isProper(entry.detected)); chart.see(answer.value, entry.detected.sentences); entityOf.set(entry.detected.key, answer.value);
      results.set(entry.detected.key, { ...base, outcome: "alias", entity: answer.value });
    }
  }
  const byKey = new Map(pending.map((entry) => [entry.detected.key, entry]));
  const settle = (key: string, trail: Set<string>): string => {
    if (entityOf.has(key)) return entityOf.get(key)!;
    const entry = byKey.get(key)!, answer = answers.get(key);
    const peer = answer && byKey.has(answer.value) && answer.confidence >= EM_ACCEPT && !trail.has(answer.value) ? answer.value : null;
    const id = peer ? settle(peer, new Set([...trail, key])) : chart.mint(entry.detected.category as Exclude<Category, "time" | "crowd">, entry.detected.type, entry.detected.text, entry.detected.sentences, isProper(entry.detected)).id;
    if (peer) { chart.name(id, entry.detected.text, isProper(entry.detected)); chart.see(id, entry.detected.sentences); }
    entityOf.set(key, id);
    const evidence = given.get(key) ?? [];
    results.set(key, { key, text: entry.detected.text, type: entry.detected.type, category: entry.detected.category, candidates: entry.scores, answer: answer?.value, confidence: answer?.confidence, ...(evidence.length ? { facts: evidence } : {}), outcome: peer ? "alias" : "new", entity: id, ...(!peer && answer && answer.value !== "new" ? { unsure: answer.value } : {}) });
    return id;
  };
  // Longer names first, so a short form pointing at a long one finds it minted (in a ring of names pointing at each other,
  // the one the ring comes back to is minted and the others are its names).
  for (const entry of [...pending].sort((a, b) => b.detected.text.length - a.detected.text.length)) settle(entry.detected.key, new Set());
  // An unsure answer that was another name of the batch is kept as that name's entity.
  for (const result of results.values()) if (result.unsure && entityOf.has(result.unsure)) result.unsure = entityOf.get(result.unsure);
  await askOwners(decide, chart, batch, [...results.values()], context);
  return detected.map((entry) => results.get(entry.key)!);
}

/**
 * Whose each concept of the batch is, for the ones with no owner yet: one request. The options are the people the passage
 * names, many (people share it, or a group runs it) and none (no one's, or the passage does not say); a sure person or
 * many is the concept's owner from its first sentence here.
 */
async function askOwners(decide: Decide, chart: Chart, batch: Sentence[], results: EmResult[], context: { position: (sentence: string) => number; facts: FactLedger }): Promise<void> {
  const asked = new Map<string, EmResult[]>();
  for (const result of results) {
    const entity = result.entity ? chart.entities.get(result.entity) : undefined;
    if (entity?.category === "concept" && !entity.owners?.length) asked.set(entity.id, [...(asked.get(entity.id) ?? []), result]);
  }
  if (!asked.size) return;
  const names = chart.names().filter(([, id]) => chart.entities.get(id)?.category === "person");
  const people = [...new Set(batch.flatMap((sentence) => mentions(sentence.text, names).map((hit) => hit.id)))].slice(0, OWNER_PEOPLE);
  const sentencesOf = (id: string) => [...new Set(asked.get(id)!.flatMap((result) => batch.filter((sentence) => sentence.text.includes(result.text)).map((sentence) => sentence.id)))];
  const before = context.position(batch[0]?.id ?? "");
  const facts = factEvidence([...asked.keys()].flatMap((id) => chart.entities.get(id)!.proper.flatMap((name) => context.facts.holding(name, before, FACT_RECENT).map((fact) => ({ fact, for: id })))));
  const { replies } = await ask(decide, ownersMode, { batch, concepts: [...asked.keys()].map((id) => ({ id, name: label(chart, id), in: sentencesOf(id) })), people: people.map((id) => ({ id, name: label(chart, id) })), facts, questions: [...asked.keys()].map((id) => ({
    key: `own:${id}`, primitive: "choice" as const, instructions: `Whose is concepts.${id}?`, options: [...people, "many", "none"],
    optionHints: { ...Object.fromEntries(people.map((person) => [person, label(chart, person)])), many: "many people share it, or a group runs it", none: "no one's: it is general, or the passage does not say whose" },
  })) }, null);
  for (const [id, entries] of asked) {
    const reply = replies.find((entry) => entry.key === `own:${id}`), value = String(reply?.value ?? "none");
    const confidence = Number(Number(reply?.distribution?.[value] ?? reply?.confidence ?? 0).toFixed(3));
    for (const result of entries) result.owner = { answer: value, confidence };
    if (value !== "none" && confidence >= EM_ACCEPT && (value === "many" || people.includes(value))) chart.entities.get(id)!.owners = [{ id: value, from: sentencesOf(id)[0] ?? batch[0]?.id ?? "", confidence }];
  }
}
