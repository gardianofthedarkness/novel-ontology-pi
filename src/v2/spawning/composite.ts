/**
 * Composite buildings (the user, 2026-11-01; docs/v2/borrow-and-spawn.md §6): a shop, a restaurant, a bar, a cinema the text
 * passes by is part of a larger building (a mall, a tower's foot, a station, an underground mall), not a building of its
 * own. It joins a host under its holder where the characters' travel is least, takes no lot and is asked nothing: no model
 * call. Which types are tenants, the hosts each may join and where in them: config/spawning/composite.json.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

export type Floor = "foot" | "upper" | "under";
/** A tenant type: the uses of the buildings it may be part of (the likeliest first), and where in its host it is. */
export interface Tenancy { in: string[]; at: "foot" | "upper" }
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

/** Where in its host a tenant is: under the street when its host is or its own sentences say so (地下), else its type's place. */
export const floorOf = (tenancy: Tenancy, host: Host, texts: string[]): Floor => (typeof host.top === "number" && host.top < 0) || texts.some((text) => /地下|underground|basement/i.test(text)) ? "under" : tenancy.at;
