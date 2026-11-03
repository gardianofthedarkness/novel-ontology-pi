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

test('continuity is by strand: a person\'s moments chain only along the strands\' entries, never across strands', async () => {
  const { chainsOf } = await import('./smoother.mjs');
  const moments = [{ scene: 's1', card: null }, { scene: 's1', card: 'c1' }, { scene: 's2', card: null }, { scene: 's3', card: null }];
  const strands = { scenes: [{ id: 's1', fork: 'f', entries: [{ person: 'a', from: null }] }, { id: 's2', fork: 'g', entries: [{ person: 'a', from: null }] }, { id: 's3', fork: 'f', entries: [{ person: 'a', from: 's1', samePlace: true }] }] };
  const chains = chainsOf(moments, 'a', strands);
  assert.deepEqual(chains.map(chain => chain.map(moment => `${moment.scene}${moment.card ? `:${moment.card}` : ''}`)), [['s1', 's1:c1', 's3'], ['s2']], 's3 follows s1 in strand f; s2, first in strand g, is a chain of its own');
  assert.equal(chains[0][2].samePlace, true);
  // In the run: a talk in strand g pulls a there; their moments in strand f stay where they were played.
  const { page, record, log } = run({ apart: 30, kind: 'live' });
  page.scenes.push({ id: 's0', starts: { a: node(600) }, events: [] });
  record.scenes.unshift({ scene: 's0', cards: [] });
  log.push({ kind: 'presence', scene: 's0', who: 'a', rank: 'ruled' });
  const twoStrands = { scenes: [{ id: 's0', fork: 'f', entries: [{ person: 'a', from: null }] }, { id: 's1', fork: 'g', entries: [{ person: 'a', from: null }, { person: 'b', from: null }] }] };
  const apartStrands = smoothRun({ page, log, record, strands: twoStrands }), oneStrand = smoothRun({ page, log, record, strands: { scenes: [{ id: 's0', fork: 'f', entries: [{ person: 'a', from: null }] }, { id: 's1', fork: 'f', entries: [{ person: 'a', from: 's0' }, { person: 'b', from: null }] }] } });
  assert.deepEqual(apartStrands.chains.a, [['s0'], ['s1']]);
  assert.ok(apartStrands.people.a[0].shift < 0.5, 'its own strand: s0 untouched by s1');
  assert.deepEqual(oneStrand.chains.a, [['s0', 's1']]);
});

test('the frame is an observation (S_frame): someone the strand carries straight on, outside the next scene\'s frame, is pulled toward it by least change', () => {
  // s1: a walks 40 m off; s2 continues s1 in the same place, its frame 10 m wide round b at x = 0.
  const page = { world, scenes: [
    { id: 's1', starts: { a: node(0), b: node(0) }, events: [{ id: 'e1', moves: [{ person: 'a', path: walkTo(0, 40) }] }] },
    { id: 's2', starts: { a: node(40), b: node(0) }, events: [] }] };
  const record = { scenes: [{ scene: 's1', cards: [{ card: 'action:x', event: 0, kind: 'action' }] }, { scene: 's2', cards: [], frame: { referent: 'the room', metres: 10, middle: { x: 0, y: 0, z: 1 } } }] };
  const log = [{ kind: 'presence', scene: 's1', who: 'a', rank: 'stated' }, { kind: 'presence', scene: 's1', who: 'b', rank: 'stated' }];
  const strands = { scenes: [{ id: 's1', fork: 'f', entries: [{ person: 'a', from: null }, { person: 'b', from: null }] }, { id: 's2', fork: 'f', continues: 's1', entries: [{ person: 'a', from: 's1', samePlace: true }, { person: 'b', from: 's1', samePlace: true }] }] };
  const framed = smoothRun({ page, log, record, strands });
  const start = framed.people.a.find(moment => moment.scene === 's2' && moment.card === null);
  assert.equal(start.frame.played, 36, 'played 36 m outside the frame (at the node\'s middle)');
  assert.ok(start.frame.map < start.frame.played, `pulled toward it: ${start.frame.map} m outside`);
  assert.ok(framed.people.a.find(moment => moment.card === 'action:x').shift > 0, 'and the walk before it bends too: back-propagated along the strand');
  const unframed = smoothRun({ page, log, record: { scenes: record.scenes.map(({ frame, ...rest }) => rest) }, strands });
  assert.ok(unframed.people.a.find(moment => moment.scene === 's2').shift < 0.5, 'without the frame, nothing moves');
});
