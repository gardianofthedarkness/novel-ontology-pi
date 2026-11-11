// The transport specialist as a pre-film step (engine/casts/transport.mjs): for each vehicle, weapon and machine the
// book's props name, Jev picks which of the kits' models a vehicle is and whose each one is, from the lines it is named in.
// Paid (Jev, cents), cached; `--stand-in` answers by rule instead (unpaid: a model by its name's words, owner not said).
// Writes <library>/universe/transport.json, which the director reads (the model a vehicle is drawn as, its owner).
//
//   node engine/casts/run/transport.mjs <novel-dir> <reading>/v2/data.json --universe <library>/universe [--cache <dir>] [--dry] [--stand-in]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as TR from '../transport.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { universe: { type: 'string' }, cache: { type: 'string' }, dry: { type: 'boolean' }, 'stand-in': { type: 'boolean' } } });
if (!novelDir || !readingPath || !values.universe) { console.error('usage: node engine/casts/run/transport.mjs <novel-dir> <data.json> --universe <library>/universe [--cache <dir>] [--dry] [--stand-in]'); process.exit(2); }
const universe = resolve(values.universe), props = JSON.parse(await readFile(join(universe, 'props.json'), 'utf8').catch(() => 'null'));
if (!props?.labels) { console.error(`no props in ${universe} (the settei cast writes them)`); process.exit(2); }
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const names = new Map((reading.chart?.entities ?? []).filter(entity => entity.type === 'person' || String(entity.id).startsWith('char_')).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
// The people named in a prop's lines (the cards that hold its evidence sentences), most named first.
const cardsOf = new Map();
for (const card of reading.cards ?? []) for (const id of card.sentences ?? []) cardsOf.set(id, card);
const peopleIn = evidence => { const count = new Map(); for (const id of evidence) for (const person of cardsOf.get(id)?.people ?? []) if (names.has(person.id)) count.set(person.id, (count.get(person.id) ?? 0) + 1); return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([id]) => id); };
const rows = TR.transportRows(props, { peopleIn });
console.error(`to ask: ${rows.length} props (${rows.filter(row => row.models).length} with models to pick)`);
if (values.dry) process.exit(0);

let paid = 0, model = 'stand-in';
if (!values['stand-in']) {
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { ask } = await load('dist/src/context/engine.js');
  const text = await loadWorkspaceSentences(resolve(novelDir)), line = id => text.get(id)?.text ?? '';
  const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js');
  const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(universe, '..', 'cache-transport')));
  model = live.modelId;
  const decide = Object.assign((state, questions) => jev.decide(state, questions), { record: () => {} });
  // A mode of the context engine (as in-use.mjs): the things are the focus, kept whole; the questions are the batch's own.
  const mode = { name: 'transport', task: 'A light novel being staged in a 3D city. For each vehicle, weapon or machine (its name as the book has it, its kind, the lines it is named in, the people in them): which of the listed 3D models a vehicle is, and whose it is.', sources: [{ name: 'things', key: 'things', quota: 0, keep: true, collect: focus => focus.items.map(([id, fields]) => ({ id, score: 1, fields })) }], cutOrder: [], questions: focus => focus.questions, budget: 120_000 };
  for (let n = 0; n < rows.length; n += 8) {
    const batch = rows.slice(n, n + 8), key = k => `thing_${n + k + 1}`;
    const items = batch.map((row, k) => [key(k), { name: row.label, kind: row.kind, lines: row.evidence.slice(0, 3).map(id => clip(line(id), 220)), people: row.people.map(id => names.get(id) ?? id) }]);
    const questions = batch.flatMap((row, k) => [
      ...(row.models ? [{ key: `model:${n + k}`, primitive: 'choice', instructions: `Which model is things.${key(k)} (${row.label})?`, options: Object.keys(row.models), optionHints: row.models }] : []),
      { key: `owner:${n + k}`, primitive: 'choice', instructions: `Whose is things.${key(k)} (${row.label})?`, options: [...row.people, ...Object.keys(TR.OWNER_OTHER)], optionHints: { ...Object.fromEntries(row.people.map(id => [id, names.get(id) ?? id])), ...TR.OWNER_OTHER } },
    ]);
    const { replies } = await ask(decide, mode, { items, questions }, null);
    batch.forEach((row, k) => {
      const picked = replies.find(entry => entry.key === `model:${n + k}`), owner = replies.find(entry => entry.key === `owner:${n + k}`);
      if (picked) { row.model = picked.value ?? null; row.modelSure = Math.round((picked.confidence ?? 0) * 1000) / 1000; }
      if (owner) { row.owner = owner.value ?? 'not said'; row.ownerSure = Math.round((owner.confidence ?? 0) * 1000) / 1000; }
    });
    console.error(`transport: ${Math.min(n + 8, rows.length)} of ${rows.length}`);
  }
}
const file = TR.transportFile(rows, { model });
await writeFile(join(universe, 'transport.json'), JSON.stringify(file, null, 1));
const tally = (key, of) => Object.values(file.props).reduce((out, entry) => { const value = of(entry); if (value) out[value] = (out[value] ?? 0) + 1; return out; }, {});
console.log(JSON.stringify({ paid, props: rows.length, models: tally('model', entry => entry.model ? `${entry.model} (${entry.modelBy})` : null), owners: tally('owner', entry => (names.has(entry.owner) ? 'a person' : entry.owner)) }));
