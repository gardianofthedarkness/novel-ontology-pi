// A recorded run reviewed by the agent, segment by segment (the user, 2026-11-12: "Segment by agent, review the entire run,
// and list me all the issues you see"). The run's own page is played in a headless Chrome; at each unit's end a still is
// taken as the reviewer segment takes it (reviewer.mjs; the indoor set view of docs/v3/design.html#indoor-mode when the people
// stand in a building), and the stills go to the reviewer in blocks of `every`. Nothing of the run is changed: no retake,
// only the verdicts and notes, kept in --out with the stills.
//
//   node engine/director/review-run.mjs <novel-dir> --run <run id> --out <folder> [--every 5] [--reviewer pi|claude-code|stand-in]
//     [--from <unit>] [--to <unit>]
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inlineStrand } from '../world/export-strand-demo.mjs';
import { reviewBlock, reviewerOf } from './reviewer.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** Where a unit's still looks: its people within 40 m of their middle, from high up; indoors the set view on their room. */
export function framing(points, room) {
  const centre = [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length);
  const kept = points.filter(p => Math.hypot(p[0] - centre[0], p[2] - centre[2]) <= 40), near = kept.length ? kept : points.slice(0, 1);
  const mid = [0, 1, 2].map(n => near.reduce((sum, p) => sum + p[n], 0) / near.length), reach = Math.max(0, ...near.map(p => Math.hypot(p[0] - mid[0], p[2] - mid[2])));
  return { focus: { x: mid[0], z: mid[2], y0: mid[1], w: 6, d: 6, h: 3 }, radius: room ? Math.min(16, Math.max(8, reach * 1.6 + 6)) : Math.min(45, Math.max(12, reach * 1.6 + 8)), elevation: room ? 42 : 60, ...(room ? { set: { lot: room.lot, room: room.room, floor: room.floor } } : {}) };
}

export async function reviewRun(novelDir, { run, out, every = 5, reviewer = 'pi', from = null, to = null, log = console.error }) {
  const novel = resolve(novelDir), page = JSON.parse(await readFile(join(novel, 'stage', 'simulation', 'runs', 'director', `${run}.page.json`), 'utf8'));
  const { browser, serve } = await import('../view/two-view-things.mjs'), { VENDOR_FILES } = await import('../live/sim-jev.mjs');
  const work = join(out, 'page'), stills = join(out, 'stills');
  await mkdir(stills, { recursive: true });
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  await writeFile(join(work, 'index.html'), inlineStrand(await readFile(join(repository, 'engine', 'view', 'strand-demo.html'), 'utf8'), page, { vendor: true }));
  const server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true });
  const names = id => page.people?.[id]?.name ?? id, sceneOf = new Map(page.scenes.map(scene => [scene.id, scene]));
  // Indoors by the story (docs/v3/design.html#indoor-fixes F7): the unit's bound room (stage/world/rooms.json) when its place is in one;
  // else, when its place is a room or a building, the room its people stand in; never a street, district or city unit.
  const script = JSON.parse(await readFile(join(novel, 'stage', 'world', 'script.json'), 'utf8').catch(() => 'null')) ?? { places: {} };
  const bound = JSON.parse(await readFile(join(novel, 'stage', 'world', 'rooms.json'), 'utf8').catch(() => 'null'))?.rooms ?? {};
  const chainOf = id => { const out = []; for (let at = id, guard = 0; at && guard < 16; at = script.places?.[at]?.parent, guard++) out.push(at); return out; };
  const storyRoom = unitId => { const place = script.scenes?.find(scene => scene.id === unitId)?.place ?? null, chain = place ? chainOf(place) : []; const room = chain.find(id => bound[id]); return { indoors: chain.some(id => ['room', 'building'].includes(script.places?.[id]?.scale)), room: room ? { ...bound[room], place: room } : null }; };
  const cardsOf = new Map(); for (const card of page.director?.cards ?? []) (cardsOf.get(card.scene) ?? cardsOf.set(card.scene, []).get(card.scene)).push(card);
  const units = [], result = { run, every, reviewer, blocks: [], units: [] };
  try {
    await chrome.size(1440, 900);
    await chrome.open(server.url);
    await new Promise(done => setTimeout(done, 5000));
    const all = await chrome.evaluate('window.__units()');
    const order = all.map(unit => unit.id), first = from ? order.indexOf(from) : 0, last = to ? order.indexOf(to) : order.length - 1;
    for (const unit of all.slice(Math.max(0, first), last + 1)) {
      const scene = sceneOf.get(unit.id), at = Math.max(unit.start, unit.end - 0.05), cards = cardsOf.get(unit.id) ?? [];
      // The people at the unit's end: placed first by a plain capture, then read where the page has them.
      await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: 'place', scene: unit.id, place: unit.place, at, people: true, frame: [1440, 900] })})`);
      const spots = (await chrome.evaluate(`(${JSON.stringify(unit.people)}).map(id => [id, window.__pawnAt(id)]).filter(([, p]) => p)`)) ?? [];
      const lastPeople = new Set((cards.at(-1)?.moves ?? []).map(move => move.person).filter(Boolean));
      const framedSpots = spots.filter(([id]) => lastPeople.has(id)).length ? spots.filter(([id]) => lastPeople.has(id)) : spots;
      let still = null, room = null, setInfo = null;
      if (framedSpots.length) {
        const story = storyRoom(unit.id);
        if (story.room) room = { lot: story.room.lot, room: story.room.room, floor: story.room.floor };
        else if (story.indoors) for (const [, p] of framedSpots) { room = await chrome.evaluate(`window.__roomAt(${p[0]}, ${p[1]}, ${p[2]})`); if (room) break; }
        const frame = framing(framedSpots.map(([, p]) => p), room);
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: `${unit.id}-review`, scene: unit.id, place: unit.place, at, people: true, frame: [1440, 900], ...frame })})`);
        await new Promise(done => setTimeout(done, 300));
        still = join(stills, `${unit.id.slice(-3)}.png`);
        if (room) setInfo = await chrome.evaluate('window.__setInfo ?? null');
        await writeFile(still, Buffer.from(await chrome.still('png'), 'base64'));
      }
      const unmoved = cards.flatMap(card => (card.moves ?? []).filter(move => move.moved === false).map(move => `${names(move.person)} found no way${move.why ? ` (${String(move.why).slice(0, 60)})` : ''}`));
      const entry = { unit: unit.id, still, place: scene?.label ?? unit.place, people: unit.people.map(names), cards: cards.length, moves: cards.reduce((n, card) => n + (card.moves ?? []).filter(move => move.moved).length, 0), held: unmoved.slice(0, 6), lines: cards.flatMap(card => card.lines ?? []).slice(0, 4).map(line => String(line.text ?? '').slice(0, 80)).filter(Boolean), indoors: room ? { lot: room.lot, room: room.room, floor: room.floor, ...(setInfo ? { sun: setInfo.sun, patches: setInfo.patches, windows: setInfo.windows } : {}) } : null, apart: framedSpots.length < spots.length ? spots.length - framedSpots.length : 0 };
      units.push(entry); result.units.push(entry);
      log(`${unit.id}: ${still ? `still ${room ? `indoors (lot ${room.lot}, ${room.room >= 0 ? `room ${room.room}` : 'no room'}, floor ${room.floor})` : 'outdoors'}` : 'no one to frame'}`);
    }
  } finally { await chrome.close(); server.server.close(); }
  const agent = reviewerOf(reviewer);
  for (let n = 0; n * every < units.length; n++) {
    const block = units.slice(n * every, (n + 1) * every);
    const { retakes, file, error } = await reviewBlock({ reviewer: agent, units: block, folder: join(out, 'reviews'), block: n + 1, log });
    result.blocks.push({ block: n + 1, units: block.map(unit => unit.unit), retakes, file, ...(error ? { error } : {}) });
  }
  await writeFile(join(out, 'review-run.json'), JSON.stringify(result, null, 1));
  return result;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { run: { type: 'string' }, out: { type: 'string' }, every: { type: 'string' }, reviewer: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } });
  if (!novelDir || !values.run || !values.out) { console.error('usage: node engine/director/review-run.mjs <novel-dir> --run <id> --out <folder> [--every 5] [--reviewer pi] [--from <unit>] [--to <unit>]'); process.exit(2); }
  const result = await reviewRun(novelDir, { run: values.run, out: resolve(values.out), every: Number(values.every ?? 5), reviewer: values.reviewer ?? 'pi', from: values.from ?? null, to: values.to ?? null });
  console.log(JSON.stringify({ units: result.units.length, blocks: result.blocks.length, retakes: result.blocks.reduce((n, b) => n + b.retakes.length, 0) }));
  process.exit(0);
}
