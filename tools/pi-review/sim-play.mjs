import { createHash } from 'node:crypto';
import { appendFile, mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo } from './config.mjs';

/**
 * The stage simulation player, served by the host: the engine's own page
 * (world-engine/view/strand-demo.html) with a book's accepted runs inlined, the way
 * the exporter builds a page (inlineStrand), and three.js served beside it
 * from the app's own copy, so nothing loads from a CDN. Read-only: runs are
 * made by `novel sim run`; this only plays what stage/simulation/ keeps.
 */
const runFile = /^runs\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.page\.json$/;
const strandId = /^[A-Za-z0-9_-]+$/;

/**
 * A book's runs that can be played (those kept with the player's data), in the index's order: each line's accepted run, or
 * with `newest` its latest run (labelled when it is not the accepted one).
 */
export async function playableRuns(workspace, { newest = false } = {}) {
  const folder = resolve(workspace, 'stage', 'simulation');
  const index = await readFile(resolve(folder, 'index.json'), 'utf8').then(JSON.parse, () => null);
  const runs = [];
  for (const [id, entry] of Object.entries(index?.strands ?? {})) {
    const kept = Array.isArray(entry?.runs) ? newest ? entry.runs.findLast(run => run.page) : entry.runs.find(run => run.id === entry.accepted) : null;
    if (!strandId.test(id) || !kept?.page || !runFile.test(kept.page)) continue;
    const data = await readFile(resolve(folder, kept.page), 'utf8').then(JSON.parse, () => null);
    if (data) runs.push({ id, label: `${entry.title ?? id} · ${kept.scenes} scene${kept.scenes === 1 ? '' : 's'}${kept.id === entry.accepted ? '' : ' · newest run, not accepted'}`, name: entry.title ?? id, data, run: kept.id });
  }
  return runs;
}

/**
 * The Content-Security-Policy for a page that admits exactly its own inline scripts, by hash (a JSON data block is never run).
 * `framed`: the page may be framed by this same origin (the live player inside the world view), by nothing else.
 */
export function pagePolicy(html, { framed = false } = {}) {
  const hashes = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  return `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors ${framed ? "'self'" : "'none'"}; base-uri 'none'`;
}

/**
 * The player page for a book's runs (accepted, or with `newest` the latest), or null when it has none; with the
 * Content-Security-Policy that admits exactly its inline scripts. `live`: a link to the live page, shown on the player.
 */
export async function simulationPage(workspace, { title = 'Simulation', newest = false, live = null } = {}) {
  const runs = await playableRuns(workspace, { newest });
  if (!runs.length) return null;
  const { inlineStrand } = await import(pathToFileURL(`${repo}/world-engine/world/export-strand-demo.mjs`).href);
  const template = await readFile(`${repo}/world-engine/view/strand-demo.html`, 'utf8');
  let html = inlineStrand(template, { strands: runs.map(({ id, label, name, data }) => ({ id, label, name, data })) }, { name: title, vendor: true });
  if (live) {
    const running = (await liveState(workspace)).status === 'running';
    html = html.replace('</body>', `<a href="${live}" style="position:fixed;right:12px;bottom:12px;z-index:50;padding:6px 12px;border-radius:99px;background:#0d1822e6;border:1px solid ${running ? '#7dffa4' : '#1d3242'};color:${running ? '#7dffa4' : '#d8e6ef'};font:13px -apple-system,sans-serif;text-decoration:none">${running ? '● Jev is picking: watch live' : 'Replay Jev\'s picks'}</a></body>`);
  }
  return { html, policy: pagePolicy(html), runs: runs.map(({ id, run }) => ({ id, run })) };
}

/** three.js for the player, from the app's own dependency: only the files the page imports (world-engine/live/sim-jev.mjs names them). */
export async function simulationVendor(file) {
  const { VENDOR_FILES } = await import(pathToFileURL(`${repo}/world-engine/live/sim-jev.mjs`).href);
  const path = Object.hasOwn(VENDOR_FILES, file) ? VENDOR_FILES[file] : null;
  return path ? readFile(`${repo}/${path}`) : null;
}

/**
 * The live page: what a book's running `novel sim pick|run` is doing, and a replay of every question Jev was asked with its
 * pictures and answers (world-engine/live/sim-jev.mjs records them). Static: it reads live.json and the recording beside it.
 */
export async function simulationLivePage() {
  const html = await readFile(new URL('./sim-live.html', import.meta.url), 'utf8');
  // Framed by World · Live (its Jev debugger panel), by this same origin only.
  return { html, policy: pagePolicy(html, { framed: true }) };
}

/**
 * The live view of the world: the engine's world as it stands at the moment being played (chunks, buildings and what is broken,
 * everyone's place, the moment's moves, where Jev looks), drawn round where Jev looks and where the people are. Static: it
 * reads live/world.json and live.json.
 */
export async function simulationWorldPage() {
  const html = await readFile(new URL('./sim-world.html', import.meta.url), 'utf8');
  return { html, policy: pagePolicy(html) };
}

/**
 * The player in live mode (play/now): the engine's own page with the line as far as the moment being played (live/page.json),
 * which it plays and holds, drawn round where Jev looks and the people; the world view swaps these in as the moments come.
 * Null before any page.
 */
export async function simulationNowPage(workspace) {
  const page = await readFile(resolve(workspace, 'stage', 'simulation', 'live', 'page.json'), 'utf8').then(JSON.parse, () => null);
  if (!page) return null;
  const { inlineStrand } = await import(pathToFileURL(`${repo}/world-engine/world/export-strand-demo.mjs`).href);
  const template = await readFile(`${repo}/world-engine/view/strand-demo.html`, 'utf8');
  const html = inlineStrand(template, page, { name: 'World · now', vendor: true });
  return { html, policy: pagePolicy(html, { framed: true }), run: page.live?.run ?? null };
}

/** The world as the running command last stood it (live/world.json), or 'null' before any. */
export async function liveWorld(workspace) {
  return readFile(resolve(workspace, 'stage', 'simulation', 'live', 'world.json'), 'utf8').catch(() => 'null');
}

/** How long a running command may go without a word before it counts as stopped (a Jev call never takes this long). */
const SILENT = 20 * 60000;
const alive = pid => { if (!Number.isSafeInteger(pid) || pid <= 0) return false; try { process.kill(pid, 0); return true; } catch (error) { return error.code === 'EPERM'; } };

/** A book's live record as the live page reads it ({ status: 'idle' } before any command): a running command whose process is gone, or silent too long, is stopped. */
export async function liveState(workspace) {
  const state = await readFile(resolve(workspace, 'stage', 'simulation', 'live.json'), 'utf8').then(JSON.parse, () => null);
  if (!state || typeof state !== 'object') return { status: 'idle' };
  if (state.status === 'running' && (!alive(state.pid) || Date.now() - Date.parse(state.updatedAt) > SILENT)) state.status = 'stopped';
  delete state.pid;
  return state;
}

/** The recording's frames (JSON lines), or '' before any. */
export async function liveFrames(workspace) {
  return readFile(resolve(workspace, 'stage', 'simulation', 'live', 'frames.jsonl'), 'utf8').catch(() => '');
}

/** One recorded picture (frames/<frame>-<n>.jpg|png), or null. */
const framePicture = /^frames\/\d{1,7}-[0-3]\.(jpg|png)$/;
export async function livePicture(workspace, file) {
  if (!framePicture.test(file)) return null;
  const body = await readFile(resolve(workspace, 'stage', 'simulation', 'live', file)).catch(() => null);
  return body && { body, type: file.endsWith('.jpg') ? 'image/jpeg' : 'image/png' };
}

/**
 * Terrain spawning's step (world-engine/terrain/terrain-spawn.mjs; docs/v3/design.html#visual-context-engine), from World · Live: `step` lets
 * a run waiting after a proposal go on by one, `run` lets it run on, `pause` makes it wait again after each proposal.
 */
export async function terrainStep(workspace, mode) {
  if (!['step', 'run', 'pause'].includes(mode)) return null;
  const file = resolve(workspace, 'stage', 'terrain', 'step.json');
  const step = await readFile(file, 'utf8').then(JSON.parse, () => ({ mode: 'step', n: 0 }));
  if (mode === 'step') step.n = (step.n ?? 0) + 1; else step.mode = mode === 'run' ? 'run' : 'step';
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(step), { mode: 0o644 });
  await rename(temporary, file);
  return step;
}

/**
 * Notes on the director's cards, shared by the reader and the developer (the user, 2026-11-02: a frontend we both use, so
 * whatever goes wrong is easily spotted): World · Live's reader adds one to the card it is on (what looks wrong and where),
 * and lists them; the developer reads stage/director/notes.jsonl. Only notes are written here, never a run's data.
 */
const notesFile = workspace => resolve(workspace, 'stage', 'director', 'notes.jsonl');
const clip = (value, length) => (typeof value === 'string' ? value.slice(0, length) : null);
export async function directorNotes(workspace) {
  const text = await readFile(notesFile(workspace), 'utf8').catch(() => '');
  return text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }).slice(-500);
}
export async function addDirectorNote(workspace, body) {
  const text = clip(body?.text, 2000)?.trim(), card = clip(body?.card, 120);
  if (!text || !card) return null;
  const note = { at: new Date().toISOString(), card, scene: clip(body.scene, 40), event: Number.isInteger(body.event) ? body.event : null, sentence: clip(body.sentence, 40), time: typeof body.time === 'number' && Number.isFinite(body.time) ? Math.round(body.time * 100) / 100 : null, text };
  await mkdir(resolve(workspace, 'stage', 'director'), { recursive: true });
  await appendFile(notesFile(workspace), `${JSON.stringify(note)}\n`, { mode: 0o644 });
  return note;
}
/**
 * The story sky (world-engine/digest/sky.mjs; experiments/v2/sky.mjs: sky.json beside the reading the run played): each
 * unit's time of day, hour, weather and lying snow, for the world's look. Null before the step has run.
 */
export async function directorSky(workspace) {
  // Beside the reading the run played, else the book's own reading (a library's vol-<n>/reading).
  const at = await readFile(resolve(workspace, 'stage', 'director', 'reading-path.json'), 'utf8').then(JSON.parse, () => null);
  const read = path => readFile(path, 'utf8').then(JSON.parse, () => null);
  const sky = (at?.path ? await read(resolve(at.path, '..', 'sky.json')) : null) ?? await read(resolve(workspace, '..', 'reading', 'sky.json'));
  return skyView(sky);
}
/** A sky.json as World · Live reads it (also the replay io's, experiments/v2/replay-io.mjs), or null. */
export function skyView(sky) {
  return sky ? { units: Object.fromEntries(Object.entries(sky.units ?? {}).map(([id, unit]) => [id, { daypart: unit.daypart?.value ?? null, hour: unit.hour ?? null, weather: unit.weather?.value ?? null, strength: unit.weather?.strength ?? null, wind: unit.weather?.wind ?? null, sure: unit.weather?.sure ?? 0, lying: !!unit.lying, ...(unit.cloudCut ? { cloudCut: unit.cloudCut } : {}) }])) } : null;
}

/**
 * The book's album as World · Live shows it (the user, 2026-11-05: "the picture detection and portrait system never wired
 * in in v2"): its pictures on their sentences (src/v2/album.ts) and each character's bound portrait (album.mjs, which
 * serves only the files its records list). Ids only: the images come from api/album-asset.
 */
export async function directorAlbum(workspace) {
  const { albumProjection } = await import('./album.mjs');
  const rows = (await readFile(resolve(workspace, 'ontology', 'entities.jsonl'), 'utf8').catch(() => '')).split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
  const labels = new Map();
  for (const entity of rows) if (entity?.kind === 'Character' && typeof entity.id === 'string') labels.set(entity.id, (entity.names?.find(name => name?.kind === 'canonical') ?? entity.names?.[0])?.text ?? entity.id);
  const view = await albumProjection(workspace, labels);
  return { pictures: view.pictures.map(({ id, kind, sentenceId, sceneId }) => ({ id, kind, sentenceId, sceneId: sceneId ?? null })), portraits: view.portraits.map(({ id, entityId, entityLabel }) => ({ id, entityId, entityLabel })) };
}
/** The reading as the reader shows it (stage/director/reading.json: kinds, detected names and what they mean); null before a run. */
export async function directorReading(workspace) {
  return readFile(resolve(workspace, 'stage', 'director', 'reading.json'), 'utf8').then(JSON.parse, () => null);
}

/**
 * What the laws, system 2, the ledger and the review made of the director's last run (Track B W7), for World · Live's
 * Why: per card, the laws' verdicts, system 2's answers beside Jev's, the card's proposals to the ontology and the review's
 * items with the main agent's answers; the run's report (laws by verdict, proposals by state, the review, canon's
 * writes, the revisions); and the lines whose speaker the world changed. Read-only.
 */
export async function directorReview(workspace) {
  const dir = resolve(workspace), json = (...path) => readFile(resolve(dir, ...path), 'utf8').then(JSON.parse, () => null);
  const lines = (...path) => readFile(resolve(dir, ...path), 'utf8').then(text => text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }), () => []);
  const [record, index] = await Promise.all([json('stage', 'director', 'run.json'), json('stage', 'simulation', 'index.json')]);
  if (!record) return null;
  const run = index?.strands?.director?.accepted ?? null;
  const [ledger, pool, answers, canon, pins, smoothed] = await Promise.all([run ? lines('stage', 'world', 'ledger', `${run}.jsonl`) : [], lines('stage', 'world', 'pool.jsonl'), lines('stage', 'world', 'answers.jsonl'), lines('stage', 'world', 'canon.jsonl'), json('stage', 'world', 'pins.json'), run ? json('stage', 'world', 'smoothed', `${run}.json`) : null]);
  // Each card's smoothed moments (W5b): per person, how wide their cloud is and how far the least-action history moves them.
  const cloudsAt = new Map();
  for (const [who, list] of Object.entries(smoothed?.people ?? {})) for (const moment of list) { const key = `${moment.scene}|${moment.card ?? 'start'}`; (cloudsAt.get(key) ?? cloudsAt.set(key, []).get(key)).push({ who, rank: moment.rank, spread: moment.spread, shift: moment.shift, cloud: moment.cloud.length, points: moment.cloud.map(spot => ({ x: spot.x, y: spot.y, z: spot.z, w: spot.w })), played: { x: moment.played.x, y: moment.played.y, z: moment.played.z }, map: { x: moment.map.x, y: moment.map.y, z: moment.map.z } }); }
  const items = [...new Map(pool.map(item => [item.id, item])).values()], answerOf = new Map(answers.map(answer => [answer.item, answer]));
  const reviewOf = item => ({ kind: item.kind, question: item.question, options: item.options, status: item.status, ...(item.note ? { note: item.note } : {}), ...(answerOf.get(item.id) ? { answer: answerOf.get(item.id).verdict, reason: answerOf.get(item.id).reason, at: answerOf.get(item.id).at, by: answerOf.get(item.id).by ?? 'pi', ...(typeof answerOf.get(item.id).confidence === 'number' ? { confidence: answerOf.get(item.id).confidence } : {}) } : {}) });
  const cards = {};
  for (const scene of record.scenes) for (const card of scene.cards) {
    const ids = new Set(card.lines?.map(line => line.id) ?? []);
    const proposals = ledger.filter(entry => entry.value?.card === card.card && entry.value?.scene === scene.scene || String(entry.value?.what ?? '').startsWith(`${scene.scene} · ${card.card}`) || [...ids].some(id => String(entry.value?.what ?? '') === `${scene.scene} · ${id}`)).map(entry => ({ kind: entry.kind, state: entry.state, law: entry.law ?? null, subject: entry.subject ?? null, why: entry.value?.why ?? entry.value?.verdict ?? null }));
    const review = items.filter(item => item.scene === scene.scene && ((item.cards ?? []).includes(card.card) || (item.lines ?? []).some(id => ids.has(id)) || item.card === card.card)).map(reviewOf);
    const clouds = [...(cloudsAt.get(`${scene.scene}|${card.card}`) ?? []), ...(scene.cards[0] === card ? (cloudsAt.get(`${scene.scene}|start`) ?? []).map(entry => ({ ...entry, start: true })) : [])];
    if (card.laws?.length || card.system2?.length || card.talk || proposals.length || review.length || clouds.length) cards[`${scene.scene}|${card.card}`] = { laws: card.laws ?? [], system2: card.system2 ?? [], talk: card.talk ?? null, proposals, review, clouds };
  }
  const count = (rows, key) => rows.reduce((sum, row) => ({ ...sum, [key(row)]: (sum[key(row)] ?? 0) + 1 }), {});
  const laws = record.scenes.flatMap(scene => [...(scene.laws ?? []), ...scene.cards.flatMap(card => card.laws ?? [])]);
  const speakers = {};
  // Lines whose speaker the world settled where the reading was unsure (W6), and those the review settled or ruled out.
  for (const [line, entry] of Object.entries((await json('stage', 'world', 'speakers.json'))?.lines ?? {})) speakers[line] = { from: null, to: entry.who, by: entry.by === 'review' ? 'the review' : 'the world' };
  for (const [line, who] of Object.entries(pins?.notSpeaker ?? {})) speakers[line] = { from: who, to: speakers[line]?.to ?? null, by: 'the review' };
  const report = {
    run, model: record.model, from: record.from, to: record.to, startedAt: record.startedAt, finishedAt: record.finishedAt ?? null, calls: record.calls ?? null,
    laws: count(laws, law => `${law.law} ${law.verdict}`),
    system2: { ran: record.scenes.reduce((n, scene) => n + (scene.system2?.length ?? 0) + scene.cards.reduce((m, card) => m + (card.system2?.length ?? 0), 0), 0), used: record.scenes.reduce((n, scene) => n + [...(scene.system2 ?? []), ...scene.cards.flatMap(card => card.system2 ?? [])].filter(entry => entry.used === 'work').length, 0) },
    proposals: count(ledger, entry => `${entry.kind} ${entry.state}`),
    review: { ...count(items, item => item.status), answered: answers.length, held: record.review?.held ?? null, applied: record.review?.applied ?? null },
    canon: record.review?.canon ?? null, canonWrites: canon.filter(entry => entry.run === run && !entry.undo).length,
    revisions: (record.revisions ?? []).map(revision => ({ who: revision.who, scene: revision.scene, metres: revision.metres ?? null, applied: !!revision.applied })),
    world: record.scenes.flatMap(scene => (scene.world ?? []).map(issue => ({ scene: scene.scene, code: issue.code, name: issue.name }))),
    smoothing: smoothed ? { moments: Object.values(smoothed.people).reduce((n, list) => n + list.length, 0), revisions: smoothed.revisions.length, meanSpread: (() => { const all = Object.values(smoothed.people).flat(); return all.length ? Math.round(all.reduce((sum, moment) => sum + moment.spread, 0) / all.length * 10) / 10 : null; })(), onStage: (smoothed.onStage ?? []).length, started: record.smoothing ?? null } : null,
  };
  return { version: 1, run, cards, report, speakers };
}

/**
 * Developer mode (the user, 2026-11-02: like the blinking-observation figure of the research handoff, what is smoothed
 * beside what the data were, and as much record as possible): everything recorded about one card of the last director
 * run. Its record and its scene's (starts, who was carried or spawned, the laws, the world's own check), the world log's
 * and the ledger's rows for the scene, the review's items and answers, each person's smoothed moments in the scene (where
 * played, how trusted, the couplings, the cloud, the least-action spot), how likely each is on the stage, what canon
 * took from the scene, the notes on the card, and the run's archived files. Read only.
 */
const RUN_FILES = { record: 'run.json', laws: 'laws.json', log: 'run.log', pins: 'pins.json', frames: 'frames.jsonl' };
export async function directorDev(workspace, { scene, card }) {
  const dir = resolve(workspace), json = (...path) => readFile(resolve(dir, ...path), 'utf8').then(JSON.parse, () => null);
  const lines = (...path) => readFile(resolve(dir, ...path), 'utf8').then(text => text.split('\n').filter(Boolean).flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } }), () => []);
  const index = await json('stage', 'simulation', 'index.json'), run = index?.strands?.director?.accepted ?? null;
  const record = (run ? await json('stage', 'director', 'runs', run, 'run.json') : null) ?? await json('stage', 'director', 'run.json');
  if (!record || !scene) return null;
  const sceneRecord = record.scenes.find(entry => entry.scene === scene) ?? null, cardRecord = sceneRecord?.cards.find(entry => entry.card === card) ?? null;
  const [log, ledger, pool, answers, smoothed, canon, notes, archive] = await Promise.all([run ? lines('stage', 'world', 'log', `${run}.jsonl`) : [], run ? lines('stage', 'world', 'ledger', `${run}.jsonl`) : [], lines('stage', 'world', 'pool.jsonl'), lines('stage', 'world', 'answers.jsonl'), run ? json('stage', 'world', 'smoothed', `${run}.json`) : null, lines('stage', 'world', 'canon.jsonl'), directorNotes(dir), run ? json('stage', 'director', 'runs', run, 'index.json') : null]);
  const inScene = row => row.scene === scene || row.value?.scene === scene || String(row.value?.what ?? '').startsWith(`${scene} `) || (row.value?.scenes ?? []).includes(scene);
  const answerOf = new Map(answers.map(answer => [answer.item, answer]));
  const people = Object.fromEntries(Object.entries(smoothed?.people ?? {}).map(([who, list]) => [who, (list ?? []).filter(moment => moment?.scene === scene)]).filter(([, list]) => list.length));
  const { cards: _cards, ...sceneOnly } = sceneRecord ?? {};
  return {
    version: 1, run, scene, card,
    cardRecord, sceneRecord: sceneRecord ? sceneOnly : null,
    worldLog: log.filter(row => row.scene === scene), ledger: ledger.filter(inScene),
    review: [...new Map(pool.map(item => [item.id, item])).values()].filter(item => item.scene === scene).map(item => ({ ...item, answer: answerOf.get(item.id) ?? null })),
    smoothing: smoothed ? { people, drive: Object.fromEntries(Object.keys(people).map(who => [who, smoothed.drive?.[who] ?? null])), on: Object.fromEntries(Object.entries(smoothed.on ?? {}).filter(([, byScene]) => scene in byScene).map(([who, byScene]) => [who, byScene[scene]])), chains: Object.fromEntries(Object.keys(people).map(who => [who, smoothed.chains?.[who] ?? null])) } : null,
    canon: canon.filter(entry => entry.run === run && !entry.undo && (entry.id === scene || String(entry.id).includes(scene) || String(entry.why ?? '').includes(scene))),
    notes: notes.filter(note => note.scene === scene && (!card || note.card === card)),
    // The run's files that are there (a run from before runs kept their own has none of its own).
    files: archive ? (await Promise.all(Object.entries({ ...RUN_FILES, ...archive.files }).map(async ([name, relative]) => ((await stat(resolve(dir, 'stage', 'director', 'runs', run, relative)).catch(() => null)) ? name : null)))).filter(Boolean) : [],
  };
}

/** One of the last run's records as kept (developer mode's Run files): its name in the run's index, or null. */
export async function directorFile(workspace, name) {
  const dir = resolve(workspace), index = JSON.parse(await readFile(resolve(dir, 'stage', 'simulation', 'index.json'), 'utf8').catch(() => 'null')), run = index?.strands?.director?.accepted;
  if (!run || !/^[a-zA-Z]{1,20}$/.test(name)) return null;
  const runDir = resolve(dir, 'stage', 'director', 'runs', run), archive = JSON.parse(await readFile(resolve(runDir, 'index.json'), 'utf8').catch(() => 'null'));
  const relative = archive?.files?.[name] ?? RUN_FILES[name];
  if (!relative) return null;
  const path = resolve(runDir, relative);
  if (!path.startsWith(resolve(dir, 'stage') + '/')) return null;
  const body = await readFile(path).catch(() => null);
  return body ? { body, type: path.endsWith('.log') ? 'text/plain; charset=utf-8' : path.endsWith('.jsonl') ? 'application/x-ndjson; charset=utf-8' : 'application/json; charset=utf-8', name: `${run}-${relative.split('/').pop()}` } : null;
}
