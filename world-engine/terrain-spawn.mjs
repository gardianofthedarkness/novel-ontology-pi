#!/usr/bin/env node
/**
 * Terrain spawning on the world engine (docs/v2/visual-context-engine.md §5; the user's call, 2026-10-31: built on the
 * engine and the place tree we have, not beside them). The world is the engine's own: export-strand-demo.mjs in its
 * world-only mode (the canvas of places from the place tree, the central build and its default spawns, each place's
 * landscape filled, the streamed lots with their skeleton buildings). So are both players: Jev looks through the engine
 * page in capture mode (strand-demo.html, headless, each shot at its own frame and camera); the user watches World · Live
 * (the same page, live/page.json) with a camera of their own, and Jev's questions beside it.
 *
 * For each city-grade place of the volume (by how much the text names it), the open places the place tree puts in it
 * (its districts and streets; with no tree, Jev says which are its parts), in story order:
 *   1. overview: the city from the side and above (1440×900) and straight down (1024×1024), the places so far pinned and
 *      named (a pin is a point: the canvas's circles are not their sizes), those kept outlined; Jev boxes where the part
 *      lies on the map and picks its ground: a manifold (a landscape type, whose buildings the engine fills in) or a
 *      basic shape (plateau, basin, hill, platform, cut, ramp, rectangle, sphere, donut);
 *   2. conflicts (code): over a part the tree does not put it in, a size far from its scale, or a box over a quarter of the
 *      map: zoom into the box and ask again, twice at most;
 *   3. height: the area from the side and above, lettered ghost slices at every height the world has, the city faded
 *      behind, red dotted lines where a slice cuts a building; Jev picks a letter;
 *   4. the proposal blinks in World · Live; in step mode the run waits for the user (Next step / Run on there); then it is
 *      kept as the engine's own input (stage/terrain.json: the part's ground, its size, where in its parent), the world is
 *      built again, and the new ground and its buildings stand in World · Live.
 * A part's height and a basic shape are kept but not drawn yet (the engine's ground is flat). Every question with its
 * pictures is on the live record (stage/simulation/live: Jev's questions). Jev's answers are cached (stage/terrain/cache).
 *
 * `spawn` (docs/v2/borrow-and-spawn.md, the user's design of 2026-11-01): borrowing and spawning by type instead of pools.
 * Level by level, every city, then every district, then every street, named and unnamed alike in the order the text first
 * comes to them: a part Jev gave a kind borrows the slot of that kind its holder has that raises the characters' travel
 * least, or spawns one where it can borrow nothing (src/v2/spawning); a level ends with the moves that lower the travel, its
 * spare slots placed, and every area of it spawning its children's slots by its kind's configuration (config/spawning).
 * `from` (city, district, street) drops that level and every level under it, to run them again; `until` stops after a level.
 * A parent whose configuration has a topology (a city) lays its children out at its level's end as manifolds of its own
 * ground, by its topology, their heights unified (§8); every change to the map is logged by book (§8.8).
 *
 *   npm run build && node world-engine/terrain-spawn.mjs <novel-dir> [--run] [--parts N] [--spawn [--from <level>]]   (N: stop after that many parts)
 */
import { copyFile, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { browser, serve } from './two-view-things.mjs';
import { createLive, PICKER_MODEL, VENDOR_FILES } from './sim-jev.mjs';
import { inlineStrand, strandDemo } from './export-strand-demo.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..'), load = path => import(pathToFileURL(`${repository}/${path}`).href);
const round = value => Math.round(value * 10) / 10;
/** An unnamed place's words, without its scene (two of the same words are the same place: world-engine-v2.md §2.0.12). */
const baseName = label => String(label).replace(/ \(scene \d+\)$/, '');
/** The basic shapes the terrain faculty may place besides the manifolds (the user's list, 2026-10-31). */
export const SHAPES = {
  plateau: 'a plateau: raised flat ground with sloping sides', basin: 'a basin: a hollow below the ground around it', hill: 'a hill: a rounded rise',
  platform: 'a platform: a flat deck raised above the ground', cut: 'a cut: a trench or a pit dug into the ground', ramp: 'a ramp: ground sloping up from one side to the other',
  rectangle: 'a rectangle: a plain block of ground', sphere: 'a sphere', donut: 'a donut: a ring, as a torus',
};
const OVERVIEW = [1440, 900], MAP = [1024, 1024], ZOOMS = 2, CELL = 2, FLOOR = 3, OPEN = new Set(['district', 'street']);
/** The core the terrain-height question looks through, half its width over its highest slice (at least 40 m): the slices stand apart, the core reads beside them. */
const CORE = 0.4, CORE_MIN = 40;
/** What the terrain view shows (docs/v2/world-engine-v2.md §2.0.16), said with every overview Jev is shown. */
const SEEN = 'The buildings are cyan holograms of their kinds (towers, office blocks, malls, apartments, schools, shops), as tall as they are; rooms and stairs show only where people are. The volumes below the street are underground halls and passages.';
/** No fog: a map straight down reads every metre of its ground alike. */
const CLEAR = { near: 1e6, far: 2e6 };

async function replace(file, body) { const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, body, { mode: 0o644 }); await rename(temporary, file); }

export async function terrainSpawn(novelDir, { jev: given = null, run = false, parts: limit = Infinity, spawn = false, from: fromLevel = null, until = null, log = () => {} } = {}) {
  const { stageInputs } = await load('dist/src/cli/commands/extract/stageCommands.js');
  const { simStrandList } = await load('dist/src/cli/commands/extract/simCommands.js');
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  // Every Jev request is composed by the context engine (the user's call): the terrain modes, from the reading's stores.
  const { ask } = await load('dist/src/v2/context/engine.js'), T = await load('dist/src/v2/context/terrainModes.js');
  const { continuityTies, universeOf } = await load('dist/src/v2/extraction/pools.js');
  // The zoom engine (docs/v2/visual-context-engine.md §4.1): every frame Jev is shown and every box it answers.
  const Z = await load('dist/src/v2/context/zoom.js'), { LANDSCAPES, formsFor, averageOverMedian } = await load('dist/src/ground/stage/landscape.js');
  const inputs = await stageInputs(novelDir), [line] = await simStrandList(novelDir);
  if (!line) throw new Error('Terrain spawning needs the world loop\'s line: a world-first book with its world script and staged scenes.');
  const folder = join(novelDir, 'stage', 'terrain');
  await mkdir(folder, { recursive: true });
  const manifest = JSON.parse(await readFile(join(novelDir, 'ontology', 'manifest.json'), 'utf8'));
  const reading = manifest.v2Reading?.out ?? null;
  const base = reading ? JSON.parse(await readFile(join(reading, 'base', 'scenes.json'), 'utf8').catch(() => '[]')) : [];
  const sentences = [...(await loadWorkspaceSentences(novelDir)).values()];
  const name = id => inputs.names[id] ?? id, scaleOf = id => inputs.scale?.places[id]?.scale ?? null;
  const tree = new Map(inputs.placeTree.map(place => [place.id, place]));
  const data2 = reading ? JSON.parse(await readFile(join(reading, 'v2', 'data.json'), 'utf8').catch(() => 'null')) : null;
  // Jev's own reports of each paid request's tokens (stage/terrain/jev-usage.json), so a terrain run can be priced.
  const client = given ?? jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL }), jev = cachedDecisions(client, join(folder, 'cache'));
  const live = await createLive(novelDir, { command: 'sim terrain', lines: [{ id: 'terrain', title: 'Terrain: the ground of the volume\'s places' }], model: jev.modelId, fresh: true });
  const asking = live.watch(jev);
  let calls = 0;
  const contexts = [];
  const decide = Object.assign(async (state, questions, options) => { calls++; return asking.decide(state, questions, options); }, { record: manifest => contexts.push(manifest) });

  // Step mode (the user's call): after each proposal the run waits for the user's next step (World · Live's buttons).
  const stepFile = join(folder, 'step.json');
  await replace(stepFile, JSON.stringify({ mode: run ? 'run' : 'step', n: 0 }));
  let seen = 0;
  const readStep = async () => JSON.parse(await readFile(stepFile, 'utf8').catch(() => '{}'));
  const wait = async why => {
    let step = await readStep();
    await live.line(0, { mode: step.mode });
    if (step.mode === 'run') { seen = step.n ?? seen; return; }
    // A wait can be hours: the record is written again each minute, or the host takes a silent run for stopped (20 min) and
    // World · Live hides its buttons.
    const waiting = `waiting for you: ${why}`;
    await live.phase(waiting);
    for (let beat = Date.now(); ;) {
      await new Promise(done => setTimeout(done, 700)); step = await readStep();
      if (step.mode === 'run' || (step.n ?? 0) > seen) { seen = step.n ?? seen; break; }
      if (Date.now() - beat > 60000) { beat = Date.now(); await live.phase(waiting); }
    }
    await live.line(0, { mode: step.mode }); await live.phase('terrain');
  };

  // The engine's world, built again after each commit: World · Live gets it (with the proposal, blinking), and so does Jev's page.
  const terrainFile = join(novelDir, 'stage', 'terrain.json');
  const terrain = JSON.parse(await readFile(terrainFile, 'utf8').catch(() => 'null')) ?? { sites: {} };
  terrain.version = 2; terrain.model = jev.modelId; terrain.sites ??= {}; terrain.order ??= []; terrain.shapes ??= {};
  // A universe's terrain (docs/v2/world-engine-v2.md §2.0.15): a named place kept in one book is kept under its exact name
  // for every later book of the universe, so only the first pays; a rerun of the same book asks again.
  const universe = universeOf(novelDir), registryFile = join(universe.dir, 'terrain.json');
  const registry = JSON.parse(await readFile(registryFile, 'utf8').catch(() => 'null')) ?? { version: 1, places: {} };
  // Borrowing and spawning by type (`spawn`): slots instead of pools, kept in the universe's registry (they outlive the book),
  // mirrored in the book's terrain for the export; the stage inputs read as the slot tree (src/v2/spawning/tree.ts).
  const S = spawn ? { ...(await load('dist/src/v2/spawning/config.js')), ...(await load('dist/src/v2/spawning/slots.js')), ...(await load('dist/src/v2/spawning/tree.js')), ...(await load('dist/src/v2/spawning/topology.js')), ...(await load('dist/src/v2/spawning/heights.js')) } : null;
  const LEVELS = ['city', 'district', 'street', 'building'], bookId = universe.book, resolver = spawn ? S.defaultResolver() : null;
  if (spawn) { terrain.mode = 'spawn'; terrain.book = bookId; registry.slots ??= {}; terrain.slots = registry.slots; }
  // The map's log, by book (docs/v2/borrow-and-spawn.md §8.8): every change to the map in order, so a book can be played again.
  const mapLogFile = join(universe.dir, 'maps', `${bookId}.json`);
  const mapLog = spawn ? JSON.parse(await readFile(mapLogFile, 'utf8').catch(() => 'null')) ?? { book: bookId, entries: [] } : null;
  const logMap = entry => { if (mapLog) mapLog.entries.push({ n: mapLog.entries.length + 1, at: new Date().toISOString(), ...entry }); };
  // `from`: that level and every level under it start again: their kept parts go, the slots this book spawned for them go,
  // and this book's names and shares on the slots that stay are let go (an earlier book's stand as they were).
  if (fromLevel) {
    const drop = new Set(LEVELS.slice(LEVELS.indexOf(fromLevel)));
    for (const [id, site] of Object.entries(terrain.sites)) if (drop.has(site.scale)) { delete terrain.sites[id]; delete terrain.shapes[id]; }
    terrain.order = terrain.order.filter(id => terrain.sites[id]);
    if (mapLog) mapLog.entries = mapLog.entries.filter(entry => !drop.has(entry.level));
    for (const [label, entry] of Object.entries(registry.places)) if (entry.book === bookId && drop.has(entry.scale)) delete registry.places[label];
    for (const [id, slot] of Object.entries(registry.slots ?? {})) {
      if (!drop.has(slot.level)) continue;
      if (slot.book === bookId && (drop.has(LEVELS[LEVELS.indexOf(slot.level) - 1]) || ['named', 'unnamed'].includes(slot.layer))) { delete registry.slots[id]; continue; }
      if (slot.ownerBook === bookId) { slot.owner = null; delete slot.ownerBook; }
      slot.sharers = slot.sharers.filter(share => share.book !== bookId); slot.damaged = slot.damaged.filter(hit => hit.book !== bookId);
      // A manifold its parent laid out by topology keeps its place: the layout is the parent level's (§8.4).
      if (slot.book === bookId && !slot.mapped) { slot.toward = null; delete slot.size; delete slot.turn; delete slot.on; }
    }
  }
  const reshape = () => { if (!spawn) return; S.withSlots(inputs, Object.values(registry.slots), bookId); tree.clear(); for (const place of inputs.placeTree) tree.set(place.id, place); };
  reshape();
  // Saved before the first build: the world is built from the files, so it must see the levels dropped and the mode at once.
  if (spawn || fromLevel) {
    await replace(terrainFile, JSON.stringify(terrain, null, 1));
    await mkdir(join(universe.dir, 'maps'), { recursive: true }); await replace(registryFile, JSON.stringify(registry, null, 1));
    if (mapLog) await replace(mapLogFile, JSON.stringify(mapLog, null, 1));
  }
  // How tightly continuity ties the places (§2.0.14): the pin's suggestion, and the places Jev is told it is tied to.
  const ties = inputs.world?.scenes ? continuityTies(inputs.world) : {};
  const template = await readFile(join(repository, 'world-engine', 'strand-demo.html'), 'utf8');
  const work = await mkdtemp(join(tmpdir(), 'terrain-engine-'));
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  await writeFile(join(work, 'index.html'), '');
  const { server, url } = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true });
  live.encoder(png => chrome.evaluate(`(async () => { const image = new Image(); image.src = 'data:image/png;base64,${png}'; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL('image/jpeg', 0.78).split(',')[1]; })()`));
  // World · Live is told where to look (the focus): the proposal, or the place just kept; `terrain` keeps the whole world drawn.
  let data = null, snapshot = null, reference = null, builds = 0, focus = null;
  const show = (moment, proposal = null) => (snapshot ? live.world({ ...snapshot, moment, ...(focus ? { focus } : {}) }, { ...data, terrain: { proposal } }) : null);
  const build = async (kept = null) => {
    const started = Date.now();
    // A plain map (the user's call, §2.0.19): the tree from the reading, its places as pins, and only the ground terrain kept.
    data = await strandDemo(novelDir, { from: line.from, to: line.to, worldOnly: true, plain: true, title: 'Terrain', live: shot => { snapshot = shot; } });
    // The terrain stage's own view (brighter fill, far fog), in World · Live and Jev's stills alike.
    data.stage = 'terrain';
    // A part just kept: World · Live looks where the engine put it (its canvas keeps it clear of its siblings).
    const node = kept && nodeOf(kept);
    if (node) focus = { x: node.x, z: node.z, r: round(node.r * 1.5) };
    await show(kept ? `${name(kept)}: kept` : `world ${builds + 1}`);
    await writeFile(join(work, 'index.html'), inlineStrand(template, data, { vendor: true }));
    await chrome.evaluate('delete window.__stage').catch(() => {});
    await chrome.open(url);
    reference = { scene: data.scenes[0].id, place: data.scenes[0].place };
    builds++;
    log(`world built (${builds}): ${data.world.lots.length} lots, ${Math.round((Date.now() - started) / 1000)} s`);
  };
  // A still from the engine page: a frame of its own, an explicit camera or a map straight down, and the terrain layers.
  let shots = 0;
  const shoot = async (frame, options) => {
    await chrome.size(frame[0], frame[1]);
    const result = await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: `terrain-${++shots}`, scene: reference.scene, event: 0, place: reference.place, frame, ...options })})`);
    return { png: await chrome.still(), map: result.map ?? null };
  };
  const nodeOf = id => data.macro.find(node => node.id === id) ?? null;
  const from = (centre, yaw, up, distance) => [centre[0] + Math.sin(yaw) * distance * Math.cos(up), (centre[1] ?? 0) + distance * Math.sin(up), centre[2] + Math.cos(yaw) * distance * Math.cos(up)];

  try {
    await live.line(0, { status: 'running' }); await live.phase('building the world');
    await build();
    await live.phase('terrain');
    // The tree as the engine stands it (the place tree, else what terrain spawning said before); the cities by how much the
    // text names them, and each one's parts: the open places the tree puts in it, larger first, then in story order.
    const parentOf = id => tree.get(id)?.parentId ?? tree.get(id)?.proposedParentId ?? terrain.sites[id]?.parent ?? null;
    // What the reading says of each place, for the context engine: its graph's facts, what stands where, the scenes' surroundings.
    const stores = await T.terrainStores({
      entities: Object.values(data2?.chart?.entities ?? {}).map(entity => ({ id: entity.id, name: entity.names?.[0] ?? entity.id, kind: entity.category })),
      facts: data2?.facts ?? [], slots: data2?.places?.slots ?? [], settings: data2?.places?.settings ?? [],
      scenes: base.map(scene => ({ id: scene.id, index: scene.index, sentences: (data2?.scenes ?? []).find(entry => entry.id === scene.id)?.sentences ?? [], environment: scene.environment ?? [] })),
    }, sentences, parentOf, name);
    const within = (id, city) => { for (let at = parentOf(id), n = 0; at && n < 12; at = parentOf(at), n++) if (at === city) return true; return false; };
    const mentions = label => sentences.filter(sentence => sentence.text.includes(label)).length, firstAt = label => sentences.findIndex(sentence => sentence.text.includes(label));
    const cities = Object.keys(inputs.scale?.places ?? {}).filter(id => scaleOf(id) === 'city').map(id => ({ id, label: name(id), mentions: mentions(name(id)) })).filter(city => city.mentions).sort((a, b) => b.mentions - a.mentions);
    // A sampling pool (docs/v2/world-engine-v2.md §2.0.11) comes where the text first mentions one of its members (an
    // unnamed place by its scene's first sentence), an empty one where its area is first named.
    const world = inputs.world?.places ?? {}, sentenceAt = new Map(sentences.map((sentence, n) => [sentence.id, n]));
    const sceneAt = new Map((data2?.scenes ?? []).map(scene => [scene.id, sentenceAt.get(scene.sentences?.[0]) ?? -1]));
    const poolAt = id => {
      const ats = Object.entries(world).filter(([, place]) => place.parent === id || place.near === id).map(([, place]) => (place.scene ? sceneAt.get(place.scene) ?? -1 : firstAt(place.label))).filter(at => at >= 0);
      return ats.length ? Math.min(...ats) : firstAt(name(world[id]?.pool ?? ''));
    };
    // What a pool holds at an area's level is a real place (it has a belonging and a full tree: docs/v2/world-engine-v2.md
    // §2.0.12): Jev processes it like a named one, where its scene first comes. Another book's members are only markers.
    const isMember = id => id.startsWith('unnamed:') && String(world[id]?.parent ?? '').startsWith('pool:');
    const atOf = id => (world[id]?.pool ? poolAt(id) : isMember(id) ? sceneAt.get(world[id].scene) ?? -1 : firstAt(name(id)));
    const open = Object.keys(inputs.scale?.places ?? {}).filter(id => OPEN.has(scaleOf(id)) && !id.startsWith('elsewhere:') && (!id.startsWith('unnamed:') || isMember(id))).map(id => ({ id, label: name(id), scale: scaleOf(id), at: atOf(id) })).filter(part => part.at >= 0);
    const order = list => list.sort((a, b) => (a.scale === b.scale ? 0 : a.scale === 'district' ? -1 : 1) || a.at - b.at);
    // A part is its nearest city's (学园都市's districts are not also 东京都's).
    const cityOf = id => { for (let at = parentOf(id), n = 0; at && n < 12; at = parentOf(at), n++) if (scaleOf(at) === 'city') return at; return null; };
    const partsOf = new Map(cities.map(city => [city.id, order(open.filter(part => cityOf(part.id) === city.id))]));
    // A flat tree (no part in any city): Jev says which parts are in which city, from the text, once a city.
    const member = new Map();
    if ([...partsOf.values()].every(list => !list.length) && open.length) {
      for (const city of cities) {
        const keys = open.map((part, k) => [`p${k + 1}`, part]);
        const { replies: answers } = await ask(decide, T.terrainMemberMode, { city: { id: city.id, label: city.label }, parts: keys.map(([key, part]) => ({ key, label: part.label, scale: part.scale })) }, stores);
        for (const [key, part] of keys) { const p = Number(answers.find(answer => answer.key === `in:${key}`)?.value ?? 0); if (p >= 0.5 && p > (member.get(part.id)?.p ?? 0)) member.set(part.id, { city: city.id, p }); }
      }
      for (const city of cities) partsOf.set(city.id, order(open.filter(part => member.get(part.id)?.city === city.id)));
    }
    const holderOf = (part, city) => { const parent = parentOf(part.id); return parent && parent !== part.id && (within(parent, city.id) || parent === city.id) ? parent : city.id; };
    // The order (the user's call, 2026-10-31): the largest level first, every city, then every district, then every
    // street; within a level, the order the text first names them. A city is asked its kind and height only (it is the map).
    // Spawn mode's helpers (docs/v2/borrow-and-spawn.md). Where a kept area stands: its holder's node plus its kept offset,
    // never a built node of its own (run 10's lesson: the canvas packs places apart).
    const siteBox = (id, site) => { const node = site.parent && Array.isArray(site.toward) && Array.isArray(site.size) ? nodeOf(site.parent) : null; return node ? Z.turnedBox([node.x + site.toward[0], node.z + site.toward[1]], site.size, site.turn ?? 0) : site.box; };
    const keptIn = id => Object.entries(terrain.sites).filter(([, site]) => site.parent === id && Array.isArray(site.box) && site.by !== 'pool').map(([sid, site]) => siteBox(sid, site));
    // An area's own extent, in the frame its parts are kept in: its size round its node (its parts' offsets are from that
    // node too), never a box kept in an earlier frame (the canvas packs places apart between builds).
    const keptBoxOf = id => { const site = terrain.sites[id], node = nodeOf(id); return site && ['jev', 'universe', 'slot'].includes(site.by) && Array.isArray(site.size) && node ? Z.turnedBox([node.x, node.z], site.size, site.turn ?? 0) : null; };
    const extentIn = id => Z.extentOf(keptBoxOf(id), keptIn(id), nodeOf(id), scaleOf(id) === 'city' ? 0.3 : 0.1);
    // A place's position for the characters' travel: its kept box's middle (an unnamed share's, its slot's), else its node.
    const positionOf = id => {
      const site = terrain.sites[id], key = site?.slot && !Array.isArray(site.toward) ? registry.slots[site.slot]?.owner ?? site.slot : id, kept = terrain.sites[key];
      if (kept && Array.isArray(kept.box)) return Z.middleOf(siteBox(key, kept));
      const node = nodeOf(id); return node ? [node.x, node.z] : null;
    };
    // The places the given ones are tied to, outside them, where they stand now (the choice's fixed places).
    const fixedFor = ids => { const own = new Set(ids), found = new Map(); for (const id of ids) for (const other of Object.keys(ties[id] ?? {})) if (!own.has(other) && !found.has(other)) { const at = positionOf(other); if (at) found.set(other, { id: other, at }); } return [...found.values()]; };
    // An area's size from its pins (§2.0.21), as the program sizes every area below: its kind's usual size, grown for its pins.
    const sizeFor = (scale, ground, pins) => {
      const L = LANDSCAPES[ground] ?? null, radius = L ? (L.radius[0] + L.radius[1]) / 2 : Z.usualSize(scale) / 2, aspect = L?.aspect ? (L.aspect[0] + L.aspect[1]) / 2 : 1;
      const long = Math.max(2 * radius, scale === 'street' ? 0 : 2 * (Z.LADDER[scale]?.sizes[0] ?? 0));
      return Z.sizeByPins(scale, [long, long * aspect], L ? (L.lot[0] + L.lot[1]) / 2 : 400, L?.coverage ?? 0.8, pins).size;
    };
    const formsIn = (id, ground, long) => { const entry = (data.landscapes ?? []).find(item => item.place === id); return entry && ground ? formsFor(ground, { roads: (entry.roads ?? []).map(road => ({ a: [road[0], road[1]], b: [road[2], road[3]], level: road[5] })), waters: (entry.waters ?? []).map(water => ({ a: [water[0], water[1]], b: [water[2], water[3]] })), plazas: (entry.plazas ?? []).map(([x, z, r]) => ({ x, z, r })) }, long / 2) : []; };
    // Where an area of a size would stand in a given area: the placement the program uses for every area (Z.placeArea), near
    // the places it is tied to, a little toward its spot, inside the area grown to make room, over nothing it may not share;
    // a street on a form of its kind there.
    const placeIn = (parent, [w, d], ground, spot, clashBoxes, crowdBoxes, tied, level) => {
      const extent = extentIn(parent), room = extent ? Z.roomFor(extent, keptIn(parent), [w, d], Z.LADDER[scaleOf(parent)]?.sizes[1]).box : null;
      const node = nodeOf(parent), centre = spot && (!room || Z.inside(room, spot)) ? spot : node ? [node.x, node.z] : spot ?? [0, 0];
      const frames = Z.framesFor(level, centre, room, Math.max(w, d), true);
      const tiedPlaced = [...tied].map(([id, n]) => { const at = positionOf(id); return at ? { at, ties: n } : null; }).filter(Boolean);
      const placed = Z.placeArea(frames.context ?? frames.work, room, [w, d], centre, tiedPlaced, clashBoxes, crowdBoxes, 48, level === 'street' ? formsIn(parent, ground, w) : []);
      return placed ? { at: placed.at, onto: placed.onto ?? null } : { at: centre, onto: null };
    };
    // Where a spawn goes (§2.4, §2.5): into its holder when that is one level up; else into the area of the level between,
    // under its holder, where the characters' travel to the places it is tied to is least (spare areas among them).
    const spawnArea = (holderId, level, size, ground, spot, tied) => {
      const up = LEVELS[LEVELS.indexOf(level) - 1];
      if (!up || scaleOf(holderId) === up) return holderId;
      const areas = [...tree.keys()].filter(id => scaleOf(id) === up && within(id, holderId));
      if (!areas.length) return holderId;
      const travel = id => { const at = placeIn(id, size, ground, spot, [], [], tied, level).at; return [...tied].reduce((sum, [other, n]) => { const p = positionOf(other); return p ? sum + n * Math.hypot(at[0] - p[0], at[1] - p[1]) : sum; }, 0); };
      return areas.map(id => [id, travel(id)]).sort((a, b) => a[1] - b[1] || String(a[0]).localeCompare(String(b[0])))[0][0];
    };
    // A level's slots for the core, each at its area's node plus its kept offset (unplaced: null).
    const slotsAt = level => Object.values(registry.slots).filter(slot => slot.level === level).map(slot => { const node = slot.toward ? nodeOf(slot.parent) : null; return { ...slot, at: node ? [round(node.x + slot.toward[0]), round(node.z + slot.toward[1])] : null }; });
    // The core's slots back as the registry keeps them: an offset from the area, and for one placed now its size and turn
    // (`placedNow`); a slot of the level the core no longer has (a spawn a name left) goes.
    const keepSlots = (level, slots, placedNow = {}) => {
      const ids = new Set(slots.map(slot => slot.id));
      for (const [id, slot] of Object.entries(registry.slots)) if (slot.level === level && !ids.has(id)) delete registry.slots[id];
      for (const { at, ...slot } of slots) {
        const node = nodeOf(slot.parent), was = registry.slots[slot.id], toward = was?.toward ?? (at && node ? [round(at[0] - node.x), round(at[1] - node.z)] : null);
        registry.slots[slot.id] = { ...slot, toward, ...(!was?.toward && toward ? placedNow[slot.id] ?? {} : {}) };
      }
    };
    // The sites of the slots no name owns (spare, or shared this book): the export builds each as an area of its level
    // (src/v2/spawning/tree.ts), on its first sharer's terrain, else its kind's default (§2.2); a spare one has no pin.
    const syncSlots = () => {
      for (const slot of Object.values(registry.slots)) {
        if (!slot.toward || slot.owner) { if (terrain.sites[slot.id]?.by === 'slot') delete terrain.sites[slot.id]; continue; }
        const shares = S.sharersIn(slot, bookId), first = shares.map(share => terrain.sites[share.mention]).find(site => site?.kind);
        // A manifold of its parent's ground (§8) keeps its own unified height; any other slot its first sharer's terrain.
        const made = slot.mapped ? { ...(S.defaultTerrain(slot.level, slot.kind) ?? {}), ...(slot.median != null ? { median: slot.median } : {}) }
          : first ? { ...(first.shape ? { shape: first.shape } : { ground: first.ground }), ...(first.median ? { median: first.median, manifold: first.manifold } : {}), ...(first.top ? { top: first.top } : {}) } : S.defaultTerrain(slot.level, slot.kind) ?? {};
        const node = nodeOf(slot.parent), size = slot.size ?? sizeFor(slot.level, made.ground, 0);
        terrain.sites[slot.id] = { label: S.slotLabel(slot, bookId, inputs.names), parent: slot.parent, parentLabel: name(slot.parent), scale: slot.level, kind: slot.kind, ...made, size, toward: slot.toward, ...(typeof slot.turn === 'number' ? { turn: slot.turn, on: slot.on } : {}),
          ...(node ? { box: Z.turnedBox([node.x + slot.toward[0], node.z + slot.toward[1]], size, slot.turn ?? 0) } : {}), by: 'slot', ...(slot.mapped ? { mapped: true, average: slot.average } : {}), ...(shares.length ? { shares: shares.map(share => share.mention) } : { spare: true }) };
      }
      terrain.slots = registry.slots;
    };
    const saveSlots = async () => {
      syncSlots(); await replace(terrainFile, JSON.stringify(terrain, null, 1)); await mkdir(join(universe.dir, 'maps'), { recursive: true }); await replace(registryFile, JSON.stringify(registry, null, 1));
      await replace(mapLogFile, JSON.stringify(mapLog, null, 1)); reshape();
    };
    // A parent's children laid out by its topology as manifolds of its own ground (§8.2, §8.3): the new ones where its
    // energy is least, those standing giving a little; the heights unified to its average (§8.6). For a born city, a city
    // re-decided, and a level's end alike; says what it did.
    const layOutChildren = (id, level, give = 1) => {
      const site = terrain.sites[id], child = S.CHILD[level];
      const topology = resolver({ id, label: site.label, level, kind: site.kind })?.topology;
      const mine = Object.values(registry.slots).filter(slot => slot.parent === id && slot.level === child), fresh = mine.filter(slot => !slot.toward);
      if (!topology || !mine.length) return null;
      // A born city's districts were a default, not yet seen: they move and change height freely at its first decision.
      const provisional = site.by === 'birth', free = slot => slot.average == null || slot.provisional;
      const radiusFor = slot => (slot.size ? Math.max(...slot.size) : Math.max(...sizeFor(child, S.defaultTerrain(child, slot.kind)?.ground, 0))) / 2;
      const result = S.layOut(mine.filter(slot => slot.toward).map(slot => ({ id: slot.id, kind: slot.kind, at: slot.toward, r: radiusFor(slot), give: mine.some(free) ? 10 : give })), fresh.map(slot => ({ id: slot.id, kind: slot.kind, r: radiusFor(slot) })), topology, id);
      for (const m of result.manifolds) {
        const slot = registry.slots[m.id], was = slot.toward;
        Object.assign(slot, { toward: m.at, size: [2 * m.r, 2 * m.r], mapped: true });
        if (!was) logMap({ level: child, what: 'spawn', id: slot.id, parent: id, kind: slot.kind, at: m.at, r: m.r, seed: slot.id });
        else if (was[0] !== m.at[0] || was[1] !== m.at[1]) { logMap({ level: child, what: 'move', id: slot.id, from: was, to: m.at }); if (slot.owner && terrain.sites[slot.owner]) terrain.sites[slot.owner].toward = m.at; }
      }
      // The heights (§8.6): the parent's average held over its own open ground and its manifolds, within the deformation limit.
      const factorOf = (scale, kind) => { const manifold = T.terrainKind(scale, kind)?.manifold; return manifold ? averageOverMedian(manifold) : 1; };
      const rangeOf = (scale, kind) => { const medians = T.terrainKind(scale, kind)?.medians ?? [0]; return [Math.min(...medians) * factorOf(scale, kind), Math.max(...medians) * factorOf(scale, kind)]; };
      const parentAverage = site.average ?? (site.median ?? 0) * factorOf(level, site.kind), disc = Math.PI * result.radius ** 2;
      const parts = [
        { id: 'open', area: Math.max(1, disc - result.manifolds.reduce((sum, m) => sum + Math.PI * m.r ** 2, 0)), average: site.open && !site.open.provisional ? site.open.average : parentAverage, range: rangeOf(level, site.kind), born: !site.open || !!site.open.provisional },
        // A free part starts again from its kind's default, so parts of one kind come out alike.
        ...result.manifolds.map(m => { const slot = registry.slots[m.id]; return { id: m.id, area: Math.PI * m.r ** 2, average: free(slot) ? (S.defaultTerrain(child, slot.kind)?.median ?? 0) * factorOf(child, slot.kind) : slot.average, range: rangeOf(child, slot.kind), born: free(slot) }; }),
      ];
      const heights = S.unify(parentAverage, parts);
      for (const m of result.manifolds) {
        const slot = registry.slots[m.id], to = heights.averages[m.id];
        if (slot.average !== to) logMap({ level: child, what: 'height', id: m.id, from: slot.average ?? null, to });
        Object.assign(slot, { average: to, median: Math.round(to / factorOf(child, slot.kind)) });
        if (provisional) slot.provisional = true; else delete slot.provisional;
      }
      if (heights.parent !== round(parentAverage)) logMap({ level, what: 'height', id, from: round(parentAverage), to: heights.parent });
      // Its open ground: the city's own ground between its manifolds, of its topology's landscape, flat (no core of its own:
      // its manifolds are its centres), at the height that holds the city's average.
      const openManifold = site.manifold ? { ...site.manifold, gradient: 0 } : null, openFactor = openManifold ? averageOverMedian(openManifold) : 1;
      site.open = { ground: topology.open ?? site.ground, average: heights.averages.open, median: Math.max(1, Math.round(heights.averages.open / openFactor)), ...(openManifold ? { manifold: openManifold } : {}), ...(provisional ? { provisional: true } : {}) };
      Object.assign(site, { average: heights.parent, size: [2 * result.radius, 2 * result.radius] });
      const R = result.radius, said = result.manifolds.map(m => `${m.kind} ${(Math.hypot(...m.at) / R).toFixed(2)}R ${heights.averages[m.id]} m`).join(', ');
      return `${site.label}: ${result.manifolds.length} ${child}s laid out by its topology, radius ${R} m (${said}); energy ring ${result.first.ring} → ${result.terms.ring}, pairs ${result.first.pairs} → ${result.terms.pairs}, pressure ${result.first.pressure} → ${result.terms.pressure}; average ${round(parentAverage)} → ${heights.parent} m, its open ground ${heights.averages.open} m`;
    };
    // A city born before Jev is asked (the user's call, 2026-11-01): Jev looks at building blocks from its first picture, and
    // its answers deform a basic city into the one the reading discloses. Born as its configuration's default kind at that
    // kind's standard height (the least average), its districts laid out by that kind's topology.
    const bornKind = spawn ? S.defaultKindOf('city') : null;
    const birthCity = (id, label) => {
      const entry = T.terrainKind('city', bornKind);
      if (!entry?.medians) return null;
      const median = entry.medians[0], average = Math.round(median * averageOverMedian(entry.manifold));
      terrain.sites[id] = { label, scale: 'city', kind: bornKind, ground: entry.ground, median, average, manifold: entry.manifold, by: 'birth' };
      logMap({ level: 'city', what: 'birth', id, kind: bornKind, average });
      return deformCity(id);
    };
    // A city's districts brought to its kind (§8.3): the slots its kind's configuration no longer has and no name holds go,
    // the ones it lacks are added; then laid out and their heights unified again (layOutChildren).
    const deformCity = id => {
      const site = terrain.sites[id], area = { id, label: site.label, level: 'city', kind: site.kind }, resolved = resolver(area);
      if (!resolved?.topology) return null;
      const { counts, layer } = S.spawnsOf(area, resolver), kept = new Map();
      const mine = Object.values(registry.slots).filter(slot => slot.parent === id && slot.level === 'district');
      for (const slot of mine.sort((a, b) => Number(!!b.owner) - Number(!!a.owner) || Number(!!b.toward) - Number(!!a.toward) || a.id.localeCompare(b.id))) {
        const n = kept.get(slot.kind) ?? 0;
        if (slot.owner || n < (counts[slot.kind] ?? 0)) { kept.set(slot.kind, n + 1); continue; }
        delete registry.slots[slot.id]; logMap({ level: 'district', what: 'remove', id: slot.id, kind: slot.kind });
      }
      for (const [kind, n] of Object.entries(counts))
        for (let k = kept.get(kind) ?? 0; k < n; k++) {
          let index = 1; while (registry.slots[`slot:${id}:${kind}:${index}`]) index++;
          const slotId = `slot:${id}:${kind}:${index}`;
          registry.slots[slotId] = { id: slotId, parent: id, level: 'district', kind, toward: null, owner: null, sharers: [], damaged: [], layer, book: bookId };
        }
      return layOutChildren(id, 'city');
    };
    // A level's end (§4.3): the moves, the spares placed, every area of the level spawning its children's slots, the world
    // built again. Run again on a pick-up, it does only what is left.
    const spawnEnd = async level => {
      if (!spawn) return;
      const mine = terrain.order.filter(id => terrain.sites[id]?.scale === level && terrain.sites[id].slot && registry.slots[terrain.sites[id].slot]);
      let moves = 0;
      if (mine.length) {
        const mentions = mine.map(id => ({ id, label: terrain.sites[id].label, named: !id.startsWith('unnamed:'), kind: terrain.sites[id].kind, holder: terrain.sites[id].holder ?? terrain.sites[id].parent, scene: world[id]?.scene ?? null }));
        const choice = S.chooseSlots({ book: bookId, level, slots: slotsAt(level), mentions, assigned: Object.fromEntries(mine.map(id => [id, terrain.sites[id].slot])), ties: (a, b) => ties[a]?.[b] ?? 0, fixed: fixedFor(mine), within: (id, of) => id === of || within(id, of), sceneIndex: scene => sceneAt.get(scene) ?? 0, place: () => null });
        moves = choice.moves;
        for (const id of mine) {
          const slotId = choice.assignment[id], site = terrain.sites[id];
          if (!slotId || slotId === site.slot) continue;
          const slot = choice.slots.find(entry => entry.id === slotId), node = nodeOf(slot.parent);
          logMap({ level, what: 'reassign', place: id, from: site.slot, to: slotId });
          site.slot = slotId;
          if (id.startsWith('unnamed:')) { site.parent = slot.owner ?? slot.id; site.parentLabel = name(site.parent); continue; }
          if (!node || !slot.at) continue;
          Object.assign(site, { parent: slot.parent, parentLabel: name(slot.parent), toward: [round(slot.at[0] - node.x), round(slot.at[1] - node.z)], box: Z.turnedBox(slot.at, site.size, slot.turn ?? 0) });
          if (typeof slot.turn === 'number') Object.assign(site, { turn: slot.turn, on: slot.on }); else { delete site.turn; delete site.on; }
        }
        keepSlots(level, choice.slots);
        if (moves) await live.outcome({ subject: `${level}s`, text: `moves at the level's end: ${choice.log.filter(line => / moves to | exchange /.test(line)).join('; ')} (travel ${choice.energy.greedy} → ${choice.energy.final} tie·m)` });
      }
      // The spares (§2.2): each slot of the level no part borrowed stands where the program places an area of its kind in
      // its area, clear of the level's other areas, on its kind's default terrain.
      let spares = 0;
      for (const slot of Object.values(registry.slots).filter(entry => entry.level === level && !entry.toward)) {
        const node = nodeOf(slot.parent);
        if (!node) continue;
        const made = S.defaultTerrain(level, slot.kind) ?? {}, size = sizeFor(level, made.ground, 0);
        const taken = Object.entries(terrain.sites).filter(([, site]) => site.scale === level && Array.isArray(site.box)).map(([id, site]) => siteBox(id, site));
        const placed = placeIn(slot.parent, size, made.ground, null, taken, [], new Map(), level);
        Object.assign(slot, { toward: [round(placed.at[0] - node.x), round(placed.at[1] - node.z)], size }, placed.onto ? { turn: placed.onto.turn, on: placed.onto.what } : {});
        logMap({ level, what: 'spawn', id: slot.id, parent: slot.parent, kind: slot.kind, at: slot.toward, r: Math.max(...size) / 2, seed: slot.id });
        syncSlots(); spares++;
      }
      // Every area of the level spawns its children's slots by its kind (config/spawning): a city its districts', a district
      // its streets'; the building level is not run yet.
      let born = 0;
      if (S.CHILD[level] !== 'building') for (const [id, site] of Object.entries(terrain.sites).filter(([sid, site]) => site.scale === level && site.kind && (level === 'city' || site.by === 'slot' || (site.slot && !sid.startsWith('unnamed:'))))) {
        // An area with a topology whose children stand already (a born or re-decided city) keeps them: deformCity manages them.
        if (resolver({ id, label: site.label, level, kind: site.kind })?.topology && Object.values(registry.slots).some(slot => slot.parent === id && slot.level === S.CHILD[level])) continue;
        for (const { at, ...child } of S.spawnChildren({ id, label: site.label, level, kind: site.kind }, resolver, bookId, Object.values(registry.slots))) { registry.slots[child.id] = { ...child, toward: null }; born++; }
      }
      // A parent whose configuration has a topology (§8.2: a city) lays out the children it has not placed yet.
      const laid = [];
      if (S.CHILD[level] !== 'building') for (const [id, site] of Object.entries(terrain.sites).filter(([, site]) => site.scale === level && site.kind)) {
        if (!Object.values(registry.slots).some(slot => slot.parent === id && slot.level === S.CHILD[level] && !slot.toward)) continue;
        const said = layOutChildren(id, level);
        if (said) laid.push(said);
      }
      await saveSlots();
      for (const text of laid) await live.outcome({ subject: `${level}s`, text });
      await live.outcome({ subject: `${level}s`, text: `the ${level} level ends: ${moves} move${moves === 1 ? '' : 's'}, ${spares} spare${spares === 1 ? '' : 's'} placed, ${born} slot${born === 1 ? '' : 's'} spawned for the level below` });
      log(`${level} level ends: ${moves} moves, ${spares} spares placed, ${born} slots below`);
      await live.phase(`building the world after the ${level} level`); await build(); await live.phase('terrain');
    };
    // Spawn mode (docs/v2/borrow-and-spawn.md §2.6): level by level, the named and the unnamed alike in the order the text
    // first comes to them; each level ends (`end`) with its moves, its spares placed and its areas' children spawned.
    const levelParts = level => Object.keys(inputs.scale?.places ?? {}).filter(id => scaleOf(id) === level && !id.startsWith('elsewhere:') && !id.startsWith('slot:'))
      .map(id => ({ id, label: name(id), scale: level, at: id.startsWith('unnamed:') ? sceneAt.get(world[id]?.scene) ?? -1 : firstAt(name(id)) })).filter(part => part.at >= 0)
      .map(part => ({ part, city: cities.find(city => city.id === cityOf(part.id)) })).filter(item => item.city).sort((a, b) => a.part.at - b.part.at);
    const queue = spawn ? [
      ...cities.map(city => ({ part: { id: city.id, label: city.label, scale: 'city', at: firstAt(city.label) }, city })).sort((a, b) => a.part.at - b.part.at), { end: 'city' },
      ...levelParts('district'), { end: 'district' }, ...levelParts('street'), { end: 'street' },
    ] : [
      ...cities.map(city => ({ part: { id: city.id, label: city.label, scale: 'city', at: firstAt(city.label) }, city })).sort((a, b) => a.part.at - b.part.at),
      // Within a level the real places first, in the text's order; its pools last, as each copies the places of its level.
      ...['district', 'street'].flatMap(level => cities.flatMap(city => (partsOf.get(city.id) ?? []).filter(part => part.scale === level).map(part => ({ part, city }))).sort((a, b) => Number(!!world[a.part.id]?.pool) - Number(!!world[b.part.id]?.pool) || a.part.at - b.part.at)),
    ];
    const total = queue.filter(item => item.part).length;
    const levelEnd = async level => spawnEnd(level);
    let placed = 0;
    // A part already kept (a stopped run's stage/terrain.json) stays as it is: the run picks up where it stopped (the user's
    // call, 2026-10-31). A fresh run moves terrain.json aside first.
    const keptBefore = id => !!terrain.sites[id] && terrain.sites[id].by !== 'birth';
    const before = queue.filter(item => item.part && keptBefore(item.part.id)).length;
    if (before) await live.outcome({ subject: 'terrain', text: `picking up: ${before} of ${total} parts kept before, ${total - before} to go` });
    // Spawn mode: every city not decided yet is born a basic city first, so Jev's first pictures show building blocks.
    if (spawn) {
      const unborn = queue.filter(item => item.part?.scale === 'city' && !terrain.sites[item.part.id]);
      for (const { part } of unborn) { const said = birthCity(part.id, part.label); if (said) await live.outcome({ subject: part.label, text: `born a basic ${bornKind} at its standard height: ${said}` }); }
      if (unborn.length) { await saveSlots(); await build(); }
    }
    for (const { part, city, end } of queue) {
      if (placed >= limit) break;
      if (end) { await levelEnd(end); if (end === until) break; continue; }
      if (keptBefore(part.id)) continue;
      // A pool's member: Jev is asked its kind, then where it lies (anywhere in its district, its pin a suggestion), then its height.
      const isCity = part.scale === 'city', sampled = isMember(part.id), cityNode = nodeOf(city.id);
      // In spawn mode a part moves to the area of the slot it borrows (docs/v2/borrow-and-spawn.md §2.3) once it is decided.
      let holder = isCity ? city.id : holderOf(part, city);
      const holderNode = nodeOf(holder) ?? cityNode, heldBy = holder;
      let slotChosen = null;
      // The city as the engine stands it now: its node and the districts and streets in it (not the rooms and buildings the
      // scenes are set in, nor the canvas's stand-in areas), and the sites so far.
      const kin = data.macro.filter(node => node.id !== part.id && (node.id === city.id || ((within(node.id, city.id) || member.get(node.id)?.city === city.id) && OPEN.has(node.scale))) && !String(node.id).startsWith('spot:') && !node.temporary && !node.unbuilt);
      // The pictures' frames (Z.fillFrame, the user's calls, 2026-11-01): the pins of the city's districts and streets, the
      // corners of what is kept in it, and the part itself; at the turn needing the smallest frame, the central 95% on each
      // of its axes, 15% more. Before, the city's node and every circle's reach: a plain map's city circle left the places
      // a small cluster in the middle. Pictures only: placement reads none of this (a run's streets ran away when it read
      // the engine's built nodes: e74ebda, reverted).
      const anchor = cityNode ?? holderNode ?? { x: 0, z: 0 }, self = nodeOf(part.id);
      const keptCorners = Object.entries(terrain.sites).filter(([id, site]) => Array.isArray(site.box) && site.by !== 'pool' && (id === city.id || within(id, city.id))).flatMap(([, site]) => [[site.box[0], site.box[1]], [site.box[2], site.box[3]]]);
      const places = [...kin.filter(node => node.id !== city.id).map(node => [node.x, node.z]), ...keptCorners], keep = self ? [self.x, self.z] : [anchor.x, anchor.z], least = isCity ? 400 : Math.max(150, Z.usualSize(part.scale === 'district' ? 'district' : 'street'));
      const fill = Z.fillFrame(places, keep, 0.95, 0.15, least), centre = [fill.x, 0, fill.z], R = fill.half;
      // The skyline turns too: its camera looks across the places' spread, the picture's width along it. Seen from SKY_UP
      // above the ground, the ground it shows is 1.6 × sin(SKY_UP) as wide as it is deep; the camera (fov 38) stands twice
      // the frame's half-depth away (1.6 would just hold it; the near places loom larger).
      const SKY_UP = 0.52, sky = Z.fillFrame(places, keep, 0.95, 0.15, least, 1.6 * Math.sin(SKY_UP)), skyCentre = [sky.x, 0, sky.z];
      // Where the engine has the part for now (the canvas's spot for it, or what was kept before), a grey pin: Jev keeps or moves it.
      // For a pool's member the pin is a suggestion (§2.0.15): Jev may box it anywhere in its district (the district its pool
      // is in, or the pool district itself), by what it is; the places continuity ties it to are marked.
      const now = nodeOf(part.id);
      let pinAt = now ? [now.x, now.z] : null;
      // A pool's member may lie anywhere in its pool's area (the user's call, §2.0.20): the district a pool street is of, the
      // whole city a pool district is of; never the span of the members boxed before it (which kept them squeezed together).
      const district = sampled ? world[holder]?.pool ?? holder : null;
      const tiedTo = new Map(Object.entries(ties[part.id] ?? {}).filter(([id]) => id !== part.id && (nodeOf(id) || terrain.sites[id])).sort((a, b) => b[1] - a[1]).slice(0, 8));
      const tag = (id, label) => (tiedTo.has(id) ? `${label} · tied` : label);
      // Extents, not circles (the zoom engine): an area's kept box, else the span of its kept parts, else its circle (a guess).
      const keptBox = id => { const site = terrain.sites[id]; return site && ['jev', 'universe', 'slot'].includes(site.by) && Array.isArray(site.box) ? site.box : null; };
      // Where a kept area stands now: its offset from its holder as the engine builds it, since a box kept earlier is in the
      // frame of that moment and its holder (a pool above all) has moved since (§2.0.22); a box with no offset as kept.
      const boxNow = (id, site) => { const holderNode = site.parent && Array.isArray(site.toward) && Array.isArray(site.size) ? nodeOf(site.parent) : null; return holderNode ? Z.turnedBox([holderNode.x + site.toward[0], holderNode.z + site.toward[1]], site.size, site.turn ?? 0) : site.box; };
      const partsOf = id => Object.entries(terrain.sites).filter(([, site]) => site.parent === id && Array.isArray(site.box) && site.by !== 'pool').map(([sid, site]) => boxNow(sid, site));
      const extentFor = id => (id ? Z.extentOf(keptBox(id), partsOf(id), nodeOf(id), scaleOf(id) === 'city' ? 0.3 : 0.1) : null);
      const levelOf = scale => (['city', 'district', 'street', 'building'].includes(scale) ? scale : null);
      const tierOf = scale => Z.tagScale(levelOf(scale), levelOf(part.scale) ?? 'street');
      // Its building pins (§2.0.21): the buildings and rooms the tree holds under it; a pool's street's, those set in its scene.
      const pinsOf = which => { const scene = world[which.id]?.scene; return Object.entries(world).filter(([id, place]) => ['building', 'room'].includes(place.scale) && (within(id, which.id) || (sampled && scene && place.scene === scene))).length; };
      const areas = (extra = []) => [
        // A place not kept yet is a pin where the engine has it (its circle is the room it takes, not its size: the user's
        // call, docs/v2/world-engine-v2.md §2.0.14); a part already kept is drawn once, as its kept box (below).
        ...kin.filter(node => node.id !== city.id && !Array.isArray(terrain.sites[node.id]?.box)).map(node => ({ pin: [node.x, node.z], label: tag(node.id, node.dwelling ? `${node.label} (sampled: the text puts it nowhere)` : node.label), color: node.id === holder ? 0x7ce6ff : 0xffd36e, textColor: node.id === holder ? '#7ce6ff' : '#ffd36e', tag: tierOf(node.scale) })),
        ...(pinAt ? [{ pin: pinAt, label: `${part.label} · ${sampled ? 'suggested' : 'now'}`, color: 0x9fb4c3, textColor: '#c9d6df', tag: Z.tagScale(null, 'street', true) }] : []),
        // A kept pool's box is its circle's (sampled, not Jev's): a pin where the engine has it now; the boxes Jev drew, outlined.
        ...Object.entries(terrain.sites).filter(([id, site]) => Array.isArray(site.box) && id !== part.id && !site.spare).map(([id, site]) => ({ ...(site.by === 'pool' ? { pin: nodeOf(id) ? [nodeOf(id).x, nodeOf(id).z] : [(site.box[0] + site.box[2]) / 2, (site.box[1] + site.box[3]) / 2] } : { box: site.box }), label: tag(id, name(id)), color: 0xffffff, textColor: '#ffffff', tag: tierOf(site.scale) })), ...extra];
      // The terrain kept for the places holding the part (its city, the place between), larger first: its manifold frames the part's.
      const kept = id => { const site = terrain.sites[id]; return site?.kind ? `${site.kind}${site.median ? `, median ${site.median} m` : site.top ? `, up to ${site.top} m` : ''}` : null; };
      const framing = Object.fromEntries((isCity ? [] : [...new Set([city.id, holder])]).filter(id => kept(id)).map(id => [name(id), kept(id)]));
      const about = { part: { id: part.id, label: part.label, scale: part.scale }, holder: { id: holder, label: name(holder) }, city: { id: city.id, label: city.label }, within: framing, ...(sampled ? { sampled: true } : {}) };
      await live.line(0, { status: 'running', part: `${part.label} (${before + placed + 1} of ${total}, in ${city.label})` });
      focus = { x: round(centre[0]), z: round(centre[2]), r: round(R * 0.6) };
      // A sampling pool is not asked: its default is the average of the places of its own level decided inside its area (a
      // pool street copies the district's streets, a pool district the city's districts: every level has its own kinds),
      // the most common kind and the mean of their medians; with none decided yet it stays empty. At the spot the engine
      // sampled for it; Jev's questions are the real places', on maps that show the pools and what stands in them.
      const poolOf = world[part.id]?.pool ?? null;
      const byDefault = () => {
        // Its extent is its members' span (the zoom engine's pool extent), within its holder; with none boxed, a pin's worth.
        const node = nodeOf(part.id) ?? holderNode ?? anchor, span = Z.poolExtent(partsOf(part.id), extentFor(holder)?.box ?? null);
        const box = span ?? [round(node.x - 10), round(node.z - 10), round(node.x + 10), round(node.z + 10)];
        const same = terrain.order.filter(id => id !== part.id && terrain.sites[id]?.scale === part.scale && !terrain.sites[id].pool && terrain.sites[id].median && within(id, poolOf)).map(id => terrain.sites[id]);
        if (!same.length) return { boxBy: null, what: null, rise: null, kind: null, entry: null, shape: null, ground: null, box, median: null, upTo: null, measure: 'median', empty: true };
        const count = new Map(); for (const site of same) count.set(site.kind, (count.get(site.kind) ?? 0) + 1);
        const kind = [...count].sort((a, b) => b[1] - a[1])[0][0], entry = T.terrainKind(part.scale, kind);
        const median = Math.round(same.reduce((sum, site) => sum + site.median, 0) / same.length);
        return { boxBy: null, what: null, rise: null, kind, entry, shape: null, ground: entry?.ground ?? same.find(site => site.kind === kind).ground, box, median, upTo: null, measure: 'median', from: same.length };
      };
      const asked = async () => {
      // 1. Overview.
      const yaw = -0.62, up = 0.52;
      const side = await shoot(OVERVIEW, { view: { fov: 38, position: from(skyCentre, -sky.turn, SKY_UP, sky.half * 2), target: skyCentre }, areas: areas(), labelScale: sky.half / 32, vague: { near: sky.half * 4, far: sky.half * 9 } });
      // The city as the context frame (a district's), its free ground: what no kept place of another branch of the tree covers.
      const cityFree = isCity ? { rects: [] } : Z.freeSpace({ x: centre[0], z: centre[2], half: R, level: 'city', purpose: 'context', tag: R / 24 }, null, Object.entries(terrain.sites).filter(([id, site]) => Array.isArray(site.box) && site.by !== 'pool' && id !== part.id && !within(part.id, id) && !within(id, part.id)).map(([, site]) => site.box));
      const top = await shoot(MAP, { topdown: { x: centre[0], z: centre[2], half: R, turn: fill.turn }, areas: areas(), free: cityFree.rects, labelScale: R / 24, vague: CLEAR });
      const { replies: grounds } = await ask(decide, T.terrainGroundMode, { ...about, shapes: SHAPES,
        pictures: { skyline: `${city.label} from the side and above, as the world stands now.${isCity && terrain.sites[part.id]?.by === 'birth' ? ` It stands as a basic ${bornKind} for now, the engine's default before the text says more; your answers reshape it.` : ''} ${SEEN}`, map: `${city.label} straight down, ${fill.turn ? `turned ${Math.round((fill.turn * 180) / Math.PI)}° so its places fill the picture (north is not up)` : 'north up'}, ${Math.round(R * 2)} m across; its districts and streets pinned and named (${name(holder)}, which holds ${part.label}, in blue), those already kept outlined in white${now ? `; where ${part.label} stands for now, a grey pin` : ''}${cityFree.rects.length ? '; free ground in faint cyan squares' : ''}. A pin is a point, not a size.` } }, stores, { request: { images: { skyline: side.png, map: top.png } } });
      const where = grounds.find(reply => reply.key === 'box'), what = grounds.find(reply => reply.key === 'kind');
      // The answer as the engine's input: a kind of the part's level (a landscape type, or a shape), or a basic shape.
      const options = T.terrainKinds(part.scale, SHAPES), kind = options[what?.value] ? String(what.value) : Object.keys(options)[isCity ? 1 : part.scale === 'street' ? 0 : 1];
      const entry = T.terrainKind(part.scale, kind), shape = entry?.shape ?? (SHAPES[kind] ? kind : null), ground = shape ? null : entry?.ground ?? null;
      const fromMap = (box, map) => (box && map ? [round(map.x - map.halfX + box.left * 2 * map.halfX), round(map.z - map.halfZ + box.top * 2 * map.halfZ), round(map.x - map.halfX + box.right * 2 * map.halfX), round(map.z - map.halfZ + box.bottom * 2 * map.halfZ)] : null);
      const width = Z.LADDER[part.scale]?.sizes ?? [60, 600], fallback = (width[0] + width[1]) / 4, at = holderNode ?? anchor;
      // A city's box is its own circle as the engine has it (the map is the city).
      const spotOf = node => [round(node.x - node.r), round(node.z - node.r), round(node.x + node.r), round(node.z + node.r)];
      // Compatibility (docs/v2/world-engine-v2.md §2.0.15, code, before Jev is asked): a kept place this one's kind may not
      // overlap (OVERLAPS: a square, nothing; what lies below the street, anything). A member's pin on one moves to the
      // nearest open space near it.
      // Of another level, a place the tree does not put it in (nor it in that place) is a clash as before.
      const below = site => (site.median ?? site.top ?? 0) < 0, level = site => site.scale === part.scale;
      const clash = (id, site) => id !== part.id && Array.isArray(site.box) && !(sampled && baseName(site.label) === baseName(part.label)) && !within(part.id, id) && !within(id, part.id) && (!level(site) || !T.mayOverlap(kind, site.kind, below(site)));
      const why = (id, site) => (level(site) ? `it is over ${name(id)} (${site.kind}), which ${/^[aeiou]/.test(kind) ? 'an' : 'a'} ${kind} may not overlap` : `it is over ${name(id)}, which the tree does not put it in`);
      if (sampled && pinAt) {
        const margin = width[0] / 2, onto = point => Object.entries(terrain.sites).find(([id, site]) => clash(id, site) && point[0] > site.box[0] - margin && point[0] < site.box[2] + margin && point[1] > site.box[1] - margin && point[1] < site.box[3] + margin);
        const first = onto(pinAt);
        let open = null;
        if (first) for (let d = 8; d < 3000 && !open; d += 8) for (let k = 0; k < 32 && !open; k++) { const t = k / 32 * Math.PI * 2, point = [round(pinAt[0] + Math.cos(t) * d), round(pinAt[1] + Math.sin(t) * d)]; if (!onto(point)) open = point; }
        if (open) { await live.outcome({ subject: part.label, text: `repinned ${Math.round(Math.hypot(open[0] - pinAt[0], open[1] - pinAt[1]))} m: ${why(...first)}` }); pinAt = open; }
      }
      // A pool's member (docs/v2/world-engine-v2.md §2.0.13, §2.0.15): between its kind and its height, Jev boxes where it
      // lies and how large it is, on a map of its whole district (its pin a suggestion, the places it is tied to marked).
      // The zoom engine: the district's extent (kept, else its kept parts' span, else its circle), the frames for a street there
      // (one when the district fits at a street's scale, else the district for context and a work frame at the street's
      // scale), the free ground in the work frame, and the parent a box is checked against.
      const districtExtent = district ? extentFor(district) : null, districtBox = districtExtent && districtExtent.by !== 'circle' ? districtExtent.box : null;
      const clashes = () => Object.entries(terrain.sites).filter(([id, site]) => clash(id, site)).map(([id, site]) => ({ box: boxNow(id, site), reason: why(id, site) }));
      // The kept places of its level it may adjoin (compatible), which it may not lie mostly over: there is free ground.
      const crowds = () => Object.entries(terrain.sites).filter(([id, site]) => id !== part.id && level(site) && Array.isArray(site.box) && site.by !== 'pool' && !clash(id, site) && !(sampled && baseName(site.label) === baseName(part.label))).map(([id, site]) => ({ box: boxNow(id, site), reason: `it lies mostly over ${name(id)} (${site.kind}): the free ground (faint cyan) has room for it` }));
      // The area the part may lie in and its extent: a pool member's pool's area (§2.0.20), else the place holding it.
      const areaOfPart = sampled ? district : holder, areaExtent = sampled ? districtExtent : isCity ? null : extentFor(holder);
      let areaReply = null, box = null, boxBy = null, laid = null, settled = null;
      if (isCity && cityNode) box = spotOf(cityNode);
      else if (shape) {
        // A shape (a platform, a ramp, a donut, a sphere): what no program makes, so Jev boxes it, on two zooms (§2.0.21).
        // Redirected to free ground (the user's call, §2.0.20): a suggested spot on kept ground of any kind moves to the
        // nearest free stretch a street's usual size wide, in its whole area.
        const usual = Z.usualSize(part.scale), taken = [...clashes(), ...crowds()].map(entry => entry.box), whole = Z.framesFor(part.scale, pinAt ?? [anchor.x, anchor.z], areaExtent?.box ?? null, usual, true);
        const wholeFrame = whole.context ?? whole.work;
        if (pinAt && taken.some(box => Z.inside(box, pinAt))) {
          const open = Z.nearestFree(wholeFrame, areaExtent?.box ?? null, taken, pinAt, usual);
          if (open) { await live.outcome({ subject: part.label, text: `moved ${Math.round(Math.hypot(open[0] - pinAt[0], open[1] - pinAt[1]))} m to free ground: its spot was on kept ground` }); pinAt = open; }
        }
        // Two zooms at a time (the user's call): the whole area, its free ground and its neighbours named large, with the work
        // map's square on it; and the work map at a street's scale round the suggested spot, where the box is drawn.
        const spot = pinAt ?? (areaExtent ? Z.middleOf(areaExtent.box) : [anchor.x, anchor.z]), { work, context } = Z.framesFor(part.scale, spot, areaExtent?.box ?? null, usual, true);
        const free = Z.freeSpace(work, areaExtent?.box ?? null, taken), largest = free.largest ? `${Math.round(Z.widthOf(free.largest))} × ${Math.round(Z.depthOf(free.largest))} m` : null;
        const close = await shoot(MAP, { topdown: { x: work.x, z: work.z, half: work.half }, areas: areas(), free: free.rects, labelScale: work.tag, vague: CLEAR });
        const square = { box: [round(work.x - work.half), round(work.z - work.half), round(work.x + work.half), round(work.z + work.half)], label: 'the map', color: 0x8fd6ff, textColor: '#8fd6ff' };
        const wide = context ? await shoot(MAP, { topdown: { x: context.x, z: context.z, half: context.half }, areas: areas([square]), free: Z.freeSpace(context, areaExtent?.box ?? null, taken).rects, labelScale: context.tag, vague: CLEAR }) : null;
        const tied = [...tiedTo].map(([id, n]) => `${name(id)} ×${n}`);
        ({ replies: [areaReply] } = await ask(decide, T.terrainAreaMode, { ...about, kind, district: name(areaOfPart), tied, pictures: {
          map: `${context ? `part of ${name(areaOfPart)}` : name(areaOfPart)} straight down, north up, ${Math.round(work.half * 2)} m across (a street is usually ${Z.LADDER.street.sizes[0]} to ${Z.LADDER.street.sizes[1]} m); ${part.label}'s suggested spot a grey pin (where continuity would put it, moved onto free ground; anywhere in ${name(areaOfPart)} may do)${tied.length ? `; the places it is tied to marked "tied"` : ''}; the other places pinned, those already kept outlined in white; free ground to build on in faint cyan squares${largest ? ` (the largest free stretch ${largest})` : ''}: build there, not over what is kept. A pin is a point, not a size. ${SEEN}`,
          ...(wide ? { context: `${name(areaOfPart)} as a whole, straight down, north up, ${Math.round(context.half * 2)} m across, its neighbours named large and its free ground in faint cyan: the square marked "the map" is where picture "map" looks.` } : {}) } }, stores, { request: { images: { map: close.png, ...(wide ? { context: wide.png } : {}) } } }));
        top.map = close.map;
        box = fromMap(areaReply?.box, top.map) ?? [at.x - fallback, at.z - fallback, at.x + fallback, at.z + fallback];
        boxBy = areaReply;
      } else if (spawn) {
        // Borrowing and spawning by type (docs/v2/borrow-and-spawn.md §2.3–2.5): sized by its pins as below; then the slot of
        // its kind it raises the characters' travel least by (an unplaced one where the program would place it), or a spawn
        // where nothing can be borrowed. The slot's area holds it from now on; the level's moves come when the level ends.
        const [w, d] = sizeFor(part.scale, ground, pinsOf(part)), placements = new Map();
        const place = (m, parent) => {
          const into = parent ?? spawnArea(holder, part.scale, [w, d], ground, pinAt, tiedTo);
          if (into && !placements.has(into)) placements.set(into, placeIn(into, [w, d], ground, pinAt, clashes().map(entry => entry.box), crowds().map(entry => entry.box), tiedTo, part.scale));
          return into && placements.get(into) ? { parent: into, at: placements.get(into).at } : null;
        };
        const mention = { id: part.id, label: part.label, named: !part.id.startsWith('unnamed:'), kind, holder, scene: world[part.id]?.scene ?? null, pin: pinAt };
        const choice = S.chooseSlots({ book: bookId, level: part.scale, slots: slotsAt(part.scale), mentions: [mention], ties: (a, b) => ties[a]?.[b] ?? 0, fixed: fixedFor([part.id]), within: (id, of) => id === of || within(id, of), sceneIndex: scene => sceneAt.get(scene) ?? 0, place, improve: false });
        const slot = choice.slots.find(entry => entry.id === choice.assignment[part.id]);
        if (!slot?.at) { await live.outcome({ subject: part.label, text: 'no slot of its kind and nowhere to spawn one: it stands at its spot' }); box = [round((pinAt ?? [at.x, at.z])[0] - w / 2), round((pinAt ?? [at.x, at.z])[1] - d / 2), round((pinAt ?? [at.x, at.z])[0] + w / 2), round((pinAt ?? [at.x, at.z])[1] + d / 2)]; }
        else {
          const fresh = !registry.slots[slot.id]?.toward, made = fresh ? placements.get(slot.parent) : null;
          keepSlots(part.scale, choice.slots, { [slot.id]: { size: [w, d], ...(made?.onto ? { turn: made.onto.turn, on: made.onto.what } : {}) } });
          const kept = registry.slots[slot.id], size = kept.size ?? [w, d];
          if (typeof kept.turn === 'number') laid = { turn: kept.turn, size, on: kept.on };
          box = Z.turnedBox(slot.at, size, kept.turn ?? 0);
          holder = mention.named ? slot.parent : slot.owner ?? slot.id;
          slotChosen = { slot: slot.id, heldBy, area: slot.owner ?? slot.id };
          logMap({ level: part.scale, what: choice.spawned.includes(slot.id) ? 'spawn' : mention.named ? 'borrow' : 'share', id: slot.id, place: part.id, parent: slot.parent, kind: slot.kind, ...(fresh ? { at: kept.toward, r: Math.max(...size) / 2 } : {}) });
          const moved = pinAt ? Math.round(Math.hypot(slot.at[0] - pinAt[0], slot.at[1] - pinAt[1])) : null;
          await live.outcome({ subject: part.label, text: `${choice.log.at(-1).replace(`${part.label}: `, '')}${moved !== null ? `, ${moved} m from its spot` : ''}${made?.onto ? ` (laid on its ground's ${made.onto.what})` : ''}` });
        }
      } else {
        // Sized by its pins and placed by the program (the user's design, §2.0.21): its kind's usual size, grown until its
        // buildings hold three a pin; round its spot (its ties' canvas spot), moved onto free ground when that size there
        // would cover a place it may not share or lie over one it may only adjoin.
        const L = LANDSCAPES[ground] ?? null, radius = L ? (L.radius[0] + L.radius[1]) / 2 : Z.usualSize(part.scale) / 2, aspect = L?.aspect ? (L.aspect[0] + L.aspect[1]) / 2 : 1;
        // A landscape's radius is one patch's: a district is at least twice its level's least (about 600 m) before its pins.
        const long = Math.max(2 * radius, part.scale === 'street' ? 0 : 2 * (Z.LADDER[part.scale]?.sizes[0] ?? 0));
        const pins = pinsOf(part), sized = Z.sizeByPins(part.scale, [long, long * aspect], L ? (L.lot[0] + L.lot[1]) / 2 : 400, L?.coverage ?? 0.8, pins);
        const [w, d] = sized.size, boxAt = c => [round(c[0] - w / 2), round(c[1] - d / 2), round(c[0] + w / 2), round(c[1] + d / 2)];
        // Where: one optimization (the user's framing): near the placed places continuity ties it to, a little toward its
        // spot, inside its area, over nothing it may not share, not mostly over what it may only adjoin (Z.placeArea).
        let centre = pinAt ?? (now ? [now.x, now.z] : [at.x, at.z]);
        const spot = centre;
        const tiedPlaced = [...tiedTo].map(([id, ties]) => { const site = terrain.sites[id], node = nodeOf(id), spot = Array.isArray(site?.box) ? Z.middleOf(boxNow(id, site)) : node ? [node.x, node.z] : null; return spot ? { at: spot, ties } : null; }).filter(Boolean);
        // Its area, when that has no box of its own (a city), grown to make room for it beside its kept parts (Z.roomFor).
        const room = areaExtent ? Z.roomFor(areaExtent, partsOf(areaOfPart), [w, d], Z.LADDER[scaleOf(areaOfPart)]?.sizes[1]).box : null;
        const frames = Z.framesFor(part.scale, centre, room, Math.max(w, d), true);
        // What is there first (§2.0.21, step 3): a street may be laid on a form the ground it will stand in already made of
        // its kind (an avenue on an arterial road, a square on a plaza, a waterfront on the water), turned along it; a pool's
        // member is laid on it again each build, as its pool's ground re-forms (the export's `relaid`).
        const made = part.scale === 'street' && ground ? (data.landscapes ?? []).filter(entry => entry.place === holder).flatMap(entry => formsFor(ground, {
          roads: (entry.roads ?? []).map(road => ({ a: [road[0], road[1]], b: [road[2], road[3]], level: road[5] })),
          waters: (entry.waters ?? []).map(water => ({ a: [water[0], water[1]], b: [water[2], water[3]] })),
          plazas: (entry.plazas ?? []).map(([x, z, r]) => ({ x, z, r })) }, w / 2)) : [];
        const placed = Z.placeArea(frames.context ?? frames.work, room, [w, d], centre, tiedPlaced, clashes().map(entry => entry.box), crowds().map(entry => entry.box), 48, made);
        if (placed) {
          const moved = Math.hypot(placed.at[0] - centre[0], placed.at[1] - centre[1]);
          if (placed.onto) await live.outcome({ subject: part.label, text: `laid on its ground's ${placed.onto.what}, ${Math.round(moved)} m from its spot (${made.length} forms of its kind there)` });
          else if (moved > 1) await live.outcome({ subject: part.label, text: `placed ${Math.round(moved)} m from its spot (${tiedPlaced.length ? `near the ${tiedPlaced.length} places it is tied to, ` : ''}on free ground${made.length ? `; none of the ${made.length} forms of its kind near enough` : ''})` });
          centre = placed.at;
          if (placed.onto) laid = { turn: placed.onto.turn, size: [w, d], on: placed.onto.what };
        } else await live.outcome({ subject: part.label, text: 'no allowed place for its size in its area: it stands at its spot, for Jev to settle' });
        box = laid ? Z.turnedBox(centre, [w, d], laid.turn) : boxAt(centre);
        // Settling (§2.0.22, the user's go-ahead): the areas the program placed beside it in its holder move with it under one
        // objective (Z.settle), in the holder's own frame (each kept part's offset from it, as the engine builds them), until
        // no move lowers it; the moves are kept with it when the user steps on, and World · Live plays them sweep by sweep.
        const origin = nodeOf(holder);
        if (origin && room) {
          const O = [origin.x, origin.z], local = q => [round(q[0] - O[0]), round(q[1] - O[1])], shift = b => [b[0] - O[0], b[1] - O[1], b[2] - O[0], b[3] - O[1]];
          const entryOf = (data.landscapes ?? []).find(entry => entry.place === holder);
          const formsOf = (kindOf, long) => (entryOf && kindOf ? formsFor(kindOf, {
            roads: (entryOf.roads ?? []).map(road => ({ a: [road[0], road[1]], b: [road[2], road[3]], level: road[5] })),
            waters: (entryOf.waters ?? []).map(water => ({ a: [water[0], water[1]], b: [water[2], water[3]] })),
            plazas: (entryOf.plazas ?? []).map(([x, z, r]) => ({ x, z, r })) }, long / 2).map(form => ({ ...form, at: local(form.at) })) : []);
          const siblings = Object.entries(terrain.sites).filter(([id, site]) => id !== part.id && site.parent === holder && site.scale === part.scale && Array.isArray(site.toward) && Array.isArray(site.size) && !site.shape && !['universe', 'pool'].includes(site.by));
          const movers = [{ id: part.id, size: [w, d], turn: laid?.turn ?? 0, on: !!laid, at: local(centre), pin: local(spot), onto: part.scale === 'street' ? formsOf(ground, w) : [] },
            ...siblings.map(([id, site]) => ({ id, size: site.size, turn: site.turn ?? 0, on: !!site.on, at: site.toward, pin: site.pinToward ?? site.toward, onto: site.scale === 'street' ? formsOf(site.ground, site.size[0]) : [] }))];
          const moving = new Set(movers.map(m => m.id));
          const fixed = Object.entries(terrain.sites).filter(([id, site]) => !moving.has(id) && site.by !== 'pool' && Array.isArray(site.box)).map(([id, site]) => site.parent === holder && Array.isArray(site.toward) && Array.isArray(site.size)
            ? { id, box: Z.turnedBox(site.toward, site.size, site.turn ?? 0), at: site.toward } : { id, box: shift(boxNow(id, site)), at: local(Z.middleOf(boxNow(id, site))) });
          const infoOf = id => (id === part.id ? { kind, scale: part.scale, label: part.label } : terrain.sites[id]);
          const relation = (a, b) => {
            const A = infoOf(a), B = infoOf(b);
            if (!A || !B || below(A) || below(B) || within(a, b) || within(b, a) || (sampled && baseName(A.label) === baseName(B.label))) return 'free';
            return A.scale !== B.scale ? 'clash' : T.mayOverlap(A.kind, B.kind, false) ? 'adjoin' : 'clash';
          };
          const result = Z.settle(movers, fixed, (a, b) => ties[a]?.[b] ?? 0, relation, shift(room));
          const end = new Map(result.movers.map(m => [m.id, m])), mine = end.get(part.id);
          const whatOf = (m, list) => (m.on ? list.find(form => form.at[0] === m.at[0] && form.at[1] === m.at[1])?.what ?? 'its ground' : null);
          if (result.sweeps.length) {
            centre = [round(O[0] + mine.at[0]), round(O[1] + mine.at[1])];
            laid = mine.on ? { turn: mine.turn, size: [w, d], on: whatOf(mine, movers[0].onto) } : null;
            box = laid ? Z.turnedBox(centre, [w, d], laid.turn) : boxAt(centre);
          }
          // Its sweeps for World · Live: every mover's place after each sweep, in world metres.
          const state = new Map(movers.map(m => [m.id, { at: m.at, turn: m.turn }])), frame = () => movers.map(m => ({ id: m.id, label: m.id === part.id ? part.label : name(m.id), part: m.id === part.id, size: m.size, at: [round(O[0] + state.get(m.id).at[0]), round(O[1] + state.get(m.id).at[1])], turn: state.get(m.id).turn }));
          const frames = [frame()];
          for (const sweep of result.sweeps) { for (const move of sweep) state.set(move.id, { at: move.to, turn: move.turn }); frames.push(frame()); }
          const movedOthers = result.movers.filter(m => m.id !== part.id && result.sweeps.some(sweep => sweep.some(move => move.id === m.id)));
          settled = { pin: local(spot), frames, energy: result.energy, moves: movedOthers.map(m => ({ id: m.id, toward: m.at, turn: m.turn, on: whatOf(m, movers.find(x => x.id === m.id).onto) })) };
          const itself = Math.round(Math.hypot(mine.at[0] - movers[0].at[0], mine.at[1] - movers[0].at[1])), sweeps = `${result.sweeps.length} sweep${result.sweeps.length === 1 ? '' : 's'}`;
          const among = movers.length > 1 ? `with the ${movers.length - 1} area${movers.length === 2 ? '' : 's'} the program placed beside it in ${name(holder)}` : `alone in ${name(holder)}`;
          await live.outcome({ subject: part.label, text: result.sweeps.length
            ? `settled ${among}: ${sweeps}; it moved ${itself} m${movers.length > 1 ? `, ${movedOthers.length} of the others moved` : ''}; ${result.overlaps[0] ? `${result.overlaps[0] - result.overlaps.at(-1)} of ${result.overlaps[0]} overlaps it may not have cleared; ` : ''}objective ${result.objective[0]} → ${result.objective.at(-1)}, continuity ${result.energy[0]} → ${result.energy.at(-1)} tie·m`
            : `settled ${among}: nothing moves (continuity ${result.energy[0]} tie·m)` });
        } else settled = origin ? { pin: [round(spot[0] - origin.x), round(spot[1] - origin.z)] } : null;
        await live.outcome({ subject: part.label, text: `sized ${w} × ${d} m by its ${pins} building pins (${sized.holds} buildings for ${sized.needs} needed${sized.grown ? ', grown' : ''})` });
      }
      // 2. Conflicts and zooms: only a box Jev drew (a shape's) is asked again; the program's settles its own.
      // The zoom engine's sanity: its level's sizes, its middle in its parent, a third of its parent at most, and no kept place
      // it may not share. Its parent: a member's district, else the place holding it when that was boxed.
      const parentBox = sampled ? (districtBox ? { box: districtBox, name: name(district) } : null) : keptBox(holder) ? { box: keptBox(holder), name: name(holder) } : null;
      const conflicts = candidate => Z.sanity(candidate, part.scale, parentBox, clashes(), sampled ? crowds() : []);
      for (let zoom = 1; zoom <= (shape && !isCity ? ZOOMS : 0); zoom++) {
        const reasons = conflicts(box);
        if (!reasons.length) break;
        const detail = Z.detailFrame(box, part.scale), zc = [detail.x, 0, detail.z], zh = detail.half;
        const mark = { box, label: `${part.label}?`, color: 0xff4040, textColor: '#ff6060' };
        await live.outcome({ subject: part.label, text: `zoom ${zoom}: ${reasons.join('; ')}` });
        const zside = await shoot(OVERVIEW, { view: { fov: 38, position: from(zc, yaw, up, zh * 2.2), target: zc }, areas: areas([mark]), labelScale: zh / 28, vague: { near: zh * 5, far: zh * 11 } });
        const ztop = await shoot(MAP, { topdown: { x: zc[0], z: zc[2], half: zh }, areas: areas([mark]), labelScale: detail.tag, vague: CLEAR });
        const { replies: [again] } = await ask(decide, T.terrainZoomMode, { ...about, kind, reasons, pictures: { skyline: `the area from the side and above. ${SEEN}`, map: `the area straight down, north up, ${Math.round(zh * 2)} m across.` } }, stores, { request: { images: { skyline: zside.png, map: ztop.png } } });
        box = fromMap(again?.box, ztop.map) ?? box;
        if (again?.box) boxBy = again;
      }
      // 3. How high the terrain rises (the ground is at 0, always): lettered ghost slices at its kind's own heights (a CBD's
      // from 200 m, a dwelling area's to 60 m: terrainTops), through a core of the area at its middle; red dotted cuts
      // through the buildings the engine stands there for now.
      // The underground's slices first (below the street), then the kind's own: the picture spans them all.
      // Spawn mode asks the kind's standard plus an addition, as averages (docs/v2/borrow-and-spawn.md §8.9).
      const kindManifold = T.terrainKind(part.scale, kind)?.manifold, factor = spawn && kindManifold ? averageOverMedian(kindManifold) : null;
      const { measure, slices: tops, standard } = T.terrainHeights(part.scale, kind, factor ? { factor } : undefined), lo = tops[0].y, hi = tops.at(-1).y, span = hi - lo;
      const core = Math.min(Math.max(box[2] - box[0], box[3] - box[1]) / 2, Math.max(CORE_MIN, span * CORE)), cc = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
      const sample = [round(cc[0] - core), round(cc[1] - core), round(cc[0] + core), round(cc[1] + core)];
      const lots = data.world.lots.map(lot => ({ box: [lot.i0 * CELL, lot.j0 * CELL, (lot.i0 + lot.nx) * CELL, (lot.j0 + lot.nz) * CELL], top: (lot.floors ?? 1) * FLOOR })).filter(lot => lot.box[0] < sample[2] && sample[0] < lot.box[2] && lot.box[1] < sample[3] && sample[1] < lot.box[3]);
      const distance = Math.max(core * 2 * 1.9, span * 2.1, 200), mid = [cc[0], (lo + hi) / 2, cc[1]];
      const heights = await shoot(OVERVIEW, { view: { fov: 40, position: from(mid, yaw, 0.3, distance), target: mid },
        slices: tops.map((entry, k) => ({ box: sample, y: entry.y, label: `${entry.letter} · ${measure === 'average' ? `${entry.offset >= 0 ? '+' : ''}${entry.offset} m` : `${entry.y} m`} · ${entry.said}`, side: k % 2 ? -1 : 1 })), cuts: tops.filter(entry => entry.y > 0).flatMap(entry => lots.filter(lot => lot.top > entry.y).slice(0, 80).map(lot => ({ box: lot.box, y: entry.y }))),
        labelScale: Math.max(2.5, distance / 75), dash: Math.max(1, distance / 160), vague: { near: distance * 1.6, far: distance * 4.5 } });
      const { replies: [rise] } = await ask(decide, T.terrainHeightMode, { ...about, kind, measure, slices: tops, ...(standard ? { standard } : {}), pictures: { heights: `the middle of ${part.label}'s area, ${Math.round(core * 2)} m across, from the side and a little above, ${measure === 'average' ? `a slice at its standard height (+0 m) and at each addition to it, and below the street` : 'a slice at each height its terrain may rise to'}; the city faded behind.` } }, stores, { request: { images: { heights: heights.png } } });
      // A built kind's median, on its manifold (the engine draws the spread); natural ground's or a shape's top.
      const height = tops.find(entry => entry.letter === rise?.value)?.y ?? null, upTo = measure === 'top' ? height : null;
      // An average (spawn mode) is built from its median; below the street a depth stays a depth.
      const average = measure === 'average' && height !== null && height >= 0 ? height : null, median = measure === 'median' ? height : measure === 'average' && height !== null ? (height < 0 ? height : Math.round(height / factor)) : null;
        return { where, boxBy, what, rise, kind, entry, shape, ground, box, laid, settled, median, upTo, measure, average };
      };
      // Kept in an earlier book of the universe under the same name (§2.0.15): reused as it was, Jev not asked; where it lay
      // in its parent, when its parent has the same name too.
      const earlier = !poolOf && !sampled && !part.id.startsWith('unnamed:') ? registry.places[part.label] : null;
      const reuse = earlier && earlier.book !== universe.book && earlier.scale === part.scale ? earlier : null;
      const reused = () => {
        const known = T.terrainKind(part.scale, reuse.kind), entry = { ...known, manifold: reuse.manifold ?? known?.manifold }, shape = reuse.shape ?? null;
        const [w, d] = reuse.size ?? [Z.LADDER[part.scale]?.sizes[0] ?? 100, Z.LADDER[part.scale]?.sizes[0] ?? 100];
        const c = reuse.toward && reuse.parentLabel === name(holder) && holderNode ? [holderNode.x + reuse.toward[0], holderNode.z + reuse.toward[1]] : pinAt ?? [(holderNode ?? anchor).x, (holderNode ?? anchor).z];
        const laid = typeof reuse.turn === 'number' ? { turn: reuse.turn, size: [w, d], on: reuse.on } : null;
        const box = isCity && cityNode ? [round(cityNode.x - cityNode.r), round(cityNode.z - cityNode.r), round(cityNode.x + cityNode.r), round(cityNode.z + cityNode.r)] : laid ? Z.turnedBox(c, [w, d], laid.turn) : [round(c[0] - w / 2), round(c[1] - d / 2), round(c[0] + w / 2), round(c[1] + d / 2)];
        return { boxBy: null, what: null, rise: null, kind: reuse.kind, entry, shape, ground: shape ? null : reuse.ground ?? known?.ground ?? null, box, laid, median: reuse.median ?? null, upTo: reuse.top ?? null, measure: reuse.median != null ? 'median' : 'top', reusedFrom: reuse.book };
      };
      const { boxBy, what, rise, kind, entry, shape, ground, box, laid, settled, median, upTo, measure, average, empty, from: averaged, reusedFrom } = poolOf ? byDefault() : reuse ? reused() : await asked();
      // 4. The proposal in World · Live, the user's step, then the engine's own input, and the world built again.
      const proposal = { id: part.id, label: part.label, kind: kind ?? 'empty', box, top: median ?? upTo, measure, ...(settled?.frames ? { settle: { frames: settled.frames, energy: settled.energy } } : {}) };
      const said = empty ? `empty (nothing of its level decided in ${name(poolOf)} yet)` : `${kind}${median ? (median < 0 ? `, ${-median} m underground` : `, median ${median} m`) : upTo ? (upTo < 0 ? `, ${-upTo} m down` : `, up to ${upTo} m`) : ''}${averaged ? ` (the average of ${averaged} ${part.scale === 'street' ? 'streets' : 'districts'})` : ''}${reusedFrom ? ` (kept in ${reusedFrom}, reused)` : ''}`;
      focus = { x: round((box[0] + box[2]) / 2), z: round((box[1] + box[3]) / 2), r: round(Math.hypot(box[2] - box[0], box[3] - box[1]) * 0.75) };
      await show(`${part.label}: proposal`, proposal);
      await live.outcome({ subject: part.label, text: `${part.label}: ${said}, ${Math.round(box[2] - box[0])} × ${Math.round(box[3] - box[1])} m (blinking in World · Live)` });
      await wait(`${part.label}: ${said}. Look around, then step on to keep it.`);
      const parentNode = nodeOf(holder);
      const toward = parentNode ? [round((box[0] + box[2]) / 2 - parentNode.x), round((box[1] + box[3]) / 2 - parentNode.z)] : null;
      terrain.sites[part.id] = isCity
        ? { label: part.label, scale: 'city', kind, ...(shape ? { shape } : { ground }), ...(median ? { median, manifold: entry.manifold } : {}), ...(average ? { average } : {}), ...(upTo ? { top: upTo } : {}), by: reusedFrom ? 'universe' : 'jev', ...(reusedFrom ? { from: reusedFrom } : {}), confidence: { kind: what?.confidence ?? null, height: rise?.confidence ?? null } }
        : empty ? { label: part.label, parent: holder, parentLabel: name(holder), scale: part.scale, empty: true, by: 'pool', pool: poolOf }
        // A pool's member borrows its pool's ground in the box Jev gave it (the engine builds it there).
        : { label: part.label, parent: holder, parentLabel: name(holder), scale: part.scale, kind, ...(shape ? { shape } : { ground }), ...(sampled ? { member: holder } : {}), size: laid?.size ?? [round(box[2] - box[0]), round(box[3] - box[1])], ...(laid ? { turn: laid.turn, on: laid.on } : {}), toward, ...(settled?.pin ? { pinToward: settled.pin } : {}), box, ...(median ? { median, manifold: entry.manifold } : {}), ...(upTo ? { top: upTo } : {}), by: poolOf ? 'pool' : reusedFrom ? 'universe' : 'jev', ...(poolOf ? { pool: poolOf } : {}), ...(reusedFrom ? { from: reusedFrom } : {}),
          confidence: { box: boxBy?.confidence ?? null, kind: what?.confidence ?? null, height: rise?.confidence ?? null } };
      // Spawn mode: the part is its slot's (its own for good when it is named, a share of this book when not). A named place
      // stands in the slot's area as its own ground; an unnamed one is a marker in the slot, whose ground the slot's site
      // carries (syncSlots).
      if (spawn && slotChosen) {
        const site = terrain.sites[part.id];
        Object.assign(site, { slot: slotChosen.slot, holder: slotChosen.heldBy });
        if (part.id.startsWith('unnamed:')) { site.parent = slotChosen.area; site.parentLabel = name(slotChosen.area); for (const key of ['toward', 'size', 'box', 'turn', 'on', 'pinToward']) delete site[key]; }
      }
      if (shape) terrain.shapes[part.id] = { kind: shape, box, ...(upTo ? { top: upTo } : {}) };
      // The areas it settled with keep where the sweeps left them (their offsets, turns and the forms they lie on).
      for (const move of parentNode ? settled?.moves ?? [] : []) {
        const site = terrain.sites[move.id];
        if (!site) continue;
        site.toward = move.toward;
        if (move.on) Object.assign(site, { turn: move.turn, on: move.on }); else { delete site.turn; delete site.on; }
        site.box = Z.turnedBox([parentNode.x + move.toward[0], parentNode.z + move.toward[1]], site.size, site.turn ?? 0);
      }
      if (!terrain.order.includes(part.id)) terrain.order.push(part.id);
      terrain.askedAt = new Date().toISOString();
      await replace(terrainFile, JSON.stringify(terrain, null, 1));
      // A named place Jev decided here is the universe's from now on, under its exact name (a later book reuses it).
      if (terrain.sites[part.id].by === 'jev' && !sampled && !part.id.startsWith('unnamed:')) {
        const { kind: k, shape: sh, ground: g, median: m, manifold, top: t, size, toward: tw, parentLabel, turn: tn, on } = terrain.sites[part.id];
        registry.places[part.label] = { book: universe.book, id: part.id, scale: part.scale, kind: k, ...(sh ? { shape: sh } : { ground: g }), ...(m ? { median: m, manifold } : {}), ...(t ? { top: t } : {}), ...(size ? { size, toward: tw, parentLabel } : {}), ...(typeof tn === 'number' ? { turn: tn, on } : {}), keptAt: new Date().toISOString() };
        await mkdir(universe.dir, { recursive: true }); await replace(registryFile, JSON.stringify(registry, null, 1));
      }
      if (spawn && isCity) { const said = deformCity(part.id); if (said) await live.outcome({ subject: part.label, text: `deformed to Jev's answer: ${said}` }); }
      if (spawn) await saveSlots();
      await live.phase(`building the world with ${part.label}`);
      await build(part.id);
      await live.phase('terrain');
      placed++;
      const after = nodeOf(part.id);
      await live.outcome({ subject: part.label, text: `${part.label} kept: the world built again, ${data.world.lots.length} lots${after ? `, ${part.label} at ${Math.round(after.x)}, ${Math.round(after.z)} (r ${Math.round(after.r)} m)` : ''}` });
      log(`${city.label} › ${part.label}: ${said}`);
    }
    if (client.usage?.length) await writeFile(join(folder, 'jev-usage.json'), JSON.stringify(client.usage), { mode: 0o644 });
    // What the context engine gave each request, and what it cut.
    await writeFile(join(folder, 'contexts.json'), JSON.stringify(contexts), { mode: 0o644 });
    await live.line(0, { status: 'done', placed }); await live.finish('done', { calls, paid: client.usage?.length ?? null });
    return { calls, placed, cities: cities.length, builds };
  } catch (error) {
    await live.finish('failed', { error: String(error?.message ?? error).slice(0, 300) });
    throw error;
  } finally { live.encoder(null); await chrome.close(); server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { run: { type: 'boolean' }, parts: { type: 'string' }, spawn: { type: 'boolean' }, from: { type: 'string' }, until: { type: 'string' } } });
  const [novelDir] = positionals, levels = ['city', 'district', 'street'];
  if (!novelDir || (values.from && !levels.includes(values.from)) || (values.until && !levels.includes(values.until))) { console.error('usage: node world-engine/terrain-spawn.mjs <novel-dir> [--run] [--parts N] [--spawn] [--from city|district|street] [--until city|district|street]'); process.exit(2); }
  console.log(JSON.stringify(await terrainSpawn(resolve(novelDir), { run: values.run, parts: values.parts ? Number(values.parts) : Infinity, spawn: values.spawn, from: values.from ?? null, until: values.until ?? null, log: line => console.error(line) })));
}
