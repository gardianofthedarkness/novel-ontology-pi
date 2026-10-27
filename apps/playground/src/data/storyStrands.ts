import type { StoryScene, TimePlaceProjection } from "./timePlace.js";

/**
 * Story strands (estimated, view only): story time as a partial order.
 *
 * A character cannot be in two places at once, so each character's scenes
 * form a strand in reading order (flashbacks aside). One scene comes before
 * another only with evidence: a shared strand, a flashback (it happened
 * before the point where it is told) or stated times that differ (part of
 * day compared only within one top-level place, for time zones). Scenes
 * with no such path between them are parallel. A scene where strands meet
 * comes after the latest scene of each, so strands merge back by
 * themselves. Reading order alone is never evidence across strands.
 *
 * A scene with no recorded cast carries the cast of a recent scene in the
 * same chapter and place, preferring one that shares a place; carried links
 * are marked. Measured against hand-read gold (docs/story-strands.md), this
 * reaches about 0.85 of scene pairs; it is a view, not a stored fact.
 */
export type StrandEdgeKind = "worldline" | "carried" | "flashback" | "time";
export interface StrandEdge { from: string; to: string; kind: StrandEdgeKind; characterId?: string }
export interface StoryStrands {
  /** Story position: below every predecessor, otherwise near where the scene is told. */
  layer: Map<string, number>;
  /** Display lane; scenes on one lane in a run (see `continues`) are one strand. */
  lane: Map<string, number>;
  /** The scene this one continues on its lane (null: a strand starts here). */
  continues: Map<string, string | null>;
  /** Happens-before edges after transitive reduction (what to draw). */
  edges: StrandEdge[];
  carried: Set<string>;
  /** Strands meet here / split after here. */
  merges: Set<string>;
  forks: Set<string>;
  layers: number;
  lanes: number;
  /** Scene pairs with no evidence ordering them. */
  parallelPairs: number;
  /** a reaches b (a happened before b). */
  before: (a: string, b: string) => boolean;
}

const SLOTS: Record<string, number> = { "late-night": 0, dawn: 1, "early-morning": 1, morning: 2, noon: 3, afternoon: 4, evening: 5, night: 6 };

export function storyStrands(data: TimePlaceProjection): StoryStrands {
  const scenes = [...data.scenes].sort((first, second) => first.index - second.index);
  const n = scenes.length;
  const at = new Map(scenes.map((scene, index) => [scene.id, index]));
  const times = new Map(data.times.map((time) => [time.id, time]));
  const places = new Map(data.places.map((place) => [place.id, place]));
  /** Top-level place: parts of the day compare only within one. */
  const region = (scene: StoryScene) => { const place = scene.placeIds[0] ? places.get(scene.placeIds[0]) : undefined; return place?.path?.[0] ?? place?.id ?? scene.placeIds[0] ?? null; };
  /** An unnamed place is compatible with any region. */
  const sameRegion = (a: string | null, b: string | null) => !a || !b || a === b;
  const key = (scene: StoryScene): [number, number, number | null] | null => {
    const anchor = scene.times.find((time) => time.via === "anchor");
    const time = anchor ? times.get(anchor.id) : undefined;
    if (!time?.date?.day) return null;
    return [time.date.month ?? 12, time.date.day, time.partOfDay ? SLOTS[time.partOfDay] ?? null : null];
  };

  // Casts: recorded, or carried from a recent scene of the same chapter and region.
  const cast = scenes.map((scene) => [...new Set(scene.characterIds)]);
  const carried = new Set<string>();
  const appearances = new Map<string, number>();
  for (const ids of cast) for (const id of ids) appearances.set(id, (appearances.get(id) ?? 0) + 1);
  scenes.forEach((scene, index) => {
    if (cast[index].length || scene.flashback) return;
    const window = scenes.slice(0, index).map((other, at) => ({ other, at })).filter(({ other, at }) => cast[at].length && !other.flashback && other.chapterIndex === scene.chapterIndex && sameRegion(region(other), region(scene))).slice(-4);
    if (!window.length) return;
    // A shared place wins; otherwise the thread the book follows most (cast weighted by their scene counts), then the nearest.
    const weight = ({ other, at }: { other: StoryScene; at: number }) => (other.placeIds.some((id) => scene.placeIds.includes(id)) ? 1e6 : 0) + cast[at].reduce((sum, id) => sum + (appearances.get(id) ?? 0), 0) + at / 1e3;
    const pick = window.reduce((best, entry) => weight(entry) > weight(best) ? entry : best);
    cast[index] = [...cast[pick.at]];
    carried.add(scene.id);
  });

  // Happens-before, kept transitively closed; an edge that would close a cycle is dropped.
  const reach = scenes.map(() => new Set<number>());
  const kinds = new Map<string, StrandEdge>();
  const add = (a: number, b: number, edge: StrandEdge) => {
    if (a === b || reach[b].has(a)) return;
    if (!kinds.has(`${a}>${b}`)) kinds.set(`${a}>${b}`, edge);
    if (reach[a].has(b)) return;
    for (let x = 0; x < n; x++) if (x === a || reach[x].has(a)) { reach[x].add(b); for (const y of reach[b]) reach[x].add(y); }
  };
  const chains = new Map<string, number[]>();
  scenes.forEach((scene, index) => { if (!scene.flashback) for (const id of cast[index]) chains.set(id, [...(chains.get(id) ?? []), index]); });
  for (const [characterId, chain] of chains) for (let k = 1; k < chain.length; k++) {
    const a = chain[k - 1], b = chain[k];
    add(a, b, { from: scenes[a].id, to: scenes[b].id, kind: carried.has(scenes[a].id) || carried.has(scenes[b].id) ? "carried" : "worldline", characterId });
  }
  scenes.forEach((scene, index) => {
    if (!scene.flashback) return;
    const next = scenes.findIndex((other, at) => at > index && !other.flashback);
    if (next >= 0) add(index, next, { from: scene.id, to: scenes[next].id, kind: "flashback" });
  });
  const anchored = scenes.map((scene, index) => ({ index, key: key(scene), region: region(scene) })).filter((entry) => entry.key);
  for (const a of anchored) for (const b of anchored) {
    const [ma, da, sa] = a.key!, [mb, db, sb] = b.key!;
    const earlier = ma < mb || (ma === mb && da < db) || (ma === mb && da === db && sa !== null && sb !== null && sa < sb && sameRegion(a.region, b.region));
    if (earlier) add(a.index, b.index, { from: scenes[a.index].id, to: scenes[b.index].id, kind: "time" });
  }

  // Transitive reduction: the edges worth drawing.
  const succ = scenes.map(() => [] as number[]);
  for (const edge of kinds.values()) succ[at.get(edge.from)!].push(at.get(edge.to)!);
  const reduced: [number, number][] = [];
  succ.forEach((targets, a) => { for (const b of targets) if (!targets.some((c) => c !== b && reach[c].has(b))) reduced.push([a, b]); });
  const pred = scenes.map(() => [] as number[]), rsucc = scenes.map(() => [] as number[]);
  for (const [a, b] of reduced) { pred[b].push(a); rsucc[a].push(b); }

  // Layers: earliest and latest positions the evidence allows, then near the telling order within them.
  const order: number[] = [];
  const seen = new Set<number>();
  const visit = (v: number) => { if (seen.has(v)) return; seen.add(v); pred[v].forEach(visit); order.push(v); };
  for (let v = 0; v < n; v++) visit(v);
  const asap = new Array<number>(n).fill(0);
  for (const v of order) asap[v] = Math.max(0, ...pred[v].map((p) => asap[p] + 1));
  const height = Math.max(0, ...asap);
  const alap = new Array<number>(n).fill(height);
  for (const v of [...order].reverse()) if (rsucc[v].length) alap[v] = Math.min(...rsucc[v].map((x) => alap[x] - 1));
  const scale = (height + 1) / Math.max(1, n);
  const layer = new Array<number>(n).fill(0);
  for (const v of order) layer[v] = Math.max(Math.min(Math.round(v * scale), alap[v]), ...pred[v].map((p) => layer[p] + 1));

  // Lanes, like a commit graph: a scene continues the lane of the predecessor it shares most with,
  // when it is that predecessor's best continuation; otherwise it opens (or reuses) a lane.
  const weight = (a: number, b: number) => cast[a].filter((id) => cast[b].includes(id)).reduce((sum, id) => sum + (chains.get(id)?.length ?? 0), 0);
  const storyNext = (p: number) => rsucc[p].filter((x) => kinds.get(`${p}>${x}`)?.kind !== "time");
  const bestNext = (p: number) => { const options = storyNext(p).length ? storyNext(p) : [...rsucc[p]]; return options.sort((x, y) => weight(p, y) - weight(p, x) || layer[x] - layer[y] || x - y)[0]; };
  const lane = new Array<number>(n).fill(-1), continues = new Array<number | null>(n).fill(null);
  const tails: (number | null)[] = [];
  const placed = new Set<number>();
  for (const v of [...Array(n).keys()].sort((x, y) => layer[x] - layer[y] || x - y)) {
    const options = pred[v].filter((p) => lane[p] >= 0 && tails[lane[p]] === p && bestNext(p) === v);
    if (options.length) {
      const best = options.sort((x, y) => weight(y, v) - weight(x, v) || x - y)[0];
      lane[v] = lane[best]; continues[v] = best;
    } else {
      const free = tails.findIndex((tail) => tail === null || (rsucc[tail].every((s) => placed.has(s)) && layer[tail] < layer[v]));
      lane[v] = free >= 0 ? free : tails.push(null) - 1;
    }
    tails[lane[v]] = v;
    placed.add(v);
    tails.forEach((tail, index) => { if (tail !== null && index !== lane[v] && rsucc[tail].length && rsucc[tail].every((s) => placed.has(s))) tails[index] = null; });
  }

  const story = (a: number, b: number) => kinds.get(`${a}>${b}`)?.kind !== "time";
  let parallelPairs = 0;
  for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) if (!reach[a].has(b) && !reach[b].has(a)) parallelPairs++;
  const ids = (values: number[]) => new Map(scenes.map((scene, index) => [scene.id, values[index]]));
  return {
    layer: ids(layer), lane: ids(lane),
    continues: new Map(scenes.map((scene, index) => [scene.id, continues[index] === null ? null : scenes[continues[index]!].id])),
    edges: reduced.map(([a, b]) => kinds.get(`${a}>${b}`)!),
    carried,
    merges: new Set(scenes.filter((_, v) => new Set(pred[v].filter((p) => story(p, v)).map((p) => lane[p])).size > 1).map((scene) => scene.id)),
    forks: new Set(scenes.filter((_, v) => new Set(rsucc[v].filter((x) => story(v, x)).map((x) => lane[x])).size > 1).map((scene) => scene.id)),
    layers: Math.max(0, ...layer) + 1, lanes: Math.max(0, ...lane) + 1, parallelPairs,
    before: (a, b) => { const x = at.get(a), y = at.get(b); return x !== undefined && y !== undefined && reach[x].has(y); },
  };
}
