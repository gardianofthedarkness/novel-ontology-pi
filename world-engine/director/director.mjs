// The director's loop (docs/v2/director-camera.md; the user's design, 2026-11-02): a line's scenes played forward card by
// card on the world the terrain built, people starting where spawning put them. Only dialogue and action cards are played:
// - an action card: each person acting is asked, on the camera operator's shots (src/v2/context/camera.ts), which way they
//   go (fourteen lettered arrows, stays, or with someone), then where (a spot inside the arrow's wedge), and only when no
//   spot fits, a rough box on a plan and then the exact box and its height (src/v2/context/directorModes.ts);
// - a dialogue card: those spoken to come within speaking distance of the speaker (a rule, no question).
// Each move is walked on the world's path integral (its windowed walk graph, rooms through their doors). Nothing is
// replayed: the engine is built once (export-strand-demo.mjs's `engine` hook) and the page written once a scene.
//   npm run build && node world-engine/director/director.mjs <novel-dir> --reading <reading>/v2/data.json --from <scene> --to <scene>
//     [--budget 60] [--stand-in] [--live] [--pace 6] [--agent <host state>] [--no-digest] [--no-speakers] [--no-jev-review]
// --no-digest: without the summarizer (digest.mjs), the pass and Jev's text questions as before; --no-speakers: no line's
// speaker settled or held for the review (a run on actions and items).
// --pace: seconds the live view is given to play each move before the next question (6 with --live).
// --stand-in answers every question by rule (no model call), for trying the loop; without it Jev is asked (paid).
import { appendFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const C = await load('dist/src/v2/context/camera.js'), CB = await load('dist/src/v2/context/cutBag.js'), M = await load('dist/src/v2/context/directorModes.js'), { ask } = await load('dist/src/v2/context/engine.js');
const S = await load('dist/apps/playground/src/data/skeleton.js'), { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
const { strandDemo, inlineStrand } = await import('../world/export-strand-demo.mjs');
const { browser, serve } = await import('../view/two-view-things.mjs');
const { VENDOR_FILES, PICKER_MODEL, retried } = await import('../live/sim-jev.mjs');
const { passScene } = await import('./pass.mjs');
const { withSystem2 } = await import('./system2.mjs');
const { writeWorldLog } = await import('../log/write-log.mjs');
const R = await import('../review/review.mjs'), JR = await import('../review/jev-review.mjs'), C6 = await import('../review/canon.mjs'), SM = await import('../smoother/smoother.mjs'), OC = await import('../smoother/occupation.mjs');
const SKY = await import('../digest/sky.mjs');
const OM = await import('./on-the-move.mjs'), RD = await import('../world/roads.mjs');
const RM = await import('../digest/rooms.mjs');
const TR = await import('../digest/transport.mjs');
const WF = await import('./workflow.mjs'), AT = await import('../laws/attacks.mjs'), IU = await import('../digest/in-use.mjs'), MT = await import('../digest/mounts.mjs'), CF = await import('../crowd/field.mjs'), DG = await import('../digest/digest.mjs'), FA = await import('../digest/facts.mjs'), LY = await import('../world/layers.mjs'), AIR = await import('../world/air.mjs'), UN = await import('../digest/underground-note.mjs'), G = await import('./gate.mjs'), LW = await import('../laws/laws.mjs');
import { copyFile } from 'node:fs/promises';
import { overridesOf, setting } from '../../dist/src/v2/settings.js';

const CELL = setting('grid.cell'), FLOOR = setting('grid.floor'), PRESENT = new Set(['speaks', 'acts', 'addressed']);
// The digest's moves played: at least this sure (below it, motion read into a spoken line or a thought).
const MOVE_SURE = setting('director.moveSure');
// Human scale, the one unit kept (physics-laws.md §9): a person's height. Every other distance is a referent measured in
// the world or a speed times the story's time.
const BODY = setting('body.height');
/** How far the layout artist and the checks look for a spot that agrees with the notes (metres; was 6 bodies, W10). */
const FACT_SEARCH = setting('director.factSearch');
// How far round a unit's start a spot under the street is looked for, when the unit is underground (metres).
const UNDER_SEARCH = setting('director.underSearch');
// The widest a crowd's field reaches round the anchor (metres): the open ground a camera takes in, never a district or the
// city. W13 (2026-11-07) died in scene 249 when a crowd sized by a city-wide frame asked for the walk graph of most of the
// city, more steps than a map holds; W12's scene 153 crowd at 718 m had put 2,018,700 people on a district.
const CROWD_REACH = setting('director.crowdReach');
// The widest window a look round a point builds (metres): a wider radius looks within this one (W13: the same crash).
const AROUND_MOST = setting('director.aroundMost');
// Earshot on the street (metres; L6's public talk): those within it of one another at a scene start stand together.
const EARSHOT = setting('talk.earshot');
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
    // Its answers turn with a count of the questions; one asked since that count was set (the architect's room) is left out
    // of it, so a new question never reshuffles every answer after it (a rehearsal compares like with like).
    if (!questions.every(question => question.key === 'room')) n++;
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

export async function direct(novelDir, { reading, readingPath = null, prefilm = null, from, to, jev, workModel = null, budget = Infinity, live = null, pace = 0, agent = null, reviewer = null, digest = true, speakers = true, smoothing = null, blasts = [], onTheMove = true, log = console.error }) {
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
  // One unit (the user, 2026-11-04: the reading's tiler cuts segments, and the split between scenes and segments is gone;
  // segments.mjs): each of the reading's scenes is one segment and one container, under its own id. The reading's, the
  // world script's, the spawn plan's and the strands' views by physics are built here and played (kept beside the world
  // files in stage/world/segments for the log, the laws and the rehearsal).
  const worldFile = async name => JSON.parse(await readFile(join(novelDir, 'stage', 'world', name), 'utf8').catch(() => 'null'));
  const SG = await import('./segments.mjs'), seg = SG.segmentWorld({ reading, script: await worldFile('script.json'), spawn: await worldFile('spawn.json'), backCredits: setting('director.backCredits', { book: novelDir }) });
  if (!seg) throw new Error('the reading has no scenes to play');
  const segStrands = SG.strandsFile(seg.script, await (await import('./strand-builder.mjs')).strandBuilder(novelDir), { reading: seg.reading });
  const segForkOf = new Map((segStrands.scenes ?? []).map(entry => [entry.id, entry.fork ?? entry.id]));
  reading = seg.reading;
  const scriptOf = async () => seg.script ?? { scenes: [] }, strandsOf = async () => segStrands, spawnOf = async () => seg.spawn;
  { const dir = join(novelDir, 'stage', 'world', 'segments'); await mkdir(dir, { recursive: true }); const { strands: _, ...file } = segStrands; await Promise.all([writeFile(join(dir, 'script.json'), JSON.stringify(seg.script)), writeFile(join(dir, 'spawn.json'), JSON.stringify(seg.spawn)), writeFile(join(dir, 'strands.json'), JSON.stringify(file, null, 1))]); }
  // A container's name in the live view: its number.
  const sceneLabel = id => Number(String(id).slice(-6));
  const sceneOf = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
  // The beats (M3, gate.mjs) of a reading with blocks: each sentence's beat, its type and its lead. The camera cuts only
  // at a beat's start (M4).
  // Smoothed per strand (the user, 2026-11-03): each scene's fork from the workspace's strands.
  const forkOf = new Map(((await strandsOf())?.scenes ?? []).map(entry => [entry.id, entry.fork]));
  const gate = G.gateOf(G.windowsOf(reading), { strandOf: scene => forkOf.get(scene) ?? null }), beatOf = new Map();
  // The storyboard's cuts (the reading's storyboard step, src/v2/extraction/storyboard.ts): each line's cut, so a card plays
  // in the cut its first line is in, framed by its shot size and angle, timed by its seconds. A reading without one plays
  // the scale cast's beats as before.
  const cutAt = new Map();
  if (reading.storyboard?.length) { const order = reading.scenes.flatMap(entry => entry.sentences), at_ = new Map(order.map((id, n) => [id, n])); for (const cut of reading.storyboard) for (let k = at_.get(cut.first); k !== undefined && k <= (at_.get(cut.last) ?? -1); k++) cutAt.set(order[k], cut); }
  if (gate) { const order = reading.scenes.flatMap(entry => entry.sentences), at_ = new Map(order.map((id, n) => [id, n])); gate.beats.forEach((beat, n) => { for (let k = at_.get(beat.first); k <= at_.get(beat.last); k++) if (!beatOf.has(order[k])) beatOf.set(order[k], { n, type: beat.type, lead: beat.lead }); }); }
  const cardsOf = new Map();
  for (const card of reading.cards) { const id = sceneOf.get(card.first); if (id && ['action', 'dialogue'].includes(card.kind)) (cardsOf.get(id) ?? cardsOf.set(id, []).get(id)).push(card); }
  // The runtime workflow (workflow.mjs; the user, 2026-11-04): each storyboard cut a node with its tasks, statuses and
  // versions, ordered by the strands (a cut waits for the last earlier cut casting each of its people); every check
  // automatic, a task retaken at most twice, then passed with faults.
  const desk = WF.createDesk({ cuts: reading.storyboard?.length ? WF.castOfCuts({ storyboard: reading.storyboard, cards: reading.cards, present: PRESENT }) : [] });
  const out = join(novelDir, 'stage', 'director'), shots = join(out, 'shots'), work = join(out, 'page');
  await mkdir(shots, { recursive: true }); await mkdir(work, { recursive: true });
  // The reading as the reader shows it over the whole book (World · Live's play/reading.json): every sentence's kind, and the
  // names, descriptions and times detected in it with whom or what they mean (experiments/v2/marks.mjs, as the reading's page).
  await writeFile(join(out, 'reading.json'), JSON.stringify(await readerView(reading, new Map([...text].map(([id, entry]) => [id, entry.text])))));
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  const template = await readFile(join(repository, 'world-engine', 'view', 'strand-demo.html'), 'utf8');
  // The world generator schema's overrides in force for this run (config/world.schema.json; milestones M8b-c): none is today's world.
  const settingsInForce = overridesOf({ book: novelDir }).map(({ layer, place, key, value, table }) => ({ layer, place, key, value, table }));
  const record = { version: 1, model: jev.modelId, from, to, startedAt: new Date().toISOString(), scenes: [], units: seg.ids.length, settings: settingsInForce };
  // Where a run's time goes (the test cycle): the page reloaded in Chrome, the pictures shot, the walk graph built.
  const timing = { reloads: 0, reloadMs: 0, shots: 0, shotMs: 0, skipped: 0 }, runStarted = performance.now();
  let engineCost = null;
  // The review (Track B W5, review.mjs): the main agent's answers since the last run become pins under the laws, and the
  // director plays by them: presence, remote actors, talk kinds, arrivals, stays. Back-propagation is Bayesian smoothing
  // (W5b, smoother.mjs): the last run smoothed with every observation it had (the review's pins among them), each scene
  // starts its people where the least-action history has them, a revision above the limit held for the review; who is on
  // the stage is smoothed too (occupation.mjs), and someone surely there whom the script left out is added. The reading
  // played from is recorded for the review CLI (novel reading).
  if (readingPath) await writeFile(join(out, 'reading-path.json'), JSON.stringify({ path: resolve(readingPath) }));
  // The story sky (experiments/v2/sky.mjs, novel sky build: sky.json beside the reading played): each unit's time of day and
  // weather, carried on every page the director makes, so a page shows them on its own and not only inside World · Live.
  const playedFrom = readingPath ? resolve(readingPath) : JSON.parse(await readFile(join(out, 'reading-path.json'), 'utf8').catch(() => 'null'))?.path ?? null;
  const skyFile = playedFrom ? JSON.parse(await readFile(join(dirname(playedFrom), 'sky.json'), 'utf8').catch(() => 'null')) : null, skyPage = skyFile?.units ? SKY.skyForPage(skyFile.units) : null;
  // The settei cast's prop sheet (universe/props.json, experiments/v2/settei.mjs): each object's kind, shape, size and
  // flying height, by its name, and the slots that are vehicles or weapons by id (drawn as what they are, not as people).
  const propSheet = JSON.parse(await readFile(join(novelDir, '..', '..', 'universe', 'props.json'), 'utf8').catch(() => 'null'));
  const propOf = name => propSheet?.labels?.[name] ?? null, slotProp = id => (propSheet?.ids?.[id] ? propOf(propSheet.ids[id]) : null);
  // A car is drawn as one of the baked CC0 cars (apps/playground/tools/vehicle-models.mjs): a taxi or a police car by its
  // name, any other one of the three plain cars by a seed; every other vehicle the page builds from parts.
  const vehicleModels = JSON.parse(await readFile(new URL('../../apps/playground/src/data/vehicleModels.json', import.meta.url), 'utf8').catch(() => 'null'));
  // The rooms' furniture (the architect: digest/rooms.mjs), baked in metres; its footprints for the layouts.
  const furnitureModels = JSON.parse(await readFile(new URL('../../apps/playground/src/data/furnitureModels.json', import.meta.url), 'utf8').catch(() => 'null'));
  const furnitureSizes = Object.fromEntries(Object.entries(furnitureModels?.models ?? {}).map(([name, model]) => [name.replace('kk-furniture-', ''), model.size]));
  // The transport specialist (digest/transport.mjs; universe/transport.json, a pre-film step): which model a vehicle is
  // (Jev's pick among its kind's models, else the rule of its name's words) and whose each vehicle, weapon or machine is.
  const transport = JSON.parse(await readFile(join(novelDir, '..', '..', 'universe', 'transport.json'), 'utf8').catch(() => 'null'));
  // Models as code (src/v2/models; milestones M10e): a thing with a checked model of its own (novel model write|put) is drawn
  // as it, at the model's own size; any other car as a baked CC0 car, the rest from parts.
  const MD = await load('dist/src/v2/models/models.js'), modelCatalog = await MD.catalogOf(novelDir), modelStore = MD.storeOf(novelDir), scadMeshes = new Map();
  for (const [id, record] of Object.entries(modelCatalog.models ?? {})) if (record.state === 'ok' || (record.state === 'part' && String(record.part).startsWith('kit:'))) { const mesh = JSON.parse(await readFile(join(modelStore, `${id}.mesh.json`), 'utf8').catch(() => 'null')); if (mesh) scadMeshes.set(id, mesh); }
  const scadOf = name => { const id = modelCatalog.names?.[String(name ?? '')]; return id && scadMeshes.has(id) ? id : null; };
  // The warehouse's vehicle slots (`models.vehicles`, novel warehouse use <part> for vehicle:<kind>; milestones M10i): a
  // vehicle of a kind with no model of its own is drawn as the part the configuration names, its mesh on the page as a
  // model's is (src/v2/models/warehouse.ts meshOfPart; the page id of a part is idOfRef).
  const WH = await load('dist/src/v2/models/warehouse.js'), PR = await load('dist/src/v2/models/partRefs.js'), vehicleSlots = setting('models.vehicles');
  for (const ref of Object.values(vehicleSlots)) if (ref && !scadMeshes.has(PR.idOfRef(ref))) { const mesh = await WH.meshOfPart(ref, { novelDir }).catch(() => null); if (mesh) scadMeshes.set(PR.idOfRef(ref), mesh); }
  const slotModel = kind => { const ref = vehicleSlots[kind]; return ref && scadMeshes.has(PR.idOfRef(ref)) ? `scad:${PR.idOfRef(ref)}` : null; };
  const carModel = (prop, name) => { if (!prop?.kind) return null; const own = scadOf(name); if (own) return `scad:${own}`; const slot = slotModel(prop.kind); if (slot) return slot; if (!vehicleModels) return null; const model = TR.modelOf(transport, String(name ?? ''), prop.kind); return model && vehicleModels.models?.[model] ? model : null; };
  const scadSize = model => (String(model ?? '').startsWith('scad:') ? scadMeshes.get(model.slice(5))?.size ?? null : null);
  // What a vehicle does besides being seen (src/v2/models/interact.ts; milestones M15): its interaction sheet by kind and
  // size with the book's overrides (models.interact); the vehicles the text broke, each with its wreck part for the page.
  const IA = await load('dist/src/v2/models/interact.js');
  const sheetOf = id => { const prop = slotProp(id); return prop?.vehicle ? IA.interactOf({ ref: vehicleSlots[prop.kind] ?? null, kind: prop.kind, size: prop.size }) : null; };
  const wrecks = new Map();
  const ownerOf = name => transport?.props?.[String(name ?? '')]?.owner ?? null;
  // The settei cast's ability sheet (universe/abilities.json): what each person can do to move. A move goes one of those
  // ways only where the pre-film notes say the line has it in use (a move's or a journey's `ability`, in-use.json).
  const abilitySheet = JSON.parse(await readFile(join(novelDir, '..', '..', 'universe', 'abilities.json'), 'utf8').catch(() => 'null'));
  /** The way a move goes: the ability its note has in use, as the person's sheet allows it (else the move's own way). */
  // Riding (world-engine/digest/mounts.mjs): what carries someone (a person, a vehicle slot, or a vehicle the lines name,
  // `item:<label>`) has a sheet as abilities do; a ridden move goes the carrier's way, a vehicle's own move its own.
  const carrierOf = id => { if (!id) return null; if (id.startsWith('item:')) return MT.carrierSheet({ prop: propOf(id.slice(5)) }); const prop = slotProp(id); return prop?.vehicle ? MT.carrierSheet({ prop }) : MT.carrierSheet({ person: abilitySheet?.people?.[id] ?? { move: {} } }); };
  const ownVehicle = id => { const prop = slotProp(id); return prop?.vehicle ? MT.carrierSheet({ prop }) : null; };
  // A vehicle that keeps to the ground (a car, a van, a train, a boat: it rides and does not fly) never takes stairs, a jump
  // or a fall: its own way (`ride:<×>`) is the level ground, and a drive the roads and their decks. A path that changes its
  // floor moved it as a person (W15: unit 154's car run up an office tower's stairs to floor 3 by a layout note; unit
  // 179's van up six floors by the on-foot way a ride falls back to, which is for a rider who gets off).
  const groundVehicle = id => { const sheet = ownVehicle(id); return sheet?.move?.ride && !sheet.move.flight ? sheet : null; };
  const howFor = (person, ability, otherwise, riding = null) => {
    if (riding && carrierOf(riding)) return MT.wayOf({ carrier: carrierOf(riding), otherwise });
    if (ownVehicle(person)) return MT.wayOf({ carrier: ownVehicle(person), otherwise });
    const move = abilitySheet?.people?.[person]?.move ?? {};
    if (ability === 'climb' && move.climb) return `climb:${move.climb.height}`;
    if (ability === 'agility' && move.agility) return `agile:${move.agility.factor}`;
    if (ability === 'appear' && move.appear) return `teleport:${move.appear.reach}`;
    if (ability === 'flight' && move.flight) return 'flight';
    return otherwise;
  };
  const reviewed = await R.applyAnswers(novelDir).catch(error => ({ error: String(error.message ?? error) }));
  const pins = await R.loadPins(novelDir), lastRun = await R.latestRun(novelDir);
  const oldLog = lastRun ? (await readFile(join(novelDir, 'stage', 'world', 'log', `${lastRun}.jsonl`), 'utf8').catch(() => '')).split('\n').filter(Boolean).map(row => JSON.parse(row)) : [];
  const oldPage = lastRun ? JSON.parse(await readFile(join(novelDir, 'stage', 'simulation', 'runs', 'director', `${lastRun}.page.json`), 'utf8').catch(() => 'null')) : null;
  // run.json is the last run's record only if that run is the last one played (a stand-in's run is not on the list). The
  // run's own copy (runs/<run>/run.json) first: a run stopped or crashed since leaves its own run.json beside it, and the
  // smoothing went off without a word (W13's third pass, after a DNS blip, played with none).
  const lastRecord = lastRun ? JSON.parse(await readFile(join(out, 'runs', lastRun, 'run.json'), 'utf8').catch(() => 'null')) ?? JSON.parse(await readFile(join(out, 'run.json'), 'utf8').catch(() => 'null')) : null;
  const oldRecord = lastRecord && `d${String(lastRecord.startedAt).replace(/\D/g, '').slice(0, 14)}` === lastRun ? lastRecord : null;
  const strandsNow = await strandsOf();
  // A rehearsal may pass a smoothing in (rehearsal.mjs: the run before it smoothed, back-tested a second pass).
  const smoothed = smoothing ?? (oldPage && oldRecord && oldLog.length ? SM.smoothRun({ page: oldPage, log: oldLog, record: oldRecord, reading, strands: strandsNow, pins }) : null);
  // Each scene start the smoothing moved: where the least-action history has them, unless the review kept the history.
  const startsMoved = new Map((smoothed?.revisions ?? []).filter(revision => revision.card === null).map(revision => [`${revision.scene}|${revision.who}`, revision]));
  const onStage = OC.occupation({ reading, script: await scriptOf(), strands: strandsNow, pins });
  const surelyThere = new Set(onStage.proposals.filter(entry => entry.propose === 'present').map(entry => `${entry.scene}|${entry.who}`));
  record.smoothing = smoothed ? { from: lastRun, moments: Object.values(smoothed.people).reduce((n, list) => n + list.length, 0), revisions: smoothed.revisions.length, starts: startsMoved.size, onStage: onStage.proposals.length } : null;
  record.review = { applied: reviewed, from: lastRun, pins: { present: Object.keys(pins.present).length, remote: Object.keys(pins.remote).length, kind: Object.keys(pins.kind).length, arrive: Object.keys(pins.arrive).length, stays: Object.keys(pins.stays).length, meet: pins.meet.length } };
  record.revisions = [];
  // The narration order against the objective stranding (segments.mjs storyOrderProblems): units play in reading order and
  // land on their strands; none may continue, take its people from, or go back on the clock of a unit played after it.
  { const problems = SG.storyOrderProblems(seg.script, segStrands); record.storyOrder = { units: seg.script?.scenes?.length ?? 0, complies: !problems.length, problems: problems.slice(0, 20), count: problems.length }; }
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
  log(record.storyOrder.complies ? `story order: the narration complies with the strands (${record.storyOrder.units} units)` : `story order: ${record.storyOrder.count} units out of their strands' order, e.g. ${JSON.stringify(record.storyOrder.problems.slice(0, 3))}`);
  let calls = 0;
  /**
   * What the player shows of the run (strand-demo.html's card list): every card played, in order, with its own lines as
   * written, who moved and what Jev answered, the producer's camera, and its event on the timeline.
   */
  const payload = () => ({ model: record.model, cards: record.scenes.flatMap(scene => scene.cards.map(card => ({ scene: scene.scene, event: card.event, card: card.card, kind: card.pass ? 'pass' : card.kind, lines: card.lines, camera: card.camera ?? null,
    moves: card.moves.map(move => ({ who: move.person, name: names.get(move.person) ?? move.person, moved: !!move.moved, direction: move.direction ?? null, how: move.how ?? null, spot: move.spot ?? null, height: move.height ?? null, boxed: !!move.box, to: move.to ?? null, why: move.why ?? null, line: move.line ?? null })) }))),
    // The strands and the calendar (World · Live's strand panel and timeline, the player's traces): each unit's strand (its
    // fork), its place on the story's clock and its time-tree node, in the order played.
    units: (seg?.script?.scenes ?? []).map(entry => ({ id: entry.id, fork: segForkOf.get(entry.id) ?? entry.id, clock: entry.clock ?? null, when: entry.at?.node ?? null })) });
  // Jev's service comes and goes: a request is tried again after a pause (sim-jev.mjs retried).
  // System 2 (system2.mjs, Track B W3): what Jev answers below 0.5 is asked of the work model with the same context; both
  // answers kept with the card (or the scene, for its pass) being asked about.
  let asking = null;
  // What each model used (the user, 2026-11-03: track the cost): the work model's requests and tokens, for system 2 and for
  // the summarizer apart; Jev's calls.
  const workMeter = workModel ? DG.metered(workModel) : null, digestMeter = workModel && digest ? DG.metered(workModel) : null;
  // Each cast its own meter (M12: the run prices itself by cast and director).
  const meters = digestMeter ? Object.fromEntries(['cinematographer', 'blocking', 'actionDirector', 'dialogueCoverage', 'backgroundAction'].map(id => [id, DG.metered(workModel)])) : {};
  record.gate = gate ? { unit: gate.windows[0]?.unit ?? null, windows: gate.windows.length, beats: gate.beats.length, coverage: gate.coverage } : null;
  // Jev's requests and the tokens it reports, by what was asked (the first question's key, its kind).
  const jevUse = { requests: 0, input: 0, output: 0, by: {} };
  record.usage = { system2: workMeter?.usage ?? null, digest: digestMeter?.usage ?? null, casts: Object.fromEntries(Object.entries(meters).map(([id, meter]) => [id, meter.usage])), jev: jevUse, workModel: workModel?.modelId ?? null };
  // Each stretch of the gate (M12): what fired there and, once played, what each fired cast found.
  // Only casts that wrote notes count as fired (the acting coach, prop master and first AD are not built: they were
  // counted as fired in up to half the stretches of W10).
  const noted = new Set(Object.values(prefilm?.units ?? {}).flatMap(unit => Object.keys(unit)));
  record.stretches = gate ? gate.windows.map(window => ({ scene: window.scene, first: window.first, last: window.last, type: window.type, fired: prefilm ? window.fired.filter(id => noted.has(id)) : window.fired, found: {} })) : [];
  const asked = withSystem2((state, questions, options) => retried(() => jev.decide(state, questions, options), log), workMeter, { note: entry => { if (asking) (asking.system2 ??= []).push(entry); } });
  // The summarizer (Track A, digest.mjs; the user, 2026-11-03): every scene of the line read by the work model ahead of the
  // play, in reading order, the memory carried from scene to scene; the director waits for a scene's digest when it comes
  // to it. Its moves (graded), facts (stated and implied), items, talk and breaks replace the pass and the text-only
  // questions; Jev still decides on the pictures. Without a work model, the director plays as before.
  const digested = new Map();
  // The pre-film casts as a reading step (world-engine/digest/casts.mjs; the user, 2026-11-04): where the reading has them,
  // the run plays from them and asks the work model nothing for them.
  if (prefilm) {
    for (const [id, unit] of Object.entries(prefilm.units ?? {})) digested.set(id, Promise.resolve(unit.scriptSupervisor ?? null));
    await writeFile(join(runDir, 'digest.json'), JSON.stringify({ version: 1, model: prefilm.model ?? null, from: 'the reading step', scenes: Object.fromEntries(Object.entries(prefilm.units ?? {}).filter(([, unit]) => unit.scriptSupervisor).map(([id, unit]) => [id, unit.scriptSupervisor])) }));
  } else if (digestMeter) {
    // The line from `from` to `to` (scene ids): every container whose scene is in it (by segment, each scene's segments).
    const ids = reading.scenes.map(scene => scene.parent ?? scene.id), lineScenes = reading.scenes.slice(ids.indexOf(from), ids.lastIndexOf(to) + 1);
    const scriptNow = await scriptOf();
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
  // Jev's usage as its provider names it: input_tokens / prompt_tokens / inputTokens / promptTokens (and the output's).
  const tokensOf = (use, side) => Number((side === 'input' ? [use?.input_tokens, use?.prompt_tokens, use?.inputTokens, use?.promptTokens] : [use?.output_tokens, use?.completion_tokens, use?.outputTokens, use?.completionTokens]).find(value => value !== undefined && value !== null) ?? 0);
  const decide = Object.assign(async (state, questions, options) => {
    calls++;
    const kind = String(questions?.[0]?.key ?? 'other').split(/[:|]/)[0], before = jev.usage?.length ?? 0, entry = (jevUse.by[kind] ??= { requests: 0, input: 0, output: 0 });
    try { return await asked(state, questions, options); } finally {
      jevUse.requests++; entry.requests++;
      for (const use of (jev.usage ?? []).slice(before)) { const input = tokensOf(use, 'input'), output = tokensOf(use, 'output'); jevUse.shape ??= Object.keys(use ?? {}).join(','); jevUse.input += input; jevUse.output += output; entry.input += input; entry.output += output; }
    }
  }, { record: () => {} });

  let result = null;
  await strandDemo(novelDir, { from, to, worldOnly: true, plain: true, title: 'Director', played: { cast: Object.fromEntries(seg.script.scenes.map(entry => [entry.id, entry.present])), spawn: seg.spawn, strands: segStrands.strands }, engine: async E => {
    engineCost = E.cost;
    // The road network vehicles drive (world-engine/world/roads.mjs): the landscapes' roads and the kept highways.
    const roadNet = E.roadInputs?.roads?.length ? RD.roadGraph(E.roadInputs) : null;
    const { world, W } = E, server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true });
    let page = null, lotsShown = -1;
    // A stand-in answers by rule and never looks (the test cycle, the user, 2026-11-03): it is shot no pictures, and the
    // page in Chrome is brought up to date only where the play itself reads it (a blast's spots). A box on a top-down map
    // is still read through the map's frame, which needs no picture.
    const looks = jev.modelId !== 'stand-in-director';
    let stale = false;
    // Every scene's line as played so far (its starts and events with their walks), kept in world nodes and made the page's
    // own whenever the page is written: a page loaded later (World · Live's frame, the Player) holds the whole line, every
    // card in it to replay (the user, 2026-11-02: tapping a played sentence replayed nothing once the run was over).
    const played = new Map();
    // The things people carry, put down, throw and break (the digest's items, the user, 2026-11-03: v1's item placing
    // brought back): each one's placements over the line, drawn on the page as v1's things are (a gold shape with its name).
    const things = new Map();
    // A thing's form (the user, 2026-11-05: "objects needs to be assigned with a shape and size"): its sheet's shape and
    // size where the settei cast has it (a "not a thing" not drawn), else a box of the size the notes give.
    const formOf = thing => { const prop = propOf(thing.name); if (prop?.shape === null) return null; if (prop?.size) return { shape: prop.shape, size: prop.size[0], height: prop.size[1], depth: prop.size[2], airborne: prop.airborne ?? 0, kind: prop.kind }; const w = Math.max(0.2, Math.min(6, thing.size)); return { shape: 'box', size: w, height: Math.max(0.2, w * 0.6), depth: w, airborne: 0, kind: null }; };
    const thingsOnPage = () => [...things.values()].filter(thing => thing.placed.length && formOf(thing)).map(thing => { const form = formOf(thing); return { id: thing.id, name: thing.name, aliases: [], model: null, theme: null, switched: false, shape: form.shape, size: form.size, height: form.height, depth: form.depth, kind: form.kind, ...(carModel({ kind: form.kind }, thing.name) ? { vehicleModel: carModel({ kind: form.kind }, thing.name), ...(scadSize(carModel({ kind: form.kind }, thing.name)) ? (([x, y, z]) => ({ size: x, height: y, depth: z }))(scadSize(carModel({ kind: form.kind }, thing.name))) : {}) } : {}), ...(ownerOf(thing.name) && ownerOf(thing.name) !== 'not said' ? { owner: ownerOf(thing.name) } : {}), placed: thing.placed, struct: null }; });
    try {
      // The page as far as the loop has played, loaded again only when the world has grown (or a scene is done).
      const reload = async () => {
        const started = performance.now();
        await writeFile(join(work, 'index.html'), inlineStrand(template, withLine(page), { vendor: true }));
        await chrome.evaluate('delete window.__stage').catch(() => {});
        await chrome.open(server.url);
        stale = false; timing.reloads++; timing.reloadMs += performance.now() - started;
      };
      const show = async (force = false) => {
        if (!force && page && world.lots.length === lotsShown) return page;
        page = E.assemble(E.runs); lotsShown = world.lots.length;
        if (looks) await reload(); else stale = true;
        return page;
      };
      // A scene's piece of the line on the page's grid as it stands now.
      function pieceOf({ scene, run }) {
        const starts = Object.fromEntries(Object.entries(run.starts).map(([who, value]) => [who, dense(value[0])]));
        const events = scene.events.map(event => ({ id: event.id, actors: event.actors ?? [], text: event.text, camera: event.camera ?? null, spots: [], hit: E.hits?.get(event.id) ?? null, blows: E.blows?.get(event.id) ?? [], hitThings: null, trace: null,
          moves: scene.cast.map(person => E.moves.get(`${scene.id}|${event.id}|${person}`)).filter(Boolean).map(move => ({ person: move.person, how: move.how, with: null, path: move.path.map(dense), ensemble: (move.ensemble ?? []).map(other => other.map(dense)), ...(move.mount ? { mount: move.mount } : {}), ...(move.air ? { air: move.air } : {}), ...(move.pace ? { pace: move.pace } : {}), ...(move.at ? { at: move.at } : {}), ...(move.real ? { real: true } : {}) })) }));
        // The hits before this scene that its strand had not seen when it was played (M17c): the page leaves them out of it.
        return { scene: scene.id, starts, events, cast: scene.cast, grid: gridKey(), unseen: E.layers?.unseen(scene.id) ?? [] };
      }
      // Each unnamed place's first unit (the world script's `scene`), for the live view to show it only once that unit has landed.
      const bornOf = new Map();
      // The rooms the architect has typed (digest/rooms.mjs): page lot, room, kind, its furniture; their models on the page.
      E.rooms ??= new Map();
      // Who held, drove or rode what after the card before (the transport specialist's possession, carried through the run).
      let heldBefore = new Map();
      // The vehicle models the page's people (a vehicle slot) and things are drawn as; only those go on the page.
      const vehiclesUsed = data => { const used = new Set([...Object.entries(data.people ?? {}).map(([id, person]) => carModel(slotProp(id), propSheet?.ids?.[id] ?? person.name)), ...thingsOnPage().map(thing => thing.vehicleModel), 'car-sedan'].filter(Boolean)); return Object.fromEntries([...used].filter(name => vehicleModels?.models?.[name]).map(name => [name, vehicleModels.models[name]])); };
      const scadUsed = data => { const used = new Set([...Object.entries(data.people ?? {}).map(([id, person]) => carModel(slotProp(id), propSheet?.ids?.[id] ?? person.name)), ...thingsOnPage().map(thing => thing.vehicleModel), ...[...wrecks.values()].map(wreck => wreck.model)].filter(model => String(model ?? '').startsWith('scad:')).map(model => model.slice(5))); return Object.fromEntries([...used].map(id => [id, scadMeshes.get(id)])); };
      const furnitureUsed = () => Object.fromEntries([...new Set([...E.rooms.values()].flatMap(room => room.furniture.map(piece => `kk-furniture-${piece[0]}`)))].filter(name => furnitureModels?.models?.[name]).map(name => [name, furnitureModels.models[name]]));
      const withLine = data => ({ ...data, ...(skyPage ? { sky: { units: skyPage } } : {}), people: Object.fromEntries(Object.entries(data.people ?? {}).map(([id, person]) => { const prop = slotProp(id); return [id, prop?.shape ? { ...person, prop: { kind: prop.kind, shape: prop.shape, size: scadSize(carModel(prop, propSheet?.ids?.[id] ?? person.name)) ?? prop.size, airborne: prop.airborne ?? 0, ...(prop.vehicle ? { vehicle: true } : {}), ...(carModel(prop, propSheet?.ids?.[id] ?? person.name) ? { model: carModel(prop, propSheet?.ids?.[id] ?? person.name) } : {}), ...(ownerOf(propSheet?.ids?.[id]) && ownerOf(propSheet?.ids?.[id]) !== 'not said' ? { owner: ownerOf(propSheet?.ids?.[id]) } : {}), ...(wrecks.has(id) ? { wreck: { model: wrecks.get(id).model, scene: wrecks.get(id).scene, event: wrecks.get(id).event, at: wrecks.get(id).at } } : {}) } } : person]; })), models: { ...(data.models ?? {}), ...vehiclesUsed(data), ...furnitureUsed() }, ...(scadMeshes.size || data.scadModels ? { scadModels: { ...(data.scadModels ?? {}), ...scadUsed(data) } } : {}), ...(E.rooms?.size ? { rooms: [...E.rooms.values()] } : {}), macro: (data.macro ?? []).map(node => (bornOf.has(node.id) ? { ...node, born: bornOf.get(node.id) } : node)), things: [...(data.things ?? []), ...thingsOnPage()], scenes: data.scenes.map(entry => { const piece = played.has(entry.id) ? pieceOf(played.get(entry.id)) : null; return piece ? { ...entry, starts: piece.starts, events: piece.events, cast: piece.cast, landed: true } : { ...entry, landed: false }; }) });
      const dense = id => { const { i, j, k } = W.cellOf(world, id), g = page.world; return ((k + g.ok) * g.NZ + (j + g.oj)) * g.NX + (i + g.oi); };
      const at = id => { const p = W.nodePos(world, id); return [p.x, p.y, p.z]; };
      const changesFloor = path => { if (!path || path.length < 2 || path.drove || path.air) return false; const y0 = at(path[0])[1]; return path.some(id => Math.abs(at(id)[1] - y0) > 1); };
      const lotOf = (x, z) => world.lotAt.get(W.cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      const lotName = index => { const lot = world.lots[index]; return lot.label ?? `the ${lot.role ?? 'building'} (${lot.height ?? lot.floors} floors)`; };
      // What stands at a point, in words: a building's room, corridor or stairs on a floor, its roof, open ground, the air.
      const said = ([x, y, z]) => {
        // A building of a street laid underground holds its column below the street's own (world.ts lotBelow): its floors
        // count from its own ground floor, on that street's floor.
        const key = W.cellKey(Math.floor(x / CELL), Math.floor(z / CELL)), level = Math.round(y / FLOOR), below = (world.lotBelow?.get(key) ?? []).find(index => level >= (world.lots[index].k0 ?? 0) && level <= (world.lots[index].k0 ?? 0) + world.lots[index].floors);
        const sunk = below !== undefined;
        const index = sunk ? below : lotOf(x, z), k = level - (sunk ? world.lots[below].k0 ?? 0 : 0), down = sunk ? ((world.lots[below].k0 ?? 0) < 0 ? `, ${-(world.lots[below].k0 ?? 0) * FLOOR} m under the street` : `, ${(world.lots[below].k0 ?? 0) * FLOOR} m up`) : '';
        // On a floor of its own: an underground street's, or another layer's (§3.5: a deck in the air, an orbit, the deep).
        const street = !sunk && Math.abs(y) > 1 ? W.hallsAt(world, Math.floor(x / CELL), Math.floor(z / CELL)).map(entry => world.source.underground?.halls?.[entry.hall]).find(hall => hall?.street && Math.abs(-hall.depth - y) < 1.5) : null;
        if (street) return street.layer === 'air' ? `a deck in the air, ${-street.depth} m up` : street.layer === 'space' ? 'a floor in orbit' : street.layer === 'deep' ? 'the deep underground' : `an underground street, ${street.depth} m down`;
        if (index === undefined) return y < -1 ? 'underground' : y < 1.5 ? `open ground (${['', 'the street', 'a plaza', 'the avenue'][world.ground.get(W.cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? 0] || 'outside'})` : `the open air, ${Math.round(y)} m up`;
        const lot = world.lots[index], i = Math.floor(x / CELL) - lot.i0, j = Math.floor(z / CELL) - lot.j0;
        if (k >= lot.floors) return k === lot.floors ? `the roof of ${lotName(index)}${down}` : `the air over ${lotName(index)}`;
        if (k < 0) return `under ${lotName(index)}`;
        const cell = lot.skeleton.cells[S.cellIndex(lot.skeleton, i, j, k)], room = lot.rooms.find(box => box.floor <= k && k <= box.top && i >= box.i0 && i <= box.i1 && j >= box.j0 && j <= box.j1);
        return (cell === S.STAIR ? `the stairs of ${lotName(index)}, floor ${k + 1}` : cell === S.CORRIDOR ? `a corridor of ${lotName(index)}, floor ${k + 1}` : room ? `${room.kind === 'room' ? 'a room' : room.kind === 'hall' ? 'a hall' : 'a hall rising through floors'} of ${lotName(index)}, floor ${room.floor + 1}` : `a wall of ${lotName(index)}, floor ${k + 1}`) + down;
      };
      // The walkable nodes round a point (within `radius` metres), with what each is: the pool spots and boxes are taken from.
      const around = (x, z, wanted) => {
        const radius = Math.min(wanted, AROUND_MOST);
        E.reach(x, z, radius + 16);
        const built = E.graphOf({ x, z }, radius + 24), { graph, type, lot } = built, nodes = [];
        for (let id = 0; id < type.length; id++) if (type[id] && graph.offsets[id + 1] > graph.offsets[id] && Math.abs(graph.x[id] - x) <= radius && Math.abs(graph.z[id] - z) <= radius) nodes.push({ id, x: graph.x[id], y: graph.y[id], z: graph.z[id], type: type[id], lot: lot[id], ground: built.ground?.[id] ?? 0 });
        return { built, nodes };
      };
      // What a walk from a node reaches within `radius` metres (the engine's onFoot, the layers and edges a walk uses): a
      // fact's spot is looked for among these only, never under a stair that lies outside every walk's window.
      const onFoot = (from, radius) => E.onFoot(from, Math.max(40, radius + 16));
      // The spots under the street a walk from a node reaches within UNDER_SEARCH, nearest first, the near-ground layer
      // (to 25 m down, docs/v2/terrain-levels.md §8.1) ahead of the deep one.
      const downFrom = node => {
        const p = at(node), reach = onFoot(node, UNDER_SEARCH), under = around(p[0], p[2], UNDER_SEARCH).nodes.filter(entry => entry.type === FA.TYPE.underground && reach.has(entry.id));
        const d = entry => Math.hypot(entry.x - p[0], entry.y - p[1], entry.z - p[2]);
        return under.sort((a, b) => (a.y < -25) - (b.y < -25) || d(a) - d(b));
      };
      // A move's walk: one draw of the path integral, and six more from the same field (the traces the player draws round it,
      // the spread of where the walk might have gone).
      // Through the air (docs/v2/terrain-levels.md §6.2; world/air.mjs): a flight, a leap or a climb up a wall from one node to
      // another as cells of the world, over the buildings round the way (their plans, their roofs at their full height);
      // the path says it goes through the air (`air`, its kind as `how`), with no ensemble.
      // Every building round the way, at its own level (a street laid underground's, a deep area's, a deck's: its roof at its
      // k0 plus its floors); each end in the one that holds its cell at its level. Under a ceiling (terrain-levels §8.3: the
      // ground skin over a hall, the deep layer's hard ceiling), the path goes no higher than a body below it (`capped`).
      const airRoute = (from, to, kind) => {
        const a = at(from), b = at(to), pad = 60, x0 = Math.min(a[0], b[0]) - pad, x1 = Math.max(a[0], b[0]) + pad, z0 = Math.min(a[2], b[2]) - pad, z1 = Math.max(a[2], b[2]) + pad, lots = [], index = new Map();
        world.lots.forEach((lot, n) => { const k0 = lot.k0 ?? 0, box = { x0: lot.i0 * CELL, z0: lot.j0 * CELL, x1: (lot.i0 + lot.nx) * CELL, z1: (lot.j0 + lot.nz) * CELL, top: (k0 + (lot.height ?? lot.floors ?? 1)) * FLOOR }; if (box.x1 < x0 || box.x0 > x1 || box.z1 < z0 || box.z0 > z1) return; index.set(n, lots.push(box) - 1); });
        const standsIn = id => {
          const p = W.nodePos(world, id), key = W.cellKey(p.i, p.j);
          const below = (world.lotBelow.get(key) ?? []).find(n => p.k >= (world.lots[n].k0 ?? 0) && p.k <= (world.lots[n].k0 ?? 0) + world.lots[n].floors);
          const n = below ?? (p.k >= 0 ? world.lotAt.get(key) : undefined);
          return n === undefined ? -1 : index.get(n) ?? -1;
        };
        const roofOf = id => { const p = W.nodePos(world, id), ceiling = W.ceilingAt(world, p.i, p.j, p.k); return ceiling.kind === 'skin' || ceiling.kind === 'hard' ? ceiling : null; };
        const over = [roofOf(from), roofOf(to)].filter(Boolean), ceiling = over.length ? Math.min(...over.map(entry => entry.at)) : Infinity;
        const points = AIR.airPath(a, b, { lots, from: standsIn(from), to: standsIn(to), kind, ceiling }), path = [];
        for (const [x, y, z] of points) { const id = W.nodeId(world, Math.floor(x / CELL), Math.floor(z / CELL), Math.round(y / FLOOR)); if (path.at(-1) !== id) path.push(id); }
        path[0] = from; if (path.at(-1) !== to) path.push(to);
        return Object.assign(path, { how: kind, air: true, ensemble: [] }, points.capped ? { capped: over.some(entry => entry.kind === 'hard') ? 'the hard ceiling' : 'the ground over it' } : {});
      };
      // The hook of the underground (docs/underground-design.md §4.8): an area's halls come alive the first moment anyone
      // stands under it, and until then no blast reaches them. The director's moves never told the exporter (no blast of a
      // director run reached a hall: no cave-in, no hole); before each blast now, every node below the street that anyone
      // stands on or has walked through wakes its hall or basement (the exporter's own `wake`), once each.
      const woken = new Set();
      const wakeBelow = (positions = {}) => {
        if (!E.wake) return;
        for (const node of [...Object.values(positions).map(entry => entry?.[0]), ...[...(E.moves?.values() ?? [])].flatMap(move => move.path ?? [])]) {
          if (node == null) continue;
          const p = W.nodePos(world, node);
          if (p.k >= 0) continue;
          const hall = W.hallsAt(world, p.i, p.j).find(entry => entry.k <= p.k), key = hall ? `hall:${hall.hall}` : `lot:${world.lotAt.get(W.cellKey(p.i, p.j)) ?? 'none'}`;
          if (woken.has(key)) continue;
          woken.add(key); E.wake(node);
        }
      };
      // The room of a building a node stands in (its lot on the page, the room's index, its floor and its plan's size in metres),
      // or null: a node on a building's floor inside one of its rooms (a street laid underground's and a deck's buildings too).
      const roomAt = node => {
        const p = W.nodePos(world, node), key = W.cellKey(p.i, p.j);
        const n = (world.lotBelow.get(key) ?? []).find(index => p.k >= (world.lots[index].k0 ?? 0) && p.k < (world.lots[index].k0 ?? 0) + world.lots[index].floors) ?? (p.k >= 0 ? world.lotAt.get(key) : undefined);
        if (n === undefined) return null;
        const lot = world.lots[n], local = W.localCell(lot, p.i, p.j), k = p.k - (lot.k0 ?? 0);
        if (!local || k < 0 || k >= lot.floors) return null;
        const r = (lot.rooms ?? []).findIndex(room => k >= room.floor && k <= (room.top ?? room.floor) && local[0] >= room.i0 && local[0] <= room.i1 && local[1] >= room.j0 && local[1] <= room.j1);
        if (r < 0) return null;
        const room = lot.rooms[r];
        return { lot: n, room: r, floor: room.floor, w: (room.i1 - room.i0 + 1) * CELL, d: (room.j1 - room.j0 + 1) * CELL, building: lot.label ?? null, role: lot.role ?? null, floors: lot.floors };
      };
      // The holes blows broke in the ground skin (terrain-levels §8.4) a flight from below can rise through: each the floor's
      // node under it, nearest first, within `radius` metres of a point.
      const holesNear = (p, radius) => {
        const out = [];
        for (const [key, hall] of world.underDamage.breaches) {
          const { ci: i, cj: j } = W.chunkOf(key), floor = W.hallsAt(world, i, j).find(entry => entry.hall === hall);
          if (!floor) continue;
          const x = (i + 0.5) * CELL, z = (j + 0.5) * CELL, d = Math.hypot(x - p[0], z - p[2]);
          if (d <= radius) out.push({ id: W.nodeId(world, i, j, floor.k), d });
        }
        return out.sort((m, n) => m.d - n.d).map(entry => entry.id);
      };
      // A drive (a road vehicle's ride, mounts.mjs `ride:<x>:road`): the quickest way by road (world-engine/world/roads.mjs)
      // from the kerb nearest where it starts to the kerb nearest the target, keeping left, up a ramp onto the expressway
      // where that is quicker; as the walk grid's nodes along the lane (a deck's at its level, a tunnel's under the street),
      // each with the second it is reached (`at`), so the car keeps its own speed on the page.
      const driveRoute = (from, targets) => {
        if (!roadNet || !targets.length) return null;
        const a = at(from[0]), target = targets.slice(0, 8).map(id => ({ id, p: at(id) })).sort((m, n) => Math.hypot(m.p[0] - a[0], m.p[2] - a[2]) - Math.hypot(n.p[0] - a[0], n.p[2] - a[2]))[0];
        if (Math.hypot(target.p[0] - a[0], target.p[2] - a[2]) < 60) return null;
        const route = RD.drive(roadNet, [a[0], a[2]], [target.p[0], target.p[2]]);
        if (!route) return null;
        const k0 = W.nodePos(world, from[0]).k, path = [], times = [];
        for (const [x, y, z, t] of route.pts) { const id = W.nodeId(world, Math.floor(x / CELL), Math.floor(z / CELL), k0 + Math.round(y / FLOOR)); if (path.at(-1) === id) { times[times.length - 1] = t; continue; } path.push(id); times.push(Math.round(t * 100) / 100); }
        path[0] = from[0]; times[0] = 0;
        if (path.at(-1) !== target.id) { path.push(target.id); times.push(times.at(-1) + 1); }
        // Its life seconds at each node as `times` (never `at`: that would hide the array's own at(); W15 died on it, scene 153).
        return Object.assign(path, { how: 'ride', ensemble: [], times, drove: { metres: route.metres, highway: route.highway, seconds: route.seconds } });
      };
      // A move's path grown by a piece (several moves of one person in one card are one walk on the page), the steps that go
      // through the air kept as ranges [first, last, kind] (`at`: where in the piece they start): the page plays them
      // straight, at that kind's pace.
      const grown = (earlier, piece, kind = null, from = 0) => {
        const base = earlier ? earlier.path.length - 1 : 0, air = [...(earlier?.air ?? []), ...(kind ? [[base + from, base + piece.length - 1, kind]] : [])];
        return { path: earlier ? [...earlier.path, ...piece.slice(1)] : [...piece], ...(air.length ? { air } : {}) };
      };
      // A walk that fails says so with a code (W0: NO_TARGET, OFF_WALK, NO_PATH) and the least that replays it: the seed's
      // key, where they stood, the first targets and how they went (with the scene's place, enough to solve it again).
      const walk = (scene, key, from, targets, how) => {
        // The engine numbers nodes as first asked for, so the ids hold only within this run: the replay also keeps where
        // they stood and the first target in metres (why-walk.mjs and the L18 blast smoother read those after the run).
        const metres = id => { const p = W.nodePos(world, id); return { x: p.x, y: p.y, z: p.z }; };
        walk.failed = null; walk.code = null; walk.widened = null; walk.freed = null; walk.portal = null; walk.replay = { key, from: from[0], targets: targets.slice(0, 8), how, at: { from: metres(from[0]), ...(targets.length ? { to: metres(targets[0]) } : {}) } };
        if (!targets.length) { walk.failed = 'no place to stand there'; walk.code = 'NO_TARGET'; return null; }
        // Appearing (within its reach) and flying go straight to the nearest target, through no walk; a target beyond an
        // appearing's reach is run to.
        if (String(how).startsWith('teleport') || how === 'flight') {
          const here = metres(from[0]), reach = how === 'flight' ? Infinity : Number(String(how).split(':')[1]) || 30;
          const target = targets.map(id => ({ id, d: Math.hypot(metres(id).x - here.x, metres(id).z - here.z) })).sort((a, b) => a.d - b.d)[0];
          // A flight is through the air (world/air.mjs); one to or from below the street goes by the walk and its lifts
          // (W12's flight to a lab 90 m down went straight through the ground), or up through a hole a blow broke in the
          // ground skin over them (terrain-levels §8.4: up only for those who leap or fly): run to the floor under it, fly out.
          const underneath = how === 'flight' && target && (here.y < -1 || metres(target.id).y < -1);
          if (target && target.d <= reach && !underneath) { if (how === 'flight') return airRoute(from[0], target.id, 'flight'); const path = [from[0], target.id]; path.ensemble = []; path.how = 'teleport'; return path; }
          if (underneath && here.y < -1 && metres(target.id).y >= -1) {
            const hole = holesNear([here.x, here.y, here.z], 60).find(id => W.nodePos(world, id).k === W.nodePos(world, from[0]).k);
            const run = hole === undefined ? null : hole === from[0] ? [from[0]] : walkIn(scene, `${key}|to the hole`, from, [hole], 'run', E.deepAt(from[0]) ? 'deep' : 'near');
            if (run?.length) { const air = airRoute(hole, target.id, 'flight'); return Object.assign([...run, ...air.slice(1)], { how: 'flight', air: true, airFrom: run.length - 1, ensemble: [], through: 'a hole in the ground over them' }); }
          }
          how = 'run';
        }
        // A road vehicle drives the road graph where one joins the two ends (else the level ground, as before).
        if (/^ride:[^:]+:road$/.test(String(how))) { const driven = driveRoute(from, targets); if (driven) return driven; }
        // The layers (docs/v2/terrain-levels.md §8.2): a walk with a target in its own layer is walked in that layer; one
        // whose targets all lie in the other goes by a portal (a lift, a shaft, a ladder, the virtual elevator).
        const layerOf = id => (E.deepAt(id) ? 'deep' : 'near'), mine = layerOf(from[0]), same = targets.filter(id => layerOf(id) === mine);
        const path = same.length ? walkIn(scene, key, from, same, how, mine) : across(scene, key, from, targets, how, mine);
        // A ride has no way off the level ground (stairs, walls): from there it goes on foot.
        if (!path && String(how).startsWith('ride:')) return walk(scene, `${key}|on foot`, from, targets, 'run');
        return path;
      };
      // One layer's walk: one draw of the path integral and six more from the same field.
      const walkIn = (scene, key, from, targets, how, layer) => {
        let field;
        try { field = E.solve(scene.placeId, key, targets, how, from[0], 40, layer); } catch (error) {
          // A walk between two cities kilometres apart (volume 2, W16: unit 144) would lay a street grid too large for the
          // engine (more edges than a Map holds). Off the grid it is a journey the story cuts: they arrive where the text
          // puts them, as a jump or a flight does (`teleport`), counted on the walk.
          if (!(error instanceof RangeError)) throw error;
          const f0 = W.nodePos(world, from[0]), far = id => { const t = W.nodePos(world, id); return Math.hypot(t.x - f0.x, t.z - f0.z); };
          const target = [...targets].sort((a, b) => far(a) - far(b))[0], path = [from[0], target];
          path.ensemble = []; path.how = 'teleport'; path.cut = 'too far for the street grid'; walk.cut = (walk.cut ?? 0) + 1;
          if (asking) asking.cut = (asking.cut ?? 0) + 1;
          return path;
        }
        const built = E.graphOf(W.nodePos(world, from[0]));
        let path = E.sampleWalk(built.graph, field, from[0], from[1], seeded(key));
        // The way may leave the 40 m round the walk (a basement's stair at the far end of its building, a mall's entrance):
        // where a walk from here reaches the target within a wider square, the walk is solved again with that much room.
        if (!path && field.part && field.part.local[from[0]] >= 0) {
          // The wider square is as wide as the walk: between two cities it is too large for the street grid (W16's unit
          // 201), and then the walk is not widened (it goes on as one with no way found).
          try {
            const f0 = W.nodePos(world, from[0]), wide = Math.round(Math.min(...targets.slice(0, 8).map(id => { const t = W.nodePos(world, id); return Math.hypot(t.x - f0.x, t.z - f0.z); })) + UNDER_SEARCH + 16), reach = E.onFoot(from[0], wide, how);
            if (targets.some(id => reach.has(id))) { field = E.solve(scene.placeId, key, targets, how, from[0], wide, layer); path = E.sampleWalk(built.graph, field, from[0], from[1], seeded(key)); if (path) { walk.widened = wide; if (asking) asking.widened = (asking.widened ?? 0) + 1; } }
          } catch (error) { if (!(error instanceof RangeError)) throw error; walk.notWidened = (walk.notWidened ?? 0) + 1; }
        }
        // Standing in a sliver of ground the buildings wall in (a cell or two between two footprints, W12's unit 169): no
        // way of going leaves it, so they step out to the nearest ground a walk leaves from, within 8 m, and go from there.
        if (!path && field.part && field.part.local[from[0]] >= 0 && !walk.freed) {
          const pocket = E.onFoot(from[0], 40, how);
          if (pocket.size < 16 && !targets.some(id => pocket.has(id))) {
            const p = at(from[0]), out = around(p[0], p[2], 8).nodes.filter(node => Math.abs(node.y - p[1]) < 1 && !pocket.has(node.id)).sort((a, b) => Math.hypot(a.x - p[0], a.z - p[2]) - Math.hypot(b.x - p[0], b.z - p[2]));
            for (const node of out.slice(0, 12)) {
              if (E.onFoot(node.id, 40, how).size < 200) continue;
              walk.freed = Math.round(Math.hypot(node.x - p[0], node.z - p[2]) * 10) / 10;
              if (asking) asking.freed = (asking.freed ?? 0) + 1;
              const rest = walkIn(scene, `${key}|freed`, [node.id, from[1]], targets, how, layer);
              if (rest) { const whole = [from[0], ...rest]; whole.ensemble = []; return whole; }
              break;
            }
          }
        }
        if (path) path.ensemble = Array.from({ length: 6 }, (_, n) => E.sampleWalk(built.graph, field, from[0], from[1], seeded(`${key}|${n}`))).filter(Boolean);
        // Why no walk was found (the user's Why panel: people chose a place and never went): where they stand is not on the
        // walk round them and their target, or the walk has no way from there to it, by what means and in which layer.
        else if (!walk.failed) { const off = field.part && field.part.local[from[0]] < 0; walk.failed = off ? 'where they stand is off the walk' : `no way there ${LY.meansOf(how)} (${LY.LAYER_WORDS[layer] ?? 'on this level'})`; walk.code = off ? 'OFF_WALK' : 'NO_PATH'; }
        return path;
      };
      // A walk between the layers (§8.2; world/layers.mjs): to a portal in this layer, the ride, and on from its other end.
      const across = (scene, key, from, targets, how, mine) => {
        const leg = (start, aims, layer) => { walk.failed = null; walk.code = null; return walkIn(scene, `${key}|${layer}|${start}`, [start, from[1]], aims, how, layer); };
        const { path, portal, why } = LY.acrossLayers({ from: from[0], targets, mine, portals: E.portalsNear(from[0], targets[0], UNDER_SEARCH), walkIn: leg, at, how, search: UNDER_SEARCH });
        if (!path) { walk.failed = why; walk.code = 'NO_PATH'; return null; }
        path.ensemble = [];
        walk.portal = portal;
        if (asking) (asking.portals ??= []).push(portal);
        return path;
      };
      const shoot = async (name, size, options) => {
        // Not shot for a stand-in; a top-down map's frame as the page gives it (strand-demo.html capture, `topdown`).
        if (!looks) { timing.skipped++; const top = options.topdown; return { view: top ? { id: name, width: size[0], height: size[1], map: { x: top.x, z: top.z, halfX: top.half * size[0] / size[1], halfZ: top.half, turn: top.turn ?? 0 } } : null, png: null }; }
        const started = performance.now();
        await chrome.size(...size);
        const view = await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: name, frame: size, people: true, mask: true, ...options })})`);
        const png = await chrome.still('png');
        await writeFile(join(shots, `${name}.png`), Buffer.from(png, 'base64'));
        timing.shots++; timing.shotMs += performance.now() - started;
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
      const spawn = await spawnOf();
      const script = await scriptOf();
      // Places in story time (the user, 2026-11-04: "why there's no positive time direction order of buildings"): an
      // unnamed place comes into the story at its first container in story order (the strands' layers, then reading order),
      // with every place it stands in. Before that it does not exist for anyone: a journey of an earlier container is never
      // offered it (the pilot: a stair down in scene 3, where the scene's own place is the
      // whole city, was matched to the underpass of scene 21, which spawning had put 1.5 km away).
      const storyRank = (() => {
        const layers = new Map((strandsNow?.scenes ?? []).map(entry => [entry.id, entry.layer ?? 0])), index = new Map(script.scenes.map((entry, n) => [entry.id, n]));
        return new Map([...script.scenes].sort((a, b) => (layers.get(a.id) ?? 0) - (layers.get(b.id) ?? 0) || index.get(a.id) - index.get(b.id)).map((entry, n) => [entry.id, n]));
      })();
      const bornAt = new Map(), born = (place, rank) => { for (let id = place, guard = 0; id && guard < 12; id = script.places?.[id]?.parent ?? null, guard++) if (!(bornAt.get(id) <= rank)) bornAt.set(id, rank); };
      for (const entry of script.scenes) if (entry.place) born(entry.place, storyRank.get(entry.id));
      for (const [id, place] of Object.entries(script.places ?? {})) if (place?.unnamed && place.scene) bornOf.set(id, place.scene);
      // A place first told inside a unit (the world script's `scene`: the alley of unit 8 in a unit placed at its district)
      // has happened there too.
      for (const [id, place] of Object.entries(script.places ?? {})) if (place?.scene && storyRank.has(place.scene)) born(id, storyRank.get(place.scene));
      // The user, 2026-11-04: "the list should be composed of places that have happened plus a list of nominated places the
      // city itself carries across volumes." A named place is the city's (the book's terrain sites, and the universe's
      // registry where there is one), there whenever the story is; an unnamed one is known only from where it happened.
      const sitesOf = async path => JSON.parse(await readFile(path, 'utf8').catch(() => 'null'))?.sites ?? {};
      const citySites = { ...(await sitesOf(join(novelDir, '..', '..', 'universe', 'terrain.json'))), ...(await sitesOf(join(novelDir, 'stage', 'terrain.json'))) };
      const nominated = id => !!id && !String(id).startsWith('unnamed:') && !String(id).startsWith('slot:') && !script.places?.[id]?.unnamed;
      const existsBy = (place, container) => nominated(place) || (bornAt.get(place) ?? Infinity) <= (storyRank.get(container) ?? -1);
      let before = null;
      const where = new Map(), lastSceneOf = new Map();
      const timeOf = id => (id ? reading.time?.scenes?.find(entry => entry.scene === id)?.node ?? null : null);
      // Continuity per strand (L1, docs/v2/physics-laws.md; the user, 2026-11-02: it holds to a strand's end and never across
      // strands): someone comes into a scene from the scene the strands say they come from (stage/world/strands.json
      // `entries`), else from where they last stood in that strand; someone first in this strand is never carried in from
      // another one. Without strands, the one state of before.
      const strands = await strandsOf();
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
      // Where each person goes next in story time: `${container}|${person}` → the container their next entry is in.
      const nextOf = new Map((strands?.scenes ?? []).flatMap(entry => (entry.entries ?? []).filter(item => item.from).map(item => [`${item.from}|${item.person}`, { id: entry.id, samePlace: item.samePlace }])));
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
      const grow = async (scene, run, reads = false) => {
        await show();
        played.set(scene.id, { scene, run });
        lastPiece = pieceOf({ scene, run });
        if (!looks && !reads) return null;
        if (stale) await reload();
        return chrome.evaluate(`window.__stage.extend(${JSON.stringify(lastPiece)})`);
      };
      for (const scene of E.chosen) {
        const run = E.runs[scene.id], reads = reading.scenes.find(entry => entry.id === scene.id), sceneRecord = { scene: scene.id, cards: [] };
        record.scenes.push(sceneRecord);
        asking = sceneRecord;
        if (!run || !reads) continue;
        // The scene is played in its strand's layer of the world (strand-layers.mjs; docs/v2/strands.md §4; milestones M17c):
        // what another strand broke, stood or caved in is not in it until the two unite; a split begins as a copy.
        { const entered = E.enter?.(scene.id);
          if (entered) {
            sceneRecord.layer = { strand: entered.layer, ...(entered.created ? { began: true } : {}), ...(entered.merged.length ? { united: entered.merged.map(entry => entry.strand) } : {}), ...(entered.switched || entered.merged.length ? { lots: entered.lots.length, things: entered.things.length, under: entered.cells.length + entered.marks.length } : {}), ...(entered.unseen.length ? { unseen: entered.unseen } : {}) };
            if (entered.switched || entered.merged.length) log(`${scene.id}: in strand ${entered.layer}${entered.created ? ' (begun)' : ''}${entered.merged.length ? `, united with ${entered.merged.map(entry => entry.strand).join(' ')}` : ''}: ${entered.lots.length} lots, ${entered.things.length} things, ${entered.cells.length + entered.marks.length} underground cells differ; ${entered.unseen.length} hits unseen`);
          } }
        // The world state (docs/v2/world-engine-redesign.md §1): who stands where carries through the story. Someone seen before
        // carries on from where they are; seen for the first time, they start at spawning's start (spawning happens once);
        // standing outside the scene's place, they travel to their start in it (walked; beyond 300 m they arrive off-page).
        const own = script.scenes.find(entry => entry.id === scene.id), spawned = spawn?.scenes?.find(entry => entry.id === scene.id);
        const dg = digested.has(scene.id) ? await digested.get(scene.id) : null, prepared = prefilm?.units?.[scene.id] ?? null;
        // Who rides what in this unit (mounts.mjs tiesOf): each tie holds from the line that first says it to the unit's end.
        const ties = MT.tiesOf(prepared);
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
          return Math.abs(u) <= w / 2 + 5 * BODY && Math.abs(v) <= d / 2 + 5 * BODY;
        };
        // A scene's people start together (the user, 2026-11-02: two people of one conversation spawned a kilometre apart, and
        // a scene going on from the last played far from it): the anchor is where those already here stand (the one nearest
        // their middle); with none here, spawning's start of the first present (one placed by the text's own words first).
        // Someone new starts a few metres from the anchor; someone from elsewhere walks to it (off-page beyond 300 m).
        // Presence as the script has it, with the review's pins over it (someone answered present or not, W5).
        const pinnedIn = [...Object.entries(pins.present).filter(([key, value]) => value && key.startsWith(`${scene.id}|`)).map(([key]) => key.slice(scene.id.length + 1)), ...[...surelyThere].filter(key => key.startsWith(`${scene.id}|`)).map(key => key.slice(scene.id.length + 1))];
        let present = [...new Set([...(own?.present ?? Object.keys(run.starts).filter(id => run.starts[id])), ...pinnedIn])].filter(who => pins.present[`${scene.id}|${who}`] !== false);
        // The stage manager (M4): a scene the script has nobody in (volume 1: 15, 20, 41, 43) takes its cast from the scene
        // digest, everyone it has on stage and not gone.
        if (!present.length && dg?.digest.people?.length) { present = dg.digest.people.filter(entry => entry.doing !== 'gone').map(entry => entry.who).filter(who => pins.present[`${scene.id}|${who}`] !== false); sceneRecord.castFrom = 'digest'; }
        // (A unit with nobody in it stands alone: its presence is physics, segmentPresence; it borrows no cast from the one before.)
        if (pinnedIn.length || present.length < (own?.present?.length ?? present.length)) sceneRecord.pinned = { present: pinnedIn, absent: (own?.present ?? []).filter(who => !present.includes(who)) };
        for (const who of present) if (E.names && !E.names[who]) E.names[who] = names.get(who) ?? who;
        // A referent measured in the world (referential distance, L16; the user, 2026-11-03): a person's height, the room or
        // the building round a point, the street's width there, the block (the scene's place where it is one, else the reach
        // of the buildings round), a landmark's distance, the district's or the city's extent; times how many of it.
        const placeBox = new Map((spawn?.scenes ?? []).filter(entry => entry.target?.box).map(entry => [entry.place, entry.target.box]));
        // Where a place stands: where the spawn plan set it (the line plays there), else, for a named place the volume has not
        // set yet, its site in the city's terrain ([x0, z0, x1, z1] to the plan's [centre x, centre z, width, depth]).
        const boxOf = id => placeBox.get(id) ?? (nominated(id) && Array.isArray(citySites[id]?.box) && citySites[id].box.length >= 4 ? (([x0, z0, x1, z1]) => [(x0 + x1) / 2, (z0 + z1) / 2, Math.abs(x1 - x0), Math.abs(z1 - z0)])(citySites[id].box) : null);
        const placeIds = [...new Set([...placeBox.keys(), ...Object.keys(citySites).filter(nominated)])];
        const lotCentreAt = index => { const lot = world.lots[index]; return [(lot.i0 + lot.nx / 2) * CELL, (lot.floors ?? 1) * FLOOR, (lot.j0 + lot.nz / 2) * CELL]; };
        const nearestLots = (p, count) => world.lots.map((_, index) => ({ index, d: Math.hypot(lotCentreAt(index)[0] - p[0], lotCentreAt(index)[2] - p[2]) })).sort((a, b) => a.d - b.d).slice(0, count);
        const measure = (ref, p) => {
          if (!ref || !p) return null;
          const index = lotOf(p[0], p[2]), lot = index !== undefined ? world.lots[index] : world.lots[nearestLots(p, 1)[0]?.index], times = ref.times ?? 1;
          const across = entry => Math.max(entry.nx, entry.nz) * CELL;
          let metres = null;
          if (ref.referent === 'a person') metres = BODY;
          else if (ref.referent === 'the room') { const k = Math.round(p[1] / FLOOR), i = Math.floor(p[0] / CELL) - (lot?.i0 ?? 0), j = Math.floor(p[2] / CELL) - (lot?.j0 ?? 0), room = lot?.rooms?.find(box => box.floor <= k && k <= (box.top ?? box.floor) && i >= box.i0 && i <= box.i1 && j >= box.j0 && j <= box.j1) ?? lot?.rooms?.[0]; metres = room ? (Math.max(room.i1 - room.i0, room.j1 - room.j0) + 1) * CELL : lot ? across(lot) / 3 : null; }
          else if (ref.referent === 'the building') metres = lot ? across(lot) : null;
          else if (ref.referent === 'the street') { const steps = [[1, 0], [1, 1], [0, 1], [-1, 1]].map(([dx, dz]) => { const run = sign => { for (let n = 1; n < 400; n++) if (lotOf(p[0] + sign * dx * n * CELL, p[2] + sign * dz * n * CELL) !== undefined) return n * CELL * Math.hypot(dx, dz); return null; }; const a = run(1), b = run(-1); return a !== null && b !== null ? a + b : null; }).filter(value => value !== null); metres = steps.length ? Math.min(...steps) : null; }
          else if (ref.referent === 'the block') { const box = placeBox.get(scene.placeId); metres = box && ['street', 'block'].includes(script.places?.[scene.placeId]?.scale) ? Math.max(box[2], box[3]) : 2 * (nearestLots(p, 8).at(-1)?.d ?? 0) || null; }
          else if (ref.referent === 'a landmark') { const named = ref.of ? world.lots.findIndex(entry => entry.label && (ref.of.includes(entry.label) || entry.label.includes(ref.of))) : -1; metres = named >= 0 ? 2 * Math.hypot(lotCentreAt(named)[0] - p[0], lotCentreAt(named)[2] - p[2]) : null; }
          else if (ref.referent === 'the district') { const box = placeBox.get(scene.placeId) ?? spawned?.target?.box; metres = box ? Math.max(box[2], box[3]) : null; }
          else if (ref.referent === 'the city') { const bounds = W.worldBounds(world); metres = Math.max(bounds.i1 - bounds.i0, bounds.j1 - bounds.j0) * CELL; }
          // A referent the world cannot measure there (no building round, no landmark by that name) falls to the next wider one.
          if (metres === null) { const wider = DG.REFERENTS[DG.REFERENTS.indexOf(ref.referent) + 1]; return wider ? measure({ ...ref, referent: wider, times: 1 }, p) : null; }
          return metres * times;
        };
        // Scale and view (M5, referential since): each beat of the scene given its frame, reach, angle and duration by the
        // work model; only the action directors' questions and their camera operator read them.
        const sceneBeats = gate && (digestMeter || prefilm) ? gate.beats.map((beat, n) => ({ ...beat, n })).filter(beat => beat.scene === scene.id) : [];
        const order_ = reads.sentences, scaleOf = new Map();
        if (sceneBeats.length) {
          const span = beat => { const a = order_.indexOf(beat.first), b = order_.indexOf(beat.last); return order_.slice(Math.max(0, a), (b < 0 ? order_.length : b + 1)).slice(0, 40); };
          const scales = prefilm ? (prepared?.cinematographer ?? []).map(entry => ({ ...entry, n: sceneBeats.find(beat => beat.first === entry.first)?.n ?? entry.n })) : await DG.scaleBeats(meters.cinematographer, { scene, beats: sceneBeats.map(beat => ({ ...beat, sentences: span(beat) })), line: id => text.get(id)?.text ?? '', kind: id => reading.kinds?.[id]?.kind ?? null, people: present.map(id => ({ id, name: names.get(id) ?? id })), digest: dg?.digest ?? null });
          for (const entry of scales) scaleOf.set(entry.n, entry);
          sceneRecord.scales = scales;
        }
        const firstScale = sceneBeats.length ? scaleOf.get(sceneBeats[0].n) ?? null : null;
        const was = new Map(present.map(who => [who, prior(who, scene.id) ?? null]));
        sceneRecord.laws = present.filter(who => where.get(who) && !was.get(who)).map(who => ({ law: 'L1', who, verdict: 'amend', why: 'first in this strand: not carried in from another strand' }));
        // Presence in the frame (L16; M4, then the user, 2026-11-03: no hard-coded distance): someone carried in stands in the
        // scene only within its frame, the referent its first beat takes in, measured round the cast's middle (volume 1,
        // scene 40: someone carried in from scene 1's roof, 460 m away, is not in it). Outside it, they come from elsewhere.
        // Except whom the strand carries straight on (L1 first; the user, 2026-11-03: the time-space physics is per strand, and
        // where the strand's ground truth and a law disagree, smoothing settles it): someone the strands have in the same
        // place, from the scene this one continues, stays where they stood. The frame is the reader's answer, an observation:
        // how far outside it they stand is recorded with the frame, and the smoother (S_frame) pulls their track toward it by
        // least change, so the next pass starts them where the least-action history has them.
        const strandHere = strandScene.get(scene.id), straightOn = who => { const entry = strandHere?.entries?.find(item => item.person === who); return !!(entry?.samePlace && entry.from && entry.from === strandHere.continues); };
        // Someone the strand carries straight on stays wherever they stand, ahead of the scene's spawn box (the user,
        // 2026-11-03: 21 of 43 arrivals off-page were people who had drifted out of the box during the scene, then put
        // back beside the group: nobody moves suddenly segment after segment).
        const carriedIn = present.filter(who => was.get(who) && (straightOn(who) || inside(was.get(who)[0])));
        // Where each carried-in person starts for the frame: the smoothed start where the smoothing moved them, else where they
        // stood (the user, 2026-11-03: a frame measured round where they stood before the revision was stale by hundreds of m).
        const startOf = who => { const revised = smoothedStart(scene, who); return revised !== null && revised !== undefined ? revised : was.get(who)[0]; };
        // Whether someone who walked in last pass is in the frame: by where they stand now. They come in again (startFor,
        // below), so the smoothing's start for them, somewhere on last pass's way in, is no place they stand; it still says
        // where the scene is (the third pass, scene 66: Yomikawa counted as already in the frame by that start, then carried
        // from where she stood, 480 m off; measured round where people stood now, the rehearsal's scene 26 framed Misaka's
        // floor 40 storeys up, not the street, and Kamijou never reached her).
        const arrivedThen = who => (smoothed?.people?.[who] ?? []).some(moment => moment.scene === scene.id && String(moment.card ?? '').startsWith('arrive:'));
        const standsAt = who => arrivedThen(who) ? was.get(who)[0] : startOf(who);
        const middle = carriedIn.length ? [0, 1, 2].map(axis => { const values = carriedIn.map(who => at(startOf(who))[axis]).sort((a, b) => a - b); return values[Math.floor(values.length / 2)]; }) : null;
        const frameMetres = middle && firstScale ? measure(firstScale.frame, middle) : null;
        if (frameMetres) sceneRecord.frame = { ...firstScale.frame, metres: Math.round(frameMetres), middle: { x: Math.round(middle[0]), y: Math.round(middle[1]), z: Math.round(middle[2]) } };
        const gap = who => { const p = at(standsAt(who)); return Math.hypot(p[0] - middle[0], p[2] - middle[2]); };
        const here = carriedIn.filter(who => !frameMetres || straightOn(who) || gap(who) <= frameMetres / 2);
        if (frameMetres) { const outside = here.filter(who => gap(who) > frameMetres / 2).map(who => ({ who, metres: Math.round(gap(who) - frameMetres / 2) })); if (outside.length) sceneRecord.frame.outside = outside; }
        if (here.length < carriedIn.length) sceneRecord.gathered = carriedIn.filter(who => !here.includes(who));
        let anchor = null;
        if (here.length) {
          const points = here.map(who => at(was.get(who)[0])), mid = [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length);
          anchor = was.get(here.reduce((best, who) => { const p = at(was.get(who)[0]), q = at(was.get(best)[0]); return Math.hypot(p[0] - mid[0], p[2] - mid[2]) < Math.hypot(q[0] - mid[0], q[2] - mid[2]) ? who : best; }, here[0]))[0];
        } else {
          const by = who => spawned?.starts.find(entry => entry.who === who)?.by;
          const first = present.find(who => ['spatial', 'part'].includes(by(who))) ?? present[0];
          anchor = first ? startNode(first) : null;
          // No one with a start here (a segment whose people the spawn plan did not place): the scene's own place, the
          // middle of its spawn box, on the open ground there.
          if ((anchor === null || anchor === undefined) && present.length && spawned?.target?.box) { const [x, z] = spawned.target.box; E.reach(x, z, 24); anchor = W.nodeNear(world, E.graphOf({ x, z }), x, z, 0) ?? null; }
        }
        // A unit underground (docs/v2/terrain-levels.md §8.5: until each place carries the set dresser's note, the unit's own
        // setting): its people start under the street. The anchor goes to the nearest spot below the street that a walk from
        // it reaches, in the near-ground layer first (§8.1); those standing above the street walk down to it (W12's units
        // 118–123: everyone started on the street, and every "underground" fact of theirs failed).
        // Or the unit's place is noted underground, or stands in a place that is (§8.5: its streets, buildings and rooms).
        // Or in the air or in space (§3.5: the note's layer, by the place's name or a hand's answer): its people start on that
        // layer's floor, its hall `<place>:under`, and never go down to the street's underground.
        const dressed = prepared?.setDresser, placeNote = UN.layerNote(prefilm?.underground, scene.placeId, script), lifted = ['air', 'space'].includes(placeNote?.layer), below = (!lifted && dressed?.setting === 'underground' && (dressed.sure ?? 0) >= 0.5) || !!placeNote;
        let wentDown = false, onLayer = false;
        // A noted place the terrain loop laid under the street (an underground stretch's own place: its area or its shape is a
        // hall, `<place>:under` or `<place>:shape`, or named by the slot it borrows in spawn mode, at the depth Jev chose, deep or
        // near): its people start in that hall.
        const halls = world.source.underground?.halls ?? [], ownHall = (() => { if (!below) return -1; for (let id = scene.placeId, guard = 0; id && guard < 12; id = script.places?.[id]?.parent ?? null, guard++) { const own = [id, citySites[id]?.slot].filter(Boolean), index = halls.findIndex(hall => own.some(name => hall.id === `${name}:shape` || hall.id === `${name}:under` || !!hall.parts?.includes(name))); if (index >= 0) return index; } return -1; })();
        if (ownHall >= 0 && anchor !== null && anchor !== undefined) {
          const p = at(anchor), [box] = halls[ownHall].boxes, inHall = around(box.x, box.z, Math.max(box.w, box.d) / 2 + 4).nodes.filter(node => node.lot === W.HALL_LOT + ownHall);
          // Already in it: on its floor, or inside one of the buildings standing on it (a street laid underground), between
          // its floor and its ceiling over a cell of it.
          const there = W.hallsAt(world, Math.floor(p[0] / CELL), Math.floor(p[2] / CELL)).some(entry => entry.hall === ownHall) && p[1] >= -halls[ownHall].depth - 0.5 && p[1] <= -halls[ownHall].depth + halls[ownHall].height;
          if (!there && !inHall.some(node => node.id === anchor)) {
            // To the hall's middle; on another layer's floor (§3.5: a district's in the deep runs 700 m), to the foot of the way
            // nearest them: joined to the street by its lift (the floor's node nearest them, a deck's corner between its
            // buildings, was reached by no walk: L1's scene 119).
            const feet = halls[ownHall].layer ? new Set((E.graphOf({ x: p[0], z: p[2] }, Math.max(box.w, box.d)).ways ?? []).filter(way => way.hall === ownHall).map(way => way.foot)) : null;
            const [mx, mz] = halls[ownHall].layer ? [p[0], p[2]] : [box.x, box.z], landing = feet?.size ? inHall.filter(node => feet.has(node.id)) : inHall;
            const down = (landing.length ? landing : inHall).sort((a, b) => Math.hypot(a.x - mx, a.z - mz) - Math.hypot(b.x - mx, b.z - mz))[0] ?? null;
            sceneRecord.underground = { place: placeNote?.inherited ?? scene.placeId, hall: halls[ownHall].kind, ...(halls[ownHall].layer ? { layer: halls[ownHall].layer } : {}), depth: halls[ownHall].depth, from: said(p), to: down ? said([down.x, down.y, down.z]) : null, metres: down ? Math.round(Math.hypot(down.x - p[0], down.z - p[2])) : null };
            if (down) { anchor = down.id; wentDown = true; onLayer = !!halls[ownHall].layer; }
          }
        } else if (below && !lifted && anchor !== null && anchor !== undefined && at(anchor)[1] > -1) {
          const p = at(anchor), down = downFrom(anchor)[0] ?? null;
          sceneRecord.underground = { setting: dressed?.setting === 'underground' ? dressed.sure : null, place: placeNote ? (placeNote.inherited ?? scene.placeId) : null, from: said(p), to: down ? said([down.x, down.y, down.z]) : null, metres: down ? Math.round(Math.hypot(down.x - p[0], down.z - p[2])) : null };
          if (down) { anchor = down.id; wentDown = true; }
        }
        // A spot an arm's length to a body or two from the anchor on its level, the same for the same person each time.
        const beside = (who, spread = [BODY, 2.5 * BODY]) => {
          if (anchor === null || anchor === undefined) return null;
          // On another layer's floor, only where a walk from the anchor goes (a deck's floor between its buildings has pockets).
          const p = at(anchor), { nodes } = around(p[0], p[2], spread[1] + 2), reach = onLayer ? onFoot(anchor, spread[1] + 2) : null, ring = nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) >= spread[0] && Math.hypot(node.x - p[0], node.z - p[2]) <= spread[1] && (!reach || reach.has(node.id)));
          return ring.length ? ring[Math.floor(seeded(`${scene.id}|${who}|beside`)() * ring.length)].id : anchor;
        };
        const positions = {}, travels = [];
        sceneRecord.spawned = []; sceneRecord.carried = []; sceneRecord.offPage = [];
        // Smoothed (§5a, W5b): someone whose start the least-action history moves stands where it has them.
        // A start the smoothing moved, in its group's frame (the user, 2026-11-07, of W13's second pass: people shuttled
        // between two halves of one group). The least-action history is the last pass's, and this pass has drifted from it,
        // so a moved start keeps its place beside those it stood with there (within earshot, on its floor), where they start
        // in this pass (carried, spawned, or where they walk in to), not that pass's own spot (scene 64: Index went to where
        // Kamijou and Misaka had stood, 66 m from where they stood now; Kamijou then walked 97 m to her and 89 m back).
        // Everyone else is placed first. Alone there, or only with others the smoothing moved too, the spot itself.
        // Someone who walked in last pass: the smoothing's start for them is where they came from, not where they stood, so it
        // is no spot to put them at (the rehearsal's scene 24: char_000004 smoothed back near her origin, 600 m off, and
        // Kamijou walked 762 m to talk to her). They come in again, from where this pass has them, as the scene gathers.
        const startFor = who => {
          if (!arrivedThen(who)) return smoothedStart(scene, who);
          const revision = startsMoved.get(`${scene.id}|${who}`);
          if (revision && !record.revisions.some(entry => entry.scene === scene.id && entry.who === who)) record.revisions.push({ who, scene: scene.id, moments: [scene.id], metres: Math.round(revision.shift), rank: revision.rank, applied: false, by: 'smoothing', why: 'walked in last pass: comes in again' });
          return null;
        };
        const moved = who => (startFor(who) ?? null) !== null;
        // Where someone stood in the last pass once the scene began: where they walked in to, for one who walked in.
        const priorStart = who => { const list = (smoothed?.people?.[who] ?? []).filter(moment => moment.scene === scene.id); const moment = list.find(entry => String(entry.card ?? '').startsWith('arrive:')) ?? list.find(entry => (entry.card ?? null) === null) ?? list[0]; return moment ? moment.map ?? moment.played : null; };
        // Then and now at the same moment: one who walked in last pass stood where they walked in to, so they are a spot to
        // regroup by only where they walk in this pass too, not where they wait before coming in (the third pass, scene 66:
        // Yomikawa was carried at her origin, 570 m off, and Kamijou and Misaka were put there beside her).
        const spotOf = who => { const node = travels.find(entry => entry.who === who)?.dest ?? (arrivedThen(who) ? null : positions[who]?.[0]); if (node === null || node === undefined) return null; const p = at(node); return { x: p[0], y: p[1], z: p[2] }; };
        const middleOf = points => ({ x: points.reduce((sum, p) => sum + p.x, 0) / points.length, y: points.reduce((sum, p) => sum + (p.y ?? 0), 0) / points.length, z: points.reduce((sum, p) => sum + p.z, 0) / points.length });
        const revisedAt = who => {
          const start = startFor(who), revision = startsMoved.get(`${scene.id}|${who}`);
          if (start === null || start === undefined || !revision) return start;
          const to = revision.to, others = present.filter(other => other !== who && !moved(other) && spotOf(other) && priorStart(other));
          const partners = others.filter(other => { const p = priorStart(other); return Math.hypot(p.x - to.x, p.z - to.z) <= EARSHOT && Math.abs((p.y ?? 0) - (to.y ?? 0)) < FLOOR / 2; });
          // With nobody unmoved within earshot in the last pass: where they stood relative to the scene, by how far the
          // scene's others have drifted since (the median of their shifts), unless that is within earshot (the third pass,
          // scene 182: Kamijou took the second pass's spot alone, 330 m from the two carried in with him, and a line later one
          // who walked in was pulled 590 m to him).
          const median = values => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor(sorted.length / 2)]; };
          const shifts = others.map(other => { const a = spotOf(other), b = priorStart(other); return { x: a.x - b.x, y: a.y - (b.y ?? 0), z: a.z - b.z }; });
          const shift = partners.length ? (() => { const now = middleOf(partners.map(spotOf)), then = middleOf(partners.map(priorStart)); return { x: now.x - then.x, y: now.y - then.y, z: now.z - then.z }; })() : shifts.length ? { x: median(shifts.map(d => d.x)), y: median(shifts.map(d => d.y)), z: median(shifts.map(d => d.z)) } : null;
          if (!shift || (!partners.length && Math.hypot(shift.x, shift.z) <= EARSHOT)) return start;
          const group = partners.length ? partners : others;
          const target = { x: to.x + shift.x, y: (to.y ?? 0) + shift.y, z: to.z + shift.z };
          E.reach(target.x, target.z, 24);
          // On the group's floor: where the nearest node there is on another (W13 rehearsal, scene 62: four floors up), the
          // nearest of the group's own spots.
          let near = W.nodeNear(world, E.graphOf({ x: target.x, z: target.z }), target.x, target.z, Math.round(target.y / FLOOR)) ?? null;
          if (near !== null && Math.abs(at(near)[1] - target.y) > FLOOR / 2) { const own = group.map(other => travels.find(entry => entry.who === other)?.dest ?? positions[other]?.[0]).filter(node => node !== null && node !== undefined); near = own.sort((a, b) => Math.hypot(at(a)[0] - target.x, at(a)[2] - target.z) - Math.hypot(at(b)[0] - target.x, at(b)[2] - target.z))[0] ?? null; }
          if (near === null) return start;
          (sceneRecord.regrouped ??= []).push({ who, with: group, metres: Math.round(Math.hypot(target.x - to.x, target.z - to.z)), ...(partners.length ? {} : { by: 'scene' }) });
          return near;
        };
        sceneRecord.revised = [];
        for (const who of [...present.filter(other => !moved(other)), ...present.filter(moved)]) {
          const from = was.get(who), revised = revisedAt(who);
          // A smoothed start is walked to from where they were, never jumped to (the user, 2026-11-05: "a person can't just
          // disappear without a path"; a second pass from W10's smoothing put 89 people at their revised starts, 31 jumps in
          // the first quarter).
          if (revised !== null && revised !== undefined) {
            sceneRecord.revised.push(who);
            if (!from || from[0] === revised) { positions[who] = [revised, from?.[1] ?? 0]; continue; }
            const a_ = at(from[0]), b_ = at(revised), metres_ = Math.hypot(a_[0] - b_[0], a_[2] - b_[2]);
            positions[who] = from; travels.push({ who, from, dest: revised, ...(frameMetres && metres_ <= frameMetres ? {} : { route: true }), smoothed: true });
            continue;
          }
          if (from && here.includes(who) && !(wentDown && Math.abs(at(from[0])[1] - at(anchor)[1]) > 1.5)) { positions[who] = from; sceneRecord.carried.push(who); continue; }
          const dest = beside(who);
          if (dest === null || dest === undefined) { if (from) positions[who] = from; continue; }
          if (!from) { positions[who] = [dest, 0]; sceneRecord.spawned.push(who); continue; }
          // Coming in (L5, L17): within the frame they walk in on screen; from further, they arrive off-page, and where the
          // story's clock says when they left, the distance must fit the time at their fastest way, else L5 is held (the
          // places may lie nearer than the city has them: L19).
          const a = at(from[0]), b = at(dest), metres = Math.hypot(a[0] - b[0], a[2] - b[2]);
          if (frameMetres && metres <= frameMetres) { positions[who] = from; travels.push({ who, from, dest }); }
          // From farther (the user, 2026-11-03: keep the distance, by a path through loaded blocks, not a jump): they come
          // the whole way, walked leg by leg as the city is loaded along it (routeWalk, below); only if no way is found do
          // they arrive off-page.
          else {
            positions[who] = from; travels.push({ who, from, dest, route: true });
            // L5 on the route: where the story's clock says when they left, the way must fit the time at their fastest way.
            const left = LW.minutesOf(timeOf(lastSceneOf.get(who))), now = LW.minutesOf(timeOf(scene.id));
            if (left !== null && now !== null) { const need = LW.tripTime(metres).seconds; if ((now - left) * 60 < need) (sceneRecord.laws ??= []).push({ law: 'L5', who, verdict: 'held', why: `${Math.round(metres)} m in ${now - left} min (${LW.tripTime(metres).by} needs ${Math.round(need / 60)}): the places may lie nearer (L19)` }); }
          }
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
        const covered = new Set(dg?.covered ?? []);
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
        // The crowd (M9; the user, 2026-11-03: a field of the place with states, acting back on the characters): where the
        // scene digest has people not named on stage, or the ambience cast fires in the scene, a field over the open
        // ground of the scene's frame round the anchor (else the street, measured), sized by the digest; drawn by its
        // samples (`crowd:` ids: scenery, never in the laws, the log, the smoother or canon). Its state is set card by card.
        const extras = new Map();
        let crowd = null;
        const ambience = (gate?.windows ?? []).some(window => window.scene === scene.id && window.fired.includes('backgroundAction'));
        if (dg && (dg.digest.background.crowd !== 'none' || ambience) && anchor !== null && anchor !== undefined) {
          const p = at(anchor), wanted = frameMetres ? frameMetres / 2 : measure({ referent: 'the street', of: null, times: 1 }, p) ?? null, radius = wanted ? Math.min(wanted, CROWD_REACH) : null;
          const { nodes, built } = radius ? around(p[0], p[2], radius) : { nodes: [] };
          const open = nodes.filter(node => node.type === 1 && Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) <= radius), ids = new Set(open.map(node => node.id));
          const neighbours = new Map(open.map(node => { const out = []; for (let e = built.graph.offsets[node.id]; e < built.graph.offsets[node.id + 1]; e++) if (ids.has(built.graph.to[e])) out.push(built.graph.to[e]); return [node.id, out]; }));
          const state = { strolling: 'milling', standing: 'milling', walking: 'flowing', running: 'alarmed' }[dg.digest.background.crowdDoing] ?? 'milling';
          if (open.length) {
            crowd = CF.crowdField({ nodes: open, neighbours, size: dg.digest.background.crowd === 'none' ? 'few' : dg.digest.background.crowd, state, seed: scene.id });
            for (const sample of crowd.samples) { const id = `crowd:${scene.id.slice(-3)}:${sample.id + 1}`; extras.set(id, sample); run.starts[id] = [sample.node, 0]; if (E.names) E.names[id] = ''; }
            sceneRecord.crowd = { ...crowd.summary(), radius: Math.round(radius), nodes: open.length };
          }
        }
        scene.events = []; run.events = []; scene.cast = [...new Set([...(scene.cast ?? []), ...Object.keys(positions), ...extras.keys()])];
        // Those coming from elsewhere walk in first (an event of their own, before the scene's cards).
        if (travels.length) {
          const meet = at(travels[0].dest), event = { id: `arrive:${scene.id}`, text: `(${travels.map(entry => names.get(entry.who) ?? entry.who).join('、')} come here)`, actors: travels.map(entry => entry.who), camera: { focus: { x: meet[0], z: meet[2], y0: meet[1], w: 6, d: 6, h: 3 }, radius: 30, elevation: 40, yaw: 0 } };
          scene.events.push(event);
          // A route from afar, in legs that each fit one walk graph window (128 m of a window 384 m wide): each leg's
          // ground loaded as they reach it, walked on the walk graph, the legs joined into one way.
          const LEG = 128, metresOf = node => { const p = at(node); return { x: p[0], y: p[1], z: p[2] }; };
          const groundNear = (x, z) => around(x, z, 12).nodes.filter(node => node.type === 1).sort((m, n) => Math.hypot(m.x - x, m.z - z) - Math.hypot(n.x - x, n.z - z)).slice(0, 8).map(node => node.id);
          // Run from `from` toward point b, leg by leg (each leg's blocks loaded as they reach it), ending on `last`.
          const runTo = (who, from, b, last, tag) => {
            const a = at(from[0]), legs = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[2] - a[2]) / LEG)), path = [from[0]], skipped = [];
            let here = from;
            for (let k = 1; k <= legs; k++) {
              const t = k / legs, aim = [a[0] + (b[0] - a[0]) * t, a[2] + (b[2] - a[2]) * t];
              const targets = k === legs && last?.length ? last : groundNear(aim[0], aim[1]);
              if (!targets.length) { skipped.push(k); continue; }
              // The leg's whole corridor streamed in first: its ends alone load about 60 m round each, so a leg of 100 m
              // or more could have a gap in its middle.
              { const h = at(here[0]); E.reach((h[0] + aim[0]) / 2, (h[2] + aim[1]) / 2, Math.hypot(aim[0] - h[0], aim[1] - h[2]) / 2 + 24); }
              const leg = walk(scene, `${scene.id}|${who}|${tag}|${k}`, here, targets, 'run');
              // Where a route stops, in metres (the engine's node ids hold only within the run): the leg, where it began, its
              // aim on the straight line, its targets, and why the walk found no way (why-walk.mjs draws it).
              if (!leg || leg.length < 2) return { path, legs: k - 1, of: legs, reached: false, stopped: { tag, leg: k, of: legs, skipped, here: metresOf(here[0]), aim: { x: aim[0], z: aim[1] }, to: metresOf(targets[0]), targets: targets.length, last: k === legs && !!last?.length, code: walk.code ?? (leg ? 'ONE_CELL' : null), why: walk.failed ?? null } };
              path.push(...leg.slice(1)); here = [leg.at(-1), here[1]];
            }
            return { path, legs, of: legs, reached: true };
          };
          // The whole way (the user, 2026-11-03: "they just run"; a virtual subway beyond what running beats, laws.mjs
          // tripTime): run, or run to a virtual station, ride, and run from the far one; the ride a straight hop (no
          // network), so a trip across the city loads only its two ends.
          const routeWalk = (who, from, dest, near) => {
            const a = at(from[0]), b = at(dest), metres = Math.hypot(b[0] - a[0], b[2] - a[2]), trip = LW.tripTime(metres);
            if (trip.by === 'run') return { ...runTo(who, from, b, near.length ? near : [dest], 'route'), trip };
            const towards = (p, q, d) => { const l = Math.hypot(q[0] - p[0], q[2] - p[2]) || 1; return [p[0] + (q[0] - p[0]) * d / l, p[1], p[2] + (q[2] - p[2]) * d / l]; };
            const station = towards(a, b, trip.access), far = towards(b, a, trip.access);
            const first = runTo(who, from, station, groundNear(station[0], station[2]), 'to-station');
            if (!first.reached) return { ...first, trip };
            const alight = groundNear(far[0], far[2]);
            if (!alight.length) return { ...first, reached: false, trip, stopped: { tag: 'alight', here: { x: far[0], y: far[1], z: far[2] }, why: 'no open ground at the far station' } };
            const last = runTo(who, [alight[0], from[1]], b, near.length ? near : [dest], 'from-station');
            return { path: [...first.path, ...last.path], legs: first.legs + last.legs, of: first.of + last.of, reached: last.reached, trip, ride: { from: first.path.at(-1), to: alight[0] } };
          };
          // The rides on a route through the layers (terrain-levels §3.4–3.5), each its own time: a launch to an orbit its
          // fixed long ride, a virtual lift its fixed one, a real lift its rise at its speed and the wait, stairs climbed. A
          // ride is a step of more than a floor and a half up or down.
          const ridesOf = path => {
            const out = [];
            for (let k = 0; k + 1 < path.length; k++) {
              const u = at(path[k]), v = at(path[k + 1]), rise = Math.abs(v[1] - u[1]);
              if (rise <= 1.5 * FLOOR) continue;
              const off = Math.abs(u[1]) > Math.abs(v[1]) ? u : v, hall = W.hallsAt(world, Math.floor(off[0] / CELL), Math.floor(off[2] / CELL)).map(entry => world.source.underground?.halls?.[entry.hall]).find(entry => entry && Math.abs(-entry.depth - off[1]) < 1.5);
              const by = hall?.layer === 'space' ? 'launch' : hall?.virtual ? 'virtual lift' : rise > W.STAIRS_DEPTH ? 'lift' : 'stairs';
              const seconds = by === 'launch' ? W.LAUNCH_RIDE : by === 'virtual lift' ? W.VIRTUAL_RIDE : by === 'lift' ? rise / W.LIFT_SPEED + W.LIFT_WAIT : rise / FLOOR * 18;
              out.push({ by, rise: Math.round(rise), seconds: Math.round(seconds) });
            }
            return out;
          };
          sceneRecord.routes = [];
          for (const entry of travels) {
            const p = at(entry.dest), { nodes } = around(p[0], p[2], 6), near = nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) <= 2.5).map(node => node.id);
            if (entry.route) {
              const route = routeWalk(entry.who, entry.from, entry.dest, near), metres = Math.round(route.path.slice(1).reduce((sum, node, k) => { const u = at(route.path[k]), v = at(node); return sum + Math.hypot(v[0] - u[0], v[2] - u[2], v[1] - u[1]); }, 0));
              const rides = ridesOf(route.path);
              sceneRecord.routes.push({ who: entry.who, metres, by: route.trip.by, seconds: route.trip.seconds + rides.reduce((sum, ride) => sum + ride.seconds, 0), ...(rides.length ? { rides } : {}), legs: route.legs, of: route.of, reached: route.reached, from: metresOf(entry.from[0]), dest: metresOf(entry.dest), ...(route.stopped ? { stopped: route.stopped } : {}) });
              if (route.path.length > 1) { E.moves.set(`${scene.id}|${event.id}|${entry.who}`, { person: entry.who, how: 'run', path: route.path, ensemble: [] }); positions[entry.who] = [route.path.at(-1), entry.from[1]]; }
              if (!route.reached) { positions[entry.who] = [entry.dest, entry.from[1]]; sceneRecord.offPage.push(entry.who); }
              continue;
            }
            const path = walk(scene, `${scene.id}|${entry.who}|arrive`, entry.from, near.length ? near : [entry.dest], 'walk');
            if (path && path.length > 1) { E.moves.set(`${scene.id}|${event.id}|${entry.who}`, { person: entry.who, how: 'walk', path: [...path], ensemble: path.ensemble ?? [] }); positions[entry.who] = [path.at(-1), entry.from[1]]; }
            else positions[entry.who] = [entry.dest, entry.from[1]];
          }
          run.events.push({ at: { ...positions } });
          sceneRecord.arrivals = travels.map(entry => entry.who);
        }
        await live?.phase(`scene ${sceneLabel(scene.id)}: ${cards.length} cards`);
        await show(true);
        await grow(scene, run);
        await stream(`scene ${sceneLabel(scene.id)} begins${sceneRecord.arrivals?.length ? ` · ${sceneRecord.arrivals.map(who => names.get(who) ?? who).join(', ')} come in` : ''}`);
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
        // A step is about a body's length; nearby is within the beat's frame (`within`, measured), never a fixed number.
        const gradedTarget = (who, entry, within = null) => {
          const here = at(positions[who][0]), [lo, hi] = entry.motion === 'step' ? [BODY / 2, 1.5 * BODY] : [1.5 * BODY, Math.max(3 * BODY, (within ?? 12 * BODY) / 2)];
          const other = entry.toward ?? entry.with, there = other && other !== who && positions[other] ? at(positions[other][0]) : null, away = entry.away && entry.away !== who && positions[entry.away] ? at(positions[entry.away][0]) : null;
          const pool = near(here, there ? BODY / 2 : lo, hi);
          if (!pool.length) return null;
          const angle = wayOf(who, false), mid = (lo + hi) / 2, aim = [here[0] + Math.cos(angle) * mid, here[2] + Math.sin(angle) * mid];
          const cost = there ? node => Math.abs(Math.hypot(node.x - there[0], node.z - there[2]) - BODY) : away ? node => -Math.hypot(node.x - away[0], node.z - away[2]) : node => Math.hypot(node.x - aim[0], node.z - aim[1]);
          const best = pool.reduce((a, b) => (cost(b) < cost(a) ? b : a));
          turn.set(who, Math.atan2(best.z - here[2], best.x - here[0]));
          return best.id;
        };
        // What a node is, for the facts (facts.mjs): how far its building's outer wall is (outdoors: whether a building is
        // beside it), an entrance near, stairs, a street.
        const describe = node => {
          // `floor`: its building's own floor (0 its ground floor; a building of a street laid underground counts from that
          // street's floor), else its level from the street (facts.mjs holds).
          const lot = node.lot >= 0 && node.lot < world.lots.length ? world.lots[node.lot] : null, k = Math.round(node.y / FLOOR) - (lot?.k0 ?? 0);
          let edge = 99, stairs = false;
          if (lot) {
            const x0 = lot.i0 * CELL, x1 = (lot.i0 + lot.nx) * CELL, z0 = lot.j0 * CELL, z1 = (lot.j0 + lot.nz) * CELL;
            edge = Math.max(0, Math.min(node.x - x0, x1 - node.x, node.z - z0, z1 - node.z));
            try { stairs = lot.skeleton.cells[S.cellIndex(lot.skeleton, Math.floor(node.x / CELL) - lot.i0, Math.floor(node.z / CELL) - lot.j0, k)] === S.STAIR; } catch { stairs = false; }
          } else if (node.type === FA.TYPE.outdoor) edge = [[-1, 0], [1, 0], [0, -1], [0, 1]].some(([di, dj]) => lotOf(node.x + di * CELL, node.z + dj * CELL) !== undefined) ? CELL : 99;
          const door = (node.type === FA.TYPE.outdoor && edge <= CELL) || (lot && k === 0 && node.type !== FA.TYPE.roof && edge <= 3) ? 2 : 99;
          return { ...node, edge, door, stairs, floor: k, street: node.type === FA.TYPE.outdoor && [1, 3].includes(node.ground || 1) };
        };
        const nodeAt = id => { const p = at(id), found = around(p[0], p[2], 3).nodes.find(node => node.id === id); return describe(found ?? { id, x: p[0], y: p[1], z: p[2], type: 0, lot: -1 }); };
        let factsUpTo = -1, itemsUpTo = -1, cameraBeat = null, cameraGroup = new Set();
        // The photographer's frame for the cut being made (workflow.mjs): set at its first card, checked with its layout,
        // the window the key animator works in; `splitOf` a cut split by a storyboard retake, the node its cards go to now.
        let frame = null, framed = null;
        const splitOf = new Map();
        // The cut bag (cutBag.ts; the user, 2026-11-04: the context engine decides which pre-film casts' notes go to which
        // runtime cast): every pre-film cast's notes on this unit, with its sequence's heading and its storyboard cuts.
        const cutBag = { notes: CB.notesOfUnit(scene.id, prepared ?? (dg ? { scriptSupervisor: dg } : null), { heading: (reading.sequences ?? []).find(entry => entry.id === reads?.sequence)?.heading ?? null, cuts: (reading.storyboard ?? []).filter(entry => entry.scene === scene.id) }) };
        const cutLines = id => { const entry = (reading.storyboard ?? []).find(cut => cut.id === id); if (!entry) return []; const from = sentenceAt.get(entry.first), to = sentenceAt.get(entry.last); return from === undefined ? [] : reads.sentences.slice(from, (to ?? from) + 1); };
        const routeAt = (lines, subject = null, cutId = null) => ({ unit: scene.id, lines, cut: cutId ? cutLines(cutId) : lines, order: reads.sentences, cast: (desk.nodes.get(cutId)?.cast ?? []).filter(who => positions[who]), subject });
        // The script supervisor's facts the routing gives a check, tested on where the cast stands now: each binding one that
        // fails is a fault (L14), with the spot nearest that agrees where there is one in the set.
        const factFaults = (task, lines, cutId, radius = FACT_SEARCH) => {
          const positionOf = who => (positions[who] ? at(positions[who][0]) : null), routed = CB.route(task, routeAt(lines, null, cutId), cutBag.notes).filter(item => item.note.kind === 'fact');
          const facts = routed.map(item => item.note.raw).filter(Boolean);
          const faults = [];
          for (const who of [...new Set(facts.map(fact => fact.who))].filter(who => positions[who])) {
            const here = nodeAt(positions[who][0]), binding = facts.filter(fact => fact.who === who && FA.binding(fact)), failing = binding.filter(fact => FA.holds(fact, here, positionOf) === false);
            if (!failing.length) continue;
            const reach = onFoot(here.id, radius), nearby = around(here.x, here.z, radius).nodes.filter(node => inside(node.id) && reach.has(node.id)).map(describe), best = FA.bestFor(binding, here, nearby, positionOf);
            faults.push({ law: 'L14', who, why: failing.map(fact => FA.factWords(fact, id => names.get(id) ?? id)).join('; '), fix: best ? 'layout' : null, spot: best?.id ?? null, lines: failing.map(fact => fact.sentence) });
          }
          return { faults, notes: routed.map(item => item.id) };
        };
        // The unit's place a building or a room, or the set dresser's setting indoors: its people start inside.
        const placeScale = script.places?.[scene.placeId]?.scale ?? null, setting = prepared?.setDresser;
        const startsInside = ['building', 'room'].includes(placeScale) || (setting?.setting === 'indoors' && (setting.sure ?? 0) >= 0.5);
        const SITE_KINDS = new Set(['indoors', 'outdoors', 'roof', 'underground']);
        const placeByNotes = (lines, cutId, moveTo) => {
          const positionOf = who => (positions[who] ? at(positions[who][0]) : null), facts = CB.route('layout', routeAt(lines, null, cutId), cutBag.notes).filter(item => item.note.kind === 'fact').map(item => item.note.raw).filter(Boolean);
          let moved = false;
          for (const who of Object.keys(positions).filter(id => (desk.nodes.get(cutId)?.cast ?? []).includes(id))) {
            const own = facts.filter(fact => fact.who === who && FA.binding(fact));
            if (startsInside && !own.some(fact => SITE_KINDS.has(fact.kind))) own.push({ who, kind: 'indoors', value: null, basis: 'implied', sure: 0.7, sentence: null, by: 'the place' });
            const here = nodeAt(positions[who][0]);
            if (!own.some(fact => FA.holds(fact, here, positionOf) === false)) continue;
            const reach = onFoot(here.id, FACT_SEARCH), best = FA.bestFor(own, here, around(here.x, here.z, FACT_SEARCH).nodes.filter(node => inside(node.id) && reach.has(node.id)).map(describe), positionOf);
            if (!best) continue;
            moveTo(who, walk(scene, `${scene.id}|${cutId}|${who}|layout-notes`, positions[who], [best.id], 'walk'), 'walk', `layout: by the notes (${own.map(fact => FA.factWords(fact, id => names.get(id) ?? id)).join('; ')})`, { quiet: true });
            moved = true;
          }
          return moved;
        };
        // How many cards each beat plays (a card's share of its beat's time, L17).
        const cardsInBeat = new Map();
        for (const entry of cards) { const n = beatOf.get(entry.first)?.n; if (n !== undefined) cardsInBeat.set(n, (cardsInBeat.get(n) ?? 0) + 1); }
        // How many cards each cut plays (a card's share of its cut's seconds: the cut's timesheet).
        const cardsInCut = new Map();
        for (const entry of cards) { const cut = cutAt.get(entry.first); if (cut) cardsInCut.set(cut.id, (cardsInCut.get(cut.id) ?? 0) + 1); }
        const ELEVATION = { 'eye level': 12, 'over a shoulder': 20, 'over the shoulder': 20, high: 45, 'top-down': 80, overhead: 80, 'low, looking up': 6, low: 6, aerial: 60 };
        // What a shot size takes in, metres across (a close-up one face, a wide shot the room or the street round them).
        const SHOT_SPAN = { 'extreme close-up': 0.6, 'close-up': 1.2, 'medium close-up': 2, 'medium shot': 3.5, 'full shot': 6, 'wide shot': 30, 'extreme wide shot': 250 };
        // Journeys (M6): where the journeys cast fires in this scene (gate.mjs), its spans read for journeys at scale,
        // given the places the world has placed (each with its box).
        const journeyOf = new Map();
        // The spans of this scene where a cast fires (gate.mjs): overlapping blocks joined (segments do not overlap), read
        // sixty lines a request (a long segment in parts, none of it dropped).
        const firedSpans = cast => {
          const spans = [];
          for (const window of (gate?.windows ?? []).filter(entry => entry.scene === scene.id && entry.fired.includes(cast))) {
            const a = order_.indexOf(window.first), b = order_.indexOf(window.last), ids = order_.slice(Math.max(0, a), b < 0 ? order_.length : b + 1), last = spans.at(-1);
            if (last && ids.some(id => last.includes(id))) last.push(...ids.filter(id => !last.includes(id))); else spans.push(ids);
          }
          return spans.flatMap(span => Array.from({ length: Math.ceil(span.length / 60) }, (_, k) => span.slice(k * 60, (k + 1) * 60)));
        };
        const people_ = () => Object.keys(positions).map(id => ({ id, name: names.get(id) ?? id }));
        if (gate && (digestMeter || prefilm)) {
          const spans = prefilm ? [] : firedSpans('blocking');
          if (prefilm) { for (const journey of prepared?.blocking ?? []) journeyOf.set(`${journey.sentence}|${journey.who}`, journey); if (prepared?.blocking) sceneRecord.journeys = prepared.blocking; }
          if (spans.length) {
            // Only the places the story has by now (story time); a place still to come is said in words, as the text names it.
            const places = placeIds.filter(id => boxOf(id) && existsBy(id, scene.id)).map(id => ({ id, label: script.places?.[id]?.label ?? citySites[id]?.label ?? names.get(id) ?? id, scale: script.places?.[id]?.scale ?? citySites[id]?.scale ?? null }));
            sceneRecord.placesOffered = { happened: places.filter(place => !nominated(place.id)).length, nominated: places.filter(place => nominated(place.id)).length, notYet: placeIds.filter(id => boxOf(id) && !existsBy(id, scene.id)).length };
            const journeys = await DG.journeysOf(meters.blocking, { scene, spans, line: id => text.get(id)?.text ?? '', kind: id => reading.kinds?.[id]?.kind ?? null, people: Object.keys(positions).map(id => ({ id, name: names.get(id) ?? id })), places, digest: dg?.digest ?? null });
            for (const journey of journeys) journeyOf.set(`${journey.sentence}|${journey.who}`, journey);
            sceneRecord.journeys = journeys;
          }
        }
        // Choreography (M7): the exchanges of this scene's fights and catastrophes, by the sentence each is told in.
        const exchangesAt = new Map();
        if (gate && (digestMeter || prefilm)) {
          const spans = prefilm ? [] : firedSpans('actionDirector');
          if (prefilm) { for (const exchange of prepared?.actionDirector ?? []) (exchangesAt.get(exchange.sentence) ?? exchangesAt.set(exchange.sentence, []).get(exchange.sentence)).push(exchange); if (prepared?.actionDirector) sceneRecord.exchanges = prepared.actionDirector.length; }
          if (spans.length) {
            const exchanges = await DG.exchangesOf(meters.actionDirector, { scene, spans, line: id => text.get(id)?.text ?? '', kind: id => reading.kinds?.[id]?.kind ?? null, people: people_(), digest: dg?.digest ?? null });
            for (const exchange of exchanges) (exchangesAt.get(exchange.sentence) ?? exchangesAt.set(exchange.sentence, []).get(exchange.sentence)).push(exchange);
            sceneRecord.exchanges = exchanges.length;
          }
        }
        // Conversation and blocking (M8): the channels, formations and attention of this scene's talk.
        // talkedHere: everyone who has talked face to face in this scene so far (where its conversations meet).
        const channelAt = new Map(), formationAt = new Map(), inFormation = new Set(), talkingUntil = new Map(), talkedHere = new Set();
        if (gate && (digestMeter || prefilm)) {
          const spans = prefilm ? [] : firedSpans('dialogueCoverage');
          if (prefilm && prepared?.dialogueCoverage) { const talk = prepared.dialogueCoverage; for (const entry of talk.exchanges ?? []) (channelAt.get(entry.sentence) ?? channelAt.set(entry.sentence, []).get(entry.sentence)).push(entry); for (const entry of talk.formations ?? []) (formationAt.get(entry.sentence) ?? formationAt.set(entry.sentence, []).get(entry.sentence)).push(entry); sceneRecord.talk = { exchanges: (talk.exchanges ?? []).length, formations: (talk.formations ?? []).length, attention: (talk.attention ?? []).length }; }
          if (spans.length) {
            const talk = await DG.talkOf(meters.dialogueCoverage, { scene, spans, line: id => text.get(id)?.text ?? '', kind: id => reading.kinds?.[id]?.kind ?? null, people: people_(), digest: dg?.digest ?? null });
            for (const entry of talk.exchanges) (channelAt.get(entry.sentence) ?? channelAt.set(entry.sentence, []).get(entry.sentence)).push(entry);
            for (const entry of talk.formations) (formationAt.get(entry.sentence) ?? formationAt.set(entry.sentence, []).get(entry.sentence)).push(entry);
            sceneRecord.talk = { exchanges: talk.exchanges.length, formations: talk.formations.length, attention: talk.attention.length };
          }
        }
        // Ambience (M9): the crowd's size, state and focus as the text has them, read where the ambience cast fires.
        const crowdAt = [];
        if (gate && (digestMeter || prefilm) && crowd) {
          const spans = prefilm ? [] : firedSpans('backgroundAction');
          if (prefilm) crowdAt.push(...(prepared?.backgroundAction ?? []).filter(entry => entry.sure >= MOVE_SURE));
          if (spans.length) { crowdAt.push(...(await DG.crowdOf(meters.backgroundAction, { scene, spans, line: id => text.get(id)?.text ?? '', kind: id => reading.kinds?.[id]?.kind ?? null, people: people_(), digest: dg?.digest ?? null })).filter(entry => entry.sure >= MOVE_SURE)); sceneRecord.crowdRead = crowdAt.map(entry => ({ sentence: entry.sentence, size: entry.size, state: entry.state, focus: entry.focus })); }
        }
        // A card's crowd: the state the text last gave it (a focus where it watches or flees someone present), and a hazard
        // where the card's fight strikes an area or breaks something (alarm spreads from there, L17's run).
        const AREA = new Set(['area blast', 'ranged power', 'beam or laser', 'firearm', 'the ground or a building itself']);
        const crowdCard = card => {
          if (!crowd) return;
          const end = Math.max(...card.sentences.map(id => sentenceAt.get(id) ?? -1)), told = crowdAt.filter(entry => (sentenceAt.get(entry.sentence) ?? Infinity) <= end).at(-1);
          if (told) {
            const p = told.focus && positions[told.focus] ? at(positions[told.focus][0]) : null;
            crowd.set(told.state, p ? { x: p[0], z: p[2] } : null);
            if (told.state === 'alarmed' && p && !crowd.hazards.some(hazard => hazard.by === told.sentence)) { crowd.hazard(p[0], p[2]); crowd.hazards.at(-1).by = told.sentence; }
          }
          for (const id of card.sentences) for (const exchange of exchangesAt.get(id) ?? []) {
            if (!AREA.has(exchange.attack) && !exchange.breaks) continue;
            const who = exchange.target ?? exchange.attacker, p = who && positions[who] ? at(positions[who][0]) : null;
            if (p && !crowd.hazards.some(hazard => hazard.by === `${id}|${who}`)) { crowd.hazard(p[0], p[2]); crowd.hazards.at(-1).by = `${id}|${who}`; }
          }
        };
        // Who leads each beat, by what its casts found (the user, 2026-11-03: the pre-film casts' findings steer the lead
        // directly, not a second type question; experiments/v2/cast-firing.mjs): blows read in a beat make it the combat
        // director's, journeys the mega-scene director's, both the mega-scene director's with combat co-directing; a beat
        // whose leading cast read it and found nothing goes to the routine director. Unread, the gate's lead stands.
        if (gate) {
          const readBy = cast => new Set(firedSpans(cast).flat()), read = { actionDirector: readBy('actionDirector'), blocking: readBy('blocking') };
          sceneRecord.leads = [];
          for (const [n, beat] of gate.beats.entries()) {
            if (beat.scene !== scene.id) continue;
            const a = order_.indexOf(beat.first), b = order_.indexOf(beat.last), ids = order_.slice(Math.max(0, a), b < 0 ? order_.length : b + 1);
            const blows = ids.some(id => exchangesAt.has(id)), goes = (sceneRecord.journeys ?? []).some(entry => ids.includes(entry.sentence));
            const readFight = ids.some(id => read.actionDirector.has(id)), readWay = ids.some(id => read.blocking.has(id));
            let found = beat.lead, co = [];
            if (blows && goes) { found = 'mega'; co = ['combat']; } else if (blows) found = 'combat'; else if (goes) found = 'mega';
            // The notes are the evidence (the W10 inspection: 33 beats guessed combat had no blows): a unit with pre-film notes
            // and no blows or journeys in the beat plays it as routine.
            else if ((beat.lead === 'combat' && (readFight || prepared)) || (beat.lead === 'mega' && (readWay || prepared))) found = 'routine';
            if (found !== beat.lead || co.length) { for (const id of ids) { const entry = beatOf.get(id); if (entry?.n === n) beatOf.set(id, { ...entry, lead: found, gateLead: beat.lead, ...(co.length ? { with: co } : {}) }); } }
            sceneRecord.leads.push({ beat: n, type: beat.type, gate: beat.lead, lead: found, ...(co.length ? { with: co } : {}), blows, journeys: goes });
          }
          // What each fired cast found in each of this scene's stretches (M12).
          for (const stretch of record.stretches.filter(entry => entry.scene === scene.id)) {
            const a = order_.indexOf(stretch.first), b = order_.indexOf(stretch.last), ids = new Set(order_.slice(Math.max(0, a), b < 0 ? order_.length : b + 1));
            if (stretch.fired.includes('actionDirector')) stretch.found.actionDirector = [...ids].reduce((n, id) => n + (exchangesAt.get(id)?.length ?? 0), 0);
            if (stretch.fired.includes('blocking')) stretch.found.blocking = (sceneRecord.journeys ?? []).filter(entry => ids.has(entry.sentence)).length;
            if (stretch.fired.includes('dialogueCoverage')) stretch.found.dialogueCoverage = [...ids].reduce((n, id) => n + (channelAt.get(id)?.length ?? 0) + (formationAt.get(id)?.length ?? 0), 0);
          }
        }
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
        // Standing vehicles stand in the walk graph (milestones M15b): a ground vehicle's footprint as a thing while it
        // stands (people walk round it or over it), lifted for a card it or its riders act in, so its own moves and their
        // boarding are not blocked by it, and stood again where the card leaves it.
        const standing = new Set();
        const standAll = () => { for (const id of Object.keys(positions)) { const sheet = sheetOf(id), prop = slotProp(id); if (!sheet?.solid || sheet.layer !== 'ground' || (prop?.airborne ?? 0) > 0 || !positions[id] || wrecks.has(id)) continue; const p = at(positions[id][0]), size = prop?.size ?? [4, 2, 2]; if (E.standThing?.(id, { x: p[0], z: p[2], w: Math.max(1, size[0]), d: Math.max(1, size[2]), h: Math.max(1, size[1]) }) !== false) standing.add(id); } };
        for (const card of cards) {
          const cardRecord = { card: card.id, kind: card.kind, ...(card.pass ? { pass: true } : {}), event: scene.events.length, lines: card.sentences.map(line), moves: [] };
          // The beat's scale (M5): Jev's pictures and the moves' reach sized by its zoom (a street's 32 m without one).
          // The beat's scale (M5, referential and timed since, L16/L17): its frame measured round the card's people, a card's
          // share of the beat's time; Jev's pictures framed at the frame, a move's reach its way's speed times that time (or
          // the reach the reader names, measured, if further). Without a scale, the camera's own defaults.
          const scale = scaleOf.get(beatOf.get(card.first)?.n) ?? null, centre = (() => { const points = card.people.filter(person => positions[person.id]).map(person => at(positions[person.id][0])); return points.length ? [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length) : anchorAt; })();
          const cut = cutAt.get(card.first) ?? null;
          // The scale's frame stays the scene's extent for blocking (facts searched, moves' targets); the cut frames the camera.
          const frameHere = scale ? measure(scale.frame, centre) : null, shotSpan = cut ? SHOT_SPAN[cut.size] ?? 3.5 : null;
          const cardSeconds = cut ? cut.seconds / (cardsInCut.get(cut.id) || 1) : scale?.duration ? scale.duration / (cardsInBeat.get(beatOf.get(card.first)?.n) || 1) : null;
          const frameRadius = Math.min(400, Math.max(10 * BODY, (frameHere ?? 20 * BODY) / 2)), speedOf = how => LW.SPEED[how] ?? LW.SPEED.walk;
          // L20: a reach on foot shrinks by the crowd's drag at the card's people.
          const drag = how => (crowd && centre && ['walk', 'run', 'step'].includes(how) ? crowd.dragAt(centre[0], centre[2]) : 1);
          const reachOf = how => drag(how) * (scale ? Math.max(speedOf(how) * (cardSeconds ?? 0), measure(scale.reach, centre) ?? 0) || (C.REACH[how] ?? C.REACH.walk) : C.REACH[how] ?? C.REACH.walk);
          if (cut) cardRecord.cut = { id: cut.id, n: cut.index + 1, size: cut.size, angle: cut.angle, move: cut.move, seconds: Math.round(cardSeconds * 10) / 10 };
          if (scale) cardRecord.scale = { frame: scale.frame, metres: frameHere ? Math.round(frameHere) : null, angle: scale.angle, reach: scale.reach, seconds: cardSeconds ? Math.round(cardSeconds * 10) / 10 : null };
          asking = cardRecord;
          await live?.phase(`scene ${sceneLabel(scene.id)} · card ${cards.indexOf(card) + 1}/${cards.length}${card.pass ? ' · from the pass' : ''} · ${card.people.filter(person => positions[person.id]).map(person => names.get(person.id) ?? person.id).join(', ')}`, { scene: scene.id, event: scene.events.length, card: card.id });
          sceneRecord.cards.push(cardRecord);
          const event = { id: card.id, text: card.sentences.map(id => text.get(id)?.text ?? '').join('').slice(0, 120), actors: card.people.filter(person => positions[person.id] && person.how.some(how => PRESENT.has(how))).map(person => person.id) };
          scene.events.push(event);
          const moveTo = (person, path, how, why, { quiet = false, thrown = false } = {}) => {
            // A ground vehicle's path that changes floor is no way for it (`groundVehicle`): held like any walk not found.
            // A wreck stays where it fell (milestones M15d): no later move plays for a vehicle the text broke.
            if (wrecks.has(person)) { cardRecord.moves.push({ person, why: 'a wreck stays where it fell', moved: false }); return; }
            if (!thrown && groundVehicle(person) && changesFloor(path)) { walk.failed = `${slotProp(person)?.kind ?? 'a vehicle'} keeps to the level ground: no way there but stairs`; walk.code = 'NO_PATH'; why = why ?? walk.failed; path = null; }
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
            const tie = tiesNow().find(entry => entry.who === person), offStage = tie && !positions[tie.on] ? mountOf(tie.on) : null;
            E.moves.set(key, { person, how: path.air && earlier ? earlier.how : path.how ?? (String(how).startsWith('ride') ? 'ride' : String(how).startsWith('climb') || String(how).startsWith('agile') || how === 'run' || earlier?.how === 'run' ? 'run' : 'walk'), ...grown(earlier, path, path.air ? path.how : null, path.airFrom ?? 0), ensemble: path.ensemble ?? [], ...(offStage ? { mount: offStage } : {}), ...(Array.isArray(path.times) && !earlier ? { at: path.times } : {}) });
            positions[person] = [path.at(-1), positions[person][1]];
            // A leap or a flight a ceiling held down (terrain-levels §8.3), or one out through a hole in the ground skin (§8.4).
            cardRecord.moves.push({ person, why, moved: true, steps: path.length, to: said(at(path.at(-1))), ...(tie ? { riding: tie.on } : {}), ...(path.drove ? { drove: path.drove } : {}), ...(path.capped ? { stoppedBy: path.capped } : {}), ...(path.through ? { through: path.through } : {}) });
            if (!carrying) carryAlong(person, path, E.moves.get(key).how);
          };
          // Riding (mounts.mjs): the ties in hold by this card; who moves with whom (a rider with what carries them on the
          // stage, and everyone it carries); a vehicle off the stage drawn under its rider (the page's `mount`).
          const tiesNow = () => { const end = lastLine(card); return ties.filter(tie => (sentenceAt.get(tie.sentence) ?? Infinity) <= end); };
          const mountOf = id => { const prop = id.startsWith('item:') ? propOf(id.slice(5)) : slotProp(id); return prop?.vehicle ? { kind: prop.kind, size: prop.size, airborne: prop.airborne ?? 0 } : null; };
          { const acting = new Set(card.people.map(person => person.id)); for (const tie of tiesNow()) if (acting.has(tie.who)) acting.add(tie.on); for (const id of [...standing]) if (acting.has(id) && E.liftThing?.(id) !== undefined) standing.delete(id); }
          let carrying = false;
          function carryAlong(person, path, how) {
            const live = tiesNow(), carrier = live.find(tie => tie.who === person)?.on ?? person, group = new Set([carrier, ...live.filter(tie => tie.on === carrier).map(tie => tie.who)]);
            const along = [...group].filter(other => other !== person && positions[other]);
            if (!along.length) return;
            carrying = true;
            try {
              for (const other of along) {
                // A ground vehicle stays where it is when its rider's way changes floor (they go on on foot).
                if (groundVehicle(other) && changesFloor(path)) { cardRecord.moves.push({ person: other, why: `stays: ${slotProp(other)?.kind ?? 'a vehicle'} keeps to the level ground (${names.get(person) ?? person} goes on on foot)`, moved: false }); continue; }
                // Aboard first: one who stands apart runs to where the ride starts, then goes with it.
                const key = `${scene.id}|${card.id}|${other}`, earlier = E.moves.get(key), from = positions[other];
                const board = from[0] === path[0] ? [from[0]] : walk(scene, `${key}|boards|${person}`, from, [path[0]], 'run');
                const ridden = [...(board ?? [from[0]]), ...path.slice(1)];
                E.moves.set(key, { person: other, how, ...grown(earlier, ridden, path.air ? path.how : null, (board ?? [from[0]]).length - 1 + (path.airFrom ?? 0)), ensemble: [], ...(Array.isArray(path.times) && !earlier && (board ?? [from[0]]).length === 1 ? { at: path.times } : {}) });
                positions[other] = [path.at(-1), from[1]];
                cardRecord.moves.push({ person: other, why: `rides with ${names.get(person) ?? person}${board ? '' : ' (boards from where they stood)'}`, moved: true, steps: ridden.length, riding: carrier === other ? person : carrier });
              }
              // L22 · Riding: the riders with what carries them, and no more than it seats.
              if (positions[carrier]) {
                const riders = live.filter(tie => tie.on === carrier && positions[tie.who]).map(tie => tie.who), sheet = carrierOf(carrier), size = Math.max(2, ...(mountOf(carrier)?.size ?? [2]));
                for (const verdict of MT.rideCheck({ carrier, riders, sheet, at: id => at(positions[id][0]), size })) (cardRecord.laws ??= []).push(verdict);
              }
              (cardRecord.rides ??= []).push({ carrier, with: [...group].filter(id => id !== carrier), how });
            } finally { carrying = false; }
          }
          const factsDue = () => {
            const end = lastLine(card), due = dg.facts.filter(fact => { const n = sentenceAt.get(fact.sentence) ?? -1; return n > factsUpTo && n <= end; });
            factsUpTo = Math.max(factsUpTo, end);
            const positionOf = who => (positions[who] ? at(positions[who][0]) : null);
            for (const who of [...new Set(due.map(fact => fact.who))].filter(who => positions[who])) {
              const own = due.filter(fact => fact.who === who), here = nodeAt(positions[who][0]);
              (cardRecord.facts ??= []).push(...own.map(fact => ({ ...fact, holds: FA.holds(fact, here, positionOf) })));
              const binding = own.filter(FA.binding), failing = binding.filter(fact => FA.holds(fact, here, positionOf) === false);
              if (!failing.length) continue;
              // Facts resolve in the set (M4): the spot is looked for inside the scene's building or area first, further
              // only for a stated fact.
              const wide = failing.some(fact => ['indoors', 'outdoors', 'roof', 'underground', 'floor', 'vehicle'].includes(fact.kind)), nearby = [...around(here.x, here.z, Math.max(5 * BODY, (frameHere ?? frameMetres ?? 24 * BODY) / (wide ? 2 : 4))).nodes];
              for (const fact of failing) { const p = fact.kind === 'near' ? positionOf(fact.value) : null; if (p) nearby.push(...around(p[0], p[2], 3 * BODY).nodes); }
              const words = failing.map(fact => FA.factWords(fact, id => names.get(id) ?? id)).join('; '), far = nearby.reduce((most, node) => Math.max(most, Math.hypot(node.x - here.x, node.z - here.z)), 0), reach = onFoot(here.id, Math.min(far, 160)), walkable = nearby.filter(node => reach.has(node.id));
              let best = FA.bestFor(binding, here, walkable.filter(node => inside(node.id)).map(describe), positionOf);
              if (!best && failing.some(fact => fact.basis === 'stated')) { best = FA.bestFor(binding, here, walkable.map(describe), positionOf); if (best) (cardRecord.laws ??= []).push({ law: 'L14', who, verdict: 'amend', why: `outside the set: ${words}` }); }
              // Said to be underground, with no way down near: the nearest way down a walk reaches (§8.5, until the place's note).
              if (!best && failing.some(fact => fact.kind === 'underground' && fact.basis === 'stated')) { best = FA.bestFor(binding, here, downFrom(here.id).slice(0, 400).map(describe), positionOf); if (best) (cardRecord.laws ??= []).push({ law: 'L14', who, verdict: 'amend', why: `went down: ${words}` }); }
              if (!best) { (cardRecord.laws ??= []).push({ law: 'L14', who, verdict: failing.some(fact => fact.basis === 'stated') ? 'held' : 'weighed', why: `no spot near agrees: ${words}` }); continue; }
              moveTo(who, walk(scene, `${scene.id}|${card.id}|${who}|implied`, positions[who], [best.id], 'walk'), 'walk', `implied: ${words}`, { quiet: true });
              const last = cardRecord.moves.at(-1);
              if (last?.person === who) last.implied = failing.map(fact => fact.sentence);
              // Whether each holds where they now stand (the record's `holds` is before the move).
              const there = nodeAt(positions[who][0]); for (const entry of cardRecord.facts) if (entry.who === who && own.some(fact => fact.sentence === entry.sentence && fact.kind === entry.kind)) entry.after = FA.holds(entry, there, positionOf);
            }
          };
          // The background's routine for those the card did not move (the latest the digest says, else the scene's): those
          // strolling or walking go on along the scene's way (strollers turn back beyond 40 m), those fighting shift a step or
          // two, those working a step every third card; the crowd moves every other card.
          // The background's routine (L17: displacement is speed times time): those strolling, walking or running go on along
          // the scene's way as far as their pace covers in the card's share of its beat; strollers and the crowd turn back at
          // the scene's frame. A beat with no duration said moves nobody in the background.
          const PACE = { strolling: LW.SPEED.walk * 0.7, walking: LW.SPEED.walk, running: LW.SPEED.run };
          const drift = () => {
            if (!cardSeconds) return;
            const end = lastLine(card), touched = new Set(cardRecord.moves.filter(move => move.moved).map(move => move.person)), bound = frameMetres ? frameMetres / 2 : null;
            const routine = who => dg.background.filter(entry => entry.who === who && (sentenceAt.get(entry.sentence) ?? 0) <= end).at(-1)?.doing ?? (who === 'crowd' ? dg.digest.background.crowdDoing : dg.digest.people.find(entry => entry.who === who)?.doing ?? null);
            const onward = (who, from, doing, wander) => {
              // L20, crowd drag: on foot through the crowd field, a share of the pace its density leaves.
              const here = at(from[0]), metres = PACE[doing] * cardSeconds * (crowd && !who.startsWith('crowd:') ? crowd.dragAt(here[0], here[2]) : 1);
              if (metres < BODY / 2) return null;
              if (wander && anchorAt && Math.hypot(here[0] - anchorAt[0], here[2] - anchorAt[2]) > wander) turn.set(who, Math.atan2(anchorAt[2] - here[2], anchorAt[0] - here[0]));
              const angle = wayOf(who, !who.startsWith('extra:')), aim = [here[0] + Math.cos(angle) * metres, here[2] + Math.sin(angle) * metres];
              const pool = near(here, metres * 0.6, metres * 1.4);
              const path = pool.length ? walk(scene, `${scene.id}|${card.id}|${who}|${doing}`, from, [pool.reduce((a, b) => (Math.hypot(b.x - aim[0], b.z - aim[1]) < Math.hypot(a.x - aim[0], a.z - aim[1]) ? b : a)).id], doing === 'running' ? 'run' : 'walk') : null;
              if (!path || path.length < 2) { turn.set(who, angle + Math.PI / 2); return null; }
              return path;
            };
            for (const who of Object.keys(positions)) {
              const doing = routine(who);
              const talking = card.people.some(person => person.id === who && person.how.some(how => how === 'speaks' || how === 'addressed')) || (talkingUntil.get(who) ?? -1) >= (sentenceAt.get(card.sentences[0]) ?? Infinity);
              if (touched.has(who) || talking || inFormation.has(who) || !PACE[doing]) continue;
              const path = onward(who, positions[who], doing, doing === 'strolling' ? bound : null);
              if (path) moveTo(who, path, doing === 'running' ? 'run' : 'walk', `background: ${doing}`, { quiet: true });
            }
            // The crowd field moves on the card's time in its state (set below, before the drift); its samples' paths drawn.
            if (!crowd) return;
            const paths = crowd.step(cardSeconds);
            let moved = 0;
            [...extras.keys()].forEach((id, k) => { const path = paths[k]; if (!path) return; E.moves.set(`${scene.id}|${card.id}|${id}`, { person: id, how: crowd.state === 'alarmed' ? 'run' : 'walk', path: [...path], ensemble: [] }); moved++; });
            cardRecord.crowd = { ...crowd.summary(), moved };
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
              const form = formOf(thing); if (!form) continue;
              const w = form.size, h = form.height, d = form.depth, y = p[1] + (held ? 0 : form.airborne);
              thing.placed.push({ scene: scene.id, event: cardRecord.event, place: scene.placeId, x: round(p[0]), y: round(y), z: round(p[2]), fit: { sx: w, sy: h, sz: d, turn: 0, stand: false, w, h, d } });
            }
          };
          // Actors are there (L9): someone the card says acts or speaks, with no place in the scene, is held (a presence the
          // script may have missed), never played.
          for (const person of card.people.filter(entry => !positions[entry.id] && entry.how.some(how => how === 'acts' || how === 'speaks'))) (cardRecord.laws ??= []).push(pins.remote[`${scene.id}|${person.id}`] ? { law: 'L9', who: person.id, verdict: 'ok', why: 'remote (pinned by the review)' } : { law: 'L9', who: person.id, verdict: 'held', why: 'acts or speaks, but is not present' });
          // Talk needs nearness, by its kind (L6; the user, 2026-11-02: the kind asked of Jev; 2026-11-04: "room level
          // conversation stay at one floor"). Who speaks to whom is the reading's, line by line (as L6 reads it), with those the
          // card marks speaking or addressed. The conversation stands on one floor: its anchor's, the one of them a fact of the
          // text placed this container (the surest), else its surest speaker. It is settled after the card's own moves, where
          // they end up (the pilot: a speaker went up to the roof after her listener was brought near on the floor below), and
          // its people are held to its last line against the background's drift. Face to face (live, group), everyone in it
          // comes within speaking distance (2–4 m) on the anchor's floor; remote, everyone stays where they are; public, those
          // within earshot (25 m, the same floor) hear it where they stand, and anyone beyond is held.
          // Across the ground skin (terrain-levels §8.3): one of two under it in a real hall, the other not in that hall; heard
          // only through an open way near both (stairs between the layers, a hole a blow broke), never through a lift.
          const heardAcross = (p, q) => {
            const a = at(positions[p][0]), b = at(positions[q][0]), cell = n => W.nodePos(world, n), roof = n => { const c = cell(n); return W.ceilingAt(world, c.i, c.j, c.k); };
            const [ra, rb] = [roof(positions[p][0]), roof(positions[q][0])];
            if (!(ra.kind === 'skin' || rb.kind === 'skin') || (ra.hall !== undefined && ra.hall === rb.hall)) return null;
            const mid = [(a[0] + b[0]) / 2, (a[2] + b[2]) / 2], openings = [];
            for (const way of around(mid[0], mid[1], 40).built.ways ?? []) if (way.kind === 'stairs') { const f = cell(way.foot), t = cell(way.top); openings.push({ below: [f.x, f.y, f.z], above: [t.x, t.y, t.z], kind: 'stairs' }); }
            for (const [key] of world.underDamage.breaches) { const { ci, cj } = W.chunkOf(key), x = (ci + 0.5) * CELL, z = (cj + 0.5) * CELL; if (Math.hypot(x - mid[0], z - mid[1]) <= 40) { const floor = W.hallsAt(world, ci, cj).find(entry => entry.hall === world.underDamage.breaches.get(key)); if (floor) openings.push({ below: [x, floor.k * FLOOR, z], above: [x, 0, z], kind: 'hole' }); } }
            return LY.heardThrough(a, b, openings);
          };
          const talkNear = async () => {
            if (card.kind !== 'dialogue') return;
            const roles = card.sentences.map(id => reading.roles?.[id]).filter(role => role?.kind === 'spoken' && role.who?.id && positions[role.who.id]);
            const members = [...new Set([...roles.flatMap(role => [role.who.id, ...(role.to?.id && positions[role.to.id] ? [role.to.id] : [])]), ...card.people.filter(person => positions[person.id] && person.how.some(how => how === 'speaks' || how === 'addressed')).map(person => person.id)])];
            if (members.length < 2) return;
            const speaks = who => Math.max(0, ...roles.filter(role => role.who.id === who).map(role => role.who.confidence ?? 0.5), card.people.some(person => person.id === who && person.how.includes('speaks')) ? 0.5 : 0);
            const placedBy = who => { const move = [...sceneRecord.cards.flatMap(entry => entry === cardRecord ? [] : entry.moves ?? []), ...cardRecord.moves].filter(entry => entry.person === who && entry.moved).at(-1); const sure = /^implied:.*?(\d{1,3})%\)/.exec(String(move?.why ?? '')); return sure ? Number(sure[1]) / 100 : 0; };
            // Where the conversation meets (the user, 2026-11-07: in W13 a listener walked to whoever spoke, card after card,
            // and back): the one a fact of the text placed in this container (the surest) stays; else the member the least
            // walking reaches, for the card's people and everyone who has talked face to face in this scene so far, so the
            // few come to the many and a conversation already gathered stays where it is (a floor counts as 30 m).
            const talkers = [...new Set([...members, ...[...talkedHere].filter(who => positions[who])])];
            const walking = who => { const a = at(positions[who][0]); return talkers.reduce((sum, other) => { const b = at(positions[other][0]); return sum + Math.hypot(a[0] - b[0], a[2] - b[2]) + Math.abs(a[1] - b[1]) * 10; }, 0); };
            const anchor = Math.max(...members.map(placedBy)) > 0
              ? members.reduce((a, b) => (placedBy(b) > placedBy(a) || (placedBy(b) === placedBy(a) && speaks(b) > speaks(a)) ? b : a))
              : members.reduce((a, b) => { const [wa, wb] = [walking(a), walking(b)]; return wb < wa - 0.5 || (Math.abs(wb - wa) <= 0.5 && speaks(b) > speaks(a)) ? b : a; });
            const gap = id => { const a = at(positions[anchor][0]), b = at(positions[id][0]); return { metres: Math.hypot(a[0] - b[0], a[2] - b[2]), floors: Math.round(Math.abs(a[1] - b[1]) / FLOOR) }; };
            const apart = members.filter(id => id !== anchor && (gap(id).metres > 5 || gap(id).floors > 0));
            let kind = 'live';
            const pinnedKind = pins.kind[card.id] ?? card.sentences.map(id => pins.kind[`line:${id}`]).find(Boolean);
            const digestKind = read(card) ? digestIn(dg.talk, card)[0]?.kind ?? null : null;
            // The conversation reader's channel first (M8): a phone, a door, a message is remote; a loudspeaker public.
            const channel = card.sentences.flatMap(id => channelAt.get(id) ?? []).sort((a, b) => b.sure - a.sure)[0] ?? null;
            if (pinnedKind) { kind = pinnedKind; cardRecord.talk = { kind, pinned: true }; }
            else if (channel) { kind = DG.CHANNELS[channel.channel]; cardRecord.talk = { kind, by: 'dialogue coverage', channel: channel.channel }; }
            else if (digestKind) { kind = digestKind; cardRecord.talk = { kind, by: 'digest' }; }
            else if (apart.length && calls < budget) {
              const others = Object.keys(positions).filter(id => id !== anchor).map(id => ({ name: names.get(id) ?? id, ...gap(id) }));
              const { replies } = await ask(decide, M.dialogueKindMode, { scene: { id: scene.id, place: placeName }, lines: card.sentences.map(line), speaker: names.get(anchor) ?? anchor, people: others }, null);
              const said = replies.find(reply => reply.key === 'kind');
              kind = String(said?.value ?? 'live'); cardRecord.talk = { kind, confidence: said?.confidence ?? null };
            }
            if (cardRecord.talk) cardRecord.talk.anchor = anchor;
            if (kind !== 'remote') { const last = sentenceAt.get(card.sentences.at(-1)) ?? 0; for (const who of members) { talkingUntil.set(who, Math.max(talkingUntil.get(who) ?? -1, last)); if (kind !== 'public') talkedHere.add(who); } }
            for (const id of apart) {
              if (kind === 'remote') { (cardRecord.laws ??= []).push({ law: 'L6', who: id, verdict: 'ok', why: 'remote: stays where they are' }); continue; }
              if (kind === 'public') {
                const { metres, floors } = gap(id), through = floors ? heardAcross(anchor, id) : null;
                if (through) (cardRecord.talk ??= { kind }).heard = [...(cardRecord.talk.heard ?? []), [anchor, id, through.kind]];
                (cardRecord.laws ??= []).push(metres <= 25 && !floors ? { law: 'L6', who: id, verdict: 'ok', why: 'public: within earshot' } : through ? { law: 'L6', who: id, verdict: 'ok', why: `public: heard through ${through.kind === 'hole' ? 'a hole in the ground' : 'the stairs'} between the levels (${Math.round(through.metres)} m)` } : { law: 'L6', who: id, verdict: 'held', why: `public, but ${Math.round(metres)} m away${floors ? `, ${floors} floors apart` : ''}: out of earshot` });
                continue;
              }
              const a = at(positions[anchor][0]), { nodes } = around(a[0], a[2], 8), ring = nodes.filter(node => Math.abs(node.y - a[1]) < 1 && Math.hypot(node.x - a[0], node.z - a[2]) >= 2 && Math.hypot(node.x - a[0], node.z - a[2]) <= 4).map(node => node.id);
              moveTo(id, walk(scene, `${scene.id}|${card.id}|${id}|talk`, positions[id], ring, 'walk'), 'walk', `spoken to by ${names.get(anchor) ?? anchor}`);
              if (pins.meet.some(meet => meet.scene === scene.id && [meet.who, meet.to].includes(id) && [meet.who, meet.to].includes(anchor))) cardRecord.moves.at(-1).pinned = true;
            }
            if (kind !== 'remote') await roomFor(anchor);
          };
          // Each person the card moves. Where the digest read the card, its moves: a step or a move nearby played by rule
          // (toward, away from or with someone, else on along their way), going elsewhere asked of Jev on the pictures,
          // following someone after they have gone. Elsewhere, Jev's text question first, as before.
          // `retake` (the key check's, workflow.mjs): { n, before, why, avoid: { directions, spots } }: the key sent back, asked
          // again with what failed, the failed choices no longer offered (their spots, else their directions).
          const keyedByJev = new Map();
          const jevMove = async (person, hint = null, retake = null) => {
            const here = at(positions[person][0]), mover = { id: person, name: names.get(person) ?? person }, slug = `${scene.id.slice(-3)}-${card.id.replace(/[^a-z0-9_]/gi, '_')}-${person}`;
            // The key animator works in the photographer's window (the user, 2026-11-04: "The key animator needs to rely on the
            // window provided by photographer"): a still camera's frame bounds the pictures and the spots, and a spot beyond it
            // is offered as one choice, leaving the frame that way; a camera that follows lets the move go as far as it reaches.
            const bounded = !!frame && !frame.follows, keyRadius = bounded ? Math.max(4 * BODY, frame.window * 1.3) : frameRadius;
            const keyFocus = bounded ? { x: frame.centre[0], z: frame.centre[2], y0: frame.centre[1], w: 6, d: 6, h: 3 } : { x: here[0], z: here[2], y0: here[1], w: 6, d: 6, h: 3 };
            await show();
            const played = await grow(scene, run);
            const others = Object.keys(positions).filter(who => who !== person).map(who => ({ id: who, name: names.get(who) ?? who }));
            const now = Object.fromEntries(Object.entries(positions).map(([who, [node]]) => { const p = at(node); return [names.get(who) ?? who, `${said(p)}${who === person ? '' : `, ${Math.round(Math.hypot(p[0] - here[0], p[2] - here[2]))} m from ${mover.name}`}`]; }));
            // The text: the card's own lines; before it, the scene's lines naming the mover, saying where or describing the place, nearest first.
            const first = reads.sentences.indexOf(card.sentences[0]), forms = nameForms.get(person) ?? [mover.name], spatial = new Set((reading.spatial ?? []).filter(entry => entry.scene === scene.id).map(entry => entry.sentence));
            const others_ = reads.sentences.map((id, n) => ({ id, n })).filter(({ id, n }) => !card.sentences.includes(id) && (Math.abs(n - first) <= 4 || spatial.has(id) || reading.kinds[id]?.kind === 'environment' || forms.some(form => (text.get(id)?.text ?? '').includes(form))));
            const context = others_.sort((a, b) => Math.abs(a.n - first) - Math.abs(b.n - first)).map(({ id }) => line(id));
            const base = { scene: { id: scene.id, place: placeName, when }, card: { id: card.id, lines: card.sentences.map(line) }, mover, lines: context, now, route: routeAt(card.sentences, person, cut?.id ?? null), ...(retake ? { retake: { before: retake.before, why: retake.why } } : {}), ...(dg ? { digest: { scene: dg.digest.summary ?? '', ...(hint ? { move: moveWords(hint) } : {}) } } : {}) };
            // Every picture is of the line as played to this moment: people where their walks ended, buildings as broken.
            const shotBase = { place: scene.placeId, at: Math.max(0, (played?.end ?? 0) - 0.02), only: [scene.placeId], mover: person };
            // a. The direction: every arrow, said by what it meets.
            const arrows = C.DIRECTIONS.map(direction => {
              let blocked = false, meets = null;
              for (const metres of [2, 5, 10, 20].map(d => Math.max(1, Math.round(d * keyRadius / 16)))) { const p = C.arrowEnd(here, direction.vector, metres), what = said(p); if (what !== said(here)) { meets = `${what} (${metres} m)`; blocked = metres <= 2 && /a wall/.test(what); break; } }
              const leaves = bounded && !WF.inFrame(frame, C.arrowEnd(here, direction.vector, keyRadius * 0.55));
              return { ...direction, said: `${meets ?? `more of ${said(here)}`}${leaves ? ', out of the frame' : ''}`, blocked };
            });
            // First the text alone: does this person go anywhere in this card? (Not asked when the digest says they go elsewhere.)
            keyedByJev.set(person, hint);
            if (!hint && !retake) {
              const whether = await ask(decide, M.moveWhetherMode, { ...base, pictures: {} }, cutBag);
              const goes = String(whether.replies.find(entry => entry.key === 'moves')?.value ?? 'stays') === 'goes', said_ = whether.replies.find(entry => entry.key === 'line')?.value ?? null;
              // Destruction only on clear evidence (the user, 2026-11-02: routine things blasted): Jev sure of it, 0.7 or more.
              { const breaks = whether.replies.find(entry => entry.key === 'breaks'); if (breaks?.value === 'yes' && (breaks.confidence ?? 0) >= 0.7) cardRecord.breaks = true; }
              if (!goes) { cardRecord.moves.push({ person, direction: 'stays', line: said_, moved: false }); return; }
            }
            cardRecord.camera ??= { focus: { x: here[0], z: here[2], y0: here[1], w: 6, d: 6, h: 3 }, radius: 16, elevation: 35, yaw: 0 };
            const a = await shoot(`${slug}-a`, [1440, 900], { ...shotBase, focus: keyFocus, radius: keyRadius, elevation: bounded ? Math.min(60, Math.max(20, frame.camera.elevation)) : scale ? ELEVATION[scale.angle] ?? 35 : 35, arrows: arrows.map(arrow => ({ at: here, vector: arrow.vector, letter: arrow.letter, color: arrow.color, length: Math.max(bounded ? 3 : 9, keyRadius * 0.55), blocked: arrow.blocked })) });
            const asked = await ask(decide, M.moveDirectionMode, { ...base, pictures: { arrows: `${mover.name} now, from 35° above; the lettered arrows go out of them (warm rise, cool fall, level ones flat).` }, arrows: arrows.filter(arrow => !retake?.avoid?.directions?.includes(arrow.letter)).map(arrow => ({ letter: arrow.letter, said: `${arrow.rise}, toward ${arrow.said}` })), others: others.filter(other => !retake?.avoid?.directions?.includes(`with:${other.id}`)) }, cutBag, { request: { images: { arrows: a.png } } });
            const reply = key => asked.replies.find(entry => entry.key === key)?.value;
            const choice = String(reply('direction') ?? 'stays'), how = String(reply('how') ?? 'walk'), because = reply('line') ?? null;
            const moveRecord = { person, direction: choice, how, line: because, ...(hint ? { digest: moveWords(hint) } : {}), ...(retake ? { retake: retake.n } : {}) };
            if (choice === 'stays') { cardRecord.moves.push({ ...moveRecord, moved: false }); return; }
            if (choice.startsWith('with:')) {
              const leader = choice.slice(5), there = positions[leader] ? at(positions[leader][0]) : null;
              if (!there) { cardRecord.moves.push({ ...moveRecord, moved: false }); return; }
              const { nodes } = around(there[0], there[2], 6), near = nodes.filter(node => Math.abs(node.y - there[1]) < 1 && Math.hypot(node.x - there[0], node.z - there[2]) <= 2.5).map(node => node.id);
              moveTo(person, walk(scene, `${slug}|with`, positions[person], near, how), how, `with ${names.get(leader)}`);
              return;
            }
            const arrow = arrows.find(entry => entry.letter === choice) ?? arrows[0], reach = reachOf(how);
            // The spots are looked for within 100 m (a flight's far end is boxed, not listed): the world streams in no further.
            const pool = around(here[0], here[2], Math.min(reach, 400) + 10), wedge = C.wedgeOnGround(here, arrow.vector, reach);
            // b. The spot: rooms, roofs, open ground and people inside the wedge, nearest first.
            const spots = [], groups = new Map();
            for (const node of pool.nodes) {
              if (!C.inWedge(here, arrow.vector, [node.x, node.y, node.z], 60) || Math.hypot(node.x - here[0], node.y - here[1], node.z - here[2]) < 2.5) continue;
              const what = said([node.x, node.y, node.z]).replace(/ \(.*\)$/, ''), band = node.type === 1 ? `${what}, about ${Math.max(5, Math.round(Math.hypot(node.x - here[0], node.z - here[2]) / 5) * 5)} m ahead` : what;
              (groups.get(band) ?? groups.set(band, []).get(band)).push(node);
            }
            for (const [what, nodes] of groups) { const d = Math.min(...nodes.map(node => Math.hypot(node.x - here[0], node.y - here[1], node.z - here[2]))); if (!/a wall/.test(what)) spots.push({ what, nodes: nodes.map(node => node.id), d }); }
            for (const other of others) { const p = at(positions[other.id][0]); if (C.inWedge(here, arrow.vector, p, 60) && Math.hypot(p[0] - here[0], p[2] - here[2]) <= reach) spots.push({ what: `beside ${other.name}`, nodes: pool.nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) <= 2).map(node => node.id), d: Math.hypot(p[0] - here[0], p[2] - here[2]) }); }
            // In a still camera's frame: the spots inside it, and the nearest beyond it as one choice, leaving the frame.
            const found = spots.filter(spot => spot.nodes.length).sort((x, y) => x.d - y.d), inside = bounded ? found.filter(spot => WF.inFrame(frame, at(spot.nodes[0]))) : found, beyond = bounded ? found.filter(spot => !inside.includes(spot)) : [];
            const offered = [...inside.slice(0, beyond.length ? 15 : 16), ...(beyond.length ? [{ what: `leaves the frame toward ${arrow.said.replace(/, out of the frame$/, '')}`, nodes: beyond[0].nodes, d: beyond[0].d, leaves: true }] : [])].filter(spot => !retake?.avoid?.spots?.includes(spot.what)).map((spot, n) => ({ ...spot, letter: String.fromCharCode(65 + n) }));
            let targets = null, how2 = how;
            if (offered.length) {
              const b = await shoot(`${slug}-b`, [1440, 900], { ...shotBase, focus: keyFocus, radius: bounded ? keyRadius : Math.max(frameRadius, Math.min(reach, 400) * 0.7), elevation: 35, arrows: [{ at: here, vector: arrow.vector, letter: arrow.letter, color: arrow.color, length: Math.min(reach, Math.max(30, frameRadius)) }], ...(wedge ? { wedge: { points: wedge, y: here[1], color: arrow.color } } : {}) });
              const spotAsked = await ask(decide, M.moveSpotMode, { ...base, direction: `toward ${arrow.said} (arrow ${arrow.letter}, ${how})`, pictures: { wedge: `${mover.name}, the chosen arrow and its wedge, as far as a ${how} reaches.` }, spots: offered.map(spot => ({ letter: spot.letter, said: `${spot.what} (${Math.round(spot.d)} m)` })) }, cutBag, { request: { images: { wedge: b.png } } });
              const spot = String(spotAsked.replies.find(entry => entry.key === 'spot')?.value ?? 'none'), chosen = offered.find(entry => entry.letter === spot);
              moveRecord.spot = chosen ? chosen.what : 'none';
              if (chosen?.leaves) moveRecord.leaves = true;
              if (chosen) targets = chosen.nodes;
            }
            // The map along the arrow, beyond the spots: where none was chosen (in a still frame, a place out of it, which
            // the reframe then plays as leaving the frame).
            if (!targets && calls < budget) {
              // c1: a rough box on the plan along the arrow.
              const along = C.frameAlong(here, arrow.vector, reach), half = (along[2] - along[0]) / 2, step = half > 60 ? 20 : half > 25 ? 10 : 5;
              const c1 = await shoot(`${slug}-c1`, [1024, 1024], { ...shotBase, topdown: { x: (along[0] + along[2]) / 2, z: (along[1] + along[3]) / 2, half }, grid: { box: along, step, y: here[1] }, arrows: [{ at: here, vector: arrow.vector, letter: arrow.letter, color: arrow.color, length: Math.min(reach, half) }], ...(wedge ? { wedge: { points: wedge, y: here[1], color: arrow.color } } : {}) });
              const roughAsked = await ask(decide, M.moveRoughMode, { ...base, direction: `toward ${arrow.said} (arrow ${arrow.letter}, ${how})`, pictures: { plan: `straight down, north up, ${Math.round(half * 2)} m across, a grid of ${step} m; ${mover.name}'s arrow and its wedge drawn.` } }, cutBag, { request: { images: { plan: c1.png } } });
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
                const exactAsked = await ask(decide, M.moveExactMode, { ...base, direction: `toward ${arrow.said} (arrow ${arrow.letter}, ${how})`, slices: slices.map(slice => ({ letter: slice.letter, said: slice.said })), pictures: { plan: `the rough box's ground close up, straight down, north up, ${Math.round(zoom * 2)} m across, a grid of 1 m.`, heights: 'the rough box\'s column from the side, its heights lettered.' } }, cutBag, { request: { images: { plan: plan.png, heights: heights.png } } });
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
            // The key animator's move goes the way its note has in use (an ability the person's sheet gives them).
            how2 = howFor(person, hint?.ability, how2, hint?.riding);
            let path = walk(scene, slug, positions[person], targets, how2);
            // A flight or a leap the text states that no walk reaches (scene 162's, from a basement W12 had put her in to an
            // office's 44th floor: held as "no way there on foot") goes through the air to the nearest of its spots
            // (world/air.mjs). Never into the ground: from below the street they first run up to the open ground over them.
            if (!path && (how === 'flight' || how === 'leap')) {
              const from = at(positions[person][0]), nearest = [...targets].sort((a, b) => { const p = at(a), q = at(b); return Math.hypot(p[0] - from[0], p[2] - from[2]) - Math.hypot(q[0] - from[0], q[2] - from[2]); })[0];
              const open = from[1] < -1 ? around(from[0], from[2], 24).nodes.filter(node => node.type === 1).sort((m, n) => Math.hypot(m.x - from[0], m.z - from[2]) - Math.hypot(n.x - from[0], n.z - from[2])).slice(0, 8).map(node => node.id) : null;
              const up = open ? (open.length ? walk(scene, `${slug}|up`, positions[person], open, 'run') : null) : [positions[person][0]];
              if (up && at(nearest)[1] >= -1) { const air = airRoute(up.at(-1), nearest, how); path = Object.assign([...up, ...air.slice(1)], { how, air: true, airFrom: up.length - 1, ensemble: [] }); moveRecord.throughAir = true; }
            }
            moveTo(person, path, how2, path ? null : walk.failed);
            Object.assign(cardRecord.moves.at(-1), moveRecord);
            await save();
          };
          // The mega-scene director (M6): a journey's destination found in the world (a placed place's box, a building
          // its name labels, else a landmark Jev picks on a map at the beat's zoom), and walked, run or leapt to (its roof
          // for leaps, flight, a wall).
          // Which way a point lies on a north-up map (the picking test, 2026-11-03: Jev picked right 94% of the time with each
          // building described in words, floors, distance and this, against 56% on the map alone).
          const mapSide = (from, p) => { const dx = p[0] - from[0], dz = p[2] - from[2], v = Math.abs(dz) > Math.abs(dx) / 2.4 ? (dz < 0 ? 'upper' : 'lower') : '', h = Math.abs(dx) > Math.abs(dz) / 2.4 ? (dx > 0 ? 'right' : 'left') : ''; return [v, h].filter(Boolean).join(' ') || 'middle'; };
          const megaMove = async (person, journey, far) => {
            const roofward = ['leaps between roofs', 'up or along a wall', 'flight'].includes(journey.manner), here = at(positions[person][0]);
            const lotCentre = index => { const lot = world.lots[index]; return [(lot.i0 + lot.nx / 2) * CELL, (lot.floors ?? 1) * FLOOR, (lot.j0 + lot.nz / 2) * CELL]; };
            const box = existsBy(journey.to, scene.id) ? boxOf(journey.to) : null;
            let lot = box ? null : world.lots.findIndex(entry => entry.label && journey.to && (journey.to.includes(entry.label) || entry.label.includes(journey.to)));
            let landmark = null;
            if (!box && lot < 0 && calls < budget) {
              const reach = Math.min(2000, measure(journey.distance, here) ?? frameRadius * 2);
              const candidates = world.lots.map((entry, index) => ({ index, p: lotCentre(index), floors: entry.height ?? entry.floors ?? 1 })).filter(entry => { const d = Math.hypot(entry.p[0] - here[0], entry.p[2] - here[2]); return d > 15 && d <= reach; }).sort((a, b) => b.floors - a.floors).slice(0, 12).map((entry, n) => ({ ...entry, letter: String.fromCharCode(65 + n) }));
              if (candidates.length) {
                const played = await grow(scene, run), half = Math.max(40, ...candidates.map(entry => Math.hypot(entry.p[0] - here[0], entry.p[2] - here[2]))) + 20;
                const map = await shoot(`${scene.id.slice(-3)}-${card.id.replace(/[^a-z0-9_]/gi, '_')}-${person}-landmark`, [1024, 1024], { place: scene.placeId, at: Math.max(0, (played?.end ?? 0) - 0.02), only: [scene.placeId], mover: person, topdown: { x: here[0], z: here[2], half }, spheres: candidates.map(entry => ({ x: entry.p[0], y: entry.p[1] + 4, z: entry.p[2], r: Math.max(4, half / 30), label: entry.letter, labelScale: Math.max(1, half / 40) })) });
                const question = `A top-down map of a city in a novel, north up, ${Math.round(half * 2)} m across; ${names.get(person) ?? person} at its middle. ${names.get(person) ?? person} goes to ${journey.to} (${journey.manner}, ${journey.distance.times} × ${journey.distance.referent}${journey.distance.of ? ` (${journey.distance.of})` : ''}). Lettered red spheres mark the buildings within reach, tallest first.`;
                const options = [{ key: 'landmark', primitive: 'choice', instructions: `Which lettered landmark does ${names.get(person) ?? person} reach?`, options: [...candidates.map(entry => entry.letter), 'none'], optionHints: Object.fromEntries([...candidates.map(entry => [entry.letter, `${entry.letter}: ${lotName(entry.index)}, ${entry.floors} floors, ${Math.round(Math.hypot(entry.p[0] - here[0], entry.p[2] - here[2]))} m away, toward the ${mapSide(here, entry.p)} of the map`]), ['none', 'none of these']]) }];
                const [pick] = await decide(question, options, { images: { map: map.png } });
                // Turn 2, v1's height lock (two-view-things.mjs; the user, 2026-11-03: "the two turn height locking design in
                // v1. Quantum applied to boxes"): the same lettered buildings from the side at two turns, almost level, so
                // their heights stand side by side; the answer is the product of the two turns' distributions (the map
                // measures where, the side view how high). The pick test: height 1/6 on the map alone, 6/6 with the lock.
                const ringed = [here, ...candidates.map(entry => entry.p)], mid = [0, 2].map(axis => ringed.reduce((sum, p) => sum + p[axis], 0) / ringed.length), spread = Math.max(...ringed.map(p => Math.hypot(p[0] - mid[0], p[2] - mid[1])));
                const tallest = Math.max(...candidates.map(entry => entry.floors)) * FLOOR, sideRadius = Math.max(spread * 1.25, tallest * 0.7), mark = sideRadius / 40, sides = {};
                const roofs = [...candidates.map(entry => ({ x: entry.p[0], y: entry.floors * FLOOR + mark, z: entry.p[2], r: mark, label: entry.letter, labelScale: mark / 1.2 })), { x: here[0], y: mark, z: here[2], r: mark * 0.8, label: names.get(person) ?? person, labelScale: mark / 1.2, outline: true }];
                for (const [name, yaw] of [['side_a', -45], ['side_b', 45]]) sides[name] = (await shoot(`${scene.id.slice(-3)}-${card.id.replace(/[^a-z0-9_]/gi, '_')}-${person}-landmark-${name}`, [1440, 900], { place: scene.placeId, at: Math.max(0, (played?.end ?? 0) - 0.02), only: [scene.placeId], mover: person, focus: { x: mid[0], z: mid[1], y0: 0, w: 2 * spread, d: 2 * spread, h: tallest }, radius: sideRadius, yaw: yaw * Math.PI / 180, elevation: 12, spheres: roofs, poles: [{ x: here[0], z: here[2] }] })).png;
                const [lock] = await decide(`${question} Pictures side_a and side_b: the same lettered buildings from the side at two turns, almost level, each lettered on a red sphere over its roof; a white pole beside ${names.get(person) ?? person} marked at 10, 20, 40 and 60 m.`, options, { images: sides });
                const letters = options[0].options, share = (answer, letter) => answer?.distribution?.[letter] ?? (answer?.value === letter ? answer.confidence ?? 0.5 : (1 - (answer?.confidence ?? 0.5)) / (letters.length - 1));
                const joint = letters.map(letter => [letter, Math.max(1e-3, share(pick, letter)) * Math.max(1e-3, share(lock, letter))]), total = joint.reduce((sum, [, p]) => sum + p, 0), best = joint.sort((a, b) => b[1] - a[1])[0];
                const chosen = candidates.find(entry => entry.letter === best[0]);
                landmark = { pick: best[0], confidence: Math.round(best[1] / total * 100) / 100, map: pick?.value ?? null, side: lock?.value ?? null };
                if (chosen) lot = chosen.index;
              }
            }
            if (!box && (lot === null || lot < 0)) return false;
            const centre = box ? [box[0], 0, box[1]] : lotCentre(lot), radius = box ? Math.max(box[2], box[3]) / 2 : Math.max(world.lots[lot].nx, world.lots[lot].nz) * CELL / 2 + 6;
            const { nodes } = around(centre[0], centre[2], radius + 4);
            const fits = node => (box ? true : node.lot === lot || Math.hypot(node.x - centre[0], node.z - centre[2]) <= radius);
            const wanted = nodes.filter(node => fits(node) && (roofward ? node.type === FA.TYPE.roof : node.type === FA.TYPE.outdoor));
            const targets = (wanted.length ? wanted : nodes.filter(fits)).sort((a, b) => Math.hypot(a.x - here[0], a.z - here[2]) - Math.hypot(b.x - here[0], b.z - here[2])).slice(0, 40).map(node => node.id);
            const how = howFor(person, journey.ability ?? far?.ability, roofward || journey.manner === 'run' || journey.manner === 'zigzag through alleys' ? 'run' : 'walk', journey.riding ?? far?.riding);
            let path = targets.length ? walk(scene, `${scene.id}|${card.id}|${person}|journey`, positions[person], targets, how) : null, airborne = false;
            // A leap, flight or climb the walk graph has no way for (no air edges: tower to tower, scene 26) goes through the
            // air to the nearest target (world/air.mjs: over what stands between, out of a window, up a wall), recorded as
            // such (L12 checks the ability).
            const airKind = journey.manner === 'flight' ? 'flight' : journey.manner === 'up or along a wall' ? 'climb' : 'leap';
            if (!path && roofward && targets.length) { path = airRoute(positions[person][0], targets[0], airKind); airborne = true; }
            moveTo(person, path, how, `journey: to ${box ? (script.places?.[journey.to]?.label ?? journey.to) : lotName(lot)} (${journey.manner})`);
            Object.assign(cardRecord.moves.at(-1), { direction: 'elsewhere', line: far.sentence, digest: moveWords(far), journey: { to: journey.to, manner: journey.manner, distance: journey.distance, ...(landmark ? { landmark } : {}) }, ...(airborne ? { airborne: true, throughAir: true, how: airKind } : {}) });
            return true;
          };
          // The combat director (M7): each exchange of the card's lines played. Where the reader is unsure, Jev is asked its
          // kind, shape and outcome on a picture of the two at the beat's zoom. A close attacker closes in; a hit throws
          // the target as far as told, away from the attacker; a dodge steps aside; what breaks goes to the destruction
          // questions; the target's state is recorded (conditions, for the ontology's state).
          // The architect (the user, 2026-11-06: "Architect should pick a room type when conversation happens in a room"): a
          // conversation that plays in a room of a building has the room's kind asked of Jev once (the lines, the building, its
          // floor, the room's size), and the room is furnished by its kind (digest/rooms.mjs) on the page. Kept per room for the
          // run; the card says which room and what kind.
          const roomFor = async who => {
            if (!positions[who]) return;
            const room = roomAt(positions[who][0]);
            if (!room) return;
            const key = `${room.lot}|${room.room}`, known = E.rooms.get(key);
            if (known) { cardRecord.room = { lot: room.lot, room: room.room, type: known.type, asked: false }; return; }
            let type = 'not said', sure = null;
            if (calls < budget) {
              const kinds = RM.ROOM_TYPE_NAMES.map(name => `${name}: ${RM.ROOM_TYPES[name]}`).join('\n');
              const [reply] = await decide(`A conversation in a novel is staged in a room of a building. The building: ${room.building ?? 'unnamed'} (${room.role ?? 'a building'}, ${room.floors} floors); the room is on floor ${room.floor + 1}, ${room.w} by ${room.d} m. The scene: ${placeName}.\nThe lines:\n${card.sentences.map(id => text.get(id)?.text ?? '').filter(Boolean).join('\n')}\n\nThe kinds of room:\n${kinds}`, [{ key: 'room', primitive: 'choice', instructions: 'What kind of room does this conversation take place in? Answer not said if the lines and the building do not tell.', options: RM.ROOM_TYPE_NAMES }]);
              if (reply?.value && RM.ROOM_TYPES[reply.value]) { type = String(reply.value); sure = reply.confidence ?? null; }
            }
            const furniture = RM.furnish(type, room.w, room.d, furnitureSizes, `${key}|${type}`).map(piece => [piece.model, piece.u, piece.v, piece.angle]);
            E.rooms.set(key, { lot: room.lot, room: room.room, type, sure, scene: scene.id, card: card.id, furniture });
            cardRecord.room = { lot: room.lot, room: room.room, type, sure, asked: true, pieces: furniture.length };
          };
          // Where a beam from the attacker (to a point, or straight up) meets the ceiling over them (the exporter's beamCeiling):
          // kept on the card, null under the open sky or inside a building.
          const underCeiling = (exchange, to) => {
            if (!E.beamCeiling) return null;
            const met = E.beamCeiling(positions[exchange.attacker][0], to ? { x: to[0], y: to[1], z: to[2] } : null);
            if (met.ceiling !== 'skin' && met.ceiling !== 'hard') return null;
            if (met.under) return null;
            (cardRecord.ceilings ??= []).push({ who: exchange.attacker, line: exchange.sentence, ...met });
            return met;
          };
          const fight = async () => {
            const exchanges = card.sentences.flatMap(id => exchangesAt.get(id) ?? []);
            // The card's blows as the page plays them (a beam, a blow up close, an explosion: strand-demo.html, blowFx);
            // set again whole when the card is taken again.
            const blows = []; (E.blows ??= new Map()).set(card.id, blows);
            for (const exchange of exchanges) {
              const entry = { ...exchange, by: 'reader' };
              const a = exchange.attacker && positions[exchange.attacker] ? at(positions[exchange.attacker][0]) : null, t = exchange.target && positions[exchange.target] ? at(positions[exchange.target][0]) : null;
              if (exchange.sure < 0.6 && calls < budget && (a || t)) {
                const mid = a && t ? [(a[0] + t[0]) / 2, (a[1] + t[1]) / 2, (a[2] + t[2]) / 2] : a ?? t, played = await grow(scene, run);
                const shot = await shoot(`${scene.id.slice(-3)}-${card.id.replace(/[^a-z0-9_]/gi, '_')}-${exchange.sentence}-fight`, [1440, 900], { place: scene.placeId, at: Math.max(0, (played?.end ?? 0) - 0.02), only: [scene.placeId], focus: { x: mid[0], z: mid[2], y0: mid[1], w: 6, d: 6, h: 3 }, radius: frameRadius, elevation: scale ? ELEVATION[scale.angle] ?? 35 : 35 });
                const who = id => (id ? names.get(id) ?? id : 'the world itself');
                const replies = await decide(`A still of a fight in a novel, staged in 3D (${who(exchange.attacker)} against ${who(exchange.target)}). The line: ${text.get(exchange.sentence)?.text ?? ''}`, [
                  { key: 'attack', primitive: 'choice', instructions: 'What kind of attack is this exchange?', options: DG.ATTACKS },
                  { key: 'shape', primitive: 'choice', instructions: 'What shape does it take in space?', options: DG.SHAPES },
                  { key: 'outcome', primitive: 'choice', instructions: 'What happens to the target?', options: DG.OUTCOMES },
                ], { images: { fight: shot.png } });
                for (const reply of replies) if (['attack', 'shape', 'outcome'].includes(reply.key) && reply.value) entry[reply.key] = String(reply.value);
                entry.by = 'jev';
              }
              (cardRecord.exchanges ??= []).push(entry);
              if (exchange.breaks && exchange.sure >= 0.7) { cardRecord.breaks = true; (cardRecord.breaksSaid ??= []).push(exchange.breaks); }
              if (exchange.condition && exchange.target) (cardRecord.conditions ??= []).push({ who: exchange.target, condition: exchange.condition, line: exchange.sentence });
              const away = (from, to, metres) => { const d = Math.hypot(to[0] - from[0], to[2] - from[2]) || 1, aim = [to[0] + (to[0] - from[0]) / d * metres, to[2] + (to[2] - from[2]) / d * metres]; const pool = near(to, Math.max(0.8, metres * 0.5), metres * 1.5 + 2); return pool.length ? pool.reduce((x, y) => (Math.hypot(y.x - aim[0], y.z - aim[1]) < Math.hypot(x.x - aim[0], x.z - aim[1]) ? y : x)).id : null; };
              if (a && t && /^(touch|close)/.test(entry.range) && Math.hypot(a[0] - t[0], a[2] - t[2]) > 3) {
                const ring = near(t, 0.8, 2).map(node => node.id);
                if (ring.length) moveTo(exchange.attacker, walk(scene, `${scene.id}|${card.id}|${exchange.attacker}|closes|${exchange.sentence}`, positions[exchange.attacker], ring, 'run'), 'run', `fight: closes in on ${names.get(exchange.target) ?? exchange.target}`, { quiet: true });
              }
              const thrown = exchange.knockback ? measure(exchange.knockback, t) : 0;
              if (t && entry.outcome === 'hit' && thrown >= BODY / 2) {
                const target = away(a ?? [t[0] - 1, t[1], t[2]], at(positions[exchange.target][0]), thrown);
                if (target !== null) moveTo(exchange.target, walk(scene, `${scene.id}|${card.id}|${exchange.target}|thrown|${exchange.sentence}`, positions[exchange.target], [target], 'run'), 'run', `fight: thrown ${Math.round(thrown)} m by ${a ? names.get(exchange.attacker) ?? exchange.attacker : 'the blow'} (${entry.attack})`, { quiet: true, thrown: true });
              } else if (t && entry.outcome === 'dodged') {
                const p = at(positions[exchange.target][0]), side = a ? [-(p[2] - a[2]), p[0] - a[0]] : [1, 0], d = Math.hypot(...side) || 1, aim = [p[0] + side[0] / d * 2, p[2] + side[1] / d * 2], pool = near(p, 1, 3);
                if (pool.length) moveTo(exchange.target, walk(scene, `${scene.id}|${card.id}|${exchange.target}|dodges|${exchange.sentence}`, positions[exchange.target], [pool.reduce((x, y) => (Math.hypot(y.x - aim[0], y.z - aim[1]) < Math.hypot(x.x - aim[0], x.z - aim[1]) ? y : x)).id], 'run'), 'run', `fight: dodges ${a ? names.get(exchange.attacker) ?? exchange.attacker : ''}`.trim(), { quiet: true });
              }
              // L21 · Attack reach (laws/attacks.mjs): the blow as the attacker can make it, after its moves: close within
              // reach, a line within range and clear of buildings, an explosion within its range and radius; the limits the
              // attacker's own (the settei sheet), else a weapon they hold, else a person's.
              if (exchange.attacker && exchange.target && positions[exchange.attacker] && positions[exchange.target]) {
                const kind = exchange.attackKind ?? IU.attackKindOf(entry);
                const weapons = [...things.values()].filter(thing => thing.holder === exchange.attacker).map(thing => ({ label: thing.name, attack: propOf(thing.name)?.attack ?? null })).filter(entry_ => entry_.attack);
                // The attacker's own attacks merged with what carries them (a vehicle's mounted weapon; a person lends no attack).
                const own = MT.mergedSheet(abilitySheet?.people?.[exchange.attacker], tiesNow().filter(tie => tie.who === exchange.attacker).map(tie => ({ id: tie.on, sheet: carrierOf(tie.on) }))).attack;
                const limits = AT.limitsOf(kind, { own, weapons });
                const verdict = AT.attackCheck({ kind, from: at(positions[exchange.attacker][0]), to: at(positions[exchange.target][0]), limits, lots: world.lots });
                if (verdict) { (cardRecord.laws ??= []).push({ ...verdict, who: exchange.attacker, line: exchange.sentence }); entry.attackKind = kind; entry.limits = limits; }
                // A beam under a ceiling (terrain-levels §8.3): through the ground skin it bores a hole and goes on; the deep
                // layer's hard ceiling (or rock past BEAM_BORE) stops it there, marked. Only one that reaches the sky tears the clouds.
                const met = kind === 'line' ? underCeiling(exchange, at(positions[exchange.target][0])) : null;
                blows.push({ attacker: exchange.attacker, target: exchange.target, kind, outcome: met?.stopped ? 'stopped' : entry.outcome ?? null, held: verdict?.verdict === 'held', ...(kind === 'area' ? { radius: limits?.radius ?? 4 } : {}), by: limits?.by ?? null, ...(SKY.cutsClouds(exchange.breaks) && !met?.stopped ? { clouds: true } : {}), ...(met ? { ceiling: met } : {}) });
              }
              // A beam the fight says tears through the clouds with no one to hit (fired at the sky): the page plays it from
              // its attacker up through the layer (strand-demo.html, cloudHoles). Under a ceiling it meets that first.
              else if (exchange.attacker && positions[exchange.attacker] && SKY.cutsClouds(exchange.breaks)) { const met = underCeiling(exchange, null); blows.push({ attacker: exchange.attacker, target: null, kind: 'line', outcome: met?.stopped ? 'stopped' : null, held: false, ...(met?.stopped ? {} : { clouds: true }), by: 'clouds', ...(met ? { ceiling: met } : {}) }); }
            }
          };
          // The routine director's blocking (M8): a group the text gives a formation stands in it, round where its people
          // are now; those in a formation, and those talking in the card, keep their places against the background's drift.
          const block = async () => {
            for (const formation of card.sentences.flatMap(id => formationAt.get(id) ?? [])) {
              const members = formation.who.filter(who => positions[who]);
              for (const who of members) inFormation.add(who);
              (cardRecord.formations ??= []).push({ who: members, formation: formation.formation, line: formation.sentence });
              if (members.length < 2 || ['two sides of a door', 'apart'].includes(formation.formation)) continue;
              const points = members.map(who => at(positions[who][0])), c = [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length), way = wayOf(members[0], true), ahead = [Math.cos(way), Math.sin(way)], side = [-ahead[1], ahead[0]];
              const slot = (who, k) => {
                const n = members.length, f = formation.formation;
                if (f === 'a ring') { const r = Math.max(1.2, n * 0.4), angle = (2 * Math.PI * k) / n; return [c[0] + Math.cos(angle) * r, c[2] + Math.sin(angle) * r]; }
                if (f === 'behind') return [c[0] - ahead[0] * 1.2 * k, c[2] - ahead[1] * 1.2 * k];
                const gap = f === 'across a table' ? 1.2 : f === 'facing' ? 0.9 : 0.5, axis = f === 'facing' || f === 'across a table' ? ahead : side;
                return [c[0] + axis[0] * gap * (2 * k - (n - 1)), c[2] + axis[1] * gap * (2 * k - (n - 1))];
              };
              members.forEach((who, k) => {
                const target = slot(who, k), here = at(positions[who][0]);
                if (Math.hypot(here[0] - target[0], here[2] - target[1]) <= 1.2) return;
                const pool = near([target[0], c[1], target[1]], 0, 2.5);
                if (!pool.length) return;
                const best = pool.reduce((a, b) => (Math.hypot(b.x - target[0], b.z - target[1]) < Math.hypot(a.x - target[0], a.z - target[1]) ? b : a));
                moveTo(who, walk(scene, `${scene.id}|${card.id}|${who}|${formation.formation}`, positions[who], [best.id], 'walk'), 'walk', `blocking: ${formation.formation}`, { quiet: true });
              });
            }
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
            const journey = far ? card.sentences.map(id => journeyOf.get(`${id}|${person}`)).find(Boolean) : null;
            if (far && journey && await megaMove(person, journey, far)) return;
            if (far) { if (calls < budget) await jevMove(person, far); else cardRecord.moves.push({ person, why: 'budget spent' }); return; }
            for (const entry of mine.slice(0, 3)) {
              const target = gradedTarget(person, entry, frameHere);
              if (target === null) { cardRecord.moves.push({ person, direction: entry.motion, moved: false, why: 'digest: no spot to step to', by: 'digest' }); continue; }
              const way = howFor(person, entry.ability, entry.how === 'run' ? 'run' : 'walk', entry.riding);
              moveTo(person, walk(scene, `${scene.id}|${card.id}|${person}|${entry.sentence}|${entry.motion}`, positions[person], [target], way), way, `digest: ${moveWords(entry)}${entry.ability ? ` (${entry.ability})` : ''}`, { quiet: true });
              Object.assign(cardRecord.moves.at(-1), { direction: entry.motion, line: entry.sentence, by: 'digest' });
            }
          };
          // The cut's node (workflow.mjs): at its first card, the layout (its cast as they stand), the photographer's frame,
          // and the layout check, every fault retaken automatically: two on one cell step apart (L11); a shot size that
          // cannot hold its cast tightens on the card's lead; at most two retakes, then passed with faults.
          const node = cut ? splitOf.get(cut.id) ?? cut.id : null, castNow = () => (desk.nodes.get(cut?.id)?.cast ?? card.people.filter(person => person.how.some(how => PRESENT.has(how))).map(person => person.id)).filter(who => positions[who]);
          if (node && node !== framed) {
            framed = node;
            const layoutNow = () => castNow().map(who => ({ who, node: positions[who][0], at: at(positions[who][0]), held: !frame?.holds || frame.holds.includes(who) }));
            // What the routing gives the layout artist and the photographer (recorded with their versions).
            const layoutNotes = CB.route('layout', routeAt(card.sentences, null, cut.id), cutBag.notes).map(item => item.id), frameNotes = CB.route('frame', routeAt(card.sentences, null, cut.id), cutBag.notes).map(item => item.id);
            const layoutVersion = () => ({ at: Object.fromEntries(layoutNow().map(entry => [entry.who, entry.at.map(round)])), notes: layoutNotes });
            desk.start(node, 'layout'); desk.publish(node, 'layout', layoutVersion());
            // The layout artist places the cast by the notes before the check (the W10 inspection: at a building's unit,
            // people "implied indoors" were laid out on the street and no retake could reach a room): each person's binding
            // facts the routing gives the layout, and, where the unit is a building or a room or the set dresser says
            // indoors, inside unless a fact says otherwise (a default that moves, never a fault); to the best spot in the set.
            if (placeByNotes(card.sentences, cut.id, moveTo)) desk.publish(node, 'layout', layoutVersion());
            desk.start(node, 'frame');
            frame = null;
            frame = WF.frameOf({ points: layoutNow().map(entry => entry.at), size: cut.size, angle: cut.angle, move: cut.move }) ?? (anchorAt ? WF.frameOf({ points: [anchorAt], size: cut.size, angle: cut.angle, move: cut.move }) : null);
            desk.publish(node, 'frame', { ...frame, notes: frameNotes });
            for (;;) {
              desk.start(node, 'layout check');
              const faults = [...WF.layoutFaults({ frame, cast: layoutNow() }), ...factFaults('layout check', card.sentences, cut.id).faults];
              // A retake only where one can help: a fault no cast can fix (no spot near agrees with the note) passes as it is.
              const verdict = desk.check(node, 'layout check', faults, { of: 'frame', canRetake: faults.some(fault => fault.fix) });
              if (verdict === 'passed with faults') frame = desk.kept(node, 'frame') ?? frame;
              if (verdict !== 'retake') break;
              const crowded = faults.filter(fault => fault.fix === 'layout' && fault.law === 'L11').map(fault => fault.who), placed = faults.filter(fault => fault.fix === 'layout' && fault.law === 'L14');
              // Where the text puts someone (the script supervisor's note) and the layout disagree: to the nearest spot that agrees.
              for (const fault of placed) moveTo(fault.who, walk(scene, `${scene.id}|${card.id}|${fault.who}|layout-note`, positions[fault.who], [fault.spot], 'walk'), 'walk', `layout: ${fault.why}`, { quiet: true });
              for (const who of crowded) {
                const taken = new Set(Object.values(positions).map(value => value[0])), free = near(at(positions[who][0]), 0.8, 2.5).filter(entry => !taken.has(entry.id));
                if (free.length) moveTo(who, walk(scene, `${scene.id}|${card.id}|${who}|layout`, positions[who], [free[0].id], 'walk'), 'walk', 'layout: one to a cell', { quiet: true });
              }
              if (crowded.length || placed.length) {
                desk.publish(node, 'layout', layoutVersion());
                // The frame taken again round the cast as they now stand (frame after layout), unless it holds a lead only.
                if (!frame?.holds) { const again = WF.frameOf({ points: layoutNow().map(entry => entry.at), size: cut.size, angle: cut.angle, move: cut.move }); if (again) { frame = again; desk.publish(node, 'frame', { ...frame, notes: frameNotes }); } }
              }
              if (faults.some(fault => fault.fix === 'tighten' || fault.fix === 'frame')) {
                const lead = card.people.find(person => positions[person.id] && person.how.some(how => how === 'speaks' || how === 'acts'))?.id ?? castNow()[0];
                if (lead) { frame = { ...WF.frameOf({ points: [at(positions[lead][0])], lead: at(positions[lead][0]), size: cut.size, angle: cut.angle, move: cut.move }), holds: [lead] }; desk.publish(node, 'frame', { ...frame, notes: frameNotes }); }
              }
            }
            desk.done(node, 'layout'); desk.done(node, 'frame');
          }
          if (node) desk.start(node, 'keys', card.id); else frame = null;
          // Before the keys: where everyone stands and the walk this card already holds for each (a layout fix), so a key
          // sent back is made again from the same place.
          const keysFrom = { moves: cardRecord.moves.length, laws: (cardRecord.laws ?? []).length }, walkKey = who => `${scene.id}|${card.id}|${who}`;
          const beforeKeys = new Map(Object.entries(positions).map(([who, value]) => [who, { at: [...value], walk: E.moves.get(walkKey(who)), moves: [], laws: [] }]));
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
          // The key check (the animation director's, workflow.mjs; the user, 2026-11-04: "let's implement the retake"): a key
          // with no way there (L10) or that puts its mover where the script supervisor's sure notes say they are not (L14).
          // A key Jev made is sent back: its mover is put back where they stood, and the key animator is asked again with
          // what failed, the failed choices no longer offered; at most two retakes, then the attempt with the fewest faults
          // is kept. A key made by rule (a graded step, a journey, a follower) is not Jev's to make again: it passes.
          if (node && frame) {
            const keysNow = () => cardRecord.moves.slice(keysFrom.moves).map(move => ({ who: move.person, moved: !!move.moved, ...(move.direction ? { direction: move.direction } : {}), ...(move.spot ? { spot: move.spot } : {}), ...(move.leaves ? { leaves: true } : {}), ...(move.retake ? { retake: move.retake } : {}) }));
            const keyFaults = () => [
              ...(cardRecord.laws ?? []).slice(keysFrom.laws).filter(entry => entry.law === 'L10' && entry.verdict === 'held').map(entry => ({ law: 'L10', who: entry.who, why: entry.why })),
              ...factFaults('key check', card.sentences, cut.id).faults.filter(fault => keyedByJev.has(fault.who)).map(({ law, who, why }) => ({ law, who, why })),
            ];
            const stateOf = who => ({ at: positions[who] ? [...positions[who]] : null, walk: E.moves.get(walkKey(who)), moves: cardRecord.moves.slice(keysFrom.moves).filter(move => move.person === who), laws: (cardRecord.laws ?? []).slice(keysFrom.laws).filter(entry => entry.who === who) });
            const restore = (who, state) => {
              if (state.at) positions[who] = [...state.at];
              if (state.walk) E.moves.set(walkKey(who), state.walk); else E.moves.delete(walkKey(who));
              cardRecord.moves.splice(keysFrom.moves, Infinity, ...cardRecord.moves.slice(keysFrom.moves).filter(move => move.person !== who), ...state.moves);
              if (cardRecord.laws) cardRecord.laws.splice(keysFrom.laws, Infinity, ...cardRecord.laws.slice(keysFrom.laws).filter(entry => entry.who !== who), ...state.laws);
            };
            let retaken = null;
            const attempts = [], avoid = new Map();
            desk.publish(node, 'keys', keysNow(), card.id);
            for (let n = 1; ; n++) {
              desk.start(node, 'key check', card.id);
              const faults = keyFaults();
              retaken ??= [...new Set(faults.filter(fault => keyedByJev.has(fault.who) && beforeKeys.has(fault.who)).map(fault => fault.who))];
              attempts.push(new Map(retaken.map(who => [who, stateOf(who)])));
              const verdict = desk.check(node, 'key check', faults, { card: card.id, of: 'keys', canRetake: retaken.some(who => faults.some(fault => fault.who === who)) && calls < budget });
              if (verdict === 'passed with faults' && attempts.length > 1) {
                const kept = desk.nodes.get(node)?.cards[card.id]?.keys?.kept ?? attempts.length;
                if (kept !== attempts.length) for (const [who, state] of attempts[kept - 1]) restore(who, state);
              }
              if (verdict !== 'retake') break;
              for (const who of retaken) {
                const mine = faults.filter(fault => fault.who === who);
                if (!mine.length) continue;
                const last = [...cardRecord.moves.slice(keysFrom.moves)].reverse().find(move => move.person === who && move.direction), was = avoid.get(who) ?? { directions: [], spots: [] };
                if (last?.spot && last.spot !== 'none') was.spots.push(last.spot); else if (last?.direction) was.directions.push(last.direction);
                avoid.set(who, was);
                restore(who, beforeKeys.get(who));
                await jevMove(who, keyedByJev.get(who), { n, before: last ? `${last.direction}${last.spot && last.spot !== 'none' ? `, to ${last.spot}` : ''}${last.how ? ` (${last.how})` : ''}` : 'a move', why: mine.map(fault => `${fault.law}: ${fault.why}`).join('; '), avoid: was });
              }
              desk.publish(node, 'keys', keysNow(), card.id);
            }
            desk.done(node, 'keys', card.id);
          }
          // What the text says or implies about where people are (the digest's facts up to this card): someone whose spot
          // disagrees with a binding fact moves to the nearest spot that agrees (an implied move); a stated fact no spot near
          // agrees with is recorded under L14. Then the background's routine, the crowd, and the things people carry.
          await fight();
          await block();
          if (dg) factsDue();
          await talkNear();
          if (dg) { crowdCard(card); drift(); carry(); }
          if (read(card) && digestIn(dg.breaks, card).some(entry => entry.sure >= 0.7)) { cardRecord.breaks = true; cardRecord.breaksSaid = digestIn(dg.breaks, card).map(entry => entry.what); }
          // Destruction (docs/v2/world-engine-redesign.md §3): a card the text says breaks something is asked where it hits (lettered
          // red spheres on the world as played) and how big (spheres of 4, 8, 16 and 32 m from two sides); the blast is applied
          // to the world and played before the next card.
          // L18: a blast the last pass's smoothing moved to this card (blasts.mjs), applied here at its smoothed size; at the
          // card that told it, nothing is asked again.
          for (const blast of blasts.filter(entry => entry.container === scene.id && entry.atCard === card.id && !entry.applied)) {
            E.reach(blast.centre.x, blast.centre.z, blast.r + 16); wakeBelow(positions);
            E.hitSphere(scene, { id: event.id }, { ...blast.centre, r: blast.r }, 0.9, `${scene.id}|${event.id}|smoothed-hit`);
            blast.applied = true;
            cardRecord.hit = { smoothed: true, told: blast.told, across: blast.r * 2, centre: blast.centre, struck: !!E.hits.get(event.id) };
          }
          const smoothedHere = blasts.some(entry => entry.container === scene.id && entry.told === card.id);
          // A vehicle the text breaks (milestones M15c): the blast sized by its interaction sheet where it stands, no Jev
          // question asked; its riders thrown clear; its wreck on the page from this card (M15d).
          const broke = cardRecord.breaks ? [...new Set([...digestIn(dg?.breaks ?? [], card).filter(entry => entry.sure >= 0.7).map(entry => String(entry.what)), ...(cardRecord.breaksSaid ?? []).map(String)])] : [];
          const crashed = [...new Set(broke.flatMap(what => Object.keys(positions).filter(id => slotProp(id)?.vehicle && !wrecks.has(id) && (() => { const label = String(propSheet?.ids?.[id] ?? names.get(id) ?? ''); return label.length > 1 && (what.includes(label) || label.includes(what)); })())))];
          for (const id of crashed) {
            const sheet = sheetOf(id), p = at(positions[id][0]), r = Math.max(1, sheet.crash.radius), strength = [0, 0.5, 0.7, 0.9, 1][sheet.crash.degree] ?? 0.7;
            if (sheet.crash.degree > 0) { E.reach(p[0], p[2], r + 16); wakeBelow(positions); E.hitSphere(scene, { id: event.id }, { x: p[0], y: p[1], z: p[2], r }, strength, `${scene.id}|${event.id}|crash|${id}`); }
            cardRecord.hit = { crash: id, across: r * 2, degree: sheet.crash.degree, struck: !!E.hits.get(event.id), centre: { x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10, z: Math.round(p[2] * 10) / 10 } };
            if (sheet.breaks !== 'none') { const ref = sheet.wreck, mesh = ref ? await WH.meshOfPart(ref, { novelDir }).catch(() => null) : null; if (mesh) scadMeshes.set(PR.idOfRef(ref), mesh); wrecks.set(id, { scene: scene.id, event: scene.events.length - 1, model: mesh ? `scad:${PR.idOfRef(ref)}` : null, part: ref, at: { x: Math.round(p[0] * 10) / 10, y: Math.round(p[1] * 10) / 10, z: Math.round(p[2] * 10) / 10 } }); if (standing.has(id)) { E.liftThing?.(id); standing.delete(id); } }
            for (const tie of tiesNow().filter(tie => tie.on === id && positions[tie.who])) { const ring = around(p[0], p[2], Math.max(4, r)).nodes.filter(node => node.type === 1 && Math.hypot(node.x - p[0], node.z - p[2]) >= Math.min(3, r / 2)).slice(0, 8).map(node => node.id); if (ring.length) moveTo(tie.who, walk(scene, `${scene.id}|${card.id}|${tie.who}|crash|${id}`, positions[tie.who], ring, 'run'), 'run', `crash: thrown clear of ${names.get(id) ?? propSheet?.ids?.[id] ?? id}`, { quiet: true, thrown: true }); }
          }
          if (cardRecord.breaks && calls < budget && !smoothedHere && !crashed.length) {
            const played = await grow(scene, run, true), at_ = Math.max(0, (played?.end ?? 0) - 0.02), slug = `${scene.id.slice(-3)}-${card.id.replace(/[^a-z0-9_]/gi, '_')}-hit`;
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
                // L18: the blast as an observation for the smoothing: its centre, Jev's whole answer on its size, how sure the
                // reading was that the card breaks something.
                const sizes = Object.fromEntries(SIZES.map((across, n) => [across, Math.round((size?.distribution?.[`${n + 1}`] ?? (Number(size?.value) === n + 1 ? 1 : 0)) * 1000) / 1000]));
                const breaksSure = Math.max(0, ...digestIn(dg?.breaks ?? [], card).map(entry => entry.sure ?? 0));
                E.reach(chosen.x, chosen.z, r + 16); wakeBelow(positions);
                E.hitSphere(scene, { id: event.id }, { x: chosen.x, y: chosen.y, z: chosen.z, r }, 0.9, `${scene.id}|${event.id}|hit`);
                cardRecord.hit = { pick: chosen.label, on: chosen.from, across: r * 2, struck: !!E.hits.get(event.id), centre: { x: Math.round(chosen.x * 10) / 10, y: Math.round(chosen.y * 10) / 10, z: Math.round(chosen.z * 10) / 10 }, sizes, sure: breaksSure };
              }
            }
          }
          // Who holds, drives or rides what after this card (the transport specialist's state): what changed since the card
          // before, each with its owner where the specialist found one (universe/transport.json).
          {
            const now = new Map();
            for (const thing of things.values()) if (thing.holder) now.set(`${thing.name}|${thing.holder}`, { thing: thing.name, who: thing.holder, how: 'holds' });
            for (const tie of tiesNow()) { const label = tie.on.startsWith('item:') ? tie.on.slice(5) : propSheet?.ids?.[tie.on] ?? tie.on; now.set(`${label}|${tie.who}`, { thing: label, who: tie.who, how: names.has(tie.on) ? 'carried by' : 'rides' }); }
            const changes = [...[...now].filter(([key]) => !heldBefore.has(key)).map(([, entry]) => ({ ...entry, change: 'takes' })), ...[...heldBefore].filter(([key]) => !now.has(key)).map(([, entry]) => ({ ...entry, change: 'leaves' }))];
            if (changes.length) cardRecord.holdings = changes.map(entry => ({ ...entry, ...(ownerOf(entry.thing) && ownerOf(entry.thing) !== 'not said' ? { owner: ownerOf(entry.thing) } : {}) }));
            heldBefore = now;
          }
          standAll();
          run.events.push({ at: Object.fromEntries(Object.entries(positions).map(([who, value]) => [who, value])) });
          // A card no one was asked about: the producer's camera on the people of the card, as they stood when it began.
          // The camera holds one group for a beat (M4; the user, 2026-11-03: the camera shifting back and forth): everyone
          // who has acted, spoken or moved in the beat so far, framed together; a new beat starts a new group.
          // With a storyboard, the camera holds one group for a cut instead: a cut is one camera setup.
          const beat = beatOf.get(card.first) ?? null, key = cut?.id ?? beat?.n ?? `card:${card.id}`;
          if (beat) cardRecord.beat = beat;
          if (key !== cameraBeat) { cameraBeat = key; cameraGroup = new Set(); }
          for (const who of [...event.actors, ...cardRecord.moves.filter(move => move.moved && !String(move.why ?? '').startsWith('background')).map(move => move.person)]) if (positions[who]) cameraGroup.add(who);
          { const points = [...cameraGroup].filter(who => positions[who]).map(who => at(positions[who][0]));
            if (points.length) { const mid = [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length), spread = Math.max(0, ...points.map(p => Math.hypot(p[0] - mid[0], p[2] - mid[2]))); cardRecord.camera = cut
              // A cut's shot: as close as its size, never cutting off the people it holds.
              ? { focus: { x: mid[0], z: mid[2], y0: mid[1], w: 6, d: 6, h: 3 }, radius: Math.max(shotSpan + 1.5, spread * 1.2 + 2 * BODY), elevation: ELEVATION[cut.angle] ?? 12, yaw: 0, cut: cut.id, move: cut.move }
              : { focus: { x: mid[0], z: mid[2], y0: mid[1], w: 6, d: 6, h: 3 }, radius: Math.max(10 * BODY, spread * 1.2 + 4 * BODY, frameHere ? Math.min(400, frameHere / 2) : 0), elevation: scale ? ELEVATION[scale.angle] ?? 35 : 35, yaw: 0 }; } }
          // The cut's node after the keys (workflow.mjs; the key check ran right after them): the in-betweens (the walks), the reframe (held, followed, exits frame, or a new cut where someone
          // who left is seen again in this cut), the photography (the camera is the frame's) and the rush check (every law
          // the card holds).
          if (node && frame) {
            desk.publish(node, 'in-betweens', { walks: cardRecord.moves.filter(move => move.moved).length }, card.id); desk.done(node, 'in-betweens', card.id);
            const later = new Set(cards.slice(cards.indexOf(card) + 1).filter(entry => cutAt.get(entry.first)?.id === cut.id).flatMap(entry => entry.people.filter(person => person.how.some(how => how === 'speaks' || how === 'acts')).map(person => person.id)));
            const ended = castNow().filter(who => !frame.holds || frame.holds.includes(who)).map(who => ({ who, at: at(positions[who][0]) }));
            const reframe = WF.reframeOf({ frame, ended, later });
            desk.publish(node, 'reframe', reframe, card.id); desk.done(node, 'reframe', card.id);
            if (reframe.decision === 'followed') { frame = { ...WF.frameOf({ points: ended.map(entry => entry.at), size: cut.size, angle: cut.angle, move: cut.move }), ...(frame.holds ? { holds: frame.holds } : {}) }; desk.publish(node, 'frame', frame); desk.done(node, 'frame'); }
            if (reframe.decision === 'new cut') splitOf.set(cut.id, desk.split(cut.id, card.id, `${reframe.outside.map(who => names.get(who) ?? who).join(', ')} left the frame and come back in this cut`));
            cardRecord.camera = { ...frame.camera, cut: node, move: cut.move };
            cardRecord.workflow = { node, frame: desk.nodes.get(node)?.tasks.frame?.kept ?? null, window: frame.window, reframe: reframe.decision, ...(reframe.outside.length ? { outside: reframe.outside } : {}) };
            desk.publish(node, 'photography', { camera: cardRecord.camera }, card.id); desk.done(node, 'photography', card.id);
            desk.start(node, 'rush check', card.id);
            desk.check(node, 'rush check', (cardRecord.laws ?? []).filter(entry => entry.verdict === 'held').map(entry => ({ law: entry.law, who: entry.who, why: entry.why })), { card: card.id, canRetake: false, of: 'photography' });
          }
          // The producer's camera rides with the card's event: the player and World · Live follow it card by card. It names
          // its group (everyone who has acted, spoken or moved in the beat or cut so far): the player's group orbit centres
          // on them as they stand frame by frame (strand-demo.html orbitTick; the user, 2026-11-08).
          if (cardRecord.camera) cardRecord.camera.group = [...cameraGroup].filter(who => positions[who]);
          event.camera = cardRecord.camera ?? null;
          // Streamed: the line as far as this card, played on in World · Live; a moment to watch a move before the next question.
          await grow(scene, run);
          const went = cardRecord.moves.filter(move => move.moved);
          await stream(`scene ${sceneLabel(scene.id)} · card ${cards.indexOf(card) + 1}/${cards.length}${went.length ? ` · ${went.map(move => names.get(move.person) ?? move.person).join(', ')} moved` : ''}`, cardRecord.camera ? { x: cardRecord.camera.focus.x, z: cardRecord.camera.focus.z, r: 24 } : null);
          if (pace && went.length) await new Promise(done => setTimeout(done, pace * 1000));
        }
        // Talk on the move (on-the-move.mjs; the user, 2026-11-08): where the reading keeps people moving while they talk,
        // the way they went over those cards is spread across them by their lines, the group in step (a leader, the others
        // a cell beside, the carried on their carrier), each piece paced to last its card. Where each of them ends the
        // stretch is kept, so the cards after it and the departures below play as they were.
        if (onTheMove && dg) {
          const lineAt = id => sentenceAt.get(id) ?? -1, formations = [...formationAt.values()].flat();
          const signals = [
            ...(dg.moves ?? []).filter(entry => (entry.sure ?? 1) >= MOVE_SURE).map(entry => ({ at: lineAt(entry.sentence), who: entry.who, state: OM.stateOfMove(entry), with: entry.with ? [entry.with] : [] })),
            ...(dg.background ?? []).filter(entry => entry.who !== 'crowd').map(entry => ({ at: lineAt(entry.sentence), who: entry.who, state: OM.stateOfDoing(entry.doing), with: [] })),
            ...formations.flatMap(entry => entry.who.map(who => ({ at: lineAt(entry.sentence), who, state: OM.stateOfFormation(entry.formation), with: OM.stateOfFormation(entry.formation) === 'walk' ? entry.who.filter(other => other !== who) : [] }))),
          ].filter(signal => signal.at >= 0 && (signal.state || signal.with.length));
          const initial = new Map((dg.digest?.people ?? []).map(entry => [entry.who, OM.stateOfDoing(entry.doing)]).filter(([, state]) => state));
          const states = OM.statesOf({ cards: cards.map(card => ({ last: lastLine(card) })), signals, initial });
          const talkers = cards.map(card => new Set(card.people.filter(person => person.how.some(how => how === 'speaks' || how === 'addressed')).map(person => person.id)));
          const metres = (a, b) => { const p = at(a), q = at(b); return Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]); };
          const remote = cards.map(card => sceneRecord.cards.find(entry => entry.card === card.id)?.talk?.kind === 'remote');
          for (const stretch of OM.stretchesOf({ states, talkers, remote })) {
            const events = stretch.cards.map(k => scene.events.findIndex(event => event.id === cards[k].id)), ids = stretch.cards.map(k => cards[k].id);
            const skip = why => (sceneRecord.onTheMove ??= []).push({ members: stretch.members, cards: ids, kept: why });
            if (events.some(n => n < 0) || events.some((n, k) => k && n !== events[k - 1] + 1)) { skip('cards not in a row'); continue; }
            const before = who => (events[0] ? run.events[events[0] - 1]?.at?.[who] : run.starts[who]) ?? null, after = who => run.events[events.at(-1)]?.at?.[who] ?? null;
            // Talk while driving (OM.cutDrive; the user, 2026-11-08): a group riding a road vehicle whose drive the director
            // laid (a ride with its timings, `at`, world-engine/world/roads.mjs). The vehicle keeps its own speed; the drive is
            // cut across the stretch's cards by their reading, and everyone aboard goes node for node with it. Talk that
            // outlasts the drive goes on with the car stopped where it arrived.
            const movesOf = who => events.map(n => E.moves.get(`${scene.id}|${scene.events[n].id}|${who}`) ?? null);
            const driver = stretch.members.find(who => movesOf(who).some(move => move?.how === 'ride' && move.at));
            if (driver) {
              const legs = movesOf(driver).filter(Boolean);
              if (legs.some(move => move.how !== 'ride' || !move.at || move.air)) { skip(`${driver} does more than drive`); continue; }
              const route = [], times = [];
              for (const move of legs) { const offset = times.length ? times.at(-1) : 0; move.path.forEach((node, k) => { if (k === 0 && route.length && route.at(-1) === node) return; route.push(node); times.push(offset + move.at[k]); }); }
              if (route.at(-1) !== after(driver)?.[0]) { skip(`${driver} ends off the drive`); continue; }
              const aboard = stretch.members.filter(who => who === driver || (movesOf(who).some(Boolean) ? movesOf(who).every(move => !move || (move.how === 'ride' && move.path.at(-1) === route.at(-1))) : before(who)?.[0] === route[0]));
              const weights = stretch.cards.map(k => OM.readSeconds(cards[k].sentences.map(line)));
              const cuts = OM.cutDrive(times, weights), mount = legs.find(move => move.mount)?.mount ?? null;
              for (const who of aboard) for (const n of events) E.moves.delete(`${scene.id}|${scene.events[n].id}|${who}`);
              cuts.forEach(([from, to], k) => {
                const n = events[k], record = sceneRecord.cards.find(entry => entry.card === ids[k]);
                if (to > from) for (const who of aboard) E.moves.set(`${scene.id}|${scene.events[n].id}|${who}`, { person: who, how: 'ride', path: route.slice(from, to + 1), at: times.slice(from, to + 1).map(t => Math.round((t - times[from]) * 100) / 100), real: true, ensemble: [], ...(who === driver && mount ? { mount } : {}) });
                for (const who of aboard) if (run.events[n]?.at) run.events[n].at[who] = [route[to], before(who)?.[1] ?? run.events[n].at[who]?.[1]];
                if (record) record.onTheMove = { group: aboard, leader: driver, how: 'ride', ...(to > from ? { seconds: Math.round((times[to] - times[from]) * 10) / 10 } : { parked: true }) };
              });
              (sceneRecord.onTheMove ??= []).push({ members: aboard, cards: ids, leader: driver, how: 'ride', seconds: Math.round(weights.reduce((a, b) => a + b, 0) * 10) / 10, drive: Math.round(times.at(-1) * 10) / 10, parked: cuts.filter(([from, to]) => to === from).length });
              continue;
            }
            // Each one's own way through the stretch: where they stood, then each card's walk; a ride, a flight or a leap, a
            // climb, an appearing, or a pin of the review's keeps the stretch as the director played it.
            const own = new Map();
            let why = null;
            for (const who of stretch.members) {
              const from = before(who), to = after(who);
              if (!from || !to) { why = `${who} not on stage throughout`; break; }
              if (ids.some(id => pins.arrive[`${scene.id}|${id}|${who}`] || pins.stays[`${scene.id}|${id}|${who}`])) { why = `${who} pinned by the review`; break; }
              const nodes = [from[0]];
              for (const n of events) {
                const move = E.moves.get(`${scene.id}|${scene.events[n].id}|${who}`);
                if (!move) continue;
                if (move.air || move.mount || !['walk', 'run'].includes(move.how)) { why = `${who} ${move.how}${move.mount ? ' aboard' : ''}`; break; }
                for (const node of move.path) if (nodes.at(-1) !== node) nodes.push(node);
              }
              if (why) break;
              if (nodes.at(-1) !== to[0]) { why = `${who} ends off their way`; break; }
              own.set(who, { from, to, nodes, metres: nodes.slice(1).reduce((sum, node, n) => sum + metres(nodes[n], node), 0) });
            }
            if (why) { skip(why); continue; }
            // The carried (the reading's "carried", with whoever carries them) ride on their carrier; the leader is a
            // carrier, else whoever went furthest.
            const carriedBy = new Map();
            for (const k of stretch.cards) for (const [a, b] of states[k].ties) if (states[k].states.get(a) === 'carried' && states[k].states.get(b) !== 'carried' && stretch.members.includes(b)) carriedBy.set(a, b);
            const walkers = stretch.members.filter(who => !carriedBy.has(who)), carriers = new Set(carriedBy.values());
            const leader = [...walkers].sort((a, b) => (carriers.has(b) - carriers.has(a)) || own.get(b).metres - own.get(a).metres)[0];
            if (!leader || own.get(leader).metres < 2) { skip('nobody went anywhere'); continue; }
            const how = stretch.cards.some(k => states[k].states.get(leader) === 'run' || states[k].states.get(leader) === 'carried') || carriers.has(leader) ? 'run' : 'walk';
            const route = own.get(leader).nodes;
            // The cells round the leader's way, for the others to walk a cell beside it.
            const points = route.map(at), xs = points.map(p => p[0]), zs = points.map(p => p[2]), mid = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
            const cellsNear = new Map(around(mid[0], mid[1], Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...zs) - Math.min(...zs)) / 2 + 8).nodes.map(node => { const c = W.cellOf(world, node.id); return [`${c.i},${c.j},${c.k}`, node.id]; }));
            const lookup = { cell: id => W.cellOf(world, id), node: (i, j, k) => cellsNear.get(`${i},${j},${k}`) ?? null };
            // A way in from where they stood and out to where they end (the director's own walk), when the way they keep
            // to starts or ends off it.
            const join = (who, a, b, label) => {
              if (a === b) return [a];
              const path = walk(scene, `${scene.id}|${ids[0]}|${who}|on the move ${label}`, [a, own.get(who).from[1]], [b], how);
              return path && path.length > 1 ? path : null;
            };
            const ways = new Map([[leader, { nodes: route }]]);
            walkers.filter(who => who !== leader).forEach((who, n) => ways.set(who, { nodes: OM.besideWay(route, OM.sideOf(n), lookup) }));
            for (const who of stretch.members.filter(who => carriedBy.has(who))) { const carrier = ways.get(carriedBy.get(who)) ?? ways.get(leader); ways.set(who, { nodes: carrier.nodes }); }
            for (const [who, way] of ways) {
              if (who === leader) continue;
              const into = join(who, own.get(who).from[0], way.nodes[0], 'in'), out = join(who, way.nodes.at(-1), own.get(who).to[0], 'out');
              if (!into || !out) { why = `no walk ${!into ? 'onto' : 'off'} the way for ${who}`; break; }
              way.lead = into.slice(0, -1); way.tail = out.slice(1);
            }
            if (why) { skip(why); continue; }
            const weights = stretch.cards.map(k => OM.readSeconds(cards[k].sentences.map(line)));
            const pieces = OM.inStep({ ways: [[leader, ways.get(leader)], ...[...ways].filter(([who]) => who !== leader)], weights, natural: OM.PACE[how], slowest: OM.SLOWEST[how], metres });
            for (const who of stretch.members) for (const n of events) E.moves.delete(`${scene.id}|${scene.events[n].id}|${who}`);
            const standing = new Map(stretch.members.map(who => [who, own.get(who).from]));
            pieces.forEach((moves, k) => {
              const n = events[k], record = sceneRecord.cards.find(entry => entry.card === ids[k]);
              for (const move of moves) { E.moves.set(`${scene.id}|${scene.events[n].id}|${move.person}`, { person: move.person, how, path: move.path, ensemble: [], ...(move.pace ? { pace: move.pace } : {}), ...(move.at ? { at: move.at } : {}) }); standing.set(move.person, [move.path.at(-1), standing.get(move.person)[1]]); }
              for (const who of stretch.members) if (run.events[n]?.at) run.events[n].at[who] = standing.get(who);
              if (record) record.onTheMove = { group: stretch.members, leader, how, pace: moves.find(move => move.person === leader)?.pace ?? OM.PACE[how], ...(carriedBy.size ? { carried: Object.fromEntries(carriedBy) } : {}) };
            });
            (sceneRecord.onTheMove ??= []).push({ members: stretch.members, cards: ids, leader, how, metres: Math.round(own.get(leader).metres), seconds: Math.round(weights.reduce((a, b) => a + b, 0) * 10) / 10, ...(carriedBy.size ? { carried: Object.fromEntries(carriedBy) } : {}) });
          }
          for (const who of Object.keys(positions)) { const last = run.events.at(-1)?.at?.[who]; if (last && last[0] !== positions[who][0]) log(`on the move: ${who} ends at ${last[0]}, positions say ${positions[who][0]}`); }
        }
        // Departures (the user, 2026-11-03: a group leaving the strand is a fork; "they just run"): whoever's next container
        // in story time is at another place leaves now, running out of the frame toward that place, while the rest stay;
        // their arrival there picks up from where they left. Read from the strands' story order (no cast of its own).
        {
          const leaving = Object.keys(positions).filter(who => !who.startsWith('crowd:') && nextOf.get(`${scene.id}|${who}`) && !nextOf.get(`${scene.id}|${who}`).samePlace);
          if (leaving.length) {
            const event = { id: `leave:${scene.id}`, text: `(${leaving.map(who => names.get(who) ?? who).join('、')} leave)`, actors: leaving, camera: null };
            sceneRecord.departures = [];
            for (const who of leaving) {
              const next = nextOf.get(`${scene.id}|${who}`), box = placeBox.get(script.scenes.find(entry => entry.id === next.id)?.place), here = at(positions[who][0]);
              const toward = box ? [box[0], box[1]] : null, edge = (frameMetres ? frameMetres / 2 : null) ?? measure({ referent: 'the street', of: null, times: 1 }, here) ?? null;
              if (!toward || !edge) continue;
              const d = Math.hypot(toward[0] - here[0], toward[1] - here[2]) || 1, out = Math.min(d, edge), aim = [here[0] + (toward[0] - here[0]) * out / d, here[2] + (toward[1] - here[2]) * out / d];
              const targets = around(aim[0], aim[1], 12).nodes.filter(node => Math.abs(node.y - here[1]) < 1).sort((m, n) => Math.hypot(m.x - aim[0], m.z - aim[1]) - Math.hypot(n.x - aim[0], n.z - aim[1])).slice(0, 8).map(node => node.id);
              const path = targets.length ? walk(scene, `${scene.id}|${who}|leave`, positions[who], targets, 'run') : null;
              if (path && path.length > 1) { E.moves.set(`${scene.id}|${event.id}|${who}`, { person: who, how: 'run', path: [...path], ensemble: [] }); positions[who] = [path.at(-1), positions[who][1]]; }
              sceneRecord.departures.push({ who, to: next.id, ran: !!(path && path.length > 1) });
            }
            if (sceneRecord.departures.some(entry => entry.ran)) { scene.events.push(event); run.events.push({ at: { ...positions } }); await grow(scene, run); }
          }
        }
        // The scene done: the live page written whole (every card so far), so a view loaded now can replay any of them.
        await stream(`scene ${sceneLabel(scene.id)} played`, null, true);
        before = { scene, reads, positions: { ...positions } };
        for (const [who, value] of Object.entries(positions)) { where.set(who, value); lastSceneOf.set(who, scene.id); }
        endOf.set(scene.id, { ...positions });
        const fork = strandScene.get(scene.id)?.fork;
        if (fork) { const inStrand = lastIn.get(fork) ?? lastIn.set(fork, new Map()).get(fork); for (const [who, value] of Object.entries(positions)) inStrand.set(who, value); }
        log(`${scene.id}: ${cards.length} cards, ${sceneRecord.cards.reduce((n, card) => n + card.moves.filter(move => move.moved).length, 0)} moves, ${calls} calls so far`);
        await save();
      }
      // The things placed over the line, for the record.
      // The world's layers as the run left them, and what began, united and changed hands on the way (M17c).
      if (E.layers) record.layers = E.layers.report();
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
        const onNow = OC.occupation({ reading, script: await scriptOf(), strands: strandsNow, pins });
        await writeFile(join(novelDir, 'stage', 'world', 'smoothed', `${id}.json`), JSON.stringify({ version: 1, run: id, ...smoothedNow, onStage: onNow.proposals, on: onNow.on }));
        record.smoothing = { ...(record.smoothing ?? {}), after: { moments: Object.values(smoothedNow.people).reduce((n, list) => n + list.length, 0), revisions: smoothedNow.revisions.length } };
        // The run re-stranded (M17d, restrand.mjs): the groups and envelopes read off where its people stood, against the
        // text's strands; its strands file beside the smoothed positions, for the report and the cross-book registry.
        try {
          const RS = await import('../smoother/restrand.mjs'), again = await RS.restrandRun(novelDir, { run: id, script: await scriptOf(), smoothed: { run: id, ...smoothedNow }, reading, only: record.scenes.map(entry => entry.scene), write: true });
          record.restrand = RS.summary(again.report);
          log(`re-stranded: ${RS.describe(again.report)[0]}`);
        } catch (error) { record.restrand = { error: String(error.message ?? error) }; }
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
      // The review by Jev first (docs/v2/jev-review.md §16): what its policy lets stand is answered as Pi's answers are;
      // the rest stays batched, and only batches with an item left go to the main agent.
      if (reviewer && held.batches?.length) {
        record.review.jev = await JR.reviewHeld(novelDir, { readingPath: reviewer.readingPath, decide: reviewer.decide, work: reviewer.work }).catch(error => ({ error: String(error.message ?? error) }));
        log(`review by Jev: ${JSON.stringify(record.review.jev)}`);
      }
      if (agent && held.batches?.length) record.review.sent = Object.keys(await R.sendToAgent(novelDir, agent.console, { expiresAt: agent.expiresAt })).length;
      log(`review: ${held.held ?? 0} held, ${held.batches?.length ?? 0} batches${agent ? ' sent to the main agent' : ''}`);
      }
    } finally { await chrome.close(); server.server.close(); }
  } });
  // Only the stretches this run played: the gate reads the whole volume, the run plays its range (the pilot's 109 of 346).
  { const played = new Set(record.scenes.map(entry => entry.scene)); record.stretches = record.stretches.filter(stretch => played.has(stretch.scene)); }
  record.finishedAt = new Date().toISOString(); record.calls = calls; record.workflow = desk.summary();
  // The run priced (M12), by the rates per million tokens in stage/director/prices.json ({ jev: { input, output }, work:
  // { input, output }, currency }) where the workspace has them: Jev's tokens as reported, each meter's tokens less the
  // share its cache answered (a cached answer costs nothing). Without rates, the tokens alone.
  const rates = JSON.parse(await readFile(join(out, 'prices.json'), 'utf8').catch(() => 'null'));
  const paid = usage => (usage?.requests ? (usage.requests - (usage.cached ?? 0)) / usage.requests : 0);
  const workCost = usage => (rates?.work && usage ? Math.round(((usage.prompt ?? 0) * rates.work.input + (usage.completion ?? 0) * rates.work.output) * paid(usage) / 1e4) / 100 : null);
  const byPart = { system2: workCost(workMeter?.usage), digest: workCost(digestMeter?.usage), ...Object.fromEntries(Object.entries(meters).map(([id, meter]) => [id, workCost(meter.usage)])), jev: rates?.jev ? Math.round((jevUse.input * rates.jev.input + jevUse.output * rates.jev.output) / 1e4) / 100 : null };
  record.cost = rates ? { currency: rates.currency ?? 'USD', rates, byPart, total: Math.round(Object.values(byPart).reduce((sum, value) => sum + (value ?? 0), 0) * 100) / 100 } : { unpriced: 'no stage/director/prices.json', tokens: { jev: { input: jevUse.input, output: jevUse.output } } };
  record.timing = { seconds: Math.round((performance.now() - runStarted) / 1000), reloads: timing.reloads, reloadSeconds: Math.round(timing.reloadMs / 1000), shots: timing.shots, shotSeconds: Math.round(timing.shotMs / 1000), notShot: timing.skipped, ...(engineCost ? { graphBuilds: engineCost.builds, graphSeconds: Math.round(engineCost.ms / 1000), graphCleared: engineCost.cleared, windowsDropped: engineCost.dropped } : {}) };
  await save();
  // The run's own copies: its record, the laws over it, and the questions Jev was asked in it.
  await writeFile(join(runDir, 'workflow.json'), JSON.stringify(desk.toJSON()));
  await copyFile(join(out, 'run.json'), join(runDir, 'run.json')).catch(() => {});
  const lawsNow = JSON.parse(await readFile(join(out, 'laws.json'), 'utf8').catch(() => 'null'));
  if (lawsNow?.run === runId) await writeFile(join(runDir, 'laws.json'), JSON.stringify(lawsNow, null, 1));
  const framesNow = (await readFile(framesFile, 'utf8').catch(() => '')).split('\n').filter(Boolean);
  if (framesNow.length > framesBefore) await writeFile(join(runDir, 'frames.jsonl'), framesNow.slice(framesBefore).join('\n') + '\n');
  await writeFile(join(runDir, 'index.json'), JSON.stringify({ version: 1, run: runId, from, to, model: jev.modelId, startedAt: record.startedAt, finishedAt: record.finishedAt, calls,
    files: { record: 'run.json', laws: 'laws.json', log: 'run.log', pins: 'pins.json', frames: 'frames.jsonl', page: `../../../simulation/runs/director/${runId}.page.json`, worldLog: `../../../world/log/${runId}.jsonl`, ledger: `../../../world/ledger/${runId}.jsonl`, smoothed: `../../../world/smoothed/${runId}.json`, restrand: `../../../world/restrand/${runId}.json`, canon: '../../../world/canon.jsonl', pool: '../../../world/pool.jsonl', answers: '../../../world/answers.jsonl' } }, null, 1));
  log(`run ${runId} done: ${calls} calls; its records in stage/director/runs/${runId}/`);
  return { record, ...result };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, budget: { type: 'string' }, 'stand-in': { type: 'boolean' }, live: { type: 'boolean' }, pace: { type: 'string' }, agent: { type: 'string' }, 'no-digest': { type: 'boolean' }, 'no-speakers': { type: 'boolean' }, 'live-test': { type: 'boolean' }, 'no-prefilm': { type: 'boolean' }, 'no-faculties': { type: 'boolean' }, 'from-last': { type: 'boolean' }, 'discard-edits': { type: 'boolean' }, 'keep-edits': { type: 'boolean' }, 'no-snapshots': { type: 'boolean' }, 'no-jev-review': { type: 'boolean' } } });
  // The universe's snapshots (src/ground/workspace/universe.ts; the user, 2026-11-05: "rerunning a previous volume returns to
  // the snapshot before that volume to recover clean status"). In a library, a book's first run is preceded by its `before`
  // snapshot; a rerun starts from that `before` (W11 had started on W10's smoothing, and played worse for it), unless
  // --from-last asks for a second pass on the last run. What changed since the book's last snapshot (an unfinished run, or
  // edits by hand) is never dropped silently: --discard-edits drops it (a guard snapshot still holds it), --keep-edits
  // makes it the new `before`. After the run, its result is snapshotted (`after`), ready for novel universe export.
  const U = await load('dist/src/ground/workspace/universe.js'), library = novelDir ? U.libraryOf(resolve(novelDir)) : null;
  // A library's book reads its own reading (vol-<n>/reading/data.json) when none is named.
  if (!values.reading && library?.book && existsSync(U.libraryPaths(library.root).book(library.book).reading.data)) values.reading = U.libraryPaths(library.root).book(library.book).reading.data;
  if (!novelDir || !values.reading || !values.from || !values.to) { console.error('usage: node world-engine/director/director.mjs <novel-dir> --reading <data.json> --from <scene> --to <scene> [--budget 60] [--stand-in] [--live] [--from-last] [--discard-edits|--keep-edits] [--no-snapshots]'); process.exit(2); }
  let before = null;
  if (library?.book && !values['no-snapshots']) {
    const book = library.book;
    before = await U.latestSnapshot(library.root, { book, kind: 'before' });
    // At a snapshot (any: a restore by hand leaves it at an older one) nothing is lost; else what changed since the last.
    const at = before ? await U.matchingSnapshot(library.root) : null, last = before && !at ? await U.latestSnapshot(library.root, { book, not: ['guard'] }) : null;
    const changed = last ? await U.changesSince(library.root, last.id) : [];
    if (changed.length && values['keep-edits']) {
      before = await U.takeSnapshot(library.root, { book, kind: 'before', parent: before.id, why: `edits kept for ${book}'s reruns: ${changed.slice(0, 6).map(entry => entry.path.replace(`${book}/novel/`, '')).join(', ')}${changed.length > 6 ? ` and ${changed.length - 6} more` : ''}` });
      console.error(`snapshot ${before.id}: the edits since ${last.id} kept; ${book}'s reruns start here`);
    } else if (changed.length && !values['discard-edits'] && !values['from-last']) {
      console.error(`${book} changed since its snapshot ${last.id} (an unfinished run, or edits): ${changed.length} files, ${changed.slice(0, 8).map(entry => `${entry.path} (${entry.change})`).join(', ')}${changed.length > 8 ? ' …' : ''}`);
      console.error('  --keep-edits makes them the start of this and later reruns; --discard-edits starts from the clean snapshot (a guard snapshot keeps them); --from-last plays on from them');
      process.exit(2);
    }
    if (!before) { before = await U.takeSnapshot(library.root, { book, kind: 'before', why: `before ${book}'s first run` }); console.error(`snapshot ${before.id}: ${book} before its first run`); }
    else if (values['from-last']) console.error(`--from-last: ${book} plays on from where its last run left it (a second pass), not from ${before.id}`);
    else {
      const restored = await U.restoreSnapshot(library.root, before.id, { why: `a rerun of ${book}` });
      console.error(`restored ${before.id}: ${restored.written} files written, ${restored.removed} set aside${restored.guard ? ` (what it replaced is ${restored.guard})` : ''}`);
    }
  }
  const reading = JSON.parse(await readFile(values.reading, 'utf8'));
  let jev = standIn();
  if (!values['stand-in']) {
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
    // The cache hides the client's `usage` (what Jev reports of each request): carried on, so the run meters Jev's tokens.
    const client = jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL });
    jev = Object.assign(cachedDecisions(client, join(resolve(novelDir), 'stage', 'director', 'cache')), { usage: client.usage });
  }
  // The review by Jev after the run (§16): Jev as it is here, before the live view wraps it; never on a stand-in run.
  const reviewJev = values['stand-in'] || values['no-jev-review'] ? null : jev;
  // System 2's work model (WORK_LLM_*), cached as Jev is; without one, system 2 is off and says so.
  let workModel = null;
  if (!values['stand-in'] && process.env.WORK_LLM_API_KEY) {
    const { workModelFromEnv } = await load('dist/src/ground/connectors/workModel.js'), { cachedWork } = await load('dist/src/digger/timeplace/cache.js');
    workModel = cachedWork(workModelFromEnv(process.env), join(resolve(novelDir), 'stage', 'director', 'cache-work'));
  } else if (!values['stand-in']) console.error('system 2 off: no work model configured (WORK_LLM_API_KEY)');
  let live = null;
  // A stand-in run never writes a book's live view (its answers are made by rule), except, asked for by name, on a private
  // copy for checking the view itself (--live-test).
  if (values.live && values['stand-in'] && !values['live-test']) { console.error('a stand-in run does not write the live view (its answers are made by rule); --live-test on a private copy only'); process.exit(2); }
  if (values.live) { const { createLive } = await import('../live/sim-jev.mjs'); live = await createLive(resolve(novelDir), { command: 'sim direct', lines: [{ id: 'director', title: 'The director: cards played forward' }], model: jev.modelId }); jev = Object.assign(live.watch(jev), { usage: jev.usage }); }
  try {
    // --agent <host state dir>: the main agent's console (Pi, through the host's queue) the held batches are sent to.
    const agentLinks = values.agent ? JSON.parse(await readFile(join(resolve(values.agent), 'links.json'), 'utf8').catch(() => '{}')) : null;
    const agent = values.agent ? { console: join(resolve(values.agent), 'runtime', 'pi-console'), expiresAt: agentLinks?.expiresAt ? Date.parse(agentLinks.expiresAt) || agentLinks.expiresAt : Date.now() + 3600_000 } : null;
    // The pre-film casts' notes the reading step made (experiments/v2/prefilm.mjs), beside the reading.
    const prefilm = values['no-prefilm'] || values['no-faculties'] ? null : await (await import('../digest/prefilm.mjs')).loadPrefilm(dirname(resolve(values.reading)));
    if (prefilm) console.error(`pre-film casts' notes from the reading step: ${Object.keys(prefilm.units ?? {}).length} units${prefilm.standIn ? ' (made by a stand-in)' : ''}`);
    const reviewer = reviewJev ? { decide: (state, questions) => reviewJev.decide(state, questions), work: workModel, readingPath: resolve(values.reading) } : null;
    const { record } = await direct(resolve(novelDir), { reading, readingPath: values.reading, prefilm, agent, reviewer, digest: !values['no-digest'], speakers: !values['no-speakers'], from: values.from, to: values.to, jev, workModel, budget: values.budget ? Number(values.budget) : Infinity, live, pace: values.pace ? Number(values.pace) : values.live ? 6 : 0 });
    if (library?.book && !values['no-snapshots']) {
      const run = `d${String(record.startedAt).replace(/\D/g, '').slice(0, 14)}`, mode = values['stand-in'] ? 'a stand-in run' : values['from-last'] ? 'a second pass' : 'a run';
      const after = await U.takeSnapshot(library.root, { book: library.book, kind: 'after', run, parent: before?.id ?? null, why: `${mode} of ${library.book}, ${values.from} to ${values.to}` });
      console.error(`snapshot ${after.id}: what ${run} left (novel universe export ${library.root} ${after.id} <out.tgz> shares it)`);
    }
    const moves = record.scenes.flatMap(scene => scene.cards.flatMap(card => card.moves));
    const second = record.scenes.flatMap(scene => [...(scene.system2 ?? []), ...scene.cards.flatMap(card => card.system2 ?? [])]);
    console.error(`system 2: ran on ${second.length} answers, the work model's used for ${second.filter(entry => entry.used === 'work').length}, differing from Jev's on ${second.filter(entry => entry.work && String(entry.work.value) !== String(entry.jev.value)).length}`);
    console.log(JSON.stringify({ calls: record.calls, scenes: record.scenes.length, cards: record.scenes.reduce((n, scene) => n + scene.cards.length, 0), moved: moves.filter(move => move.moved).length, stayed: moves.filter(move => move.direction === 'stays').length, unmoved: moves.filter(move => move.moved === false && move.direction !== 'stays').length }));
    await live?.finish('done');
  } catch (error) { await live?.finish('failed', { error: String(error?.message ?? error).slice(0, 300) }); throw error; }
}
