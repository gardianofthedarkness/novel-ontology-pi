/**
 * Warehouse part references and the slot maps that hold them (milestones M10i; docs/v2/models-and-settings.md §8.4). A
 * part is `<source>:<part>`: `kit:cw_wpn_ak` (gkNextEngine's kits), `pack:suburban-01` (the baked CC0 packs),
 * `own:m1234abcd` (the universe's own models), or any source registered with `novel warehouse add`. The three slot
 * settings are maps from a kind to a part; `checkPartMap` is what the settings schema holds them to (settings.ts).
 */
export const PART_REF = /^[a-z][a-z0-9_-]*:[\w.-]+$/;
export const PROP_KINDS_FOR_PARTS = ["tree", "street-light", "bench", "bin", "car", "bollard"] as const;
export const VEHICLE_KINDS = ["a car", "a van or a truck", "a bus", "a train or a carriage", "a motorbike or a bicycle", "a boat", "a helicopter", "an aircraft", "a drone"] as const;

/** What is wrong with a kind -> part map for `fill.props`, `models.vehicles` or `models.parts` (empty when fine). */
export function checkPartMap(key: string, value: unknown): string[] {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return [`${key} must be an object: { "<kind>": "<source>:<part>" }`];
  const out: string[] = [];
  const kinds: readonly string[] | null = key === "fill.props" ? PROP_KINDS_FOR_PARTS : key === "models.vehicles" ? VEHICLE_KINDS : null;
  for (const [kind, part] of Object.entries(value as Record<string, unknown>)) {
    if (kinds && !kinds.includes(kind)) out.push(`${key}.${kind}: not a kind here (${kinds.join(", ")})`);
    if (part !== null && (typeof part !== "string" || !PART_REF.test(part))) out.push(`${key}.${kind} must be a part reference <source>:<part> (novel warehouse find), or null to take none`);
  }
  return out;
}

/** The source and part of a reference, or null. */
export function splitRef(ref: string): { source: string; part: string } | null {
  const m = PART_REF.test(ref) ? ref.match(/^([^:]+):(.+)$/) : null;
  return m ? { source: m[1], part: m[2] } : null;
}

/** The page's model id for a part reference (the same reference always gives the same id; `scad:<id>` on the page). */
export const idOfRef = (ref: string) => { let h = 2166136261; for (const c of `part:${ref}`) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); } return `w${(h >>> 0).toString(16).padStart(8, "0")}`; };
