import test from 'node:test';
import assert from 'node:assert/strict';
import { castItems, checkSheet, mergeValue, samePeople, unsheeted } from './cast.mjs';

// A small reading: char_1 a girl in Santa clothes, char_2 her name once it is said (one person); char_3 someone else.
const reading = () => ({
  chart: { entities: [
    { id: 'char_1', type: 'person', proper: ['Santa girl'], names: ['the girl'], mentions: 3 },
    { id: 'char_2', type: 'person', proper: ['Maidono'], names: ['Maidono Hoshimi'] },
    { id: 'char_3', type: 'person', proper: ['Negaoka Norito'], names: ['Director Negaoka'] },
    { id: 'char_4', type: 'person', proper: ['Negaoka'], names: [] },
  ] },
  cards: [
    { id: 'c1', people: [{ id: 'char_1', how: ['speaks'] }, { id: 'char_3', how: ['acts'] }] },
    { id: 'c2', people: [{ id: 'char_1', how: ['acts'] }, { id: 'char_2', how: ['speaks', 'addressed'] }] },
    { id: 'c3', people: [{ id: 'char_3', how: ['speaks'] }, { id: 'char_4', how: ['acts'] }] },
  ],
  roles: { s1: { who: { id: 'char_2', answer: 'char_2' } } },
  rides: { 'scriptSupervisor|s1|char_2': { on: 'char_3' } },
});

test('a merge: every mention made the kept one; a card naming both lists them once, with both ways they were there; the chart keeps one entry', () => {
  const { value, changed } = mergeValue(reading(), 'char_1', 'char_2');
  assert.equal(changed, 5, 'the chart, a card, a role\'s id and answer, a ride\'s key');
  assert.deepEqual(value.chart.entities.map(entity => entity.id), ['char_1', 'char_3', 'char_4']);
  assert.deepEqual(value.chart.entities[0].proper, ['Santa girl', 'Maidono'], 'its names joined, the kept one\'s first');
  assert.equal(value.chart.entities[0].mentions, 3, 'its own scalars kept');
  assert.deepEqual(value.cards[1].people, [{ id: 'char_1', how: ['acts', 'speaks', 'addressed'] }]);
  assert.deepEqual(value.roles.s1.who, { id: 'char_1', answer: 'char_1' });
  assert.ok('scriptSupervisor|s1|char_1' in value.rides, 'an id inside a composite key');
  assert.equal(JSON.stringify(value).includes('char_2'), false);
});

test('a merge where the merged one comes first in a list: the kept one\'s own entry still leads', () => {
  const data = { list: [{ id: 'char_9', label: 'merged' }, { id: 'char_1', label: 'kept' }] };
  assert.deepEqual(mergeValue(data, 'char_1', 'char_9').value.list, [{ id: 'char_1', label: 'kept' }]);
  assert.deepEqual(mergeValue({ ids: ['char_10', 'char_1'] }, 'char_10', 'char_1').value.ids, ['char_10'], 'never char_10 inside char_1x');
});

test('a sheet is checked against the settei\'s kinds and their limits', () => {
  assert.deepEqual(checkSheet({ move: { flight: { height: 80 } }, attack: { line: { range: 100 } } }), { move: { flight: { sure: 1, height: 80 } }, attack: { line: { sure: 1, range: 100 } } });
  assert.throws(() => checkSheet({ move: { swim: {} } }), /No move kind "swim"/);
  assert.throws(() => checkSheet({ move: { flight: { range: 30 } } }), /takes height/);
  assert.throws(() => checkSheet({ attack: { area: { radius: -3 } } }), /number above 0/);
  assert.throws(() => checkSheet({ spell: {} }), /"move" and "attack" only/);
});

test('the finder: names inside names (Negaoka in Negaoka Norito), the one with more cards kept; Maidono and the Santa girl only when raised', () => {
  assert.deepEqual(samePeople(reading()), [{ keep: 'char_3', merged: 'char_4', forms: ['Negaoka Norito', 'Negaoka'], cards: [2, 1] }]);
  assert.deepEqual(unsheeted(reading(), { people: { char_3: {} } }, { least: 2 }), [{ who: 'char_1', cards: 2 }]);
});

test('the cast\'s questions: a pair, a held sheet kind, a main character with none; ids from what they ask', () => {
  const abilities = { people: { char_1: { move: {}, attack: {} } }, held: [{ who: 'char_3', part: 'move', kind: 'flight', sure: 0.34, height: 6, evidence: ['s9'] }] };
  const items = castItems({ reading: reading(), abilities, least: 2, at: '2026-11-06T00:00:00Z' });
  assert.deepEqual(items.map(item => [item.kind, item.subjects.join('+'), item.options.join('/')]), [
    ['person', 'char_3+char_4', 'same person/different people'],
    ['sheet', 'char_3', 'yes, as held/no/set by hand'],
    ['sheet', 'char_3', 'nothing beyond a person/set by hand'],
  ]);
  assert.match(items[1].question, /a way of moving: flies, or stays up in the air \(height 6\)\. Jev said so, only 34% sure/);
  assert.equal(castItems({ reading: reading(), abilities, least: 2 })[0].id, items[0].id, 'asked again: the same question');
});
