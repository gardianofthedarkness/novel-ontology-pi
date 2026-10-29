#!/usr/bin/env node
/**
 * A book's places built from the bottom up on the canvas (src/ground/stage/placeCanvas.ts):
 * - In story order, each place is born when the text first names it.
 * - A building (or room) brings each missing place above it into being: the open ones (city, district, street) as
 *   circles of their own, filled from their centres with Jev's landscape. The building takes a lot in the nearest of
 *   them.
 * - Then scenes drift past 第七学区's edge twice and it grows; the circles above it grow, and its neighbours are
 *   pushed aside whole.
 * - Stills of each stage. A mock: nothing is written to the book.
 *
 *   npm run build && node playground/canvas-mock.mjs <novel-dir> <types.json> --vendor <dir> --out <dir> [--grow <place label>]
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { browser, serve } from './two-view-things.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..'), load = path => import(pathToFileURL(`${repository}/${path}`));
const L = await load('dist/src/ground/stage/landscape.js'), C = await load('dist/src/ground/stage/placeCanvas.js'), { borrowLots } = await load('dist/src/ground/stage/cityFill.js');
const { stageInputs } = await load('dist/src/cli/commands/extract/stageCommands.js'), { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
const { values, positionals } = parseArgs({ allowPositionals: true, options: { vendor: { type: 'string' }, out: { type: 'string' }, grow: { type: 'string', default: '第七学区' } } });
const [novelDir, typesFile] = positionals, out = resolve(values.out);
await mkdir(out, { recursive: true });
const inputs = await stageInputs(novelDir), name = id => inputs.names[id] ?? id, types = JSON.parse(await readFile(typesFile, 'utf8'));
const typeOf = label => Object.values(types).flat().filter(entry => entry.label === label && entry.type !== 'none').sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0]?.type ?? 'residential';
const scaleOf = id => inputs.scale?.places[id]?.scale ?? 'district', OPEN = new Set(['region', 'city', 'district', 'street']);
const sentences = [...(await loadWorkspaceSentences(novelDir)).values()], firstAt = label => sentences.findIndex(s => s.text.includes(label));
const byId = new Map(inputs.data.places.map(place => [place.id, place]));
const story = inputs.data.places.map(place => ({ place, at: firstAt(name(place.id)) })).filter(entry => entry.at >= 0).sort((a, b) => a.at - b.at).map(entry => entry.place);

const canvas = C.emptyCanvas(), pinned = new Map(), log = [];
/** A place known to the story: its open ancestors (and itself, if open) born outermost first; a building or room becomes a unit with a lot in the nearest. */
function know(place) {
  const chain = (place.path ?? [place.id]).filter(id => byId.has(id)), open = chain.filter(id => OPEN.has(scaleOf(id)));
  const fresh = open.filter(id => !canvas.places[id]);
  C.bearChain(canvas, open.map(id => ({ id, label: name(id), scale: scaleOf(id), landscape: typeOf(name(id)) })));
  if (fresh.length) log.push(`${name(place.id)}: born ${fresh.map(name).join(' › ')}`);
  if (OPEN.has(scaleOf(place.id)) || !open.length) return;
  // A building or a room: a lot in the nearest open place that holds it, as near its middle as is free.
  // Known only to lie in a city (no district or street named): an unnamed temporary area of the city holds it.
  const holder = canvas.places[C.holderFor(canvas, open.at(-1), scaleOf(place.id), place.id)], filled = L.fillLandscape(holder.landscape), taken = new Set([...(pinned.get(holder.id) ?? [])]);
  const borrowed = borrowLots(filled.fabric, { circle: { x: 0, z: 0, r: L.circleOf(holder.landscape, 0) * 0.6 } }, 'office', taken, place.id) ?? borrowLots(filled.fabric, {}, 'office', taken, place.id);
  if (!borrowed) return;
  pinned.set(holder.id, new Set([...taken, ...borrowed.lots]));
  const lots = borrowed.lots.map(id => filled.fabric.lots.find(lot => lot.id === id)), centre = [lots.reduce((s, l) => s + l.centre[0], 0) / lots.length, lots.reduce((s, l) => s + l.centre[1], 0) / lots.length];
  C.addUnit(canvas, holder.id, { id: place.id, label: name(place.id), kind: scaleOf(place.id) === 'room' ? 'room' : 'building', r: Math.round(Math.sqrt(lots.reduce((s, l) => s + l.area, 0)) / 2), at: centre });
  log.push(`${name(place.id)}: a lot in ${holder.label}${holder.temporary ? ' (temporary)' : ''}`);
}

const round = v => Math.round(v * 10) / 10;
const library = JSON.parse(await readFile(`${repository}/apps/playground/src/data/architectureModels.json`, 'utf8'));
/** Everything on the canvas, in world metres: each open place's ground at its world offset, its circle, its units. */
function canvasData(title) {
  const data = { title, extent: 300, roads: [], buildings: [], named: [], places: [], fields: [], walls: [], outlines: [], boxes: [], models: Object.fromEntries(Object.entries(library.models).filter(([id]) => /^(skyscraper|tower|office|block-wide|keep|fountain)/.test(id))) };
  for (const place of Object.values(canvas.places)) {
    const [wx, wz] = C.worldOf(canvas, place.id), W = p => [round(p[0] + wx), round(p[1] + wz)];
    data.extent = Math.max(data.extent, Math.abs(wx) + place.r, Math.abs(wz) + place.r);
    data.places.push({ name: place.label, temporary: !!place.temporary, born: `${place.scale}${place.landscape ? ` · ${place.landscape.patches.map(p => p.type).join(' + ')}` : ''}`, x: round(wx), z: round(wz), r: place.r });
    for (const unit of place.units) data.named.push({ name: unit.label, x: round(unit.at[0] + wx), z: round(unit.at[1] + wz), w: unit.r * 1.3, d: unit.r * 1.3, angle: 0, floors: 10, k: 'office' });
    if (!place.landscape) continue;
    const filled = L.fillLandscape(place.landscape), skip = pinned.get(place.id) ?? new Set(), typeById = Object.fromEntries(place.landscape.patches.map(p => [p.id, p.type]));
    for (const road of filled.fabric.roads) data.roads.push({ a: W(road.a), b: W(road.b), width: road.width, level: road.level });
    for (const b of filled.fabric.buildings) if (!skip.has(b.lot)) data.buildings.push({ x: round(b.x + wx), z: round(b.z + wz), w: round(b.w), d: round(b.d), angle: b.angle, floors: b.floors, k: b.kind });
    for (const mark of filled.landmarks) data.buildings.push({ ...mark, x: round(mark.x + wx), z: round(mark.z + wz), k: mark.kind, ...(mark.kind === 'skyscraper' ? { form: 'sky-spire' } : {}) });
    for (const keep of filled.keeps) data.buildings.push({ ...keep, x: round(keep.x + wx), z: round(keep.z + wz), k: 'keep' });
    for (const lot of filled.fabric.lots) if (['farm', 'park'].includes(typeById[filled.owner[lot.id]])) data.fields.push({ pts: lot.pts.map(W), o: 0.06 });
    for (const [a, b] of filled.walls) data.walls.push({ a: W(a), b: W(b) });
  }
  data.extent = Math.round(data.extent * 1.05);
  return data;
}

let page = await readFile(`${repository}/playground/landscape-mock.html`, 'utf8');
page = page.replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './vendor/three.module.js').replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './vendor/addons/')
  .replace('<script type="application/json" id="fill-data">null</script>', () => `<script type="application/json" id="fill-data">${JSON.stringify(canvasData('canvas')).replace(/</g, '\\u003c')}</script>`);
await writeFile(join(out, 'canvas.html'), page);
const { server, url } = await serve(join(out, 'canvas.html'), resolve(values.vendor)), chrome = await browser();
const shoot = async (file, title, view) => { const data = canvasData(title); await chrome.evaluate(`window.__stage.load(${JSON.stringify(data)})`); await chrome.evaluate(`window.__stage.view(${JSON.stringify(view ?? { mode: 'top', target: [0, 0], half: data.extent })})`); await writeFile(join(out, file), Buffer.from(await chrome.still('png'), 'base64')); return data.extent; };
const radii = () => Object.fromEntries(Object.values(canvas.places).map(place => [place.label, place.r]));
const stages = [];
try {
  await chrome.open(url);
  know(story[0]);
  stages.push({ stage: 'first', radii: radii(), extent: await shoot('1-first.png', 'first') });
  for (const place of story.slice(1)) know(place);
  stages.push({ stage: 'all', radii: radii(), extent: await shoot('2-all.png', 'all') });
  const grower = Object.values(canvas.places).find(place => place.label === values.grow);
  if (grower) for (const toward of [[400, 120], [-150, 420]]) C.addPart(canvas, grower.id, 'residential', toward, { by: 'drift' });
  stages.push({ stage: 'grown', radii: radii(), extent: await shoot('3-grown.png', 'grown') });
  await shoot('4-grown-3d.png', 'grown', { mode: 'persp', target: [0, 0], distance: 2600, yaw: 0.9, elevation: 0.55 });
} finally { await chrome.close(); server.close(); }
await writeFile(join(out, 'canvas.json'), JSON.stringify({ log, stages, canvas }, null, 1));
console.log(log.join('\n')); for (const stage of stages) console.log(stage.stage, JSON.stringify(stage.radii));
