/**
 * `novel settings show|explain|set|unset|diff` (milestones M8b; docs/v3/design.html#models-and-settings §4): the universal world
 * generator schema (config/world.schema.json) for an agent, concise and context-aware. A value resolves defaults <
 * universe (<library>/universe/settings.json) < book (<novel>/stage/settings.json) < place (`places.<id>` in either).
 * `set` checks a value against the schema before it writes, writes it to the layer it belongs in, logs who and why, and
 * with --before takes the book's new `before` snapshot (a full rerun restores the latest one, so a change without it is
 * either kept by --keep-edits or lost). JSON out; nothing here asks a model.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { forgetLayers, layersOf, merge, overridesOf, problemsOf, resolveSetting, schema, table, universeFor, type Layer } from "../../../world/settings.js";
import { latestSnapshot, libraryOf, readSnapshot, takeSnapshot } from "../../../ground/workspace/universe.js";

interface LayerFile { values?: Record<string, unknown>; tables?: Record<string, unknown>; places?: Record<string, { values?: Record<string, unknown>; tables?: Record<string, unknown> }>; log?: unknown[] }
const isObject = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function scopeOf(novelDir: string) {
  const book = resolve(novelDir), universe = universeFor(book);
  return { book, universe, files: { book: join(book, "stage", "settings.json"), universe: universe ? join(universe, "settings.json") : null } };
}

/** Effective values (with where each part came from), optionally only those under a prefix or changed from the default. */
export async function settingsShow(novelDir: string, options: { prefix?: string; place?: string; changed?: boolean } = {}) {
  const scope = scopeOf(novelDir), { keys, groups } = schema() as ReturnType<typeof schema> & { groups?: Record<string, { about: string }> };
  forgetLayers();
  const at = { book: scope.book, universe: scope.universe, place: options.place ?? null };
  const rows = Object.keys(keys).filter((key) => !options.prefix || key === options.prefix || key.startsWith(`${options.prefix}.`)).map((key) => {
    const { value, from } = resolveSetting(key, at), entry = keys[key];
    return { key, value, changed: !same(value, entry.default), from: from.length > 1 ? from.slice(1) : "default", unit: entry.unit, kind: entry.kind };
  }).filter((row) => !options.changed || row.changed);
  return {
    scope: at, layers: layersOf(at).map(({ layer, file, place }) => ({ layer, file, place })),
    settings: rows, count: rows.length, changed: rows.filter((row) => row.changed).length,
    groups: options.prefix ? undefined : Object.keys(groups ?? {}),
    next: rows.length ? `novel settings explain ${rows[0].key}` : "novel settings show <novel-dir> (no prefix) lists every key",
  };
}

/** What a key (or a table) means, its unit, range and kind, which layers may set it, where it is used and when a change takes effect. */
export function settingsExplain(key: string) {
  const all = schema() as ReturnType<typeof schema> & { groups?: Record<string, { about: string; after: string }> };
  const entry = all.keys[key], group = all.groups?.[key.split(".")[0]];
  if (entry) return { key, meaning: entry.meaning, unit: entry.unit, kind: entry.kind, range: entry.range ?? null, default: entry.default, layers: entry.layers, used: entry.used, group: group?.about ?? null, takesEffect: group?.after ?? null, set: entry.layers.length ? `novel settings set <novel-dir> ${key} '<JSON>' ${entry.layers.includes("place") ? "[--place <id>] " : ""}--why <text> [--before]` : "not settable" };
  const tableEntry = all.tables[key];
  if (tableEntry) return { table: key, file: tableEntry.file, meaning: tableEntry.meaning, layers: tableEntry.layers, used: tableEntry.used, parts: Object.keys((table<Record<string, unknown>>(key) as Record<string, unknown>).types as object ?? table<Record<string, unknown>>(key)).slice(0, 40), set: `novel settings set <novel-dir> ${key} '<JSON part>' --table --why <text> [--before]` };
  const near = Object.keys(all.keys).filter((name) => name.includes(key) || key.includes(name.split(".")[0])).slice(0, 12);
  throw new Error(`No setting or table "${key}".${near.length ? ` Near: ${near.join(", ")}.` : ""} novel settings show <novel-dir> lists every key.`);
}

async function readLayer(file: string): Promise<LayerFile> { return JSON.parse(await readFile(file, "utf8").catch(() => "{}")) as LayerFile; }
async function writeLayer(file: string, data: LayerFile) {
  await mkdir(dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(data, null, 1)}\n`, { mode: 0o644 }); await rename(temporary, file);
}

/** Which file and part a change goes to: the book's unless --layer universe or the key may not be set by a book. */
function targetOf(novelDir: string, key: string, options: { place?: string; layer?: Layer; isTable?: boolean }) {
  const scope = scopeOf(novelDir), all = schema(), layers = (options.isTable ? all.tables[key]?.layers : all.keys[key]?.layers) ?? [];
  if (!layers.length) throw new Error(options.isTable ? `No table "${key}".` : all.keys[key] ? `${key} is not settable (${all.keys[key].kind}: ${all.keys[key].meaning})` : `No setting "${key}" (novel settings explain ${key}).`);
  if (options.place && !layers.includes("place")) throw new Error(`${key} may not be set for one place (only: ${layers.join(", ")})`);
  const layer: Exclude<Layer, "place"> = options.layer && options.layer !== "place" ? options.layer : layers.includes("book") ? "book" : "universe";
  if (!layers.includes(layer)) throw new Error(`${key} may not be set by a ${layer} (only: ${layers.join(", ")})`);
  const file = layer === "book" ? scope.files.book : scope.files.universe;
  if (!file) throw new Error(`${novelDir} has no universe folder two levels up: a ${layer} setting needs a library (novel library init).`);
  return { scope, layer, file };
}

async function afterChange(novelDir: string, change: Record<string, unknown>, options: { why: string; before?: boolean }) {
  const library = libraryOf(resolve(novelDir));
  if (!library?.book) return { snapshot: null, note: "Not in a library: no snapshot taken." };
  if (!options.before) return { snapshot: null, note: `No snapshot taken: a full rerun restores the book's latest before, so this change is lost there unless kept (--keep-edits) or taken as a before: novel universe snapshot ${library.root} --book ${library.book} --before --why "<why>" (or set again with --before).` };
  const parent = (await latestSnapshot(library.root, { book: library.book, kind: "before" }))?.id ?? null;
  const made = await takeSnapshot(library.root, { book: library.book, kind: "before", why: `settings: ${JSON.stringify(change)}: ${options.why}`, parent });
  return { snapshot: made.id, note: "A new before: the next full rerun starts with this change." };
}

/** Set a value (or a table's part with --table) in its layer, after checking it against the schema. */
export async function settingsSet(novelDir: string, key: string, raw: string, options: { place?: string; layer?: Layer; why?: string; before?: boolean; isTable?: boolean; by?: string }) {
  if (!options.why?.trim()) throw new Error("--why <text> is required: say why this setting changes.");
  let value: unknown; try { value = JSON.parse(raw); } catch { value = raw; }
  const { layer, file } = targetOf(novelDir, key, options);
  const data = await readLayer(file), part = options.place ? ((data.places ??= {})[options.place] ??= {}) : data;
  if (options.isTable) {
    if (!isObject(value)) throw new Error(`A table's part must be a JSON object (e.g. '{"types":{"residential":{"cap":60}}}').`);
    (part.tables ??= {})[key] = merge(part.tables?.[key], value);
  } else {
    const merged = merge(part.values?.[key], value), problems = problemsOf(key, merged, options.place ? "place" : layer);
    if (problems.length) throw new Error(`Refused: ${problems.join("; ")}. novel settings explain ${key}`);
    (part.values ??= {})[key] = merged;
  }
  const at = new Date().toISOString(), change = { key, value, place: options.place ?? null, table: !!options.isTable };
  data.log = [...(data.log ?? []), { at, op: "set", ...change, layer, why: options.why, by: options.by ?? process.env.NOVEL_AGENT ?? null }].slice(-300);
  await writeLayer(file, data); forgetLayers();
  const now = options.isTable ? undefined : resolveSetting(key, { book: resolve(novelDir), place: options.place ?? null });
  return { set: change, layer, file, now: now ? { value: now.value, from: now.from.slice(1) } : undefined, ...(await afterChange(novelDir, change, { why: options.why, before: options.before })), takesEffect: settingsExplainSafe(key) };
}
function settingsExplainSafe(key: string) { try { const explained = settingsExplain(key) as { takesEffect?: string | null }; return explained.takesEffect ?? null; } catch { return null; } }

/** Take an override out of its layer (the value falls back to the layer below). */
export async function settingsUnset(novelDir: string, key: string, options: { place?: string; layer?: Layer; why?: string; before?: boolean; isTable?: boolean; by?: string }) {
  if (!options.why?.trim()) throw new Error("--why <text> is required.");
  const { layer, file } = targetOf(novelDir, key, options);
  if (!existsSync(file)) return { unset: key, found: false, file };
  const data = await readLayer(file), part = options.place ? data.places?.[options.place] : data, bag = options.isTable ? part?.tables : part?.values;
  if (!bag || !(key in bag)) return { unset: key, found: false, file };
  delete bag[key];
  const change = { key, place: options.place ?? null, table: !!options.isTable };
  data.log = [...(data.log ?? []), { at: new Date().toISOString(), op: "unset", ...change, layer, why: options.why, by: options.by ?? process.env.NOVEL_AGENT ?? null }].slice(-300);
  await writeLayer(file, data); forgetLayers();
  return { unset: key, found: true, layer, file, ...(await afterChange(novelDir, { unset: key, place: options.place ?? null }, { why: options.why, before: options.before })) };
}

/** What differs: from the defaults (every override in force, by layer and place), or the settings files against a snapshot. */
export async function settingsDiff(novelDir: string, options: { from?: string } = {}) {
  const scope = scopeOf(novelDir);
  const overrides = async (file: string | null, layer: string) => {
    if (!file || !existsSync(file)) return [];
    const data = await readLayer(file), out: { layer: string; place: string | null; key: string; value: unknown; table: boolean }[] = [];
    for (const [key, value] of Object.entries(data.values ?? {})) out.push({ layer, place: null, key, value, table: false });
    for (const [key, value] of Object.entries(data.tables ?? {})) out.push({ layer, place: null, key, value, table: true });
    for (const [place, own] of Object.entries(data.places ?? {})) {
      for (const [key, value] of Object.entries(own.values ?? {})) out.push({ layer, place, key, value, table: false });
      for (const [key, value] of Object.entries(own.tables ?? {})) out.push({ layer, place, key, value, table: true });
    }
    return out;
  };
  const now = [...(await overrides(scope.files.universe, "universe")), ...(await overrides(scope.files.book, "book"))];
  if (!options.from) return { against: "defaults", overrides: now, count: now.length };
  const library = libraryOf(scope.book);
  if (!library) throw new Error("--from needs the book to be in a library (its snapshots).");
  const snapshot = await readSnapshot(library.root, options.from), files = (snapshot as unknown as { files: Record<string, { sha: string }> }).files;
  const relOf = (file: string | null) => (file ? file.slice(resolve(library.root).length + 1) : null);
  const then: typeof now = [];
  for (const [file, layer] of [[scope.files.universe, "universe"], [scope.files.book, "book"]] as const) {
    const held = relOf(file) ? files[relOf(file)!] : undefined;
    if (!held) continue;
    const text = await readFile(join(library.root, "snapshots", "objects", held.sha.slice(0, 2), held.sha), "utf8");
    const data = JSON.parse(text) as LayerFile;
    for (const [key, value] of Object.entries(data.values ?? {})) then.push({ layer, place: null, key, value, table: false });
    for (const [place, own] of Object.entries(data.places ?? {})) for (const [key, value] of Object.entries(own.values ?? {})) then.push({ layer, place, key, value, table: false });
    for (const [key, value] of Object.entries(data.tables ?? {})) then.push({ layer, place: null, key, value, table: true });
  }
  const id = (row: { layer: string; place: string | null; key: string; table: boolean }) => `${row.layer}|${row.place ?? ""}|${row.table ? "table:" : ""}${row.key}`;
  const before = new Map(then.map((row) => [id(row), row])), after = new Map(now.map((row) => [id(row), row]));
  const added = now.filter((row) => !before.has(id(row))), removed = then.filter((row) => !after.has(id(row)));
  const changed = now.filter((row) => before.has(id(row)) && !same(before.get(id(row))!.value, row.value)).map((row) => ({ ...row, was: before.get(id(row))!.value }));
  return { against: options.from, added, removed, changed, count: added.length + removed.length + changed.length };
}

// ---- profiles (milestones M8d): a named set of overrides and nothing more ----------------------------------------------

interface Profile { version: 1; name: string; at: string; why: string; by: string | null; from: string; overrides: { layer: Layer; place: string | null; key: string; value: unknown; table: boolean }[] }
const profilesDir = (novelDir: string) => { const universe = universeFor(resolve(novelDir)); if (!universe) throw new Error(`${novelDir} has no universe folder two levels up: profiles live in a library (novel library init).`); return join(universe, "profiles"); };
const profileName = (name: string) => { if (!/^[a-z0-9][a-z0-9_-]{0,47}$/i.test(name)) throw new Error("A profile's name is letters, digits, - and _ (e.g. old-town, space-colony)."); return name; };

/** Keep the overrides in force (every layer and place) as a profile the universe holds; any agent or user makes one. */
export async function settingsProfileSave(novelDir: string, name: string, options: { why?: string; by?: string }) {
  if (!options.why?.trim()) throw new Error("--why <text> is required: say what this profile is.");
  const scope = scopeOf(novelDir), overrides = overridesOf({ book: scope.book, universe: scope.universe }).map(({ layer, place, key, value, table: isTable }) => ({ layer, place, key, value, table: isTable }));
  const profile: Profile = { version: 1, name: profileName(name), at: new Date().toISOString(), why: options.why, by: options.by ?? process.env.NOVEL_AGENT ?? null, from: scope.book, overrides };
  const file = join(profilesDir(novelDir), `${profile.name}.json`);
  await mkdir(dirname(file), { recursive: true }); await writeFile(`${file}.${process.pid}.tmp`, `${JSON.stringify(profile, null, 1)}\n`); await rename(`${file}.${process.pid}.tmp`, file);
  return { saved: profile.name, file, overrides: overrides.length, keys: [...new Set(overrides.map((entry) => entry.key))], next: `novel settings profile apply <novel-dir> ${profile.name} --why <text>` };
}

/** Set a profile's overrides one by one through the schema (each checked, layered and logged; a place's to its place). */
export async function settingsProfileApply(novelDir: string, name: string, options: { why?: string; before?: boolean; by?: string }) {
  if (!options.why?.trim()) throw new Error("--why <text> is required.");
  const file = join(profilesDir(novelDir), `${profileName(name)}.json`);
  if (!existsSync(file)) { const have = await settingsProfileList(novelDir); throw new Error(`No profile ${name}${have.profiles.length ? ` (have: ${have.profiles.map((entry) => entry.name).join(", ")})` : ""}.`); }
  const profile = JSON.parse(await readFile(file, "utf8")) as Profile, applied: { key: string; place: string | null; layer: Layer }[] = [], refused: { key: string; place: string | null; problem: string }[] = [];
  for (const [n, entry] of profile.overrides.entries()) {
    try {
      const set = await settingsSet(novelDir, entry.key, JSON.stringify(entry.value), { place: entry.place ?? undefined, layer: entry.layer === "place" ? undefined : entry.layer, why: `profile ${profile.name}: ${options.why}`, isTable: entry.table, by: options.by, before: options.before && n === profile.overrides.length - 1 });
      applied.push({ key: entry.key, place: entry.place, layer: set.layer });
    } catch (error) { refused.push({ key: entry.key, place: entry.place, problem: String((error as Error).message ?? error) }); }
  }
  return { applied: profile.name, overrides: applied.length, refused, keys: [...new Set(applied.map((entry) => entry.key))], takesEffect: "props, fill and landscape settings at the next run or rehearsal; the rest at the next director run", next: `novel settings diff ${novelDir}` };
}

/** The universe's profiles. */
export async function settingsProfileList(novelDir: string) {
  const dir = profilesDir(novelDir), { readdir } = await import("node:fs/promises");
  const names = existsSync(dir) ? (await readdir(dir)).filter((entry) => entry.endsWith(".json")) : [];
  const profiles = [];
  for (const entry of names) { const profile = JSON.parse(await readFile(join(dir, entry), "utf8")) as Profile; profiles.push({ name: profile.name, at: profile.at, why: profile.why, by: profile.by, overrides: profile.overrides.length, keys: [...new Set(profile.overrides.map((item) => item.key))] }); }
  return { dir, profiles, next: profiles.length ? `novel settings profile apply <novel-dir> ${profiles[0].name} --why <text>` : "novel settings profile save <novel-dir> <name> --why <text>" };
}
