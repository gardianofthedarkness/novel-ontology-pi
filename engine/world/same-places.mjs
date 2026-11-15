// The places a book shares with the earlier books of its universe, and every place's universe key (src/universe/placeKeys.ts;
// docs/v3/design.html#borrow-and-spawn §6.4; the user, 2026-11-14: "One universe key per place. A matched place takes the key
// of the book where it first appeared; vol 1's places keep their own ids, so vol 1's world doesn't change. Every seed and id
// built from a place id uses this key", and "make sure it's human - workflow facing pipeline, not hard fix on test case").
//
// A volume step before terrain (engine/volume/volume.mjs `same-places`), its record in `universe/places.json`:
//   - match: each named place of the book (an ontology Location) beside the earlier books' places that share a name with
//     it; with --work the work model reads where each book names it and says whether it is the same place; a place with no
//     earlier namesake, or one the model says is another, is new: keyed under its book. The first book's keys are its ids.
//   - set: a person's (or the main agent's) override of one place, with a why: the same as an earlier book's place, or new;
//   - show: every place of the book with its key, how it was decided and why;
//   - canvas: where each place of a book stands in its world, from its parent (the book's world built alone, no model
//     asked), by key: a later book stands the places it shares with it, and what it inherits, at the same spots, and packs
//     only its own round them. Recorded for the earlier book by match, again whenever that book's terrain changed.
// A rerun of match keeps every override.
//
//   novel same-places match <novel-dir> [--work] [--dry]
//   novel same-places set <novel-dir> <place id> <book>:<place id>|new --why <text>
//   novel same-places show <novel-dir>
//   node engine/world/same-places.mjs canvas <novel-dir>
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { earlierCanvas, keysOf, recordOf, useKeysOf } from './universe-keys.mjs';

export { earlierCanvas, keysOf, useKeysOf };
import { basename, dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = file => readFile(file, 'utf8').then(JSON.parse).catch(() => null);
const bookOf = novelDir => basename(dirname(resolve(novelDir)));
const universeOf = novelDir => join(resolve(novelDir), '..', '..', 'universe');
const novelOf = (universe, book) => join(universe, '..', book, 'novel');
/** A book's place in the series: vol-2 is 2. */
export const bookNumber = book => Number(String(book).match(/(\d+)\s*$/)?.[1] ?? NaN);
/** How many sentences naming a place each side of the question shows. */
export const PASSAGE = 6;

/** A book's named places (its ontology's Locations): id → { label, names }. */
export async function placesOfBook(novelDir) {
  const text = await readFile(join(novelDir, 'ontology', 'entities.jsonl'), 'utf8').catch(() => '');
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const entity = JSON.parse(line);
    if (entity.kind !== 'Location') continue;
    const names = [...new Set((entity.names ?? []).map(name => (typeof name === 'string' ? name : name.text)).filter(Boolean))];
    if (names.length) out.set(entity.id, { label: names[0], names });
  }
  return out;
}

/** The books of the universe with places, in series order: the library's folders that hold a novel. */
async function booksOf(universe) {
  const { readdir } = await import('node:fs/promises');
  const entries = await readdir(join(universe, '..'), { withFileTypes: true }).catch(() => []);
  const books = [];
  for (const entry of entries) if (entry.isDirectory() && Number.isFinite(bookNumber(entry.name)) && await json(join(universe, '..', entry.name, 'novel', 'ontology', 'manifest.json'))) books.push(entry.name);
  return books.sort((a, b) => bookNumber(a) - bookNumber(b));
}

/** The work model's reading of one pair: where the earlier book names its place, where this book names its own. */
export async function workCheck(work, { earlier, here }) {
  const system = 'You compare two places named in two books of one series. Answer only as JSON {"same": true|false, "reason": "<one short sentence>"}.';
  const prompt = JSON.stringify({ task: 'same-place', question: 'Is the place named in the second book\'s lines the same place as the one named in the first book\'s lines (the same city, building or room of the story\'s world), not another place that happens to share a name?', first: earlier, second: here });
  const request = { system, prompt, jsonSchema: { type: 'object' }, maxTokens: 200 };
  let content = null;
  try { content = work.generateWithUsage ? (await work.generateWithUsage(request)).content : await work.generate(request); } catch { return null; }
  try { const body = JSON.parse(content ?? 'null'); return typeof body?.same === 'boolean' ? body : null; } catch { return null; }
}

/** The lines of a book that name a place, the first few. */
async function namingLines(novelDir, names) {
  const { loadWorkspaceSentences } = await import(pathToFileURL(join(repository, 'dist', 'src', 'cli', 'commands', 'extract', 'timeplaceCommands.js')).href);
  const sentences = [...(await loadWorkspaceSentences(novelDir)).values()];
  return sentences.filter(sentence => names.some(name => sentence.text?.includes(name))).slice(0, PASSAGE).map(sentence => sentence.text);
}

/**
 * Each named place of the book matched (pure): `here` this book's places, `earlier` the earlier books' places, latest book
 * first ({ book, id, key, names }); `checked(here, there)` the work model's answer where it was asked. A place takes the key
 * of the earlier place sharing the most names with it (the latest book on a tie) unless the answer refuses it; else it is new.
 */
export function decide({ book, here, earlier, checked = null, kept = {} }) {
  const out = {};
  for (const [id, place] of here) {
    if (kept[id]?.by === 'hand') { out[id] = kept[id]; continue; }
    const shared = earlier.map(there => ({ there, n: there.names.filter(name => place.names.includes(name)).length })).filter(entry => entry.n);
    shared.sort((a, b) => b.n - a.n || bookNumber(b.there.book) - bookNumber(a.there.book));
    const best = shared[0]?.there ?? null, answer = best && checked ? checked(id, best) : null;
    if (best && (!answer || answer.same))
      out[id] = { label: place.label, key: best.key, same: `${best.book}:${best.id}`, by: answer ? 'work' : 'names', why: answer?.reason ?? `shares the name ${place.names.find(name => best.names.includes(name))}` };
    else out[id] = { label: place.label, key: `${book}:${id}`, by: best ? 'work' : 'new', why: best ? `not ${best.book}:${best.id}: ${answer.reason ?? 'the work model reads another place'}` : 'no earlier book names it' };
  }
  return out;
}

/** `match`: the book's places beside the earlier books', each keyed; written to universe/places.json. */
export async function match(novelDir, { work = null, write = true } = {}) {
  const dir = resolve(novelDir), book = bookOf(dir), universe = universeOf(dir), record = await recordOf(universe);
  const books = (await booksOf(universe)).filter(other => bookNumber(other) < bookNumber(book));
  const here = await placesOfBook(dir);
  let entry;
  if (!books.length) entry = { at: new Date().toISOString(), first: true, places: {} };
  else {
    // The earlier books' places with their keys, the latest book first: a book not matched yet is keyed as it would be.
    const earlier = [];
    // The universe's first book is keyed by its ids (recorded so, if it was not yet); a later one not matched yet, under its book.
    if (!record.books?.[books[0]]) record.books[books[0]] = { at: new Date().toISOString(), first: true, places: {} };
    for (const other of [...books].reverse()) {
      const keys = record.books?.[other], places = await placesOfBook(novelOf(universe, other));
      for (const [id, place] of places) earlier.push({ book: other, id, key: keys?.first ? id : keys?.places?.[id]?.key ?? `${other}:${id}`, names: place.names });
    }
    let checked = null;
    if (work) {
      const answers = new Map(), linesOf = new Map();
      const lines = async (book, novel, id, names) => linesOf.get(`${book}|${id}`) ?? linesOf.set(`${book}|${id}`, await namingLines(novel, names)).get(`${book}|${id}`);
      const pairs = decide({ book, here, earlier, kept: record.books?.[book]?.places ?? {} });
      for (const [id, decided] of Object.entries(pairs)) {
        if (!decided.same || decided.by === 'hand') continue;
        const [otherBook, otherId] = [decided.same.slice(0, decided.same.indexOf(':')), decided.same.slice(decided.same.indexOf(':') + 1)];
        const there = earlier.find(entry => entry.book === otherBook && entry.id === otherId);
        answers.set(id, await workCheck(work, { earlier: await lines(otherBook, novelOf(universe, otherBook), otherId, there.names), here: await lines(book, dir, id, here.get(id).names) }));
      }
      checked = id => answers.get(id) ?? null;
    }
    entry = { at: new Date().toISOString(), last: books.at(-1), places: decide({ book, here, earlier, checked, kept: record.books?.[book]?.places ?? {} }) };
    // Where the earlier book's places stand (its world built alone): this book's shared and inherited places stand there.
    if (write) await freshCanvas(universe, books.at(-1));
  }
  if (write) { const now = await recordOf(universe); const merged = Object.fromEntries([...new Set([...Object.keys(record.books), ...Object.keys(now.books ?? {})])].map(other => [other, { ...(record.books[other] ?? {}), ...(now.books?.[other] ?? {}) }])); record.books = { ...merged, [book]: { ...(now.books?.[book]?.canvas ? { canvas: now.books[book].canvas } : {}), ...entry } }; await mkdir(universe, { recursive: true }); await writeFile(join(universe, 'places.json'), JSON.stringify(record, null, 1)); }
  return summary(book, entry);
}

/** The book's terrain as it stands (its canvas record is stale once it changed). */
const terrainDigest = async novelDir => createHash('sha256').update(await readFile(join(novelDir, 'stage', 'terrain.json')).catch(() => Buffer.alloc(0))).digest('hex').slice(0, 16);

/**
 * `canvas`: where each place of the book stands, built alone (worldOnly, no model asked): by key, its parent's key and its
 * spot in its parent's frame. Into universe/places.json under the book, with the digest of the terrain it was built on.
 */
export async function recordCanvas(novelDir) {
  const dir = resolve(novelDir), book = bookOf(dir), universe = universeOf(dir);
  const { strandDemo } = await import('./export-strand-demo.mjs'), K = await import(pathToFileURL(join(repository, 'dist', 'src', 'universe', 'placeKeys.js')).href);
  const script = await json(join(dir, 'stage', 'world', 'script.json')), ids = (script?.scenes ?? []).map(scene => scene.id);
  if (!ids.length) throw new Error(`${book}: no world script to build its world from`);
  const data = await strandDemo(dir, { from: ids[0], to: ids.at(-1), worldOnly: true, plain: true, title: 'canvas' });
  const node = new Map(data.macro.map(entry => [entry.id, entry])), places = {};
  for (const entry of data.macro) {
    if (String(entry.id).startsWith('spot:') || entry.temporary) continue;
    const parent = entry.parent ? node.get(entry.parent) : null;
    places[K.placeKey(entry.id)] = { parent: entry.parent ? K.placeKey(entry.parent) : null, at: [Math.round((entry.x - (parent?.x ?? 0)) * 10) / 10, Math.round((entry.z - (parent?.z ?? 0)) * 10) / 10] };
  }
  const record = await recordOf(universe);
  record.books[book] = { ...(record.books[book] ?? {}), canvas: { terrain: await terrainDigest(dir), at: new Date().toISOString(), places } };
  await mkdir(universe, { recursive: true }); await writeFile(join(universe, 'places.json'), JSON.stringify(record, null, 1));
  return { book, places: Object.keys(places).length };
}

/** The earlier book's canvas, made again in a process of its own (its own keys) when it is missing or its terrain changed. */
async function freshCanvas(universe, book) {
  const novel = novelOf(universe, book), kept = (await recordOf(universe)).books?.[book]?.canvas;
  // An earlier book with no terrain has no world to stand on: nothing to record.
  if (!(await readFile(join(novel, 'stage', 'terrain.json')).then(() => true, () => false))) return null;
  if (kept && kept.terrain === await terrainDigest(novel)) return kept;
  await new Promise((done, fail) => execFile(process.execPath, ['--max-old-space-size=8192', fileURLToPath(import.meta.url), 'canvas', novel], { maxBuffer: 1 << 26 }, error => (error ? fail(error) : done())));
  return (await recordOf(universe)).books?.[book]?.canvas ?? null;
}

/** `set`: one place made the same as an earlier book's (`vol-1:loc_000001`), or new, with why. */
export async function setPlace(novelDir, id, to, why) {
  const dir = resolve(novelDir), book = bookOf(dir), universe = universeOf(dir), record = await recordOf(universe), entry = record.books?.[book];
  if (!entry || entry.first) throw new Error(`${book}: ${entry?.first ? 'the universe\'s first book: its keys are its ids' : 'not matched yet (novel same-places match first)'}`);
  const place = (await placesOfBook(dir)).get(id);
  if (!place) throw new Error(`${book} has no named place ${id}`);
  if (to === 'new') entry.places[id] = { label: place.label, key: `${book}:${id}`, by: 'hand', why };
  else {
    const at = to.indexOf(':'), otherBook = to.slice(0, at), otherId = to.slice(at + 1), other = record.books?.[otherBook];
    if (at < 0 || !(await placesOfBook(novelOf(universe, otherBook))).has(otherId)) throw new Error(`no place ${to}: give <book>:<place id>`);
    const key = other?.first ? otherId : other?.places?.[otherId]?.key ?? `${otherBook}:${otherId}`;
    entry.places[id] = { label: place.label, key, same: to, by: 'hand', why };
  }
  await writeFile(join(universe, 'places.json'), JSON.stringify(record, null, 1));
  return { book, place: id, ...entry.places[id] };
}

/** `show`: the book's places with their keys. */
export async function show(novelDir) {
  const dir = resolve(novelDir), book = bookOf(dir), entry = (await recordOf(universeOf(dir))).books?.[book];
  return entry ? { ...summary(book, entry), places: entry.places } : { book, note: 'not matched yet' };
}

function summary(book, entry) {
  if (entry.first) return { book, first: true, note: 'the universe\'s first book: every key is the place\'s id' };
  const places = Object.entries(entry.places), same = places.filter(([, place]) => place.same);
  return { book, last: entry.last, places: places.length, same: same.length, new: places.length - same.length, matched: same.map(([id, place]) => `${id} ${place.label} = ${place.same} (${place.by}: ${place.why})`) };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { values, positionals: [command, novelDir, ...rest] } = parseArgs({ allowPositionals: true, options: { work: { type: 'boolean' }, dry: { type: 'boolean' }, why: { type: 'string' } } });
  if (!novelDir) throw new Error('Usage: same-places.mjs match <novel-dir> [--work] [--dry] | set <novel-dir> <place id> <book>:<place id>|new --why <text> | show <novel-dir>');
  let out;
  if (command === 'match') {
    let work = null;
    if (values.work) { const { workModelFromEnv } = await import(pathToFileURL(join(repository, 'dist', 'src', 'ground', 'connectors', 'workModel.js')).href); work = workModelFromEnv(process.env); }
    out = await match(novelDir, { work, write: !values.dry });
  } else if (command === 'set') {
    if (!rest[0] || !rest[1] || !values.why) throw new Error('Usage: same-places.mjs set <novel-dir> <place id> <book>:<place id>|new --why <text>');
    out = await setPlace(novelDir, rest[0], rest[1], values.why);
  } else if (command === 'canvas') out = await recordCanvas(novelDir);
  else out = await show(novelDir);
  console.log(JSON.stringify(out, null, 1));
}
