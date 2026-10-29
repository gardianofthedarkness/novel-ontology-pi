/**
 * The stage simulation decided live, as `novel sim pick` runs it, and what a running `novel sim pick|run` is doing, for the
 * host's live page.
 *
 * simulateLine: one story line's page (the engine's player, inlined) in capture mode in headless Chrome, served on loopback
 * with three.js beside it, walked forward event by event: on a picture of each event as it begins, Jev decides where the
 * people go, where the things it mentions stand (playground/two-view-things.mjs) and where its fight hits and how big
 * (playground/impact-choices.mjs); the engine plays the event with those answers and the next event begins from what it made.
 * Every answer is saved as it comes (stage/sim-decisions.json, stage/thing-boxes.json, stage/impacts.json, which the engine
 * reads), chained to the answers before it, so a stopped run continues and a changed answer is followed by fresh ones.
 *
 * createLive: what a running command is doing (stage/simulation/live.json) and a recording of every question Jev was asked
 * and what each answer made, with their pictures (stage/simulation/live/), which the host's play/live page shows live or
 * replays. Nothing reads them back. Derived view data like the runs, private with the book.
 */
import { createHash } from 'node:crypto';
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { compactData, inlineStrand, runStrand } from './export-strand-demo.mjs';
import { fightWork, pickImpacts, SIZES } from './impact-choices.mjs';
import { browser, CHROME, pickModels, placementWork, placeThings, serve } from './two-view-things.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
/** Box questions need Jev 1.14; the analysis keeps its own pinned model. */
export const PICKER_MODEL = 'jev-1.14.0';
/** three.js for a player page, from the app's own dependency: only the files the page imports (path beside the page → file in the repository). */
export const VENDOR_FILES = {
  'three.module.js': 'apps/playground/node_modules/three/build/three.module.js',
  'three.core.js': 'apps/playground/node_modules/three/build/three.core.js',
  'addons/controls/OrbitControls.js': 'apps/playground/node_modules/three/examples/jsm/controls/OrbitControls.js',
};
/** How many pictures of one question the live page shows. */
export const LIVE_PICTURES = 4;

/** A file replaced whole, so a reader never sees half of it. */
async function replace(file, body) {
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, body, { mode: 0o644 });
  await rename(temporary, file);
}

/** As the movement step: someone the event names moves on an even chance, anyone else only above 0.8. */
const MOVE_THRESHOLD = { named: 0.5, other: 0.8 };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
const probabilities = answer => answer?.distribution && Object.keys(answer.distribution).length ? Object.fromEntries(Object.entries(answer.distribution).map(([key, p]) => [key, Math.round(p * 1000) / 1000])) : typeof answer?.value === 'string' ? { [answer.value]: 1 } : {};

/**
 * One story line simulated forward in story time, every decision made by Jev on a picture of the world as it stands
 * (`strand`: from, to, fork, as runStrand takes it). Before the walk, which model each thing is drawn as (not tied to a
 * moment). Then event by event, on the event as it begins (people where earlier moves left them, things where earlier
 * answers put them, buildings as earlier blasts left them):
 *   people: who moves, to which of the place's spots (pinned and named on the picture), how and which way: one call;
 *   things: where each thing the event mentions stands (placeThings);
 *   fights: where the event's fight hits and how big (pickImpacts);
 * then the engine plays the event with those answers, the next event begins from what it made, and the live record gets the
 * event's step (its end, each move's path drawn on it). Each event's answers are kept with the chain of every answer before
 * it (stage/sim-decisions.json: the movement; stage/thing-boxes.json, stage/impacts.json: things and fights): an answer whose
 * chain changed (an earlier answer, or the book, did) is asked again; the rest are reused, so a stopped run continues where
 * it stopped. Questions stop being started once `budget` calls are spent. Returns the calls made, what was asked, reused and
 * left, and how many events were stepped.
 */
export async function simulateLine(novelDir, strand, { jev, budget = Infinity, live = null, log = () => {} }) {
  await access(CHROME).catch(() => { throw new Error(`The pictures Jev answers on are drawn by Google Chrome, headless, which is not at ${CHROME} (NOVEL_CHROME names another).`); });
  const { MANNERS, DIRECTIONS, DIRECTION_HINT } = await import(pathToFileURL(join(repository, 'dist', 'src', 'ground', 'stage', 'holoNav.js')).href);
  const work = await mkdtemp(join(tmpdir(), 'sim-live-'));
  const template = await readFile(join(repository, 'playground', 'strand-demo.html'), 'utf8');
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  const boxesFile = join(novelDir, 'stage', 'thing-boxes.json'), impactsFile = join(novelDir, 'stage', 'impacts.json'), decisionsFile = join(novelDir, 'stage', 'sim-decisions.json');
  const boxes = JSON.parse(await readFile(boxesFile, 'utf8').catch(() => 'null')) ?? {};
  const models = { ...(boxes.models ?? {}) }, placements = { ...(boxes.placements ?? {}) };
  const fights = { ...(JSON.parse(await readFile(impactsFile, 'utf8').catch(() => 'null'))?.fights ?? {}) };
  const decisions = { ...(JSON.parse(await readFile(decisionsFile, 'utf8').catch(() => 'null'))?.events ?? {}) };
  const saveBoxes = () => replace(boxesFile, JSON.stringify({ ...boxes, version: 1, model: jev.modelId, askedAt: new Date().toISOString(), models, placements }, null, 1));
  const saveImpacts = () => replace(impactsFile, JSON.stringify({ version: 1, model: jev.modelId, askedAt: new Date().toISOString(), sizes: SIZES, fights }, null, 1));
  const saveDecisions = () => replace(decisionsFile, JSON.stringify({ version: 1, model: jev.modelId, askedAt: new Date().toISOString(), events: decisions }, null, 1));
  await writeFile(join(work, 'index.html'), '');
  const { server, url } = await serve(join(work, 'index.html'), join(work, 'vendor'));
  const chrome = await browser();
  const stop = () => void chrome.close().finally(() => process.exit(143));
  process.once('SIGTERM', stop);
  // The line as the engine makes it now, with every answer so far, in capture mode; with `until` (one of its events), only as
  // far as that event (an engine that cannot stop early makes all of it).
  const load = async (until = null) => {
    // The world as the engine plays it goes to the live record too (live/world.json), for the live view of the world.
    const data = await runStrand(novelDir, strand, { ...(until ? { until: { scene: until.scene, event: until.index } } : {}), ...(live ? { live: (snapshot, page) => live.world(snapshot, page) } : {}) });
    await writeFile(join(work, 'index.html'), inlineStrand(template, data, { vendor: true }));
    await chrome.evaluate('delete window.__stage').catch(() => {});
    await chrome.open(url);
    return { data, stage: await chrome.evaluate('({ things: window.__stage.things, places: window.__stage.places, scenes: window.__stage.scenes, fights: window.__stage.fights })') };
  };
  const capture = options => chrome.evaluate(`window.__stage.capture(${JSON.stringify(options)})`);
  live?.encoder(png => chrome.evaluate(`(async () => { const image = new Image(); image.src = 'data:image/png;base64,${png}'; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL('image/jpeg', 0.78).split(',')[1]; })()`));
  const after = live ? async done => {
    const view = outcomeView(done);
    if (view.capture) await capture(view.capture);
    await live.outcome({ subject: view.subject, text: view.text, ...(view.capture ? { picture: await chrome.still('jpeg'), jpeg: true } : {}) });
  } : null;
  try {
    // The page loaded has every answer so far and reaches event `through` of the line (all of it at first).
    let { data, stage } = await load(), calls = 0, through = Infinity;
    await live?.phase('models');
    const picked = await pickModels({ chrome, jev, stage, models, limit: budget, log });
    calls += picked;
    if (picked) { await saveBoxes(); ({ data, stage } = await load()); }
    // The whole line as first made: what each event is (its text, its people, the things it places, its fight), which answers do not change.
    const line = { data, stage };
    const counts = { events: { asked: 0, reused: 0, left: 0 }, placements: { asked: 0, reused: 0, failed: 0, left: 0 }, fights: { asked: 0, reused: 0, left: 0 } };
    let chain = hash(['line', strand.from, strand.to, strand.fork ?? null]), stepped = 0, stopped = null;
    const events = line.data.scenes.flatMap(scene => scene.events.map((event, index) => ({ scene: scene.id, index, id: event.id })));
    for (const [position, { scene: sceneId, index, id }] of events.entries()) {
      const scene = line.data.scenes.find(entry => entry.id === sceneId), event = scene.events[index], key = `${sceneId}|${index}`, place = line.stage.places[scene.place];
      chain = hash([chain, key, id, event.text]);
      const things = placementWork(line.stage).filter(item => item.spot.scene === sceneId && item.spot.event === index), hits = fightWork(line.stage).filter(item => item.fight.scene === sceneId && item.fight.event === index);
      const people = [...new Set([...event.actors, ...scene.cast])].filter(person => line.data.people[person]), hasSpots = (event.spots ?? scene.spots ?? []).length > 0;
      // What was answered at this event, by the answers' own keys (a fight Jev said breaks nothing is gone from the page, but its
      // answer stays): the digest the chain carries on.
      const answered = () => [decisions[key]?.moves ?? null, Object.keys(placements).filter(name => name.startsWith(`${key}|`)).sort().map(name => [name, placements[name]?.box ?? null]), fights[key]?.sphere ?? fights[key]?.none ?? null];
      // Answers made on another world than this one (an earlier answer or the book changed, or made before answers were chained) are asked again.
      if (decisions[key]?.chain !== chain) {
        delete decisions[key];
        for (const name of Object.keys(placements)) if (name.startsWith(`${key}|`)) delete placements[name];
        delete fights[key];
      }
      const ask = { people: people.length && hasSpots && !decisions[key]?.moves, things: things.filter(item => placements[item.key]?.inputs !== item.inputs), fights: hits.filter(item => !fights[item.key]) };
      if (!ask.people && !ask.things.length && !ask.fights.length) {
        if (decisions[key]) counts.events.reused++; else { decisions[key] = { chain, scene: sceneId, event: id }; await saveDecisions(); }
        counts.placements.reused += things.length; counts.fights.reused += hits.length;
        chain = hash([chain, ...answered()]);
        continue;
      }
      if (calls >= budget) { stopped = position; break; }
      // The page as far as this event, with every answer so far (the world as it stands when the event begins).
      if (through < position) { ({ data, stage } = await load(events[position])); through = position; }
      // The spots people may go to: the event's own when the engine gives them (taken around where its people stand), else the scene's.
      const here = data.scenes.find(entry => entry.id === sceneId), spots = here.events[index].spots ?? here.spots ?? [];
      const label = `${scene.label ?? sceneId} · event ${index + 1}`;
      await live?.phase(`people · ${label}`);
      let moves = decisions[key]?.moves ?? null;
      if (ask.people) {
        // People: on the event as it begins, before its own hit, with the spots they may go to pinned and named.
        // Spots that come to the same place on the graph share one pin, named for all of them.
        const pins = [...Map.groupBy(spots, spot => spot.node)].map(([node, same]) => ({ node, label: same.map(spot => spot.label).join(' / ') })), pinOf = spot => pins.find(pin => pin.node === spot.node).label;
        await capture({ id: `${key}#now`, scene: sceneId, event: index, place: scene.place, mask: true, beforeHit: true, pins });
        const now = await chrome.still(), name = person => line.data.people[person].name;
        const questions = people.flatMap((person, n) => [
          { key: `moves_${n}`, primitive: 'noul', label: `${name(person)} moves`, instructions: `In this event, does ${name(person)} go to a different spot of the place (walk, run, climb, go down, fall, get dragged or teleport)? Talking, looking, or acting in place is not moving.` },
          { key: `to_${n}`, primitive: 'choice', label: `${name(person)} to`, instructions: `Which pinned spot in picture "now" is ${name(person)} at when this event ends (the one they are at, if they do not move)?`, options: spots.map(spot => spot.id), optionHints: Object.fromEntries(spots.map(spot => [spot.id, `${spot.id}: the pin named ${pinOf(spot)}${spot.hint ? `, ${spot.hint}` : ''}`])) },
          { key: `how_${n}`, primitive: 'choice', label: `${name(person)} how`, instructions: `How does ${name(person)} get there?`, options: [...MANNERS] },
          { key: `dir_${n}`, primitive: 'choice', label: `${name(person)} way`, instructions: `Which way does ${name(person)} go in this event? ${DIRECTIONS.map(direction => `${direction}: ${DIRECTION_HINT[direction]}`).join('; ')}.`, options: [...DIRECTIONS] },
        ]);
        const answers = new Map((await jev.decide([
          `A still of a 3D model of a place in a novel, as an event begins: where the people are now, and where they can go.`,
          `Place: ${place.path.join(' › ')} (${place.kind} of ${place.lots} buildings). Blue lattices are the buildings' corridors and orange their stairs; gold shapes are things already there; small labelled dots are people where they are now; gold pins are the spots of the place, each named.`,
          `Event: ${event.text}`,
          `People here: ${people.map(name).join(', ')}.`,
          `Picture "now": the place as this event begins.`,
        ].join('\n'), questions, { images: { now } })).map(answer => [answer.key, answer]));
        calls++; counts.events.asked++;
        moves = Object.fromEntries(people.map((person, n) => {
          const p = Math.round(Number(answers.get(`moves_${n}`)?.value ?? 0) * 1000) / 1000, how = String(answers.get(`how_${n}`)?.value ?? 'walk');
          return [person, p >= (event.actors.includes(person) ? MOVE_THRESHOLD.named : MOVE_THRESHOLD.other) ? { moves: p, to: probabilities(answers.get(`to_${n}`)), how: MANNERS.includes(how) ? how : 'walk', direction: probabilities(answers.get(`dir_${n}`)) } : { moves: p }];
        }));
      } else counts.events.reused++;
      decisions[key] = { chain, scene: sceneId, event: id, ...(moves ? { moves } : {}) };
      await saveDecisions();
      // Things and fights: on the same moment (the event as it begins), with the people where they are.
      if (ask.things.length) {
        await live?.phase(`things · ${label}`);
        const only = new Set(ask.things.map(item => item.key));
        const done = await placeThings({ chrome, jev, stage: { ...stage, things: stage.things.map(thing => ({ ...thing, placed: thing.placed.filter(spot => only.has(`${spot.scene}|${spot.event}|${thing.name}`)) })) }, models, placements, save: saveBoxes, budget: budget - calls, log, after });
        calls += done.calls; counts.placements.asked += done.asked; counts.placements.failed += done.failed; counts.placements.left += done.left;
      }
      counts.placements.reused += things.length - ask.things.length;
      if (ask.fights.length) {
        await live?.phase(`fights · ${label}`);
        const done = await pickImpacts({ chrome, jev, stage: { ...stage, fights: ask.fights.map(item => item.fight) }, fights, save: saveImpacts, budget: budget - calls, log, after });
        calls += done.calls; counts.fights.asked += done.asked; counts.fights.left += done.left;
      }
      counts.fights.reused += hits.length - ask.fights.length;
      // The budget ran out inside this event: stop here, so the next run takes it up again before anything after it is asked.
      if (counts.placements.left || counts.fights.left) { stopped = position; break; }
      chain = hash([chain, ...answered()]);
      // The event played with its answers: its end, with each move's path drawn, as the next event begins from it. When
      // nothing in it changed the world (nobody moves, now or as the page last played it; nothing placed or hit), the page
      // as it is already begins the next event.
      const movers = Object.values(moves ?? {}).filter(answer => answer.to).length, played = here.events[index].moves.length;
      if (!movers && !played && !ask.things.length && !ask.fights.length) continue;
      // One run as far as the next event: this one's end, and the world as the next begins.
      const next = events[position + 1] ?? null;
      ({ data, stage } = await load(next ?? events[position]));
      through = next ? position + 1 : position;
      if (live) {
        await live.phase(`step · ${label}`);
        const played = data.scenes.find(entry => entry.id === sceneId).events[index];
        await capture({ id: `${key}#look`, scene: sceneId, event: index, place: scene.place, mask: true });
        const length = (await chrome.evaluate(`window.__stage.moves(${JSON.stringify({ camera: `${key}#look`, scene: sceneId, event: index })})`)).seconds;
        await capture({ id: `${key}#end`, scene: sceneId, event: index, place: scene.place, mask: true, play: Math.max(0.05, length - 0.05) });
        const shown = await chrome.evaluate(`window.__stage.moves(${JSON.stringify({ camera: `${key}#end`, scene: sceneId, event: index })})`);
        const said = [...shown.moves.map(move => `${move.name} → ${move.spot} (${move.how})`), ...things.filter(item => placements[item.key]?.box).map(item => `${item.thing.name} placed`), ...(played.hit?.sphere ? [`a ${played.hit.sphere.r * 2} m blast`] : [])];
        await live.frame({ kind: 'step', subject: label, text: said.join('; ') || 'nobody moves', context: [`Place: ${place.path.join(' › ')}`, `Event: ${event.text.slice(0, 400)}`],
          pictures: [{ name: 'end', picture: await chrome.still('jpeg'), jpeg: true }],
          moves: shown.moves.map(move => ({ person: move.person, name: move.name, color: move.color, how: move.how, spot: move.spot, from: move.from, to: move.to, overlays: { end: { path: move.path, ensemble: move.ensemble } } })) });
        stepped++;
      }
    }
    // Stopped at the budget: the events from there on are still to be decided (an over-count: some may only need checking).
    if (stopped !== null) counts.events.left = events.length - stopped;
    const unmodelled = line.stage.things.filter(thing => thing.placed.length && !models[thing.name]).length;
    return { calls, models: { picked, left: unmodelled }, ...counts, stepped, left: unmodelled + counts.events.left + counts.placements.left + counts.fights.left };
  } finally {
    process.off('SIGTERM', stop);
    live?.encoder(null);
    await chrome.close();
    server.close();
    await rm(work, { recursive: true, force: true });
  }
}

/** What a question is about, in a few words for the live page's list: the thing, or the start of the event. */
const subjectOf = context => context.find(line => line.startsWith('Thing: '))?.slice(7).split(',')[0] ?? context.find(line => line.startsWith('A thing a novel mentions: '))?.slice(26).split(',')[0] ?? context.find(line => line.startsWith('People here: '))?.slice(13, 53) ?? context.find(line => line.startsWith('Event: '))?.slice(7, 47) ?? '';
const round = value => Math.round(value * 10) / 10;

/**
 * The live record of a running `novel sim pick|run` (`command`), on story lines `lines` ([{ id, title }]):
 *   stage/simulation/live.json        the command, its lines and their state, the calls spent, the question Jev is on, the latest frames;
 *   stage/simulation/live/frames.jsonl every frame so far, across commands, for the replay: a question (its pictures, what it is about,
 *                                     the questions, Jev's answers and how long they took), an outcome (a picture of what came out)
 *                                     or an event's moves (pictures at its start and end, each move's path on them, Jev's movement answers);
 *   stage/simulation/live/frames/     the frames' pictures, <frame>-<n>.jpg (or .png when no browser could re-encode them).
 * `watch(jev)` gives a model that records each question before passing it on; `outcome()` records what an answer made and
 * `frame()` any other frame (an event's moves). Writes
 * never fail the command: the record is for watching only.
 */
export async function createLive(novelDir, { command, lines, budget = null, model = null }) {
  const folder = join(novelDir, 'stage', 'simulation'), recording = join(folder, 'live'), pictures = join(recording, 'frames');
  await mkdir(pictures, { recursive: true });
  const at = () => new Date().toISOString();
  const recorded = await readFile(join(recording, 'frames.jsonl'), 'utf8').catch(() => '');
  let frame = recorded ? recorded.trimEnd().split('\n').length : 0, encode = null;
  const state = { version: 2, command, status: 'running', pid: process.pid, startedAt: at(), updatedAt: at(), model, budget, calls: 0, lines: lines.map(line => ({ ...line, status: 'waiting' })), line: null, phase: null, frames: frame, ask: null, log: [] };
  let writing = Promise.resolve();
  const queue = work => (writing = writing.then(work).catch(() => {}));
  const write = () => queue(() => { state.updatedAt = at(); return replace(join(folder, 'live.json'), JSON.stringify(state)); });
  // A frame's pictures, re-encoded small when a browser is at hand; their names beside the page.
  const keep = async (f, images) => Promise.all(images.slice(0, LIVE_PICTURES).map(async ([name, png], index) => {
    const jpeg = encode ? await encode(png).catch(() => null) : null, file = `frames/${f}-${index}.${jpeg ? 'jpg' : 'png'}`;
    await writeFile(join(recording, file), Buffer.from(jpeg ?? png, 'base64'), { mode: 0o644 }).catch(() => {});
    return { name, file };
  }));
  const record = entry => {
    state.frames = entry.f + 1;
    state.log.unshift({ f: entry.f, kind: entry.kind, at: entry.at, line: entry.line, phase: entry.phase, subject: entry.subject, ...(entry.kind === 'ask' ? { answers: entry.answers.map(({ key, value, confidence }) => ({ key, value, confidence })) } : { text: entry.text }) });
    state.log.length = Math.min(state.log.length, 40);
    return queue(async () => { await writeFile(join(recording, 'frames.jsonl'), `${JSON.stringify(entry)}\n`, { flag: 'a', mode: 0o644 }); }).then(write);
  };
  await write();
  return {
    state,
    line(index, patch) { state.line = index; Object.assign(state.lines[index], patch); return write(); },
    phase(name) { state.phase = name; return write(); },
    finish(status, extra = {}) { state.status = status; state.phase = null; Object.assign(state, extra); return write(); },
    /** How pictures are made small for the record (base64 PNG in, base64 JPEG out): set once a browser is open, cleared when it closes. */
    encoder(fn) { encode = fn; },
    /** A frame that is not a question (an outcome, an event's moves): its pictures (base64 PNG or JPEG) and what it shows. */
    async frame({ kind, subject, text, context = [], pictures = [], answers = null, moves = null }) {
      const f = frame++, files = [];
      for (const [index, { name, picture, jpeg = false }] of pictures.slice(0, LIVE_PICTURES).entries()) {
        const file = `frames/${f}-${index}.${jpeg ? 'jpg' : 'png'}`;
        await writeFile(join(recording, file), Buffer.from(picture, 'base64'), { mode: 0o644 }).catch(() => {});
        files.push({ name, file });
      }
      return record({ f, kind, at: at(), line: state.line, phase: state.phase, subject, text, ...(context.length ? { context } : {}), pictures: files, ...(answers ? { answers } : {}), ...(moves ? { moves } : {}) });
    },
    /**
     * The world as the engine stands it at a moment (export-strand-demo.mjs's snapshot): written whole to live/world.json, which
     * the live view of the world reads; live.json says which run and moment it is.
     */
    world(snapshot, page = null) {
      const run = (state.world?.run ?? 0) + 1, before = state.world?.notes ?? { chunks: 0, lots: 0 };
      state.world = { run, moment: snapshot.moment, final: snapshot.final, focus: snapshot.focus, notes: snapshot.notes, page: page ? run : state.world?.page ?? null };
      // The world's growth, one line a snapshot (live/world-log.jsonl, kept with the book): how much stands and what is new,
      // so how the city was built up, piece by piece, can be checked afterwards.
      const grown = { run, at: at(), command, moment: snapshot.moment, place: snapshot.placeLabel, focus: snapshot.focus, chunks: snapshot.notes.chunks, lots: snapshot.notes.lots, nodes: snapshot.notes.nodes, newChunks: snapshot.notes.chunks - before.chunks, newLots: snapshot.notes.lots - before.lots, broken: snapshot.broken.length, earlier: snapshot.notes.applied };
      queue(() => writeFile(join(recording, 'world-log.jsonl'), `${JSON.stringify(grown)}\n`, { flag: 'a', mode: 0o644 }));
      // With the page so far (the player's data as far as this moment), the live player draws it in full (live/page.json).
      return queue(async () => { await replace(join(recording, 'world.json'), JSON.stringify({ ...snapshot, run, at: at() })); if (page) await replace(join(recording, 'page.json'), JSON.stringify({ ...compactData(page), live: { run, moment: snapshot.moment, focus: snapshot.focus, final: snapshot.final } })); }).then(write);
    },
    /** What an answer made, as a picture and a line of text. */
    outcome({ subject, text, picture = null, jpeg = false }) { return this.frame({ kind: 'outcome', subject, text, pictures: picture ? [{ name: 'outcome', picture, jpeg }] : [] }); },
    watch(jev) {
      return {
        modelId: jev.modelId,
        async decide(text, questions, options = {}) {
          const f = frame++, started = Date.now(), context = text.split('\n').filter(line => /^(Place|Event|Thing): |^A thing a novel mentions: /.test(line)).map(line => line.slice(0, 400));
          const files = await keep(f, Object.entries(options.images ?? {}));
          state.calls++;
          state.ask = { f, at: at(), call: state.calls, line: state.line, phase: state.phase, subject: subjectOf(context), context, pictures: files, questions: questions.map(question => ({ key: question.key, primitive: question.primitive, ...(question.label ? { label: question.label } : {}), instructions: String(question.instructions).slice(0, 300), ...(question.options ? { options: question.options.length } : {}) })), answers: null };
          await write();
          try {
            const answers = await jev.decide(text, questions, options);
            state.ask.answers = answers.map(answer => ({ key: answer.key, value: typeof answer.value === 'number' ? Math.round(answer.value * 100) / 100 : answer.value, confidence: answer.confidence ?? null,
              ...(answer.box ? { box: answer.box } : {}), ...(answer.distribution ? { top: Object.entries(answer.distribution).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([option, p]) => [option, Math.round(p * 100) / 100]) } : {}) }));
            state.ask.ms = Date.now() - started;
            await record({ ...state.ask, kind: 'ask' });
            return answers;
          } catch (error) {
            state.ask.error = String(error?.message ?? error).slice(0, 200);
            await write();
            throw error;
          }
        },
      };
    },
  };
}

/** What a placement or a fight came to, for the live record: the capture options that draw it and a line saying it. */
export function outcomeView({ kind, key, base, thing, record, box, none, focus, chosen, sphere }) {
  if (kind === 'fight') return none ? { subject: key, text: 'no damage' } : { subject: key, text: `hits ${chosen}: a ${sphere.r * 2} m blast`, capture: { ...base, id: `${key}#outcome`, focus, radius: 22, spheres: [{ ...sphere, outline: true, label: `${sphere.r * 2} m` }] } };
  if (!box) return { subject: thing, text: record?.spots?.length ? 'no place came out' : 'no spot to stand on' };
  const size = `${round(box.x[1] - box.x[0])}×${round(box.z[1] - box.z[0])}×${round(box.y[1] - box.y[0])} m`, where = record?.universe ? 'out in space' : record?.chosen === 'sky' ? `in the sky, ${round(box.y[0])} m up` : `at ghost ${record?.chosen}, ${round(box.y[0])} m up`;
  return { subject: thing, text: `${size}, ${where}`, capture: { ...base, mask: true, id: `${key}#outcome`, focus: { x: (box.x[0] + box.x[1]) / 2, y0: box.y[0], z: (box.z[0] + box.z[1]) / 2, w: box.x[1] - box.x[0], h: box.y[1] - box.y[0], d: box.z[1] - box.z[0] }, solved: box } };
}
