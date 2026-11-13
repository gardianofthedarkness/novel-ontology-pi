// Every indoor unit of a run, measured on what any book's indoor shot must do (the user, 2026-11-13: "make your methods
// generalizable to any novel with indoor scenes. The performance should stay consistent across segments and books").
// The clip benchmark (check.mjs) holds three units of one book to the clip; this holds every unit with a shot to rules that
// name no book: the shot is drawn; it frames the room (set, the end of outside) or stands in it (eye); every person the agent
// staged in the room is there and in frame, and no one it put elsewhere is; the sun falls only through windows it reaches,
// by day; the walls read, nothing overlays the frame, people are slim; the camera moves; a typed room is furnished. Each unit
// is played with the run's own shot at the start of the unit (as the agent staged it) and near its end. The report gives
// each unit's share passed and the spread over units: the mean, the worst, and which checks fail where.
//
//   node engine/bench/indoor-set/check-units.mjs <novel-dir> --run <run id> --out <folder> [--from <unit>] [--to <unit>]
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inlineStrand } from '../../world/export-strand-demo.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '..', '..', '..');
const ok = (pass, seen) => ({ result: pass ? 'pass' : 'fail', seen });

/** The checks of one unit from its shot's facts at its start and near its end, the agent's staging and the room's kind. */
export function judgeUnit({ start, end, staged, kind }) {
  const out = {}, f = start;
  out['shot.drawn'] = ok(!!start && !!end, start ? `${start.kind} (${start.phase})` : 'no shot drawn');
  if (!f) return out;
  const framing = facts => (facts.phase === 'eye' ? !!facts.camera?.inside : facts.phase === 'outside' ? true : facts.frameShare >= 0.12 && facts.frameShare <= 0.95);
  out['room.framed'] = ok(framing(f) && (!end || framing(end)), f.phase === 'eye' ? `camera ${f.camera?.inside ? 'inside' : 'outside'} the room` : `the room ${f.frameShare} of the frame${end ? `, then ${end.frameShare}` : ''}`);
  const shown = new Map((f.people ?? []).map(person => [person.id, person]));
  const inRoom = Object.entries(staged ?? {}).filter(([, entry]) => entry.at !== 'elsewhere').map(([who]) => who), away = Object.entries(staged ?? {}).filter(([, entry]) => entry.at === 'elsewhere').map(([who]) => who);
  const placed = inRoom.filter(who => { const person = shown.get(who); return person && (person.inRoom || person.onBalcony); });
  out['people.staged'] = ok(placed.length === inRoom.length, `${placed.length} of ${inRoom.length} staged in the room are there${inRoom.filter(who => !placed.includes(who)).length ? ` (not: ${inRoom.filter(who => !placed.includes(who)).join(', ')})` : ''}`);
  out['people.elsewhere'] = ok(away.every(who => !shown.has(who)), away.length ? `${away.filter(who => !shown.has(who)).length} of ${away.length} put elsewhere stay out` : 'no one put elsewhere');
  const visible = (f.people ?? []).filter(person => person.inRoom || person.onBalcony);
  out['people.in-frame'] = ok(f.phase === 'outside' || visible.every(person => person.inFrame), f.phase === 'outside' ? 'from outside: the room comes later' : `${visible.filter(person => person.inFrame).length} of ${visible.length} in the frame`);
  out['sun.physics'] = ok(f.phase === 'outside' || (f.patches > 0) === (f.light === 'day' && f.sunFacing > 0), `${f.patches} patch(es); ${f.light} light; ${f.sunFacing} window(s) facing the sun`);
  out['walls.read'] = ok((f.walls?.opacity ?? 0) >= 0.7 && !!f.walls?.edges, `walls ${f.walls?.opacity}`);
  out['frame.clean'] = ok(f.overlays === 0 && f.figure?.radius <= 0.25 && !f.figure?.ring, 'no overlays, slim people');
  const moved = f.kind === 'set' ? (f.moves?.degrees ?? 0) >= 10 : (f.moves?.metres ?? 0) >= (f.kind === 'eye' ? 0.2 : 10);
  out['camera.moves'] = ok(moved, f.kind === 'set' ? `${f.moves?.degrees}°` : `${f.moves?.metres} m`);
  out['room.furnished'] = ok(!kind || kind === 'not said' || (f.furniture?.length ?? 0) > 0, `${kind ?? 'no kind'}: ${f.furniture?.length ?? 0} pieces`);
  return out;
}

export async function checkUnits(novelDir, { run, out, from = null, to = null, log = console.error }) {
  const novel = resolve(novelDir), page = JSON.parse(await readFile(join(novel, 'stage', 'simulation', 'runs', 'director', `${run}.page.json`), 'utf8'));
  const script = JSON.parse(await readFile(join(novel, 'stage', 'world', 'script.json'), 'utf8'));
  const plan = JSON.parse(await readFile(join(novel, 'stage', 'world', 'room-plan.json'), 'utf8').catch(() => 'null')) ?? {};
  const bound = JSON.parse(await readFile(join(novel, 'stage', 'world', 'rooms.json'), 'utf8').catch(() => 'null'))?.rooms ?? {};
  const chainOf = id => { const chain = []; for (let at = id, guard = 0; at && guard < 16; at = script.places?.[at]?.parent, guard++) chain.push(at); return chain; };
  const bindingOf = unitId => { const place = script.scenes?.find(scene => scene.id === unitId)?.place, chain = place ? chainOf(place) : [], room = chain.find(id => bound[id]); if (room) return bound[room]; const building = chain.find(id => Object.values(bound).some(b => b.building === id && !b.entry)); return building ? Object.values(bound).find(b => b.building === building && !b.entry) : null; };
  if (!page.shots) { page.shots = {}; for (const scene of script.scenes ?? []) { const b = bindingOf(scene.id); if (b) page.shots[scene.id] = { kind: plan.shots?.[scene.id]?.kind ?? 'set', lot: b.lot, room: b.room, ...(b.part ? { part: b.part } : {}) }; } log('shots filled from the room plan (a run made before shots)'); }
  const { browser, serve } = await import('../../view/two-view-things.mjs'), { VENDOR_FILES } = await import('../../live/sim-jev.mjs');
  const work = join(out, 'page'); await mkdir(join(out, 'stills'), { recursive: true });
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  await writeFile(join(work, 'index.html'), inlineStrand(await readFile(join(repository, 'engine', 'view', 'strand-demo.html'), 'utf8'), page, { vendor: true }));
  const server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true }), units = [];
  try {
    await chrome.size(1440, 810); await chrome.open(server.url); await new Promise(done => setTimeout(done, 5000));
    const all = await chrome.evaluate('window.__units()'), order = all.map(unit => unit.id), lo = from ? order.indexOf(from) : 0, hi = to ? order.indexOf(to) : order.length - 1;
    for (const unit of all.slice(Math.max(0, lo), hi + 1).filter(entry => page.shots[entry.id])) {
      const factsAt = async share => {
        const at = unit.start + (unit.end - unit.start) * share, base = { scene: unit.id, place: unit.place, at, people: true, frame: [1440, 810], storySky: true, shot: true };
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, id: 'warm' })})`); await new Promise(done => setTimeout(done, 700));
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, id: unit.id })})`); await new Promise(done => setTimeout(done, 400));
        const facts = await chrome.evaluate('window.__shotFacts()'); return facts?.unit === unit.id ? facts : null;
      };
      const start = await factsAt(0.12), still = join(out, 'stills', `${unit.id.slice(-3)}.png`);
      await writeFile(still, Buffer.from(await chrome.still('png'), 'base64'));
      const end = await factsAt(0.92), binding = bindingOf(unit.id);
      const checks = judgeUnit({ start, end, staged: plan.staging?.[unit.id] ?? {}, kind: binding?.kind ?? null });
      const values = Object.values(checks), share = values.filter(check => check.result === 'pass').length / values.length;
      units.push({ unit: unit.id, shot: page.shots[unit.id].kind, share: Math.round(share * 1000) / 1000, still, checks });
      log(`${unit.id} (${page.shots[unit.id].kind}): ${Math.round(share * 100)}%${share < 1 ? ` · ${Object.entries(checks).filter(([, check]) => check.result === 'fail').map(([id]) => id).join(', ')}` : ''}`);
    }
  } finally { await chrome.close(); server.server.close(); }
  const shares = units.map(unit => unit.share), failing = {};
  for (const unit of units) for (const [id, check] of Object.entries(unit.checks)) if (check.result === 'fail') (failing[id] ??= []).push(unit.unit);
  const summary = { run, units: units.length, mean: shares.length ? Math.round((shares.reduce((a, b) => a + b, 0) / shares.length) * 1000) / 10 : 0, worst: shares.length ? Math.round(Math.min(...shares) * 1000) / 10 : 0, perfect: shares.filter(value => value === 1).length, failing: Object.fromEntries(Object.entries(failing).map(([id, list]) => [id, list.length])) };
  await writeFile(join(out, 'units.json'), JSON.stringify({ summary, failing, units }, null, 1));
  return { summary, failing, units };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { run: { type: 'string' }, out: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' } } });
  if (!novelDir || !values.run || !values.out) { console.error('usage: node engine/bench/indoor-set/check-units.mjs <novel-dir> --run <id> --out <folder> [--from <unit>] [--to <unit>]'); process.exit(2); }
  const result = await checkUnits(novelDir, { run: values.run, out: resolve(values.out), from: values.from ?? null, to: values.to ?? null });
  console.log(JSON.stringify(result.summary));
  process.exit(0);
}
