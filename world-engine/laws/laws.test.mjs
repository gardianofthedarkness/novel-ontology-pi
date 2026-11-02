import test from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesHeld, actorsThere, continuity, minutesOf, reachable, talk, travelTime, twoPlaces, waysOf } from './laws.mjs';

const at = (x, z, y = 0) => ({ x, z, y });

test('continuity holds within a strand and never carries from another one', () => {
  const strands = { scenes: [
    { id: 's1', fork: 's1', entries: [{ person: 'a', from: null }] },
    { id: 's2', fork: 's2', entries: [{ person: 'a', from: 's1' }] },
    { id: 's3', fork: 's1', entries: [{ person: 'a', from: 's1' }, { person: 'b', from: null }] },
  ] };
  const played = { scenes: [
    { id: 's1', present: ['a'], carried: [] },
    { id: 's2', present: ['a', 'b'], carried: ['a'] },
    { id: 's3', present: ['a', 'b'], carried: ['a', 'b'] },
  ] };
  const { checked, violations } = continuity({ played, strands });
  assert.equal(checked, 3);
  assert.deepEqual(violations.map(v => [v.scene, v.who]), [['s3', 'a'], ['s3', 'b']], 'a comes back to s1\'s strand from s2\'s state; b appears in this strand first but was carried');
});

test('two places at once only where two scenes state the same clock time; travel only where both state one', () => {
  const script = { scenes: [
    { id: 's1', place: 'p', present: ['a'], clock: [0, 1], at: { node: 't:y1:12-24:15:00', stated: true } },
    { id: 's2', place: 'q', present: ['a'], clock: [0, 2], at: { node: 't:y1:12-24:15:00', stated: true } },
    { id: 's3', place: 'q', present: ['a'], clock: [0, 3], at: { node: 't:y1:12-24:evening', stated: true } },
  ] };
  assert.equal(minutesOf('t:y1:12-24:evening'), null);
  assert.equal(twoPlaces({ script }).violations.length, 1);
  const played = { arrivals: [{ scene: 's2', fromScene: 's1', who: 'a', metres: 600 }, { scene: 's3', fromScene: 's2', who: 'a', metres: 9000 }] };
  const tooFar = travelTime({ played, script, abilities: { people: {} } });
  assert.deepEqual([tooFar.checked, tooFar.violations.length], [1, 1], '600 m in no time breaks it; a gap with no clock time fits anything');
  assert.equal(travelTime({ played, script, abilities: { people: { a: { ways: { teleport: { range: 1000 } } } } } }).violations.length, 0, 'a teleport fits');
});

test('talk: the speaker is present and in earshot of whom they speak to; actors are there', () => {
  const played = { cards: [
    { scene: 's1', card: 'dialogue:x', kind: 'dialogue', lines: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }], moves: [], actors: ['a', 'z'], positions: { a: at(0, 0), b: at(3, 0), c: at(80, 0) } },
  ] };
  const speakers = { l1: { who: 'a', to: 'b' }, l2: { who: 'a', to: 'c' }, l3: { who: 'z', to: 'a' } };
  assert.deepEqual(talk({ played, speakers }).violations.map(v => v.what), ['s1 · l2', 's1 · l3']);
  assert.deepEqual(actorsThere({ played }).violations.map(v => v.who), ['z']);
});

test('reachable and abilities: a chosen move that never walked; a leap only by someone who can', () => {
  const played = { cards: [{ scene: 's1', card: 'action:x', kind: 'action', lines: [], actors: [], positions: {}, moves: [
    { person: 'a', direction: 'J', how: 'leap', moved: true },
    { person: 'b', direction: 'C', how: 'run', moved: false, why: 'no way there on foot' },
    { person: 'c', direction: 'stays' },
  ] }] };
  assert.deepEqual(reachable({ played }).violations.map(v => v.who), ['b']);
  assert.equal(abilitiesHeld({ played, abilities: { people: {} } }).violations[0].why, 'a leap by someone with no such way (played as a walk)');
  const able = { people: { a: { ways: { leap: { height: 15 } } } } };
  assert.ok(waysOf(able, 'a').has('leap'));
  assert.equal(abilitiesHeld({ played, abilities: able }).violations[0].engine, true, 'a leap the person has, still walked by the engine until W4');
});
