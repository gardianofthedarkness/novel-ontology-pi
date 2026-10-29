/**
 * Jev's answers for the stage simulation, as `novel sim pick` asks them, and what a running `novel sim pick|run` is doing,
 * for the host's live page.
 *
 * pickStrand: one story line's page (the engine's player, inlined) in capture mode in headless Chrome, served on loopback
 * with three.js beside it, and Jev's choices on pictures of it (playground/two-view-things.mjs, playground/impact-choices.mjs):
 * which model each thing is drawn as, where each placement stands, where each fight hits and how big. Every answer is saved
 * as it comes (stage/thing-boxes.json, stage/impacts.json, which the engine reads) and reused while what it was asked from
 * stays the same, so a stopped pick continues.
 *
 * createLive: what a running command is doing (stage/simulation/live.json) and a recording of every question Jev was asked
 * and what each answer made, with their pictures (stage/simulation/live/), which the host's play/live page shows live or
 * replays. Nothing reads them back. Derived view data like the runs, private with the book.
 */
import { access, copyFile, mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inlineStrand, runStrand } from './export-strand-demo.mjs';
import { pickImpacts, SIZES } from './impact-choices.mjs';
import { browser, CHROME, pickModels, placeThings, serve } from './two-view-things.mjs';

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

/**
 * Jev's answers for one story line (`strand`: from, to, fork, as runStrand takes it): the model of every thing on it, then
 * its placements, then its fights. Questions stop being started once `budget` calls are spent. The page is made again after
 * models are picked (so ghosts take their shape) and after placements (so fights are seen with the things where Jev put
 * them). Returns the calls made and, per kind, what was asked, reused and left.
 */
export async function pickStrand(novelDir, strand, { jev, budget = Infinity, live = null, log = () => {} }) {
  await access(CHROME).catch(() => { throw new Error(`The pictures Jev answers on are drawn by Google Chrome, headless, which is not at ${CHROME} (NOVEL_CHROME names another).`); });
  const work = await mkdtemp(join(tmpdir(), 'sim-pick-'));
  const template = await readFile(join(repository, 'playground', 'strand-demo.html'), 'utf8');
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  const boxesFile = join(novelDir, 'stage', 'thing-boxes.json'), impactsFile = join(novelDir, 'stage', 'impacts.json');
  const boxes = JSON.parse(await readFile(boxesFile, 'utf8').catch(() => 'null')) ?? {};
  const models = { ...(boxes.models ?? {}) }, placements = { ...(boxes.placements ?? {}) };
  const fights = { ...(JSON.parse(await readFile(impactsFile, 'utf8').catch(() => 'null'))?.fights ?? {}) };
  const saveBoxes = () => replace(boxesFile, JSON.stringify({ ...boxes, version: 1, model: jev.modelId, askedAt: new Date().toISOString(), models, placements }, null, 1));
  const saveImpacts = () => replace(impactsFile, JSON.stringify({ version: 1, model: jev.modelId, askedAt: new Date().toISOString(), sizes: SIZES, fights }, null, 1));
  await writeFile(join(work, 'index.html'), '');
  const { server, url } = await serve(join(work, 'index.html'), join(work, 'vendor'));
  const chrome = await browser();
  // A stopped command (Pi's runner stops one at its deadline) takes its browser with it.
  const stop = () => void chrome.close().finally(() => process.exit(143));
  process.once('SIGTERM', stop);
  // The line as the engine makes it now, with every answer so far, in capture mode.
  const load = async () => {
    await writeFile(join(work, 'index.html'), inlineStrand(template, await runStrand(novelDir, strand), { vendor: true }));
    await chrome.evaluate('delete window.__stage').catch(() => {});
    await chrome.open(url);
    return chrome.evaluate('({ things: window.__stage.things, places: window.__stage.places, scenes: window.__stage.scenes, fights: window.__stage.fights })');
  };
  // The live record: pictures re-encoded small by the page, and a picture of what each answer made.
  live?.encoder(png => chrome.evaluate(`(async () => { const image = new Image(); image.src = 'data:image/png;base64,${png}'; await image.decode(); const canvas = document.createElement('canvas'); canvas.width = image.naturalWidth; canvas.height = image.naturalHeight; canvas.getContext('2d').drawImage(image, 0, 0); return canvas.toDataURL('image/jpeg', 0.78).split(',')[1]; })()`));
  const after = live ? async done => {
    const view = outcomeView(done);
    if (view.capture) await chrome.evaluate(`window.__stage.capture(${JSON.stringify(view.capture)})`);
    await live.outcome({ subject: view.subject, text: view.text, ...(view.capture ? { picture: await chrome.still('jpeg'), jpeg: true } : {}) });
  } : null;
  try {
    let stage = await load(), calls = 0;
    await live?.phase('models');
    const picked = await pickModels({ chrome, jev, stage, models, limit: budget, log });
    calls += picked;
    if (picked) { await saveBoxes(); stage = await load(); }
    await live?.phase('things');
    const things = await placeThings({ chrome, jev, stage, models, placements, save: saveBoxes, budget: budget - calls, log, after });
    calls += things.calls;
    if (things.asked) stage = await load();
    await live?.phase('fights');
    const hits = await pickImpacts({ chrome, jev, stage, fights, save: saveImpacts, budget: budget - calls, log, after });
    calls += hits.calls;
    const unmodelled = stage.things.filter(thing => thing.placed.length && !models[thing.name]).length;
    return { calls, models: { picked, left: unmodelled }, placements: { asked: things.asked, reused: things.reused, failed: things.failed, left: things.left }, fights: { asked: hits.asked, reused: hits.reused, left: hits.left }, left: unmodelled + things.left + hits.left };
  } finally {
    process.off('SIGTERM', stop);
    live?.encoder(null);
    await chrome.close();
    server.close();
    await rm(work, { recursive: true, force: true });
  }
}

/** What a question is about, in a few words for the live page's list: the thing, or the start of the event. */
const subjectOf = context => context.find(line => line.startsWith('Thing: '))?.slice(7).split(',')[0] ?? context.find(line => line.startsWith('A thing a novel mentions: '))?.slice(26).split(',')[0] ?? context.find(line => line.startsWith('Event: '))?.slice(7, 47) ?? '';
const round = value => Math.round(value * 10) / 10;

/**
 * The live record of a running `novel sim pick|run` (`command`), on story lines `lines` ([{ id, title }]):
 *   stage/simulation/live.json        the command, its lines and their state, the calls spent, the question Jev is on, the latest frames;
 *   stage/simulation/live/frames.jsonl every frame so far, across commands, for the replay: a question (its pictures, what it is about,
 *                                     the questions, Jev's answers and how long they took) or an outcome (a picture of what came out);
 *   stage/simulation/live/frames/     the frames' pictures, <frame>-<n>.jpg (or .png when no browser could re-encode them).
 * `watch(jev)` gives a model that records each question before passing it on; `outcome()` records what an answer made. Writes
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
    /** What an answer made, as a picture (base64 PNG or JPEG) and a line of text. */
    async outcome({ subject, text, picture = null, jpeg = false }) {
      const f = frame++, files = picture ? [{ name: 'outcome', file: `frames/${f}-0.${jpeg ? 'jpg' : 'png'}` }] : [];
      if (picture) await writeFile(join(recording, files[0].file), Buffer.from(picture, 'base64'), { mode: 0o644 }).catch(() => {});
      return record({ f, kind: 'outcome', at: at(), line: state.line, phase: state.phase, subject, text, pictures: files });
    },
    watch(jev) {
      return {
        modelId: jev.modelId,
        async decide(text, questions, options = {}) {
          const f = frame++, started = Date.now(), context = text.split('\n').filter(line => /^(Place|Event|Thing): |^A thing a novel mentions: /.test(line)).map(line => line.slice(0, 400));
          const files = await keep(f, Object.entries(options.images ?? {}));
          state.calls++;
          state.ask = { f, at: at(), call: state.calls, line: state.line, phase: state.phase, subject: subjectOf(context), context, pictures: files, questions: questions.map(question => ({ key: question.key, primitive: question.primitive, instructions: String(question.instructions).slice(0, 300), ...(question.options ? { options: question.options.length } : {}) })), answers: null };
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
