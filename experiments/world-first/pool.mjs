// The world's review pool, from the world-first loop's side (docs/world-first-design.md §11; the CLI side is
// src/cli/commands/extract/worldCommands.ts). What a scene leaves unsure or against a law becomes a pool item; every
// `batch` open items are a batch, sent to the main agent (Pi, through its console's queue, as the host itself does)
// while the world goes on. The agent answers from the original text; the world, between scenes, turns answers into pins
// (a presence settled, two names one person or not, a dialogue's kind) and replays from the start with them: the cache
// keeps unchanged scenes free. A pin the laws reject (someone pinned into a scene while elsewhere at that time) sends its
// item back to the pool, for the next batch.
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const load = path => import(pathToFileURL(`${repository}/${path}`).href);
const itemId = key => `wi_${createHash('sha256').update(key).digest('hex').slice(0, 16)}`;

/** The pool's items for one scene of the world log: the same question twice is one item (its id is its key). */
export function flagsOf({ scene, number, placeLabel, summary, unsure, dialogues, actorFlags, name }) {
  const at = new Date().toISOString(), items = [];
  const item = (key, fields) => items.push({ id: itemId(key), scene, status: 'open', attempts: 0, at, evidence: [], ...fields });
  for (const { id, p } of unsure) item(`presence|${scene}|${id}`, { kind: 'presence', subjects: [id], names: [name(id)], question: `Is ${name(id)} physically in scene ${number} (at ${placeLabel}: ${summary})? Being mentioned, remembered or on a phone is not being there.`, options: ['present', 'not present'], evidence: [`Jev: ${Math.round(p * 100)}% present`] });
  for (const node of dialogues.filter(node => node.conflicts.length)) item(`dialogue|${scene}|${node.id}`, { kind: 'dialogue', subjects: node.parties, names: node.parties.map(name), question: `A dialogue in scene ${number} between ${node.parties.map(name).join(' and ')}, which the world took as ${node.kind}: ${node.conflicts.join('; ')}. How does it happen?`, options: ['live', 'group', 'remote', 'public'], evidence: [`dialogue ${node.id}`] });
  for (const flag of actorFlags) item(`actor|${scene}|${flag.person}`, { kind: 'actor', subjects: [flag.person], names: [name(flag.person)], question: `An event of scene ${number} has ${name(flag.person)} taking part, but the world does not have them there (${flag.law}). Are they in the scene?`, options: ['present', 'not present', 'remote'], evidence: [`event ${flag.event}`] });
  return items;
}

/** An identity question: two records one person, or not (an ambiguous epithet, a merge to confirm, traces too alike). */
export const identityFlag = ({ a, b, name, why, scene = null }) => ({ id: itemId(`identity|${[a, b].sort().join('|')}`), kind: 'identity', scene, subjects: [a, b], names: [name(a), name(b)], question: `Are ${name(a)} and ${name(b)} the same person?`, options: ['same', 'different'], evidence: [why], status: 'open', attempts: 0, at: new Date().toISOString() });

/**
 * Into the pool: items not there yet (or failed, now with more to go on). Batches of `size` open items are made and, with
 * a `console` (the host's Pi console folder), each is sent to the agent. Returns the batches made.
 */
export async function pool(novelDir, items, { size = 8, console: consoleDir = null } = {}) {
  const { loadPool, writePool, makeBatch } = await load('dist/src/cli/commands/extract/worldCommands.js');
  const known = new Map((await loadPool(novelDir)).map(item => [item.id, item]));
  await writePool(novelDir, items.filter(item => !known.has(item.id)));
  const open = (await loadPool(novelDir)).filter(item => item.status === 'open'), batches = [];
  for (let start = 0; start + size <= open.length; start += size) batches.push(await makeBatch(novelDir, open.slice(start, start + size)));
  if (consoleDir) await sendUnsent(novelDir, consoleDir);
  return batches;
}

/** Every batch not yet in the agent's queue goes there (stage/world/sent.json remembers which did); failures are kept, to retry. */
export async function sendUnsent(novelDir, consoleDir) {
  const folder = join(novelDir, 'stage', 'world'), sentFile = join(folder, 'sent.json');
  const sent = JSON.parse(await readFile(sentFile, 'utf8').catch(() => '{}')), ids = (await readdir(join(folder, 'batches')).catch(() => [])).filter(name => name.endsWith('.json')).map(name => name.slice(0, -5));
  for (const id of ids.filter(id => !sent[id]?.status || sent[id].error)) sent[id] = await tellAgent(consoleDir, novelDir, { id, items: JSON.parse(await readFile(join(folder, 'batches', `${id}.json`), 'utf8')).items });
  await writeFile(sentFile, JSON.stringify(sent, null, 1), { mode: 0o600 });
  return sent;
}
/** The console takes a UUID per message: one made from the batch id, so sending a batch again is the same message. */
const uuidOf = id => { const hex = createHash('sha256').update(id).digest('hex'); return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`; };

/** The batch to the main agent: a message in its console's queue (the host's own way in), naming the commands to use. */
async function tellAgent(consoleDir, novelDir, batch) {
  const { createPiConsole } = await import(pathToFileURL(`${repository}/tools/pi-review/pi-console.mjs`).href);
  // The host's own window: the console takes messages only until the host expires (links.json beside its runtime folder).
  const links = JSON.parse(await readFile(join(consoleDir, '..', '..', 'links.json'), 'utf8').catch(() => '{}'));
  const piConsole = createPiConsole({ directory: consoleDir, expiresAt: links.expiresAt ?? Date.now() + 3600_000 });
  const text = `World batch ${batch.id} (${batch.items.length} questions) waits in the world-first book ${novelDir}. Read it with: novel world batch ${novelDir} ${batch.id}. Check each question against the original text with novel source grep ${novelDir} <regex>, novel source similar ${novelDir} <text> and novel query ${novelDir} 'MATCH …', then answer each item with: novel world answer ${novelDir} ${batch.id} <item> <option> --reason "<why, citing sentence ids>". The world goes on meanwhile and applies your answers under its laws.`;
  try { return await piConsole.submit({ id: uuidOf(batch.id), text }); } catch (error) { return { error: error.message }; }
}

/** Answers not applied yet, as pins for the world, and the items they settle. */
export async function newAnswers(novelDir) {
  const { loadPool, loadAnswers } = await load('dist/src/cli/commands/extract/worldCommands.js');
  const items = new Map((await loadPool(novelDir)).map(item => [item.id, item]));
  return (await loadAnswers(novelDir)).map(answer => ({ answer, item: items.get(answer.item) })).filter(({ item }) => item?.status === 'answered');
}

/** The pins the world plays by (stage/world/pins.json): presence settled per scene, identities, dialogue kinds. */
export async function loadPins(novelDir) {
  return JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'pins.json'), 'utf8').catch(() => '{"present":{},"same":[],"different":[],"kind":{}}'));
}
export async function savePins(novelDir, pins) { await writeFile(join(novelDir, 'stage', 'world', 'pins.json'), JSON.stringify(pins, null, 1), { mode: 0o600 }); }

/** Answers into pins: what each says about the world. */
export function pinsFrom(pins, settled) {
  for (const { answer, item } of settled) {
    if (item.kind === 'presence' || item.kind === 'actor') pins.present[`${item.scene}|${item.subjects[0]}`] = answer.verdict === 'present';
    if (item.kind === 'identity') (answer.verdict === 'same' ? pins.same : pins.different).push([...item.subjects].sort());
    if (item.kind === 'dialogue') pins.kind[item.evidence[0].replace(/^dialogue /, '')] = answer.verdict;
  }
  return pins;
}

/** Items marked applied, or back in the pool with what the laws said (`failed`: item id → why). */
export async function settle(novelDir, settled, failed = new Map()) {
  const { writePool } = await load('dist/src/cli/commands/extract/worldCommands.js');
  await writePool(novelDir, settled.map(({ item }) => failed.has(item.id) ? { ...item, status: 'open', attempts: item.attempts + 1, note: `The world could not take the last answer: ${failed.get(item.id)}`, batch: null, at: new Date().toISOString() } : { ...item, status: 'applied', at: new Date().toISOString() }));
}
