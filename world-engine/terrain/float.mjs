// L19 · Floating places (docs/v2/directing/L18-L19-plan.md; the user, 2026-11-05: "move the place using the smoothing").
// The city is part of back-propagation: after a run, its places are moved so that the run's tracks and settings hold,
// changing the city least.
//
//   tracks    a person in two units one after the other at two places: the places pulled together while they stand
//             further apart than the person can go in the time the two units allow (their speed, faster where an
//             agility is in use); measured where its people stand (a place's spot plus a track's `offA`/`offB`, the
//             spawn box's offset from it), which a move carries along;
//   settings  a unit whose text says a kind of ground (high-rise, low houses…) that its place does not stand in: the place
//             pulled toward the nearest ground of that kind (set-dresser.mjs);
//   mass      every place costs its mass times the square of how far it moves (unnamed ones light, named ones heavy,
//             districts and cities fixed); siblings kept clear of each other.
//
// Relaxed by sweeps of gradient steps; each sweep lowers the energy. Pure: places, tracks and pulls in; moves and the
// energy before and after out.

export const MASS = { unnamed: 1, slot: 4, named: 30 };
export const MOVABLE = new Set(['street', 'building', 'room']);

/** The energy of a layout and its gradient: tracks beyond reach (squared excess), setting pulls, mass × displacement². */
export function energyOf(at, { places, tracks, pulls, weights }) {
  const grad = new Map([...at.keys()].map(id => [id, [0, 0]]));
  let tracksE = 0, pullsE = 0, massE = 0;
  for (const track of tracks) {
    const a = standOf(at, track, 'a'), b = standOf(at, track, 'b');
    if (!a || !b) continue;
    const dx = b[0] - a[0], dz = b[1] - a[1], d = Math.hypot(dx, dz) || 1e-9, excess = d - track.reach;
    if (excess <= 0) continue;
    tracksE += weights.track * excess * excess;
    const g = 2 * weights.track * excess / d;
    grad.get(track.a)[0] -= g * dx; grad.get(track.a)[1] -= g * dz; grad.get(track.b)[0] += g * dx; grad.get(track.b)[1] += g * dz;
  }
  for (const pull of pulls) {
    const p = at.get(pull.place);
    if (!p) continue;
    const dx = p[0] - pull.to[0], dz = p[1] - pull.to[1];
    pullsE += weights.setting * (dx * dx + dz * dz);
    grad.get(pull.place)[0] += 2 * weights.setting * dx; grad.get(pull.place)[1] += 2 * weights.setting * dz;
  }
  for (const [id, place] of places) {
    const p = at.get(id), dx = p[0] - place.at[0], dz = p[1] - place.at[1];
    massE += place.mass * (dx * dx + dz * dz);
    grad.get(id)[0] += 2 * place.mass * dx; grad.get(id)[1] += 2 * place.mass * dz;
  }
  return { energy: tracksE + pullsE + massE, tracks: tracksE, pulls: pullsE, mass: massE, grad };
}

/**
 * Relax the layout. `places`: Map id → { at: [x, z], mass, r, parent, movable }; `tracks`: [{ a, b, reach }]; `pulls`:
 * [{ place, to: [x, z] }]. Returns { at: Map id → [x, z], moves: [{ id, from, to, metres }], before, after }.
 */
export function relax({ places, tracks, pulls = [], weights = { track: 1, setting: 0.5 }, sweeps = 400, gap = 4 }) {
  const at = new Map([...places].map(([id, place]) => [id, [...place.at]]));
  const before = energyOf(at, { places, tracks, pulls, weights });
  // A step no larger than the stiffest spring allows (the heaviest pull a place feels), so every sweep lowers the energy.
  const stiff = new Map([...places].map(([id, place]) => [id, 2 * place.mass]));
  for (const track of tracks) for (const id of [track.a, track.b]) if (stiff.has(id)) stiff.set(id, stiff.get(id) + 2 * weights.track);
  for (const pull of pulls) if (stiff.has(pull.place)) stiff.set(pull.place, stiff.get(pull.place) + 2 * weights.setting);
  for (let sweep = 0; sweep < sweeps; sweep++) {
    const { grad } = energyOf(at, { places, tracks, pulls, weights });
    for (const [id, place] of places) {
      if (!place.movable) continue;
      const g = grad.get(id), step = 0.5 / stiff.get(id), p = at.get(id);
      p[0] -= step * g[0]; p[1] -= step * g[1];
    }
    // Siblings kept clear: a moved place pushed off another of its parent's that it would overlap.
    for (const [id, place] of places) {
      if (!place.movable) continue;
      const p = at.get(id);
      for (const [other, sibling] of places) {
        if (other === id || sibling.parent !== place.parent) continue;
        const q = at.get(other), dx = p[0] - q[0], dz = p[1] - q[1], d = Math.hypot(dx, dz), need = place.r + sibling.r + gap;
        if (d < need && d > 1e-6 && Math.hypot(place.at[0] - sibling.at[0], place.at[1] - sibling.at[1]) >= need) { p[0] = q[0] + dx / d * need; p[1] = q[1] + dz / d * need; }
      }
    }
  }
  const after = energyOf(at, { places, tracks, pulls, weights });
  const moves = [...places].filter(([id, place]) => place.movable && Math.hypot(at.get(id)[0] - place.at[0], at.get(id)[1] - place.at[1]) >= 1).map(([id, place]) => ({ id, from: place.at.map(v => Math.round(v * 10) / 10), to: at.get(id).map(v => Math.round(v * 10) / 10), metres: Math.round(Math.hypot(at.get(id)[0] - place.at[0], at.get(id)[1] - place.at[1])) }));
  return { at, moves, before: { energy: Math.round(before.energy), tracks: Math.round(before.tracks), pulls: Math.round(before.pulls) }, after: { energy: Math.round(after.energy), tracks: Math.round(after.tracks), pulls: Math.round(after.pulls), mass: Math.round(after.mass) } };
}

/** Where a track's end stands: its place's spot plus the track's offset there. */
function standOf(at, track, end) { const p = at.get(track[end]), off = track[end === 'a' ? 'offA' : 'offB']; return p && (off ? [p[0] + off[0], p[1] + off[1]] : p); }

/** How many tracks stand beyond reach, and by how much in all (metres). */
export function beyondReach(at, tracks) {
  let count = 0, metres = 0;
  for (const track of tracks) { const a = standOf(at, track, 'a'), b = standOf(at, track, 'b'); if (!a || !b) continue; const excess = Math.hypot(b[0] - a[0], b[1] - a[1]) - track.reach; if (excess > 0) { count++; metres += excess; } }
  return { count, metres: Math.round(metres) };
}
