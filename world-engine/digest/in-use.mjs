// When an ability is in use (the user, 2026-11-05: an ability's moving is "only accounted when text indicates the ability is
// enabled"). The settei sheet says what someone can do; the pre-film casts' notes say when the text has it in use, each on
// the line it rests on:
//
//   the script supervisor's moves and blocking's journeys: whether the line shows the person using a way of moving their
//     sheet gives them (agility, appearing, climbing, flight), asked of Jev for the people who have one;
//   the action director's blows: which of the three attacks each is (up close, along a line, an explosion at a point), by
//     rule from the kind and the shape the action director already noted.
//
// Written beside the reading (in-use.json) and merged into those notes when they are loaded (prefilm.mjs loadPrefilm):
// a move or journey gains `ability`, a blow `attackKind`. Physics and the runtime casts read them there.

const CLOSE = new Set(['hand to hand', 'grapple or throw', 'blade or blunt weapon', 'an ability that cancels']);
const AREA_SHAPES = new Set(['sphere', 'ring', 'wave along the ground', 'rain from above', 'cone']);

/** A blow's attack: close, line or area, from the action director's kind, shape and range. */
export function attackKindOf(blow) {
  if (blow.attack === 'area blast' || AREA_SHAPES.has(blow.shape)) return 'area';
  if (CLOSE.has(blow.attack) || blow.range === 'touch' || blow.range === 'close (under 3 m)') return 'close';
  return 'line';
}

/** The moves and journeys to ask about: those of people whose sheet gives them a way of moving, with that way's kinds. */
export function movesToAsk({ prefilm, abilities }) {
  const out = [];
  for (const [unit, notes] of Object.entries(prefilm?.units ?? {})) {
    for (const move of notes.scriptSupervisor?.moves ?? []) { const kinds = Object.keys(abilities?.people?.[move.who]?.move ?? {}); if (kinds.length && move.motion !== 'still') out.push({ unit, cast: 'scriptSupervisor', sentence: move.sentence, who: move.who, kinds, said: `${move.motion}${move.how ? ` (${move.how})` : ''}${move.to ? `, to ${move.to}` : ''}` }); }
    for (const journey of notes.blocking ?? []) { const kinds = Object.keys(abilities?.people?.[journey.who]?.move ?? {}); if (kinds.length) out.push({ unit, cast: 'blocking', sentence: journey.sentence, who: journey.who, kinds, said: `${journey.manner ?? 'goes'} to ${journey.said?.to ?? journey.to ?? '?'}` }); }
  }
  return out;
}

/** The file: each move's ability in use (none left out) by `cast|sentence|who`, and each blow's attack by `sentence|attacker`. */
export function inUseFile({ moves = [], prefilm, at = new Date().toISOString(), model = null, least = 0.5 }) {
  const out = { version: 1, at, model, least, moves: {}, attacks: {} };
  for (const row of moves) if (row.kind && row.kind !== 'none' && (row.sure ?? 0) >= least) out.moves[`${row.cast}|${row.sentence}|${row.who}`] = { kind: row.kind, sure: row.sure };
  for (const notes of Object.values(prefilm?.units ?? {})) for (const blow of notes.actionDirector ?? []) out.attacks[`${blow.sentence}|${blow.attacker}`] = { kind: attackKindOf(blow), attack: blow.attack, shape: blow.shape, range: blow.range };
  return out;
}

/** The notes with what is in use merged in (a move or journey gains `ability`, a blow `attackKind`). */
export function withInUse(prefilm, inUse) {
  if (!prefilm || !inUse) return prefilm;
  const units = {};
  for (const [id, notes] of Object.entries(prefilm.units ?? {})) {
    const ss = notes.scriptSupervisor;
    units[id] = {
      ...notes,
      ...(ss ? { scriptSupervisor: { ...ss, moves: (ss.moves ?? []).map(move => { const used = inUse.moves[`scriptSupervisor|${move.sentence}|${move.who}`]; return used ? { ...move, ability: used.kind } : move; }) } } : {}),
      ...(notes.blocking ? { blocking: notes.blocking.map(journey => { const used = inUse.moves[`blocking|${journey.sentence}|${journey.who}`]; return used ? { ...journey, ability: used.kind } : journey; }) } : {}),
      ...(notes.actionDirector ? { actionDirector: notes.actionDirector.map(blow => ({ ...blow, attackKind: inUse.attacks[`${blow.sentence}|${blow.attacker}`]?.kind ?? attackKindOf(blow) })) } : {}),
    };
  }
  return { ...prefilm, units };
}
