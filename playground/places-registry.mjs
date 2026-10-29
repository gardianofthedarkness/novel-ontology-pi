/**
 * The places registry: what the Places page shows, assembled from the world each story line's accepted run built, so the
 * page never fills anything itself. Per book, under stage/simulation/places/:
 *   index.json            the canvas of places (each place's circle, parent and depth, as the latest accepted run that
 *                         built it laid it); each place's ground (its roads and walls) and its manifolds in birth order
 *                         (each patch of its landscape: its type, era, birth, centre, radius and outline, and the version of its fill); and
 *                         every nominated building: the reviewed buildings of the ontology on the lots they borrowed, and
 *                         the staged buildings on the canvas;
 *   fills/<version>.json  one fill (a manifold's buildings, or a place's ground) in its place's own metres, named by its
 *                         content, so a version is written once and never changes; a place pushed on the canvas moves its
 *                         fills without new versions, and a new patch adds a fill without touching the older ones'.
 * A manifold is one patch of a place's landscape as the world engine filled it (its fingerprint: the patch, the older
 * patches that cut its ground, the recipe). When a run's data does not say which patch each building stands on, a place's
 * landscape counts as one manifold carrying every patch's type. Derived view data, never canon; private with the book.
 */
import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const PLACES_VERSION = 1;
const round = value => Math.round(value * 10) / 10;
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 12);

async function replace(file, body) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, body, { mode: 0o644 });
  await rename(temporary, file);
}

/** The reviewed buildings of the ontology, by every name they go by: `{ id, name }` per name. */
async function nominatedNames(novelDir) {
  const rows = (await readFile(join(novelDir, 'ontology', 'entities.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => { try { return JSON.parse(line); } catch { return null; } }).filter(Boolean);
  const names = new Map();
  for (const entity of rows) {
    if (entity.kind !== 'Location' || !entity.properties?.building) continue;
    const canonical = entity.names?.find(name => name.kind === 'canonical')?.text ?? entity.names?.[0]?.text ?? entity.id;
    for (const name of entity.names ?? []) if (name?.text && !names.has(name.text)) names.set(name.text, { id: entity.id, name: canonical });
  }
  return names;
}

/** Each line's accepted run that kept the player's data, oldest first (a later run's world is the latest). */
async function acceptedRuns(novelDir) {
  const folder = join(novelDir, 'stage', 'simulation'), index = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8').catch(() => 'null'));
  const runs = [];
  for (const [strand, entry] of Object.entries(index?.strands ?? {})) {
    const run = Array.isArray(entry?.runs) ? entry.runs.find(item => item.id === entry.accepted) : null;
    if (!run?.page || !/^runs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.page\.json$/.test(run.page)) continue;
    const data = JSON.parse(await readFile(join(folder, run.page), 'utf8').catch(() => 'null'));
    if (data?.macro && Array.isArray(data.landscapes)) runs.push({ strand, run: run.id, exportedAt: run.exportedAt ?? data.exportedAt ?? '', engine: run.engine ?? null, data });
  }
  return runs.sort((first, second) => String(first.exportedAt).localeCompare(String(second.exportedAt)));
}

/** The registry from the book's accepted runs, written under stage/simulation/places/; returns its index (null without world runs). */
export async function buildPlaces(novelDir) {
  const runs = await acceptedRuns(novelDir);
  if (!runs.length) return null;
  const folder = join(novelDir, 'stage', 'simulation', 'places'), names = await nominatedNames(novelDir);
  await mkdir(join(folder, 'fills'), { recursive: true });
  const places = new Map(), fills = new Map(), named = new Map();
  for (const { strand, run, data } of runs) {
    for (const node of data.macro) places.set(node.id, { id: node.id, label: node.label, scale: node.scale ?? null, parent: node.parent ?? null, x: node.x, z: node.z, r: node.r, depth: node.depth ?? 0, ...(node.temporary ? { temporary: true } : {}), strand, run });
    for (const land of data.landscapes) fills.set(land.place, { land, strand, run });
    // Named buildings on the lots they borrowed: a lot carries the fill building it stands on (`<place>:<lot>`, the lot's
    // own id after the first colon).
    for (const lot of data.world?.lots ?? []) {
      const nominee = lot.detected && names.get(lot.detected.name);
      if (nominee && /^[^:]+:.+$/.test(String(lot.source)) && !String(lot.source).startsWith('anchor')) named.set(nominee.id, { entity: nominee.id, name: nominee.name, source: lot.source, scene: lot.detected.scene, strand, run });
    }
  }
  // A fill kept once, named by its content: a later run that fills the same reuses it.
  const keep = async content => {
    const version = hash(content), file = join(folder, 'fills', `${version}.json`);
    if (!(await stat(file).then(() => true, () => false))) await replace(file, JSON.stringify({ version, ...content }));
    return version;
  };
  const manifolds = [], grounds = [];
  for (const [place, { land, strand, run }] of fills) {
    const at = places.get(place) ?? { x: 0, z: 0 }, local = ([x, z]) => [round(x - at.x), round(z - at.z)];
    // The place's ground: its roads and walls, across its manifolds.
    const ground = { kind: 'ground', place, roads: (land.roads ?? []).map(([ax, az, bx, bz, width]) => [...local([ax, az]), ...local([bx, bz]), width]), walls: (land.walls ?? []).map(([ax, az, bx, bz]) => [...local([ax, az]), ...local([bx, bz])]) };
    grounds.push({ place, version: await keep(ground), roads: ground.roads.length, walls: ground.walls.length, strand, run });
    // Its manifolds, in birth order: each patch's buildings when the run says which patch each stands on, else the whole
    // landscape as one.
    const split = Array.isArray(land.patches) && Array.isArray(land.manifolds) && land.manifolds.length === land.buildings.length;
    const patches = split ? land.patches : [{ id: null, type: null, manifold: null }];
    for (const patch of patches) {
      const rows = land.buildings.flatMap((row, n) => !split || land.manifolds[n] === patch.manifold ? [[...local(row), ...row.slice(2)]] : []);
      const types = split ? [patch.type] : land.types ?? [];
      const version = await keep({ kind: 'manifold', place, types, buildings: rows });
      manifolds.push({ id: patch.manifold ?? `${place}:landscape`, place, ...(patch.id ? { patch: patch.id } : {}), types, ...(patch.era ? { era: patch.era } : {}), ...(patch.born !== undefined ? { born: patch.born } : {}),
        ...(patch.centre ? { centre: local(patch.centre), radius: patch.radius } : {}), ...(Array.isArray(patch.outline) ? { outline: patch.outline.map(local) } : {}), version, buildings: rows.length, strand, run });
    }
  }
  // A nominated building where it stands: its fill building, in its place's own metres.
  const buildings = [];
  for (const entry of named.values()) {
    const place = entry.source.slice(0, entry.source.indexOf(':')), land = fills.get(place)?.land, row = land?.buildings[land.ids?.indexOf(entry.source) ?? -1], at = places.get(place);
    if (!row || !at) continue;
    const [x, z, w, d, angle, floors] = row;
    buildings.push({ id: entry.entity, name: entry.name, kind: 'named', place, x: round(x - at.x), z: round(z - at.z), w, d, angle, floors, scene: entry.scene, strand: entry.strand, run: entry.run });
  }
  // The staged buildings: units on the canvas (no landscape, nothing inside them).
  const parents = new Set([...places.values()].map(place => place.parent).filter(Boolean));
  for (const place of places.values()) if (!fills.has(place.id) && !parents.has(place.id) && place.parent && (['building', 'site', 'room'].includes(place.scale) || place.r <= 30)) {
    const holder = places.get(place.parent);
    buildings.push({ id: place.id, name: place.label, kind: 'staged', place: place.parent, x: round(place.x - (holder?.x ?? 0)), z: round(place.z - (holder?.z ?? 0)), r: place.r, strand: place.strand, run: place.run });
  }
  const index = { version: PLACES_VERSION, builtAt: new Date().toISOString(), runs: runs.map(({ strand, run, exportedAt, engine }) => ({ strand, run, exportedAt, engine })),
    places: [...places.values()].map(place => ({ ...place, open: fills.has(place.id) || parents.has(place.id) })), grounds, manifolds, buildings };
  await replace(join(folder, 'index.json'), JSON.stringify(index, null, 1));
  return index;
}
