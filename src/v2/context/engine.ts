import type { DecisionQuestion } from "../../ground/connectors/jev.js";

/**
 * The context composing engine (docs/v2/context-engine.md; layer 3 of docs/v2/world-model.md): one way to compose the state
 * of a Jev request. A mode is a recipe: its sources and their quotas, the order to cut in, how its questions are written.
 * A source ranks items for a focus from the stores; it never decides. The probe measures the focus's surroundings (each
 * stat 0..1) and the plan scales every quota by the complexity they come to (0.75 + 0.75 × complexity). The budget (the
 * state's characters) cuts in the mode's order, weakest first, never the focus's own sources. The render writes one
 * document keyed by id. The manifest records the stats, the plan, every item kept and every item cut, and why. The same
 * stores and focus give the same document, so the answer cache keeps working.
 */
export interface Item { id: string; fields: unknown; score: number; why?: string }
export interface Source<F, S> {
  name: string;
  /** The state's key the items render under. */
  key: string;
  quota: number;
  /** The focus itself (what is asked, the options): never cut. */
  keep?: boolean;
  collect(focus: F, stores: S): Item[] | Promise<Item[]>;
}
export interface Mode<F, S> {
  name: string;
  task: string;
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
}
export interface ManifestEntry { source: string; id: string; score: number; cost: number; kept: boolean; cut?: "quota" | "budget"; why?: string }
export interface Manifest { mode: string; stats: Record<string, number>; complexity: number; scale: number; budget: number; used: number; entries: ManifestEntry[] }
export interface Composed { state: Record<string, unknown>; questions: DecisionQuestion[]; manifest: Manifest }

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
    const collected = [...(await source.collect(focus, stores))], items = source.keep ? collected : collected.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const quota = source.keep ? items.length : Math.max(1, Math.round(source.quota * scale));
    kept[source.name] = [];
    items.forEach((item, n) => {
      const cost = JSON.stringify(item.fields).length;
      if (n < quota) kept[source.name].push({ ...item, cost });
      else entries.push({ source: source.name, id: item.id, score: item.score, cost, kept: false, cut: "quota", ...(item.why ? { why: item.why } : {}) });
    });
  }
  const render = () => {
    const state: Record<string, unknown> = { task: mode.task, ...(mode.definitions ?? {}) };
    for (const source of mode.sources) if (kept[source.name].length) state[source.key] = { ...(state[source.key] as Record<string, unknown> ?? {}), ...Object.fromEntries(kept[source.name].map((item) => [item.id, item.fields])) };
    return state;
  };
  let state = render(), used = JSON.stringify(state).length;
  // Over budget: the weakest item of the first source in the cut order that still has one, until it fits or nothing is left to cut.
  while (used > budget) {
    const from = mode.cutOrder.find((name) => kept[name]?.length && !mode.sources.find((source) => source.name === name)?.keep);
    if (!from) break;
    const item = kept[from].pop()!;
    entries.push({ source: from, id: item.id, score: item.score, cost: item.cost, kept: false, cut: "budget", ...(item.why ? { why: item.why } : {}) });
    state = render(); used = JSON.stringify(state).length;
  }
  for (const source of mode.sources) for (const item of kept[source.name]) entries.push({ source: source.name, id: item.id, score: item.score, cost: item.cost, kept: true, ...(item.why ? { why: item.why } : {}) });
  const plain = Object.fromEntries(Object.entries(kept).map(([name, items]) => [name, items.map(({ cost: _, ...item }) => item)]));
  return { state, questions: mode.questions(focus, plain), manifest: { mode: mode.name, stats, complexity, scale, budget, used, entries } };
}
