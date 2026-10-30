import type {
  DecisionAnswer,
  DecisionQuestion,
  DecisionState,
} from "../../ground/connectors/jev.js";
import type { Sentence } from "../intake/sectioning.js";

/**
 * Span segmentation (sectors 02/03, owner's design 2026-10-22).
 *
 * The decision model does not classify every sentence ("does a scene
 * begin here?" fragments scenes — the old per-sentence design produced
 * a median scene size of ONE sentence on real text). It POINTS at
 * boundaries instead. Scenes: Jev chooses where each scene STARTS over
 * long batches (80 sentences, 20 look-back); a scene's end is defined
 * by the next chosen start, so scenes tile the block exactly (scene
 * i+1 starts at scene i's end + 1 by construction). An end-pick is
 * still asked per scene — as a cross-check and as the provisional end
 * a batch-seam query can ratify: when a scene is open at a seam, ONE
 * query shown its tail text decides whether it continues into the new
 * batch or already ended. (Measured reason ends are not authoritative:
 * asked for the end of a scene whose start was imposed, Jev picks the
 * batch's last sentence at 0.95 confidence and the block collapses
 * into one scene; asked to choose starts, it finds the real joints.)
 *
 * Dialogue exchanges (since 2026-10-30) come from what each sentence is
 * (classifySentences: spoken, thought, fact, action or narration, and
 * whether the people talking change), asked as one structured document
 * a window. Per-sentence answers work here because of the stitch: an
 * exchange stays open through narration and replies and ends only when
 * the people change or after a long silence, so it finds conversations,
 * not lines (start and end selection, which it replaced, measured 16x
 * slower on vol 1 for mostly the same exchanges). Each exchange links
 * to the ONE scene it sits in, or the TWO scenes it straddles when a
 * conversation crosses a scene cut.
 */

export type DecideFn = (
  state: DecisionState,
  questions: DecisionQuestion[],
) => Promise<DecisionAnswer[]>;

export interface SegmentationGates {
  accept: number;
  reask: number;
}

export interface SpanEscalation {
  unitId: string;
  reason: string;
}

const BATCH = 80;
const LOOKBACK = 20;
const STEP = 60;
const SEAM_TAIL = 12;

const render = (sentences: Sentence[]): string =>
  sentences.map((s) => `${s.id}: ${s.text}`).join("\n");

function choiceValue(
  answers: DecisionAnswer[],
  key: string,
): DecisionAnswer | undefined {
  return answers.find((a) => a.key === key);
}

/**
 * Tile the block into scenes. Returns spans as sentence-id arrays that
 * partition the block exactly: every sentence in exactly one scene, in
 * order.
 *
 * Authority (measured 2026-10-22, see the experiment report): Jev
 * DETECTS boundaries when it chooses where a scene STARTS; asked for
 * the end of a scene whose start was imposed on it, it punts to the
 * batch end at 0.95 confidence and the whole block collapses into one
 * scene. So boundaries are start-driven, and the owner's tiling rule
 * holds identically: scene i+1 starts exactly at scene i's end + 1,
 * because scene i's end is DEFINED by the next chosen start. The
 * end-pick is still asked for every scene — it is the cross-check
 * (a chosen start far past the provisional end flags a possible
 * missed boundary) and the seam's provisional end (an "ended" seam
 * ratifies it as the real end, and the next scene opens at end + 1).
 *
 * There is always exactly one open scene. It opens at the tiling
 * cursor (0, or the previous scene's end + 1). Per batch, Jev picks
 * scene starts inside the batch's forward region; at each batch seam,
 * one continuation query with the open scene's tail text injected
 * decides whether it flows into the new batch or already ended.
 */
export async function tileScenes(
  sentences: Sentence[],
  decide: DecideFn,
  opts: {
    stateSummary: string;
    gates: SegmentationGates;
    onSpan?: (spans: string[][]) => Promise<void>;
  },
): Promise<{
  spans: string[][];
  escalations: SpanEscalation[];
  unitConfidences: Record<string, number>;
}> {
  const escalations: SpanEscalation[] = [];
  const unitConfidences: Record<string, number> = {};
  const n = sentences.length;
  const closed: [number, number][] = [];
  if (n === 0) return { spans: [], escalations, unitConfidences };

  const spansNow = (): string[][] =>
    closed.map(([a, b]) => sentences.slice(a, b + 1).map((s) => s.id));
  const idxOf = new Map(sentences.map((s, i) => [s.id, i]));

  // The one open scene: its tiling start, and the provisional end Jev
  // picked for it (advisory until a seam ratifies it).
  let cur: { start: number; end: number | null } = { start: 0, end: null };

  const askEnd = async (regionEnd: number): Promise<void> => {
    const startId = sentences[cur.start].id;
    const key = `scene_end:${startId}`;
    const from = Math.max(cur.start, regionEnd - BATCH);
    const options = sentences.slice(from, regionEnd).map((s) => s.id);
    if (options.length === 0) return;
    const context = sentences.slice(Math.max(0, from - LOOKBACK), regionEnd);
    const answers = await decide(
      `${opts.stateSummary}\n---\n${render(context)}`,
      [
        {
          key,
          primitive: "choice",
          instructions: `A scene begins at sentence ${startId}: one continuous place, time and viewpoint. Which sentence id is the LAST sentence of this scene? If the scene continues past the last numbered sentence (${options[options.length - 1]}), pick that last sentence.`,
          options,
        },
      ],
    );
    const a = choiceValue(answers, key);
    const conf = a?.confidence ?? 0;
    unitConfidences[startId] = conf;
    if (conf < opts.gates.reask) {
      escalations.push({
        unitId: startId,
        reason: `scene end decision too uncertain (${conf.toFixed(2)})`,
      });
    }
    const picked = typeof a?.value === "string" ? idxOf.get(a.value) : undefined;
    cur.end = picked !== undefined && picked >= cur.start ? picked : regionEnd - 1;
  };

  for (let batchStart = 0; batchStart < n; batchStart += STEP) {
    const regionEnd = Math.min(n, batchStart + BATCH);

    if (batchStart > 0) {
      // Seam: ONE continuation query for the open scene, with its
      // tail text from the previous batch injected.
      const tailFrom = Math.max(cur.start, batchStart - SEAM_TAIL);
      const tail = sentences.slice(tailFrom, batchStart);
      const head = sentences.slice(batchStart, batchStart + SEAM_TAIL);
      const key = `scene_seam:${sentences[batchStart].id}`;
      const answers = await decide(
        `${opts.stateSummary}\nPREVIOUS SCENE (began at ${sentences[cur.start].id}, still open) — its most recent sentences:\n${render(tail)}\n---\nFOLLOWING PASSAGE:\n${render(head)}`,
        [
          {
            key,
            primitive: "choice",
            instructions:
              "The previous scene's most recent sentences are shown first, then the passage that follows them. Does the previous scene CONTINUE into the following passage (same place, time and viewpoint flowing on), or did it END before the passage begins?",
            options: ["continues", "ended"],
          },
        ],
      );
      const a = choiceValue(answers, key);
      const conf = a?.confidence ?? 0;
      unitConfidences[key] = conf;
      if (conf < opts.gates.reask) {
        escalations.push({
          unitId: sentences[batchStart].id,
          reason: `scene seam decision too uncertain (${conf.toFixed(2)}); defaulted to "continues"`,
        });
      }
      if (a?.value === "ended") {
        const end = Math.min(cur.end ?? batchStart - 1, batchStart - 1);
        closed.push([cur.start, Math.max(end, cur.start)]);
        await opts.onSpan?.(spansNow());
        // Tiling: the next scene opens at the ratified end + 1, even
        // though its salient start may be pointed at later.
        cur = { start: closed[closed.length - 1][1] + 1, end: null };
        if (cur.start < regionEnd) await askEnd(regionEnd);
      }
    } else {
      await askEnd(regionEnd);
    }

    // Start detection over the forward region: each chosen start
    // closes the open scene at start - 1 and opens the next there.
    const context = sentences.slice(
      Math.max(0, batchStart - LOOKBACK),
      regionEnd,
    );
    const state = `${opts.stateSummary}\n---\n${render(context)}`;
    let local = batchStart;
    for (let iter = 0; iter < 12 && local < regionEnd; iter++) {
      const anchorId = sentences[local].id;
      const key = `scene_start:${anchorId}`;
      const options = [
        ...sentences.slice(local, regionEnd).map((s) => s.id),
        "NONE",
      ];
      const answers = await decide(state, [
        {
          key,
          primitive: "choice",
          instructions: `A new scene begins where the place changes, time skips, or the viewpoint shifts. Which sentence id BEGINS the next scene at or after ${anchorId}? Pick the first sentence of the next scene, or NONE if no new scene begins in the rest of this passage.`,
          options,
        },
      ]);
      const a = choiceValue(answers, key);
      const conf = a?.confidence ?? 0;
      if (conf < opts.gates.reask) {
        escalations.push({
          unitId: anchorId,
          reason: `scene start decision too uncertain (${conf.toFixed(2)})`,
        });
      }
      if (!a || a.value === "NONE" || a.value === "") break;
      const s = typeof a.value === "string" ? idxOf.get(a.value) : undefined;
      if (s === undefined || s < local) break;
      if (s <= cur.start) {
        // Pointed at the open scene's own start: not a new boundary.
        local = s + 1;
        continue;
      }
      if (cur.end !== null && s - 1 - cur.end > 10) {
        escalations.push({
          unitId: sentences[cur.end + 1].id,
          reason: `possible missed boundary between the provisional end ${sentences[cur.end].id} and the next chosen start ${sentences[s].id}`,
        });
      }
      closed.push([cur.start, s - 1]);
      await opts.onSpan?.(spansNow());
      cur = { start: s, end: null };
      await askEnd(regionEnd);
      local = (cur.end ?? s) + 1;
    }
  }
  closed.push([cur.start, n - 1]);

  return { spans: spansNow(), escalations, unitConfidences };
}

/**
 * What each sentence of a block is, asked a window at a time as one structured document (Jev's structured input,
 * docs.typesafe.ai/concepts/state and /primitives/advanced): the state is a JSON object holding the kinds' definitions once
 * and the window's sentences keyed by id (with the sentences before it as context only), and each question names its
 * sentence by path (`passage.<id>`), so a question costs a few tokens instead of repeating the definitions. Every question
 * of a window goes in one request (parallel questions: one call, not a chain of start and end questions), and the windows
 * run at the same time. For each sentence: is it spoken aloud, thought (a person's inner voice, feelings in their head,
 * talking to themself), a fact (background knowledge of the world: how things are, what a place or a power is, history —
 * not this scene's happening), an action or movement by someone or something that matters (a person, a crowd, an important
 * thing, a building or a place), or a jump back in time (the user's rule, 2026-10-30), a description of the surroundings (the environment: a place, the
 * weather, the light, what stands around), or narration; and does the sentence's carrier change there (the user's v2 flow,
 * 2026-10-30: who carries it — the speaker, the one acting, or what it is about — and so the people taking part).
 *
 * From that (the user's rules, 2026-10-30): a dialogue exchange runs as long as the same people are talking, narration and
 * actions between the lines inside it (actions are extracted apart, as events); it ends where the people talking change, or
 * after a long stretch with no one speaking. A monologue is a run of thought, a few narration or action sentences inside
 * it. Facts are kept as the world's background knowledge. Units are sentence indices of the block. The questions' keys
 * (`dlg_kind:<sentence>`, `dlg_turn:<sentence>`) are the dialogue faculty's, so reviewer and recall pins apply to them.
 */
export const SENTENCE_KINDS = {
  spoken: "spoken aloud: a line of speech someone says to someone (or shouts, announces)",
  thought: "a person's inner voice: their thoughts, feelings in their head, or talking to themself (a monologue)",
  fact: "background knowledge of the world: how things are, what a place, a group, a power or a thing is, its history or rules — not something happening in this scene",
  action: "an action or a movement by someone or something that matters: a person or a crowd, an important object, weapon or vehicle, a building or a place acts, moves or changes; or the story goes back in time (a flashback). Something happening in the background with no one who matters in it is narration",
  environment: "a description of the surroundings: a place, a building or a room, the street, the weather, the light, what stands around",
  narration: "narration: how someone looks or feels, the scene's mood, commentary, a passage of time, and what happens in the background with no one who matters in it (a passing machine's noise)",
} as const;
export type SentenceKind = keyof typeof SENTENCE_KINDS;
/** Each kind in a few words, as its choice's criterion (the full definition is in the document's `kinds`). */
const KIND_LABELS: Record<SentenceKind, string> = {
  spoken: "said aloud to someone",
  thought: "a person's inner voice, or talking to themself",
  fact: "background knowledge of the world",
  action: "who or what matters acts or moves; a flashback",
  environment: "the surroundings: a place, weather, things",
  narration: "looks, feelings, mood, commentary, background",
};
/** The carrier of a sentence: who speaks it, who acts in it, or what it is about. It changes where the people taking part do. */
const TURN = {
  true: "the people taking part change here: someone new speaks, acts or is spoken to, someone who was taking part has gone, or it turns to another subject or place",
  false: "the same people go on (talking, even taking turns, or acting), or it stays on the same subject",
};
/**
 * Sentences classified a request (each with two questions: about 120 tokens, so a window is well inside Jev's 64k-token
 * request), the sentences before them shown as context only, and the windows asked at once.
 */
const CLASSIFY = 100, CONTEXT = 8, WINDOWS_AT_ONCE = 4;
/** A conversation that goes this many sentences with no one speaking has ended. */
const QUIET = 8;
/** A monologue keeps at most this many narration or action sentences inside it. */
const ASIDE = 2;

/** The structured document a window's questions are about (the request's state). */
export function sentenceDocument(task: string, before: Sentence[], asked: Sentence[]) {
  return {
    task: `${task} Classify every sentence of the passage (sentences keyed by id, in reading order).`.trim(),
    kinds: { ...SENTENCE_KINDS },
    change: `A sentence's carrier is who speaks it, who acts in it, or what it is about. It changes when ${TURN.true}.`,
    ...(before.length ? { before: Object.fromEntries(before.map((sentence) => [sentence.id, sentence.text])) } : {}),
    passage: Object.fromEntries(asked.map((sentence) => [sentence.id, sentence.text])),
  };
}

export async function classifySentences(
  sentences: Sentence[],
  decide: DecideFn,
  opts: { stateSummary: string; onBatch?: (through: number, kinds: SentenceKind[], turns: number[]) => Promise<void> },
): Promise<{ kinds: SentenceKind[]; confidence: number[]; turns: number[] }> {
  const kinds: SentenceKind[] = [], confidence: number[] = [], turns: number[] = [];
  const windows = Array.from({ length: Math.ceil(sentences.length / CLASSIFY) }, (_, w) => w * CLASSIFY);
  const done = new Map<number, DecisionAnswer[]>();
  let next = 0, published = 0, publishing = Promise.resolve();
  // Windows finish in any order; their answers join the kinds in reading order, and each finished prefix is published.
  const publish = async () => {
    while (done.has(windows[published])) {
      const b = windows[published], answers = done.get(b)!;
      for (const sentence of sentences.slice(b, b + CLASSIFY)) {
        const kind = choiceValue(answers, `dlg_kind:${sentence.id}`), turn = answers.find((answer) => answer.key === `dlg_turn:${sentence.id}`);
        kinds.push((kind?.value && kind.value in SENTENCE_KINDS ? kind.value : "narration") as SentenceKind);
        confidence.push(kind?.confidence ?? 0);
        turns.push(Number(turn?.value ?? 0));
      }
      published++;
      await opts.onBatch?.(Math.min(sentences.length, b + CLASSIFY) - 1, kinds, turns);
    }
  };
  await Promise.all(Array.from({ length: Math.min(WINDOWS_AT_ONCE, windows.length) }, async () => {
    while (next < windows.length) {
      const b = windows[next++], asked = sentences.slice(b, b + CLASSIFY), before = sentences.slice(Math.max(0, b - CONTEXT), b);
      done.set(b, await decide(sentenceDocument(opts.stateSummary, before, asked), asked.flatMap((sentence) => [
        { key: `dlg_kind:${sentence.id}`, primitive: "choice" as const, instructions: `What kind of sentence is passage.${sentence.id}? (The kinds are defined in kinds.)`, options: Object.keys(SENTENCE_KINDS), optionHints: { ...KIND_LABELS } },
        { key: `dlg_turn:${sentence.id}`, primitive: "noul" as const, instructions: `At passage.${sentence.id}, does the carrier change?`, noulCriteria: TURN },
      ])));
      publishing = publishing.then(publish);
      await publishing;
    }
  }));
  return { kinds, confidence, turns };
}

/** Dialogue exchanges, monologues and fact runs from the sentences' kinds (indices, first and last). */
export function spansOfKinds(kinds: SentenceKind[], turns: number[]): { dialogues: [number, number][]; monologues: [number, number][]; facts: [number, number][] } {
  const dialogues: [number, number][] = [], monologues: [number, number][] = [], facts: [number, number][] = [];
  let talk: [number, number] | null = null, quiet = 0, inner: [number, number] | null = null, aside = 0;
  for (let i = 0; i < kinds.length; i++) {
    const kind = kinds[i];
    if (kind === "spoken") {
      if (talk && turns[i] >= 0.5) { dialogues.push(talk); talk = null; }
      if (talk) talk[1] = i; else talk = [i, i];
      quiet = 0;
    } else if (talk && ++quiet > QUIET) { dialogues.push(talk); talk = null; }
    if (kind === "thought") { if (inner) inner[1] = i; else inner = [i, i]; aside = 0; }
    else if (inner && (kind === "spoken" || ++aside > ASIDE)) { monologues.push(inner); inner = null; }
    if (kind === "fact") { const last = facts[facts.length - 1]; if (last && last[1] === i - 1) last[1] = i; else facts.push([i, i]); }
  }
  if (talk) dialogues.push(talk);
  if (inner) monologues.push(inner);
  return { dialogues, monologues, facts };
}

/** A card's kind: a sentence kind (a run of it), or an exchange or a monologue over such runs. */
export type CardKind = SentenceKind | "dialogue" | "monologue";
/** Where a card goes (the user's v2 flow): the world engine plays dialogue, action and environment; thought, fact and narration go to the ontology. */
export const CARD_HOME: Record<CardKind, "world" | "ontology"> = { dialogue: "world", spoken: "world", action: "world", environment: "world", thought: "ontology", monologue: "ontology", fact: "ontology", narration: "ontology" };
export interface KindCard { id: string; kind: CardKind; home: "world" | "ontology"; first: string; last: string; inside?: string[] }

/**
 * A block's cards from its sentences' kinds (the user's v2 flow, 2026-10-30): adjacent sentences of one kind are one card, a
 * new card where the carrier changes. Exchanges and monologues (spansOfKinds) are cards over those runs, nested: a dialogue
 * card holds the runs inside it (its spoken lines, and the actions and narration between them), so an action inside a
 * conversation is still an action card for the world engine. `ids` are the sentences' ids, in the order of `kinds`.
 */
export function kindCards(ids: string[], kinds: SentenceKind[], turns: number[]): KindCard[] {
  const card = (kind: CardKind, first: number, last: number): KindCard => ({ id: `${kind}:${ids[first]}`, kind, home: CARD_HOME[kind], first: ids[first], last: ids[last] });
  const runs: [SentenceKind, number, number][] = [];
  for (let i = 0; i < kinds.length; i++) {
    const run = runs[runs.length - 1];
    if (run && run[0] === kinds[i] && run[2] === i - 1 && !(turns[i] >= 0.5)) run[2] = i;
    else runs.push([kinds[i], i, i]);
  }
  const { dialogues, monologues } = spansOfKinds(kinds, turns);
  const over = (kind: CardKind, spans: [number, number][]): KindCard[] => spans.map(([first, last]) => ({ ...card(kind, first, last), inside: runs.filter(([, from, to]) => from >= first && to <= last).map(([inner, from, to]) => card(inner, from, to).id) }));
  const order = new Map(ids.map((id, index) => [id, index]));
  return [...runs.map(([kind, first, last]) => card(kind, first, last)), ...over("dialogue", stitchDialogueSpans(dialogues)), ...over("monologue", monologues)]
    .sort((a, b) => order.get(a.first)! - order.get(b.first)! || order.get(b.last)! - order.get(a.last)!);
}

/**
 * The block's dialogue exchanges (and its monologues and facts), from the sentences' kinds (`classifySentences`): the same
 * interface the chained start-and-end questions had, `onBatch` with the spans finished through each window.
 */
export async function selectExchangeSpans(
  sentences: Sentence[],
  decide: DecideFn,
  opts: { stateSummary: string; gates: SegmentationGates; onBatch?: (spans: [number, number][], completeThrough: number) => Promise<void> },
): Promise<{
  spans: [number, number][];
  monologues: [number, number][];
  facts: [number, number][];
  escalations: SpanEscalation[];
  unitConfidences: Record<string, number>;
}> {
  const { kinds, confidence, turns } = await classifySentences(sentences, decide, { stateSummary: opts.stateSummary, onBatch: async (through, soFar, turnsSoFar) => {
    if (!opts.onBatch) return;
    // The exchanges settled so far: one still open near the window's end may run on into the next.
    const settled = through === sentences.length - 1 ? through + 1 : through - QUIET, { dialogues } = spansOfKinds(soFar, turnsSoFar);
    await opts.onBatch(stitchDialogueSpans(dialogues.filter(([, end]) => end < settled)), Math.max(-1, Math.min(through, settled)));
  } });
  const { dialogues, monologues, facts } = spansOfKinds(kinds, turns);
  const escalations: SpanEscalation[] = [], unitConfidences: Record<string, number> = {};
  for (const [start] of [...dialogues, ...monologues]) {
    unitConfidences[sentences[start].id] = confidence[start];
    if (confidence[start] < opts.gates.reask) escalations.push({ unitId: sentences[start].id, reason: `the kind of sentence ${sentences[start].id} is too uncertain (${confidence[start].toFixed(2)})` });
  }
  return { spans: stitchDialogueSpans(dialogues), monologues, facts, escalations, unitConfidences };
}

function stitchDialogueSpans(raw: [number, number][]): [number, number][] {
  const sorted = raw.map(([start, end]): [number, number] => [start, end]).sort((left, right) => left[0] - right[0] || left[1] - right[1]);
  const merged: [number, number][] = [];
  for (const span of sorted) {
    const last = merged[merged.length - 1];
    if (last && span[0] <= last[1]) {
      const overlap = last[1] - span[0] + 1;
      if (overlap >= 3) {
        if (span[1] > last[1]) last[1] = span[1];
        continue;
      }
      span[0] = last[1] + 1;
      if (span[0] > span[1]) continue;
    }
    merged.push([...span]);
  }

  return merged;
}

/**
 * Link exchange spans (index ranges) to the scene partition: the
 * scene holding the exchange's first sentence, plus the one holding
 * its last when they differ (the straddle case). Pure join — runs
 * after the scene and dialogue pipelines complete, in any order.
 */
export function linkExchangeScenes(
  sentences: Sentence[],
  spans: [number, number][],
  sceneSpans: string[][],
): number[][] {
  const idxById = new Map(sentences.map((s, i) => [s.id, i]));
  const sceneOf = new Array<number>(sentences.length).fill(-1);
  sceneSpans.forEach((span, si) => {
    for (const id of span) {
      const idx = idxById.get(id);
      if (idx !== undefined) sceneOf[idx] = si;
    }
  });
  return spans.map(([a, b]) => {
    const first = sceneOf[a];
    const lastS = sceneOf[b];
    const links = [first];
    if (lastS !== first && lastS >= 0) links.push(lastS);
    return links.filter((x) => x >= 0);
  });
}

/**
 * Select dialogue exchanges over the block and link each to the scene
 * (or two scenes, when it straddles a cut) it belongs to. Units are
 * sentence-id arrays; unitScenes[i] holds the scene-span indices for
 * units[i], one or two entries.
 */
export async function selectExchanges(
  sentences: Sentence[],
  sceneSpans: string[][],
  decide: DecideFn,
  opts: { stateSummary: string; gates: SegmentationGates },
): Promise<{
  units: string[][];
  unitScenes: number[][];
  escalations: SpanEscalation[];
  unitConfidences: Record<string, number>;
}> {
  const { spans, escalations, unitConfidences } = await selectExchangeSpans(
    sentences,
    decide,
    opts,
  );
  return {
    units: spans.map(([a, b]) => sentences.slice(a, b + 1).map((s) => s.id)),
    unitScenes: linkExchangeScenes(sentences, spans, sceneSpans),
    escalations,
    unitConfidences,
  };
}
