// The places a book shares with earlier books and their universe keys (same-places.mjs; src/universe/placeKeys.ts).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { decide, keysOf, match, setPlace, show } from './same-places.mjs';
import { FOREIGN, placeKey, placeOfKey, slotToBook, slotToUniverse, usePlaceKeys } from '../../dist/src/universe/placeKeys.js';

const here = new Map([['p1', { label: 'Harbour', names: ['Harbour', 'the port'] }], ['p2', { label: 'Mill', names: ['Mill'] }], ['p3', { label: 'Inn', names: ['Inn'] }]]);
const earlier = [
  { book: 'vol-2', id: 'p9', key: 'p4', names: ['the port'] },
  { book: 'vol-1', id: 'p4', key: 'p4', names: ['Harbour', 'the port'] },
  { book: 'vol-1', id: 'p1', key: 'p1', names: ['Inn'] },
];

test('a place takes the key of the earlier place sharing the most names; one with none is new under its book', () => {
  const out = decide({ book: 'vol-3', here, earlier });
  assert.equal(out.p1.key, 'p4');
  assert.equal(out.p1.same, 'vol-1:p4', 'two names shared beat one');
  assert.equal(out.p2.key, 'vol-3:p2');
  assert.equal(out.p2.by, 'new');
  assert.equal(out.p3.key, 'p1', 'an earlier book\'s id is its key, whatever this book numbers');
});

test('the work model may refuse a match; a hand override stands', () => {
  const out = decide({ book: 'vol-3', here, earlier, checked: id => (id === 'p3' ? { same: false, reason: 'another inn' } : { same: true, reason: 'the same harbour' }), kept: { p2: { label: 'Mill', key: 'p7', same: 'vol-1:p7', by: 'hand', why: 'the text says so' } } });
  assert.equal(out.p1.by, 'work');
  assert.equal(out.p3.key, 'vol-3:p3');
  assert.match(out.p3.why, /another inn/);
  assert.deepEqual(out.p2, { label: 'Mill', key: 'p7', same: 'vol-1:p7', by: 'hand', why: 'the text says so' });
});

test('keys: the first book\'s are its ids; a later book\'s own and foreign places translate both ways', () => {
  usePlaceKeys(null);
  assert.equal(placeKey('loc_000001'), 'loc_000001');
  usePlaceKeys({ loc_000002: 'loc_000001' }, 'vol-2');
  assert.equal(placeKey('loc_000002'), 'loc_000001', 'the same place takes the earlier key');
  assert.equal(placeKey('loc_000001'), 'vol-2:loc_000001', 'another place with the earlier id is keyed under its book');
  assert.equal(placeKey('slot:loc_000001:cbd:1'), 'slot:loc_000001:cbd:1', 'a slot id is its own key');
  assert.equal(placeOfKey('loc_000001'), 'loc_000002');
  assert.equal(placeOfKey('vol-2:loc_000001'), 'loc_000001');
  assert.equal(placeOfKey('loc_000003'), `${FOREIGN}loc_000003`, 'an earlier place this book has not');
  assert.equal(placeKey(`${FOREIGN}loc_000003`), 'loc_000003');
  const kept = { id: 'slot:loc_000001:cbd:1', parent: 'loc_000001', owner: 'loc_000003', sharers: [{ book: 'vol-1', mention: 'unnamed:place_1_1' }] };
  const book = slotToBook(kept);
  assert.equal(book.parent, 'loc_000002');
  assert.equal(book.owner, `${FOREIGN}loc_000003`);
  assert.deepEqual(slotToUniverse(book), kept, 'back in keys as it was');
  usePlaceKeys(null);
});

test('match, set and show over a library: the first book is keyed by its ids, the second by its matches', async () => {
  const library = await mkdtemp(join(tmpdir(), 'same-places-'));
  const book = async (name, places) => {
    const dir = join(library, name, 'novel', 'ontology');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'manifest.json'), '{}');
    await writeFile(join(dir, 'entities.jsonl'), places.map(([id, names]) => JSON.stringify({ id, kind: 'Location', names: names.map(text => ({ text })) })).join('\n') + '\n' + JSON.stringify({ id: 'char_1', kind: 'Character', names: [{ text: 'Harbour' }] }));
    return join(library, name, 'novel');
  };
  const one = await book('vol-1', [['loc_000001', ['City']], ['loc_000002', ['Harbour']]]);
  const two = await book('vol-2', [['loc_000001', ['Mill']], ['loc_000002', ['City']], ['loc_000003', ['Harbour', 'the port']]]);
  assert.equal((await match(one)).first, true);
  assert.equal(await keysOf(one), null);
  const out = await match(two);
  assert.equal(out.same, 2);
  assert.deepEqual(await keysOf(two), { loc_000001: 'vol-2:loc_000001', loc_000002: 'loc_000001', loc_000003: 'loc_000002' });
  await setPlace(two, 'loc_000003', 'new', 'another harbour, on the other coast');
  assert.equal((await keysOf(two)).loc_000003, 'vol-2:loc_000003');
  await match(two);
  assert.equal((await keysOf(two)).loc_000003, 'vol-2:loc_000003', 'a rerun keeps the override');
  assert.equal((await show(two)).places.loc_000003.by, 'hand');
  await assert.rejects(setPlace(one, 'loc_000001', 'new', 'x'), /first book/);
  const record = JSON.parse(await readFile(join(library, 'universe', 'places.json'), 'utf8'));
  assert.deepEqual(Object.keys(record.books), ['vol-1', 'vol-2']);
});

test('a later book matched before the first is recorded keys the first by its ids', async () => {
  const library = await mkdtemp(join(tmpdir(), 'same-places-'));
  for (const [name, places] of [['vol-1', [['loc_000001', ['City']]]], ['vol-2', [['loc_000004', ['City']]]]]) {
    const dir = join(library, name, 'novel', 'ontology');
    await mkdir(dir, { recursive: true }); await writeFile(join(dir, 'manifest.json'), '{}');
    await writeFile(join(dir, 'entities.jsonl'), places.map(([id, names]) => JSON.stringify({ id, kind: 'Location', names: names.map(text => ({ text })) })).join('\n'));
  }
  await match(join(library, 'vol-2', 'novel'));
  assert.deepEqual(await keysOf(join(library, 'vol-2', 'novel')), { loc_000004: 'loc_000001' });
  assert.equal(await keysOf(join(library, 'vol-1', 'novel')), null, 'the first book recorded as keyed by its ids');
});
