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
 *   1. overview: the city from the side and above (1440×900) and straight down (1024×1024), the places so far outlined and
 *      named; Jev boxes where the part lies on the map and picks its ground: a manifold (a landscape type, whose buildings
 *      the engine fills in) or a basic shape (plateau, basin, hill, platform, cut, ramp, rectangle, sphere, donut);
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
 *   npm run build && node playground/terrain-spawn.mjs <novel-dir> [--run] [--parts N]   (N: stop after that many parts)
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
/** The basic shapes of ground the terrain faculty may place besides the manifolds (the user's list, 2026-10-31). */
export const SHAPES = {
  plateau: 'a plateau: raised flat ground with sloping sides', basin: 'a basin: a hollow below the ground around it', hill: 'a hill: a rounded rise',
  platform: 'a platform: a flat deck raised above the ground', cut: 'a cut: a trench or a pit dug into the ground', ramp: 'a ramp: ground sloping up from one side to the other',
  rectangle: 'a rectangle: a plain block of ground', sphere: 'a sphere', donut: 'a donut: a ring, as a torus',
};
/** How wide a part's ground is, by its scale (metres): a box far from it is asked about again. */
const SCALE_WIDTH = { district: [300, 2400], street: [40, 400], city: [800, 8000] };
const OVERVIEW = [1440, 900], MAP = [1024, 1024], ZOOMS = 2, CELL = 2, FLOOR = 3, OPEN = new Set(['district', 'street']);
/** Half the core the height question looks through (metres): about the levels' own span, so they stand apart on the picture. */
const CORE = 84;
/** No fog: a map straight down reads every metre of its ground alike. */
const CLEAR = { near: 1e6, far: 2e6 };

async function replace(file, body) { const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, body, { mode: 0o644 }); await rename(temporary, file); }

export async function terrainSpawn(novelDir, { jev: given = null, run = false, parts: limit = Infinity, log = () => {} } = {}) {
  const L = await load('dist/src/ground/stage/landscape.js');
  const { stageInputs } = await load('dist/src/cli/commands/extract/stageCommands.js');
  const { simStrandList } = await load('dist/src/cli/commands/extract/simCommands.js');
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  // Every Jev request is composed by the context engine (the user's call): the terrain modes, from the reading's stores.
  const { ask } = await load('dist/src/v2/context/engine.js'), T = await load('dist/src/v2/context/terrainModes.js');
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
  const live = await createLive(novelDir, { command: 'sim terrain', lines: [{ id: 'terrain', title: 'Terrain: the ground of the volume\'s places' }], model: jev.modelId });
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
    await live.phase(`waiting for you: ${why}`);
    for (;;) { await new Promise(done => setTimeout(done, 700)); step = await readStep(); if (step.mode === 'run' || (step.n ?? 0) > seen) { seen = step.n ?? seen; break; } }
    await live.line(0, { mode: step.mode }); await live.phase('terrain');
  };

  // The engine's world, built again after each commit: World · Live gets it (with the proposal, blinking), and so does Jev's page.
  const terrainFile = join(novelDir, 'stage', 'terrain.json');
  const terrain = JSON.parse(await readFile(terrainFile, 'utf8').catch(() => 'null')) ?? { sites: {} };
  terrain.version = 2; terrain.model = jev.modelId; terrain.sites ??= {}; terrain.order ??= []; terrain.shapes ??= {};
  const template = await readFile(join(repository, 'playground', 'strand-demo.html'), 'utf8');
  const work = await mkdtemp(join(tmpdir(), 'terrain-engine-'));
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  await writeFile(join(work, 'index.html'), '');
  const { server, url } = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser();
  live.encoder(png => chrome.evaluate(`(async () => { const image = new Image(); image.src = 'data:image/png;base64,${png}'; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL('image/jpeg', 0.78).split(',')[1]; })()`));
  // World · Live is told where to look (the focus): the proposal, or the place just kept; `terrain` keeps the whole world drawn.
  let data = null, snapshot = null, reference = null, builds = 0, focus = null;
  const show = (moment, proposal = null) => (snapshot ? live.world({ ...snapshot, moment, ...(focus ? { focus } : {}) }, { ...data, terrain: { proposal } }) : null);
  const build = async (kept = null) => {
    const started = Date.now();
    data = await strandDemo(novelDir, { from: line.from, to: line.to, worldOnly: true, title: 'Terrain', live: shot => { snapshot = shot; } });
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
  const circle = (x, z, r) => Array.from({ length: 48 }, (_, n) => { const t = n / 48 * Math.PI * 2; return [round(x + r * Math.cos(t)), round(z + r * Math.sin(t))]; });
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
      scenes: base.map(scene => ({ id: scene.id, index: scene.index, environment: scene.environment ?? [] })),
    }, sentences, parentOf, name);
    const within = (id, city) => { for (let at = parentOf(id), n = 0; at && n < 12; at = parentOf(at), n++) if (at === city) return true; return false; };
    const mentions = label => sentences.filter(sentence => sentence.text.includes(label)).length, firstAt = label => sentences.findIndex(sentence => sentence.text.includes(label));
    const cities = Object.keys(inputs.scale?.places ?? {}).filter(id => scaleOf(id) === 'city').map(id => ({ id, label: name(id), mentions: mentions(name(id)) })).filter(city => city.mentions).sort((a, b) => b.mentions - a.mentions);
    const open = Object.keys(inputs.scale?.places ?? {}).filter(id => OPEN.has(scaleOf(id))).map(id => ({ id, label: name(id), scale: scaleOf(id), at: firstAt(name(id)) })).filter(part => part.at >= 0);
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
    const kinds = { ...Object.fromEntries(Object.keys(L.LANDSCAPES).map(type => [type, `${type}: ${L.LANDSCAPES[type].hint} (the engine fills in its buildings)`])), ...SHAPES };
    const total = [...partsOf.values()].reduce((sum, list) => sum + list.length, 0);
    let placed = 0;
    for (const city of cities) for (const part of partsOf.get(city.id) ?? []) {
      if (placed >= limit) break;
      const holder = holderOf(part, city), cityNode = nodeOf(city.id), holderNode = nodeOf(holder) ?? cityNode;
      // The city as the engine stands it now: its node and the districts and streets in it (not the rooms and buildings the
      // scenes are set in, nor the canvas's stand-in areas), and the sites so far.
      const kin = data.macro.filter(node => node.id !== part.id && (node.id === city.id || ((within(node.id, city.id) || member.get(node.id)?.city === city.id) && OPEN.has(node.scale))) && !String(node.id).startsWith('spot:') && !node.temporary && !node.unbuilt);
      const anchor = cityNode ?? holderNode ?? { x: 0, z: 0 }, centre = [anchor.x, 0, anchor.z];
      const R = Math.max(400, ...kin.map(node => Math.hypot(node.x - centre[0], node.z - centre[2]) + node.r)) * 1.1;
      // Where the engine has the part for now (the canvas's spot for it, or what was kept before), in grey: Jev keeps or moves it.
      const now = nodeOf(part.id);
      const areas = (extra = []) => [
        // A part already kept is drawn once, as its kept box (below), not again as the engine's circle.
        ...kin.filter(node => node.id !== city.id && !Array.isArray(terrain.sites[node.id]?.box)).map(node => ({ pts: circle(node.x, node.z, node.r), label: node.dwelling ? `${node.label} (sampled: the text puts it nowhere)` : node.label, color: node.id === holder ? 0x7ce6ff : 0xffd36e, textColor: node.id === holder ? '#7ce6ff' : '#ffd36e' })),
        ...(now ? [{ pts: circle(now.x, now.z, now.r), label: `${part.label} · now`, color: 0x9fb4c3, textColor: '#c9d6df' }] : []),
        ...Object.entries(terrain.sites).filter(([id, site]) => Array.isArray(site.box) && id !== part.id).map(([id, site]) => ({ box: site.box, label: name(id), color: 0xffffff, textColor: '#ffffff' })), ...extra];
      const about = { part: { id: part.id, label: part.label, scale: part.scale }, holder: { id: holder, label: name(holder) }, city: { id: city.id, label: city.label } };
      await live.line(0, { status: 'running', part: `${part.label} (${placed + 1} of ${total}, in ${city.label})` });
      focus = { x: round(centre[0]), z: round(centre[2]), r: round(R * 0.6) };
      // 1. Overview.
      const yaw = -0.62, up = 0.52;
      const side = await shoot(OVERVIEW, { view: { fov: 38, position: from(centre, yaw, up, R * 1.8), target: centre }, areas: areas(), labelScale: R / 32, vague: { near: R * 4, far: R * 9 } });
      const top = await shoot(MAP, { topdown: { x: centre[0], z: centre[2], half: R }, areas: areas(), labelScale: R / 24, vague: CLEAR });
      const { replies: [where, what] } = await ask(decide, T.terrainGroundMode, { ...about, kinds,
        pictures: { skyline: `${city.label} from the side and above, as the world stands now.`, map: `${city.label} straight down, north up, ${Math.round(R * 2)} m across; its districts and streets outlined and named (${name(holder)}, which holds ${part.label}, in blue)${now ? `; where ${part.label} stands for now in grey` : ''}.` } }, stores, { request: { images: { skyline: side.png, map: top.png } } });
      const kind = kinds[what?.value] ? String(what.value) : 'commercial', shape = SHAPES[kind] ? kind : null;
      const fromMap = (box, map) => (box && map ? [round(map.x - map.halfX + box.left * 2 * map.halfX), round(map.z - map.halfZ + box.top * 2 * map.halfZ), round(map.x - map.halfX + box.right * 2 * map.halfX), round(map.z - map.halfZ + box.bottom * 2 * map.halfZ)] : null);
      const width = SCALE_WIDTH[part.scale] ?? [60, 600], fallback = (width[0] + width[1]) / 4, at = holderNode ?? anchor;
      let box = fromMap(where?.box, top.map) ?? [at.x - fallback, at.z - fallback, at.x + fallback, at.z + fallback];
      // 2. Conflicts and zooms.
      const conflicts = candidate => {
        const reasons = [], across = Math.max(candidate[2] - candidate[0], candidate[3] - candidate[1]);
        const overlap = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
        for (const [id, site] of Object.entries(terrain.sites)) if (id !== part.id && Array.isArray(site.box) && overlap(candidate, site.box) && !within(part.id, id) && !within(id, part.id)) reasons.push(`it is over ${name(id)}, which the tree does not put it in`);
        if (across > width[1]) reasons.push(`${Math.round(across)} m across is too big for a ${part.scale}`);
        if (across < width[0]) reasons.push(`${Math.round(across)} m across is too small for a ${part.scale}`);
        if ((candidate[2] - candidate[0]) * (candidate[3] - candidate[1]) > 0.25 * (2 * R) ** 2) reasons.push('it takes more than a quarter of the map');
        return reasons;
      };
      for (let zoom = 1; zoom <= ZOOMS; zoom++) {
        const reasons = conflicts(box);
        if (!reasons.length) break;
        const zc = [(box[0] + box[2]) / 2, 0, (box[1] + box[3]) / 2], zh = Math.max(width[0], Math.max(box[2] - box[0], box[3] - box[1])) * 0.95;
        const mark = { box, label: `${part.label}?`, color: 0xff4040, textColor: '#ff6060' };
        await live.outcome({ subject: part.label, text: `zoom ${zoom}: ${reasons.join('; ')}` });
        const zside = await shoot(OVERVIEW, { view: { fov: 38, position: from(zc, yaw, up, zh * 2.2), target: zc }, areas: areas([mark]), labelScale: zh / 28, vague: { near: zh * 5, far: zh * 11 } });
        const ztop = await shoot(MAP, { topdown: { x: zc[0], z: zc[2], half: zh }, areas: areas([mark]), labelScale: zh / 22, vague: CLEAR });
        const { replies: [again] } = await ask(decide, T.terrainZoomMode, { ...about, kind, reasons, pictures: { skyline: 'the area from the side and above.', map: `the area straight down, north up, ${Math.round(zh * 2)} m across.` } }, stores, { request: { images: { skyline: zside.png, map: ztop.png } } });
        box = fromMap(again?.box, ztop.map) ?? box;
      }
      // 3. Height: ghost slices at every height the world has, through a core of the area at its middle (the whole of a big
      // area would put the slices a few pixels apart); red dotted cuts through its buildings.
      const core = Math.min(Math.max(box[2] - box[0], box[3] - box[1]) / 2, CORE), cc = [(box[0] + box[2]) / 2, (box[1] + box[3]) / 2];
      const sample = [round(cc[0] - core), round(cc[1] - core), round(cc[0] + core), round(cc[1] + core)];
      const lots = data.world.lots.map(lot => ({ box: [lot.i0 * CELL, lot.j0 * CELL, (lot.i0 + lot.nx) * CELL, (lot.j0 + lot.nz) * CELL], top: (lot.floors ?? 1) * FLOOR })).filter(lot => lot.box[0] < sample[2] && sample[0] < lot.box[2] && lot.box[1] < sample[3] && sample[1] < lot.box[3]);
      const roofs = [...new Set(lots.map(lot => lot.top))].sort((a, b) => b - a), tallest = roofs[0] ?? 0, median = roofs[Math.floor(roofs.length / 2)] ?? 0;
      const levels = [[-60, 'deep underground'], [-12, 'the subway'], [-5, 'just under the street'], [0, 'the street'], [6, 'two floors up'], [15, 'five floors up'], ...(median > 20 ? [[median, 'the roofs around']] : []), ...(tallest > 30 ? [[tallest, 'the tallest roof'], [tallest + 40, 'the sky above the roofs']] : [[60, 'the sky']])]
        .filter(([y], k, all) => all.findIndex(([other]) => Math.abs(other - y) < 3) === k).sort((a, b) => a[0] - b[0]).map(([y, said], k) => ({ letter: 'ABCDEFGHIJ'[k], y: Math.round(y), said }));
      const span = levels.at(-1).y - levels[0].y, distance = Math.max(core * 2 * 1.9, span * 2.1, 200), mid = [cc[0], (levels[0].y + levels.at(-1).y) / 2, cc[1]];
      const heights = await shoot(OVERVIEW, { view: { fov: 40, position: from(mid, yaw, 0.3, distance), target: mid },
        slices: levels.map((level, k) => ({ box: sample, y: level.y, label: `${level.letter} · ${level.y} m · ${level.said}`, side: k % 2 ? -1 : 1 })), cuts: levels.flatMap(level => (level.y > 0 ? lots.filter(lot => lot.top > level.y).slice(0, 80).map(lot => ({ box: lot.box, y: level.y })) : [])),
        labelScale: Math.max(2.5, distance / 75), dash: Math.max(1, distance / 160), vague: { near: distance * 0.9, far: distance * 2.6 } });
      const { replies: [level] } = await ask(decide, T.terrainHeightMode, { ...about, kind, levels, pictures: { heights: `the middle of ${part.label}'s area, ${Math.round(core * 2)} m across, from the side and a little above, the city faded behind.` } }, stores, { request: { images: { heights: heights.png } } });
      const y = levels.find(entry => entry.letter === level?.value)?.y ?? 0;
      // 4. The proposal in World · Live, the user's step, then the engine's own input, and the world built again.
      const proposal = { id: part.id, label: part.label, kind, box, y };
      focus = { x: round((box[0] + box[2]) / 2), z: round((box[1] + box[3]) / 2), r: round(Math.hypot(box[2] - box[0], box[3] - box[1]) * 0.75) };
      await show(`${part.label}: proposal`, proposal);
      await live.outcome({ subject: part.label, text: `${part.label}: ${kind} at ${y} m, ${Math.round(box[2] - box[0])} × ${Math.round(box[3] - box[1])} m (blinking in World · Live)` });
      await wait(`${part.label}: ${kind} at ${y} m. Look around, then step on to keep it.`);
      const parentNode = nodeOf(holder);
      const toward = parentNode ? [round((box[0] + box[2]) / 2 - parentNode.x), round((box[1] + box[3]) / 2 - parentNode.z)] : null;
      terrain.sites[part.id] = { label: part.label, parent: holder, parentLabel: name(holder), scale: part.scale, ...(shape ? { shape } : { ground: kind }), size: [round(box[2] - box[0]), round(box[3] - box[1])], toward, box, y, by: 'jev',
        confidence: { box: where?.confidence ?? null, kind: what?.confidence ?? null, height: level?.confidence ?? null } };
      if (shape) terrain.shapes[part.id] = { kind: shape, box, y };
      if (!terrain.order.includes(part.id)) terrain.order.push(part.id);
      terrain.askedAt = new Date().toISOString();
      await replace(terrainFile, JSON.stringify(terrain, null, 1));
      await live.phase(`building the world with ${part.label}`);
      await build(part.id);
      await live.phase('terrain');
      placed++;
      const after = nodeOf(part.id);
      await live.outcome({ subject: part.label, text: `${part.label} kept: the world built again, ${data.world.lots.length} lots${after ? `, ${part.label} at ${Math.round(after.x)}, ${Math.round(after.z)} (r ${Math.round(after.r)} m)` : ''}` });
      log(`${city.label} › ${part.label}: ${kind} at ${y} m`);
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
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { run: { type: 'boolean' }, parts: { type: 'string' } } });
  const [novelDir] = positionals;
  if (!novelDir) { console.error('usage: node playground/terrain-spawn.mjs <novel-dir> [--run] [--parts N]'); process.exit(2); }
  console.log(JSON.stringify(await terrainSpawn(resolve(novelDir), { run: values.run, parts: values.parts ? Number(values.parts) : Infinity, log: line => console.error(line) })));
}
