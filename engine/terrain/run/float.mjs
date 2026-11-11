// L19 · Floating places over a played run (engine/terrain/float.mjs): the run's tracks (a person's units one after
// the other at two places, against the time the two units allow and their speed) and the set dresser's settings (a unit
// standing on another kind of ground than its lines say) pull the places; the city changes least. No model is asked.
//
//   node engine/terrain/run/float.mjs <library> <reading>/v2/data.json [--apply <copy of the library>] [--out report.json]
//
// --apply writes the moved places into the copy's terrain (each site's `at`, beside its parent, as the place canvas bears
// it) and moves its spawn plan's boxes and starts with their places; the originals kept as *.before-float.json.
import { copyFile, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import * as FL from '../float.mjs';
import * as SD from '../../casts/set-dresser.mjs';
import { loadPrefilm } from '../../casts/prefilm.mjs';

const { values, positionals: [libraryArg, readingPath] } = parseArgs({ allowPositionals: true, options: { apply: { type: 'string' }, out: { type: 'string' } } });
if (!libraryArg || !readingPath) { console.error('usage: node engine/terrain/run/float.mjs <library> <data.json> [--apply <copy>] [--out report.json]'); process.exit(2); }
const library = resolve(libraryArg), stage = join(library, 'vol-1', 'novel', 'stage'), json = async path => JSON.parse(await readFile(path, 'utf8'));
const record = await json(join(stage, 'director', 'run.json')), run = `d${String(record.startedAt).replace(/\D/g, '').slice(0, 14)}`;
const page = await json(join(stage, 'simulation', 'runs', 'director', `${run}.page.json`)), reading = await json(resolve(readingPath));
const prefilm = await loadPrefilm(dirname(resolve(readingPath))), abilities = await json(join(library, 'universe', 'abilities.json')).catch(() => null);

// The places: where the run's city had each, its size, its parent; who may move and how heavy.
const macro = new Map((page.macro ?? []).map(node => [node.id, node])), parentOf = id => macro.get(id)?.parent ?? null;
const ancestors = id => { const out = []; for (let p = parentOf(id), guard = 0; p && guard < 16; p = parentOf(p), guard++) out.push(p); return out; };
const massOf = id => (id.startsWith('unnamed:') ? FL.MASS.unnamed : id.startsWith('slot:') ? FL.MASS.slot : FL.MASS.named);
// A place standing on a borrowed lot of its street (a borrow, a tenant: terrain spawning's building level) is that lot's
// and never floats.
const sites = (await json(join(stage, 'terrain.json')).catch(() => null))?.sites ?? {}, onLot = id => ['borrow', 'tenant'].includes(sites[id]?.by);
const places = new Map([...macro].map(([id, node]) => [id, { at: [node.x, node.z], r: node.r ?? 10, parent: node.parent ?? null, mass: massOf(id), movable: FL.MOVABLE.has(node.scale) && !onLot(id) }]));

// The tracks: each person's units in the order played, a pair at two places neither holding the other.
const unitPlace = new Map(page.scenes.map(scene => [scene.id, scene.place]));
const seconds = new Map(); for (const cut of reading.storyboard ?? []) seconds.set(cut.scene, (seconds.get(cut.scene) ?? 0) + (cut.seconds ?? 4));
const SPEED = 3, GAP = 60;
const agilityOf = (unit, who) => { const used = [...(prefilm?.units?.[unit]?.scriptSupervisor?.moves ?? []), ...(prefilm?.units?.[unit]?.blocking ?? [])].some(move => move.who === who && move.ability === 'agility'); return used ? abilities?.people?.[who]?.move?.agility?.factor ?? 1 : 1; };
// Where a unit's people stand against its place's spot: its spawn box's offset (a box may stand far from the spot the city
// drew; the move carries both, so the track is measured at the box).
const plan = await json(join(stage, 'world', 'spawn.json')).catch(() => ({ scenes: [] })), planOf = new Map(plan.scenes.map(entry => [entry.id, entry]));
const standOff = unit => { const box = planOf.get(unit)?.target?.box, p = macro.get(unitPlace.get(unit)); return Array.isArray(box) && p ? [box[0] - p.x, box[1] - p.z] : null; };
const last = new Map(), tracks = [];
for (const scene of record.scenes) {
  const place = unitPlace.get(scene.scene);
  for (const who of Object.keys(scene.starts ?? {})) {
    if (who.startsWith('crowd:')) continue;
    const before = last.get(who);
    if (before && place && before.place && before.place !== place && macro.has(place) && macro.has(before.place) && !ancestors(place).includes(before.place) && !ancestors(before.place).includes(place)) {
      const time = ((seconds.get(before.unit) ?? 30) + (seconds.get(scene.scene) ?? 30)) / 2 + GAP;
      tracks.push({ a: before.place, b: place, offA: standOff(before.unit), offB: standOff(scene.scene), reach: SPEED * agilityOf(scene.scene, who) * time, who, from: before.unit, to: scene.scene });
    }
    last.set(who, { unit: scene.scene, place });
  }
}

// The settings: a unit whose lines say a kind of ground its people did not stand on, its place pulled by the gap to the
// nearest ground of that kind.
const ground = SD.groundMap(page.world.lots), cellAt = (x, z) => ground.find(cell => Math.abs(cell.x - x) <= 30 && Math.abs(cell.z - z) <= 30) ?? { setting: 'open ground' };
const pulls = [], judged = [];
for (const scene of record.scenes) {
  const said = prefilm?.units?.[scene.scene]?.setDresser, place = unitPlace.get(scene.scene), starts = Object.values(scene.starts ?? {});
  if (!said || said.sure < 0.5 || !SD.judged(said.setting) || !starts.length || !places.get(place)?.movable) continue;
  const x = starts.reduce((sum, p) => sum + p[0], 0) / starts.length, z = starts.reduce((sum, p) => sum + p[2], 0) / starts.length, here = cellAt(x, z).setting;
  judged.push({ unit: scene.scene, said: said.setting, ground: here });
  if (here === said.setting) continue;
  const near = SD.nearestOf(ground, said.setting, [x, z]);
  if (near) { const p = places.get(place).at; pulls.push({ place, to: [p[0] + near.x - x, p[1] + near.z - z], unit: scene.scene, metres: Math.round(near.d) }); }
}

const out = FL.relax({ places, tracks, pulls });
const start = new Map([...places].map(([id, place]) => [id, place.at]));
const report = {
  run, places: places.size, movable: [...places.values()].filter(place => place.movable).length, tracks: tracks.length, pulls: pulls.length, judged: judged.length,
  beyondReach: { before: FL.beyondReach(start, tracks), after: FL.beyondReach(out.at, tracks) }, energy: { before: out.before, after: out.after },
  moved: { places: out.moves.length, metres: out.moves.reduce((sum, move) => sum + move.metres, 0), largest: Math.max(0, ...out.moves.map(move => move.metres)), over300: out.moves.filter(move => move.metres > 300).length },
  pullsAfter: pulls.map(pull => ({ unit: pull.unit, wanted: pull.metres, left: Math.round(Math.hypot(out.at.get(pull.place)[0] - pull.to[0], out.at.get(pull.place)[1] - pull.to[1])) })),
};
if (values.out) await writeFile(resolve(values.out), JSON.stringify({ report, moves: out.moves, tracks }, null, 1));
console.log(JSON.stringify(report, null, 1));

if (values.apply) {
  const copy = resolve(values.apply), cstage = join(copy, 'vol-1', 'novel', 'stage');
  const terrain = await json(join(cstage, 'terrain.json')), spawn = await json(join(cstage, 'world', 'spawn.json'));
  await copyFile(join(cstage, 'terrain.json'), join(cstage, 'terrain.before-float.json')); await copyFile(join(cstage, 'world', 'spawn.json'), join(cstage, 'world', 'spawn.before-float.json'));
  // Each moved place's position beside its parent (as the canvas bears it), the parent where it now stands.
  const moved = new Map(out.moves.map(move => [move.id, [move.to[0] - move.from[0], move.to[1] - move.from[1]]]));
  for (const move of out.moves) { const site = (terrain.sites[move.id] ??= {}), parent = parentOf(move.id), base = parent ? out.at.get(parent) ?? places.get(parent).at : [0, 0]; site.at = [Math.round((move.to[0] - base[0]) * 10) / 10, Math.round((move.to[1] - base[1]) * 10) / 10]; site.floated = { from: move.from, to: move.to, metres: move.metres, parent, run }; }
  terrain.floated = { run, at: new Date().toISOString(), moved: out.moves.length };
  // The spawn plan moves with its places: a unit's box and starts shifted by its place's move (or its nearest moved ancestor's).
  const shiftOf = id => { for (const p of [id, ...ancestors(id)]) if (moved.has(p)) return moved.get(p); return null; };
  let shifted = 0;
  for (const scene of spawn.scenes) {
    const d = shiftOf(scene.place); if (!d) continue; shifted++;
    if (Array.isArray(scene.target?.box)) { scene.target.box[0] += d[0]; scene.target.box[1] += d[1]; }
    for (const entry of scene.starts ?? []) if (Array.isArray(entry.at)) entry.at = [entry.at[0] + d[0], entry.at[1] + d[1]];
  }
  await writeFile(join(cstage, 'terrain.json'), JSON.stringify(terrain, null, 1)); await writeFile(join(cstage, 'world', 'spawn.json'), JSON.stringify(spawn, null, 1));
  console.error(`applied to ${copy}: ${out.moves.length} places moved in the terrain, ${shifted} units' spawn boxes moved with them`);
}
