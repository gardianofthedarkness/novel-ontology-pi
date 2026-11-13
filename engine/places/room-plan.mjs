// The rooms by the agent, with evidence (docs/v3/design.html#room-plan; the user, 2026-11-13: "Make sure your idea is
// generalized, not customized. I feel like agent needs to engage more", then "Yes, as proposed"). After the place tree and
// before filming, the agent goes through every room the book's units are set in and decides what the text shows of it, each
// decision with a line of the book: its kind, its floor, whether it is part of another room (a flat's entrance, a suite's
// bathroom) or a room of its own, what it opens onto; and for each unit set in it, where each person of the unit is in it
// (at a feature of the room, or elsewhere). Code checks that each line is the book's and lies in or just before a unit set
// in that room, and refuses what is not; it holds no words of any book or language. Kept in stage/world/room-plan.json;
// the director binds and stages the rooms from it (director.mjs).
//
//   look:    rooms | room <room id> | stage <unit>
//   decide:  kind <room> <kind> --line <id> --why <t>            (a kind of engine/casts/rooms.mjs; "not said" needs only --why)
//            floor <room> <n|ground|not-said> --line <id> --why <t>   (n as the text counts it: 1 the ground floor)
//            part <room> <other room|own> --line <id> --why <t>
//            opens <room> <balcony|window|none> --line <id> --why <t>
//            at <unit> <person> <feature> [--through <unit>] --line <id> --why <t>   (features: FEATURES below; elsewhere: not in
//            the room; --through: the same through the room's later units where they are present, the line in the first)
//            shot <unit> <set|eye|outside> [--through <unit>] --line <id> --why <t>   (how the unit is filmed: SHOTS below)
//   then:    check
//   node engine/places/room-plan.mjs <command> <novel-dir> [args]
import { mkdir, readFile, rename, rmdir, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { storesOf, LOOK_BACK } from './place-tree.mjs';
import { ROOM_TYPES, ROOM_TYPE_NAMES } from '../casts/rooms.mjs';

/** Where a person may be in a room: by a piece of it, at an opening, anywhere on its floor, or not in it at all. */
export const FEATURES = {
  bed: 'on or by a bed', seat: 'on a chair, sofa or bench', desk: 'at a desk or worktable', table: 'at a table',
  counter: 'at a counter or kitchen worktop', door: 'at the room\'s door, just inside', window: 'at a window',
  balcony: 'out on the balcony', floor: 'somewhere on the room\'s floor (no piece said)', elsewhere: 'not in the room in this unit (on the phone, remembered, gone out)',
};
const OPENINGS = ['balcony', 'window', 'none'];
/** How a unit set in a room is filmed (the shot stage, docs/v3/design.html#shot-stage): the room cut open from above, at eye
 *  level inside it, or from the street outside up to its window and into it. */
export const SHOTS = {
  set: 'the default: the room cut open, seen from above and a little aside: who is where in it and what they do; also a room\'s first unit',
  eye: 'at eye level inside the room, looking toward its window, when the story\'s weather is rain, snow or a storm and the people are indoors (the shot looks out at it with them), or for a quiet, close moment between people in the room',
  outside: 'from the street outside, up the building to the room\'s window, then into the room: when the story comes back to the room from elsewhere at a new time of day (evening, night), or someone arrives at its door from outside; never a room\'s first unit',
};

function refuse(why) { const error = new Error(why); error.refused = true; throw error; }
const needWhy = why => { if (!why || String(why).trim().length < 4) refuse('Say why (--why), in a few words.'); };
const readJson = (path, fallback) => readFile(path, 'utf8').then(JSON.parse, () => fallback);

/** The book's rooms and units as the place tree left them (stage/world/script.json), the decisions so far, the text. */
export async function roomStores(novelDir) {
  const stores = await storesOf(novelDir), script = await readJson(join(stores.world, 'script.json'), null);
  if (!script?.places) refuse('No world script: run the place pass first (novel places apply).');
  const plan = await readJson(join(stores.world, 'room-plan.json'), { version: 1, rooms: {}, staging: {}, log: [] });
  const chainOf = id => { const out = []; for (let at = id, guard = 0; at && script.places[at] && guard < 16; at = script.places[at].parent, guard++) out.push(at); return out; };
  const sky = await readJson(join(stores.novel, '..', 'reading', 'sky.json'), null);
  return { ...stores, script, plan, chainOf, sky };
}

/** Every room some unit is set in (the unit's place or a room above it), with its building and its units in order. */
export function roomsOf(s) {
  const out = new Map();
  for (const scene of s.script.scenes ?? []) {
    if (!scene.place) continue;
    const room = s.chainOf(scene.place).find(id => s.script.places[id]?.scale === 'room');
    if (!room) continue;
    if (!out.has(room)) { const up = s.chainOf(room).slice(1); out.set(room, { id: room, label: s.script.places[room].label, building: up.find(id => s.script.places[id]?.scale === 'building') ?? null, units: [] }); }
    out.get(room).units.push(scene.id);
  }
  return [...out.values()];
}

/** The units set in a room's building but in no room of it (a corridor, a doorway, the stairs): filmed on that room (the
 *  first room of the building any unit is set in), so each has a shot to decide too. */
export function buildingUnitsOf(s) {
  const rooms = roomsOf(s), byBuilding = new Map();
  for (const room of rooms) if (room.building && !byBuilding.has(room.building)) byBuilding.set(room.building, room);
  const out = [];
  for (const scene of s.script.scenes ?? []) {
    if (!scene.place) continue;
    const chain = s.chainOf(scene.place);
    if (chain.some(id => s.script.places[id]?.scale === 'room')) continue;
    const building = chain.find(id => byBuilding.has(id));
    if (building) out.push({ unit: scene.id, room: byBuilding.get(building).id, building });
  }
  return out;
}

/** A unit's story sky (the reading's sky.json): its time of day and weather, the light a shot is chosen for. */
const skyOf = (s, unit) => { const told = s.sky?.units?.[unit]; return told ? { daypart: told.daypart?.value ?? null, hour: told.hour ?? null, weather: told.weather?.value ?? null } : null; };
const lightOf = sky => (sky ? `${sky.daypart ?? '?'}|${sky.weather ?? '?'}` : null);
const nameOf = (s, id) => { const e = s.entity.get(id); return e?.name ?? e?.names?.[0]?.text ?? e?.names?.[0] ?? id; };
const presentOf = (s, unit) => s.script.scenes.find(scene => scene.id === unit)?.present ?? [];
/** A line lies in a unit or within LOOK_BACK lines before its first. */
function inUnit(s, unit, line) {
  const lines = s.sceneLines.get(unit) ?? [], n = s.at.get(line);
  if (n === undefined || !lines.length) return false;
  const first = s.at.get(lines[0]), last = s.at.get(lines.at(-1));
  return n >= first - LOOK_BACK && n <= last;
}
const needLine = (s, line, units, where) => {
  if (!line || !s.text.has(line)) refuse(`No line ${line} in this book.`);
  if (!units.some(unit => inUnit(s, unit, line))) refuse(`Line ${line} is not in ${where} nor within ${LOOK_BACK} lines before it.`);
};

export function decide(s, command, { positional: [a, b, c], why, line, through = null }) {
  const rooms = roomsOf(s), room = rooms.find(entry => entry.id === a), d = s.plan;
  const needRoom = () => { if (!room) refuse(`${a} is not a room any unit is set in (see: rooms).`); };
  const entry = () => (d.rooms[a] ??= {});
  needWhy(why);
  if (command === 'kind') {
    needRoom();
    if (!ROOM_TYPES[b]) refuse(`No kind "${b}"; kinds: ${ROOM_TYPE_NAMES.join(', ')}.`);
    if (b !== 'not said') needLine(s, line, room.units, `a unit set in ${a}`);
    entry().kind = { value: b, line: line ?? null, why };
  } else if (command === 'floor') {
    needRoom();
    const value = b === 'ground' ? 1 : b === 'not-said' ? null : Number(b);
    if (b !== 'not-said' && b !== 'ground' && !(Number.isInteger(value) && value >= 1 && value <= 200)) refuse('A floor is a whole number as the text counts it (1 the ground floor), ground, or not-said.');
    if (b !== 'not-said') needLine(s, line, room.units, `a unit set in ${a}`);
    entry().floor = { value, line: line ?? null, why };
  } else if (command === 'part') {
    needRoom();
    if (b !== 'own') {
      const other = rooms.find(r => r.id === b);
      if (!other || b === a) refuse(`${b} is not another room a unit is set in (see: rooms).`);
      if (other.building !== room.building) refuse(`${b} is in another building than ${a}: a part of a room is in its building.`);
      if (d.rooms[b]?.part?.of === a) refuse(`${b} is already part of ${a}: one of the two is the room, the other its part.`);
    }
    needLine(s, line, room.units, `a unit set in ${a}`);
    entry().part = { of: b === 'own' ? null : b, line, why };
  } else if (command === 'opens') {
    needRoom();
    if (!OPENINGS.includes(b)) refuse(`A room opens onto ${OPENINGS.join(', ')}.`);
    if (b !== 'none') needLine(s, line, room.units, `a unit set in ${a}`);
    entry().opens = { value: b, line: line ?? null, why };
  } else if (command === 'at') {
    const unit = a, person = b, feature = c, home = rooms.find(r => r.units.includes(unit));
    if (!home) refuse(`${unit} is not set in a room (see: rooms).`);
    if (!presentOf(s, unit).includes(person)) refuse(`${person} is not present in ${unit}; present: ${presentOf(s, unit).join(', ') || 'no one'}.`);
    if (!FEATURES[feature]) refuse(`No feature "${feature}"; features: ${Object.keys(FEATURES).join(', ')}.`);
    if (feature === 'balcony' && d.rooms[home.id]?.opens?.value !== 'balcony') refuse(`${home.id} has no balcony decided: opens ${home.id} balcony first, with its line.`);
    needLine(s, line, [unit], unit);
    let span = [unit];
    if (through) {
      const i = home.units.indexOf(unit), j = home.units.indexOf(through);
      if (j < 0) refuse(`${through} is not set in ${home.id}.`);
      if (j < i) refuse(`--through ${through} is before ${unit}.`);
      if (j - i > 30) refuse('--through covers at most 30 of the room\'s units at once.');
      span = home.units.slice(i, j + 1).filter(u => presentOf(s, u).includes(person));
    }
    for (const u of span) (d.staging[u] ??= {})[person] = { at: feature, line, why, ...(u !== unit ? { from: unit } : {}) };
    d.log.push({ command, args: [a, b, c], through, line, why, at: new Date().toISOString() });
    return { ok: true, at: [unit, person, feature], units: span.length };
  } else if (command === 'shot') {
    const unit = a, kind = b, inBuilding = buildingUnitsOf(s), home = rooms.find(r => r.units.includes(unit)) ?? (() => { const found = inBuilding.find(entry => entry.unit === unit); return found ? { id: found.room, units: inBuilding.filter(entry => entry.room === found.room).map(entry => entry.unit) } : null; })();
    if (!home) refuse(`${unit} is not set in a room or in the building of one (see: rooms).`);
    if (!SHOTS[kind]) refuse(`No shot "${kind}"; shots: ${Object.keys(SHOTS).join(', ')}.`);
    needLine(s, line, [unit], unit);
    let span = [unit];
    if (through) {
      const i = home.units.indexOf(unit), j = home.units.indexOf(through); if (j < i) refuse(`--through ${through} is not ${unit} or a later unit of ${home.id}.`); if (j - i > 30) refuse('--through covers at most 30 of the room\'s units at once.'); span = home.units.slice(i, j + 1);
      // A shot is chosen for its light: a run filmed alike shares the story's time of day and weather.
      const changed = span.find(u => lightOf(skyOf(s, u)) !== lightOf(skyOf(s, unit)));
      if (changed) refuse(`The light changes at ${changed} (${JSON.stringify(skyOf(s, changed))} after ${JSON.stringify(skyOf(s, unit))}): a shot --through stops before it; decide ${changed} on its own.`);
    }
    for (const u of span) (d.shots ??= {})[u] = { kind, line, why, ...(u !== unit ? { from: unit } : {}) };
    d.log.push({ command, args: [a, b], through, line, why, at: new Date().toISOString() });
    return { ok: true, shot: [unit, kind], units: span.length };
  } else refuse(`Unknown command ${command}.`);
  d.log.push({ command, args: [a, b, c].filter(Boolean), line: line ?? null, why, at: new Date().toISOString() });
  return { ok: true, [command]: [a, b, c].filter(Boolean) };
}

/** What is left: each room's kind, floor and part; each person of each unit set in a room placed in it or elsewhere. */
export function checkOf(s) {
  const rooms = roomsOf(s), d = s.plan, left = [];
  for (const room of rooms) {
    const mine = d.rooms[room.id] ?? {};
    for (const key of ['kind', 'floor', 'part', 'opens']) if (!mine[key]) left.push({ room: room.id, label: room.label, missing: key });
    for (const unit of room.units) { for (const person of presentOf(s, unit)) if (!d.staging[unit]?.[person]) left.push({ unit, room: room.id, person, missing: 'at' }); if (!d.shots?.[unit]) left.push({ unit, room: room.id, missing: 'shot' }); }
  }
  for (const entry of buildingUnitsOf(s)) if (!d.shots?.[entry.unit]) left.push({ unit: entry.unit, room: entry.room, missing: 'shot', building: entry.building });
  return { done: left.length === 0, rooms: rooms.length, units: rooms.reduce((n, r) => n + r.units.length, 0), left: left.length, items: left };
}

export function roomsView(s) {
  const inBuilding = buildingUnitsOf(s);
  return roomsOf(s).map(room => { const mine = s.plan.rooms[room.id] ?? {}; return `${room.id} ${room.label} in ${room.building ?? 'no building'}: ${room.units.length} units (${room.units[0]} … ${room.units.at(-1)}); kind ${mine.kind?.value ?? '?'}, floor ${mine.floor ? mine.floor.value ?? 'not said' : '?'}, part ${mine.part ? mine.part.of ?? 'own' : '?'}, opens ${mine.opens?.value ?? '?'}${inBuilding.some(entry => entry.room === room.id) ? `; its building's other units (filmed on it): ${inBuilding.filter(entry => entry.room === room.id).map(entry => entry.unit).join(' ')}` : ''}`; }).join('\n');
}
export function roomView(s, id) {
  const room = roomsOf(s).find(entry => entry.id === id); if (!room) refuse(`${id} is not a room any unit is set in.`);
  return { ...room, building: room.building ? `${room.building} ${s.script.places[room.building]?.label ?? ''}` : null, decided: s.plan.rooms[id] ?? {}, kinds: ROOM_TYPES,
    firstLines: room.units.slice(0, 6).map(unit => ({ unit, lines: (s.sceneLines.get(unit) ?? []).slice(0, 4).map(line => `${line} ${s.text.get(line)?.text ?? ''}`) })) };
}
export async function stageView(s, unit) {
  const inBuilding = buildingUnitsOf(s).find(entry => entry.unit === unit), room = roomsOf(s).find(r => r.units.includes(unit) || r.id === inBuilding?.room); if (!room) refuse(`${unit} is not set in a room or its building.`);
  const prefilm = await readJson(join(s.novel, '..', 'reading', 'prefilm.json'), null), notes = prefilm?.units?.[unit]?.scriptSupervisor?.digest?.people ?? [];
  // What came before it: the unit before in the book, where it was and its sky; whether this is the room's first unit.
  const order = s.script.scenes.map(scene => scene.id), k = order.indexOf(unit), before = k > 0 ? s.script.scenes[k - 1] : null;
  const previous = before ? { unit: before.id, place: before.place ? `${before.place} ${s.script.places[before.place]?.label ?? ''}` : 'nowhere', inThisRoom: room.units.includes(before.id), sky: skyOf(s, before.id) } : null;
  return { unit, room: `${room.id} ${room.label}`, firstInRoom: room.units[0] === unit, previous, sky: skyOf(s, unit), opens: s.plan.rooms[room.id]?.opens?.value ?? '?', features: FEATURES, shots: SHOTS, shot: s.plan.shots?.[unit] ?? null,
    people: presentOf(s, unit).map(id => ({ id, name: nameOf(s, id), notes: notes.find(note => note.who === id) ?? null, decided: s.plan.staging[unit]?.[id] ?? null })),
    lines: (s.sceneLines.get(unit) ?? []).map(line => `${line} ${s.text.get(line)?.text ?? ''}`) };
}

/** Written whole or not at all (a file beside it, then renamed over it). */
export async function save(s) { const file = join(s.world, 'room-plan.json'), next = `${file}.${process.pid}.tmp`; await writeFile(next, JSON.stringify(s.plan, null, 1)); await rename(next, file); }

/** One decision at a time on a book (an agent may run several commands at once): a lock folder beside the plan, taken
 *  before the plan is read and given back after it is written; a lock older than a minute is a dead one's, and taken. */
async function locked(novelDir, work) {
  const lock = join(novelDir, 'stage', 'world', 'room-plan.lock'), until = Date.now() + 30000;
  for (;;) {
    try { await mkdir(lock); break; }
    catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = await stat(lock).then(info => Date.now() - info.mtimeMs, () => 0);
      if (age > 60000) { await rmdir(lock).catch(() => {}); continue; }
      if (Date.now() > until) throw new Error('The room plan is busy (another decision is being written); try again.');
      await new Promise(done => setTimeout(done, 50 + Math.random() * 100));
    }
  }
  try { return await work(); } finally { await rmdir(lock).catch(() => {}); }
}

export async function run(argv) {
  const [command, novelDir, ...rest] = argv, positional = [], flags = {};
  for (let k = 0; k < rest.length; k++) { if (rest[k].startsWith('--')) { flags[rest[k].slice(2)] = rest[k + 1]; k++; } else positional.push(rest[k]); }
  if (!command || !novelDir) throw new Error('Usage: room-plan <rooms|room|stage|kind|floor|part|opens|at|check> <novel-dir> [args]');
  if (!['rooms', 'room', 'stage', 'check'].includes(command)) return locked(novelDir, async () => { const s = await roomStores(novelDir), decided = decide(s, command, { positional, why: flags.why, line: flags.line, through: flags.through ?? null }); await save(s); return decided; });
  const s = await roomStores(novelDir);
  if (command === 'rooms') return roomsView(s);
  if (command === 'room') return roomView(s, positional[0]);
  if (command === 'stage') return stageView(s, positional[0]);
  if (command === 'check') { const c = checkOf(s); return { ...c, items: c.items.slice(0, 60) }; }
  return null;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try { const out = await run(process.argv.slice(2)); console.log(typeof out === 'string' ? out : JSON.stringify(out, null, 1)); }
  catch (error) { console.log(JSON.stringify({ refused: error.refused ? error.message : undefined, error: error.refused ? undefined : String(error.message ?? error) })); process.exit(error.refused ? 3 : 1); }
}
