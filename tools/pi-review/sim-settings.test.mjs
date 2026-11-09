// World · Live's handles (sim-settings.mjs; milestones M8d, M10i): the settings view by group, a change written through the
// schema with a why, the warehouse view, and a part connected to a slot; bad bodies refused. Needs the built CLI (dist/).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { applySetting, settingsView, useWarehousePart, warehouseView } from './sim-settings.mjs';

const root = mkdtempSync(join(tmpdir(), 'handles-'));
process.env.NOVEL_MODEL_PACKS = join(root, 'packs'); process.env.NOVEL_WAREHOUSE = join(root, 'packs', 'warehouse.json'); mkdirSync(join(root, 'packs'), { recursive: true });
function library(name) {
  const lib = join(root, name), novel = join(lib, 'vol-1', 'novel');
  mkdirSync(join(lib, 'universe'), { recursive: true }); mkdirSync(join(novel, 'stage'), { recursive: true }); mkdirSync(join(lib, 'vol-1', 'reading'), { recursive: true });
  writeFileSync(join(lib, 'universe', 'terrain.json'), '{}\n'); writeFileSync(join(novel, 'stage', 'terrain.json'), '{}\n');
  return { lib, novel };
}

test('the settings view groups every key with its meaning, range and layers; a change with a why lands in the book layer and its log', async () => {
  const { novel } = library('a');
  const view = await settingsView(novel);
  assert.ok(view.count >= 70 && view.groups.fill && view.groups.fill.after.includes('next run'));
  const earshot = view.groups.talk.keys.find(row => row.key === 'talk.earshot');
  assert.ok(earshot.meaning.length > 10 && Array.isArray(earshot.layers) && earshot.settable);
  assert.deepEqual(await applySetting(novel, { key: 'talk.earshot', value: 12 }), { error: 'a key and a why are needed' });
  const set = await applySetting(novel, { key: 'talk.earshot', value: 12, why: 'a closer talk for the test' });
  assert.equal(set.ok, true); assert.equal(set.layer, 'universe', 'talk.earshot is a universe key');
  const refused = await applySetting(novel, { key: 'talk.earshot', value: 'near', why: 'wrong' });
  assert.match(refused.error, /Refused/);
  const placed = await applySetting(novel, { key: 'fill.ops', value: [{ op: 'scatter', what: 'tree', on: 'street', n: 10 }], place: 'loc_000001', why: 'trees in the city' });
  assert.equal(placed.ok, true); assert.equal(placed.layer, 'book');
  const file = JSON.parse(readFileSync(join(novel, 'stage', 'settings.json'), 'utf8'));
  assert.equal(file.places.loc_000001.values['fill.ops'][0].what, 'tree'); assert.equal(file.log.at(-1).by, 'World · Live');
  const again = await settingsView(novel, { place: 'loc_000001' });
  assert.ok(again.overrides.some(row => row.key === 'fill.ops' && row.place === 'loc_000001'));
  const unset = await applySetting(novel, { key: 'talk.earshot', unset: true, why: 'back to the default' });
  assert.equal(unset.ok, true); assert.equal(unset.found, true);
});

test('the warehouse view lists the sources and the slots in use; a part goes to a slot with a why, a bad slot or part is refused', async () => {
  const { novel } = library('b');
  const view = await warehouseView(novel, {});
  assert.ok(view.sources.some(source => source.name === 'kit') && view.sources.some(source => source.name === 'pack'));
  assert.deepEqual(view.slots, { props: {}, vehicles: {}, parts: {} });
  const found = await warehouseView(novel, { find: 'sedan', source: 'pack' });
  assert.ok(found.found.parts.length >= 1 && found.found.parts[0].ref.startsWith('pack:'), JSON.stringify(found.found.parts.slice(0, 2)));
  const part = found.found.parts[0].ref;
  assert.deepEqual(await useWarehousePart(novel, { part, slot: 'vehicle:a car' }), { error: 'a part, a slot and a why are needed' });
  const used = await useWarehousePart(novel, { part, slot: 'vehicle:a car', why: 'the test car' });
  assert.equal(used.ok, true); assert.equal(used.connected.slot, 'vehicle:a car');
  assert.deepEqual((await warehouseView(novel, {})).slots.vehicles, { 'a car': part });
  assert.match((await useWarehousePart(novel, { part, slot: 'prop:Lamp Post!', why: 'x' })).error, /needed|not a kind here/);
  assert.match((await useWarehousePart(novel, { part: 'pack:no_such_model', slot: 'prop:car', why: 'x' })).error, /No part/);
});
