// A library made before snapshots (the user, 2026-11-05: "rerunning a previous volume returns to the snapshot before that
// volume to recover clean status"), given its first snapshots the v1 way: what its runs wrote is taken out of the canon by
// the canon's own log (canon.mjs undoCanon), the runs' outputs are set aside, and that clean state is each book's `before`;
// then the library is put back as it was found and that is recorded as the state after its last run. Nothing is lost: the
// state as found is the first snapshot (a guard), and restoring is how it is put back.
//
//   node world-engine/library/adopt.mjs <library-dir> [--why <text>]
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { undoCanon } from '../review/canon.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const universe = () => import(pathToFileURL(join(repository, 'dist', 'src', 'ground', 'workspace', 'universe.js')).href);

/** A run's outputs in a book (what the director and the review write per run): set aside for the clean state. */
export const RUN_OUTPUTS = ['stage/director/run.json', 'stage/director/laws.json', 'stage/director/reading.json', 'stage/director/reading-path.json', 'stage/world/pins.json', 'stage/world/speakers.json', 'stage/world/pool.jsonl', 'stage/world/answers.jsonl', 'stage/world/canon.jsonl'];

/** Adopt `root`: guard (as found) → clean `before` per book → restored as found → `after` its last run. */
export async function adopt(root, { why = 'adopted' } = {}) {
  const U = await universe(), paths = U.libraryPaths(root);
  if ((await U.readIndex(root)).snapshots.length) throw new Error(`${paths.root} has snapshots already`);
  const states = await U.bookStates(root), books = Object.keys(states);
  if (!books.length) throw new Error(`${paths.root} has no books (vol-<n>/novel)`);
  const found = await U.takeSnapshot(root, { book: null, kind: 'guard', why: `${why}: the library as found` });
  // The clean state: each book's runs taken out of its canon, the runs' outputs and the review's set aside, the run index emptied.
  const undone = {};
  for (const book of books) {
    const novel = paths.book(book).novel;
    undone[book] = {};
    for (const run of [...states[book].canon].reverse()) undone[book][run] = (await undoCanon(novel, { run })).undone;
  }
  const cleanFiles = new Set();
  for (const book of books) {
    const novel = paths.book(book).novel;
    for (const rel of RUN_OUTPUTS) if (existsSync(join(novel, rel))) cleanFiles.add(`${book}/novel/${rel}`);
    for (const rel of Object.keys(found.files)) if (rel.startsWith(`${book}/novel/stage/world/batches/`)) cleanFiles.add(rel);
    const index = paths.book(book).simulation.index;
    if (existsSync(index)) { const value = JSON.parse(await readFile(index, 'utf8')); if (value.strands?.director) { value.strands.director = { ...value.strands.director, runs: [], accepted: null }; await writeFile(index, JSON.stringify(value, null, 1)); } }
  }
  const { unlink } = await import('node:fs/promises');
  for (const rel of cleanFiles) await unlink(join(paths.root, rel)).catch(() => {});
  const befores = [];
  for (const book of books) befores.push(await U.takeSnapshot(root, { book, kind: 'before', why: `${why}: runs ${Object.keys(undone[book]).join(', ') || 'none'} taken out of the canon (${Object.values(undone[book]).reduce((n, k) => n + k, 0)} writes), their outputs set aside` }));
  // Back as found, recorded as the state after each book's last run.
  const restored = await U.restoreSnapshot(root, found.id, { why: `${why}: back as found`, graph: false });
  const afters = [];
  for (const [k, book] of books.entries()) afters.push(await U.takeSnapshot(root, { book, kind: 'after', run: states[book].accepted, parent: befores[k].id, why: `${why}: the state its last run left` }));
  return { found: found.id, before: befores.map(entry => entry.id), after: afters.map(entry => entry.id), undone, setAside: [...cleanFiles].length, restoredWritten: restored.written, restoredRemoved: restored.removed };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [root] } = parseArgs({ allowPositionals: true, options: { why: { type: 'string' } } });
  if (!root) { console.error('usage: node world-engine/library/adopt.mjs <library-dir> [--why <text>]'); process.exit(2); }
  console.log(JSON.stringify(await adopt(resolve(root), { why: values.why ?? 'adopted' }), null, 1));
}
