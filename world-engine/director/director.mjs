// The director's loop (docs/v2/director-camera.md; the user's design, 2026-11-02): a line's scenes played forward card by
// card on the world the terrain built, people starting where spawning put them. Only dialogue and action cards are played:
// - an action card: each person acting is asked, on the camera operator's shots (src/v2/context/camera.ts), which way they
//   go (fourteen lettered arrows, stays, or with someone), then where (a spot inside the arrow's wedge), and only when no
//   spot fits, a rough box on a plan and then the exact box and its height (src/v2/context/directorModes.ts);
// - a dialogue card: those spoken to come within speaking distance of the speaker (a rule, no question).
// Each move is walked on the world's path integral (its windowed walk graph, rooms through their doors). Nothing is
// replayed: the engine is built once (export-strand-demo.mjs's `engine` hook) and the page written once a scene.
//   npm run build && node world-engine/director/director.mjs <novel-dir> --reading <reading>/v2/data.json --from <scene> --to <scene>
//     [--budget 60] [--stand-in] [--live] [--pace 6] [--agent <host state>] [--no-digest] [--no-speakers]
// --no-digest: without the summarizer (digest.mjs), the pass and Jev's text questions as before; --no-speakers: no line's
// speaker settled or held for the review (a run on actions and items).
// --pace: seconds the live view is given to play each move before the next question (6 with --live).
// --stand-in answers every question by rule (no model call), for trying the loop; without it Jev is asked (paid).
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const C = await load('dist/src/v2/context/camera.js'), M = await load('dist/src/v2/context/directorModes.js'), { ask } = await load('dist/src/v2/context/engine.js');
const S = await load('dist/apps/playground/src/data/skeleton.js'), { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
const { strandDemo, inlineStrand } = await import('../world/export-strand-demo.mjs');
const { browser, serve } = await import('../view/two-view-things.mjs');
const { VENDOR_FILES, PICKER_MODEL, retried } = await import('../live/sim-jev.mjs');
const { passScene } = await import('./pass.mjs');
const { withSystem2 } = await import('./system2.mjs');
const { writeWorldLog } = await import('../log/write-log.mjs');
const R = await import('../review/review.mjs'), C6 = await import('../review/canon.mjs'), SM = await import('../smoother/smoother.mjs'), OC = await import('../smoother/occupation.mjs');
const DG = await import('../digest/digest.mjs'), FA = await import('../digest/facts.mjs');
import { copyFile } from 'node:fs/promises';

const CELL = 2, FLOOR = 3, PRESENT = new Set(['speaks', 'acts', 'addressed']);
// The digest's moves played: at least this sure (below it, motion read into a spoken line or a thought).
const MOVE_SURE = 0.5;
const seeded = text => { let h = 2166136261; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } let s = h >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const round = value => Math.round(value * 10) / 10;

/**
 * A stand-in director (no model), answering about as the text does: the pass finds a move in one sentence of twelve, a card
 * goes somewhere one time in three and breaks something one time in fifteen; arrows by turn; every other spot question
 * answered "none" so the boxes are tried too.
 */
export function standIn() {
  let n = 0;
  return { modelId: 'stand-in-director', async decide(_state, questions) {
    n++;
    return questions.map((question, k) => {
      if (question.primitive === 'box') return { key: question.key, value: { left: 0.42, top: 0.42, right: 0.58, bottom: 0.58 }, box: { left: 0.42, top: 0.42, right: 0.58, bottom: 0.58 }, confidence: 0.5 };
      const options = question.options ?? [], turn = n + k;
      const value = question.key.endsWith('|show') ? (turn % 12 ? 'none' : 'moves') : question.key === 'moves' ? (n % 3 ? 'stays' : 'goes') : question.key === 'breaks' ? (n % 15 ? 'no' : 'yes')
        : question.key === 'direction' ? options[n % Math.min(6, options.length)] : question.key === 'spot' ? (n % 2 ? options[0] : 'none') : question.key === 'how' ? 'walk'
        : question.key === 'height' ? (options.find(o => /ground/.test(question.optionHints?.[o] ?? '')) ?? options[0]) : options[0];
      return { key: question.key, value, confidence: 0.5 };
    });
  } };
}

/** The reader's view of a reading: kinds, marks (not everyday things) and the names they point at. */
export async function readerView(reading, text) {
  const { sentenceMarks } = await import('../../experiments/v2/marks.mjs');
  const marks = Object.fromEntries(Object.entries(await sentenceMarks(reading, text)).map(([id, found]) => [id, found.filter(([, , type]) => type !== 'r')]).filter(([, found]) => found.length));
  const names = Object.fromEntries([...reading.chart.entities.map(entity => [entity.id, [entity.proper?.[0] ?? entity.names?.[0] ?? entity.id, entity.category ?? null]]), ...(reading.slots ?? []).map(slot => [slot.id, [slot.label, slot.kind ?? 'person']])]);
  return { version: 2, kinds: Object.fromEntries(Object.entries(reading.kinds ?? {}).map(([id, entry]) => [id, entry.kind])), marks, names };
}

export async function direct(novelDir, { reading, readingPath = null, from, to, jev, workModel = null, budget = Infinity, live = null, pace = 0, agent = null, digest = true, speakers = true, log = console.error }) {
  // A card's line with its kind (spoken, action, environment, thought, fact, narration) and, spoken, who says it: the
  // reader colours sentences by kind, and the page puts a spoken line in a bubble over its speaker.
  // Who says a line is the reading's (EM², a Jev question during extraction): its answer and how sure; below its accept
  // threshold no one.
  const spoken = id => (reading.roles?.[id]?.kind === 'spoken' ? reading.roles[id].who ?? null : null);
  // Where the reading is unsure, the speaker the world settled on the last run (W6, speakers.mjs), marked as the world's.
  const settledSpeakers = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'speakers.json'), 'utf8').catch(() => '{}')).lines ?? {};
  const text = await loadWorkspaceSentences(novelDir), line = id => ({ id, text: text.get(id)?.text ?? '', kind: reading.kinds?.[id]?.kind ?? null, ...(spoken(id)?.id ? { who: spoken(id).id } : settledSpeakers[id]?.who ? { who: settledSpeakers[id].who, by: settledSpeakers[id].by } : {}), ...(spoken(id) ? { sure: spoken(id).confidence ?? null } : {}) });
  const names = new Map([...reading.chart.entities.map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]), ...(reading.slots ?? []).map(slot => [slot.id, slot.label])]);
  const nameForms = new Map(reading.chart.entities.map(entity => [entity.id, [...new Set([...(entity.proper ?? []), ...(entity.names ?? [])])].filter(form => form.length >= 2)]));
  const sceneOf = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
  const cardsOf = new Map();
  for (const card of reading.cards) { const id = sceneOf.get(card.first); if (id && ['action', 'dialogue'].includes(card.kind)) (cardsOf.get(id) ?? cardsOf.set(id, []).get(id)).push(card); }
  const out = join(novelDir, 'stage', 'director'), shots = join(out, 'shots'), work = join(out, 'page');
  await mkdir(shots, { recursive: true }); await mkdir(work, { recursive: true });
  // The reading as the reader shows it over the whole book (World · Live's play/reading.json): every sentence's kind, and the
  // names, descriptions and times detected in it with whom or what they mean (experiments/v2/marks.mjs, as the reading's page).
  await writeFile(join(out, 'reading.json'), JSON.stringify(await readerView(reading, new Map([...text].map(([id, entry]) => [id, entry.text])))));
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  const template = await readFile(join(repository, 'world-engine', 'view', 'strand-demo.html'), 'utf8');
  const record = { version: 1, model: jev.modelId, from, to, startedAt: new Date().toISOString(), scenes: [] };
  // The review (Track B W5, review.mjs): the main agent's answers since the last run become pins under the laws, and the
  // director plays by them: presence, remote actors, talk kinds, arrivals, stays. Back-propagation is Bayesian smoothing
  // (W5b, smoother.mjs): the last run smoothed with every observation it had (the review's pins among them), each scene
  // starts its people where the least-action history has them, a revision above the limit held for the review; who is on
  // the stage is smoothed too (occupation.mjs), and someone surely there whom the script left out is added. The reading
  // played from is recorded for the review CLI (novel reading).
  if (readingPath) await writeFile(join(out, 'reading-path.json'), JSON.stringify({ path: resolve(readingPath) }));
  const reviewed = await R.applyAnswers(novelDir).catch(error => ({ error: String(error.message ?? error) }));
  const pins = await R.loadPins(novelDir), lastRun = await R.latestRun(novelDir);
  const oldLog = lastRun ? (await readFile(join(novelDir, 'stage', 'world', 'log', `${lastRun}.jsonl`), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(row => JSON.parse(row)) : [];
  const oldPage = lastRun ? JSON.parse(await readFile(join(novelDir, 'stage', 'simulation', 'runs', 'director', `${lastRun}.page.json`), 'utf8').catch(() => 'null')) : null;
  // run.json is the last run's record only if that run is the last one played (a stand-in's run is not on the list).
  const lastRecord = lastRun ? JSON.parse(await readFile(join(out, 'run.json'), 'utf8').catch(() => 'null')) : null;
  const oldRecord = lastRecord && `d${String(lastRecord.startedAt).replace(/\D/g, '').slice(0, 14)}` === lastRun ? lastRecord : null;
  const strandsNow = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'strands.json'), 'utf8').catch(() => 'null'));
  const smoothed = oldPage && oldRecord && oldLog.length ? SM.smoothRun({ page: oldPage, log: oldLog, record: oldRecord, reading, strands: strandsNow, pins }) : null;
  // Each scene start the smoothing moved: where the least-action history has them, unless the review kept the history.
  const startsMoved = new Map((smoothed?.revisions ?? []).filter(revision => revision.card === null).map(revision => [`${revision.scene}|${revision.who}`, revision]));
  const onStage = OC.occupation({ reading, script: JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8').catch(() => '{"scenes":[]}')), strands: strandsNow, pins });
  const surelyThere = new Set(onStage.proposals.filter(entry => entry.propose === 'present').map(entry => `${entry.scene}|${entry.who}`));
  record.smoothing = smoothed ? { from: lastRun, moments: Object.values(smoothed.people).reduce((n, list) => n + list.length, 0), revisions: smoothed.revisions.length, starts: startsMoved.size, onStage: onStage.proposals.length } : null;
  record.review = { applied: reviewed, from: lastRun, pins: { present: Object.keys(pins.present).length, remote: Object.keys(pins.remote).length, kind: Object.keys(pins.kind).length, arrive: Object.keys(pins.arrive).length, stays: Object.keys(pins.stays).length, meet: pins.meet.length } };
  record.revisions = [];
  const save = () => writeFile(join(out, 'run.json'), JSON.stringify(record, null, 1));
  // Every run keeps its own records (the user, 2026-11-02: as much record as possible), in stage/director/runs/<run>/:
  // the pins it began with, its log line by line as it plays, and at its end its record, the laws over it and Jev's
  // questions and answers asked in it. Its page, world log, ledger and smoothing are kept by run beside them already.
  const runId = `d${record.startedAt.replace(/\D/g, '').slice(0, 14)}`, runDir = join(out, 'runs', runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(join(runDir, 'pins.json'), JSON.stringify(pins, null, 1));
  const framesFile = join(novelDir, 'stage', 'simulation', 'live', 'frames.jsonl'), framesBefore = (await readFile(framesFile, 'utf8').catch(() => '')).split('\n').filter(Boolean).length;
  const say = log;
  log = (...args) => { say(...args); appendFile(join(runDir, 'run.log'), `${new Date().toISOString()} ${args.map(arg => (typeof arg === 'string' ? arg : JSON.stringify(arg))).join(' ')}\n`).catch(() => {}); };
  log(`run ${runId}: ${from} – ${to}, model ${jev.modelId}${workModel ? `, system 2 ${workModel.modelId ?? 'on'}` : ', system 2 off'}${agent ? ', review sent to the main agent' : ''}`);
  let calls = 0;
  /**
   * What the player shows of the run (strand-demo.html's card list): every card played, in order, with its own lines as
   * written, who moved and what Jev answered, the producer's camera, and its event on the timeline.
   */
  const payload = () => ({ model: record.model, cards: record.scenes.flatMap(scene => scene.cards.map(card => ({ scene: scene.scene, event: card.event, card: card.card, kind: card.pass ? 'pass' : card.kind, lines: card.lines, camera: card.camera ?? null,
    moves: card.moves.map(move => ({ who: move.person, name: names.get(move.person) ?? move.person, moved: !!move.moved, direction: move.direction ?? null, how: move.how ?? null, spot: move.spot ?? null, height: move.height ?? null, boxed: !!move.box, to: move.to ?? null, why: move.why ?? null, line: move.line ?? null })) }))) });
  // Jev's service comes and goes: a request is tried again after a pause (sim-jev.mjs retried).
  // System 2 (system2.mjs, Track B W3): what Jev answers below 0.5 is asked of the work model with the same context; both
  // answers kept with the card (or the scene, for its pass) being asked about.
  let asking = null;
  // What each model used (the user, 2026-11-03: track the cost): the work model's requests and tokens, for system 2 and for
  // the summarizer apart; Jev's calls.
  const workMeter = workModel ? DG.metered(workModel) : null, digestMeter = workModel && digest ? DG.metered(workModel) : null;
  record.usage = { system2: workMeter?.usage ?? null, digest: digestMeter?.usage ?? null, workModel: workModel?.modelId ?? null };
  const asked = withSystem2((state, questions, options) => retried(() => jev.decide(state, questions, options), log), workMeter, { note: entry => { if (asking) (asking.system2 ??= []).push(entry); } });
  // The summarizer (Track A, digest.mjs; the user, 2026-11-03): every scene of the line read by the work model ahead of the
  // play, in reading order, the memory carried from scene to scene; the director waits for a scene's digest when it comes
  // to it. Its moves (graded), facts (stated and implied), items, talk and breaks replace the pass and the text-only
  // questions; Jev still decides on the pictures. Without a work model, the director plays as before.
  const digested = new Map();
  if (digestMeter) {
    const ids = reading.scenes.map(scene => scene.id), lineScenes = reading.scenes.slice(ids.indexOf(from), ids.indexOf(to) + 1);
    const scriptNow = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8').catch(() => '{"scenes":[]}'));
    const cardOfLine = new Map(reading.cards.flatMap(card => card.sentences.map(id => [id, card.id])));
    const peopleOf = scene => {
      const own = scriptNow.scenes.find(entry => entry.id === scene.id), found = new Set([...(own?.present ?? []), ...[...surelyThere].filter(key => key.startsWith(`${scene.id}|`)).map(key => key.slice(scene.id.length + 1)), ...Object.entries(pins.present).filter(([key, value]) => value && key.startsWith(`${scene.id}|`)).map(([key]) => key.slice(scene.id.length + 1))]);
      for (const card of reading.cards) if (sceneOf.get(card.first) === scene.id) for (const person of card.people) if (person.how.some(how => PRESENT.has(how))) found.add(person.id);
      return [...found].filter(id => pins.present[`${scene.id}|${id}`] !== false).map(id => ({ id, name: names.get(id) ?? id }));
    };
    const waiting = new Map(lineScenes.map(scene => { let done; const promise = new Promise(resolve => { done = resolve; }); digested.set(scene.id, promise); return [scene.id, done]; }));
    const kept = {};
    DG.digestScenes(digestMeter, { scenes: lineScenes, line: id => text.get(id)?.text ?? '', kind: id => reading.kinds?.[id]?.kind ?? null, peopleOf, cardOf: cardOfLine,
      placeOf: scene => { const own = scriptNow.scenes.find(entry => entry.id === scene.id); return names.get(own?.place) ?? scriptNow.places?.[own?.place]?.label ?? own?.place ?? ''; },
      whenOf: scene => reading.time?.scenes?.find(entry => entry.scene === scene.id)?.when ?? null,
      onScene: async result => {
        kept[result.scene] = result; waiting.get(result.scene)?.(result);
        log(`digest ${result.scene}: ${result.moves.length} moves, ${result.facts.length} facts, ${result.items.length} items, ${result.talk.length} talk, ${result.breaks.length} breaks${result.failed.length ? `; failed: ${result.failed.join(', ')}` : ''}`);
        await writeFile(join(runDir, 'digest.json'), JSON.stringify({ version: 1, model: workModel.modelId, scenes: kept }));
      } }).catch(error => { log(`digest stopped: ${error.message ?? error}`); for (const done of waiting.values()) done(null); });
  }
  const decide = Object.assign(async (state, questions, options) => { calls++; return asked(state, questions, options); }, { record: () => {} });

  let result = null;
  await strandDemo(novelDir, { from, to, worldOnly: true, plain: true, title: 'Director', engine: async E => {
    const { world, W } = E, server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true });
    let page = null, lotsShown = -1;
    // Every scene's line as played so far (its starts and events with their walks), kept in world nodes and made the page's
    // own whenever the page is written: a page loaded later (World · Live's frame, the Player) holds the whole line, every
    // card in it to replay (the user, 2026-11-02: tapping a played sentence replayed nothing once the run was over).
    const played = new Map();
    // The things people carry, put down, throw and break (the digest's items, the user, 2026-11-03: v1's item placing
    // brought back): each one's placements over the line, drawn on the page as v1's things are (a gold shape with its name).
    const things = new Map();
    const thingsOnPage = () => [...things.values()].filter(thing => thing.placed.length).map(thing => ({ id: thing.id, name: thing.name, aliases: [], model: null, theme: null, switched: false, shape: thing.size > 1.5 ? 'box' : 'oval', size: Math.max(0.4, Math.min(6, thing.size)), height: thing.size > 1.5 ? Math.max(1, thing.size * 0.4) : Math.max(0.4, thing.size), placed: thing.placed, struct: null }));
    try {
      // The page as far as the loop has played, loaded again only when the world has grown (or a scene is done).
      const show = async (force = false) => {
        if (!force && page && world.lots.length === lotsShown) return page;
        page = E.assemble(E.runs); lotsShown = world.lots.length;
        await writeFile(join(work, 'index.html'), inlineStrand(template, withLine(page), { vendor: true }));
        await chrome.evaluate('delete window.__stage').catch(() => {});
        await chrome.open(server.url);
        return page;
      };
      // A scene's piece of the line on the page's grid as it stands now.
      function pieceOf({ scene, run }) {
        const starts = Object.fromEntries(Object.entries(run.starts).map(([who, value]) => [who, dense(value[0])]));
        const events = scene.events.map(event => ({ id: event.id, actors: event.actors ?? [], text: event.text, camera: event.camera ?? null, spots: [], hit: E.hits?.get(event.id) ?? null, hitThings: null, trace: null,
          moves: scene.cast.map(person => E.moves.get(`${scene.id}|${event.id}|${person}`)).filter(Boolean).map(move => ({ person: move.person, how: move.how, with: null, path: move.path.map(dense), ensemble: (move.ensemble ?? []).map(other => other.map(dense)) })) }));
        return { scene: scene.id, starts, events, cast: scene.cast, grid: gridKey() };
      }
      const withLine = data => ({ ...data, things: [...(data.things ?? []), ...thingsOnPage()], scenes: data.scenes.map(entry => { const piece = played.has(entry.id) ? pieceOf(played.get(entry.id)) : null; return piece ? { ...entry, starts: piece.starts, events: piece.events, cast: piece.cast } : entry; }) });
      const dense = id => { const { i, j, k } = W.cellOf(world, id), g = page.world; return ((k + g.ok) * g.NZ + (j + g.oj)) * g.NX + (i + g.oi); };
      const at = id => { const p = W.nodePos(world, id); return [p.x, p.y, p.z]; };
      const lotOf = (x, z) => world.lotAt.get(W.cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      const lotName = index => { const lot = world.lots[index]; return lot.label ?? `the ${lot.role ?? 'building'} (${lot.height ?? lot.floors} floors)`; };
      // What stands at a point, in words: a building's room, corridor or stairs on a floor, its roof, open ground, the air.
      const said = ([x, y, z]) => {
        const index = lotOf(x, z), k = Math.round(y / FLOOR);
        if (index === undefined) return y < -1 ? 'underground' : y < 1.5 ? `open ground (${['', 'the street', 'a plaza', 'the avenue'][world.ground.get(W.cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? 0] || 'outside'})` : `the open air, ${Math.round(y)} m up`;
        const lot = world.lots[index], i = Math.floor(x / CELL) - lot.i0, j = Math.floor(z / CELL) - lot.j0;
        if (k >= lot.floors) return k === lot.floors ? `the roof of ${lotName(index)}` : `the air over ${lotName(index)}`;
        if (k < 0) return `under ${lotName(index)}`;
        const cell = lot.skeleton.cells[S.cellIndex(lot.skeleton, i, j, k)], room = lot.rooms.find(box => box.floor <= k && k <= box.top && i >= box.i0 && i <= box.i1 && j >= box.j0 && j <= box.j1);
        return cell === S.STAIR ? `the stairs of ${lotName(index)}, floor ${k + 1}` : cell === S.CORRIDOR ? `a corridor of ${lotName(index)}, floor ${k + 1}` : room ? `${room.kind === 'room' ? 'a room' : room.kind === 'hall' ? 'a hall' : 'a hall rising through floors'} of ${lotName(index)}, floor ${room.floor + 1}` : `a wall of ${lotName(index)}, floor ${k + 1}`;
      };
      // The walkable nodes round a point (within `radius` metres), with what each is: the pool spots and boxes are taken from.
      const around = (x, z, radius) => {
        E.reach(x, z, radius + 16);
        const built = E.graphOf({ x, z }, radius + 24), { graph, type, lot } = built, nodes = [];
        for (let id = 0; id < type.length; id++) if (type[id] && graph.offsets[id + 1] > graph.offsets[id] && Math.abs(graph.x[id] - x) <= radius && Math.abs(graph.z[id] - z) <= radius) nodes.push({ id, x: graph.x[id], y: graph.y[id], z: graph.z[id], type: type[id], lot: lot[id], ground: built.ground?.[id] ?? 0 });
        return { built, nodes };
      };
      // A move's walk: one draw of the path integral, and six more from the same field (the traces the player draws round it,
      // the spread of where the walk might have gone).
      // A walk that fails says so with a code (W0: NO_TARGET, OFF_WALK, NO_PATH) and the least that replays it: the seed's
      // key, where they stood, the first targets and how they went (with the scene's place, enough to solve it again).
      const walk = (scene, key, from, targets, how) => {
        walk.failed = null; walk.code = null; walk.replay = { key, from: from[0], targets: targets.slice(0, 8), how };
        if (!targets.length) { walk.failed = 'no place to stand there'; walk.code = 'NO_TARGET'; return null; }
        const field = E.solve(scene.placeId, key, targets, how, from[0]), built = E.graphOf(W.nodePos(world, from[0]));
        const path = E.sampleWalk(built.graph, field, from[0], from[1], seeded(key));
        if (path) path.ensemble = Array.from({ length: 6 }, (_, n) => E.sampleWalk(built.graph, field, from[0], from[1], seeded(`${key}|${n}`))).filter(Boolean);
        // Why no walk was found (the user's Why panel: people chose a place and never went): where they stand is not on the
        // walk round them and their target, or the walk has no way from there to it.
        else { const off = field.part && field.part.local[from[0]] < 0; walk.failed = off ? 'where they stand is off the walk' : 'no way there on foot'; walk.code = off ? 'OFF_WALK' : 'NO_PATH'; }
        return path;
      };
      const shoot = async (name, size, options) => {
        await chrome.size(...size);
        const view = await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: name, frame: size, people: true, mask: true, ...options })})`);
        const png = await chrome.still('png');
        await writeFile(join(shots, `${name}.png`), Buffer.from(png, 'base64'));
        return { view, png };
      };

      // The live world's snapshot with the cards in its notes (World · Live's Cards panel reads them there).
      // `focus`: where the live view's Follow Jev looks (the card's people), else the engine's own.
      const noted = (moment, focus = null, extend = null) => { const shot = E.snapshot(true); return { ...shot, moment, ...(focus ? { focus } : {}), notes: { ...shot.notes, director: payload(), ...(extend ? { extend } : {}) } }; };
      // Streamed (docs/v2/world-engine-redesign.md §4): after every card, the scene's piece of the line (its starts and events so
      // far) in the live notes, which World · Live's frame plays on from where it is; the whole page only when the world grid
      // has changed (the frame then loads it, and takes the pieces after).
      const gridKey = () => `${page.world.NX}x${page.world.NZ}+${page.world.oi},${page.world.oj},${page.world.ok}`;
      let lastPiece = null, sentGrid = null, seq = 0;
      const stream = async (moment, focus = null, whole = false) => {
        if (!live) return;
        const full = gridKey() !== sentGrid;
        await live.world(noted(moment, focus, lastPiece ? { ...lastPiece, seq: ++seq, ...(focus ? { focus } : {}) } : null), full || whole ? { ...withLine(page), director: payload() } : null);
        if (full) sentGrid = gridKey();
      };
      const spawn = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'spawn.json'), 'utf8').catch(() => 'null'));
      const script = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8'));
      let before = null;
      const where = new Map();
      // Continuity per strand (L1, docs/v2/physics-laws.md; the user, 2026-11-02: it holds to a strand's end and never across
      // strands): someone comes into a scene from the scene the strands say they come from (stage/world/strands.json
      // `entries`), else from where they last stood in that strand; someone first in this strand is never carried in from
      // another one. Without strands, the one state of before.
      const strands = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'strands.json'), 'utf8').catch(() => 'null'));
      // A scene start the smoothing moved (W5b): the least-action spot, from the last run's page, as a node of this world.
      const smoothedStart = (scene, who) => {
        const revision = startsMoved.get(`${scene.id}|${who}`);
        if (!revision) return null;
        const decided = pins.revise?.[`${scene.id}|${who}`];
        const applied = decided === 'keep' ? false : revision.shift <= SM.REVISION_LIMIT || decided === 'apply';
        if (!record.revisions.some(entry => entry.scene === scene.id && entry.who === who)) record.revisions.push({ who, scene: scene.id, moments: [scene.id], metres: Math.round(revision.shift), rank: revision.rank, applied, by: 'smoothing' });
        if (!applied) return null;
        const p = revision.to;
        E.reach(p.x, p.z, 24);
        return W.nodeNear(world, E.graphOf({ x: p.x, z: p.z }), p.x, p.z, Math.round(p.y / FLOOR)) ?? null;
      };
      const strandScene = new Map((strands?.scenes ?? []).map(entry => [entry.id, entry]));
      const endOf = new Map(), lastIn = new Map();
      const prior = (who, sceneId) => {
        const own = strandScene.get(sceneId);
        if (!own) return where.get(who) ?? null;
        const entry = (own.entries ?? []).find(item => item.person === who);
        if (!entry?.from) return null;
        return endOf.get(entry.from)?.[who] ?? lastIn.get(strandScene.get(entry.from)?.fork)?.get(who) ?? lastIn.get(own.fork)?.get(who) ?? null;
      };
      // The page's line grown in place to this moment (strand-demo.html `extend`): the scene's starts and its events so far,
      // each with its moves as walked; the page is loaded again only when the world has grown.
      const grow = async (scene, run) => {
        await show();
        played.set(scene.id, { scene, run });
        lastPiece = pieceOf({ scene, run });
        return chrome.evaluate(`window.__stage.extend(${JSON.stringify(lastPiece)})`);
      };
      for (const scene of E.chosen) {
        const run = E.runs[scene.id], reads = reading.scenes.find(entry => entry.id === scene.id), sceneRecord = { scene: scene.id, cards: [] };
        record.scenes.push(sceneRecord);
        asking = sceneRecord;
        if (!run || !reads) continue;
        // The world state (docs/v2/world-engine-redesign.md §1): who stands where carries through the story. Someone seen before
        // carries on from where they are; seen for the first time, they start at spawning's start (spawning happens once);
        // standing outside the scene's place, they travel to their start in it (walked; beyond 300 m they arrive off-page).
        const own = script.scenes.find(entry => entry.id === scene.id), spawned = spawn?.scenes?.find(entry => entry.id === scene.id);
        const startNode = who => {
          const start = spawned?.starts.find(entry => entry.who === who);
          if (!start) return run.starts[who]?.[0] ?? null;
          E.reach(start.at[0], start.at[1], 24);
          const built = E.graphOf({ x: start.at[0], z: start.at[1] });
          return W.nodeNear(world, built, start.at[0], start.at[1], Math.round(start.y / FLOOR)) ?? W.nodeNear(world, built, start.at[0], start.at[1], null);
        };
        const inside = node => {
          const box = spawned?.target?.box; if (!box || spawned.target.kind === 'area') return true;
          const [x, , z] = at(node), [cx, cz, w, d, angle] = box, dx = x - cx, dz = z - cz, u = dx * Math.cos(angle) + dz * Math.sin(angle), v = -dx * Math.sin(angle) + dz * Math.cos(angle);
          return Math.abs(u) <= w / 2 + 8 && Math.abs(v) <= d / 2 + 8;
        };
        // A scene's people start together (the user, 2026-11-02: two people of one conversation spawned a kilometre apart, and
        // a scene going on from the last played far from it): the anchor is where those already here stand (the one nearest
        // their middle); with none here, spawning's start of the first present (one placed by the text's own words first).
        // Someone new starts a few metres from the anchor; someone from elsewhere walks to it (off-page beyond 300 m).
        // Presence as the script has it, with the review's pins over it (someone answered present or not, W5).
        const pinnedIn = [...Object.entries(pins.present).filter(([key, value]) => value && key.startsWith(`${scene.id}|`)).map(([key]) => key.slice(scene.id.length + 1)), ...[...surelyThere].filter(key => key.startsWith(`${scene.id}|`)).map(key => key.slice(scene.id.length + 1))];
        const present = [...new Set([...(own?.present ?? Object.keys(run.starts).filter(id => run.starts[id])), ...pinnedIn])].filter(who => pins.present[`${scene.id}|${who}`] !== false);
        if (pinnedIn.length || present.length < (own?.present?.length ?? present.length)) sceneRecord.pinned = { present: pinnedIn, absent: (own?.present ?? []).filter(who => !present.includes(who)) };
        for (const who of present) if (E.names && !E.names[who]) E.names[who] = names.get(who) ?? who;
        const was = new Map(present.map(who => [who, prior(who, scene.id)]));
        sceneRecord.laws = present.filter(who => where.get(who) && !was.get(who)).map(who => ({ law: 'L1', who, verdict: 'amend', why: 'first in this strand: not carried in from another strand' }));
        const here = present.filter(who => was.get(who) && inside(was.get(who)[0]));
        let anchor = null;
        if (here.length) {
          const points = here.map(who => at(was.get(who)[0])), mid = [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length);
          anchor = was.get(here.reduce((best, who) => { const p = at(was.get(who)[0]), q = at(was.get(best)[0]); return Math.hypot(p[0] - mid[0], p[2] - mid[2]) < Math.hypot(q[0] - mid[0], q[2] - mid[2]) ? who : best; }, here[0]))[0];
        } else {
          const by = who => spawned?.starts.find(entry => entry.who === who)?.by;
          const first = present.find(who => ['spatial', 'part'].includes(by(who))) ?? present[0];
          anchor = first ? startNode(first) : null;
        }
        // A spot a few metres from the anchor on its level, the same for the same person each time.
        const beside = (who, spread = [1.5, 4]) => {
          if (anchor === null || anchor === undefined) return null;
          const p = at(anchor), { nodes } = around(p[0], p[2], spread[1] + 2), ring = nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) >= spread[0] && Math.hypot(node.x - p[0], node.z - p[2]) <= spread[1]);
          return ring.length ? ring[Math.floor(seeded(`${scene.id}|${who}|beside`)() * ring.length)].id : anchor;
        };
        const positions = {}, travels = [];
        sceneRecord.spawned = []; sceneRecord.carried = []; sceneRecord.offPage = [];
        // Smoothed (§5a, W5b): someone whose start the least-action history moves stands where it has them.
        const revisedAt = who => smoothedStart(scene, who);
        sceneRecord.revised = [];
        for (const who of present) {
          const from = was.get(who), revised = revisedAt(who);
          if (revised !== null && revised !== undefined) { positions[who] = [revised, from?.[1] ?? 0]; sceneRecord.revised.push(who); continue; }
          if (from && here.includes(who)) { positions[who] = from; sceneRecord.carried.push(who); continue; }
          const dest = beside(who);
          if (dest === null || dest === undefined) { if (from) positions[who] = from; continue; }
          if (!from) { positions[who] = [dest, 0]; sceneRecord.spawned.push(who); continue; }
          const a = at(from[0]), b = at(dest);
          if (Math.hypot(a[0] - b[0], a[2] - b[2]) <= 300) { positions[who] = from; travels.push({ who, from, dest }); }
          else { positions[who] = [dest, from[1]]; sceneRecord.offPage.push(who); }
        }
        for (const key of Object.keys(run.starts)) delete run.starts[key];
        Object.assign(run.starts, positions);
        sceneRecord.starts = Object.fromEntries(Object.entries(positions).map(([who, [node]]) => [who, at(node).map(Math.round)]));
        // The world's own check round the scene (W0, world.ts worldIssues): every building wholly in its graph entered from the
        // street, every room reached. What fails is recorded with the scene, so a held walk can be told from a broken world.
        if (anchor !== null && anchor !== undefined && W.worldIssues) { const p = at(anchor), issues = W.worldIssues(world, E.graphOf({ x: p[0], z: p[2] })); if (issues.length) sceneRecord.world = issues.slice(0, 20).map(issue => ({ ...issue, name: lotName(issue.lot) })); }
        // The director's pass (pass.mjs): the narration and description sentences that move someone present join the cards,
        // as actions of those they name, in reading order.
        // With the summarizer's digest of the scene, its moves stand in for the pass: a sentence outside the played cards that
        // moves someone present is played as their action card.
        const dg = digested.has(scene.id) ? await digested.get(scene.id) : null, covered = new Set(dg?.covered ?? []);
        let moving;
        if (dg) {
          sceneRecord.digest = { ...dg.digest, windows: dg.windows, failed: dg.failed, found: { moves: dg.moves.length, facts: dg.facts.length, items: dg.items.length, talk: dg.talk.length, breaks: dg.breaks.length, background: dg.background.length } };
          const inCards = new Set((cardsOf.get(scene.id) ?? []).flatMap(card => card.sentences)), bySentence = new Map();
          for (const move of dg.moves) if (!inCards.has(move.sentence) && move.motion !== 'still' && move.sure >= MOVE_SURE && positions[move.who]) (bySentence.get(move.sentence) ?? bySentence.set(move.sentence, new Set()).get(move.sentence)).add(move.who);
          moving = [...bySentence].map(([id, who]) => ({ id: `digest:${id}`, kind: 'action', first: id, sentences: [id], people: [...who].map(person => ({ id: person, how: ['acts'] })), pass: true, digest: true }));
        } else {
          const passed = await passScene({ reading, text, decide, scene: reads, place: names.get(scene.placeId) ?? scene.placeId, people: Object.fromEntries(Object.keys(positions).map(id => [id, names.get(id) ?? id])) });
          sceneRecord.pass = passed;
          moving = Object.entries(passed).filter(([, entry]) => entry.show === 'moves' && entry.who.length).map(([id, entry]) => ({ id: `pass:${id}`, kind: 'action', first: id, sentences: [id], people: entry.who.map(who => ({ id: who, how: ['acts'] })), pass: true }));
        }
        const position = new Map(reads.sentences.map((id, n) => [id, n]));
        // A card's digest entries, and those it moves (the reading's actors and anyone the digest has moving in it).
        const digestIn = (list, card) => (dg ? list.filter(entry => card.sentences.includes(entry.sentence)) : []);
        const read = card => !!dg && card.sentences.every(id => covered.has(id));
        const digestMovers = card => digestIn(dg?.moves ?? [], card).filter(entry => entry.motion !== 'still' && entry.sure >= MOVE_SURE && positions[entry.who]).map(entry => entry.who);
        const cards = [...(cardsOf.get(scene.id) ?? []), ...moving].filter(card => card.people.some(person => positions[person.id] && person.how.some(how => PRESENT.has(how))) || digestMovers(card).length).sort((a, b) => (position.get(a.first) ?? 0) - (position.get(b.first) ?? 0));
        // The crowd (the scene digest: few or many people not named on stage): walkers round the anchor, scenery only (never
        // in the laws, the log or canon), drifting as the crowd does.
        const extras = new Map();
        if (dg && dg.digest.background.crowd !== 'none' && anchor !== null && anchor !== undefined) {
          const p = at(anchor), { nodes } = around(p[0], p[2], 22), kind = nodes.find(node => node.id === anchor)?.type;
          const open = nodes.filter(node => Math.abs(node.y - p[1]) < 1 && (kind === undefined || node.type === kind) && Math.hypot(node.x - p[0], node.z - p[2]) >= 5);
          for (let n = 0; n < (dg.digest.background.crowd === 'many' ? 6 : 3) && open.length; n++) {
            const id = `extra:${scene.id.slice(-3)}:${n + 1}`, node = open[Math.floor(seeded(id)() * open.length)].id;
            extras.set(id, [node, 0]); run.starts[id] = [node, 0]; if (E.names) E.names[id] = '路人';
          }
          sceneRecord.extras = { count: extras.size, doing: dg.digest.background.crowdDoing };
        }
        scene.events = []; run.events = []; scene.cast = [...new Set([...(scene.cast ?? []), ...Object.keys(positions), ...extras.keys()])];
        // Those coming from elsewhere walk in first (an event of their own, before the scene's cards).
        if (travels.length) {
          const meet = at(travels[0].dest), event = { id: `arrive:${scene.id}`, text: `(${travels.map(entry => names.get(entry.who) ?? entry.who).join('、')} come here)`, actors: travels.map(entry => entry.who), camera: { focus: { x: meet[0], z: meet[2], y0: meet[1], w: 6, d: 6, h: 3 }, radius: 30, elevation: 40, yaw: 0 } };
          scene.events.push(event);
          for (const entry of travels) {
            const p = at(entry.dest), { nodes } = around(p[0], p[2], 6), near = nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) <= 2.5).map(node => node.id);
            const path = walk(scene, `${scene.id}|${entry.who}|arrive`, entry.from, near.length ? near : [entry.dest], 'walk');
            if (path && path.length > 1) { E.moves.set(`${scene.id}|${event.id}|${entry.who}`, { person: entry.who, how: 'walk', path: [...path], ensemble: path.ensemble ?? [] }); positions[entry.who] = [path.at(-1), entry.from[1]]; }
            else positions[entry.who] = [entry.dest, entry.from[1]];
          }
          run.events.push({ at: { ...positions } });
          sceneRecord.arrivals = travels.map(entry => entry.who);
        }
        await live?.phase(`scene ${Number(scene.id.slice(-3))}: ${cards.length} cards`);
        await show(true);
        await grow(scene, run);
        await stream(`scene ${Number(scene.id.slice(-3))} begins${sceneRecord.arrivals?.length ? ` · ${sceneRecord.arrivals.map(who => names.get(who) ?? who).join(', ')} come in` : ''}`);
        if (pace && sceneRecord.arrivals?.length) await new Promise(done => setTimeout(done, pace * 1000));
        const placeName = names.get(scene.placeId) ?? scene.placeId, when = reading.time?.scenes?.find(entry => entry.scene === scene.id)?.when ?? null;
        // The digest's helpers for this scene (digest.mjs, facts.mjs): a card's last line, a move in words, the walkable
        // spots round a point on its level, each person's way through the scene (those strolling or walking share the
        // scene's, a little apart, so a group keeps together), and what a node is for the facts.
        const sentenceAt = new Map(reads.sentences.map((id, n) => [id, n])), lastLine = card => Math.max(...card.sentences.map(id => sentenceAt.get(id) ?? -1));
        const anchorAt = anchor !== null && anchor !== undefined ? at(anchor) : null;
        const moveWords = entry => `${entry.motion}${entry.toward ? ` toward ${names.get(entry.toward) ?? entry.toward}` : ''}${entry.away ? ` away from ${names.get(entry.away) ?? entry.away}` : ''}${entry.with ? ` with ${names.get(entry.with) ?? entry.with}` : ''}${entry.to ? `, to ${entry.to}` : ''} (${entry.how}, ${entry.basis}, ${Math.round(entry.sure * 100)}%)`;
        const near = (p, lo, hi) => around(p[0], p[2], hi + 2).nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) >= lo && Math.hypot(node.x - p[0], node.z - p[2]) <= hi);
        const turn = new Map(), sceneWay = seeded(`${scene.id}|way`)() * 2 * Math.PI;
        const wayOf = (who, shared = true) => { if (!turn.has(who)) turn.set(who, shared ? sceneWay + (seeded(`${scene.id}|${who}|way`)() - 0.5) * 0.5 : seeded(`${scene.id}|${who}|way`)() * 2 * Math.PI); return turn.get(who); };
        // A graded move's spot: a step (to 2.5 m) or nearby (to 10 m) on their level; toward or with someone, to 1.5 m of
        // them; away from someone, as far from them as the span allows; else on along their way.
        const gradedTarget = (who, entry) => {
          const here = at(positions[who][0]), [lo, hi] = entry.motion === 'step' ? [0.8, 2.5] : [2.5, 10];
          const other = entry.toward ?? entry.with, there = other && other !== who && positions[other] ? at(positions[other][0]) : null, away = entry.away && entry.away !== who && positions[entry.away] ? at(positions[entry.away][0]) : null;
          const pool = near(here, there ? 0.8 : lo, hi);
          if (!pool.length) return null;
          const angle = wayOf(who, false), mid = (lo + hi) / 2, aim = [here[0] + Math.cos(angle) * mid, here[2] + Math.sin(angle) * mid];
          const cost = there ? node => Math.abs(Math.hypot(node.x - there[0], node.z - there[2]) - 1.5) : away ? node => -Math.hypot(node.x - away[0], node.z - away[2]) : node => Math.hypot(node.x - aim[0], node.z - aim[1]);
          const best = pool.reduce((a, b) => (cost(b) < cost(a) ? b : a));
          turn.set(who, Math.atan2(best.z - here[2], best.x - here[0]));
          return best.id;
        };
        // What a node is, for the facts (facts.mjs): how far its building's outer wall is (outdoors: whether a building is
        // beside it), an entrance near, stairs, a street.
        const describe = node => {
          const lot = node.lot >= 0 && node.lot < world.lots.length ? world.lots[node.lot] : null, k = Math.round(node.y / FLOOR);
          let edge = 99, stairs = false;
          if (lot) {
            const x0 = lot.i0 * CELL, x1 = (lot.i0 + lot.nx) * CELL, z0 = lot.j0 * CELL, z1 = (lot.j0 + lot.nz) * CELL;
            edge = Math.max(0, Math.min(node.x - x0, x1 - node.x, node.z - z0, z1 - node.z));
            try { stairs = lot.skeleton.cells[S.cellIndex(lot.skeleton, Math.floor(node.x / CELL) - lot.i0, Math.floor(node.z / CELL) - lot.j0, k)] === S.STAIR; } catch { stairs = false; }
          } else if (node.type === FA.TYPE.outdoor) edge = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([di, dj]) => lotOf(node.x + di * CELL, node.z + dj * CELL) !== undefined) ? CELL : 99;
          const door = (node.type === FA.TYPE.outdoor && edge <= CELL) || (lot && k === 0 && node.type !== FA.TYPE.roof && edge <= 3) ? 2 : 99;
          return { ...node, edge, door, stairs, street: node.type === FA.TYPE.outdoor && [1, 3].includes(node.ground || 1) };
        };
        const nodeAt = id => { const p = at(id), found = around(p[0], p[2], 3).nodes.find(node => node.id === id); return describe(found ?? { id, x: p[0], y: p[1], z: p[2], type: 0, lot: -1 }); };
        let factsUpTo = -1, itemsUpTo = -1;
        // What people carry as the scene begins (the scene digest). A thing someone here held before is drawn with them only
        // if the scene says they still carry it (else it was left behind); someone elsewhere keeps what they hold.
        const personNames = [...names.values()].filter(name => typeof name === 'string');
        const carried = new Map((dg?.digest.people ?? []).map(person => [person.who, person.holding.filter(name => DG.isThing(name, personNames))]));
        for (const thing of things.values()) if (dg && thing.holder && positions[thing.holder] && !(carried.get(thing.holder) ?? []).some(name => name.includes(thing.name) || thing.name.includes(name))) { thing.holder = null; thing.at = null; }
        for (const [who, holding] of carried) for (const name of holding) {
          if (!positions[who]) continue;
          const person = { who };
          const id = `item:${name}`, thing = things.get(id) ?? things.set(id, { id, name, size: 0.5, holder: null, at: null, broken: false, placed: [], events: [] }).get(id);
          thing.holder = person.who; thing.at = null; thing.events.push({ scene: scene.id, card: null, event: 'held', who: person.who });
        }
        for (const card of cards) {
          const cardRecord = { card: card.id, kind: card.kind, ...(card.pass ? { pass: true } : {}), event: scene.events.length, lines: card.sentences.map(line), moves: [] };
          asking = cardRecord;
          await live?.phase(`scene ${Number(scene.id.slice(-3))} · card ${cards.indexOf(card) + 1}/${cards.length}${card.pass ? ' · from the pass' : ''} · ${card.people.filter(person => positions[person.id]).map(person => names.get(person.id) ?? person.id).join(', ')}`);
          sceneRecord.cards.push(cardRecord);
          const event = { id: card.id, text: card.sentences.map(id => text.get(id)?.text ?? '').join('').slice(0, 120), actors: card.people.filter(person => positions[person.id] && person.how.some(how => PRESENT.has(how))).map(person => person.id) };
          scene.events.push(event);
          const moveTo = (person, path, how, why, { quiet = false } = {}) => {
            // Reachable (L10): a move no walk reaches is held with why, and nobody moves. A quiet move (the background's
            // routine, a graded step) that finds no walk is left unplayed without a law.
            if (path && path.length < 2) { cardRecord.moves.push({ person, why: why ?? 'already there', moved: false }); return; }
            if (!path && quiet) { cardRecord.moves.push({ person, why, moved: false, quiet: true, ...(walk.code ? { code: walk.code } : {}) }); return; }
            const pinKey = `${scene.id}|${card.id}|${person}`;
            if (!path && pins.arrive[pinKey] && walk.replay?.targets?.length) { positions[person] = [walk.replay.targets[0], positions[person][1]]; { const [x, y, z] = at(walk.replay.targets[0]); cardRecord.moves.push({ person, why: 'arrives (pinned by the review)', moved: true, arrived: true, pinned: true, to: said([x, y, z]), at: { x: round(x), y: round(y), z: round(z) } }); } (cardRecord.laws ??= []).push({ law: 'L10', who: person, verdict: 'pinned', why: 'no walk there, but they get there (the review)' }); return; }
            if (!path && pins.stays[pinKey]) { cardRecord.moves.push({ person, why: 'stays (pinned by the review)', moved: false, pinned: true }); (cardRecord.laws ??= []).push({ law: 'L10', who: person, verdict: 'ok', why: 'they stay (the review)' }); return; }
            if (!path) { cardRecord.moves.push({ person, why, moved: false, ...(walk.code ? { code: walk.code, replay: walk.replay } : {}) }); (cardRecord.laws ??= []).push({ law: 'L10', who: person, verdict: 'held', why: walk.failed ?? why ?? 'no walk there', ...(walk.code ? { code: walk.code } : {}) }); return; }
            // Several moves of one person in one card (steps, then an implied move) are one walk on the page.
            const key = `${scene.id}|${card.id}|${person}`, earlier = E.moves.get(key);
            E.moves.set(key, { person, how: how === 'run' || earlier?.how === 'run' ? 'run' : 'walk', path: earlier ? [...earlier.path, ...path.slice(1)] : [...path], ensemble: path.ensemble ?? [] });
            positions[person] = [path.at(-1), positions[person][1]];
            cardRecord.moves.push({ person, why, moved: true, steps: path.length, to: said(at(path.at(-1))) });
          };
          const factsDue = () => {
            const end = lastLine(card), due = dg.facts.filter(fact => { const n = sentenceAt.get(fact.sentence) ?? -1; return n > factsUpTo && n <= end; });
            factsUpTo = Math.max(factsUpTo, end);
            const positionOf = who => (positions[who] ? at(positions[who][0]) : null);
            for (const who of [...new Set(due.map(fact => fact.who))].filter(who => positions[who])) {
              const own = due.filter(fact => fact.who === who), here = nodeAt(positions[who][0]);
              (cardRecord.facts ??= []).push(...own.map(fact => ({ ...fact, holds: FA.holds(fact, here, positionOf) })));
              const binding = own.filter(FA.binding), failing = binding.filter(fact => FA.holds(fact, here, positionOf) === false);
              if (!failing.length) continue;
              const wide = failing.some(fact => ['indoors', 'outdoors', 'roof', 'underground', 'floor', 'vehicle'].includes(fact.kind)), pool = [...around(here.x, here.z, wide ? 60 : 24).nodes];
              for (const fact of failing) { const p = fact.kind === 'near' ? positionOf(fact.value) : null; if (p) pool.push(...around(p[0], p[2], 6).nodes); }
              const best = FA.bestFor(binding, here, pool.map(describe), positionOf), words = failing.map(fact => FA.factWords(fact, id => names.get(id) ?? id)).join('; ');
              if (!best) { (cardRecord.laws ??= []).push({ law: 'L14', who, verdict: failing.some(fact => fact.basis === 'stated') ? 'held' : 'weighed', why: `no spot near agrees: ${words}` }); continue; }
              moveTo(who, walk(scene, `${scene.id}|${card.id}|${who}|implied`, positions[who], [best.id], 'walk'), 'walk', `implied: ${words}`, { quiet: true });
              const last = cardRecord.moves.at(-1);
              if (last?.person === who) last.implied = failing.map(fact => fact.sentence);
            }
          };
          // The background's routine for those the card did not move (the latest the digest says, else the scene's): those
          // strolling or walking go on along the scene's way (strollers turn back beyond 40 m), those fighting shift a step or
          // two, those working a step every third card; the crowd moves every other card.
          const SPAN = { strolling: [2, 4], walking: [3, 6], running: [6, 10], fighting: [0.8, 2], working: [0.8, 2] };
          const drift = () => {
            const end = lastLine(card), index = cards.indexOf(card), touched = new Set(cardRecord.moves.filter(move => move.moved).map(move => move.person));
            const routine = who => dg.background.filter(entry => entry.who === who && (sentenceAt.get(entry.sentence) ?? 0) <= end).at(-1)?.doing ?? (who === 'crowd' ? dg.digest.background.crowdDoing : dg.digest.people.find(entry => entry.who === who)?.doing ?? null);
            const onward = (who, from, doing, wander) => {
              const span = SPAN[doing], here = at(from[0]);
              if (wander && anchorAt && Math.hypot(here[0] - anchorAt[0], here[2] - anchorAt[2]) > wander) turn.set(who, Math.atan2(anchorAt[2] - here[2], anchorAt[0] - here[0]));
              const angle = doing === 'fighting' ? seeded(`${card.id}|${who}|spar`)() * 2 * Math.PI : wayOf(who, !who.startsWith('extra:')), mid = (span[0] + span[1]) / 2, aim = [here[0] + Math.cos(angle) * mid, here[2] + Math.sin(angle) * mid];
              const pool = near(here, span[0], span[1]);
              const path = pool.length ? walk(scene, `${scene.id}|${card.id}|${who}|${doing}`, from, [pool.reduce((a, b) => (Math.hypot(b.x - aim[0], b.z - aim[1]) < Math.hypot(a.x - aim[0], a.z - aim[1]) ? b : a)).id], doing === 'running' ? 'run' : 'walk') : null;
              if (!path || path.length < 2) { turn.set(who, angle + Math.PI / 2); return null; }
              return path;
            };
            for (const who of Object.keys(positions)) {
              const doing = routine(who);
              if (touched.has(who) || !SPAN[doing] || (doing === 'working' && index % 3)) continue;
              const path = onward(who, positions[who], doing, doing === 'strolling' ? 40 : 0);
              if (path) moveTo(who, path, doing === 'running' ? 'run' : 'walk', `background: ${doing}`, { quiet: true });
            }
            const crowd = routine('crowd');
            if (!SPAN[crowd] || index % 2) return;
            let moved = 0;
            for (const [id, value] of extras) {
              const path = onward(id, value, crowd, 30);
              if (!path) continue;
              E.moves.set(`${scene.id}|${card.id}|${id}`, { person: id, how: crowd === 'running' ? 'run' : 'walk', path: [...path], ensemble: [] });
              extras.set(id, [path.at(-1), 0]); moved++;
            }
            if (moved) cardRecord.crowd = { doing: crowd, moved };
          };
          // The things in the card's lines: held, picked up, used (with whoever holds them), given, put down or thrown (left
          // where they fell), broken. Each thing held by someone present is placed with them after every card they move.
          const carry = () => {
            const end = lastLine(card);
            for (const entry of dg.items.filter(item => { const n = sentenceAt.get(item.sentence) ?? -1; return n > itemsUpTo && n <= end && DG.isThing(item.item, personNames); })) {
              const id = `item:${entry.item}`, thing = things.get(id) ?? things.set(id, { id, name: entry.item, size: entry.size, holder: null, at: null, broken: false, placed: [], events: [] }).get(id);
              const holderAt = () => (thing.holder && positions[thing.holder] ? at(positions[thing.holder][0]) : null);
              if (['appears', 'held', 'picked-up', 'used'].includes(entry.event)) {
                if (entry.who && positions[entry.who]) { thing.holder = entry.who; thing.at = null; }
                else if (!thing.holder && !thing.at) { const actor = event.actors.find(who => positions[who]), p = actor ? at(positions[actor][0]) : anchorAt; if (p) thing.at = { scene: scene.id, p: [p[0] + 1, p[1], p[2]] }; }
              } else if (entry.event === 'given') { if (entry.to && positions[entry.to]) thing.holder = entry.to; }
              else if (entry.event === 'put-down' || entry.event === 'thrown') {
                const p = holderAt() ?? (thing.at?.scene === scene.id ? thing.at.p : null);
                if (p) { const angle = wayOf(thing.holder ?? id, false), d = entry.event === 'thrown' ? 6 : 0.8; thing.at = { scene: scene.id, p: [p[0] + Math.cos(angle) * d, p[1], p[2] + Math.sin(angle) * d] }; }
                thing.holder = null;
              } else if (entry.event === 'broken') thing.broken = true;
              thing.events.push({ scene: scene.id, card: card.id, event: entry.event, who: entry.who, to: entry.to, line: entry.sentence });
              (cardRecord.items ??= []).push({ item: entry.item, event: entry.event, ...(entry.who ? { who: entry.who } : {}), ...(entry.to ? { to: entry.to } : {}), line: entry.sentence });
            }
            itemsUpTo = Math.max(itemsUpTo, end);
            for (const thing of things.values()) {
              const held = thing.holder && positions[thing.holder] ? at(positions[thing.holder][0]) : null;
              const p = held ? [held[0] + 0.4, held[1] + (thing.size > 1.5 ? 0 : 1), held[2] + 0.3] : thing.at?.scene === scene.id ? thing.at.p : null, last = thing.placed.at(-1);
              if (!p || (last && last.scene === scene.id && Math.hypot(last.x - p[0], last.y - p[1], last.z - p[2]) < 0.3)) continue;
              const w = Math.max(0.4, Math.min(6, thing.size)), h = thing.size > 1.5 ? Math.max(1, w * 0.4) : w;
              thing.placed.push({ scene: scene.id, event: cardRecord.event, place: scene.placeId, x: round(p[0]), y: round(p[1]), z: round(p[2]), fit: { sx: w, sy: h, sz: w, turn: 0, stand: false, w, h, d: w } });
            }
          };
          // Actors are there (L9): someone the card says acts or speaks, with no place in the scene, is held (a presence the
          // script may have missed), never played.
          for (const person of card.people.filter(entry => !positions[entry.id] && entry.how.some(how => how === 'acts' || how === 'speaks'))) (cardRecord.laws ??= []).push(pins.remote[`${scene.id}|${person.id}`] ? { law: 'L9', who: person.id, verdict: 'ok', why: 'remote (pinned by the review)' } : { law: 'L9', who: person.id, verdict: 'held', why: 'acts or speaks, but is not present' });
          if (card.kind === 'dialogue') {
            // Talk needs nearness, by its kind (L6; the user, 2026-11-02: the kind asked of Jev): where someone spoken to stands
            // apart from the first speaker, Jev says what kind of talk it is. Face to face (live, group), they come within
            // speaking distance (2–4 m) on the speaker's floor; remote, everyone stays where they are; public, those within
            // earshot (25 m, the same floor) hear it where they stand, and anyone beyond is held.
            const speaker = card.people.find(person => positions[person.id] && person.how.includes('speaks'))?.id;
            const gap = id => { const a = at(positions[speaker][0]), b = at(positions[id][0]); return { metres: Math.hypot(a[0] - b[0], a[2] - b[2]), floors: Math.round(Math.abs(a[1] - b[1]) / FLOOR) }; };
            const apart = speaker ? card.people.filter(entry => entry.id !== speaker && positions[entry.id] && entry.how.includes('addressed')).map(entry => entry.id).filter(id => gap(id).metres > 5 || gap(id).floors > 0) : [];
            let kind = 'live';
            const pinnedKind = pins.kind[card.id] ?? card.sentences.map(id => pins.kind[`line:${id}`]).find(Boolean);
            const digestKind = read(card) ? digestIn(dg.talk, card)[0]?.kind ?? null : null;
            if (pinnedKind) { kind = pinnedKind; cardRecord.talk = { kind, pinned: true }; }
            else if (digestKind) { kind = digestKind; cardRecord.talk = { kind, by: 'digest' }; }
            else if (apart.length && calls < budget) {
              const others = Object.keys(positions).filter(id => id !== speaker).map(id => ({ name: names.get(id) ?? id, ...gap(id) }));
              const { replies } = await ask(decide, M.dialogueKindMode, { scene: { id: scene.id, place: placeName }, lines: card.sentences.map(line), speaker: names.get(speaker) ?? speaker, people: others }, null);
              const said = replies.find(reply => reply.key === 'kind');
              kind = String(said?.value ?? 'live'); cardRecord.talk = { kind, confidence: said?.confidence ?? null };
            }
            for (const id of apart) {
              if (kind === 'remote') { (cardRecord.laws ??= []).push({ law: 'L6', who: id, verdict: 'ok', why: 'remote: stays where they are' }); continue; }
              if (kind === 'public') { const { metres, floors } = gap(id); (cardRecord.laws ??= []).push(metres <= 25 && !floors ? { law: 'L6', who: id, verdict: 'ok', why: 'public: within earshot' } : { law: 'L6', who: id, verdict: 'held', why: `public, but ${Math.round(metres)} m away${floors ? `, ${floors} floors apart` : ''}: out of earshot` }); continue; }
              const a = at(positions[speaker][0]), { nodes } = around(a[0], a[2], 8), ring = nodes.filter(node => Math.abs(node.y - a[1]) < 1 && Math.hypot(node.x - a[0], node.z - a[2]) >= 2 && Math.hypot(node.x - a[0], node.z - a[2]) <= 4).map(node => node.id);
              moveTo(id, walk(scene, `${scene.id}|${card.id}|${id}|talk`, positions[id], ring, 'walk'), 'walk', `spoken to by ${names.get(speaker)}`);
              if (pins.meet.some(meet => meet.scene === scene.id && [meet.who, meet.to].includes(id) && [meet.who, meet.to].includes(speaker))) cardRecord.moves.at(-1).pinned = true;
            }
          }
          // Each person the card moves. Where the digest read the card, its moves: a step or a move nearby played by rule
          // (toward, away from or with someone, else on along their way), going elsewhere asked of Jev on the pictures,
          // following someone after they have gone. Elsewhere, Jev's text question first, as before.
          const jevMove = async (person, hint = null) => {
            const here = at(positions[person][0]), mover = { id: person, name: names.get(person) ?? person }, slug = `${scene.id.slice(-3)}-${card.id.replace(/[^a-z0-9_]/gi, '_')}-${person}`;
            await show();
            const played = await grow(scene, run);
            const others = Object.keys(positions).filter(who => who !== person).map(who => ({ id: who, name: names.get(who) ?? who }));
            const now = Object.fromEntries(Object.entries(positions).map(([who, [node]]) => { const p = at(node); return [names.get(who) ?? who, `${said(p)}${who === person ? '' : `, ${Math.round(Math.hypot(p[0] - here[0], p[2] - here[2]))} m from ${mover.name}`}`]; }));
            // The text: the card's own lines; before it, the scene's lines naming the mover, saying where or describing the place, nearest first.
            const first = reads.sentences.indexOf(card.sentences[0]), forms = nameForms.get(person) ?? [mover.name], spatial = new Set((reading.spatial ?? []).filter(entry => entry.scene === scene.id).map(entry => entry.sentence));
            const others_ = reads.sentences.map((id, n) => ({ id, n })).filter(({ id, n }) => !card.sentences.includes(id) && (Math.abs(n - first) <= 4 || spatial.has(id) || reading.kinds[id]?.kind === 'environment' || forms.some(form => (text.get(id)?.text ?? '').includes(form))));
            const context = others_.sort((a, b) => Math.abs(a.n - first) - Math.abs(b.n - first)).map(({ id }) => line(id));
            const base = { scene: { id: scene.id, place: placeName, when }, card: { id: card.id, lines: card.sentences.map(line) }, mover, lines: context, now, ...(dg ? { digest: { scene: dg.digest.summary ?? '', ...(hint ? { move: moveWords(hint) } : {}) } } : {}) };
            // Every picture is of the line as played to this moment: people where their walks ended, buildings as broken.
            const shotBase = { place: scene.placeId, at: Math.max(0, (played?.end ?? 0) - 0.02), only: [scene.placeId], mover: person };
            // a. The direction: every arrow, said by what it meets.
            const arrows = C.DIRECTIONS.map(direction => {
              let blocked = false, meets = null;
              for (const metres of [2, 5, 10, 20]) { const p = C.arrowEnd(here, direction.vector, metres), what = said(p); if (what !== said(here)) { meets = `${what} (${metres} m)`; blocked = metres === 2 && /a wall/.test(what); break; } }
              return { ...direction, said: meets ?? `more of ${said(here)}`, blocked };
            });
            // First the text alone: does this person go anywhere in this card? (Not asked when the digest says they go elsewhere.)
            if (!hint) {
              const whether = await ask(decide, M.moveWhetherMode, { ...base, pictures: {} }, null);
              const goes = String(whether.replies.find(entry => entry.key === 'moves')?.value ?? 'stays') === 'goes', said_ = whether.replies.find(entry => entry.key === 'line')?.value ?? null;
              // Destruction only on clear evidence (the user, 2026-11-02: routine things blasted): Jev sure of it, 0.7 or more.
              { const breaks = whether.replies.find(entry => entry.key === 'breaks'); if (breaks?.value === 'yes' && (breaks.confidence ?? 0) >= 0.7) cardRecord.breaks = true; }
              if (!goes) { cardRecord.moves.push({ person, direction: 'stays', line: said_, moved: false }); return; }
            }
            cardRecord.camera ??= { focus: { x: here[0], z: here[2], y0: here[1], w: 6, d: 6, h: 3 }, radius: 16, elevation: 35, yaw: 0 };
            const a = await shoot(`${slug}-a`, [1440, 900], { ...shotBase, focus: { x: here[0], z: here[2], y0: here[1], w: 6, d: 6, h: 3 }, radius: 16, elevation: 35, arrows: arrows.map(arrow => ({ at: here, vector: arrow.vector, letter: arrow.letter, color: arrow.color, length: 9, blocked: arrow.blocked })) });
            const asked = await ask(decide, M.moveDirectionMode, { ...base, pictures: { arrows: `${mover.name} now, from 35° above; the lettered arrows go out of them (warm rise, cool fall, level ones flat).` }, arrows: arrows.map(arrow => ({ letter: arrow.letter, said: `${arrow.rise}, toward ${arrow.said}` })), others }, null, { request: { images: { arrows: a.png } } });
            const reply = key => asked.replies.find(entry => entry.key === key)?.value;
            const choice = String(reply('direction') ?? 'stays'), how = String(reply('how') ?? 'walk'), because = reply('line') ?? null;
            const moveRecord = { person, direction: choice, how, line: because, ...(hint ? { digest: moveWords(hint) } : {}) };
            if (choice === 'stays') { cardRecord.moves.push({ ...moveRecord, moved: false }); return; }
            if (choice.startsWith('with:')) {
              const leader = choice.slice(5), there = positions[leader] ? at(positions[leader][0]) : null;
              if (!there) { cardRecord.moves.push({ ...moveRecord, moved: false }); return; }
              const { nodes } = around(there[0], there[2], 6), near = nodes.filter(node => Math.abs(node.y - there[1]) < 1 && Math.hypot(node.x - there[0], node.z - there[2]) <= 2.5).map(node => node.id);
              moveTo(person, walk(scene, `${slug}|with`, positions[person], near, how), how, `with ${names.get(leader)}`);
              return;
            }
            const arrow = arrows.find(entry => entry.letter === choice) ?? arrows[0], reach = C.REACH[how] ?? C.REACH.walk;
            // The spots are looked for within 100 m (a flight's far end is boxed, not listed): the world streams in no further.
            const pool = around(here[0], here[2], Math.min(reach, 100) + 10), wedge = C.wedgeOnGround(here, arrow.vector, reach);
            // b. The spot: rooms, roofs, open ground and people inside the wedge, nearest first.
            const spots = [], groups = new Map();
            for (const node of pool.nodes) {
              if (!C.inWedge(here, arrow.vector, [node.x, node.y, node.z], 60) || Math.hypot(node.x - here[0], node.y - here[1], node.z - here[2]) < 2.5) continue;
              const what = said([node.x, node.y, node.z]).replace(/ \(.*\)$/, ''), band = node.type === 1 ? `${what}, about ${Math.max(5, Math.round(Math.hypot(node.x - here[0], node.z - here[2]) / 5) * 5)} m ahead` : what;
              (groups.get(band) ?? groups.set(band, []).get(band)).push(node);
            }
            for (const [what, nodes] of groups) { const d = Math.min(...nodes.map(node => Math.hypot(node.x - here[0], node.y - here[1], node.z - here[2]))); if (!/a wall/.test(what)) spots.push({ what, nodes: nodes.map(node => node.id), d }); }
            for (const other of others) { const p = at(positions[other.id][0]); if (C.inWedge(here, arrow.vector, p, 60) && Math.hypot(p[0] - here[0], p[2] - here[2]) <= reach) spots.push({ what: `beside ${other.name}`, nodes: pool.nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) <= 2).map(node => node.id), d: Math.hypot(p[0] - here[0], p[2] - here[2]) }); }
            const offered = spots.filter(spot => spot.nodes.length).sort((x, y) => x.d - y.d).slice(0, 16).map((spot, n) => ({ ...spot, letter: String.fromCharCode(65 + n) }));
            let targets = null, how2 = how;
            if (offered.length) {
              const b = await shoot(`${slug}-b`, [1440, 900], { ...shotBase, focus: { x: here[0], z: here[2], y0: here[1], w: 6, d: 6, h: 3 }, radius: Math.max(16, reach * 0.7), elevation: 35, arrows: [{ at: here, vector: arrow.vector, letter: arrow.letter, color: arrow.color, length: Math.min(reach, 30) }], ...(wedge ? { wedge: { points: wedge, y: here[1], color: arrow.color } } : {}) });
              const spotAsked = await ask(decide, M.moveSpotMode, { ...base, direction: `toward ${arrow.said} (arrow ${arrow.letter}, ${how})`, pictures: { wedge: `${mover.name}, the chosen arrow and its wedge, as far as a ${how} reaches.` }, spots: offered.map(spot => ({ letter: spot.letter, said: `${spot.what} (${Math.round(spot.d)} m)` })) }, null, { request: { images: { wedge: b.png } } });
              const spot = String(spotAsked.replies.find(entry => entry.key === 'spot')?.value ?? 'none'), chosen = offered.find(entry => entry.letter === spot);
              moveRecord.spot = chosen ? chosen.what : 'none';
              if (chosen) targets = chosen.nodes;
            }
            if (!targets && calls < budget) {
              // c1: a rough box on the plan along the arrow.
              const frame = C.frameAlong(here, arrow.vector, reach), half = (frame[2] - frame[0]) / 2, step = half > 60 ? 20 : half > 25 ? 10 : 5;
              const c1 = await shoot(`${slug}-c1`, [1024, 1024], { ...shotBase, topdown: { x: (frame[0] + frame[2]) / 2, z: (frame[1] + frame[3]) / 2, half }, grid: { box: frame, step, y: here[1] }, arrows: [{ at: here, vector: arrow.vector, letter: arrow.letter, color: arrow.color, length: Math.min(reach, half) }], ...(wedge ? { wedge: { points: wedge, y: here[1], color: arrow.color } } : {}) });
              const roughAsked = await ask(decide, M.moveRoughMode, { ...base, direction: `toward ${arrow.said} (arrow ${arrow.letter}, ${how})`, pictures: { plan: `straight down, north up, ${Math.round(half * 2)} m across, a grid of ${step} m; ${mover.name}'s arrow and its wedge drawn.` } }, null, { request: { images: { plan: c1.png } } });
              const roughReply = roughAsked.replies.find(entry => entry.key === 'box'), roughBox = roughReply?.box ?? roughReply?.value, map = c1.view?.map;
              if (roughBox?.left !== undefined && map) {
                const rough = C.planToGround([roughBox.left, roughBox.top, roughBox.right, roughBox.bottom], map), mid = [(rough[0] + rough[2]) / 2, (rough[1] + rough[3]) / 2], zoom = Math.max(6, (rough[2] - rough[0]) * 0.75, (rough[3] - rough[1]) * 0.75);
                // c2: the rough box zoomed top-down, and its column from the side with its heights lettered.
                const spot = around(mid[0], mid[1], zoom + 4);
                const standing = [...new Set(spot.nodes.filter(node => node.lot >= 0 && node.lot < world.lots.length && node.x >= rough[0] && node.x <= rough[2] && node.z >= rough[1] && node.z <= rough[3]).map(node => node.lot))].map(index => ({ name: lotName(index), bottom: 0, floors: world.lots[index].height ?? world.lots[index].floors }));
                const roofs = Math.max(0, ...standing.map(entry => entry.floors * FLOOR)), slices = C.columnSlices(standing, { top: how === 'flight' ? 60 : how === 'leap' ? roofs + 15 : roofs + 5 });
                const side = C.sideView(rough, arrow.vector, slices), radius = Math.max(12, side.focus.h * 0.55), distance = radius / Math.tan(Math.PI / 8);
                const plan = await shoot(`${slug}-c2-plan`, [1024, 1024], { ...shotBase, topdown: { x: mid[0], z: mid[1], half: zoom }, grid: { box: [mid[0] - zoom, mid[1] - zoom, mid[0] + zoom, mid[1] + zoom], step: 1, y: 0 } });
                const heights = await shoot(`${slug}-c2-side`, [1440, 900], { ...shotBase, focus: side.focus, radius, vague: { near: distance * 1.05, far: distance * 1.9 }, yaw: side.yaw, elevation: side.elevation, slices: slices.map(slice => ({ box: rough, y: slice.y, label: `${slice.letter} ${slice.said}` })) });
                const exactAsked = await ask(decide, M.moveExactMode, { ...base, direction: `toward ${arrow.said} (arrow ${arrow.letter}, ${how})`, slices: slices.map(slice => ({ letter: slice.letter, said: slice.said })), pictures: { plan: `the rough box's ground close up, straight down, north up, ${Math.round(zoom * 2)} m across, a grid of 1 m.`, heights: 'the rough box\'s column from the side, its heights lettered.' } }, null, { request: { images: { plan: plan.png, heights: heights.png } } });
                const exactReply = exactAsked.replies.find(entry => entry.key === 'box'), exactBox = exactReply?.box ?? exactReply?.value, height = slices.find(slice => slice.letter === exactAsked.replies.find(entry => entry.key === 'height')?.value) ?? slices.find(slice => slice.y === 0);
                const exact = exactBox?.left !== undefined && plan.view?.map ? C.planToGround([exactBox.left, exactBox.top, exactBox.right, exactBox.bottom], plan.view.map) : rough;
                moveRecord.box = exact; moveRecord.height = height ? height.said : null;
                // The cells a person can stand on in the box, at the height said (in the air: the nearest under it).
                const inBox = spot.nodes.filter(node => node.x >= exact[0] - 1 && node.x <= exact[2] + 1 && node.z >= exact[1] - 1 && node.z <= exact[3] + 1);
                const y = height?.y ?? 0, best = Math.min(...inBox.map(node => Math.abs(node.y - y) + (height?.air && node.y > y ? 100 : 0)));
                targets = inBox.filter(node => Math.abs(node.y - y) + (height?.air && node.y > y ? 100 : 0) <= best + 0.5).map(node => node.id);
                if (height?.air) moveRecord.air = true;
                if (how === 'flight' || how === 'leap') how2 = 'run';
              }
            }
            if (!targets?.length) { cardRecord.moves.push({ ...moveRecord, moved: false, why: 'no place to stand there', code: 'NO_TARGET' }); return; }
            const path = walk(scene, slug, positions[person], targets, how2);
            moveTo(person, path, how2, path ? null : walk.failed);
            Object.assign(cardRecord.moves.at(-1), moveRecord);
            await save();
          };
          const followers = [];
          const digestMove = async person => {
            const all = digestIn(dg.moves, card).filter(entry => entry.motion !== 'still' && entry.sure >= MOVE_SURE), mine = all.filter(entry => entry.who === person);
            if (!mine.length) { cardRecord.moves.push({ person, direction: 'still', moved: false, by: 'digest' }); return; }
            const far = mine.find(entry => entry.motion === 'elsewhere');
            // Two going together, each "with" the other: the one carried follows; else the one the digest named first leads.
            const theirs = far?.with ? all.find(entry => entry.who === far.with && entry.motion === 'elsewhere') : null;
            const follows = far?.with && far.with !== person && positions[far.with] && (theirs?.with !== person || (far.how === 'carried' ? true : theirs.how === 'carried' ? false : all.indexOf(far) > all.indexOf(theirs)));
            if (follows) { followers.push({ person, leader: far.with, entry: far }); return; }
            if (far) { if (calls < budget) await jevMove(person, far); else cardRecord.moves.push({ person, why: 'budget spent' }); return; }
            for (const entry of mine.slice(0, 3)) {
              const target = gradedTarget(person, entry);
              if (target === null) { cardRecord.moves.push({ person, direction: entry.motion, moved: false, why: 'digest: no spot to step to', by: 'digest' }); continue; }
              moveTo(person, walk(scene, `${scene.id}|${card.id}|${person}|${entry.sentence}|${entry.motion}`, positions[person], [target], entry.how === 'run' ? 'run' : 'walk'), entry.how, `digest: ${moveWords(entry)}`, { quiet: true });
              Object.assign(cardRecord.moves.at(-1), { direction: entry.motion, line: entry.sentence, by: 'digest' });
            }
          };
          const movers = card.kind === 'dialogue' ? (read(card) ? [...new Set(digestMovers(card))] : [])
            : [...new Set([...card.people.filter(entry => positions[entry.id] && entry.how.includes('acts')).map(entry => entry.id), ...(read(card) ? digestMovers(card) : [])])];
          for (const person of movers) {
            if (read(card)) { await digestMove(person); continue; }
            if (calls >= budget) { cardRecord.moves.push({ person, why: 'budget spent' }); continue; }
            await jevMove(person);
          }
          for (const { person, leader, entry } of followers) {
            const t = at(positions[leader][0]), here = at(positions[person][0]);
            if (Math.hypot(t[0] - here[0], t[2] - here[2]) <= 2.5 && Math.abs(t[1] - here[1]) < 1) { cardRecord.moves.push({ person, why: `with ${names.get(leader) ?? leader}: already beside them`, moved: false, by: 'digest' }); continue; }
            moveTo(person, walk(scene, `${scene.id}|${card.id}|${person}|with`, positions[person], near(t, 0.8, 2.5).map(node => node.id), entry.how === 'run' ? 'run' : 'walk'), entry.how, `with ${names.get(leader) ?? leader}`);
            Object.assign(cardRecord.moves.at(-1), { direction: 'elsewhere', line: entry.sentence, digest: moveWords(entry) });
          }
          // What the text says or implies about where people are (the digest's facts up to this card): someone whose spot
          // disagrees with a binding fact moves to the nearest spot that agrees (an implied move); a stated fact no spot near
          // agrees with is recorded under L14. Then the background's routine, the crowd, and the things people carry.
          if (dg) { factsDue(); drift(); carry(); }
          if (read(card) && digestIn(dg.breaks, card).some(entry => entry.sure >= 0.7)) { cardRecord.breaks = true; cardRecord.breaksSaid = digestIn(dg.breaks, card).map(entry => entry.what); }
          // Destruction (docs/v2/world-engine-redesign.md §3): a card the text says breaks something is asked where it hits (lettered
          // red spheres on the world as played) and how big (spheres of 4, 8, 16 and 32 m from two sides); the blast is applied
          // to the world and played before the next card.
          if (cardRecord.breaks && calls < budget) {
            const played = await grow(scene, run), at_ = Math.max(0, (played?.end ?? 0) - 0.02), slug = `${scene.id.slice(-3)}-${card.id.replace(/[^a-z0-9_]/gi, '_')}-hit`;
            await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: `${slug}-look`, place: scene.placeId, at: at_, only: [scene.placeId], frame: [1440, 900] })})`);
            const spots = await chrome.evaluate(`window.__stage.impactSpots(${JSON.stringify({ place: scene.placeId })})`) ?? [];
            const about = `A still of a 3D model of a place in a novel, as the story stands at this card. Blue lattices are the buildings' corridors and orange their stairs; small labelled figures are people.\nThe card: ${event.text}`;
            if (spots.length) {
              // Framed on the spots: their middle, far enough back to hold them all.
              const mid = [spots.reduce((sum, spot) => sum + spot.x, 0) / spots.length, spots.reduce((sum, spot) => sum + spot.y, 0) / spots.length, spots.reduce((sum, spot) => sum + spot.z, 0) / spots.length];
              const spread = Math.max(10, ...spots.map(spot => Math.hypot(spot.x - mid[0], spot.z - mid[2])));
              const where = await shoot(`${slug}-where`, [1440, 900], { place: scene.placeId, at: at_, only: [scene.placeId], focus: { x: mid[0], z: mid[2], y0: mid[1] - 1, w: 2, d: 2, h: 2 }, radius: spread * 1.3 + 4, elevation: 35, spheres: spots.map(spot => ({ ...spot, r: 2.5 })) });
              const letters = spots.map(spot => spot.label);
              const [pick] = await decide(`${about}\nPicture "where": the place at this moment, with ${letters.length} lettered red spheres where it might break a building.`, [{ key: 'where', primitive: 'choice', instructions: 'Which lettered red sphere in picture "where" is where this card breaks something? Answer none if it breaks nothing.', options: [...letters, 'none'], optionHints: Object.fromEntries([...spots.map(spot => [spot.label, `${spot.label}: on ${spot.from}`]), ['none', 'it breaks nothing']]) }], { images: { where: where.png } });
              const chosen = spots.find(spot => spot.label === pick?.value);
              cardRecord.hit = { pick: pick?.value ?? null };
              if (chosen) {
                const SIZES = [4, 8, 16, 32], focus = { x: chosen.x, y0: chosen.y - 1, z: chosen.z, w: 2, h: 2, d: 2 }, rings = SIZES.map((size, n) => ({ x: chosen.x, y: chosen.y, z: chosen.z, r: size / 2, label: `${n + 1}`, outline: true }));
                const near = await shoot(`${slug}-near`, [1440, 900], { place: scene.placeId, at: at_, only: [scene.placeId], focus, radius: 22, spheres: rings }), side = await shoot(`${slug}-side`, [1440, 900], { place: scene.placeId, at: at_, only: [scene.placeId], focus, radius: 22, yaw: Math.PI / 2, elevation: 20, spheres: rings });
                const [size] = await decide(`${about}\nPictures "near" and "side": where it hits, close up from two sides, four red spheres round the point labelled 1 to 4: ${SIZES.map((size, n) => `${n + 1} is ${size} m across`).join(', ')}.`, [{ key: 'size', primitive: 'choice', instructions: 'Which labelled sphere is the size of what this card breaks?', options: SIZES.map((_, n) => `${n + 1}`) }], { images: { near: near.png, side: side.png } });
                const r = (SIZES[Number(size?.value) - 1] ?? 8) / 2;
                E.reach(chosen.x, chosen.z, r + 16);
                E.hitSphere(scene, { id: event.id }, { x: chosen.x, y: chosen.y, z: chosen.z, r }, 0.9, `${scene.id}|${event.id}|hit`);
                cardRecord.hit = { pick: chosen.label, on: chosen.from, across: r * 2, struck: !!E.hits.get(event.id) };
              }
            }
          }
          run.events.push({ at: Object.fromEntries(Object.entries(positions).map(([who, value]) => [who, value])) });
          // A card no one was asked about: the producer's camera on the people of the card, as they stood when it began.
          if (!cardRecord.camera) { const points = event.actors.filter(who => positions[who]).map(who => at(positions[who][0])); if (points.length) { const mid = [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length); cardRecord.camera = { focus: { x: mid[0], z: mid[2], y0: mid[1], w: 6, d: 6, h: 3 }, radius: 16, elevation: 35, yaw: 0 }; } }
          // The producer's camera rides with the card's event: the player and World · Live follow it card by card.
          event.camera = cardRecord.camera ?? null;
          // Streamed: the line as far as this card, played on in World · Live; a moment to watch a move before the next question.
          await grow(scene, run);
          const went = cardRecord.moves.filter(move => move.moved);
          await stream(`scene ${Number(scene.id.slice(-3))} · card ${cards.indexOf(card) + 1}/${cards.length}${went.length ? ` · ${went.map(move => names.get(move.person) ?? move.person).join(', ')} moved` : ''}`, cardRecord.camera ? { x: cardRecord.camera.focus.x, z: cardRecord.camera.focus.z, r: 24 } : null);
          if (pace && went.length) await new Promise(done => setTimeout(done, pace * 1000));
        }
        // The scene done: the live page written whole (every card so far), so a view loaded now can replay any of them.
        await stream(`scene ${Number(scene.id.slice(-3))} played`, null, true);
        before = { scene, reads, positions: { ...positions } };
        for (const [who, value] of Object.entries(positions)) where.set(who, value);
        endOf.set(scene.id, { ...positions });
        const fork = strandScene.get(scene.id)?.fork;
        if (fork) { const inStrand = lastIn.get(fork) ?? lastIn.set(fork, new Map()).get(fork); for (const [who, value] of Object.entries(positions)) inStrand.set(who, value); }
        log(`${scene.id}: ${cards.length} cards, ${sceneRecord.cards.reduce((n, card) => n + card.moves.filter(move => move.moved).length, 0)} moves, ${calls} calls so far`);
        await save();
      }
      // The things placed over the line, for the record.
      record.items = [...things.values()].map(thing => ({ id: thing.id, name: thing.name, size: thing.size, holder: thing.holder, placements: thing.placed.length, broken: thing.broken, events: thing.events }));
      result = { data: { ...withLine(page), title: `The director · ${from} – ${to}`, director: payload() }, calls };
      // The run as a playable run of the book (stage/simulation/index.json, the Player's list): replayed card by card. A
      // stand-in's run (rule-made answers) is not one: it is only for trying the loop.
      if (jev.modelId !== 'stand-in-director') {
      const folder = join(novelDir, 'stage', 'simulation'), id = `d${record.startedAt.replace(/\D/g, '').slice(0, 14)}`;
      await mkdir(join(folder, 'runs', 'director'), { recursive: true });
      await writeFile(join(folder, 'runs', 'director', `${id}.page.json`), JSON.stringify(result.data));
      const index = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8').catch(() => 'null')) ?? { version: 2, strands: {} };
      const entry = index.strands.director ??= { title: 'The director', runs: [] };
      entry.runs.push({ id, scenes: E.chosen.length, page: `runs/director/${id}.page.json` }); entry.accepted = id;
      await writeFile(join(folder, 'index.json'), JSON.stringify(index, null, 1));
      // The run's world log, the laws over it and its proposals to the ontology (Track B W1, W2: logged, nothing applied).
      const written = await writeWorldLog(novelDir, { run: id, reading });
      log(`world log: ${JSON.stringify(written.log)}; laws broken: ${Object.entries(written.laws).filter(([, law]) => law.broken).map(([law, { broken }]) => `${law} ${broken}`).join(', ') || 'none'}`);
      // This run smoothed (W5b): each person's clouds and least-action history, for Why and the report, and who is likely
      // on the stage where the script says otherwise.
      try {
        const runLog = (await readFile(join(novelDir, 'stage', 'world', 'log', `${id}.jsonl`), 'utf8')).split('\n').filter(Boolean).map(row => JSON.parse(row));
        const smoothedNow = SM.smoothRun({ page: JSON.parse(await readFile(join(folder, 'runs', 'director', `${id}.page.json`), 'utf8')), log: runLog, record, reading, strands: strandsNow, pins });
        await mkdir(join(novelDir, 'stage', 'world', 'smoothed'), { recursive: true });
        const onNow = OC.occupation({ reading, script: JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8').catch(() => '{"scenes":[]}')), strands: strandsNow, pins });
        await writeFile(join(novelDir, 'stage', 'world', 'smoothed', `${id}.json`), JSON.stringify({ version: 1, run: id, ...smoothedNow, onStage: onNow.proposals, on: onNow.on }));
        record.smoothing = { ...(record.smoothing ?? {}), after: { moments: Object.values(smoothedNow.people).reduce((n, list) => n + list.length, 0), revisions: smoothedNow.revisions.length } };
      } catch (error) { record.smoothing = { ...(record.smoothing ?? {}), error: String(error.message ?? error) }; }
      // What the run settled into canon (W6, canon.mjs), each by its gate, undoable; the graph rebuilt from the bundle. First,
      // so what it holds (the lines no one could settle, the audits) goes to the review with the rest.
      try {
        record.review.canon = await C6.toCanon(novelDir, { run: id, reading, speakers });
        const { buildGraphFromBundle } = await load('dist/src/ground/connectors/ladybug.js');
        await buildGraphFromBundle(join(novelDir, 'ontology'), join(novelDir, 'ontology', 'graph.lbug'));
      } catch (error) { record.review.canon = { error: String(error.message ?? error) }; }
      log(`canon: ${JSON.stringify(record.review.canon)}`);
      // What the laws held goes to the main agent (W5): one batch per scene by reach, sent to its console when one is given.
      const held = await R.holdForReview(novelDir, { run: id, name: who => names.get(who) ?? who, skip: speakers ? [] : ['who-speaks', 'audit', 'speaker'] }).catch(error => ({ error: String(error.message ?? error) }));
      record.review.held = { held: held.held, asked: held.asked, left: held.left, batches: held.batches?.length ?? 0, ...(held.error ? { error: held.error } : {}) };
      if (agent && held.batches?.length) record.review.sent = Object.keys(await R.sendToAgent(novelDir, agent.console, { expiresAt: agent.expiresAt })).length;
      log(`review: ${held.held ?? 0} held, ${held.batches?.length ?? 0} batches${agent ? ' sent to the main agent' : ''}`);
      }
    } finally { await chrome.close(); server.server.close(); }
  } });
  record.finishedAt = new Date().toISOString(); record.calls = calls;
  await save();
  // The run's own copies: its record, the laws over it, and the questions Jev was asked in it.
  await copyFile(join(out, 'run.json'), join(runDir, 'run.json')).catch(() => {});
  const lawsNow = JSON.parse(await readFile(join(out, 'laws.json'), 'utf8').catch(() => 'null'));
  if (lawsNow?.run === runId) await writeFile(join(runDir, 'laws.json'), JSON.stringify(lawsNow, null, 1));
  const framesNow = (await readFile(framesFile, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  if (framesNow.length > framesBefore) await writeFile(join(runDir, 'frames.jsonl'), framesNow.slice(framesBefore).join('\n') + '\n');
  await writeFile(join(runDir, 'index.json'), JSON.stringify({ version: 1, run: runId, from, to, model: jev.modelId, startedAt: record.startedAt, finishedAt: record.finishedAt, calls,
    files: { record: 'run.json', laws: 'laws.json', log: 'run.log', pins: 'pins.json', frames: 'frames.jsonl', page: `../../../simulation/runs/director/${runId}.page.json`, worldLog: `../../../world/log/${runId}.jsonl`, ledger: `../../../world/ledger/${runId}.jsonl`, smoothed: `../../../world/smoothed/${runId}.json`, canon: '../../../world/canon.jsonl', pool: '../../../world/pool.jsonl', answers: '../../../world/answers.jsonl' } }, null, 1));
  log(`run ${runId} done: ${calls} calls; its records in stage/director/runs/${runId}/`);
  return { record, ...result };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, budget: { type: 'string' }, 'stand-in': { type: 'boolean' }, live: { type: 'boolean' }, pace: { type: 'string' }, agent: { type: 'string' }, 'no-digest': { type: 'boolean' }, 'no-speakers': { type: 'boolean' } } });
  if (!novelDir || !values.reading || !values.from || !values.to) { console.error('usage: node world-engine/director/director.mjs <novel-dir> --reading <data.json> --from <scene> --to <scene> [--budget 60] [--stand-in] [--live]'); process.exit(2); }
  const reading = JSON.parse(await readFile(values.reading, 'utf8'));
  let jev = standIn();
  if (!values['stand-in']) {
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
    jev = cachedDecisions(jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL }), join(resolve(novelDir), 'stage', 'director', 'cache'));
  }
  // System 2's work model (WORK_LLM_*), cached as Jev is; without one, system 2 is off and says so.
  let workModel = null;
  if (!values['stand-in'] && process.env.WORK_LLM_API_KEY) {
    const { workModelFromEnv } = await load('dist/src/ground/connectors/workModel.js'), { cachedWork } = await load('dist/src/digger/timeplace/cache.js');
    workModel = cachedWork(workModelFromEnv(process.env), join(resolve(novelDir), 'stage', 'director', 'cache-work'));
  } else if (!values['stand-in']) console.error('system 2 off: no work model configured (WORK_LLM_API_KEY)');
  let live = null;
  if (values.live && values['stand-in']) { console.error('a stand-in run does not write the live view (its answers are made by rule)'); process.exit(2); }
  if (values.live) { const { createLive } = await import('../live/sim-jev.mjs'); live = await createLive(resolve(novelDir), { command: 'sim direct', lines: [{ id: 'director', title: 'The director: cards played forward' }], model: jev.modelId }); jev = live.watch(jev); }
  try {
    // --agent <host state dir>: the main agent's console (Pi, through the host's queue) the held batches are sent to.
    const agentLinks = values.agent ? JSON.parse(await readFile(join(resolve(values.agent), 'links.json'), 'utf8').catch(() => '{}')) : null;
    const agent = values.agent ? { console: join(resolve(values.agent), 'runtime', 'pi-console'), expiresAt: agentLinks?.expiresAt ? Date.parse(agentLinks.expiresAt) || agentLinks.expiresAt : Date.now() + 3600_000 } : null;
    const { record } = await direct(resolve(novelDir), { reading, readingPath: values.reading, agent, digest: !values['no-digest'], speakers: !values['no-speakers'], from: values.from, to: values.to, jev, workModel, budget: values.budget ? Number(values.budget) : Infinity, live, pace: values.pace ? Number(values.pace) : values.live ? 6 : 0 });
    const moves = record.scenes.flatMap(scene => scene.cards.flatMap(card => card.moves));
    const second = record.scenes.flatMap(scene => [...(scene.system2 ?? []), ...scene.cards.flatMap(card => card.system2 ?? [])]);
    console.error(`system 2: ran on ${second.length} answers, the work model's used for ${second.filter(entry => entry.used === 'work').length}, differing from Jev's on ${second.filter(entry => entry.work && String(entry.work.value) !== String(entry.jev.value)).length}`);
    console.log(JSON.stringify({ calls: record.calls, scenes: record.scenes.length, cards: record.scenes.reduce((n, scene) => n + scene.cards.length, 0), moved: moves.filter(move => move.moved).length, stayed: moves.filter(move => move.direction === 'stays').length, unmoved: moves.filter(move => move.moved === false && move.direction !== 'stays').length }));
    await live?.finish('done');
  } catch (error) { await live?.finish('failed', { error: String(error?.message ?? error).slice(0, 300) }); throw error; }
}
