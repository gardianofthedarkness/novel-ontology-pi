import type { DecisionQuestion, DecisionState } from "../../ground/connectors/jev.js";
import type { Sentence } from "../../digger/intake/sectioning.js";
import { ask, type Asker, type Manifest } from "../context/engine.js";
import { kindsMode, unitTypeMode, tilingSeamMode, tilingWindowMode } from "../context/readingModes.js";
import { BLOCK_TYPES, classifySentences, kindCards, tileScenes, type BlockAnswer, type KindCard, type SentenceKind } from "../../digger/autostep/segmentation.js";
import { Chart, mentions, resolveBatch, type EmResult } from "./em.js";
import { FactLedger, type FactEntry } from "./facts.js";
import type { Lister } from "./listing.js";
import { resolveRoles, type DescriptionType, type RolesResult } from "./roles.js";
import { readStoryTime, timeWords, type StoryTime } from "./time.js";
import { hintsOnce } from "./hints.js";
import { placeEm, type PlaceResult } from "./placeEm.js";
import { spatialMentions, type SpatialMention } from "./spatial.js";
import { readHeadings, readStoryboard, type Cut } from "./storyboard.js";
import { CATEGORY_OF, typeNames, type Decide, type Detected, type EntityType } from "./typing.js";
import { designationForms, introSentences, introTerms, type IntroParts } from "./front.js";
import { settledCategory, usualType } from "../rules/typing.js";

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
/** A distribution kept whole (rounded) with its top three candidates (the user, 2026-11-03: top distributions and scores kept for sentences and blocks). */
export function kindScores(distribution: Record<string, number> | undefined): { top?: [string, number][]; distribution?: Record<string, number> } {
  const entries = Object.entries(distribution ?? {}).filter(([, p]) => Number.isFinite(p));
  if (!entries.length) return {};
  const round = (p: number) => Number(p.toFixed(3));
  return { top: entries.sort((a, b) => b[1] - a[1]).slice(0, 3).map(([kind, p]) => [kind, round(p)]), distribution: Object.fromEntries(entries.map(([kind, p]) => [kind, round(p)])) };
}

export interface FlowBlock { id: string; chapter: number; sentences: Sentence[] }
/** A card's person (or slot, or a thing or place that acts): how it is there (named, speaks, acts, addressed, described) and in which of its sentences. */
export interface CardPerson { id: string; how: ("named" | "speaks" | "acts" | "addressed" | "described")[]; at: string[] }
export interface FlowCard extends KindCard { block: string; sentences: string[]; entities: { id: string; at: string[] }[]; people: CardPerson[] }
/** A scene of the reading: one unit the two tiling passes cut, with its kind (the unit-type step) and its whole distribution. */
/** A sequence: one span of the tiler's scene pass (where the place, the time or the viewpoint changes), its scenes, and its heading. */
export interface FlowSequence { id: string; index: number; block: string; chapter: number; sentences: string[]; scenes: string[]; spans?: string[][]; heading?: SequenceHeading }
/** A sequence's heading, as a screenplay's: interior or exterior, where (a place of the tree or an unnamed one), the time of day. */
export interface SequenceHeading { setting: string | null; place: string | null; daytime: string | null; confidence: { setting: number; place: number; daytime: number } }
export interface FlowScene { id: string; index: number; block: string; chapter: number; sequence?: string; sentences: string[]; type?: string | null; confidence?: number; distribution?: Record<string, number>; top?: [string, number][] }
export interface SceneContext {
  scene: string;
  cards: string[];
  before: Partial<Record<"dialogue" | "action" | "environment", string[]>>;
  recommended: { id: string; score: number }[];
  facts: string[];
}
/** `contexts`: what the context engine composed for the step's requests, by mode: requests, items kept and cut, characters. */
export interface StepLog { step: string; requests: number; ms: number; inputChars: number; questionChars?: number; detail?: Record<string, unknown>; contexts?: Record<string, { requests: number; kept: number; cut: number; chars: number }> }
export interface FlowResult extends RolesResult {
  /** The tiler's scene-pass spans, each with its scenes and its heading (interior or exterior, where, the time of day). */
  sequences: FlowSequence[];
  /** The cuts: each scene's cards storyboarded into shots (size, angle, movement, seconds). */
  storyboard: Cut[];
  /** `was`: the kind the classifier gave, where the action rule changed it (nothing that matters acts); `actor`: the thing that did. */
  /** The blocks (twelve sentences, moving six at a time) and what each is about, as Jev's whole distribution (M2). */
  blocks: (BlockAnswer & { block: string })[];
  scenes: FlowScene[]; cards: FlowCard[]; kinds: Record<string, { kind: SentenceKind; turn: number; confidence: number; top?: [string, number][]; distribution?: Record<string, number>; was?: SentenceKind; actor?: string }>;
  chart: Chart; em: { batch: string; results: EmResult[] }[]; contexts: SceneContext[]; steps: StepLog[];
  /** The fact ledger, in reading order: who each fact is about, its time, and its story period. */
  facts: FactEntry[];
  /** Story time: the time words and their roles, the periods, each scene's time, the calendar. */
  time: Omit<StoryTime, "periodOf">;
  /** Place EM: the tree (each named place's parent and scale, and what said so), the unnamed places as leaves, each scene's setting, occupancy. */
  places: PlaceResult;
  /** Spatial words (on the ground, underground, on the roof): who or what each says is where, and at what level. */
  spatial: SpatialMention[];
  /** The book's introduction as the reading used it (front.ts): each cast entry's names and who it is in the chart, the synopsis, its standing facts, the people it merged. */
  intro: { cast: { name: string; names: string[]; entity: string | null; plate: number | null }[]; synopsis: string[]; afterword: number; standing: FactEntry[]; merged: [string, string][] } | null;
}

/** Sentences a listing batch holds (small: two new names of one person in one batch cannot see each other's answers). */
export const LIST_BATCH = 30;
/** Listing and typing requests at once; Jev requests at once overall. */
export const LIST_AT_ONCE = 8, JEV_AT_ONCE = 12;
/** Recent scenes the recommender looks back over for a scene's context, and facts a context carries. */
const RECENT_SCENES = 3, CONTEXT_FACTS = 6;

/**
 * Steps that send answer options' meanings once a request (hints.ts) by default: none (the user's call, 2026-10-31: the
 * saving is not worth the correctness). Measured on vol 1: 18% of Jev's input saved, but typing typed descriptions of
 * people as none of the types, and EM² saved 6% with its sure answers a little worse; the kinds were no worse.
 */
export const HINTS_ONCE_STEPS: string[] = [];

/** `hintsOnce`: the steps (by their log name) that send meanings once; true every step but the tiling, false none. */
export async function readFlow(blocks: FlowBlock[], decideRaw: Decide, lister: Lister, options: { onStep?: (log: StepLog) => void; present?: Map<string, string[]>; hintsOnce?: boolean | string[]; intro?: IntroParts | null } = {}): Promise<FlowResult> {
  const onceSteps = options.hintsOnce === true ? null : options.hintsOnce === false ? [] : options.hintsOnce ?? HINTS_ONCE_STEPS;
  const once = (step: string) => onceSteps === null || onceSteps.includes(step);
  const steps: StepLog[] = [];
  const meter = (step: string) => { const log: StepLog = { step, requests: 0, ms: 0, inputChars: 0 }; steps.push(log); return log; };
  // One gate for every Jev request of the flow.
  let running = 0; const waiting: (() => void)[] = [];
  const gate = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= JEV_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try { return await work(); } finally { running--; waiting.shift()?.(); }
  };
  // Each step's way to Jev; the context engine's manifests of its requests are tallied in its log.
  const decideFor = (log: StepLog, compact = once(log.step)): Asker => Object.assign(async (state: DecisionState, questions: DecisionQuestion[]) => {
    const sent = compact ? hintsOnce(state, questions) : { state, questions };
    log.requests++; log.inputChars += typeof sent.state === "string" ? sent.state.length : JSON.stringify(sent.state).length;
    log.questionChars = (log.questionChars ?? 0) + JSON.stringify(sent.questions).length;
    return gate(() => decideRaw(sent.state, sent.questions));
  }, {
    record: (manifest: Manifest) => {
      const tally = ((log.contexts ??= {})[manifest.mode] ??= { requests: 0, kept: 0, cut: 0, chars: 0 });
      tally.requests++; tally.chars += manifest.used;
      for (const entry of manifest.entries) entry.kept ? tally.kept++ : tally.cut++;
    },
  });
  const timed = async <T>(log: StepLog, work: () => Promise<T>): Promise<T> => { const started = performance.now(); try { return await work(); } finally { log.ms = Math.round(performance.now() - started); options.onStep?.(log); } };

  const all = blocks.flatMap((block) => block.sentences.map((sentence) => ({ sentence, block })));
  const position = new Map(all.map(({ sentence }, index) => [sentence.id, index]));
  const textOf = new Map(all.map(({ sentence }) => [sentence.id, sentence.text]));
  const pos = (id: string) => position.get(id) ?? -1, text = (id: string) => textOf.get(id) ?? "";

  // 1–3 at once.
  const tiling = meter("scene tiling"), kindsLog = meter("sentence kinds"), listing = meter("listing (work model)"), typing = meter("typing");
  // The tiling's requests stay as they were (its answers come from the cache, so a comparison of readings keeps its scenes).
  // Two passes of one tiling (the user, 2026-11-04: "double level tiling triggering with slightly different prompt, although
  // we still treat the final result as one process and the middle layer isn't preserved"): the scene pass where the place,
  // the time or the viewpoint changes, then the kind pass inside each of its spans where the kind of action changes. Only
  // the kind pass's spans are kept: they are the reading's scenes (its segments).
  const tiled = timed(tiling, () => Promise.all(blocks.map(async (block) => {
    const decide = decideFor(tiling, false);
    const tile = (sentences: Sentence[], words: "scene" | "kind", summary: string) => tileScenes(sentences, decide, { stateSummary: summary, gates: { accept: 0.85, reask: 0.55 }, words, ask: async (request) => (await (request.kind === "seam" ? ask(decide, tilingSeamMode, request, null) : ask(decide, tilingWindowMode, request, null))).replies });
    const scenePass = await tile(block.sentences, "scene", `Processing block ${block.id}.`);
    // Each scene-pass span is kept as a sequence (the user, 2026-11-04: the industry's levels, episode › sequence › scene ›
    // cut): its place, time and viewpoint are read once, as a heading, below.
    const groups = await Promise.all(scenePass.spans.map(async (span) => ({ sequence: span, spans: span.length < 2 ? [span] : (await tile(block.sentences.filter((sentence) => span.includes(sentence.id)), "kind", `Processing one scene of block ${block.id}.`)).spans })));
    return { block, groups };
  })));
  const classified = timed(kindsLog, () => Promise.all(blocks.map(async (block) => {
    const decide = decideFor(kindsLog);
    return { block, ...(await classifySentences(block.sentences, decide, { stateSummary: `Processing block ${block.id}.`, ask: async (window) => (await ask(decide, kindsMode, window, null)).replies })) };
  })));
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
  const sequences: FlowSequence[] = tiles.flatMap(({ block, groups }) => groups.map((group) => ({ id: "", index: 0, block: block.id, chapter: block.chapter, sentences: group.sequence, scenes: [] as string[], spans: group.spans }))).map((sequence, index) => ({ ...sequence, id: `sequence_${String(index + 1).padStart(6, "0")}`, index }));
  const scenes: FlowScene[] = sequences.flatMap((sequence) => (sequence.spans ?? []).map((ids) => ({ id: "", index: 0, block: sequence.block, chapter: sequence.chapter, sequence: sequence.id, sentences: ids }))).map((scene, index) => ({ ...scene, id: `scene_${String(index + 1).padStart(6, "0")}`, index }));
  for (const sequence of sequences) { sequence.scenes = scenes.filter((scene) => scene.sequence === sequence.id).map((scene) => scene.id); delete (sequence as { spans?: unknown }).spans; }
  // Each unit's kind, asked of the unit whole (M14's type step in the reading): forty units a request, in reading order.
  const unitTypes = meter("unit types");
  await timed(unitTypes, async () => {
    const decide = decideFor(unitTypes), PER = 40, SHOWN = 3000, kinds = Object.keys(BLOCK_TYPES);
    await Promise.all(Array.from({ length: Math.ceil(scenes.length / PER) }, (_, n) => scenes.slice(n * PER, (n + 1) * PER)).map(async (batch) => {
      const units = batch.map((scene) => ({ id: `unit_${scene.index + 1}`, text: scene.sentences.map(text).join("").slice(0, SHOWN) }));
      const questions: DecisionQuestion[] = batch.map((scene) => ({ key: `unit_type:${scene.id}`, primitive: "choice", instructions: `What is segments.unit_${scene.index + 1} mostly about (one of kinds)?`, options: [...kinds], optionHints: { ...BLOCK_TYPES } }));
      const { replies } = await ask(decide, unitTypeMode, { units, questions }, null);
      for (const scene of batch) {
        const reply = replies.find((entry) => entry.key === `unit_type:${scene.id}`), distribution = Object.fromEntries(kinds.map((k) => [k, Number(Number(reply?.distribution?.[k] ?? (reply?.value === k ? reply?.confidence ?? 0 : 0)).toFixed(3))]));
        Object.assign(scene, { type: reply?.value && kinds.includes(String(reply.value)) ? String(reply.value) : null, confidence: Number(Number(reply?.confidence ?? 0).toFixed(2)), distribution, top: Object.entries(distribution).sort((a, b) => b[1] - a[1]).slice(0, 3) });
      }
    }));
  });
  const kindOf: FlowResult["kinds"] = {};
  for (const { block, kinds: list, turns, confidence, distributions } of kinds) block.sentences.forEach((sentence, index) => { kindOf[sentence.id] = { kind: list[index], turn: Number(turns[index].toFixed(3)), confidence: Number(confidence[index].toFixed(3)), ...kindScores(distributions[index]) }; });
  const cut = (): FlowCard[] => blocks.flatMap((block) => {
    const ids = block.sentences.map((sentence) => sentence.id);
    return kindCards(ids, ids.map((id) => kindOf[id].kind), ids.map((id) => kindOf[id].turn)).map((card) => ({ ...card, block: block.id, sentences: ids.slice(ids.indexOf(card.first), ids.indexOf(card.last) + 1), entities: [], people: [] }));
  });
  let cards = cut();
  const facts = new FactLedger(cards.filter((card) => card.kind === "fact"), text, pos);

  // EM, batch by batch in reading order (the facts before each string are its evidence).
  const chart = new Chart(), emLog = meter("EM"), emDecide = decideFor(emLog), em: FlowResult["em"] = [];
  // The book's introduction (front.ts; the user, 2026-11-05: "are we using the introduction parts to leverage our overall
  // understanding?"): its lines are standing facts, carried by every request about the people they name; each cast
  // entry's other names (what its epithet quotes or sets off, typed once: a name of theirs, not an ability or a title,
  // and a numbered designation's digits) join the person when the reading meets them.
  let introCast: { name: string; names: string[]; plate: number | null }[] = [];
  if (options.intro && (options.intro.cast.length || options.intro.synopsis.length)) {
    const introLog = meter("introduction");
    await timed(introLog, async () => {
      const { sentences } = introSentences(options.intro!), castSentences = sentences.slice(0, options.intro!.cast.length);
      for (const sentence of sentences) textOf.set(sentence.id, sentence.text);
      const terms = options.intro!.cast.map(introTerms), asked = [...new Set(terms.flat())];
      const typed = asked.length ? await typeNames(decideFor(introLog), castSentences, asked) : [];
      const isName = (term: string) => typed.some((entry) => entry.text === term && entry.category === "person" && (entry.proper ?? 1) >= 0.5);
      introCast = options.intro!.cast.map((entry, index) => {
        const names = [entry.name, ...terms[index].filter(isName)];
        // A numbered designation (a serial number) is a name of theirs whatever typing said (the book calls them by its number).
        const designations = terms[index].flatMap(designationForms), numbered = terms[index].filter((term) => designationForms(term).length);
        return { name: entry.name, names: [...new Set([...names, ...numbered, ...designations])], plate: entry.plate };
      });
      for (const entry of introCast) chart.expect(entry.names);
      facts.addStanding(sentences.map((sentence) => ({ sentence: sentence.id, text: sentence.text })));
    });
  }
  await timed(emLog, async () => {
    for (const [index, batch] of batches.entries()) em.push({ batch: batch.sentences[0]?.id ?? String(index), results: await resolveBatch(emDecide, chart, batch.sentences, detectedOf[index] ?? [], { position: pos, text, facts }) });
  });
  // Each named entity takes the category most of its typings gave it (rules/typing.ts): 魔法侧, minted a place as a region in
  // one batch and a concept in another, is no place. It moves under an id of its category, and EM's answers follow it.
  const typings = new Map<string, Map<string, number>>();
  for (const result of em.flatMap((batch) => batch.results)) if (result.entity && chart.entities.has(result.entity)) { const votes = typings.get(result.entity) ?? new Map<string, number>(); votes.set(result.type, (votes.get(result.type) ?? 0) + 1); typings.set(result.entity, votes); }
  const moved = new Map<string, string>();
  for (const [id, votes] of typings) {
    const settled = settledCategory(votes, (type) => CATEGORY_OF[type as keyof typeof CATEGORY_OF]), entity = chart.entities.get(id)!;
    if (settled && settled.category !== entity.category && settled.category !== "time" && settled.category !== "crowd") moved.set(id, chart.recategorize(id, settled.category, settled.type as EntityType));
  }
  // Two people of the chart the introduction names as one (a name of theirs met on its own first): one, ids kept.
  const merged = chart.mergeExpected(pos);
  for (const [drop, keep] of merged) moved.set(drop, keep);
  for (const result of em.flatMap((batch) => batch.results)) { if (result.entity && moved.has(result.entity)) result.entity = moved.get(result.entity)!; result.candidates = result.candidates?.map((candidate) => ({ ...candidate, id: moved.get(candidate.id) ?? candidate.id })); }
  for (const entity of chart.entities.values()) entity.owners = entity.owners?.map((owner) => ({ ...owner, id: moved.get(owner.id) ?? owner.id }));

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
  // Descriptions of matter go to EM²; descriptions of places (大楼, 便利店, 这座城市) to place EM, with every sentence that holds
  // each, by the type most batches gave the words (直升机航空母舰: a vehicle in most, a building in one, is no place).
  const typeVotes = new Map<string, Map<string, number>>();
  for (const entry of em.flatMap((batch) => batch.results)) { const votes = typeVotes.get(entry.text) ?? new Map<string, number>(); votes.set(entry.type, (votes.get(entry.type) ?? 0) + 1); typeVotes.set(entry.text, votes); }
  const usual = (text: string) => usualType(typeVotes.get(text) ?? new Map<string, number>(), (type) => CATEGORY_OF[type as keyof typeof CATEGORY_OF] === "place");
  const placeDescriptions = new Map<string, { text: string; type: string; sentences: string[] }>();
  for (const entry of em.flatMap((batch) => batch.results)) {
    if (entry.outcome !== "description") continue;
    if (entry.category === "place") {
      const type = usual(entry.text) ?? entry.type;
      if (CATEGORY_OF[type as keyof typeof CATEGORY_OF] !== "place") continue;
      const found = placeDescriptions.get(entry.text) ?? { text: entry.text, type, sentences: [] };
      for (const id of entry.sentences ?? []) if (!found.sentences.includes(id)) found.sentences.push(id);
      placeDescriptions.set(entry.text, found); continue;
    }
    if (!described.has(entry.text)) described.set(entry.text, entry.category === "crowd" ? "crowd" : entry.category === "thing" ? (entry.type as "vehicle" | "weapon") : "person");
  }
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
  // Place EM (docs/v2/world-model.md §5): the tree, the settings, the unnamed places and occupancy, apart from matter.
  const spatial = spatialMentions({ em, cards, roles: resolved.roles, scenes });
  const placesLog = meter("place EM");
  const places = await timed(placesLog, () => placeEm(decideFor(placesLog), { chart, scenes, cards, sentences: all.map(({ sentence }) => sentence), kinds: kindOf, text, facts: facts.facts, time, descriptions: [...placeDescriptions.values()], spatial }));
  // Sequence headings and the storyboard (storyboard.ts): each sequence's heading (a scene of it whose place was only
  // carried on takes the heading's), then each scene's cards cut into shots.
  const flashback = new Set(time.scenes.filter((entry) => entry.flashback).map((entry) => entry.scene));
  const labelOf = (id: string) => { const slot = places.slots.find((entry) => entry.id === id); return slot ? slot.label : chart.entities.get(id)?.names[0] ?? id; };
  const headingLog = meter("sequence headings");
  const headed = await timed(headingLog, () => readHeadings(decideFor(headingLog), { sequences, places, label: labelOf, text, flashback: (scene) => flashback.has(scene) }));
  for (const sequence of sequences) { const heading = headed.headings.get(sequence.id); if (heading) sequence.heading = { setting: heading.setting, place: heading.place, daytime: heading.daytime, confidence: heading.confidence }; }
  headingLog.detail = { scenesPlaced: headed.changed };
  const sequenceOf = new Map(scenes.map((scene) => [scene.id, scene.sequence ?? null])), sequenceById = new Map(sequences.map((sequence) => [sequence.id, sequence]));
  const boardLog = meter("storyboard");
  const storyboard = await timed(boardLog, () => readStoryboard(decideFor(boardLog), { scenes, cards, text, sequenceOf: (scene) => sequenceOf.get(scene) ?? null,
    headingOf: (scene) => { const heading = sequenceById.get(sequenceOf.get(scene) ?? "")?.heading; return heading ? { setting: heading.setting, where: heading.place ? labelOf(heading.place) : null, daytime: heading.daytime } : null; } }));
  const { periodOf: _, ...storyTime } = time;
  return { sequences, storyboard, scenes, cards, kinds: kindOf, blocks: kinds.flatMap((entry) => entry.blocks.map((answer) => ({ ...answer, block: entry.block.id }))), chart, em, contexts, steps, facts: facts.facts, time: storyTime, places, spatial, ...resolved,
    intro: options.intro ? { cast: introCast.map((entry) => ({ ...entry, entity: entry.names.map((name) => chart.exact(name)?.id).find(Boolean) ?? null })), synopsis: options.intro.synopsis, afterword: options.intro.afterword.length, standing: facts.standing, merged } : null };
}
