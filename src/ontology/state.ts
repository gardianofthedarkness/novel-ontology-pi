import type { CharacterStateAtPoint, OntEvent, StateChange } from "./types.js";

/**
 * The character state fold (decision #10, state materialization v1).
 *
 * Canon state is a deterministic fold: replay a character's persisted
 * StateChange deltas in the chronological order of the events they
 * follow, and the state at any point is pure arithmetic over those
 * records — no model, no randomness. Stochastic sampling enters only
 * in Phase 4 simulation, which reads a folded snapshot at a fork and
 * generates forward from it; this fold is what it will read.
 *
 * Semantics per dimension:
 *  - emotions / relationships: ADDITIVE deltas, accumulated and
 *    clamped to [-1, 1] (the same range extraction clamps each
 *    emitted delta to). Keys whose accumulated value returns to
 *    exactly 0 are dropped, so a neutral state stays empty.
 *  - knowledge / goals / possessions: ordered sets — adds append
 *    unseen items, removals delete (possessions only; knowledge and
 *    goals have no removal channel in the v1 delta shape).
 *  - location: the last non-null value wins.
 *
 * Deltas whose afterEventId is not among the given events are
 * orphans (their event never materialized) and are excluded — they
 * cannot be placed chronologically. Ordering between deltas that
 * follow the same event is by record id, so the fold is total and
 * reproducible.
 */

const clampUnit = (v: number): number => Math.min(1, Math.max(-1, v));

function addClamped(map: Record<string, number>, key: string, delta: number): void {
  const next = clampUnit((map[key] ?? 0) + delta);
  if (next === 0) delete map[key];
  else map[key] = next;
}

function addAll(list: string[], items: string[]): void {
  for (const item of items) if (!list.includes(item)) list.push(item);
}

function removeAll(list: string[], items: string[]): void {
  for (const item of items) {
    const i = list.indexOf(item);
    if (i >= 0) list.splice(i, 1);
  }
}

/**
 * Fold `deltas` for one character up to and including the event
 * `atEventId`. Returns null when the point itself is unknown (the
 * event is not in `events`) — a state "before the story" or after an
 * unmaterialized event is not a meaningful read. An existing point
 * with no deltas yields the empty state.
 */
export function foldStateAt(
  characterId: string,
  atEventId: string,
  events: OntEvent[],
  deltas: StateChange[],
): CharacterStateAtPoint | null {
  const orderOf = new Map(events.map((e) => [e.id, e.chronologicalOrder]));
  const atOrder = orderOf.get(atEventId);
  if (atOrder === undefined) return null;

  const applicable = deltas
    .filter((d) => d.characterId === characterId)
    .map((d) => ({ d, order: orderOf.get(d.afterEventId) }))
    .filter((x): x is { d: StateChange; order: number } => x.order !== undefined && x.order <= atOrder)
    .sort((a, b) => a.order - b.order || (a.d.id < b.d.id ? -1 : a.d.id > b.d.id ? 1 : 0));

  const state: CharacterStateAtPoint = {
    characterId,
    atEventId,
    emotions: {},
    knowledge: [],
    goals: [],
    relationships: {},
    location: null,
    possessions: [],
  };
  for (const { d } of applicable) {
    for (const [k, v] of Object.entries(d.emotions ?? {})) addClamped(state.emotions, k, v);
    for (const [k, v] of Object.entries(d.relationships ?? {})) addClamped(state.relationships, k, v);
    addAll(state.knowledge, d.knowledgeAdd ?? []);
    addAll(state.goals, d.goalsAdd ?? []);
    addAll(state.possessions, d.possessionsAdd ?? []);
    removeAll(state.possessions, d.possessionsRemove ?? []);
    if (d.location !== null && d.location !== undefined) state.location = d.location;
  }
  return state;
}

/** The canon event with the greatest chronological order, if any. */
export function latestEvent(events: OntEvent[], timelineId = "tl_canon"): OntEvent | null {
  let best: OntEvent | null = null;
  for (const e of events) {
    if (e.timelineId !== timelineId) continue;
    if (!best || e.chronologicalOrder > best.chronologicalOrder) best = e;
  }
  return best;
}
