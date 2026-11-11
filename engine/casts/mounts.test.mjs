import test from 'node:test';
import assert from 'node:assert/strict';
import { carrierSheet, mergedSheet, rideCheck, ridesFile, ridesToAsk, tiesOf, wayOf, withRides } from './mounts.mjs';

test('a carrier\'s sheet: a vehicle carries by its kind, a weapon attacks, a person lends their ways of moving only', () => {
  const heli = carrierSheet({ prop: { kind: 'a helicopter', airborne: 60 } });
  assert.deepEqual(heli.move, { flight: { height: 60 } });
  assert.equal(heli.seats, 6);
  assert.deepEqual(carrierSheet({ prop: { kind: 'a small weapon', attack: { kind: 'line', range: 100, sure: 0.9 } } }), { kind: 'weapon', move: {}, attack: { line: { range: 100 } }, seats: 0 });
  const kuroko = carrierSheet({ person: { move: { appear: { reach: 100, midair: true } }, attack: { close: { reach: 3 } } } });
  assert.deepEqual(kuroko.move, { appear: { reach: 100, midair: true } });
  assert.deepEqual(kuroko.attack, {}, 'whom a person carries does not take their attacks');
  assert.equal(carrierSheet({ prop: { kind: 'furniture' } }), null);
});

test('the merged sheet: per kind the larger of each limit, and where it came from', () => {
  const own = { move: { agility: { factor: 2, sure: 0.8 } }, attack: { close: { reach: 1 } } };
  const merged = mergedSheet(own, [{ id: 'car', sheet: carrierSheet({ prop: { kind: 'a car' } }) }, { id: 'gun', sheet: carrierSheet({ prop: { kind: 'a small weapon', attack: { kind: 'line', range: 100 } } }) }, { id: 'stick', sheet: { move: {}, attack: { close: { reach: 3 } } } }]);
  assert.deepEqual(merged.move, { agility: { factor: 2, by: 'own' }, ride: { factor: 3, road: true, by: 'car' } });
  assert.deepEqual(merged.attack, { close: { reach: 3, by: 'stick' }, line: { range: 100, by: 'gun' } });
});

test('a ridden move goes the carrier\'s way (flying first); an unridden one the ability in use, else as noted', () => {
  assert.equal(wayOf({ carrier: carrierSheet({ prop: { kind: 'a helicopter' } }) }), 'flight');
  assert.equal(wayOf({ carrier: carrierSheet({ prop: { kind: 'a bus' } }) }), 'ride:2.5:road');
  assert.equal(wayOf({ carrier: carrierSheet({ person: { move: { appear: { reach: 80 } } } }) }), 'teleport:80');
  assert.equal(wayOf({ carrier: carrierSheet({ person: { move: {} } }), otherwise: 'run' }), 'run', 'carried by someone with no power: as they go');
  assert.equal(wayOf({ carrier: carrierSheet({ person: { move: {} } }), carrierWay: 'agile:4' }), 'agile:4', 'the carrier\'s own way this card');
  assert.equal(wayOf({ sheet: { move: { climb: { height: 300 } } }, ability: 'climb' }), 'climb:300');
  assert.equal(wayOf({ sheet: { move: {} }, ability: 'climb', otherwise: 'walk' }), 'walk');
});

test('L22: riders stand with their carrier; no more than it seats', () => {
  const at = id => ({ car: [0, 0, 0], a: [1, 0, 0], b: [30, 0, 0] })[id];
  const out = rideCheck({ carrier: 'car', riders: ['a', 'b'], sheet: { seats: 1 }, at, size: 4.5 });
  assert.deepEqual(out.map(entry => entry.verdict), ['held', 'ok', 'held']);
});

test('the notes: carried and vehicle moves asked, a vehicle\'s own move not; the answers merged back as ties', () => {
  const prefilm = { units: { u1: { cast: ['a', 'b', 'van'], scriptSupervisor: { moves: [{ sentence: 's1', who: 'a', motion: 'elsewhere', how: 'carried' }, { sentence: 's2', who: 'van', motion: 'elsewhere', how: 'vehicle' }, { sentence: 's3', who: 'b', how: 'walk' }] }, blocking: [{ sentence: 's4', who: 'b', manner: 'a vehicle' }] } } };
  const rows = ridesToAsk({ prefilm, vehicles: new Set(['van']) });
  assert.deepEqual(rows.map(row => `${row.who}:${row.how}`), ['a:carried', 'b:vehicle']);
  rows[0].on = 'b'; rows[0].sure = 0.9; rows[1].on = 'van'; rows[1].sure = 0.3;
  const file = ridesFile({ rows });
  assert.deepEqual(Object.keys(file.rides), ['scriptSupervisor|s1|a']);
  assert.equal(file.held.length, 1);
  const merged = withRides(prefilm, file);
  assert.equal(merged.units.u1.scriptSupervisor.moves[0].riding, 'b');
  assert.deepEqual(tiesOf(merged.units.u1), [{ who: 'a', on: 'b', sentence: 's1' }]);
});
