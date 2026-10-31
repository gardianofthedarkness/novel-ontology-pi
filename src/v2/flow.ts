import type { Sentence } from "../digger/intake/sectioning.js";
import { classifySentences, kindCards, tileScenes, type KindCard, type SentenceKind } from "../digger/autostep/segmentation.js";
import { Chart, mentions, resolveBatch, type EmResult } from "./em.js";
import { FactLedger, type FactEntry } from "./facts.js";
import type { Lister } from "./listing.js";
import { resolveRoles, type DescriptionType, type RolesResult } from "./roles.js";
import { readStoryTime, timeWords, type StoryTime } from "./time.js";
import { hintsOnce } from "./hints.js";
import { typeNames, type Decide, type Detected } from "./typing.js";

/**
 * The v2 reading flow (the user's sketch, 2026-10-30; docs/v2/world-engine-v2.md §2):
 * - the book's sentences (ids b<block>_s<n>, with the album's pictures anchored on them) go three ways at once:
 *   1. scene tiling (Jev, start selection): a scene is a list of sentence ids;
 *   2. sentence kinds (Jev, one structured document a window): spoken, thought, fact, action, environment or narration,
 *      and whether the carrier changes; adjacent sentences of a kind are one card, nested under exchanges and monologues;
 *   3. listing (System 2, the work model, batches of sentences) then typing (Jev): the important names, and what each is;
 * - everything waits for all three; then EM runs batch by batch in reading order (the chart grows as it reads);
 * - System 0 scans every card for the chart's names (string match);
 * - each scene's context is composed: its world cards, the scene before's cards of the same kind in sequence, and the
 *   people the recommender expects from the recent scenes (the world engine adds its view of who is where);
 * - story time (time.ts), scene by scene: each time word's role, the story periods, the calendar; the facts are ranked by
 *   story time from here on;
 * - EM² (roles.ts), scene by scene: who says or does each line, who a line is said to, and who each description of a
 *   person or a crowd means where it stands (a person of the chart, or an unnamed person or crowd of the scene: a slot),
 *   and which vehicle or weapon an unnamed one is (a named one, or the scene's own: a slot);
 *   an action where nothing that matters acts becomes narration (the user's rule), and the cards are cut again; each
 *   card's people are then the ones it names, and the ones its lines and descriptions point at;
 * - the facts (facts.ts) are the source of truth throughout: EM and EM² are given the latest facts about their candidates.
 */
export interface FlowBlock { id: string; chapter: number; sentences: Sentence[] }
/** A card's person (or slot, or a thing or place that acts): how it is there (named, speaks, acts, addressed, described) and in which of its sentences. */
export interface CardPerson { id: string; how: ("named" | "speaks" | "acts" | "addressed" | "described")[]; at: string[] }
export interface FlowCard extends KindCard { block: string; sentences: string[]; entities: { id: string; at: string[] }[]; people: CardPerson[] }
export interface FlowScene { id: string; index: number; block: string; chapter: number; sentences: string[] }
export interface SceneContext {
  scene: string;
  cards: string[];
  before: Partial<Record<"dialogue" | "action" | "environment", string[]>>;
  recommended: { id: string; score: number }[];
  facts: string[];
}
export interface StepLog { step: string; requests: number; ms: number; inputChars: number; questionChars?: number; detail?: Record<string, unknown> }
export interface FlowResult extends RolesResult {
  /** `was`: the kind the classifier gave, where the action rule changed it (nothing that matters acts); `actor`: the thing that did. */
  scenes: FlowScene[]; cards: FlowCard[]; kinds: Record<string, { kind: SentenceKind; turn: number; confidence: number; was?: SentenceKind; actor?: string }>;
  chart: Chart; em: { batch: string; results: EmResult[] }[]; contexts: SceneContext[]; steps: StepLog[];
  /** The fact ledger, in reading order: who each fact is about, its time, and its story period. */
  facts: FactEntry[];
  /** Story time: the time words and their roles, the periods, each scene's time, the calendar. */
  time: Omit<StoryTime, "periodOf">;
}

/** Sentences a listing batch holds (small: two new names of one person in one batch cannot see each other's answers). */
export const LIST_BATCH = 30;
/** Listing and typing requests at once; Jev requests at once overall. */
export const LIST_AT_ONCE = 8, JEV_AT_ONCE = 12;
/** Recent scenes the recommender looks back over for a scene's context, and facts a context carries. */
const RECENT_SCENES = 3, CONTEXT_FACTS = 6;

/** `hintsOnce`: answer options' meanings once a request (hints.ts; default on); off sends them in every question, as before. */
export async function readFlow(blocks: FlowBlock[], decideRaw: Decide, lister: Lister, options: { onStep?: (log: StepLog) => void; present?: Map<string, string[]>; hintsOnce?: boolean } = {}): Promise<FlowResult> {
  const steps: StepLog[] = [];
  const meter = (step: string) => { const log: StepLog = { step, requests: 0, ms: 0, inputChars: 0 }; steps.push(log); return log; };
  // One gate for every Jev request of the flow.
  let running = 0; const waiting: (() => void)[] = [];
  const gate = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= JEV_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try { return await work(); } finally { running--; waiting.shift()?.(); }
  };
  const decideFor = (log: StepLog, compact = options.hintsOnce !== false): Decide => async (state, questions) => {
    const sent = compact ? hintsOnce(state, questions) : { state, questions };
    log.requests++; log.inputChars += typeof sent.state === "string" ? sent.state.length : JSON.stringify(sent.state).length;
    log.questionChars = (log.questionChars ?? 0) + JSON.stringify(sent.questions).length;
    return gate(() => decideRaw(sent.state, sent.questions));
  };
  const timed = async <T>(log: StepLog, work: () => Promise<T>): Promise<T> => { const started = performance.now(); try { return await work(); } finally { log.ms = Math.round(performance.now() - started); options.onStep?.(log); } };

  const all = blocks.flatMap((block) => block.sentences.map((sentence) => ({ sentence, block })));
  const position = new Map(all.map(({ sentence }, index) => [sentence.id, index]));
  const textOf = new Map(all.map(({ sentence }) => [sentence.id, sentence.text]));
  const pos = (id: string) => position.get(id) ?? -1, text = (id: string) => textOf.get(id) ?? "";

  // 1–3 at once.
  const tiling = meter("scene tiling"), kindsLog = meter("sentence kinds"), listing = meter("listing (work model)"), typing = meter("typing");
  // The tiling's requests stay as they were (its answers come from the cache, so a comparison of readings keeps its scenes).
  const tiled = timed(tiling, () => Promise.all(blocks.map(async (block) => ({ block, ...(await tileScenes(block.sentences, decideFor(tiling, false), { stateSummary: `Processing block ${block.id}.`, gates: { accept: 0.85, reask: 0.55 } })) }))));
  const classified = timed(kindsLog, () => Promise.all(blocks.map(async (block) => ({ block, ...(await classifySentences(block.sentences, decideFor(kindsLog), { stateSummary: `Processing block ${block.id}.` })) }))));
  const batches = blocks.flatMap((block) => Array.from({ length: Math.ceil(block.sentences.length / LIST_BATCH) }, (_, index) => ({ block, sentences: block.sentences.slice(index * LIST_BATCH, (index + 1) * LIST_BATCH) })));
  const listingStarted = performance.now(), typingDecide = decideFor(typing);
  const detectedOf: Detected[][] = new Array(batches.length);
  const listed = (async () => {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(LIST_AT_ONCE, batches.length) }, async () => {
      while (next < batches.length) {
        const index = next++, batch = batches[index].sentences;
        listing.requests++; listing.inputChars += batch.reduce((sum, sentence) => sum + sentence.text.length + sentence.id.length + 2, 0);
        const asked = performance.now();
        const names = await lister(batch);
        listing.ms += Math.round(performance.now() - asked);
        const started = performance.now();
        detectedOf[index] = await typeNames(typingDecide, batch, names);
        typing.ms += Math.round(performance.now() - started);
      }
    }));
    listing.detail = { wallMs: Math.round(performance.now() - listingStarted), note: "ms: listing and typing request time summed over the workers" };
    options.onStep?.(listing); options.onStep?.(typing);
  })();
  const [tiles, kinds] = await Promise.all([tiled, classified, listed]);

  // Scenes and cards.
  const scenes: FlowScene[] = tiles.flatMap(({ block, spans }) => spans.map((ids) => ({ id: "", index: 0, block: block.id, chapter: block.chapter, sentences: ids }))).map((scene, index) => ({ ...scene, id: `scene_${String(index + 1).padStart(6, "0")}`, index }));
  const kindOf: FlowResult["kinds"] = {};
  for (const { block, kinds: list, turns, confidence } of kinds) block.sentences.forEach((sentence, index) => { kindOf[sentence.id] = { kind: list[index], turn: Number(turns[index].toFixed(3)), confidence: Number(confidence[index].toFixed(3)) }; });
  const cut = (): FlowCard[] => blocks.flatMap((block) => {
    const ids = block.sentences.map((sentence) => sentence.id);
    return kindCards(ids, ids.map((id) => kindOf[id].kind), ids.map((id) => kindOf[id].turn)).map((card) => ({ ...card, block: block.id, sentences: ids.slice(ids.indexOf(card.first), ids.indexOf(card.last) + 1), entities: [], people: [] }));
  });
  let cards = cut();
  const facts = new FactLedger(cards.filter((card) => card.kind === "fact"), text, pos);

  // EM, batch by batch in reading order (the facts before each string are its evidence).
  const chart = new Chart(), emLog = meter("EM"), emDecide = decideFor(emLog), em: FlowResult["em"] = [];
  await timed(emLog, async () => {
    for (const [index, batch] of batches.entries()) em.push({ batch: batch.sentences[0]?.id ?? String(index), results: await resolveBatch(emDecide, chart, batch.sentences, detectedOf[index] ?? [], { position: pos, text, facts }) });
  });

  // System 0: every sentence scanned for the chart's proper names (and the appearances EM recorded, where a thing's or a
  // place's description was decided); every appearance recorded on its entity, and each card's entities.
  const scan = meter("card scan"), found = new Map<string, { id: string }[]>();
  const scanCards = () => {
    for (const card of cards) {
      const at = new Map<string, string[]>();
      for (const id of card.sentences) for (const hit of found.get(id) ?? []) at.set(hit.id, [...new Set([...(at.get(hit.id) ?? []), id])]);
      card.entities = [...at].map(([id, sentences]) => ({ id, at: sentences }));
    }
  };
  await timed(scan, async () => {
    const names = chart.names();
    for (const entity of chart.entities.values()) for (const id of entity.seen) found.set(id, [...(found.get(id) ?? []), { id: entity.id }]);
    for (const { sentence } of all) { const hits = mentions(sentence.text, names); found.set(sentence.id, [...(found.get(sentence.id) ?? []), ...hits]); for (const hit of hits) chart.see(hit.id, [sentence.id]); }
    scanCards();
    for (const entity of chart.entities.values()) entity.seen.sort((a, b) => pos(a) - pos(b));
  });

  // Each scene's context.
  const sceneOf = new Map(scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene.id])));
  const compose = (): SceneContext[] => {
    const worldCards = new Map<string, FlowCard[]>();
    for (const card of cards) if (["dialogue", "action", "environment"].includes(card.kind)) { const scene = sceneOf.get(card.first); if (scene) worldCards.set(scene, [...(worldCards.get(scene) ?? []), card]); }
    return scenes.map((scene, index) => {
      const before = scenes[index - 1], previous = before ? worldCards.get(before.id) ?? [] : [];
      const recent = scenes.slice(Math.max(0, index - RECENT_SCENES), index + 1), score = new Map<string, number>();
      recent.forEach((entry, at) => { for (const card of worldCards.get(entry.id) ?? []) for (const hit of card.entities) if (chart.entities.get(hit.id)?.category === "person") score.set(hit.id, (score.get(hit.id) ?? 0) + hit.at.length * (at + 1) / recent.length); });
      const start = pos(scene.sentences[0]);
      return {
        scene: scene.id,
        cards: (worldCards.get(scene.id) ?? []).map((card) => card.id),
        before: Object.fromEntries((["dialogue", "action", "environment"] as const).map((kind) => [kind, previous.filter((card) => card.kind === kind).map((card) => card.id)]).filter(([, list]) => list.length)),
        recommended: [...score].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, value]) => ({ id, score: Number(value.toFixed(2)) })),
        facts: facts.facts.filter((fact) => fact.order < start).slice(-CONTEXT_FACTS).map((fact) => fact.id),
      };
    });
  };
  let contexts = compose();

  // Story time, scene by scene in reading order; then the facts rank by it.
  const timeLog = meter("story time"), timeDecide = decideFor(timeLog);
  const listedTimes = em.flatMap((batch) => batch.results).filter((entry) => entry.outcome === "time").map((entry) => entry.text);
  const time = await timed(timeLog, () => readStoryTime(timeDecide, { scenes: scenes.map((scene) => ({ id: scene.id, chapter: scene.chapter, sentences: scene.sentences })), words: blocks.flatMap((block) => timeWords(block.sentences, listedTimes)), text, position: pos, kind: (id) => kindOf[id]?.kind }));
  facts.byStory(time.periodOf);

  // EM², scene by scene in reading order.
  const named = new Map([...found].map(([id, hits]) => [id, [...new Set(hits.map((hit) => hit.id))]]));
  const described = new Map<string, DescriptionType>();
  for (const entry of em.flatMap((batch) => batch.results)) if (entry.outcome === "description" && !described.has(entry.text)) described.set(entry.text, entry.category === "crowd" ? "crowd" : entry.category === "thing" ? (entry.type as "vehicle" | "weapon") : "person");
  const rolesLog = meter("roles (EM²)"), rolesDecide = decideFor(rolesLog);
  const resolved = await timed(rolesLog, () => resolveRoles(rolesDecide, { scenes, kinds: kindOf, chart, named, descriptions: [...described].map(([text, type]) => ({ text, type })), recommended: new Map(contexts.map((context) => [context.scene, context.recommended])), facts, text, position: pos, present: options.present }));

  // The user's rule for actions: an action is something that matters acting or moving (a person, a crowd, a vehicle, a
  // weapon, a thing with a name of its own, a building or a place), or the story going back in time. One where nothing that
  // matters acts is narration (no one acts, an everyday thing does, or EM² says it is background): the cards are cut again,
  // scanned again, and the contexts composed again. The kind keeps what it was, and who or what acted.
  for (const [id, role] of Object.entries(resolved.roles)) {
    if (role.kind !== "action" || ((role.matters ?? 1) >= 0.5 && (role.who.id || !["none", "unnamed", "general"].includes(role.who.answer)))) continue;
    kindOf[id] = { ...kindOf[id], kind: "narration", was: "action", ...(role.who.id ? { actor: role.who.id } : {}) };
    delete resolved.roles[id];
  }
  cards = cut(); scanCards(); contexts = compose();

  // Each card's people: the ones it names, and the ones its lines and descriptions point at.
  const describedAt = new Map<string, string[]>();
  for (const reference of resolved.references) if (reference.entity) for (const id of reference.sentences) describedAt.set(id, [...(describedAt.get(id) ?? []), reference.entity]);
  for (const card of cards) {
    const people = new Map<string, { how: Set<CardPerson["how"][number]>; at: Set<string> }>();
    const mark = (id: string | null | undefined, sentence: string, how: CardPerson["how"][number]) => {
      if (!id) return;
      const entry = people.get(id) ?? { how: new Set(), at: new Set() };
      entry.how.add(how); entry.at.add(sentence); people.set(id, entry);
    };
    for (const id of card.sentences) {
      for (const entity of named.get(id) ?? []) if (chart.entities.get(entity)?.category === "person") mark(entity, id, "named");
      const role = resolved.roles[id];
      if (role) { mark(role.who.id, id, role.kind === "spoken" ? "speaks" : "acts"); mark(role.to?.id, id, "addressed"); }
      for (const entity of describedAt.get(id) ?? []) mark(entity, id, "described");
    }
    card.people = [...people].map(([id, entry]) => ({ id, how: [...entry.how], at: [...entry.at] }));
  }
  facts.settle(chart, pos);
  const { periodOf: _, ...storyTime } = time;
  return { scenes, cards, kinds: kindOf, chart, em, contexts, steps, facts: facts.facts, time: storyTime, ...resolved };
}
