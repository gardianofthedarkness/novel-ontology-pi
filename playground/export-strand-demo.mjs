// One timeline strand as a continuous, shareable page: its places built from the place tree (a district or
// street of skeleton buildings: corridors, stair cores, box rooms on every floor; clutter drawn by percolation
// conditioned on access; fights damaging buildings in story order), its people
// walked scene by scene with positions handed along their world lines (stage environment), and every move
// sampled from the path integral (an exact h-transform draw, plus a small ensemble to show the spread).
// Where each move ends comes from Jev's spot answers in the book's movement report. The page carries scene
// and event summaries, names and places; no quotes or source text.
//   npm run build && node playground/export-strand-demo.mjs <novel-dir> <out.html> --from <scene-id> --to <scene-id> [--fork <scene-id>] [--title text]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = path => import(pathToFileURL(`${repository}/${path}`));
const PALETTE = ['#7ce6ff', '#ff8fb1', '#ffd36e', '#9dff8a', '#c59bff', '#ff9d5c', '#5cf2c8', '#f2f2f2', '#8fb6ff', '#e0ff6e'];
/** The artistic models (Kenney CC0 kits, baked in apps/playground) a building of each role may wear; one is drawn per lot at random. */
const SHELLS = { office: ['tower-a', 'tower-b', 'tower-d', 'tower-e', 'tower-f', 'tower-g', 'tower-h', 'tower-i', 'tower-j', 'tower-l', 'tower-m', 'office-c', 'office-h', 'block-wide-a', 'block-wide-b'], tall: ['skyscraper-a', 'skyscraper-b', 'skyscraper-e', 'tower-c', 'tower-k'], shop: ['office-c', 'block-wide-a', 'market'], hospital: ['office-k'], station: ['block-wide-b'] };
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
const ROLE_OF = { hospital: 'hospital', station: 'station', office: 'office', skyscraper: 'office', school: 'office', home: 'shop', market: 'shop' };
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
  const { composePlace, placeGraph, placeSpot, nodePosition, degrade, semanticAxis, cellAt, cutOffOf } = await load('dist/apps/playground/src/data/skeletonPlace.js');
  const { structureOf, intact, blast, settle, skeletonStanding, unitAt } = await load('dist/apps/playground/src/data/structure.js');
  const { placeTreeCircles } = await load('dist/apps/playground/src/data/timePlace.js');
  const { newBuildingHere } = await load('dist/src/digger/stage/objects.js');
  const { skeletonStream: stream, generateSkeleton, SKELETON_CELL } = await load('dist/apps/playground/src/data/skeleton.js');
  const { solveWalk, sampleWalk, temperatureBound, directionOf } = await load('dist/apps/playground/src/data/pathIntegral.js');
  const inputs = await stageInputs(novelDir), answers = await latestStrandAnswers(novelDir), strands = storyStrands(inputs.data, answers ?? {});
  const staged = new Map(inputs.movementScenes.map(scene => [scene.id, scene])), byIndex = new Map(inputs.data.scenes.map(scene => [scene.id, scene.index]));
  const all = inputs.data.scenes.map(scene => { const stage = staged.get(scene.id); return { id: scene.id, index: scene.index, placeId: stage?.placeId ?? scene.placeIds[0] ?? null, flashback: scene.flashback, cast: stage?.cast ?? answers?.presence.get(scene.id) ?? scene.characterIds, events: stage?.events }; });
  const fork = options.fork ? forkTimeline(all, strands).forkOf : null;
  const chosen = all.filter(scene => staged.has(scene.id) && scene.events?.length && byIndex.get(scene.id) >= byIndex.get(options.from) && byIndex.get(scene.id) <= byIndex.get(options.to) && (!fork || fork.get(scene.id) === fork.get(options.fork)));
  const timeline = forkTimeline(chosen, strands);
  const places = new Map(inputs.data.places.map(place => [place.id, place])), name = id => inputs.names[id] ?? id;

  // Each place a group of skeleton buildings from the place tree; its standing cells change as fights damage it.
  const groups = new Map();
  for (const placeId of new Set(chosen.map(scene => scene.placeId))) {
    const place = places.get(placeId), label = name(placeId);
    const members = inputs.data.places.filter(child => child.parentId === placeId && ROLE_OF[inputs.architecture?.places[child.id]?.kind]).map(child => ({ label: name(child.id), role: ROLE_OF[inputs.architecture.places[child.id].kind] }));
    const seed = [...placeId].reduce((hash, char) => (Math.imul(hash, 31) + char.charCodeAt(0)) >>> 0, 7);
    // A place that is itself a building (the architecture pick says so) is a site: that building, named, on the widest lot.
    const own = inputs.architecture?.places[placeId]?.kind, site = ['skyscraper', 'office', 'home', 'hospital', 'school', 'station', 'church', 'market', 'castle'].includes(own);
    const layout = composePlace({ id: placeId, kind: site ? 'site' : /[街路巷道]$/.test(label) ? 'street' : 'district', seed, members: site ? [{ label, role: ROLE_OF[own] ?? 'office', floors: own === 'skyscraper' ? [10, 14] : [5, 7] }, ...members] : members });
    groups.set(placeId, { label, path: (place?.path ?? [placeId]).map(name), layout, things: new Map(), standing: layout.lots.map(lot => lot.skeleton.cells.map(value => (value ? 1 : 0))), structures: [], units: [], version: 0, built: null });
  }
  const graphOf = placeId => { const group = groups.get(placeId); if (!group.built || group.built.version !== group.version) group.built = { version: group.version, ...placeGraph(group.layout, group.standing, [...group.things.values()]) }; return group.built; };
  const T = 0.6 * temperatureBound({ step: 2, kappa: 1, lambda: 8, floorHeight: 3, arcCost: 7 }), kappa = 1, lambda = 8;
  const fields = new Map(), solve = (placeId, key, targets, how) => {
    const group = groups.get(placeId), cacheKey = `${placeId}|${group.version}|${key}|${classOf(how)}`;
    if (!fields.has(cacheKey)) fields.set(cacheKey, solveWalk(graphOf(placeId).graph, targets, { T, kappa, lambda, factors: FACTORS[classOf(how)] }));
    return fields.get(cacheKey);
  };
  const pick = (list, rng) => list[Math.floor(rng() * list.length)];
  const report = inputs.movement?.scenes ?? {}, moves = new Map(), hits = new Map(), hitThings = new Map(), struck = new Set(), notes = { unreachable: 0, sampled: 0, teleports: 0, solves: 0, hits: 0, destroyed: 0 };
  const top = distribution => Object.entries(distribution ?? {}).sort((a, b) => b[1] - a[1])[0]?.[0];
  /** A spot as Jev named it, in this place: districts name streets and sides; buildings name floors, the roof and the street. */
  const spotKey = (placeId, spot) => { const group = groups.get(placeId); return placeSpot(group.layout, group.label, graphOf(placeId).spots, spot); };
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
  const mentions = chosen.flatMap(scene => (found?.scenes?.[scene.id]?.objects ?? []).filter(object => !(object.kind === 'building' && object.match.kind === 'building')).map(object => ({ scene: scene.id, event: Math.max(0, scene.events.findIndex(entry => entry.id === object.event)), object })));
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
    const picked = twoView?.models?.[label], model = picked?.kind === 'model' && library.models[picked.id] ? picked.id : null;
    const matched = lead.match.id === 'sphere' ? 'oval' : lead.match.id, size = Math.min(24, Math.max(4, ...own.map(entry => entry.object.size))), shape = picked?.kind === 'shape' && SHAPES[picked.id] ? picked.id : lead.match.kind === 'shape' && SHAPES[matched] ? matched : 'box';
    const height = shape === 'diamond' ? size : shape === 'oval' ? size * 0.55 : Math.max(1.2, size * 0.35);
    const struct = size >= 10 ? generateSkeleton('house', 4049 + n, { width: Math.max(4, Math.round(size / 2) * 2), depth: Math.max(4, Math.round(Math.max(size * 0.35, 4) / 2) * 2), floors: Math.max(1, Math.round(height / 3)), cores: 1 }) : null;
    return { id: `thing_${n + 1}`, name: label, aliases: [...tally.keys()].filter(other => other !== label), model, shape, size, height, airborne: own.filter(entry => entry.object.airborne).length * 2 > own.length, struct, standing: struct ? struct.cells.map(value => (value ? 1 : 0)) : null, mentions: own.map(entry => ({ scene: entry.scene, event: entry.event })), placed: [] };
  });
  // Where each placement stands: the cast from Jev's two views (a box on the reader's view, a box on a low side view showing
  // the first as a beam), with the thing's model fitted as large as fits inside it.
  notes.thingBoxes = 0;
  /** Place (or move) the things an event mentions: in their two-view cast, or else on the ground beside the event's first actor. */
  const placedAt = new Set();
  const placeThings = (scene, event, at) => {
    const index = scene.events.findIndex(entry => entry.id === event.id);
    // Once per event: the first turn of an event is its first actor's.
    if (placedAt.has(event.id)) return;
    placedAt.add(event.id);
    for (const entity of entities) if (entity.mentions.some(entry => entry.scene === scene.id && entry.event === index) && at) {
      const group = groups.get(scene.placeId), box = boxes[`${scene.id}|${index}|${entity.name}`]?.box, round = value => Math.round(value * 10) / 10;
      let x, z, cast;
      if (box) { [x, z] = [(box.x[0] + box.x[1]) / 2, (box.z[0] + box.z[1]) / 2]; cast = { w: box.x[1] - box.x[0], h: box.y[1] - box.y[0], d: box.z[1] - box.z[0], y0: box.y[0] }; notes.thingBoxes++; }
      else {
        // No box yet: on the ground beside the actor, in the first direction with open ground; on the actor's spot when there is none.
        const actor = nodePosition(group.layout, at[0]), lotAt = (px, pz) => group.layout.lots.find(entry => px >= entry.i0 * 2 && px < (entry.i0 + entry.nx) * 2 && pz >= entry.j0 * 2 && pz < (entry.j0 + entry.nz) * 2);
        const reach = entity.size / 2 + 2, open = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: actor.x + dx * reach, z: actor.z + dz * reach })).find(spot => spot.x > 0 && spot.z > 0 && spot.x < group.layout.NX * 2 && spot.z < group.layout.NZ * 2 && !lotAt(spot.x, spot.z) && actor.k === 0);
        ({ x, z } = open ?? actor); cast = { w: entity.size, h: entity.height, d: entity.shape === 'box' ? Math.max(1.2, entity.size * 0.35) : entity.size, y0: entity.airborne ? 8 : 0 };
      }
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
    const chosen = impacts[`${scene.id}|${scene.events.findIndex(entry => entry.id === event.id)}`];
    if (chosen?.none) { notes.impacts.none++; return; }
    if (chosen?.sphere) return hitSphere(scene, event, chosen.sphere, strength, seed);
    // Things near the blast are hit too; a big one loses part of its structure.
    const near = nodePosition(groups.get(scene.placeId).layout, at[0]), thingHits = [];
    for (const entity of entities) if (entity.at?.place === scene.placeId && Math.hypot(entity.at.x - near.x, entity.at.z - near.z) <= 4 + entity.size / 2) {
      const rng = stream(seed, 'thing', entity.id), destroyed = [];
      if (entity.standing) for (let cell = 0; cell < entity.standing.length; cell++) if (entity.standing[cell] && rng() < strength * 0.6) { entity.standing[cell] = 0; destroyed.push(cell); }
      thingHits.push({ id: entity.id, destroyed });
    }
    if (thingHits.length) hitThings.set(event.id, thingHits);
    const group = groups.get(scene.placeId), p = nodePosition(group.layout, at[0]);
    const distance = lot => Math.hypot(Math.max(0, lot.i0 * 2 - p.x, p.x - (lot.i0 + lot.nx) * 2), Math.max(0, lot.j0 * 2 - p.z, p.z - (lot.j0 + lot.nz) * 2));
    const index = group.layout.lots.map((lot, n) => [n, distance(lot)]).filter(([, d]) => d <= 6).sort((a, b) => a[1] - b[1])[0]?.[0];
    if (index === undefined) return;
    const lot = group.layout.lots[index], point = { x: Math.min(Math.max(p.x, lot.i0 * 2 + 1), (lot.i0 + lot.nx) * 2 - 1), y: Math.min(p.y, (lot.floors - 1) * 3), z: Math.min(Math.max(p.z, lot.j0 * 2 + 1), (lot.j0 + lot.nz) * 2 - 1) };
    const half = 3 + 5 * strength, box = { x: [point.x - half, point.x + half], y: [Math.max(0, point.y - 3), point.y + 3 + 3 * strength], z: [point.z - half, point.z + half] };
    const result = degrade(group.layout, index, group.standing[index], box, strength, stream(seed, 'hit'));
    group.standing[index] = result.standing; group.version++;
    notes.hits++; notes.destroyed += result.destroyed.length;
    hits.set(event.id, { lot: index, strength: Math.round(strength * 100) / 100, point, box, destroyed: result.destroyed, cutOff: result.cutOff, cutRooms: result.cutRooms });
  };
  /**
   * A chosen impact: every building the sphere reaches loses what its percolation step takes inside the sphere; things in it
   * are hit too. A blast reaches into the building it hits: chosen off its structure, the sphere centres on that building's
   * nearest standing unit (a wall, a slab, a stair), so it always meets structure.
   */
  const hitSphere = (scene, event, chosen, strength, seed) => {
    const group = groups.get(scene.placeId);
    // A lot's structure and what of it stands now (its skeleton's cells as the walk left them, walls and roof as hits left them).
    const unitsOf = index => { const structure = (group.structures[index] ??= structureOf(group.layout.lots[index])), units = group.units[index] ?? intact(structure); for (let cell = 0; cell < structure.cells; cell++) units[cell] = group.standing[index][cell] && structure.kind[cell] ? 1 : 0; return { structure, units }; };
    const struck = group.layout.lots.map((lot, index) => ({ lot, index, gap: Math.hypot(Math.max(0, lot.i0 * 2 - chosen.x, chosen.x - (lot.i0 + lot.nx) * 2), Math.max(0, lot.j0 * 2 - chosen.z, chosen.z - (lot.j0 + lot.nz) * 2)) })).sort((a, b) => a.gap - b.gap)[0];
    let sphere = chosen;
    if (struck) { const { structure, units } = unitsOf(struck.index); let best = null, far = Infinity; units.forEach((up, unit) => { if (!up) return; const at = unitAt(structure, unit), gap = Math.hypot(at.x - chosen.x, at.y - chosen.y, at.z - chosen.z); if (gap < far) { far = gap; best = at; } }); if (best && far > chosen.r / 2) sphere = { ...best, r: chosen.r }; }
    const reach = (lot) => Math.hypot(Math.max(0, lot.i0 * 2 - sphere.x, sphere.x - (lot.i0 + lot.nx) * 2), Math.max(0, -sphere.y, sphere.y - lot.floors * 3), Math.max(0, lot.j0 * 2 - sphere.z, sphere.z - (lot.j0 + lot.nz) * 2));
    const box = { x: [sphere.x - sphere.r, sphere.x + sphere.r], y: [sphere.y - sphere.r, sphere.y + sphere.r], z: [sphere.z - sphere.r, sphere.z + sphere.r], sphere };
    // Each building the sphere reaches, as structural units (structure.ts): those the blast's energy breaks go, then what
    // has lost its load path falls straight down to rest; walls and the roof break and fall like corridors and stairs.
    const parts = group.layout.lots.map((lot, index) => [index, reach(lot)]).filter(([, gap]) => gap <= sphere.r).sort((a, b) => a[1] - b[1]).map(([index]) => {
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
    if (!parts.length) return;
    group.version++; notes.hits++; notes.impacts.sphere++;
    const [main, ...more] = parts, round = value => Math.round(value * 10) / 10;
    hits.set(event.id, { ...main, more, strength: Math.round(strength * 100) / 100, point: { x: sphere.x, y: sphere.y, z: sphere.z }, box: { x: box.x, y: box.y, z: box.z }, sphere: { x: round(sphere.x), y: round(sphere.y), z: round(sphere.z), r: sphere.r } });
  };
  const mover = {
    // Carried from this place when they were last here; else where Jev said the scene finds them, else coming in off the avenue.
    start: ({ scene, handoff, carried, seed }) => {
      if (carried) return carried;
      const { spots } = graphOf(scene.placeId), said = report[scene.id]?.starts?.[handoff.person], named = said && said.stated >= 0.5 ? spotKey(scene.placeId, top(said.to)) : null;
      const spot = named && spots[named]?.length ? named : 'avenue';
      return [pick(spots[spot], stream(seed)), directionOf(0, -1)];
    },
    act: ({ scene, event, person, at, seed }) => {
      placeThings(scene, event, at);
      damage(scene, event, at, seed);
      const answer = report[scene.id]?.events?.[event.id]?.[person], spot = spotKey(scene.placeId, top(answer?.to)), { graph, spots } = graphOf(scene.placeId);
      if (!answer?.to || !at || !spots[spot]?.length) return { kind: 'stay' };
      const [node, heading] = at, rng = stream(seed);
      if (answer.how === 'teleport') { const to = pick(spots[spot], rng); notes.teleports++; moves.set(`${scene.id}|${event.id}|${person}`, { person, how: 'teleport', spot, path: [node, to], ensemble: [] }); return { kind: 'move', to: [to, heading] }; }
      // Already there: somewhere else in the same spot, at least 4 m off or on another level.
      let targets = spots[spot], key = spot;
      if (targets.includes(node)) { targets = targets.filter(other => Math.hypot(graph.x[other] - graph.x[node], graph.z[other] - graph.z[node]) > 4 || graph.y[other] !== graph.y[node]); key = `${spot}@${node}`; }
      const field = solve(scene.placeId, key, targets, answer.how), path = sampleWalk(graph, field, node, heading, rng);
      if (!path) { notes.unreachable++; return { kind: 'stay' }; }
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
    },
  };
  const { scenes: runs } = await walkTimeline(timeline, chosen, mover, { concurrency: 1, version: 'strand-demo-2' });
  notes.solves = fields.size;
  const people = [...new Set(chosen.flatMap(scene => scene.cast))], color = new Map(people.map((id, index) => [id, PALETTE[index % PALETTE.length]]));
  // The macro view: the strand's places and their ancestors in the place tree; and who migrated between places, scene by scene.
  const placeOf = new Map(chosen.map(scene => [scene.id, scene.placeId])), tree = new Set(chosen.flatMap(scene => places.get(scene.placeId)?.path ?? [scene.placeId]));
  const migrations = chosen.flatMap(scene => (timeline.handoffs.get(scene.id) ?? []).filter(handoff => handoff.from && !handoff.samePlace).map(handoff => ({ scene: scene.id, person: handoff.person, from: placeOf.get(handoff.from), to: scene.placeId })));
  const clean = text => (text ?? '').split('（原文：')[0].trim();
  // Things the scenes put in their places (novel stage objects): a named building takes a generic lot and lights up when first
  // mentioned; anything else stands in the box where Jev's two views agree (placeThings above).
  const detected = JSON.parse(await readFile(`${novelDir}/stage/objects.json`, 'utf8').catch(() => 'null'));
  const ROLE_FOR = { hospital: 'hospital', skyscraper: 'office', office: 'office', market: 'shop', station: 'station', school: 'office', home: 'shop' };
  const lotNames = new Map(), placedObjects = new Map();
  for (const scene of chosen) {
    const group = groups.get(scene.placeId), found = detected?.scenes?.[scene.id]?.objects ?? [], run = runs[scene.id];
    for (const object of found) {
      const eventIndex = Math.max(0, scene.events.findIndex(event => event.id === object.event));
      if (object.kind === 'building' && object.match.kind === 'building') {
        if (!newBuildingHere(object.name, group.label, [...groups.values()].map(other => other.label))) continue;
        const lots = group.layout.lots, key = `${scene.placeId}|${object.name}`;
        if (lotNames.has(key)) continue;
        const free = lots.findIndex((lot, index) => !lot.label && ![...lotNames.values()].some(entry => entry.place === scene.placeId && entry.lot === index) && lot.role === (ROLE_FOR[object.match.id] ?? lot.role));
        const index = free >= 0 ? free : lots.findIndex((lot, n) => !lot.label && ![...lotNames.values()].some(entry => entry.place === scene.placeId && entry.lot === n));
        if (index >= 0) lotNames.set(key, { place: scene.placeId, lot: index, name: object.name, scene: scene.id, event: eventIndex, model: object.match.id });
        continue;
      }
    }
  }
  notes.detected = { buildings: lotNames.size, objects: [...placedObjects.values()].reduce((sum, list) => sum + list.length, 0) };
  const worn = new Set(entities.filter(entity => entity.model && entity.placed.length).map(entity => entity.model));
  const named = (placeId, index) => [...lotNames.values()].find(entry => entry.place === placeId && entry.lot === index);
  const shellOf = (placeId, lot, index) => { const role = named(placeId, index) ? (ROLE_FOR[named(placeId, index).model] ?? lot.role) : lot.role, choices = SHELLS[role === 'office' && (lot.floors >= 7 || named(placeId, index)?.model === 'skyscraper') ? 'tall' : role] ?? SHELLS.office, model = choices[Math.floor(stream('shell', placeId, index)() * choices.length)]; worn.add(model); return model; };
  const exported = Object.fromEntries([...groups].map(([id, { layout }]) => [id, layout.lots.map((lot, index) => shellOf(id, lot, index))]));
  // The macro view is the place tree's own layout (the production one), in metres: each place of the strand reserves a disc as
  // wide as its grid, a region that is itself a place keeps its grid above its children, and nothing overlaps.
  const macroLayout = () => {
    const parentOf = id => tree.has(places.get(id)?.parentId) ? places.get(id).parentId : null, links = new Map();
    for (const migration of migrations) if (migration.from && migration.to) { const key = `${migration.from}\u0000${migration.to}`; links.set(key, (links.get(key) ?? 0) + 1); }
    const circles = placeTreeCircles([...tree].map(id => ({ id, parentId: parentOf(id), sceneIds: [] })), [...links].map(([key, count]) => { const [from, to] = key.split('\u0000'); return { from, to, count }; }),
      { ownRadius: place => groups.has(place.id) ? Math.hypot(groups.get(place.id).layout.NX, groups.get(place.id).layout.NZ) * SKELETON_CELL / 2 + 4 : 0 });
    const round = value => Math.round(value * 10) / 10;
    return [...tree].map(id => { const at = circles.get(id); return { id, label: name(id), parent: parentOf(id), x: round(at.x), z: round(at.y), r: round(at.r), depth: at.depth, spotX: round(at.spotX), spotZ: round(at.spotY) }; });
  };
  return {
    models: Object.fromEntries([...worn].map(model => [model, library.models[model]])), modelSource: library.source,
    things: entities.filter(entity => entity.placed.length).map(entity => ({ id: entity.id, name: entity.name, aliases: entity.aliases, model: entity.model, shape: entity.shape, size: entity.size, height: entity.height, placed: entity.placed,
      struct: entity.struct ? { nx: entity.struct.nx, nz: entity.struct.nz, floors: entity.struct.floors, cells: [...entity.struct.cells].join('') } : null })),
    title: options.title ?? `${name(chosen[0].placeId)} …`, exportedAt: new Date().toISOString(), T: Math.round(T * 1000) / 1000, kappa, lambda, notes, migrations,
    macro: macroLayout(),
    people: Object.fromEntries(people.map(id => [id, { name: name(id), color: color.get(id) }])),
    places: Object.fromEntries([...groups].map(([id, { label, path, layout }]) => [id, { label, path, kind: layout.kind, NX: layout.NX, NZ: layout.NZ, K: layout.K, ground: [...layout.ground].join(''), clutter: [...layout.clutter.keys()].filter(cell => layout.clutter[cell]), clutterDraws: layout.clutterDraws,
      lots: layout.lots.map((lot, index) => ({ model: exported[id][index], label: lot.label, detected: named(id, index) ? { name: named(id, index).name, scene: named(id, index).scene, event: named(id, index).event } : null, role: named(id, index) && ROLE_FOR[named(id, index).model] === 'hospital' ? 'hospital' : lot.role, i0: lot.i0, j0: lot.j0, nx: lot.nx, nz: lot.nz, floors: lot.floors, cells: [...lot.skeleton.cells].join(''), rooms: lot.rooms.map(room => [room.floor, room.i0, room.j0, room.i1, room.j1]) })) }])),
    scenes: chosen.map(scene => {
      const run = runs[scene.id], label = inputs.data.scenes.find(entry => entry.id === scene.id)?.label;
      return { id: scene.id, place: scene.placeId, label: label && label !== scene.id ? label : null,
        starts: Object.fromEntries(Object.entries(run.starts).map(([person, at]) => [person, at?.[0] ?? null])),
        from: Object.fromEntries((timeline.handoffs.get(scene.id) ?? []).map(handoff => [handoff.person, handoff.from ? (handoff.samePlace ? 'stays' : 'arrives') : 'enters'])),
        objects: placedObjects.get(scene.id) ?? [],
        events: scene.events.map(event => ({ text: clean(event.text), hit: hits.get(event.id) ?? null, hitThings: hitThings.get(event.id) ?? null, moves: scene.cast.map(person => moves.get(`${scene.id}|${event.id}|${person}`)).filter(Boolean) })) };
    }),
  };
}

/**
 * A strand's simulation as a record other sessions and tools can read without the player: the buildings (places, lots,
 * skeletons), the things and where each placement stands, every move as points in the place's metres, and every hit with
 * its sphere, energy and the units it broke or brought down. Derived view data, never canon: it lives with the book under
 * `stage/simulation/` (docs/stage-simulation-records.md).
 */
export function simulationRecord(data, strand) {
  const CELL = 2, FLOOR = 3, round = value => Math.round(value * 100) / 100;
  const point = (place, node) => { const i = node % place.NX, j = Math.floor(node / place.NX) % place.NZ, k = Math.floor(node / (place.NX * place.NZ)); return [round((i + 0.5) * CELL), k * FLOOR, round((j + 0.5) * CELL)]; };
  const part = part => ({ lot: part.lot, energy: part.energy ?? null, blasted: part.blasted ?? null, fallen: part.fallen ?? null, destroyedCells: part.destroyed, fellCells: part.fell ?? [], cutOffCells: part.cutOff, cutOffRooms: part.cutRooms });
  return {
    kind: 'stage-simulation', version: 1, exportedAt: data.exportedAt, strand: { ...strand, title: data.title },
    units: { metres: { cell: CELL, floor: FLOOR }, kinds: { 1: 'corridor', 2: 'stair', 3: 'wall', 4: 'roof' }, tuple: '[kind, i, j, k] on the lot\'s grid; fallen ones add where they came to rest (metres up)' },
    engine: { T: data.T, kappa: data.kappa, lambda: data.lambda, notes: data.notes },
    people: data.people,
    buildings: Object.fromEntries(Object.entries(data.places).map(([id, place]) => [id, { label: place.label, path: place.path, kind: place.kind, grid: { NX: place.NX, NZ: place.NZ, floors: place.K },
      lots: place.lots.map(lot => ({ label: lot.label, detected: lot.detected, role: lot.role, model: lot.model, footprint: { i0: lot.i0, j0: lot.j0, nx: lot.nx, nz: lot.nz }, floors: lot.floors, skeleton: lot.cells, rooms: lot.rooms })) }])),
    things: data.things.map(thing => ({ id: thing.id, name: thing.name, aliases: thing.aliases, model: thing.model, shape: thing.shape, size: thing.size, placements: thing.placed })),
    migrations: data.migrations,
    scenes: data.scenes.map(scene => {
      const place = data.places[scene.place];
      return { id: scene.id, place: scene.place, label: scene.label, starts: Object.fromEntries(Object.entries(scene.starts).map(([person, node]) => [person, node == null ? null : point(place, node)])),
        events: scene.events.map((event, index) => ({ index, text: event.text, moves: event.moves.map(move => ({ person: move.person, how: move.how, spot: move.spot, path: move.path.map(node => point(place, node)) })),
          hit: event.hit && { sphere: event.hit.sphere ?? null, strength: event.hit.strength, parts: [event.hit, ...(event.hit.more ?? [])].map(part) }, hitThings: event.hitThings })) };
    }),
  };
}

/** The player page with the strand inlined. */
export function inlineStrand(template, data, { name = 'One Strand', fragment = false, vendor = false } = {}) {
  // `vendor`: three.js served beside the page (vendor/), so the page needs no CDN.
  if (vendor) template = template.replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './vendor/three.module.js').replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './vendor/addons/');
  let page = template.replace('<title>One Strand · Holo Stage</title>', () => `<title>${name}</title>`).replace('<script type="application/json" id="strand-data"></script>', () => `<script type="application/json" id="strand-data">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`);
  // A host that adds its own document wrapper (a claude.ai page) takes the title, import map, styles and body.
  if (fragment) page = [page.match(/<title>[^<]*<\/title>/)[0], '<meta name="claude:viewport-fit-sides" content="cover">', page.match(/<script type="importmap">[\s\S]*?<\/script>/)[0], page.match(/<style>[\s\S]*?<\/style>/)[0], page.match(/<body>([\s\S]*)<\/body>/)[1]].join('\n');
  if (/\/view\/[A-Za-z0-9_-]{43}\//.test(page) || page.includes('（原文：')) throw new Error('Private paths or source quotes ended up in the page');
  return page;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' }, fork: { type: 'string' }, title: { type: 'string' }, name: { type: 'string' }, fragment: { type: 'boolean' }, vendor: { type: 'boolean' }, set: { type: 'string' }, records: { type: 'boolean' } } });
  const usage = 'Usage: node playground/export-strand-demo.mjs <novel-dir> <out.html> --from <scene-id> --to <scene-id> [--fork <scene-id>] [--title text] [--name text] [--fragment] [--vendor]\n       node playground/export-strand-demo.mjs --set <strands.json> <out.html> [--name text] [--fragment] [--vendor] [--records]   (strands.json: [{ id, label, name, novel, from, to, fork, title }], one page with a strand picker)';
  const template = await readFile(`${repository}/playground/strand-demo.html`, 'utf8'), started = Date.now();
  // One page per strand, or one page carrying a set of strands to pick from.
  const entries = values.set ? JSON.parse(await readFile(values.set, 'utf8')) : [{ ...values, novel: positionals[0] }], out = values.set ? positionals[0] : positionals[1];
  if (!out || entries.some(entry => !entry.novel || !entry.from || !entry.to) || (values.set && entries.some(entry => !/^[A-Za-z0-9_-]+$/.test(entry.id ?? '') || !entry.label))) throw new Error(usage);
  const strands = [];
  for (const entry of entries) strands.push({ id: entry.id, label: entry.label, name: entry.name, data: await strandDemo(entry.novel.replace(/^~(?=\/)/, process.env.HOME), entry) });
  const page = inlineStrand(template, values.set ? { strands } : strands[0].data, { name: values.name, fragment: values.fragment, vendor: values.vendor });
  await writeFile(out, page, { mode: 0o644 });
  // --records: each strand's simulation, kept with its book (stage/simulation/<strand>.json, listed in index.json).
  if (values.records) for (const [n, strand] of strands.entries()) {
    const entry = entries[n], folder = `${entry.novel.replace(/^~(?=\/)/, process.env.HOME)}/stage/simulation`, id = entry.id ?? `${entry.from}-${entry.to}`;
    await mkdir(folder, { recursive: true });
    await writeFile(`${folder}/${id}.json`, JSON.stringify(simulationRecord(strand.data, { id, from: entry.from, to: entry.to, fork: entry.fork ?? null }), null, 1), { mode: 0o644 });
    const index = JSON.parse(await readFile(`${folder}/index.json`, 'utf8').catch(() => '{"strands":{}}'));
    index.strands[id] = { file: `${id}.json`, from: entry.from, to: entry.to, fork: entry.fork ?? null, title: strand.data.title, exportedAt: strand.data.exportedAt, scenes: strand.data.scenes.length, hits: strand.data.notes.hits, things: strand.data.things.length };
    await writeFile(`${folder}/index.json`, JSON.stringify(index, null, 1), { mode: 0o644 });
  }
  const summary = data => ({ scenes: data.scenes.length, events: data.scenes.reduce((n, s) => n + s.events.length, 0), ...data.notes, T: data.T, places: Object.values(data.places).map(p => ({ label: p.label, kind: p.kind, lots: p.lots.length, floors: p.lots.map(l => l.floors).join('/'), clutter: p.clutter.length, draws: p.clutterDraws })) });
  console.log(JSON.stringify({ out, bytes: Buffer.byteLength(page), ...(values.set ? { strands: strands.map(strand => ({ id: strand.id, ...summary(strand.data) })) } : summary(strands[0].data)), seconds: (Date.now() - started) / 1000 }));
}
