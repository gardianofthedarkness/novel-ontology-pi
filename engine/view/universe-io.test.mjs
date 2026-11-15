// The universe view's data (universe-io.mjs): every book's units in told order, the carry's decisions without their words.
import test from 'node:test';
import assert from 'node:assert/strict';
import { bookLabel, universeData } from './universe-io.mjs';

const live = (run, units, cards) => ({ world: { run, notes: { director: { units, cards } } } });

test('each book\'s units with their strand, story time and people; a unit before any time stands as the first comes', () => {
  const one = live('r1', [{ id: 'scene_000001', fork: 'scene_000001', when: null }, { id: 'scene_000002', fork: 'scene_000001', when: 't:y1:07-20:night' }, { id: 'scene_000003', fork: 'scene_000003', when: null }],
    [{ scene: 'scene_000002', moves: [{ who: 'char_1' }, { who: 'crowd:1' }], lines: [{ who: 'char_1' }, { who: 'char_2' }] }]);
  const two = live('r2', [{ id: 'scene_000001', fork: 'scene_000002', when: 't:y1:08-08' }], []);
  const registry = { books: { 'vol-1': { strands: [{ key: 'vol-1:scene_000001', scenes: [], open: true }, { key: 'vol-1:scene_000003', scenes: [], open: false, into: 'vol-1:scene_000001' }] } },
    decisions: { 'vol-2': [{ candidate: 'vol-1:scene_000001', inherited: true, into: 'vol-2:scene_000002', by: 'work', reason: 'the words of a model' }], 'vol-3': [{ candidate: 'x', inherited: false }] } };
  const data = universeData({ title: 'T', books: [{ book: 'vol-1', live: one, reading: { names: { char_1: ['Ann'], char_2: ['Ben'] } } }, { book: 'vol-2', live: two, reading: null, run: 'r2' }], registry });
  assert.deepEqual(data.books[0].units, [['000001', '000001', null, []], ['000002', '000001', 'y1:07-20:night', ['char_1', 'char_2']], ['000003', '000003', '~y1:07-20:night', []]]);
  assert.deepEqual(data.books[0].names, { char_1: 'Ann', char_2: 'Ben' }, 'the crowd is no one named');
  assert.deepEqual(data.books[0].strands, [{ key: 'vol-1:scene_000001' }, { key: 'vol-1:scene_000003', into: 'vol-1:scene_000001' }]);
  assert.equal(data.books[1].strands, null, 'a book not registered yet: its run\'s strands');
  assert.deepEqual(data.decisions, { 'vol-2': [{ candidate: 'vol-1:scene_000001', inherited: true, into: 'vol-2:scene_000002', by: 'work' }] }, 'no reason\'s words; only the books shown');
  assert.equal(data.books[1].label, 'Vol 2');
  assert.equal(data.books[1].run, 'r2');
});

test('a book whose replay has no director run is refused', () => {
  assert.throws(() => universeData({ title: 'T', books: [{ book: 'vol-1', live: { world: { notes: {} } } }], registry: null }), /no director run/);
  assert.equal(bookLabel('book_one'), 'Book one');
});
