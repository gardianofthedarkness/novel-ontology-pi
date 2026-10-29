#!/usr/bin/env node
/**
 * Jev places the things a strand puts in its places, from pictures the reader would see: the stage's capture loop,
 * tried on the strand demo. Three calls:
 *   0. once per thing, which model it is: a choice on a labelled sheet of every model the stage can draw (the Kenney
 *      buildings) and the basic shapes (box, oval, triangle, diamond, donut; a sphere is an oval in a cube-shaped cast);
 * then for every placement, a box question (Jev 1.14: one bounding box as fractions of the picture) and a yes/no on
 * whether the spot is in the picture at all, on
 *   1. the place at that moment from the reader's camera;
 *   2. the same moment from the side, lowered to a near-level look and aimed at the first box drawn in as a beam
 *      (everything that box could mean in 3D), at six turns (±45°, ±90°, ±135°) in one call: Jev's box and confidence
 *      for each, so the turn it is surest of is kept (one whose box pins a stretch of the beam first);
 *   3. only when the best turn is still unsure (confidence under --low, or its box spans the beam): the same moment from
 *      above, aimed at the beam, whose box pins the footprint even for a thing in the air.
 * The points of the place all the kept pictures show inside their boxes are the cast: its position, size and height.
 * The exporter fits the picked model into it, as large as fits. The report keeps every turn's confidence, so how sure Jev
 * is by turn can be compared over the same scenes (printed at the end).
 *
 *   node playground/two-view-things.mjs <strand-page.html> <novel-dir> --vendor <dir> [--out <dir>] [--max N] [--fresh] [--resweep] [--resolve] [--low 0.5] [--model jev-1.14.0]
 *
 * --reask keeps the models and asks every view again; --resweep keeps the models and the reader's-view boxes and asks the
 * side and top views again; --resolve re-renders the views of answers already given and solves them again, with no Jev
 * calls. Every still sees through the buildings in front of what it looks at (the beam, or the people there).
 *
 * --method candidates (the default) places by candidates (see byCandidates); --method boxes runs the box loop above; --use choice|marker|ghost picks which of its casts
 * the exporter gets (default ghost: the surest). The run ends with a comparison of its options over the same placements.
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

/** The side view's turns, in degrees from the reader's view, each a picture named for its turn. */
const TURNS = [-135, -90, -45, 45, 90, 135], picture = turn => `side_${turn < 0 ? 'm' : 'p'}${Math.abs(turn)}`;

/** One Jev call on several stills of one moment: a box and its confidence on each. */
async function askMany(jev, state, stills, name) {
  const answers = await jev.decide(state, stills.map(({ turn }) => ({ key: picture(turn), primitive: 'box', instructions: `${name} in picture "${picture(turn)}": the space it takes up where this event puts it, its whole extent at its size.` })), { images: Object.fromEntries(stills.map(({ turn, still }) => [picture(turn), still])) });
  const pct = value => Math.round(value * 100);
  return stills.map(({ turn }, n) => ({ turn, box: answers[n].box, confidence: answers[n].confidence ?? 0, label: `x ${pct(answers[n].box.left)}–${pct(answers[n].box.right)}%, y ${pct(answers[n].box.top)}–${pct(answers[n].box.bottom)}%` }));
}

/**
 * Placing by candidates: spots from the scene, a choice among them, then boxes on zoomed stills of the chosen spot.
 *   Call 1: the reader's view with every spot drawn as a lettered white ghost of the thing; Jev picks one, or none.
 *   Call 2: four close-ups of the chosen spot in one call, a box on each: from the reader's side and from a low look
 *           turned 90°, each once with only a ring at the spot's base and once with the ghost drawn there.
 * Three casts come out: the chosen spot at the thing's usual size (choice), the ring close-ups' boxes solved around the
 * spot (marker), and the ghost close-ups' boxes solved around it (ghost).
 * The choice always offers "sky" too. Sky counts when Jev picks it at least twice as likely as "none" (otherwise it is
 * only a way of saying no ground spot fits, and the likeliest spot is zoomed on). Then two turns from two directions of
 * the sky (high up, looking down so the ground shows, height poles at the people and the nearest spots as a ruler)
 * replace the close-ups: the first, a choice on lettered sky ghosts (15, 30 and 50 m up over the people, the middle and
 * the buildings the event names), finds it (skyChoice); the second zooms on the chosen ghost and boxes it from both
 * directions, which locks its place and size (sky2).
 */
async function byCandidates({ chrome, jev, base, key, thing, about, kept, out, slug, use }) {
  const w = thing.size, h = thing.height, d = thing.shape === 'box' && !thing.model ? Math.max(1.2, thing.size * 0.35) : thing.size, form = { model: thing.model, shape: thing.shape };
  const capture = options => chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, mask: true, ...options })})`);
  let calls = 0;
  await capture({ id: `${key}#look` });
  const spots = await chrome.evaluate(`window.__stage.candidates(${JSON.stringify({ place: base.place, thing: { w, h, d, airborne: thing.airborne } })})`);
  if (!spots.length) return { calls, record: { spots }, box: null };
  await capture({ id: `${key}#spots`, ghosts: spots, form });
  const picture = await chrome.still(), letters = spots.map(spot => spot.label);
  const choice = kept?.choice ?? await (async () => {
    calls++;
    const [answer] = await jev.decide([...about, `Picture "spots": the place as the reader sees it at this moment, with ${letters.length} white ghosts of ${thing.name}, each lettered: the spots it might take.`].join('\n'),
      [{ key: 'spot', primitive: 'choice', instructions: `Which lettered ghost in picture "spots" stands where this event puts ${thing.name}? Answer sky if it is up in the air above the place, none if no ghost is close.`, options: [...letters, 'sky', 'none'], optionHints: Object.fromEntries([...spots.map(spot => [spot.label, `${spot.label}: the ghost lettered ${spot.label}, by ${spot.from}`]), ['sky', 'sky: up in the air above the place, not standing on the ground or on a building'], ['none', 'none: no ghost is close to where it goes']]) }], { images: { spots: picture } });
    return { pick: answer.value, confidence: answer.confidence ?? null, distribution: answer.distribution ?? {} };
  })();
  const round = value => Math.round(value * 10) / 10, cast = solved => solved && { x: solved.x.map(round), y: solved.y.map(round), z: solved.z.map(round) };
  const sky = choice.pick === 'sky' && (choice.distribution.sky ?? 0) >= 2 * (choice.distribution.none ?? 0);
  if (sky) {
    // Two turns, each from two directions of the sky, high up and looking down so the ground shows, poles as a ruler.
    const poles = spots.slice(0, 3), directions = [['a', -45], ['b', 45]];
    const skySpots = await chrome.evaluate(`window.__stage.skySpots(${JSON.stringify({ place: base.place, thing: { w, h, d } })})`);
    // Turn 1, find: every sky spot as a lettered white ghost, seen from both directions; one choice on both pictures.
    const span = { x: Math.min(...skySpots.map(spot => spot.x)), X: Math.max(...skySpots.map(spot => spot.x)), z: Math.min(...skySpots.map(spot => spot.z)), Z: Math.max(...skySpots.map(spot => spot.z)) };
    const middle = { x: (span.x + span.X) / 2, z: (span.z + span.Z) / 2, y0: 25, w, h, d }, wide = Math.max(30, Math.hypot(span.X - span.x, span.Z - span.z) / 2 + Math.max(w, d) + 10), found = [];
    for (const [name, yaw] of directions) { await capture({ id: `${key}#sky_${name}`, focus: middle, radius: wide, yaw: yaw * Math.PI / 180, elevation: 35, poles, ghosts: skySpots, form }); found.push({ name: `sky_${name}`, still: await chrome.still() }); }
    const skyChoice = kept?.sky?.choice ?? await (async () => {
      calls++;
      const skyLetters = skySpots.map(spot => spot.label);
      const [answer] = await jev.decide([...about, `Pictures "sky_a" and "sky_b": the sky over the place at this moment from two directions, high up and looking down so the ground shows, with the same ${skyLetters.length} lettered white ghosts of ${thing.name} in both: the places in the air it might be. Thin white poles beside the people are marked at 10, 20, 40 and 60 m.`].join('\n'),
        [{ key: 'sky', primitive: 'choice', instructions: `Which lettered ghost in pictures "sky_a" and "sky_b" is where this event puts ${thing.name} in the air? Answer none if no ghost is close.`, options: [...skyLetters, 'none'], optionHints: Object.fromEntries([...skySpots.map(spot => [spot.label, `${spot.label}: the ghost lettered ${spot.label}, ${spot.from}`]), ['none', 'none: no ghost is close to where it is']]) }], { images: Object.fromEntries(found.map(({ name, still }) => [name, still])) });
      return { pick: answer.value, confidence: answer.confidence ?? null, distribution: answer.distribution ?? {} };
    })();
    const skyLikeliest = Object.entries(skyChoice.distribution).filter(([letter]) => letter !== 'none').sort((a, b) => b[1] - a[1])[0]?.[0], up = skySpots.find(spot => spot.label === skyChoice.pick) ?? skySpots.find(spot => spot.label === skyLikeliest) ?? skySpots[0];
    // Turn 2, lock: zoomed on the chosen ghost from both directions, a box on each.
    const close = Math.max(12, 1.8 * Math.max(w, d, h)), locks = [];
    for (const [name, yaw] of directions) { await capture({ id: `${key}#lock_${name}`, focus: up, radius: close, yaw: yaw * Math.PI / 180, elevation: 35, poles, ghosts: [{ ...up, label: '' }], form }); locks.push({ name: `lock_${name}`, still: await chrome.still() }); }
    const lock = kept?.sky?.lock ?? await (async () => {
      calls++;
      const result = await jev.decide([...about, `Pictures "lock_a" and "lock_b": close-ups of the sky over the place at this moment from two directions, high up and looking down so the ground shows, with a white ghost of ${thing.name} where it was picked to be. Thin white poles beside the people are marked at 10, 20, 40 and 60 m.`].join('\n'),
        locks.map(({ name }) => ({ key: name, primitive: 'box', instructions: `${thing.name} up in the air in picture "${name}": the space it takes up where this event puts it, its whole extent at its true size.` })), { images: Object.fromEntries(locks.map(({ name, still }) => [name, still])) });
      return Object.fromEntries(locks.map(({ name }, n) => [name, { box: result[n].box, confidence: result[n].confidence ?? 0 }]));
    })();
    const locked = cast(await chrome.evaluate(`window.__stage.solve(${JSON.stringify({ place: base.place, hull: true, around: { x: up.x, z: up.z, r: close, y: [3, 90] }, views: locks.map(({ name }) => ({ camera: `${key}#${name}`, box: lock[name].box })) })})`));
    const casts = { skyChoice: { x: [up.x - w / 2, up.x + w / 2].map(round), y: [up.y0, up.y0 + h].map(round), z: [up.z - d / 2, up.z + d / 2].map(round) }, sky2: locked };
    if (out) {
      await writeFile(join(out, `${slug}-spots.png`), Buffer.from(picture, 'base64'));
      for (const { name, still } of [...found, ...locks]) await writeFile(join(out, `${slug}-${name}.png`), Buffer.from(still, 'base64'));
      if (locked) { await capture({ id: 'check', focus: up, radius: Math.max(20, 2 * Math.max(w, d, h)), elevation: 25, poles, solved: locked }); await writeFile(join(out, `${slug}-check-sky.png`), Buffer.from(await chrome.still(), 'base64')); }
    }
    return { calls, record: { spots, choice, chosen: 'sky', skySpots, sky: { choice: skyChoice, picked: up.label, lock }, casts }, box: casts.sky2 ?? casts.skyChoice };
  }
  // "None" still zooms on the likeliest lettered spot, flagged.
  const likeliest = Object.entries(choice.distribution).filter(([letter]) => letter !== 'none' && letter !== 'sky').sort((a, b) => b[1] - a[1])[0]?.[0], chosen = spots.find(spot => spot.label === choice.pick) ?? spots.find(spot => spot.label === likeliest) ?? spots[0];
  const views = [['near', 0, null, 'marker'], ['side', 90, 12, 'marker'], ['near_ghost', 0, null, 'ghost'], ['side_ghost', 90, 12, 'ghost']], stills = [];
  for (const [name, turn, elevation, kind] of views) {
    await capture({ id: `${key}#${name}`, focus: chosen, yaw: turn * Math.PI / 180, ...(elevation === null ? {} : { elevation }), ...(kind === 'marker' ? { marker: chosen } : { ghosts: [{ ...chosen, label: '' }], form }) });
    stills.push({ name, still: await chrome.still() });
  }
  const zoom = kept?.zoom ?? await (async () => {
    calls++;
    const answers = await jev.decide([...about, `Pictures ${stills.map(({ name }) => `"${name}"`).join(', ')}: close-ups of the spot picked for ${thing.name} at this moment. "near" and "near_ghost" look from the reader's side; "side" and "side_ghost" from the side, turned 90° and low. In "near" and "side" a white ring marks the spot's base; in "near_ghost" and "side_ghost" a white ghost shows the thing there at its usual size.`].join('\n'),
      stills.map(({ name }) => ({ key: name, primitive: 'box', instructions: `${thing.name} in picture "${name}": the space it takes up where this event puts it, its whole extent at its true size.` })), { images: Object.fromEntries(stills.map(({ name, still }) => [name, still])) });
    return Object.fromEntries(stills.map(({ name }, n) => [name, { box: answers[n].box, confidence: answers[n].confidence ?? 0 }]));
  })();
  const around = { x: chosen.x, z: chosen.z, r: Math.max(9, 1.6 * Math.max(w, d, h)) };
  const solveFrom = (a, b) => chrome.evaluate(`window.__stage.solve(${JSON.stringify({ place: base.place, around, views: [{ camera: `${key}#${a}`, box: zoom[a].box }, { camera: `${key}#${b}`, box: zoom[b].box }] })})`);
  const casts = { choice: { x: [chosen.x - w / 2, chosen.x + w / 2].map(round), y: [chosen.y0, chosen.y0 + h].map(round), z: [chosen.z - d / 2, chosen.z + d / 2].map(round) }, marker: cast(await solveFrom('near', 'side')), ghost: cast(await solveFrom('near_ghost', 'side_ghost')) };
  if (out) {
    await writeFile(join(out, `${slug}-spots.png`), Buffer.from(picture, 'base64'));
    for (const { name, still } of stills) await writeFile(join(out, `${slug}-${name}.png`), Buffer.from(still, 'base64'));
    for (const variant of ['marker', 'ghost']) if (casts[variant]) { await capture({ id: 'check', focus: chosen, solved: casts[variant], boxes: [{ box: zoom[variant === 'marker' ? 'near' : 'near_ghost'].box, color: '#7ce6ff' }] }); await writeFile(join(out, `${slug}-check-${variant}.png`), Buffer.from(await chrome.still(), 'base64')); }
  }
  return { calls, record: { spots, choice, chosen: chosen.label, zoom, casts }, box: casts[use] ?? casts.choice };
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
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { vendor: { type: 'string' }, out: { type: 'string' }, max: { type: 'string' }, fresh: { type: 'boolean' }, reask: { type: 'boolean' }, resweep: { type: 'boolean' }, resolve: { type: 'boolean' }, low: { type: 'string', default: '0.5' }, method: { type: 'string', default: 'candidates' }, use: { type: 'string', default: 'ghost' }, model: { type: 'string', default: 'jev-1.14.0' } } });
  const [page, novelDir] = positionals.map(path => resolve(path));
  if (!page || !novelDir || !values.vendor) throw new Error('Usage: node playground/two-view-things.mjs <strand-page.html> <novel-dir> --vendor <dir> [--out <dir>] [--max N] [--fresh]');
  const load = path => import(pathToFileURL(`${repository}/${path}`));
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js');
  // Box questions need Jev 1.14; the analysis keeps its own pinned model.
  const jev = jevFromEnv({ ...process.env, JEV_MODEL: values.model }), report = `${novelDir}/stage/thing-boxes.json`, out = values.out ? resolve(values.out) : null;
  const previous = values.fresh ? null : JSON.parse(await readFile(report, 'utf8').catch(() => 'null'));
  const placements = values.reask ? {} : { ...(previous?.placements ?? {}) }, models = { ...(previous?.models ?? {}) }, started = Date.now();
  const library = JSON.parse(await readFile(`${repository}/apps/playground/src/data/architectureModels.json`, 'utf8')), keys = [...Object.keys(library.models), ...SHAPES];
  if (out) await mkdir(out, { recursive: true });
  const { server, url } = await serve(page, resolve(values.vendor)), chrome = await browser();
  let calls = 0, asked = 0, reused = 0, failed = 0;
  // Saved after every placement, so a stopped run keeps what it was told.
  const save = () => writeFile(report, JSON.stringify({ version: 1, model: jev.modelId, askedAt: new Date().toISOString(), models, placements }, null, 1), { mode: 0o644 });
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
      if (earlier && !values.resolve && !values.resweep) { reused++; continue; }
      if (earlier) reused++; else asked++;
      const base = { scene: spot.scene, event: spot.event, place: spot.place, hide: [thing.id] }, keep = earlier && (values.resolve || values.resweep);
      const about = [
        `A still of a 3D model of a place in a novel, used to place one thing the story mentions.`,
        `Place: ${place.path.join(' › ')} (${place.kind} of ${place.lots} buildings). Blue lattices are the buildings' corridors and orange their stairs; gold shapes are things already there; small labelled dots are people.`,
        `Event: ${text}`,
        `Thing: ${thing.name}, about ${thing.size} m across${thing.airborne ? ', in the air' : ''}${models[thing.name] ? `, drawn as ${hint(models[thing.name].id)}` : ''}.`,
      ];
      if (values.method === 'candidates') {
        const slug = `${String(n + 1).padStart(2, '0')}-${thing.id}`, kept = values.resolve && earlier?.method === 'candidates' ? earlier : null;
        const placed = await byCandidates({ chrome, jev, base, key, thing, about, kept, out, slug, use: values.use });
        calls += placed.calls; if (!placed.box) failed++;
        placements[key] = { inputs, thing: thing.name, detected: thing.size, airborne: thing.airborne, place: spot.place, method: 'candidates', ...placed.record, box: placed.box };
        await save();
        const round = value => Math.round(value * 10) / 10, size = cast => cast ? `${round(cast.x[1] - cast.x[0])}×${round(cast.z[1] - cast.z[0])}×${round(cast.y[1] - cast.y[0])} m at y ${cast.y[0]}` : 'none';
        const { choice, zoom, casts } = placed.record;
        const confidences = answers => Object.entries(answers ?? {}).map(([name, answer]) => `${name} ${answer.confidence.toFixed(2)}`).join(' ');
        console.error(`${thing.name} (${thing.size} m${thing.airborne ? ', air' : ''}) @ ${spot.scene}#${spot.event}: ${placed.record.spots.length} spots, picked ${choice?.pick} (${choice?.confidence?.toFixed(2)}) → ${placed.record.chosen === 'sky' ? `sky ghost ${placed.record.sky.picked} of ${placed.record.skySpots.length} (${placed.record.sky.choice.pick}, ${placed.record.sky.choice.confidence?.toFixed(2)}) → lock ${confidences(placed.record.sky.lock)} → picked ${size(casts?.skyChoice)} | locked ${size(casts?.sky2)}` : `zoom ${confidences(zoom)} → choice ${size(casts?.choice)} | marker ${size(casts?.marker)} | ghost ${size(casts?.ghost)}`}`);
        continue;
      }
      // Call 1: the reader's view.
      await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, mask: true, id: `${key}#1` })})`);
      const first = await chrome.still();
      const one = keep ? earlier.views[0] : await ask(jev, [...about, `Picture "view": the place as the reader sees it at this moment.`].join('\n'), first, thing.name);
      if (!keep) calls++;
      const view1 = { camera: `${key}#1`, box: one.box }, solve = views => chrome.evaluate(`window.__stage.solve(${JSON.stringify({ place: spot.place, views })})`);
      // Call 2: the side view at every turn, in one call; each turn solved with view 1.
      const sides = [];
      for (const turn of TURNS) {
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, mask: true, id: `${key}#${turn}`, yaw: turn * Math.PI / 180, elevation: 12, aim: view1, beams: [view1] })})`);
        sides.push({ turn, still: await chrome.still() });
      }
      const swept = values.resolve && earlier?.sweep ? earlier.sweep : await askMany(jev, [...about, `Pictures ${TURNS.map(picture).join(', ')}: the same moment seen from the side and from low down, turned by the angle in each name (m: left, p: right, in degrees) from the reader's view. The orange beam is everything a box drawn on the reader's view could mean in 3D; ${thing.name} lies inside the beam.`].join('\n'), sides, thing.name);
      if (!(values.resolve && earlier?.sweep)) calls++;
      for (const side of swept) { const solved = await solve([view1, { camera: `${key}#${side.turn}`, box: side.box }]); side.cover = solved?.cover ?? null; side.uncertain = solved?.uncertain ?? true; }
      // The turn Jev is surest of, among those whose box pins a stretch of the beam (else among all).
      const pinned = swept.filter(side => !side.uncertain), best = (pinned.length ? pinned : swept).reduce((a, b) => (b.confidence > a.confidence ? b : a));
      const side = { camera: `${key}#${best.turn}`, box: best.box };
      // Call 3, only when still unsure: the view from above, aimed at the beam.
      let top = null;
      if (best.confidence < Number(values.low) || best.uncertain) {
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, mask: true, id: `${key}#top`, elevation: 84, aim: view1, beams: [view1] })})`);
        const above = await chrome.still();
        top = values.resolve && earlier?.top ? earlier.top : await ask(jev, [...about, `Picture "view": the same moment seen from above. The orange beam is everything a box drawn on the reader's view could mean in 3D; ${thing.name} lies inside the beam.`].join('\n'), above, thing.name);
        if (!(values.resolve && earlier?.top)) calls++;
        if (out) await writeFile(join(out, `${String(n + 1).padStart(2, '0')}-${thing.id}-top.png`), Buffer.from(above, 'base64'));
      }
      const solved = await solve([view1, side, ...(top ? [{ camera: `${key}#top`, box: top.box }] : [])]);
      // Carving from every still at once (view 1, all six turns, the top view), each box weighted by Jev's confidence.
      const carved = await chrome.evaluate(`window.__stage.carve(${JSON.stringify({ place: spot.place, views: [view1, ...swept.map(entry => ({ camera: `${key}#${entry.turn}`, box: entry.box, confidence: entry.confidence })), ...(top ? [{ camera: `${key}#top`, box: top.box, confidence: top.confidence }] : [])] })})`);
      const round = value => Math.round(value * 10) / 10, box = solved && { x: solved.x.map(round), y: solved.y.map(round), z: solved.z.map(round) };
      if (!box) failed++;
      placements[key] = { inputs, thing: thing.name, place: spot.place, views: [{ ...one, yaw: 0 }, { ...best, yaw: best.turn }], sweep: swept, top, box, carved: carved && { x: carved.x.map(round), y: carved.y.map(round), z: carved.z.map(round) }, hull: solved?.hull, cover: solved?.cover, uncertain: solved?.uncertain ?? null, points: solved?.points ?? 0 };
      if (out) {
        const slug = `${String(n + 1).padStart(2, '0')}-${thing.id}`;
        await writeFile(join(out, `${slug}-1.png`), Buffer.from(first, 'base64'));
        for (const { turn, still } of sides) await writeFile(join(out, `${slug}-side${turn}.png`), Buffer.from(still, 'base64'));
        // Check stills: the reader's view and the kept side view, each with its box (cyan) and the solved 3D box (green).
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, mask: true, id: 'check-1', boxes: [{ box: one.box, color: '#7ce6ff' }], solved: box })})`);
        await writeFile(join(out, `${slug}-check-1.png`), Buffer.from(await chrome.still(), 'base64'));
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, mask: true, id: 'check-2', yaw: best.turn * Math.PI / 180, elevation: 12, aim: view1, beams: [view1], boxes: [{ box: best.box, color: '#7ce6ff' }], solved: box })})`);
        await writeFile(join(out, `${slug}-check-2.png`), Buffer.from(await chrome.still(), 'base64'));
      }
      const size = box ? `${round(box.x[1] - box.x[0])}×${round(box.z[1] - box.z[0])}×${round(box.y[1] - box.y[0])} m at y ${box.y[0]}–${box.y[1]}` : 'no overlap';
      const turns = swept.map(entry => `${entry.turn > 0 ? '+' : ''}${entry.turn}° ${entry.confidence.toFixed(2)}${entry.uncertain ? '~' : ''}`).join(' ');
      console.error(`${thing.name} @ ${spot.scene}#${spot.event}: turns ${turns} → kept ${best.turn}°${top ? `, top view ${top.confidence?.toFixed(2)}` : ''} → ${size}${solved?.uncertain ? ', depth uncertain' : ''}; carved from all → ${carved ? `${round(carved.x[1] - carved.x[0])}×${round(carved.z[1] - carved.z[0])}×${round(carved.y[1] - carved.y[0])} m at y ${round(carved.y[0])}–${round(carved.y[1])}` : 'nothing'}`);
    }
  } finally { await chrome.close(); server.close(); }
  // Placing by candidates: how each option did over the same placements.
  const skied = Object.values(placements).filter(entry => entry.method === 'candidates' && entry.chosen === 'sky');
  if (skied.length) console.error(`sky picked ${skied.length}: ${skied.map(entry => `${entry.thing} ${entry.casts.sky2 ? `locked at y ${entry.casts.sky2.y[0]}–${entry.casts.sky2.y[1]}` : `picked at y ${entry.casts.skyChoice.y[0]}–${entry.casts.skyChoice.y[1]}`}`).join('; ')}`);
  const tried = Object.values(placements).filter(entry => entry.method === 'candidates' && entry.casts && entry.zoom);
  if (tried.length) {
    const sizeOf = cast => Math.max(cast.x[1] - cast.x[0], cast.z[1] - cast.z[0], cast.y[1] - cast.y[0]);
    const median = list => { const sorted = list.slice().sort((a, b) => a - b); return sorted.length ? Math.round(sorted[Math.floor(sorted.length / 2)] * 100) / 100 : null; };
    const mean = list => Math.round(list.reduce((sum, value) => sum + value, 0) / Math.max(1, list.length) * 100) / 100;
    const rows = ['choice', 'marker', 'ghost'].map(variant => { const done = tried.filter(entry => entry.casts[variant]); return `${variant}: solved ${done.length}/${tried.length}, largest side ÷ detected size (median) ${median(done.map(entry => sizeOf(entry.casts[variant]) / entry.detected))}, in the air ${done.filter(entry => entry.casts[variant].y[0] > 3).length}`; });
    console.error(`candidates: choice confidence ${mean(tried.map(entry => entry.choice.confidence ?? 0))} (none picked ${tried.filter(entry => entry.choice.pick === 'none').length}); zoom box confidence near ${mean(tried.map(entry => entry.zoom.near.confidence))}, side ${mean(tried.map(entry => entry.zoom.side.confidence))}, near_ghost ${mean(tried.map(entry => entry.zoom.near_ghost.confidence))}, side_ghost ${mean(tried.map(entry => entry.zoom.side_ghost.confidence))}; ${rows.join('; ')}`);
  }
  // How sure Jev is by turn, over the same scenes: mean box confidence, how often its box spans the beam, how often it was kept.
  const byTurn = Object.fromEntries(TURNS.map(turn => { const entries = Object.values(placements).map(entry => entry.sweep?.find(side => side.turn === turn)).filter(Boolean); return [turn, { confidence: Math.round(entries.reduce((sum, side) => sum + side.confidence, 0) / Math.max(1, entries.length) * 100) / 100, spans: entries.filter(side => side.uncertain).length, kept: Object.values(placements).filter(entry => entry.views?.[1]?.turn === turn).length, of: entries.length }]; }));
  console.error(`by turn (mean confidence, boxes spanning the beam, kept): ${Object.entries(byTurn).map(([turn, row]) => `${turn > 0 ? '+' : ''}${turn}° ${row.confidence} ${row.spans}/${row.of} ${row.kept}`).join(' | ')}; top views asked: ${Object.values(placements).filter(entry => entry.top).length}`);
  await writeFile(report, JSON.stringify({ version: 1, model: jev.modelId, askedAt: new Date().toISOString(), byTurn, models, placements }, null, 1), { mode: 0o644 });
  console.log(JSON.stringify({ report, placements: Object.keys(placements).length, asked, reused, failed, calls, seconds: (Date.now() - started) / 1000 }));
}
