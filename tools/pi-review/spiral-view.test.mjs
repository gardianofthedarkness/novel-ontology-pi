import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSpiral } from './spiral-view.mjs';

test('the stored spiral reaches the view with its scene ids renamed; unknown books and missing files give nothing', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spiral-view-'));
  assert.equal(await readSpiral(root, 'demo', () => null), null);
  await mkdir(join(root, 'calendar'));
  const run = (id, scenes) => ({ id, knots: scenes.map((scene, k) => ({ id: scene, x: k * 9, q: [k, -k] })), track: [[0, 0, 0], [9, 1, -1]], axis: [[0, 0, 0], [9, 0, 0]] });
  await writeFile(join(root, 'calendar', 'old.spiral.json'), JSON.stringify({ version: 1, builtAt: 't', scale: { dx: 9, radial: 120, knot: 5.5 }, continuities: [] }));
  assert.equal(await readSpiral(root, 'old', () => 'x'), null, 'an older layout waits for the next build');
  await writeFile(join(root, 'calendar', 'demo.spiral.json'), JSON.stringify({ version: 4, builtAt: 't', scale: { dx: 9, knot: 14 }, continuities: [{ id: 'main', frame: { width: 900, height: 300 }, books: [], runs: [run('src_a::s1', ['src_a::s1', 'src_a::s2']), run('src_z::s1', ['src_z::s1'])], links: [{ from: 'src_a::s1', to: 'src_z::s1' }], days: [{ key: '1-12-24', label: '12月24日', from: 0, to: 9 }], metrics: {} }] }));
  const view = await readSpiral(root, 'demo', (sourceId, sceneId) => sourceId === 'src_a' ? `1:${sceneId}` : null);
  assert.deepEqual(view.runs.map((entry) => entry.knots.map((knot) => knot.id)), [['1:s1', '1:s2']], 'the book the view does not show is left out');
  assert.equal(view.links.length, 0, 'a link to a book not shown is dropped');
  assert.equal(view.days[0].label, '12月24日');
  assert.deepEqual(view.scale, { dx: 9, knot: 14, width: 900, height: 300 }, 'the floor box comes with the scale');
});

test('group trips reach the view with renamed scenes; a trip into a book not shown is dropped, and files without trips give none', async () => {
  const root = await mkdtemp(join(tmpdir(), 'spiral-trips-'));
  await mkdir(join(root, 'calendar'));
  const run = (id, scenes) => ({ id, knots: scenes.map((scene, k) => ({ id: scene, x: k * 9, q: [0, 0] })), track: [[0, 0, 0]], axis: [[0, 0, 0]] });
  const trip = (from, to) => ({ from, to, runs: ['src_a::s1', 'src_a::s1'], people: ['src_a::c1', 'src_a::c2'], names: ['甲', '乙'], places: ['钟塔', '车站'], guessed: true, nested: false, backed: false });
  const continuity = { id: 'main', frame: { width: 1, height: 1 }, books: [], runs: [run('src_a::s1', ['src_a::s1', 'src_a::s2'])], links: [], days: [] };
  await writeFile(join(root, 'calendar', 'old.spiral.json'), JSON.stringify({ version: 4, builtAt: 't', scale: { dx: 9, knot: 14 }, continuities: [continuity] }));
  assert.deepEqual((await readSpiral(root, 'old', (_, scene) => scene)).trips, [], 'a spiral built before trips has none');
  await writeFile(join(root, 'calendar', 'demo.spiral.json'), JSON.stringify({ version: 4, builtAt: 't', scale: { dx: 9, knot: 14 }, continuities: [{ ...continuity, trips: [trip('src_a::s1', 'src_a::s2'), trip('src_a::s2', 'src_b::s9')] }] }));
  const view = await readSpiral(root, 'demo', (sourceId, sceneId) => sourceId === 'src_a' ? `1:${sceneId}` : null);
  assert.deepEqual(view.trips, [{ from: '1:s1', to: '1:s2', lane: 0, runs: ['src_a::s1', 'src_a::s1'], names: ['甲', '乙'], places: ['钟塔', '车站'], guessed: true, nested: false, backed: false }]);
});
