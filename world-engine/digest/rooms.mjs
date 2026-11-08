// The architect's rooms (the user, 2026-11-06: "Architect should pick a room type when conversation happens in a room").
// When a conversation plays in a room of a building, Jev picks what kind of room it is from a fixed list (the text, the
// building, its floor); the room is then furnished by its kind from the CC0 furniture kit (KayKit Furniture Bits, baked by
// apps/playground/tools/furniture-models.mjs into furnitureModels.json, in metres). Pure: a room's size in, its furniture out.

/** The kinds of room Jev picks from, each with the words it is told. */
export const ROOM_TYPES = {
  classroom: 'desks in rows facing the front: a school classroom, a lecture room',
  office: 'desks, chairs and cabinets: a workplace, a staff room, a principal\'s or a manager\'s office',
  'meeting room': 'one long table with chairs round it: a conference or interview room',
  bedroom: 'a bed: a bedroom, a dormitory room, a hotel room',
  'living room': 'a sofa, a low table, armchairs: a family\'s or a flat\'s main room',
  'kitchen or dining room': 'a table with chairs, cupboards along a wall',
  'café or restaurant': 'small tables with chairs, people eating or drinking',
  bar: 'a counter with stools, a few small tables',
  shop: 'shelves and counters of goods: a store, a convenience store, a boutique',
  'hospital room': 'beds in a row: a ward, an infirmary, a clinic',
  laboratory: 'long benches and cabinets: a research lab, a workshop',
  'library or study': 'shelves of books, a reading table',
  'lobby or hall': 'a few armchairs and plants: an entrance hall, a waiting room, a corridor\'s end',
  storage: 'cabinets and stacked things: a store room, a warehouse room',
  cell: 'almost bare, a bed at most: a cell, a holding room, an empty room',
  'control room': 'consoles along the walls with chairs: a control or security room',
  'not said': 'the lines do not say what the room is',
};
export const ROOM_TYPE_NAMES = Object.keys(ROOM_TYPES);

// Each kind's furniture as rules (the kit's model names), from the walls in: `wall` items stand along the walls facing in,
// `grid` items fill the floor in rows, `centre` one in the middle, `around` chairs round the last centred table.
const RECIPES = {
  classroom: [{ grid: ['table_small', 'chair_A'], pitch: [1.6, 1.8] }, { front: 'table_medium' }],
  office: [{ wall: ['table_medium', 'cabinet_medium', 'table_medium', 'shelf_A_big', 'cabinet_small'], chair: 'chair_A' }, { corner: 'lamp_standing' }],
  'meeting room': [{ centre: 'table_medium_long' }, { around: 'chair_A' }, { corner: 'cactus_medium_A' }],
  bedroom: [{ back: 'bed_single_A', large: 'bed_double_A' }, { wall: ['cabinet_small', 'shelf_A_small'] }, { centre: 'rug_oval_A' }, { corner: 'lamp_standing' }],
  'living room': [{ back: 'couch_pillows' }, { centre: 'table_low' }, { wall: ['armchair', 'shelf_B_large_decorated', 'armchair'] }, { under: 'rug_rectangle_stripes_A' }, { corner: 'lamp_standing' }, { corner: 'cactus_medium_B' }],
  'kitchen or dining room': [{ centre: 'table_medium' }, { around: 'chair_B_wood' }, { wall: ['cabinet_medium', 'cabinet_medium', 'cabinet_small'] }],
  'café or restaurant': [{ grid: ['table_small', 'chair_A_wood', 'chair_A_wood'], pitch: [2.4, 2.4], pairs: true }, { corner: 'cactus_small_A' }],
  bar: [{ wall: ['cabinet_medium', 'cabinet_medium', 'cabinet_medium'], stools: 'chair_stool' }, { grid: ['table_small', 'chair_stool'], pitch: [2.4, 2.4], away: 2.2 }],
  shop: [{ wall: ['cabinet_medium_decorated', 'shelf_B_large_decorated', 'cabinet_medium_decorated', 'shelf_B_large_decorated'] }, { centre: 'table_medium' }],
  'hospital room': [{ row: 'bed_single_B', beside: 'cabinet_small' }, { corner: 'chair_C' }],
  laboratory: [{ grid: ['table_medium_long', 'chair_stool'], pitch: [3.2, 2.6] }, { wall: ['cabinet_medium', 'cabinet_medium'] }],
  'library or study': [{ wall: ['shelf_A_big', 'shelf_A_big', 'shelf_A_big', 'shelf_A_big', 'shelf_A_big'] }, { centre: 'table_medium_long' }, { around: 'chair_B' }],
  'lobby or hall': [{ wall: ['armchair', 'table_small', 'armchair'] }, { corner: 'cactus_medium_A' }, { corner: 'cactus_medium_B' }, { wall: ['pictureframe_large_A'] }],
  storage: [{ wall: ['cabinet_medium', 'cabinet_medium', 'cabinet_small', 'cabinet_medium', 'cabinet_small'] }, { grid: ['cabinet_small'], pitch: [2.2, 2.2] }],
  cell: [{ back: 'bed_single_B' }],
  'control room': [{ wall: ['table_medium_long', 'table_medium_long', 'cabinet_medium'], chair: 'chair_C' }],
  'not said': [],
};
/** Every model a recipe can use (to bake and to put on a page). */
export const FURNITURE_MODELS = [...new Set(Object.values(RECIPES).flatMap(rules => rules.flatMap(rule => Object.values(rule).flat().filter(value => typeof value === 'string'))))].sort();

const seeded = seed => { let h = 2166136261; for (const c of String(seed)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return () => ((h = Math.imul(h ^ (h >>> 15), 2246822507) ^ Math.imul(h ^ (h >>> 13), 3266489909)) >>> 0) / 4294967296; };

/**
 * A room furnished by its kind: `w` × `d` metres (its plan's sides: u along w, v along d, from its corner), `sizes` the baked
 * models' footprints ({ name: [x, y, z] } metres, the model facing +z), `seed` its own. Returns [{ model, u, v, angle }]:
 * each piece's middle, metres from the room's corner, and its turn about the vertical (0 faces +v). Pieces never overlap,
 * keep 0.25 m off the walls and leave a 1.2 m way across the room's middle line; what does not fit is left out.
 */
export function furnish(type, w, d, sizes, seed = type) {
  const rules = RECIPES[type] ?? [], out = [], taken = [], rng = seeded(seed), margin = 0.25;
  const foot = (model, angle) => { const [x, , z] = sizes[model] ?? [1, 1, 1], turned = Math.abs(Math.sin(angle)) > 0.5; return turned ? [z, x] : [x, z]; };
  const free = (u, v, fw, fd) => u - fw / 2 >= margin - 1e-6 && v - fd / 2 >= margin - 1e-6 && u + fw / 2 <= w - margin + 1e-6 && v + fd / 2 <= d - margin + 1e-6 && taken.every(t => u + fw / 2 <= t[0] - t[2] / 2 + 0.05 || u - fw / 2 >= t[0] + t[2] / 2 - 0.05 || v + fd / 2 <= t[1] - t[3] / 2 + 0.05 || v - fd / 2 >= t[1] + t[3] / 2 - 0.05);
  const put = (model, u, v, angle, { under = false } = {}) => {
    if (!sizes[model]) return false;
    const [fw, fd] = foot(model, angle);
    if (!under && !free(u, v, fw, fd)) return false;
    if (under && (u - fw / 2 < margin || v - fd / 2 < margin || u + fw / 2 > w - margin || v + fd / 2 > d - margin)) return false;
    out.push({ model, u: round(u), v: round(v), angle: round(angle) });
    if (!under) taken.push([u, v, fw, fd]);
    return true;
  };
  // The walls, as segments to walk along: the back wall (v = d) first, then the sides, then the front; each with the angle a
  // piece against it faces into the room.
  const walls = [
    { from: [0, d], dir: [1, 0], length: w, angle: Math.PI, inward: [0, -1] },
    { from: [0, 0], dir: [0, 1], length: d, angle: Math.PI / 2, inward: [1, 0] },
    { from: [w, 0], dir: [0, 1], length: d, angle: -Math.PI / 2, inward: [-1, 0] },
    { from: [0, 0], dir: [1, 0], length: w, angle: 0, inward: [0, 1] },
  ];
  const againstWall = (model, wall, at) => { const [, fd] = foot(model, 0), depth = fd / 2 + margin + 0.02; return [wall.from[0] + wall.dir[0] * at + wall.inward[0] * depth, wall.from[1] + wall.dir[1] * at + wall.inward[1] * depth]; };
  let lastTable = null;
  for (const rule of rules) {
    if (rule.back) { const model = rule.large && w * d >= 14 && sizes[rule.large] ? rule.large : rule.back, [, fd] = foot(model, 0); put(model, w / 2, d - margin - fd / 2 - 0.02, Math.PI); }
    if (rule.front) { const [, fd] = foot(rule.front, 0); put(rule.front, w / 2, margin + fd / 2 + 0.3, 0); }
    if (rule.centre) { if (put(rule.centre, w / 2, d / 2, w >= d ? 0 : Math.PI / 2)) lastTable = out.at(-1); }
    if (rule.under) put(rule.under, w / 2, d / 2, w >= d ? 0 : Math.PI / 2, { under: true });
    if (rule.around && lastTable) {
      const [tw, td] = foot(lastTable.model, lastTable.angle), [cw, cd] = foot(rule.around, 0), gap = 0.15;
      for (const [du, dv, angle] of [[0, -(td / 2 + cd / 2 + gap), 0], [0, td / 2 + cd / 2 + gap, Math.PI], [-(tw / 2 + cw / 2 + gap), 0, Math.PI / 2], [tw / 2 + cw / 2 + gap, 0, -Math.PI / 2]])
        for (const shift of tw > 2 && !du ? [-tw / 4, tw / 4] : [0]) put(rule.around, lastTable.u + du + (du ? 0 : shift), lastTable.v + dv, angle);
    }
    if (rule.corner) { const [fw, fd] = foot(rule.corner, 0), corners = [[margin + fw / 2, d - margin - fd / 2], [w - margin - fw / 2, d - margin - fd / 2], [margin + fw / 2, margin + fd / 2], [w - margin - fw / 2, margin + fd / 2]]; for (const [u, v] of corners.sort(() => rng() - 0.5)) if (put(rule.corner, u, v, 0)) break; }
    if (rule.wall) {
      // Along the walls in turn, each piece where it first fits, a chair in front of a desk when the rule has one.
      let n = 0;
      for (const wall of walls) {
        for (let at = 0.9; at < wall.length - 0.6 && n < rule.wall.length; at += 0.25) {
          const model = rule.wall[n], [fw] = foot(model, 0), [u, v] = againstWall(model, wall, at + fw / 2);
          if (!put(model, u, v, wall.angle)) continue;
          at += fw + 0.2; n++;
          const seat = rule.chair ?? rule.stools;
          if (seat && /table|cabinet/.test(model)) { const [, fd] = foot(model, 0), [, cd] = foot(seat, 0); put(seat, u + wall.inward[0] * (fd / 2 + cd / 2 + 0.1), v + wall.inward[1] * (fd / 2 + cd / 2 + 0.1), wall.angle + Math.PI); }
        }
      }
    }
    if (rule.row) {
      // Beds side by side along the back wall, a cabinet beside each.
      const [bw, bd] = foot(rule.row, Math.PI);
      for (let u = margin + bw / 2; u + bw / 2 <= w - margin; u += bw + 1.2) { if (put(rule.row, u, d - margin - bd / 2 - 0.02, Math.PI) && rule.beside) put(rule.beside, u + bw / 2 + 0.6, d - margin - 0.5, Math.PI); }
    }
    if (rule.grid) {
      // Rows facing the front (−v): the first model, the others behind it (a desk and its chair) or either side (pairs).
      // A shallow room (under 4 m) takes one row from its front wall in; a deeper one leaves the front free.
      const [pu, pv] = rule.pitch, [main, ...seats] = rule.grid, [, mainDepth] = foot(main, 0), shallow = d < 4;
      const first = shallow ? margin + mainDepth / 2 + 0.02 : Math.max((rule.away ?? 0) + 1.2, 1.5);
      for (let v = first; shallow ? v === first : v + pv / 2 <= d - 0.4; v += pv) for (let u = 1.0; u + 0.6 <= w - 0.4; u += pu) {
        if (!put(main, u, v, 0)) continue;
        const [, fd] = foot(main, 0);
        seats.forEach((seat, k) => { const [, cd] = foot(seat, 0); if (rule.pairs) put(seat, u, v + (k ? -1 : 1) * (fd / 2 + cd / 2 + 0.05), k ? 0 : Math.PI); else put(seat, u, v + fd / 2 + cd / 2 + 0.05, Math.PI); });
      }
    }
  }
  // Nothing fitted (a narrow strip of a room): a line of the kind's first piece along its long side, at its middle.
  const firstModel = rules.flatMap(rule => Object.values(rule).flat().filter(value => typeof value === 'string' && sizes[value]))[0];
  if (!out.length && firstModel) {
    const along = w >= d, length = along ? w : d, [fw] = foot(firstModel, 0);
    for (let at = margin + fw / 2 + 0.3; at + fw / 2 <= length - margin; at += fw + 0.8) put(firstModel, along ? at : w / 2, along ? d / 2 : at, along ? 0 : Math.PI / 2);
  }
  return out;
}
const round = value => Math.round(value * 100) / 100;
