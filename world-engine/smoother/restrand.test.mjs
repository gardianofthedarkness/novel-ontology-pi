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
const unit = (n, place, present) => ({ id: `u${n}`, chapter: 1, place, placeBy: 'stated', clock: [n, n], present, at: { node: `t${n}`, stated: false } });
const stand = (scene, x, z) => ({ scene, card: null, map: { node: 0, x, z, y: 0 } });
const LANE = [[20, 20], [22, 20], [24, 20]], HOUSE = [320, 20];

/**
 * Nine units. The text: a, b and c in the lane, c alone in the house (u4), all three again (u5), a and b in the house
 * (u6), a alone (u7, u9), and d, someone new, in the house (u8). The run: c stood in the east through u2 already; a and
 * b never went to the house in u6; in u7 b stood by a and c across the district; in u9 d stood by a.
 */
function world() {
  const script = { version: 1, places, scenes: [unit(1, 'lane', ['a', 'b', 'c']), unit(2, 'lane', ['a', 'b', 'c']), unit(3, 'lane', ['a', 'b']), unit(4, 'house', ['c']), unit(5, 'lane', ['a', 'b', 'c']), unit(6, 'house', ['a', 'b']), unit(7, 'lane', ['a']), unit(8, 'house', ['d']), unit(9, 'lane', ['a'])] };
  const people = { a: [], b: [], c: [], d: [] }, put = (who, scene, [x, z]) => people[who].push(stand(scene, x, z));
  for (const n of [1, 2, 3, 5, 6, 7, 9]) put('a', `u${n}`, LANE[0]);
  for (const n of [1, 2, 3, 5, 6]) put('b', `u${n}`, LANE[1]);
  put('b', 'u7', [30, 20]);
  put('c', 'u1', LANE[2]); put('c', 'u2', HOUSE); put('c', 'u2', [322, 20]); put('c', 'u4', HOUSE); put('c', 'u5', LANE[2]); put('c', 'u7', [95, 95]);
  put('d', 'u8', HOUSE); put('d', 'u9', [25, 20]);
  return { script, smoothed: { run: 'r1', people: { ...people, thing_1: [stand('u1', 20, 20)] } }, sites };
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

test('runUnits: groups by where the people stood', () => {
  const { script, smoothed } = world(), { units, script: played } = runUnits({ script, smoothed, sites });
  const at = id => units.find(entry => entry.id === id);
  assert.deepEqual(units.filter(entry => entry.id !== entry.of).map(entry => entry.id), ['u2~2']);
  assert.deepEqual([at('u2').people, at('u2').envelope, at('u2~2').people, at('u2~2').envelope], [['a', 'b'], 'west', ['c'], 'east']);
  assert.equal(unitOf('u2~2'), 'u2');
  assert.deepEqual([at('u6').envelope, at('u6').written], ['west', 'east'], 'played where they stood, not where the text says');
  assert.deepEqual([at('u7').people, at('u7').with, at('u7').leftOut], [['a'], ['b'], 1], 'within earshot: with the group; across the district: left out');
  assert.deepEqual(at('u9').with, ['d']);
  assert.deepEqual(played.scenes.find(scene => scene.id === 'u7').present, ['a', 'b']);
  assert.equal(played.scenes.length, 10);
  assert.ok(!units.some(entry => entry.people.includes('thing_1') || entry.with.includes('thing_1')), 'only people the script names anywhere');
});

test('runUnits: someone who walks in is with the group; a unit nobody was placed in keeps the text\'s envelope', () => {
  const { script, smoothed } = world();
  smoothed.people.c = smoothed.people.c.map(moment => (moment.scene === 'u2' && moment.map.x === 322 ? stand('u2', 24, 20) : moment));
  smoothed.people.d = smoothed.people.d.filter(moment => moment.scene !== 'u8');
  const { units } = runUnits({ script, smoothed, sites });
  assert.ok(units.every(entry => entry.id === entry.of), 'no group apart');
  assert.deepEqual(units.find(entry => entry.id === 'u2').people, ['a', 'b', 'c']);
  const empty = units.find(entry => entry.id === 'u8');
  assert.deepEqual([empty.envelope, empty.placed, empty.people], ['east', 0, ['d']]);
});

test('restrand: a hidden split, two unions the text did not say, a unit played elsewhere', () => {
  const { text, strands, report, document } = restrand({ ...world(), run: 'r1' });
  assert.deepEqual(text.forks.map(fork => fork.id), ['u1', 'u8'], 'the text: one strand that moves, and the newcomer\'s');
  assert.deepEqual(strands.forks.map(fork => fork.id).sort(), ['u1', 'u2~2', 'u8']);
  assert.deepEqual(report.strands, { text: 2, run: 3, gone: [], begun: ['u2~2'] });
  assert.deepEqual(report.splits, [{ scene: 'u2', envelope: 'west', written: 'west', apart: [{ envelope: 'east', people: ['c'], strand: 'u2~2', own: true }] }]);
  assert.deepEqual(report.unions, [{ scene: 'u5', kept: 'u1', closed: 'u2~2', said: false, by: [] }, { scene: 'u9', kept: 'u1', closed: 'u8', said: false, by: ['d'] }]);
  assert.deepEqual(report.moved, [{ from: 'u6', to: 'u6', units: 1, text: 'east', run: 'west' }]);
  assert.deepEqual(report.changed, [{ from: 'u4', to: 'u4', units: 1, text: 'u1', run: 'u2~2' }], 'c alone in the house: on the strand the run began in u2');
  assert.deepEqual(report.units, { all: 9, placed: 9, people: 17, unplaced: 0, with: 2, leftOut: 1, noSite: 0 });
  assert.deepEqual(report.forks.find(fork => fork.id === 'u2~2'), { id: 'u2~2', units: 2, people: 1, envelope: 'east', open: false, splitFrom: ['u1'], into: 'u1', intoAt: 'u5' });
  // The run's strands file: the text's shape, with the run, its units and what it says against the text.
  assert.deepEqual([document.version, document.from, document.run, document.envelope, document.earshot], [2, 'run:r1', 'r1', 'district', 25]);
  assert.equal(document.scenes.length, 10);
  assert.equal(document.scenes.find(entry => entry.id === 'u2~2').fork, 'u2~2');
  assert.equal(document.units.length, 10);
  assert.deepEqual(document.against, report);
  assert.deepEqual(summary(report), { envelope: 'district', strands: { text: 2, run: 3, gone: 0, begun: 1 }, splits: { units: 1, own: 1 }, unions: { all: 2, unsaid: 2 }, moved: { units: 1, stretches: 1 }, changed: { units: 1, stretches: 1 }, people: { placed: 17, unplaced: 0, with: 2, leftOut: 1, noSite: 0 } });
  const lines = describe(report);
  assert.match(lines[0], /the text 2, the run 3; only in the run: u2~2/);
  assert.ok(lines.some(line => /u9: u8 into u1, with d/.test(line)));
});

test('restrand: a run that played the text as written says nothing against it', () => {
  const { script, smoothed } = world();
  smoothed.people.c = smoothed.people.c.filter(moment => moment.scene !== 'u7').map(moment => (moment.scene === 'u2' ? stand('u2', 24, 20) : moment));
  smoothed.people.a = smoothed.people.a.map(moment => (moment.scene === 'u6' ? stand('u6', 318, 20) : moment));
  smoothed.people.b = smoothed.people.b.filter(moment => moment.scene !== 'u7').map(moment => (moment.scene === 'u6' ? stand('u6', 320, 22) : moment));
  smoothed.people.d = smoothed.people.d.filter(moment => moment.scene !== 'u9');
  const { report } = restrand({ script, smoothed, sites });
  assert.deepEqual(report.strands, { text: 2, run: 2, gone: [], begun: [] });
  assert.deepEqual([report.splits, report.unions, report.moved, report.changed], [[], [], [], []]);
});

test('restrand: a finer envelope scale reads finer groups', () => {
  const { script, smoothed } = world();
  // b in the arcade through u3, a in the lane: one district apart by the built tree only at the street scale.
  smoothed.people.b = smoothed.people.b.map(moment => (moment.scene === 'u3' ? stand('u3', 70, 70) : moment));
  assert.equal(restrand({ script, smoothed, sites, envelope: 'district' }).units.filter(entry => entry.of === 'u3').length, 2, 'the arcade is the north\'s: another district');
  smoothed.people.b = smoothed.people.b.map(moment => (moment.scene === 'u3' ? stand('u3', 45, 45) : moment));
  assert.equal(restrand({ script, smoothed, sites, envelope: 'district' }).units.filter(entry => entry.of === 'u3').length, 1, 'off the lane, in the west');
  assert.equal(restrand({ script, smoothed, sites, envelope: 'street' }).units.filter(entry => entry.of === 'u3').length, 1, 'the west is no street: not known to be apart from the lane');
});

test('restrandRun: a book\'s run from its files, written beside the smoothed positions', async () => {
  const library = await mkdtemp(join(tmpdir(), 'restrand-')), dir = join(library, 'vol-1', 'novel'), { script, smoothed } = world();
  await mkdir(join(dir, 'stage', 'world', 'smoothed'), { recursive: true });
  await writeFile(join(dir, 'stage', 'world', 'script.json'), JSON.stringify(script));
  await writeFile(join(dir, 'stage', 'world', 'smoothed', 'r0.json'), JSON.stringify({ ...smoothed, run: 'r0', people: {} }));
  await writeFile(join(dir, 'stage', 'world', 'smoothed', 'r1.json'), JSON.stringify(smoothed));
  await writeFile(join(dir, 'stage', 'terrain.json'), JSON.stringify({ book: 'vol-1', sites, slots: [] }));
  const dry = await restrandRun(dir);
  assert.deepEqual([dry.run, dry.file, dry.report.strands.run], ['r1', null, 3], 'the last smoothed run, nothing written');
  assert.ok(!existsSync(join(dir, 'stage', 'world', 'restrand')));
  const kept = await restrandRun(dir, { run: 'r1', write: true });
  assert.equal(kept.file, join(dir, 'stage', 'world', 'restrand', 'r1.json'));
  const file = JSON.parse(await readFile(kept.file, 'utf8'));
  assert.deepEqual([file.version, file.run, file.against.strands.run, file.forks.length], [2, 'r1', 3, 3]);
  // The director hands in what it has at a run's end; a segment script beside the world's is the one played.
  await mkdir(join(dir, 'stage', 'world', 'segments'), { recursive: true });
  await writeFile(join(dir, 'stage', 'world', 'segments', 'script.json'), JSON.stringify({ ...script, scenes: script.scenes.slice(0, 5) }));
  assert.equal((await restrandRun(dir, { run: 'r1' })).units.length, 6);
  assert.equal((await restrandRun(dir, { script, smoothed: { ...smoothed, run: 'r2' }, envelope: 'city' })).report.strands.run, 1);
  await assert.rejects(restrandRun(dir, { run: 'none' }), /no smoothed positions/);
});

test('restrand: a run of a part of the script is read over that part alone', () => {
  const { script, smoothed } = world(), only = ['u1', 'u2', 'u3', 'u4'];
  smoothed.people = Object.fromEntries(Object.entries(smoothed.people).map(([who, list]) => [who, list.filter(moment => only.includes(moment.scene))]));
  const { text, report, document } = restrand({ script, smoothed, sites, only });
  assert.deepEqual(text.forks.map(fork => fork.id), ['u1'], 'the newcomer of u8 is not in the part');
  assert.deepEqual(report.strands, { text: 1, run: 2, gone: [], begun: ['u2~2'] });
  assert.deepEqual([report.units.all, report.units.unplaced, document.scenes.length], [4, 0, 5]);
  assert.equal(report.forks.find(fork => fork.id === 'u2~2').open, true, 'no union in the part: open at its end');
  assert.deepEqual(report.unions, []);
});
