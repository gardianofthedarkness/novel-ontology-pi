// Re-stranding a run (restrand.mjs; milestones M17d) on a small built city.
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, restrand, restrandRun, runPlaces, runUnits, siteAt, summary, unitOf } from './restrand.mjs';

// Two districts well apart (west, east) and a third (north) whose box overlaps the west's, as the registry's do; a
// street in the west and in the north, a house in the east. The text knows the city, the west and east, the lane and
// the house; the arcade and the north are only built.
const sites = {
  city: { scale: 'city', parent: null },
  west: { scale: 'district', parent: 'city', box: [0, 0, 100, 100] },
  north: { scale: 'district', parent: 'city', box: [50, 0, 150, 100] },
  east: { scale: 'district', parent: 'city', box: [300, 0, 400, 100] },
  lane: { scale: 'street', parent: 'west', box: [10, 10, 40, 40] },
  arcade: { scale: 'street', parent: 'north', box: [60, 60, 90, 90] },
  house: { scale: 'building', parent: 'east', box: [310, 10, 330, 30] },
};
const places = { city: { scale: 'city', parent: null }, west: { scale: 'district', parent: 'city' }, east: { scale: 'district', parent: 'city' }, lane: { scale: 'street', parent: 'west' }, house: { scale: 'building', parent: 'east' } };
/** A unit: who acts in it, who else is in view. */
const unit = (n, place, acting, more = []) => ({ id: `u${n}`, chapter: 1, place, placeBy: 'stated', clock: [n, n], evidence: acting, present: [...acting, ...more], stayed: [], firstSeen: [], timeline: [], at: { node: `t${n}`, stated: false } });
const stand = (scene, x, z) => ({ scene, card: null, map: { node: 0, x, z, y: 0 } });
const LANE = [[20, 20], [22, 20], [24, 20]], HOUSE = [320, 20];

/**
 * Nine units. The text: a, b and c act together in the lane (u1, u2, u5), a and b (u3), c alone in the house (u4), a and
 * b in the house (u6), a alone (u7, u9), and d, someone new, in the house (u8). The run: in u2 c stood in the house,
 * 300 m off, with no conversation with a or b there; in u3 b stood in the house although the text has a and b talking;
 * a and b never went to the house in u6; in u7 b stood by a; in u9 d stood by a.
 */
function world() {
  const script = { version: 1, places, scenes: [unit(1, 'lane', ['a', 'b', 'c']), unit(2, 'lane', ['a', 'b', 'c']), unit(3, 'lane', ['a', 'b']), unit(4, 'house', ['c']), unit(5, 'lane', ['a', 'b', 'c']), unit(6, 'house', ['a', 'b']), unit(7, 'lane', ['a']), unit(8, 'house', ['d']), unit(9, 'lane', ['a'])] };
  const people = { a: [], b: [], c: [], d: [] }, put = (who, scene, [x, z]) => people[who].push(stand(scene, x, z));
  for (const n of [1, 2, 3, 5, 6, 7, 9]) put('a', `u${n}`, LANE[0]);
  for (const n of [1, 2, 5, 6]) put('b', `u${n}`, LANE[1]);
  put('b', 'u3', HOUSE); put('b', 'u7', [30, 20]);
  put('c', 'u1', LANE[2]); put('c', 'u2', [322, 20]); put('c', 'u4', HOUSE); put('c', 'u5', LANE[2]);
  put('d', 'u8', HOUSE); put('d', 'u9', [25, 20]);
  const beats = { u1: { links: [['a', 'b', 'c']], beats: [['a', 'b', 'c']] }, u2: { links: [['a', 'b']], beats: [['a', 'b'], ['c']] }, u3: { links: [['a', 'b']], beats: [['a', 'b']] }, u4: { links: [], beats: [['c']] }, u5: { links: [['a', 'b', 'c']], beats: [['a', 'b', 'c']] }, u6: { links: [['a', 'b']], beats: [['a', 'b']] }, u7: { links: [], beats: [['a']] }, u8: { links: [], beats: [['d']] }, u9: { links: [], beats: [['a']] } };
  return { script, smoothed: { run: 'r1', people }, sites, beats };
}

test('siteAt: the smallest site that holds a spot, the nearest centre among equals', () => {
  const at = siteAt(sites);
  assert.equal(at({ x: 20, z: 20 }), 'lane');
  assert.equal(at({ x: 70, z: 70 }), 'arcade', 'a street before the districts over it');
  assert.equal(at({ x: 55, z: 20 }), 'west', 'two districts hold it: deeper inside the west');
  assert.equal(at({ x: 95, z: 20 }), 'north');
  assert.equal(at({ x: 200, z: 50 }), null);
  assert.equal(at(null), null);
});

test('runPlaces: the built sites over the text\'s places', () => {
  const tree = runPlaces({ places: { ...places, pool: { scale: 'district', parent: 'city', pool: true }, lane: { scale: 'street', parent: 'east' } } }, sites, { house: { parent: 'east', scale: 'building' } });
  assert.deepEqual(tree.lane, { scale: 'street', parent: 'west' }, 'where the engine built it');
  assert.equal(tree.pool.scale, null, 'a sampling pool is no envelope');
  assert.deepEqual(tree.arcade, { scale: 'street', parent: 'north' });
});

test('runUnits: groups by earshot and by the text\'s interactions, at any scale', () => {
  const { script, smoothed, beats } = world(), { units, script: played } = runUnits({ script, smoothed, sites, beats, earshot: 25 });
  const at = id => units.find(entry => entry.id === id);
  assert.deepEqual([at('u2').people, at('u2~2').people, at('u2~2').of], [['a', 'b'], ['c'], 'u2'], 'c stood 300 m off with no conversation: apart');
  assert.deepEqual([units.some(entry => entry.id === 'u3~2'), at('u3').apartTalk], [false, [{ people: ['a', 'b'], metres: 300 }]], 'a and b talk in the text: one group, and the distance a fault');
  assert.deepEqual([at('u6').moved, at('u6').district, at('u6').sites], [true, 'east', ['west']], 'played in the west, the text says the house in the east');
  assert.deepEqual([at('u7').with, at('u9').with], [['b'], ['d']], 'on the stage within earshot, not named there');
  assert.deepEqual(played.scenes.find(entry => entry.id === 'u2~2').evidence, ['c']);
  const plain = runUnits({ script, smoothed, sites, earshot: 25 }).units;
  assert.ok(plain.some(entry => entry.id === 'u3~2'), 'without the reading only distance groups: b stood apart in u3');
});

test('restrand: the run\'s strands against the text\'s', () => {
  const { script, smoothed, beats } = world(), { report, document } = restrand({ script, smoothed, sites, beats, earshot: 25, run: 'r1' });
  assert.deepEqual([report.strands.text, report.strands.run, report.strands.begun], [1, 2, ['u2']], 'a and b left c in u2 and talk again in u3: a strand');
  assert.deepEqual(report.splits.map(split => [split.scene, split.apart.map(group => [group.people, group.own])]), [['u2', [[['c'], true]]]]);
  assert.deepEqual(report.unions.map(union => [union.scene, union.closed, union.kept, union.said]), [['u5', 'u2', 'u1', false]], 'the strand begun first keeps its id');
  assert.deepEqual(report.changed.map(row => [row.from, row.to, row.text, row.run]), [['u2', 'u3', 'u1', 'u2']]);
  assert.deepEqual(report.moved.map(row => [row.from, row.text, row.run]), [['u6', 'east', 'west']]);
  assert.deepEqual(summary(report), { strands: { text: 1, run: 2, gone: 0, begun: 1 }, splits: { units: 1, own: 1 }, unions: { all: 1, unsaid: 1 }, apartTalk: { units: 1, pairs: 1 }, moved: { units: 1, stretches: 1 }, changed: { units: 2, stretches: 1 }, people: { placed: 17, unplaced: 0, with: 2 } });
  assert.deepEqual([document.version, document.from, document.run, document.envelope, document.earshot], [2, 'run:r1', 'r1', 'context', 25]);
  assert.match(describe(report)[0], /the text 1, the run 2/);
});

test('restrand: only the units the run played', () => {
  const { script, smoothed, beats } = world(), { report } = restrand({ script, smoothed, sites, beats, only: ['u1', 'u2', 'u3'] });
  assert.equal(report.units.all, 3);
  assert.deepEqual([report.strands.text, report.strands.run], [1, 2], 'a and b apart from c from u2, talking again in u3');
});

test('restrandRun: a book\'s files in, the run\'s strands file out', async () => {
  const { script, smoothed } = world(), root = await mkdtemp(join(tmpdir(), 'restrand-')), novel = join(root, 'vol-1', 'novel');
  await mkdir(join(novel, 'stage', 'world', 'smoothed'), { recursive: true }); await mkdir(join(novel, 'stage', 'world', 'segments'), { recursive: true });
  await writeFile(join(novel, 'stage', 'world', 'segments', 'script.json'), JSON.stringify(script));
  await writeFile(join(novel, 'stage', 'world', 'smoothed', 'r1.json'), JSON.stringify(smoothed));
  await writeFile(join(novel, 'stage', 'terrain.json'), JSON.stringify({ book: 'vol-1', sites, slots: {} }));
  const result = await restrandRun(novel, { write: true, earshot: 25 });
  assert.equal(result.run, 'r1');
  assert.ok(existsSync(join(novel, 'stage', 'world', 'restrand', 'r1.json')));
  const written = JSON.parse(await readFile(result.file, 'utf8'));
  assert.equal(written.from, 'run:r1');
  assert.equal(unitOf('u2~2'), 'u2');
});
