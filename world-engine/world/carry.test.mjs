// What a book carries into the next, per strand (carry.mjs; milestones M16; docs/v2/borrow-and-spawn.md §4.5).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bookEntry, candidatesFor, damageInForce, damageOf, decide, inForce, keep, reaches, register, setDecision, slotOfSource } from './carry.mjs';

const NAMES = { a: ['Ann', 'the girl'], b: ['Ben'], c: ['Cal'], x: ['Stranger'], d: ['Dee'] };
const names = id => NAMES[id] ?? [];
const unit = (id, evidence) => ({ id, evidence });
// Book 1: the main strand (u1..u5, a and b at the end), a side strand of c (u2, u3) closed into it at u4, and a strand
// of d alone (u6), open at the end.
const book1 = () => bookEntry({
  book: 'vol-1', from: 'text', names,
  script: { scenes: [unit('u1', ['a', 'b']), unit('u2', ['c']), unit('u3', ['c']), unit('u4', ['a', 'c']), unit('u5', ['a', 'b']), unit('u6', ['d'])] },
  forks: [
    { id: 'u1', scenes: ['u1', 'u4', 'u5'], people: ['a', 'b', 'c'], envelope: 'city', open: true },
    { id: 'u2', scenes: ['u2', 'u3'], people: ['c'], envelope: 'city', into: 'u1', intoAt: 'u4' },
    { id: 'u6', scenes: ['u6'], people: ['d'], envelope: 'city', open: true },
  ],
});

test('a book\'s strands for the registry: the last group by name, open or closed into another', () => {
  const entry = book1();
  assert.deepEqual(entry.strands.map(strand => [strand.key, strand.open, strand.into ?? null]), [['vol-1:u1', true, null], ['vol-1:u2', false, 'vol-1:u1'], ['vol-1:u6', true, null]]);
  assert.deepEqual(entry.strands[0].last.map(person => person.id), ['a', 'b', 'c'], 'the last three segments with someone acting');
  assert.deepEqual(entry.strands[0].first[0], { id: 'a', names: ['Ann', 'the girl'] });
});

test('candidates are the open strands of the book registered last before', () => {
  const registry = { books: { 'vol-1': book1() } };
  assert.deepEqual([candidatesFor(registry, 'vol-2').last, candidatesFor(registry, 'vol-2').candidates.map(strand => strand.key)], ['vol-1', ['vol-1:u1', 'vol-1:u6']]);
  assert.deepEqual(candidatesFor(registry, 'vol-1').candidates, [], 'a book inherits from no later one');
});

test('inherited when the new book\'s strand begins with someone of the last group, by name; else closed', () => {
  const { candidates } = candidatesFor({ books: { 'vol-1': book1() } }, 'vol-2');
  const strands = [{ key: 'vol-2:v1', first: [{ id: 'p9', names: ['Ben'] }] }, { key: 'vol-2:v4', first: [{ id: 'p1', names: ['Stranger'] }] }];
  const decisions = decide({ candidates, strands });
  assert.deepEqual(decisions.map(decision => [decision.candidate, decision.inherited, decision.into, decision.by]), [['vol-1:u1', true, 'vol-2:v1', 'names'], ['vol-1:u6', false, null, 'names']]);
  assert.match(decisions[0].reason, /Ben go on in it/);
  const refused = decide({ candidates, strands, checked: () => ({ inherits: false, reason: 'months later, elsewhere' }) });
  assert.deepEqual([refused[0].inherited, refused[0].by, refused[0].reason], [false, 'work', 'months later, elsewhere']);
});

test('a lot\'s slot from its source, and nominated when a named place owns it', () => {
  const slots = { 'slot:d:shop:1': { owner: null }, 'slot:d:shop:1:rows2': { owner: 'loc_10' } };
  assert.deepEqual(slotOfSource('city:slot:d:shop:1:rows2', slots), { slot: 'slot:d:shop:1:rows2', nominated: true, owner: 'loc_10' });
  assert.deepEqual(slotOfSource('city:slot:d:shop:1:rows7:part', slots), { slot: 'slot:d:shop:1', nominated: false, owner: null }, 'up to the nearest slot known');
  assert.deepEqual(slotOfSource('city:B12', slots), { slot: null, nominated: false });
});

test('a run\'s damage building by building, each with the strand its scene is on', () => {
  const page = { world: { lots: [{ source: 'city:slot:d:shop:1:rows2', manifold: 'm1' }, { source: 'city:B4', manifold: 'm2' }] }, scenes: [{ id: 'u1', events: [] }, { id: 'u3', events: [{ hit: { lot: 0, blasted: [[3, 1, 1, 1]], fallen: [], destroyed: [], fell: [], more: [{ lot: 1, blasted: [[3, 0, 0, 1]], fallen: [[4, 1, 1, 2, 0]], destroyed: [5], fell: [] }] } }] }] };
  const out = damageOf({ book: 'vol-1', run: 'r1', page, entry: book1(), slots: { 'slot:d:shop:1:rows2': { owner: 'loc_10' } } });
  assert.deepEqual(out.map(entry => [entry.scene, entry.story, entry.strand, entry.building, entry.nominated]), [['u3', 1, 'vol-1:u2', 'city:slot:d:shop:1:rows2', true], ['u3', 1, 'vol-1:u2', 'city:B4', false]]);
  assert.deepEqual([out[1].manifold, out[1].fallen, out[1].destroyed], ['m2', [[4, 1, 1, 2, 0]], [5]]);
});

test('in force: nominated always; another only when its strand reached the book through inherited strands', () => {
  const registry = { books: { 'vol-1': book1() }, decisions: { 'vol-2': [{ candidate: 'vol-1:u1', inherited: true, into: 'vol-2:v1' }, { candidate: 'vol-1:u6', inherited: false, into: null }] } };
  const damage = { entries: [
    { book: 'vol-1', strand: 'vol-1:u2', building: 'side', nominated: false },
    { book: 'vol-1', strand: 'vol-1:u6', building: 'alone', nominated: false },
    { book: 'vol-1', strand: 'vol-1:u6', building: 'named', nominated: true },
    { book: 'vol-2', strand: 'vol-2:v1', building: 'own', nominated: false },
  ] };
  assert.deepEqual(inForce(registry, damage, 'vol-2').map(entry => entry.building), ['side', 'named'], 'the side strand lives on in the main, inherited; the closed one is whole; a book\'s own is no carry');
  assert.equal(reaches(registry, 'vol-1:u2', 'vol-2'), true);
  // Book 3: vol-2's v1 closed at its end into nothing new; vol-3 does not inherit it.
  registry.books['vol-2'] = { strands: [{ key: 'vol-2:v1', scenes: ['w1'], open: true }] };
  registry.decisions['vol-3'] = [{ candidate: 'vol-2:v1', inherited: false, into: null }];
  assert.deepEqual(inForce(registry, damage, 'vol-3').map(entry => entry.building), ['named'], 'closed at vol-3: every non-nominated building whole again');
  registry.decisions['vol-3'] = [{ candidate: 'vol-2:v1', inherited: true, into: 'vol-3:z1' }];
  assert.deepEqual(inForce(registry, damage, 'vol-3').map(entry => entry.building), ['side', 'named', 'own'], 'inherited through two books');
});

test('register, keep, set and the damage in force over a library on disk', async () => {
  const root = await mkdtemp(join(tmpdir(), 'carry-')), novel = join(root, 'vol-1', 'novel'), universe = join(root, 'universe');
  await mkdir(join(novel, 'stage', 'world', 'restrand'), { recursive: true }); await mkdir(join(novel, 'stage', 'simulation', 'runs', 'director'), { recursive: true }); await mkdir(join(novel, 'ontology'), { recursive: true }); await mkdir(universe, { recursive: true });
  await writeFile(join(novel, 'ontology', 'entities.jsonl'), Object.entries(NAMES).map(([id, list]) => JSON.stringify({ id, names: list.map(text => ({ text })) })).join('\n'));
  const forks = [{ id: 'u1', scenes: ['u1', 'u2'], people: ['a', 'b'], envelope: 'city', open: true }, { id: 'u3', scenes: ['u3'], people: ['d'], envelope: 'city', open: true }];
  await writeFile(join(novel, 'stage', 'world', 'restrand', 'r1.json'), JSON.stringify({ forks, units: [{ id: 'u1', people: ['a', 'b'] }, { id: 'u2', people: ['a'] }, { id: 'u3', people: ['d'] }] }));
  await writeFile(join(novel, 'stage', 'simulation', 'runs', 'director', 'r1.page.json'), JSON.stringify({ world: { lots: [{ source: 'city:B1', manifold: 'x' }, { source: 'city:slot:s:1', manifold: 'y' }] }, scenes: [{ id: 'u1', events: [] }, { id: 'u2', events: [{ hit: { lot: 0, blasted: [[1, 1, 1, 1]] } }] }, { id: 'u3', events: [{ hit: { lot: 1, blasted: [[1, 2, 2, 1]] } }] }] }));
  await writeFile(join(universe, 'terrain.json'), JSON.stringify({ slots: { 'slot:s:1': { owner: null } } }));
  const made = await register(novel, { run: 'r1' });
  assert.deepEqual([made.from, made.open], ['run:r1', ['vol-1:u1', 'vol-1:u3']]);
  const kept = await keep(novel, { run: 'r1' });
  assert.deepEqual([kept.buildings, kept.nominated, kept.strands], [2, 0, ['vol-1:u1', 'vol-1:u3']]);
  // Book 2: the agent decides (no reading here): the main inherited, d's closed.
  const second = join(root, 'vol-2', 'novel'); await mkdir(second, { recursive: true });
  await setDecision(second, 'vol-1:u1', true, 'the same two go on', { into: 'vol-2:v1' });
  await setDecision(second, 'vol-1:u3', false, 'resolved');
  const forced = await damageInForce(second);
  assert.deepEqual([forced.book, forced.entries.map(entry => entry.building), forced.kept], ['vol-2', ['city:B1'], 2]);
  const registry = JSON.parse(await readFile(join(universe, 'strands.json'), 'utf8'));
  assert.deepEqual(registry.decisions['vol-2'].map(decision => [decision.candidate, decision.inherited, decision.by]), [['vol-1:u1', true, 'agent'], ['vol-1:u3', false, 'agent']]);
  await assert.rejects(setDecision(second, 'vol-1:zz', true, 'no'), /not an open strand/);
});

test('the work model\'s check takes a plain client (generate) or a metered one (generateWithUsage), and no answer is no check', async () => {
  const { workCheck } = await import('./carry.mjs');
  const plain = { async generate(request) { assert.match(request.system, /JSON/); return '{"inherits":false,"reason":"another city"}'; } };
  const metered = { async generateWithUsage() { return { content: '{"inherits":true,"reason":"the same two"}' }; } };
  assert.deepEqual(await workCheck(plain, { lastLines: ['a'], firstLines: ['b'] }), { inherits: false, reason: 'another city' });
  assert.deepEqual(await workCheck(metered, { lastLines: [], firstLines: [] }), { inherits: true, reason: 'the same two' });
  assert.equal(await workCheck({ async generate() { return 'not json'; } }, { lastLines: [], firstLines: [] }), null);
  assert.equal(await workCheck({ async generate() { throw new Error('down'); } }, { lastLines: [], firstLines: [] }), null);
});
