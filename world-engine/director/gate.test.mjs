import test from 'node:test';
import assert from 'node:assert/strict';
import { beatsOf, decode, smooth } from './beats.mjs';
import { gateOf } from './gate.mjs';

test('beats: one unsure block does not break a beat; a sure run of another type does; every scene starts one', () => {
  const block = (type, confidence = 0.9) => ({ distribution: { [type]: 0.9, routine: type === 'routine' ? 0.9 : 0.1 }, confidence });
  const types = decode([block('routine'), block('routine'), block('confrontation', 0.3), block('routine'), block('confrontation'), block('confrontation'), block('confrontation')]);
  assert.deepEqual(types, ['routine', 'routine', 'routine', 'routine', 'confrontation', 'confrontation', 'confrontation']);
  assert.deepEqual(beatsOf(['routine', 'routine', 'routine'], ['a', 'a', 'b']).map(beat => [beat.scene, beat.from, beat.to]), [['a', 0, 1], ['b', 2, 2]]);
});

test('the gate over windows: a fight leads to the combat director; faculties co-fire; coverage counted', () => {
  const window = (scene, type, action, thought = 0) => ({ scene, first: `${scene}${type}`, last: '', block: { distribution: type === 'routine' ? { routine: 0.8, exposition: 0.2 } : { [type]: 0.8, exposition: 0.2 }, confidence: 0.9, type }, sentences: Array.from({ length: 12 }, () => ({ distribution: { action, thought, narration: 1 - action - thought }, confidence: 0.8 })), signals: {} });
  const windows = [...Array.from({ length: 10 }, () => window('s1', 'exposition', 0.1)), window('s2', 'confrontation', 0.9), window('s2', 'confrontation', 0.9), ...Array.from({ length: 4 }, () => window('s3', 'interior', 0.05, 0.8)), ...Array.from({ length: 4 }, () => window('s4', 'exposition', 0.1))];
  const gate = gateOf(windows);
  assert.equal(gate.beats.find(beat => beat.scene === 's2').lead, 'combat');
  assert.ok(gate.coverage.choreography > 0 && gate.coverage.choreography < 0.4);
  assert.ok(gate.windows.filter(entry => entry.scene === 's3').slice(1).every(entry => entry.fired.includes('feeling') && !entry.fired.includes('choreography')), 'thought fires the inner-state faculty, not the fight\'s');
});

test('smoothing per strand: a later block is evidence for an earlier one; an unsure block takes its strand\'s type', () => {
  const block = (distribution, confidence) => ({ distribution, confidence });
  const flat = block({ routine: 0.34, confrontation: 0.33, traversal: 0.33 }, 0.3);
  const fight = block({ confrontation: 0.9, routine: 0.1 }, 0.9);
  const out = smooth([flat, fight, fight, fight]);
  assert.equal(out[0].type, 'confrontation', 'the fight that follows says what the unsure start was');
  assert.ok(out[0].distribution.confrontation > flat.distribution.confrontation);
  const middle = smooth([fight, fight, block({ routine: 0.7, confrontation: 0.3 }, 0.4), fight, fight]);
  assert.equal(middle[2].type, 'confrontation', 'one unsure block inside a fight stays in the fight');
});
