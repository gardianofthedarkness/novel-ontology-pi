// A run measured against the indoor set's benchmark (standard.json; the user, 2026-11-12: "Our automated run for the first
// indoor scenes should exactly match it as standard"; 2026-11-13: "Fix all three tonight until fully automated version
// matches the example clip at 95%"). The run's own page is played in a headless Chrome at each moment of the standard, with
// the run's own shot of that unit (the shot stage, data.shots: the camera is the run's, none of ours); the page says what the
// shot drew (window.__shotFacts) and each check is passed or failed. The score is the share of checks passed.
// Written to --out: check.json, the run's frames, and compare.html (the benchmark's frame beside the run's, with the checks).
//
//   node engine/bench/indoor-set/check.mjs <novel-dir> --run <run id> --out <folder>
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { inlineStrand } from '../../world/export-strand-demo.mjs';

const here = dirname(fileURLToPath(import.meta.url)), repository = resolve(here, '..', '..', '..');
const FURNITURE_KINDS = { bed: /bed/, cabinet: /cabinet|nightstand|drawer|dresser/, shelf: /shelf|book/, rug: /rug|carpet/, table: /table|desk/, lamp: /lamp|light/ };
const between = (value, [lo, hi]) => typeof value === 'number' && value >= lo && value <= hi;
const verdict = (pass, seen) => ({ result: pass ? 'pass' : 'fail', seen });

/** Every check of the standard, from the shot's facts at its moments (`at`: moment id to facts) and the run's records. */
export function judge(shot, at, { binding, lot, sky, story }) {
  const out = {}, f = Object.values(at)[0] ?? null, last = Object.values(at).at(-1) ?? null, seen = facts => facts ? `${facts.kind} shot (${facts.phase})` : 'no shot of this unit';
  const shotIs = (facts, kind) => !!facts && facts.kind === kind;
  const peopleIn = facts => (facts?.people ?? []).filter(person => person.inRoom || person.onBalcony).length;
  if (shot.id === 'set') {
    const room = binding && lot?.rooms?.[binding.room], rect = binding?.part ?? (room ? [room.i0 ?? room[1], room.j0 ?? room[2], room.i1 ?? room[3], room.j1 ?? room[4]] : null), area = rect ? (rect[2] - rect[0] + 1) * (rect[3] - rect[1] + 1) * 4 : null;
    out['set.shot'] = verdict(shotIs(f, 'set'), seen(f));
    out['set.room-bound'] = verdict(!!binding && f?.lot === binding.lot && f?.room === binding.room, binding ? `bound lot ${binding.lot} room ${binding.room}${binding.part ? ` (part ${binding.part.join(',')})` : ''}; shot on ${f ? `lot ${f.lot} room ${f.room}` : 'none'}` : 'no bound room');
    out['set.upper-floor'] = verdict(!!binding && binding.floor >= 1 && (lot?.floors ?? 0) >= 3, binding ? `floor ${binding.floor} of ${lot?.floors ?? '?'}` : 'no bound room');
    const kinds = Object.entries(FURNITURE_KINDS).filter(([, test]) => (f?.furniture ?? []).some(model => test.test(model))).map(([kind]) => kind);
    out['set.kind'] = verdict(binding?.kind === 'bedroom' && (f?.furniture?.length ?? 0) > 0, `kind ${binding?.kind ?? 'none'}, ${f?.furniture?.length ?? 0} pieces`);
    out['set.size'] = verdict(between(area, [16, 36]), area === null ? 'no room' : `${area} m²`);
    out['set.nothing-above'] = verdict(!!f && !f.ceiling, f ? (f.ceiling ? 'the floors above drawn' : 'nothing above the room') : 'no shot');
    out['set.near-cut'] = verdict((f?.walls?.cut?.length ?? 0) >= 1, `${f?.walls?.cut?.length ?? 0} side(s) cut low`);
    out['set.far-stand'] = verdict((f?.walls?.standing?.length ?? 0) >= 1, `${f?.walls?.standing?.length ?? 0} side(s) standing`);
    out['set.walls-read'] = verdict((f?.walls?.opacity ?? 0) >= 0.7 && !!f?.walls?.edges, f ? `walls ${f.walls.opacity} opaque, outlined` : 'no shot');
    out['set.window'] = verdict((f?.windows ?? 0) >= 1, `${f?.windows ?? 0} window(s)`);
    out['set.balcony'] = verdict(!!f?.balcony, f?.balcony ? 'a balcony door with its slab and rail' : 'no balcony');
    const dayClear = f?.light === 'day';
    out['set.sun'] = verdict(dayClear && (f?.patches ?? 0) >= 1, `${f?.patches ?? 0} sun patch(es) in a ${f?.light ?? '?'} light`);
    out['set.furniture'] = verdict(kinds.includes('bed') && kinds.length >= 4, `${kinds.join(', ') || 'none'}`);
    out['set.people-in'] = verdict((f?.people?.length ?? 0) > 0 && (f?.people ?? []).every(person => person.inRoom || person.onBalcony), (f?.people ?? []).map(person => `${person.id} ${person.inRoom ? 'in' : person.onBalcony ? 'on the balcony' : `${person.away} m out`}`).join('; ') || 'no one');
    out['set.camera'] = verdict(!!f && between(f.camera.pitch, [26, 40]) && between(f.camera.distance, [8, 14]), f ? `pitch ${f.camera.pitch}°, ${f.camera.distance} m from the room's middle` : 'no shot');
    out['set.moves'] = verdict((f?.moves?.degrees ?? 0) >= 15, `the camera swings ${f?.moves?.degrees ?? 0}° over the unit`);
    out['set.surround'] = verdict(!!f && f.overlays === 0, f ? 'the room, its corridor slab, the building faint, its neighbours faint' : 'no shot');
    out['set.no-overlays'] = verdict(!!f && f.overlays === 0, f ? 'no pins, traces, things or labels but the people\'s names' : 'no shot');
    out['set.figures'] = verdict(!!f && f.figure.radius <= 0.25 && !f.figure.ring, f ? `people ${f.figure.radius * 2} m wide, ${f.figure.ring ? 'a ring' : 'no ring'}` : 'no shot');
    out['set.outside'] = verdict(dayClear && between(sky?.hour, [8, 10]), `${f?.light ?? '?'} light at ${sky?.hour ?? '?'}:00`);
    out['set.story'] = verdict(!!story.onBalcony, story.onBalcony ? 'someone out on the balcony' : 'no one on the balcony');
  } else if (shot.id === 'eye') {
    const all = Object.values(at);
    out['eye.shot'] = verdict(all.every(facts => shotIs(facts, 'eye')), all.map(seen).join('; '));
    out['eye.inside'] = verdict(!!f?.camera?.inside && between(f.camera.height, [1.4, 1.8]), f ? `camera ${f.camera.inside ? 'inside' : 'outside'} the room at ${f.camera.height} m` : 'no shot');
    out['eye.walls-ceiling'] = verdict(f?.walls?.standing?.length === 4 && !!f?.ceiling, f ? `${f.walls.standing.length} walls standing, ${f.ceiling ? 'a ceiling' : 'no ceiling'}` : 'no shot');
    out['eye.window-view'] = verdict((f?.windows ?? 0) >= 1, `${f?.windows ?? 0} window(s) to look out of`);
    out['eye.rain'] = verdict(f?.light === 'rain' && !!f?.rain && (f?.patches ?? 0) === 0, f ? `${f.light} light, ${f.rain ? 'rain' : 'no rain'}, ${f.patches} patch(es)` : 'no shot');
    out['eye.people'] = verdict(peopleIn(f) >= 1 && (f?.people ?? []).every(person => person.inRoom || person.onBalcony), (f?.people ?? []).map(person => `${person.id} ${person.inRoom ? 'in' : `${person.away} m out`}`).join('; ') || 'no one');
    out['eye.moves'] = verdict((f?.moves?.metres ?? 0) >= 0.2, `the camera drifts ${f?.moves?.metres ?? 0} m`);
    out['eye.no-overlays'] = verdict(!!f && f.overlays === 0, f ? 'none' : 'no shot');
  } else {
    const [a, b, c] = Object.values(at);
    out['outside.shot'] = verdict(shotIs(a, 'outside') && a.phase === 'outside' && c?.phase === 'into', [a, b, c].map(seen).join('; '));
    out['outside.facade'] = verdict((a?.facadePanes ?? 0) >= 3, `${a?.facadePanes ?? 0} window panes on the faces toward the camera`);
    out['outside.lit'] = verdict(['dusk', 'night'].includes(a?.light) && (a?.litPanes ?? 0) >= 1, a ? `${a.light} light, ${a.litPanes} lit pane(s)` : 'no shot');
    out['outside.fade'] = verdict(!!a && !!b && b.shellOpacity < a.shellOpacity, a && b ? `the shell ${a.shellOpacity} then ${b.shellOpacity}` : 'no shot');
    out['outside.into-set'] = verdict(c?.phase === 'into' && (c?.walls?.cut?.length ?? 0) >= 1, c ? `${c.phase}, ${c.walls.cut.length} side(s) cut` : 'no shot');
    out['outside.rises'] = verdict((a?.moves?.metres ?? 0) >= 10, `the camera travels ${a?.moves?.metres ?? 0} m`);
    out['outside.story'] = verdict((c?.people ?? []).some(person => !person.inRoom && person.level && person.away <= 4), (c?.people ?? []).map(person => `${person.id} ${person.inRoom ? 'in the room' : `${person.away} m out`}`).join('; ') || 'no one');
    out['outside.no-overlays'] = verdict(!!a && a.overlays === 0, a ? 'none' : 'no shot');
  }
  return out;
}

export async function checkRun(novelDir, { run, out, log = console.error }) {
  const novel = resolve(novelDir), standard = JSON.parse(await readFile(join(here, 'standard.json'), 'utf8'));
  const page = JSON.parse(await readFile(join(novel, 'stage', 'simulation', 'runs', 'director', `${run}.page.json`), 'utf8'));
  const script = JSON.parse(await readFile(join(novel, 'stage', 'world', 'script.json'), 'utf8'));
  const plan = JSON.parse(await readFile(join(novel, 'stage', 'world', 'room-plan.json'), 'utf8').catch(() => 'null')) ?? {};
  const bound = JSON.parse(await readFile(join(novel, 'stage', 'world', 'rooms.json'), 'utf8').catch(() => 'null'))?.rooms ?? {};
  const chainOf = id => { const chain = []; for (let at = id, guard = 0; at && guard < 16; at = script.places?.[at]?.parent, guard++) chain.push(at); return chain; };
  const bindingOf = unitId => { const place = script.scenes?.find(scene => scene.id === unitId)?.place, chain = place ? chainOf(place) : [], room = chain.find(id => bound[id]); if (room) return bound[room]; const building = chain.find(id => Object.values(bound).some(b => b.building === id && !b.entry)); return building ? Object.values(bound).find(b => b.building === building && !b.entry) : null; };
  if (!page.shots) { page.shots = {}; for (const scene of script.scenes ?? []) { const b = bindingOf(scene.id); if (b) page.shots[scene.id] = { kind: plan.shots?.[scene.id]?.kind ?? 'set', lot: b.lot, room: b.room, ...(b.part ? { part: b.part } : {}), away: Object.entries(plan.staging?.[scene.id] ?? {}).filter(([, staged]) => staged.at === 'elsewhere').map(([who]) => who) }; } log('shots filled from the room plan (a run made before shots)'); }
  // A run whose shots predate `away`: whom the agent put elsewhere in each unit, from its plan.
  for (const [unitId, shot] of Object.entries(page.shots)) shot.away ??= Object.entries(plan.staging?.[unitId] ?? {}).filter(([, staged]) => staged.at === 'elsewhere').map(([who]) => who);
  const { browser, serve } = await import('../../view/two-view-things.mjs'), { VENDOR_FILES } = await import('../../live/sim-jev.mjs');
  const work = join(out, 'page');
  await mkdir(join(out, 'stills'), { recursive: true });
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  await writeFile(join(work, 'index.html'), inlineStrand(await readFile(join(repository, 'engine', 'view', 'strand-demo.html'), 'utf8'), page, { vendor: true }));
  const server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true }), result = { run, shots: [] };
  const lengths = { set: 11, eye: 10, outside: 11 };
  try {
    await chrome.size(1440, 810);
    await chrome.open(server.url);
    await new Promise(done => setTimeout(done, 5000));
    const units = new Map((await chrome.evaluate('window.__units()')).map(unit => [unit.id, unit]));
    const factsAt = async (unitId, share) => {
      const unit = units.get(unitId); if (!unit) return null;
      const at = unit.start + (unit.end - unit.start) * Math.min(0.98, share), base = { scene: unit.id, place: unit.place, at, people: true, frame: [1440, 810], storySky: true, shot: true };
      await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, id: 'warm' })})`); await new Promise(done => setTimeout(done, 1000));
      await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, id: `${unitId}-check` })})`); await new Promise(done => setTimeout(done, 500));
      const facts = await chrome.evaluate('window.__shotFacts()');
      return facts?.unit === unitId ? facts : null;
    };
    for (const shot of standard.shots) {
      const binding = bindingOf(shot.unit), at = {};
      for (const moment of shot.moments) {
        at[moment.id] = await factsAt(shot.unit, moment.t / lengths[shot.id]);
        await writeFile(join(out, 'stills', `${moment.id}.png`), Buffer.from(await chrome.still('png'), 'base64'));
      }
      // The set's staging may fall in the next units of the room (storyUnits): someone on the balcony at any of their ends.
      let onBalcony = false;
      for (const unitId of shot.storyUnits ?? []) { const facts = await factsAt(unitId, 0.98); if ((facts?.people ?? []).some(person => person.onBalcony)) onBalcony = true; }
      const sky = (await chrome.evaluate('window.__replay()'))?.sky ?? null, lot = binding ? page.world?.lots?.[binding.lot] : null;
      const lotRoom = lot?.rooms?.[binding?.room];
      const checks = judge(shot, at, { binding, lot: lot ? { ...lot, rooms: lot.rooms.map(r => (Array.isArray(r) ? { floor: r[0], i0: r[1], j0: r[2], i1: r[3], j1: r[4] } : r)) } : null, sky: { hour: skyHour(page, shot.unit) }, story: { onBalcony } });
      result.shots.push({ shot: shot.id, unit: shot.unit, facts: at, checks, room: lotRoom ?? null });
      const counts = Object.values(checks).reduce((sum, check) => ({ ...sum, [check.result]: (sum[check.result] ?? 0) + 1 }), {});
      log(`${shot.id} (${shot.unit}): ${Object.entries(counts).map(([key, n]) => `${n} ${key}`).join(', ')}`);
    }
  } finally { await chrome.close(); server.server.close(); }
  const all = result.shots.flatMap(entry => Object.values(entry.checks)), passed = all.filter(check => check.result === 'pass').length;
  result.score = { passed, of: all.length, share: Math.round((passed / Math.max(1, all.length)) * 1000) / 10 };
  await writeFile(join(out, 'check.json'), JSON.stringify(result, null, 1));
  await writeFile(join(out, 'compare.html'), compareHtml(standard, result));
  for (const shot of standard.shots) for (const moment of shot.moments) await copyFile(join(here, 'reference', `${moment.id}.png`), join(out, 'stills', `reference-${moment.id}.png`)).catch(() => {});
  return result;
}

/** The story's hour of a unit (the page's sky). */
function skyHour(page, unitId) { return page.sky?.units?.[unitId]?.hour ?? null; }

/** The benchmark's frames beside the run's, shot by shot, with each check's result. */
function compareHtml(standard, result) {
  const esc = text => String(text).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const colour = { pass: '#2f9e5b', fail: '#d0453a' };
  const shots = standard.shots.map(shot => {
    const run = result.shots.find(entry => entry.shot === shot.id) ?? { checks: {} };
    const rows = shot.checks.map(check => { const got = run.checks[check.id] ?? { result: 'fail', seen: 'not measured' }; return `<tr><td><b style="color:${colour[got.result]}">${esc(got.result)}</b></td><td>${esc(check.what)}</td><td>${esc(got.seen)}</td></tr>`; }).join('');
    const pairs = shot.moments.map(moment => `<div class="pair"><figure><img src="stills/reference-${moment.id}.png"><figcaption>Benchmark ${moment.id}</figcaption></figure><figure><img src="stills/${moment.id}.png"><figcaption>Run ${esc(result.run)}</figcaption></figure></div>`).join('');
    return `<section><h2>${esc(shot.title)} &middot; ${esc(shot.unit)} &middot; ${esc(shot.sky.time)} ${esc(shot.sky.weather)}</h2>${pairs}<div class="scroll"><table>${rows}</table></div></section>`;
  }).join('');
  return `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Indoor Set Check</title><style>:root{--bg:#f4f6f8;--fg:#18222e;--line:#d8dee5}@media (prefers-color-scheme: dark){:root{--bg:#10161d;--fg:#e3e9ef;--line:#2a3542;color-scheme:dark}}body{background:var(--bg);color:var(--fg);font:14px/1.45 system-ui,sans-serif;margin:0;padding:20px max(16px,env(safe-area-inset-left,0px))}h1{font-size:20px}h2{font-size:16px;margin:28px 0 8px}.pair{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:10px;margin-bottom:10px}figure{margin:0}img{width:100%;border-radius:6px;display:block}figcaption{font-size:12px;opacity:.7;margin-top:4px}.scroll{overflow-x:auto}table{border-collapse:collapse;margin-top:10px;width:100%}td{border-top:1px solid var(--line);padding:6px 8px;vertical-align:top}td:first-child{white-space:nowrap}</style><h1>Indoor set check: run ${esc(result.run)} &middot; ${result.score.passed} of ${result.score.of} (${result.score.share}%)</h1>${shots}`;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { run: { type: 'string' }, out: { type: 'string' } } });
  if (!novelDir || !values.run || !values.out) { console.error('usage: node engine/bench/indoor-set/check.mjs <novel-dir> --run <id> --out <folder>'); process.exit(2); }
  const result = await checkRun(novelDir, { run: values.run, out: resolve(values.out) });
  console.log(JSON.stringify(result.score));
  process.exit(0);
}
