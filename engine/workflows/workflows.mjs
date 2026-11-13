// The agent's workflows (docs/v3/design.html#agent-workflows; the user, 2026-11-12: "we don't have workflows created for
// agents. These should be hard linked into workflows that are self motivated: fixed formats and prompts initiated with
// one button to run a volume"). Each step of a volume that needs the agent's judgement is a workflow: a fixed prompt
// that names the whole job, the commands it may run, a fixed reply format, and a check in code that says what is left.
// The volume runner starts it, and as long as the check finds something left it sends the same follow-up with what is
// left, up to `rounds` times; the step is done only when the check passes. Nothing here depends on what a book holds.
//
//   node engine/workflows/workflows.mjs run <workflow> <novel-dir> [--driver <script>]   (one workflow by hand)
//   node engine/workflows/workflows.mjs check <workflow> <novel-dir>
import { spawn } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const SKILL = join(repository, 'skills', 'novel-volume', 'SKILL.md');
const MODELS_SKILL = join(repository, 'skills', 'novel-models', 'SKILL.md');
const readJson = file => { try { return JSON.parse(readFileSync(file, 'utf8')); } catch { return null; } };

/** A heading line of the fixed reply format is present (any heading level, the words as given). */
const hasHeading = (text, heading) => new RegExp(`^#{1,4}\\s*${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'mi').test(text ?? '');
const formatText = headings => headings.map(h => `## ${h}`).join('\n');

export const WORKFLOWS = {
  places: {
    step: 'places', title: 'The place tree', skill: SKILL, rounds: 5,
    // What the agent may run: these verbs on its book (the guard checks each command's form).
    verbs: ['places', 'source', 'search', 'reading'],
    format: ['Settings', 'Mentions and drops', 'Holds', 'Units', 'Journeys', 'Left'],
    prompt: novel => [
      `Place pass for the book at ${novel}. The reading guessed where every unit of the story happens; before anything is built, make the book's place tree true to the text at every level: cities and districts, streets, buildings and rooms, and the place of every unit at the finest place the text shows, down to the room.`,
      `Read the skill first: cat ${SKILL} (section "The place tree"). Use only novel places commands (and novel source to read the text) on this book.`,
      `The job is done when novel places check ${novel} shows "done": true, which needs all of these at zero: undecided cities and districts, unplaced story units (a unit that happens nowhere, such as front matter, a title or an afterword, is marked with nowhere), unproved placements (runs of units whose place no sentence shows: find the sentence and set, or say the run goes on where an earlier unit was with same ... --through), coarse placements (runs of units placed wider than their own lines show: a unit in a city whose lines name a room, a shop or a street; set each at the finest place its lines show, a room when a sentence names the room, or keep a run wide on purpose with wide ... --through when it really happens across the place), the same place made twice (merge one into the other), rooms with no building above them (hold each room under the building the text puts it in: a dorm room under its dorm), and changes of city with no journey; then novel places apply ${novel}. A place the reading made from a word that is not a place (a dish, a title, a figure of speech, a person's nickname) is dropped, and its units placed again where the text puts them.`,
      `Every decision needs a sentence of the book that shows it; a refused claim comes back with why: correct it, never repeat it. Use only what the text says, never what you know of the book from outside. No paid step.`,
      `When check is done, reply in exactly this format, one line per item with its sentence id:\n${formatText(['Settings', 'Mentions and drops', 'Holds', 'Units', 'Journeys', 'Left'])}`,
    ].join('\n\n'),
    check: async novel => {
      const P = await import(pathToFileURL(join(repository, 'engine', 'places', 'place-tree.mjs')).href);
      const c = P.checkOf(await P.storesOf(novel));
      const left = [
        ...c.undecided.map(row => `undecided: ${row.id} ${row.label} (${row.scale}, ${row.unitsUnder} units)`),
        ...c.unplacedStory.map(id => `unplaced story unit: ${id}`),
        ...(c.roomsWithoutBuilding ?? []).map(room => `a room with no building: ${room.place} ${room.label} (${room.units} units; hold it under the building the text puts it in)`),
        ...c.unproved.map(run => `unproved placement: ${run.from}${run.count > 1 ? ` … ${run.to} (${run.count} units)` : ''} at ${run.place} ${run.label}`),
        ...(c.unprovedMoves ? [`${c.unprovedMoves} changes of city with no journey (novel places moves)`] : []),
        ...(c.left === 0 && !c.applied ? ['the decisions are not applied yet: novel places apply'] : []),
      ];
      return { done: c.done, left, summary: { left: c.left, applied: c.applied, decided: c.decided } };
    },
  },
  rooms: {
    step: 'rooms', title: 'The rooms', skill: SKILL, rounds: 6,
    verbs: ['rooms', 'source', 'search', 'reading', 'places'],
    format: ['Rooms', 'Parts and openings', 'Staging', 'Shots', 'Left'],
    prompt: novel => [
      `Rooms pass for the book at ${novel}. Its place tree is decided; before filming, decide what the text shows of every room its units are set in, and where each person is in it, so the film stages each room as the text has it.`,
      `Read the skill first: cat ${SKILL} (section "The rooms"). Use only novel rooms commands (novel source and novel places unit to read the text) on this book. novel rooms rooms lists the rooms; novel rooms room <id> shows one with the first lines of its units; novel rooms stage <unit> shows a unit's people, the script supervisor's notes on where each starts and ends, the room's features and the unit's lines.`,
      `For each room decide: kind (a kind of the list; not said when the text never shows it), floor (as the text counts floors, 1 the ground floor; ground; or not-said), part (own, or the other room it belongs to when it is a part of one: an entrance, a bathroom or a kitchen of the same home), opens (balcony, window, or none), and sun (the sun its windows take as its lines show it: morning, afternoon, or none when they do not say). Then for each unit set in a room, where each person present is: at a feature of the room (bed, seat, desk, table, counter, door, window, balcony, floor) or elsewhere (present in the unit but not in the room: on the phone, remembered, gone out). A person who stays at one feature through the room's next units: at ... --through <unit>. A unit set in a room's building but in no room (its corridor, its door; novel rooms rooms lists them under their room) is filmed on that room: stage its people relative to it too (door: at the room's door from outside; corridor: on its floor nearby; a room feature: inside it; elsewhere). And for each unit set in a room, how it is filmed (shot <unit> <set|eye|outside>, novel rooms stage lists what each means): set by default (a room's first unit too); eye where the unit's sky (novel rooms stage shows it) has rain, snow or a storm and its people are indoors, or for a quiet, close moment; outside where the story comes back to the room from elsewhere at a new time of day or someone arrives at its door, never a room's first unit; shot ... --through <unit> for a run filmed alike (it stops where the light changes).`,
      `The job is done when novel rooms check ${novel} shows "done": true. Every decision needs --why and, but for what the text does not say, --line with a sentence of a unit set in that room (or just before it) that shows it; a refused claim comes back with why: correct it, never repeat it. Use only what the text says, never what you know of the book from outside. No paid step.`,
      `When check is done, reply in exactly this format, one line per decision with its sentence id:\n${formatText(['Rooms', 'Parts and openings', 'Staging', 'Shots', 'Left'])}`,
    ].join('\n\n'),
    check: async novel => {
      const R = await import(pathToFileURL(join(repository, 'engine', 'places', 'room-plan.mjs')).href);
      const c = R.checkOf(await R.roomStores(novel)), rooms = c.items.filter(item => item.room && !item.unit), people = c.items.filter(item => item.missing === 'at'), shots = c.items.filter(item => item.missing === 'shot');
      const byUnit = new Map(); for (const item of people) (byUnit.get(item.unit) ?? byUnit.set(item.unit, []).get(item.unit)).push(item.person);
      const left = [...rooms.map(item => `room ${item.room} ${item.label}: no ${item.missing}`), ...[...byUnit].map(([unit, who]) => `${unit}: where is ${who.join(', ')}`), ...(shots.length ? [`${shots.length} units with no shot: ${shots.slice(0, 12).map(item => item.unit).join(', ')}${shots.length > 12 ? ' …' : ''}`] : [])];
      return { done: c.done, left, summary: { rooms: c.rooms, units: c.units, left: c.left } };
    },
  },
  look: {
    step: 'look', title: 'The look pass', skill: MODELS_SKILL, rounds: 3,
    verbs: ['look', 'settings', 'warehouse', 'model', 'source', 'search'],
    format: ['Book look', 'Places', 'Models', 'Left'],
    prompt: novel => [
      `Look pass for the book at ${novel}: its place tree is decided and its terrain has not been built. Set the world generator for this book's places from the text alone.`,
      `Read the skill first: cat ${MODELS_SKILL} (section "The look pass"). novel look context ${novel} lists the place tree top down with each place's environment sentences, the warehouse parts the text names and the keys a place may set. Decide the book-level look first, then each place's overrides where its own sentences differ (--place <id>).`,
      `Write every change with --why "<sentence ids>: <what they say>" (novel settings set, novel warehouse use ... --place <id>); a kind of thing the fill does not know yet gets a kind of its own (prop:<name>) and a fill.ops operator. Finish with one change carrying --before. No download, no paid step; a look is never canon.`,
      `Reply in exactly this format, one line per change with its sentence ids:\n${formatText(['Book look', 'Places', 'Models', 'Left'])}`,
    ].join('\n\n'),
    check: async (novel, { since } = {}) => {
      const settings = readJson(join(novel, 'stage', 'settings.json')), log = (settings?.log ?? []).filter(e => !since || (e.at ?? '') >= since);
      const left = [...(log.length ? [] : ['no settings written yet (novel settings set ... --why)']), ...(log.some(e => !String(e.why ?? '').trim()) ? ['a change without --why'] : [])];
      return { done: left.length === 0, left, summary: { writes: log.length } };
    },
  },
};

/** The fixed follow-up: what the check still finds, and the same format. */
export const followUp = (workflow, novel, check, formatMissing) => [
  check.done ? `Your reply is not in the fixed format.` : `Not finished: the check for this step still finds ${check.left.length} thing${check.left.length === 1 ? '' : 's'} left:`,
  ...check.left.slice(0, 40).map(line => `- ${line}`), ...(check.left.length > 40 ? [`- … and ${check.left.length - 40} more`] : []),
  check.done ? '' : `Continue from where you are (novel ${workflow.verbs[0]} ... on ${novel}); do not undo what is decided.`,
  `${formatMissing ? 'Reply' : 'When it is done, reply'} in exactly this format:\n${formatText(workflow.format)}`,
].filter(Boolean).join('\n');

/** The check of one workflow on a book, as the runner sees it. */
export async function checkWorkflow(id, novelDir, options = {}) {
  const workflow = WORKFLOWS[id]; if (!workflow) throw new Error(`no workflow ${id}; workflows: ${Object.keys(WORKFLOWS).join(', ')}`);
  return workflow.check(resolve(novelDir), options);
}

/**
 * Runs a workflow to the end: the prompt, then after each round the check and, while something is left, the follow-up in
 * the same session, at most `rounds` rounds. `driver` runs one round: ({ message, session, workflow, novel }) →
 * { reply, session, commands, refused, seconds } (the default: Pi on the work model, tools/pi-review/workflow-agent.mjs).
 * The record is kept in <book>/workflows/<id>.json. Returns { done, rounds, left }.
 */
export async function runWorkflow(id, novelDir, { driver = driverOf(process.env.NOVEL_WORKFLOW_AGENT), log = () => {}, definition = null } = {}) {
  const workflow = definition ?? WORKFLOWS[id]; if (!workflow) throw new Error(`no workflow ${id}`);
  const novel = resolve(novelDir), since = new Date().toISOString(), recordFile = join(dirname(novel), 'workflows', `${id}.json`);
  await mkdir(dirname(recordFile), { recursive: true });
  const record = { workflow: id, novel, started: since, rounds: [] };
  let message = workflow.prompt(novel), session = null, check = null;
  for (let round = 1; round <= workflow.rounds; round++) {
    log(`${id}: round ${round}`);
    const answer = await driver({ message, session, workflow, novel, id });
    session = answer.session ?? session;
    check = await workflow.check(novel, { since });
    const formatMissing = workflow.format.filter(h => !hasHeading(answer.reply, h));
    record.rounds.push({ round, at: new Date().toISOString(), sent: message, reply: answer.reply ?? '', error: answer.error ?? null, commands: answer.commands ?? 0, refused: answer.refused ?? 0, seconds: answer.seconds ?? 0, check: { done: check.done, left: check.left.length, summary: check.summary }, formatMissing });
    await writeFile(recordFile, JSON.stringify(record, null, 1));
    if (answer.error && !answer.reply) { log(`${id}: the agent failed: ${answer.error}`); break; }
    if (check.done && formatMissing.length === 0) break;
    message = followUp(workflow, novel, check, formatMissing.length > 0);
  }
  record.ended = new Date().toISOString(); record.done = !!check?.done; record.left = check?.left ?? [];
  await writeFile(recordFile, JSON.stringify(record, null, 1));
  return { done: record.done, rounds: record.rounds.length, left: record.left, record: recordFile, reply: record.rounds.at(-1)?.reply ?? '' };
}

/** The agent that runs a workflow: the one the user has open (NOVEL_WORKFLOW_AGENT: pi, the default, or claude-code). */
export function driverOf(agent = 'pi') {
  if (!agent || agent === 'pi') return piDriver;
  if (agent === 'claude-code') return claudeDriver;
  throw new Error(`no agent ${agent}: pi or claude-code`);
}

/** The book's own novel command for an agent whose tool rules match a command's start (Claude Code): a small script beside the book's workflows. */
async function novelCommandOf(novel) {
  const file = join(dirname(novel), 'workflows', 'novel');
  await mkdir(dirname(file), { recursive: true });
  await writeFile(file, `#!/bin/sh\n# The novel command for this book's agent workflows.\nexec "${process.execPath}" "${join(repository, 'dist', 'src', 'cli', 'cli.js')}" "$@"\n`, { mode: 0o755 });
  return file;
}

/** One round with Claude Code (claude -p, the session resumed for follow-ups): only the workflow's verbs are allowed, through the book's novel command. */
export async function claudeDriver({ message, session, workflow, novel }) {
  const command = process.env.NOVEL_CLAUDE_COMMAND || 'claude', novelCommand = await novelCommandOf(novel), started = Date.now();
  const allowed = [...workflow.verbs.map(verb => `Bash(${novelCommand} ${verb}:*)`), `Read(${workflow.skill})`];
  const text = `${session ? '' : `The novel command here is ${novelCommand}: run every "novel ..." command as ${novelCommand} ... (one command per call).\n\n`}${message}`;
  return new Promise(done => {
    const child = spawn(command, ['-p', text, ...(session ? ['--resume', session] : []), '--output-format', 'json', '--allowedTools', ...allowed], { cwd: dirname(novel), env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => done({ reply: '', error: String(error.message ?? error), session }));
    child.on('close', () => {
      let reply = null; try { reply = JSON.parse(out); } catch {}
      if (!reply) { done({ reply: '', error: (err || out).slice(-400) || 'Claude Code ended without a reply', session }); return; }
      done({ reply: reply.is_error ? '' : String(reply.result ?? ''), error: reply.is_error ? String(reply.result ?? '').slice(0, 400) : null, session: reply.session_id ?? session, commands: reply.num_turns ?? 0, refused: (reply.permission_denials ?? []).length, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

/** One round with Pi on the work model: a child process (the Pi SDK lives with tools/pi-review), JSON lines out. */
export function piDriver({ message, session, novel, id }) {
  const script = process.env.NOVEL_WORKFLOW_DRIVER || join(repository, 'tools', 'pi-review', 'workflow-agent.mjs');
  return new Promise(done => {
    const child = spawn(process.execPath, [script, id, novel, ...(session ? [session] : [])], { cwd: repository, env: { ...process.env, NOVEL_WORKFLOW_MESSAGE: message }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    child.on('exit', () => {
      const lines = out.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const last = lines.findLast(line => 'result' in line || 'error' in line) ?? { error: err.slice(-400) || 'the agent ended without a reply' };
      done({ reply: last.result ?? '', error: last.error ?? null, session: last.sessionFile ?? lines.find(line => line.session)?.session ?? session, commands: last.commands ?? 0, refused: last.refused ?? 0, seconds: last.seconds ?? 0 });
    });
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, id, novelDir] = process.argv.slice(2);
  if (!['run', 'check'].includes(command) || !id || !novelDir) { console.error('usage: node engine/workflows/workflows.mjs run|check <workflow> <novel-dir>'); process.exit(2); }
  const out = command === 'check' ? await checkWorkflow(id, novelDir) : await runWorkflow(id, novelDir, { log: line => console.error(`${new Date().toISOString()} ${line}`) });
  console.log(JSON.stringify(out, null, 1));
}
