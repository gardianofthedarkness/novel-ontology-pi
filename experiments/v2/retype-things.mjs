// The thing rule on a reading already made (the user, 2026-11-04: "only weapons, vehicles or items that in that segment
// look like they probably play an important role, have a dedicated name, or have impact on the scene because of their
// functionality will be extracted. Routine things used will not."). Each unnamed weapon or vehicle slot is typed again
// by the reading's own typing step (src/v2/extraction/typing.ts, its definitions as they are now), in the segment where
// it is first described, with that segment as the passage. A slot typed a weapon, vehicle or item stays; one typed
// routine (or anything else) goes.
//
//   node experiments/v2/retype-things.mjs <novel-dir> <reading>/v2/data.json            what it would ask (nothing paid)
//   node experiments/v2/retype-things.mjs <novel-dir> <reading>/v2/data.json --run      asks Jev (paid: one request a segment)
//   ... --run --write                                                                   also writes the reading without them
//                                                                                       (data.before-things.json kept)

import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { run: { type: 'boolean' }, write: { type: 'boolean' } } });
if (!novelDir || !readingPath) { console.error('usage: node experiments/v2/retype-things.mjs <novel-dir> <reading>/v2/data.json [--run] [--write]'); process.exit(2); }
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { typeNames, CATEGORY_OF } = await load('dist/src/v2/extraction/typing.js');
const text = await loadWorkspaceSentences(resolve(novelDir));
// The reading's scenes are its segments (one unit, 2026-11-04).
const segmentOf = new Map(); reading.scenes.forEach((segment, n) => { for (const id of segment.sentences) segmentOf.set(id, n); });
const things = reading.slots.filter(slot => slot.kind === 'weapon' || slot.kind === 'vehicle');
// By the segment of each slot's first description; its names that stand in that segment.
const asks = new Map();
for (const slot of things) {
  const n = segmentOf.get(slot.sentences[0]);
  if (n === undefined) continue;
  const segment = reading.scenes[n], batch = segment.sentences.map(id => ({ id, text: text.get(id)?.text ?? '' }));
  const names = [...new Set([slot.label, ...slot.names])].filter(name => batch.some(sentence => sentence.text.includes(name)));
  if (!names.length) continue;
  const entry = asks.get(n) ?? asks.set(n, { segment: n, batch, names: [], slots: [] }).get(n);
  for (const name of names) if (!entry.names.includes(name)) entry.names.push(name);
  entry.slots.push({ slot, names });
}
console.log(`${things.length} weapon and vehicle slots; ${asks.size} segments to ask (one request each)`);
if (!values.run) process.exit(0);

const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
const { PICKER_MODEL } = await import('../../world-engine/live/sim-jev.mjs');
const client = jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL }), jev = cachedDecisions(client, join(dirname(resolve(readingPath)), 'cache-things'));
const results = [];
for (const entry of asks.values()) {
  const typed = await typeNames((state, questions) => jev.decide(state, questions), entry.batch, entry.names);
  for (const { slot, names } of entry.slots) {
    const mine = typed.filter(answer => names.includes(answer.text)), kept = mine.some(answer => CATEGORY_OF[answer.type] === 'thing');
    results.push({ id: slot.id, kind: slot.kind, label: slot.label, segment: entry.segment, now: mine.map(answer => `${answer.type} ${Math.round(answer.confidence * 100)}%`).join(', '), kept });
  }
}
for (const entry of results) console.log(`${entry.kept ? 'keep' : 'drop'}  ${entry.kind.padEnd(7)} ${entry.id.padEnd(16)} ${entry.label}  →  ${entry.now}`);
console.log(`kept ${results.filter(entry => entry.kept).length}, dropped ${results.filter(entry => !entry.kept).length}; Jev requests ${client.usage.length}`);
await writeFile(join(dirname(resolve(readingPath)), 'retype-things.json'), JSON.stringify(results, null, 1));
if (values.write) {
  // The reading without the dropped slots: their descriptions and the lines they acted in point at no one.
  const dropped = new Set(results.filter(entry => !entry.kept).map(entry => entry.id));
  await copyFile(resolve(readingPath), join(dirname(resolve(readingPath)), 'data.before-things.json'));
  reading.slots = reading.slots.filter(slot => !dropped.has(slot.id));
  for (const role of Object.values(reading.roles)) for (const pick of [role.who, role.to]) if (pick && dropped.has(pick.id)) { pick.id = null; pick.answer = 'none'; }
  for (const reference of reading.references ?? []) if (dropped.has(reference.entity)) { reference.entity = null; reference.answer = 'none'; }
  await writeFile(resolve(readingPath), JSON.stringify(reading));
  console.log(`wrote the reading without ${dropped.size} slots (the one before kept as data.before-things.json)`);
}
