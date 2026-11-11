// The settei cast (設定, a studio's model sheets; the user, 2026-11-05: "let's build the terrain and ability system ...
// objects needs to be assigned with a shape and size"). A pre-film cast that reads the volume once and writes the sheets
// the runtime casts and physics read:
//
//   abilities  each person's moves (agility, appearing, climbing walls, flight) and attacks (close, along a line, an
//              explosion at a point), each with its limits, from the abilities the reading found (concepts with their
//              owners) and the main characters' own lines; universe/abilities.json, by person (weapons: in props)
//   props      each object's kind (a phone, a robot, a car, a helicopter, a blade…), from which its shape, its size and
//              whether it flies: the vehicles and weapons the reading made slots, its objects, and the things the script
//              supervisor's notes carry; universe/props.json, by label (and slot)
//
// Jev picks each from a fixed list, given the lines the reading cites; nothing here is free text. This file holds the lists
// and the tables that turn an answer into metres, and the questions; engine/casts/run/settei.mjs asks them.

// ── Abilities (the user, 2026-11-05: "the ability should build with weapon system") ─────────────────────────────────
// An ability is two parts. How it moves someone: agility (moving faster and with less effort: the path integral's and
// the smoothing's cost per metre, lowered), appearing somewhere at once (a teleport, mid-air too), going up building
// walls, staying in the air (flight). And how it attacks: up close, along a line (a beam, a bullet, a cannon), or an
// explosion at a point. A weapon has the attack part only. The sheet says what someone can do; when the text has it in
// use is the pre-film notes' (the script supervisor's moves, blocking's journeys, the action director's blows).
export const MOVES = {
  none: 'not a way of moving: it carries no one anywhere',
  agility: 'moves far faster or with far less effort than a person: dashing, bounding, leaping from roof to roof',
  appear: 'appears somewhere else at once (a teleport), on the ground or in the air',
  climb: 'goes up the walls of buildings',
  flight: 'flies, or stays up in the air',
};
export const ATTACKS = {
  none: 'not an attack',
  close: 'hits up close: a fist, a kick, a blade, a touch',
  line: 'hits along a line from afar: a bullet, a beam, a shot, a cannon, something thrown',
  area: 'hits an area round a point: an explosion, a blast, lightning striking a spot',
};
export const AGILITY = { 'a little faster than a person': 1.5, 'about twice as fast': 2, 'about four times as fast': 4, 'ten times or more': 10 };
export const REACH = { 'a few metres': 5, 'tens of metres': 30, 'about a hundred metres': 100, 'hundreds of metres': 400, 'a kilometre or more': 1500 };
export const MIDAIR = { 'in the air too': true, 'only onto the ground or a floor': false };
export const CLIMB = { 'a floor or two': 6, 'up to a rooftop (10–30 m)': 25, 'any building': 300 };
export const HEIGHT = { 'a floor or two': 6, 'up to a rooftop (10–30 m)': 25, 'high over the city (50 m or more)': 80 };
export const CLOSE = { touch: 1, 'an arm or a weapon long (under 3 m)': 3 };
export const RANGE = { 'tens of metres': 30, 'about a hundred metres': 100, 'hundreds of metres': 400, 'a kilometre or more': 1500 };
export const RADIUS = { 'a few metres': 3, 'about ten metres': 10, 'tens of metres': 30, 'a city block (about 80 m)': 80 };
/** The questions of a sheet entry: the move it gives and the attack it gives, then every limit (only the ones that apply are read). */
export const LIMITS = { agility: AGILITY, reach: REACH, midair: MIDAIR, climb: CLIMB, height: HEIGHT, close: CLOSE, range: RANGE, radius: RADIUS };

const r3 = value => Math.round(value * 1000) / 1000;
/** One entry's sheet from Jev's answers: the move (with its limits) and the attack (with its), each with how sure Jev is of its kind. */
export function sheetOf(answers) {
  const value = (key, table, fallback) => table[answers[key]?.value] ?? fallback;
  const moveKind = answers.move?.value, attackKind = answers.attack?.value;
  const move = MOVES[moveKind] && moveKind !== 'none' ? { kind: moveKind, sure: r3(answers.move?.confidence ?? 0),
    ...(moveKind === 'agility' ? { factor: value('agility', AGILITY, 2) } : moveKind === 'appear' ? { reach: value('reach', REACH, 30), midair: value('midair', MIDAIR, false) } : moveKind === 'climb' ? { height: value('climb', CLIMB, 25) } : { height: value('height', HEIGHT, 25) }) } : null;
  const attack = ATTACKS[attackKind] && attackKind !== 'none' ? { kind: attackKind, sure: r3(answers.attack?.confidence ?? 0),
    ...(attackKind === 'close' ? { reach: value('close', CLOSE, 3) } : attackKind === 'line' ? { range: value('range', RANGE, 100) } : { radius: value('radius', RADIUS, 10), range: value('range', RANGE, 100) }) } : null;
  return { move, attack };
}

/** Two sheets of one kind merged (an ability and the person's own lines): the larger of each limit, the surer. */
const merge = (kept, next) => { if (!kept) return { ...next }; const out = { ...kept }; for (const [key, v] of Object.entries(next)) out[key] = typeof v === 'number' ? Math.max(kept[key] ?? 0, v) : typeof v === 'boolean' ? (kept[key] || v) : v; return out; };

/** The abilities file: each person's moves and attacks by kind, the evidence they rest on; a kind under `least` sure held. */
export const SHEET_SURE = 0.5;
export function abilitiesFile(entries, { names = new Map(), at = new Date().toISOString(), model = null, least = SHEET_SURE } = {}) {
  const people = {}, held = [];
  for (const entry of entries) {
    for (const part of ['move', 'attack']) {
      const sheet = entry.sheet?.[part];
      if (!sheet) continue;
      if (sheet.sure < least) { held.push({ who: entry.who, part, ...sheet, evidence: entry.evidence ?? [] }); continue; }
      const person = (people[entry.who] ??= { name: names.get(entry.who) ?? entry.who, move: {}, attack: {}, evidence: [], by: 'settei', model, at });
      const { kind, ...limits } = sheet;
      person[part][kind] = merge(person[part][kind], limits);
      for (const id of entry.evidence ?? []) if (!person.evidence.includes(id)) person.evidence.push(id);
      if (entry.concept && !(person.from ??= []).includes(entry.concept)) person.from.push(entry.concept);
    }
  }
  return { version: 2, least, people, held };
}

// ── Props ───────────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The kinds of objects, each with its shape and its proportions (width, height, depth in metres at its usual size), whether
 * it flies and whether it carries people. The size Jev gives scales the proportions to the longest side it says.
 */
export const KINDS = {
  'a handheld thing': { hint: 'a phone, a camera, a remote, a card, a key, a pen', shape: 'box', dims: [0.15, 0.03, 0.08] },
  'a bag or a box': { hint: 'a bag, a case, a parcel, a box, a container', shape: 'box', dims: [0.5, 0.4, 0.3] },
  'a robot or a machine': { hint: 'a cleaning robot, a vending machine, a device that stands on its own', shape: 'cylinder', dims: [0.6, 0.8, 0.6] },
  furniture: { hint: 'a chair, a table, a bed, a bench, a shelf', shape: 'box', dims: [1.2, 0.8, 0.6] },
  'a sign or a screen': { hint: 'a sign, a board, a screen, a poster, a billboard', shape: 'panel', dims: [1.5, 1, 0.08] },
  'a car': { hint: 'a car, a taxi, a police car', shape: 'box', dims: [4.5, 1.5, 1.9], vehicle: true },
  'a van or a truck': { hint: 'a van, a truck, a lorry, an armoured car', shape: 'box', dims: [6.5, 2.6, 2.4], vehicle: true },
  'a bus': { hint: 'a bus, a coach', shape: 'box', dims: [11, 3, 2.5], vehicle: true },
  'a train or a carriage': { hint: 'a train, a carriage, a monorail, a tram', shape: 'box', dims: [20, 3.4, 3], vehicle: true },
  'a motorbike or a bicycle': { hint: 'a motorbike, a scooter, a bicycle', shape: 'box', dims: [2, 1.1, 0.7], vehicle: true },
  'a helicopter': { hint: 'a helicopter, an observation helicopter', shape: 'capsule', dims: [12, 3.5, 3], vehicle: true, airborne: 40 },
  'an aircraft': { hint: 'a plane, a jet, an airship', shape: 'capsule', dims: [35, 8, 30], vehicle: true, airborne: 150 },
  'a drone': { hint: 'a drone, a small flying machine', shape: 'box', dims: [0.6, 0.25, 0.6], vehicle: true, airborne: 15 },
  'a boat': { hint: 'a boat, a ship, a ferry', shape: 'box', dims: [9, 2.5, 3], vehicle: true },
  'a small weapon': { hint: 'a gun, a knife, a sword, a baton, a dart', shape: 'box', dims: [0.3, 0.12, 0.05] },
  'a heavy weapon': { hint: 'a cannon, a launcher, a turret, a machine gun on a mount', shape: 'cylinder', dims: [3, 1, 1] },
  'part of a building': { hint: 'a door, a window, a wall, a pillar, a stair, a lift', shape: 'panel', dims: [1, 2.2, 0.2] },
  'not a thing': { hint: 'a power, a feeling, a word, a place, a person: nothing to draw', shape: null, dims: null },
};
export const SIZES = { 'fits in a hand': 0.2, 'about an arm long': 0.7, 'about a person': 1.8, 'about a car': 4.5, 'about a bus': 11, 'about a building': 30 };

/** One object's sheet from Jev's answers: its kind, shape, size in metres (its proportions scaled to the size said), flying height. */
export function propOf(answers) {
  const kind = answers.kind?.value, table = KINDS[kind];
  if (!table || !table.shape) return kind === 'not a thing' ? { kind, shape: null } : null;
  const longest = SIZES[answers.size?.value] ?? Math.max(...table.dims), scale = longest / Math.max(...table.dims);
  return {
    kind, shape: table.shape, size: table.dims.map(d => Math.round(d * scale * 100) / 100), ...(table.vehicle ? { vehicle: true } : {}), ...(table.airborne ? { airborne: Math.round(table.airborne * Math.min(3, Math.max(0.5, scale))) } : {}),
    sure: Math.round(Math.min(answers.kind?.confidence ?? 0, answers.size?.confidence ?? 0) * 1000) / 1000,
  };
}

/** Every object to sheet, by label once: the reading's vehicle and weapon slots, its objects, the notes' items; each with up to `most` lines. */
export function propsToAsk({ reading, prefilm = null, most = 2 }) {
  const byLabel = new Map(), add = (label, from, sentences, id = null) => {
    const key = String(label ?? '').trim();
    if (!key) return;
    const entry = byLabel.get(key) ?? byLabel.set(key, { label: key, from: new Set(), sentences: [], ids: [] }).get(key);
    entry.from.add(from); if (id) entry.ids.push(id);
    for (const sentence of sentences) if (sentence && entry.sentences.length < most && !entry.sentences.includes(sentence)) entry.sentences.push(sentence);
  };
  for (const slot of reading.slots ?? []) if (slot.kind === 'vehicle' || slot.kind === 'weapon') add(slot.label, `slot:${slot.kind}`, slot.sentences ?? [], slot.id);
  for (const entity of reading.chart?.entities ?? []) if (['object', 'weapon', 'vehicle'].includes(entity.type)) add(entity.proper?.[0] ?? entity.names?.[0], `entity:${entity.type}`, entity.seen ?? [], entity.id);
  for (const unit of Object.values(prefilm?.units ?? {})) for (const item of unit.scriptSupervisor?.items ?? []) add(item.item, 'item', [item.sentence]);
  return [...byLabel.values()].map(entry => ({ ...entry, from: [...entry.from] }));
}

/** Every ability to ask about: each concept the reading gives a person as its owner, with the lines it is seen in. */
export function abilitiesToAsk({ reading, most = 4 }) {
  const persons = new Set((reading.chart?.entities ?? []).filter(entity => entity.type === 'person').map(entity => entity.id));
  const out = [];
  for (const concept of (reading.chart?.entities ?? []).filter(entity => entity.type === 'concept')) {
    for (const owner of concept.owners ?? []) if (persons.has(owner.id) && (owner.confidence ?? 1) >= 0.5) out.push({ who: owner.id, concept: concept.id, label: concept.proper?.[0] ?? concept.names?.[0] ?? concept.id, sentences: [...new Set([owner.from, concept.first, ...(concept.seen ?? [])].filter(Boolean))].slice(0, most) });
  }
  return out;
}

/** The props file: each label's sheet, and each slot's and entity's by its id. */
/** The kinds that are weapons: their sheet carries an attack (asked of them alone). */
export const WEAPON_KINDS = new Set(['a small weapon', 'a heavy weapon']);
export function propsFile(rows, { at = new Date().toISOString(), model = null } = {}) {
  const labels = {}, ids = {};
  for (const row of rows) { if (!row.prop) continue; labels[row.label] = { ...row.prop, ...(row.attack ? { attack: row.attack } : {}), from: row.from, evidence: row.sentences }; for (const id of row.ids ?? []) ids[id] = row.label; }
  return { version: 1, by: 'settei', model, at, labels, ids };
}
