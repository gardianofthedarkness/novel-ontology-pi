import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { repo } from './config.mjs';

/**
 * The stage simulation player, served by the host: the engine's own page
 * (playground/strand-demo.html) with a book's accepted runs inlined, the way
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

/** The Content-Security-Policy for a page that admits exactly its own inline scripts, by hash (a JSON data block is never run). */
function pagePolicy(html) {
  const hashes = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  return `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'`;
}

/**
 * The player page for a book's runs (accepted, or with `newest` the latest), or null when it has none; with the
 * Content-Security-Policy that admits exactly its inline scripts. `live`: a link to the live page, shown on the player.
 */
export async function simulationPage(workspace, { title = 'Simulation', newest = false, live = null } = {}) {
  const runs = await playableRuns(workspace, { newest });
  if (!runs.length) return null;
  const { inlineStrand } = await import(pathToFileURL(`${repo}/playground/export-strand-demo.mjs`).href);
  const template = await readFile(`${repo}/playground/strand-demo.html`, 'utf8');
  let html = inlineStrand(template, { strands: runs.map(({ id, label, name, data }) => ({ id, label, name, data })) }, { name: title, vendor: true });
  if (live) {
    const running = (await liveState(workspace)).status === 'running';
    html = html.replace('</body>', `<a href="${live}" style="position:fixed;right:12px;bottom:12px;z-index:50;padding:6px 12px;border-radius:99px;background:#0d1822e6;border:1px solid ${running ? '#7dffa4' : '#1d3242'};color:${running ? '#7dffa4' : '#d8e6ef'};font:13px -apple-system,sans-serif;text-decoration:none">${running ? '● Jev is picking: watch live' : 'Replay Jev\'s picks'}</a></body>`);
  }
  return { html, policy: pagePolicy(html), runs: runs.map(({ id, run }) => ({ id, run })) };
}

/** three.js for the player, from the app's own dependency: only the files the page imports (playground/sim-jev.mjs names them). */
export async function simulationVendor(file) {
  const { VENDOR_FILES } = await import(pathToFileURL(`${repo}/playground/sim-jev.mjs`).href);
  const path = Object.hasOwn(VENDOR_FILES, file) ? VENDOR_FILES[file] : null;
  return path ? readFile(`${repo}/${path}`) : null;
}

/**
 * The live page: what a book's running `novel sim pick|run` is doing, and a replay of every question Jev was asked with its
 * pictures and answers (playground/sim-jev.mjs records them). Static: it reads live.json and the recording beside it.
 */
export async function simulationLivePage() {
  const html = await readFile(new URL('./sim-live.html', import.meta.url), 'utf8');
  return { html, policy: pagePolicy(html) };
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
  const { inlineStrand } = await import(pathToFileURL(`${repo}/playground/export-strand-demo.mjs`).href);
  const template = await readFile(`${repo}/playground/strand-demo.html`, 'utf8');
  const html = inlineStrand(template, page, { name: 'World · now', vendor: true });
  return { html, policy: pagePolicy(html), run: page.live?.run ?? null };
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
