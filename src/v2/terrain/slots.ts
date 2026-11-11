/**
 * Slots, borrowing and spawning (docs/v3/design.html#borrow-and-spawn §2.2–2.5, §4; the user's design, 2026-11-01). An area of a
 * decided kind spawns typed slots one level down (config.ts); a mention Jev gave a kind borrows a slot of that kind in its
 * holder, or spawns one when none can be borrowed, one level at a time in narrative order, keeping the characters' travel
 * least. What it decides is which slot each mention takes; where the slots stand is the engine's (placement, then the
 * settling that moves them), so this module is plain data and arithmetic, tested on its own.
 *
 * The rules (§2.3, §2.4, §2.8, §4.5):
 *  - a named place takes a slot of its own, for good: its name returns to it in every later book;
 *  - an unnamed mention shares any slot of its kind, but never one already taken by another mention of its own scene, nor
 *    one damaged earlier in its book; unnamed shares and damage are its book's, cleared for the next;
 *  - a mention spawns only when it can borrow nothing; so unnamed mentions never grow an area with their number.
 */
import { CHILD, type Level, type Parent, type Resolver, spawnsOf } from "./config.js";
import { setting } from "../settings.js";

export type Point = [number, number];
export interface Share { book: string; mention: string; scene: string | null }
export interface Slot {
  id: string;
  /** The area it stands in. */
  parent: string;
  level: Level;
  kind: string;
  /** Where it stands, in world metres; null until a mention borrows it or its level places its spares. */
  at: Point | null;
  /** The named place it is, for good (§4.5). */
  owner: string | null;
  ownerBook?: string;
  /** The unnamed mentions sharing it, by book; only the current book's are in force. */
  sharers: Share[];
  /** Where it was damaged, by book (the simulation's; option A of §2.8); only the current book's are in force. */
  damaged: { book: string; scene: string }[];
  /** What spawned it: the configuration layer, or "named" / "unnamed" for a spawn beyond it. */
  layer: string;
  book: string;
}
export interface Mention {
  id: string;
  label: string;
  named: boolean;
  /** Its kind, Jev's answer at its level. */
  kind: string;
  /** The place holding it in the tree: its parent, or a place higher up (§2.5). */
  holder: string;
  /** Its scene: an unnamed mention's own, a named place's first. */
  scene: string | null;
  pin?: Point | null;
}
/** A place already standing (a higher level's, an earlier book's), which a mention may be tied to: a point, or a box (0 inside). */
export interface Fixed { id: string; at: Point; box?: [number, number, number, number] }

export interface LevelProblem {
  book: string;
  level: Level;
  /**
   * A bounded repair (the dynamic-grid research, §3: a small edit never rebuilds the city): only these mentions may move in
   * the level's improving moves; the others stand on the slots they hold. All may move when it is not given.
   */
  movable?: (id: string) => boolean;
  /** Every slot of the level in the mentions' holders (earlier books' among them, standing where they are). */
  slots: Slot[];
  /** The level's mentions, in narrative order. */
  mentions: Mention[];
  /** Continuity ties between places (the characters going between their scenes: `continuityTies`). */
  ties: (a: string, b: string) => number;
  fixed: Fixed[];
  /** The tree: whether a place is under a holder (itself counts). */
  within: (place: string, holder: string) => boolean;
  /** Story order of the book's scenes, for damage (§2.8). */
  sceneIndex?: (scene: string) => number;
  /**
   * The engine's placement (§2.4): where a mention would stand, in `parent` (an unplaced slot's area) or, for a spawn
   * (`parent` null), in the area under its holder where it would be best; `taken` are the slots standing.
   */
  place: (mention: Mention, parent: string | null, taken: Slot[]) => { parent: string; at: Point } | null;
  /** Ties between places in different areas count at this weight (the user, 2026-11-01: 0.3 for now). */
  crossWeight?: number;
  /** The pins' weight, as the settling's (zoom.ts SETTLE.lambda). */
  lambda?: number;
  /** Mentions already on a slot (mention id → slot id; the slots record them): the engine's step mode borrows one mention at a time, and the moves come when the level ends. */
  assigned?: Record<string, string>;
  /** Whether to make the moves after the greedy pass (default yes); the step mode borrows one mention at a time without them. */
  improve?: boolean;
  /** The engine's own rules on top of admissible (a tall-lined street only where the buildings are tall enough). */
  allow?: (slot: Slot, mention: Mention) => boolean;
}
export interface Choice {
  /** Mention id → slot id. */
  assignment: Record<string, string>;
  slots: Slot[];
  spawned: string[];
  energy: { greedy: number; final: number };
  moves: number;
  log: string[];
}

const SLOTS = setting<{ crossWeight: number; lambda: number }>("spawn.slots");
export const CROSS_WEIGHT = SLOTS.crossWeight, LAMBDA = SLOTS.lambda;

/** A slot's sharers and damage in force in a book: only that book's (§4.5). */
export const sharersIn = (slot: Slot, book: string) => slot.sharers.filter((share) => share.book === book);

/** Whether a mention may borrow a slot (§2.3, §2.5, §2.8): its kind, under its holder, and the slot free for it. */
export function admissible(slot: Slot, mention: Mention, problem: Pick<LevelProblem, "book" | "within" | "sceneIndex">): boolean {
  if (slot.kind !== mention.kind || !problem.within(slot.parent, mention.holder)) return false;
  if (mention.named) return slot.owner === null || slot.owner === mention.id;
  const sameScene = sharersIn(slot, problem.book).some((share) => share.mention !== mention.id && share.scene !== null && share.scene === mention.scene);
  const at = mention.scene !== null && problem.sceneIndex ? problem.sceneIndex(mention.scene) : Infinity;
  const damaged = slot.damaged.some((hit) => hit.book === problem.book && (problem.sceneIndex?.(hit.scene) ?? -Infinity) < at);
  return !sameScene && !damaged;
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const toBox = (p: Point, box: [number, number, number, number]) => Math.hypot(Math.max(box[0] - p[0], 0, p[0] - box[2]), Math.max(box[1] - p[1], 0, p[1] - box[3]));

/** The spawned slots of an area of a decided kind (§2.2): its configuration's children, unplaced, of the level below. */
export function spawnChildren(area: Parent, resolver: Resolver, book: string, existing: Slot[] = []): Slot[] {
  const level = CHILD[area.level];
  if (!level) return [];
  const { counts, layer } = spawnsOf(area, resolver), slots: Slot[] = [];
  for (const [kind, n] of Object.entries(counts))
    for (let k = 0; k < n; k++) slots.push({ id: `slot:${area.id}:${kind}:${k + 1}`, parent: area.id, level, kind, at: null, owner: null, sharers: [], damaged: [], layer, book });
  const known = new Set(existing.map((slot) => slot.id));
  return slots.filter((slot) => !known.has(slot.id));
}

/**
 * Which slot each mention takes (§4.3): in narrative order, the admissible slot that raises the characters' travel least
 * (an unplaced one costed where the engine would place it), a spawn only where nothing can be borrowed; then moves that
 * lower the whole level's energy (a named place to a better free slot, two names of a kind exchanging theirs, an unnamed
 * mention to a better slot) until none does. Earlier books' slots and their owners stand as they are.
 */
export function chooseSlots(problem: LevelProblem): Choice {
  const w = problem.crossWeight ?? CROSS_WEIGHT, lambda = problem.lambda ?? LAMBDA, book = problem.book;
  const slots = problem.slots.map((slot) => ({ ...slot, at: slot.at ? ([...slot.at] as Point) : null, sharers: [...slot.sharers], damaged: [...slot.damaged] }));
  const byId = new Map(slots.map((slot) => [slot.id, slot]));
  const assignment: Record<string, string> = {}, spawned: string[] = [], log: string[] = [];
  const mentionOf = new Map(problem.mentions.map((m) => [m.id, m]));
  const slotOf = (id: string) => byId.get(assignment[id])!;
  const fits = (slot: Slot, m: Mention) => admissible(slot, m, problem) && (problem.allow?.(slot, m) ?? true);
  const weight = (a: Slot, parentB: string) => (a.parent === parentB ? 1 : w);
  // A mention's own cost at a point in an area, against the mentions placed so far (all but `skip`), the fixed places and its pin.
  const cost = (m: Mention, at: Point, parent: string, skip = new Set<string>()) => {
    let sum = 0;
    for (const [other, slotId] of Object.entries(assignment)) {
      if (other === m.id || skip.has(other)) continue;
      const t = problem.ties(m.id, other), slot = byId.get(slotId)!;
      if (t && slot.at) sum += t * (slot.parent === parent ? 1 : w) * distance(at, slot.at);
    }
    for (const fixed of problem.fixed) { const t = problem.ties(m.id, fixed.id); if (t) sum += t * (problem.within(fixed.id, parent) || problem.within(parent, fixed.id) ? 1 : w) * (fixed.box ? toBox(at, fixed.box) : distance(at, fixed.at)); }
    if (m.pin) sum += lambda * distance(at, m.pin);
    return sum;
  };
  const energy = () => {
    let sum = 0;
    const placed = Object.entries(assignment).map(([id, slotId]) => [mentionOf.get(id)!, byId.get(slotId)!] as const).filter(([, slot]) => slot.at);
    placed.forEach(([m, a], n) => {
      for (const [m2, b] of placed.slice(n + 1)) { const t = problem.ties(m.id, m2.id); if (t) sum += t * weight(a, b.parent) * distance(a.at!, b.at!); }
      for (const fixed of problem.fixed) { const t = problem.ties(m.id, fixed.id); if (t) sum += t * (problem.within(fixed.id, a.parent) || problem.within(a.parent, fixed.id) ? 1 : w) * (fixed.box ? toBox(a.at!, fixed.box) : distance(a.at!, fixed.at)); }
      if (m.pin) sum += lambda * distance(a.at!, m.pin);
    });
    return sum;
  };
  const take = (m: Mention, slot: Slot, at: Point | null) => {
    if (!slot.at && at) slot.at = at;
    if (m.named) { slot.owner = m.id; slot.ownerBook ??= book; } else slot.sharers.push({ book, mention: m.id, scene: m.scene });
    assignment[m.id] = slot.id;
  };
  const leave = (m: Mention, slot: Slot) => {
    if (m.named) { if (slot.ownerBook === book) { slot.owner = null; delete slot.ownerBook; } }
    else slot.sharers = slot.sharers.filter((share) => !(share.book === book && share.mention === m.id));
    delete assignment[m.id];
  };

  // 1. Greedy, in narrative order; a mention already on a slot stays there.
  for (const [id, slotId] of Object.entries(problem.assigned ?? {})) if (mentionOf.has(id) && byId.has(slotId)) assignment[id] = slotId;
  for (const m of problem.mentions) {
    if (assignment[m.id]) continue;
    const own = m.named ? slots.find((slot) => slot.owner === m.id) : null;
    if (own) { take(m, own, own.at ?? problem.place(m, own.parent, slots.filter((s) => s.at))?.at ?? null); log.push(`${m.label}: back on its own slot ${own.id}`); continue; }
    // Unplaced slots of one kind in one area are alike: each area's is costed once, where the engine would place it.
    const where = new Map<string, Point | null>(), candidates: { slot: Slot; at: Point; c: number }[] = [];
    for (const slot of slots.filter((s) => fits(s, m))) {
      let at = slot.at;
      if (!at) { if (!where.has(slot.parent)) where.set(slot.parent, problem.place(m, slot.parent, slots.filter((s) => s.at))?.at ?? null); at = where.get(slot.parent) ?? null; }
      if (at) candidates.push({ slot, at, c: cost(m, at, slot.parent) });
    }
    candidates.sort((a, b) => a.c - b.c || Number(!a.slot.at) - Number(!b.slot.at) || a.slot.id.localeCompare(b.slot.id));
    const best = candidates[0];
    if (best) { take(m, best.slot, best.at); log.push(`${m.label}: borrows ${best.slot.id}${m.named ? "" : best.slot.owner ? ` (${best.slot.owner}'s)` : ""}`); continue; }
    const placed = problem.place(m, null, slots.filter((s) => s.at));
    if (!placed) { log.push(`${m.label}: nothing to borrow and nowhere to spawn`); continue; }
    const n = slots.filter((s) => s.parent === placed.parent && s.kind === m.kind).length + 1;
    const slot: Slot = { id: `slot:${placed.parent}:${m.kind}:${n}`, parent: placed.parent, level: problem.level, kind: m.kind, at: placed.at, owner: null, sharers: [], damaged: [], layer: m.named ? "named" : "unnamed", book };
    slots.push(slot); byId.set(slot.id, slot); spawned.push(slot.id);
    take(m, slot, placed.at);
    log.push(`${m.label}: spawns ${slot.id} (${m.named ? "every slot of its kind holds another name" : "no slot of its kind it may share"})`);
  }
  const greedy = energy();

  // 2. Moves, until none lowers the level's energy: this book's names to a better free slot or exchanging theirs, unnamed
  // mentions to a better slot they may share. A slot spawned for a name it no longer holds goes (§3: no growth).
  let moves = 0;
  for (let round = 0; round < (problem.improve === false ? 0 : 20); round++) {
    let moved = false;
    const mine = problem.mentions.filter((m) => assignment[m.id] && (!m.named || slotOf(m.id).ownerBook === book) && (problem.movable?.(m.id) ?? true));
    for (const m of mine) {
      const from = slotOf(m.id);
      if (!from.at) continue;
      const here = cost(m, from.at, from.parent);
      const options = slots.filter((slot) => slot !== from && slot.at && fits(slot, m) && !(m.named && slot.owner));
      const best = options.map((slot) => ({ slot, c: cost(m, slot.at!, slot.parent) })).sort((a, b) => a.c - b.c || a.slot.id.localeCompare(b.slot.id))[0];
      if (best && best.c < here - 0.5) {
        leave(m, from); take(m, best.slot, null); moves++; moved = true;
        log.push(`${m.label}: moves to ${best.slot.id} (${Math.round(here)} → ${Math.round(best.c)} tie·m)`);
        if (from.layer === "named" && from.book === book && !from.owner && !sharersIn(from, book).length) { slots.splice(slots.indexOf(from), 1); byId.delete(from.id); spawned.splice(spawned.indexOf(from.id), 1); }
      }
    }
    const names = mine.filter((m) => m.named);
    for (let i = 0; i < names.length; i++)
      for (let j = i + 1; j < names.length; j++) {
        const a = names[i], b = names[j], A = slotOf(a.id), B = slotOf(b.id);
        if (a.kind !== b.kind || !A.at || !B.at || !problem.within(B.parent, a.holder) || !problem.within(A.parent, b.holder) || !(problem.allow?.(B, a) ?? true) || !(problem.allow?.(A, b) ?? true)) continue;
        const pair = new Set([a.id, b.id]), before = cost(a, A.at, A.parent, pair) + cost(b, B.at, B.parent, pair), after = cost(a, B.at, B.parent, pair) + cost(b, A.at, A.parent, pair);
        if (after < before - 0.5) {
          A.owner = b.id; B.owner = a.id; assignment[a.id] = B.id; assignment[b.id] = A.id; moves++; moved = true;
          log.push(`${a.label} and ${b.label} exchange slots (${Math.round(before)} → ${Math.round(after)} tie·m)`);
        }
      }
    if (!moved) break;
  }
  return { assignment, slots, spawned, energy: { greedy: Math.round(greedy), final: Math.round(energy()) }, moves, log };
}

/** How many areas of each kind stand in an area (§3's bound is checked on this). */
export function countsIn(slots: Slot[], parent: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const slot of slots) if (slot.parent === parent) counts[slot.kind] = (counts[slot.kind] ?? 0) + 1;
  return counts;
}
