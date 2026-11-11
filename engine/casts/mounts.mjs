// Riding (the user, 2026-11-05: "a riding can be a transporter or a weapon. A rider tied to a person augments that
// person's abilities ... A person can ride with another person too, if it's carried, it obtains the transportation
// abilities of the other character. This could be the same physics system as abilities").
//
// A carrier is anything a person can be tied to for a while: a vehicle they ride, a weapon they hold, another person who
// carries them. Each has a sheet in the abilities' own shape ({ move: { kind: limits }, attack: { kind: limits } }):
//
//   a vehicle  how it carries (a car, a bus, a bike, a boat, a train ride the level ground at their speed; a helicopter,
//              a plane fly) and any attack the prop sheet gives it; seats for so many;
//   a weapon   its attack only (the prop sheet's); held, it seats nobody;
//   a person   their ways of moving only (the settei sheet): who they carry moves as they do; their attacks stay theirs.
//
// A rider's sheet while tied is their own merged with their carriers' (the larger of each limit), so the path integral, the
// smoothing and L21 read one sheet whatever its source. A ridden move goes the carrier's way. Pure: sheets in, sheets out.

/** How each kind of vehicle carries (engine/casts/settei.mjs KINDS): a ride's factor against a run (4 m/s), a flight's height; seats. */
export const CARRIERS = {
  'a car': { move: { ride: { factor: 3, road: true } }, seats: 5 },
  'a van or a truck': { move: { ride: { factor: 2.5, road: true } }, seats: 3 },
  'a bus': { move: { ride: { factor: 2.5, road: true } }, seats: 40 },
  'a train or a carriage': { move: { ride: { factor: 6 } }, seats: 200 },
  'a motorbike or a bicycle': { move: { ride: { factor: 2, road: true } }, seats: 2 },
  'a boat': { move: { ride: { factor: 2 } }, seats: 10 },
  'a helicopter': { move: { flight: { height: 40 } }, seats: 6 },
  'an aircraft': { move: { flight: { height: 150 } }, seats: 200 },
  'a drone': { move: { flight: { height: 15 } }, seats: 0 },
};
/** Someone who carries another (in their arms, on their back, along in a teleport) carries one more. */
export const PERSON_SEATS = 1;

/** A carrier's sheet: a vehicle's by its kind (its flying height the prop's own), a weapon's attack, a person's moves. */
export function carrierSheet({ prop = null, person = null } = {}) {
  if (person) return { kind: 'person', move: { ...(person.move ?? {}) }, attack: {}, seats: PERSON_SEATS };
  if (!prop) return null;
  const table = CARRIERS[prop.kind], attack = prop.attack?.kind ? { [prop.attack.kind]: limitsOnly(prop.attack) } : {};
  if (table) {
    const move = structuredClone(table.move);
    if (move.flight && prop.airborne) move.flight.height = prop.airborne;
    return { kind: 'vehicle', vehicle: prop.kind, move, attack, seats: table.seats };
  }
  return Object.keys(attack).length ? { kind: 'weapon', move: {}, attack, seats: 0 } : null;
}
const limitsOnly = ({ kind, sure, ...limits }) => limits;

/** One sheet of a person's own merged with their carriers': per kind the larger of each limit, `by` the carrier it came from. */
export function mergedSheet(own, carriers = []) {
  const out = { move: {}, attack: {} };
  const take = (part, kind, limits, by) => {
    const kept = out[part][kind];
    if (!kept) { out[part][kind] = { ...limits, by }; return; }
    let better = false;
    for (const [key, value] of Object.entries(limits)) {
      if (typeof value === 'number' && value > (kept[key] ?? -Infinity)) { kept[key] = value; better = true; }
      else if (typeof value === 'boolean' && value && !kept[key]) { kept[key] = true; better = true; }
    }
    if (better) kept.by = by;
  };
  for (const part of ['move', 'attack']) for (const [kind, limits] of Object.entries(own?.[part] ?? {})) take(part, kind, limitsOnly({ kind, ...limits }), 'own');
  for (const { id, sheet } of carriers) if (sheet) for (const part of ['move', 'attack']) for (const [kind, limits] of Object.entries(sheet[part] ?? {})) take(part, kind, limitsOnly({ kind, ...limits }), id);
  return out;
}

/** The order a ridden move takes its carrier's ways in: flying over all, then appearing, riding the ground, walls, speed. */
const RIDDEN = ['flight', 'appear', 'ride', 'climb', 'agility'];
/** A sheet's way of moving as the path integral names it (engine/world/export-strand-demo.mjs specOf, the director's walk). */
export function wayName(kind, limits) {
  if (kind === 'flight') return 'flight';
  if (kind === 'appear') return `teleport:${limits.reach ?? 30}`;
  // A road vehicle (`road`) drives the road graph (engine/world/roads.mjs; the director's walk) where one joins the
  // two ends; a train, a boat or a ride with no road under it goes the walk grid's level ground.
  if (kind === 'ride') return `ride:${limits.factor ?? 3}${limits.road ? ':road' : ''}`;
  if (kind === 'climb') return `climb:${limits.height ?? 25}`;
  if (kind === 'agility') return `agile:${limits.factor ?? 2}`;
  return null;
}
/**
 * The way a move goes. Ridden (`carrier` the sheet of what carries them): the carrier's best way, its own (a car rides, a
 * helicopter flies, a person carries the rider the way they themselves move: `carrierWay` when known). Else the person's
 * own ability the notes have in use (`ability`), from the merged sheet; else `otherwise`.
 */
export function wayOf({ sheet, ability = null, carrier = null, carrierWay = null, otherwise = 'walk' }) {
  if (carrier) {
    if (carrierWay) return carrierWay;
    for (const kind of RIDDEN) if (carrier.move?.[kind]) return wayName(kind, carrier.move[kind]);
    return otherwise;
  }
  if (ability && sheet?.move?.[ability]) return wayName(ability, sheet.move[ability]) ?? otherwise;
  return otherwise;
}

/**
 * L22 · Riding: a rider stands with what carries them, and a carrier carries no more than it seats. `riders` the ids tied to
 * it this moment; `at(id)` where each stands ([x, y, z] metres); `size` the carrier's longest side (metres).
 */
export function rideCheck({ carrier, riders, sheet, at, size = 2 }) {
  const out = [], seats = sheet?.seats ?? 1, p = at(carrier);
  if (riders.length > seats) out.push({ law: 'L22', who: carrier, verdict: 'held', why: `${riders.length} ride, it seats ${seats}` });
  for (const who of riders) {
    const q = at(who);
    if (!p || !q) continue;
    const d = Math.round(Math.hypot(q[0] - p[0], q[2] - p[2], (q[1] - p[1]) * 0.5) * 10) / 10, room = size / 2 + 2;
    out.push(d <= room ? { law: 'L22', who, on: carrier, verdict: 'ok', why: `aboard, ${d} m from its middle` } : { law: 'L22', who, on: carrier, verdict: 'held', why: `${d} m from what carries them (within ${room} m)` });
  }
  return out;
}

// ── The notes: who rides what, and when ────────────────────────────────────────────────────────────────────────────
/** The moves and journeys to ask about: carried, or by a vehicle not their own (a vehicle that moves is its own carrier). */
export function ridesToAsk({ prefilm, vehicles = new Set() }) {
  const out = [];
  for (const [unit, notes] of Object.entries(prefilm?.units ?? {})) {
    const cast = notes.cast ?? [];
    for (const move of notes.scriptSupervisor?.moves ?? []) if ((move.how === 'carried' || move.how === 'vehicle') && !vehicles.has(move.who)) out.push({ unit, cast: 'scriptSupervisor', sentence: move.sentence, who: move.who, how: move.how, with: move.with ?? null, said: [move.motion, move.how, move.to ?? ''].filter(Boolean).join(', '), others: cast.filter(id => id !== move.who) });
    for (const journey of notes.blocking ?? []) if ((journey.manner === 'carried' || journey.manner === 'a vehicle') && !vehicles.has(journey.who)) out.push({ unit, cast: 'blocking', sentence: journey.sentence, who: journey.who, how: journey.manner === 'carried' ? 'carried' : 'vehicle', with: null, said: `${journey.manner} to ${journey.said?.to ?? journey.to ?? '?'}`, others: cast.filter(id => id !== journey.who) });
  }
  return out;
}

/** The file: each ridden move's carrier by `cast|sentence|who` (an id: a person, a slot, or `item:<label>`), a pick under `least` sure left out. */
export function ridesFile({ rows = [], at = new Date().toISOString(), model = null, least = 0.5 }) {
  const out = { version: 1, at, model, least, rides: {}, held: [] };
  for (const row of rows) {
    if (!row.on || row.on === 'nobody') continue;
    if ((row.sure ?? 0) < least) { out.held.push({ key: `${row.cast}|${row.sentence}|${row.who}`, on: row.on, sure: row.sure }); continue; }
    out.rides[`${row.cast}|${row.sentence}|${row.who}`] = { on: row.on, sure: row.sure };
  }
  return out;
}

/** The notes with the rides merged in (a move or journey gains `riding`: the id of what carries them). */
export function withRides(prefilm, rides) {
  if (!prefilm || !rides) return prefilm;
  const units = {};
  for (const [id, notes] of Object.entries(prefilm.units ?? {})) {
    const ss = notes.scriptSupervisor, on = (cast, entry) => rides.rides[`${cast}|${entry.sentence}|${entry.who}`]?.on;
    units[id] = {
      ...notes,
      ...(ss ? { scriptSupervisor: { ...ss, moves: (ss.moves ?? []).map(move => (on('scriptSupervisor', move) ? { ...move, riding: on('scriptSupervisor', move) } : move)) } } : {}),
      ...(notes.blocking ? { blocking: notes.blocking.map(journey => (on('blocking', journey) ? { ...journey, riding: on('blocking', journey) } : journey)) } : {}),
    };
  }
  return { ...prefilm, units };
}

/** A unit's ties: each rider and what carries them, from the line it is first said on (a tie holds to the unit's end). */
export function tiesOf(notes) {
  const ties = new Map();
  for (const entry of [...(notes?.scriptSupervisor?.moves ?? []), ...(notes?.blocking ?? [])]) if (entry.riding && !ties.has(`${entry.who}|${entry.riding}`)) ties.set(`${entry.who}|${entry.riding}`, { who: entry.who, on: entry.riding, sentence: entry.sentence });
  return [...ties.values()];
}
