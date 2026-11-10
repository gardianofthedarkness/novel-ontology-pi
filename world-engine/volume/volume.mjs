// A whole volume, step by step, for the Pi agent to run (the user, 2026-11-10: "Let's run a full volume 2 by asking pi
// agent to do so"). The steps are the ones that made volume 1 (~/claude-world-first/w12-build.sh) and those built since:
// the reading, the workspace, the book's strands, what it carries from the book before (carry.mjs), the look pass (Pi's
// own: models and settings, before terrain builds the places), the sky, transport, terrain, the starts, the pre-film
// casts, a `before` snapshot, the
// director's run, and what the run leaves for the next book. Each step runs in the background (a Pi command lasts at most
// 30 minutes; a reading or a run lasts longer), logs to <library>/runtime/volume/<book>/<step>.{out,err} and records its
// state in <library>/<book>/volume.json. A step that fails stops the chain; run it again once fixed (paid steps cache
// what they asked, so a rerun pays only for what changed).
//
//   node world-engine/volume/volume.mjs status <novel-dir>
//   node world-engine/volume/volume.mjs run <novel-dir> [--step <id> | --until <id>]   (from the first step not done)
//   node world-engine/volume/volume.mjs log <novel-dir> <step> [--lines N]
//   node world-engine/volume/volume.mjs done <novel-dir> look --why <text>              (Pi's look pass, marked done)
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, open, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const json = file => readFile(file, 'utf8').then(JSON.parse).catch(() => null);
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** Where a book's things are: its workspace, the folder before it was made (the source), its reading, its library. */
export function placesOf(novelDir) {
  const novel = resolve(novelDir), bookDir = dirname(novel), library = dirname(bookDir), book = basename(bookDir);
  return { novel, book, bookDir, library, universe: join(library, 'universe'), source: `${novel}.source`, reading: join(bookDir, 'reading'), readingRun: join(bookDir, 'reading-run'), data: join(bookDir, 'reading', 'data.json'), state: join(bookDir, 'volume.json'), logs: join(library, 'runtime', 'volume', book) };
}
/** The book before this one in the series (vol-1 before vol-2), or null. */
export const previousBook = book => { const n = Number(String(book).match(/(\d+)$/)?.[1] ?? NaN); return n > 1 ? String(book).replace(/\d+$/, String(n - 1)) : null; };

/** The job's entry for this book (its EPUB), from <library>/job.json. */
async function jobEntry(at) {
  const job = await json(join(at.library, 'job.json'));
  return (job?.volumes ?? []).find(volume => resolve(volume.workspace ?? '') === at.novel) ?? null;
}
/** A run of a book that can be kept: the director's latest run with its page and its smoothing. */
export async function lastRun(novelDir) {
  const novel = resolve(novelDir), runs = await readdir(join(novel, 'stage', 'director', 'runs')).catch(() => []);
  const ok = [];
  for (const id of runs.filter(name => /^d\d{14}$/.test(name)).sort()) if (existsSync(join(novel, 'stage', 'simulation', 'runs', 'director', `${id}.page.json`)) && existsSync(join(novel, 'stage', 'world', 'smoothed', `${id}.json`))) ok.push(id);
  return ok.at(-1) ?? null;
}

/** A step's environment: the caller's (the keys come from the host), the models volume 1 was made with, the portrait venv. */
export function stepEnvironment(env = process.env) {
  const venv = join(env.HOME ?? '', 'claude-world-first', 'portrait-venv', 'bin', 'python');
  const out = { ...env, JEV_MODEL: 'jev-1.14.0', WORK_LLM_PROVIDER: 'deepseek', WORK_LLM_MODEL: 'deepseek-chat', ...(!env.NOVEL_PORTRAIT_PYTHON && existsSync(venv) ? { NOVEL_PORTRAIT_PYTHON: venv } : {}) };
  // The host's model observer (a local proxy for Pi's own commands, its live view) refuses requests over 4 MB (terrain's
  // pictures) and ends with the host: a step asks Jev and the work model directly.
  for (const key of ['JEV_ENDPOINT', 'WORK_LLM_BASE_URL']) if (/^http:\/\/(127\.0\.0\.1|localhost)[:/]/.test(out[key] ?? '')) delete out[key];
  return out;
}
const node = (script, ...args) => ({ program: process.execPath, args: [join(repository, script), ...args] });
const cli = (...args) => node('dist/src/cli/cli.js', ...args);

/**
 * The steps, in order. Each: `id`; `paid` (Jev or the work model are asked); `who` 'runner' or 'pi' (Pi's judgement);
 * `done(at)` whether its result is there; `commands(at)` what it runs (one after another), or `act(at)` done in process.
 */
export const STEPS = [
  { id: 'prepare', paid: false, why: 'the book\'s folder before the reading becomes the source the reading and the workspace read',
    done: at => existsSync(join(at.novel, 'stage', 'world', 'script.json')) || existsSync(at.source),
    act: async at => { if (!existsSync(at.novel)) throw new Error(`no book folder at ${at.novel}`); await rename(at.novel, at.source); } },
  { id: 'read', paid: true, why: 'the reading (Jev and the work model; ~$0.3–0.4 a volume)',
    done: at => existsSync(join(at.readingRun, 'v2', 'data.json')) || existsSync(at.data),
    commands: async at => { const job = await jobEntry(at); return [node('experiments/v2/read.mjs', existsSync(at.source) ? at.source : at.novel, at.readingRun, ...(job?.epub ? ['--epub', job.epub] : []))]; } },
  { id: 'workspace', paid: false, why: 'the world-first workspace and its world script from the reading; the reading into the book',
    done: at => existsSync(join(at.novel, 'stage', 'world', 'script.json')) && existsSync(at.data),
    commands: async at => [node('experiments/v2/workspace.mjs', at.source, at.readingRun, at.novel)],
    after: async at => {
      await mkdir(at.reading, { recursive: true }); await cp(join(at.readingRun, 'v2'), at.reading, { recursive: true });
      // The book's own settings (a look pass done before, the book's layer) stay the book's.
      const settings = join(at.source, 'stage', 'settings.json');
      if (existsSync(settings) && !existsSync(join(at.novel, 'stage', 'settings.json'))) await cp(settings, join(at.novel, 'stage', 'settings.json'));
    } },
  { id: 'strands', paid: false, why: 'the book\'s strands by interaction (stage/world/strands.json)',
    done: at => existsSync(join(at.novel, 'stage', 'world', 'strands.json')),
    commands: async at => [node('experiments/v2/strands.mjs', at.novel, '--reading', at.data)] },
  { id: 'carry', paid: true, why: 'the book before registered with its run\'s damage kept, then this book inheriting or closing its open strands (a few work-model questions)',
    done: at => !previousBook(at.book) || !!readJson(join(at.universe, 'strands.json'))?.decisions?.[at.book],
    commands: async at => {
      const before = previousBook(at.book);
      if (!before) return [];
      const prior = join(at.library, before, 'novel'), registry = await json(join(at.universe, 'strands.json')), run = await lastRun(prior);
      const out = [];
      if (!registry?.books?.[before] && run) out.push(node('world-engine/smoother/restrand.mjs', prior, '--run', run, '--write'), cli('strands', 'register', prior, '--run', run), cli('strands', 'keep', prior, '--run', run));
      else if (!registry?.books?.[before]) out.push(cli('strands', 'register', prior));
      out.push(cli('strands', 'inherit', at.novel, '--work'));
      return out;
    } },
  { id: 'look', paid: true, who: 'pi', why: 'YOUR step: the look pass (novel-models skill): models for the book\'s things, settings for how its places look; then `novel volume done <workspace> look --why <text>`',
    done: () => false },
  { id: 'sky', paid: true, why: 'time of day and weather by unit (12 or so Jev questions)',
    done: at => existsSync(join(at.reading, 'sky.json')), commands: async at => [cli('sky', 'build', at.novel)],
    // novel sky build writes beside the reading the workspace's manifest names (the reading's run); the director plays the book's.
    after: async at => { const made = join(at.readingRun, 'v2', 'sky.json'); if (existsSync(made)) await cp(made, join(at.reading, 'sky.json')); } },
  { id: 'transport', paid: true, why: 'vehicles\' models and owners into the universe (a few Jev questions)',
    done: () => false, commands: async at => [node('experiments/v2/transport.mjs', at.novel, at.data, '--universe', at.universe)] },
  { id: 'terrain', paid: true, why: 'the places built, city to street (~150 Jev questions; 15–30 minutes)',
    done: at => existsSync(join(at.novel, 'stage', 'terrain.json')), commands: async at => [cli('sim', 'terrain', at.novel, '--spawn', '--from', 'city', '--run')] },
  { id: 'starts', paid: false, why: 'where each one stands as each unit begins',
    done: at => existsSync(join(at.novel, 'stage', 'world', 'spawn.json')), commands: async at => [node('world-engine/spawning/spawn.mjs', at.novel, '--reading', at.data)] },
  { id: 'prefilm', paid: true, why: 'the pre-film casts\' notes (the work model; ~$0.8 a volume)',
    done: at => existsSync(join(at.reading, 'prefilm.json')), commands: async at => [node('experiments/v2/prefilm.mjs', at.novel, at.data)] },
  { id: 'settei', paid: true, why: 'people\'s abilities (settei)', done: () => false, commands: async at => [node('experiments/v2/settei.mjs', at.novel, at.data, '--universe', at.universe)] },
  { id: 'in-use', paid: true, why: 'what is in use, by whom', done: at => existsSync(join(at.reading, 'in-use.json')), commands: async at => [node('experiments/v2/in-use.mjs', at.novel, at.data, '--universe', at.universe)] },
  { id: 'set-dresser', paid: true, why: 'the set dresser\'s things', done: () => false, commands: async at => [node('experiments/v2/set-dresser.mjs', at.novel, at.data)] },
  { id: 'rides', paid: true, why: 'who rides what', done: at => existsSync(join(at.reading, 'rides.json')), commands: async at => [node('experiments/v2/rides.mjs', at.novel, at.data, '--universe', at.universe)] },
  { id: 'voices', paid: false, why: 'who speaks unattributed lines (local embeddings)', done: at => existsSync(join(at.reading, 'voices.json')), commands: async at => [node('experiments/v2/voices.mjs', at.novel, at.data)] },
  { id: 'stills', paid: true, why: 'the book\'s pictures read (faces, places)', done: at => existsSync(join(at.reading, 'pictures.json')), commands: async at => [node('experiments/v2/stills.mjs', at.novel, at.data)] },
  { id: 'snapshot', paid: false, why: 'the book\'s `before` snapshot (where its run starts; the director restores it)',
    done: () => false, commands: async at => [cli('universe', 'snapshot', at.library, '--book', at.book, '--before', '--why', `${at.book} before its first run (novel volume)`)] },
  { id: 'direct', paid: true, why: 'the director\'s run of the whole book (Jev; about 1.5 hours)',
    done: () => false, commands: async at => {
      const script = await json(join(at.novel, 'stage', 'world', 'script.json')), first = script?.scenes?.[0]?.id, last = script?.scenes?.at(-1)?.id;
      if (!first || !last) throw new Error('no world script to run');
      return [node('world-engine/director/director.mjs', at.novel, '--reading', at.data, '--from', first, '--to', last, '--live')];
    } },
  { id: 'kept', paid: false, why: 'the run re-stranded, this book registered and its damage kept for the next book',
    done: () => false, commands: async at => {
      const run = await lastRun(at.novel);
      if (!run) throw new Error('no run with a page and a smoothing to keep');
      return [node('world-engine/smoother/restrand.mjs', at.novel, '--run', run, '--write'), cli('strands', 'register', at.novel, '--run', run), cli('strands', 'keep', at.novel, '--run', run)];
    } },
];

/** The book's recorded state: each step's status, when, its log. */
export async function stateOf(at) { return (await json(at.state)) ?? { book: at.book, steps: {} }; }
const save = (at, state) => writeFile(at.state, JSON.stringify(state, null, 1));
const alive = pid => { try { process.kill(pid, 0); return true; } catch { return false; } };

/** Each step with where it stands: done (recorded or its result there), running, failed, waiting. */
export async function status(novelDir) {
  const at = placesOf(novelDir), state = await stateOf(at);
  const steps = STEPS.map(step => {
    const own = state.steps[step.id] ?? {};
    const running = own.status === 'running' && own.pid && alive(own.pid);
    const done = own.status === 'done' || (own.status !== 'failed' && !running && step.done(at));
    return { id: step.id, paid: step.paid, who: step.who ?? 'runner', status: running ? 'running' : done ? 'done' : own.status === 'failed' ? 'failed' : own.status === 'running' ? 'stopped' : 'waiting', why: step.why, ...(own.started ? { started: own.started } : {}), ...(own.ended ? { ended: own.ended } : {}), ...(own.error ? { error: own.error } : {}), ...(own.note ? { note: own.note } : {}) };
  });
  const next = steps.find(step => step.status !== 'done');
  return { book: at.book, workspace: at.novel, logs: at.logs, next: next ? { id: next.id, who: next.who, status: next.status } : null, steps };
}

/** Runs steps in this process, in order, recording each (what the background runner does). */
export async function execute(novelDir, ids, { log = () => {} } = {}) {
  const at = placesOf(novelDir);
  await mkdir(at.logs, { recursive: true });
  for (const id of ids) {
    const step = STEPS.find(entry => entry.id === id);
    if (!step) throw new Error(`no step ${id}`);
    if (step.who === 'pi') { log(`${id}: the agent's step; stopping here`); break; }
    const state = await stateOf(at);
    state.steps[id] = { status: 'running', pid: process.pid, started: new Date().toISOString() };
    await save(at, state);
    try {
      if (step.act) await step.act(at);
      for (const [n, command] of (step.commands ? await step.commands(at) : []).entries()) {
        const out = await open(join(at.logs, `${id}.out`), n ? 'a' : 'w'), err = await open(join(at.logs, `${id}.err`), n ? 'a' : 'w');
        await out.write(`== ${new Date().toISOString()} ${basename(command.args[0])} ${command.args.slice(1).map(arg => (arg.startsWith('/') ? basename(arg) : arg)).join(' ')}\n`);
        const code = await new Promise(done => {
          const child = spawn(command.program, command.args, { cwd: repository, env: stepEnvironment(), stdio: ['ignore', out.fd, err.fd] });
          child.on('exit', code => done(code ?? 1)); child.on('error', () => done(1));
        });
        await out.close(); await err.close();
        if (code !== 0) throw new Error(`${basename(command.args[0])} exited ${code}: see ${join(at.logs, `${id}.err`)}`);
      }
      if (step.after) await step.after(at);
      const now = await stateOf(at);
      now.steps[id] = { ...now.steps[id], status: 'done', ended: new Date().toISOString() };
      await save(at, now); log(`${id}: done`);
    } catch (error) {
      const now = await stateOf(at);
      now.steps[id] = { ...now.steps[id], status: 'failed', ended: new Date().toISOString(), error: String(error.message ?? error) };
      await save(at, now); log(`${id}: failed: ${error.message ?? error}`);
      return false;
    }
  }
  return true;
}

/** Starts steps in the background: `step` alone, or from the first step not done up to `until` (or up to Pi's look pass). */
export async function run(novelDir, { step = null, until = null } = {}) {
  const at = placesOf(novelDir), now = await status(novelDir);
  if (now.steps.some(entry => entry.status === 'running')) throw new Error(`a step is running: ${now.steps.find(entry => entry.status === 'running').id}`);
  const order = STEPS.map(entry => entry.id);
  let ids;
  if (step) { if (!order.includes(step)) throw new Error(`no step ${step}; steps: ${order.join(', ')}`); ids = [step]; }
  else {
    const from = now.steps.findIndex(entry => entry.status !== 'done');
    if (from < 0) return { started: [], note: 'every step is done' };
    const to = until ? order.indexOf(until) : order.length - 1;
    if (until && to < 0) throw new Error(`no step ${until}`);
    ids = order.slice(from, to + 1);
    const pi = ids.findIndex(id => STEPS.find(entry => entry.id === id).who === 'pi');
    if (pi === 0) throw new Error(`the next step, ${ids[0]}, is yours: ${STEPS.find(entry => entry.id === ids[0]).why}`);
    if (pi > 0) ids = ids.slice(0, pi);
  }
  await mkdir(at.logs, { recursive: true });
  const runnerLog = await open(join(at.logs, 'runner.log'), 'a');
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), 'exec', at.novel, ...ids], { cwd: repository, env: process.env, detached: true, stdio: ['ignore', runnerLog.fd, runnerLog.fd] });
  child.unref(); await runnerLog.close();
  return { started: ids, pid: child.pid, logs: at.logs, note: 'running in the background: check with novel volume status' };
}

/** The last lines of a step's log (out and err). */
export async function logOf(novelDir, step, lines = 40) {
  const at = placesOf(novelDir), tail = text => text.split('\n').slice(-lines).join('\n');
  return { step, out: tail(await readFile(join(at.logs, `${step}.out`), 'utf8').catch(() => '')), err: tail(await readFile(join(at.logs, `${step}.err`), 'utf8').catch(() => '')) };
}

/** The agent's own step marked done, with why. */
export async function markDone(novelDir, step, why) {
  const at = placesOf(novelDir), found = STEPS.find(entry => entry.id === step);
  if (!found || found.who !== 'pi') throw new Error(`only the agent's steps are marked done by hand (${STEPS.filter(entry => entry.who === 'pi').map(entry => entry.id).join(', ')})`);
  if (!why?.trim()) throw new Error('say why (--why)');
  const state = await stateOf(at);
  state.steps[step] = { status: 'done', ended: new Date().toISOString(), note: why.trim() };
  await save(at, state);
  return { step, status: 'done', note: why.trim() };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [command, novelDir, ...rest] } = parseArgs({ allowPositionals: true, options: { step: { type: 'string' }, until: { type: 'string' }, lines: { type: 'string' }, why: { type: 'string' } } });
  if (!novelDir || !['status', 'run', 'exec', 'log', 'done'].includes(command)) { console.error('usage: node world-engine/volume/volume.mjs status|run|log|done <novel-dir> ... (see the header)'); process.exit(2); }
  if (command === 'exec') { const ok = await execute(novelDir, rest, { log: line => console.log(`${new Date().toISOString()} ${line}`) }); process.exit(ok ? 0 : 1); }
  const out = command === 'status' ? await status(novelDir) : command === 'run' ? await run(novelDir, { step: values.step ?? null, until: values.until ?? null }) : command === 'log' ? await logOf(novelDir, rest[0], Number(values.lines ?? 40)) : await markDone(novelDir, rest[0], values.why);
  console.log(JSON.stringify(out, null, 1));
}
