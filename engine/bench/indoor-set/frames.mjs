// A run's frames beside the benchmark's, frame by frame (the user, 2026-11-13: "I still want you to check screenshot by
// screenshot how our automated process is lacking from your given example"). For each moment of standard.json the run's
// page is played at the same share of the same unit, its camera where the clip's stands relative to its room (the set: the
// set view; eye level: inside by the door at 1.6 m facing the window wall; from outside: across the street from the window
// wall, rising toward the room), with the story's sky; the clip's frame and the run's are put side by side in one picture.
// Nothing is judged here: the pictures are for the eye (check.mjs measures).
//
//   node engine/bench/indoor-set/frames.mjs <novel-dir> --run <run id> --out <folder>
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inlineStrand } from '../../world/export-strand-demo.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '..', '..', '..');
const ease = t => t * t * (3 - 2 * t), clamp = t => Math.max(0, Math.min(1, t)), lerp = (a, b, t) => a + (b - a) * t;

/**
 * The clip's camera for a moment, in the clip's room frame: `out` metres out from the window wall (negative: inside, toward
 * the door), `side` across it, `up` above the room's floor, and where it looks in the same frame. The clip's room: its window
 * wall at x = 6, 4.5 m deep (x 1.5 to 6) and 6 m across (z -3 to 3), its floor at y = 0 (clip.html).
 */
export function clipCamera(shot, t) {
  const wall = 6, frame = ([x, y, z]) => ({ out: x - wall, side: z, up: y });
  if (shot === 'eye') { const k = ease(clamp(t / 10)); return { from: frame([lerp(1.85, 2.15, k), 1.6, lerp(2.7, 2.5, k)]), to: frame([6, lerp(1.45, 1.35, k), lerp(-0.7, -1.1, k)]), fov: 42 }; }
  if (shot === 'outside' && t < 7.2) { const k = ease(clamp(t / 7.2)); return { from: frame([lerp(36, 18, k), lerp(-6, 2.5, k), lerp(14, 6, k)]), to: frame([lerp(6, 4, k), lerp(0, 0.8, k), lerp(0, 0.2, k)]), fov: 42 }; }
  return null; // the set (and the end of the shot from outside): the page's own set camera
}

/** A clip-frame point placed on a run's room: scaled so the clip's 4.5 m depth is the room's depth toward its windows. */
function placed(room, point) {
  const [ox, oz] = room.out, [sx, sz] = [-oz, ox], wallX = room.at[0] + ox * room.halfOut, wallZ = room.at[2] + oz * room.halfOut;
  const depth = point.out < 0 ? point.out * (room.halfOut * 2 / 4.5) : point.out, across = point.side * (room.halfSide * 2 / 6);
  return [wallX + ox * depth + sx * across, room.at[1] + point.up, wallZ + oz * depth + sz * across];
}

export async function framesOf(novelDir, { run, out, log = console.error }) {
  const novel = resolve(novelDir), standard = JSON.parse(await readFile(join(here, 'standard.json'), 'utf8'));
  const page = JSON.parse(await readFile(join(novel, 'stage', 'simulation', 'runs', 'director', `${run}.page.json`), 'utf8'));
  const script = JSON.parse(await readFile(join(novel, 'stage', 'world', 'script.json'), 'utf8'));
  const bound = JSON.parse(await readFile(join(novel, 'stage', 'world', 'rooms.json'), 'utf8').catch(() => 'null'))?.rooms ?? {};
  const chainOf = id => { const chain = []; for (let at = id, guard = 0; at && guard < 16; at = script.places?.[at]?.parent, guard++) chain.push(at); return chain; };
  const bindingOf = unitId => { const place = script.scenes?.find(scene => scene.id === unitId)?.place, room = place ? chainOf(place).find(id => bound[id]) : null; return room ? bound[room] : null; };
  const { browser, serve } = await import('../../view/two-view-things.mjs'), { VENDOR_FILES } = await import('../../live/sim-jev.mjs');
  const work = join(out, 'page'), pairs = join(out, 'pairs');
  await mkdir(pairs, { recursive: true });
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  await writeFile(join(work, 'index.html'), inlineStrand(await readFile(join(repository, 'engine', 'view', 'strand-demo.html'), 'utf8'), page, { vendor: true }));
  const server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true }), result = [];
  // The benchmark's room for every shot: the bound room of the set's unit (the clip plays all three in one room).
  const home = bindingOf(standard.shots[0].unit);
  try {
    await chrome.size(1440, 810);
    await chrome.open(server.url);
    await new Promise(done => setTimeout(done, 5000));
    const units = new Map((await chrome.evaluate('window.__units()')).map(unit => [unit.id, unit]));
    const room = home ? await chrome.evaluate(`window.__roomFrame(${home.lot}, ${home.room})`) : null;
    for (const shot of standard.shots) for (const moment of shot.moments) {
      const unit = units.get(shot.unit), length = { set: 11, eye: 10, outside: 11 }[shot.id] ?? 10;
      if (!unit || !room) { result.push({ moment: moment.id, missing: !unit ? 'the unit is not in this run' : 'no bound room' }); continue; }
      const at = unit.start + (unit.end - unit.start) * Math.min(0.98, moment.t / length), cam = clipCamera(shot.id, moment.t);
      const base = { id: `${moment.id}-run`, scene: unit.id, place: unit.place, at, people: true, frame: [1440, 810], storySky: true };
      await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, id: 'warm' })})`);
      await new Promise(done => setTimeout(done, 900));
      const options = cam ? { ...base, view: { position: placed(room, cam.from), target: placed(room, cam.to), fov: cam.fov } } : { ...base, set: { lot: home.lot, room: home.room, floor: home.floor } };
      await chrome.evaluate(`window.__stage.capture(${JSON.stringify(options)})`);
      await new Promise(done => setTimeout(done, 400));
      const file = join(out, `${moment.id}-run.png`);
      await writeFile(file, Buffer.from(await chrome.still('png'), 'base64'));
      const sky = (await chrome.evaluate('window.__replay()'))?.sky ?? null;
      result.push({ moment: moment.id, unit: unit.id, at: Math.round(at * 10) / 10, camera: cam ? 'clip' : 'set', run: file, sky: sky ? { hour: sky.hour, weather: sky.weather } : null });
      log(`${moment.id}: ${unit.id} at ${Math.round(at)} s (${cam ? 'the clip\'s camera' : 'the set view'})`);
    }
    // The pairs: the clip's frame left, the run's right, each moment one picture.
    const label = text => `<div style="position:absolute;left:10px;top:8px;font:600 22px system-ui;color:#fff;background:#000a;padding:3px 9px;border-radius:4px">${text}</div>`;
    for (const entry of result.filter(item => item.run)) {
      const clip = await readFile(join(here, 'reference', `${entry.moment}.png`)), mine = await readFile(entry.run);
      const html = `<body style="margin:0;background:#000;display:flex;gap:8px"><div style="position:relative"><img style="width:960px;display:block" src="data:image/png;base64,${clip.toString('base64')}">${label(`Benchmark · ${entry.moment}`)}</div><div style="position:relative"><img style="width:960px;display:block" src="data:image/png;base64,${mine.toString('base64')}">${label(`Run ${run} · ${entry.unit}`)}</div></body>`;
      await chrome.size(1928, 540);
      await chrome.evaluate(`document.open(); document.write(${JSON.stringify(html)}); document.close();`);
      await new Promise(done => setTimeout(done, 500));
      entry.pair = join(pairs, `${entry.moment}.png`);
      await writeFile(entry.pair, Buffer.from(await chrome.still('png'), 'base64'));
    }
  } finally { await chrome.close(); server.server.close(); }
  await writeFile(join(out, 'frames.json'), JSON.stringify({ run, room: home, frames: result }, null, 1));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { run: { type: 'string' }, out: { type: 'string' } } });
  if (!novelDir || !values.run || !values.out) { console.error('usage: node engine/bench/indoor-set/frames.mjs <novel-dir> --run <id> --out <folder>'); process.exit(2); }
  const result = await framesOf(novelDir, { run: values.run, out: resolve(values.out) });
  console.log(JSON.stringify(result.map(entry => ({ moment: entry.moment, pair: entry.pair ?? null, missing: entry.missing ?? null }))));
  process.exit(0);
}
