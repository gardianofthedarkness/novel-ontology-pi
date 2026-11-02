/**
 * Composite buildings (the user, 2026-11-01; docs/v2/borrow-and-spawn.md §6): a shop, a restaurant, a bar, a cinema the text
 * passes by is part of a larger building (a mall, a tower's foot, a station, an underground mall), not a building of its
 * own. It joins a host under its holder where the characters' travel is least and takes no lot. Its floor and size: fixed
 * for some types (a convenience store on floor one), else asked of Jev in one question; it stands at a random spot of that
 * floor. Which types are tenants, the hosts each may join: config/spawning/composite.json.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { seeded } from "./config.js";

/** A tenant type: the uses of the buildings it may be part of (the likeliest first); a fixed floor and size; how many floors tall. */
export interface Tenancy { in: string[]; floor?: number; size?: number; floors?: number }
const DEFAULT = fileURLToPath(new URL("../../../../config/spawning/composite.json", import.meta.url));
/** The tenant types, by building type. */
export const loadTenancies = (file = DEFAULT): Record<string, Tenancy> => JSON.parse(readFileSync(file, "utf8")).tenants;

/** A building a tenant may join: one kept at the building level, or a spare lot of a host use. `top` its height, when kept. */
export interface Host { id: string; use: string; at: [number, number]; kept: boolean; top?: number | null }

/**
 * The host a tenant joins: of the hosts of a use it may be part of, the one where `travel` (the characters' travel, as the
 * borrowing measures it) is least; a building kept at this level before a spare lot at the same cost, then the likelier use.
 */
export function chooseHost(tenancy: Tenancy, hosts: Host[], travel: (at: [number, number]) => number): Host | null {
  const fit = hosts.filter((host) => tenancy.in.includes(host.use));
  if (!fit.length) return null;
  const cost = new Map(fit.map((host) => [host, travel(host.at)]));
  return [...fit].sort((a, b) => cost.get(a)! - cost.get(b)! || Number(b.kept) - Number(a.kept) || tenancy.in.indexOf(a.use) - tenancy.in.indexOf(b.use) || a.id.localeCompare(b.id))[0];
}

/** An option of the part's question: its letter, its value (a floor, −1 and −2 under the street; or m²), what it is in words. */
export interface PartOption { letter: string; value: number; said: string }
const LETTERS = "ABCDEFGHIJKLMNOPQRST";
const FLOORS = [1, 2, 3, 4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50, 60, 80, 100];
/** The floors a part may be on: two under the street, then its host's, its top floor among them (`floors` unknown: up to 20). */
export function partFloors(floors: number | null): PartOption[] {
  const top = floors && floors > 0 ? floors : 20, picked = [...new Set([...FLOORS.filter((floor) => floor < top), top])].slice(-(LETTERS.length - 2));
  return [[-2, "two floors under the street"], [-1, "one floor under the street"], ...picked.map((floor): [number, string] => [floor, floor === 1 ? "floor 1, at street level" : floor === top && floors ? `floor ${floor}, its top floor` : `floor ${floor}`])].map(([value, said], k) => ({ letter: LETTERS[k], value: value as number, said: said as string }));
}
const SIZES: [number, string][] = [[20, "a kiosk or a stall"], [50, "a small shop"], [100, "a shop"], [200, "a large shop or restaurant"], [500, "a hall"], [1000, "a big hall: a supermarket, a cinema"], [2000, "a very big hall"], [5000, "a whole wing"]];
/** The sizes a part may be (m²), up to a floor of its host (`area`, its whole floor among them; unknown: all). */
export function partSizes(area: number | null): PartOption[] {
  const fit = area ? SIZES.filter(([size]) => size < area * 0.9) : SIZES;
  return [...fit, ...(area ? [[Math.round(area), "the whole floor"] as [number, string]] : [])].map(([value, said], k) => ({ letter: LETTERS[k], value, said: `about ${value} m²: ${said}` }));
}
/** Where on its floor a part stands: a spot of the host's footprint, the same each time for the same part ([−0.5, 0.5] each way). */
export const spotOf = (id: string): [number, number] => [Math.round((seeded(`${id}|part-u`) - 0.5) * 1000) / 1000, Math.round((seeded(`${id}|part-v`) - 0.5) * 1000) / 1000];
