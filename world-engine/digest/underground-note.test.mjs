import test from 'node:test';
import assert from 'node:assert/strict';
import { factsOf, notedUnderground, undergroundNotes, undergroundStretches } from './underground-note.mjs';

// A city of ten units, a district under it with three, and a hall in the district with one; plus a street of two.
const script = {
  places: { city: { scale: 'city', parent: null }, under: { scale: 'district', parent: 'city' }, hall: { scale: 'building', parent: 'under' }, street: { scale: 'street', parent: 'city' } },
  scenes: [
    ...Array.from({ length: 10 }, (_, n) => ({ id: `c${n}`, place: 'city' })),
    { id: 'u1', place: 'under' }, { id: 'u2', place: 'under' }, { id: 'u3', place: 'under' }, { id: 'h1', place: 'hall' },
    { id: 's1', place: 'street' }, { id: 's2', place: 'street' },
  ],
};
const settings = { c1: { setting: 'underground', sure: 0.9 }, c2: { setting: 'high-rise', sure: 0.8 }, u1: { setting: 'underground', sure: 1 }, u2: { setting: 'underground', sure: 0.8 }, u3: { setting: 'not said', sure: 0.9 }, s1: { setting: 'mid-rise streets', sure: 0.7 } };

test('a place is noted where most of its units are underground; a few underground units in a city are not enough', () => {
  const { places, noted } = undergroundNotes({ script, settings });
  assert.equal(places.city.noted, false, 'W12: 3 of the city\'s units underground never note the city');
  assert.deepEqual(places.city.underground, ['c1']);
  assert.equal(places.under.noted, true);
  assert.deepEqual(places.under.underground, ['u1', 'u2']);
  assert.equal(places.under.share, 0.67, 'two of its three units');
  const read = undergroundNotes({ script, settings: { ...settings, c3: { setting: 'underground', sure: 1 }, c4: { setting: 'underground', sure: 1 } } });
  assert.equal(read.places.city.noted, false, 'three of ten units, though three of the four the set dresser read there: a share of all its units');
  assert.ok(noted.includes('under'));
});

test('places inside a noted area inherit its note; the layer is the near-ground one by default', () => {
  const notes = undergroundNotes({ script, settings });
  assert.equal(notes.places.hall.noted, true);
  assert.equal(notes.places.hall.inherited, 'under');
  assert.equal(notes.places.hall.layer, 'near');
  assert.equal(notedUnderground(notes, 'hall', script)?.noted, true);
  assert.equal(notedUnderground(notes, 'street', script), null);
});

test("the pre-film notes' underground facts count as evidence for a unit the set dresser did not call underground", () => {
  const prefilm = { units: { s1: { scriptSupervisor: { facts: [{ kind: 'underground', sure: 0.8 }, { kind: 'floor', sure: 0.9 }] } }, s2: { scriptSupervisor: { facts: [{ kind: 'underground', sure: 0.7 }] } } } };
  assert.deepEqual(factsOf(prefilm), { s1: [0.8], s2: [0.7] });
  const notes = undergroundNotes({ script, settings, facts: factsOf(prefilm) });
  assert.equal(notes.places.street.noted, true);
  assert.deepEqual(notes.places.street.underground, ['s1', 's2']);
});

test('an underground stretch: units of one city and one sequence with underground evidence at most two apart, the units between them with it', () => {
  const scenes = ['a1', 'a2', 'a3', 'a4', 'a5', 'a6', 'a7', 'a8', 'b1'].map(id => ({ id, sequence: id[0] }));
  const city = { places: { city: { scale: 'city' }, street: { scale: 'street', parent: 'city' } }, scenes: [...scenes.map(({ id }) => ({ id, place: 'city' })), { id: 'a5x', place: 'street' }] };
  city.scenes.find(entry => entry.id === 'a6').place = 'street';
  const settings = { a1: { setting: 'underground', sure: 0.8, lines: ['l1'] }, a3: { setting: 'underground', sure: 1, lines: ['l3'] }, b1: { setting: 'underground', sure: 1, lines: ['l9'] } };
  const facts = { a4: [{ sure: 0.9, sentence: 'f4' }], a6: [{ sure: 0.9, sentence: 'f6' }], a8: [{ sure: 0.3, sentence: 'f8' }] };
  const stretches = undergroundStretches({ scenes, script: city, settings, facts });
  assert.equal(stretches.length, 1, 'b1 alone is no stretch; a6 is at a street, not the city; a8 is not sure enough');
  const [one] = stretches;
  assert.deepEqual(one.units, ['a1', 'a2', 'a3', 'a4']);
  assert.deepEqual(one.evidence, ['a1', 'a3', 'a4']);
  assert.deepEqual(one.sentences, ['l1', 'l3', 'f4']);
  assert.equal(one.parent, 'city');
  assert.equal(one.scale, 'street');
  assert.equal(one.id, 'place_a1_under'.replace('a1', 'a1'.slice(-6)));
  const apart = undergroundStretches({ scenes, script: city, settings: { a1: settings.a1 }, facts: { a5: [{ sure: 0.9, sentence: 'f5' }] } });
  assert.equal(apart.length, 0, 'three units apart is two stretches of one, so none');
});
