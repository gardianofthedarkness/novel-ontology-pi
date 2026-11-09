// The strand builder bound for a book (docs/v2/strands.md; milestones M17a): the TypeScript builder (groupStrands,
// strandsDocument), the book's envelope scale (the setting strands.envelope, a district by default) and the built
// world's place tree, read from the terrain registry: where the engine built a place the text left "somewhere in the
// city". One binding for the director, the pre-film casts, why-walk and the book's own strands file, so every reader of
// strands is handed the same ones. Reads the book's stage/terrain.json (its copy of the registry), else the universe's.
import { readFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { builtTree, groupStrands, strandsDocument } from '../../dist/src/v2/extraction/strands.js';
import { setting } from '../../dist/src/v2/settings.js';

const json = file => readFile(file, 'utf8').then(JSON.parse).catch(() => null);

/** What segments.mjs strandsFile takes: { groupStrands, strandsDocument, envelope, tree } for the book in `novelDir`. */
export async function strandBuilder(novelDir, { envelope = null } = {}) {
  const dir = resolve(novelDir), volume = basename(dirname(dir));
  const terrain = (await json(join(dir, 'stage', 'terrain.json'))) ?? (await json(join(dir, '..', '..', 'universe', 'terrain.json')));
  return { groupStrands, strandsDocument, envelope: envelope ?? setting('strands.envelope', { book: dir }), tree: builtTree(terrain?.slots, terrain?.book ?? volume) };
}
