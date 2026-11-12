// The reviewer segment (docs/v3/design.html#reviewer-segment; the user, 2026-11-12: "we come up with a magic number for
// example like 5 segments, that triggers one round of review from agent. It will look at each segments screenshot, and
// decide either to retake or not, if retake leave comments to director in what to improve"). Every `every` units the
// director stops; the reviewer (Claude Code, which reads the pictures) is given each unit's still with what the unit is,
// and answers, in a fixed format, keep or retake for each, with a note to the director for a retake. The director then
// rewinds to the first unit retaken and plays on from there, each retaken unit with its note in the director's questions.
// One round per block: the retaken units are not reviewed again.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** How many units a review covers when none is given. */
export const EVERY = 5;

/** The fixed prompt: the units of the block, each with its picture and what it should show; the fixed reply. */
export function reviewPrompt(units, { attached = false } = {}) {
  let n = 0;
  return [
    `You are the reviewer of a film being directed from a novel, one unit (a short stretch of the story) at a time, in a 3D world. The director has just played the units below. For each, look at its picture (${attached ? 'the pictures are attached in the order of the units that have one' : 'read the file'}): the director's camera at the end of the unit, every person labelled by name where the world has them.`,
    'Judge each unit only on what the picture and its notes show against what the unit should show: the people the unit has are there and visible, in the right kind of place (a room, a street, a rooftop), standing where the action needs them (close enough to talk, to fight, to hand something over), nobody inside a wall or floating, nobody there who should not be. The picture is the review\'s own camera, not the film\'s: high above the people, and indoors the room opened as a stage set (the building above it left out, the walls toward the camera cut down to a low line, the far walls standing with their windows, its furniture inside). Never retake for the camera (its angle, its distance, a wall or a roof in the way): the director cannot change it. Retake a unit only when where the people are is clearly wrong and the director could stage it better; otherwise keep it.',
    'For a retake, the note is to the director: what is wrong in the picture and what to do instead, in one or two plain sentences (who should stand where, who should go to whom, who should leave or come in). Never ask for anything the unit\'s lines do not say.',
    ...units.map(unit => [`Unit ${unit.unit}`, `- picture: ${unit.still ? (attached ? `attached picture ${++n}` : unit.still) : '(no picture: judge from the notes)'}`, `- place: ${unit.place ?? 'unknown'}`, `- people: ${unit.people.join(', ') || 'none'}`, `- cards played: ${unit.cards}; moves: ${unit.moves}; held by the laws: ${unit.held.join('; ') || 'none'}`, ...(unit.lines?.length ? ['- its first lines:', ...unit.lines.map(line => `  ${line}`)] : [])].join('\n')),
    'Reply with exactly one JSON block and nothing after it:\n```json\n[{"unit": "<unit id>", "verdict": "keep" | "retake", "note": "<to the director, for a retake; empty for keep>"}]\n```\nOne entry for every unit above, in the same order.',
  ].join('\n\n');
}

/** The verdicts from a reply: one per unit of the block, or null when the reply is not in the fixed format. */
export function verdictsOf(reply, units) {
  const block = String(reply ?? '').match(/```json\s*([\s\S]*?)```/)?.[1] ?? String(reply ?? '').match(/\[[\s\S]*\]/)?.[0];
  let list; try { list = JSON.parse(block); } catch { return null; }
  if (!Array.isArray(list)) return null;
  const ids = new Set(units.map(unit => unit.unit)), out = [];
  for (const unit of units) {
    const found = list.find(entry => entry?.unit === unit.unit);
    if (!found || !['keep', 'retake'].includes(found.verdict)) return null;
    out.push({ unit: unit.unit, verdict: found.verdict, note: found.verdict === 'retake' ? String(found.note ?? '').trim().slice(0, 600) : '' });
  }
  return out.filter(entry => ids.has(entry.unit));
}

/** Claude Code reads the stills (its Read tool on the review's own folder only); one call, resumed once if out of format. */
export function claudeReviewer({ command = process.env.NOVEL_REVIEW_AGENT_COMMAND || 'claude', cwd } = {}) {
  const call = (text, folder, resume) => new Promise(done => {
    const child = spawn(command, ['-p', text, ...(resume ? ['--resume', resume] : []), '--output-format', 'json', '--allowedTools', `Read(${folder}/**)`], { cwd: cwd ?? folder, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => done({ error: String(error.message ?? error) }));
    child.on('close', () => { let reply = null; try { reply = JSON.parse(out); } catch {} done(reply ? { reply: reply.is_error ? '' : String(reply.result ?? ''), error: reply.is_error ? String(reply.result ?? '').slice(0, 400) : null, session: reply.session_id ?? null, cost: reply.total_cost_usd ?? null } : { error: (err || out).slice(-400) || 'Claude Code ended without a reply' }); });
  });
  return {
    id: 'claude-code',
    async review(units, folder) {
      const first = await call(reviewPrompt(units), folder, null);
      if (first.error) return { error: first.error, rounds: [first] };
      let verdicts = verdictsOf(first.reply, units);
      const rounds = [first];
      if (!verdicts && first.session) { const again = await call('Your reply was not in the fixed format. Reply again with only the JSON block, one entry per unit.', folder, first.session); rounds.push(again); verdicts = verdictsOf(again.reply, units); }
      return verdicts ? { verdicts, rounds } : { error: 'the reviewer\'s reply was not in the fixed format', rounds };
    },
  };
}

/** Pi on the work model (DeepSeek reads pictures): the stills attached to the prompt (tools/pi-review/review-agent.mjs), once more in the same session when out of format. */
export function piReviewer({ script = process.env.NOVEL_REVIEW_PI_RUNNER || join(repository, 'tools', 'pi-review', 'review-agent.mjs') } = {}) {
  const call = (text, folder, images, session) => new Promise(done => {
    const child = spawn(process.execPath, [script, folder, ...(session ? [session] : [])], { cwd: folder, env: { ...process.env, NOVEL_REVIEW_MESSAGE: text, NOVEL_REVIEW_IMAGES: JSON.stringify(images) }, stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '', err = '';
    child.stdout.on('data', chunk => { out += chunk; }); child.stderr.on('data', chunk => { err += chunk; });
    child.on('error', error => done({ error: String(error.message ?? error) }));
    child.on('close', () => {
      const lines = out.split('\n').flatMap(line => { try { return [JSON.parse(line)]; } catch { return []; } });
      const last = lines.findLast(line => 'result' in line || 'error' in line) ?? { error: err.slice(-400) || 'Pi ended without a reply' };
      done({ reply: last.result ?? '', error: last.error ?? null, session: last.sessionFile ?? lines.find(line => line.session)?.session ?? session, seconds: last.seconds ?? null, images: last.images ?? 0 });
    });
  });
  return {
    id: 'pi',
    async review(units, folder) {
      const images = units.map(unit => unit.still).filter(Boolean);
      const first = await call(reviewPrompt(units, { attached: true }), folder, images, null);
      if (first.error) return { error: first.error, rounds: [first] };
      let verdicts = verdictsOf(first.reply, units);
      const rounds = [first];
      if (!verdicts && first.session) { const again = await call('Your reply was not in the fixed format. Reply again with only the JSON block, one entry per unit.', folder, [], first.session); rounds.push(again); verdicts = verdictsOf(again.reply, units); }
      return verdicts ? { verdicts, rounds } : { error: 'the reviewer\'s reply was not in the fixed format', rounds };
    },
  };
}

/** A stand-in for trying the loop (no model): a unit is retaken when the laws held something in it, with that as the note. */
export function standInReviewer() {
  return { id: 'stand-in', async review(units) { return { verdicts: units.map(unit => (unit.held.length ? { unit: unit.unit, verdict: 'retake', note: `stand-in: the laws held ${unit.held[0]}; place the people so it holds` } : { unit: unit.unit, verdict: 'keep', note: '' })), rounds: [] }; } };
}

/**
 * The review of one block: its units given to the reviewer, the verdicts kept in <novel>/stage/director/reviews/<run>/
 * block-<n>.json with the prompt and every reply. Returns the units to retake with their notes, or none when the review fails
 * (the block is kept as played and the failure said).
 */
export async function reviewBlock({ reviewer, units, folder, block, log = () => {} }) {
  await mkdir(folder, { recursive: true });
  const started = Date.now(), result = await reviewer.review(units, folder).catch(error => ({ error: String(error.message ?? error), rounds: [] }));
  const file = join(folder, `block-${String(block).padStart(3, '0')}.json`);
  await writeFile(file, JSON.stringify({ block, reviewer: reviewer.id, units, prompt: reviewPrompt(units), seconds: Math.round((Date.now() - started) / 1000), ...result }, null, 1));
  if (result.error) { log(`review of block ${block}: ${result.error}; the block is kept as played`); return { retakes: [], file, error: result.error }; }
  const retakes = result.verdicts.filter(entry => entry.verdict === 'retake');
  log(`review of block ${block} (${units.map(unit => unit.unit.slice(-3)).join(', ')}): ${retakes.length ? `retake ${retakes.map(entry => entry.unit.slice(-3)).join(', ')}` : 'all kept'}`);
  return { retakes, file };
}

/** The reviewer an option names: 'pi' (the work model, which reads pictures), 'claude-code' or 'stand-in'. */
export function reviewerOf(id = 'claude-code', options = {}) {
  if (id === 'stand-in') return standInReviewer();
  if (id === 'pi') return piReviewer(options);
  if (id === 'claude-code') return claudeReviewer(options);
  throw new Error(`no reviewer ${id}: pi, claude-code or stand-in`);
}
