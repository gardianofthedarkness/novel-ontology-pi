import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEMO, READ, SAY, besideWay, inStep, readSeconds, sideOf, spreadWay, stateOfDoing, stateOfFormation, stateOfMove, statesOf, stretchesOf } from './on-the-move.mjs';

// A straight street of 2 m cells along x: node n is cell (n, 0, 0).
const metres = (a, b) => Math.abs(a - b) * 2;

test('a card lasts as long as its spoken lines take to read, at least READ', () => {
  assert.equal(readSeconds([]), READ);
  assert.equal(readSeconds([{ kind: 'narration', text: 'x'.repeat(80) }]), READ);
  assert.equal(readSeconds([{ kind: 'spoken', text: 'x'.repeat(30) }]), 30 * SAY + 0.6);
  assert.equal(readSeconds([{ kind: 'spoken', text: '   ' }]), READ);
});

test('the reading entries as motion', () => {
  assert.equal(stateOfMove({ motion: 'elsewhere', how: 'walk' }), 'walk');
  assert.equal(stateOfMove({ motion: 'nearby', how: 'carried' }), 'carried');
  assert.equal(stateOfMove({ motion: 'elsewhere', how: 'vehicle' }), 'ride');
  assert.equal(stateOfMove({ motion: 'elsewhere', how: 'leap' }), 'other');
  assert.equal(stateOfMove({ motion: 'step', how: 'walk' }), null);
  assert.equal(stateOfDoing('strolling'), 'walk');
  assert.equal(stateOfDoing('sitting'), 'stop');
  assert.equal(stateOfDoing('none'), null);
  assert.equal(stateOfFormation('side by side walking'), 'walk');
  assert.equal(stateOfFormation('facing'), 'stop');
  assert.equal(stateOfFormation('beside'), null);
});

test('a stroll: two going together, talking all the way, make one stretch; a stop ends it', () => {
  const cards = [{ last: 1 }, { last: 3 }, { last: 5 }, { last: 7 }];
  const states = statesOf({ cards, initial: new Map([['a', 'walk'], ['b', 'walk'], ['c', 'stop']]), signals: [
    { at: 0, who: 'a', state: 'walk', with: ['b'] }, { at: 0, who: 'b', state: 'walk', with: ['a'] },
    { at: 6, who: 'a', state: 'stop' },
  ] });
  assert.deepEqual(states.map(entry => entry.states.get('a')), ['walk', 'walk', 'walk', 'stop']);
  assert.deepEqual(states[0].ties, [['a', 'b'], ['b', 'a']]);
  const talkers = [new Set(['a']), new Set(['b']), new Set(['a', 'b']), new Set(['a'])];
  const stretches = stretchesOf({ states, talkers });
  // a and b together through cards 0-2; b goes on alone on card 3 (one card: too short to spread).
  assert.deepEqual(stretches, [{ members: ['a', 'b'], cards: [0, 1, 2] }]);
});

test('no talk on the move, no stretch; a group of one is one', () => {
  const cards = [{ last: 0 }, { last: 1 }, { last: 2 }];
  const states = statesOf({ cards, signals: [{ at: 0, who: 'a', state: 'run' }] });
  assert.deepEqual(stretchesOf({ states, talkers: [new Set(), new Set(), new Set()] }), []);
  assert.deepEqual(stretchesOf({ states, talkers: [new Set(), new Set(['a']), new Set()] }), [{ members: ['a'], cards: [0, 1, 2] }]);
});

test('one carried by a runner keeps with them; one who joins later starts a new group', () => {
  const cards = [{ last: 0 }, { last: 1 }, { last: 2 }, { last: 3 }];
  const states = statesOf({ cards, signals: [
    { at: 0, who: 'k', state: 'run', with: ['l'] }, { at: 0, who: 'l', state: 'carried', with: ['k'] },
    { at: 2, who: 'm', state: 'run', with: ['k'] },
  ] });
  const talkers = cards.map(() => new Set(['k']));
  assert.deepEqual(stretchesOf({ states, talkers }), [{ members: ['k', 'l'], cards: [0, 1] }, { members: ['k', 'l', 'm'], cards: [2, 3] }]);
});

test('a card where one of the group talks face to face with someone outside it ends the stretch; a phone call does not', () => {
  const cards = [{ last: 0 }, { last: 1 }, { last: 2 }, { last: 3 }, { last: 4 }];
  const states = statesOf({ cards, signals: [{ at: 0, who: 'a', state: 'walk', with: ['b'] }, { at: 0, who: 'b', state: 'walk', with: ['a'] }] });
  const talkers = [new Set(['a', 'b']), new Set(['a', 'b']), new Set(['a', 'x']), new Set(['b']), new Set(['a', 'b'])];
  assert.deepEqual(stretchesOf({ states, talkers }), [{ members: ['a', 'b'], cards: [0, 1] }, { members: ['a', 'b'], cards: [3, 4] }]);
  assert.deepEqual(stretchesOf({ states, talkers, remote: [false, false, true, false, false] }), [{ members: ['a', 'b'], cards: [0, 1, 2, 3, 4] }]);
});

test('a way spread by the weights', () => {
  const route = Array.from({ length: 11 }, (_, n) => n);
  assert.deepEqual(spreadWay(route, [1, 1], metres), [[0, 5], [5, 10]]);
  assert.deepEqual(spreadWay(route, [3, 1], metres), [[0, 7], [7, 10]]);
});

test('in step: the leader paced to last its cards, the others in its time, ends kept', () => {
  const lead = Array.from({ length: 11 }, (_, n) => n), weights = [10, 10];
  const ways = [['a', { nodes: lead }], ['b', { nodes: lead.map(n => n + 100), lead: [99], tail: [111] }]];
  const out = inStep({ ways, weights, natural: 1.4, slowest: 0.3, metres });
  // 10 m a card over 10 s of reading: 10 / (10 * DEMO) = 0.33 m/s.
  assert.equal(out[0][0].pace, Math.round((10 / (10 * DEMO)) * 100) / 100);
  assert.deepEqual(out[0][0].path, [0, 1, 2, 3, 4, 5]);
  assert.deepEqual(out[0][1].path, [99, 100, 101, 102, 103, 104, 105]);
  assert.deepEqual(out[1][1].path.at(-1), 111);
  // b covers its 12 m in the leader's time for its 10 m.
  const time = move => move.path.slice(1).reduce((sum, node, n) => sum + metres(move.path[n], node), 0) / move.pace / DEMO;
  assert.ok(Math.abs(time(out[0][0]) - time(out[0][1])) < 0.2);
});

test('node for node: a member on a longer way reaches each node when the leader reaches its own', () => {
  const lead = Array.from({ length: 11 }, (_, n) => n), weights = [10, 10];
  // b's way zig-zags: every other node a cell further off, so it is longer than the leader's.
  const zig = lead.map(n => (n % 2 ? 1000 + n : 100 + n)), far = (a, b) => (a >= 1000 || b >= 1000 ? metres(a % 1000, b % 1000) + 2 : metres(a % 100, b % 100));
  const out = inStep({ ways: [['a', { nodes: lead }], ['b', { nodes: zig }]], weights, natural: 1.4, slowest: 0.3, metres: (a, b) => (a < 100 && b < 100 ? metres(a, b) : far(a, b)) });
  assert.deepEqual(out[0][1].at, out[0][0].at);
  assert.equal(out[0][1].at[0], 0);
  assert.equal(out[0][0].at.length, out[0][0].path.length);
});

test('never slower than the slowest, never faster than their own pace', () => {
  const lead = [0, 1], out = inStep({ ways: [['a', { nodes: lead }]], weights: [30], natural: 1.4, slowest: 0.3, metres });
  assert.equal(out[0][0].pace, 0.3);
  const far = Array.from({ length: 101 }, (_, n) => n), quick = inStep({ ways: [['a', { nodes: far }]], weights: [READ], natural: 1.4, slowest: 0.3, metres });
  assert.equal(quick[0][0].pace, undefined);
});

test('beside a way: across its heading, node for node, the offset kept where there is no ground, else the way itself', () => {
  const cell = id => ({ i: id % 100, j: Math.floor(id / 100), k: 0 }), open = new Set([101, 102, 103, 105, 106]);
  const node = (i, j) => (j >= 0 && open.has(j * 100 + i) ? j * 100 + i : null);
  // Heading +i: a positive side is +j, one cell.
  assert.deepEqual(besideWay([1, 2, 3], sideOf(0), { cell, node }), [101, 102, 103]);
  // The other side has no ground: the way's own nodes (never a flip).
  assert.deepEqual(besideWay([1, 2, 3], sideOf(1), { cell, node }), [1, 2, 3]);
  // A gap in the side (cell 104): the way's own node there, then beside again.
  assert.deepEqual(besideWay([1, 2, 3, 4, 5, 6], 1, { cell, node }), [101, 102, 103, 4, 105, 106]);
  // Diagonal heading (+i +j): the offset is diagonal, (-1, +1); off the grid at the first node, the way's own.
  const diagonal = [0, 101, 202, 303], all = (i, j) => (i >= 0 && j >= 0 ? j * 100 + i : null);
  assert.deepEqual(besideWay(diagonal, 1, { cell, node: all }), [0, 200, 301, 402]);
  assert.deepEqual([0, 1, 2, 3].map(sideOf), [1, -1, 2, -2]);
});

test('a drive keeps its own timing and is cut across the cards by their reading', async () => {
  const { cutDrive, DEMO } = await import('./on-the-move.mjs');
  // A drive of 11 nodes, one every 2 life seconds (20 s); three cards of 2, 3 and 1 reading seconds, played in real time.
  const at = Array.from({ length: 11 }, (_, n) => n * 2);
  assert.equal(DEMO, 3);
  assert.deepEqual(cutDrive(at, [2, 3, 1]), [[0, 1], [1, 2], [2, 10]], 'the last card takes the rest of the drive');
  // At the player's quicker clock (a reading second = DEMO life seconds), the same cards cover more of the drive.
  assert.deepEqual(cutDrive(at, [2, 3, 1], { scale: DEMO }), [[0, 3], [3, 7], [7, 10]]);
  // Talk longer than the drive: the cards after the arrival are empty (the car stopped).
  assert.deepEqual(cutDrive([0, 3, 6], [6, 2, 2]), [[0, 2], [2, 2], [2, 2]]);
});

