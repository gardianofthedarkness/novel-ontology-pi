// Story strands of a v2 book (src/v2/extraction/strands.ts groupStrands; docs/v3/design.html#strands §0; the user, 2026-11-09: "As
// long as the group splits on different things and no longer interact with each other on semantic scale, they become two
// strands. When they reunited the strands become one"): the same builder the director plays (segments.mjs strandsFile),
// on the units the director plays (segmentWorld over the reading: the credit checked, who acts in each unit), bound for
// the book by strand-builder.mjs (the built world's place tree). No scale is set; no model call.
// Writes <novel>/stage/world/strands.json (what spawning reads) and prints a summary.
//   npm run build && node experiments/v2/strands.mjs <novel-dir> [--reading <data.json>] [--time <reading>/v2/time.yaml] [--dry]
// --reading: the reading (default <novel-dir>/../reading/data.json); --time: a script from before scenes kept their node on
// the time tree takes it from the reading's story time; --dry: print only, write nothing.
import { readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { strandBuilder } from '../../world-engine/director/strand-builder.mjs';
import { segmentWorld, strandsFile } from '../../world-engine/director/segments.mjs';
const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, time: { type: 'string' }, dry: { type: 'boolean' } } });
if (!novelDir) { console.error('usage: node experiments/v2/strands.mjs <novel-dir> [--reading <data.json>] [--time <time.yaml>] [--dry]'); process.exit(2); }

const dir = resolve(novelDir), book = JSON.parse(await readFile(join(dir, 'stage', 'world', 'script.json'), 'utf8'));
const readingFile = resolve(values.reading ?? join(dir, '..', 'reading', 'data.json')), reading = JSON.parse(await readFile(readingFile, 'utf8'));
if (values.time) {
  // The reading's scenes: `- scene: <id>` then its `inherited:` and `node:` lines.
  const text = await readFile(values.time, 'utf8'), at = new Map();
  for (const block of text.slice(text.indexOf('\nscenes:'), text.indexOf('\ntree:')).split('\n  - scene: ').slice(1)) {
    const id = block.split('\n')[0].trim(), node = block.match(/\n\s+node: (\S+)/)?.[1], inherited = /\n\s+inherited: true/.test(block);
    if (node && node !== 'null') at.set(id, { node, stated: !inherited });
  }
  for (const scene of book.scenes) if (!scene.at && at.has(scene.id)) scene.at = at.get(scene.id);
}
const world = segmentWorld({ reading, script: book }), script = world.script, builder = await strandBuilder(dir), tree = builder.tree;
const { strands, ...file } = strandsFile(script, builder, { reading: world.reading }), told = strands.forks.filter(fork => !fork.past);
const people = new Set(script.scenes.flatMap(scene => scene.present));
const checks = strands.checks.reduce((count, check) => ({ ...count, [check.kind]: (count[check.kind] ?? 0) + 1 }), {});
const arrivals = [...strands.handoffs.values()].flat(), carried = arrivals.filter(entry => entry.from && entry.samePlace).length, from = arrivals.filter(entry => entry.from && !entry.samePlace).length;
const short = id => String(id).replace(/^scene_0*/, '');
console.log(`scenes ${script.scenes.length} (with a time node ${script.scenes.filter(scene => scene.at).length}, in the past ${strands.forks.filter(fork => fork.past).length}), people ${people.size}`);
console.log(`scale read from the context (places the built world knows better: ${Object.keys(tree).length}); scenes on a strand with no known area ${[...strands.envelopeOf.values()].filter(place => !place).length}`);
console.log(`strands ${told.length}: open at the end ${told.filter(fork => fork.open).length}, united into another ${told.filter(fork => fork.into).length}, of one scene ${told.filter(fork => fork.scenes.length === 1).length}`);
console.log(`entries: ${carried} carry on at the same place, ${from} come from elsewhere, ${arrivals.length - carried - from} first appear or are in the past`);
console.log('checks', JSON.stringify(checks));
// A strand's line: its scenes, people, where it came from and what became of it (ids only: a place's id may hold its name).
for (const fork of told) console.log(`  ${short(fork.id)}: ${fork.scenes.length} scenes (${short(fork.scenes[0])} … ${short(fork.scenes.at(-1))}), ${fork.people.length} people${fork.from.length ? `, from ${fork.from.map(short).join(', ')}` : ''}${fork.unites.length ? `, unites ${fork.unites.map(short).join(', ')}` : ''}, ${fork.open ? 'open' : fork.into ? `into ${short(fork.into)}` : 'closed'}`);
if (!values.dry) {
  await writeFile(join(dir, 'stage', 'world', 'strands.json'), JSON.stringify({ ...file, from: 'v2-script' }, null, 1));
  console.log('written', join(dir, 'stage', 'world', 'strands.json'));
}
