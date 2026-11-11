// World · Live's handles (milestones M8d, M10i): the world generator's settings as the schema describes them, read for the
// Settings panel and written through `novel settings set` (checked, layered, logged with the panel's why); the model
// warehouse read for the Warehouse panel and a part connected to a slot through `novel warehouse use`. Everything goes
// through the same commands an agent runs, from the built CLI (dist/); nothing here asks a model.
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo } from './config.mjs';

const load = path => import(pathToFileURL(resolve(repo, path)).href);
const clip = (value, length) => (typeof value === 'string' ? value.slice(0, length) : null);
const PLACE = /^[\w:-]{1,80}$/, KEY = /^[a-z][\w.]{1,60}$/i, REF = /^[a-z][a-z0-9_-]*:[\p{L}\p{N}._-]{1,120}$/u, SLOT = /^(prop|vehicle|kind|use|role):[\p{L}\p{N} .-]{1,60}$/u;

/** The settings as they resolve for the book (or a place), by group, with each key's meaning, unit, range, kind, layers and when a change takes effect. */
export async function settingsView(workspace, { place = null } = {}) {
  const S = await load('dist/src/cli/commands/extract/settingsCommands.js'), V = await load('dist/src/world/settings.js');
  const shown = await S.settingsShow(workspace, { place: place ?? undefined }), schema = V.schema(), groups = schema.groups ?? {};
  const byGroup = {};
  for (const row of shown.settings) {
    const entry = schema.keys[row.key], group = row.key.split('.')[0];
    (byGroup[group] ??= { about: groups[group]?.about ?? null, after: groups[group]?.after ?? null, keys: [] }).keys.push({ ...row, meaning: entry.meaning, range: entry.range ?? null, layers: entry.layers, default: entry.default, settable: entry.layers.length > 0, forPlace: entry.layers.includes('place') });
  }
  const tables = Object.entries(schema.tables).map(([name, entry]) => ({ name, meaning: entry.meaning, layers: entry.layers, file: entry.file }));
  return { scope: shown.scope, layers: shown.layers, changed: shown.changed, count: shown.count, groups: byGroup, tables, overrides: V.overridesOf({ book: resolve(workspace), place }).map(({ layer, place: at, key, value, table }) => ({ layer, place: at, key, value, table })) };
}

/** A change from the panel: { key, value, place?, why, before?, table?, unset? } → novel settings set|unset; the reply says problems or when it takes effect. */
export async function applySetting(workspace, body) {
  const key = clip(body?.key, 80), why = clip(body?.why, 400)?.trim(), place = clip(body?.place, 80) || undefined;
  if (!key || !KEY.test(key) || !why) return { error: 'a key and a why are needed' };
  if (place && !PLACE.test(place)) return { error: 'a bad place id' };
  const S = await load('dist/src/cli/commands/extract/settingsCommands.js'), options = { place, why, before: body?.before === true, isTable: body?.table === true, by: 'World · Live' };
  try {
    if (body?.unset === true) return { ok: true, ...(await S.settingsUnset(workspace, key, options)) };
    if (!('value' in (body ?? {}))) return { error: 'a value is needed' };
    return { ok: true, ...(await S.settingsSet(workspace, key, JSON.stringify(body.value), options)) };
  } catch (error) { return { error: String(error?.message ?? error).slice(0, 600) }; }
}

/** The warehouse for the panel: the sources, and parts found for a few words (or a source's parts when no words are given). */
export async function warehouseView(workspace, { find = '', kind = null, category = null, source = null, size = null, top = 40 } = {}) {
  const W = await load('dist/src/cli/commands/extract/warehouseCommands.js');
  const sources = await W.warehouseList({ novelDir: workspace });
  const words = clip(find, 120)?.trim() ?? '';
  const found = words || source || category ? await W.warehouseFind(words || (category ?? source ?? ''), { kind: clip(kind, 60) || undefined, category: clip(category, 40) || undefined, source: clip(source, 40) || undefined, size: Number.isFinite(Number(size)) && Number(size) > 0 ? Number(size) : undefined, top: Math.min(200, Math.max(1, Number(top) || 40)), novelDir: workspace }) : null;
  const V = await load('dist/src/world/settings.js'), at = { book: resolve(workspace) };
  const slots = { props: V.setting('fill.props', at), vehicles: V.setting('models.vehicles', at), parts: V.setting('models.parts', at) };
  // The slots a part may go to, from the kinds the code knows and the uses the table has (one list, the panel's too).
  const PR = await load('dist/src/world/models/partRefs.js'), MD = await load('dist/src/world/models/models.js'), uses = V.table('models.uses', at);
  const slotChoices = [...PR.PROP_KINDS_FOR_PARTS.map(kind => `prop:${kind}`), ...PR.VEHICLE_KINDS.map(kind => `vehicle:${kind}`), ...[...MD.PART_KINDS].map(kind => `kind:${kind}`), ...Object.keys(uses.uses ?? {}).map(use => `use:${use}`), ...Object.keys(uses.roles ?? {}).map(role => `role:${role}`)];
  return { sources: sources.sources, allowedLicences: sources.allowedLicences, found, slots, slotChoices };
}

/** A part connected to a slot from the panel: { part, slot, why, place?, before?, floors? } → novel warehouse use. */
export async function useWarehousePart(workspace, body) {
  const part = clip(body?.part, 120), slot = clip(body?.slot, 80), why = clip(body?.why, 400)?.trim(), place = clip(body?.place, 80) || undefined;
  if (!part || !REF.test(part) || !slot || !SLOT.test(slot) || !why) return { error: 'a part, a slot and a why are needed' };
  if (place && !PLACE.test(place)) return { error: 'a bad place id' };
  const floors = Array.isArray(body?.floors) && body.floors.length === 2 && body.floors.every(v => Number.isInteger(v) && v > 0) ? body.floors : undefined;
  const W = await load('dist/src/cli/commands/extract/warehouseCommands.js');
  try { return { ok: true, ...(await W.warehouseUse(workspace, part, slot, { why, place, before: body?.before === true, floors, by: 'World · Live' })) }; } catch (error) { return { error: String(error?.message ?? error).slice(0, 600) }; }
}
