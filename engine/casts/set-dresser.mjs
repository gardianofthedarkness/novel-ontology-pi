// The set dresser (a pre-film cast; the user, 2026-11-05: "the environment said we are in somewhere that is full of high
// buildings, but the screen shows people are in the suburban area with no sky scrapers"). Each unit's own environment lines
// read into the kind of setting it plays in, picked by Jev from a fixed list; and the city's ground, cell by cell, read into
// the same kinds from its buildings, so a unit's place can be told whether it stands in what its text describes and, when
// not, where the nearest ground that does is (the floating terrain pulls the place there, through the smoothing).

export const SETTINGS = {
  'open ground': 'a square, a car park, an empty lot, a wide crossing: few or no buildings',
  'low houses': 'houses and shops of one to three floors, a quiet residential street',
  'mid-rise streets': 'buildings of four to ten floors, an ordinary city street',
  'high-rise': 'towers and tall buildings over ten floors, skyscrapers, a business district',
  waterside: 'by a river, a canal, the sea, a lake',
  'park or green': 'a park, trees, a garden, a riverbank of grass',
  underground: 'below the street: a subway, an underground passage or mall',
  indoors: 'inside a building: the setting is a room, a hall, a shop, not the street',
  'not said': 'the lines do not say what is around them',
};
/** The settings a stretch of city ground can be told as from its buildings alone. */
export const GROUND_SETTINGS = ['open ground', 'low houses', 'mid-rise streets', 'high-rise'];

/** A cell of the city's ground from its buildings (floors of the lots standing in it, their share of its area). */
export function groundSettingOf({ floors = [], covered = 0 }) {
  if (covered < 0.12 || !floors.length) return 'open ground';
  const sorted = [...floors].sort((a, b) => a - b), tall = sorted[Math.floor(sorted.length * 0.75)];
  return tall > 10 ? 'high-rise' : tall >= 4 ? 'mid-rise streets' : 'low houses';
}

/** The city read cell by cell (`size` m squares): each cell's setting, its centre, how many buildings, their tallest. */
export function groundMap(lots, { size = 60, cell = 2 } = {}) {
  const cells = new Map();
  for (const lot of lots) {
    const x = (lot.i0 + lot.nx / 2) * cell, z = (lot.j0 + lot.nz / 2) * cell, key = `${Math.floor(x / size)},${Math.floor(z / size)}`;
    const entry = cells.get(key) ?? cells.set(key, { floors: [], area: 0, gx: Math.floor(x / size), gz: Math.floor(z / size) }).get(key);
    entry.floors.push(lot.floors ?? lot.height ?? 0); entry.area += lot.nx * lot.nz * cell * cell;
  }
  return [...cells.values()].map(entry => ({ x: (entry.gx + 0.5) * size, z: (entry.gz + 0.5) * size, buildings: entry.floors.length, tallest: Math.max(...entry.floors), setting: groundSettingOf({ floors: entry.floors, covered: entry.area / (size * size) }) }));
}

/** Whether ground matches a setting: the ground's own kinds must match; waterside, park, underground and indoors are not judged here. */
export const judged = setting => GROUND_SETTINGS.includes(setting);

/** The nearest cell of ground of a setting to a point (within `most` m), or null. */
export function nearestOf(map, setting, point, most = 1500) {
  let best = null;
  for (const cell of map) { if (cell.setting !== setting) continue; const d = Math.hypot(cell.x - point[0], cell.z - point[1]); if (d <= most && (!best || d < best.d)) best = { ...cell, d }; }
  return best;
}
