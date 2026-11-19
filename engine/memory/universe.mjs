// A world's memories as one graph (docs/v3/design.html §10.1 and #universal-em; the user, 2026-11-19: "Fix memory
// first"). Each book's memory pass keeps the book's own ids (novel/ontology/memories.jsonl); here they meet:
//   people       a holder, a teller and a cue that is a character become the person of the universe cast
//                (engine/universe/cast.mjs), so Index of volume 6 remembers what Index of volume 1 lived through.
//   everything   else (places, things, ideas) keeps its book: <book>/<id>, as two books' loc_000002 are not one place.
//   order        one story order across the books: a book's scenes follow the books before it (scene 1 of volume 2 is
//                278 + 1 after volume 1's 278), so retention and the recall wall run across books.
//   time         each scene's story day, from the reading's calendar (reading/time.yaml: a scene's periods, each with
//                its span in minutes); a scene with none (or a flashback) keeps the day before it; a book never starts
//                before the last one ended. Memories age in story days (the user, 2026-11-19: "Age by story time"):
//                volumes 1-6 are July 19 to September 1, six weeks, not 1,800 scenes. The wall stays on story order.
//   paratext     memories of an afterword or the credits are left out (engine/reading/paratext.mjs).
// The graph is a cache: built in a folder named for what it was built from, so a changed memory file builds a new one.
import { createHash } from 'node:crypto';
import { existsSync, statSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = (path) => import(pathToFileURL(join(repository, path)).href);
const lines = async (file) => existsSync(file) ? (await readFile(file, 'utf8')).split(/\r?\n/).filter(Boolean).map((l) => JSON.parse(l)) : [];
const latest = (rows) => [...new Map(rows.map((r) => [r.id, r])).values()];
const KINDS = new Set(['Location', 'Item', 'Concept', 'Organization']);
const DAY = 1440;
/**
 * Recall on story days. tau0 is a week: real-life events fade over months to years, not days (Linton's diary study lost
 * about 5% of logged events a year); a calm memory is at 0.6 after two weeks, 0.37 after a month, with the power law's
 * long tail, and an arousing one's tau is up to four times longer (consolidation, set when it forms). A tau0 of one day
 * was tried first and left volume 1 at 0.2 by volume 6 (six weeks), out of reach of any cue. The felt arousal fades
 * over months (tauFelt 30 days): by six weeks a memory's charge is about three quarters of what it was.
 */
export const TIME_WEIGHTS = { tau0: 7, tauFelt: 30, dFelt: 0.3 };

/** Each scene's story time in minutes from the reading's time file (null where the reading has none). */
export function sceneMinutes(timeYaml, sceneIds) {
  const scenesPart = timeYaml.slice(timeYaml.indexOf('\nscenes:'), timeYaml.indexOf('\ntree:'));
  const calendarPart = timeYaml.slice(timeYaml.indexOf('\ncalendar:'));
  const start = new Map();
  for (const entry of calendarPart.split(/\n\s*- ref: /).slice(1)) {
    const id = entry.match(/\n\s*timeId: (\S+)/)?.[1], s = entry.match(/\n\s*span:\s*\n\s*start: (-?\d+)/)?.[1];
    if (id && s !== undefined) start.set(id, Number(s));
  }
  const byScene = new Map();
  for (const block of scenesPart.split(/\n\s*- scene: /).slice(1)) {
    const id = block.match(/^(\S+)/)?.[1], periods = (block.match(/\n\s*periods: \[([^\]]*)\]/)?.[1] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
    const flashback = /\n\s*flashback: true/.test(block), times = periods.map((x) => start.get(x)).filter((x) => x !== undefined);
    byScene.set(id, flashback || !times.length ? null : Math.min(...times));
  }
  return sceneIds.map((id) => byScene.get(id) ?? null);
}

/** Each scene's place on the story's clock as the reading wrote it (t:year:month-day:time), or null. */
export function sceneNodes(timeYaml, sceneIds) {
  const scenesPart = timeYaml.slice(timeYaml.indexOf('\nscenes:'), timeYaml.indexOf('\ntree:')), byScene = new Map();
  for (const block of scenesPart.split(/\n\s*- scene: /).slice(1)) { const id = block.match(/^(\S+)/)?.[1], node = block.match(/\n\s*node: (\S+)/)?.[1]; byScene.set(id, node && node !== 'null' ? node : null); }
  return sceneIds.map((id) => byScene.get(id) ?? null);
}

/** Minutes per scene made whole: a gap keeps the time before it (the first ones take the first known), never going back. */
export function fillTimes(raw, notBefore = 0) {
  const first = raw.find((x) => x !== null) ?? notBefore, out = [];
  let last = Math.max(notBefore, first);
  for (const x of raw) { if (x !== null && x > last) last = x; out.push(last); }
  return out;
}

/** The world's books in the job's order, each with its folder, its scenes and where its story order starts. */
export async function booksOf(libraryDir) {
  const library = resolve(libraryDir), job = JSON.parse(await readFile(join(library, 'job.json'), 'utf8'));
  const out = [];
  let offset = 0, until = 0;
  for (const v of job.volumes) {
    const book = dirname(resolve(v.workspace)).split(/[\\/]/).at(-1), dir = join(library, book), dataFile = join(dir, 'reading', 'data.json');
    if (!existsSync(dataFile)) break; // a book not read yet: the order stops here
    const ids = JSON.parse(await readFile(dataFile, 'utf8')).scenes.map((s) => s.id), scenes = ids.length;
    const pt = join(dir, 'reading', 'paratext.json'), tf = join(dir, 'reading', 'time.yaml');
    const timeYaml = existsSync(tf) ? await readFile(tf, 'utf8') : null;
    const raw = timeYaml ? sceneMinutes(timeYaml, ids) : ids.map(() => null), nodes = timeYaml ? sceneNodes(timeYaml, ids) : ids.map(() => null);
    // A book whose own clock starts before the last one ended is moved after it (one story, told in order).
    const firstKnown = raw.find((x) => x !== null), shift = firstKnown !== undefined && firstKnown < until ? until - firstKnown : 0;
    const minutes = fillTimes(raw.map((x) => (x === null ? null : x + shift)), until);
    out.push({ book, dir, scenes, offset, ids, nodes, days: minutes.map((m) => m / DAY), paratext: new Set(existsSync(pt) ? JSON.parse(await readFile(pt, 'utf8')).paratext : []) });
    offset += scenes; until = minutes.at(-1) ?? until;
  }
  return out;
}

/** "vol-6" (its end) or "vol-6:120" (its 120th scene) as one story order. */
export function storyPoint(books, at) {
  const [book, scene] = String(at).split(':'), b = books.find((x) => x.book === book);
  if (!b) throw new Error(`no book ${book} (read: ${books.map((x) => x.book).join(', ')})`);
  return b.offset + (scene ? Math.min(Number(scene), b.scenes) : b.scenes);
}
/** The story day at an order (the day of that scene). */
export function storyDay(books, order) {
  const b = books.findLast((x) => order > x.offset) ?? books[0];
  return b.days[Math.max(0, Math.min(b.scenes, order - b.offset) - 1)] ?? 0;
}

/** Everything the graph holds, mapped onto the universe: people, the other entries, the memories. */
export async function universeMemories(libraryDir) {
  const library = resolve(libraryDir), books = await booksOf(library);
  const cast = JSON.parse(await readFile(join(library, 'universe', 'cast.json'), 'utf8'));
  const personOf = new Map(cast.persons.flatMap((p) => p.members.map((m) => [`${m.book}/${m.entity}`, p.id])));
  const things = [], memories = [], skipped = { paratext: 0, noPerson: 0 }, files = {}, called = new Map();
  for (const b of books) {
    const onto = join(b.dir, 'novel', 'ontology');
    for (const e of latest(await lines(join(onto, 'entities.jsonl')))) {
      if (KINDS.has(e.kind)) things.push({ id: `${b.book}/${e.id}`, kind: e.kind, name: e.names?.[0]?.text ?? e.id, forms: (e.names ?? []).map((n) => n.text).filter(Boolean) });
      // What each book's reading calls a person (its canonical name), counted across the books, names the person.
      const person = e.kind === 'Character' && personOf.get(`${b.book}/${e.id}`), canonical = e.names?.find((n) => n.kind === 'canonical')?.text;
      if (person && canonical) { const c = called.get(person) ?? new Map(); c.set(canonical, (c.get(canonical) ?? 0) + 1); called.set(person, c); }
    }
    const file = join(onto, 'memories.jsonl');
    if (!existsSync(file)) continue;
    files[b.book] = `${statSync(file).size}:${statSync(file).mtimeMs}`;
    const map = (id) => personOf.get(`${b.book}/${id}`) ?? (String(id).startsWith('char_') ? null : `${b.book}/${id}`);
    for (const m of await lines(file)) {
      if (m.scene && b.paratext.has(m.scene)) { skipped.paratext++; continue; }
      const holder = personOf.get(`${b.book}/${m.holderId}`);
      if (!holder) { skipped.noPerson++; continue; }
      const heard = m.heardFromId ? personOf.get(`${b.book}/${m.heardFromId}`) : undefined;
      memories.push({ ...m, id: `${b.book}/${m.id}`, book: b.book, holderId: holder, atOrder: m.atOrder + b.offset, learnedOrder: m.learnedOrder + b.offset,
        learnedTime: b.days[Math.max(0, m.learnedOrder - 1)] ?? 0,
        cues: [...new Set((m.cues ?? []).map(map).filter((c) => c && c !== holder))], ...(heard && heard !== holder ? { heardFromId: heard } : { heardFromId: undefined }) });
    }
  }
  const nameOf = (p) => [...(called.get(p.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? p.label;
  const people = cast.persons.map((p) => ({ id: p.id, name: nameOf(p), forms: p.forms }));
  return { library, books, cast, people, things, memories, skipped, files };
}

/** The graph for the world's memories as they are now: built once per set of memory files, then reused. */
export async function universeGraph(libraryDir) {
  const u = await universeMemories(libraryDir);
  const key = createHash('sha256').update(JSON.stringify(['index-2-time', u.files, statSync(join(u.library, 'universe', 'cast.json')).mtimeMs])).digest('hex').slice(0, 12);
  const dir = join(u.library, 'universe', 'memory-graph', key), file = join(dir, 'memory.lbug'), fresh = !existsSync(file);
  await mkdir(dir, { recursive: true });
  const { LadybugStore } = await load('dist/src/ground/connectors/ladybug.js'), { indexMemories } = await load('dist/src/ground/ontology/memory.js');
  const store = new LadybugStore(file), run = (c, p) => store.run(c, p);
  await store.initSchema();
  if (fresh) {
    const t = Date.now();
    for (const p of u.people) await run('CREATE (:Character {id: $id, canonical_name: $name})', { id: p.id, name: p.name });
    for (const e of u.things) await run(`CREATE (:${e.kind} {id: $id, canonical_name: $name})`, { id: e.id, name: e.name });
    await indexMemories(run, u.memories);
    await writeFile(join(dir, 'built.json'), JSON.stringify({ books: u.files, memories: u.memories.length, skipped: u.skipped, ms: Date.now() - t }, null, 1));
  }
  // A cue is any person, place or thing of the world named in a text (two characters or more).
  const named = [...u.people, ...u.things].flatMap((e) => e.forms.filter((f) => f && f.length >= 2).map((f) => [f, e.id]));
  const cuesOf = (text) => [...new Set(named.filter(([f]) => text.includes(f)).map(([, id]) => id))];
  const nameOf = (id) => [...u.people, ...u.things].find((e) => e.id === id)?.name ?? id;
  return { ...u, dir, store, run, fresh, cuesOf, nameOf, close: () => store.close() };
}

/** A person by id, or by a name any book gave them (the one with the most memories when several share it). */
export function findPerson(u, query) {
  const hits = u.people.filter((p) => p.id === query || p.forms.includes(query));
  if (!hits.length) throw new Error(`no person ${query}`);
  const count = (p) => u.memories.filter((m) => m.holderId === p.id).length;
  return hits.sort((a, b) => count(b) - count(a))[0];
}
