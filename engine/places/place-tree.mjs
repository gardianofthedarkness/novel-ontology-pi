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
//            same <scene> <earlier scene> [--through <scene>] --why <t> | nowhere <scene> --why <t> | wide <scene> [--through <scene>] --why <t>
//            merge <place id> <into place id> --why <t> | travel <scene> <person> --line <id> --why <t>
//   then:    check | apply
//   node engine/places/place-tree.mjs <command> <novel-dir> [args]
import { existsSync, readFileSync } from 'node:fs';
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJson = (path, fallback = null) => readFile(path, 'utf8').then(JSON.parse, () => fallback);
/** How far before a unit's first line a line may still show where it is (an environment paragraph before it). */
export const LOOK_BACK = 12;
/** How many units back `same` may reach across a chapter's start. */
export const SAME_ACROSS = 3;

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
  decisions.merges ??= {};
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
    if (decided?.nowhere) { place = null; by = 'agent (nowhere: ' + decided.why + ')'; }
    else if (decided?.place) { place = decided.place; by = 'agent'; }
    else if (decided?.same) { place = byId.get(decided.same)?.place ?? null; by = 'agent (same as ' + decided.same + ')'; }
    else if (place && chainOf(stores, place).some(gone)) { place = null; by = 'none (its place is not a setting)'; }
    const row = { ...scene, place: place ? mergedInto(stores, place) : place, placeBy: by };
    byId.set(scene.id, row); out.push(row);
  }
  return out;
}
/** A place and the places above it, as decided (an unnamed place's holder, where the agent gave one). */
/** The place a place was merged into (the same place the reading made twice), followed to the end. */
export function mergedInto(stores, id) {
  for (let k = 0; id && stores.decisions.merges?.[id] && k < 14; k++) id = stores.decisions.merges[id].into;
  return id;
}
export function chainOf(stores, id) {
  const out = [];
  id = mergedInto(stores, id);
  for (let k = 0; id && k < 14; k++) { out.push(id); id = mergedInto(stores, stores.decisions.holds[id]?.parent ?? stores.original.places[id]?.parent ?? null); }
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
  const all = stores.allNames ??= Object.keys(stores.original.places).flatMap(other => namesOf(stores, other));
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
    // Across a chapter's start only from the units just before it (a chapter that opens mid-scene); further back, a line of its own.
    if (stores.original.scenes[i].chapter !== stores.original.scenes[j].chapter && i - j > SAME_ACROSS) refuse(`${b} is in another chapter and more than ${SAME_ACROSS} units before: give ${a} its own line (set).`);
    // --through <unit>: every unit from a to that one goes on where b was (a run of units in one place).
    const k = args.through ? stores.original.scenes.findIndex(s => s.id === args.through) : i;
    if (k < i) refuse(`--through ${args.through} is not ${a} or after it.`);
    if (k - i > 60) refuse('--through covers at most 60 units at once.');
    const run = stores.original.scenes.slice(i, k + 1).map(s => s.id);
    for (const id of run) d.units[id] = { same: b, why };
    record(stores, { command, scene: a, same: b, ...(k > i ? { through: args.through } : {}), why }); return { same: b, units: run.length, why };
  }
  // The same place made twice by the reading (two units' unnamed dorms that are one dorm): one is merged into the other.
  if (command === 'merge') {
    needPlace(stores, a); needPlace(stores, b); needWhy(why);
    if (a === b || chainOf(stores, b).includes(a) || chainOf(stores, a).includes(b)) refuse(`${a} and ${b} are one inside the other, not the same place twice.`);
    if (stores.original.places[a].scale !== stores.original.places[b].scale) refuse(`${a} is a ${stores.original.places[a].scale}, ${b} a ${stores.original.places[b].scale}: only places of one scale are merged.`);
    d.merges ??= {}; d.merges[a] = { into: b, why }; record(stores, { command, place: a, into: b, why }); return d.merges[a];
  }
  // A unit that happens across its place, not in one room or building of it (a chase through the streets): kept wide.
  if (command === 'wide') {
    const i = stores.original.scenes.findIndex(s => s.id === a); if (i < 0) refuse(`No unit ${a}.`); needWhy(why);
    const k = args.through ? stores.original.scenes.findIndex(s => s.id === args.through) : i;
    if (k < i || k - i > 60) refuse('--through must be this unit or one at most 60 after it.');
    const run = stores.original.scenes.slice(i, k + 1).map(s => s.id);
    d.wide ??= {}; for (const id of run) d.wide[id] = { why };
    record(stores, { command, scene: a, ...(k > i ? { through: args.through } : {}), why }); return { wide: run.length, why };
  }
  // A unit that happens nowhere: front matter, a chapter's title, a summary or an afterword, whatever people it names.
  if (command === 'nowhere') {
    if (!stores.original.scenes.some(s => s.id === a)) refuse(`No unit ${a}.`); needWhy(why);
    d.units[a] = { nowhere: true, why }; record(stores, { command, scene: a, why }); return d.units[a];
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
/** Whether a unit has people in it (front matter, titles and afterwords have none and may stay unplaced). */
const isStory = scene => (scene.present ?? []).some(who => !String(who).startsWith('crowd:'));
/**
 * Units whose place no sentence shows, as runs: a unit's place is shown when the agent decided it, when a line of the unit
 * (or just before it) names the place or a place in it, or when the unit goes on in the place of the story unit before it
 * (in its chapter, or just across a chapter's start) whose place is shown.
 */
export function unprovedOf(stores) {
  const placed = placedScenes(stores), shown = new Map(), out = [];
  let previous = null;
  for (const [k, scene] of placed.entries()) {
    if (!scene.place || !isStory(scene)) continue;
    const lines = stores.sceneLines.get(scene.id) ?? [], first = stores.at.get(lines[0]);
    const window = first === undefined ? lines : [...stores.order.slice(Math.max(0, first - LOOK_BACK), first), ...lines];
    const ok = !!stores.decisions.units[scene.id]
      || window.some(line => names(stores, scene.place, line))
      || (previous && previous.place === scene.place && shown.get(previous.id) && (previous.chapter === scene.chapter || k - previous.k <= SAME_ACROSS));
    shown.set(scene.id, ok);
    if (!ok) { const last = out.at(-1); if (last && last.place === scene.place && last.toIndex === k - 1) { last.to = scene.id; last.toIndex = k; last.count++; } else out.push({ from: scene.id, to: scene.id, place: scene.place, label: stores.original.places[scene.place]?.label ?? scene.place, count: 1, toIndex: k }); }
    previous = { id: scene.id, place: scene.place, chapter: scene.chapter, k };
  }
  return out.map(({ toIndex, ...run }) => run);
}

const RANK = { region: 0, city: 1, district: 2, street: 3, building: 3, room: 4 };
const rankOf = (stores, id) => isPool(id) ? RANK[stores.original.places[stores.original.places[id]?.parent]?.scale] ?? 1 : RANK[stores.original.places[id]?.scale] ?? 3;
/** The places a line names on its own, each line read once. */
function namedIn(stores, line) {
  stores.namedCache ??= new Map();
  if (stores.namedCache.has(line)) return stores.namedCache.get(line);
  stores.placeNames ??= Object.keys(stores.original.places).filter(id => !isPool(id)).map(id => [id, namesOf(stores, id)]);
  const all = stores.allNames ??= Object.keys(stores.original.places).flatMap(other => namesOf(stores, other));
  const t = stores.text.get(line)?.text ?? '', out = new Set();
  for (const [id, names] of stores.placeNames) if (!stores.decisions.merges?.[id] && names.some(n => t.includes(n) && namesAlone(t, n, all))) out.add(id);
  stores.namedCache.set(line, out); return out;
}
/**
 * Units placed wider than their own lines show, as runs: a unit at a city, a district, a street or a building whose lines
 * name a place inside it of a finer scale (a room of the building, a building of the city). Each run is placed at the
 * finest place its lines show (set), or kept wide on purpose (wide, a chase through the streets).
 */
export function coarseOf(stores) {
  const placed = placedScenes(stores), gone = id => chainOf(stores, id).some(p => ['mention', 'drop'].includes(stores.decisions.places[p]?.status)), out = [];
  for (const [k, scene] of placed.entries()) {
    if (!scene.place || !isStory(scene) || stores.decisions.wide?.[scene.id]) continue;
    const rank = rankOf(stores, scene.place), finer = new Set();
    for (const line of stores.sceneLines.get(scene.id) ?? []) for (const id of namedIn(stores, line)) {
      const real = mergedInto(stores, id);
      if (real !== scene.place && !gone(real) && rankOf(stores, real) > rank && chainOf(stores, real).includes(scene.place)) finer.add(real);
    }
    if (!finer.size) continue;
    // The likeliest first: places the reading made near this unit (an unnamed place's own unit), then the rest.
    const near = id => { const at = Number(String(stores.original.places[id]?.scene ?? '').match(/(\d+)$/)?.[1] ?? NaN); return Number.isFinite(at) ? Math.abs(at - (k + 1)) : 1e6; };
    const labels = [...finer].sort((x, y) => near(x) - near(y)).slice(0, 4).map(id => `${id} ${stores.original.places[id]?.label}`);
    const last = out.at(-1);
    if (last && last.place === scene.place && last.toIndex === k - 1) { last.to = scene.id; last.toIndex = k; last.count++; for (const l of labels) if (!last.finer.includes(l) && last.finer.length < 6) last.finer.push(l); }
    else out.push({ from: scene.id, to: scene.id, place: scene.place, label: stores.original.places[scene.place]?.label ?? scene.place, finer: labels, count: 1, toIndex: k });
  }
  return out.map(({ toIndex, ...run }) => run);
}
/**
 * Rooms with no building above them (docs/v3/design.html#indoor-fixes F1): a room-scale place a story unit is set in, held
 * straight under a street, district or city. Terrain builds sites down to buildings only, so such a room has no building
 * in the world and its units would start anywhere in the city. Each is held under the building the text gives.
 */
export function roomsWithoutBuildingOf(stores) {
  const placed = placedScenes(stores), out = new Map();
  for (const scene of placed) {
    if (!scene.place || !isStory(scene)) continue;
    const chain = chainOf(stores, scene.place), at = chain.findIndex(id => stores.original.places[id]?.scale === 'room');
    if (at < 0) continue;
    const room = chain[at];
    if (chain.slice(at + 1).some(id => stores.original.places[id]?.scale === 'building')) continue;
    const entry = out.get(room) ?? { place: room, label: stores.original.places[room]?.label ?? room, units: 0, first: scene.id };
    entry.units++; out.set(room, entry);
  }
  return [...out.values()];
}

/** The same place made twice: places of one scale and one name (longer than a bare noun) in the same city, each holding units. */
export function duplicatesOf(stores) {
  const placed = placedScenes(stores), holding = new Set();
  for (const scene of placed) for (const id of scene.place ? chainOf(stores, scene.place) : []) holding.add(id);
  const groups = new Map();
  for (const id of holding) {
    const p = stores.original.places[id]; if (!p || isPool(id) || stores.decisions.merges?.[id]) continue;
    const base = String(p.label).replace(/ \(scene \d+\)$/, ''); if (base.length <= 2) continue;
    const key = `${base}|${p.scale}|${cityOf(stores, id)}`; groups.set(key, [...(groups.get(key) ?? []), id]);
  }
  return [...groups.values()].filter(ids => ids.length > 1).map(ids => ({ places: ids, label: stores.original.places[ids[0]].label.replace(/ \(scene \d+\)$/, '') }));
}

/** Whether the world script was written from the decisions as they are now (apply ran after the last decision). */
function appliedAfter(stores) {
  let script; try { script = JSON.parse(readFileSync(join(stores.world, 'script.json'), 'utf8')); } catch { return false; }
  const last = stores.decisions.log.at(-1)?.at;
  return !!script.placeTree?.at && (!last || script.placeTree.at >= last);
}

export function checkOf(stores) {
  const out = checkParts(stores);
  // What is left for the agent: every count here must be zero, and apply must have run after the last decision.
  out.left = out.undecided.length + out.unplacedStory.length + out.unproved.length + out.coarse.length + out.duplicates.length + out.roomsWithoutBuilding.length + out.unprovedMoves;
  out.done = out.left === 0 && out.applied;
  return out;
}
function checkParts(stores) {
  const tree = treeOf(stores), placed = placedScenes(stores);
  const areas = tree.filter(row => ['city', 'district', 'region'].includes(row.scale) && !isPool(row.id));
  return {
    undecided: areas.filter(row => row.status === 'undecided').map(row => ({ id: row.id, label: row.label, scale: row.scale, unitsUnder: row.unitsUnder })),
    emptySettings: tree.filter(row => row.status === 'setting' && row.unitsUnder === 0).map(row => ({ id: row.id, label: row.label })),
    placeholders: tree.filter(row => isPool(row.id) && row.unitsUnder > 0).map(row => ({ id: row.id, label: row.label, unitsUnder: row.unitsUnder })),
    unplaced: placed.filter(scene => !scene.place).length,
    unplacedStory: placed.filter(scene => !scene.place && isStory(scene) && !stores.decisions.units[scene.id]?.nowhere).map(scene => scene.id),
    unproved: unprovedOf(stores),
    coarse: coarseOf(stores),
    roomsWithoutBuilding: roomsWithoutBuildingOf(stores),
    duplicates: duplicatesOf(stores),
    unprovedMoves: movesOf(stores).length,
    applied: appliedAfter(stores),
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
    if (d.merges?.[id]) continue;
    const parent = mergedInto(stores, d.holds[id]?.parent ?? place.parent ?? null);
    places[id] = { ...place, ...(parent !== (place.parent ?? null) ? { parent } : {}), ...(d.holds[id] ? { heldBy: 'agent' } : {}), ...(d.places[id] ? { decided: d.places[id].status } : {}) };
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
  if (!command || !novelDir) throw new Error('Usage: place-tree <tree|place|unit|units|moves|setting|mention|drop|hold|set|same|nowhere|wide|merge|travel|check|apply> <novel-dir> [args]');
  const stores = await storesOf(novelDir);
  if (command === 'tree') return treeOf(stores).map(row => `${'  '.repeat(row.depth)}${row.id} ${row.label} [${row.scale ?? '?'}${row.unnamed ? ', unnamed' : ''}] ${row.status}; units here ${row.unitsHere}, under ${row.unitsUnder}`).join('\n');
  if (command === 'place') return placeView(stores, positional[0]);
  if (command === 'unit') return unitView(stores, positional[0]);
  if (command === 'units') return unitsView(stores, flags);
  if (command === 'moves') return movesOf(stores);
  if (command === 'check') return checkOf(stores);
  if (command === 'apply') { const result = await apply(stores); await save(stores); return result; }
  const decided = decide(stores, command, { positional, why: flags.why, line: flags.line, through: flags.through, override: 'override' in flags });
  await save(stores);
  return { ok: true, [command]: positional, ...decided };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const out = await run(process.argv.slice(2)); console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1)); }
  catch (error) { console.log(JSON.stringify({ refused: error.refused ? error.message : undefined, error: error.refused ? undefined : String(error.message ?? error) })); process.exit(error.refused ? 3 : 1); }
}
