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
  const settled = [{ line: 'b0_s1', who: 'char_1', to: 'char_2', by: 'reading', gate: 'applied' }, { line: 'b0_s2', who: null, to: null, by: 'reading', gate: 'held' }];
  const out = canonOf({ ...input, settled }), scene = out.find(entry => entry.file === 'scenes.jsonl').record;
  assert.deepEqual([scene.charactersPresent, scene.locationId], [['char_1', 'char_2'], 'loc_1'], 'people of the book only, not slots');
  assert.deepEqual(scene.turns, [{ speakerId: 'char_1', addresseeId: 'char_2', sentenceIds: ['b0_s1'], by: 'reading' }, { speakerId: null, addresseeId: null, sentenceIds: ['b0_s2'], by: 'reading' }], 'a speaker the laws held is written as unknown');
  const where = out.filter(entry => entry.file === 'state-changes.jsonl');
  assert.deepEqual(where.map(entry => [entry.record.characterId, entry.record.afterEventId, entry.gate]), [['char_1', 'e2', 'applied'], ['char_2', 'e2', 'held']]);
  assert.equal(out.find(entry => entry.file === 'timelines.jsonl').record.id, 'tl_strand_s1');
  assert.equal(canonOf(input).find(entry => entry.file === 'scenes.jsonl').record.turns[1].speakerId, 'char_3', 'a line the run did not play keeps the reading\'s speaker');
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
  // Two runs on the same records (W10 then W11), undone newest first: the canon as before either (the second run's rows
  // used to stay, since the records had rows before it).
  const original = { scenes: await readFile(join(dir, 'ontology', 'scenes.jsonl'), 'utf8') };
  await write(['stage', 'world', 'ledger', 'r2.jsonl'], input.ledger);
  await toCanon(dir, { run: 'r', reading }); await toCanon(dir, { run: 'r2', reading });
  assert.equal((await lines('state-changes.jsonl')).filter(row => row.world?.run === 'r2').length, 1);
  await undoCanon(dir, { run: 'r2' }); await undoCanon(dir, { run: 'r' });
  const fold = rows => [...new Map(rows.map(row => [row.id, row])).values()];
  assert.deepEqual((await lines('state-changes.jsonl')).map(row => row.id), ['sc_old'], 'neither run\'s state changes left');
  assert.deepEqual(fold(await lines('scenes.jsonl')), fold(original.scenes.trim().split('\n').map(line => JSON.parse(line))), 'the scenes as they were');
  assert.ok(!(await lines('timelines.jsonl').catch(() => [])).some(row => row.world), 'neither run\'s timelines left');
});

test('speakers settled by the world: Jev\'s unsure guess there; the only speaker; a guess from elsewhere held; an audit\'s no rules one out', async () => {
  const { settleSpeakers } = await import('./speakers.mjs');
  const here = { a: { x: 0, y: 0, z: 0 }, b: { x: 3, y: 0, z: 0 }, c: { x: 200, y: 0, z: 0 } };
  const roles = { l1: { kind: 'spoken', who: { id: null, answer: 'a', confidence: 0.4 }, to: { id: null, answer: 'b' } }, l2: { kind: 'spoken', who: { id: null, answer: 'none', confidence: 0.3 } }, l3: { kind: 'spoken', who: { id: null, answer: 'z', confidence: 0.45 } }, l4: { kind: 'spoken', who: { id: null, answer: 'c', confidence: 0.4 }, to: { id: 'b' } }, l5: { kind: 'spoken', who: { id: 'a', confidence: 0.9 } } };
  const cards = [{ scene: 's', card: 'dialogue:l1', positions: here, lines: ['l1', 'l2', 'l3', 'l4', 'l5'].map(id => ({ id })) }];
  const peopleOf = () => [{ id: 'b', how: ['speaks'] }, { id: 'a', how: ['addressed'] }];
  const by = list => Object.fromEntries(list.map(entry => [entry.line, `${entry.gate}:${entry.who ?? '-'}`]));
  assert.deepEqual(by(settleSpeakers({ cards, reading: { roles }, peopleOf })), { l1: 'applied:a', l2: 'applied:b', l3: 'held:-', l4: 'held:-', l5: 'applied:a' }, 'l4: c is 200 m from b, out of earshot; l2 falls to the only speaker');
  assert.equal(by(settleSpeakers({ cards, reading: { roles }, peopleOf, pins: { notSpeaker: { l2: 'b' } } })).l2, 'held:-', 'ruled out by an audit: not settled on them again by rule');
  assert.equal(by(settleSpeakers({ cards, reading: { roles }, peopleOf, route: 'review' })).l1, 'held:-', 'a class whose audits are too often wrong goes to the review');
});

test('a description the review answered is a named person: its words an alias of theirs, once', () => {
  const entities = new Map([['char_1', { id: 'char_1', kind: 'Character', names: [{ text: 'Mikoto', lang: 'en', kind: 'canonical' }], properties: {}, confidence: 1 }]]);
  const withSlots = { ...reading, slots: [{ id: 'slot_9', label: 'the girl', names: ['the girl', 'the girl in brown'] }] };
  const out = canonOf({ ...input, reading: withSlots, entities, pins: { notSpeaker: {}, same: [['char_1', 'slot_9']] } }).filter(entry => entry.file === 'entities.jsonl');
  assert.deepEqual(out.map(entry => entry.record.names.map(name => name.text)), [['Mikoto', 'the girl', 'the girl in brown']]);
  const again = new Map([['char_1', out[0].record]]);
  assert.equal(canonOf({ ...input, reading: withSlots, entities: again, pins: { notSpeaker: {}, same: [['char_1', 'slot_9']] } }).filter(entry => entry.file === 'entities.jsonl').length, 0, 'nothing new the second time');
});

test('places from the world: a named building is its lot, with the blasts on it; a room inside it is PART_OF it, on its floor; a walk between scenes of one unstated time puts the second later', async () => {
  const { worldPlaces } = await import('./canon.mjs');
  const world = { NX: 100, NZ: 100, K: 5, oi: 0, oj: 0, ok: 0, lots: [{ i0: 10, j0: 10, nx: 10, nz: 10, floors: 6, role: 'office', source: 'b1' }, { i0: 50, j0: 50, nx: 4, nz: 4, floors: 2, source: 'b2' }] };
  const node = (x, z, k = 0) => (k * world.NZ + Math.floor(z / 2)) * world.NX + Math.floor(x / 2);
  const page = { world, scenes: [
    { id: 's1', starts: { char_1: node(25, 25) }, events: [{ id: 'action:x', hit: { lot: 0, destroyed: [1, 2, 3] }, moves: [] }] },
    { id: 's2', starts: { char_1: node(26, 24, 3), char_2: node(30, 30, 3) }, events: [] },
  ] };
  const script = { places: { loc_b: { scale: 'building' }, loc_r: { scale: 'room' } }, scenes: [{ id: 's1', place: 'loc_b', at: { node: 't:night', stated: false } }, { id: 's2', place: 'loc_r', at: { node: 't:night', stated: false } }] };
  const record = { scenes: [{ scene: 's1', cards: [] }, { scene: 's2', cards: [] }] };
  const placed = worldPlaces({ page, script, record, arrivals: [{ fromScene: 's1', scene: 's2', who: 'char_1', metres: 600 }] });
  assert.deepEqual(placed.places.loc_r, [{ scene: 's2', lot: { source: 'b1', floors: 6, role: 'office' }, floor: 3 }]);
  const entities = new Map(['loc_b', 'loc_r'].map(id => [id, { id, kind: 'Location', names: [{ text: id }], properties: {}, confidence: 1 }]));
  const scenes = new Map([['s1', { id: 's1', sentenceIds: ['x1'] }], ['s2', { id: 's2', sentenceIds: ['x2'] }]]);
  const events = new Map([['e1', { id: 'e1', chronologicalOrder: 1, evidence: { sentenceIds: ['x1'] } }], ['e2', { id: 'e2', chronologicalOrder: 2, evidence: { sentenceIds: ['x2'] } }]]);
  const out = canonOf({ run: 'r', record: { scenes: [] }, ledger: [], pins: {}, scenes, events, script, strands: null, reading: { roles: {} }, entities, world: placed, relations: [] });
  const of = id => out.find(entry => entry.file === 'entities.jsonl' && entry.record.id === id)?.record.properties.world;
  assert.deepEqual(of('loc_b'), { lot: 'b1', floors: 6, role: 'office', damage: [{ scene: 's1', card: 'action:x', cells: 3 }] });
  assert.deepEqual(of('loc_r'), { lot: 'b1', floor: 4 });
  const relations = out.filter(entry => entry.file === 'relations.jsonl').map(entry => [entry.record.type, entry.record.fromId, entry.record.toId, entry.record.properties.minMinutes ?? null]);
  assert.deepEqual(relations, [['PART_OF', 'loc_r', 'loc_b', null], ['PRECEDES', 'e1', 'e2', 8]]);
  const again = canonOf({ run: 'r', record: { scenes: [] }, ledger: [], pins: {}, scenes, events, script, strands: null, reading: { roles: {} }, entities, world: placed, relations: out.filter(entry => entry.file === 'relations.jsonl').map(entry => entry.record) });
  assert.equal(again.filter(entry => entry.file === 'relations.jsonl').length, 0, 'what canon has is not written again');
});

test('a split is asked when someone is twice in two places at once', () => {
  const ledger = [1, 2].map(n => ({ state: 'held', law: 'L2', subject: 'char_1', value: { what: `s${n} & s${n + 5} · char_1` } }));
  const held = canonOf({ ...input, ledger }).filter(entry => entry.file === 'held');
  assert.deepEqual(held.map(entry => [entry.record.kind, entry.record.who, entry.record.where.length]), [['split', 'char_1', 2]]);
});

test('a line the reading was unsure of is settled by its voice, whatever Jev guessed', async () => {
  const { settleSpeakers } = await import('./speakers.mjs');
  const cards = [{ scene: 's', card: 'c', positions: { a: { x: 0, y: 0, z: 0 }, b: { x: 2, y: 0, z: 0 } }, lines: [{ id: 'l1' }, { id: 'l2' }, { id: 'l3' }] }];
  const roles = { l1: { kind: 'spoken', who: { id: null, answer: 'none', confidence: 0.3 } }, l2: { kind: 'spoken', who: { id: null, answer: 'b', confidence: 0.4 } }, l3: { kind: 'spoken', who: { id: null, answer: 'a', confidence: 0.4 } } };
  const voices = { l1: { who: 'a' }, l2: { who: 'b' }, l3: { who: 'b' } };
  const out = Object.fromEntries(settleSpeakers({ cards, reading: { roles }, voices }).map(entry => [entry.line, `${entry.by}:${entry.gate}:${entry.who ?? '-'}`]));
  assert.deepEqual(out, { l1: 'voice:applied:a', l2: 'voice:applied:b', l3: 'voice:applied:b' });
});

test("a line the book's picture shows someone saying is theirs, before their voice's pick, if they are there", async () => {
  const { settleSpeakers } = await import('./speakers.mjs');
  const cards = [{ scene: 's', card: 'c', positions: { a: { x: 0, y: 0, z: 0 }, b: { x: 2, y: 0, z: 0 } }, lines: [{ id: 'l1' }, { id: 'l2' }] }];
  const roles = { l1: { kind: 'spoken', who: { id: null, answer: 'none', confidence: 0.3 } }, l2: { kind: 'spoken', who: { id: null, answer: 'none', confidence: 0.3 } } };
  const out = Object.fromEntries(settleSpeakers({ cards, reading: { roles }, voices: { l1: { who: 'a' }, l2: { who: 'a' } }, pictured: { l1: 'b', l2: 'z' } }).map(entry => [entry.line, `${entry.by}:${entry.who ?? '-'}`]));
  assert.deepEqual(out, { l1: 'picture:b', l2: 'voice:a' }, 'l2: the picture\'s speaker is not there, so the voice decides');
});
