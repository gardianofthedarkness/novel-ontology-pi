// The terrain cast's transport step (docs/v2/highway-research.md §8; roads-and-transit.md stage 2): each city's
// expressway, built from the world as the terrain stands and kept. Kept in the universe's terrain registry
// (universe/terrain.json `highways`, by city: it outlives the book, as slots do), mirrored in the book's terrain for the
// export, and logged in the map's log by book. Run again, a city whose districts are all known keeps its highway as it
// is; a new district may add a link (world-engine/world/highways.mjs planHighway: bounded repair). `--rebuild` forgets
// the kept highways and lays them again.
//
//   node world-engine/terrain/transport.mjs <novel dir> [--rebuild] [--dry]
//
// No model is asked: the line is the map's and the ground's.
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

import { setting } from '../../dist/src/v2/settings.js';
const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = (path) => import(pathToFileURL(`${repository}/${path}`).href);
async function replace(file, body) { const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, body, { mode: 0o644 }); await rename(temporary, file); }

/** A city's inputs for planHighway from a world-only page: its districts (map order), gates, ground. */
export function cityInputs(data, cityId) {
  const node = new Map((data.macro ?? []).map((entry) => [entry.id, entry])), city = node.get(cityId), land = (data.landscapes ?? []).find((entry) => entry.place === cityId);
  if (!city || !land) return null;
  const ancestors = (id) => { const out = []; for (let at = node.get(id); at; at = node.get(at.parent)) out.push(at.id); return out; };
  const chains = (data.scenes ?? []).map((scene) => ancestors(scene.place)), scenesIn = (id) => chains.filter((chain) => chain.includes(id)).length;
  const districts = data.macro.filter((entry) => entry.parent === cityId && entry.scale === 'district').map((d) => ({ id: d.id, x: d.x, z: d.z, r: d.r, scenes: scenesIn(d.id) }));
  const own = new Set(ancestors(cityId)), gates = [];
  for (const other of data.macro.filter((entry) => ((entry.scale === 'region' && entry.parent === null) || entry.scale === 'city') && !own.has(entry.id) && entry.id !== cityId)) {
    const dx = other.x - city.x, dz = other.z - city.z, d = Math.hypot(dx, dz) || 1, at = [city.x + (dx / d) * (city.r - 30), city.z + (dz / d) * (city.r - 30)];
    const near = gates.find((gate) => Math.hypot(gate.x - at[0], gate.z - at[1]) < 300);
    if (near) { near.toward.push(other.id); near.scenes += scenesIn(other.id); continue; }
    gates.push({ id: `gate:${other.id}`, x: at[0], z: at[1], toward: [other.id], scenes: scenesIn(other.id) });
  }
  const districtIds = new Set(districts.map((d) => d.id));
  const ground = { roads: land.roads, waters: land.waters ?? [], patches: land.patches.map(({ id, centre, radius, height, outline }) => ({ id, centre, radius, height, outline })), named: land.patches.filter((patch) => patch.id !== 'p0' && !districtIds.has(patch.id) && patch.radius <= 150).map((patch) => patch.id) };
  return { city: { id: city.id, x: city.x, z: city.z, r: city.r }, districts, gates, ground };
}

export async function terrainTransport(novelDir, { rebuild = false, dry = false, log = (line) => console.error(line) } = {}) {
  const { simStrandList } = await load('dist/src/cli/commands/extract/simCommands.js');
  const { universeOf } = await load('dist/src/v2/extraction/pools.js');
  const { strandDemo } = await import('../world/export-strand-demo.mjs');
  const HW = await import('../world/highways.mjs');
  const [line] = await simStrandList(novelDir);
  if (!line) throw new Error('The transport step needs the world loop\'s line: a world-first book with its world script and staged scenes.');
  const universe = universeOf(novelDir), registryFile = join(universe.dir, 'terrain.json'), terrainFile = join(novelDir, 'stage', 'terrain.json');
  const registry = JSON.parse(await readFile(registryFile, 'utf8').catch(() => 'null')) ?? { version: 1, places: {} };
  const terrain = JSON.parse(await readFile(terrainFile, 'utf8').catch(() => 'null'));
  if (!terrain) throw new Error(`no terrain at ${terrainFile}: build the terrain first`);
  const started = Date.now();
  log(`transport: building the world of ${line.from} to ${line.to}`);
  const data = await strandDemo(novelDir, { from: line.from, to: line.to, worldOnly: true, plain: true, title: 'Transport' });
  const cities = (data.macro ?? []).filter((entry) => entry.scale === 'city' && (data.landscapes ?? []).some((land) => land.place === entry.id));
  const at = new Date().toISOString(), kept = rebuild ? {} : { ...(registry.highways ?? {}) }, out = {}, summary = [];
  for (const city of cities) {
    const inputs = cityInputs(data, city.id);
    if (!inputs || inputs.districts.length < 2) { summary.push({ city: city.id, built: false, why: 'fewer than two districts' }); continue; }
    const t0 = Date.now(), keep = kept[city.id] ?? null, record = HW.planHighway({ ...inputs, keep, at, knobs: setting('highway.knobs', { book: novelDir, place: city.id }) });
    // A city whose districts never pay for a link (no story between them) keeps no highway: nothing stored or logged.
    if (!record.links.length) { summary.push({ city: city.id, op: 'none', links: 0, notLinked: record.notLinked }); log(`transport: ${city.id}: no link pays (${record.notLinked.length} hubs)`); continue; }
    out[city.id] = record;
    const op = record === keep ? 'kept' : keep ? 'repaired' : 'built';
    summary.push({ city: city.id, op, links: record.links.length, notLinked: record.notLinked, deckKm: record.report.deckKm, tunnelKm: record.report.tunnelKm, ramps: record.ramps.length, seconds: Math.round((Date.now() - t0) / 100) / 10 });
    log(`transport: ${city.id} ${op}: ${record.links.length} links, ${record.report.deckKm} km of deck, ${record.report.tunnelKm} km of tunnel, ${record.ramps.length} ramps`);
  }
  if (!dry) {
    registry.highways = { ...(registry.highways ?? {}), ...out };
    terrain.highways = Object.fromEntries(Object.entries(registry.highways).filter(([id]) => cities.some((city) => city.id === id)));
    await mkdir(universe.dir, { recursive: true });
    await replace(registryFile, JSON.stringify(registry, null, 1));
    await replace(terrainFile, JSON.stringify(terrain, null, 1));
    // The map's log (borrow-and-spawn.md §8.8): a highway built or repaired is a change to the map, in order.
    const mapLogFile = join(universe.dir, 'maps', `${universe.book}.json`), mapLog = JSON.parse(await readFile(mapLogFile, 'utf8').catch(() => 'null')) ?? { book: universe.book, entries: [] };
    for (const entry of summary.filter((row) => row.op === 'built' || row.op === 'repaired')) mapLog.entries.push({ n: mapLog.entries.length + 1, at, highway: entry.city, op: entry.op, links: entry.links, deckKm: entry.deckKm, tunnelKm: entry.tunnelKm, ramps: entry.ramps });
    await mkdir(dirname(mapLogFile), { recursive: true }); await replace(mapLogFile, JSON.stringify(mapLog, null, 1));
  }
  return { cities: summary, seconds: Math.round((Date.now() - started) / 100) / 10, written: !dry };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { rebuild: { type: 'boolean' }, dry: { type: 'boolean' } } });
  if (!novelDir) { console.error('usage: node world-engine/terrain/transport.mjs <novel dir> [--rebuild] [--dry]'); process.exit(2); }
  console.log(JSON.stringify(await terrainTransport(resolve(novelDir), { rebuild: !!values.rebuild, dry: !!values.dry }), null, 1));
}
