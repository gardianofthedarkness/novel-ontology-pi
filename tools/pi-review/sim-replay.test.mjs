import test from 'node:test';
import assert from 'node:assert/strict';
import { replayOf, roughPath } from './sim-replay.mjs';

// A 10 × 10 world grid; a node is i + j·NX (+ k·NX·NZ), shifted by oi, oj, ok.
const world = { NX: 10, NZ: 10, oi: 0, oj: 0, ok: 0, lots: [{ i0: 1, j0: 1, nx: 2, nz: 3, floors: 4, detected: { name: 'tower', scene: 's2' } }] };
const node = (i, j) => i + j * 10;
const page = {
  title: 'test', world, people: { a: { name: 'A', color: '#f00' }, b: { name: 'B' } },
  scenes: [
    { id: 's1', place: 'p1', starts: { a: node(0, 0), 'crowd:001:1': node(5, 5) }, events: [{ id: 'action:x1', text: 'a goes', moves: [{ person: 'a', how: 'walk', path: [node(0, 0), node(1, 0), node(2, 0), node(3, 0), node(3, 1)] }, { person: 'crowd:001:1', path: [node(5, 5), node(6, 5)] }] }] },
    { id: 's2', place: 'p2', starts: { b: node(9, 9) }, events: [{ id: 'action:y1', text: 'b waits', moves: [] }] },
  ],
};

test('the replay: units in story time, every person\'s track, crowds left out, buildings from the terrain', () => {
  // The strands put s2 first in story time (a lower layer), on its own strand.
  const strands = { scenes: [{ id: 's1', fork: 's1', layer: 2 }, { id: 's2', fork: 's2', layer: 1 }] };
  const terrain = { sites: { loc_1: { label: 'the school (scene 3)', scale: 'building', kind: 'school', box: [0, 0, 10, 20] }, loc_2: { label: 'a street', scale: 'street', box: [0, 0, 100, 10] } } };
  const replay = replayOf(page, strands, terrain);
  assert.deepEqual(replay.moments.map(entry => [entry.unit, entry.card, entry.fork]), [['s2', null, 0], ['s2', 'action:y1', 0], ['s1', null, 1], ['s1', 'action:x1', 1]]);
  assert.deepEqual(replay.people.map(person => person.id), ['a', 'b']);
  assert.equal(replay.tracks['crowd:001:1'], undefined);
  assert.deepEqual(replay.tracks.a.map(entry => entry.m), [2, 3]);
  assert.deepEqual(replay.tracks.a[1].at, [7, 3, 0]);
  assert.deepEqual(replay.buildings.map(entry => [entry.name, entry.x, entry.z]), [['the school', 5, 10]]);
  assert.deepEqual(replay.places.map(entry => entry.name), ['a street']);
  assert.deepEqual(replay.forks.map(fork => fork.units), [['s2'], ['s1']]);
});

test('a rough path keeps its ends, a point every few metres and its turns', () => {
  const straight = Array.from({ length: 11 }, (_, k) => [k, 0]);
  assert.deepEqual(roughPath(straight), [[0, 0], [4, 0], [8, 0], [10, 0]]);
  assert.deepEqual(roughPath([[0, 0], [1, 0], [1, 1]]), [[0, 0], [1, 0], [1, 1]], 'a turn is kept');
});
