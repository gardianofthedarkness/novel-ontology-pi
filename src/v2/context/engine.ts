import type { DecisionAnswer, DecisionQuestion, DecisionState } from "../../ground/connectors/jev.js";

/**
 * The context composing engine (docs/v2/context-engine.md; layer 3 of docs/v2/world-model.md): one way to compose the state
 * of a Jev request. A mode is a recipe: its sources and their quotas, the order to cut in, how its questions are written.
 * A source ranks items for a focus from the stores; it never decides. The probe measures the focus's surroundings (each
 * stat 0..1) and the plan scales every quota by the complexity they come to (0.75 + 0.75 × complexity). The budget (the
 * state's characters) cuts in the mode's order, weakest first, never the focus's own sources. The render writes one
 * document keyed by id. The manifest records the stats, the plan, every item kept and every item cut, and why. The same
 * stores and focus give the same document, so the answer cache keeps working. Every Jev request goes through it (the
 * user's call, 2026-10-31): the reading's (readingModes.ts), place EM's (placeModes.ts) and terrain's (terrainModes.ts).
 */
export interface Item { id: string; fields: unknown; score: number; why?: string }
export interface Source<F, S> {
  name: string;
  /** The state's key the items render under. */
  key: string;
  quota: number;
  /** The focus itself (what is asked, the options): never cut, in its own order. */
  keep?: boolean;
  /** Its items come ranked by the step's own recommender: they keep that order (the quota and the budget still cut). */
  ranked?: boolean;
  /** Its key is in the document even with no items (an empty map). */
  always?: boolean;
  collect(focus: F, stores: S): Item[] | Promise<Item[]>;
}
export interface Mode<F, S> {
  name: string;
  task: string | ((focus: F) => string);
  definitions?: Record<string, unknown>;
  sources: Source<F, S>[];
  /** Over budget, cut from these sources in this order. */
  cutOrder: string[];
  /** The stats of the surroundings, each 0..1, and their weights in the complexity (equal by default). */
  probe?(focus: F, stores: S): Record<string, number>;
  weights?: Record<string, number>;
  questions(focus: F, kept: Record<string, Item[]>): DecisionQuestion[];
  /** Characters of the state. */
  budget: number;
  /** The document Jev is sent, where the mode writes it otherwise than as the state (a prompt of plain text). */
  render?(state: Record<string, unknown>): DecisionState;
}
export interface ManifestEntry { source: string; id: string; score: number; cost: number; kept: boolean; cut?: "quota" | "budget"; why?: string }
export interface Manifest { mode: string; stats: Record<string, number>; complexity: number; scale: number; budget: number; used: number; entries: ManifestEntry[] }
/** `document` is what Jev is sent: the state, or the mode's own render of it. */
export interface Composed { state: Record<string, unknown>; document: DecisionState; questions: DecisionQuestion[]; manifest: Manifest }
/** A step's way to Jev; `record`, where the step's caller keeps them, takes every request's manifest. */
export type Asker = ((state: DecisionState, questions: DecisionQuestion[], options?: never) => Promise<DecisionAnswer[]>) & { record?: (manifest: Manifest) => void };

const unit = (value: number) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0));
const round = (value: number) => Number(value.toFixed(3));

export async function compose<F, S>(mode: Mode<F, S>, focus: F, stores: S, options: { budget?: number } = {}): Promise<Composed> {
  const stats = Object.fromEntries(Object.entries(mode.probe?.(focus, stores) ?? {}).map(([key, value]) => [key, round(unit(value))]));
  const weight = (key: string) => mode.weights?.[key] ?? 1, keys = Object.keys(stats);
  const complexity = keys.length ? round(keys.reduce((sum, key) => sum + weight(key) * stats[key], 0) / keys.reduce((sum, key) => sum + weight(key), 0)) : 0;
  const scale = round(0.75 + 0.75 * complexity), budget = options.budget ?? mode.budget;
  const entries: ManifestEntry[] = [], kept: Record<string, (Item & { cost: number })[]> = {};
  for (const source of mode.sources) {
    // The focus keeps its own order; every other source, the strongest first.
    const collected = [...(await source.collect(focus, stores))], items = source.keep || source.ranked ? collected : collected.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const quota = source.keep ? items.length : Math.max(1, Math.round(source.quota * scale));
    kept[source.name] = [];
    items.forEach((item, n) => {
      const cost = JSON.stringify(item.fields).length;
      if (n < quota) kept[source.name].push({ ...item, cost });
      else entries.push({ source: source.name, id: item.id, score: item.score, cost, kept: false, cut: "quota", ...(item.why ? { why: item.why } : {}) });
    });
  }
  const render = () => {
    const state: Record<string, unknown> = { task: typeof mode.task === "function" ? mode.task(focus) : mode.task, ...(mode.definitions ?? {}) };
    for (const source of mode.sources) if (kept[source.name].length || source.always) state[source.key] = { ...(state[source.key] as Record<string, unknown> ?? {}), ...Object.fromEntries(kept[source.name].map((item) => [item.id, item.fields])) };
    return state;
  };
  const size = (state: Record<string, unknown>) => { const document = mode.render ? mode.render(state) : state; return typeof document === "string" ? document.length : JSON.stringify(document).length; };
  let state = render(), used = size(state);
  // Over budget: the weakest item of the first source in the cut order that still has one, until it fits or nothing is left to cut.
  while (used > budget) {
    const from = mode.cutOrder.find((name) => kept[name]?.length && !mode.sources.find((source) => source.name === name)?.keep);
    if (!from) break;
    const item = kept[from].pop()!;
    entries.push({ source: from, id: item.id, score: item.score, cost: item.cost, kept: false, cut: "budget", ...(item.why ? { why: item.why } : {}) });
    state = render(); used = size(state);
  }
  for (const source of mode.sources) for (const item of kept[source.name]) entries.push({ source: source.name, id: item.id, score: item.score, cost: item.cost, kept: true, ...(item.why ? { why: item.why } : {}) });
  const plain = Object.fromEntries(Object.entries(kept).map(([name, items]) => [name, items.map(({ cost: _, ...item }) => item)]));
  return { state, document: mode.render ? mode.render(state) : state, questions: mode.questions(focus, plain), manifest: { mode: mode.name, stats, complexity, scale, budget, used, entries } };
}

/** Compose, record the manifest with the asker, and ask Jev (nothing is asked where the mode has no question). */
export async function ask<F, S>(decide: Asker, mode: Mode<F, S>, focus: F, stores: S, options: { budget?: number; request?: unknown } = {}): Promise<{ replies: DecisionAnswer[]; composed: Composed }> {
  const composed = await compose(mode, focus, stores, { budget: options.budget });
  decide.record?.(composed.manifest);
  const replies = composed.questions.length ? await (decide as (state: DecisionState, questions: DecisionQuestion[], request?: unknown) => Promise<DecisionAnswer[]>)(composed.document, composed.questions, options.request) : [];
  return { replies, composed };
}
