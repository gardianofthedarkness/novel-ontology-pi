// When an ability is in use, as a reading step (engine/casts/in-use.mjs): for each move and journey of a person
// whose settei sheet gives them a way of moving, Jev says whether the line shows that way in use; each blow's attack is
// sorted by rule. Paid (Jev, cents), cached. Writes <reading>/v2/in-use.json; loadPrefilm merges it into the notes.
//
//   node engine/casts/run/in-use.mjs <novel-dir> <reading>/v2/data.json --universe <library>/universe [--cache <dir>] [--dry]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as IU from '../in-use.mjs';
import { MOVES } from '../settei.mjs';
import { prefilmOf } from '../../director/specialists.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { universe: { type: 'string' }, cache: { type: 'string' }, dry: { type: 'boolean' } } });
if (!novelDir || !readingPath || !values.universe) { console.error('usage: node engine/casts/run/in-use.mjs <novel-dir> <data.json> --universe <library>/universe [--cache <dir>] [--dry]'); process.exit(2); }
const dir = dirname(resolve(readingPath)), read = name => readFile(join(dir, name), 'utf8').then(JSON.parse);
// The notes as the casts wrote them (not merged with an earlier in-use.json).
const prefilm = prefilmOf(await read('prefilm.json').catch(() => read('faculties.json')));
const abilities = JSON.parse(await readFile(join(resolve(values.universe), 'abilities.json'), 'utf8'));
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const names = new Map((reading.chart?.entities ?? []).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { ask } = await load('dist/src/context/engine.js');
const text = await loadWorkspaceSentences(resolve(novelDir)), line = id => text.get(id)?.text ?? '';
const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
const rows = IU.movesToAsk({ prefilm, abilities });
console.error(`to ask: ${rows.length} moves and journeys; blows sorted by rule`);
if (values.dry) process.exit(0);

let paid = 0;
const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js');
const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(dir, '..', 'cache-in-use')));
const decide = Object.assign((state, questions) => jev.decide(state, questions), { record: () => {} });
const mode = { name: 'in-use', task: 'A light novel being staged in a 3D city. For each move (a line, a few lines round it, who moves, and how the notes read it), say whether the line shows the person using one of their own powers to move (the options name the ones they have), or an ordinary move: walking, running, being carried.', definitions: () => ({ ways: MOVES }), sources: [{ name: 'moves', key: 'moves', quota: 0, keep: true, collect: focus => focus.items.map(([id, fields]) => ({ id, score: 1, fields })) }], cutOrder: [], questions: focus => focus.questions, budget: 120_000 };
const order = [...text.keys()], at = new Map(order.map((id, n) => [id, n])), round = (id, k) => order.slice(Math.max(0, (at.get(id) ?? 0) - k), (at.get(id) ?? 0) + k + 1);
for (let n = 0; n < rows.length; n += 10) {
  const batch = rows.slice(n, n + 10), key = k => `move_${n + k + 1}`;
  const items = batch.map((row, k) => [key(k), { who: names.get(row.who) ?? row.who, notes: row.said, line: clip(line(row.sentence), 240), around: round(row.sentence, 2).filter(id => id !== row.sentence).map(id => clip(line(id), 160)) }]);
  const questions = batch.map((row, k) => ({ key: `use:${n + k}`, primitive: 'choice', instructions: `Does moves.${key(k)} show ${names.get(row.who) ?? row.who} using one of their own powers to move?`, options: ['none', ...row.kinds], optionHints: { none: 'an ordinary move: walking, running, being carried, a vehicle not their own', ...Object.fromEntries(row.kinds.map(kind => [kind, MOVES[kind]])) } }));
  const { replies } = await ask(decide, mode, { items, questions }, null);
  batch.forEach((row, k) => { const reply = replies.find(entry => entry.key === `use:${n + k}`); row.kind = reply?.value ?? null; row.sure = Math.round((reply?.confidence ?? 0) * 1000) / 1000; });
  console.error(`in use: ${Math.min(n + 10, rows.length)} of ${rows.length}`);
}
const file = IU.inUseFile({ moves: rows, prefilm, model: live.modelId });
await writeFile(join(dir, 'in-use.json'), JSON.stringify(file, null, 1));
const byKind = {}; for (const entry of Object.values(file.moves)) byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1;
const attacks = {}; for (const entry of Object.values(file.attacks)) attacks[entry.kind] = (attacks[entry.kind] ?? 0) + 1;
console.log(JSON.stringify({ paid, asked: rows.length, inUse: Object.keys(file.moves).length, byKind, attacks }));
