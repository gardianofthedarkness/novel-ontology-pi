/**
 * The place tree with slots instead of pools (docs/v2/borrow-and-spawn.md §2.2–2.7), as terrain spawning and the world's
 * export both read it when a book's terrain is made by borrowing and spawning (stage/terrain.json `mode: "spawn"`):
 *  - no pools: a pool's members stand in the pool's own area (a place the text puts only in 学园都市 is held by 学园都市, and
 *    borrows among the slots under it: §2.5);
 *  - every placed slot no named place owns (spare, or shared by unnamed mentions) is a place of its level in its area;
 *  - a named place stands in its slot's area, an unnamed mention in the slot it shares this book.
 * The stage inputs are changed in place, so every later reader of them (paths, scales, names, the canvas) sees one tree.
 */
import { TERRAIN_KINDS } from "../context/terrainModes.js";
import type { Level } from "./config.js";
import { sharersIn, type Slot } from "./slots.js";

/** A slot as terrain keeps it: the core's slot, with its offset from its area (`toward`, as a kept site's) instead of a world point. */
export type KeptSlot = Omit<Slot, "at"> & { toward: [number, number] | null };

interface TreePlace { id: string; label: string; parentId: string | null; proposedParentId?: string | null; path?: string[]; sceneIds?: string[] }
interface ScriptPlace { label: string; parent?: string | null; pool?: string; scale?: string; [key: string]: unknown }
export interface SlotInputs {
  placeTree?: TreePlace[];
  world?: { places: Record<string, ScriptPlace> } | null;
  names: Record<string, string>;
  scale?: { places: Record<string, { label?: string; scale: string; inputs?: string }> } | null;
}

/** What an unnamed place is called without its scene (two of the same words in two scenes are the same words). */
export const baseLabel = (label: string) => label.replace(/ \(scene \d+\)$/, "");

/** A slot's name on the map: a spare one by its kind, a shared one by what its sharers call it. */
export function slotLabel(slot: KeptSlot, book: string, names: Record<string, string>): string {
  const sharers = sharersIn(slot as unknown as Slot, book);
  if (!sharers.length) return `${slot.kind} · spare`;
  const words = baseLabel(names[sharers[0].mention] ?? sharers[0].mention);
  return sharers.length > 1 ? `${words} · ${sharers.length} scenes` : words;
}

/** A slot's default terrain (§2.2): its kind's ground, the middle of its medians and its manifold; a natural kind's shape and top. */
export function defaultTerrain(level: Level, kind: string): { ground?: string; median?: number; manifold?: unknown; shape?: string; top?: number } | null {
  const entry = (TERRAIN_KINDS as Record<string, Record<string, { ground?: string; manifold?: unknown; medians?: number[]; shape?: string; tops?: number[] }>>)[level]?.[kind];
  if (!entry) return null;
  if (entry.shape) return { shape: entry.shape, ...(entry.tops?.length ? { top: entry.tops[Math.floor(entry.tops.length / 2)] } : {}) };
  return { ground: entry.ground, ...(entry.medians?.length ? { median: entry.medians[Math.floor(entry.medians.length / 2)], manifold: entry.manifold } : {}) };
}

/** The stage inputs with slots instead of pools, changed in place (see above); returns which places were moved where. */
export function withSlots(inputs: SlotInputs, slots: KeptSlot[], book: string): { moved: Record<string, string>; added: string[] } {
  const script = inputs.world?.places ?? {}, tree = inputs.placeTree ?? [], moved: Record<string, string> = {}, added: string[] = [];
  const poolArea = new Map(Object.entries(script).filter(([id]) => id.startsWith("pool:")).map(([id, place]) => [id, (place.pool ?? place.parent ?? null) as string | null]));
  const area = (id: string | null | undefined) => (id && poolArea.has(id) ? poolArea.get(id) ?? null : id ?? null);
  const parentOf = new Map<string, string | null>();
  for (const place of tree) parentOf.set(place.id, place.parentId);
  // 1. No pools.
  for (const id of poolArea.keys()) delete script[id];
  for (const [id, place] of Object.entries(script)) if (place.parent && poolArea.has(place.parent)) { place.parent = area(place.parent); moved[id] = place.parent ?? ""; }
  for (let n = tree.length - 1; n >= 0; n--) if (poolArea.has(tree[n].id)) tree.splice(n, 1);
  for (const place of tree) {
    if (place.parentId && poolArea.has(place.parentId)) { place.parentId = area(place.parentId); moved[place.id] = place.parentId ?? ""; }
    if (place.proposedParentId && poolArea.has(place.proposedParentId)) place.proposedParentId = area(place.proposedParentId);
  }
  // 2. Placed slots no name owns are places of their level; owners and this book's sharers stand under them.
  const byId = new Map(tree.map((place) => [place.id, place]));
  const reparent = (id: string, parent: string) => {
    const place = byId.get(id);
    if (place && place.parentId !== parent) { place.parentId = parent; place.proposedParentId = null; moved[id] = parent; }
    if (script[id] && script[id].parent !== parent) { script[id].parent = parent; moved[id] = parent; }
  };
  for (const slot of slots.filter((entry) => entry.toward)) {
    if (slot.owner) { reparent(slot.owner, slot.parent); continue; }
    const label = slotLabel(slot, book, inputs.names);
    if (!byId.has(slot.id)) { const place = { id: slot.id, label, parentId: slot.parent, proposedParentId: null, path: [], sceneIds: [] }; tree.push(place); byId.set(slot.id, place); added.push(slot.id); }
    inputs.names[slot.id] = label;
    if (inputs.scale) inputs.scale.places[slot.id] = { label, scale: slot.level, inputs: "" };
    script[slot.id] = { label, scale: slot.level, parent: slot.parent, slot: true };
    for (const share of sharersIn(slot as unknown as Slot, book)) reparent(share.mention, slot.id);
  }
  // 3. Paths again, from the parents (a place whose chain moved, and every place under it).
  const pathOf = new Map<string, string[]>();
  const path = (id: string, seen = new Set<string>()): string[] => {
    if (pathOf.has(id)) return pathOf.get(id)!;
    const place = byId.get(id), parent = place?.parentId ?? script[id]?.parent ?? null;
    const result = parent && !seen.has(parent) && (byId.has(parent) || script[parent]) ? [...path(parent, new Set([...seen, id])), id] : (place?.path?.length ? place.path : [id]);
    pathOf.set(id, result);
    return result;
  };
  const touched = new Set([...Object.keys(moved), ...added]);
  for (const place of tree) if (touched.has(place.id) || (place.path ?? []).some((at) => poolArea.has(at) || touched.has(at))) place.path = path(place.id);
  return { moved, added };
}
