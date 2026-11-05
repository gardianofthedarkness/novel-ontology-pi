// The settei cast as a reading step (world-engine/digest/settei.mjs): each person's ways of moving and each object's kind,
// shape and size, picked by Jev from fixed lists given the lines the reading cites. Paid (Jev only, cents), cached.
// Writes <library>/universe/abilities.json and props.json (a universe's sheets follow its people and things from book to book).
//
//   node experiments/v2/settei.mjs <novel-dir> <reading>/v2/data.json --universe <library>/universe [--cache <dir>] [--dry]
//
// --dry: count what would be asked, ask nothing.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as ST from '../../world-engine/digest/settei.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { universe: { type: 'string' }, cache: { type: 'string' }, dry: { type: 'boolean' } } });
if (!novelDir || !readingPath || !values.universe) { console.error('usage: node experiments/v2/settei.mjs <novel-dir> <data.json> --universe <library>/universe [--cache <dir>] [--dry]'); process.exit(2); }
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const prefilm = await (await import('../../world-engine/digest/prefilm.mjs')).loadPrefilm(dirname(resolve(readingPath)));
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { ask } = await load('dist/src/v2/context/engine.js');
const text = await loadWorkspaceSentences(resolve(novelDir)), line = id => text.get(id)?.text ?? '';
const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
const names = new Map((reading.chart?.entities ?? []).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
const formsOf = new Map((reading.chart?.entities ?? []).filter(entity => entity.type === 'person').map(entity => [entity.id, [...new Set([...(entity.proper ?? []), ...(entity.names ?? [])])].filter(form => form.length >= 2)]));

// What to ask: the abilities the reading gives people; each main character's own lines that move them; every object.
const abilities = ST.abilitiesToAsk({ reading });
const MOVE = /跳|跃|飞|瞬间移动|空间移动|冲|奔|飘|浮|传送|骑|驾驶|开车|蹬/;
const people = (reading.chart?.entities ?? []).filter(entity => entity.type === 'person' && (entity.seen?.length ?? 0) >= 15).map(entity => {
  const forms = formsOf.get(entity.id) ?? [], lines = [...text.keys()].filter(id => MOVE.test(line(id)) && forms.some(form => line(id).includes(form))).slice(0, 6);
  return { who: entity.id, label: names.get(entity.id), sentences: lines };
}).filter(entry => entry.sentences.length);
const props = ST.propsToAsk({ reading, prefilm });
console.error(`to ask: ${abilities.length} abilities of people, ${people.length} people by their own lines, ${props.length} objects`);
if (values.dry) process.exit(0);

let paid = 0;
const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(resolve(values.universe), '..', 'cache-settei')));
const decide = Object.assign((state, questions) => jev.decide(state, questions), { record: () => {} });
const given = name => ({ name, key: name, quota: 0, keep: true, collect: focus => focus.items.map(([id, fields]) => ({ id, score: 1, fields })) });
const modeOf = (name, task, definitions) => ({ name, task, definitions: () => definitions, sources: [given('entries')], cutOrder: [], questions: focus => focus.questions, budget: 120_000 });
const choice = (key, instructions, options) => ({ key, primitive: 'choice', instructions, options: Object.keys(options), optionHints: options });
const pick = reply => (reply ? { value: reply.value, confidence: reply.confidence ?? 0 } : null);

// Abilities and people's own lines: the way, its reach, its height.
const wayMode = modeOf('settei-ways', 'A light novel being staged in a 3D city. For each entry (a person, and an ability the story gives them or the lines that move them), say how it lets the person move beyond walking and running, how far one such move carries them, and how high. Say "none" when it does not carry them anywhere.', { ways: ST.WAYS, reach: ST.REACH, height: ST.HEIGHT });
const wayRows = [];
const asks = [...abilities.map(entry => ({ ...entry, kind: 'ability' })), ...people.map(entry => ({ ...entry, kind: 'lines' }))];
for (let n = 0; n < asks.length; n += 8) {
  const batch = asks.slice(n, n + 8), key = k => `entry_${n + k + 1}`;
  const items = batch.map((entry, k) => [key(k), { person: names.get(entry.who) ?? entry.who, ...(entry.kind === 'ability' ? { ability: entry.label } : {}), lines: entry.sentences.map(id => clip(line(id), 220)) }]);
  const questions = batch.flatMap((entry, k) => [
    choice(`way:${n + k}`, `How does entries.${key(k)} let ${names.get(entry.who) ?? entry.who} move beyond walking and running?`, ST.WAYS),
    choice(`reach:${n + k}`, `How far does one such move of entries.${key(k)} carry them?`, Object.fromEntries(Object.keys(ST.REACH).map(option => [option, option]))),
    choice(`height:${n + k}`, `How high can it take them (a leap or a flight; else the least)?`, Object.fromEntries(Object.keys(ST.HEIGHT).map(option => [option, option]))),
  ]);
  const { replies } = await ask(decide, wayMode, { items, questions }, null);
  batch.forEach((entry, k) => { const answers = Object.fromEntries(['way', 'reach', 'height'].map(field => [field, pick(replies.find(reply => reply.key === `${field}:${n + k}`))])); wayRows.push({ ...entry, answers, way: ST.wayOf(answers), evidence: entry.sentences }); });
  console.error(`ways: ${Math.min(n + 8, asks.length)} of ${asks.length}`);
}

// Objects: the kind and the size.
const propMode = modeOf('settei-props', 'A light novel being staged in a 3D city. For each thing named (with the lines it is in), say what kind of thing it is, so it can be drawn with the right shape, and about how big it is (its longest side).', { kinds: Object.fromEntries(Object.entries(ST.KINDS).map(([kind, entry]) => [kind, entry.hint])), sizes: Object.fromEntries(Object.keys(ST.SIZES).map(size => [size, size])) });
const propRows = [];
for (let n = 0; n < props.length; n += 12) {
  const batch = props.slice(n, n + 12), key = k => `thing_${n + k + 1}`;
  const items = batch.map((entry, k) => [key(k), { name: entry.label, lines: entry.sentences.map(id => clip(line(id), 200)) }]);
  const questions = batch.flatMap((entry, k) => [
    choice(`kind:${n + k}`, `What kind of thing is entries.${key(k)} (${entry.label})?`, Object.fromEntries(Object.entries(ST.KINDS).map(([kind, row]) => [kind, row.hint]))),
    choice(`size:${n + k}`, `About how big is entries.${key(k)}, its longest side?`, Object.fromEntries(Object.keys(ST.SIZES).map(option => [option, option]))),
  ]);
  const { replies } = await ask(decide, propMode, { items, questions }, null);
  batch.forEach((entry, k) => { const answers = Object.fromEntries(['kind', 'size'].map(field => [field, pick(replies.find(reply => reply.key === `${field}:${n + k}`))])); propRows.push({ ...entry, answers, prop: ST.propOf(answers) }); });
  console.error(`props: ${Math.min(n + 12, props.length)} of ${props.length}`);
}

const universe = resolve(values.universe);
await mkdir(universe, { recursive: true });
const at = new Date().toISOString();
const abilitiesOut = ST.abilitiesFile(wayRows, { names, at, model: live.modelId }), propsOut = ST.propsFile(propRows, { at, model: live.modelId });
await writeFile(join(universe, 'abilities.json'), JSON.stringify(abilitiesOut, null, 1));
await writeFile(join(universe, 'props.json'), JSON.stringify(propsOut, null, 1));
await writeFile(join(universe, 'settei-answers.json'), JSON.stringify({ at, model: live.modelId, paid, ways: wayRows.map(({ answers, ...row }) => ({ ...row, answers })), props: propRows.map(({ answers, ...row }) => ({ ...row, answers })) }, null, 1));
const kinds = {}; for (const row of propRows) kinds[row.prop?.kind ?? 'unanswered'] = (kinds[row.prop?.kind ?? 'unanswered'] ?? 0) + 1;
console.log(JSON.stringify({ paid, people: Object.keys(abilitiesOut.people).length, ways: Object.values(abilitiesOut.people).reduce((n, person) => n + Object.keys(person.ways).length, 0), props: Object.keys(propsOut.labels).length, kinds }));
