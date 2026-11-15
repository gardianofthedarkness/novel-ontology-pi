// A book's universe keys and where the earlier book's world stood its places, for the terrain step and the export
// (src/universe/placeKeys.ts; written by engine/world/same-places.mjs into universe/places.json). Loaders only, no command:
// the export loads them while same-places builds a world.
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = file => readFile(file, 'utf8').then(JSON.parse).catch(() => null);
const bookOf = novelDir => basename(dirname(resolve(novelDir)));
const universeOf = novelDir => join(resolve(novelDir), '..', '..', 'universe');

/** The record (universe/places.json): per book, each place's key and how it was decided. */
export async function recordOf(universe) {
  return (await json(join(universe, 'places.json'))) ?? { version: 1, books: {} };
}

/**
 * A book's keys (place id → key) for src/universe/placeKeys.ts `usePlaceKeys`, or null where every key is the id: the
 * universe's first book, a book not matched yet, or a library made before keys.
 */
export async function keysOf(novelDir) {
  const dir = resolve(novelDir), book = bookOf(dir), entry = (await recordOf(universeOf(dir))).books?.[book];
  if (!entry || entry.first) return null;
  return Object.fromEntries(Object.entries(entry.places ?? {}).map(([id, place]) => [id, place.key]));
}

/** Loads a book's keys into the shared module (dist): the terrain step and the export call it before building. */
export async function useKeysOf(novelDir) {
  const { usePlaceKeys } = await import(pathToFileURL(join(repository, 'dist', 'src', 'universe', 'placeKeys.js')).href);
  const keys = await keysOf(novelDir);
  usePlaceKeys(keys, keys ? bookOf(novelDir) : null);
  return keys;
}

/**
 * Where this book's places stand by the earlier book's world: key → { parent, at } (the parent's key; the spot in its frame),
 * or null for the first book. The export stands a place here when its parent's key is the same (src/world/built/placeCanvas.ts).
 */
export async function earlierCanvas(novelDir) {
  const dir = resolve(novelDir), record = await recordOf(universeOf(dir)), last = record.books?.[bookOf(dir)]?.last;
  return last ? record.books?.[last]?.canvas?.places ?? null : null;
}
