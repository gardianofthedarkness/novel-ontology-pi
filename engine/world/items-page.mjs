// A book's page with its items as the page keeps them now (engine/world/items.mjs): a page written before the rule rebuilt
// from the run's record of item events; each kept item drawn as its routine shelf model, and an item the sort found is not
// an object left off, as the book's bindings name them (novel model shelf: stage/models/items.json). One way for the
// director's pages, the volume's `items` step and the replay export.
//
//   node engine/world/items-page.mjs <novel-dir>   (the run's live page, stage/simulation/live/page.json, rewritten)
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { bindItemModels, itemsOnPage } from './items.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = path => readFile(path, 'utf8').then(JSON.parse).catch(() => null);

/** The book's item models by item name: { id, mesh } for one on the shelf, { hide: true } for one that is not an object. */
export async function itemModelsOf(novelDir) {
  const bound = await json(join(novelDir, 'stage', 'models', 'items.json')), models = new Map();
  if (!bound?.items) return models;
  const { PACKS_ROOT } = await import(pathToFileURL(join(repository, 'dist', 'src', 'world', 'models', 'warehouse.js')).href);
  const { meshOf, shelfDir } = await import(pathToFileURL(join(repository, 'dist', 'src', 'world', 'models', 'shelf.js')).href);
  for (const [name, { ref, object }] of Object.entries(bound.items)) {
    if (object === false) { models.set(name, { hide: true }); continue; }
    const slug = String(ref ?? '').match(/^routine:(.+)$/)?.[1], mesh = slug ? meshOf(shelfDir(PACKS_ROOT), slug) : null;
    if (mesh) models.set(name, { id: `routine_${slug}`, mesh });
  }
  return models;
}

/** The page with its items handled (a new object; the page given is not changed). */
export async function withItems(page, novelDir) {
  let things = page.things ?? [];
  if (!things.some(thing => thing.holds)) {
    const runItems = (await json(join(novelDir, 'stage', 'director', 'run.json')))?.items;
    if (runItems) things = itemsOnPage(things, runItems, page.scenes ?? []).things;
  }
  const made = bindItemModels(things, await itemModelsOf(novelDir));
  return { ...page, things: made.things, ...(Object.keys(made.scadModels).length ? { scadModels: { ...(page.scadModels ?? {}), ...made.scadModels } } : {}) };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [novelDir] = process.argv.slice(2);
  if (!novelDir) { console.error('usage: node engine/world/items-page.mjs <novel-dir>'); process.exit(2); }
  const file = join(resolve(novelDir), 'stage', 'simulation', 'live', 'page.json'), page = await json(file);
  if (!page) { console.error(`no page at ${file}`); process.exit(1); }
  const out = await withItems(page, resolve(novelDir)), items = out.things.filter(thing => thing.holds);
  await writeFile(file, JSON.stringify(out));
  console.log(JSON.stringify({ page: file, items: items.length, withModels: items.filter(thing => String(thing.model ?? '').startsWith('scad:routine_')).length, left: (page.things ?? []).length - out.things.length }));
}
