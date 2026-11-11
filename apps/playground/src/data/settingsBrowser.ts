/**
 * The world generator schema's resolver in the browser (config/world.schema.json; src/world/settings.ts reads files, which a
 * page cannot): the defaults and the tables bundled at build time, no layers. The frontend's build puts this module in
 * place of src/world/settings.ts for the world modules it shares (vite.config.ts `browserSettings`).
 */
import schemaJson from "../../../../config/world.schema.json";
import landscapes from "../../../../config/terrain/landscapes.json";

const revive = (value: unknown): unknown => (value === "Infinity" ? Infinity : Array.isArray(value) ? value.map(revive) : value && typeof value === "object" ? Object.fromEntries(Object.entries(value).map(([key, v]) => [key, revive(v)])) : value);
const keys = (schemaJson as { keys: Record<string, { default: unknown }> }).keys;
const TABLES: Record<string, unknown> = { "terrain.landscapes": landscapes };

export function setting<T = unknown>(key: string): T {
  const entry = keys[key];
  if (!entry) throw new Error(`no setting ${key} in config/world.schema.json`);
  return revive(entry.default) as T;
}
export function table<T = unknown>(name: string): T {
  if (!(name in TABLES)) throw new Error(`the table ${name} is not bundled for the browser (apps/playground/src/data/settingsBrowser.ts)`);
  return TABLES[name] as T;
}
