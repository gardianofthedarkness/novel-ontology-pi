/**
 * Causality candidate generation — hybrid, EM-style.
 *
 * Two legs nominate pairs for Jev adjudication; neither leg decides anything:
 *
 * 1. Graph patterns (the "Cypher leg"): the same patterns an agent would
 *    express in Cypher over the ontology — shared actors, shared location,
 *    state-change chains (a delta after event A on character X, then a later
 *    unit involving X), and dialogue participation (a card sharing a
 *    participant with an event's actors). Run over bundle data here because
 *    the faculty's home is the bundle, not a live graph; the patterns are
 *    graph patterns, not text heuristics.
 * 2. Embedding top-K: for each unit, the K most similar units by cosine
 *    similarity over the causality sidecar vectors (K = 32, the ratified
 *    fallback shape; candidacy floor 0.5).
 *
 * Nomination is deliberately NOT adjacency: mere succession is not a leg.
 * A pair needs at least one graph leg or an embedding leg. Direction follows
 * novel-sequence order; order-ambiguous pairs are emitted in chapter/id order
 * and flagged so Jev's temporal-consistency criterion can reject them.
 * Existing CAUSES links (either direction) are never re-nominated, and the
 * pair count is capped so a big novel cannot blow up a Jev batch.
 */

import { topKSimilar } from "../../ground/connectors/embeddings.js";
import { alreadyLinked, compareOrder, type CausalityUniverse } from "./units.js";

export interface CausalCandidate {
  fromId: string;
  toId: string;
  /** Legs that nominated the pair, e.g. ["shared-actor", "embedding:0.81"]. */
  legs: string[];
  /** Heuristic ordering score for the batch (leg count + embedding score), NOT a verdict. */
  codeScore: number;
  /** True when the novel sequence could not order this pair. */
  orderAmbiguous: boolean;
}

/** Embedding similarity floor for candidacy. */
export const EMBEDDING_CANDIDACY_FLOOR = 0.5;
/** Embedding top-K per unit. */
export const EMBEDDING_TOP_K = 32;
/** Safety cap on pairs per pass. */
export const MAX_CANDIDATE_PAIRS = 500;

export interface CandidateOptions {
  /** Per-block passes: only pairs touching one of these unit ids. Null = sweep (all pairs). */
  touchedIds?: Set<string> | null;
  /** Unit id -> vector, from the sidecar (absent = embedding leg skipped). */
  vectors?: Map<string, number[]>;
  topK?: number;
  maxPairs?: number;
}

export function nominateCausalCandidates(
  universe: CausalityUniverse,
  opts: CandidateOptions = {},
): CausalCandidate[] {
  const touched = opts.touchedIds ?? null;
  const topK = opts.topK ?? EMBEDDING_TOP_K;
  const maxPairs = opts.maxPairs ?? MAX_CANDIDATE_PAIRS;
  const vectors = opts.vectors ?? new Map<string, number[]>();

  // State-change chains: character -> set of event ids after which a delta lands.
  const deltaAfter = new Map<string, Set<string>>();
  for (const change of universe.stateChanges) {
    const set = deltaAfter.get(change.characterId) ?? new Set<string>();
    set.add(change.afterEventId);
    deltaAfter.set(change.characterId, set);
  }
  // Character -> units involving them (for state-chain forward lookup).
  const unitsByActor = new Map<string, string[]>();
  for (const unit of universe.units) {
    for (const actor of unit.actors) {
      const list = unitsByActor.get(actor) ?? [];
      list.push(unit.id);
      unitsByActor.set(actor, list);
    }
  }

  const pairs = new Map<string, CausalCandidate>();
  const addLeg = (fromId: string, toId: string, leg: string, scoreBoost: number) => {
    if (fromId === toId) return;
    if (touched && !touched.has(fromId) && !touched.has(toId)) return;
    if (alreadyLinked(universe, fromId, toId)) return;
    const a = universe.byId.get(fromId);
    const b = universe.byId.get(toId);
    if (!a || !b) return;
    // Direction follows novel-sequence order; ambiguous pairs keep
    // chapter/id order and are flagged.
    const order = compareOrder(a, b, universe);
    let from = fromId;
    let to = toId;
    let ambiguous = false;
    if (order === 1) {
      from = toId;
      to = fromId;
    } else if (order === null) {
      ambiguous = true;
      if (a.chapterIndex !== b.chapterIndex ? a.chapterIndex > b.chapterIndex : a.id > b.id) {
        from = toId;
        to = fromId;
      }
    }
    const key = `${from}|${to}`;
    const existing = pairs.get(key);
    if (existing) {
      if (!existing.legs.includes(leg)) existing.legs.push(leg);
      existing.codeScore += scoreBoost;
      existing.orderAmbiguous = existing.orderAmbiguous && ambiguous;
    } else {
      pairs.set(key, { fromId: from, toId: to, legs: [leg], codeScore: scoreBoost, orderAmbiguous: ambiguous });
    }
  };

  // Leg 1a: shared actors (event actors / dialogue participants).
  for (const [actor, unitIds] of unitsByActor) {
    for (let i = 0; i < unitIds.length; i++) {
      for (let j = i + 1; j < unitIds.length; j++) {
        addLeg(unitIds[i], unitIds[j], "shared-actor", 1);
      }
    }
  }
  // Leg 1b: shared location (via owning scene).
  const unitsByLocation = new Map<string, string[]>();
  for (const unit of universe.units) {
    if (!unit.locationId) continue;
    const list = unitsByLocation.get(unit.locationId) ?? [];
    list.push(unit.id);
    unitsByLocation.set(unit.locationId, list);
  }
  for (const unitIds of unitsByLocation.values()) {
    for (let i = 0; i < unitIds.length; i++) {
      for (let j = i + 1; j < unitIds.length; j++) {
        addLeg(unitIds[i], unitIds[j], "shared-location", 0.5);
      }
    }
  }
  // Leg 1c: state-change chains — a delta after event A, then a later unit
  // involving the same character. The later unit must follow A in sequence.
  for (const [characterId, afterIds] of deltaAfter) {
    for (const afterId of afterIds) {
      const anchor = universe.byId.get(afterId);
      if (!anchor) continue;
      for (const laterId of unitsByActor.get(characterId) ?? []) {
        if (laterId === afterId) continue;
        const later = universe.byId.get(laterId);
        if (!later) continue;
        if (compareOrder(anchor, later, universe) === -1) addLeg(afterId, laterId, "state-chain", 1);
      }
    }
  }
  // Leg 2: embedding top-K (both directions nominate; direction re-resolved
  // in addLeg by novel-sequence order).
  if (vectors.size > 0) {
    const pool = universe.units
      .filter((unit) => vectors.has(unit.id))
      .map((unit) => ({ id: unit.id, vector: vectors.get(unit.id)! }));
    for (const unit of pool) {
      for (const hit of topKSimilar(unit.vector, pool, topK, new Set([unit.id]))) {
        if (hit.score < EMBEDDING_CANDIDACY_FLOOR) continue;
        addLeg(unit.id, hit.id, `embedding:${hit.score.toFixed(2)}`, hit.score);
      }
    }
  }

  return [...pairs.values()]
    .sort((a, b) => b.codeScore - a.codeScore || a.fromId.localeCompare(b.fromId) || a.toId.localeCompare(b.toId))
    .slice(0, maxPairs);
}
