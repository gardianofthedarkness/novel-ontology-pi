import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { universeMemories, storyPoint, findPerson } from './universe.mjs';

// A made-up world of two books: a in both (char_1 in book 1, char_2 in book 2), b only in book 1; a place in each book
// with the same local id; an afterword scene in book 2.
async function world() {
  const root = await mkdtemp(join(tmpdir(), 'universe-'));
  const book = async (name, scenes, entities, memories, paratext = []) => {
    const dir = join(root, name);
    await mkdir(join(dir, 'novel', 'ontology'), { recursive: true }); await mkdir(join(dir, 'reading'), { recursive: true });
    await writeFile(join(dir, 'reading', 'data.json'), JSON.stringify({ scenes: Array.from({ length: scenes }, (_, i) => ({ id: `scene_${i + 1}` })) }));
    await writeFile(join(dir, 'reading', 'paratext.json'), JSON.stringify({ paratext }));
    await writeFile(join(dir, 'novel', 'ontology', 'entities.jsonl'), entities.map((e) => JSON.stringify(e)).join('\n'));
    await writeFile(join(dir, 'novel', 'ontology', 'memories.jsonl'), memories.map((m) => JSON.stringify(m)).join('\n'));
  };
  const person = (id, text) => ({ id, kind: 'Character', names: [{ text, kind: 'canonical' }] });
  const mem = (id, holderId, at, cues, scene, extra = {}) => ({ id, holderId, branchId: 'canon', kind: 'episode', source: 'did', atOrder: at, learnedOrder: at, summaryEn: id, arousal: 0.5, valence: 0, relevance: 0.5, central: 1, confidence: 1, cues, evidence: [], scene, ...extra });
  await book('vol-1', 10, [person('char_1', 'Alma'), person('char_2', 'Bern'), { id: 'loc_1', kind: 'Location', names: [{ text: 'Harbour' }] }],
    [mem('m1', 'char_1', 3, ['char_2', 'loc_1'], 'scene_3'), mem('m2', 'char_2', 5, ['char_1'], 'scene_5', { heardFromId: 'char_1', source: 'told' })]);
  await book('vol-2', 8, [person('char_2', 'Alma'), { id: 'loc_1', kind: 'Location', names: [{ text: 'Tower' }] }],
    [mem('m1', 'char_2', 2, ['loc_1'], 'scene_2'), mem('m9', 'char_2', 8, [], 'scene_8')], ['scene_8']);
  await writeFile(join(root, 'job.json'), JSON.stringify({ volumes: [1, 2].map((n) => ({ id: n, workspace: join(root, `vol-${n}`, 'novel') })) }));
  await mkdir(join(root, 'universe'));
  await writeFile(join(root, 'universe', 'cast.json'), JSON.stringify({ persons: [
    { id: 'p_0001', label: 'Alma Reyes', forms: ['Alma', 'Alma Reyes'], members: [{ book: 'vol-1', entity: 'char_1' }, { book: 'vol-2', entity: 'char_2' }] },
    { id: 'p_0002', label: 'Bern', forms: ['Bern'], members: [{ book: 'vol-1', entity: 'char_2' }] },
  ] }));
  return root;
}

test('memories meet by person, on one story order; other entries keep their book; paratext is left out', async () => {
  const root = await world();
  try {
    const u = await universeMemories(root);
    assert.deepEqual(u.books.map((b) => [b.book, b.offset]), [['vol-1', 0], ['vol-2', 10]]);
    const byId = Object.fromEntries(u.memories.map((m) => [m.id, m]));
    assert.deepEqual(Object.keys(byId).sort(), ['vol-1/m1', 'vol-1/m2', 'vol-2/m1'], 'the afterword memory is out; the two m1 stay two');
    assert.equal(byId['vol-1/m1'].holderId, 'p_0001');
    assert.equal(byId['vol-2/m1'].holderId, 'p_0001', 'char_2 of book 2 is the same person as char_1 of book 1');
    assert.equal(byId['vol-1/m2'].holderId, 'p_0002', 'char_2 of book 1 is someone else');
    assert.deepEqual(byId['vol-1/m1'].cues, ['p_0002', 'vol-1/loc_1']);
    assert.deepEqual(byId['vol-2/m1'].cues, ['vol-2/loc_1'], 'the same local id is another place');
    assert.equal(byId['vol-1/m2'].heardFromId, 'p_0001');
    assert.equal(byId['vol-2/m1'].atOrder, 12, 'scene 2 of book 2 comes after book 1\'s ten');
    assert.deepEqual([storyPoint(u.books, 'vol-1'), storyPoint(u.books, 'vol-2:3')], [10, 13]);
    assert.equal(findPerson(u, 'Alma').id, 'p_0001');
    assert.equal(u.people.find((p) => p.id === 'p_0001').name, 'Alma', 'named by what the books call them');
    assert.throws(() => storyPoint(u.books, 'vol-9'), /no book vol-9/);
  } finally { await rm(root, { recursive: true, force: true }); }
});
