// The review (docs/v2/world-ontology.md §7, §7b; Track B W5): what the laws hold after a director run goes to a main
// agent (Pi, Codex or another; each with all the rights) as one bundle per scene, through v1's pool, batches and answers
// (src/cli/commands/extract/worldCommands.ts). The agent reads the evidence with the review CLI (the reading, the world
// log, the source and the original EPUB, the graph) and answers each item with one of its options and a reason; answers
// become pins (stage/world/pins.json) once the laws pass them, and the director plays by the pins on its next run. What
// an answer cannot make lawful goes back to the pool with why. Nothing waits on the review: a held item plays its lawful
// default until it is answered.
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);
const itemId = key => `wi_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;
const jsonl = text => text.split('\n').filter(Boolean).map(line => JSON.parse(line));
const readJsonl = path => readFile(path, 'utf8').then(jsonl, () => []);
const readJson = (path, fallback = null) => readFile(path, 'utf8').then(JSON.parse, () => fallback);

/** Each held item's question and options, by what the law found (§7b classes: S story state, A abilities). */
export const OPTIONS = {
  actor: ['present', 'not present', 'remote'],
  speaker: ['present', 'remote', 'not the speaker'],
  talk: ['live', 'group', 'remote', 'public'],
  reach: ['arrives', 'stays', 'another way'],
  continuity: ['follow the strands', 'as played'],
  'two-places': ['not in the first', 'not in the second', 'both'],
  travel: ['not in the later scene', 'more time passes', 'a faster way'],
  blast: ['no blast', 'the text breaks something'],
  note: ['presence', 'speaker', 'place', 'move', 'time', 'nothing'],
  revision: ['apply', 'keep the history'],
  audit: ['right', 'wrong'],
};

/** A ledger entry's scene, card and line, from its value (a play-time verdict) or its `what` ("scene · card · who"). */
const whereOf = entry => {
  if (entry.value?.scene) return { scene: entry.value.scene, card: entry.value.card ?? null, line: null };
  const parts = String(entry.value?.what ?? '').split(' · ');
  const scene = parts[0]?.split(' & ')[0] ?? null, second = parts[1] ?? null;
  return { scene, card: second && second.includes(':') ? second : null, line: second && /^b\d+_s\d+$/.test(second) ? second : null };
};

/**
 * The held items of run `run`: the ledger's held entries (the laws as the run played, and over it afterwards) and the
 * user's notes on cards, each a pool item with its question, options and evidence. `name(id)` names a person. The world's
 * own faults (`kind: world`) are the engine's, not the agent's: they are counted, not asked.
 */
export function heldItems({ ledger, notes = [], name = id => id, at = new Date().toISOString() }) {
  const items = new Map();
  // One question per person (or pair) and scene: the same break on several cards or lines is one item, its cards and
  // lines gathered, so one answer settles them all.
  const item = (key, fields) => {
    const id = itemId(key), known = items.get(id);
    if (!known) { items.set(id, { id, status: 'open', attempts: 0, at, evidence: [], ...fields, cards: fields.card ? [fields.card] : [], lines: fields.line ? [fields.line] : [] }); return; }
    if (fields.card && !known.cards.includes(fields.card)) known.cards.push(fields.card);
    if (fields.line && !known.lines.includes(fields.line)) known.lines.push(fields.line);
    for (const entry of fields.evidence ?? []) if (!known.evidence.includes(entry) && known.evidence.length < 12) known.evidence.push(entry);
  };
  // A revision too big to apply on its own (§5a, class R): the agent says whether the history changes that much.
  for (const entry of ledger.filter(row => row.state === 'held' && row.kind === 'revision' && row.value?.metres !== null && row.value?.metres !== undefined)) item(`revision|${entry.value.scene}|${entry.subject}`, { scene: entry.value.scene, card: null, law: null, ledger: entry.id, kind: 'revision', subjects: [entry.subject], names: [name(entry.subject)], question: `Smoothing the run with everything it observed moves ${name(entry.subject)} ${entry.value.metres} m at the start of ${entry.value.scene} (from where the run had them, ${entry.value.rank ?? 'by rule'}). Should the history change that much?`, options: OPTIONS.revision, evidence: [`revision ${entry.id}`] });
  // A line the world could not settle (W6, speakers.mjs): who says it, of those there (and Jev's guess from elsewhere).
  for (const entry of ledger.filter(row => row.state === 'held' && row.kind === 'speaker')) {
    const v = entry.value, options = [...new Set(v.candidates ?? [])].filter(id => id !== v.to);
    item(`who-speaks|${v.line}`, { scene: v.scene, card: v.card, line: v.line, law: null, ledger: entry.id, kind: 'who-speaks', subjects: options, names: options.map(name), question: `In ${v.scene}, who says line ${v.line}${v.to ? ` (to ${name(v.to)})` : ''}? The reading was unsure; the world could not settle it: ${v.why}. Those there: ${options.map(id => `${id} = ${name(id)}`).join(', ')}.`, options: [...options, 'none of them'], evidence: [`line ${v.line}`, `card ${v.card}`, `ledger ${entry.id}`] });
  }
  // What canon could not take from the world on its own (W6, canon.mjs): a named building in several lots, a named room on
  // several floors, a place inside a building canon puts elsewhere, someone twice in two places at once.
  for (const entry of ledger.filter(row => row.state === 'held' && ['building', 'floor', 'container', 'split'].includes(row.kind))) {
    const v = entry.value, base = { scene: v.scenes?.[0] ?? null, card: null, law: null, ledger: entry.id, kind: entry.kind, evidence: [`ledger ${entry.id}`, ...(v.scenes ?? []).map(scene => `scene ${scene}`)] };
    if (entry.kind === 'building') item(`building|${v.place}`, { ...base, subjects: [v.place], names: [name(v.place)], question: `${name(v.place)} (${v.place}) plays in ${v.lots.length} different buildings across ${v.scenes.join(', ')}. Is it one building throughout (the one most of them used), or are these different places the text gives one name?`, options: ['one building', 'different places'] });
    if (entry.kind === 'floor') item(`floor|${v.place}`, { ...base, subjects: [v.place], names: [name(v.place)], question: `${name(v.place)} (${v.place}) is played on floors ${v.floors.join(', ')} in ${v.scenes.join(', ')}. Which floor is it on (counting the ground as 1)?`, options: v.floors.map(String) });
    if (entry.kind === 'container') item(`container|${v.place}`, { ...base, subjects: [v.place, v.host], names: [name(v.place), name(v.host)], question: `${name(v.place)} (${v.place}) plays inside ${name(v.host)} (${v.host}), but the ontology has it inside ${name(v.parent)} (${v.parent}). Which contains it?`, options: [v.host, v.parent] });
    if (entry.kind === 'split') item(`split|${v.who}`, { ...base, subjects: [v.who], names: [name(v.who)], question: `${name(v.who)} (${v.who}) is in two places at the same stated moment ${v.where.length} times (${v.where.join('; ')}). Is this one person, or two the reading took for one?`, options: ['one person', 'two people'] });
  }
  // An audit (§7b): a share of what the world settled on its own, checked; too many wrong and the class goes to the review.
  for (const entry of ledger.filter(row => row.state === 'held' && row.kind === 'audit')) {
    const v = entry.value;
    item(`audit|${entry.class}|${v.line ?? entry.subject}`, { scene: v.scene, card: v.card, line: v.line, law: null, ledger: entry.id, kind: 'audit', audits: entry.class, subjects: v.who ? [v.who] : [], names: v.who ? [name(v.who)] : [], question: `An audit of what the world settled on its own: in ${v.scene}, line ${v.line} is said by ${name(v.who)} (${v.why}). Is that right?`, options: OPTIONS.audit, evidence: [`line ${v.line}`, `card ${v.card}`, `ledger ${entry.id}`] });
  }
  for (const entry of ledger.filter(row => row.state === 'held' && (row.kind === 'law' || row.kind === 'held'))) {
    const law = entry.law, { scene, card, line } = whereOf(entry), who = entry.subject, why = entry.value?.why ?? '';
    const evidence = [`${law}: ${why}`, ...(card ? [`card ${card}`] : []), ...(line ? [`line ${line}`] : []), `ledger ${entry.id}`];
    const base = { scene, card, line, law, ledger: entry.id };
    if (law === 'L9') item(`actor|${scene}|${who}`, { ...base, kind: 'actor', subjects: [who], names: [name(who)], question: `In ${scene}${card ? `, card ${card}` : ''}, ${name(who)} acts or speaks, but the world has no place for them in the scene. Are they there?`, options: OPTIONS.actor, evidence });
    else if (law === 'L6' && /is not present/.test(why)) item(`speaker|${scene}|${who}`, { ...base, kind: 'speaker', subjects: [who], names: [name(who)], question: `In ${scene}, ${name(who)} says a line (${line}; the reading's speaker), but the world has no place for them in the scene. Are they there, talking from elsewhere, or is someone else the speaker?`, options: OPTIONS.speaker, evidence });
    else if (law === 'L6') { const to = entry.value?.to ?? (why.match(/speaks to (\S+)/)?.[1] ?? null); item(`talk|${scene}|${[who, to].sort().join('|')}`, { ...base, kind: 'talk', subjects: [who, ...(to ? [to] : [])], names: [name(who), ...(to ? [name(to)] : [])], question: `In ${scene}${card ? `, card ${card}` : line ? `, line ${line}` : ''}: ${[who, to].filter(Boolean).reduce((said, id) => said.replace(new RegExp(`(?<!\\w)${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?!\\w)`, 'g'), name(id)), why.replace(/ \(kind not asked yet\)/, ''))}. How does this talk happen: face to face (live), in a group, remotely (a phone, a message, a broadcast), or aloud in public?`, options: OPTIONS.talk, evidence }); }
    else if (law === 'L10') item(`reach|${scene}|${card}|${who}`, { ...base, kind: 'reach', subjects: [who], names: [name(who)], question: `In ${scene}${card ? `, card ${card}` : ''}, ${name(who)} was to move (${why}), but no walk got there. Do they get there, do they stay, or do they go another way (a leap, flight, a vehicle)?`, options: OPTIONS.reach, evidence });
    else if (law === 'L1') item(`continuity|${scene}|${who}`, { ...base, kind: 'continuity', subjects: [who], names: [name(who)], question: `${name(who)} comes into ${scene}: ${why}. Should they come in from where the strands say, or as played (and the strands are wrong)?`, options: OPTIONS.continuity, evidence });
    else if (law === 'L2') { const pair = String(entry.value?.what ?? '').split(' · ')[0].split(' & '); item(`two-places|${pair.join('&')}|${who}`, { ...base, kind: 'two-places', scenes: pair, subjects: [who], names: [name(who)], question: `${name(who)} is in ${pair[0]} (the first) and ${pair[1]} (the second) at the same stated moment, at different places (${why}). Which is wrong?`, options: OPTIONS['two-places'], evidence }); }
    else if (law === 'L5') item(`travel|${scene}|${who}`, { ...base, kind: 'travel', subjects: [who], names: [name(who)], question: `${name(who)} reaches ${scene} too fast: ${why}. Are they not in the later scene, does more time pass than stated, or do they go a faster way?`, options: OPTIONS.travel, evidence });
    else if (law === 'L13') item(`blast|${scene}|${card}`, { ...base, kind: 'blast', subjects: [], names: [], question: `In ${scene}${card ? `, card ${card}` : ''}: ${why}. Does the text break something here?`, options: OPTIONS.blast, evidence });
  }
  for (const note of notes) item(`note|${note.card}|${note.at}`, { scene: note.scene ?? null, card: note.card, law: null, kind: 'note', subjects: [], names: [], question: `The user noted on card ${note.card}${note.sentence ? ` (line ${note.sentence})` : ''}: "${note.text}". What does it change? Answer with what is wrong and, in the reason, how it should be.`, options: OPTIONS.note, evidence: [`note ${note.at}`] });
  return [...items.values()];
}

/**
 * The order to ask in (§7b, reach decides priority): one bundle per scene, scored by how far its items reach (the scenes
 * after it in its strand where its people appear again) and how many it settles; the first `budget` bundles are asked.
 */
export function bundlesOf(items, { log = [], strands = null, budget = Infinity }) {
  const forkOf = new Map((strands?.scenes ?? []).map((scene, n) => [scene.id, { fork: scene.fork, n }]));
  const seen = new Map();
  for (const record of log.filter(row => row.kind === 'presence')) (seen.get(record.who) ?? seen.set(record.who, new Set()).get(record.who)).add(record.scene);
  const reach = item => item.subjects.reduce((sum, who) => sum + [...(seen.get(who) ?? [])].filter(scene => forkOf.get(scene)?.fork === forkOf.get(item.scene)?.fork && (forkOf.get(scene)?.n ?? 0) > (forkOf.get(item.scene)?.n ?? 0)).length, 0);
  const byScene = new Map();
  for (const item of items) (byScene.get(item.scene ?? 'none') ?? byScene.set(item.scene ?? 'none', []).get(item.scene ?? 'none')).push(item);
  return [...byScene.entries()].map(([scene, list]) => ({ scene, items: list, score: list.reduce((sum, item) => sum + 1 + reach(item), 0) }))
    .sort((a, b) => b.score - a.score || String(a.scene).localeCompare(String(b.scene))).slice(0, budget);
}

/** The latest director run's id (stage/simulation/index.json), or null. */
export async function latestRun(novelDir) {
  return (await readJson(join(novelDir, 'stage', 'simulation', 'index.json')))?.strands?.director?.accepted ?? null;
}

/**
 * Run `run`'s held items into the pool, one batch per scene in order of reach, at most `budget` new batches. Items the
 * pool has (asked before, answered or not) are not asked again. Returns the batches made and what was left.
 */
export async function holdForReview(novelDir, { run = null, budget = 12, size = 10, name = null, skip = [] } = {}) {
  const { loadPool, writePool, makeBatch } = await load('dist/src/cli/commands/extract/worldCommands.js');
  run ??= await latestRun(novelDir);
  if (!run) throw new Error('No director run to review: run the director first.');
  const ledger = await readJsonl(join(novelDir, 'stage', 'world', 'ledger', `${run}.jsonl`)), log = await readJsonl(join(novelDir, 'stage', 'world', 'log', `${run}.jsonl`));
  const notes = await readJsonl(join(novelDir, 'stage', 'director', 'notes.jsonl')), strands = await readJson(join(novelDir, 'stage', 'world', 'strands.json'));
  const names = name ?? (id => id);
  const known = new Map((await loadPool(novelDir)).map(item => [item.id, item]));
  // Identity from the world (W6, identity.mjs): two who are never together in a strand, with the same people round them.
  const readingPath = (await readJson(join(novelDir, 'stage', 'director', 'reading-path.json')))?.path;
  const slots = readingPath ? (await readJson(readingPath, {}))?.slots ?? [] : [];
  const { identityProposals } = await import('./identity.mjs');
  const identities = identityProposals({ log, slots, strands }).map(({ a, b, why }) => ({ id: itemId(`identity|${[a, b].sort().join('|')}`), status: 'open', attempts: 0, at: new Date().toISOString(), kind: 'identity', scene: null, card: null, law: null, cards: [], lines: [], subjects: [a, b], names: [names(a), names(b)], question: `Are ${names(a)} (${a}) and ${names(b)} (${b}) the same person? The world never has them together: ${why.replace(/(char|slot)_[\d_]+/g, id => `${names(id)}`)}.`, options: ['same', 'different'], evidence: [why] }));
  // Kinds left out of this review (`skip`: a run without speakers leaves who says a line for later) stay in the pool, unasked.
  const fresh = [...heldItems({ ledger, notes, name: names }), ...identities].filter(item => !known.has(item.id) && !skip.includes(item.kind));
  await writePool(novelDir, fresh);
  const open = (await loadPool(novelDir)).filter(item => item.status === 'open' && !skip.includes(item.kind));
  const bundles = bundlesOf(open, { log, strands, budget });
  const batches = [];
  // A scene's bundle is one batch, or a few of at most `size` (v1 sent 8): an agent answers a batch in one sitting.
  for (const bundle of bundles) for (let start = 0; start < bundle.items.length; start += size) batches.push({ ...(await makeBatch(novelDir, bundle.items.slice(start, start + size))), scene: bundle.scene, score: bundle.score });
  return { run, held: fresh.length, asked: batches.reduce((sum, batch) => sum + batch.items.length, 0), batches, left: open.length - batches.reduce((sum, batch) => sum + batch.items.length, 0), world: ledger.filter(row => row.kind === 'world').length };
}

/** The pins the director plays by (v1's, with v2's: remote actors, arrivals, stays, meetings, speakers, notes). */
export async function loadPins(novelDir) {
  return { present: {}, same: [], different: [], kind: {}, landscape: {}, remote: {}, arrive: {}, stays: {}, meet: [], revise: {}, speaker: {}, audits: {}, places: {}, floor: {}, container: {}, split: {}, notSpeaker: {}, notes: {}, abilities: [], strands: [], time: [], ...await readJson(join(novelDir, 'stage', 'world', 'pins.json'), {}) };
}
export async function savePins(novelDir, pins) {
  await mkdir(join(novelDir, 'stage', 'world'), { recursive: true });
  await writeFile(join(novelDir, 'stage', 'world', 'pins.json'), JSON.stringify(pins, null, 1), { mode: 0o600 });
}

/**
 * The laws on an answer before it is pinned (G0 on G1's answers): someone answered present in a scene must not then be
 * in two places (L2: another scene at the same stated moment, at another place, has them). Returns why not, or null.
 */
export function lawAgainst({ item, verdict }, { script, pins }) {
  if ((item.kind === 'actor' || item.kind === 'speaker') && verdict === 'present') {
    const here = script.scenes.find(scene => scene.id === item.scene), who = item.subjects[0];
    if (here?.at?.stated && here.clock) for (const other of script.scenes) {
      if (other.id === here.id || other.at?.node !== here.at.node || other.place === here.place || !other.clock) continue;
      if (pins.present[`${other.id}|${who}`] ?? other.present.includes(who)) return `L2: ${who} is in ${other.id} at ${other.place} at the same moment`;
    }
  }
  return null;
}

/** Answers into pins, each checked by the laws first; returns the pins and the answers the laws turned back (item id → why). */
export function pinsFrom(pins, settled, { script }) {
  const failed = new Map();
  for (const { answer, item } of settled) {
    const against = lawAgainst({ item, verdict: answer.verdict }, { script, pins });
    if (against) { failed.set(item.id, against); continue; }
    const [who, to] = item.subjects, key = `${item.scene}|${who}`;
    if (item.kind === 'presence') pins.present[key] = answer.verdict === 'present';
    if (item.kind === 'identity') (answer.verdict === 'same' ? pins.same : pins.different).push([...item.subjects].sort());
    if (item.kind === 'dialogue') pins.kind[item.evidence[0].replace(/^dialogue /, '')] = answer.verdict;
    if (item.kind === 'landscape') pins.landscape[item.subjects[0]] = answer.verdict;
    if (item.kind === 'actor' || item.kind === 'speaker') {
      if (answer.verdict === 'present') pins.present[key] = true;
      else if (answer.verdict === 'remote') pins.remote[key] = true;
      else if (item.kind === 'actor') pins.present[key] = false;
      else for (const line of item.lines ?? []) pins.notSpeaker[line] = who;
    }
    if (item.kind === 'talk') {
      // The kind for each card it was found on (a line's card is the director's to find: `line:<id>`).
      for (const card of item.cards ?? []) pins.kind[card] = answer.verdict;
      for (const line of item.lines ?? []) pins.kind[`line:${line}`] = answer.verdict;
      // Face to face, they met: an anchor (rank pinned) the director back-propagates from (§5a).
      if ((answer.verdict === 'live' || answer.verdict === 'group') && to && !pins.meet.some(entry => entry.item === item.id)) pins.meet.push({ scene: item.scene, cards: item.cards ?? [], lines: item.lines ?? [], who, to, item: item.id });
    }
    if (item.kind === 'reach') { if (answer.verdict === 'arrives') pins.arrive[`${item.scene}|${item.card}|${who}`] = true; else if (answer.verdict === 'stays') pins.stays[`${item.scene}|${item.card}|${who}`] = true; else pins.abilities.push({ who, scene: item.scene, card: item.card, reason: answer.reason }); }
    if (item.kind === 'continuity' && answer.verdict === 'as played') pins.strands.push({ scene: item.scene, who, reason: answer.reason });
    if (item.kind === 'two-places' && answer.verdict !== 'both') pins.present[`${item.scenes[answer.verdict === 'not in the first' ? 0 : 1]}|${who}`] = false;
    if (item.kind === 'travel') { if (answer.verdict === 'not in the later scene') pins.present[key] = false; else if (answer.verdict === 'more time passes') pins.time.push({ scene: item.scene, reason: answer.reason }); else pins.abilities.push({ who, scene: item.scene, reason: answer.reason }); }
    if (item.kind === 'who-speaks') for (const line of item.lines ?? []) pins.speaker[line] = answer.verdict === 'none of them' ? null : answer.verdict;
    if (item.kind === 'audit') {
      const audit = (pins.audits[item.audits] ??= { right: 0, wrong: 0 });
      audit[answer.verdict === 'right' ? 'right' : 'wrong']++;
      if (answer.verdict === 'wrong' && item.audits === 'speaker') for (const line of item.lines ?? []) pins.notSpeaker[line] = who;
    }
    if (item.kind === 'building') pins.places[item.subjects[0]] = answer.verdict;
    if (item.kind === 'floor') pins.floor[item.subjects[0]] = answer.verdict;
    if (item.kind === 'container') pins.container[item.subjects[0]] = answer.verdict;
    if (item.kind === 'split') pins.split[item.subjects[0]] = answer.verdict;
    if (item.kind === 'revision') pins.revise[`${item.scene}|${who}`] = answer.verdict === 'apply' ? 'apply' : 'keep';
    if (item.kind === 'note' || item.kind === 'blast') pins.notes[item.card ?? item.id] = { verdict: answer.verdict, reason: answer.reason };
  }
  return { pins, failed };
}

/** The answers not applied yet into pins, under the laws; settled items marked applied, the rest back in the pool with why. */
export async function applyAnswers(novelDir) {
  const { loadPool, loadAnswers, writePool } = await load('dist/src/cli/commands/extract/worldCommands.js');
  const items = new Map((await loadPool(novelDir)).map(item => [item.id, item]));
  const settled = (await loadAnswers(novelDir)).map(answer => ({ answer, item: items.get(answer.item) })).filter(({ item, answer }) => item?.status === 'answered' && item.batch === answer.batch);
  const latest = new Map(settled.map(entry => [entry.item.id, entry]));
  const script = await readJson(join(novelDir, 'stage', 'world', 'script.json'), { scenes: [] });
  // The cast's questions (cast.mjs: who is one person, what they can do) are done by its commands, not pinned.
  const cast = item => item.kind === 'person' || item.kind === 'sheet', castFailed = new Map();
  if ([...latest.values()].some(({ item }) => cast(item))) { const { applyCast } = await import('./cast.mjs'); for (const { item, answer } of latest.values()) if (cast(item)) { const why = await applyCast(novelDir, item, answer); if (why) castFailed.set(item.id, why); } }
  const { pins, failed } = pinsFrom(await loadPins(novelDir), [...latest.values()].filter(({ item }) => !cast(item)), { script });
  for (const [id, why] of castFailed) failed.set(id, why);
  await savePins(novelDir, pins);
  const now = new Date().toISOString();
  await writePool(novelDir, [...latest.values()].map(({ item }) => failed.has(item.id) ? { ...item, status: 'open', attempts: item.attempts + 1, note: `The laws could not take the last answer: ${failed.get(item.id)}`, batch: null, at: now } : { ...item, status: 'applied', at: now }));
  return { applied: latest.size - failed.size, failed: Object.fromEntries(failed) };
}

/** The message that sends a batch to a main agent: what it is and the commands to answer it with. */
export const batchMessage = (novelDir, batch) => batch.cast ? `Cast review ${batch.id}: ${batch.items.length} question${batch.items.length === 1 ? '' : 's'} about who is one person and what people can do in ${novelDir}. Read them with: novel world batch ${novelDir} ${batch.id} (its "how" says what each answer does). A person and their sheet: novel cast show ${novelDir} <char_…>. For the evidence: novel reading ${novelDir} card|scene|line <id>, novel source grep ${novelDir} <regex>, novel source similar ${novelDir} <text>. Answer each item: novel world answer ${novelDir} ${batch.id} <item> <option> --reason "<why, citing sentence ids>"; then novel world apply ${novelDir}.` : `World review ${batch.id}: ${batch.items.length} held item${batch.items.length === 1 ? '' : 's'} from scene ${batch.scene ?? '?'} of ${novelDir}, which the physics laws could not settle. Read them with: novel world batch ${novelDir} ${batch.id}. For the evidence: novel reading ${novelDir} card|scene|line <id>, novel world log ${novelDir} --scene <id>, novel source grep ${novelDir} <regex>, novel source similar ${novelDir} <text>, novel source epub ${novelDir} --grep <regex>, novel query ${novelDir} 'MATCH …'. Answer each item: novel world answer ${novelDir} ${batch.id} <item> <option> --reason "<why, citing sentence ids>". The world goes on meanwhile and applies your answers under its laws.`;

/** Every batch not yet in the main agent's console queue goes there (stage/world/sent.json remembers which did). */
export async function sendToAgent(novelDir, consoleDir, { expiresAt = Date.now() + 3600_000 } = {}) {
  const { readdir } = await import('node:fs/promises');
  const { createPiConsole } = await load('tools/pi-review/pi-console.mjs');
  const folder = join(novelDir, 'stage', 'world'), sentFile = join(folder, 'sent.json'), sent = await readJson(sentFile, {});
  const piConsole = createPiConsole({ directory: consoleDir, expiresAt });
  const { loadPool } = await load('dist/src/cli/commands/extract/worldCommands.js');
  const pool = new Map((await loadPool(novelDir)).map(item => [item.id, item]));
  for (const file of (await readdir(join(folder, 'batches')).catch(() => [])).filter(name => name.endsWith('.json')).sort()) {
    const id = file.slice(0, -5);
    if (sent[id]?.status && !sent[id].error) continue;
    const batch = await readJson(join(folder, 'batches', file));
    if (!batch.items.some(item => pool.get(item)?.status === 'batched')) continue;
    const hex = createHash('sha256').update(id).digest('hex'), uuid = `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
    try { sent[id] = await piConsole.submit({ id: uuid, text: batchMessage(novelDir, { ...batch, scene: pool.get(batch.items[0])?.scene, cast: batch.items.every(item => ['person', 'sheet'].includes(pool.get(item)?.kind)) }) }); } catch (error) { sent[id] = { error: error.message }; }
  }
  await writeFile(sentFile, JSON.stringify(sent, null, 1), { mode: 0o600 });
  return sent;
}
