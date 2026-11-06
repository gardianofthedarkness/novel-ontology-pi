// The underground note on each place (docs/v2/terrain-levels.md §8.5; world-engine/digest/underground-note.mjs), as a
// reading step. Free: it asks nothing, it gathers the set dresser's settings (settings.json) and, where made, the pre-film
// notes' underground facts (prefilm.json) by the world script's places. Run it after the set dresser and before the
// terrain loop, which opens its underground slices to a noted city or district. Writes <reading>/underground-notes.json.
//
// A library keeps the reading twice: --also writes the same notes beside another copy (the reading step's own output,
// which the terrain loop reads by the book's manifest).
//
//   node experiments/v2/underground-notes.mjs <novel-dir> <reading>/data.json [--also <other data.json>] [--dry]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { factsOf, undergroundNotes } from '../../world-engine/digest/underground-note.mjs';

const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { dry: { type: 'boolean' }, also: { type: 'string', multiple: true } } });
if (!novelDir || !readingPath) { console.error('usage: node experiments/v2/underground-notes.mjs <novel-dir> <reading>/data.json [--dry]'); process.exit(2); }
const dir = dirname(resolve(readingPath)), json = path => readFile(path, 'utf8').then(JSON.parse).catch(() => null);
const script = await json(join(resolve(novelDir), 'stage', 'world', 'script.json'));
if (!script) { console.error('no world script (stage/world/script.json) in the novel'); process.exit(1); }
const settings = (await json(join(dir, 'settings.json')))?.units ?? {}, prefilm = await json(join(dir, 'prefilm.json'));
const notes = undergroundNotes({ script, settings, facts: factsOf(prefilm) });
const out = { version: 1, at: new Date().toISOString(), from: { settings: Object.keys(settings).length, prefilm: !!prefilm }, ...notes };
if (!values.dry) for (const at of [dir, ...(values.also ?? []).map(path => dirname(resolve(path)))]) await writeFile(join(at, 'underground-notes.json'), JSON.stringify(out, null, 1));
console.log(JSON.stringify({ places: Object.keys(notes.places).length, noted: notes.noted.length, evidence: Object.entries(notes.places).filter(([, note]) => note.underground?.length).map(([id, note]) => ({ id, scale: script.places?.[id]?.scale ?? null, units: note.units, underground: note.underground.length, share: note.share, noted: note.noted })) }));
