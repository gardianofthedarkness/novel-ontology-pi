import { CORRIDOR, STAIR, SKELETON_CELL, FLOOR_HEIGHT, type Skeleton } from "./skeleton.js";

/**
 * A building as structural units, broken by a blast and settled by gravity: the lowest stable shape.
 *
 * Units sit on the skeleton's grid (2 × 2 × 3 m): the corridors and stairs it already has, a wall on every outer cell
 * of every floor, and a roof over the whole footprint. Each kind holds with a bond strength (walls weakest, stairs
 * strongest, none immune).
 *
 * A blast of diameter d and strength s carries E = E₀ · s · (d / 8 m)³: the energy grows with the size chosen, not
 * with what it touches. A unit at distance ρ from the centre (inside the sphere) receives E / (4π max(ρ, ½ m)²): the
 * centre lies inside a unit, so even a small blast breaks what it touches.
 *
 * The shape after it minimizes F = Σ_broken (b_u − e_u) + g Σ m_u y_u over the shapes in which every standing unit has
 * a load path to the ground. Breaking exactly the units whose received energy exceeds their bond minimizes the first
 * sum (`blast`); then every unit without a load path falls straight down onto the first support below (`settle`).
 * Falling only lowers the potential energy and losing a unit never adds support, so one pass reaches the fixed point.
 *
 * A load path: a unit rests on the unit right below it (any kind; the ground holds the ground floor), and slabs
 * (corridors, the roof) and walls reach sideways along their own layer for at most SPAN units from a resting one; a
 * stair also hangs on the corridor beside it, one unit.
 */
export const UNIT = { corridor: 1, stair: 2, wall: 3, roof: 4 } as const;
export type UnitKind = (typeof UNIT)[keyof typeof UNIT];
/** What it takes to break a unit, in blast-energy units: an 8 m blast at full strength breaks walls within 3 m. */
export const BOND: Record<UnitKind, number> = { 1: 2, 2: 4, 3: 1, 4: 1.5 };
/** E₀: so that an 8 m blast at strength 1 breaks a wall (bond 1) out to 3 m: E₀ / (4π · 3²) = 1. */
export const BLAST_ENERGY = 36 * Math.PI;
/** How far a slab or a wall spans sideways from a unit that rests on something. */
export const SPAN = 2;
/** How thick a fallen unit lies once it has come down. */
export const RUBBLE = 0.6;

export interface Structure {
  nx: number; nz: number; floors: number; i0: number; j0: number;
  /** Per unit: its kind (0 where the skeleton has solid mass), and its grid place (k is the floor; the roof is k = floors). */
  kind: Uint8Array; i: Int16Array; j: Int16Array; k: Int16Array;
  /** Where the skeleton's cells end: units below this index are the skeleton's cells, in its order. */
  cells: number;
}

/** A lot's structural units: its skeleton cells, then the walls floor by floor (outer cells in row order), then the roof. */
export function structureOf(lot: { i0: number; j0: number; skeleton: Pick<Skeleton, "nx" | "nz" | "floors" | "cells"> }): Structure {
  const { nx, nz, floors } = lot.skeleton, cells = nx * nz * floors, outer: [number, number][] = [];
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) if (i === 0 || j === 0 || i === nx - 1 || j === nz - 1) outer.push([i, j]);
  const count = cells + outer.length * floors + nx * nz, kind = new Uint8Array(count), ii = new Int16Array(count), jj = new Int16Array(count), kk = new Int16Array(count);
  for (let cell = 0; cell < cells; cell++) { const value = lot.skeleton.cells[cell]; kind[cell] = value === CORRIDOR ? UNIT.corridor : value === STAIR ? UNIT.stair : 0; ii[cell] = cell % nx; jj[cell] = Math.floor(cell / nx) % nz; kk[cell] = Math.floor(cell / (nx * nz)); }
  let n = cells;
  for (let k = 0; k < floors; k++) for (const [i, j] of outer) { kind[n] = UNIT.wall; ii[n] = i; jj[n] = j; kk[n] = k; n++; }
  for (let j = 0; j < nz; j++) for (let i = 0; i < nx; i++) { kind[n] = UNIT.roof; ii[n] = i; jj[n] = j; kk[n] = floors; n++; }
  return { nx, nz, floors, i0: lot.i0, j0: lot.j0, kind, i: ii, j: jj, k: kk, cells };
}

/** Everything standing at first: every unit that is not solid mass. */
export const intact = (structure: Structure) => Uint8Array.from(structure.kind, (kind) => (kind ? 1 : 0));

/** A unit's centre in the place's metres. */
export function unitAt(structure: Structure, unit: number) {
  const kind = structure.kind[unit], k = structure.k[unit];
  const y = kind === UNIT.roof ? k * FLOOR_HEIGHT : kind === UNIT.corridor ? k * FLOOR_HEIGHT + 0.15 : k * FLOOR_HEIGHT + FLOOR_HEIGHT / 2;
  return { x: (structure.i0 + structure.i[unit] + 0.5) * SKELETON_CELL, y, z: (structure.j0 + structure.j[unit] + 0.5) * SKELETON_CELL };
}

/** The units a blast breaks: inside its sphere, wherever the energy reaching a unit exceeds the unit's bond. */
export function blast(structure: Structure, standing: Uint8Array, sphere: { x: number; y: number; z: number; r: number }, strength: number) {
  const energy = BLAST_ENERGY * Math.max(0, strength) * (2 * sphere.r / 8) ** 3, broken: number[] = [];
  for (let unit = 0; unit < standing.length; unit++) {
    if (!standing[unit]) continue;
    const at = unitAt(structure, unit), distance = Math.hypot(at.x - sphere.x, at.y - sphere.y, at.z - sphere.z);
    if (distance > sphere.r) continue;
    if (energy / (4 * Math.PI * Math.max(distance, 0.5) ** 2) > BOND[structure.kind[unit] as UnitKind]) broken.push(unit);
  }
  return { broken, energy };
}

/** Which standing units have a load path to the ground (see the module note): 1 where they do. */
export function supported(structure: Structure, standing: Uint8Array): Uint8Array {
  const { nx, nz, floors, kind, cells } = structure, wallStart = cells, roofStart = cells + (structure.kind.length - cells - nx * nz);
  // Each unit's index by layer and place: skeleton cells, walls (by outer cell), roof.
  const cell = (i: number, j: number, k: number) => (k >= 0 && k < floors && i >= 0 && j >= 0 && i < nx && j < nz ? (k * nz + j) * nx + i : -1);
  const wallIndex = new Map<number, number>();
  for (let unit = wallStart; unit < roofStart; unit++) wallIndex.set((structure.k[unit] * nz + structure.j[unit]) * nx + structure.i[unit], unit);
  const wall = (i: number, j: number, k: number) => (k >= 0 && k < floors ? wallIndex.get((k * nz + j) * nx + i) ?? -1 : -1);
  const roof = (i: number, j: number) => (i >= 0 && j >= 0 && i < nx && j < nz ? roofStart + j * nx + i : -1);
  /** The units right below a unit's place, any kind. */
  const below = (unit: number) => { const i = structure.i[unit], j = structure.j[unit], k = structure.k[unit]; return [cell(i, j, k - 1), wall(i, j, k - 1)].filter((other) => other >= 0); };
  /** Its neighbours in its own layer, which it may span to (a stair: the corridors beside it). */
  const beside = (unit: number) => {
    const i = structure.i[unit], j = structure.j[unit], k = structure.k[unit], steps: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    if (kind[unit] === UNIT.roof) return steps.map(([a, b]) => roof(i + a, j + b));
    if (kind[unit] === UNIT.wall) return steps.map(([a, b]) => wall(i + a, j + b, k));
    return steps.map(([a, b]) => cell(i + a, j + b, k)).filter((other) => other >= 0 && kind[other] === UNIT.corridor);
  };
  // The most span left at each unit: a unit resting on something (or the ground) has all of it; each step sideways uses one.
  const left = new Int8Array(standing.length).fill(-1);
  const rests = (unit: number) => structure.k[unit] === 0 && kind[unit] !== UNIT.roof ? true : kind[unit] === UNIT.roof ? [cell(structure.i[unit], structure.j[unit], floors - 1), wall(structure.i[unit], structure.j[unit], floors - 1)].some((other) => other >= 0 && standing[other] && left[other] >= 0) : below(unit).some((other) => standing[other] && left[other] >= 0);
  for (let changed = true; changed;) {
    changed = false;
    for (let unit = 0; unit < standing.length; unit++) {
      if (!standing[unit] || !kind[unit]) continue;
      let best = rests(unit) ? SPAN : -1;
      const reach = kind[unit] === UNIT.stair ? 1 : SPAN;
      for (const other of beside(unit)) if (other >= 0 && standing[other] && left[other] > 0) best = Math.max(best, Math.min(reach, left[other]) - (kind[unit] === UNIT.stair ? 0 : 1));
      if (best > left[unit]) { left[unit] = best; changed = true; }
    }
  }
  return Uint8Array.from(left, (value, unit) => (standing[unit] && value >= 0 ? 1 : 0));
}

/**
 * Gravity after a blast: every standing unit without a load path falls straight down, landing on the first supported
 * unit below it in its column (or on what has already fallen there, or on the ground), and lies there as rubble.
 */
export function settle(structure: Structure, standing: Uint8Array) {
  const held = supported(structure, standing), after = standing.slice(), fallen: { unit: number; from: number; to: number }[] = [], columns = new Map<number, number[]>();
  for (let unit = 0; unit < standing.length; unit++) if (standing[unit] && !held[unit]) { const column = structure.j[unit] * structure.nx + structure.i[unit]; columns.set(column, [...(columns.get(column) ?? []), unit]); }
  for (const [column, units] of columns) {
    const i = column % structure.nx, j = Math.floor(column / structure.nx);
    units.sort((a, b) => unitAt(structure, a).y - unitAt(structure, b).y);
    let top = -1;
    for (const unit of units) {
      const from = unitAt(structure, unit).y;
      // The highest unit still held below it in this column, else the ground.
      if (top < 0) { top = 0; for (let other = 0; other < standing.length; other++) if (held[other] && structure.i[other] === i && structure.j[other] === j) { const y = unitAt(structure, other).y; if (y < from) top = Math.max(top, y + (structure.kind[other] === UNIT.stair ? FLOOR_HEIGHT / 2 : 0.3)); } }
      fallen.push({ unit, from, to: top }); after[unit] = 0; top += RUBBLE;
    }
  }
  return { standing: after, fallen };
}

/** The skeleton's own standing cells (corridors and stairs) out of a structure's standing units. */
export const skeletonStanding = (structure: Structure, standing: Uint8Array) => standing.slice(0, structure.cells);
