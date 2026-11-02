import test from 'node:test';
import assert from 'node:assert/strict';
import { metres, smoothRun } from './smoother.mjs';
import { occupation } from './occupation.mjs';

// A flat world 600 cells across (2 m each): a node is i + j * NX on the ground floor.
const world = { NX: 600, NZ: 10, K: 1, oi: 0, oj: 0, ok: 0 };
const node = (x, z = 1) => Math.floor(x / 2) + Math.floor(z / 2) * world.NX;
const walkTo = (from, to) => Array.from({ length: Math.abs(to - from) / 2 + 1 }, (_, n) => node(from + Math.sign(to - from) * n * 2));

/** A scene where a and b start apart, b walks a little, and a speaks to b (`kind` as Jev gave it, or none). */
function run({ apart, kind, rankA = 'ruled' }) {
  const page = { world, scenes: [{ id: 's1', starts: { a: node(0), b: node(apart) }, events: [{ id: 'e1', moves: [{ person: 'b', path: walkTo(apart, apart + 4), ensemble: [walkTo(apart, apart - 6)] }] }, { id: 'e2', moves: [] }] }] };
  const record = { scenes: [{ scene: 's1', cards: [{ card: 'action:x', event: 0, kind: 'action' }, { card: 'dialogue:y', event: 1, kind: 'dialogue', ...(kind ? { talk: { kind } } : {}), lines: [{ id: 'l1', who: 'a', to: 'b' }] }] }] };
  const log = [{ kind: 'presence', scene: 's1', who: 'a', rank: rankA }, { kind: 'presence', scene: 's1', who: 'b', rank: 'ruled' }];
  return { page, record, log };
}
const gapAt = (result, card) => { const a = result.people.a.find(moment => moment.card === card), b = result.people.b.find(moment => moment.card === card); return metres(a.map, b.map); };

test('a talk Jev called face to face brings speaker and listener within reach; each moment keeps a cloud', () => {
  const result = smoothRun(run({ apart: 30, kind: 'live' }));
  assert.ok(gapAt(result, "dialogue:y") <= 7, `within reach, give or take a spot (the pull is soft against the walk): ${gapAt(result, "dialogue:y")} m`);
  const moment = result.people.a.find(entry => entry.card === 'dialogue:y');
  assert.ok(moment.cloud.length > 1 && Math.abs(moment.cloud.reduce((sum, spot) => sum + spot.w, 0) - 1) < 0.05 || moment.cloud.length === 8, 'a weighted cloud');
  assert.ok(result.revisions.some(revision => revision.card === 'dialogue:y'), 'and the move is a revision');
});

test('a talk of no kind given, a kilometre apart: a voice from afar, nobody teleported; a stated place holds', () => {
  const far = smoothRun(run({ apart: 1000 }));
  assert.ok(gapAt(far, 'dialogue:y') > 900, 'left apart');
  assert.equal(far.revisions.filter(revision => revision.shift > 50).length, 0);
  const stated = smoothRun(run({ apart: 30, kind: 'live', rankA: 'stated' }));
  assert.ok(stated.people.a[0].shift <= stated.people.b.at(-1).shift + 0.1, 'the stated one moves least; the other comes to them');
});

test('who is on the stage: the script\'s presence can miss; acting is strong evidence; the review\'s answer near certain', () => {
  const reading = { scenes: [{ id: 's1', sentences: ['x1'] }, { id: 's2', sentences: ['x2'] }, { id: 's3', sentences: ['x3'] }], cards: [
    { first: 'x1', people: [{ id: 'a', how: ['acts', 'speaks'] }] }, { first: 'x2', people: [{ id: 'a', how: ['acts', 'speaks'] }, { id: 'c', how: ['named'] }] }, { first: 'x3', people: [{ id: 'a', how: ['speaks'] }] }] };
  const script = { scenes: [{ id: 's1', present: ['a'] }, { id: 's2', present: [] }, { id: 's3', present: ['a'] }] };
  const strands = { scenes: ['s1', 's2', 's3'].map(id => ({ id, fork: 'f' })) };
  const { on, proposals } = occupation({ reading, script, strands });
  assert.ok(on.a.s2 > 0.9, `left out of s2's script, but acting there between two scenes they are in: ${on.a.s2}`);
  assert.deepEqual(proposals.map(entry => [entry.scene, entry.who, entry.propose]), [['s2', 'a', 'present']]);
  assert.ok(on.c.s2 < 0.5, 'only named: likely not there');
  assert.ok(occupation({ reading, script, strands, pins: { remote: { 's2|a': true } } }).on.a.s2 < 0.05, 'the review said remote');
});
