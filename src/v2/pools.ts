import { existsSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import type { ReadingScript, ScriptPlace } from "./script.js";

/**
 * Sampling pools (docs/v2/world-engine-v2.md §2.0.11, the user's design, 2026-10-31). Every nominated area (a named
 * region, city or district) has a pool one level below it (a pool city, a pool district, a pool street): its backup
 * area, whose terrain is the area's own by default. What the text mentions in an area without nominating it (place EM's
 * unnamed places held there; a named building or room the tree puts nowhere) stands in that area's pool, not in a named
 * sibling picked at random. Where a thing could be in several areas, their pools are even chances, picked once by a seed
 * and kept. The pools are permanent across the books of one universe: the universe's registry keeps every pool ever made,
 * keyed by its area's name, and its members by book, in the order they were placed. A rule of the tree (layer 4 of
 * docs/v2/world-model.md): it decides without a model, and the world engine lays the pools out (placeCanvas.ts).
 */
export const POOL_BELOW: Record<string, string> = { region: "city", city: "district", district: "street" };
const RANK: Record<string, number> = { room: 0, building: 1, street: 2, district: 3, city: 4, region: 5 };
export const poolId = (areaLabel: string) => `pool:${areaLabel}`;
export const isPool = (id: string) => id.startsWith("pool:");
/** A member of a pool from another book of the universe: stands as a marker, so this book's members keep clear of it. */
export const elsewhereId = (book: string, id: string) => `elsewhere:${book}/${id}`;

export interface PoolMember { id: string; label: string; scale: string | null }
/** The universe's pools: every pool ever made, its area by book, its members by book in the order placed, and the picks kept. */
export interface PoolRegistry {
  version: 1;
  pools: Record<string, { area: string; areaScale: string; scale: string; books: Record<string, string>; members: Record<string, PoolMember[]> }>;
  /** A thing that could be in several areas: the pool picked for it, by book (kept: a pick is made once). */
  picks: Record<string, Record<string, string>>;
}
export const emptyRegistry = (): PoolRegistry => ({ version: 1, pools: {}, picks: {} });

/** One of several choices, each as likely, picked by a seed (the same every run; the choices' order does not matter). */
export function evenPick(seed: string, choices: string[]): string {
  const sorted = [...new Set(choices)].sort(), hash = [...seed].reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) >>> 0, 7);
  return sorted[hash % sorted.length];
}

/**
 * The universe a workspace belongs to: the library its volumes are imported into (a host's state: catalog.json, job.json),
 * with the book's key there (vol-1); a workspace in no library is a universe of its own.
 */
export function universeOf(novelDir: string): { dir: string; book: string } {
  const volume = dirname(novelDir), library = dirname(volume);
  return existsSync(join(library, "catalog.json")) || existsSync(join(library, "job.json")) ? { dir: join(library, "universe"), book: basename(volume) } : { dir: join(novelDir, "stage", "universe"), book: "book" };
}

/**
 * The script with its pools: a pool place for every nominated area (its scale one below the area's), what is not nominated
 * moved into its area's pool, the even picks made (or kept), the other books' members as markers; and the registry with
 * this book's pools and members. Order: the reading's places, the pools, then each pool's members by book (earlier books
 * first), so a later book's members are laid out after an earlier one's, which never move.
 */
export function withPools(script: ReadingScript, registry: PoolRegistry, book: string): { script: ReadingScript; registry: PoolRegistry; pools: number; pooled: number; picked: number } {
  const places: Record<string, ScriptPlace> = Object.fromEntries(Object.entries(script.places).filter(([id]) => !isPool(id) && !id.startsWith("elsewhere:")).map(([id, place]) => [id, { ...place }]));
  const next: PoolRegistry = { version: 1, pools: { ...registry.pools }, picks: { ...registry.picks, [book]: { ...(registry.picks[book] ?? {}) } } };
  const nominated = Object.entries(places).filter(([, place]) => !place.unnamed && place.scale && POOL_BELOW[place.scale]);
  const poolOf = new Map<string, string>(), made: Record<string, ScriptPlace> = {};
  for (const [id, area] of nominated) {
    const pool = poolId(area.label), scale = POOL_BELOW[area.scale!];
    poolOf.set(id, pool);
    made[pool] = { label: `${area.label} · pool`, scale, parent: id, pool: id };
    const entry = next.pools[pool] ?? { area: area.label, areaScale: area.scale!, scale, books: {}, members: {} };
    next.pools[pool] = { ...entry, books: { ...entry.books, [book]: id }, members: { ...entry.members, [book]: [] } };
  }
  const fits = (place: ScriptPlace, pool: string) => (RANK[place.scale ?? "building"] ?? 1) <= (RANK[made[pool].scale ?? "street"] ?? 2);
  const allPools = [...poolOf.values()];
  const members = new Map<string, string>();
  let picked = 0;
  for (const [id, place] of Object.entries(places)) {
    // A named place is nominated: a named area, or a named building the tree puts somewhere, stays where it is.
    if (!place.unnamed && (place.parent || (RANK[place.scale ?? "building"] ?? 1) >= RANK.street)) continue;
    // Held by a nominated area: its pool. Held by a building, a room or a street: stays where it is.
    if (place.parent) { const pool = poolOf.get(place.parent); if (pool && fits(place, pool)) members.set(id, pool); continue; }
    // Held by nothing: the pools of the areas it could be in (where its scenes are set), each as likely; with none, any pool.
    const areas = place.nears ?? (place.near ? [place.near] : []), choices = areas.map((area) => poolOf.get(area)).filter((pool): pool is string => !!pool && fits(place, pool));
    const open = choices.length ? choices : allPools.filter((pool) => fits(place, pool));
    if (!open.length) continue;
    const kept = next.picks[book][id], pool = kept && open.includes(kept) ? kept : evenPick(`${book}:${id}`, open);
    next.picks[book][id] = pool;
    if (open.length > 1) { place.pools = [...new Set(open)].sort(); picked++; }
    members.set(id, pool);
  }
  for (const [id, pool] of members) {
    const place = places[id];
    // A named place the tree puts nowhere keeps its own parent empty (canon says nothing): the engine samples it into the pool.
    if (place.unnamed) place.parent = pool; else place.near = pool;
    next.pools[pool].members[book].push({ id, label: place.label, scale: place.scale });
  }
  // The other books' members, as markers in their pools: earlier books' before this book's members, later ones' after.
  const books = (pool: string) => Object.keys(next.pools[pool].members).filter((other) => other !== book).sort();
  const marker = (pool: string, other: string, member: PoolMember): [string, ScriptPlace] => [elsewhereId(other, member.id), { label: `${member.label} · ${other}`, scale: member.scale, parent: pool, unnamed: true, elsewhere: other }];
  const before = Object.keys(made).flatMap((pool) => books(pool).filter((other) => other < book).flatMap((other) => next.pools[pool].members[other].map((member) => marker(pool, other, member))));
  const after = Object.keys(made).flatMap((pool) => books(pool).filter((other) => other > book).flatMap((other) => next.pools[pool].members[other].map((member) => marker(pool, other, member))));
  const own = [...members.keys()], rest = Object.entries(places).filter(([id]) => !members.has(id));
  const ordered = Object.fromEntries([...rest, ...Object.entries(made), ...before, ...own.map((id) => [id, places[id]] as [string, ScriptPlace]), ...after]);
  return { script: { ...script, places: ordered }, registry: next, pools: Object.keys(made).length, pooled: members.size, picked };
}
