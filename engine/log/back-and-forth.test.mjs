import test from 'node:test';
import assert from 'node:assert/strict';
import { backAndForth } from './back-and-forth.mjs';

const record = { scenes: [{ scene: 's1', cards: [{ card: 'a1' }, { card: 'd1' }, { card: 'd2' }] }, { scene: 's2', cards: [{ card: 'a2' }] }] };
const position = (n, who, scene, card, at, from, source, metres) => ({ id: `r:${n}`, kind: 'position', who, scene, card, at, from: from && `r:${from}`, source, metres });

test('a walk out undone by a conversation pull is a round trip through talk', () => {
  const log = [
    position(1, 'k', 's1', null, { x: 0, y: 0, z: 0 }, null, 'carried', 0),
    position(2, 'k', 's1', 'a1', { x: 40, y: 0, z: 0 }, 1, 'answer', 40),
    position(3, 'k', 's1', 'd1', { x: 2, y: 0, z: 1 }, 2, 'talk', 39),
    position(4, 'i', 's1', null, { x: 60, y: 0, z: 0 }, null, 'walked in', 60),
  ];
  const result = backAndForth({ log, record });
  assert.equal(result.roundTrips.count, 1);
  assert.equal(result.roundTrips.throughTalk, 1);
  assert.deepEqual(result.roundTrips.kinds, { 'answer -> talk': 1 });
  assert.deepEqual(result.talk, { moves: 1, metres: 39, far: 1, farMetres: 39 });
});

test('a walk that stays, or comes back only in another scene, is no round trip', () => {
  const log = [
    position(1, 'k', 's1', null, { x: 0, y: 0, z: 0 }, null, 'carried', 0),
    position(2, 'k', 's1', 'a1', { x: 40, y: 0, z: 0 }, 1, 'answer', 40),
    position(3, 'k', 's1', 'd2', { x: 45, y: 0, z: 0 }, 2, 'talk', 5),
    position(4, 'k', 's2', 'a2', { x: 0, y: 0, z: 0 }, 3, 'digest', 45),
  ];
  const result = backAndForth({ log, record });
  assert.equal(result.roundTrips.count, 0);
  assert.equal(result.talk.far, 0);
});
