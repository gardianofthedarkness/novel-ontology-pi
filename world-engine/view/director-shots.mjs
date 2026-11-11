// The director's shots for one person at a scene's start (docs/v3/design.html#director-camera §2), drawn by the camera operator
// (src/v2/context/camera.ts) on the world as last built (stage/simulation/live/page.json), with no model call: a, the
// fourteen lettered arrows; b, the chosen arrow and its wedge; c1, the plan framed along it; c2, a rough box's column from
// the side with its heights lettered, and the box zoomed top-down. For looking at the shots before Jev answers on them.
//   npm run build && node world-engine/view/director-shots.mjs <novel-dir> --scene <scene-id> [--who <name>] [--arrow <letter>] [--way walk] --out <dir>
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { browser, serve } from './two-view-things.mjs';
import { inlineStrand } from '../world/export-strand-demo.mjs';
import { VENDOR_FILES } from '../live/sim-jev.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const C = await import(pathToFileURL(join(repository, 'dist/src/v2/context/camera.js')).href);
const CELL = 2, FLOOR = 3;

export async function directorShots(novelDir, { scene, who = null, arrow = 'A', way = 'walk', out }) {
  const data = JSON.parse(await readFile(join(novelDir, 'stage', 'simulation', 'live', 'page.json'), 'utf8'));
  const template = await readFile(join(repository, 'world-engine', 'view', 'strand-demo.html'), 'utf8');
  await mkdir(out, { recursive: true });
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(out, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(out, 'vendor', path)); }
  await writeFile(join(out, 'index.html'), inlineStrand(template, data, { vendor: true }));
  const { server, url } = await serve(join(out, 'index.html'), join(out, 'vendor')), chrome = await browser({ gpu: true });
  const shots = [];
  try {
    await chrome.open(url);
    const card = await chrome.evaluate(`window.__stage.sceneCard(${JSON.stringify(scene)})`);
    if (!card?.people.length) throw new Error(`nobody stands in ${scene}`);
    const person = card.people.find(entry => !who || entry.name === who || entry.id === who) ?? card.people[0], at = person.at;
    const chosen = C.DIRECTIONS.find(entry => entry.letter === arrow) ?? C.DIRECTIONS[0], reach = C.REACH[way] ?? C.REACH.walk;
    const shoot = async (name, size, options) => { await chrome.size(...size); const view = await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: name, place: card.place, at: card.at, people: true, mask: true, frame: size, only: [card.place], mover: person.id, ...options })})`); const file = join(out, `${name}.png`); await writeFile(file, Buffer.from(await chrome.still('png'), 'base64')); shots.push({ name, file, view }); return view; };
    const focus = { x: at[0], z: at[2], y0: at[1], w: 6, d: 6, h: 3 };
    // a: every arrow, a fixed length for reading (not the reach), from 35° above.
    const shown = 9;
    await shoot('a-direction', [1440, 900], { focus, radius: 16, elevation: 35, arrows: C.DIRECTIONS.map(d => ({ at, vector: d.vector, letter: d.letter, color: d.color, length: shown })) });
    // b: the chosen arrow and its wedge, as far as the move reaches.
    const wedge = C.wedgeOnGround(at, chosen.vector, reach);
    await shoot('b-spot', [1440, 900], { focus, radius: Math.max(16, reach * 0.7), elevation: 35, arrows: [{ at, vector: chosen.vector, letter: chosen.letter, color: chosen.color, length: Math.min(reach, 30) }], ...(wedge ? { wedge: { points: wedge, y: at[1], color: chosen.color } } : {}) });
    // c1: the plan along the arrow.
    const frame = C.frameAlong(at, chosen.vector, reach), half = (frame[2] - frame[0]) / 2;
    const step = half > 60 ? 20 : half > 25 ? 10 : 5;
    const map = await shoot('c1-rough', [1024, 1024], { topdown: { x: (frame[0] + frame[2]) / 2, z: (frame[1] + frame[3]) / 2, half }, grid: { box: frame, step, y: at[1] }, arrows: [{ at, vector: chosen.vector, letter: chosen.letter, color: chosen.color, length: Math.min(reach, half) }], ...(wedge ? { wedge: { points: wedge, y: at[1], color: chosen.color } } : {}) });
    // c2: a rough box where the arrow reaches (Jev's in a run), its column from the side, its heights lettered.
    const end = C.arrowEnd(at, chosen.vector, reach * 0.6), rough = [end[0] - 6, end[2] - 6, end[0] + 6, end[2] + 6];
    const lots = [...(data.world?.lots ?? []), ...(data.world?.shells ?? [])].filter(lot => lot.i0 * CELL < rough[2] && (lot.i0 + lot.nx) * CELL > rough[0] && lot.j0 * CELL < rough[3] && (lot.j0 + lot.nz) * CELL > rough[1]);
    // The column's air as high as the way may go: a flight to 60 m, a leap a little over the roofs, else a storey over them.
    const roofs = Math.max(0, ...lots.map(lot => (lot.height ?? lot.floors ?? 1) * FLOOR)), top = way === 'flight' ? 60 : way === 'leap' ? roofs + 15 : roofs + 5;
    const slices = C.columnSlices(lots.map((lot, n) => ({ name: lot.label ?? lot.role ?? `building ${n + 1}`, bottom: 0, floors: lot.height ?? lot.floors ?? 1 })), { top });
    const side = C.sideView(rough, chosen.vector, slices);
    const radius = Math.max(12, side.focus.h * 0.55), distance = radius / Math.tan(Math.PI / 8);
    await shoot('c2-height', [1440, 900], { focus: side.focus, radius, vague: { near: distance * 1.05, far: distance * 1.9 }, yaw: side.yaw, elevation: side.elevation, slices: slices.map(slice => ({ box: rough, y: slice.y, label: `${slice.letter} ${slice.said}` })), arrows: [{ at, vector: chosen.vector, letter: chosen.letter, color: chosen.color, length: Math.min(reach, 20) }] });
    await shoot('c2-exact', [1024, 1024], { topdown: { x: end[0], z: end[2], half: 10 }, grid: { box: [end[0] - 10, end[2] - 10, end[0] + 10, end[2] + 10], step: 1, y: 0 }, arrows: [{ at, vector: chosen.vector, letter: chosen.letter, color: chosen.color, length: Math.min(reach, 20) }] });
    const manifest = { scene, person: person.name, at, arrow: chosen.letter, way, reach, frame, map: map?.map ?? null, rough, slices };
    await writeFile(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
    return { shots: shots.map(shot => shot.file), manifest };
  } finally { await chrome.close(); server.close(); }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { scene: { type: 'string' }, who: { type: 'string' }, arrow: { type: 'string' }, way: { type: 'string' }, out: { type: 'string' } } });
  if (!novelDir || !values.scene || !values.out) { console.error('usage: node world-engine/view/director-shots.mjs <novel-dir> --scene <id> [--who <name>] [--arrow A] [--way walk] --out <dir>'); process.exit(2); }
  const result = await directorShots(resolve(novelDir), { scene: values.scene, who: values.who ?? null, arrow: values.arrow ?? 'A', way: values.way ?? 'walk', out: resolve(values.out) });
  console.log(JSON.stringify({ shots: result.shots, person: result.manifest.person, arrow: result.manifest.arrow, slices: result.manifest.slices.length }));
}
