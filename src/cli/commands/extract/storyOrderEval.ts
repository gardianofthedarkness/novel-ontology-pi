import { readFile } from "node:fs/promises";

/**
 * Story-order evaluation: story time as a partial order, scored pair by pair.
 *
 * Gold (story-order-gold-v1, kept privately with the book) lists strands — a
 * character's or group's scenes in story order — and cross-strand edges with
 * the evidence for each. Two scenes are BEFORE/AFTER when a path of strands
 * and edges joins them and PARALLEL when none does: no evidence in the text
 * orders them (two places, cut between). Edges marked certain:false are
 * likely readings: a pair whose relation depends on one is left out, as are
 * pairs listed in uncertainPairs and excluded scenes (front matter, headings).
 *
 * Predictions come in three shapes:
 *   order — a total order of scene ids (what one story-time line asserts);
 *   ranks — scene id → rank, equal ranks unordered;
 *   dag   — happens-before edges; unconnected pairs are parallel.
 * No model calls, no thresholds: the report gives metrics only.
 */
export type Relation = "before" | "after" | "parallel";

export interface StoryOrderGold {
  policy: "story-order-gold-v1";
  scenes: string[];
  excluded?: { sceneId: string; reason?: string }[];
  strands: { id: string; label?: string; sceneIds: string[] }[];
  edges?: { from: string; to: string; certain?: boolean; note?: string }[];
  uncertainPairs?: [string, string][];
}

export type StoryOrderPrediction =
  | { kind: "order"; sceneIds: string[] }
  | { kind: "ranks"; ranks: Record<string, number> }
  | { kind: "dag"; edges: [string, string][] };

/** Reachability over a set of happens-before edges; throws on a cycle. */
function closure(ids: string[], edges: [string, string][]): (a: string, b: string) => boolean {
  const index = new Map(ids.map((id, at) => [id, at]));
  const next: number[][] = ids.map(() => []);
  for (const [from, to] of edges) {
    const a = index.get(from), b = index.get(to);
    if (a === undefined || b === undefined || a === b) continue;
    next[a].push(b);
  }
  const reach = ids.map((_, start) => {
    const seen = new Set<number>();
    const stack = [...next[start]];
    while (stack.length) {
      const at = stack.pop()!;
      if (seen.has(at)) continue;
      seen.add(at);
      stack.push(...next[at]);
    }
    if (seen.has(start)) throw new Error(`Story-order edges form a cycle through ${ids[start]}`);
    return seen;
  });
  return (a, b) => reach[index.get(a)!]?.has(index.get(b)!) ?? false;
}

const relationOf = (reaches: (a: string, b: string) => boolean, a: string, b: string): Relation => reaches(a, b) ? "before" : reaches(b, a) ? "after" : "parallel";

function strandEdges(gold: StoryOrderGold): [string, string][] {
  return gold.strands.flatMap((strand) => strand.sceneIds.slice(1).map((id, at) => [strand.sceneIds[at], id] as [string, string]));
}

function validateGold(input: unknown): StoryOrderGold {
  const gold = input as StoryOrderGold;
  if (!gold || gold.policy !== "story-order-gold-v1" || !Array.isArray(gold.scenes) || !Array.isArray(gold.strands)) throw new Error("Story-order evaluation expects story-order-gold-v1");
  const known = new Set(gold.scenes);
  const check = (id: unknown, where: string) => { if (typeof id !== "string" || !known.has(id)) throw new Error(`Unknown scene ${String(id)} in gold ${where}`); };
  for (const strand of gold.strands) strand.sceneIds.forEach((id) => check(id, `strand ${strand.id}`));
  for (const edge of gold.edges ?? []) { check(edge.from, "edge"); check(edge.to, "edge"); }
  for (const pair of gold.uncertainPairs ?? []) pair.forEach((id) => check(id, "uncertainPairs"));
  return gold;
}

function predictedRelation(prediction: StoryOrderPrediction, ids: string[]): (a: string, b: string) => Relation | null {
  if (prediction?.kind === "order" && Array.isArray(prediction.sceneIds)) {
    const at = new Map(prediction.sceneIds.map((id, index) => [id, index]));
    return (a, b) => !at.has(a) || !at.has(b) ? null : at.get(a)! < at.get(b)! ? "before" : "after";
  }
  if (prediction?.kind === "ranks" && prediction.ranks && typeof prediction.ranks === "object") {
    const rank = prediction.ranks;
    return (a, b) => typeof rank[a] !== "number" || typeof rank[b] !== "number" ? null : rank[a] < rank[b] ? "before" : rank[a] > rank[b] ? "after" : "parallel";
  }
  if (prediction?.kind === "dag" && Array.isArray(prediction.edges)) {
    const reaches = closure(ids, prediction.edges);
    return (a, b) => relationOf(reaches, a, b);
  }
  throw new Error("Story-order prediction must be {kind: order|ranks|dag}");
}

export function scoreStoryOrder(goldInput: unknown, predictionInput: unknown) {
  const gold = validateGold(goldInput);
  const excluded = new Set((gold.excluded ?? []).map((entry) => entry.sceneId));
  const ids = gold.scenes.filter((id) => !excluded.has(id));
  const certainEdges: [string, string][] = [...strandEdges(gold), ...(gold.edges ?? []).filter((edge) => edge.certain !== false).map((edge) => [edge.from, edge.to] as [string, string])];
  const allEdges: [string, string][] = [...certainEdges, ...(gold.edges ?? []).filter((edge) => edge.certain === false).map((edge) => [edge.from, edge.to] as [string, string])];
  const certain = closure(gold.scenes, certainEdges), likely = closure(gold.scenes, allEdges);
  const listed = new Set((gold.uncertainPairs ?? []).flatMap(([a, b]) => [`${a}|${b}`, `${b}|${a}`]));
  const predict = predictedRelation(predictionInput as StoryOrderPrediction, gold.scenes);
  const confusion: Record<Relation, Record<Relation | "missing", number>> = {
    before: { before: 0, after: 0, parallel: 0, missing: 0 }, after: { before: 0, after: 0, parallel: 0, missing: 0 }, parallel: { before: 0, after: 0, parallel: 0, missing: 0 },
  };
  let uncertain = 0;
  const errors: { a: string; b: string; gold: Relation; predicted: Relation | "missing" }[] = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    const a = ids[i], b = ids[j];
    const expected = relationOf(certain, a, b);
    if (listed.has(`${a}|${b}`) || expected !== relationOf(likely, a, b)) { uncertain++; continue; }
    const actual = predict(a, b) ?? "missing";
    confusion[expected][actual]++;
    if (actual !== expected) errors.push({ a, b, gold: expected, predicted: actual });
  }
  const total = (row: Record<string, number>) => Object.values(row).reduce((sum, value) => sum + value, 0);
  const goldOrdered = total(confusion.before) + total(confusion.after);
  const goldParallel = total(confusion.parallel);
  const correct = confusion.before.before + confusion.after.after + confusion.parallel.parallel;
  const predictedParallel = confusion.before.parallel + confusion.after.parallel + confusion.parallel.parallel;
  const ratio = (part: number, whole: number) => whole ? Math.round((part / whole) * 10000) / 10000 : null;
  // Where errors concentrate: scenes most often involved in a wrong pair.
  const blame = new Map<string, number>();
  for (const error of errors) for (const id of [error.a, error.b]) blame.set(id, (blame.get(id) ?? 0) + 1);
  return {
    policy: "story-order-v1",
    scenes: ids.length, excludedScenes: excluded.size, scoredPairs: goldOrdered + goldParallel, uncertainPairs: uncertain,
    goldOrderedPairs: goldOrdered, goldParallelPairs: goldParallel,
    pairAccuracy: ratio(correct, goldOrdered + goldParallel),
    orderedAccuracy: ratio(confusion.before.before + confusion.after.after, goldOrdered),
    reversedPairs: confusion.before.after + confusion.after.before,
    parallelRecall: ratio(confusion.parallel.parallel, goldParallel),
    parallelPrecision: ratio(confusion.parallel.parallel, predictedParallel),
    falseOrderPairs: confusion.parallel.before + confusion.parallel.after,
    missingPairs: confusion.before.missing + confusion.after.missing + confusion.parallel.missing,
    confusion,
    mostInvolvedScenes: [...blame.entries()].sort((first, second) => second[1] - first[1]).slice(0, 12).map(([sceneId, pairs]) => ({ sceneId, pairs })),
  };
}

/**
 * A time-place run report as a prediction: scenes ordered by their period's
 * estimated story index, then reading order (the single story-time line).
 * With ties, scenes of one period are left unordered instead.
 */
export function timeplacePrediction(report: { sceneTimes: { sceneId: string; periodIds: string[] }[]; periods: { id: string; storyIndex: number }[]; sceneOpenings?: Record<string, string> }, ties = false): StoryOrderPrediction {
  const story = new Map(report.periods.map((period) => [period.id, period.storyIndex]));
  const rank = (sceneId: string) => {
    const periods = report.sceneTimes.find((time) => time.sceneId === sceneId)?.periodIds ?? [];
    return periods.length ? story.get(periods[0]) ?? -1 : -1;
  };
  const scenes = report.sceneTimes.map((time) => time.sceneId);
  if (ties) return { kind: "ranks", ranks: Object.fromEntries(scenes.map((id) => [id, rank(id)])) };
  return { kind: "order", sceneIds: scenes.map((id, reading) => ({ id, reading, rank: rank(id) })).sort((first, second) => first.rank - second.rank || first.reading - second.reading).map((entry) => entry.id) };
}

export async function evalStoryOrder(goldPath: string, predictedPath: string, options: { timeplace?: boolean; ties?: boolean } = {}) {
  const [gold, predicted] = await Promise.all([readFile(goldPath, "utf8").then(JSON.parse), readFile(predictedPath, "utf8").then(JSON.parse)]);
  return scoreStoryOrder(gold, options.timeplace ? timeplacePrediction(predicted, options.ties) : predicted);
}
