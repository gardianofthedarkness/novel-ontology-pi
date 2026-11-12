// The place tree by the agent, with evidence (docs/v3/design.html#place-tree-agent; the user, 2026-11-12: "we need agent
// to help build space trees with evidence instead of only reading"). After the reading and before terrain, the agent goes
// through the reading's place tree and its units' places and decides, each decision with a line of the book that shows
// it; code checks every claim against the text and refuses what it cannot find. The decisions are kept in
// stage/world/place-tree.json and applied to the world script (stage/world/script.json, rebuilt each time from the
// reading's own, kept as script.reading.json), which strands, starts, terrain, the director and the review all read.
//
//   look:    tree | place <id> | unit <scene> | units [--place <id>] [--by <how>] [--chapter <n>] | moves
//   decide:  setting <id> --line <id> --why <t> | mention <id> --why <t> | drop <id> --why <t>
//            hold <unnamed id> <parent id> --line <id> --why <t> | set <scene> <place id> --line <id> --why <t>
//            same <scene> <earlier scene> --why <t> | travel <scene> <person> --line <id> --why <t>
//   then:    check | apply
//   node engine/places/place-tree.mjs <command> <novel-dir> [args]
import { existsSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (path, fallback = null) => readFile(path, 'utf8').then(JSON.parse, () => fallback);
/** How far before a unit's first line a line may still show where it is (an environment paragraph before it). */
export const LOOK_BACK = 12;

/** The book's stores: the reading's own script (kept), the decisions, the reading, the sentences in order. */
export async function storesOf(novelDir) {
  const novel = resolve(novelDir), world = join(novel, 'stage', 'world');
  const kept = join(world, 'script.reading.json');
  const original = await readJson(existsSync(kept) ? kept : join(world, 'script.json'));
  if (!original?.places) throw new Error('No world script in this book: run the workspace step first.');
  const readingPath = (await readJson(join(novel, 'stage', 'director', 'reading-path.json')))?.path ?? join(novel, '..', 'reading', 'data.json');
  const reading = await readJson(readingPath);
  if (!reading?.scenes) throw new Error(`No reading at ${readingPath}.`);
  const { loadWorkspaceSentences } = await import(pathToFileURL(join(repository, 'dist/src/cli/commands/extract/timeplaceCommands.js')).href);
  const text = await loadWorkspaceSentences(novel), order = [...text.keys()], at = new Map(order.map((id, n) => [id, n]));
  const decisions = await readJson(join(world, 'place-tree.json'), { version: 1, places: {}, units: {}, holds: {}, travels: {}, log: [] });
  const entity = new Map((reading.chart?.entities ?? []).map(e => [e.id, e]));
  const sceneLines = new Map((reading.scenes ?? []).map(s => [s.id, s.sentences ?? []]));
  return { novel, world, kept, original, reading, text, order, at, decisions, entity, sceneLines };
}

/** A place's names: its label (without the script's "(scene N)" or " · pool"), and the reading's names for it. */
export function namesOf(stores, id) {
  const place = stores.original.places[id] ?? {}, label = String(place.label ?? id).replace(/ \(scene \d+\)$/, '').replace(/ · pool$/, '');
  const e = stores.entity.get(id);
  // An unnamed place is also named by its head noun, the label's last two characters (the text says 'dorm' of 'boys' dorm').
  const head = place.unnamed && label.length > 2 ? [label.slice(-2)] : [];
  return [...new Set([label, ...head, ...(e?.proper ?? []), ...(e?.names ?? []).map(n => (typeof n === 'string' ? n : n?.text)).filter(Boolean)])].filter(n => n.length >= 2);
}
const isPool = id => String(id).startsWith('pool:');
const lineOk = (stores, id) => stores.text.has(id);

/** The tree as decided so far: each place with its parent, scale, status and how many units are set there. */
export function treeOf(stores) {
  const { places } = stores.original, d = stores.decisions, units = new Map();
  for (const scene of placedScenes(stores)) if (scene.place) units.set(scene.place, (units.get(scene.place) ?? 0) + 1);
  const parentOf = id => d.holds[id]?.parent ?? places[id]?.parent ?? null;
  const total = id => (units.get(id) ?? 0) + Object.keys(places).filter(other => parentOf(other) === id).reduce((n, other) => n + total(other), 0);
  const rows = [], walk = (id, depth) => {
    const p = places[id], status = d.places[id]?.status ?? (isPool(id) ? 'placeholder' : 'undecided');
    rows.push({ id, depth, label: p.label, scale: p.scale ?? null, status, unitsHere: units.get(id) ?? 0, unitsUnder: total(id), ...(p.unnamed ? { unnamed: true } : {}) });
    for (const child of Object.keys(places).filter(other => parentOf(other) === id).sort()) walk(child, depth + 1);
  };
  for (const id of Object.keys(places).filter(id => !parentOf(id) || !places[parentOf(id)]).sort()) walk(id, 0);
  return rows;
}

/** Each unit's place as the decisions so far make it (the reading's where none is decided; nothing where its place is gone). */
export function placedScenes(stores) {
  const d = stores.decisions, gone = id => ['mention', 'drop'].includes(d.places[id]?.status);
  const byId = new Map(), out = [];
  for (const scene of stores.original.scenes) {
    const decided = d.units[scene.id];
    let place = scene.place, by = scene.placeBy;
    if (decided?.place) { place = decided.place; by = 'agent'; }
    else if (decided?.same) { place = byId.get(decided.same)?.place ?? null; by = 'agent (same as ' + decided.same + ')'; }
    else if (place && chainOf(stores, place).some(gone)) { place = null; by = 'none (its place is not a setting)'; }
    const row = { ...scene, place, placeBy: by };
    byId.set(scene.id, row); out.push(row);
  }
  return out;
}
/** A place and the places above it, as decided (an unnamed place's holder, where the agent gave one). */
export function chainOf(stores, id) {
  const out = [];
  for (let k = 0; id && k < 14; k++) { out.push(id); id = stores.decisions.holds[id]?.parent ?? stores.original.places[id]?.parent ?? null; }
  return out;
}
const cityOf = (stores, id) => chainOf(stores, id).find(p => stores.original.places[p]?.scale === 'city') ?? null;

/** Lines that name a place (any of its names), in reading order. */
export function mentionsOf(stores, id, limit = 12) {
  const names = namesOf(stores, id), out = [];
  for (const [line, s] of stores.text) if (names.some(n => (s.text ?? '').includes(n))) { out.push({ line, text: s.text.slice(0, 90) }); if (out.length >= limit) break; }
  return { names, lines: out, count: [...stores.text.values()].filter(s => names.some(n => (s.text ?? '').includes(n))).length };
}

/** Whether a line may show that a unit is somewhere: in the unit, or within LOOK_BACK lines before its first. */
function nearUnit(stores, scene, line) {
  const lines = stores.sceneLines.get(scene) ?? [], first = stores.at.get(lines[0]), n = stores.at.get(line);
  return lines.includes(line) || (first !== undefined && n !== undefined && n < first && first - n <= LOOK_BACK);
}
/** Longer names a place's name can sit inside without being it (W17: Kyoto inside Tokyo Metropolis). */
export const CONTAINERS = ['\u4e1c\u4eac\u90fd', '\u4eac\u90fd\u5e9c', '\u5317\u4eac\u5e02', '\u5357\u4eac\u5e02', '\u4e1c\u4eac\u6e7e', '\u4eac\u90fd\u5e02'];
/** Whether text names `name` on its own: an occurrence not inside a longer place name (the tree's own, or CONTAINERS). */
export function namesAlone(text, name, longer = []) {
  const wider = [...CONTAINERS, ...longer].filter(other => other !== name && other.includes(name));
  for (let at = text.indexOf(name); at >= 0; at = text.indexOf(name, at + 1)) {
    const inside = wider.some(other => { const offset = other.indexOf(name); return offset >= 0 && text.startsWith(other, at - offset); });
    if (!inside) return true;
  }
  return false;
}
/** Whether a line names a place: any of its names, or (an unnamed place) its own words; or a place under it. */
function names(stores, id, line) {
  const t = stores.text.get(line)?.text ?? '';
  const all = Object.keys(stores.original.places).flatMap(other => namesOf(stores, other));
  const under = Object.keys(stores.original.places).filter(other => chainOf(stores, other).includes(id));
  return [id, ...under].some(p => namesOf(stores, p).some(n => namesAlone(t, n, all)));
}

// ── The decisions, each checked ────────────────────────────────────────────────────────────────────────────────────
function refuse(why) { const error = new Error(why); error.refused = true; throw error; }
const needWhy = why => { if (!why || String(why).trim().length < 4) refuse('Say why (--why), in a few words.'); };
const needPlace = (stores, id) => { if (!stores.original.places[id]) refuse(`No place ${id} in this book's tree (see: tree).`); };
function record(stores, entry) { stores.decisions.log.push({ ...entry, at: new Date().toISOString() }); }

export function decide(stores, command, args) {
  const d = stores.decisions, [a, b] = args.positional, why = args.why, line = args.line;
  // A place once made a mention or dropped is turned back only on purpose (--override), and it is logged.
  if (['setting', 'mention', 'drop'].includes(command) && d.places[a] && d.places[a].status !== command && ['mention', 'drop'].includes(d.places[a].status) && !args.override) refuse(`${a} is already a ${d.places[a].status} (${d.places[a].why}); --override to change it.`);
  if (command === 'setting') {
    needPlace(stores, a); needWhy(why);
    if (!line || !lineOk(stores, line)) refuse(`No line ${line} in this book.`);
    if (!names(stores, a, line)) refuse(`Line ${line} does not name ${namesOf(stores, a).join(' / ')} (or a place in it): a setting needs a line that puts something there.`);
    d.places[a] = { status: 'setting', line, why }; record(stores, { command, place: a, line, why }); return d.places[a];
  }
  if (command === 'mention' || command === 'drop') {
    needPlace(stores, a); needWhy(why);
    // An unnamed place may be dropped (a figure of speech the reading took for a place: its units are placed again), never
    // made a mention: it is somewhere a unit is set, or nowhere.
    if (command === 'mention' && stores.original.places[a]?.unnamed) refuse(`${a} is an unnamed place a unit is set in: hold it under a setting, or drop it if the text never puts anyone there.`);
    d.places[a] = { status: command, why }; record(stores, { command, place: a, why }); return d.places[a];
  }
  if (command === 'hold') {
    needPlace(stores, a); needPlace(stores, b); needWhy(why);
    if (chainOf(stores, b).includes(a)) refuse(`${b} is inside ${a}: a place cannot hold what holds it.`);
    if (['mention', 'drop'].includes(d.places[b]?.status)) refuse(`${b} is a ${d.places[b].status}, not a setting: nothing can be held in it.`);
    if (!line || !lineOk(stores, line)) refuse(`No line ${line} in this book.`);
    const scene = stores.original.places[a]?.scene, ok = (scene ? nearUnit(stores, scene, line) : true) || names(stores, b, line);
    if (!ok) refuse(`Line ${line} is neither in or just before ${a}'s unit nor names ${namesOf(stores, b).join(' / ')}.`);
    d.holds[a] = { parent: b, line, why }; record(stores, { command, place: a, parent: b, line, why }); return d.holds[a];
  }
  if (command === 'set') {
    const scene = stores.original.scenes.find(s => s.id === a); if (!scene) refuse(`No unit ${a}.`);
    needPlace(stores, b); needWhy(why);
    if (['mention', 'drop'].includes(d.places[b]?.status)) refuse(`${b} is a ${d.places[b].status}, not a setting.`);
    if (!line || !lineOk(stores, line)) refuse(`No line ${line} in this book.`);
    if (!nearUnit(stores, a, line)) refuse(`Line ${line} is not in ${a} nor within ${LOOK_BACK} lines before it.`);
    if (!names(stores, b, line)) refuse(`Line ${line} does not name ${namesOf(stores, b).join(' / ')} (or a place in it). If the unit only goes on where the last one was, use: same ${a} <earlier unit>.`);
    d.units[a] = { place: b, line, why }; record(stores, { command, scene: a, place: b, line, why }); return d.units[a];
  }
  if (command === 'same') {
    const i = stores.original.scenes.findIndex(s => s.id === a), j = stores.original.scenes.findIndex(s => s.id === b);
    if (i < 0 || j < 0) refuse(`No unit ${i < 0 ? a : b}.`); needWhy(why);
    if (j >= i) refuse(`${b} is not before ${a}.`);
    if (stores.original.scenes[i].chapter !== stores.original.scenes[j].chapter) refuse(`${b} is in another chapter: give ${a} its own line (set).`);
    d.units[a] = { same: b, why }; record(stores, { command, scene: a, same: b, why }); return d.units[a];
  }
  if (command === 'travel') {
    const [scene, person] = [a, b]; if (!stores.original.scenes.some(s => s.id === scene)) refuse(`No unit ${scene}.`); needWhy(why);
    if (!line || !lineOk(stores, line)) refuse(`No line ${line} in this book.`);
    if (!nearUnit(stores, scene, line)) refuse(`Line ${line} is not in ${scene} nor just before it.`);
    d.travels[`${scene}|${person}`] = { line, why }; record(stores, { command, scene, person, line, why }); return d.travels[`${scene}|${person}`];
  }
  refuse(`Unknown command ${command}.`);
}

/** People changing city between their units with no travel line: each an unproved move. */
export function movesOf(stores) {
  const placed = placedScenes(stores), last = new Map(), out = [];
  for (const scene of placed) {
    const city = scene.place ? cityOf(stores, scene.place) : null;
    for (const who of scene.present ?? []) {
      if (String(who).startsWith('crowd:')) continue;
      const before = last.get(who);
      if (before && city && before.city !== city && !stores.decisions.travels[`${scene.id}|${who}`]) out.push({ who, from: before.scene, fromCity: stores.original.places[before.city]?.label, to: scene.id, toCity: stores.original.places[city]?.label });
      if (city) last.set(who, { city, scene: scene.id });
    }
  }
  return out;
}

/** What is left: undecided cities and districts, units with no place, settings with no unit, unproved moves. */
export function checkOf(stores) {
  const tree = treeOf(stores), placed = placedScenes(stores);
  const areas = tree.filter(row => ['city', 'district', 'region'].includes(row.scale) && !isPool(row.id));
  return {
    undecided: areas.filter(row => row.status === 'undecided').map(row => ({ id: row.id, label: row.label, scale: row.scale, unitsUnder: row.unitsUnder })),
    emptySettings: tree.filter(row => row.status === 'setting' && row.unitsUnder === 0).map(row => ({ id: row.id, label: row.label })),
    placeholders: tree.filter(row => isPool(row.id) && row.unitsUnder > 0).map(row => ({ id: row.id, label: row.label, unitsUnder: row.unitsUnder })),
    unplaced: placed.filter(scene => !scene.place).length,
    unprovedMoves: movesOf(stores).length,
    decided: { places: Object.keys(stores.decisions.places).length, holds: Object.keys(stores.decisions.holds).length, units: Object.keys(stores.decisions.units).length, travels: Object.keys(stores.decisions.travels).length },
  };
}

/** The world script from the reading's own and the decisions: mentions and drops out of the tree (and placeholders left empty), holders set, each unit's place. */
export async function apply(stores) {
  if (!existsSync(stores.kept)) await copyFile(join(stores.world, 'script.json'), stores.kept);
  const d = stores.decisions, gone = new Set(Object.entries(d.places).filter(([, v]) => ['mention', 'drop'].includes(v.status)).map(([id]) => id));
  const placed = placedScenes(stores), used = new Set();
  for (const scene of placed) for (const id of scene.place ? chainOf(stores, scene.place) : []) used.add(id);
  const places = {};
  for (const [id, place] of Object.entries(stores.original.places)) {
    if (chainOf(stores, id).some(p => gone.has(p))) continue;
    if (isPool(id) && !used.has(id)) continue;
    places[id] = { ...place, ...(d.holds[id] ? { parent: d.holds[id].parent, heldBy: 'agent' } : {}), ...(d.places[id] ? { decided: d.places[id].status } : {}) };
  }
  const scenes = placed.map(scene => ({ ...scene, place: scene.place && places[scene.place] ? scene.place : null, ...(d.units[scene.id] ? { placeEvidence: d.units[scene.id].line ?? null } : {}) }));
  const script = { ...stores.original, places, scenes, placeTree: { by: 'agent', at: new Date().toISOString(), mentions: [...gone], decided: Object.keys(d.places).length + Object.keys(d.units).length + Object.keys(d.holds).length } };
  await writeFile(join(stores.world, 'script.json'), JSON.stringify(script, null, 1));
  return { places: Object.keys(places).length, removed: Object.keys(stores.original.places).length - Object.keys(places).length, unplaced: scenes.filter(s => !s.place).length, cities: Object.values(places).filter(p => p.scale === 'city').map(p => p.label) };
}

export async function save(stores) { await writeFile(join(stores.world, 'place-tree.json'), JSON.stringify(stores.decisions, null, 1)); }

// ── The views ──────────────────────────────────────────────────────────────────────────────────────────────────────
export function placeView(stores, id) {
  needPlace(stores, id);
  const p = stores.original.places[id], placed = placedScenes(stores).filter(s => s.place === id);
  return { id, label: p.label, scale: p.scale ?? null, parent: stores.decisions.holds[id]?.parent ?? p.parent ?? null, decided: stores.decisions.places[id] ?? null, ...(p.unnamed ? { unnamed: true, scene: p.scene } : {}),
    mentions: mentionsOf(stores, id), units: placed.slice(0, 20).map(s => ({ scene: s.id, by: s.placeBy })), unitCount: placed.length };
}
export function unitView(stores, sceneId) {
  const scene = placedScenes(stores).find(s => s.id === sceneId); if (!scene) refuse(`No unit ${sceneId}.`);
  const lines = stores.sceneLines.get(sceneId) ?? [], first = stores.at.get(lines[0]) ?? 0;
  const before = stores.order.slice(Math.max(0, first - 4), first);
  const kind = id => stores.reading.kinds?.[id]?.kind ?? null;
  const named = Object.keys(stores.original.places).filter(id => !stores.original.places[id].unnamed && !isPool(id) && lines.some(line => namesOf(stores, id).some(n => (stores.text.get(line)?.text ?? '').includes(n))));
  return { scene: sceneId, chapter: scene.chapter, place: scene.place, chain: scene.place ? chainOf(stores, scene.place).map(id => stores.original.places[id]?.label ?? id) : [], by: scene.placeBy, present: scene.present,
    namedHere: named.map(id => ({ id, label: stores.original.places[id].label })),
    before: before.map(id => ({ line: id, text: (stores.text.get(id)?.text ?? '').slice(0, 90) })),
    lines: lines.slice(0, 14).map(id => ({ line: id, kind: kind(id), text: (stores.text.get(id)?.text ?? '').slice(0, 90) })), more: Math.max(0, lines.length - 14) };
}
export function unitsView(stores, { place = null, by = null, chapter = null, unplaced = null } = {}) {
  return placedScenes(stores).filter(s => (!unplaced || !s.place) && (!place || s.place === place || (s.place && chainOf(stores, s.place).includes(place))) && (!by || String(s.placeBy).startsWith(by)) && (chapter === null || s.chapter === Number(chapter)))
    .map(s => ({ scene: s.id, chapter: s.chapter, place: s.place ? stores.original.places[s.place]?.label : null, by: s.placeBy, first: (stores.text.get((stores.sceneLines.get(s.id) ?? [])[0])?.text ?? '').slice(0, 50) }));
}

// ── The command line ───────────────────────────────────────────────────────────────────────────────────────────────
export async function run(argv) {
  const [command, novelDir, ...rest] = argv, positional = [], flags = {};
  for (let k = 0; k < rest.length; k++) { if (rest[k] === '--override' || rest[k] === '--unplaced') { flags[rest[k].slice(2)] = true; continue; } if (rest[k].startsWith('--')) { flags[rest[k].slice(2)] = rest[k + 1]; k++; } else positional.push(rest[k]); }
  if (!command || !novelDir) throw new Error('Usage: place-tree <tree|place|unit|units|moves|setting|mention|drop|hold|set|same|travel|check|apply> <novel-dir> [args]');
  const stores = await storesOf(novelDir);
  if (command === 'tree') return treeOf(stores).map(row => `${'  '.repeat(row.depth)}${row.id} ${row.label} [${row.scale ?? '?'}${row.unnamed ? ', unnamed' : ''}] ${row.status}; units here ${row.unitsHere}, under ${row.unitsUnder}`).join('\n');
  if (command === 'place') return placeView(stores, positional[0]);
  if (command === 'unit') return unitView(stores, positional[0]);
  if (command === 'units') return unitsView(stores, flags);
  if (command === 'moves') return movesOf(stores);
  if (command === 'check') return checkOf(stores);
  if (command === 'apply') { const result = await apply(stores); await save(stores); return result; }
  const decided = decide(stores, command, { positional, why: flags.why, line: flags.line, override: 'override' in flags });
  await save(stores);
  return { ok: true, [command]: positional, ...decided };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const out = await run(process.argv.slice(2)); console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1)); }
  catch (error) { console.log(JSON.stringify({ refused: error.refused ? error.message : undefined, error: error.refused ? undefined : String(error.message ?? error) })); process.exit(error.refused ? 3 : 1); }
}
