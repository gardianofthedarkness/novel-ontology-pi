// A top-down map picture of the world around a point, for Jev's box questions (docs/world-first-design.md §7–8): where
// someone starts, where a nominated room is, where a group gathers. North is up and one picture is `2 × radius` metres
// across. It shows the ground (dark), the roads (grey), every lot standing there (blue, darker the taller, with its
// outline), and the people already placed (red dots), so Jev can place someone among them. With a `floor`, it is a slice
// of the buildings at that floor: each one's rooms (light, outlined), its corridors and stairs (mid-grey), and a building
// too low to reach it as its roof, so a box on it picks a room. With `under` (one of Jev's three underground choices, docs/
// underground-design.md §6.1), it is what lies there from above: the halls of that choice by kind (and every building's
// basement just under the street), with their pillars, in the dark of the ground. Plain Node: a small PNG writer, no browser.
import { deflateSync } from 'node:zlib';
import { CORRIDOR, MASS, cellIndex } from '../dist/apps/playground/src/data/skeleton.js';
import { basementsOf } from '../dist/apps/playground/src/data/world.js';
import { boundsOf, inHall, intervalsOf, pillarAt } from '../dist/src/ground/stage/underground.js';

/** The halls' colours on a picture underground: the subway, a mall, the storm water, a deep facility, a basement. */
const HALL_COLOUR = { station: [110, 210, 225], tunnel: [80, 170, 190], mall: [230, 190, 110], tank: [110, 150, 235], channel: [90, 130, 220], lab: [235, 140, 160], military: [215, 120, 120], quantum: [200, 150, 235] };
const BASEMENT = [160, 145, 235];

const CRC = Int32Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = bytes => { let c = -1; for (const byte of bytes) c = CRC[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => { const out = Buffer.alloc(12 + data.length); out.writeUInt32BE(data.length, 0); out.write(type, 4, 'ascii'); data.copy(out, 8); out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length); return out; };

/** An RGB picture (`rgb`: width × height × 3 bytes, rows top first) as a PNG. */
export function encodePng(width, height, rgb) {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  for (let y = 0; y < height; y++) rgb.copy(raw, y * (width * 3 + 1) + 1, y * width * 3, (y + 1) * width * 3);
  const head = Buffer.alloc(13);
  head.writeUInt32BE(width, 0); head.writeUInt32BE(height, 4); head[8] = 8; head[9] = 2;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', head), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const toSegment = (x, z, [ax, az], [bx, bz]) => { const dx = bx - ax, dz = bz - az, t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / (dx * dx + dz * dz || 1))); return Math.hypot(x - ax - t * dx, z - az - t * dz); };

/**
 * The map around (x, z), `radius` metres each way, `size` pixels square. `people`: points [x, z] already placed. Returns
 * the PNG (base64) and how to read a box on it back into the world (`at(box)`: the box's middle in metres).
 */
export function mapPicture(world, { x, z, radius = 48, size = 384, people = [], floor = null, under = null }) {
  const rgb = Buffer.alloc(size * size * 3), metres = radius * 2, x0 = x - radius, z0 = z - radius, scale = size / metres;
  const halls = under ? (world.source.underground?.halls ?? []).filter(hall => intervalsOf(hall).includes(under)).map(hall => ({ hall, b: boundsOf(hall) })).filter(({ b }) => b.x1 >= x0 && b.x0 <= x0 + metres && b.z1 >= z0 && b.z0 <= z0 + metres) : [];
  const paint = (px, py, [r, g, b]) => { if (px < 0 || py < 0 || px >= size || py >= size) return; const at = (py * size + px) * 3; rgb[at] = r; rgb[at + 1] = g; rgb[at + 2] = b; };
  const roads = world.source.roads.filter(road => toSegment(x, z, road.a, road.b) <= radius * 1.5 + road.width);
  for (let py = 0; py < size; py++) for (let px = 0; px < size; px++) {
    const wx = x0 + (px + 0.5) / scale, wz = z0 + (py + 0.5) / scale;
    // Underground, the roads are the subway's tunnels (none reach the deep level); above, the streets.
    // Underground, the roads are the subway's tunnels (amber where an underground mall runs), the wide ones the storm-water
    // channels; the tanks are wide halls; none reach the deep level. Above, the streets.
    if (under) {
      // Underground: the dark of the ground, and the halls of this choice (a pillar darker) where they lie.
      const hall = halls.find(entry => wx >= entry.b.x0 && wx <= entry.b.x1 && wz >= entry.b.z0 && wz <= entry.b.z1 && inHall(entry.hall, [wx, wz]))?.hall;
      paint(px, py, hall ? (pillarAt(hall, [wx, wz]) ? HALL_COLOUR[hall.kind].map(value => value * 0.45) : HALL_COLOUR[hall.kind]) : [18, 20, 24]);
      continue;
    }
    paint(px, py, roads.some(road => toSegment(wx, wz, road.a, road.b) <= road.width / 2) ? [96, 102, 110] : [34, 40, 46]);
  }
  const cellBox = (lot, i0, j0, i1, j1, fill, edge) => {
    const [p0, q0, p1, q1] = [Math.floor(((lot.i0 + i0) * 2 - x0) * scale), Math.floor(((lot.j0 + j0) * 2 - z0) * scale), Math.ceil(((lot.i0 + i1 + 1) * 2 - x0) * scale), Math.ceil(((lot.j0 + j1 + 1) * 2 - z0) * scale)];
    for (let py = q0; py < q1; py++) for (let px = p0; px < p1; px++) paint(px, py, edge && (px === p0 || px === p1 - 1 || py === q0 || py === q1 - 1) ? edge : fill);
  };
  for (const lot of world.lots) {
    const lx0 = lot.i0 * 2, lz0 = lot.j0 * 2, lx1 = lx0 + lot.nx * 2, lz1 = lz0 + lot.nz * 2;
    if (lx1 < x0 || lx0 > x0 + metres || lz1 < z0 || lz0 > z0 + metres) continue;
    if (under) {
      // Just under the street, every building's basement under its footprint (violet), unless a hall of this choice is drawn there.
      if (under === 'shallow' && basementsOf(lot)) cellBox(lot, 0, 0, lot.nx - 1, lot.nz - 1, BASEMENT, [90, 80, 160]);
      continue;
    }
    if (floor !== null) {
      // The slice at this floor: too low, its roof; else its walls, corridors and stairs, then its rooms.
      if (lot.floors <= floor) { cellBox(lot, 0, 0, lot.nx - 1, lot.nz - 1, [70, 74, 80], [110, 116, 124]); continue; }
      cellBox(lot, 0, 0, lot.nx - 1, lot.nz - 1, [22, 30, 44], [150, 200, 240]);
      for (let j = 0; j < lot.nz; j++) for (let i = 0; i < lot.nx; i++) if (lot.skeleton.cells[cellIndex(lot.skeleton, i, j, floor)] !== MASS) cellBox(lot, i, j, i, j, lot.skeleton.cells[cellIndex(lot.skeleton, i, j, floor)] === CORRIDOR ? [92, 104, 118] : [120, 110, 90], null);
      for (const room of lot.rooms ?? []) if (room.floor === floor) cellBox(lot, room.i0, room.j0, room.i1, room.j1, [196, 214, 232], [60, 90, 130]);
      continue;
    }
    const shade = Math.max(70, 210 - Math.min(lot.height ?? lot.floors, 40) * 4), fill = [40, Math.round(shade * 0.6), shade], edge = [150, 200, 240];
    const [p0, q0, p1, q1] = [Math.floor((lx0 - x0) * scale), Math.floor((lz0 - z0) * scale), Math.ceil((lx1 - x0) * scale), Math.ceil((lz1 - z0) * scale)];
    for (let py = q0; py < q1; py++) for (let px = p0; px < p1; px++) paint(px, py, px === p0 || px === p1 - 1 || py === q0 || py === q1 - 1 ? edge : fill);
  }
  for (const [px, pz] of people) {
    const cx = Math.round((px - x0) * scale), cy = Math.round((pz - z0) * scale);
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) if (dx * dx + dy * dy <= 16) paint(cx + dx, cy + dy, [235, 70, 80]);
  }
  return {
    png: encodePng(size, size, rgb).toString('base64'),
    legend: floor === null && !under ? `A map from above, north up, ${metres} m across: dark is open ground, grey are roads, blue blocks are buildings (darker is taller), red dots are people already there.`
      : under === 'shallow' ? `What lies just under the street, from above, north up, ${metres} m across: violet boxes are the basements under buildings, amber an underground mall, blue the top of a storm-water tank, darker squares pillars, the rest is ground; red dots are people already down here.`
      : under === 'subway' ? `The subway, 12 m down, from above, north up, ${metres} m across: light teal boxes are stations (a platform with a concourse at each end), darker teal bands the tunnels between them, darker squares pillars, the rest is ground; red dots are people already down here.`
      : under === 'deep' ? `Deep underground, from above, north up, ${metres} m across: blue are the storm-water tank and its channels, pink and red boxes deep facilities (labs, military bunkers, quantum research), darker squares pillars, the rest is rock; red dots are people already down here.`
      : `A slice through the buildings at floor ${floor + 1}, from above, north up, ${metres} m across: light outlined boxes are rooms, mid-grey are corridors and stairs, grey blocks are roofs of buildings too low to reach this floor, red dots are people already on this floor.`,
    at: box => ({ x: x0 + ((box.left + box.right) / 2) * metres, z: z0 + ((box.top + box.bottom) / 2) * metres, w: (box.right - box.left) * metres, d: (box.bottom - box.top) * metres }),
  };
}
