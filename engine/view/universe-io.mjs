// The universe view, static (the user, 2026-11-14: "each universe get a universal link that has both volumes strand views
// together in one universal calendar"): one page over every book of a universe whose public replay (replay-io.mjs) sits in
// the site's folder by the book's name, their units on one story clock, a lane per strand, the carry's decisions across the
// books' edges (universe/strands.json). A unit tapped opens its book's World · Live there (?unit=…&universe=../).
//
// Read from the books' public replays only (their live.json and reading.json, already without any sentence of the books)
// (and review.json for the run's id) and from the universe's strand registry (keys and decisions, never the reasons' words); refused like a replay if anything
// sentence-like would be published.
//
//   node engine/view/universe-io.mjs <library> <site-dir> [--title "…"] [--keep-text]
//     --keep-text: over private replays (replay-io --keep-text), not checked for text; refused inside a git checkout.
//     <site-dir>/<book>/ for each book: node engine/view/replay-io.mjs <library>/<book>/novel <metadata-dir> <site-dir>/<book>
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inCheckout, refuse } from './replay-io.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = path => readFile(path, 'utf8').then(JSON.parse);
const CJK_RUN = /[\u3040-\u30ff\u3400-\u9fff\uf900-\ufaff]+/g, NAME_MOST = 12;

/** A book's id as a reader names it: vol-2 → Vol 2. */
export const bookLabel = book => String(book).replace(/[-_]+/g, ' ').replace(/^\w/, c => c.toUpperCase());

/**
 * The page's data for the books (pure): each one's units in told order as [unit, strand, story time, people], the names of
 * the people, its strands as the registry keeps them; the carry's decisions without their words.
 */
export function universeData({ title, books, registry }) {
  const strip = id => String(id ?? '').replace(/^scene_/, '');
  const out = { title, books: [], decisions: {} };
  for (const { book, live, reading, run = null } of books) {
    const director = live.world?.notes?.director;
    if (!director) throw new Error(`${book}: its replay has no director run`);
    const people = new Map();
    for (const card of director.cards ?? []) {
      const seen = people.get(card.scene) ?? people.set(card.scene, new Map()).get(card.scene);
      for (const item of [...(card.moves ?? []), ...(card.lines ?? [])]) if (item.who && !String(item.who).startsWith('crowd')) seen.set(item.who, (seen.get(item.who) ?? 0) + 1);
    }
    let last = null;
    const units = (director.units ?? []).map(unit => {
      if (unit.when) last = unit.when;
      const who = [...(people.get(unit.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1]).slice(0, 4).map(([id]) => id);
      const when = unit.when ? unit.when.replace(/^t:/, '') : last ? `~${last.replace(/^t:/, '')}` : null;
      return [strip(unit.id), strip(unit.fork), when, who];
    });
    const names = {};
    for (const id of new Set(units.flatMap(unit => unit[3]))) names[id] = reading?.names?.[id]?.[0] ?? id;
    const strands = registry?.books?.[book]?.strands?.map(strand => ({ key: strand.key, ...(strand.into ? { into: strand.into } : {}) })) ?? null;
    out.books.push({ book, label: bookLabel(book), run, units, names, strands });
  }
  const here = new Set(books.map(entry => entry.book));
  for (const [book, list] of Object.entries(registry?.decisions ?? {})) if (here.has(book)) out.decisions[book] = list.map(({ candidate, inherited, into, by }) => ({ candidate, inherited: !!inherited, into: into ?? null, by: by ?? null }));
  return out;
}

/** The universe page written to <site-dir>/index.html over the books whose replays are there, in the registry's order. */
export async function universeIo(library, siteDir, { title = 'Universe', keepText = false } = {}) {
  if (keepText && inCheckout(siteDir)) throw new Error(`${siteDir} is in a git checkout: a private universe page never goes there`);
  const universe = join(resolve(library), 'universe');
  const registry = await json(join(universe, 'strands.json')).catch(() => null);
  const places = await json(join(universe, 'places.json')).catch(() => null);
  const order = [...new Set([...Object.keys(registry?.books ?? {}), ...Object.keys(places?.books ?? {})])];
  const books = [];
  for (const book of order) {
    const dir = join(resolve(siteDir), book);
    if (!existsSync(join(dir, 'live.json'))) continue;
    books.push({ book, live: await json(join(dir, 'live.json')), reading: await json(join(dir, 'reading.json')).catch(() => null), run: (await json(join(dir, 'review.json')).catch(() => null))?.run ?? null });
  }
  if (!books.length) throw new Error(`No book of the universe has a replay in ${siteDir}`);
  const data = universeData({ title, books, registry });
  const template = await readFile(join(repository, 'engine', 'view', 'universe-strands.html'), 'utf8');
  const titleText = String(title).replace(/[<&]/g, '');
  const DATA_LINE = 'const DATA = __DATA__;';
  if (template.split(DATA_LINE).length !== 2) throw new Error('universe-strands.html: no one data line to fill');
  const page = template.split('__TITLE__').join(titleText).replace(DATA_LINE, () => `const DATA = ${JSON.stringify(data).replace(/</g, '\\u003c')};`);
  if (!keepText) {
    refuse('index.html', page);
    const long = (page.match(CJK_RUN) ?? []).find(run => run.length > NAME_MOST && run !== titleText);
    if (long) throw new Error(`index.html: a run of ${long.length} CJK characters would be published`);
  }
  await writeFile(join(resolve(siteDir), 'index.html'), page);
  return { books: data.books.map(book => ({ book: book.book, run: book.run, units: book.units.length })), carried: Object.values(data.decisions).flat().filter(d => d.inherited).length, kilobytes: Math.round(page.length / 1024) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [library, siteDir] } = parseArgs({ allowPositionals: true, options: { title: { type: 'string' }, 'keep-text': { type: 'boolean' } } });
  if (!library || !siteDir) { console.error('usage: node engine/view/universe-io.mjs <library> <site-dir> [--title "..."]'); process.exit(2); }
  console.log(JSON.stringify(await universeIo(library, siteDir, { title: values.title ?? 'Universe', keepText: !!values['keep-text'] })));
}
