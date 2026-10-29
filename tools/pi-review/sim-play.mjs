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

/** A book's accepted runs that can be played (those kept with the player's data), in the index's order. */
export async function playableRuns(workspace) {
  const folder = resolve(workspace, 'stage', 'simulation');
  const index = await readFile(resolve(folder, 'index.json'), 'utf8').then(JSON.parse, () => null);
  const runs = [];
  for (const [id, entry] of Object.entries(index?.strands ?? {})) {
    const accepted = Array.isArray(entry?.runs) ? entry.runs.find(run => run.id === entry.accepted) : null;
    if (!strandId.test(id) || !accepted?.page || !runFile.test(accepted.page)) continue;
    const data = await readFile(resolve(folder, accepted.page), 'utf8').then(JSON.parse, () => null);
    if (data) runs.push({ id, label: `${entry.title ?? id} · ${accepted.scenes} scene${accepted.scenes === 1 ? '' : 's'}`, name: entry.title ?? id, data, run: accepted.id });
  }
  return runs;
}

/** The player page for a book's accepted runs, or null when it has none; with the Content-Security-Policy that admits exactly its inline scripts. */
export async function simulationPage(workspace, { title = 'Simulation' } = {}) {
  const runs = await playableRuns(workspace);
  if (!runs.length) return null;
  const { inlineStrand } = await import(pathToFileURL(`${repo}/playground/export-strand-demo.mjs`).href);
  const template = await readFile(`${repo}/playground/strand-demo.html`, 'utf8');
  const html = inlineStrand(template, { strands: runs.map(({ id, label, name, data }) => ({ id, label, name, data })) }, { name: title, vendor: true });
  // The import map and the player are inline scripts: allow those two by hash, nothing else inline (the data block is JSON, never run).
  const hashes = [...html.matchAll(/<script(?![^>]*type="application\/json")[^>]*>([\s\S]*?)<\/script>/g)].map(match => `'sha256-${createHash('sha256').update(match[1]).digest('base64')}'`);
  const policy = `default-src 'self'; script-src 'self' ${hashes.join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self' data:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; frame-ancestors 'none'; base-uri 'none'`;
  return { html, policy, runs: runs.map(({ id, run }) => ({ id, run })) };
}

/** three.js for the player, from the app's own dependency: only the files the page imports. */
const VENDOR = {
  'three.module.js': 'apps/playground/node_modules/three/build/three.module.js',
  'three.core.js': 'apps/playground/node_modules/three/build/three.core.js',
  'addons/controls/OrbitControls.js': 'apps/playground/node_modules/three/examples/jsm/controls/OrbitControls.js',
};
export async function simulationVendor(file) {
  const path = Object.hasOwn(VENDOR, file) ? VENDOR[file] : null;
  return path ? readFile(`${repo}/${path}`) : null;
}
