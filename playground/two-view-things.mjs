#!/usr/bin/env node
/**
 * Jev places the things a strand puts in its places, from pictures the reader would see: the stage's capture loop,
 * tried on the strand demo. Three calls:
 *   0. once per thing, which model it is: a choice on a labelled sheet of every model the stage can draw (the Kenney
 *      buildings) and the basic shapes (box, oval, triangle, diamond, donut; a sphere is an oval in a cube-shaped cast);
 * then for every placement, a box question (Jev 1.14: one bounding box as fractions of the picture) and a yes/no on
 * whether the spot is in the picture at all, on
 *   1. the place at that moment from the reader's camera;
 *   2. the same moment from the side: turned 90° (left or right, drawn from the placement) and lowered to a near-level
 *      look, aimed at the first box drawn into it as a beam (everything that box could mean in 3D). From the side the
 *      beam's run and the thing's height read directly.
 * The points of the place both pictures show inside their boxes are the cast: its position, size and height. The
 * exporter fits the picked model into it, as large as fits.
 *
 *   node playground/two-view-things.mjs <strand-page.html> <novel-dir> --vendor <dir> [--out <dir>] [--max N] [--fresh] [--resolve] [--model jev-1.14.0]
 *
 * --resolve re-renders the two views of answers already given and solves them again, with no Jev calls.
 *
 * The page is the strand exporter's single-strand output with --vendor; <dir> holds its three.js files. Writes
 * <novel-dir>/stage/thing-boxes.json (read by the exporter) and, under --out, each still Jev saw and a check still per
 * view with both boxes and the solved 3D box drawn in. Answers are reused unless --fresh. Needs a Jev key (novel jev
 * login); renders with the installed Google Chrome, headless.
 */
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

/** The page and its three.js files on a local port, for the headless browser. */
async function serve(page, vendor) {
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript' };
  const server = createServer(async (request, response) => {
    const path = new URL(request.url, 'http://x').pathname;
    const file = path === '/' || path === '/index.html' ? page : path.startsWith('/vendor/') ? join(vendor, path.slice('/vendor/'.length)) : null;
    if (!file || file.includes('..')) { response.writeHead(404).end(); return; }
    try { response.writeHead(200, { 'Content-Type': types[extname(file)] ?? 'application/octet-stream' }).end(await readFile(file)); } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => server.listen(0, '127.0.0.1', done));
  return { server, url: `http://127.0.0.1:${server.address().port}/index.html?capture` };
}

/** Headless Chrome over the DevTools protocol: one page, evaluate and screenshot. */
async function browser() {
  const profile = await mkdtemp(join(tmpdir(), 'two-view-'));
  const chrome = spawn(CHROME, ['--headless=new', '--remote-debugging-port=0', `--user-data-dir=${profile}`, '--window-size=800,600', '--hide-scrollbars', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--no-first-run', '--no-default-browser-check', 'about:blank'], { stdio: 'ignore' });
  let port = null;
  for (let tries = 0; tries < 100 && !port; tries++) { port = await readFile(join(profile, 'DevToolsActivePort'), 'utf8').then(text => text.split('\n'), () => null); if (!port) await new Promise(done => setTimeout(done, 100)); }
  if (!port) throw new Error('Chrome did not start');
  const socket = new WebSocket(`ws://127.0.0.1:${port[0]}${port[1]}`), waiting = new Map();
  let id = 0;
  socket.onmessage = message => { const reply = JSON.parse(message.data); const entry = waiting.get(reply.id); if (!entry) return; waiting.delete(reply.id); if (reply.error) entry.reject(new Error(reply.error.message)); else entry.resolve(reply.result); };
  await new Promise((done, fail) => { socket.onopen = done; socket.onerror = fail; });
  const send = (method, params = {}, sessionId) => new Promise((done, fail) => { const n = ++id; waiting.set(n, { resolve: done, reject: fail }); socket.send(JSON.stringify({ id: n, method, params, ...(sessionId ? { sessionId } : {}) })); });
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' }), { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
  await send('Emulation.setDeviceMetricsOverride', { width: 800, height: 600, deviceScaleFactor: 1, mobile: false }, sessionId);
  const evaluate = async expression => { const { result, exceptionDetails } = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }, sessionId); if (exceptionDetails) throw new Error(exceptionDetails.exception?.description ?? exceptionDetails.text); return result.value; };
  return {
    open: async url => { await send('Page.navigate', { url }, sessionId); for (let tries = 0; tries < 300; tries++) { if (await evaluate('!!window.__stage').catch(() => false)) return; await new Promise(done => setTimeout(done, 100)); } throw new Error('The page did not start in capture mode'); },
    evaluate,
    still: async () => (await send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: 800, height: 600, scale: 1 } }, sessionId)).data,
    // Chrome writes its profile until it exits; a leftover temporary profile is no reason to lose a run.
    close: async () => { socket.close(); const exited = new Promise(done => chrome.once('exit', done)); chrome.kill(); await Promise.race([exited, new Promise(done => setTimeout(done, 3000))]); await rm(profile, { recursive: true, force: true }).catch(() => {}); },
  };
}

const SHAPES = ['box', 'oval', 'triangle', 'diamond', 'donut'];
/** What each model or shape on the sheet is, in words, beside its picture. */
const hint = key => key.startsWith('skyscraper') ? 'a skyscraper' : key.startsWith('tower') ? 'a slim tower block' : key.startsWith('block-wide') ? 'a wide low block' : key.startsWith('office') ? 'an office building'
  : ({ market: 'a market hall', keep: 'a castle keep', fountain: 'a fountain', windmill: 'a windmill', box: 'a box: vehicles, containers, machines', oval: 'an egg, capsule or ball: airships, pods, spheres', triangle: 'a triangular prism: roofs, ramps, tents', diamond: 'a diamond: crystals', donut: 'a ring: halos, wheels, rings' })[key] ?? key;

/** Call 0: which model or shape a thing is drawn as, picked from the labelled sheet. */
async function pickModel(jev, sheet, keys, thing, text) {
  const [answer] = await jev.decide([`Picture "models" is a sheet of every model and shape a 3D stage can draw, each labelled with its name.`, `A thing a novel mentions: ${thing.name}, about ${thing.size} m across${thing.airborne ? ', in the air' : ''}.`, `Where it is mentioned: ${text}`].join('\n'),
    [{ key: 'model', primitive: 'choice', instructions: `Which model or shape on picture "models" should ${thing.name} be drawn as: the one that looks most like it?`, options: keys, optionHints: Object.fromEntries(keys.map(key => [key, `${key}: ${hint(key)}`])) }], { images: { models: sheet } });
  const top = Object.entries(answer.distribution ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([key, p]) => [key, Math.round(p * 100) / 100]);
  return { id: answer.value, kind: SHAPES.includes(answer.value) ? 'shape' : 'model', confidence: answer.confidence ?? null, top };
}

/** One Jev call on one still: where the thing is (a box) and whether its spot is in the picture at all. */
async function ask(jev, state, still, name) {
  const [where, seen] = await jev.decide(state, [
    { key: 'where', primitive: 'box', instructions: `${name} in picture "view": the space it takes up where this event puts it, its whole extent at its size.` },
    { key: 'seen', primitive: 'noul', instructions: `Is the spot where this event puts ${name} inside picture "view"?` },
  ], { images: { view: still } });
  const pct = value => Math.round(value * 100);
  return { box: where.box, confidence: where.confidence ?? null, seen: Math.round(seen.value * 100) / 100, label: `x ${pct(where.box.left)}–${pct(where.box.right)}%, y ${pct(where.box.top)}–${pct(where.box.bottom)}%` };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { vendor: { type: 'string' }, out: { type: 'string' }, max: { type: 'string' }, fresh: { type: 'boolean' }, resolve: { type: 'boolean' }, model: { type: 'string', default: 'jev-1.14.0' } } });
  const [page, novelDir] = positionals.map(path => resolve(path));
  if (!page || !novelDir || !values.vendor) throw new Error('Usage: node playground/two-view-things.mjs <strand-page.html> <novel-dir> --vendor <dir> [--out <dir>] [--max N] [--fresh]');
  const load = path => import(pathToFileURL(`${repository}/${path}`));
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js');
  // Box questions need Jev 1.14; the analysis keeps its own pinned model.
  const jev = jevFromEnv({ ...process.env, JEV_MODEL: values.model }), report = `${novelDir}/stage/thing-boxes.json`, out = values.out ? resolve(values.out) : null;
  const previous = values.fresh ? null : JSON.parse(await readFile(report, 'utf8').catch(() => 'null'));
  const placements = { ...(previous?.placements ?? {}) }, models = { ...(previous?.models ?? {}) }, started = Date.now();
  const library = JSON.parse(await readFile(`${repository}/apps/playground/src/data/architectureModels.json`, 'utf8')), keys = [...Object.keys(library.models), ...SHAPES];
  if (out) await mkdir(out, { recursive: true });
  const { server, url } = await serve(page, resolve(values.vendor)), chrome = await browser();
  let calls = 0, asked = 0, reused = 0, failed = 0;
  try {
    await chrome.open(url);
    const stage = await chrome.evaluate('({ things: window.__stage.things, places: window.__stage.places, scenes: window.__stage.scenes })');
    const work = stage.things.flatMap(thing => thing.placed.map(spot => ({ thing, spot, key: `${spot.scene}|${spot.event}|${thing.name}` })));
    // Call 0, once per thing: the model, from one sheet of them all.
    if (stage.things.some(thing => !models[thing.name])) {
      await chrome.evaluate(`window.__stage.sheet(${JSON.stringify({ models: library.models, entries: keys })})`);
      const sheet = await chrome.still();
      if (out) await writeFile(join(out, '00-models.png'), Buffer.from(sheet, 'base64'));
      for (const thing of stage.things) {
        if (models[thing.name] || (values.max && calls >= Number(values.max) * 2)) continue;
        const first = thing.placed[0], text = stage.scenes.find(scene => scene.id === first.scene)?.events[first.event] ?? '';
        models[thing.name] = await pickModel(jev, sheet, keys, thing, text); calls++;
        console.error(`${thing.name}: drawn as ${models[thing.name].id} (${models[thing.name].top.map(([key, p]) => `${key} ${p}`).join(', ')})`);
      }
    }
    for (const [n, { thing, spot, key }] of work.entries()) {
      if (values.max && asked >= Number(values.max)) break;
      const place = stage.places[spot.place], text = stage.scenes.find(scene => scene.id === spot.scene)?.events[spot.event] ?? '';
      const inputs = createHash('sha256').update(JSON.stringify([key, spot.place, text, thing.size, thing.airborne])).digest('hex').slice(0, 16);
      const earlier = placements[key]?.inputs === inputs ? placements[key] : null;
      if (earlier && !values.resolve) { reused++; continue; }
      if (earlier) reused++; else asked++;
      // Left or right, drawn from the placement, so a re-run turns the same way.
      const yaw = (parseInt(inputs.slice(0, 2), 16) % 2 ? 1 : -1) * Math.PI / 2, base = { scene: spot.scene, event: spot.event, place: spot.place, hide: [thing.id] };
      const about = [
        `A still of a 3D model of a place in a novel, used to place one thing the story mentions.`,
        `Place: ${place.path.join(' › ')} (${place.kind} of ${place.lots} buildings). Blue lattices are the buildings' corridors and orange their stairs; gold shapes are things already there; small labelled dots are people.`,
        `Event: ${text}`,
        `Thing: ${thing.name}, about ${thing.size} m across${thing.airborne ? ', in the air' : ''}${models[thing.name] ? `, drawn as ${hint(models[thing.name].id)}` : ''}.`,
      ];
      await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, id: `${key}#1` })})`);
      const first = await chrome.still();
      const one = earlier ? earlier.views[0] : await ask(jev, [...about, `Picture "view": the place as the reader sees it at this moment.`].join('\n'), first, thing.name);
      if (!earlier) calls++;
      await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, id: `${key}#2`, yaw, elevation: 12, aim: { camera: `${key}#1`, box: one.box }, beams: [{ camera: `${key}#1`, box: one.box }] })})`);
      const second = await chrome.still();
      const two = earlier ? earlier.views[1] : await ask(jev, [...about, `Picture "view": the same moment seen from the side, turned 90° and from low down. The orange beam is everything a box drawn on the reader's view could mean in 3D; ${thing.name} lies inside the beam.`].join('\n'), second, thing.name);
      if (!earlier) calls++;
      const solved = await chrome.evaluate(`window.__stage.solve(${JSON.stringify({ place: spot.place, views: [{ camera: `${key}#1`, box: one.box }, { camera: `${key}#2`, box: two.box }] })})`);
      const round = value => Math.round(value * 10) / 10, box = solved && { x: solved.x.map(round), y: solved.y.map(round), z: solved.z.map(round) };
      if (!box) failed++;
      placements[key] = { inputs, thing: thing.name, place: spot.place, views: [{ ...one, yaw: 0 }, { ...two, yaw: Math.round(yaw * 180 / Math.PI) }], box, hull: solved?.hull, cover: solved?.cover, uncertain: solved?.uncertain ?? null, points: solved?.points ?? 0 };
      if (out) {
        const slug = `${String(n + 1).padStart(2, '0')}-${thing.id}`;
        await writeFile(join(out, `${slug}-1.png`), Buffer.from(first, 'base64'));
        await writeFile(join(out, `${slug}-2.png`), Buffer.from(second, 'base64'));
        // Check stills: each view with its own box (cyan), and the solved 3D box (green).
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, id: 'check-1', boxes: [{ box: one.box, color: '#7ce6ff' }], solved: box })})`);
        await writeFile(join(out, `${slug}-check-1.png`), Buffer.from(await chrome.still(), 'base64'));
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, id: 'check-2', yaw, elevation: 12, aim: { camera: `${key}#1`, box: one.box }, beams: [{ camera: `${key}#1`, box: one.box }], boxes: [{ box: two.box, color: '#7ce6ff' }], solved: box })})`);
        await writeFile(join(out, `${slug}-check-2.png`), Buffer.from(await chrome.still(), 'base64'));
      }
      const size = box ? `${round(box.x[1] - box.x[0])}×${round(box.z[1] - box.z[0])}×${round(box.y[1] - box.y[0])} m at y ${box.y[0]}–${box.y[1]}` : 'no overlap';
      console.error(`${thing.name} (${thing.size} m${thing.airborne ? ', in the air' : ''}) @ ${spot.scene}#${spot.event}: view 1 ${one.label} (spot in view ${one.seen}), view 2 ${two.label} covering ${Math.round((solved?.cover ?? 0) * 100)}% of the beam → ${size}${solved?.uncertain ? ', depth uncertain' : ''}`);
    }
  } finally { await chrome.close(); server.close(); }
  await writeFile(report, JSON.stringify({ version: 1, model: jev.modelId, askedAt: new Date().toISOString(), models, placements }, null, 1), { mode: 0o644 });
  console.log(JSON.stringify({ report, placements: Object.keys(placements).length, asked, reused, failed, calls, seconds: (Date.now() - started) / 1000 }));
}
