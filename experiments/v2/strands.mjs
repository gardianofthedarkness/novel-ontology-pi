// Story strands of a v2 book (src/v2/extraction/strands.ts groupStrands; docs/v2/strands.md; the user, 2026-11-09: "a
// timeline performed by a group of people in a limited, enveloping area"): a strand is a group, its envelope and its
// stretch of story time; a sub-group told in another envelope splits off, groups the text has together unite. The same
// builder the director plays (segments.mjs strandsFile), bound for the book by strand-builder.mjs: the envelope scale is
// the setting strands.envelope, and the built world's place tree comes from the book's terrain registry. No model call.
// Writes <novel>/stage/world/strands.json (what spawning reads) and prints a summary.
//   npm run build && node experiments/v2/strands.mjs <novel-dir> [--time <reading>/v2/time.yaml] [--envelope <scale>] [--dry]
// --time: a script from before scenes kept their node on the time tree takes it from the reading's story time.
// --envelope: try another scale than the book's setting; --dry: print only, write nothing.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { strandBuilder } from '../../world-engine/director/strand-builder.mjs';

const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { time: { type: 'string' }, envelope: { type: 'string' }, dry: { type: 'boolean' } } });
if (!novelDir) { console.error('usage: node experiments/v2/strands.mjs <novel-dir> [--time <time.yaml>] [--envelope <scale>] [--dry]'); process.exit(2); }

const dir = resolve(novelDir), script = JSON.parse(await readFile(join(dir, 'stage', 'world', 'script.json'), 'utf8'));
if (values.time) {
  // The reading's scenes: `- scene: <id>` then its `inherited:` and `node:` lines.
  const text = await readFile(values.time, 'utf8'), at = new Map();
  for (const block of text.slice(text.indexOf('\nscenes:'), text.indexOf('\ntree:')).split('\n  - scene: ').slice(1)) {
    const id = block.split('\n')[0].trim(), node = block.match(/\n\s+node: (\S+)/)?.[1], inherited = /\n\s+inherited: true/.test(block);
    if (node && node !== 'null') at.set(id, { node, stated: !inherited });
  }
  for (const scene of script.scenes) if (!scene.at && at.has(scene.id)) scene.at = at.get(scene.id);
}
const { groupStrands, strandsDocument, envelope, tree } = await strandBuilder(dir, { envelope: values.envelope ?? null });
const strands = groupStrands(script, { envelope, tree }), told = strands.forks.filter(fork => !fork.past);
const people = new Set(script.scenes.flatMap(scene => scene.present));
const checks = strands.checks.reduce((count, check) => ({ ...count, [check.kind]: (count[check.kind] ?? 0) + 1 }), {});
const arrivals = [...strands.handoffs.values()].flat(), carried = arrivals.filter(entry => entry.from && entry.samePlace).length, from = arrivals.filter(entry => entry.from && !entry.samePlace).length;
const short = id => String(id).replace(/^scene_0*/, '');
console.log(`scenes ${script.scenes.length} (with a time node ${script.scenes.filter(scene => scene.at).length}, in the past ${strands.forks.filter(fork => fork.past).length}), people ${people.size}`);
console.log(`envelope ${strands.scale} (places the built world knows better: ${Object.keys(tree).length}); scenes with no known envelope ${[...strands.envelopeOf.values()].filter(place => !place).length}`);
console.log(`strands ${told.length}: open at the end ${told.filter(fork => fork.open).length}, united into another ${told.filter(fork => fork.into).length}, of one scene ${told.filter(fork => fork.scenes.length === 1).length}`);
console.log(`entries: ${carried} carry on at the same place, ${from} come from elsewhere, ${arrivals.length - carried - from} first appear or are in the past`);
console.log('checks', JSON.stringify(checks));
// A strand's line: its scenes, people, where it came from and what became of it (ids only: a place's id may hold its name).
for (const fork of told) console.log(`  ${short(fork.id)}: ${fork.scenes.length} scenes (${short(fork.scenes[0])} … ${short(fork.scenes.at(-1))}), ${fork.people.length} people${fork.from.length ? `, from ${fork.from.map(short).join(', ')}` : ''}${fork.unites.length ? `, unites ${fork.unites.map(short).join(', ')}` : ''}, ${fork.open ? 'open' : fork.into ? `into ${short(fork.into)}` : 'closed'}`);
if (!values.dry) {
  await writeFile(join(dir, 'stage', 'world', 'strands.json'), JSON.stringify(strandsDocument(script, strands, 'v2-script'), null, 1));
  console.log('written', join(dir, 'stage', 'world', 'strands.json'));
}
