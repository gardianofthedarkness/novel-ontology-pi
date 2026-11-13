// A run measured against the indoor set's benchmark (standard.json; the user, 2026-11-12: "Our automated run for the first
// indoor scenes should exactly match it as standard"). The run's own page is played in a headless Chrome; at the end of each
// benchmark unit a still is taken as the engine takes one (review-run.mjs's framing: the set view on the unit's bound room),
// the page says what that set drew (window.__setFacts), and each check of the standard is passed, failed or not built.
// Written to --out: check.json, the run's stills, and compare.html (the benchmark's frame beside the run's, with the checks).
//
//   node engine/bench/indoor-set/check.mjs <novel-dir> --run <run id> --out <folder>
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inlineStrand } from '../../world/export-strand-demo.mjs';
import { framing } from '../../director/review-run.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '..', '..', '..');
const FURNITURE_KINDS = { bed: /bed/, cabinet: /cabinet|nightstand|drawer|dresser/, shelf: /shelf|book/, rug: /rug|carpet/, table: /table|desk/, lamp: /lamp|light/ };
const between = (value, [lo, hi]) => typeof value === 'number' && value >= lo && value <= hi;
const verdict = (pass, seen) => ({ result: pass ? 'pass' : 'fail', seen });
const notBuilt = seen => ({ result: 'not built', seen });

/** The set shot's checks, from what the run recorded and what the page drew. */
export function judgeSet({ binding, capturedSet, lot, facts, people, sky, story }) {
  const out = {}, room = binding && lot?.rooms?.[binding.room], area = room ? (room[3] - room[1] + 1) * (room[4] - room[2] + 1) * 4 : null;
  out['set.room-bound'] = verdict(!!binding && capturedSet?.lot === binding.lot && capturedSet?.room === binding.room, binding ? `bound lot ${binding.lot} room ${binding.room} floor ${binding.floor}; still on ${capturedSet ? `lot ${capturedSet.lot} room ${capturedSet.room}` : 'no set'}` : 'no bound room');
  out['set.upper-floor'] = verdict(!!binding && binding.floor >= 1 && (lot?.floors ?? 0) >= 3, binding ? `floor ${binding.floor} of ${lot?.floors ?? '?'}` : 'no bound room');
  const kinds = Object.entries(FURNITURE_KINDS).filter(([, test]) => (facts?.furniture ?? []).some(([model]) => test.test(model))).map(([kind]) => kind);
  out['set.kind'] = verdict(binding?.kind === 'bedroom' && (facts?.furniture?.length ?? 0) > 0, `kind ${binding?.kind ?? 'none'}, ${facts?.furniture?.length ?? 0} pieces`);
  out['set.size'] = verdict(between(area, [16, 36]), area === null ? 'no room' : `${area} m² (${room[3] - room[1] + 1} x ${room[4] - room[2] + 1} cells of 2 m)`);
  out['set.nothing-above'] = verdict(facts?.info?.above === 0, facts ? `${facts.info?.above ?? '?'} pieces drawn above the room` : 'no set drawn');
  const cutSides = (facts?.sides ?? []).filter(side => side.cut > 0), standSides = (facts?.sides ?? []).filter(side => side.stand > 0 && side.cut === 0);
  out['set.near-cut'] = verdict(cutSides.length >= 1 && cutSides.every(side => side.stand === 0), facts ? `${cutSides.length} side(s) cut low` : 'no set drawn');
  out['set.far-stand'] = verdict(standSides.length >= 1, facts ? `${standSides.length} side(s) standing` : 'no set drawn');
  out['set.window'] = verdict((facts?.info?.windows ?? 0) >= 1, `${facts?.info?.windows ?? 0} window pane(s) in the room`);
  out['set.balcony'] = verdict((facts?.balconies ?? 0) >= 1, `${facts?.balconies ?? 0} balcony door(s)`);
  // The page's sky: its hour and weather amounts (rain, snow, fog, cloud 0-1) as it plays the story's sky.
  const w = sky?.weather ?? {}, wet = (w.rain ?? 0) > 0.2 || (w.snow ?? 0) > 0.2 || (w.fog ?? 0) > 0.4, said = sky?.on && typeof sky.hour === 'number' ? `${sky.hour}:00, ${wet ? 'wet' : (w.cloud ?? 0) >= 0.5 ? 'overcast' : 'clear'}` : 'no story sky in the still';
  const dayClear = !!sky?.on && sky.hour >= 6 && sky.hour <= 17 && !wet && (w.cloud ?? 0) < 0.5;
  out['set.sun'] = dayClear ? verdict(!!facts?.info?.sun && (facts?.info?.patches ?? 0) >= 1, `${facts?.info?.patches ?? 0} sun patch(es) at ${said}`) : verdict(false, `${said}, not the benchmark's 9:00 clear`);
  out['set.furniture'] = verdict(kinds.includes('bed') && kinds.length >= 4, `${kinds.join(', ') || 'none'} (${(facts?.furniture ?? []).map(([model]) => model).join(', ')})`);
  out['set.people-in'] = verdict(people.length > 0 && people.every(person => person.inRoom || person.onBalcony), people.map(person => `${person.id} ${person.inRoom ? 'in the room' : person.onBalcony ? 'on the balcony' : 'outside it'}`).join('; ') || 'no one');
  const cam = facts?.camera;
  out['set.camera'] = verdict(!!cam && between(cam.pitch, [26, 40]) && between(cam.distance, [8, 14]) && cam.targetOff <= 1, cam ? `pitch ${cam.pitch}°, ${cam.distance} m from the room's middle, aimed ${cam.targetOff} m off it` : 'no set drawn');
  out['set.surround'] = verdict(facts?.info?.stairs === 0, facts ? `${facts.info?.stairs ?? '?'} stair block(s), ${facts.info?.corridors ?? '?'} corridor slab(s) on the floor` : 'no set drawn');
  out['set.outside'] = verdict(dayClear && between(sky.hour, [8, 10]), said);
  out['set.story'] = verdict(!!story.onBalcony && !!story.toDoor, `${story.onBalcony ? 'someone on the balcony' : 'no one on the balcony'}; ${story.toDoor ? 'a walk ends at the balcony door' : 'no walk to the balcony door'}`);
  return out;
}

export async function checkRun(novelDir, { run, out, log = console.error }) {
  const novel = resolve(novelDir), standard = JSON.parse(await readFile(join(here, 'standard.json'), 'utf8'));
  const page = JSON.parse(await readFile(join(novel, 'stage', 'simulation', 'runs', 'director', `${run}.page.json`), 'utf8'));
  const script = JSON.parse(await readFile(join(novel, 'stage', 'world', 'script.json'), 'utf8'));
  const bound = JSON.parse(await readFile(join(novel, 'stage', 'world', 'rooms.json'), 'utf8').catch(() => 'null'))?.rooms ?? {};
  const chainOf = id => { const chain = []; for (let at = id, guard = 0; at && guard < 16; at = script.places?.[at]?.parent, guard++) chain.push(at); return chain; };
  const bindingOf = unitId => { const place = script.scenes?.find(scene => scene.id === unitId)?.place, room = place ? chainOf(place).find(id => bound[id]) : null; return room ? { ...bound[room], place: room } : null; };
  const { browser, serve } = await import('../../view/two-view-things.mjs'), { VENDOR_FILES } = await import('../../live/sim-jev.mjs');
  const work = join(out, 'page');
  await mkdir(join(out, 'stills'), { recursive: true });
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  await writeFile(join(work, 'index.html'), inlineStrand(await readFile(join(repository, 'engine', 'view', 'strand-demo.html'), 'utf8'), page, { vendor: true }));
  const server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true }), result = { run, shots: [] };
  try {
    await chrome.size(1440, 810);
    await chrome.open(server.url);
    await new Promise(done => setTimeout(done, 5000));
    const units = new Map((await chrome.evaluate('window.__units()')).map(unit => [unit.id, unit]));
    for (const shot of standard.shots) {
      const unit = units.get(shot.unit), binding = bindingOf(shot.unit), entry = { shot: shot.id, unit: shot.unit, still: null, checks: {} };
      if (!unit) { for (const check of shot.checks) entry.checks[check.id] = { result: 'fail', seen: 'the unit is not in this run' }; result.shots.push(entry); continue; }
      const at = Math.max(unit.start, unit.end - 0.05);
      await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: 'place', scene: unit.id, place: unit.place, at, people: true, frame: [1440, 810], storySky: true })})`);
      await new Promise(done => setTimeout(done, 1200));
      const spots = (await chrome.evaluate(`(${JSON.stringify(unit.people)}).map(id => [id, window.__pawnAt(id)]).filter(([, p]) => p)`)) ?? [];
      const set = binding ? { lot: binding.lot, room: binding.room, floor: binding.floor } : null;
      const frame = spots.length ? framing(spots.map(([, p]) => p), set) : null;
      if (frame) await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: `${unit.id}-bench`, scene: unit.id, place: unit.place, at, people: true, frame: [1440, 810], storySky: true, ...frame })})`);
      await new Promise(done => setTimeout(done, 400));
      entry.still = join(out, 'stills', `${shot.id}.png`);
      await writeFile(entry.still, Buffer.from(await chrome.still('png'), 'base64'));
      const facts = set ? await chrome.evaluate('window.__setFacts()') : null, sky = (await chrome.evaluate('window.__replay()'))?.sky ?? null;
      const roomOf = await Promise.all(spots.map(async ([id, p]) => [id, p, await chrome.evaluate(`window.__roomAt(${p[0]}, ${p[1]}, ${p[2]})`)]));
      const lot = binding ? page.world?.lots?.[binding.lot] : null;
      const people = roomOf.map(([id, p, room]) => {
        const inRoom = !!room && !!binding && room.lot === binding.lot && room.room === binding.room;
        // On the balcony: outside the room's cells, at its floor, within 2 m of its outline (the slab is 1.2 m out).
        const near = facts?.at ? Math.hypot(p[0] - facts.at[0], p[2] - facts.at[1]) : Infinity;
        return { id, inRoom, onBalcony: !inRoom && !!facts && Math.abs(p[1] - facts.yFloor) < 1 && near <= Math.max(facts.w, facts.d) / 2 + 2 };
      });
      // The staging may fall in the next unit of the same room (shot.storyUnits): someone on the balcony at any of their ends.
      let balconyElsewhere = false;
      for (const other of (shot.storyUnits ?? []).filter(id => id !== unit.id && units.has(id))) {
        const next = units.get(other), when = Math.max(next.start, next.end - 0.05), nextBinding = bindingOf(other);
        if (!nextBinding || nextBinding.lot !== binding?.lot || nextBinding.room !== binding?.room) continue;
        await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: 'place', scene: other, place: next.place, at: when, people: true, frame: [1440, 810], storySky: true, set })})`);
        const theirs = (await chrome.evaluate(`(${JSON.stringify(next.people)}).map(id => [id, window.__pawnAt(id)]).filter(([, p]) => p)`)) ?? [], f = await chrome.evaluate('window.__setFacts()');
        for (const [, p] of theirs) { const room = await chrome.evaluate(`window.__roomAt(${p[0]}, ${p[1]}, ${p[2]})`), inside = !!room && room.lot === binding.lot && room.room === binding.room; if (!inside && f?.at && Math.abs(p[1] - f.yFloor) < 1 && Math.hypot(p[0] - f.at[0], p[2] - f.at[1]) <= Math.max(f.w, f.d) / 2 + 2) balconyElsewhere = true; }
      }
      const cards = (page.director?.cards ?? []).filter(card => (shot.storyUnits ?? [unit.id]).includes(card.scene));
      const story = { onBalcony: people.some(person => person.onBalcony) || balconyElsewhere, toDoor: facts?.balconies > 0 && cards.some(card => (card.moves ?? []).some(move => move.moved)) && people.some(person => person.inRoom) };
      entry.facts = facts; entry.sky = sky; entry.people = people;
      if (shot.id === 'set') entry.checks = judgeSet({ binding, capturedSet: set, lot, facts, people, sky, story });
      else for (const check of shot.checks) entry.checks[check.id] = notBuilt(shot.id === 'eye' ? 'the page has no eye-level shot: a still of this unit is the set view from above' : 'the page has no move from outside into the set');
      result.shots.push(entry);
      const counts = Object.values(entry.checks).reduce((sum, check) => ({ ...sum, [check.result]: (sum[check.result] ?? 0) + 1 }), {});
      log(`${shot.id} (${shot.unit}): ${Object.entries(counts).map(([key, n]) => `${n} ${key}`).join(', ')}`);
    }
  } finally { await chrome.close(); server.server.close(); }
  await writeFile(join(out, 'check.json'), JSON.stringify(result, null, 1));
  await writeFile(join(out, 'compare.html'), compareHtml(standard, result));
  for (const shot of standard.shots) for (const moment of shot.moments) await copyFile(join(here, 'reference', `${moment.id}.png`), join(out, 'stills', `reference-${moment.id}.png`)).catch(() => {});
  return result;
}

/** The benchmark's frames beside the run's still, shot by shot, with each check's result. */
function compareHtml(standard, result) {
  const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const colour = { pass: '#2f9e5b', fail: '#d0453a', 'not built': '#8a93a0' };
  const shots = standard.shots.map(shot => {
    const run = result.shots.find(entry => entry.shot === shot.id) ?? { checks: {} };
    const rows = shot.checks.map(check => { const got = run.checks[check.id] ?? { result: 'fail', seen: '' }; return `<tr><td><b style="color:${colour[got.result]}">${esc(got.result)}</b></td><td>${esc(check.what)}</td><td>${esc(got.seen)}</td></tr>`; }).join('');
    return `<section><h2>${esc(shot.title)} &middot; ${esc(shot.unit)} &middot; ${esc(shot.sky.time)} ${esc(shot.sky.weather)}</h2><div class="pair"><figure><img src="stills/reference-${shot.moments.at(-1).id}.png"><figcaption>Benchmark</figcaption></figure><figure><img src="stills/${shot.id}.png"><figcaption>Run ${esc(result.run)}</figcaption></figure></div><div class="scroll"><table>${rows}</table></div></section>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Indoor Set Check</title><style>:root{--bg:#f4f6f8;--fg:#18222e;--line:#d8dee5}@media (prefers-color-scheme: dark){:root{--bg:#10161d;--fg:#e3e9ef;--line:#2a3542;color-scheme:dark}}body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0;padding:20px max(16px,env(safe-area-inset-left,0px))}h1{font-size:20px}h2{font-size:16px;margin:28px 0 8px}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px}figure{margin:0}img{width:100%;border-radius:6px;display:block}figcaption{font-size:12px;opacity:.7;margin-top:4px}.scroll{overflow-x:auto}table{border-collapse:collapse;margin-top:10px;width:100%}td{border-top:1px solid var(--line);padding:6px 8px;vertical-align:top}td:first-child{white-space:nowrap}</style><h1>Indoor set check: run ${esc(result.run)}</h1>${shots}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { run: { type: 'string' }, out: { type: 'string' } } });
  if (!novelDir || !values.run || !values.out) { console.error('usage: node engine/bench/indoor-set/check.mjs <novel-dir> --run <id> --out <folder>'); process.exit(2); }
  const result = await checkRun(novelDir, { run: values.run, out: resolve(values.out) });
  const all = result.shots.flatMap(shot => Object.values(shot.checks)), count = key => all.filter(check => check.result === key).length;
  console.log(JSON.stringify({ pass: count('pass'), fail: count('fail'), notBuilt: count('not built') }));
  process.exit(0);
}
