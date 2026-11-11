import test from 'node:test';
import assert from 'node:assert/strict';
import { abilitiesFile, abilitiesToAsk, propOf, propsFile, propsToAsk, sheetOf } from './settei.mjs';

test('a sheet from Jev: a move with its limits, an attack with its; none is none', () => {
  assert.deepEqual(sheetOf({ move: { value: 'none', confidence: 0.9 }, attack: { value: 'none', confidence: 0.9 } }), { move: null, attack: null });
  const appear = sheetOf({ move: { value: 'appear', confidence: 0.8 }, reach: { value: 'tens of metres' }, midair: { value: 'in the air too' }, attack: { value: 'close', confidence: 0.7 }, close: { value: 'touch' } });
  assert.deepEqual(appear.move, { kind: 'appear', sure: 0.8, reach: 30, midair: true });
  assert.deepEqual(appear.attack, { kind: 'close', sure: 0.7, reach: 1 });
  const blast = sheetOf({ move: { value: 'flight', confidence: 0.6 }, height: { value: 'high over the city (50 m or more)' }, attack: { value: 'area', confidence: 0.9 }, radius: { value: 'about ten metres' }, range: { value: 'about a hundred metres' } });
  assert.deepEqual(blast.move, { kind: 'flight', sure: 0.6, height: 80 });
  assert.deepEqual(blast.attack, { kind: 'area', sure: 0.9, radius: 10, range: 100 });
  assert.equal(sheetOf({ move: { value: 'agility', confidence: 0.9 }, agility: { value: 'about four times as fast' } }).move.factor, 4);
});

test('the abilities file: an ability and a person\'s own lines merged by kind, the larger limit kept; a doubtful kind held', () => {
  const file = abilitiesFile([
    { who: 'a', concept: 'c1', sheet: { move: { kind: 'appear', sure: 0.6, reach: 30, midair: false }, attack: { kind: 'line', sure: 0.9, range: 100 } }, evidence: ['s1'] },
    { who: 'a', sheet: { move: { kind: 'appear', sure: 0.7, reach: 100, midair: true }, attack: null }, evidence: ['s2'] },
    { who: 'b', sheet: { move: null, attack: null }, evidence: ['s3'] },
    { who: 'c', sheet: { move: { kind: 'flight', sure: 0.3, height: 25 }, attack: null }, evidence: ['s4'] },
  ], { names: new Map([['a', 'A']]), at: 't' });
  assert.deepEqual(Object.keys(file.people), ['a']);
  assert.deepEqual(file.people.a.move.appear, { sure: 0.7, reach: 100, midair: true });
  assert.deepEqual(file.people.a.attack.line, { sure: 0.9, range: 100 });
  assert.deepEqual(file.held.map(entry => [entry.who, entry.part]), [['c', 'move']]);
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
