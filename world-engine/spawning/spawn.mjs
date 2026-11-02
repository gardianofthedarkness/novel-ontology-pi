// Spawning positions (docs/v2/spawning.md; src/v2/spawning/positions.ts): where each person and each thing of every scene
// stands when it begins, on the world the terrain built (the last build's page), by the rules; no model call yet. Reads
// stage/world/script.json, stage/world/strands.json (experiments/v2/strands.mjs), stage/terrain.json and
// stage/simulation/live/page.json; writes stage/world/spawn.json.
//   npm run build && node world-engine/spawning/spawn.mjs <novel-dir> [--reading <reading>/v2/data.json]
// --reading: a script from before scenes kept their things takes them from the reading (its cards and chart).
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const P = await load('dist/src/v2/spawning/positions.js'), { sceneThings } = await load('dist/src/v2/extraction/script.js');
const { compose } = await load('dist/src/v2/context/engine.js'), { spawnSpotMode, spawnLines } = await load('dist/src/v2/context/spawnModes.js'), CP = await load('dist/src/v2/terrain/composite.js');
const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');

/** The scenes' starts on a book: its script, strands, terrain and built page; `reading`: the reading's data, for things. */
export async function spawnBook(novelDir, { reading = null } = {}) {
  const read = async file => JSON.parse(await readFile(join(novelDir, 'stage', ...file), 'utf8'));
  const script = await read(['world', 'script.json']), strands = await read(['world', 'strands.json']), terrain = await read(['terrain.json']), page = await read(['simulation', 'live', 'page.json']);
  if (reading && script.scenes.every(scene => !scene.things)) {
    const category = new Map(reading.chart.entities.map(entity => [entity.id, entity.category])), sceneOf = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
    const cardsOf = new Map();
    for (const card of reading.cards) { const id = sceneOf.get(card.sentences?.[0] ?? card.first); if (id) { if (!cardsOf.has(id)) cardsOf.set(id, []); cardsOf.get(id).push(card); } }
    for (const scene of script.scenes) { const things = sceneThings(cardsOf.get(scene.id) ?? [], id => category.get(id)); if (things.length) scene.things = things; }
  }
  // The world as built: each marker, each building by its id, each composite building's part.
  const macro = new Map(page.macro.map(node => [node.id, node])), buildings = new Map(), parts = new Map();
  for (const entry of page.landscapes ?? []) { entry.ids?.forEach((id, n) => buildings.set(id, entry.buildings[n])); for (const part of entry.parts ?? []) parts.set(part[7], part); }
  const buildingOf = site => {
    const slot = site?.slot ? terrain.slots?.[site.slot] : null;
    if (!slot) return null;
    const key = slot.lot ?? slot.id, short = key.startsWith(`${slot.parent}:`) ? key.slice(slot.parent.length + 1) : key;
    for (const entry of page.landscapes ?? []) { const found = buildings.get(`${entry.place}:${key}`) ?? buildings.get(`${entry.place}:${short}`); if (found) return found; }
    return null;
  };
  const scaleOf = place => script.places[place]?.scale ?? terrain.sites?.[place]?.scale ?? macro.get(place)?.scale ?? null;
  const target = (scene, place, depth = 0) => {
    const site = terrain.sites?.[place], scale = scaleOf(place), node = macro.get(place);
    if (site?.by === 'tenant' && parts.has(place)) { const part = parts.get(place); return { place, kind: 'part', box: part.slice(0, 5), bottom: part[5], floors: 1 }; }
    const built = site?.scale === 'building' ? buildingOf(site) : null;
    if (built) return { place, kind: 'building', box: built.slice(0, 5), bottom: 0, floors: Math.max(1, built[5]) };
    // A room: in its building, on one of its floors (a random room of a random floor, the user's call).
    if (scale === 'room' && depth < 4) { const holder = script.places[place]?.parent; const inside = holder ? target(scene, holder, depth + 1) : null; if (inside) return { ...inside, place }; }
    if (!node) return null;
    if (scale === 'building' || scale === 'room') return { place, kind: 'building', box: [node.x, node.z, Math.max(8, node.r * 1.2), Math.max(8, node.r * 1.2), 0], bottom: 0, floors: Math.max(1, Math.round((site?.top ?? 9) / 3)) };
    return { place, kind: 'area', box: [node.x, node.z, Math.max(10, node.r * 1.2), Math.max(10, node.r * 1.2), 0], bottom: 0, floors: 0 };
  };
  const entries = new Map(strands.scenes.map(scene => [scene.id, scene.entries])), starts = P.spawnScenes(script.scenes, entries, target);
  // Jev's spot question, composed (no call): for each scene, those the rules could only put on a random floor of a
  // building, a choice over its spots, read from the scene's text (docs/v2/spawning.md §4).
  const names = new Map((reading?.chart?.entities ?? []).map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
  const nameOf = id => names.get(id) ?? script.places[id]?.label ?? id;
  const text = await loadWorkspaceSentences(novelDir), sceneLines = new Map((reading?.scenes ?? []).map(scene => [scene.id, scene.sentences.map(id => ({ id, text: text.get(id)?.text ?? '' }))]));
  const asks = new Map();
  for (const scene of script.scenes) {
    const open = (starts.get(scene.id) ?? []).filter(start => start.by === 'default'), here = open.length && scene.place ? target(scene.id, scene.place) : null;
    if (!here || here.kind !== 'building') continue;
    const inside = Object.entries(terrain.sites ?? {}).filter(([, site]) => site.by === 'tenant' && site.in === scene.place).map(([, site]) => `inside ${site.label} (${site.type}), floor ${site.floor}`);
    const said = [...CP.partFloors(here.floors).map(option => option.said), 'on its roof', 'on the street in front of it', ...inside].slice(0, 20);
    const spots = said.map((text, n) => ({ letter: 'ABCDEFGHIJKLMNOPQRST'[n], said: text }));
    const subjects = open.map(start => ({ id: start.who, name: nameOf(start.who), kind: start.kind }));
    const lines = spawnLines(sceneLines.get(scene.id) ?? [], subjects.map(subject => subject.name), (scene.spatial ?? []).map(mention => mention.sentence));
    const composed = await compose(spawnSpotMode, { scene: { id: scene.id, label: `${Number(scene.id.slice(-3))}`, when: scene.at?.node ?? null }, place: { name: nameOf(scene.place), kind: 'building', floors: here.floors }, subjects, spots, lines }, null);
    asks.set(scene.id, { subjects: subjects.map(subject => subject.id), spots, document: composed.document, questions: composed.questions.map(question => question.key) });
  }
  return { script, starts, asks, nameOf };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, live: { type: 'boolean' } } });
  if (!novelDir) { console.error('usage: node world-engine/spawning/spawn.mjs <novel-dir> [--reading <data.json>]'); process.exit(2); }
  const reading = values.reading ? JSON.parse(await readFile(values.reading, 'utf8')) : null;
  const { script, starts, asks, nameOf } = await spawnBook(novelDir, { reading });
  const all = [...starts.values()].flat(), by = {}, unplaced = script.scenes.filter(scene => !(starts.get(scene.id) ?? []).length).map(scene => scene.id);
  for (const start of all) by[`${start.kind} ${start.by}`] = (by[`${start.kind} ${start.by}`] ?? 0) + 1;
  console.log(`scenes ${script.scenes.length}, starts ${all.length} (people ${all.filter(start => start.kind === 'person').length}, things ${all.filter(start => start.kind === 'thing').length})`);
  console.log('by', JSON.stringify(by));
  console.log(`scenes with nobody placed: ${unplaced.length}${unplaced.length ? ` (${unplaced.slice(0, 8).join(', ')}${unplaced.length > 8 ? ' …' : ''})` : ''}`);
  console.log(`Jev's spot question, composed for ${asks.size} scenes (${[...asks.values()].reduce((n, ask) => n + ask.subjects.length, 0)} to place); not asked yet`);
  const scenes = script.scenes.map(scene => ({ id: scene.id, place: scene.place, when: scene.at?.node ?? null, starts: starts.get(scene.id) ?? [], ...(asks.has(scene.id) ? { ask: asks.get(scene.id) } : {}) }));
  await writeFile(join(novelDir, 'stage', 'world', 'spawn.json'), JSON.stringify({ version: 1, from: 'rules', scenes }, null, 1));
  console.log('written', join(novelDir, 'stage', 'world', 'spawn.json'));
  // World · Live (--live): the world built again (people at their starts) and the spawn list beside it, with each
  // scene's text as Jev would be sent it.
  if (values.live) {
    const { createLive } = await import('../live/sim-jev.mjs'), { strandDemo } = await import('../world/export-strand-demo.mjs'), { simStrandList } = await load('dist/src/cli/commands/extract/simCommands.js');
    const [line] = await simStrandList(novelDir), live = await createLive(novelDir, { command: 'sim spawn', lines: [{ id: 'spawn', title: 'Spawning: where everyone begins' }] });
    try {
      await live.phase('building the world');
      let snapshot = null;
      const data = await strandDemo(novelDir, { from: line.from, to: line.to, worldOnly: true, plain: true, title: 'Spawning', live: shot => { snapshot = shot; } });
      data.stage = 'terrain';
      const list = scenes.map(scene => ({ id: scene.id, placeId: scene.place, place: scene.place ? nameOf(scene.place) : null, when: scene.when, starts: scene.starts.map(start => ({ who: start.who, name: nameOf(start.who), kind: start.kind, by: start.by, floor: start.floor, at: start.at, from: start.from })), ...(scene.ask ? { ask: { spots: scene.ask.spots, document: scene.ask.document } } : {}) }));
      if (snapshot) await live.world({ ...snapshot, moment: 'spawn: where everyone begins', notes: { ...snapshot.notes, spawn: list } }, data);
      await live.finish('done');
    } catch (error) { await live.finish('failed', { error: String(error?.message ?? error).slice(0, 300) }); throw error; }
  }
}
