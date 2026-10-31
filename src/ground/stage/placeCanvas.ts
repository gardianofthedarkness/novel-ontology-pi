import { addPatch, circleOf, firstLandscape, LANDSCAPE_VERSION, placeBeside, type Landscape, type LandscapeType, type Patch } from "./landscape.js";
import type { Point } from "./cityFill.js";

/**
 * The canvas of places, built from the bottom up. Every recognised place (a city, a district like 第七学区, a street,
 * a building) is a circle of its own, in its own frame (its centre at the origin), sitting at an offset in its
 * parent's frame. Places are born when the story first needs them, smallest first: a building known to belong to a
 * district brings the district (and the city above it) into being around it, and every circle is as large as what
 * is built inside it, so it grows as things are added:
 *
 * - a place's radius encloses its own landscape (its centre-filled patches), the named buildings and streets placed
 *   in it, and its children's circles, never less than its scale's least radius;
 * - a newborn child takes the free spot nearest its parent's middle (or toward a direction), clear of its siblings
 *   and of the parent's own ground;
 * - when a circle grows into a sibling, the sibling is pushed aside, whole: places move only as rigid circles in
 *   their parent's frame, so nothing inside any place ever moves in its own frame. Growth then carries on up.
 */
/** sampled: the place the tree put it in, when it stands in an area of that place picked by a seed (see holderFor). */
export interface Unit { id: string; label: string; kind: "building" | "street" | "room"; at: Point; r: number; sampled?: string }
/**
 * temporary: an unnamed area holding what is known only to lie somewhere in a larger place, until the text names it.
 * dwelling: the area of the central build a place the ontology puts in no larger one dwells in, until it is named.
 * pool: a sampling pool's area (docs/v2/world-engine-v2.md §2.0.11): it holds what that area has that is not nominated,
 * its members kept POOL_SPACING apart, and grows as they come.
 */
export interface CanvasPlace { id: string; label: string; scale: string; parent: string | null; at: Point; landscape: Landscape | null; units: Unit[]; r: number; born: number; temporary?: boolean; dwelling?: string; pool?: string }
export interface Canvas { places: Record<string, CanvasPlace>; born: number }

/** The least radius of a place of each scale, in metres, before anything is built in it. */
export const LEAST: Record<string, number> = { region: 300, city: 120, district: 60, street: 30, building: 12, room: 4 };
const GAP = 10;
/** How far apart a pool keeps its members, by their kind (metres between their circles). */
export const POOL_SPACING: Record<Unit["kind"], number> = { street: 40, building: 20, room: 8 };
export const emptyCanvas = (): Canvas => ({ places: {}, born: 0 });
/** A place's children; with null, the places at the top of the canvas (each a sibling of the others). */
const childrenOf = (canvas: Canvas, id: string | null) => Object.values(canvas.places).filter((place) => place.parent === id);

/** What a place's circle must hold, in its own frame: its ground, its units, its children. */
export function radiusOf(canvas: Canvas, id: string): number {
  const place = canvas.places[id];
  const parts = [LEAST[place.scale] ?? 30, ...(place.landscape?.patches.length ? [circleOf(place.landscape, 0)] : []), ...place.units.map((unit) => Math.hypot(...unit.at) + unit.r), ...childrenOf(canvas, id).map((child) => Math.hypot(...child.at) + child.r)];
  return Math.round(Math.max(...parts) + GAP);
}

/** Recompute a place's circle; push siblings it now overlaps aside (whole); carry on up. */
export function grow(canvas: Canvas, id: string): Canvas {
  const place = canvas.places[id];
  place.r = radiusOf(canvas, id);
  const parent = place.parent ? canvas.places[place.parent] : null, siblings = childrenOf(canvas, place.parent);
  // The parent's own ground stays put at its middle; every other overlap is settled by moving the younger circle (or
  // the one not growing) along the line between the centres, as little as clears it. Top-level places are siblings too.
  const own = parent?.landscape?.patches.length ? circleOf(parent.landscape, 0) : 0;
  for (let round = 0; round < 60; round++) {
    let moved = false;
    for (const a of siblings) {
      const fromOwn = Math.hypot(...a.at), clearOwn = own ? own + a.r + GAP : 0;
      if (own && fromOwn < clearOwn) { const u: Point = fromOwn > 1e-6 ? [a.at[0] / fromOwn, a.at[1] / fromOwn] : [1, 0]; a.at = [Math.round(u[0] * clearOwn * 10) / 10, Math.round(u[1] * clearOwn * 10) / 10]; moved = true; }
      for (const b of siblings) {
        if (a === b) continue;
        const d = Math.hypot(b.at[0] - a.at[0], b.at[1] - a.at[1]), need = a.r + b.r + GAP;
        if (d >= need) continue;
        const pushed = b.id === id ? a : a.id === id ? b : a.born > b.born ? a : b, other = pushed === a ? b : a;
        const u: Point = d > 1e-6 ? [(pushed.at[0] - other.at[0]) / d, (pushed.at[1] - other.at[1]) / d] : [1, 0];
        pushed.at = [Math.round((other.at[0] + u[0] * need) * 10) / 10, Math.round((other.at[1] + u[1] * need) * 10) / 10];
        moved = true;
      }
    }
    if (!moved) break;
  }
  return parent ? grow(canvas, parent.id) : canvas;
}

/**
 * A place born on the canvas: at the free spot nearest its parent's middle (or toward a direction), then grown up. `ground`:
 * its first patch as given (terrain spawning: the type and the size Jev chose), in place of one sampled from its type.
 */
export function bear(canvas: Canvas, place: { id: string; label: string; scale: string; parent: string | null; landscape?: LandscapeType | null; toward?: Point; ground?: Patch | null }): Canvas {
  if (canvas.places[place.id]) return canvas;
  const landscape = place.ground ? { version: LANDSCAPE_VERSION, seed: place.id, patches: [place.ground] } : place.landscape ? firstLandscape(place.id, place.landscape) : null, born = ++canvas.born;
  const entry: CanvasPlace = { id: place.id, label: place.label, scale: place.scale, parent: place.parent, at: [0, 0], landscape, units: [], r: 0, born };
  canvas.places[place.id] = entry;
  entry.r = radiusOf(canvas, place.id);
  const parent = place.parent ? canvas.places[place.parent] : null, own = parent?.landscape?.patches.length ? [{ x: 0, z: 0, r: circleOf(parent.landscape, 0) }] : [];
  const occupied = [...own, ...(parent?.units ?? []).map((unit) => ({ x: unit.at[0], z: unit.at[1], r: unit.r })), ...childrenOf(canvas, place.parent).filter((child) => child.id !== place.id).map((child) => ({ x: child.at[0], z: child.at[1], r: child.r }))];
  const spot = placeBeside(occupied, entry.r, place.id, place.toward, GAP);
  entry.at = [spot.x, spot.z];
  return parent ? grow(canvas, parent.id) : grow(canvas, place.id);
}

/**
 * From the bottom up: a place known to belong to a chain of larger ones (root first: the city, the district, the
 * street) brings each missing one into being, outermost first, so the smallest is born into the circle that holds it.
 */
export function bearChain(canvas: Canvas, chain: { id: string; label: string; scale: string; landscape?: LandscapeType | null; toward?: Point }[]): Canvas {
  chain.forEach((place, n) => bear(canvas, { ...place, parent: n ? chain[n - 1].id : null }));
  return canvas;
}

/** A named building, street or room built inside a place (in its own frame, at the free spot nearest `near`); the circle grows to hold it. */
export function addUnit(canvas: Canvas, placeId: string, unit: Omit<Unit, "at"> & { at?: Point }, near?: Point): Canvas {
  const place = canvas.places[placeId];
  if (place.units.some((entry) => entry.id === unit.id)) return canvas;
  const at = unit.at ?? (() => { const spot = placeBeside([...place.units.map((entry) => ({ x: entry.at[0], z: entry.at[1], r: entry.r })), ...childrenOf(canvas, placeId).map((child) => ({ x: child.at[0], z: child.at[1], r: child.r }))], unit.r, unit.id, near, place.pool ? POOL_SPACING[unit.kind] : 4); return [spot.x, spot.z] as Point; })();
  place.units.push({ ...unit, at });
  return grow(canvas, placeId);
}

/** A new part of a place's ground where a scene drifted past its edge (landscape.ts); the circle grows to hold it. */
export function addPart(canvas: Canvas, placeId: string, type: LandscapeType, toward: Point, born?: Patch["born"]): Canvas {
  const place = canvas.places[placeId];
  place.landscape = place.landscape ? addPatch(place.landscape, type, toward, born) : firstLandscape(placeId, type, born);
  return grow(canvas, placeId);
}

/** The scale one step below a place's, for an unnamed area inside it. */
const BELOW: Record<string, string> = { region: "city", city: "district", district: "street" };
const RANK: Record<string, number> = { room: 0, building: 1, street: 2, district: 3, city: 4, region: 5 };
/**
 * Where a building, room or street known only to lie somewhere in a larger place goes: when that place is a city or
 * larger, the level between is missing. It goes into an area already there inside that place at the next larger scale
 * than its own there is (a street, else a district), picked by a seed (its id), so the same in every run and the city
 * bounded (the user's call, 2026-10-31: sampled, as a place the tree puts nowhere dwells). Only a place with no such area
 * inside it gives the unit an unnamed temporary area one step below it (a district in a city), born like any place and
 * filled with the parent's landscape. Otherwise the place itself holds it. `sampledIn` says which it was.
 */
export function holderFor(canvas: Canvas, placeId: string, unitScale: string, unitId: string): string {
  const place = canvas.places[placeId];
  // The place's sampling pool, when it has one (the user's design: what is not nominated stands in its area's pool).
  const pool = poolOf(canvas, placeId);
  if (pool && (RANK[unitScale] ?? 1) <= (RANK[canvas.places[pool].scale] ?? 0)) return pool;
  if ((RANK[place.scale] ?? 0) < RANK.city || (RANK[place.scale] ?? 0) - (RANK[unitScale] ?? 1) < 2) return placeId;
  const inside = (id: string): boolean => { for (let at = canvas.places[id]?.parent; at; at = canvas.places[at]?.parent) if (at === placeId) return true; return false; };
  const areas = Object.values(canvas.places).filter((area) => isArea(area) && inside(area.id) && (RANK[area.scale] ?? 0) > (RANK[unitScale] ?? 1) && (RANK[area.scale] ?? 0) < (RANK[place.scale] ?? 0));
  const least = Math.min(...areas.map((area) => RANK[area.scale] ?? 0));
  if (areas.length) return pickBy(unitId, areas.filter((area) => (RANK[area.scale] ?? 0) === least).map((area) => area.id));
  const id = `tmp:${placeId}:${unitId}`;
  if (canvas.places[id]) return id;
  bear(canvas, { id, label: `an area of ${place.label}`, scale: BELOW[place.scale] ?? "district", parent: placeId, landscape: place.landscape?.patches[0]?.type ?? "residential" });
  const area: CanvasPlace = canvas.places[id];
  area.temporary = true;
  return id;
}
/** An area's sampling pool on the canvas, if it has one. */
export const poolOf = (canvas: Canvas, areaId: string): string | null => Object.values(canvas.places).find((place) => place.pool === areaId)?.id ?? null;
/** Whether holderFor sampled the unit into an area inside the place (not the place itself, nor a stand-in made for it). */
export const sampledIn = (canvas: Canvas, placeId: string, holder: string): boolean => holder !== placeId && !canvas.places[holder]?.temporary;
/**
 * When the text names the area a temporary one stood for: the temporary area becomes it, where it is, with all it
 * holds (its id, name and scale change; nothing moves). A named place already on the canvas keeps its own circle, and
 * the temporary one stays as it is.
 */
export function adopt(canvas: Canvas, temporaryId: string, named: { id: string; label: string; scale?: string }): Canvas {
  const area = canvas.places[temporaryId];
  if (!area?.temporary || canvas.places[named.id]) return canvas;
  delete canvas.places[temporaryId];
  canvas.places[named.id] = { ...area, id: named.id, label: named.label, scale: named.scale ?? area.scale, temporary: false };
  for (const place of Object.values(canvas.places)) if (place.parent === temporaryId) place.parent = named.id;
  return canvas;
}

/** An area of the central build (a place larger than a building), the place the ontology puts it in, if any, and else the one proposed for it (a pending review), if any. */
export interface BuildArea { id: string; label: string; scale: string; parent: string | null; proposed?: string | null; landscape?: LandscapeType | null; ground?: Patch | null; pool?: string }
/** One of several choices, picked by a seed (a place's id), so the same in every run; the choices' order does not matter. */
function pickBy(seed: string, choices: string[]): string {
  const sorted = [...choices].sort(), hash = [...seed].reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) >>> 0, 7);
  return sorted[hash % sorted.length];
}
const isArea = (place: CanvasPlace) => !place.temporary && (RANK[place.scale] ?? 0) > RANK.building;

/**
 * The central build, before any scene runs: every area larger than a building the ontology names (a region, a city, a
 * district, a street) is born on the canvas, the larger first, so every strand of the story stands in one city. An area
 * the ontology puts inside another is born in it. One it puts in no larger area (a district the text never places in a
 * city) dwells in the area proposed for it, while that waits for review; with none proposed, at a spot of the build
 * picked at random, inside one of its areas of the next larger scale there is (seeded by its id, so the same spot in
 * every run). It dwells until the ontology names where it belongs; the largest stay at the top. `toward` gives a newborn area a direction in its parent (the sibling it has most to do with). Returns where each
 * dwelling area dwells.
 */
export function centralBuild(canvas: Canvas, areas: BuildArea[], toward?: (id: string, parent: string | null) => Point | undefined): Record<string, string> {
  const ids = new Set(areas.map((area) => area.id)), dwelling: Record<string, string> = {}, rank = (scale: string) => RANK[scale] ?? 0;
  // A named parent (or else a proposed one) counts when it is an area of the build and its chain of parents does not loop back.
  const named = new Map(areas.map((area) => [area.id, area.parent && ids.has(area.parent) ? area.parent : area.proposed && ids.has(area.proposed) ? area.proposed : null]));
  const proposed = new Set(areas.filter((area) => !(area.parent && ids.has(area.parent)) && area.proposed && ids.has(area.proposed)).map((area) => area.id));
  for (const area of areas) { const seen = new Set([area.id]); for (let at = named.get(area.id); at; at = named.get(at)) { if (seen.has(at)) { named.set(area.id, null); break; } seen.add(at); } }
  let left = [...areas].sort((a, b) => rank(b.scale) - rank(a.scale));
  while (left.length) {
    const waiting: BuildArea[] = [];
    for (const area of left) {
      const parent = named.get(area.id) ?? null;
      if (parent && !canvas.places[parent]) { waiting.push(area); continue; }
      const hosts = parent ? [] : Object.values(canvas.places).filter((place) => isArea(place) && rank(place.scale) > rank(area.scale));
      const nearest = Math.min(...hosts.map((place) => rank(place.scale))), host = hosts.length ? pickBy(area.id, hosts.filter((place) => rank(place.scale) === nearest).map((place) => place.id)) : null;
      const into = parent ?? host, dwells = host ?? (parent && proposed.has(area.id) ? parent : null);
      bear(canvas, { ...area, parent: into, toward: toward?.(area.id, into) });
      if (area.pool) canvas.places[area.id].pool = area.pool;
      if (dwells) { canvas.places[area.id].dwelling = dwells; dwelling[area.id] = dwells; }
    }
    if (waiting.length === left.length) break;
    left = waiting;
  }
  return dwelling;
}

/**
 * Where a building the ontology puts in no area dwells: the area proposed for it (a pending review), when that is in the
 * build; else one of the build's districts and streets (with none, one of its larger areas), picked at random by the
 * building's id, until the text names where it is; null with no area at all.
 */
export function dwellingFor(canvas: Canvas, unitId: string, proposed?: string | null): string | null {
  if (proposed && canvas.places[proposed] && isArea(canvas.places[proposed])) return proposed;
  // With sampling pools, any pool, each as likely (the user's design); else as before.
  const pools = Object.values(canvas.places).filter((place) => place.pool && isArea(place));
  if (pools.length) return pickBy(unitId, pools.map((place) => place.id));
  const areas = Object.values(canvas.places).filter(isArea), own = areas.filter((place) => place.scale === "district" || place.scale === "street");
  const choices = (own.length ? own : areas).map((place) => place.id);
  return choices.length ? pickBy(unitId, choices) : null;
}

/** A place's centre on the whole canvas: its offset added up through its ancestors. */
export function worldOf(canvas: Canvas, id: string): Point {
  let x = 0, z = 0;
  for (let at: CanvasPlace | undefined = canvas.places[id]; at; at = at.parent ? canvas.places[at.parent] : undefined) { x += at.at[0]; z += at.at[1]; }
  return [x, z];
}
