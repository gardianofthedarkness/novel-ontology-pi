// Story strands of a v2 book (src/v2/extraction/strands.ts; the user, 2026-11-01): v1's strands on the world script, and
// the per-fork timeline spawning reads. No model call. Writes <novel>/stage/world/strands.json and prints a summary.
//   npm run build && node experiments/v2/strands.mjs <novel-dir> [--time <reading>/v2/time.yaml]
// --time: a script from before scenes kept their node on the time tree takes it from the reading's story time.
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const { scriptStrands } = await import(pathToFileURL(join(repository, 'dist/src/v2/extraction/strands.js')).href);
const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { time: { type: 'string' } } });
if (!novelDir) { console.error('usage: node experiments/v2/strands.mjs <novel-dir> [--time <time.yaml>]'); process.exit(2); }

const script = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8'));
if (values.time) {
  // The reading's scenes: `- scene: <id>` then its `inherited:` and `node:` lines.
  const text = await readFile(values.time, 'utf8'), at = new Map();
  for (const block of text.slice(text.indexOf('\nscenes:'), text.indexOf('\ntree:')).split('\n  - scene: ').slice(1)) {
    const id = block.split('\n')[0].trim(), node = block.match(/\n\s+node: (\S+)/)?.[1], inherited = /\n\s+inherited: true/.test(block);
    if (node && node !== 'null') at.set(id, { node, stated: !inherited });
  }
  for (const scene of script.scenes) if (!scene.at && at.has(scene.id)) scene.at = at.get(scene.id);
}
const { strands, timeline } = scriptStrands(script);
const people = new Set(script.scenes.flatMap(scene => scene.present));
const checks = strands.checks.reduce((count, check) => ({ ...count, [`${check.kind}:${check.status}`]: (count[`${check.kind}:${check.status}`] ?? 0) + 1 }), {});
const arrivals = [...timeline.handoffs.values()].flat(), carried = arrivals.filter(entry => entry.from && entry.samePlace).length, from = arrivals.filter(entry => entry.from && !entry.samePlace).length;
console.log(`scenes ${script.scenes.length} (with a time node ${script.scenes.filter(scene => scene.at).length}), people ${people.size}`);
console.log(`lanes ${new Set(strands.lane.values()).size}, forks ${timeline.forks.length}, parallel scene pairs ${strands.parallelPairs}`);
console.log(`entries: ${carried} carry on at the same place, ${from} come from elsewhere, ${arrivals.length - carried - from} first appear or are in the past`);
console.log('checks', JSON.stringify(checks));
for (const fork of timeline.forks) console.log(`  ${fork.id}: ${fork.scenes.length} scenes (${fork.scenes[0]} … ${fork.scenes.at(-1)}), ${fork.people.length} people${fork.from.length ? `, from ${fork.from.join(', ')}` : ''}${fork.to.length ? `, on to ${fork.to.join(', ')}` : ''}`);
const out = { version: 1, from: 'v2-script', scenes: script.scenes.map(scene => ({ id: scene.id, fork: timeline.forkOf.get(scene.id) ?? null, layer: strands.layer.get(scene.id) ?? null, lane: strands.lane.get(scene.id) ?? null, continues: strands.continues?.get(scene.id) ?? null, entries: timeline.handoffs.get(scene.id) ?? [] })), forks: timeline.forks, checks: strands.checks };
await writeFile(join(novelDir, 'stage', 'world', 'strands.json'), JSON.stringify(out, null, 1));
console.log('written', join(novelDir, 'stage', 'world', 'strands.json'));
