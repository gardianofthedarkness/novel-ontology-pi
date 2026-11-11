// The settei cast as a reading step (engine/casts/settei.mjs): each person's ways of moving and each object's kind,
// shape and size, picked by Jev from fixed lists given the lines the reading cites. Paid (Jev only, cents), cached.
// Writes <library>/universe/abilities.json and props.json (a universe's sheets follow its people and things from book to book).
//
//   node engine/casts/run/settei.mjs <novel-dir> <reading>/v2/data.json --universe <library>/universe [--cache <dir>] [--dry]
//
// --dry: count what would be asked, ask nothing.
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import * as ST from '../settei.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const { values, positionals: [novelDir, readingPath] } = parseArgs({ allowPositionals: true, options: { universe: { type: 'string' }, cache: { type: 'string' }, dry: { type: 'boolean' } } });
if (!novelDir || !readingPath || !values.universe) { console.error('usage: node engine/casts/run/settei.mjs <novel-dir> <data.json> --universe <library>/universe [--cache <dir>] [--dry]'); process.exit(2); }
const reading = JSON.parse(await readFile(resolve(readingPath), 'utf8'));
const prefilm = await (await import('../prefilm.mjs')).loadPrefilm(dirname(resolve(readingPath)));
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js'), { ask } = await load('dist/src/context/engine.js');
const text = await loadWorkspaceSentences(resolve(novelDir));
// The book's introduction (src/reading/front.ts; front.json beside the reading): each introduced person's line from
// it (what they are, by the publisher) leads the lines asked about them, and an introduced person is asked about even if
// the book sees them seldom.
const front = JSON.parse(await readFile(join(dirname(resolve(readingPath)), 'front.json'), 'utf8').catch(() => 'null'));
const introLine = new Map(), introOf = new Map();
if (front && reading.intro?.cast?.length) {
  const { introParts, introSentences } = await load('dist/src/reading/front.js'), { sentences } = introSentences(introParts(front));
  reading.intro.cast.forEach((entry, k) => { if (entry.entity && sentences[k]) { introLine.set(sentences[k].id, sentences[k].text); introOf.set(entry.entity, sentences[k].id); } });
}
const line = id => text.get(id)?.text ?? introLine.get(id) ?? '';
const clip = (value, size) => (value.length > size ? `${value.slice(0, size - 1)}…` : value);
const names = new Map((reading.chart?.entities ?? []).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
const formsOf = new Map((reading.chart?.entities ?? []).filter(entity => entity.type === 'person').map(entity => [entity.id, [...new Set([...(entity.proper ?? []), ...(entity.names ?? [])])].filter(form => form.length >= 2)]));

// What to ask: the abilities the reading gives people; each main character's own lines that move them; every object.
const abilities = ST.abilitiesToAsk({ reading });
const MOVE = /跳|跃|飞|瞬间移动|空间移动|冲|奔|飘|浮|传送|骑|驾驶|开车|蹬|墙|壁|屋顶|楼顶/;
// A person's own lines that move them, spread over the volume (the first few alone missed what comes later: a leap
// between towers in a later unit).
const spread = (list, most) => (list.length <= most ? list : Array.from({ length: most }, (_, k) => list[Math.floor((k * list.length) / most)]));
const people = (reading.chart?.entities ?? []).filter(entity => entity.type === 'person' && ((entity.seen?.length ?? 0) >= 15 || introOf.has(entity.id))).map(entity => {
  const forms = formsOf.get(entity.id) ?? [], lines = spread([...text.keys()].filter(id => MOVE.test(line(id)) && forms.some(form => line(id).includes(form))), 8);
  return { who: entity.id, label: names.get(entity.id), sentences: [...(introOf.has(entity.id) ? [introOf.get(entity.id)] : []), ...lines] };
}).filter(entry => entry.sentences.length);
const props = ST.propsToAsk({ reading, prefilm });
console.error(`to ask: ${abilities.length} abilities of people, ${people.length} people by their own lines, ${props.length} objects`);
if (values.dry) process.exit(0);

let paid = 0;
const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/reading/v1/timeplace/cache.js');
const live = jevFromEnv(process.env), jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { paid++; return live.decide(...args); } }, resolve(values.cache ?? join(resolve(values.universe), '..', 'cache-settei')));
const decide = Object.assign((state, questions) => jev.decide(state, questions), { record: () => {} });
const given = name => ({ name, key: name, quota: 0, keep: true, collect: focus => focus.items.map(([id, fields]) => ({ id, score: 1, fields })) });
const modeOf = (name, task, definitions) => ({ name, task, definitions: () => definitions, sources: [given('entries')], cutOrder: [], questions: focus => focus.questions, budget: 120_000 });
const choice = (key, instructions, options) => ({ key, primitive: 'choice', instructions, options: Object.keys(options), optionHints: options });
const pick = reply => (reply ? { value: reply.value, confidence: reply.confidence ?? 0 } : null);

// Abilities and people's own lines: the move it gives and the attack it gives, and every limit (the ones that apply are read).
const options = table => Object.fromEntries(Object.keys(table).map(option => [option, option]));
const sheetMode = modeOf('settei-abilities', 'A light novel being staged in a 3D city. For each entry (a person, and an ability the story gives them or the lines that show them moving or fighting), say how it lets the person move beyond walking and running, and how it lets them attack; then its limits. Say "none" for a part it does not give.', { moves: ST.MOVES, attacks: ST.ATTACKS });
const sheetRows = [];
const asks = [...abilities.map(entry => ({ ...entry, kind: 'ability' })), ...people.map(entry => ({ ...entry, kind: 'lines' }))];
const LIMIT_ASK = {
  agility: 'If it makes them faster: how much faster than a person?', reach: 'If they appear elsewhere: how far can one jump of it take them?', midair: 'If they appear elsewhere: can they appear in the air?',
  climb: 'If they go up walls: how high?', height: 'If they fly: how high can they stay?', close: 'If it hits up close: how far does it reach?', range: 'If it hits from afar (a line or an explosion): how far away?', radius: 'If it explodes at a point: how wide is the blast?',
};
for (let n = 0; n < asks.length; n += 6) {
  const batch = asks.slice(n, n + 6), key = k => `entry_${n + k + 1}`;
  const items = batch.map((entry, k) => [key(k), { person: names.get(entry.who) ?? entry.who, ...(entry.kind === 'ability' ? { ability: entry.label } : {}), lines: entry.sentences.map(id => clip(line(id), 220)) }]);
  const questions = batch.flatMap((entry, k) => [
    choice(`move:${n + k}`, `How does entries.${key(k)} let ${names.get(entry.who) ?? entry.who} move beyond walking and running?`, ST.MOVES),
    choice(`attack:${n + k}`, `How does entries.${key(k)} let them attack?`, ST.ATTACKS),
    ...Object.entries(ST.LIMITS).map(([limit, table]) => choice(`${limit}:${n + k}`, `entries.${key(k)}: ${LIMIT_ASK[limit]}`, options(table))),
  ]);
  const { replies } = await ask(decide, sheetMode, { items, questions }, null);
  batch.forEach((entry, k) => { const answers = Object.fromEntries(['move', 'attack', ...Object.keys(ST.LIMITS)].map(field => [field, pick(replies.find(reply => reply.key === `${field}:${n + k}`))])); sheetRows.push({ ...entry, answers, sheet: ST.sheetOf(answers), evidence: entry.sentences }); });
  console.error(`abilities: ${Math.min(n + 6, asks.length)} of ${asks.length}`);
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

// Weapons: the attack each gives (the same three kinds and limits as a person's).
const weaponRows = propRows.filter(row => ST.WEAPON_KINDS.has(row.prop?.kind));
const weaponMode = modeOf('settei-weapons', 'A light novel being staged in a 3D city. For each weapon (with the lines it is in), say how it attacks and its limits.', { attacks: ST.ATTACKS });
for (let n = 0; n < weaponRows.length; n += 10) {
  const batch = weaponRows.slice(n, n + 10), key = k => `weapon_${n + k + 1}`;
  const items = batch.map((entry, k) => [key(k), { name: entry.label, lines: entry.sentences.map(id => clip(line(id), 200)) }]);
  const questions = batch.flatMap((entry, k) => [choice(`attack:${n + k}`, `How does entries.${key(k)} (${entry.label}) attack?`, ST.ATTACKS), ...['close', 'range', 'radius'].map(limit => choice(`${limit}:${n + k}`, `entries.${key(k)}: ${LIMIT_ASK[limit]}`, options(ST.LIMITS[limit])))]);
  const { replies } = await ask(decide, weaponMode, { items, questions }, null);
  batch.forEach((entry, k) => { const answers = Object.fromEntries(['attack', 'close', 'range', 'radius'].map(field => [field, pick(replies.find(reply => reply.key === `${field}:${n + k}`))])); entry.attack = ST.sheetOf(answers).attack; entry.attackAnswers = answers; });
  console.error(`weapons: ${Math.min(n + 10, weaponRows.length)} of ${weaponRows.length}`);
}

const universe = resolve(values.universe);
await mkdir(universe, { recursive: true });
const at = new Date().toISOString();
const abilitiesOut = ST.abilitiesFile(sheetRows, { names, at, model: live.modelId }), propsOut = ST.propsFile(propRows, { at, model: live.modelId });
await writeFile(join(universe, 'abilities.json'), JSON.stringify(abilitiesOut, null, 1));
await writeFile(join(universe, 'props.json'), JSON.stringify(propsOut, null, 1));
await writeFile(join(universe, 'settei-answers.json'), JSON.stringify({ at, model: live.modelId, paid, abilities: sheetRows.map(({ answers, ...row }) => ({ ...row, answers })), props: propRows.map(({ answers, ...row }) => ({ ...row, answers })) }, null, 1));
const kinds = {}; for (const row of propRows) kinds[row.prop?.kind ?? 'unanswered'] = (kinds[row.prop?.kind ?? 'unanswered'] ?? 0) + 1;
console.log(JSON.stringify({ paid, people: Object.keys(abilitiesOut.people).length, moves: Object.values(abilitiesOut.people).reduce((n, person) => n + Object.keys(person.move).length, 0), attacks: Object.values(abilitiesOut.people).reduce((n, person) => n + Object.keys(person.attack).length, 0), held: abilitiesOut.held.length, weapons: weaponRows.filter(row => row.attack).length, props: Object.keys(propsOut.labels).length, kinds }));
