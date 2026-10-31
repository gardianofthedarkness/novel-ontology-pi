// One timeline strand as a continuous, shareable page: its places built from the place tree (a district or
// street of skeleton buildings: corridors, stair cores, box rooms on every floor; clutter drawn by percolation
// conditioned on access; fights damaging buildings in story order), its people
// walked scene by scene with positions handed along their world lines (stage environment), and every move
// sampled from the path integral (an exact h-transform draw, plus a small ensemble to show the spread).
// Where each move ends comes from Jev's spot answers in the book's movement report. The page carries scene
// and event summaries, names and places; no quotes or source text.
//   npm run build && node playground/export-strand-demo.mjs <novel-dir> <out.html> --from <scene-id> --to <scene-id> [--fork <scene-id>] [--title text]
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { mapPicture } from './world-map.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = path => import(pathToFileURL(`${repository}/${path}`));
const PALETTE = ['#7ce6ff', '#ff8fb1', '#ffd36e', '#9dff8a', '#c59bff', '#ff9d5c', '#5cf2c8', '#f2f2f2', '#8fb6ff', '#e0ff6e'];
/** The artistic models (Kenney CC0 kits, baked in apps/playground) a building of each role may wear; one is drawn per lot at random. */
/** Shells for lots on ancient ground (a village, a castle town, farmland): the old town's buildings. */
const ANCIENT_SHELLS = ['market', 'keep', 'windmill', 'market'];
const SHELLS = { office: ['tower-a', 'tower-b', 'tower-d', 'tower-e', 'tower-f', 'tower-g', 'tower-h', 'tower-i', 'tower-j', 'tower-l', 'tower-m', 'office-c', 'office-h', 'block-wide-a', 'block-wide-b'], tall: ['skyscraper-a', 'skyscraper-b', 'skyscraper-e', 'tower-c', 'tower-k'], shop: ['office-c', 'block-wide-a', 'market'], hospital: ['office-k'], station: ['block-wide-b'], school: ['kk-school'], home: ['kk-dormitory', 'kk-apartment'], mall: ['kk-mall'] };
// The basic shapes, at unit size (their extents). A sphere is a kind of oval: an oval in a cube-shaped cast.
const SHAPES = { box: [1, 1, 1], oval: [1, 0.55, 0.7], triangle: [1, 1, 1], diamond: [1, 1, 1], donut: [1, 0.3, 1] };
/**
 * The biggest fit of a model or shape inside a cast (metres): a model keeps its proportions and scales evenly, turned
 * 0° or 90°, whichever fits larger, resting on the cast's floor (centred in it when the cast is in the air); a basic shape
 * stretches to fill the cast, and a donut stands on edge when the cast is taller than it is wide.
 * Returns the form's scale and turn, and its extent in the place's axes.
 */
export function fitInCast(form, cast, natural) {
  if (natural) {
    const [nw, nh, nd] = natural, fits = [0, 90].map(turn => { const [w, d] = turn ? [nd, nw] : [nw, nd]; return { turn, s: Math.min(cast.w / w, cast.h / nh, cast.d / d), w, d }; }), best = fits.sort((a, b) => b.s - a.s)[0];
    const h = nh * best.s, lift = cast.y0 > 1.5 ? (cast.h - h) / 2 : 0;
    return { sx: best.s, sy: best.s, sz: best.s, turn: best.turn, stand: false, w: best.w * best.s, h, d: best.d * best.s, y0: cast.y0 + lift };
  }
  if (form === 'donut' && cast.h > Math.max(cast.w, cast.d)) {
    const along = cast.w >= cast.d, across = Math.max(cast.w, cast.d), thick = Math.min(Math.min(cast.w, cast.d), 0.3 * Math.min(across, cast.h));
    return { sx: across, sy: cast.h, sz: thick / 0.3, turn: along ? 0 : 90, stand: true, w: along ? across : thick, h: cast.h, d: along ? thick : across, y0: cast.y0 };
  }
  const [nw, nh, nd] = SHAPES[form] ?? SHAPES.box;
  return { sx: cast.w / nw, sy: cast.h / nh, sz: cast.d / nd, turn: 0, stand: false, w: cast.w, h: cast.h, d: cast.d, y0: cast.y0 };
}
const ROLE_OF = { hospital: 'hospital', station: 'station', office: 'office', skyscraper: 'office', school: 'school', home: 'home', market: 'shop', church: 'station' };
/** Floors of a named building by its kind (novel stage architecture). */
const FLOORS_OF = { skyscraper: 16, office: 10, school: 4, home: 8, hospital: 6, market: 2, station: 2, church: 2 };
/** A world-first spot's building (the world loop's choice when it made the spot): its role in the world and its floors. */
const BUILDING_OF = { school: ['school', 4], dormitory: ['home', 8], house: ['home', 2], hospital: ['hospital', 6], office: ['office', 10], mall: ['mall', 5], shop: ['shop', 2], station: ['station', 2], church: ['station', 2], skyscraper: ['office', 16], warehouse: ['station', 2] };
/** Edge-cost factors by kind [walk, climb, descend, jump, fall, sky arc]: a fall is cheap only for someone falling; jumps and arcs for someone running or falling. */
const FACTORS = { walk: [1, 1, 1, 3, 6, 3], run: [1, 1, 1, 1, 4, 1], fall: [1, 1, 1, 1, 0.15, 1] };
const classOf = how => how === 'fall' ? 'fall' : how === 'run' ? 'run' : 'walk';
/** Until the damage question is asked of Jev: a reading of the event summary, from the strongest words down. */
const DAMAGE_WORDS = [[4, /倒塌|崩塌|摧毁|炸毁|夷为平地|粉碎|坍塌/], [3, /爆炸|炸|轰|电磁炮|炮击|冲击波/], [2, /劈|砍|击穿|砸|撞|射|开火|斩|雷击|闪电/]];
export const damageDegree = text => DAMAGE_WORDS.find(([, pattern]) => pattern.test(text))?.[0] ?? 0;
/** Until the direction question is asked of Jev: a direct move needs the event's text to show its actor using a power to move. */
const POWER_WORDS = /飞行|飞向|飞过|飞起|飞翔|浮空|悬浮|瞬间移动|瞬移|空间移动|传送|弹射|磁力|喷射/;

export async function strandDemo(novelDir, options) {
  const { stageInputs } = await load('dist/src/cli/commands/extract/stageCommands.js');
  const { storyStrands } = await load('dist/src/digger/timeplace/strandQuestions.js');
  const { latestStrandAnswers } = await load('dist/src/digger/timeplace/strandView.js');
  const { forkTimeline, walkTimeline } = await load('dist/src/digger/stage/environment.js');
  const { composePlace, placeGraph, placeSpot, nodePosition, nodeOf, degrade, semanticAxis, cellAt, cutOffOf } = await load('dist/apps/playground/src/data/skeletonPlace.js');
  const { macroLattice, latticeNode, latticeWithin, crossings, smoothPath } = await load('dist/apps/playground/src/data/macroPath.js');
  const { structureOf, intact, blast, settle, skeletonStanding, unitAt, BLAST_ENERGY } = await load('dist/apps/playground/src/data/structure.js');
  const C = await load('dist/src/ground/stage/placeCanvas.js'), { fillLandscape, groundFor, insideBy, reachOf, LANDSCAPES, patchFromBox } = await load('dist/src/ground/stage/landscape.js'), U = await load('dist/src/ground/stage/underground.js'), W = await load('dist/apps/playground/src/data/world.js');
  // Model themes (modelThemes.json): a thing is drawn in the theme of the manifold under it, unless Jev switched theme.
  const { themedModel } = await load('dist/apps/playground/src/data/modelThemes.js'), modelThemes = JSON.parse(await readFile(`${repository}/apps/playground/src/data/modelThemes.json`, 'utf8'));
  const { newBuildingHere } = await load('dist/src/digger/stage/objects.js');
  const { stageKindOf, scaleOfName } = await load('dist/src/digger/stage/scale.js');
  const { skeletonStream: stream, generateSkeleton, SKELETON_CELL } = await load('dist/apps/playground/src/data/skeleton.js');
  const { solveWalk, sampleWalk: walkSample, temperatureBound, directionOf } = await load('dist/apps/playground/src/data/pathIntegral.js');
  const { navGrid } = await load('dist/src/ground/stage/holoNav.js');
  const inputs = await stageInputs(novelDir), answers = await latestStrandAnswers(novelDir), strands = storyStrands(inputs.data, answers ?? {});
  const staged = new Map(inputs.movementScenes.map(scene => [scene.id, scene])), byIndex = new Map(inputs.data.scenes.map(scene => [scene.id, scene.index]));
  const all = inputs.data.scenes.map(scene => { const stage = staged.get(scene.id); return { id: scene.id, index: scene.index, placeId: stage?.placeId ?? scene.placeIds[0] ?? null, flashback: scene.flashback, cast: stage?.cast ?? answers?.presence.get(scene.id) ?? scene.characterIds, events: stage?.events }; });
  const fork = options.fork ? forkTimeline(all, strands).forkOf : null;
  const lineScenes = all.filter(scene => staged.has(scene.id) && scene.events?.length && byIndex.get(scene.id) >= byIndex.get(options.from) && byIndex.get(scene.id) <= byIndex.get(options.to) && (!fork || fork.get(scene.id) === fork.get(options.fork)));
  // `until` (a scene and an event index): the line only as far as that event, for a loop that decides one event at a time.
  const stop = options.until ? byIndex.get(options.until.scene) : Infinity;
  // `worldOnly` (terrain spawning): the world the line's scenes stand in, built and reached, with no event played and no
  // question asked (nobody is born by Jev; the engine's own starts reach each scene's place).
  const chosen = lineScenes.filter(scene => byIndex.get(scene.id) <= stop).map(scene => (options.worldOnly ? { ...scene, events: [] } : scene.id === options.until?.scene ? { ...scene, events: scene.events.slice(0, options.until.event + 1) } : scene));
  const timeline = forkTimeline(chosen, strands);
  // World-first (docs/world-first-design.md): the world script's dialogue nodes come in among each scene's events (a live
  // or a group node moves people: who came to whom, or where the group gathers); and Jev is asked at run time, in the
  // scene's composed context, where someone first seen starts (the level, then a box on a map of the place), who came to
  // whom when two people talking face to face are apart, and the box a group gathers in. Cached under stage/world/cache.
  const worldScript = inputs.worldFirst ? inputs.world : null, worldScene = new Map((worldScript?.scenes ?? []).map(scene => [scene.id, scene]));
  // Terrain and spawns (playground/terrain.mjs), when they were asked: where Jev put each main site in the place that holds
  // it, and which scenes start anew (everyone present placed afresh, with the scene's environment in the question).
  const terrain = JSON.parse(await readFile(`${novelDir}/stage/terrain.json`, 'utf8').catch(() => 'null'));
  const spawnPlan = JSON.parse(await readFile(`${novelDir}/stage/world/spawn.json`, 'utf8').catch(() => 'null'));
  const anew = sceneId => spawnPlan?.scenes?.[sceneId]?.spawn === 'new';
  let jev = null;
  if (worldScript && !options.worldOnly) {
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
    // Pinned to the model that answers box questions (1.14): left to the environment, Jev defaults to 1.13, which refuses them.
    jev = cachedDecisions(jevFromEnv({ ...process.env, JEV_MODEL: WORLD_MODEL }), `${novelDir}/stage/world/cache`);
    // A live run records every question the engine asks (its exact prompt and pictures) on the live page.
    if (options.watch) jev = options.watch(jev);
    for (const scene of chosen) {
      const entry = worldScene.get(scene.id);
      if (!entry) continue;
      const own = new Map((scene.events ?? []).map(event => [event.id, event]));
      scene.events = entry.timeline.flatMap(item => item.type === 'event' ? (own.has(item.id) ? [own.get(item.id)] : []) : ['live', 'group'].includes(item.kind) && item.parties.length ? [{ id: item.id, text: item.kind === 'group' ? '（几个人当面交谈）' : '（两人当面交谈）', actors: item.parties, dialogue: item }] : []);
    }
  }
  const places = new Map(inputs.data.places.map(place => [place.id, place])), name = id => inputs.names[id] ?? id;

  // One world for every staged place (apps/playground/src/data/world.ts): the city of the canvas and its landscapes, streamed
  // in by chunks as the story reaches it. A staged building is an anchor on its canvas spot; an open place is its ground.
  // Each place keeps its name and path; the world's lots, things, standing cells and graph are shared by all of them.
  const ownGrids = new Set(chosen.map(scene => scene.placeId));
  const kindOf = placeId => { const own = inputs.architecture?.places[placeId]?.kind, scale = inputs.scale?.places[placeId]?.scale ?? null; return stageKindOf(scale) ?? (['skyscraper', 'office', 'home', 'hospital', 'school', 'station', 'church', 'market', 'castle'].includes(own) ? 'site' : /[街路巷道]$/.test(name(placeId)) ? 'street' : 'district'); };
  const groups = new Map(), shared = { layout: null, things: new Map(), standing: [], structures: [], units: [], version: 0, built: null };
  const groupOf = own => Object.defineProperties(own, Object.fromEntries(['layout', 'things', 'standing', 'structures', 'units', 'version', 'built'].map(key => [key, { get: () => shared[key], set: value => { shared[key] = value; } }])));
  let world = null, moment = 'start';
  /**
   * The walk graph of the world round a point, as it stands now: one window per neighbourhood (128 m squares, 192 m either
   * way of their middle), shared by everything asked there until the world changes; a wider one when `half` needs it.
   */
  const windows = new Map();
  const graphOf = (focus = null, half = 0) => {
    if (shared.built?.version !== shared.version) { shared.built = { version: shared.version }; windows.clear(); fields.clear(); spotCache.clear(); }
    const f = focus ?? { x: 0, z: 0 }, cx = Math.round(f.x / 128) * 128, cz = Math.round(f.z / 128) * 128, h = Math.max(192, Math.ceil((half + Math.max(Math.abs(f.x - cx), Math.abs(f.z - cz))) / 64) * 64), key = `${cx}|${cz}|${h}`;
    if (!windows.has(key)) windows.set(key, { version: shared.version, ...W.worldGraph(world, shared.standing, [...shared.things.values()], { x0: cx - h, x1: cx + h, z0: cz - h, z1: cz + h }) });
    return windows.get(key);
  };
  /**
   * Stream in the world around a point at this moment: new chunks bring their lots (standing whole), and the walk sees them.
   * It streams 32 m further than asked, so the next small step rarely needs more.
   */
  const reach = (x, z, radius, at = moment) => {
    if (!W.ensure(world, x, z, radius, at)) return;
    W.ensure(world, x, z, radius + 32, at);
    while (shared.standing.length < world.lots.length) shared.standing.push(world.lots[shared.standing.length].skeleton.cells.map(value => (value ? 1 : 0)));
    shared.version++;
    applyEarlier();
  };
  const T = 0.6 * temperatureBound({ step: 2, kappa: 1, lambda: 8, floorHeight: 3, arcCost: 7 }), kappa = 1, lambda = 8;
  /**
   * A walk's field, solved on the world round where it goes (its targets and, given `from`, where it starts, with 40 m of
   * room): small however much of the city is explored. `sampleWalk` on it is wrapped to take and give world ids.
   */
  const fields = new Map(), spotCache = new Map(), solve = (placeId, key, targets, how, from = null) => {
    const points = [...targets, ...(from === null ? [] : [from])].map(id => W.nodePos(world, id)), pad = 40;
    const box = { x0: Math.min(...points.map(p => p.x)) - pad, x1: Math.max(...points.map(p => p.x)) + pad, z0: Math.min(...points.map(p => p.z)) - pad, z1: Math.max(...points.map(p => p.z)) + pad };
    const built = graphOf({ x: (box.x0 + box.x1) / 2, z: (box.z0 + box.z1) / 2 }, Math.max(box.x1 - box.x0, box.z1 - box.z0) / 2);
    const cacheKey = `${built.version}|${key}|${classOf(how)}|${[box.x0, box.x1, box.z0, box.z1].map(Math.round).join(',')}`;
    if (!fields.has(cacheKey)) { const part = W.windowOf(built.graph, box), field = solveWalk(part.graph, targets.map(id => part.local[id]).filter(n => n >= 0), { T, kappa, lambda, factors: FACTORS[classOf(how)] }); fields.set(cacheKey, { ...field, part }); }
    return fields.get(cacheKey);
  };
  const sampleWalk = (graph, field, start, heading, rng) => { if (!field.part) return walkSample(graph, field, start, heading, rng); const at = field.part.local[start]; if (at < 0) return null; const path = walkSample(field.part.graph, field, at, heading, rng); return path && path.map(n => field.part.ids[n]); };
  const pick = (list, rng) => list[Math.floor(rng() * list.length)];
  // Where people go: as the live simulation decided it (novel sim pick, Jev on a picture of each event as it stood), over the
  // movement step's answers in words; an event the live simulation decided takes its answers from there.
  const decided = JSON.parse(await readFile(`${novelDir}/stage/sim-decisions.json`, 'utf8').catch(() => 'null'))?.events ?? {};
  const report = structuredClone(inputs.movement?.scenes ?? {});
  for (const entry of Object.values(decided)) if (entry?.moves && entry.scene && entry.event) ((report[entry.scene] ??= { starts: {}, events: {} }).events ??= {})[entry.event] = entry.moves;
  const moves = new Map(), hits = new Map(), hitThings = new Map(), struck = new Set(), notes = { unreachable: 0, sampled: 0, teleports: 0, solves: 0, hits: 0, destroyed: 0, travel: { routes: 0, metres: 0, crossed: 0, unreachable: 0 } };
  const topSpot = distribution => Object.entries(distribution ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  /**
   * The spots Jev names, near a point (the person, else the place's own anchor), on the world as it stands: its streets,
   * open ground and plazas, roofs, rooms either side, and the floors and roof of the place's own building. A spot near
   * someone at the edge of what is explored can be ground just streamed in: that is how a scene drifts.
   */
  const NEAR = 40;
  const spotsFor = (placeId, focus) => { const group = groups.get(placeId), f = focus ?? group.anchor, key = `${placeId}|${Math.round(f.x / 4)}|${Math.round(f.z / 4)}`, built = graphOf(f); if (!spotCache.has(key)) spotCache.set(key, W.spotsNear(world, built, f.x, f.z, NEAR, group.main())); return spotCache.get(key); };
  const spotKey = (placeId, spot, focus) => W.worldSpot(spotsFor(placeId, focus), spot);
  const focusOf = at => (at ? W.nodePos(world, at[0]) : undefined);
  // How destructive each event is: its embedding (the causality faculty's sidecar) projected onto the book's own
  // destruction direction, learned from events whose summaries say they wreck things against those that fight nowhere.
  const vectors = new Map((await readFile(`${novelDir}/ontology/embeddings.jsonl`, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line)).filter(row => row.kind === 'event').map(row => [row.id, row.vector]));
  const bookEvents = inputs.movementScenes.flatMap(scene => scene.events), summary = event => event.text.split('（原文：')[0];
  const axis = vectors.size ? semanticAxis(vectors, bookEvents.filter(event => damageDegree(summary(event)) >= 3).map(event => event.id), bookEvents.filter(event => !damageDegree(summary(event))).map(event => event.id)) : null;
  notes.axis = axis ? { positives: axis.positives, negatives: axis.negatives } : null;
  /** A fight's damage, once per event: a box around where its first actor stands (standing in for Jev's box on the view), degraded by the event's strength. */
  // Things the story mentions (novel stage objects). Mentions of one named thing become one object: names sharing a
  // distinctive token (a Latin word, an acronym such as A.A.A. for Anti-Art Attachment, a rare pair of characters such as
  // 姬蜂). A stand-in for the EM faculty, which should decide these identities. Big things (10 m or more) carry structure
  // inside, a small skeleton that hits can break; every thing joins the walk once placed (its top walkable, the street
  // under a grounded one blocked) and moves when a later event mentions it elsewhere.
  const found = JSON.parse(await readFile(`${novelDir}/stage/objects.json`, 'utf8').catch(() => 'null'));
  // Jev's three calls per thing (playground/two-view-things.mjs): which model it is, then a box on two views of each placement.
  const twoView = JSON.parse(await readFile(`${novelDir}/stage/thing-boxes.json`, 'utf8').catch(() => 'null')), boxes = twoView?.placements ?? {};
  const library = JSON.parse(await readFile(`${repository}/apps/playground/src/data/architectureModels.json`, 'utf8'));
  // Building EM (experiments/world-first/buildings.mjs): with it, a building the text mentions is never a box; it is its
  // building's real lot (below, and the page's named lots).
  const buildingsEM = worldScript ? JSON.parse(await readFile(`${novelDir}/stage/world/buildings.json`, 'utf8').catch(() => 'null')) : null;
  const { memberOf } = await import(pathToFileURL(`${repository}/experiments/world-first/buildings.mjs`).href), identityBy = new Map((buildingsEM?.identities ?? []).flatMap(identity => (identity.members ?? []).map(member => [member, identity])));
  const mentions = chosen.flatMap(scene => (found?.scenes?.[scene.id]?.objects ?? []).filter(object => !object.room && !(object.kind === 'building' && (buildingsEM || object.match.kind === 'building'))).map(object => ({ scene: scene.id, event: Math.max(0, scene.events.findIndex(entry => entry.id === object.event)), object })));
  const tokensOf = text => { const latin = text.match(/[A-Za-z]+/g) ?? [], cjk = [...text.replace(/[^一-鿿぀-ヿ]/g, '')], acronym = latin.length >= 2 ? latin.map(word => word[0].toUpperCase()).join('') : ''; return new Set([...latin.map(word => word.toUpperCase()).filter(word => word.length >= 3), ...(acronym.length >= 3 ? [acronym] : []), ...cjk.slice(0, -1).map((char, n) => char + cjk[n + 1])]); };
  const STOP = new Set(['机器', '装置', '飞行', '巨型', '人行', '通道', '临时', '仓库', '大型', '残骸']), names = [...new Set(mentions.map(entry => entry.object.name))], counts = new Map();
  for (const text of names) for (const token of tokensOf(text)) counts.set(token, (counts.get(token) ?? 0) + 1);
  const distinctive = token => (counts.get(token) ?? 0) >= 2 && !STOP.has(token) && counts.get(token) <= Math.max(2, names.length * 0.4);
  const parent = mentions.map((_, index) => index), root = index => parent[index] === index ? index : (parent[index] = root(parent[index]));
  for (let a = 0; a < mentions.length; a++) for (let b = a + 1; b < mentions.length; b++) { const ta = tokensOf(mentions[a].object.name); if ([...tokensOf(mentions[b].object.name)].some(token => ta.has(token) && distinctive(token))) parent[root(a)] = root(b); }
  const entities = [...new Set(mentions.map((_, index) => root(index)))].map((head, n) => {
    const own = mentions.filter((_, index) => root(index) === head), tally = new Map();
    for (const entry of own) tally.set(entry.object.name, (tally.get(entry.object.name) ?? 0) + 1);
    const label = [...tally].sort((a, b) => b[1] - a[1] || a[0].length - b[0].length)[0][0], lead = own.find(entry => entry.object.name === label).object;
    // The model Jev picked for it, or else the detection's shape match.
    const picked = twoView?.models?.[label], model = picked?.kind === 'model' && library.models[picked.id] ? picked.id : picked ? null : library.models[lead.match.id] ? lead.match.id : null;
    const matched = lead.match.id === 'sphere' ? 'oval' : lead.match.id, size = Math.min(24, Math.max(4, ...own.map(entry => entry.object.size))), shape = picked?.kind === 'shape' && SHAPES[picked.id] ? picked.id : lead.match.kind === 'shape' && SHAPES[matched] ? matched : 'box';
    const height = shape === 'diamond' ? size : shape === 'oval' ? size * 0.55 : Math.max(1.2, size * 0.35);
    const struct = size >= 10 ? generateSkeleton('house', 4049 + n, { width: Math.max(4, Math.round(size / 2) * 2), depth: Math.max(4, Math.round(Math.max(size * 0.35, 4) / 2) * 2), floors: Math.max(1, Math.round(height / 3)), cores: 1 }) : null;
    return { id: `thing_${n + 1}`, name: label, aliases: [...tally.keys()].filter(other => other !== label), model, switched: !!picked?.switched, theme: picked?.theme ?? null, shape, size, height, airborne: own.filter(entry => entry.object.airborne).length * 2 > own.length, struct, standing: struct ? struct.cells.map(value => (value ? 1 : 0)) : null, mentions: own.map(entry => ({ scene: entry.scene, event: entry.event })), placed: [] };
  });
  // Where each placement stands: the cast from Jev's two views (a box on the reader's view, a box on a low side view showing
  // the first as a beam), with the thing's model fitted as large as fits inside it.
  notes.thingBoxes = 0;
  /** Place (or move) the things an event mentions: in their two-view cast, or else on the ground beside the event's first actor. */
  const placedAt = new Set();
  // What Jev decided, per event, for the player's trace: who moves where with what chance, which way and how; the things
  // placed (model pick, lettered spots, the choice and the boxes); the impacts (lettered spots, the pick, the size).
  const traces = new Map(), traceOf = (sceneId, index) => { const key = `${sceneId}|${index}`; if (!traces.has(key)) traces.set(key, {}); return traces.get(key); };
  const top = (distribution, n = 3) => Object.entries(distribution ?? {}).sort((a, b) => b[1] - a[1]).slice(0, n).map(([key, p]) => [key, Math.round(p * 100) / 100]);
  /** Where a spot Jev named is in a place: the middle of its nodes (metres), or null. */
  const spotAt = (placeId, name, focus) => { const key = spotKey(placeId, name, focus), { graph } = graphOf(focus ?? groups.get(placeId).anchor), spots = spotsFor(placeId, focus), nodes = key ? spots[key] ?? [] : []; if (!nodes.length) return null; const mean = axis => Math.round(nodes.reduce((sum, node) => sum + graph[axis][node], 0) / nodes.length * 10) / 10; return [mean('x'), mean('y'), mean('z')]; };
  const placeThings = (scene, event, at) => {
    const index = scene.events.findIndex(entry => entry.id === event.id);
    // Once per event: the first turn of an event is its first actor's.
    if (placedAt.has(event.id)) return;
    placedAt.add(event.id);
    for (const entity of entities) if (entity.mentions.some(entry => entry.scene === scene.id && entry.event === index) && at) {
      // Jev's boxes made on the world (frame 'world'); boxes from the fixed grids of earlier engines no longer fit it.
      const group = groups.get(scene.placeId), made = boxes[`${scene.id}|${index}|${entity.name}`], box = made?.frame === 'world' ? made.box : null, round = value => Math.round(value * 10) / 10;
      let x, z, cast;
      if (box) {
        [x, z] = [(box.x[0] + box.x[1]) / 2, (box.z[0] + box.z[1]) / 2]; cast = { w: box.x[1] - box.x[0], h: box.y[1] - box.y[0], d: box.z[1] - box.z[0], y0: box.y[0] }; notes.thingBoxes++;
        const placement = boxes[`${scene.id}|${index}|${entity.name}`], model = twoView?.models?.[entity.name];
        (traceOf(scene.id, index).things ??= []).push({ thing: entity.name, model: model ? { id: model.id, confidence: model.confidence, top: model.top } : null, method: placement.method, chosen: placement.chosen ?? null,
          choice: placement.choice ? { pick: placement.choice.pick, confidence: placement.choice.confidence, top: top(placement.choice.distribution, 4) } : null,
          spots: (placement.spots ?? []).map(spot => ({ label: spot.label, x: spot.x, z: spot.z, y0: spot.y0 ?? 0, w: spot.w, h: spot.h, d: spot.d, from: spot.from })), casts: placement.casts ?? null, box });
      }
      else {
        // No box yet: on the ground beside the actor, in the first direction with open ground; on the actor's spot when there is none.
        // A thing in the air flies above the roofs around it (an airship over the towers), by at least its own height.
        const actor = W.nodePos(world, at[0]), lotAt = (px, pz) => world.lots.find(entry => px >= entry.i0 * 2 && px < (entry.i0 + entry.nx) * 2 && pz >= entry.j0 * 2 && pz < (entry.j0 + entry.nz) * 2);
        const gap = entity.size / 2 + 2, open = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: actor.x + dx * gap, z: actor.z + dz * gap })).find(spot => !lotAt(spot.x, spot.z) && actor.k === 0);
        ({ x, z } = open ?? actor);
        const roofs = entity.airborne ? world.lots.filter(entry => Math.hypot((entry.i0 + entry.nx / 2) * 2 - x, (entry.j0 + entry.nz / 2) * 2 - z) <= entity.size / 2 + 24).map(entry => (entry.height ?? entry.floors) * 3) : [];
        cast = { w: entity.size, h: entity.height, d: entity.shape === 'box' ? Math.max(1.2, entity.size * 0.35) : entity.size, y0: entity.airborne ? Math.max(12, ...roofs) + Math.max(6, entity.height ?? 4) : 0 };
      }
      reach(x, z, Math.max(24, entity.size));
      // At its first placement, a thing takes the theme of the manifold under it (its category's model of that era: a
      // windmill in a modern district is a wind turbine); a model Jev chose by switching theme stays as it is.
      if (!entity.placed.length && entity.model && !entity.switched) { entity.theme = themeAt(x, z); entity.model = themedModel(modelThemes, entity.model, entity.theme, entity.id); }
      const fit = fitInCast(entity.shape, cast, entity.model ? library.models[entity.model].size : null), y0 = fit.y0, y1 = y0 + fit.h;
      for (const other of groups.values()) if (other.things.delete(entity.id)) other.version++;
      group.things.set(entity.id, { i0: Math.floor((x - fit.w / 2) / 2), i1: Math.floor((x + fit.w / 2) / 2), j0: Math.floor((z - fit.d / 2) / 2), j1: Math.floor((z + fit.d / 2) / 2), top: Math.round(y1 / 3), grounded: y0 < 1.5 && Math.max(fit.w, fit.d) <= 8 });
      group.version++;
      entity.placed.push({ scene: scene.id, event: index, place: scene.placeId, x: round(x), y: round(y0), z: round(z), fit: { sx: Math.round(fit.sx * 1000) / 1000, sy: Math.round(fit.sy * 1000) / 1000, sz: Math.round(fit.sz * 1000) / 1000, turn: fit.turn, stand: fit.stand, w: round(fit.w), h: round(fit.h), d: round(fit.d) }, ...(box ? { boxed: true } : {}) });
      entity.at = { place: scene.placeId, x, y: (y0 + y1) / 2, z };
    }
  };
  notes.things = { mentions: mentions.length, things: entities.length, withStructure: entities.filter(entity => entity.struct).length };
  // Where each fight hits and how big, as Jev chose (playground/impact-choices.mjs): a sphere on a building, or no damage.
  const impacts = JSON.parse(await readFile(`${novelDir}/stage/impacts.json`, 'utf8').catch(() => 'null'))?.fights ?? {};
  notes.impacts = { sphere: 0, none: 0 };
  const damage = (scene, event, at, seed) => {
    if (struck.has(event.id)) return;
    struck.add(event.id);
    // Without event embeddings for this book, the wording's degree stands in for the strength.
    const strength = axis ? axis.strength(event.id) ?? 0 : [0, 0, 0, 0.85, 0.95][damageDegree(summary(event))];
    if (strength < 0.8 || !at) return;
    const made = impacts[`${scene.id}|${scene.events.findIndex(entry => entry.id === event.id)}`], chosen = made?.none || made?.frame === 'world' ? made : null;
    if (chosen?.pick) traceOf(scene.id, scene.events.findIndex(entry => entry.id === event.id)).impact = { pick: chosen.pick.pick, confidence: chosen.pick.confidence, top: top(chosen.pick.distribution, 4), spots: (chosen.spots ?? []).map(spot => ({ label: spot.label, x: spot.x, y: spot.y, z: spot.z, from: spot.from })),
      size: chosen.size ? { pick: chosen.size.pick, confidence: chosen.size.confidence, top: top(chosen.size.distribution, 4) } : null, sphere: chosen.sphere ?? null, none: !!chosen.none };
    if (chosen?.none) { notes.impacts.none++; return; }
    // A fight underground: the blast is where its first actor stands, as big as Jev chose (else 4–8 m by its strength),
    // and reaches only what is underground (docs/underground-design.md §4.2).
    const fighter = W.nodePos(world, at[0]);
    if (fighter.y < -1) {
      const r = chosen?.sphere?.r ?? 2 + 2 * strength, round = value => Math.round(value * 10) / 10, under = underHit(fighter, r, strength);
      notes.hits++; notes.impacts.sphere++;
      hits.set(event.id, { lot: -1, under, strength: Math.round(strength * 100) / 100, point: { x: fighter.x, y: fighter.y, z: fighter.z }, box: { x: [fighter.x - r, fighter.x + r], y: [fighter.y - r, fighter.y + r], z: [fighter.z - r, fighter.z + r] }, sphere: { x: round(fighter.x), y: round(fighter.y), z: round(fighter.z), r } });
      return;
    }
    if (chosen?.sphere) return hitSphere(scene, event, chosen.sphere, strength, seed);
    // Things near the blast are hit too; a big one loses part of its structure.
    const near = W.nodePos(world, at[0]), thingHits = [];
    for (const entity of entities) if (entity.at?.place === scene.placeId && Math.hypot(entity.at.x - near.x, entity.at.z - near.z) <= 4 + entity.size / 2) {
      const rng = stream(seed, 'thing', entity.id), destroyed = [];
      if (entity.standing) for (let cell = 0; cell < entity.standing.length; cell++) if (entity.standing[cell] && rng() < strength * 0.6) { entity.standing[cell] = 0; destroyed.push(cell); }
      thingHits.push({ id: entity.id, destroyed });
    }
    if (thingHits.length) hitThings.set(event.id, thingHits);
    const group = groups.get(scene.placeId), p = W.nodePos(world, at[0]);
    reach(p.x, p.z, 24);
    const distance = lot => Math.hypot(Math.max(0, lot.i0 * 2 - p.x, p.x - (lot.i0 + lot.nx) * 2), Math.max(0, lot.j0 * 2 - p.z, p.z - (lot.j0 + lot.nz) * 2));
    const index = group.layout.lots.map((lot, n) => [n, distance(lot)]).filter(([, d]) => d <= 6).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (index === undefined) return;
    const lot = group.layout.lots[index], point = { x: Math.min(Math.max(p.x, lot.i0 * 2 + 1), (lot.i0 + lot.nx) * 2 - 1), y: Math.min(p.y, (lot.floors - 1) * 3), z: Math.min(Math.max(p.z, lot.j0 * 2 + 1), (lot.j0 + lot.nz) * 2 - 1) };
    const half = 3 + 5 * strength, box = { x: [point.x - half, point.x + half], y: [Math.max(0, point.y - 3), point.y + 3 + 3 * strength], z: [point.z - half, point.z + half] };
    const result = degrade(group.layout, index, group.standing[index], box, strength, stream(seed, 'hit'));
    group.standing[index] = result.standing; group.version++;
    notes.hits++; notes.destroyed += result.destroyed.length;
    hits.set(event.id, { lot: index, strength: Math.round(strength * 100) / 100, point, box, destroyed: result.destroyed, cutOff: result.cutOff, cutRooms: result.cutRooms, under: underHit(point, half, strength) });
  };
  /**
   * A blast reaching underground (docs/underground-design.md §4), only where the area is awake (§4.8): from a blast inside
   * a hall, along the hall (the void channels it); from the street, only a shallow hall's roof under it, straight through the
   * ground. Each hall reached collapses (U.collapse): its piles close its cells; a shallow hall's cave may dent the street.
   */
  const underHit = (centre, r, strength) => {
    const halls = world.source.underground?.halls ?? [], energy = BLAST_ENERGY * strength * (2 * r / 8) ** 3, out = [];
    halls.forEach((hall, index) => {
      if (!awake.has(hall.area)) return;
      const b = U.boundsOf(hall), top = hall.depth - hall.height, below = centre.y < -1;
      if (centre.x < b.x0 - r || centre.x > b.x1 + r || centre.z < b.z0 - r || centre.z > b.z1 + r) return;
      if (below ? centre.y < -hall.depth - r || centre.y > -top + r : !(top < U.BANDS[0].to && top + centre.y <= r)) return;
      reach(centre.x, centre.z, r + 40);
      const k = W.levelOf(hall.depth), cells = [];
      for (let i = Math.floor(b.x0 / 2); i <= Math.floor(b.x1 / 2); i++) for (let j = Math.floor(b.z0 / 2); j <= Math.floor(b.z1 / 2); j++) { const entry = W.hallsAt(world, i, j).find(e => e.hall === index && e.k === k); if (entry) cells.push({ i, j, pillar: entry.pillar, reach: Infinity }); }
      if (!cells.length) return;
      if (below) {
        // Along the hall from the cell nearest the blast (2 m a step, 2.8 m a diagonal).
        const at = new Map(cells.map((cell, n) => [W.cellKey(cell.i, cell.j), n])), start = cells.reduce((best, cell, n) => Math.hypot((cell.i + 0.5) * 2 - centre.x, (cell.j + 0.5) * 2 - centre.z) < Math.hypot((cells[best].i + 0.5) * 2 - centre.x, (cells[best].j + 0.5) * 2 - centre.z) ? n : best, 0), queue = [start];
        cells[start].reach = 0;
        for (let head = 0; head < queue.length; head++) for (const [di, dj, cost] of [[1, 0, 2], [-1, 0, 2], [0, 1, 2], [0, -1, 2], [1, 1, 2.83], [1, -1, 2.83], [-1, 1, 2.83], [-1, -1, 2.83]]) { const cell = cells[queue[head]], m = at.get(W.cellKey(cell.i + di, cell.j + dj)); if (m !== undefined && cell.reach + cost < cells[m].reach) { cells[m].reach = cell.reach + cost; queue.push(m); } }
      } else for (const cell of cells) cell.reach = Math.hypot((cell.i + 0.5) * 2 - centre.x, top + centre.y, (cell.j + 0.5) * 2 - centre.z);
      const width = hall.bores.length ? hall.bores[0].width : Math.min(...hall.boxes.map(box => Math.min(box.w, box.d)));
      const result = U.collapse({ depth: hall.depth, height: hall.height, lined: hall.lined, pillars: hall.pillars, width }, cells, energy, below ? width * hall.height : Infinity);
      if (!result.failed.length && !result.pillars.length && !result.lining.length) return;
      const piles = world.underDamage.piles.get(index) ?? world.underDamage.piles.set(index, new Map()).get(index);
      for (const [n, height] of Object.entries(result.pile)) { const key = W.cellKey(cells[n].i, cells[n].j); piles.set(key, Math.max(piles.get(key) ?? 0, height)); }
      for (const [n, depth] of Object.entries(result.dent)) { const key = W.cellKey(cells[n].i, cells[n].j); world.underDamage.dents.set(key, Math.max(world.underDamage.dents.get(key) ?? 0, depth)); }
      out.push({ hall: hall.id, kind: hall.kind, stopped: result.stopped, pillars: result.pillars.length, lining: result.lining.length, failed: result.failed.length, layers: result.layers, pile: Math.max(0, ...Object.values(result.pile)), dent: Object.keys(result.dent).length });
    });
    if (out.length) { notes.underground.hits += out.length; shared.version++; }
    return out;
  };
  /** Where someone under fallen ground gets out to: the nearest open cell of the same hall (null when they are not buried). */
  const buried = at => {
    if (!at) return null;
    const p = W.nodePos(world, at[0]), hall = p.k < 0 ? W.hallsAt(world, p.i, p.j).find(e => e.k === p.k) : null;
    if (!hall || (world.underDamage.piles.get(hall.hall)?.get(W.cellKey(p.i, p.j)) ?? 0) < 2) return null;
    const out = nodeOfHall({ hall: hall.hall }, { x: p.x, z: p.z });
    return out != null && out !== at[0] ? out : null;
  };
  /**
   * A chosen impact: every building the sphere reaches loses what its percolation step takes inside the sphere; things in it
   * are hit too. A blast reaches into the building it hits: chosen off its structure, the sphere centres on that building's
   * nearest standing unit (a wall, a slab, a stair), so it always meets structure.
   */
  const hitSphere = (scene, event, chosen, strength, seed) => {
    reach(chosen.x, chosen.z, chosen.r + 16);
    const group = groups.get(scene.placeId);
    // A lot's structure and what of it stands now (its skeleton's cells as the walk left them, walls and roof as hits left them).
    const unitsOf = index => { const structure = (group.structures[index] ??= structureOf(group.layout.lots[index])), units = group.units[index] ?? intact(structure); for (let cell = 0; cell < structure.cells; cell++) units[cell] = group.standing[index][cell] && structure.kind[cell] ? 1 : 0; return { structure, units }; };
    const struck = group.layout.lots.map((lot, index) => ({ lot, index, gap: Math.hypot(Math.max(0, lot.i0 * 2 - chosen.x, chosen.x - (lot.i0 + lot.nx) * 2), Math.max(0, lot.j0 * 2 - chosen.z, chosen.z - (lot.j0 + lot.nz) * 2)) })).sort((a, b) => a.gap - b.gap)[0];
    let sphere = chosen;
    if (struck) { const { structure, units } = unitsOf(struck.index); let best = null, far = Infinity; units.forEach((up, unit) => { if (!up) return; const at = unitAt(structure, unit), gap = Math.hypot(at.x - chosen.x, at.y - chosen.y, at.z - chosen.z); if (gap < far) { far = gap; best = at; } }); if (best && far > chosen.r / 2) sphere = { ...best, r: chosen.r }; }
    const gapTo = (lot) => Math.hypot(Math.max(0, lot.i0 * 2 - sphere.x, sphere.x - (lot.i0 + lot.nx) * 2), Math.max(0, -sphere.y, sphere.y - lot.floors * 3), Math.max(0, lot.j0 * 2 - sphere.z, sphere.z - (lot.j0 + lot.nz) * 2));
    const box = { x: [sphere.x - sphere.r, sphere.x + sphere.r], y: [sphere.y - sphere.r, sphere.y + sphere.r], z: [sphere.z - sphere.r, sphere.z + sphere.r], sphere };
    // Each building the sphere reaches, as structural units (structure.ts): those the blast's energy breaks go, then what
    // has lost its load path falls straight down to rest; walls and the roof break and fall like corridors and stairs.
    const parts = group.layout.lots.map((lot, index) => [index, gapTo(lot)]).filter(([, gap]) => gap <= sphere.r).sort((a, b) => a[1] - b[1]).map(([index]) => {
      const { structure, units } = unitsOf(index);
      const { broken, energy } = blast(structure, units, sphere, strength), hit = units.slice();
      for (const unit of broken) hit[unit] = 0;
      const { standing: after, fallen } = settle(structure, hit);
      group.units[index] = after; group.standing[index] = skeletonStanding(structure, after);
      notes.destroyed += broken.length + fallen.length; notes.fell = (notes.fell ?? 0) + fallen.length;
      const tuple = unit => [structure.kind[unit], structure.i[unit], structure.j[unit], structure.k[unit]];
      return { lot: index, destroyed: broken.filter(unit => unit < structure.cells), fell: fallen.filter(({ unit }) => unit < structure.cells).map(({ unit }) => unit), ...cutOffOf(group.layout, index, group.standing[index]),
        blasted: broken.map(tuple), fallen: fallen.map(({ unit, to }) => [...tuple(unit), Math.round(to * 10) / 10]), energy: Math.round(energy) };
    });
    const thingHits = entities.filter(entity => entity.at?.place === scene.placeId && Math.hypot(entity.at.x - sphere.x, entity.at.y - sphere.y, entity.at.z - sphere.z) <= sphere.r + entity.size / 2).map(entity => {
      const rng = stream(seed, 'thing', entity.id), destroyed = [];
      if (entity.standing) for (let cell = 0; cell < entity.standing.length; cell++) if (entity.standing[cell] && rng() < strength * 0.6) { entity.standing[cell] = 0; destroyed.push(cell); }
      return { id: entity.id, destroyed };
    });
    if (thingHits.length) hitThings.set(event.id, thingHits);
    const under = underHit(sphere, sphere.r, strength);
    if (!parts.length && !under.length) return;
    group.version++; notes.hits++; notes.impacts.sphere++;
    const [main = { lot: -1 }, ...more] = parts, round = value => Math.round(value * 10) / 10;
    hits.set(event.id, { ...main, more, under, strength: Math.round(strength * 100) / 100, point: { x: sphere.x, y: sphere.y, z: sphere.z }, box: { x: box.x, y: box.y, z: box.z }, sphere: { x: round(sphere.x), y: round(sphere.y), z: round(sphere.z), r: sphere.r } });
  };
  // The macro view: the strand's places and their ancestors in the place tree; and who migrated between places, scene by scene.
  const placeOf = new Map(chosen.map(scene => [scene.id, scene.placeId])), tree = new Set(chosen.flatMap(scene => places.get(scene.placeId)?.path ?? [scene.placeId]));
  const migrations = chosen.flatMap(scene => (timeline.handoffs.get(scene.id) ?? []).filter(handoff => handoff.from && !handoff.samePlace).map(handoff => ({ scene: scene.id, person: handoff.person, from: placeOf.get(handoff.from), to: scene.placeId })));
  // The same over the whole book (every staged scene, whatever the strand): what the central build's places sit toward.
  const book = all.filter(scene => staged.has(scene.id) && scene.events?.length), bookPlace = new Map(book.map(scene => [scene.id, scene.placeId])), bookTimeline = forkTimeline(book, strands);
  const bookTrips = book.flatMap(scene => (bookTimeline.handoffs.get(scene.id) ?? []).filter(handoff => handoff.from && !handoff.samePlace).map(handoff => ({ from: bookPlace.get(handoff.from), to: scene.placeId })));
  // The macro view is the canvas of places (src/ground/stage/placeCanvas.ts). Before any scene, the central build: every
  // area larger than a building in the ontology's place tree (a city, district or street by Jev's scale, or before Jev has
  // scaled it the generic part of its name) is a circle of its own, the larger first, as large as what is built in it; one
  // the ontology puts in no larger area dwells at a random spot of the build (seeded by its id) until it is named. Then, in
  // story order, a staged building is a unit with its grid on a lot of the nearest open place above it; one known only to
  // lie in a city gets an unnamed temporary area of that city, and one the ontology puts in no area dwells in one of the
  // build's districts or streets at random. A newborn circle takes the free spot toward the sibling it has the most travel
  // with over the whole book, so places people travel between more sit closer, and every strand stands in the same city.
  // Each open place's ground is its landscape (Jev's, stage/landscape.json), filled from its centre; a staged open place
  // keeps its grid at its middle.
  const ground = new Map();
  const canvasLayout = () => {
    const OPEN = new Set(['region', 'city', 'district', 'street']), scaleOf = id => inputs.scale?.places[id]?.scale ?? null;
    const isOpen = id => OPEN.has(scaleOf(id)) || (!scaleOf(id) && (ownGrids.has(id) ? kindOf(id) : 'district') !== 'site');
    // A staged building's lot, with room round it; an open place's own ground is its landscape, filled from its middle.
    const gridRadius = () => 22;
    const placeTree = inputs.placeTree ?? inputs.data.places, treePath = new Map(placeTree.map(place => [place.id, place.path ?? [place.id]]));
    // Where the place tree gives a place no parent, the terrain step's (stage/terrain.json: which site holds which) is used.
    const terrainPath = (id, seen = new Set([id])) => { const parent = terrain?.sites?.[id]?.parent; if (!parent || seen.has(parent)) return null; seen.add(parent); return [...(terrainPath(parent, seen) ?? [parent]), id]; };
    const pathOf = id => { const path = treePath.get(id) ?? places.get(id)?.path ?? [id], above = terrainPath(path[0]); return above ? [...above.slice(0, -1), ...path] : path; };
    // The manifold under each place (groundFor, src/ground/stage/landscape.ts): Jev's landscape (novel stage landscape), or
    // the main agent's answer over it; a place without one is built by the terrain rules as the ground of the nearest
    // larger place that has one, else as its scale suggests, so the world is never bare.
    // Terrain spawning's answer for a place, where it was asked (stage/terrain.json): its ground's type wins over the
    // landscape step's, and its first patch is the size of Jev's box.
    const terrainGround = id => { const site = terrain?.sites?.[id]; return site?.ground && LANDSCAPES[site.ground] ? site : null; };
    const groundPatch = id => { const site = terrainGround(id); if (!site?.size) return null; const [w, d] = site.size; return patchFromBox(site.ground, 'p0', id, { x0: -w / 2, z0: -d / 2, x1: w / 2, z1: d / 2 }, { by: 'jev' }, site.top ?? null); };
    const landscapeOf = (id, scale = scaleOf(id) ?? (ownGrids.has(id) ? kindOf(id) : 'district')) => {
      if (!ground.has(id)) ground.set(id, terrainGround(id) ? { type: terrainGround(id).ground, by: 'jev', from: 'terrain' } : groundFor(inputs.landscape?.places[id], pathOf(id).filter(at => at !== id).reverse(), at => inputs.landscape?.places[at], scale));
      return ground.get(id).type;
    };
    const trips = (a, b) => bookTrips.filter(m => m.from && m.to && (pathOf(m.from).includes(a) && pathOf(m.to).includes(b) || pathOf(m.from).includes(b) && pathOf(m.to).includes(a))).length;
    const canvas = C.emptyCanvas();
    // Toward where the terrain step put it in this parent, else toward the sibling it has the most travel with.
    const toward = (id, parent) => terrain?.sites?.[id]?.parent === parent ? terrain.sites[id].toward : Object.values(canvas.places).filter(place => place.parent === parent && place.id !== id).map(place => [place, trips(id, place.id)]).filter(([, count]) => count).sort((x, y) => y[1] - x[1])[0]?.[0].at;
    const birth = (id, parent) => {
      if (canvas.places[id]) return;
      C.bear(canvas, { id, label: name(id), scale: scaleOf(id) ?? (ownGrids.has(id) ? kindOf(id) : 'district'), parent, landscape: landscapeOf(id), toward: toward(id, parent), ground: groundPatch(id) });
    };
    // An unnamed place (a v2 reading's EM² place) is never an area of the build: it is a marker in one, until Jev places it.
    const areaScale = id => { if (String(id).startsWith('unnamed:')) return null; const scale = scaleOf(id) ?? scaleOfName(name(id)); return OPEN.has(scale) ? scale : null; };
    // Where the place tree said only the city (or nothing held an EM² place but its scene): an area picked by a seed, which the
    // live view shows blinking until the text or Jev says where it is (the user's call, 2026-10-31).
    const guessed = id => ['scene', 'setting'].includes(worldScript?.places?.[id]?.held), sampled = [];
    const areas = placeTree.filter(place => areaScale(place.id)).map(place => ({ id: place.id, label: name(place.id), scale: areaScale(place.id), ground: groundPatch(place.id), parent: place.parentId ?? terrain?.sites?.[place.id]?.parent ?? null, proposed: place.proposedParentId ?? null, landscape: landscapeOf(place.id, areaScale(place.id)) }));
    const dwelling = C.centralBuild(canvas, areas, toward), dwellingUnits = {};
    notes.build = { areas: areas.length, byName: areas.filter(area => !scaleOf(area.id)).length, dwelling: Object.entries(dwelling).map(([id, host]) => `${name(id)} in ${name(host)}`), unscaled: placeTree.filter(place => !scaleOf(place.id) && !areaScale(place.id)).length };
    for (const scene of chosen) {
      const chain = pathOf(scene.placeId), open = chain.filter(id => id !== scene.placeId && isOpen(id));
      open.forEach((id, n) => birth(id, n ? open[n - 1] : null));
      if (isOpen(scene.placeId)) { birth(scene.placeId, open.at(-1) ?? null); continue; }
      if (Object.values(canvas.places).some(place => place.units.some(unit => unit.id === scene.placeId))) continue;
      const host = open.length ? null : C.dwellingFor(canvas, scene.placeId, placeTree.find(place => place.id === scene.placeId)?.proposedParentId);
      if (host) {
        // A building the place tree puts in no larger place dwells at a random spot of the central build until the text names where it is.
        const holder = C.holderFor(canvas, host, scaleOf(scene.placeId) ?? 'building', scene.placeId);
        C.addUnit(canvas, holder, { id: scene.placeId, label: name(scene.placeId), kind: 'building', r: gridRadius(scene.placeId) });
        dwellingUnits[scene.placeId] = host; notes.build.dwelling.push(`${name(scene.placeId)} in ${name(host)}`);
        continue;
      }
      if (!open.length) {
        // With no area in the build at all: an unnamed area of its own round it (a temporary district of ordinary ground,
        // until the text names where it is), so it stands in a city rather than on bare ground.
        const area = `tmp:${scene.placeId}`;
        if (!canvas.places[area]) { C.bear(canvas, { id: area, label: `round ${name(scene.placeId)}`, scale: 'district', parent: null, landscape: 'residential' }); canvas.places[area].temporary = true; }
        C.addUnit(canvas, area, { id: scene.placeId, label: name(scene.placeId), kind: 'building', r: gridRadius(scene.placeId) });
        continue;
      }
      const holder = C.holderFor(canvas, open.at(-1), scaleOf(scene.placeId) ?? 'building', scene.placeId), picked = C.sampledIn(canvas, open.at(-1), holder) || guessed(scene.placeId);
      // Near where the terrain step put the building (the site on the chain it stands for) in this holder.
      const site = [...chain].reverse().find(at => terrain?.sites?.[at]), near = site && terrain.sites[site].parent === holder ? terrain.sites[site].toward : undefined;
      C.addUnit(canvas, holder, { id: scene.placeId, label: name(scene.placeId), kind: 'building', r: gridRadius(scene.placeId), ...(picked ? { sampled: open.at(-1) } : {}) }, near);
    }
    // Every other building, room and unnamed place of the tree (a v2 reading's EM² places among them), laid out as the
    // scenes' are, buildings before the rooms they hold: in the area the tree puts it in (sampled into one of a city's
    // areas where it says only the city), beside the building that holds a room, dwelling where it says nothing. Only
    // what a scene is set in is built; the rest are markers on the map (unbuilt), off the walking lattice.
    const unitOf = id => { for (const place of Object.values(canvas.places)) { const unit = place.units.find(entry => entry.id === id); if (unit) return { place, unit }; } return null; };
    const SIZE = { building: 0, street: 1, room: 2 }, unitScale = id => { const scale = scaleOf(id) ?? scaleOfName(name(id)); return scale in SIZE ? scale : null; };
    for (const place of placeTree.filter(entry => unitScale(entry.id) && !areaScale(entry.id)).sort((a, b) => SIZE[unitScale(a.id)] - SIZE[unitScale(b.id)])) {
      if (canvas.places[place.id] || unitOf(place.id)) continue;
      const scale = unitScale(place.id), kind = scale === 'street' ? 'street' : scale === 'room' ? 'room' : 'building', r = C.LEAST[scale];
      const parent = place.parentId ?? null, building = parent && !canvas.places[parent] ? unitOf(parent) : null;
      if (building) { C.addUnit(canvas, building.place.id, { id: place.id, label: `${name(place.id)} · in ${building.unit.label}`, kind, r, ...(guessed(place.id) || building.unit.sampled ? { sampled: building.unit.sampled ?? parent } : {}) }, building.unit.at); continue; }
      const area = parent && canvas.places[parent] ? parent : null, host = area ?? C.dwellingFor(canvas, place.id, place.proposedParentId);
      if (!host) continue;
      const holder = C.holderFor(canvas, host, scale, place.id), picked = !area || C.sampledIn(canvas, host, holder) || guessed(place.id);
      C.addUnit(canvas, holder, { id: place.id, label: name(place.id), kind, r, ...(picked ? { sampled: area ?? 'build' } : {}) });
      if (!area) { dwellingUnits[place.id] = host; notes.build.dwelling.push(`${name(place.id)} in ${name(host)}`); }
    }
    const round = value => Math.round(value * 10) / 10, depthOf = id => { let depth = 0; for (let at = canvas.places[id]; at?.parent; at = canvas.places[at.parent]) depth++; return depth; };
    const nodes = [];
    for (const place of Object.values(canvas.places)) {
      const [x, z] = C.worldOf(canvas, place.id), grid = place.units.find(unit => unit.id === `${place.id}#grid`);
      nodes.push({ id: place.id, label: place.label, scale: place.scale, parent: place.parent, x: round(x), z: round(z), r: place.r, depth: depthOf(place.id), spotX: round(x), spotZ: round(z), ...(grid ? { own: grid.r } : {}), ...(place.temporary ? { temporary: true } : {}), ...(place.dwelling ? { dwelling: place.dwelling } : {}) });
      for (const unit of place.units) if (['building', 'room', 'street'].includes(unit.kind)) nodes.push({ id: unit.id, label: unit.label, scale: scaleOf(unit.id), parent: place.id, ...(unit.sampled ? { sampled: unit.sampled } : {}), ...(ownGrids.has(unit.id) ? {} : { unbuilt: true }), x: round(x + unit.at[0]), z: round(z + unit.at[1]), r: unit.r, depth: depthOf(place.id) + 1, spotX: round(x + unit.at[0]), spotZ: round(z + unit.at[1]), ...(dwellingUnits[unit.id] ? { dwelling: dwellingUnits[unit.id] } : {}) });
    }
    return { nodes, canvas };
  };
  const { nodes: macro, canvas } = canvasLayout(), macroOf = new Map(macro.map(node => [node.id, node]));
  // An area the build made for a building (a temporary one) stands on the ground of the place it was made in.
  for (const place of Object.values(canvas.places)) if (!ground.has(place.id) && place.landscape) ground.set(place.id, { type: place.landscape.patches[0].type, by: place.parent ? 'terrain' : 'scale', ...(place.parent ? { from: place.parent } : {}) });
  notes.ground = Object.fromEntries(['jev', 'agent', 'terrain', 'scale', 'none'].map(by => [by, [...ground.values()].filter(entry => entry.by === by).length]).filter(([, count]) => count));
  /** The manifold a moment stands on, for the live view: from the city in to the scene's place, each with its ground and who set it. */
  const groundLine = id => {
    const parts = [], label = at => macroOf.get(at)?.label ?? name(at);
    for (let at = id; at; at = macroOf.get(at)?.parent) { const entry = ground.get(at); if (entry?.type) parts.unshift(`${label(at)} ${entry.type} (${entry.by === 'jev' ? `Jev ${Math.round((entry.confidence ?? 0) * 100)}%` : entry.by === 'terrain' ? `terrain, as ${label(entry.from)}` : entry.by})`); }
    return parts.join(' › ');
  };
  // Each open place's landscape, filled (src/ground/stage/landscape.ts), in map metres: what stands around the staged grids,
  // never on them (nor on the units and circles built inside it). Derived view data: only nominated buildings are canon.
  const landscapes = Object.values(canvas.places).filter(place => place.landscape).map(place => {
    const [wx, wz] = C.worldOf(canvas, place.id), round = value => Math.round(value * 10) / 10, filled = fillLandscape(place.landscape);
    // Not where a child place stands: it has its own ground there.
    const keep = Object.values(canvas.places).filter(child => child.parent === place.id).map(child => ({ at: child.at, r: child.r }));
    const clear = (x, z, margin = 3) => keep.every(({ at, r }) => Math.hypot(x - at[0], z - at[1]) > r + margin);
    // A building's id is its place and its lot in the fill (stable as the place grows). Its `manifold` is the patch it
    // stands on: that patch with the older patches that cut its ground, and the fill's recipe, so a newer patch never
    // changes an older one's buildings (damage kept for them in world.json stays theirs). `era`: that patch's.
    const patchOf = b => place.landscape.patches.find(patch => patch.id === (filled.owner[b.lot] ?? String(b.lot).split(':')[0])) ?? place.landscape.patches[0];
    const manifoldOf = patch => createHash('sha256').update(JSON.stringify({ recipe: 1, patch, older: place.landscape.patches.slice(0, place.landscape.patches.indexOf(patch)) })).digest('hex').slice(0, 12);
    const buildings = [...filled.fabric.buildings, ...filled.landmarks, ...filled.keeps].filter(b => clear(b.x, b.z, Math.max(b.w, b.d) / 2)).map(b => { const patch = patchOf(b); return { id: `${place.id}:${b.lot}`, x: b.x + wx, z: b.z + wz, w: b.w, d: b.d, angle: b.angle, floors: b.floors, kind: b.kind, manifold: manifoldOf(patch), era: LANDSCAPES[patch.type]?.era ?? 'modern' }; });
    // What lies under it (hallsOf, src/ground/stage/underground.ts): malls, the storm water, deep facilities, in world metres.
    const shift = ([x, z]) => [Math.round((x + wx) * 10) / 10, Math.round((z + wz) * 10) / 10], under = U.hallsOf(place.landscape).map(hall => ({ ...hall, boxes: hall.boxes.map(box => { const [x, z] = shift([box.x, box.z]); return { ...box, x, z }; }), bores: hall.bores.map(bore => ({ ...bore, a: shift(bore.a), b: shift(bore.b) })), up: hall.up.map(shift) }));
    const roads = filled.fabric.roads.filter(road => clear((road.a[0] + road.b[0]) / 2, (road.a[1] + road.b[1]) / 2, 0)).map(road => ({ a: [road.a[0] + wx, road.a[1] + wz], b: [road.b[0] + wx, road.b[1] + wz], width: road.width, level: road.level }));
    // Each patch (manifold) in birth order: its type and era, its centre and radius, its outline as 48 points (world metres),
    // and its fingerprint; each building's manifold in `buildings` order.
    const patches = place.landscape.patches.map(patch => ({ id: patch.id, type: patch.type, era: LANDSCAPES[patch.type]?.era ?? 'modern', born: patch.born ?? null, centre: [round(patch.x + wx), round(patch.z + wz)], radius: round(patch.R), height: round(patch.H), manifold: manifoldOf(patch),
      outline: Array.from({ length: 48 }, (_, n) => { const angle = (n / 48) * Math.PI * 2, d = reachOf(patch, [patch.x + Math.cos(angle), patch.z + Math.sin(angle)]); return [round(patch.x + wx + Math.cos(angle) * d), round(patch.z + wz + Math.sin(angle) * d)]; }) }));
    return { place: place.id, types: place.landscape.patches.map(patch => patch.type), patches, manifolds: buildings.map(b => b.manifold), buildings: buildings.map(b => [round(b.x), round(b.z), round(b.w), round(b.d), Math.round(b.angle * 1000) / 1000, b.floors]), roads: roads.map(road => [round(road.a[0]), round(road.a[1]), round(road.b[0]), round(road.b[1]), road.width]),
      walls: filled.walls.map(([a, b]) => [round(a[0] + wx), round(a[1] + wz), round(b[0] + wx), round(b[1] + wz)]), source: { buildings, roads, plazas: filled.plazas.map(plaza => ({ x: plaza.x + wx, z: plaza.z + wz, r: plaza.r })), underground: under } };
  });
  /** The theme of the manifold at a point: the era of the patch reaching it most surely (modern where no landscape does). */
  const themeAt = (x, z) => {
    let best = null, depth = -1;
    for (const place of Object.values(canvas.places)) {
      if (!place.landscape) continue;
      const [wx, wz] = C.worldOf(canvas, place.id);
      if (Math.hypot(x - wx, z - wz) > place.r) continue;
      for (const patch of place.landscape.patches) { const by = insideBy(patch, [x - wx, z - wz]); if (by > depth) { depth = by; best = patch; } }
    }
    return best && LANDSCAPES[best.type]?.era === 'ancient' ? 'ancient' : 'modern';
  };
  // The world: every staged place an anchor on its canvas spot (a staged building stands there; an open place is its ground).
  // One building, one lot (building EM, the user's rules): a building whose identity holds several of the scenes' places
  // keeps the one with the least total travel for everyone who went there in the book (from where each was in their scene
  // before), and every scene at the others moves onto it; it takes the building's name.
  const keptOf = new Map();
  if (buildingsEM) {
    const position = id => macroOf.get(id), merged = [];
    for (const identity of buildingsEM.identities) {
      const candidates = identity.places.filter(id => ownGrids.has(id) && position(id));
      if (!candidates.length) continue;
      const visits = chosen.flatMap((scene, n) => identity.places.includes(scene.placeId) ? scene.cast.map(person => { for (let m = n - 1; m >= 0; m--) if (chosen[m].cast.includes(person) && !identity.places.includes(chosen[m].placeId)) return position(chosen[m].placeId); return null; }).filter(Boolean) : []);
      const cost = id => visits.reduce((sum, from) => sum + Math.hypot(from.x - position(id).x, from.z - position(id).z), 0);
      const kept = candidates.sort((a, b) => cost(a) - cost(b))[0];
      for (const id of identity.places) keptOf.set(id, { kept, label: identity.label, identity: identity.id });
      if (candidates.length > 1) merged.push(`${identity.label}: ${candidates.map(name).join(' + ')} → ${name(kept)} (${Math.round(cost(kept))} m of travel)`);
    }
    for (const scene of chosen) { const to = keptOf.get(scene.placeId)?.kept; if (to && to !== scene.placeId) { ownGrids.delete(scene.placeId); scene.placeId = to; } }
    notes.buildingEM = { identities: buildingsEM.identities.length, merged };
  }
  // A named building's role and floors by its kind (architecture); a world-first spot's by the building the world said it is.
  const anchors = [...ownGrids].map(id => {
    const node = macroOf.get(id), own = kindOf(id) === 'site', kind = inputs.architecture?.places[id]?.kind, [role, floors] = BUILDING_OF[worldScript?.places?.[id]?.building] ?? [ROLE_OF[kind] ?? 'office', FLOORS_OF[kind] ?? 6];
    return { place: id, label: keptOf.get(id)?.label ?? name(id), x: node?.spotX ?? 0, z: node?.spotZ ?? 0, own, role, floors, era: themeAt(node?.spotX ?? 0, node?.spotZ ?? 0) };
  });
  notes.buildings = Object.fromEntries(Object.entries(anchors.filter(anchor => anchor.own).reduce((count, anchor) => ({ ...count, [anchor.role]: (count[anchor.role] ?? 0) + 1 }), {})));
  // The city's subway on its own logic (subwayOf): through the centres of the areas the canvas has (its districts and
  // streets, not the scenes' own spots) and the stations the story names; across the city through its middle without them.
  // Each hall belongs to the smallest area its middle lies in: its underground comes alive once someone goes down there.
  const city = macro.filter(node => !node.parent && node.scale === 'city').sort((a, b) => b.r - a.r)[0] ?? macro.filter(node => !node.parent).sort((a, b) => b.r - a.r)[0];
  const stops = macro.filter(node => ['district', 'street'].includes(node.scale) && !node.temporary && !node.unbuilt && !String(node.id).startsWith('spot:')).map(node => ({ id: node.id, x: node.x, z: node.z }))
    .concat(anchors.filter(anchor => anchor.own && anchor.role === 'station').map(anchor => ({ id: anchor.place, x: anchor.x, z: anchor.z })));
  const areaAt = (x, z) => macro.filter(node => !node.dwelling && !node.unbuilt && ['city', 'district', 'street'].includes(node.scale) && Math.hypot(x - node.x, z - node.z) <= node.r).sort((a, b) => a.r - b.r)[0]?.id ?? city?.id ?? null;
  // One storm-water system for the city: its own landscape's (a district's landscape keeps its malls and deep facilities).
  const halls = [...landscapes.flatMap(entry => entry.source.underground.filter(hall => !['tank', 'channel'].includes(hall.kind) || entry.place === city?.id)), ...(city ? U.subwayOf(stops, city.id, city.r) : [])].map(hall => { const b = U.boundsOf(hall); return { ...hall, area: areaAt((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2), label: U.HALL_LABEL[hall.kind] }; });
  const underground = { halls };
  notes.underground = { halls: Object.fromEntries(Object.entries(halls.reduce((count, hall) => ({ ...count, [hall.kind]: (count[hall.kind] ?? 0) + 1 }), {}))), stops: stops.length, active: {}, hits: 0 };
  world = W.createWorld({ buildings: landscapes.flatMap(entry => entry.source.buildings), roads: landscapes.flatMap(entry => entry.source.roads), plazas: landscapes.flatMap(entry => entry.source.plazas), anchors, underground });
  shared.layout = { id: 'world', kind: 'world', lots: world.lots };
  // Damage other story lines left on the world (stage/simulation/world.json, from their accepted runs): applied in story order,
  // to a building the moment it stands here, when the scene that broke it comes before the one being walked. A building whose
  // landscape has changed since (another fingerprint) is not that building any more. Derived view data, never canon.
  const damageLog = JSON.parse(await readFile(`${novelDir}/stage/simulation/world.json`, 'utf8').catch(() => 'null'));
  const sameLine = entry => entry.strand?.from === options.from && entry.strand?.to === options.to && (entry.strand?.fork ?? null) === (options.fork ?? null);
  let pending = (damageLog?.entries ?? []).filter(entry => !sameLine(entry) && Number.isFinite(entry.story)).sort((a, b) => a.story - b.story), story = -Infinity;
  const earlier = [];
  notes.earlier = { log: damageLog?.version ?? null, applied: 0, stale: 0 };
  const applyEarlier = () => {
    pending = pending.filter(entry => {
      if (entry.story >= story) return true;
      const index = world.lots.findIndex(lot => lot.source === entry.building);
      if (index < 0) return true;
      const lot = world.lots[index];
      if (entry.manifold !== lot.manifold) { notes.earlier.stale++; return false; }
      const structure = (shared.structures[index] ??= structureOf(lot)), units = shared.units[index] ?? intact(structure), unitOf = new Map();
      for (let unit = 0; unit < structure.kind.length; unit++) unitOf.set(`${structure.kind[unit]}|${structure.i[unit]}|${structure.j[unit]}|${structure.k[unit]}`, unit);
      for (const [kind, i, j, k] of [...entry.blasted, ...entry.fallen]) { const unit = unitOf.get(`${kind}|${i}|${j}|${k}`); if (unit !== undefined) units[unit] = 0; }
      const standing = skeletonStanding(structure, units);
      for (const cell of [...entry.destroyed, ...entry.fell]) standing[cell] = 0;
      shared.units[index] = units; shared.standing[index] = standing; shared.version++; notes.earlier.applied++;
      earlier.push({ lot: index, strand: entry.strand.id, run: entry.run, scene: entry.scene, label: entry.label, story: entry.story, blasted: entry.blasted, fallen: entry.fallen, destroyed: entry.destroyed, fell: entry.fell });
      return false;
    });
  };
  for (const id of ownGrids) groups.set(id, groupOf({ label: name(id), path: (places.get(id)?.path ?? [id]).map(name), scale: inputs.scale?.places[id]?.scale ?? null, kind: kindOf(id), anchor: anchors.find(anchor => anchor.place === id), main: () => { const index = world.lots.findIndex(lot => lot.place === id); return index >= 0 ? index : null; } }));
  notes.landscape = { places: landscapes.length, buildings: landscapes.reduce((sum, entry) => sum + entry.buildings.length, 0), temporary: macro.filter(node => node.temporary).length };
  // Between places, people walk the map: its own path integral over a lattice (macroPath.ts), from where they leave one
  // place's grid to where they enter the next, each boundary crossed costing more the more slanted the crossing. Inside
  // the two places they walk each place's own graph: out to the edge of the grid where the map path leaves it, and in from
  // where it arrives to where the scene finds them.
  const boundaries = macro.filter(node => !node.unbuilt).flatMap(node => [{ x: node.x, z: node.z, r: node.r }, ...(node.own ? [{ x: node.spotX, z: node.spotZ, r: node.own }] : [])]);
  // The lattice's cell grows with the map, so a city-sized canvas stays a few hundred cells across.
  const span = Math.max(...boundaries.map(b => Math.abs(b.x) + b.r), ...boundaries.map(b => Math.abs(b.z) + b.r)) * 2 + 80, macroCell = Math.max(4, Math.ceil(span / 260));
  const lattice = macroLattice(boundaries, { cell: macroCell, margin: 40 }), macroKappa = 2, macroT = 0.6 * temperatureBound({ step: macroCell, kappa: macroKappa, lambda, floorHeight: 3, arcCost: 7 });
  /** A node on the map (the world and the map share metres), and the box round a place's anchor where its ground begins. */
  const onMap = (placeId, node) => { const p = W.nodePos(world, node); return { x: p.x, z: p.z }; };
  const gridOf = placeId => { const { anchor } = groups.get(placeId), half = 24; return { x: [anchor.x - half, anchor.x + half], z: [anchor.z - half, anchor.z + half] }; };
  const inGrid = (placeId, node) => { const rect = gridOf(placeId), x = lattice.graph.x[node], z = lattice.graph.z[node]; return x >= rect.x[0] && x <= rect.x[1] && z >= rect.z[0] && z <= rect.z[1]; };
  const macroFields = new Map(), macroField = placeId => { if (!macroFields.has(placeId)) macroFields.set(placeId, solveWalk(lattice.graph, latticeWithin(lattice, gridOf(placeId)), { T: macroT, kappa: macroKappa, lambda })); return macroFields.get(placeId); };
  /** Open ground within a few metres of a point, streamed in first: where one walks out of or into a place. */
  const doorsNear = (x, z) => { reach(x, z, 20); const built = graphOf({ x, z }), out = []; for (let id = 0; id < built.type.length; id++) if (built.type[id] === 1 && built.graph.offsets[id + 1] > built.graph.offsets[id]) { const p = W.nodePos(world, id); if (Math.hypot(p.x - x, p.z - z) <= 6) out.push(id); } return out; };
  const where = new Map(), routes = new Map();
  // Who goes together: Jev's pairs at a chance of at least a half, joined into groups. A group's leader is its first
  // member in the walk's order (the people an event names, then the cast; at a start, the handoffs' order), and every
  // other member ends beside the leader. Answers from before pairs were asked fall back to two people the event names
  // going to the same spot.
  const TOGETHER = 0.5;
  const leaderOf = (pairs, order, person) => {
    const group = new Set([person]);
    for (let grew = true; grew;) { grew = false; for (const [a, b, p] of pairs) if (p >= TOGETHER && group.has(a) !== group.has(b)) { group.add(a); group.add(b); grew = true; } }
    const first = order.find(id => group.has(id));
    return first && first !== person ? first : null;
  };
  const eventPairs = (scene, event) => {
    const asked = report[scene.id]?.pairs?.[event.id];
    if (asked) return asked;
    const answers = report[scene.id]?.events?.[event.id] ?? {}, named = event.actors.filter(id => answers[id]?.to);
    return named.flatMap((a, i) => named.slice(i + 1).filter(b => topSpot(answers[a].to) === topSpot(answers[b].to)).map(b => [a, b, TOGETHER]));
  };
  /** The free node beside another, on its level: the nearest 0.8–3 m off that nobody in the scene stands on. */
  const besideNode = (placeId, node) => {
    const { graph } = graphOf(W.nodePos(world, node)), taken = new Set([...where.values()].filter(entry => entry.at).map(entry => entry.at[0]));
    let best = null, gap = Infinity;
    for (let other = 0; other < graph.nodes; other++) {
      if (other === node || taken.has(other) || graph.y[other] !== graph.y[node] || graph.offsets[other + 1] === graph.offsets[other]) continue;
      const d = Math.hypot(graph.x[other] - graph.x[node], graph.z[other] - graph.z[node]);
      if (d >= 0.8 && d <= 3 && d < gap) { best = other; gap = d; }
    }
    return best ?? node;
  };
  // Where each person begins in a scene and ends in an event, for their companions.
  const begun = new Map(), went = new Map();
  /** One person's way from the place they were last in to where the scene finds them: out, across the map, in. */
  const travel = (scene, person, begin, seed) => {
    const last = where.get(person), from = last?.place, to = scene.placeId, rng = stream(seed, 'route');
    if (!from || from === to || !macroOf.has(from) || !groups.has(from)) return begin;
    const leaving = onMap(from, last.at[0]), walk = sampleWalk(lattice.graph, macroField(to), latticeNode(lattice, leaving.x, leaving.z), Math.max(0, last.at[1]), rng);
    if (!walk) { notes.travel.unreachable++; return begin; }
    const point = node => ({ x: lattice.graph.x[node], z: lattice.graph.z[node] }), gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
    let leave = 0;
    for (let n = 0; n < walk.length; n++) if (inGrid(from, walk[n])) leave = n;
    // Out: to the edge cells nearest where the map path leaves the grid.
    const exitAt = point(walk[leave]), doors = doorsNear(exitAt.x, exitAt.z);
    const exit = doors.length ? sampleWalk(null, solve(from, `edge@${doors.join(',')}@${last.at[0]}`, doors, 'walk', last.at[0]), last.at[0], Math.max(0, last.at[1]), rng) : null;
    // In: from the edge cell nearest where the map path arrives, to where the scene finds them.
    const arriveAt = point(walk.at(-1)), door = doorsNear(arriveAt.x, arriveAt.z).map(node => ({ node, gap: gap(onMap(to, node), arriveAt) })).sort((a, b) => a.gap - b.gap)[0]?.node;
    const heading = walk.length > 1 ? directionOf(arriveAt.x - lattice.graph.x[walk.at(-2)], arriveAt.z - lattice.graph.z[walk.at(-2)]) : begin[1];
    const entry = door === undefined ? null : sampleWalk(null, solve(to, `node@${begin[0]}@${door}`, [begin[0]], 'walk', door), door, heading, rng);
    const round = value => Math.round(value * 10) / 10, start = exit ? onMap(from, exit.at(-1)) : exitAt, end = door === undefined ? arriveAt : onMap(to, door);
    const path = smoothPath([start, ...walk.slice(leave + 1, -1).map(point), end].map(p => [p.x, p.z])).map(([x, z]) => [round(x), round(z)]);
    const metres = path.slice(1).reduce((sum, p, n) => sum + Math.hypot(p[0] - path[n][0], p[1] - path[n][1]), 0), crossed = path.slice(1).reduce((sum, p, n) => sum + crossings(boundaries, path[n][0], path[n][1], p[0], p[1]).count, 0);
    routes.set(`${scene.id}|${person}`, { exit, path, entry, metres: Math.round(metres), crossed });
    notes.travel.routes++; notes.travel.metres += Math.round(metres); notes.travel.crossed += crossed;
    if (!entry || entry.length < 2) return begin;
    const a = W.nodePos(world, entry.at(-1)), b = W.nodePos(world, entry.at(-2)), turned = directionOf(a.x - b.x, a.z - b.z);
    return [begin[0], turned >= 0 ? turned : begin[1]];
  };
  const mover = {
    // Carried from this place when they were last here; else where Jev said the scene finds them, else coming in off the avenue
    // (walking there from the place they were last in).
    start: ({ scene, handoff, carried, seed }) => {
      // Together at the opening: beside the leader, wherever the leader begins.
      const order = (timeline.handoffs.get(scene.id) ?? []).map(entry => entry.person), leader = leaderOf(report[scene.id]?.startPairs ?? [], order, handoff.person), ahead = leader && begun.get(`${scene.id}|${leader}`);
      if (ahead) {
        (traceOf(scene.id, 'start').together ??= []).push({ person: handoff.person, with: leader });
        const begin = [besideNode(scene.placeId, ahead[0]), ahead[1]];
        begun.set(`${scene.id}|${handoff.person}`, begin);
        return handoff.from && !handoff.samePlace ? travel(scene, handoff.person, begin, seed) : begin;
      }
      const begin = beginOf({ scene, handoff, carried, seed });
      begun.set(`${scene.id}|${handoff.person}`, begin);
      return begin;
    },
    act: args => {
      const { scene, event, person, at, seed } = args, order = [...scene.cast.filter(id => event.actors.includes(id)), ...scene.cast.filter(id => !event.actors.includes(id))];
      const leader = leaderOf(eventPairs(scene, event), order, person), led = leader ? went.get(`${scene.id}|${event.id}|${leader}`) : null;
      if (!led || led.node === null || !at) { const outcome = actAlone(args); went.set(`${scene.id}|${event.id}|${person}`, outcome.kind === 'move' ? { node: outcome.to[0], how: moves.get(`${scene.id}|${event.id}|${person}`)?.how } : { node: at?.[0] ?? null }); return outcome; }
      // Going with the leader: to the node beside where the leader ends (or stands, if they stay), the leader's way.
      const { graph } = graphOf(focusOf(at)), [node, heading] = at, rng = stream(seed), target = besideNode(scene.placeId, led.node), how = led.how ?? 'walk';
      traceMove(scene, event, person, focusOf(at));
      (traceOf(scene.id, scene.events.findIndex(entry => entry.id === event.id)).together ??= []).push({ person, with: leader });
      placeThings(scene, event, at);
      damage(scene, event, at, seed);
      const near = Math.hypot(graph.x[target] - graph.x[node], graph.z[target] - graph.z[node]) <= 3 && graph.y[target] === graph.y[node];
      went.set(`${scene.id}|${event.id}|${person}`, { node: near ? node : target, how });
      if (near) return { kind: 'stay' };
      const path = sampleWalk(graph, solve(scene.placeId, `node@${target}@${node}`, [target], how, node), node, heading, rng);
      if (!path) { notes.unreachable++; return { kind: 'stay' }; }
      notes.together = (notes.together ?? 0) + 1;
      const last = path.length > 1 ? directionOf(graph.x[path.at(-1)] - graph.x[path.at(-2)], graph.z[path.at(-1)] - graph.z[path.at(-2)]) : heading;
      moves.set(`${scene.id}|${event.id}|${person}`, { person, how, spot: `with:${leader}`, with: leader, path, ensemble: [] });
      return { kind: 'move', to: [path.at(-1), last >= 0 ? last : heading] };
    },
  };
  /** Where someone begins on their own. */
  function beginOf({ scene, handoff, carried, seed }) {
      if (carried) return carried;
      const { anchor } = groups.get(scene.placeId);
      reach(anchor.x, anchor.z, 56);
      const spots = spotsFor(scene.placeId), said = report[scene.id]?.starts?.[handoff.person], named = said && said.stated >= 0.5 ? spotKey(scene.placeId, topSpot(said.to)) : null;
      if (said) (traceOf(scene.id, 'start').starts ??= []).push({ person: handoff.person, stated: said.stated, to: top(said.to, 3).map(([name, p]) => [name, p, spotAt(scene.placeId, name)]), used: !!named });
      const spot = named && spots[named]?.length ? named : spots.avenue.length ? 'avenue' : 'north', begin = [pick(spots[spot], stream(seed)), directionOf(0, -1)];
      return handoff.from && !handoff.samePlace ? travel(scene, handoff.person, begin, seed) : begin;
  }
  /** Jev's answer for someone in an event, for the player's trace. */
  function traceMove(scene, event, person, focus) {
    const answer = report[scene.id]?.events?.[event.id]?.[person], spot = spotKey(scene.placeId, topSpot(answer?.to), focus);
    if (answer) (traceOf(scene.id, scene.events.findIndex(entry => entry.id === event.id)).moves ??= []).push({ person, moves: answer.moves ?? null, how: answer.how ?? null, direction: top(answer.direction, 2), to: top(answer.to, 3).map(([name, p]) => [name, p, spotAt(scene.placeId, name, focus)]), chosen: answer.to ? spot : null });
  }
  /** What someone does on their own in an event: Jev's move for them, walked. */
  function actAlone({ scene, event, person, at, seed }) {
      placeThings(scene, event, at);
      damage(scene, event, at, seed);
      const focus = focusOf(at);
      if (focus) reach(focus.x, focus.z, 48);
      const answer = report[scene.id]?.events?.[event.id]?.[person], spot = spotKey(scene.placeId, topSpot(answer?.to), focus), { graph } = graphOf(focus), spots = spotsFor(scene.placeId, focus);
      traceMove(scene, event, person, focus);
      if (!answer?.to || !at || !spots[spot]?.length) return { kind: 'stay' };
      const [node, heading] = at, rng = stream(seed);
      if (answer.how === 'teleport') { const to = pick(spots[spot], rng); notes.teleports++; moves.set(`${scene.id}|${event.id}|${person}`, { person, how: 'teleport', spot, path: [node, to], ensemble: [] }); return { kind: 'move', to: [to, heading] }; }
      // Already there: somewhere else in the same spot, at least 4 m off or on another level.
      let targets = spots[spot], key = spot;
      if (targets.includes(node)) { targets = targets.filter(other => Math.hypot(graph.x[other] - graph.x[node], graph.z[other] - graph.z[node]) > 4 || graph.y[other] !== graph.y[node]); key = `${spot}@${node}`; }
      const field = solve(scene.placeId, `${key}@${node}`, targets, answer.how, node), path = sampleWalk(graph, field, node, heading, rng);
      // What a move could not reach (the first few, for the run's notes): where it was going and from which level.
      if (!path) { notes.unreachable++; if ((notes.unreachableWhy ??= []).length < 12) notes.unreachableWhy.push({ scene: scene.id, spot, how: answer.how, from: W.nodePos(world, node).k, targets: targets.length }); return { kind: 'stay' }; }
      const ensemble = Array.from({ length: 14 }, () => sampleWalk(graph, field, node, heading, rng)).filter(Boolean);
      const last = path.length > 1 ? directionOf(graph.x[path.at(-1)] - graph.x[path.at(-2)], graph.z[path.at(-1)] - graph.z[path.at(-2)]) : heading;
      notes.sampled++;
      if (event.actors.includes(person) && POWER_WORDS.test(event.text.split('（原文：')[0])) {
        notes.direct = (notes.direct ?? 0) + 1;
        moves.set(`${scene.id}|${event.id}|${person}`, { person, how: 'direct', spot, path: [node, path.at(-1)], ensemble: [] });
        return { kind: 'move', to: [path.at(-1), heading] };
      }
      moves.set(`${scene.id}|${event.id}|${person}`, { person, how: answer.how, spot, path, ensemble });
      return { kind: 'move', to: [path.at(-1), last >= 0 ? last : heading] };
  }
  // Where each person was last: the place and node a later scene's travel starts from.
  /**
   * The world as it stands at a moment, for the live view (options.live): every chunk and lot explored, what of each lot is
   * broken, where everyone is, the moment's moves as points, and where the moment is looked at (the middle of its people,
   * as wide as they stand apart) — what Jev's picture of it frames. World metres throughout.
   */
  const palette = new Map([...new Set(chosen.flatMap(scene => scene.cast))].map((id, index) => [id, PALETTE[index % PALETTE.length]]));
  const snapshot = (final = false) => {
    const [sceneId, eventText] = moment.split('|'), scene = chosen.find(entry => entry.id === sceneId), eventIndex = Number(eventText), event = Number.isInteger(eventIndex) ? scene?.events[eventIndex] : null;
    const people = [...where.entries()].filter(([, entry]) => entry.at).map(([id, entry]) => { const p = W.nodePos(world, entry.at[0]); return { id, name: name(id), color: palette.get(id) ?? '#ffffff', x: p.x, y: p.y, z: p.z, here: entry.place === scene?.placeId }; });
    const here = people.filter(person => person.here), centre = here.length ? { x: here.reduce((sum, p) => sum + p.x, 0) / here.length, z: here.reduce((sum, p) => sum + p.z, 0) / here.length } : groups.get(scene?.placeId)?.anchor ?? { x: 0, z: 0 };
    const focus = { x: Math.round(centre.x * 10) / 10, z: Math.round(centre.z * 10) / 10, r: Math.round(Math.max(16, ...here.map(p => Math.hypot(p.x - centre.x, p.z - centre.z) + 8))) };
    const point = id => { const p = W.nodePos(world, id); return [p.x, p.y, p.z]; };
    const playing = event ? scene.cast.map(person => moves.get(`${scene.id}|${event.id}|${person}`)).filter(Boolean).map(move => ({ person: move.person, how: move.how, with: move.with ?? null, path: move.path.map(point) })) : [];
    const broken = world.lots.flatMap((lot, index) => {
      const standing = shared.standing[index], units = shared.units[index], structure = shared.structures[index], cells = [];
      if (standing) for (let cell = 0; cell < lot.skeleton.cells.length; cell++) if (lot.skeleton.cells[cell] && !standing[cell]) cells.push(cell);
      const lost = units && structure ? [...units.keys()].filter(unit => unit >= structure.cells && structure.kind[unit] && !units[unit]).map(unit => [structure.kind[unit], structure.i[unit], structure.j[unit], structure.k[unit]]) : [];
      return cells.length || lost.length ? [{ lot: index, cells, units: lost }] : [];
    });
    return { kind: 'stage-world-live', final, moment, scene: sceneId ?? null, place: scene?.placeId ?? null, placeLabel: scene ? name(scene.placeId) : null, event: event ? { index: eventIndex, text: event.text.split('（原文：')[0].slice(0, 200) } : null, focus, people, moves: playing,
      chunks: [...world.chunks].map(([key, born]) => { const { ci, cj } = W.chunkOf(key); return [ci, cj, born, W.chunkGround(world, key)]; }),
      lots: world.lots.map(lot => ({ i0: lot.i0, j0: lot.j0, nx: lot.nx, nz: lot.nz, floors: lot.floors, height: lot.height, label: lot.label, role: lot.role, source: lot.source, place: lot.place, born: lot.born, cells: [...lot.skeleton.cells].join('') })),
      broken, hits: [...hits.entries()].map(([id, hit]) => ({ event: id, sphere: hit.sphere ?? null, point: hit.point })), earlier: earlier.map(({ lot, strand, scene: from, story: at }) => ({ lot, strand, scene: from, story: at })),
      landscapes: landscapes.map(entry => ({ place: entry.place, buildings: entry.buildings, ids: entry.source.buildings.map(b => b.id), roads: entry.roads })), dropped: [...world.dropped],
      notes: { chunks: world.chunks.size, lots: world.lots.length, nodes: world.cells.length / 3, applied: notes.earlier.applied, build: notes.build, ground: scene ? groundLine(scene.placeId) : '' } };
  };
  let lastLive = 0;
  const live = (final = false, now = false) => { if (!options.live || (!final && !now && Date.now() - lastLive < 300)) return; lastLive = Date.now(); options.live(snapshot(final), now ? assemble(partialRuns(), moment) : null); };
  /** The walk so far as runs: each scene begun, with where its people began (where they were after each event is not kept). */
  const partialRuns = () => { const out = {}; for (const [key, begin] of begun) { const [sceneId, person] = key.split('|'); ((out[sceneId] ??= { starts: {}, events: [] }).starts[person] = begin); } return out; };
  const { start, act } = mover;
  // World-first starts and meetings (see worldScript above). Conversation distance: the same floor, within 4 m.
  const TALK = 4;
  const meetings = new Map();
  const peopleAt = (placeId, except = null, floor = null) => [...where.entries()].filter(([id, entry]) => id !== except && entry.place === placeId && entry.at).map(([, entry]) => W.nodePos(world, entry.at[0])).filter(p => floor === null || p.k === floor).map(p => [p.x, p.z]);
  /**
   * Someone first seen: first the level (the street, a building's ground floor, each floor up to the tallest building
   * around, a roof), then a box on a picture of that level, a slice through the buildings there with their rooms drawn.
   * Inside, the room under the box (or the nearest room on that floor of that building) is where they are born, on a
   * walkable cell of it; outside, the walkable cell nearest the box. Null leaves it to the engine's own start.
   */
  const firstStart = async ({ scene, handoff, carried }) => {
    const entry = worldScene.get(scene.id), fresh = anew(scene.id) && (entry?.present ?? []).includes(handoff.person);
    // A scene that starts anew (stage/world/spawn.json) places everyone present afresh; otherwise only someone first seen.
    if (!jev || (!fresh && (carried || !entry?.firstSeen?.includes(handoff.person)))) return null;
    const { anchor } = groups.get(scene.placeId), radius = 48;
    reach(anchor.x, anchor.z, 56);
    const who = name(handoff.person), context = [entry.context ?? '', ...startContext(scene, handoff.person, anchor)].filter(Boolean).join('\n\n');
    const around = world.lots.filter(lot => Math.abs((lot.i0 + lot.nx / 2) * 2 - anchor.x) <= radius && Math.abs((lot.j0 + lot.nz / 2) * 2 - anchor.z) <= radius);
    const top = Math.min(12, Math.max(1, ...around.map(lot => lot.floors)));
    // In a room on a floor the text does not give: a floor drawn at random (the same for this person and scene every run)
    // among the floors of the scene's own building, or of the tallest building around when the scene has none.
    const ROOM = 'inside a building, in a room, on a floor the text does not say';
    const levels = [['outside, at street level', null], ['inside a building, on the ground floor', 0], ...Array.from({ length: top - 1 }, (_, n) => [`inside a building, on floor ${n + 2}`, n + 1]), [ROOM, 'room'], ['on a roof', 'roof'], ['underground, just under the street (a basement, a car park, an underground mall)', 'shallow'], ['in the subway (a station, a platform, a tunnel)', 'subway'], ['deep underground (storm-water tanks and channels, a deep facility, a bunker)', 'deep']];
    const [level] = await jev.decide(context, [{ key: 'level', primitive: 'choice', instructions: `Where is ${who} when this scene begins: outside, on which floor of a building (or in a room on a floor the text does not say), on a roof, or underground (just under the street, in the subway, or deep)?`, options: levels.map(([label]) => label) }]);
    let floor = levels.find(([label]) => label === level?.value)?.[1] ?? null, own = null;
    if (floor === 'room') { const index = groups.get(scene.placeId).main?.(); own = index != null ? world.lots[index] : null; const floors = own ? own.floors : top; floor = Math.min(floors - 1, Math.floor(stream(`${scene.id}|${handoff.person}|floor`)() * floors)); notes.roomFloors = [...(notes.roomFloors ?? []), floor + 1]; }
    if (['shallow', 'subway', 'deep'].includes(floor)) return bornUnder({ scene, handoff, who, context, anchor, radius, choice: floor, level: level?.value ?? null });
    const inside = typeof floor === 'number';
    // A floor drawn for the scene's own building: the slice is of that building, close up, so the box picks one of its rooms.
    const centre = own ? { x: (own.i0 + own.nx / 2) * 2, z: (own.j0 + own.nz / 2) * 2, r: Math.max(own.nx, own.nz) + 6 } : { x: anchor.x, z: anchor.z, r: radius };
    const picture = mapPicture(world, { x: centre.x, z: centre.z, radius: centre.r, people: peopleAt(scene.placeId, handoff.person, inside ? floor : null), floor: inside ? floor : null });
    const asked = await jev.decide(`${context}\n\n${picture.legend}`, [{ key: 'box', primitive: 'box', instructions: inside ? `Which room on this floor is ${who} in when this scene begins? Box that room.` : `Where on this map is ${who} when this scene begins?` }, { key: 'on', primitive: 'noul', instructions: `Is where ${who} is when this scene begins somewhere on this picture?` }], { images: { map: picture.png } });
    notes.worldStarts = (notes.worldStarts ?? 0) + 1;
    const box = asked.find(answer => answer.key === 'box')?.box, on = Number(asked.find(answer => answer.key === 'on')?.value ?? 0);
    // In the scene's own building (a drawn floor) they are there by the scene: without a box, the middle of its floor.
    if (!own && (!box || on < 0.3)) return null;
    const point = box ? picture.at(box) : { x: centre.x, z: centre.z }, index = world.lotAt.get(W.cellKey(Math.floor(point.x / 2), Math.floor(point.z / 2))), boxed = index === undefined ? null : world.lots[index], built = graphOf(point);
    // The box missed the building whose floor was drawn (a roof, the street): the nearest room on that floor of that building.
    const lot = own && !(boxed && boxed.floors > floor) ? own : boxed;
    let node = null, room = null;
    if (inside && lot && lot.floors > floor) {
      const ci = Math.floor(point.x / 2) - lot.i0, cj = Math.floor(point.z / 2) - lot.j0, rooms = (lot.rooms ?? []).map((box, n) => ({ box, n })).filter(entry => entry.box.floor === floor);
      const gap = ({ box }) => Math.hypot((box.i0 + box.i1) / 2 - ci, (box.j0 + box.j1) / 2 - cj);
      room = rooms.find(({ box }) => ci >= box.i0 && ci <= box.i1 && cj >= box.j0 && cj <= box.j1) ?? rooms.sort((a, b) => gap(a) - gap(b))[0] ?? null;
      if (room) {
        let far = Infinity;
        for (let id = 0; id < built.type.length; id++) {
          if (!built.type[id] || built.graph.offsets[id + 1] === built.graph.offsets[id]) continue;
          const p = W.nodePos(world, id);
          if (p.k !== floor || p.i < lot.i0 + room.box.i0 || p.i > lot.i0 + room.box.i1 || p.j < lot.j0 + room.box.j0 || p.j > lot.j0 + room.box.j1) continue;
          const d = Math.hypot(p.x - point.x, p.z - point.z);
          if (d < far) { far = d; node = id; }
        }
      }
    }
    node ??= W.nodeNear(world, built, point.x, point.z, floor === 'roof' && lot ? lot.floors : inside ? floor : 0);
    if (node == null) return null;
    notes.bornInRooms = (notes.bornInRooms ?? 0) + (room && node != null ? 1 : 0);
    (traceOf(scene.id, 'start').boxed ??= []).push({ person: handoff.person, level: level?.value ?? null, ...(inside ? { floor: floor >= 0 ? floor + 1 : floor } : {}), at: [Math.round(point.x), Math.round(point.z)], ...(room ? { room: room.n, building: lot.source } : {}), ...(fresh ? { anew: true } : {}) });
    if (fresh) notes.freshStarts = (notes.freshStarts ?? 0) + 1;
    // Placed afresh where a scene starts anew: there, not walked from where they were.
    return handoff.from && !handoff.samePlace && !fresh ? travel(scene, handoff.person, [node, 0], `${scene.id}|${handoff.person}`) : [node, 0];
  };
  /**
   * What a start question adds to the world loop's context: the scene's surroundings (its environment cards, from the
   * spawn plan) and who is already placed here, each with how far and which way from the middle of the picture.
   */
  const startContext = (scene, person, anchor) => {
    const plan = spawnPlan?.scenes?.[scene.id], here = [...where.entries()].filter(([id, entry]) => id !== person && entry.place === scene.placeId && entry.at);
    const side = (dx, dz) => ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8];
    const placed = here.map(([id, entry]) => { const p = W.nodePos(world, entry.at[0]), d = Math.hypot(p.x - anchor.x, p.z - anchor.z); return `- ${name(id)}: ${d < 3 ? 'at the middle' : `${Math.round(d)} m ${side(p.x - anchor.x, p.z - anchor.z)} of the middle`}${p.k > 0 ? `, floor ${p.k + 1}` : p.k < 0 ? ', underground' : ''}`; });
    return [
      plan?.environment?.length ? `This scene's surroundings, as the text describes them:\n${plan.environment.map(card => `- ${card}`).join('\n')}` : '',
      plan?.spawn === 'new' ? `This scene starts anew (${plan.why ?? 'time has passed, or the surroundings changed'}): everyone in it is placed afresh.` : '',
      placed.length ? `Already placed here (the red dots on the map):\n${placed.join('\n')}` : '',
    ];
  };
  /**
   * Underground (docs/underground-design.md §6.1): what is under a point for one of Jev's three choices, a hall (its index)
   * or a building's basement (its lot), the one under the point, else the nearest within 30 m; and its node nearest the point.
   */
  const hallUnder = (choice, point) => {
    const halls = world.source.underground?.halls ?? [], own = halls.map((hall, index) => ({ hall, index })).filter(({ hall }) => U.intervalsOf(hall).includes(choice));
    const lotIndex = world.lotAt.get(W.cellKey(Math.floor(point.x / 2), Math.floor(point.z / 2))), basement = choice === 'shallow' && lotIndex !== undefined && W.basementsOf(world.lots[lotIndex]) ? { lot: lotIndex } : null;
    // A basement is drawn over whatever lies deeper under its building, so a box on it means the basement.
    const under = own.find(({ hall }) => U.inHall(hall, [point.x, point.z]));
    if (basement) return basement;
    if (under) return { hall: under.index };
    const gap = hall => { const b = U.boundsOf(hall); return Math.hypot(Math.max(0, b.x0 - point.x, point.x - b.x1), Math.max(0, b.z0 - point.z, point.z - b.z1)); };
    const near = own.map(({ hall, index }) => ({ index, gap: gap(hall) })).filter(entry => entry.gap <= 30).sort((a, b) => a.gap - b.gap)[0];
    return near ? { hall: near.index } : null;
  };
  const nodeOfHall = (found, point) => {
    reach(point.x, point.z, 40);
    const built = graphOf(point), want = found.hall !== undefined ? W.HALL_LOT + found.hall : found.lot;
    let best = null, far = Infinity;
    for (let id = 0; id < built.type.length; id++) {
      if (built.type[id] !== 5 || built.lot[id] !== want || built.graph.offsets[id + 1] === built.graph.offsets[id]) continue;
      const p = W.nodePos(world, id), d = Math.hypot(p.x - point.x, p.z - point.z);
      if (d < far) { far = d; best = id; }
    }
    return best;
  };
  /** Someone first seen underground: a picture of that choice's halls from above, a box on it, the hall it finds. */
  const bornUnder = async ({ scene, handoff, who, context, anchor, radius, choice, level }) => {
    reach(anchor.x, anchor.z, radius + 8);
    const below = [...where.entries()].filter(([id, entry]) => id !== handoff.person && entry.place === scene.placeId && entry.at).map(([, entry]) => W.nodePos(world, entry.at[0])).filter(p => p.k < 0).map(p => [p.x, p.z]);
    const picture = mapPicture(world, { x: anchor.x, z: anchor.z, radius, people: below, under: choice });
    const asked = await jev.decide(`${context}\n\n${picture.legend}`, [{ key: 'box', primitive: 'box', instructions: `Where down here is ${who} when this scene begins? Box that place on the picture.` }], { images: { map: picture.png } });
    notes.worldStarts = (notes.worldStarts ?? 0) + 1;
    const box = asked[0]?.box;
    if (!box) return null;
    const point = picture.at(box), found = hallUnder(choice, point), node = found ? nodeOfHall(found, point) : null;
    if (node == null) return null;
    notes.bornUnder = (notes.bornUnder ?? 0) + 1;
    wake(node);
    (traceOf(scene.id, 'start').boxed ??= []).push({ person: handoff.person, level, under: choice, at: [Math.round(point.x), Math.round(point.z)], ...(found.hall !== undefined ? { hall: world.source.underground.halls[found.hall].id } : { basement: world.lots[found.lot].source }) });
    return handoff.from && !handoff.samePlace ? travel(scene, handoff.person, [node, 0], `${scene.id}|${handoff.person}`) : [node, 0];
  };
  /**
   * The hook (docs/underground-design.md §4.8): an area's underground comes alive the first moment anyone stands on a node
   * under it (a hall's, or a basement's: the area its building's middle lies in); until then no blast reaches it.
   */
  const awake = new Map();
  const wake = node => {
    if (node == null || W.nodePos(world, node).k >= 0) return;
    // Someone below the street: the ground over every way out of their hall is laid too (a station's stairs are 90 m off).
    const at = W.nodePos(world, node);
    for (const entry of W.hallsAt(world, at.i, at.j)) for (const [x, z] of world.source.underground.halls[entry.hall].up) reach(x, z, 16);
    const built = graphOf(W.nodePos(world, node)), lot = built.lot[node], hall = lot >= W.HALL_LOT ? world.source.underground.halls[lot - W.HALL_LOT] : null;
    const area = hall ? hall.area : lot >= 0 && lot < W.HALL_LOT ? areaAt((world.lots[lot].i0 + world.lots[lot].nx / 2) * 2, (world.lots[lot].j0 + world.lots[lot].nz / 2) * 2) : null;
    if (area && !awake.has(area)) { awake.set(area, moment); notes.underground.active[name(area)] = moment; }
  };
  /**
   * The underground as the page draws it: each hall's plan, depth and height, kind and label, and its pillars (2 m points);
   * what cave-ins left (piles on hall cells, dents in the street: cell, level or depth, metres); and the areas awake.
   */
  const undergroundView = () => {
    const halls = world.source.underground?.halls ?? [], cellOf = key => { const { ci, cj } = W.chunkOf(key); return [ci, cj]; };
    return {
      halls: halls.map(hall => {
        const b = U.boundsOf(hall), pillars = [];
        if (hall.pillars) for (let x = Math.floor(b.x0 / 2) * 2 + 1; x <= b.x1; x += 2) for (let z = Math.floor(b.z0 / 2) * 2 + 1; z <= b.z1; z += 2) if (U.pillarAt(hall, [x, z])) pillars.push([x, z]);
        // A passage's stairs: from the pavement nearest its end (where the world joins them) down to the passage.
        const stairs = hall.kind === 'corridor' ? hall.up.map(([x, z]) => { const [sx, sz] = W.streetNear(world, x, z, 30) ?? [x, z]; return [sx, sz, x, z]; }) : undefined;
        return { id: hall.id, kind: hall.kind, label: hall.label, area: hall.area, depth: hall.depth, height: hall.height, boxes: hall.boxes, bores: hall.bores, pillars, ...(stairs ? { stairs } : {}) };
      }),
      piles: [...world.underDamage.piles].flatMap(([index, cells]) => [...cells].map(([key, height]) => [...cellOf(key), W.levelOf(halls[index].depth), height])),
      dents: [...world.underDamage.dents].map(([key, depth]) => [...cellOf(key), depth]),
      awake: [...awake.keys()],
    };
  };
  /** Walk someone to a node, the way the engine walks a move. */
  const walkTo = (scene, event, person, at, target, seed, label) => {
    const { graph } = graphOf(focusOf(at)), [node, heading] = at, rng = stream(seed);
    if (node === target) return { kind: 'stay' };
    const path = sampleWalk(graph, solve(scene.placeId, `node@${target}@${node}`, [target], 'walk', node), node, heading, rng);
    if (!path) { notes.unreachable++; return { kind: 'stay' }; }
    const last = path.length > 1 ? directionOf(graph.x[path.at(-1)] - graph.x[path.at(-2)], graph.z[path.at(-1)] - graph.z[path.at(-2)]) : heading;
    moves.set(`${scene.id}|${event.id}|${person}`, { person, how: 'walk', spot: label, path, ensemble: [] });
    return { kind: 'move', to: [path.at(-1), last >= 0 ? last : heading] };
  };
  /** Where a live or group node takes people: a live pair apart meets (who came to whom); a group gathers in one box. */
  const meetingOf = async (scene, event, node) => {
    const context = worldScene.get(scene.id)?.context ?? '', posOf = id => { const entry = where.get(id); return entry?.at && entry.place === scene.placeId ? entry.at : null; };
    if (node.kind === 'live') {
      const [a, b] = node.parties, pa = posOf(a), pb = posOf(b);
      if (!a || !b || !pa || !pb) return {};
      const A = W.nodePos(world, pa[0]), B = W.nodePos(world, pb[0]), apart = Math.hypot(A.x - B.x, A.z - B.z);
      if (apart <= TALK && A.k === B.k) return {};
      const options = [`${name(a)} came to ${name(b)}`, `${name(b)} came to ${name(a)}`, 'they met between them'];
      const [came] = await jev.decide(`${context}\n\n${name(a)} and ${name(b)} are ${Math.round(apart)} m apart${A.k !== B.k ? ', on different floors' : ''}, and now talk face to face.`, [{ key: 'came', primitive: 'choice', instructions: `${name(a)} and ${name(b)} talk face to face here. Who came to whom?`, options }]);
      notes.meetings = (notes.meetings ?? 0) + 1;
      const pick = options.indexOf(came?.value);
      if (pick === 0) return { label: `to:${b}`, targets: { [a]: besideNode(scene.placeId, pb[0]) } };
      if (pick === 1) return { label: `to:${a}`, targets: { [b]: besideNode(scene.placeId, pa[0]) } };
      const mid = W.nodeNear(world, graphOf({ x: (A.x + B.x) / 2, z: (A.z + B.z) / 2 }), (A.x + B.x) / 2, (A.z + B.z) / 2, A.k);
      return mid == null ? {} : { label: 'met', targets: { [a]: mid, [b]: besideNode(scene.placeId, mid) } };
    }
    if (node.kind === 'group') {
      // A group talks where most of it already is: on that floor (a slice through the buildings there when it is indoors),
      // round the middle of those on it; a group already together on one floor does not move.
      const members = [...new Set([...node.parties, ...node.listeners])].filter(posOf), at = members.map(id => W.nodePos(world, posOf(id)[0]));
      if (!at.length) return {};
      const floors = at.reduce((count, p) => count.set(p.k, (count.get(p.k) ?? 0) + 1), new Map()), k = [...floors].sort((x, y) => y[1] - x[1])[0][0], on = at.filter(p => p.k === k);
      const mid = { x: on.reduce((sum, p) => sum + p.x, 0) / on.length, z: on.reduce((sum, p) => sum + p.z, 0) / on.length };
      if (at.every(p => p.k === k && Math.hypot(p.x - mid.x, p.z - mid.z) <= TALK)) { notes.groupsTogether = (notes.groupsTogether ?? 0) + 1; return {}; }
      // Underground, the picture is of the choice the group's hall is in; above, a slice of the floor indoors, else the street.
      const down = k < 0 ? (() => { const node = posOf(members[0])[0], built = graphOf(W.nodePos(world, node)), lot = built.lot[node]; return lot >= W.HALL_LOT ? U.intervalsOf(world.source.underground.halls[lot - W.HALL_LOT])[0] : 'shallow'; })() : null;
      const indoors = k > 0 || on.some(p => world.lotAt.has(W.cellKey(p.i, p.j)));
      const picture = mapPicture(world, { x: mid.x, z: mid.z, radius: 48, people: peopleAt(scene.placeId, null, k), ...(down ? { under: down } : indoors ? { floor: k } : {}) });
      const asked = await jev.decide(`${context}\n\n${picture.legend}`, [{ key: 'box', primitive: 'box', instructions: `Where on this ${indoors ? 'floor' : 'map'} do ${node.parties.map(name).join('、')} and the others with them gather to talk together?` }], { images: { map: picture.png } });
      notes.groupBoxes = (notes.groupBoxes ?? 0) + 1;
      const box = asked[0]?.box;
      if (!box) return {};
      const area = picture.at(box), built = graphOf(area), rng = stream(`${scene.id}|${event.id}|group`), targets = {};
      for (const id of members) {
        const target = W.nodeNear(world, built, area.x + (rng() - 0.5) * Math.max(2, area.w), area.z + (rng() - 0.5) * Math.max(2, area.d), k);
        if (target != null) targets[id] = target;
      }
      return { label: 'group', targets };
    }
    return {};
  };
  const dialogueAct = async ({ scene, event, person, at, seed }) => {
    const key = `${scene.id}|${event.id}`;
    if (!meetings.has(key)) meetings.set(key, await meetingOf(scene, event, event.dialogue));
    const plan = meetings.get(key), target = plan.targets?.[person];
    return target == null || !at ? { kind: 'stay' } : walkTo(scene, event, person, at, target, seed, plan.label);
  };
  mover.start = async args => { live(); moment = `${args.scene.id}|start`; if (byIndex.get(args.scene.id) > story) { story = byIndex.get(args.scene.id); applyEarlier(); } const boxed = await firstStart(args); let at = boxed ?? start(args); const free = buried(at); if (free != null) { at = [free, at[1]]; notes.underground.escaped = (notes.underground.escaped ?? 0) + 1; } wake(at?.[0]); if (boxed) begun.set(`${args.scene.id}|${args.handoff.person}`, boxed); where.set(args.handoff.person, { place: args.scene.placeId, at }); return at; };
  // `pace` (seconds): each moment held that long before the next is played, so a live view shows every event.
  const hold = () => new Promise(done => setTimeout(done, options.pace * 1000));
  mover.act = async args => {
    const now = `${args.scene.id}|${args.scene.events.findIndex(entry => entry.id === args.event.id)}`;
    if (now !== moment) { if (options.pace) { live(false, true); await hold(); } else live(); }
    moment = now;
    // Under fallen ground: they get out first, to the nearest open cell of their hall.
    const free = buried(args.at);
    if (free != null) { notes.underground.escaped = (notes.underground.escaped ?? 0) + 1; moves.set(`${args.scene.id}|${args.event.id}|${args.person}`, { person: args.person, how: 'run', spot: 'out from under', path: [args.at[0], free], ensemble: [] }); where.set(args.person, { place: args.scene.placeId, at: [free, args.at[1]] }); return { kind: 'move', to: [free, args.at[1]] }; }
    const outcome = args.event.dialogue && jev ? await dialogueAct(args) : act(args);
    if (outcome.kind === 'move') { where.set(args.person, { place: args.scene.placeId, at: outcome.to }); const end = W.nodePos(world, outcome.to[0]); reach(end.x, end.z, 40); wake(outcome.to[0]); }
    return outcome;
  };
  const detected = JSON.parse(await readFile(`${novelDir}/stage/objects.json`, 'utf8').catch(() => 'null'));
  /**
   * The page's data from the walk (`runs`: each scene's starts and where people were after each event), or, with `upto` (a
   * moment, `<scene>|<event>`), the line as far as that moment, for a live view while the walk goes on.
   */
  const assemble = (runs, upto = null) => {
    const [uptoScene, uptoEvent] = upto ? upto.split('|') : [];
    const shown = !upto ? chosen : chosen.filter(scene => byIndex.get(scene.id) <= byIndex.get(uptoScene) && runs[scene.id]).map(scene => (scene.id === uptoScene ? { ...scene, events: scene.events.slice(0, uptoEvent === 'start' ? 0 : Number(uptoEvent) + 1) } : scene));
    notes.solves = fields.size;
    const people = [...new Set(chosen.flatMap(scene => scene.cast))], color = new Map(people.map((id, index) => [id, PALETTE[index % PALETTE.length]]));
    const clean = text => (text ?? '').split('（原文：')[0].trim();
    // Things the scenes put in their places (novel stage objects): a named building takes a generic lot and lights up when first
    // mentioned; anything else stands in the box where Jev's two views agree (placeThings above).
    const ROLE_FOR = { hospital: 'hospital', skyscraper: 'office', office: 'office', market: 'shop', station: 'station', school: 'office', home: 'shop' };
    const lotNames = new Map(), placedObjects = new Map();
    for (const scene of chosen) {
      const group = groups.get(scene.placeId), found = detected?.scenes?.[scene.id]?.objects ?? [], run = runs[scene.id];
      for (const object of found) {
        const eventIndex = Math.max(0, scene.events.findIndex(event => event.id === object.event));
        // A room is inside a building: it never takes a lot of its own.
        if (object.room) continue;
        // With building EM: the building the mention is (its answer), one lot for it in the whole book — the kept lot of its
        // places, else one generic lot near where it is first mentioned; never one per place, never a box.
        if (object.kind === 'building' && buildingsEM) {
          const answer = buildingsEM.answers.find(entry => entry.scene === scene.id && entry.name === object.name), member = answer ? memberOf(answer) : null;
          if (!member) continue;
          const identity = identityBy.get(member) ?? { id: member, label: object.name, places: [] };
          if (lotNames.has(identity.id)) continue;
          const kept = identity.places.map(id => keptOf.get(id)?.kept ?? id).find(id => world.lots.some(lot => lot.place === id));
          if (kept) { lotNames.set(identity.id, { place: kept, lot: world.lots.findIndex(lot => lot.place === kept), name: identity.label, scene: scene.id, event: eventIndex, model: object.match.id }); continue; }
          const { anchor } = group, gap = lot => Math.hypot((lot.i0 + lot.nx / 2) * 2 - anchor.x, (lot.j0 + lot.nz / 2) * 2 - anchor.z);
          const near = world.lots.map((lot, index) => ({ lot, index, gap: gap(lot) })).filter(entry => entry.gap <= 80 && !entry.lot.label && !entry.lot.place && ![...lotNames.values()].some(other => other.lot === entry.index)).sort((a, b) => a.gap - b.gap);
          const index = (near.find(entry => entry.lot.role === ROLE_FOR[object.match.id]) ?? near[0])?.index ?? -1;
          if (index >= 0) lotNames.set(identity.id, { place: scene.placeId, lot: index, name: identity.label, scene: scene.id, event: eventIndex, model: object.match.id });
          continue;
        }
        if (object.kind === 'building' && object.match.kind === 'building') {
          if (!newBuildingHere(object.name, group.label, [...groups.values()].map(other => other.label))) continue;
          const key = `${scene.placeId}|${object.name}`;
          if (lotNames.has(key)) continue;
          // The nearest free lot of the world round the place's anchor (within 80 m), of the building's role if there is one.
          const { anchor } = group, gap = lot => Math.hypot((lot.i0 + lot.nx / 2) * 2 - anchor.x, (lot.j0 + lot.nz / 2) * 2 - anchor.z);
          const near = world.lots.map((lot, index) => ({ lot, index, gap: gap(lot) })).filter(entry => entry.gap <= 80 && !entry.lot.label && !entry.lot.place && ![...lotNames.values()].some(other => other.lot === entry.index)).sort((a, b) => a.gap - b.gap);
          const index = (near.find(entry => entry.lot.role === ROLE_FOR[object.match.id]) ?? near[0])?.index ?? -1;
          if (index >= 0) lotNames.set(key, { place: scene.placeId, lot: index, name: object.name, scene: scene.id, event: eventIndex, model: object.match.id });
          continue;
        }
      }
    }
    notes.detected = { buildings: lotNames.size, objects: [...placedObjects.values()].reduce((sum, list) => sum + list.length, 0) };
    const worn = new Set(entities.filter(entity => entity.model && entity.placed.length).map(entity => entity.model));
    // A deep facility is dressed in the modern kit's model of its kind (kk-lab, kk-military, kk-quantum).
    for (const hall of world.source.underground?.halls ?? []) if (['lab', 'military', 'quantum'].includes(hall.kind)) worn.add(`kk-${hall.kind}`);
    // One world: a lot is named whichever place named it.
    const named = (placeId, index) => [...lotNames.values()].find(entry => entry.lot === index);
    const shellOf = (placeId, lot, index) => { if (lot.era === 'ancient' && !named(placeId, index)) { const model = ANCIENT_SHELLS[Math.floor(stream('shell', placeId, index)() * ANCIENT_SHELLS.length)]; worn.add(model); return model; } const role = named(placeId, index) ? (ROLE_FOR[named(placeId, index).model] ?? lot.role) : lot.role, choices = SHELLS[role === 'office' && (lot.floors >= 7 || named(placeId, index)?.model === 'skyscraper') ? 'tall' : role] ?? SHELLS.office, model = choices[Math.floor(stream('shell', placeId, index)() * choices.length)]; worn.add(model); return model; };
    const shells = world.lots.map((lot, index) => shellOf('world', lot, index));
    // The world as the page draws it: one grid over everything explored (oi, oj: the offset of world cell 0, 0 on it), its nodes
    // as that grid's dense cells, each lot and chunk with the moment it was first reached.
    const bounds = W.worldBounds(world), NX = bounds.i1 - bounds.i0, NZ = bounds.j1 - bounds.j0, oi = -bounds.i0, oj = -bounds.j0;
    const K = Math.max(1, ...world.lots.map(lot => lot.floors + 1), ...[...shared.things.values()].map(thing => thing.top + 1));
    // Levels below the street are negative: they are packed from `ok` levels down, so every node is a non-negative number.
    const ok = W.UNDER_LEVELS, dense = id => { if (id === null || id === undefined) return id; const { i, j, k } = W.cellOf(world, id); return ((k + ok) * NZ + (j + oj)) * NX + (i + oi); };
    const denseMove = move => ({ ...move, path: move.path.map(dense), ensemble: move.ensemble.map(path => path.map(dense)) });
    const worldLots = world.lots.map((lot, index) => ({ model: shells[index], label: lot.label, detected: named('world', index) ? { name: named('world', index).name, scene: named('world', index).scene, event: named('world', index).event } : null, role: named('world', index) && ROLE_FOR[named('world', index).model] === 'hospital' ? 'hospital' : lot.role,
      i0: lot.i0, j0: lot.j0, nx: lot.nx, nz: lot.nz, floors: lot.floors, height: lot.height, born: lot.born, source: lot.source, manifold: lot.manifold, era: lot.era, place: lot.place, cells: [...lot.skeleton.cells].join(''), rooms: lot.rooms.map(room => [room.floor, room.i0, room.j0, room.i1, room.j1]) }));
    notes.world = { chunks: world.chunks.size, lots: world.lots.length, nodes: world.cells.length / 3, grid: [NX, NZ, K] };
    return {
      models: Object.fromEntries([...worn].map(model => [model, library.models[model]])), modelSource: library.source,
      things: entities.filter(entity => entity.placed.length).map(entity => ({ id: entity.id, name: entity.name, aliases: entity.aliases, model: entity.model, theme: entity.theme ?? null, switched: entity.switched, shape: entity.shape, size: entity.size, height: entity.height, placed: entity.placed,
        struct: entity.struct ? { nx: entity.struct.nx, nz: entity.struct.nz, floors: entity.struct.floors, cells: [...entity.struct.cells].join('') } : null })),
      title: options.title ?? `${name(chosen[0].placeId)} …`, exportedAt: new Date().toISOString(), T: Math.round(T * 1000) / 1000, kappa, lambda, notes,
      migrations: migrations.map(migration => { const route = routes.get(`${migration.scene}|${migration.person}`); return { ...migration, route: route ? { ...route, exit: route.exit?.map(dense) ?? null, entry: route.entry?.map(dense) ?? null } : null }; }),
      macro, landscapes: landscapes.map(({ source, ...entry }) => ({ ...entry, ids: source.buildings.map(b => b.id) })), travel: { T: Math.round(macroT * 1000) / 1000, kappa: macroKappa, cell: lattice.cell, crossing: { mu: 24, nu: 3 } },
      people: Object.fromEntries(people.map(id => [id, { name: name(id), color: color.get(id) }])),
      // Every staged place is the one world (its lots shared), with its own name, path, kind and anchor.
      world: { NX, NZ, K, oi, oj, ok, lots: worldLots, earlier, underground: undergroundView(),
        ruins: pending.filter(entry => entry.story < Math.max(...chosen.map(scene => byIndex.get(scene.id)))).map(entry => ({ building: entry.building, strand: entry.strand.id, scene: entry.scene, label: entry.label, story: entry.story })), chunks: [...world.chunks].map(([key, born]) => { const { ci, cj } = W.chunkOf(key); return [ci, cj, born, W.chunkGround(world, key)]; }), clutter: [...world.clutter].flatMap(key => [Math.floor(key / 65536) - 32768, key % 65536 - 32768]),
        // Landscape buildings that never stood as lots (under a staged building, or no room on the grid), and when that was settled.
        dropped: [...world.dropped] },
      places: Object.fromEntries([...groups].map(([id, { label, path, scale, kind, anchor }]) => [id, { label, path, scale, kind, world: true, theme: anchor.era, anchor: { x: anchor.x, z: anchor.z, own: anchor.own }, NX, NZ, K, oi, oj, ok, lots: worldLots }])),
      scenes: shown.map(scene => {
        const run = runs[scene.id], label = inputs.data.scenes.find(entry => entry.id === scene.id)?.label, kind = staged.get(scene.id)?.kind ?? null;
        // The spots the movement questions offer for this building, each at a node of the world near a point (the one nearest
        // the middle of the nodes the spot covers): where the live simulation pins them on its pictures. The scene's at its
        // anchor; each event's round where its people stand as it begins.
        const pins = focus => kind ? navGrid(kind).spots.flatMap(spot => {
          const nodes = spotsFor(scene.placeId, focus)[spotKey(scene.placeId, spot.id, focus)] ?? [];
          if (!nodes.length) return [];
          const at = nodes.map(id => W.nodePos(world, id)), mx = at.reduce((sum, p) => sum + p.x, 0) / at.length, mz = at.reduce((sum, p) => sum + p.z, 0) / at.length;
          const best = at.reduce((b, p, n) => (Math.hypot(p.x - mx, p.z - mz) < Math.hypot(at[b].x - mx, at[b].z - mz) ? n : b), 0);
          return [{ id: spot.id, label: spot.label, hint: spot.hint, node: dense(nodes[best]) }];
        }) : [];
        const standing = index => Object.values(index ? run.events[index - 1]?.at ?? {} : run.starts).filter(Boolean).map(at => W.nodePos(world, at[0]));
        const middle = points => (points.length ? { x: points.reduce((sum, p) => sum + p.x, 0) / points.length, z: points.reduce((sum, p) => sum + p.z, 0) / points.length } : undefined);
        return { id: scene.id, index: byIndex.get(scene.id), place: scene.placeId, label: label && label !== scene.id ? label : null, kind, cast: scene.cast, spots: pins(),
          starts: Object.fromEntries(Object.entries(run.starts).map(([person, at]) => [person, at ? dense(at[0]) : null])),
          from: Object.fromEntries((timeline.handoffs.get(scene.id) ?? []).map(handoff => [handoff.person, handoff.from ? (handoff.samePlace ? 'stays' : 'arrives') : 'enters'])),
          objects: placedObjects.get(scene.id) ?? [],
          trace: traces.get(`${scene.id}|start`) ?? null,
          events: scene.events.map((event, index) => ({ id: event.id, actors: event.actors ?? [], text: clean(event.text), spots: pins(middle(standing(index))), hit: hits.get(event.id) ?? null, hitThings: hitThings.get(event.id) ?? null, moves: scene.cast.map(person => moves.get(`${scene.id}|${event.id}|${person}`)).filter(Boolean).map(denseMove), trace: traces.get(`${scene.id}|${index}`) ?? null })) };
      }),
    };
  };
  const { scenes: runs } = await walkTimeline(timeline, chosen, mover, { concurrency: 1, version: WALK_SEED });
  const data = assemble(runs);
  if (options.live) options.live(snapshot(true), data);
  return data;
}

/**
 * A strand's simulation as a record other sessions and tools can read without the player: the buildings (places, lots,
 * skeletons), the things and where each placement stands, every move as points in the place's metres, and every hit with
 * its sphere, energy and the units it broke or brought down. Derived view data, never canon: it lives with the book under
 * `stage/simulation/` (docs/stage-simulation-records.md).
 */
export function simulationRecord(data, strand) {
  const CELL = 2, FLOOR = 3, round = value => Math.round(value * 100) / 100;
  // A node as a point: on the world's grid, in world metres (oi, oj: where world cell 0, 0 sits on the grid).
  const point = (place, node) => { const i = node % place.NX - (place.oi ?? 0), j = Math.floor(node / place.NX) % place.NZ - (place.oj ?? 0), k = Math.floor(node / (place.NX * place.NZ)) - (place.ok ?? 0); return [round((i + 0.5) * CELL), k * FLOOR, round((j + 0.5) * CELL)]; };
  const part = part => ({ lot: part.lot, energy: part.energy ?? null, blasted: part.blasted ?? null, fallen: part.fallen ?? null, destroyedCells: part.destroyed, fellCells: part.fell ?? [], cutOffCells: part.cutOff, cutOffRooms: part.cutRooms });
  return {
    kind: 'stage-simulation', version: 2, exportedAt: data.exportedAt, strand: { ...strand, title: data.title },
    units: { metres: { cell: CELL, floor: FLOOR }, kinds: { 1: 'corridor', 2: 'stair', 3: 'wall', 4: 'roof' }, tuple: '[kind, i, j, k] on the lot\'s grid; fallen ones add where they came to rest (metres up)' },
    engine: { T: data.T, kappa: data.kappa, lambda: data.lambda, notes: data.notes, travel: data.travel },
    people: data.people,
    // The world once (every lot explored, in world cells, with the moment it was first reached); each place lists the lots round its anchor.
    world: data.world ? { grid: { NX: data.world.NX, NZ: data.world.NZ, floors: data.world.K, oi: data.world.oi, oj: data.world.oj, ok: data.world.ok }, chunks: data.world.chunks.map(([ci, cj, born]) => [ci, cj, born]),
      lots: data.world.lots.map(lot => ({ label: lot.label, detected: lot.detected, role: lot.role, model: lot.model, source: lot.source, manifold: lot.manifold, footprint: { i0: lot.i0, j0: lot.j0, nx: lot.nx, nz: lot.nz }, floors: lot.floors, height: lot.height, born: lot.born, place: lot.place, skeleton: lot.cells, rooms: lot.rooms })),
      earlier: data.world.earlier.map(({ lot, strand, run, scene, story }) => ({ lot, strand, run, scene, story })) } : null,
    buildings: Object.fromEntries(Object.entries(data.places).map(([id, place]) => [id, { label: place.label, path: place.path, scale: place.scale, kind: place.kind, anchor: place.anchor,
      lots: (data.world?.lots ?? []).flatMap((lot, index) => Math.hypot((lot.i0 + lot.nx / 2) * CELL - place.anchor.x, (lot.j0 + lot.nz / 2) * CELL - place.anchor.z) <= 80 ? [index] : []) }])),
    things: data.things.map(thing => ({ id: thing.id, name: thing.name, aliases: thing.aliases, model: thing.model, shape: thing.shape, size: thing.size, placements: thing.placed })),
    migrations: data.migrations, macro: data.macro,
    // Each open place's landscape by type, and how many buildings fill it: the fill itself is regenerated from the landscape, never kept.
    landscapes: (data.landscapes ?? []).map(entry => ({ place: entry.place, types: entry.types, buildings: entry.buildings.length })),
    scenes: data.scenes.map(scene => {
      const place = data.places[scene.place];
      return { id: scene.id, index: scene.index ?? null, place: scene.place, label: scene.label, starts: Object.fromEntries(Object.entries(scene.starts).map(([person, node]) => [person, node == null ? null : point(place, node)])),
        events: scene.events.map((event, index) => ({ index, text: event.text, moves: event.moves.map(move => ({ person: move.person, how: move.how, spot: move.spot, ...(move.with ? { with: move.with } : {}), path: move.path.map(node => point(place, node)) })),
          hit: event.hit && { sphere: event.hit.sphere ?? null, strength: event.hit.strength, parts: [event.hit, ...(event.hit.more ?? [])].filter(entry => entry.lot >= 0).map(part), under: event.hit.under ?? [] }, hitThings: event.hitThings })) };
    }),
  };
}

/**
 * The world engine's version: one number, raised whenever a change to the engine changes what a run comes out as (its
 * world, its walk, its record format), and kept with every run (the record's `run`, the strand index, the live state and
 * the growth log), so each run says which engine made it. A version pushed as stable is tagged world-engine-v<N> in git.
 */
export const ENGINE_VERSION = 3;
/** The Jev model the world-first engine asks (births, meetings, gatherings): one that answers box questions. */
export const WORLD_MODEL = 'jev-1.14.0';
/** The engine's name in run records. */
export const ENGINE = `world-engine-${ENGINE_VERSION}`;
/** What the walk's seeds come from (the scene keys under it): kept while the walk itself is unchanged, so its runs reproduce. */
const WALK_SEED = 'strand-demo-4';
/** What a run is made from: the book's reviewed ontology and the stage's answers (buildings, objects, movement, Jev's placements and impacts, the live simulation's decisions). */
const SIMULATION_INPUTS = ['ontology/entities.jsonl', 'ontology/relations.jsonl', 'ontology/scenes.jsonl', 'ontology/events.jsonl', 'stage/architecture.json', 'stage/scale.json', 'stage/landscape.json', 'stage/objects.json', 'stage/movement.json', 'stage/thing-boxes.json', 'stage/impacts.json', 'stage/sim-decisions.json'];
export async function simulationInputs(novelDir) {
  const hash = createHash('sha256');
  for (const name of SIMULATION_INPUTS) hash.update(`${name}\n${await readFile(`${novelDir}/${name}`, 'utf8').catch(() => '')}\n`);
  return hash.digest('hex').slice(0, 16);
}

/**
 * A strand's record kept as a run of its own (stage/simulation/runs/<strand>/<run>.json), never overwritten: each run says
 * what it was made from (`inputs`), the engine and when; the same outcome again is the same run. A strand's accepted run (its
 * first, or this one with `accept`) is the one readers take: copied to <strand>.json, where they look, and named in
 * index.json, which lists every run. A strand recorded before runs existed keeps that record as its first run. With `page`
 * (the player's data for the run), it is kept beside the record as <run>.page.json, so a host can play the run.
 * Derived view data, never canon (docs/stage-simulation-records.md).
 */
export async function keepRun(folder, strand, record, { inputs, accept = false, page = null }) {
  const index = JSON.parse(await readFile(`${folder}/index.json`, 'utf8').catch(() => '{"strands":{}}'));
  const before = index.strands[strand.id] ?? null, runs = before?.runs ?? [];
  const contentOf = value => createHash('sha256').update(JSON.stringify({ ...value, exportedAt: null, run: null })).digest('hex').slice(0, 12);
  const entryOf = (value, id, extra) => ({ id, file: `runs/${strand.id}/${id}.json`, exportedAt: value.exportedAt, content: contentOf(value), scenes: value.scenes.length, hits: value.scenes.reduce((n, scene) => n + scene.events.filter(event => event.hit).length, 0), things: value.things.length, ...extra });
  const write = async (entry, value) => { await mkdir(`${folder}/runs/${strand.id}`, { recursive: true }); await writeFile(`${folder}/${entry.file}`, JSON.stringify({ ...value, run: { id: entry.id, inputs: entry.inputs, engine: entry.engine, engineVersion: entry.engineVersion ?? null } }, null, 1), { mode: 0o644, flag: 'wx' }); };
  // Before runs: the strand's one record becomes its first run, accepted.
  let accepted = before?.accepted ?? null;
  if (before && !before.runs) {
    const legacy = JSON.parse(await readFile(`${folder}/${before.file}`, 'utf8').catch(() => 'null'));
    if (legacy?.scenes) { const entry = entryOf(legacy, `${String(legacy.exportedAt).replace(/\D/g, '').slice(0, 14)}-${contentOf(legacy).slice(0, 6)}`, { inputs: null, engine: null }); await write(entry, legacy); runs.push(entry); accepted = entry.id; }
  }
  const content = contentOf(record);
  let run = runs.find(entry => entry.content === content);
  const fresh = !run;
  if (!run) { run = entryOf(record, `${record.exportedAt.replace(/\D/g, '').slice(0, 14)}-${content.slice(0, 6)}`, { inputs, engine: ENGINE, engineVersion: ENGINE_VERSION }); await write(run, record); runs.push(run); }
  if (page && !run.page) { run.page = `runs/${strand.id}/${run.id}.page.json`; await writeFile(`${folder}/${run.page}`, JSON.stringify(page), { mode: 0o644 }); }
  if (accept || !accepted) accepted = run.id;
  const chosen = runs.find(entry => entry.id === accepted);
  await writeFile(`${folder}/${strand.id}.json`, await readFile(`${folder}/${chosen.file}`, 'utf8'), { mode: 0o644 });
  index.version = 2;
  index.strands[strand.id] = { file: `${strand.id}.json`, from: strand.from, to: strand.to, fork: strand.fork ?? null, title: record.strand.title, accepted, exportedAt: chosen.exportedAt, scenes: chosen.scenes, hits: chosen.hits, things: chosen.things, runs };
  await writeFile(`${folder}/index.json`, JSON.stringify(index, null, 1), { mode: 0o644 });
  const damage = await keepWorldDamage(folder);
  return { strand: strand.id, run: run.id, fresh, accepted, world: damage.version, ...(accepted !== run.id ? { note: `Kept as a run; ${accepted} stays accepted (--accept to take this one)` } : {}) };
}

/**
 * The world's damage as the story lines leave it (stage/simulation/world.json): every building each line's accepted run broke,
 * by the building's id in its landscape (and that landscape's fingerprint), with the scene's story order and what broke (units
 * blasted and fallen, skeleton cells destroyed). A run of any other line applies these, in story order, to the same building
 * when it stands there again (the engine), so a later scene finds it broken. Rebuilt from the accepted runs whenever a run is
 * kept; each version it replaces is kept in world-history/. Derived view data from versioned runs, never canon.
 */
export async function keepWorldDamage(folder) {
  const index = JSON.parse(await readFile(`${folder}/index.json`, 'utf8').catch(() => '{"strands":{}}')), entries = [], runs = [];
  for (const [id, line] of Object.entries(index.strands)) {
    const run = line.runs?.find(entry => entry.id === line.accepted);
    const record = run && JSON.parse(await readFile(`${folder}/${run.file}`, 'utf8').catch(() => 'null'));
    // A run of an earlier engine (fixed grids, no world) leaves nothing on the world.
    if (!record?.world) continue;
    runs.push({ strand: id, run: run.id });
    for (const scene of record.scenes) for (const event of scene.events) for (const part of event.hit?.parts ?? []) {
      const lot = record.world.lots[part.lot];
      if (!lot?.source) continue;
      entries.push({ strand: { id, from: record.strand.from, to: record.strand.to, fork: record.strand.fork ?? null }, run: run.id, scene: scene.id, label: scene.label ?? null, event: event.index, story: scene.index,
        building: lot.source, manifold: lot.manifold ?? '', sphere: event.hit.sphere ?? null, energy: part.energy ?? null, blasted: part.blasted ?? [], fallen: part.fallen ?? [], destroyed: part.destroyedCells ?? [], fell: part.fellCells ?? [] });
    }
  }
  const before = JSON.parse(await readFile(`${folder}/world.json`, 'utf8').catch(() => 'null'));
  if (before && JSON.stringify([before.runs, before.entries]) === JSON.stringify([runs, entries])) return before;
  if (before) { await mkdir(`${folder}/world-history`, { recursive: true }); await writeFile(`${folder}/world-history/${before.version}.json`, JSON.stringify(before, null, 1), { mode: 0o644, flag: 'wx' }).catch(() => {}); }
  const world = { kind: 'stage-world-damage', version: (before?.version ?? 0) + 1, updatedAt: new Date().toISOString(), runs, entries };
  await writeFile(`${folder}/world.json`, JSON.stringify(world, null, 1), { mode: 0o644 });
  return world;
}

/**
 * One strand through the engine: the scenes from `from` to `to` on the fork of `fork` (a scene id), walked and simulated;
 * returns the player's data (what strandDemo makes). The one entry point `novel sim run` uses, so the engine behind it can
 * change (city filling, say) without the command changing.
 */
export async function runStrand(novelDir, { from, to, fork = null, title } = {}, { until = null, live = null, pace = 0, watch = null } = {}) {
  // `live`: called with the world as it stands at each moment played (at most every 0.3 s) and at the end, for the live view.
  return strandDemo(novelDir, { from, to, ...(fork ? { fork } : {}), ...(title ? { title } : {}), ...(until ? { until } : {}), ...(live ? { live } : {}), ...(pace ? { pace } : {}), ...(watch ? { watch } : {}) });
}

/** A strand's page data with the world's lots once (data.world.lots): each place's copy of them is restored by the page. */
export const compactData = value => value?.world?.lots ? { ...value, places: Object.fromEntries(Object.entries(value.places).map(([id, place]) => [id, place.world ? { ...place, lots: undefined } : place])) } : value;

/** The player page with the strand inlined. */
export function inlineStrand(template, data, { name = 'One Strand', fragment = false, vendor = false } = {}) {
  // `vendor`: three.js served beside the page (vendor/), so the page needs no CDN.
  if (vendor) template = template.replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './vendor/three.module.js').replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './vendor/addons/');
  data = data.strands ? { ...data, strands: data.strands.map(strand => ({ ...strand, data: compactData(strand.data) })) } : compactData(data);
  let page = template.replace('<title>One Strand · Holo Stage</title>', () => `<title>${name}</title>`).replace('<script type="application/json" id="strand-data"></script>', () => `<script type="application/json" id="strand-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
  // A host that adds its own document wrapper (a claude.ai page) takes the title, import map, styles and body.
  if (fragment) page = [page.match(/<title>[^<]*<\/title>/)[0], '<meta name="claude:viewport-fit-sides" content="cover">', page.match(/<script type="importmap">[\s\S]*?<\/script>/)[0], page.match(/<style>[\s\S]*?<\/style>/)[0], page.match(/<body>([\s\S]*)<\/body>/)[1]].join('\n');
  if (/\/view\/[A-Za-z0-9_-]{43}\//.test(page) || page.includes('（原文：')) throw new Error('Private paths or source quotes ended up in the page');
  return page;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' }, fork: { type: 'string' }, title: { type: 'string' }, name: { type: 'string' }, fragment: { type: 'boolean' }, vendor: { type: 'boolean' }, set: { type: 'string' }, records: { type: 'boolean' }, accept: { type: 'boolean' } } });
  const usage = 'Usage: node playground/export-strand-demo.mjs <novel-dir> <out.html> --from <scene-id> --to <scene-id> [--fork <scene-id>] [--title text] [--name text] [--fragment] [--vendor]\n       node playground/export-strand-demo.mjs --set <strands.json> <out.html> [--name text] [--fragment] [--vendor] [--records [--accept]]   (strands.json: [{ id, label, name, novel, from, to, fork, title }], one page with a strand picker)';
  const template = await readFile(`${repository}/playground/strand-demo.html`, 'utf8'), started = Date.now();
  // One page per strand, or one page carrying a set of strands to pick from.
  const entries = values.set ? JSON.parse(await readFile(values.set, 'utf8')) : [{ ...values, novel: positionals[0] }], out = values.set ? positionals[0] : positionals[1];
  if (!out || entries.some(entry => !entry.novel || !entry.from || !entry.to) || (values.set && entries.some(entry => !/^[A-Za-z0-9_-]+$/.test(entry.id ?? '') || !entry.label))) throw new Error(usage);
  const strands = [];
  for (const entry of entries) strands.push({ id: entry.id, label: entry.label, name: entry.name, data: await strandDemo(entry.novel.replace(/^~(?=\/)/, process.env.HOME), entry) });
  const page = inlineStrand(template, values.set ? { strands } : strands[0].data, { name: values.name, fragment: values.fragment, vendor: values.vendor });
  await writeFile(out, page, { mode: 0o644 });
  // --records: each strand's simulation kept with its book as a versioned run (keepRun); --accept makes this export's run the accepted one.
  const kept = [];
  if (values.records) for (const [n, strand] of strands.entries()) {
    const entry = entries[n], novel = entry.novel.replace(/^~(?=\/)/, process.env.HOME), folder = `${novel}/stage/simulation`, id = entry.id ?? `${entry.from}-${entry.to}`;
    await mkdir(folder, { recursive: true });
    const meta = { id, from: entry.from, to: entry.to, fork: entry.fork ?? null };
    kept.push(await keepRun(folder, meta, simulationRecord(strand.data, meta), { inputs: await simulationInputs(novel), accept: values.accept }));
  }
  const summary = data => ({ scenes: data.scenes.length, events: data.scenes.reduce((n, s) => n + s.events.length, 0), ...data.notes, T: data.T, places: Object.values(data.places).map(p => ({ label: p.label, kind: p.kind })), world: data.world ? { chunks: data.world.chunks.length, lots: data.world.lots.length, grid: [data.world.NX, data.world.NZ, data.world.K] } : null });
  console.log(JSON.stringify({ out, bytes: Buffer.byteLength(page), ...(values.set ? { strands: strands.map(strand => ({ id: strand.id, ...summary(strand.data) })) } : summary(strands[0].data)), ...(kept.length ? { runs: kept } : {}), seconds: (Date.now() - started) / 1000 }));
}
