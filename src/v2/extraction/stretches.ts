import type { DecisionAnswer, DecisionQuestion } from "../../ground/connectors/jev.js";
import type { Sentence } from "../../digger/intake/sectioning.js";
import { BLOCK_TYPES, type BlockType } from "../../digger/autostep/segmentation.js";
import { ask, type Asker } from "../context/engine.js";
import { stretchCutMode, stretchTypeMode } from "../context/readingModes.js";

/**
 * One tiling for the whole reading (the user, 2026-11-04: "there's no more scene needed anymore. Everything runs on segment
 * level. You should make segment and scene reading the same thing, just a prompt level change, no two prompts for two
 * levels"). The book is cut once, into stretches, and a stretch is what every later step calls a scene: who is there,
 * where and when it is, and what kind it is. One question a sentence says whether it continues the stretch before it or
 * begins a new one, and why: elsewhere (the place, the time or the point of view changes: what a scene change was) or of
 * another kind (what the passage is doing changes: what a segment change was, M14). Each stretch is then typed with one of
 * the nine kinds, and the types are smoothed over the sentences between two changes of place or time, with Jev's own
 * probability of a change of kind as the chance the type changes there (M14's tuning: a one-line island survives only
 * where its type's evidence outweighs the stretch round it). No length rule anywhere.
 */
export const STRETCH_TASK =
  "A novel, sentence by sentence, to be cut into stretches. Every later step works on one stretch at a time: who is there, where and when it is, and what kind of stretch it is. A different specialist of a film crew takes over for each kind in stretches (a fight choreographer, a chase unit, someone for inner voices, for phone calls, for scenery). Say for each sentence whether it continues the stretch before it or begins a new one. A new stretch begins where the place, the time or the point of view changes, or where what the passage is doing changes kind and a different specialist would take over; not where a speaker, a sentence, a blow or a moment changes within the same kind.";
export const BOUNDARY = {
  continues: "the same stretch goes on: the same place, time and point of view, and the same kind (the talk continues as speakers alternate, blows keep being exchanged, the thought, the memory or the description continues)",
  elsewhere: "a new stretch begins elsewhere: another place, another time (later on, or back in a memory), or another point of view",
  kind: "a new stretch of another kind begins here, in the same place and time: talk turns into a fight, a fight into a chase or an escape, action into someone's inner thought, scene-setting into events, background into people acting, or back",
} as const;
export type Boundary = keyof typeof BOUNDARY;
const TYPES = Object.keys(BLOCK_TYPES) as BlockType[];
/** Jev's request window (the kinds pass's): sentences asked a request, and those before shown as context. */
const REQUEST = 100, CONTEXT = 8;
/** Stretches typed a request, and how much of each one's text is shown. */
const TYPED = 40, SHOWN = 3000;

/** A stretch: its sentences, how it began (elsewhere, of another kind; the block's first begins elsewhere), Jev's probability of that change at its first sentence, and its kind with the whole distribution. */
export interface Stretch {
  sentences: string[];
  start: "elsewhere" | "kind";
  change: number | null;
  type: BlockType | null;
  confidence: number;
  distribution: Record<string, number>;
  smoothed: Record<string, number>;
  top: [string, number][];
}

const round = (value: number, places = 3) => Math.round(value * 10 ** places) / 10 ** places;
const mean = (list: Record<string, number>[]) => {
  const sum: Record<string, number> = {};
  for (const entry of list) for (const [type, p] of Object.entries(entry)) sum[type] = (sum[type] ?? 0) + p / list.length;
  return Object.fromEntries(Object.entries(sum).map(([type, p]) => [type, round(p)]));
};

/**
 * Each sentence's kind, smoothed: forward-backward over a span's sentences, each observing its stretch's type distribution
 * (mixed toward even as Jev was less sure of it), the type changing at a sentence as likely as Jev held a stretch of
 * another kind to begin there. The runs of one most likely type, and each sentence's posterior.
 */
export function smoothedRuns(ids: string[], move: (id: string) => number, observed: Record<string, { distribution: Record<string, number>; confidence: number }>) {
  const T = TYPES.length, normal = (row: number[]) => { const sum = row.reduce((a, b) => a + b, 0) || 1; return row.map((v) => v / sum); };
  const emit = (id: string) => { const { distribution = {}, confidence = 0 } = observed[id] ?? {}; return TYPES.map((type) => Math.max(1e-3, confidence * (distribution[type] ?? 0) + (1 - confidence) / T)); };
  const at = (k: number) => (k ? move(ids[k]) : 0);
  const forward: number[][] = [normal(emit(ids[0]))];
  for (let k = 1; k < ids.length; k++) { const e = emit(ids[k]), m = at(k); forward.push(normal(TYPES.map((_, t) => e[t] * forward[k - 1].reduce((sum, p, s) => sum + p * (s === t ? 1 - m : m / (T - 1)), 0)))); }
  const backward: number[][] = new Array(ids.length); backward[ids.length - 1] = TYPES.map(() => 1 / T);
  for (let k = ids.length - 2; k >= 0; k--) { const e = emit(ids[k + 1]), m = at(k + 1); backward[k] = normal(TYPES.map((_, s) => TYPES.reduce((sum, __, t) => sum + (s === t ? 1 - m : m / (T - 1)) * e[t] * backward[k + 1][t], 0))); }
  const runs: { first: number; last: number; type: BlockType; confidence: number }[] = [], posterior: Record<string, Record<string, number>> = {};
  ids.forEach((id, k) => {
    const post = normal(forward[k].map((p, t) => p * backward[k][t])), best = post.indexOf(Math.max(...post)), type = TYPES[best];
    posterior[id] = Object.fromEntries(TYPES.map((name, t) => [name, round(post[t])]));
    if (runs.at(-1)?.type === type) runs.at(-1)!.last = k; else runs.push({ first: k, last: k, type, confidence: round(post[best], 2) });
  });
  return { runs, posterior };
}

/** The distribution an answer gives (its own, else its value at its confidence, the rest spread evenly). */
function distributionOf(answer: DecisionAnswer | undefined, options: readonly string[]): Record<string, number> {
  if (answer?.distribution && Object.keys(answer.distribution).length) return Object.fromEntries(options.map((option) => [option, Number(answer.distribution?.[option] ?? 0)]));
  const value = String(answer?.value ?? options[0]), confidence = Number(answer?.confidence ?? 1);
  return Object.fromEntries(options.map((option) => [option, option === value ? confidence : (1 - confidence) / Math.max(1, options.length - 1)]));
}

/** Cut a block's sentences into stretches (above). Every sentence in exactly one stretch, in order. */
export async function tileStretches(sentences: Sentence[], decide: Asker): Promise<Stretch[]> {
  if (!sentences.length) return [];
  const options = Object.keys(BOUNDARY) as Boundary[];
  // 1. Every sentence after the block's first: continues, elsewhere, or of another kind.
  const boundary = new Map<string, Record<string, number>>();
  const windows = Array.from({ length: Math.ceil(sentences.length / REQUEST) }, (_, n) => n * REQUEST);
  await Promise.all(windows.map(async (from) => {
    const asked = sentences.slice(from, from + REQUEST), before = sentences.slice(Math.max(0, from - CONTEXT), from);
    const questions: DecisionQuestion[] = asked.filter((sentence) => sentence.id !== sentences[0].id).map((sentence) => ({ key: `stretch:${sentence.id}`, primitive: "choice", instructions: `Does passage.${sentence.id} continue the stretch before it, or begin a new one?`, options: [...options], optionHints: { ...BOUNDARY } }));
    if (!questions.length) return;
    const { replies } = await ask(decide, stretchCutMode, { before, asked, questions }, null);
    for (const question of questions) boundary.set(question.key.slice("stretch:".length), distributionOf(replies.find((reply) => reply.key === question.key), options));
  }));
  const pOf = (id: string) => boundary.get(id) ?? { continues: 1, elsewhere: 0, kind: 0 };
  // 2. Spans between changes of place, time or point of view (more likely than not), and within them the stretches as
  // asked: where a new stretch of either kind is more likely than not.
  const spans: number[][] = [];
  sentences.forEach((sentence, k) => { if (!k || pOf(sentence.id).elsewhere > 0.5) spans.push([k]); else spans.at(-1)!.push(k); });
  const asked: { span: number; sentences: number[] }[] = [];
  spans.forEach((span, s) => span.forEach((k, n) => { const p = pOf(sentences[k].id); if (!n || p.elsewhere + p.kind > 0.5) asked.push({ span: s, sentences: [k] }); else asked.at(-1)!.sentences.push(k); }));
  // 3. The kind of each stretch as asked, many in one document.
  const typed = new Map<number, { distribution: Record<string, number>; confidence: number }>();
  await Promise.all(Array.from({ length: Math.ceil(asked.length / TYPED) }, (_, n) => n * TYPED).map(async (from) => {
    const group = asked.slice(from, from + TYPED);
    const stretches = group.map((stretch, k) => ({ key: `stretch_${from + k + 1}`, text: stretch.sentences.map((at) => sentences[at].text).join("").slice(0, SHOWN) }));
    const questions: DecisionQuestion[] = group.map((_, k) => ({ key: `stretch_type:${from + k + 1}`, primitive: "choice", instructions: `What is stretches.stretch_${from + k + 1} mostly about (one of kinds)?`, options: [...TYPES], optionHints: { ...BLOCK_TYPES } }));
    const { replies } = await ask(decide, stretchTypeMode, { stretches, questions }, null);
    group.forEach((_, k) => { const reply = replies.find((entry) => entry.key === `stretch_type:${from + k + 1}`); typed.set(from + k, { distribution: distributionOf(reply, TYPES), confidence: Number(reply?.confidence ?? 0) }); });
  }));
  // 4. Smoothed within each span: the stretches are its runs of one most likely kind.
  const out: Stretch[] = [];
  spans.forEach((span, s) => {
    const ids = span.map((k) => sentences[k].id), observed: Record<string, { distribution: Record<string, number>; confidence: number }> = {};
    asked.forEach((stretch, n) => { if (stretch.span === s) for (const k of stretch.sentences) observed[sentences[k].id] = typed.get(n) ?? { distribution: {}, confidence: 0 }; });
    const { runs, posterior } = smoothedRuns(ids, (id) => pOf(id).kind, observed);
    runs.forEach((run, r) => {
      const own = ids.slice(run.first, run.last + 1), first = own[0], p = pOf(first), smoothed = mean(own.map((id) => posterior[id]));
      out.push({
        sentences: own, start: r ? "kind" : "elsewhere", change: span[run.first] === 0 ? null : round(r ? p.kind + p.elsewhere : p.elsewhere),
        type: run.type, confidence: run.confidence, distribution: mean(own.map((id) => observed[id]?.distribution ?? {})), smoothed,
        top: Object.entries(smoothed).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([type, p_]) => [type, round(p_, 2)]),
      });
    });
  });
  return out;
}
