// One timeline strand as a continuous, shareable page: its places built from the place tree (a district or
// street of skeleton buildings: corridors, stair cores, box rooms on every floor; clutter drawn by percolation
// conditioned on access; fights damaging buildings in story order), its people
// walked scene by scene with positions handed along their world lines (stage environment), and every move
// sampled from the path integral (an exact h-transform draw, plus a small ensemble to show the spread).
// Where each move ends comes from Jev's spot answers in the book's movement report. The page carries scene
// and event summaries, names and places; no quotes or source text.
//   npm run build && node playground/export-strand-demo.mjs <novel-dir> <out.html> --from <scene-id> --to <scene-id> [--fork <scene-id>] [--title text]
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const load = path => import(pathToFileURL(`${repository}/${path}`));
const PALETTE = ['#7ce6ff', '#ff8fb1', '#ffd36e', '#9dff8a', '#c59bff', '#ff9d5c', '#5cf2c8', '#f2f2f2', '#8fb6ff', '#e0ff6e'];
/** The artistic models (Kenney CC0 kits, baked in apps/playground) a building of each role may wear; one is drawn per lot at random. */
const SHELLS = { office: ['tower-a', 'tower-b', 'tower-d', 'tower-e', 'tower-f', 'tower-g', 'tower-h', 'tower-i', 'tower-j', 'tower-l', 'tower-m', 'office-c', 'office-h', 'block-wide-a', 'block-wide-b'], tall: ['skyscraper-a', 'skyscraper-b', 'skyscraper-e', 'tower-c', 'tower-k'], shop: ['office-c', 'block-wide-a', 'market'], hospital: ['office-k'], station: ['block-wide-b'] };
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
  const { composePlace, placeGraph, nodePosition, degrade, semanticAxis } = await load('dist/apps/playground/src/data/skeletonPlace.js');
  const { skeletonStream: stream, generateSkeleton } = await load('dist/apps/playground/src/data/skeleton.js');
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
    const layout = composePlace({ id: placeId, kind: /[街路巷道]$/.test(label) ? 'street' : 'district', seed, members });
    groups.set(placeId, { label, path: (place?.path ?? [placeId]).map(name), layout, things: new Map(), standing: layout.lots.map(lot => lot.skeleton.cells.map(value => (value ? 1 : 0))), version: 0, built: null });
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
    const size = Math.min(24, Math.max(4, ...own.map(entry => entry.object.size))), shape = lead.match.kind === 'shape' ? lead.match.id : 'box';
    const height = shape === 'sphere' || shape === 'diamond' ? size : shape === 'oval' ? size * 0.55 : Math.max(1.2, size * 0.35);
    const struct = size >= 10 ? generateSkeleton('house', 4049 + n, { width: Math.max(4, Math.round(size / 2) * 2), depth: Math.max(4, Math.round(Math.max(size * 0.35, 4) / 2) * 2), floors: Math.max(1, Math.round(height / 3)), cores: 1 }) : null;
    return { id: `thing_${n + 1}`, name: label, aliases: [...tally.keys()].filter(other => other !== label), shape, size, height, airborne: own.filter(entry => entry.object.airborne).length * 2 > own.length, struct, standing: struct ? struct.cells.map(value => (value ? 1 : 0)) : null, mentions: own.map(entry => ({ scene: entry.scene, event: entry.event })), placed: [] };
  });
  /** Place (or move) the things an event mentions, where its first actor stands, resting on whatever is under them. */
  const placedAt = new Set();
  const placeThings = (scene, event, at) => {
    const index = scene.events.findIndex(entry => entry.id === event.id);
    // Once per event: the first turn of an event is its first actor's.
    if (placedAt.has(event.id)) return;
    placedAt.add(event.id);
    for (const entity of entities) if (entity.mentions.some(entry => entry.scene === scene.id && entry.event === index) && at) {
      // Beside the actor, in the first direction with open ground; on the actor's own spot when there is none.
      const group = groups.get(scene.placeId), actor = nodePosition(group.layout, at[0]), lotAt = (x, z) => group.layout.lots.find(entry => x >= entry.i0 * 2 && x < (entry.i0 + entry.nx) * 2 && z >= entry.j0 * 2 && z < (entry.j0 + entry.nz) * 2);
      const reach = entity.size / 2 + 2, open = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => ({ x: actor.x + dx * reach, z: actor.z + dz * reach })).find(spot => spot.x > 0 && spot.z > 0 && spot.x < group.layout.NX * 2 && spot.z < group.layout.NZ * 2 && !lotAt(spot.x, spot.z) && actor.k === 0);
      const p = open ?? actor, lot = lotAt(p.x, p.z);
      const y = (lot ? lot.floors * 3 : 0) + entity.height / 2 + (entity.airborne ? 8 : 0), depth = entity.shape === 'box' ? Math.max(1.2, entity.size * 0.35) : entity.size;
      for (const other of groups.values()) if (other.things.delete(entity.id)) other.version++;
      group.things.set(entity.id, { i0: Math.floor((p.x - entity.size / 2) / 2), i1: Math.floor((p.x + entity.size / 2) / 2), j0: Math.floor((p.z - depth / 2) / 2), j1: Math.floor((p.z + depth / 2) / 2), top: Math.round((y + entity.height / 2) / 3), grounded: y - entity.height / 2 < 1.5 && entity.size <= 8 });
      group.version++;
      entity.placed.push({ scene: scene.id, event: index, place: scene.placeId, x: Math.round(p.x * 10) / 10, y: Math.round(y * 10) / 10, z: Math.round(p.z * 10) / 10 });
      entity.at = { place: scene.placeId, x: p.x, y, z: p.z };
    }
  };
  notes.things = { mentions: mentions.length, things: entities.length, withStructure: entities.filter(entity => entity.struct).length };
  const damage = (scene, event, at, seed) => {
    if (struck.has(event.id)) return;
    struck.add(event.id);
    const strength = axis?.strength(event.id) ?? 0;
    if (strength < 0.8 || !at) return;
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
  const mover = {
    // Carried from this place when they were last here; else where Jev said the scene finds them, else coming in off the avenue.
    start: ({ scene, handoff, carried, seed }) => {
      if (carried) return carried;
      const { spots } = graphOf(scene.placeId), said = report[scene.id]?.starts?.[handoff.person];
      const spot = said && said.stated >= 0.5 && spots[top(said.to)]?.length ? top(said.to) : 'avenue';
      return [pick(spots[spot], stream(seed)), directionOf(0, -1)];
    },
    act: ({ scene, event, person, at, seed }) => {
      placeThings(scene, event, at);
      damage(scene, event, at, seed);
      const answer = report[scene.id]?.events?.[event.id]?.[person], spot = top(answer?.to), { graph, spots } = graphOf(scene.placeId);
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
  // mentioned; anything else stands where the event's first actor is (standing in for Jev's box on the top view), floating on
  // top of whatever is under it.
  const detected = JSON.parse(await readFile(`${novelDir}/stage/objects.json`, 'utf8').catch(() => 'null'));
  const ROLE_FOR = { hospital: 'hospital', skyscraper: 'office', office: 'office', market: 'shop', station: 'station', school: 'office', home: 'shop' };
  const anonymous = /^(另一栋|另一座|那栋|这栋)?(大)?(楼|大楼|建筑|房子)$/;
  const lotNames = new Map(), placedObjects = new Map();
  for (const scene of chosen) {
    const group = groups.get(scene.placeId), found = detected?.scenes?.[scene.id]?.objects ?? [], run = runs[scene.id];
    for (const object of found) {
      const eventIndex = Math.max(0, scene.events.findIndex(event => event.id === object.event));
      if (object.kind === 'building' && object.match.kind === 'building') {
        // Anonymous buildings are already standing; one named after another place stands there, not here.
        if (anonymous.test(object.name) || [...groups.values()].some(other => other.label !== group.label && object.name.includes(other.label))) continue;
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
  const library = JSON.parse(await readFile(`${repository}/apps/playground/src/data/architectureModels.json`, 'utf8')), worn = new Set();
  const named = (placeId, index) => [...lotNames.values()].find(entry => entry.place === placeId && entry.lot === index);
  const shellOf = (placeId, lot, index) => { const role = named(placeId, index) ? (ROLE_FOR[named(placeId, index).model] ?? lot.role) : lot.role, choices = SHELLS[role === 'office' && (lot.floors >= 7 || named(placeId, index)?.model === 'skyscraper') ? 'tall' : role] ?? SHELLS.office, model = choices[Math.floor(stream('shell', placeId, index)() * choices.length)]; worn.add(model); return model; };
  const exported = Object.fromEntries([...groups].map(([id, { layout }]) => [id, layout.lots.map((lot, index) => shellOf(id, lot, index))]));
  return {
    models: Object.fromEntries([...worn].map(model => [model, library.models[model]])), modelSource: library.source,
    things: entities.filter(entity => entity.placed.length).map(entity => ({ id: entity.id, name: entity.name, aliases: entity.aliases, shape: entity.shape, size: entity.size, height: entity.height, placed: entity.placed,
      struct: entity.struct ? { nx: entity.struct.nx, nz: entity.struct.nz, floors: entity.struct.floors, cells: [...entity.struct.cells].join('') } : null })),
    title: options.title ?? `${name(chosen[0].placeId)} …`, exportedAt: new Date().toISOString(), T: Math.round(T * 1000) / 1000, kappa, lambda, notes, migrations,
    macro: [...tree].map(id => ({ id, label: name(id), parent: tree.has(places.get(id)?.parentId) ? places.get(id).parentId : null })),
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
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { from: { type: 'string' }, to: { type: 'string' }, fork: { type: 'string' }, title: { type: 'string' }, name: { type: 'string' }, fragment: { type: 'boolean' }, vendor: { type: 'boolean' } } });
  const [novelDir, out] = positionals;
  if (!novelDir || !out || !values.from || !values.to) throw new Error('Usage: node playground/export-strand-demo.mjs <novel-dir> <out.html> --from <scene-id> --to <scene-id> [--fork <scene-id>] [--title text]');
  const started = Date.now(), data = await strandDemo(novelDir, values);
  const page = inlineStrand(await readFile(`${repository}/playground/strand-demo.html`, 'utf8'), data, { name: values.name, fragment: values.fragment, vendor: values.vendor });
  await writeFile(out, page, { mode: 0o644 });
  console.log(JSON.stringify({ out, bytes: Buffer.byteLength(page), scenes: data.scenes.length, events: data.scenes.reduce((n, s) => n + s.events.length, 0), ...data.notes, T: data.T, places: Object.values(data.places).map(p => ({ label: p.label, kind: p.kind, lots: p.lots.length, floors: p.lots.map(l => l.floors).join('/'), clutter: p.clutter.length, draws: p.clutterDraws })), seconds: (Date.now() - started) / 1000 }));
}
