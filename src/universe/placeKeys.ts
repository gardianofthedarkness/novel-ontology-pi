/**
 * A place's universe key (docs/v3/design.html#borrow-and-spawn §6.4: "What a book kept never moves in a later book"; the
 * user, 2026-11-14: "One universe key per place. A matched place takes the key of the book where it first appeared; vol 1's
 * places keep their own ids, so vol 1's world doesn't change. Every seed and id built from a place id uses this key").
 *
 * Each book numbers its places from one, so one city is loc_000001 in vol 1 and loc_000002 in vol 2, and vol 2's
 * loc_000001 is another place. The world is seeded and keyed by place ids (a canvas place's landscape, a slot's id, a
 * building's id, its skeleton), so a later book built from its own ids stands on another city: nothing an earlier book
 * broke is found again. The same-places step (engine/world/same-places.mjs, universe/places.json) gives every place of a
 * later book its key: the key of the earlier place it is the same as, else its own id under its book (`vol-2:loc_000001`).
 * The first book's keys are its ids.
 *
 * The terrain step and the export work in the book's own ids and use the key where an id or a seed is made from a place:
 * `placeKey`. The universe's registry of slots (universe/terrain.json) holds keys; a book reads it in its own ids
 * (`slotToBook`) and writes it back in keys (`slotToUniverse`). An earlier book's place this book does not have is
 * `universe:<key>` here (`FOREIGN`): it stands where that book kept it, under its own key.
 */

/** The prefix of an earlier book's place this book does not have. */
export const FOREIGN = "universe:";

let keys: Map<string, string> | null = null, places: Map<string, string> | null = null, qualify: string | null = null;

/**
 * The keys in use (one book is built at a time in a process): `map` this book's place id → key; `book` this book, whose
 * places not in the map are keyed under it. None (the first book, or a library made before keys): every key is the id.
 */
export function usePlaceKeys(map: Record<string, string> | null, book: string | null = null): void {
  keys = map ? new Map(Object.entries(map)) : null;
  places = map ? new Map(Object.entries(map).map(([id, key]) => [key, id])) : null;
  qualify = map ? book : null;
}

/** Whether keys other than the ids are in use. */
export function placeKeysInUse(): boolean {
  return keys !== null;
}

// A slot's id is made from its parent's key already; an empty id stays empty.
const isPlace = (id: string) => !!id && !id.startsWith("slot:");

/** The universe key of one of this book's places (a slot's id is its own key). */
export function placeKey(id: string): string;
export function placeKey(id: string | null | undefined): string | null;
export function placeKey(id: string | null | undefined): string | null {
  if (id == null) return null;
  if (!keys || !isPlace(id)) return id;
  if (id.startsWith(FOREIGN)) return id.slice(FOREIGN.length);
  return keys.get(id) ?? (qualify ? `${qualify}:${id}` : id);
}

/** This book's place with a universe key: its own, or the earlier book's place as `universe:<key>`. */
export function placeOfKey(key: string): string;
export function placeOfKey(key: string | null | undefined): string | null;
export function placeOfKey(key: string | null | undefined): string | null {
  if (key == null) return null;
  if (!places || !isPlace(key)) return key;
  const own = places.get(key);
  if (own) return own;
  if (qualify && key.startsWith(`${qualify}:`)) return key.slice(qualify.length + 1);
  return `${FOREIGN}${key}`;
}

interface KeyedSlot { parent?: string | null; owner?: string | null; sharers?: { mention?: string }[]; [field: string]: unknown }

const translated = <T extends KeyedSlot>(slot: T, to: (id: string | null | undefined) => string | null): T => ({
  ...slot,
  ...(slot.parent !== undefined ? { parent: to(slot.parent) } : {}),
  ...(slot.owner !== undefined ? { owner: to(slot.owner) } : {}),
  ...(Array.isArray(slot.sharers) ? { sharers: slot.sharers.map((share) => (share?.mention ? { ...share, mention: to(share.mention) } : share)) } : {}),
});

/** A slot of the universe's registry (keys) in this book's ids. */
export function slotToBook<T extends KeyedSlot>(slot: T): T {
  return keys ? translated(slot, placeOfKey) : slot;
}

/** A slot in this book's ids back in keys, for the universe's registry. */
export function slotToUniverse<T extends KeyedSlot>(slot: T): T {
  return keys ? translated(slot, placeKey) : slot;
}

/** The registry's slots (by id) in this book's ids, or back in keys. */
export function slotsToBook<T extends KeyedSlot>(slots: Record<string, T>): Record<string, T> {
  return keys ? Object.fromEntries(Object.entries(slots).map(([id, slot]) => [id, slotToBook(slot)])) : slots;
}
export function slotsToUniverse<T extends KeyedSlot>(slots: Record<string, T>): Record<string, T> {
  return keys ? Object.fromEntries(Object.entries(slots).map(([id, slot]) => [id, slotToUniverse(slot)])) : slots;
}
