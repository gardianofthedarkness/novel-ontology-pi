// The cast's review (the user, 2026-11-06: "Add the missing commands, and have the agent review in batches"): two entries
// of the reading that are one person, merged everywhere they are named; one person's ability sheet, set by hand or by the
// agent; and the questions that find both, asked in the world's review pool in batches (novel cast review), answered by
// the agent with novel world answer, applied by novel world apply. Before, no command merged two people of a v2 reading
// (novel fix merge reaches the ontology only) and no command set one person's sheet (the settei step sheets the whole
// cast at once): W12's split people (Maidono and the Santa girl, the two Negaoka entries) and Accelerator's and Index's
// sheets waited on a hand edit.
import { copyFile, mkdir, readFile, readdir, writeFile, appendFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { ATTACKS, MOVES, SHEET_SURE } from '../digest/settei.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const readJson = async (path, fallback = null) => JSON.parse(await readFile(path, 'utf8').catch(() => 'null')) ?? fallback;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);

// ── Merging two people ────────────────────────────────────────────────────────────────────────────────────────────────

/** An id as a whole token inside a string (`char_000034` in "scriptSupervisor|b0000_s0259|char_000034", never in char_0000341). */
const tokenOf = id => new RegExp(`(?<![A-Za-z0-9_])${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![A-Za-z0-9_])`, 'g');

/**
 * Every mention of `merged` in a value (strings, keys) made `keep`, and what then names one person twice made one: two
 * entries of a list with the same id fused (the kept person's own entry first: its scalars win, lists are joined), a
 * string or an equal record listed twice once, two keys that became one fused. Pure: returns { value, changed }.
 */
export function mergeValue(value, keep, merged) {
  const token = tokenOf(merged), renamed = new WeakSet();
  let changed = 0;
  const swap = text => text.replace(token, () => { changed++; return keep; });
  const fuse = (a, b) => {
    if (Array.isArray(a) && Array.isArray(b)) return dedupe([...a, ...b]);
    if (isObject(a) && isObject(b)) { const out = { ...a }; for (const [key, v] of Object.entries(b)) out[key] = key in out ? fuse(out[key], v) : v; return out; }
    return a;
  };
  const dedupe = list => {
    const out = [];
    for (const item of list) {
      if (isObject(item) && typeof item.id === 'string') {
        const at = out.findIndex(other => isObject(other) && other.id === item.id);
        if (at >= 0) { out[at] = renamed.has(out[at]) && !renamed.has(item) ? fuse(item, out[at]) : fuse(out[at], item); continue; }
      } else if (out.some(other => other === item || (typeof item === 'object' && JSON.stringify(other) === JSON.stringify(item)))) continue;
      out.push(item);
    }
    return out;
  };
  const walk = item => {
    if (typeof item === 'string') return swap(item);
    if (Array.isArray(item)) { const before = changed, list = item.map(walk); return changed > before ? dedupe(list) : list; }
    if (!isObject(item)) return item;
    const was = item.id === merged, out = {};
    for (const [key, v] of Object.entries(item)) { const name = swap(key), next = walk(v); out[name] = name in out ? (key === name ? fuse(next, out[name]) : fuse(out[name], next)) : next; }
    if (was) renamed.add(out);
    return out;
  };
  return { value: walk(value), changed };
}

/** The readings a book plays from: the director's (stage/director/reading-path.json), the book's (its manifest), and any given. */
export async function readingsOf(novelDir, extra = []) {
  const recorded = (await readJson(join(novelDir, 'stage', 'director', 'reading-path.json')))?.path, out = (await readJson(join(novelDir, 'ontology', 'manifest.json')))?.v2Reading?.out;
  return [...new Set([recorded, out ? join(out, 'v2', 'data.json') : null, ...extra].filter(Boolean).map(path => resolve(path)))];
}

/** The universe a book's sheets live in (src/v2/extraction/pools.ts universeOf: a library's, else the book's own). */
export async function universeDir(novelDir) {
  const { universeOf } = await load('dist/src/v2/extraction/pools.js');
  return universeOf(resolve(novelDir)).dir;
}

const stamp = () => new Date().toISOString().replace(/[-:.]/g, '').slice(0, 15);
/** Before a file is rewritten, its copy under <novel>/stage/world/cast-backup/<stamp>/ (the log names it; nothing is lost). */
async function keepCopy(novelDir, at, path) {
  const folder = join(novelDir, 'stage', 'world', 'cast-backup', at), name = `${createHash('sha256').update(path).digest('hex').slice(0, 8)}-${basename(path)}`;
  await mkdir(folder, { recursive: true, mode: 0o700 });
  await copyFile(path, join(folder, name));
  return join(folder, name);
}
const log = (novelDir, record) => mkdir(join(novelDir, 'stage', 'world'), { recursive: true, mode: 0o700 }).then(() => appendFile(join(novelDir, 'stage', 'world', 'cast-log.jsonl'), JSON.stringify(record) + '\n', { mode: 0o600 }));

/**
 * Two people of a book made one (`merged` into `keep`): every JSON file beside each reading (data.json, the pre-film notes,
 * the voices, rides, in-use, settings) by mergeValue, its YAML views by the token alone; the universe's sheets
 * (abilities.json); the ontology (novel fix merge, the graph rebuilt) where both are entities. Each file is copied aside
 * first; `dry`: the files and their changes listed, nothing written. Returns what changed where.
 */
export async function mergePeople(novelDir, { keep, merged, reason, by = 'hand', readings = null, universe = null, dry = false }) {
  if (!/^char_\d+$/.test(keep) || !/^char_\d+$/.test(merged) || keep === merged) throw new Error('Merge two different people of the reading: novel cast merge <novel-dir> <keep char_…> <merged char_…>.');
  if (!reason?.trim()) throw new Error('--reason is required: why they are one person, citing sentence ids.');
  const paths = readings ?? await readingsOf(novelDir), at = stamp(), changes = [];
  if (!paths.length) throw new Error(`No reading for ${novelDir}: give one with --reading <data.json>.`);
  const people = (await readJson(paths[0]))?.chart?.entities ?? [];
  if (!people.some(entity => entity.id === keep) || !people.some(entity => entity.id === merged)) throw new Error(`${keep} and ${merged} must both be people of the reading ${paths[0]}.`);
  const rewrite = async (path, kind) => {
    const text = await readFile(path, 'utf8').catch(() => null);
    if (text === null || !tokenOf(merged).test(text)) return;
    let next, changed;
    if (kind === 'json') { const result = mergeValue(JSON.parse(text), keep, merged); next = JSON.stringify(result.value, null, text.includes('\n ') ? 1 : undefined); changed = result.changed; }
    else { changed = (text.match(tokenOf(merged)) ?? []).length; next = text.replace(tokenOf(merged), keep); }
    changes.push({ file: path, mentions: changed });
    if (dry) return;
    changes.at(-1).copy = await keepCopy(novelDir, at, path);
    await writeFile(path, next);
  };
  for (const reading of paths) {
    const folder = dirname(reading);
    for (const name of (await readdir(folder).catch(() => [])).sort()) {
      if (name.endsWith('.json')) await rewrite(join(folder, name), 'json');
      else if (name.endsWith('.yaml') || name.endsWith('.yml')) await rewrite(join(folder, name), 'yaml');
    }
  }
  const sheets = join(universe ?? await universeDir(novelDir), 'abilities.json');
  await rewrite(sheets, 'json');
  // The ontology's own entities (novel fix merge rebuilds the graph); a book with only one of them there keeps its own.
  let ontology = null;
  if (!dry) {
    const { runFix } = await load('dist/src/cli/commands/extract/fixCommands.js');
    ontology = await runFix(resolve(novelDir), 'merge', [keep, merged], { reason }).then(() => 'merged', error => `not merged there: ${error.message}`);
  }
  const record = { at: new Date().toISOString(), op: 'merge', keep, merged, reason, by, dry, files: changes.map(({ file, mentions, copy }) => ({ file, mentions, ...(copy ? { copy } : {}) })), ontology };
  if (!dry) await log(novelDir, record);
  return record;
}

// ── One person's ability sheet ────────────────────────────────────────────────────────────────────────────────────────

/** The limits each kind of sheet takes (world-engine/digest/settei.mjs: sheetOf), with what each must be. */
const LIMITS_OF = {
  move: { agility: { factor: 'number' }, appear: { reach: 'number', midair: 'boolean' }, climb: { height: 'number' }, flight: { height: 'number' } },
  attack: { close: { reach: 'number' }, line: { range: 'number' }, area: { radius: 'number', range: 'number' } },
};
/** A sheet as given ({ move: { kind: limits }, attack: { kind: limits } }), checked against the settei's kinds; throws why not. */
export function checkSheet(sheet) {
  if (!isObject(sheet)) throw new Error('A sheet is {"move": {<kind>: {limits}}, "attack": {<kind>: {limits}}}.');
  const out = {};
  for (const [part, kinds] of Object.entries(sheet)) {
    if (!LIMITS_OF[part]) throw new Error(`A sheet has "move" and "attack" only, not "${part}".`);
    if (!isObject(kinds)) throw new Error(`"${part}" maps a kind to its limits.`);
    out[part] = {};
    for (const [kind, limits] of Object.entries(kinds)) {
      const table = LIMITS_OF[part][kind];
      if (!table) throw new Error(`No ${part} kind "${kind}": one of ${Object.keys(LIMITS_OF[part]).map(k => `${k} (${(part === 'move' ? MOVES : ATTACKS)[k]})`).join('; ')}.`);
      const given = isObject(limits) ? limits : {}, kept = {};
      for (const [key, value] of Object.entries(given)) {
        if (key === 'sure') continue;
        if (!table[key]) throw new Error(`${part} ${kind} takes ${Object.keys(table).join(', ')}, not "${key}".`);
        if (typeof value !== table[key] || (typeof value === 'number' && !(value > 0))) throw new Error(`${part} ${kind} ${key} is a ${table[key] === 'number' ? 'number above 0' : 'true or false'}.`);
        kept[key] = value;
      }
      out[part][kind] = { sure: 1, ...kept };
    }
  }
  return out;
}

/**
 * One person's sheet set in the universe's abilities.json: the parts given replace theirs (the other part kept), each kind
 * sure (set by `by` for `reason`); `none`: no ability at all. The held kinds of that person for those parts (Jev under
 * SHEET_SURE) are taken off. The file is copied aside first.
 */
export async function setSheet(novelDir, { who, sheet = null, none = false, reason, evidence = [], by = 'hand', name = null, universe = null }) {
  if (!/^char_\d+$/.test(who)) throw new Error('A sheet is a person\'s: novel cast sheet <novel-dir> <char_…> --sheet \'<JSON>\' | --none --reason <text>.');
  if (!reason?.trim()) throw new Error('--reason is required: what the text says they can do, citing sentence ids.');
  if (!none && !sheet) throw new Error('Give --sheet \'<JSON>\' or --none.');
  const checked = none ? { move: {}, attack: {} } : checkSheet(sheet), path = join(universe ?? await universeDir(novelDir), 'abilities.json');
  // Their name as the reading has it, for one with no sheet yet.
  if (!name) { const [readingPath] = await readingsOf(novelDir), entity = readingPath ? (await readJson(readingPath))?.chart?.entities?.find(entry => entry.id === who) : null; name = entity?.proper?.[0] ?? entity?.names?.[0] ?? null; }
  const file = await readJson(path, { version: 2, least: SHEET_SURE, people: {}, held: [] }), before = file.people[who] ?? null;
  const copy = await readFile(path).then(() => keepCopy(novelDir, stamp(), path), () => null);
  const person = { ...(before ?? { name: name ?? who, move: {}, attack: {}, evidence: [] }), ...checked, evidence: [...new Set([...(before?.evidence ?? []), ...evidence])], by, reason, at: new Date().toISOString(), ...(none ? { none: true } : {}) };
  if (!none) delete person.none;
  file.people = { ...file.people, [who]: person };
  const parts = new Set(Object.keys(checked));
  file.held = (file.held ?? []).filter(entry => !(entry.who === who && parts.has(entry.part)));
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify(file, null, 1));
  const record = { at: person.at, op: 'sheet', who, by, reason, sheet: none ? 'none' : checked, before, file: path, ...(copy ? { copy } : {}) };
  await log(novelDir, record);
  return record;
}

// ── Finding them, and the review ──────────────────────────────────────────────────────────────────────────────────────

const formsOf = entity => [...new Set([...(entity.proper ?? []), ...(entity.names ?? [])])].filter(form => form.length >= 2);
/**
 * Two people of the reading who may be one: a form of one's name the same as, or inside, a form of the other's (Negaoka
 * in Director Negaoka Norito; Misaka's sister twice). A family name shared by sisters comes up too: the agent answers from the text. Pure.
 */
export function samePeople(reading, { cards = null } = {}) {
  const people = (reading.chart?.entities ?? []).filter(entity => entity.type === 'person'), count = new Map();
  for (const card of cards ?? reading.cards ?? []) for (const person of card.people ?? []) count.set(person.id, (count.get(person.id) ?? 0) + 1);
  const out = [];
  for (let i = 0; i < people.length; i++) for (let j = i + 1; j < people.length; j++) {
    const a = people[i], b = people[j], fa = formsOf(a), fb = formsOf(b);
    const pair = fa.flatMap(x => fb.filter(y => x === y || x.includes(y) || y.includes(x)).map(y => [x, y]));
    if (!pair.length) continue;
    const [keep, merged] = (count.get(b.id) ?? 0) > (count.get(a.id) ?? 0) ? [b, a] : [a, b];
    out.push({ keep: keep.id, merged: merged.id, forms: pair[0], cards: [count.get(keep.id) ?? 0, count.get(merged.id) ?? 0] });
  }
  return out;
}

/** The main cast with no sheet: people in at least `least` cards the universe has no sheet for. Pure. */
export function unsheeted(reading, abilities, { least = 20 } = {}) {
  const count = new Map();
  for (const card of reading.cards ?? []) for (const person of card.people ?? []) count.set(person.id, (count.get(person.id) ?? 0) + 1);
  return (reading.chart?.entities ?? []).filter(entity => entity.type === 'person' && (count.get(entity.id) ?? 0) >= least && !abilities?.people?.[entity.id]).map(entity => ({ who: entity.id, cards: count.get(entity.id) }));
}

const itemId = text => `wi_${createHash('sha256').update(text).digest('hex').slice(0, 16)}`;
const kindWords = (part, kind) => (part === 'move' ? MOVES : ATTACKS)[kind] ?? kind;
const limitWords = limits => Object.entries(limits).filter(([key]) => !['sure', 'evidence', 'who', 'part', 'kind'].includes(key)).map(([key, value]) => `${key} ${value}`).join(', ');

/**
 * The cast's questions for the review pool (kinds `person` and `sheet`), each with its id from what it asks, so an item
 * asked before (answered or not) is not asked again:
 *   person  two entries that may be one person (samePeople, and pairs raised with novel cast ask): same person | different people;
 *   sheet   a sheet kind Jev was unsure of (abilities.json `held`): yes, as held | no | set by hand;
 *           a main character with no sheet: nothing beyond a person | set by hand.
 * "set by hand" means the agent sets it first (novel cast sheet …), then answers.
 */
export function castItems({ reading, abilities, least = 20, at = new Date().toISOString() }) {
  const name = new Map((reading.chart?.entities ?? []).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
  const base = { status: 'open', attempts: 0, at, scene: null, card: null, law: null };
  const items = samePeople(reading).map(({ keep, merged, forms, cards }) => ({ ...base, id: itemId(`person|${[keep, merged].sort().join('|')}`), kind: 'person', subjects: [keep, merged], names: [name.get(keep), name.get(merged)],
    question: `Are ${name.get(keep)} (${keep}, ${cards[0]} cards) and ${name.get(merged)} (${merged}, ${cards[1]} cards) one person in this book? Their names meet: "${forms[0]}" and "${forms[1]}". One person: they are merged into ${keep} everywhere.`,
    options: ['same person', 'different people'], evidence: [`forms: ${forms.join(' / ')}`] }));
  for (const held of abilities?.held ?? []) {
    items.push({ ...base, id: itemId(`sheet|held|${held.who}|${held.part}|${held.kind}`), kind: 'sheet', subjects: [held.who], names: [name.get(held.who) ?? held.who], held,
      question: `${name.get(held.who) ?? held.who} (${held.who}), a ${held.part === 'move' ? 'way of moving' : 'way of attacking'}: ${kindWords(held.part, held.kind)} (${limitWords(held)}). Jev said so, only ${Math.round(held.sure * 100)}% sure. Is it so in the book? "yes, as held" keeps it; "set by hand": set the right sheet first with novel cast sheet.`,
      options: ['yes, as held', 'no', 'set by hand'], evidence: (held.evidence ?? []).slice(0, 12) });
  }
  for (const { who, cards } of unsheeted(reading, abilities, { least })) {
    items.push({ ...base, id: itemId(`sheet|none|${who}`), kind: 'sheet', subjects: [who], names: [name.get(who) ?? who],
      question: `What can ${name.get(who) ?? who} (${who}, ${cards} cards) do, by the book? There is no sheet: they move and fight as anyone. "set by hand": set it first with novel cast sheet (moves: ${Object.keys(LIMITS_OF.move).join(', ')}; attacks: ${Object.keys(LIMITS_OF.attack).join(', ')}).`,
      options: ['nothing beyond a person', 'set by hand'], evidence: [] });
  }
  return items;
}

/** A pair raised by hand (or by the agent reading another batch): a `person` item for the next cast batch. */
export function askedItem(reading, a, b, why, at = new Date().toISOString()) {
  const name = new Map((reading.chart?.entities ?? []).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
  if (!name.has(a) || !name.has(b) || a === b) throw new Error(`${a} and ${b} must be two people of the reading.`);
  return { status: 'open', attempts: 0, at, scene: null, card: null, law: null, id: itemId(`person|${[a, b].sort().join('|')}`), kind: 'person', subjects: [a, b], names: [name.get(a), name.get(b)],
    question: `Are ${name.get(a)} (${a}) and ${name.get(b)} (${b}) one person in this book? Raised: ${why}. One person: they are merged into ${a} everywhere.`, options: ['same person', 'different people'], evidence: [why] };
}

/**
 * The cast review: its questions into the world's pool (castItems, and any raised), then batches of at most `size` (the
 * people first), for the agent (novel world batch, novel world answer; novel world apply runs what they decide).
 */
export async function castReview(novelDir, { size = 8, least = 20 } = {}) {
  const { loadPool, writePool, makeBatch } = await load('dist/src/cli/commands/extract/worldCommands.js');
  const [readingPath] = await readingsOf(novelDir), reading = readingPath ? await readJson(readingPath) : null;
  if (!reading) throw new Error(`No reading for ${novelDir}.`);
  const abilities = await readJson(join(await universeDir(novelDir), 'abilities.json'), { people: {}, held: [] });
  const known = new Set((await loadPool(novelDir)).map(item => item.id)), fresh = castItems({ reading, abilities, least }).filter(item => !known.has(item.id));
  await writePool(novelDir, fresh);
  const open = (await loadPool(novelDir)).filter(item => item.status === 'open' && (item.kind === 'person' || item.kind === 'sheet')).sort((a, b) => (a.kind === 'person' ? 0 : 1) - (b.kind === 'person' ? 0 : 1));
  const batches = [];
  for (let start = 0; start < open.length; start += size) batches.push(await makeBatch(novelDir, open.slice(start, start + size)));
  return { asked: fresh.length, batched: open.length, batches: batches.map(batch => ({ batch: batch.id, items: batch.items.length, read: `novel world batch ${novelDir} ${batch.id}` })) };
}

/**
 * What the agent decided, done (novel world apply): `same person` merges (into the first subject); `different people`
 * nothing more; a held sheet kept as Jev had it, or taken off; `set by hand` checked (the person has a sheet novel cast
 * sheet wrote); `nothing beyond a person` written as no ability. Returns null, or why it could not.
 */
export async function applyCast(novelDir, item, answer) {
  const [who, other] = item.subjects, reason = `${answer.reason} (review ${answer.batch})`;
  if (item.kind === 'person') {
    if (answer.verdict !== 'same person') return null;
    const done = await mergePeople(novelDir, { keep: who, merged: other, reason, by: 'agent' }).catch(error => ({ error: error.message }));
    return done.error ?? null;
  }
  const path = join(await universeDir(novelDir), 'abilities.json'), abilities = await readJson(path, { people: {}, held: [] });
  // Set by hand: the person has a sheet novel cast sheet wrote (by the agent or by hand), not only the settei step's.
  if (answer.verdict === 'set by hand') return abilities.people?.[who] && abilities.people[who].by && abilities.people[who].by !== 'settei' ? null : `no sheet set for ${who} by novel cast sheet: set it first, then answer`;
  if (answer.verdict === 'nothing beyond a person') return (await setSheet(novelDir, { who, none: true, reason, by: 'agent' }).then(() => null, error => error.message));
  if (item.held && answer.verdict === 'yes, as held') {
    const { who: _w, part, kind, sure: _s, evidence = [], ...limits } = item.held;
    const kept = abilities.people?.[who]?.[part] ?? {};
    return (await setSheet(novelDir, { who, sheet: { [part]: { ...Object.fromEntries(Object.entries(kept).map(([k, v]) => [k, Object.fromEntries(Object.entries(v).filter(([key]) => key !== 'sure'))])), [kind]: limits } }, reason, evidence, by: 'agent' }).then(() => null, error => error.message));
  }
  if (item.held && answer.verdict === 'no') {
    abilities.held = (abilities.held ?? []).filter(entry => !(entry.who === who && entry.part === item.held.part && entry.kind === item.held.kind));
    await writeFile(path, JSON.stringify(abilities, null, 1));
    await log(novelDir, { at: new Date().toISOString(), op: 'sheet-held-dropped', who, part: item.held.part, kind: item.held.kind, reason, by: 'agent' });
    return null;
  }
  return null;
}

/** A person as the cast commands see them: names, cards, sheet (and what is held), and what the cast log did to them. */
export async function showPerson(novelDir, who = null) {
  const [readingPath] = await readingsOf(novelDir), reading = readingPath ? await readJson(readingPath) : null;
  if (!reading) throw new Error(`No reading for ${novelDir}.`);
  const universe = await universeDir(novelDir), abilities = await readJson(join(universe, 'abilities.json'), { people: {}, held: [] });
  const count = new Map();
  for (const card of reading.cards ?? []) for (const person of card.people ?? []) count.set(person.id, (count.get(person.id) ?? 0) + 1);
  const row = entity => ({ id: entity.id, names: formsOf(entity).slice(0, 6), cards: count.get(entity.id) ?? 0, sheet: abilities.people?.[entity.id] ? { move: abilities.people[entity.id].move, attack: abilities.people[entity.id].attack, by: abilities.people[entity.id].by ?? 'settei' } : null, held: (abilities.held ?? []).filter(entry => entry.who === entity.id).map(({ part, kind, sure }) => ({ part, kind, sure })) });
  const people = (reading.chart?.entities ?? []).filter(entity => entity.type === 'person');
  if (!who) return { reading: readingPath, universe, people: people.map(row).sort((a, b) => b.cards - a.cards) };
  const entity = people.find(entry => entry.id === who);
  if (!entity) throw new Error(`No person ${who} in ${readingPath}.`);
  const history = (await readFile(join(novelDir, 'stage', 'world', 'cast-log.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(entry => [entry.keep, entry.merged, entry.who].includes(who));
  return { reading: readingPath, universe, ...row(entity), history };
}
