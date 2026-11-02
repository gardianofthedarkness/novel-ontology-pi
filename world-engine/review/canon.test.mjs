import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonOf, toCanon, undoCanon } from './canon.mjs';

const scenes = new Map([['s1', { id: 's1', sentenceIds: ['b0_s1', 'b0_s2', 'b0_s3'], charactersPresent: [], turns: [], locationId: null }]]);
const events = new Map([['e1', { id: 'e1', chronologicalOrder: 1, evidence: { sentenceIds: ['b0_s1'] } }], ['e2', { id: 'e2', chronologicalOrder: 2, evidence: { sentenceIds: ['b0_s3'] } }]]);
const record = { scenes: [{ scene: 's1', starts: { char_1: [0, 0, 0], char_2: [3, 0, 0], slot_9: [1, 0, 1] }, cards: [] }] };
const reading = { roles: { b0_s1: { kind: 'spoken', who: { id: 'char_1' }, to: { id: 'char_2' } }, b0_s2: { kind: 'spoken', who: { id: 'char_3' } }, b0_s3: { kind: 'action', who: { id: 'char_1' } } } };
const input = { run: 'r', record, ledger: [{ state: 'held', law: 'L9', subject: 'char_2', value: { scene: 's1' } }, { state: 'held', law: 'L6', subject: 'char_3', value: { what: 's1 · b0_s2', why: 'speaker char_3 is not present' } }], pins: { notSpeaker: {} }, scenes, events, script: { scenes: [{ id: 's1', place: 'loc_1' }] }, strands: { scenes: [{ id: 's1', fork: 's1' }] }, reading };

test('canon from a run: presence, place and speakers of a scene; where each is at its end, held where a law held them; a timeline per strand', () => {
  const out = canonOf(input), scene = out.find(entry => entry.file === 'scenes.jsonl').record;
  assert.deepEqual([scene.charactersPresent, scene.locationId], [['char_1', 'char_2'], 'loc_1'], 'people of the book only, not slots');
  assert.deepEqual(scene.turns, [{ speakerId: 'char_1', addresseeId: 'char_2', sentenceIds: ['b0_s1'] }, { speakerId: null, addresseeId: null, sentenceIds: ['b0_s2'] }], 'a speaker the laws held is written as unknown');
  const where = out.filter(entry => entry.file === 'state-changes.jsonl');
  assert.deepEqual(where.map(entry => [entry.record.characterId, entry.record.afterEventId, entry.gate]), [['char_1', 'e2', 'applied'], ['char_2', 'e2', 'held']]);
  assert.equal(out.find(entry => entry.file === 'timelines.jsonl').record.id, 'tl_strand_s1');
  assert.equal(canonOf({ ...input, pins: { notSpeaker: { b0_s1: 'char_1' } } }).find(entry => entry.file === 'scenes.jsonl').record.turns[0].speakerId, null, 'the review rejected that speaker');
});

test('a run\'s writes to canon are logged and undone: an existing record back to what it was, a new one taken out', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'canon-')), write = (path, rows) => writeFile(join(dir, ...path), rows.map(row => JSON.stringify(row)).join('\n') + '\n');
  await mkdir(join(dir, 'ontology')); await mkdir(join(dir, 'stage', 'world', 'ledger'), { recursive: true }); await mkdir(join(dir, 'stage', 'director'), { recursive: true });
  await write(['ontology', 'scenes.jsonl'], [...scenes.values()]); await write(['ontology', 'events.jsonl'], [...events.values()]); await write(['ontology', 'state-changes.jsonl'], [{ id: 'sc_old', characterId: 'char_9' }]);
  await writeFile(join(dir, 'stage', 'director', 'run.json'), JSON.stringify(record)); await write(['stage', 'world', 'ledger', 'r.jsonl'], input.ledger);
  await writeFile(join(dir, 'stage', 'world', 'script.json'), JSON.stringify(input.script)); await writeFile(join(dir, 'stage', 'world', 'strands.json'), JSON.stringify(input.strands));
  const done = await toCanon(dir, { run: 'r', reading });
  assert.deepEqual(done.applied, { 'scenes.jsonl': 1, 'state-changes.jsonl': 1, 'timelines.jsonl': 1 });
  const lines = async file => (await readFile(join(dir, 'ontology', file), 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal((await lines('scenes.jsonl')).at(-1).locationId, 'loc_1');
  assert.deepEqual(await undoCanon(dir, { run: 'r' }), { undone: 3 });
  assert.equal((await lines('scenes.jsonl')).at(-1).locationId, null, 'the scene as it was');
  assert.deepEqual((await lines('state-changes.jsonl')).map(row => row.id), ['sc_old'], 'the new record taken out, the old kept');
  assert.deepEqual(await undoCanon(dir, { run: 'r' }), { undone: 0 }, 'undone once');
});
