import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPlaces } from './places-registry.mjs';

/** A book with one accepted world run: a city with two patches (manifolds), a district inside it, a named building on a lot. */
async function book(context) {
  const novel = await mkdtemp(join(tmpdir(), 'places-'));
  context.after(() => rm(novel, { recursive: true, force: true }));
  await mkdir(join(novel, 'ontology'), { recursive: true });
  await writeFile(join(novel, 'ontology', 'entities.jsonl'), [
    { id: 'loc_tower', kind: 'Location', names: [{ text: 'Clock Tower', kind: 'canonical' }, { text: 'the Tower', kind: 'alias' }], properties: { source: 'stage-objects', building: 'office' } },
    { id: 'item_bus', kind: 'Item', names: [{ text: 'Bus', kind: 'canonical' }], properties: { source: 'stage-objects' } },
  ].map(row => JSON.stringify(row)).join('\n'));
  const folder = join(novel, 'stage', 'simulation');
  await mkdir(join(folder, 'runs', 'line_a'), { recursive: true });
  const page = {
    exportedAt: '2026-10-29T10:00:00.000Z',
    macro: [{ id: 'city', label: 'City', scale: 'city', parent: null, x: 100, z: 50, r: 400, depth: 0 }, { id: 'ward', label: 'Ward', scale: 'district', parent: 'city', x: 300, z: 50, r: 120, depth: 1 }, { id: 'hall', label: 'Hall', scale: 'building', parent: 'ward', x: 310, z: 60, r: 22, depth: 2 }],
    landscapes: [{ place: 'city', types: ['skyscrapers', 'park'], buildings: [[110, 60, 20, 20, 0, 30], [120, 40, 10, 10, 0.5, 8], [400, 80, 15, 15, 0, 2]], ids: ['city:L1', 'city:L2', 'city:p1:landmark'], manifolds: ['m_sky', 'm_sky', 'm_park'],
      patches: [{ id: 'p0', type: 'skyscrapers', era: 'modern', born: { scene: 's1' }, centre: [100, 50], radius: 150, manifold: 'm_sky', outline: [[250, 50], [100, 200], [-50, 50]] }, { id: 'p1', type: 'park', era: 'modern', born: { scene: 's9' }, centre: [400, 80], radius: 60, manifold: 'm_park' }],
      roads: [[0, 50, 200, 50, 12]], walls: [] }],
    world: { lots: [{ source: 'city:L2', detected: { name: 'the Tower', scene: 's3', event: 1 } }, { source: 'city:L1', detected: { name: 'Unreviewed Mall', scene: 's4' } }] },
  };
  await writeFile(join(folder, 'runs', 'line_a', 'r1.page.json'), JSON.stringify(page));
  await writeFile(join(folder, 'index.json'), JSON.stringify({ version: 2, strands: { line_a: { accepted: 'r1', runs: [{ id: 'r1', page: 'runs/line_a/r1.page.json', exportedAt: page.exportedAt }] } } }));
  return { novel, folder, page };
}

test('the places registry: places from the canvas, a manifold per patch with its own fill, nominated buildings on their lots', async (context) => {
  const { novel, folder } = await book(context);
  const index = await buildPlaces(novel);
  assert.deepEqual(index.places.map(place => [place.id, place.open]), [['city', true], ['ward', true], ['hall', false]]);
  assert.deepEqual(index.manifolds.map(manifold => [manifold.id, manifold.patch, manifold.types, manifold.buildings]), [['m_sky', 'p0', ['skyscrapers'], 2], ['m_park', 'p1', ['park'], 1]]);
  const sky = index.manifolds[0];
  assert.deepEqual(sky.centre, [0, 0], 'in the place\'s own metres');
  assert.deepEqual(sky.outline, [[150, 0], [0, 150], [-150, 0]]);
  const fill = JSON.parse(await readFile(join(folder, 'places', 'fills', `${sky.version}.json`), 'utf8'));
  assert.deepEqual(fill.buildings, [[10, 10, 20, 20, 0, 30], [20, -10, 10, 10, 0.5, 8]]);
  assert.equal(index.grounds[0].roads, 1);
  // Only a reviewed building of the ontology is nominated, by any of its names; the staged building stands where the canvas put it.
  assert.deepEqual(index.buildings.map(building => [building.kind, building.id, building.name, building.place, building.x, building.z]), [['named', 'loc_tower', 'Clock Tower', 'city', 20, -10], ['staged', 'hall', 'Hall', 'ward', 10, 10]]);
});

test('fills are named by content: a place pushed on the canvas or a run again keeps every version; a new patch adds one', async (context) => {
  const { novel, folder, page } = await book(context);
  const first = await buildPlaces(novel), files = (await readdir(join(folder, 'places', 'fills'))).sort();
  // The city pushed 30 m east, everything in it with it: the same fills.
  const moved = structuredClone(page);
  moved.exportedAt = '2026-10-29T11:00:00.000Z';
  moved.macro[0].x += 30;
  moved.landscapes[0].buildings = moved.landscapes[0].buildings.map(([x, z, ...rest]) => [x + 30, z, ...rest]);
  moved.landscapes[0].roads = moved.landscapes[0].roads.map(([ax, az, bx, bz, w]) => [ax + 30, az, bx + 30, bz, w]);
  moved.landscapes[0].patches = moved.landscapes[0].patches.map(patch => ({ ...patch, centre: [patch.centre[0] + 30, patch.centre[1]] }));
  await writeFile(join(folder, 'runs', 'line_a', 'r1.page.json'), JSON.stringify(moved));
  const second = await buildPlaces(novel);
  assert.deepEqual(second.manifolds.map(manifold => manifold.version), first.manifolds.map(manifold => manifold.version));
  assert.deepEqual((await readdir(join(folder, 'places', 'fills'))).sort(), files);
  assert.equal(second.places[0].x, 130);
  // A new patch: the older manifolds keep their versions, one more fill.
  const grown = structuredClone(moved);
  grown.landscapes[0].buildings.push([600, 60, 8, 8, 0, 1]); grown.landscapes[0].ids.push('city:L9'); grown.landscapes[0].manifolds.push('m_farm');
  grown.landscapes[0].patches.push({ id: 'p2', type: 'farm', era: 'old', born: { scene: 's20' }, centre: [600, 60], radius: 40, manifold: 'm_farm' });
  await writeFile(join(folder, 'runs', 'line_a', 'r1.page.json'), JSON.stringify(grown));
  const third = await buildPlaces(novel);
  assert.deepEqual(third.manifolds.slice(0, 2).map(manifold => manifold.version), first.manifolds.map(manifold => manifold.version));
  assert.equal(third.manifolds[2].types[0], 'farm');
  assert.equal((await readdir(join(folder, 'places', 'fills'))).length, files.length + 1);
});

test('a run whose data does not say which patch each building stands on keeps its landscape as one manifold; no world runs, no registry', async (context) => {
  const { novel, folder, page } = await book(context);
  const plain = structuredClone(page);
  delete plain.landscapes[0].manifolds; delete plain.landscapes[0].patches;
  await writeFile(join(folder, 'runs', 'line_a', 'r1.page.json'), JSON.stringify(plain));
  const index = await buildPlaces(novel);
  assert.deepEqual(index.manifolds.map(manifold => [manifold.id, manifold.types, manifold.buildings]), [['city:landscape', ['skyscrapers', 'park'], 3]]);
  await writeFile(join(folder, 'runs', 'line_a', 'r1.page.json'), JSON.stringify({ ...plain, landscapes: undefined }));
  assert.equal(await buildPlaces(novel), null);
});
