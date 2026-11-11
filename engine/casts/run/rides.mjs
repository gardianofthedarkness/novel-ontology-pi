// Who rides what, as a reading step (engine/casts/mounts.mjs): for each move and journey the notes say is carried
// or by a vehicle, Jev picks what carries the person: someone else in the unit, a vehicle there (a slot, or a vehicle the
// unit's lines name), or nobody said. A vehicle's own move is its own (never asked). Paid (Jev, cents), cached. Writes
// <reading>/v2/rides.json; loadPrefilm merges it into the notes (a move or journey gains `riding`).
//
//   node engine/casts/run/rides.mjs <novel-dir> <reading>/v2/data.json --universe <library>/universe [--cache <dir>] [--dry]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as MT from '../mounts.mjs';
import { prefilmOf } from '../../director/specialists.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { universe: { type: 'string' }, cache: { type: 'string' }, dry: { type: 'boolean' } } });
if (!novelDir || !readingPath || !values.universe) { console.error('usage: node engine/casts/run/rides.mjs <novel-dir> <data.json> --universe <library>/universe [--cache <dir>] [--dry]'); process.exit(2); }
const dir = dirname(resolve(readingPath)), read = name => readFile(join(dir, name), 'utf8').then(JSON.parse);
const prefilm = prefilmOf(await read('prefilm.json').catch(() => read('faculties.json')));
const props = JSON.parse(await readFile(join(resolve(values.universe), 'props.json'), 'utf8').catch(() => 'null'));
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const names = new Map((reading.chart?.entities ?? []).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
for (const slot of reading.slots ?? []) if (!names.has(slot.id)) names.set(slot.id, slot.label ?? slot.id);
// The vehicles: slots the prop sheet makes one (they move on their own), and vehicle labels the unit's lines name.
const isVehicle = label => !!props?.labels?.[label]?.vehicle && !!MT.CARRIERS[props.labels[label].kind]?.seats;
const vehicles = new Set(Object.entries(props?.ids ?? {}).filter(([, label]) => props.labels?.[label]?.vehicle).map(([id]) => id));
const rows = MT.ridesToAsk({ prefilm, vehicles });
console.error(`to ask: ${rows.length} carried or ridden moves and journeys`);
if (values.dry) process.exit(0);

const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { ask } = await load('dist/src/context/engine.js');
const text = await loadWorkspaceSentences(resolve(novelDir)), line = id => text.get(id)?.text ?? '';
const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
const order = [...text.keys()], at = new Map(order.map((id, n) => [id, n])), round = (id, k) => order.slice(Math.max(0, (at.get(id) ?? 0) - k), (at.get(id) ?? 0) + k + 1);
// Each row's options: nobody said, the others in the unit (people, and vehicle slots), the vehicles its lines name.
for (const row of rows) {
  const lines = round(row.sentence, 3).map(line).join('');
  const named = Object.keys(props?.labels ?? {}).filter(label => isVehicle(label) && lines.includes(label)).map(label => `item:${label}`);
  row.options = ['nobody', ...row.others.filter(id => !vehicles.has(id) || isVehicle(props.ids[id])), ...named];
  row.hints = Object.fromEntries(row.options.map(option => [option, option === 'nobody' ? 'the lines do not say who or what carries them' : option.startsWith('item:') ? `${option.slice(5)} (${props.labels[option.slice(5)].kind})` : vehicles.has(option) ? `${names.get(option) ?? option} (${props.labels[props.ids[option]].kind})` : `${names.get(option) ?? option} (a person)`]));
}

let paid = 0;
const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js');
const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(dir, '..', 'cache-rides')));
const decide = Object.assign((state, questions) => jev.decide(state, questions), { record: () => {} });
const mode = { name: 'rides', task: 'A light novel being staged in a 3D city. For each move (a line, the lines round it, who moves, and how the notes read it: carried, or by a vehicle), say what carries the person: another person (in their arms, on their back, along in a teleport), a vehicle they ride, or that the lines do not say.', definitions: () => ({}), sources: [{ name: 'moves', key: 'moves', quota: 0, keep: true, collect: focus => focus.items.map(([id, fields]) => ({ id, score: 1, fields })) }], cutOrder: [], questions: focus => focus.questions, budget: 120_000 };
for (let n = 0; n < rows.length; n += 10) {
  const batch = rows.slice(n, n + 10), key = k => `move_${n + k + 1}`;
  const items = batch.map((row, k) => [key(k), { who: names.get(row.who) ?? row.who, notes: row.said, line: clip(line(row.sentence), 240), around: round(row.sentence, 2).filter(id => id !== row.sentence).map(id => clip(line(id), 160)) }]);
  const questions = batch.map((row, k) => ({ key: `on:${n + k}`, primitive: 'choice', instructions: `In moves.${key(k)}, what carries ${names.get(row.who) ?? row.who}?`, options: row.options, optionHints: row.hints }));
  const { replies } = await ask(decide, mode, { items, questions }, null);
  batch.forEach((row, k) => { const reply = replies.find(entry => entry.key === `on:${n + k}`); row.on = reply?.value ?? null; row.sure = Math.round((reply?.confidence ?? 0) * 1000) / 1000; });
  console.error(`rides: ${Math.min(n + 10, rows.length)} of ${rows.length}`);
}
const file = MT.ridesFile({ rows, model: live.modelId });
await writeFile(join(dir, 'rides.json'), JSON.stringify(file, null, 1));
const byKind = { person: 0, vehicle: 0 }; for (const { on } of Object.values(file.rides)) byKind[on.startsWith('item:') || vehicles.has(on) ? 'vehicle' : 'person']++;
console.log(JSON.stringify({ paid, asked: rows.length, ridden: Object.keys(file.rides).length, held: file.held.length, byKind }));
