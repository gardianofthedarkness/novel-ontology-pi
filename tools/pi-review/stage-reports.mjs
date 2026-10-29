import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * The stage reports the Places map reads (view inputs, not canon): each
 * place's picked building (novel stage architecture) and the buildings the
 * story names in each staged scene (novel stage objects). Null before the
 * report exists or when it cannot be read.
 */
const report = (workspace, name) => readFile(resolve(workspace, 'stage', `${name}.json`), 'utf8').then(JSON.parse, () => null);

/** Place id → picked kind or "none". */
export async function readArchitecture(workspace) {
  const picks = (await report(workspace, 'architecture'))?.places;
  return picks ? Object.fromEntries(Object.entries(picks).filter(([, pick]) => typeof pick?.kind === 'string').map(([id, pick]) => [id, pick.kind])) : null;
}

/** Named buildings, one row per mention: {sceneId, name, model (a building kind the stage can draw, or null), size}. */
export async function readStageBuildings(workspace) {
  const scenes = (await report(workspace, 'objects'))?.scenes;
  if (!scenes || typeof scenes !== 'object') return null;
  return Object.entries(scenes).flatMap(([sceneId, entry]) => (Array.isArray(entry?.objects) ? entry.objects : [])
    .filter(thing => thing?.kind === 'building' && typeof thing.name === 'string' && thing.name.trim())
    .map(thing => ({ sceneId, name: thing.name.trim(), model: thing.match?.kind === 'building' && typeof thing.match.id === 'string' ? thing.match.id : null, size: Number.isFinite(thing.size) ? thing.size : null })));
}

const simulationFile = /^[\w.-]+\.json$/;
const cells = list => Array.isArray(list) ? list.filter(Number.isInteger) : [];
/** Structural units `[kind, i, j, k]` (a fallen one also has where it came to rest). */
const units = list => Array.isArray(list) ? list.filter(unit => Array.isArray(unit) && unit.length >= 4 && unit.every(Number.isFinite)) : [];

/**
 * The stage simulation records (stage/simulation/, docs/stage-simulation-records.md), each strand's
 * accepted run, trimmed to what the Places map draws: per place its lots with their skeletons and rooms (the first strand's layout of
 * a place stands), the things placed there, the hits with the cells and units each lot lost, and who
 * moved between places. Null without records.
 */
export async function readSimulation(workspace) {
  const folder = resolve(workspace, 'stage', 'simulation');
  const index = await readFile(resolve(folder, 'index.json'), 'utf8').then(JSON.parse, () => null);
  if (!index?.strands || typeof index.strands !== 'object') return null;
  const strands = [], places = {}, things = [], hits = [], migrations = [];
  for (const [id, entry] of Object.entries(index.strands)) {
    if (!simulationFile.test(String(entry?.file))) continue;
    const record = await readFile(resolve(folder, entry.file), 'utf8').then(JSON.parse, () => null);
    if (!record?.buildings || !Array.isArray(record.scenes)) continue;
    // The strand's accepted run (versioned records: index.json lists every run; <strand>.json is the accepted one).
    const run = record.run && typeof record.run.id === 'string' ? { id: record.run.id, engine: record.run.engine ?? null, inputs: record.run.inputs ?? null } : null;
    strands.push({ id, title: record.strand?.title ?? entry.title ?? id, from: record.strand?.from ?? null, to: record.strand?.to ?? null, run, runs: Array.isArray(entry.runs) ? entry.runs.length : 1 });
    for (const [placeId, place] of Object.entries(record.buildings)) {
      if (places[placeId] || !Array.isArray(place?.lots)) continue;
      places[placeId] = { strand: id, label: place.label, kind: place.kind, grid: { nx: place.grid?.NX ?? 32, nz: place.grid?.NZ ?? 24 },
        lots: place.lots.map(lot => ({ name: lot.detected?.name ?? lot.label ?? null, since: lot.detected?.scene ?? null, label: lot.label ?? null, role: lot.role ?? null, model: lot.model, i0: lot.footprint.i0, j0: lot.footprint.j0, nx: lot.footprint.nx, nz: lot.footprint.nz, floors: lot.floors,
          skeleton: typeof lot.skeleton === 'string' && /^[0-9]*$/.test(lot.skeleton) ? lot.skeleton : '', rooms: Array.isArray(lot.rooms) ? lot.rooms.filter(room => Array.isArray(room) && room.length === 5 && room.every(Number.isInteger)) : [] })) };
    }
    for (const thing of record.things ?? []) things.push({ id: `${id}:${thing.id}`, name: thing.name, model: thing.model ?? null, shape: thing.shape ?? null,
      placements: (thing.placements ?? []).map(placement => ({ scene: placement.scene, place: placement.place, x: placement.x, y: placement.y ?? 0, z: placement.z, w: placement.fit?.w ?? 4, h: placement.fit?.h ?? 4, d: placement.fit?.d ?? 4, turn: placement.fit?.turn ?? 0 })) });
    for (const scene of record.scenes) for (const event of scene.events ?? []) if (event.hit?.sphere) hits.push({ scene: scene.id, place: scene.place, event: event.index, ...event.hit.sphere, strength: event.hit.strength,
      lots: (event.hit.parts ?? []).map(part => ({ lot: part.lot, destroyed: cells(part.destroyedCells), fell: cells(part.fellCells), cutOff: cells(part.cutOffCells), cutRooms: cells(part.cutOffRooms), blasted: units(part.blasted), fallen: units(part.fallen) })),
      things: (event.hitThings ?? []).map(entry => `${id}:${entry.id}`) });
    for (const move of record.migrations ?? []) migrations.push({ scene: move.scene, person: move.person, from: move.from, to: move.to });
  }
  return strands.length ? { strands, places, things, hits, migrations } : null;
}
