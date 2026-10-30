import type { Sentence } from "../digger/intake/sectioning.js";
import { classifySentences, kindCards, tileScenes, type KindCard, type SentenceKind } from "../digger/autostep/segmentation.js";
import { Chart, mentions, resolveBatch, type EmResult, type Fact } from "./em.js";
import type { Lister } from "./listing.js";
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
 *   people the recommender expects from the recent scenes (the world engine adds its view of who is where).
 */
export interface FlowBlock { id: string; chapter: number; sentences: Sentence[] }
export interface FlowCard extends KindCard { block: string; sentences: string[]; entities: { id: string; at: string[] }[] }
export interface FlowScene { id: string; index: number; block: string; chapter: number; sentences: string[] }
export interface SceneContext {
  scene: string;
  cards: string[];
  before: Partial<Record<"dialogue" | "action" | "environment", string[]>>;
  recommended: { id: string; score: number }[];
  facts: string[];
}
export interface StepLog { step: string; requests: number; ms: number; inputChars: number; detail?: Record<string, unknown> }
export interface FlowResult {
  scenes: FlowScene[]; cards: FlowCard[]; kinds: Record<string, { kind: SentenceKind; turn: number; confidence: number }>;
  chart: Chart; em: { batch: string; results: EmResult[] }[]; contexts: SceneContext[]; steps: StepLog[];
}

/** Sentences a listing batch holds (small: two new names of one person in one batch cannot see each other's answers). */
export const LIST_BATCH = 30;
/** Listing and typing requests at once; Jev requests at once overall. */
export const LIST_AT_ONCE = 8, JEV_AT_ONCE = 12;
/** Recent scenes the recommender looks back over for a scene's context, and facts a context carries. */
const RECENT_SCENES = 3, CONTEXT_FACTS = 6;

export async function readFlow(blocks: FlowBlock[], decideRaw: Decide, lister: Lister, options: { onStep?: (log: StepLog) => void } = {}): Promise<FlowResult> {
  const steps: StepLog[] = [];
  const meter = (step: string) => { const log: StepLog = { step, requests: 0, ms: 0, inputChars: 0 }; steps.push(log); return log; };
  // One gate for every Jev request of the flow.
  let running = 0; const waiting: (() => void)[] = [];
  const gate = async <T>(work: () => Promise<T>): Promise<T> => {
    if (running >= JEV_AT_ONCE) await new Promise<void>((resolve) => waiting.push(resolve));
    running++;
    try { return await work(); } finally { running--; waiting.shift()?.(); }
  };
  const decideFor = (log: StepLog): Decide => async (state, questions) => {
    log.requests++; log.inputChars += typeof state === "string" ? state.length : JSON.stringify(state).length;
    return gate(() => decideRaw(state, questions));
  };
  const timed = async <T>(log: StepLog, work: () => Promise<T>): Promise<T> => { const started = performance.now(); try { return await work(); } finally { log.ms = Math.round(performance.now() - started); options.onStep?.(log); } };

  const all = blocks.flatMap((block) => block.sentences.map((sentence) => ({ sentence, block })));
  const position = new Map(all.map(({ sentence }, index) => [sentence.id, index]));
  const textOf = new Map(all.map(({ sentence }) => [sentence.id, sentence.text]));
  const pos = (id: string) => position.get(id) ?? -1, text = (id: string) => textOf.get(id) ?? "";

  // 1–3 at once.
  const tiling = meter("scene tiling"), kindsLog = meter("sentence kinds"), listing = meter("listing (work model)"), typing = meter("typing");
  const tiled = timed(tiling, () => Promise.all(blocks.map(async (block) => ({ block, ...(await tileScenes(block.sentences, decideFor(tiling), { stateSummary: `Processing block ${block.id}.`, gates: { accept: 0.85, reask: 0.55 } })) }))));
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
        const names = await lister(batch);
        const started = performance.now();
        detectedOf[index] = await typeNames(typingDecide, batch, names);
        typing.ms += Math.round(performance.now() - started);
      }
    }));
    listing.ms = Math.round(performance.now() - listingStarted) - typing.ms;
    options.onStep?.(listing); options.onStep?.(typing);
  })();
  const [tiles, kinds] = await Promise.all([tiled, classified, listed]);

  // Scenes and cards.
  const scenes: FlowScene[] = tiles.flatMap(({ block, spans }) => spans.map((ids) => ({ id: "", index: 0, block: block.id, chapter: block.chapter, sentences: ids }))).map((scene, index) => ({ ...scene, id: `scene_${String(index + 1).padStart(6, "0")}`, index }));
  const kindOf: FlowResult["kinds"] = {};
  const cards: FlowCard[] = kinds.flatMap(({ block, kinds: list, turns, confidence }) => {
    const ids = block.sentences.map((sentence) => sentence.id);
    ids.forEach((id, index) => { kindOf[id] = { kind: list[index], turn: Number(turns[index].toFixed(3)), confidence: Number(confidence[index].toFixed(3)) }; });
    return kindCards(ids, list, turns).map((card) => ({ ...card, block: block.id, sentences: ids.slice(ids.indexOf(card.first), ids.indexOf(card.last) + 1), entities: [] }));
  });
  const facts: Fact[] = cards.filter((card) => card.kind === "fact").map((card) => ({ first: card.first, text: card.sentences.map(text).join("") }));

  // EM, batch by batch in reading order.
  const chart = new Chart(), emLog = meter("EM"), emDecide = decideFor(emLog), em: FlowResult["em"] = [];
  await timed(emLog, async () => {
    for (const [index, batch] of batches.entries()) em.push({ batch: batch.sentences[0]?.id ?? String(index), results: await resolveBatch(emDecide, chart, batch.sentences, detectedOf[index] ?? [], { position: pos, text, facts }) });
  });

  // System 0: every card scanned for the chart's proper names (and the appearances EM recorded, where a description was
  // decided); every appearance recorded on its entity.
  const scan = meter("card scan");
  await timed(scan, async () => {
    const names = chart.names(), found = new Map<string, { id: string }[]>();
    for (const entity of chart.entities.values()) for (const id of entity.seen) found.set(id, [...(found.get(id) ?? []), { id: entity.id }]);
    for (const { sentence } of all) { const hits = mentions(sentence.text, names); found.set(sentence.id, [...(found.get(sentence.id) ?? []), ...hits]); for (const hit of hits) chart.see(hit.id, [sentence.id]); }
    for (const card of cards) {
      const at = new Map<string, string[]>();
      for (const id of card.sentences) for (const hit of found.get(id) ?? []) at.set(hit.id, [...new Set([...(at.get(hit.id) ?? []), id])]);
      card.entities = [...at].map(([id, sentences]) => ({ id, at: sentences }));
    }
    for (const entity of chart.entities.values()) entity.seen.sort((a, b) => pos(a) - pos(b));
  });

  // Each scene's context.
  const sceneOf = new Map(scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene.id])));
  const worldCards = new Map<string, FlowCard[]>();
  for (const card of cards) if (["dialogue", "action", "environment"].includes(card.kind)) { const scene = sceneOf.get(card.first); if (scene) worldCards.set(scene, [...(worldCards.get(scene) ?? []), card]); }
  const contexts: SceneContext[] = scenes.map((scene, index) => {
    const before = scenes[index - 1], previous = before ? worldCards.get(before.id) ?? [] : [];
    const recent = scenes.slice(Math.max(0, index - RECENT_SCENES), index + 1), score = new Map<string, number>();
    recent.forEach((entry, at) => { for (const card of worldCards.get(entry.id) ?? []) for (const hit of card.entities) if (chart.entities.get(hit.id)?.category === "person") score.set(hit.id, (score.get(hit.id) ?? 0) + hit.at.length * (at + 1) / recent.length); });
    const start = pos(scene.sentences[0]);
    return {
      scene: scene.id,
      cards: (worldCards.get(scene.id) ?? []).map((card) => card.id),
      before: Object.fromEntries((["dialogue", "action", "environment"] as const).map((kind) => [kind, previous.filter((card) => card.kind === kind).map((card) => card.id)]).filter(([, list]) => list.length)),
      recommended: [...score].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([id, value]) => ({ id, score: Number(value.toFixed(2)) })),
      facts: cards.filter((card) => card.kind === "fact" && pos(card.first) < start).slice(-CONTEXT_FACTS).map((card) => card.id),
    };
  });
  return { scenes, cards, kinds: kindOf, chart, em, contexts, steps };
}
