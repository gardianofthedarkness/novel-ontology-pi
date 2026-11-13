// The indoor set's benchmark pictures (the user, 2026-11-12, of the indoor clip: "I really really liked the indoor scene
// demo you made and we should make it a bench mark. Our automated run for the first indoor scenes should exactly match it
// as standard"). clip.html is the clip as the user saw it, kept unchanged; this script plays it in a headless Chrome and
// takes its frames at the fixed moments standard.json names, without the captions, 1440 × 810, into reference/.
//
//   node engine/bench/indoor-set/reference.mjs [--out <folder>]
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { browser } from '../../view/two-view-things.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '..', '..', '..');
const THREE_FILES = { '/three.module.js': 'node_modules/three/build/three.module.js', '/three.core.js': 'node_modules/three/build/three.core.js' };
/** The clip with its stage over the whole window and the captions off: the picture alone. */
const STAGE_ONLY = '<style>.stage{position:fixed!important;inset:0!important;width:100vw!important;height:100vh!important;aspect-ratio:auto!important;border-radius:0!important;z-index:9}.tag,.callouts{display:none!important}</style>';

/** Serves the clip (with the stage-only style) and three.js from the repository's node_modules. */
export async function serveClip() {
  const page = (await readFile(join(here, 'clip.html'), 'utf8')) + STAGE_ONLY;
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://x').pathname;
    if (path === '/' || path === '/index.html') { response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(page); return; }
    const file = THREE_FILES[path];
    if (!file) { response.writeHead(404).end(); return; }
    response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(await readFile(join(repository, file)));
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { server, url: `http://127.0.0.1:${server.address().port}/index.html` };
}

/** The benchmark's frames: one PNG per moment of standard.json, written to `out`. */
export async function referenceStills(out = join(here, 'reference')) {
  const standard = JSON.parse(await readFile(join(here, 'standard.json'), 'utf8'));
  await mkdir(out, { recursive: true });
  const { server, url } = await serveClip(), chrome = await browser({ gpu: true }), written = [];
  try {
    await chrome.size(1440, 810);
    await chrome.evaluate(`location.href = ${JSON.stringify(url)}`).catch(() => {});
    for (let tries = 0; tries < 100; tries++) { if (await chrome.evaluate('!!window.__clip').catch(() => false)) break; await new Promise(done => setTimeout(done, 100)); }
    for (const shot of standard.shots) for (const moment of shot.moments) {
      await chrome.evaluate(`window.__clip.seek(${shot.clip}, ${moment.t})`);
      await new Promise(done => setTimeout(done, 400));
      const file = join(out, `${moment.id}.png`);
      await writeFile(file, Buffer.from(await chrome.still('png'), 'base64'));
      written.push(file);
    }
  } finally { await chrome.close(); server.close(); }
  return written;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values } = parseArgs({ options: { out: { type: 'string' } } });
  console.log(JSON.stringify(await referenceStills(values.out ? resolve(values.out) : undefined)));
  process.exit(0);
}
