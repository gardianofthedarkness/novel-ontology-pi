import test from 'node:test';
import assert from 'node:assert/strict';
import { beatsOf, decode } from './beats.mjs';
import { gateOf } from './gate.mjs';

test('beats: one unsure block does not break a beat; a sure run of another type does; every scene starts one', () => {
  const block = (type, confidence = 0.9) => ({ distribution: { [type]: 0.9, routine: type === 'routine' ? 0.9 : 0.1 }, confidence });
  const types = decode([block('routine'), block('routine'), block('confrontation', 0.3), block('routine'), block('confrontation'), block('confrontation'), block('confrontation')]);
  assert.deepEqual(types, ['routine', 'routine', 'routine', 'routine', 'confrontation', 'confrontation', 'confrontation']);
  assert.deepEqual(beatsOf(['routine', 'routine', 'routine'], ['a', 'a', 'b']).map(beat => [beat.scene, beat.from, beat.to]), [['a', 0, 1], ['b', 2, 2]]);
});

test('the gate over windows: a fight leads to the combat director; coverage and damping counted', () => {
  const window = (scene, type, action) => ({ scene, first: `${scene}${type}`, last: '', block: { distribution: { [type]: 0.8, routine: 0.2 }, confidence: 0.9, type }, sentences: Array.from({ length: 12 }, () => ({ distribution: { action, narration: 1 - action }, confidence: 0.8 })), signals: {} });
  const windows = [...Array.from({ length: 8 }, () => window('s1', 'routine', 0.1)), window('s2', 'confrontation', 0.9), window('s2', 'confrontation', 0.9), ...Array.from({ length: 8 }, () => window('s3', 'interior', 0.05))];
  const gate = gateOf(windows);
  assert.equal(gate.beats.find(beat => beat.scene === 's2').lead, 'combat');
  assert.ok(gate.coverage.choreography > 0 && gate.coverage.choreography < 0.4);
  assert.ok(gate.windows.filter(entry => entry.scene === 's3').slice(1).every(entry => entry.damped), 'stretches of thought with no action are held still (the first is the fight\'s margin)');
});
