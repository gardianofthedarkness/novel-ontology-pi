import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { OWNED_KINDS, VEHICLE_MODELS, modelOf, ruleModel, transportFile, transportRows } from './transport.mjs';

const baked = JSON.parse(await readFile(new URL('../../apps/playground/src/data/vehicleModels.json', import.meta.url), 'utf8'));

test('every model the specialist may pick is baked', () => {
  for (const models of Object.values(VEHICLE_MODELS)) for (const name of Object.keys(models)) assert.ok(baked.models[name], name);
});

test('the rows: vehicles with their kind\'s models to pick (and none), weapons and machines for their owner only; a thing or a sign never asked', () => {
  const props = { labels: { 'police car': { kind: 'a car', evidence: ['s1'] }, rifle: { kind: 'a small weapon', evidence: ['s2'] }, sign: { kind: 'a sign or a screen' }, 'a robot': { kind: 'a robot or a machine' } } };
  const rows = transportRows(props, { peopleIn: evidence => (evidence.includes('s1') ? ['char_1'] : []) });
  assert.deepEqual(rows.map(row => row.label), ['a robot', 'police car', 'rifle']);
  const car = rows.find(row => row.label === 'police car');
  assert.ok(car.models['kn-police'] && car.models['none of these']);
  assert.deepEqual(car.people, ['char_1']);
  assert.equal(rows.find(row => row.label === 'rifle').models, null);
  assert.ok(OWNED_KINDS.has('a heavy weapon'));
});

test('the file: Jev\'s pick where it named a model of the kind, the rule of its name where it said none; owners as answered', () => {
  const rows = [
    { label: 'the taxi', kind: 'a car', evidence: ['s1'], model: 'none of these', owner: 'not said' },
    { label: 'black car', kind: 'a car', evidence: ['s2'], model: 'kn-suv-luxury', modelSure: 0.8, owner: 'char_2', ownerSure: 0.7 },
    { label: 'pistol', kind: 'a small weapon', evidence: ['s3'], owner: 'an organization' },
  ];
  const file = transportFile(rows, { model: 'stand-in', at: 'now' });
  assert.deepEqual(file.props['the taxi'], { kind: 'a car', model: 'kn-taxi', modelBy: 'rule', owner: 'not said', evidence: ['s1'] });
  assert.equal(file.props['black car'].model, 'kn-suv-luxury');
  assert.equal(file.props['black car'].modelBy, 'jev');
  assert.equal(file.props.pistol.model, undefined);
  assert.equal(modelOf(file, 'black car', 'a car'), 'kn-suv-luxury');
  assert.equal(modelOf(null, 'fire engine', 'a van or a truck'), 'kn-firetruck', 'before the specialist: its name\'s words');
  assert.equal(ruleModel('a helicopter', 'x'), null, 'a kind with no model is built from parts');
});
