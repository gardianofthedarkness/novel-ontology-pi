// The set dresser as a reading step (engine/casts/set-dresser.mjs): each unit with environment lines read into the
// kind of setting it plays in, picked by Jev from a fixed list. Paid (Jev, cents), cached. Writes <reading>/v2/settings.json;
// loadPrefilm merges it into the notes (a unit's setDresser).
//
//   node engine/casts/run/set-dresser.mjs <novel-dir> <reading>/v2/data.json [--cache <dir>] [--dry]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { SETTINGS } from '../set-dresser.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { cache: { type: 'string' }, dry: { type: 'boolean' } } });
if (!novelDir || !readingPath) { console.error('usage: node engine/casts/run/set-dresser.mjs <novel-dir> <data.json> [--cache <dir>] [--dry]'); process.exit(2); }
const dir = dirname(resolve(readingPath)), reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { ask } = await load('dist/src/context/engine.js');
const text = await loadWorkspaceSentences(resolve(novelDir)), line = id => text.get(id)?.text ?? '';
const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
const heading = new Map((reading.sequences ?? []).map(sequence => [sequence.id, sequence.heading]));
const units = reading.scenes.map(scene => ({ id: scene.id, lines: scene.sentences.filter(id => reading.kinds?.[id]?.kind === 'environment').slice(0, 6), heading: heading.get(scene.sequence) ?? null })).filter(unit => unit.lines.length);
console.error(`to ask: ${units.length} units with environment lines (of ${reading.scenes.length})`);
if (values.dry) process.exit(0);
let paid = 0;
const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js');
const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(dir, '..', 'cache-set-dresser')));
const decide = Object.assign((state, questions) => jev.decide(state, questions), { record: () => {} });
const mode = { name: 'set-dresser', task: 'Segments of a light novel being staged in a 3D city, each given by its environment lines (what the text says of its surroundings) and its screenplay heading. For each, say the kind of setting it plays in, as the lines describe it.', definitions: () => ({ settings: SETTINGS }), sources: [{ name: 'segments', key: 'segments', quota: 0, keep: true, collect: focus => focus.items.map(([id, fields]) => ({ id, score: 1, fields })) }], cutOrder: [], questions: focus => focus.questions, budget: 120_000 };
const out = { version: 1, at: new Date().toISOString(), model: live.modelId, units: {} };
for (let n = 0; n < units.length; n += 8) {
  const batch = units.slice(n, n + 8), key = k => `segment_${n + k + 1}`;
  const items = batch.map((unit, k) => [key(k), { ...(unit.heading ? { heading: [unit.heading.setting, unit.heading.daytime].filter(Boolean).join(', ') } : {}), lines: unit.lines.map(id => clip(line(id), 200)) }]);
  const questions = batch.map((unit, k) => ({ key: `setting:${unit.id}`, primitive: 'choice', instructions: `What kind of setting does segments.${key(k)} play in?`, options: Object.keys(SETTINGS), optionHints: SETTINGS }));
  const { replies } = await ask(decide, mode, { items, questions }, null);
  for (const unit of batch) { const reply = replies.find(entry => entry.key === `setting:${unit.id}`); if (reply?.value) out.units[unit.id] = { setting: String(reply.value), sure: Math.round((reply.confidence ?? 0) * 1000) / 1000, lines: unit.lines }; }
  console.error(`settings: ${Math.min(n + 8, units.length)} of ${units.length}`);
}
await writeFile(join(dir, 'settings.json'), JSON.stringify(out, null, 1));
const by = {}; for (const unit of Object.values(out.units)) by[unit.setting] = (by[unit.setting] ?? 0) + 1;
console.log(JSON.stringify({ paid, units: Object.keys(out.units).length, by }));
