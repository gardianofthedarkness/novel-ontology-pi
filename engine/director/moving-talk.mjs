// Moving conversations, an experimental build (the user, 2026-11-08: "see if two people are in a continuous movement mid
// conversation, for example having a dialogue mid walking down a mall or a street, or talking while driving somewhere, can
// movement and dialogue/action happen at the same time in the animation"; "build your experimental build around those
// experimental clips to help me better understand each options effect").
//
// The player already plays a card's moves and its lines at once (a move starts with its card, the lines share the card's
// length), but the director lays a walk and the talk on it out as separate cards: they walk, stop, then talk. Each sample
// unit of a directed run is cut out of the run's page and played under each option:
//   A  as played: the director's own cards.
//   B  on the move: each mover's way through the unit is one route, laid over the unit's cards by how long each card's
//      lines take to read, so they keep moving while the lines are said (each on their own way).
//   C  together: B on the leader's route, the others beside the leader (a cell to the side, keeping abreast) and anyone
//      carried on their carrier.
//   P  paced: C (or B where nobody leads) with each card's piece of the way walked at the pace that makes it last the
//      card's lines (never faster than the way's own pace, never slower than 0.3 m/s): people slow down as they talk, and
//      a short way still lasts the whole conversation.
//   D  riding: the riders aboard a vehicle that goes the route while they talk (the vehicle is a person drawn as one).
// A staged sample (`stage`) is a unit the run never played (another volume's passage): its cards are given, and it is
// laid on a route of the run's own city.
// The pages carry the book's lines (they play in the bubbles): private, never published.
//   node engine/director/moving-talk.mjs <run page.json> <spec.json> <out-dir>
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
// The player's own pacing (strand-demo.html): a card lasts long enough to read its spoken lines.
const SAY = 0.16, READ = 2.1, CELL = 2, FLOOR = 3;
// Its walking paces (SPEED, m/s), played DEMO times faster than life.
const SPEED = { walk: 1.4, run: 3.6, sneak: 0.8, ride: 12 }, DEMO = 3;
export const VEHICLE_DIMS = { 'a car': [4.5, 1.5, 1.9], 'a van or a truck': [6.5, 2.6, 2.4], 'a bus': [11, 3, 2.5] };

/** A node's grid cell in its place, and back (the page's encoding). */
export const cellOf = (place, node) => ({ i: node % place.NX - place.oi, j: Math.floor(node / place.NX) % place.NZ - place.oj, k: Math.floor(node / (place.NX * place.NZ)) - place.ok });
export const nodeOf = (place, { i, j, k }) => (k + place.ok) * place.NX * place.NZ + (j + place.oj) * place.NX + (i + place.oi);
const metres = (place, a, b) => { const p = cellOf(place, a), q = cellOf(place, b); return Math.hypot((p.i - q.i) * CELL, (p.j - q.j) * CELL, (p.k - q.k) * FLOOR); };

/** The page cut to one unit: its scene, its people, its cards and its sky; the world stays whole. */
export function sliceScene(page, sceneId) {
  const scene = page.scenes.find(entry => entry.id === sceneId);
  if (!scene) throw new Error(`no ${sceneId} on the page`);
  const cast = new Set([...scene.cast, ...Object.keys(scene.starts), ...scene.events.flatMap(event => event.moves.map(move => move.person))]);
  return {
    ...page,
    scenes: [{ ...scene, index: 0 }],
    migrations: (page.migrations ?? []).filter(entry => entry.scene === sceneId),
    people: Object.fromEntries(Object.entries(page.people).filter(([id]) => cast.has(id))),
    places: { [scene.place]: page.places[scene.place] },
    director: { ...page.director, cards: page.director.cards.filter(card => card.scene === sceneId), units: (page.director.units ?? []).filter(unit => unit.id === sceneId) },
    ...(page.sky?.units ? { sky: { ...page.sky, units: { [sceneId]: page.sky.units[sceneId] } } } : {}),
  };
}

/** How long each card plays for its lines (the player's own rule). */
const readingTimes = (page, scene) => scene.events.map((_, index) => {
  const card = page.director.cards.find(entry => entry.scene === scene.id && entry.event === index);
  const chars = (card?.lines ?? []).filter(line => line.kind === 'spoken' && line.text.trim()).reduce((sum, line) => sum + line.text.length, 0);
  return Math.max(READ, chars ? chars * SAY + 0.6 : 0);
});

/** One person's whole way through the unit: their start, then each move's path in card order. */
export function routeOf(scene, who) {
  const nodes = scene.starts[who] != null ? [scene.starts[who]] : [];
  for (const event of scene.events) for (const move of event.moves) if (move.person === who) for (const node of move.path) if (nodes.at(-1) !== node) nodes.push(node);
  return nodes;
}

/** A route cut into one piece per card, each as long as its share of the reading time (pieces join end to start). */
export function spread(place, route, weights) {
  const along = [0];
  for (let n = 1; n < route.length; n++) along.push(along[n - 1] + metres(place, route[n - 1], route[n]));
  const total = along.at(-1), sum = weights.reduce((a, b) => a + b, 0), cuts = [];
  let start = 0, so = 0;
  for (const weight of weights) {
    so += weight;
    const goal = (total * so) / sum;
    let end = start;
    while (end < route.length - 1 && along[end + 1] <= goal + 1e-6) end++;
    cuts.push([start, end]);
    start = end;
  }
  return cuts;
}

/** The way someone mostly moves in the unit (their longest move's), for their route. */
const mostlyHow = (scene, who) => scene.events.flatMap(event => event.moves).filter(move => move.person === who).sort((a, b) => b.path.length - a.path.length)[0]?.how ?? 'walk';

/** A route one cell to the side of another (keeping abreast: the side is across the way it heads, over a few cells). */
export function besideRoute(place, route, side) {
  return route.map((node, n) => {
    const a = cellOf(place, route[Math.max(0, n - 3)]), b = cellOf(place, route[Math.min(route.length - 1, n + 3)]), di = b.i - a.i, dj = b.j - a.j, here = cellOf(place, node);
    const [si, sj] = Math.abs(dj) >= Math.abs(di) ? [Math.sign(dj) || 1, 0] : [0, -(Math.sign(di) || 1)];
    return nodeOf(place, { i: here.i + side * si, j: here.j + side * sj, k: here.k });
  });
}

/**
 * A group's moves over some cards, in step: the lead's way cut by the cards' reading times, each piece at the lead's pace
 * (its own, or `paced` to last its card's lines, never slower than 0.3 m/s), and everyone else on their own way (the same,
 * or a cell beside: as many cells) in exactly the lead's time for that piece, so they keep together. [card, move] pairs.
 */
function inStep(place, ways, how, cards, weights, paced) {
  const natural = SPEED[how] ?? 1.4, own = cards.map(index => weights[index]), cuts = spread(place, ways[0][1], own);
  const length = path => path.slice(1).reduce((sum, node, n) => sum + metres(place, path[n], node), 0);
  const seconds = cuts.map(([from, to], n) => { if (to <= from) return 0; const metresOf = length(ways[0][1].slice(from, to + 1)), pace = paced ? Math.min(natural, Math.max(0.3, metresOf / (own[n] * DEMO))) : natural; return metresOf / pace / DEMO; });
  const out = [];
  for (const [who, way] of ways) cuts.forEach(([from, to], n) => {
    if (to <= from || !seconds[n]) return;
    const path = way.slice(from, to + 1), pace = Math.max(0.05, length(path) / (seconds[n] * DEMO));
    out.push([cards[n], { person: who, how, with: null, ensemble: [], path, ...(Math.abs(pace - natural) > 0.01 ? { pace: Math.round(pace * 100) / 100 } : {}) }]);
  });
  return out;
}

/** Options B, C, P and D on a cut page. `movers`: who keeps moving; `leader`/`beside`/`carried`: the group; `vehicle`: D. */
export function stageOption(page, option, spec) {
  if (option === 'A') return page;
  const scene = page.scenes[0], place = page.places[scene.place], weights = readingTimes(page, scene), every = scene.events.map((_, index) => index);
  const led = option === 'C' || option === 'D' || (option === 'P' && spec.leader), paced = option === 'P' || option === 'D';
  const restaged = new Set(!led ? spec.movers : [spec.leader, ...(spec.beside ?? []), ...Object.keys(spec.carried ?? {}), ...(option === 'D' ? [spec.vehicle.id, ...(spec.riders ?? [])] : [])]);
  const events = scene.events.map(event => ({ ...event, moves: event.moves.filter(move => !restaged.has(move.person)) })), starts = { ...scene.starts };
  const lay = (ways, how) => { for (const [who, way] of ways) starts[who] = way[0]; for (const [card, move] of inStep(place, ways, how, every, weights, paced)) events[card].moves.push(move); };
  if (!led) for (const who of spec.movers) lay([[who, routeOf(scene, who)]], spec.how?.[who] ?? mostlyHow(scene, who));
  else {
    const route = spec.route ?? routeOf(scene, spec.leader), how = option === 'D' ? 'ride' : spec.how?.[spec.leader] ?? mostlyHow(scene, spec.leader);
    const side = n => (n % 2 ? -(1 + (n >> 1)) : 1 + (n >> 1)), beside = (spec.beside ?? []).map((who, n) => [who, besideRoute(place, route, side(n))]);
    if (option === 'D') lay([[spec.vehicle.id, route], [spec.leader, route], ...(spec.riders ?? []).map(who => [who, route])], how);
    else lay([[spec.leader, route], ...beside, ...Object.entries(spec.carried ?? {}).map(([who, carrier]) => [who, carrier === spec.leader ? route : beside.find(([other]) => other === carrier)?.[1] ?? route])], how);
  }
  return { ...page, scenes: [{ ...scene, starts, cast: [...new Set([...scene.cast, ...Object.keys(starts)])], events }] };
}

/** A staged unit on the cut page of another: its people, its cards (given), on a route of the base unit's city. */
export function stageUnit(base, { id, people, cards, route, hour = null }) {
  const scene = base.scenes[0];
  const events = cards.map((card, index) => ({ id: `${id}:${index}`, actors: card.actors ?? [], text: card.text ?? '', camera: null, spots: [], hit: null, blows: [], hitThings: null, trace: null, moves: [] }));
  // Phase moves the staged cards give (a walk to the car, say), by the base city's route.
  for (const [index, card] of cards.entries()) for (const move of card.moves ?? []) events[index].moves.push({ person: move.who, how: move.how, with: null, ensemble: [], path: route.slice(move.from, move.to + 1) });
  const starts = Object.fromEntries(Object.entries(people).map(([who, person]) => [who, route[person.at ?? 0]]));
  return {
    ...base,
    people: Object.fromEntries(Object.entries(people).map(([who, person]) => [who, { name: person.name, color: person.color, ...(person.prop ? { prop: person.prop } : {}) }])),
    scenes: [{ ...scene, id, label: null, cast: Object.keys(people), starts, from: Object.fromEntries(Object.keys(people).map(who => [who, 'enters'])), events }],
    migrations: [],
    director: { ...base.director, cards: cards.map((card, index) => ({ scene: id, event: index, card: `${id}:${index}`, kind: card.kind, lines: card.lines })), units: [{ ...(base.director.units?.[0] ?? {}), id }] },
    ...(hour !== null ? { sky: { units: { [id]: { daypart: null, hour, weather: 'clear', strength: null, wind: null, sure: 1, lying: false } } } } : {}),
  };
}

/**
 * A staged unit's moves by phases (a walk to the car, then the drive): each phase is who moves (`who`, the first leading;
 * those `beside` a cell to the side), how, a stretch of the route (`from`..`to`) and its cards. A: the director's way, the
 * whole stretch on the phase's action card (`act`) at its own pace, the talk standing (or sitting in the stopped car) after
 * it. D: the stretch spread over the phase's cards, each piece paced to last its card's lines, so they talk as they go.
 */
export function stagePhases(unit, option, phases, route) {
  const scene = unit.scenes[0], place = unit.places[scene.place], weights = readingTimes(unit, scene), events = scene.events.map(event => ({ ...event, moves: [] }));
  for (const phase of phases) {
    const stretch = route.slice(phase.from, phase.to + 1), ways = [...phase.who.map(who => [who, stretch]), ...(phase.beside ?? []).map((who, n) => [who, besideRoute(place, stretch, n + 1)])];
    for (const [card, move] of inStep(place, ways, phase.how, option === 'A' ? [phase.act] : phase.cards, weights, option !== 'A')) events[card].moves.push(move);
  }
  return { ...unit, scenes: [{ ...scene, events }] };
}

/**
 * How much of a unit's talk is said on the move, by the player's own timing: each card as long as its lines or its moves,
 * each line its share of the card, each move from the card's start at its pace. Per spoken second: is the speaker moving,
 * and is one they talk with (another who speaks in that card) moving with them; and how far apart they are.
 */
export function talkInMotion(page) {
  const scene = page.scenes[0], place = page.places[scene.place], at = node => { const c = cellOf(place, node); return { x: (c.i + 0.5) * CELL, y: c.k * FLOOR, z: (c.j + 0.5) * CELL }; };
  const where = { ...scene.starts }, tally = { spoken: 0, speakerMoving: 0, together: 0, still: 0, apart: [] };
  scene.events.forEach((event, index) => {
    const card = page.director.cards.find(entry => entry.scene === scene.id && entry.event === index), said = (card?.lines ?? []).filter(line => line.kind === 'spoken' && line.text.trim());
    const timed = event.moves.map(move => { if (Array.isArray(move.at) && move.at.length === move.path.length) return { move, steps: move.at.map(s => s / (move.real ? 1 : DEMO)) }; const steps = [0]; for (let k = 1; k < move.path.length; k++) { const a = at(move.path[k - 1]), b = at(move.path[k]); steps.push(steps[k - 1] + Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / (move.pace ?? SPEED[move.how] ?? 1.4) / DEMO); } return { move, steps }; });
    const chars = said.reduce((sum, line) => sum + line.text.length, 0), length = Math.max(READ, chars ? chars * SAY + 0.6 : 0, ...timed.map(({ steps }) => steps.at(-1) + 0.6));
    const placeAt = (who, t) => { const entry = timed.find(({ move }) => move.person === who); if (!entry) return where[who] != null ? at(where[who]) : null; const { move, steps } = entry; let k = 1; while (k < steps.length - 1 && steps[k] < t) k++; const a = at(move.path[k - 1]), b = at(move.path[k]), f = Math.min(1, Math.max(0, (t - steps[k - 1]) / Math.max(1e-6, steps[k] - steps[k - 1]))); return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, z: a.z + (b.z - a.z) * f }; };
    const moving = (who, t) => timed.some(({ move, steps }) => move.person === who && t < steps.at(-1) && steps.at(-1) > 0.05);
    const speakers = [...new Set(said.map(line => line.who).filter(Boolean))];
    let from = 0;
    for (const line of said) {
      const span = ((length - 0.6) * line.text.length) / chars, mid = from + span / 2, who = line.who, others = speakers.filter(other => other !== who);
      tally.spoken += span;
      if (who && moving(who, mid)) tally.speakerMoving += span;
      if (who && moving(who, mid) && others.some(other => moving(other, mid))) tally.together += span;
      if (![who, ...others].filter(Boolean).some(person => moving(person, mid))) tally.still += span;
      const p = who ? placeAt(who, mid) : null, near = others.map(other => placeAt(other, mid)).filter(Boolean).map(q => p ? Math.hypot(p.x - q.x, p.z - q.z) : null).filter(d => d !== null);
      if (near.length) tally.apart.push(Math.min(...near));
      from += span;
    }
    for (const { move } of timed) where[move.person] = move.path.at(-1);
  });
  const share = value => (tally.spoken ? Math.round((100 * value) / tally.spoken) : 0);
  const apart = [...tally.apart].sort((a, b) => a - b);
  return { spokenSeconds: Math.round(tally.spoken), speakerMoving: share(tally.speakerMoving), together: share(tally.together), standingStill: share(tally.still), partnersApartMedian: apart.length ? Math.round(apart[Math.floor(apart.length / 2)]) : null, partnersApartMax: apart.length ? Math.round(apart.at(-1)) : null };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [pageFile, specFile, outDir] = process.argv.slice(2).map(path => resolve(path));
  if (!outDir) { console.error('usage: node engine/director/moving-talk.mjs <run page.json> <spec.json> <out-dir>'); process.exit(2); }
  const page = JSON.parse(await readFile(pageFile, 'utf8')), spec = JSON.parse(await readFile(specFile, 'utf8'));
  const { inlineStrand } = await import(pathToFileURL(join(repository, 'engine', 'world', 'export-strand-demo.mjs')).href);
  const { VENDOR_FILES } = await import(pathToFileURL(join(repository, 'engine', 'live', 'sim-jev.mjs')).href);
  const template = await readFile(join(repository, 'engine', 'view', 'strand-demo.html'), 'utf8');
  await mkdir(outDir, { recursive: true });
  const made = [];
  for (const sample of spec.samples) {
    const cut = sliceScene(page, sample.scene), unit = sample.stage ? stageUnit(cut, { ...sample.stage, route: sample.stage.route ?? routeOf(cut.scenes[0], sample.stage.routeOf) }) : cut;
    for (const option of sample.options) {
      const data = sample.stage ? stagePhases(unit, option.id, sample.stage.phases, sample.stage.route ?? routeOf(cut.scenes[0], sample.stage.routeOf)) : stageOption(unit, option.id, { ...sample, ...option });
      const file = `${sample.id}-${option.id}.html`;
      await writeFile(join(outDir, file), inlineStrand(template, data, { name: `${sample.title} · ${option.id}`, vendor: true }));
      made.push({ sample: sample.id, option: option.id, file, cards: data.scenes[0].events.length, moves: data.scenes[0].events.reduce((n, event) => n + event.moves.length, 0), ...talkInMotion(data) });
    }
  }
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(outDir, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(outDir, 'vendor', path)); }
  await writeFile(join(outDir, 'clips.json'), JSON.stringify({ made }, null, 1));
  for (const row of made) console.log(JSON.stringify(row));
}
