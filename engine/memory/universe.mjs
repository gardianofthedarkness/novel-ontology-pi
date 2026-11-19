// A world's memories as one graph (docs/v3/design.html §10.1 and #universal-em; the user, 2026-11-19: "Fix memory
// first"). Each book's memory pass keeps the book's own ids (novel/ontology/memories.jsonl); here they meet:
//   people       a holder, a teller and a cue that is a character become the person of the universe cast
//                (engine/universe/cast.mjs), so Index of volume 6 remembers what Index of volume 1 lived through.
//   everything   else (places, things, ideas) keeps its book: <book>/<id>, as two books' loc_000002 are not one place.
//   order        one story order across the books: a book's scenes follow the books before it (scene 1 of volume 2 is
//                278 + 1 after volume 1's 278), so retention and the recall wall run across books.
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

/** The world's books in the job's order, each with its folder, its scenes and where its story order starts. */
export async function booksOf(libraryDir) {
  const library = resolve(libraryDir), job = JSON.parse(await readFile(join(library, 'job.json'), 'utf8'));
  const out = [];
  let offset = 0;
  for (const v of job.volumes) {
    const book = dirname(resolve(v.workspace)).split(/[\\/]/).at(-1), dir = join(library, book), dataFile = join(dir, 'reading', 'data.json');
    if (!existsSync(dataFile)) break; // a book not read yet: the order stops here
    const scenes = JSON.parse(await readFile(dataFile, 'utf8')).scenes.length;
    const pt = join(dir, 'reading', 'paratext.json');
    out.push({ book, dir, scenes, offset, paratext: new Set(existsSync(pt) ? JSON.parse(await readFile(pt, 'utf8')).paratext : []) });
    offset += scenes;
  }
  return out;
}

/** "vol-6" (its end) or "vol-6:120" (its 120th scene) as one story order. */
export function storyPoint(books, at) {
  const [book, scene] = String(at).split(':'), b = books.find((x) => x.book === book);
  if (!b) throw new Error(`no book ${book} (read: ${books.map((x) => x.book).join(', ')})`);
  return b.offset + (scene ? Math.min(Number(scene), b.scenes) : b.scenes);
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
        cues: [...new Set((m.cues ?? []).map(map).filter((c) => c && c !== holder))], ...(heard && heard !== holder ? { heardFromId: heard } : { heardFromId: undefined }) });
    }
  }
  const nameOf = (p) => [...(called.get(p.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0]?.[0] ?? p.label;
  const people = cast.persons.map((p) => ({ id: p.id, name: nameOf(p), forms: p.forms }));
  return { library, books, people, things, memories, skipped, files };
}

/** The graph for the world's memories as they are now: built once per set of memory files, then reused. */
export async function universeGraph(libraryDir) {
  const u = await universeMemories(libraryDir);
  const key = createHash('sha256').update(JSON.stringify([u.files, statSync(join(u.library, 'universe', 'cast.json')).mtimeMs])).digest('hex').slice(0, 12);
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
