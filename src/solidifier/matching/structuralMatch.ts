import type { Entity, OntEvent, Relation, Scene } from "../../ground/ontology/types.js";

/**
 * Structural entity matching (sector 04) — the EM faculty's eyes.
 *
 * Form-based nomination (entityMatch.ts) is blind to pairs that share
 * no name form at all: cross-script twins （安娜 vs "Anna Sprengel")
 * and descriptive records （蜂蜜色少女 for 食蜂操祈）. Structure sees
 * them: two records of one entity draw their scenes, events and
 * relation neighbors from the same underlying person.
 *
 * Design rules (owner-ratified 2026-10-23):
 *  - STRICT by default. We do not need to find every match — the
 *    check re-runs as data grows, so a missed pair's score only
 *    rises; a bad merge is permanent. Nomination requires a high
 *    combined score, a support floor, and ZERO co-actor events
 *    (two records acting in the same event is distinctness
 *    evidence, and companions are the false-positive class).
 *  - Pairs already sharing a name form are EXCLUDED — an existing
 *    alias means the identity is already linked; form nomination
 *    owns those pairs.
 *  - Pairs remembered as DISTINCT (matching.json) are skipped
 *    unless their shared evidence grew materially since the verdict.
 *
 * Features mirror the feasibility prototype validated on a real
 * graph (alternating-spelling twin ranked #1 of 47 pairs).
 */

export interface StructuralFeatures {
  sceneJaccard: number;
  neighborJaccard: number;
  sharedScenes: number;
  sharedNeighbors: number;
  coActorEvents: number;
  score: number;
}

export interface StructuralCandidate {
  aId: string;
  bId: string;
  kind: string;
  features: StructuralFeatures;
  reasons: string[];
}

export interface DistinctRecord {
  a: string;
  b: string;
  sharedScenes: number;
  sharedNeighbors: number;
  ts: string;
}

export interface StructuralOptions {
  /** Minimum combined score to nominate. Default 0.6 (strict). */
  minScore?: number;
  /** Support floor: shared scenes >= this OR shared neighbors >= that. */
  minSharedScenes?: number;
  minSharedNeighbors?: number;
  /** Pairs to consider; default: all same-kind pairs. */
  scopeIds?: Set<string> | null;
  /** Only pairs where at least one side is in this set (per-block pass). */
  touchedIds?: Set<string> | null;
  /** Remembered-distinct pairs to skip unless evidence grew. */
  distinct?: DistinctRecord[];
}

const pairKey = (a: string, b: string) => [a, b].sort().join("|");

export function buildStructuralIndex(
  entities: Entity[],
  events: OntEvent[],
  scenes: Scene[],
  relations: Relation[],
) {
  const sceneById = new Map(scenes.map((s) => [s.id, s]));
  const sceneSentences = new Map(scenes.map((s) => [s.id, new Set(s.sentenceIds)]));
  // event -> scene via evidence sentences (best overlap)
  const eventScene = new Map<string, string>();
  for (const ev of events) {
    const evSents = new Set(ev.evidence?.sentenceIds ?? []);
    let best: string | null = null;
    let bestN = 0;
    for (const [sid, ss] of sceneSentences) {
      let n = 0;
      for (const s of evSents) if (ss.has(s)) n++;
      if (n > bestN) { best = sid; bestN = n; }
    }
    if (best) eventScene.set(ev.id, best);
  }
  const participates = new Map<string, Set<string>>();
  for (const r of relations) {
    if (r.type !== "PARTICIPATES_IN") continue;
    if (!participates.has(r.fromId)) participates.set(r.fromId, new Set());
    participates.get(r.fromId)!.add(r.toId);
  }
  const entScenes = new Map<string, Set<string>>();
  const entEvents = new Map<string, Set<string>>();
  const add = (m: Map<string, Set<string>>, k: string, v: string) => {
    if (!m.has(k)) m.set(k, new Set());
    m.get(k)!.add(v);
  };
  for (const s of scenes) {
    for (const c of s.charactersPresent) add(entScenes, c, s.id);
  }
  for (const ev of events) {
    const actors = new Set([...ev.primaryActors, ...ev.affectedCharacters]);
    for (const [cid, evs] of participates) if (evs.has(ev.id)) actors.add(cid);
    for (const c of actors) {
      add(entEvents, c, ev.id);
      const sid = eventScene.get(ev.id);
      if (sid) add(entScenes, c, sid);
    }
  }
  const neighbors = new Map<string, Map<string, number>>();
  const bump = (a: string, b: string) => {
    if (a === b) return;
    if (!neighbors.has(a)) neighbors.set(a, new Map());
    const m = neighbors.get(a)!;
    m.set(b, (m.get(b) ?? 0) + 1);
  };
  const byEvent = new Map<string, Set<string>>();
  for (const ev of events) {
    byEvent.set(ev.id, new Set([...ev.primaryActors, ...ev.affectedCharacters]));
  }
  for (const cs of byEvent.values()) for (const a of cs) for (const b of cs) bump(a, b);
  for (const s of scenes) {
    const cs = new Set(s.charactersPresent);
    for (const a of cs) for (const b of cs) bump(a, b);
  }
  return { entScenes, entEvents, neighbors, sceneById };
}

const jaccard = (a: Set<string>, b: Set<string>): number =>
  a.size === 0 && b.size === 0 ? 0 : a.size === 0 || b.size === 0 ? 0 : [...a].filter((x) => b.has(x)).length / new Set([...a, ...b]).size;

const weightedJaccard = (a: Map<string, number>, b: Map<string, number>): number => {
  const keys = new Set([...a.keys(), ...b.keys()]);
  if (keys.size === 0) return 0;
  let num = 0, den = 0;
  for (const k of keys) {
    num += Math.min(a.get(k) ?? 0, b.get(k) ?? 0);
    den += Math.max(a.get(k) ?? 0, b.get(k) ?? 0);
  }
  return den === 0 ? 0 : num / den;
};

const EMPTY_SET = new Set<string>();
const EMPTY_MAP = new Map<string, number>();

export function nominateStructuralCandidates(
  entities: Entity[],
  events: OntEvent[],
  scenes: Scene[],
  relations: Relation[],
  options: StructuralOptions = {},
): StructuralCandidate[] {
  const minScore = options.minScore ?? 0.6;
  const minSharedScenes = options.minSharedScenes ?? 2;
  const minSharedNeighbors = options.minSharedNeighbors ?? 3;
  const idx = buildStructuralIndex(entities, events, scenes, relations);
  const distinctByPair = new Map((options.distinct ?? []).map((d) => [pairKey(d.a, d.b), d]));
  const formsOf = new Map(entities.map((e) => [e.id, new Set(e.names.map((n) => n.text))]));
  const inScope = (id: string) => !options.scopeIds || options.scopeIds.has(id);
  const touched = (a: string, b: string) => !options.touchedIds || options.touchedIds.has(a) || options.touchedIds.has(b);
  const out: StructuralCandidate[] = [];
  for (let i = 0; i < entities.length; i++) {
    for (let j = i + 1; j < entities.length; j++) {
      const a = entities[i], b = entities[j];
      if (a.kind !== b.kind) continue;
      if (!inScope(a.id) || !inScope(b.id) || !touched(a.id, b.id)) continue;
      // Exclude existing aliases: any shared name form means the
      // identity is already linked (form nomination owns those).
      const fa = formsOf.get(a.id)!, fb = formsOf.get(b.id)!;
      if ([...fa].some((f) => fb.has(f))) continue;
      const sa = idx.entScenes.get(a.id) ?? EMPTY_SET;
      const sb = idx.entScenes.get(b.id) ?? EMPTY_SET;
      const sharedScenes = [...sa].filter((x) => sb.has(x)).length;
      const na = idx.neighbors.get(a.id) ?? EMPTY_MAP;
      const nb = idx.neighbors.get(b.id) ?? EMPTY_MAP;
      const sharedNeighbors = [...na.keys()].filter((k) => nb.has(k)).length;
      if (sharedScenes < 1 && sharedNeighbors < 1) continue; // blocking: no shared context at all
      const ea = idx.entEvents.get(a.id) ?? EMPTY_SET;
      const eb = idx.entEvents.get(b.id) ?? EMPTY_SET;
      const coActorEvents = [...ea].filter((x) => eb.has(x)).length;
      const sceneJ = jaccard(sa, sb);
      const nbrJ = weightedJaccard(na, nb);
      const score = 0.5 * sceneJ + 0.5 * nbrJ;
      const features: StructuralFeatures = {
        sceneJaccard: sceneJ, neighborJaccard: nbrJ,
        sharedScenes, sharedNeighbors, coActorEvents, score,
      };
      if (score < minScore) continue;
      if (coActorEvents > 0) continue; // strict: co-acting is distinctness evidence
      if (sharedScenes < minSharedScenes && sharedNeighbors < minSharedNeighbors) continue;
      const prior = distinctByPair.get(pairKey(a.id, b.id));
      if (prior && sharedScenes <= prior.sharedScenes + 1 && sharedNeighbors <= prior.sharedNeighbors + 1) continue;
      out.push({
        aId: a.id, bId: b.id, kind: a.kind, features,
        reasons: [`structural match: score ${score.toFixed(2)} (scene Jaccard ${sceneJ.toFixed(2)} over ${sharedScenes} shared scenes, neighbor Jaccard ${nbrJ.toFixed(2)} over ${sharedNeighbors} shared neighbors, ${coActorEvents} co-actor events)`],
      });
    }
  }
  return out.sort((x, y) => y.features.score - x.features.score);
}
