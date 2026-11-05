import test from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesFile, abilitiesToAsk, propOf, propsFile, propsToAsk, wayOf } from './settei.mjs';

test('a way from Jev: none is no way; a teleport has a reach and no height; a leap a height', () => {
  assert.equal(wayOf({ way: { value: 'none', confidence: 0.9 } }), null);
  assert.deepEqual(wayOf({ way: { value: 'teleport', confidence: 0.8 }, reach: { value: 'tens of metres', confidence: 0.6 } }), { way: 'teleport', reach: 30, sure: 0.8, reachSure: 0.6, sight: false });
  assert.equal(wayOf({ way: { value: 'leap', confidence: 0.9 }, reach: { value: 'about a hundred metres', confidence: 0.9 }, height: { value: 'up to a rooftop (10–30 m)', confidence: 0.7 } }).height, 25);
});

test('the abilities file merges an ability and a person\'s own lines into one way, the further reach kept', () => {
  const file = abilitiesFile([
    { who: 'a', concept: 'c1', way: { way: 'teleport', reach: 30, sure: 0.6 }, evidence: ['s1'] },
    { who: 'a', way: { way: 'teleport', reach: 100, sure: 0.5 }, evidence: ['s2'] },
    { who: 'b', way: null, evidence: ['s3'] },
    { who: 'c', way: { way: 'ride', reach: 30, sure: 0.3 }, evidence: ['s4'] },
  ], { names: new Map([['a', 'A']]), at: 't' });
  assert.deepEqual(Object.keys(file.people), ['a']);
  assert.deepEqual(file.held.map(entry => entry.who), ['c'], 'a doubtful way is held');
  assert.deepEqual(file.people.a.ways.teleport, { reach: 100, sure: 0.6 });
  assert.deepEqual(file.people.a.evidence, ['s1', 's2']);
});

test('a prop from Jev: a helicopter flies and is about a bus long; not a thing has no shape', () => {
  const heli = propOf({ kind: { value: 'a helicopter', confidence: 0.9 }, size: { value: 'about a bus', confidence: 0.8 } });
  assert.equal(heli.shape, 'capsule'); assert.equal(heli.vehicle, true); assert.ok(heli.airborne > 0); assert.equal(Math.max(...heli.size), 11);
  assert.deepEqual(propOf({ kind: { value: 'not a thing', confidence: 0.9 } }), { kind: 'not a thing', shape: null });
  assert.equal(propOf({ kind: { value: 'a handheld thing', confidence: 0.9 }, size: { value: 'fits in a hand', confidence: 0.9 } }).shape, 'box');
});

test('what to ask: slots that are vehicles or weapons, objects, and the notes\' items, each label once; owned abilities of people', () => {
  const reading = {
    slots: [{ id: 's1', kind: 'vehicle', label: 'heli', sentences: ['x1'] }, { id: 's2', kind: 'person', label: 'man', sentences: ['x2'] }, { id: 's3', kind: 'vehicle', label: 'heli', sentences: ['x3'] }],
    chart: { entities: [{ id: 'item_1', type: 'object', names: ['phone'], seen: ['x4'] }, { id: 'p', type: 'person', names: ['P'] }, { id: 'c', type: 'concept', names: ['jump'], first: 'x5', seen: ['x5', 'x6'], owners: [{ id: 'p', from: 'x5', confidence: 1 }, { id: 'many', from: 'x6', confidence: 0.7 }] }] },
  };
  const props = propsToAsk({ reading, prefilm: { units: { u: { scriptSupervisor: { items: [{ item: 'phone', sentence: 'x7' }] } } } } });
  assert.deepEqual(props.map(entry => entry.label).sort(), ['heli', 'phone']);
  assert.deepEqual(props.find(entry => entry.label === 'heli').ids, ['s1', 's3']);
  assert.deepEqual(abilitiesToAsk({ reading }).map(entry => [entry.who, entry.concept]), [['p', 'c']]);
  const file = propsFile([{ label: 'heli', ids: ['s1', 's3'], from: ['slot:vehicle'], sentences: ['x1'], prop: { kind: 'a helicopter', shape: 'capsule' } }]);
  assert.equal(file.ids.s3, 'heli');
});
