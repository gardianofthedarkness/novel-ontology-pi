import test from 'node:test';
import assert from 'node:assert/strict';
import { attackKindOf, inUseFile, movesToAsk, withInUse } from './in-use.mjs';

test('a blow sorted into close, line or area by its kind, shape and range', () => {
  assert.equal(attackKindOf({ attack: 'hand to hand', shape: 'point', range: 'touch' }), 'close');
  assert.equal(attackKindOf({ attack: 'beam or laser', shape: 'line or beam', range: 'far (under 100 m)' }), 'line');
  assert.equal(attackKindOf({ attack: 'ranged power', shape: 'sphere', range: 'near (under 15 m)' }), 'area');
  assert.equal(attackKindOf({ attack: 'area blast', shape: 'point' }), 'area');
  assert.equal(attackKindOf({ attack: 'firearm', shape: 'point', range: 'near (under 15 m)' }), 'line');
});

test('only the moves of people with a way of moving are asked; what is in use merges into the casts\' notes', () => {
  const prefilm = { units: { u: { scriptSupervisor: { moves: [{ sentence: 's1', who: 'a', motion: 'elsewhere', how: 'run' }, { sentence: 's2', who: 'b', motion: 'nearby' }] }, blocking: [{ sentence: 's3', who: 'a', manner: 'up or along a wall', to: 'x' }], actionDirector: [{ sentence: 's4', attacker: 'a', attack: 'firearm', shape: 'point' }] } } };
  const abilities = { people: { a: { move: { climb: { height: 300 } } } } };
  const rows = movesToAsk({ prefilm, abilities });
  assert.deepEqual(rows.map(row => [row.cast, row.sentence]), [['scriptSupervisor', 's1'], ['blocking', 's3']]);
  rows[0].kind = 'none'; rows[0].sure = 0.9; rows[1].kind = 'climb'; rows[1].sure = 0.8;
  const merged = withInUse(prefilm, inUseFile({ moves: rows, prefilm, at: 't' })).units.u;
  assert.equal(merged.scriptSupervisor.moves[0].ability, undefined);
  assert.equal(merged.blocking[0].ability, 'climb');
  assert.equal(merged.actionDirector[0].attackKind, 'line');
});
