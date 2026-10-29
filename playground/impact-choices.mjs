#!/usr/bin/env node
/**
 * Jev places a fight's damage from pictures the reader would see, the way things are placed: choices on ghosts.
 *
 * For every fight the strand's stand-in found breaking something (its strength from the event's embedding):
 *   1. where it hits: the place just before the hit, from the reader's camera, with lettered red spheres at the likely
 *      impact points (on the faces of the buildings by the fighters, on the nearest roofs, between the fighters); Jev
 *      picks one, or "no damage";
 *   2. how big: close-ups of the chosen point from the reader's side and from the side, with concentric red spheres
 *      4, 8, 16 and 32 m across labelled 1–4; one choice on both. The same call boxes the blast on a third close-up with
 *      only the point marked, which is measured in metres to compare a box with the choice.
 * The exporter breaks every building the chosen sphere reaches, a step down its percolation curve inside the sphere.
 *
 *   node playground/impact-choices.mjs <strand-page.html> <novel-dir> --vendor <dir> [--out <dir>] [--fresh] [--model jev-1.14.0]
 *
 * Writes <novel-dir>/stage/impacts.json, saved after every fight. Answers are reused unless --fresh. `novel sim pick`
 * runs the same choices (pickImpacts) on the book's story lines.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { browser, serve } from './two-view-things.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SIZES = [4, 8, 16, 32];

/** Every fight on a strand's stage (the page's window.__stage.fights, or the same made from its data), keyed as its answer is kept. */
export const fightWork = stage => stage.fights.map(fight => ({ fight, key: `${fight.scene}|${fight.event}` }));

/**
 * Jev's choices for every fight on a strand's stage not answered yet (with `again`, answered ones are shown again and kept
 * as answered, for their stills): `fights` (by key) is filled in and saved after each, and `after` told of it (the live view
 * draws what came out). A fight with no spot to hit is kept
 * as such, so the stand-in stays. No fight is started once `budget` calls are spent. Returns the calls made and the fights
 * asked, reused and left.
 */
export async function pickImpacts({ chrome, jev, stage, fights, save, budget = Infinity, again = false, out = null, log = console.error, after = null }) {
  let calls = 0, asked = 0, reused = 0, left = 0;
  for (const [n, { fight, key }] of fightWork(stage).entries()) {
    const kept = fights[key], slug = `${String(n + 1).padStart(2, '0')}-${fight.scene}-${fight.event}`, place = stage.places[fight.place];
    if (kept && !again) { reused++; continue; }
    if (!kept && calls >= budget) { left++; continue; }
    if (kept) reused++; else asked++;
    const base = { scene: fight.scene, event: fight.event, place: fight.place, mask: true, beforeHit: true }, capture = options => chrome.evaluate(`window.__stage.capture(${JSON.stringify({ ...base, ...options })})`);
    const about = [
      `A still of a 3D model of a place in a novel, just before a fight breaks part of a building.`,
      `Place: ${place.path.join(' › ')} (${place.kind} of ${place.lots} buildings). Blue lattices are the buildings' corridors and orange their stairs; small labelled dots are people.`,
      `Event: ${fight.text}`,
    ];
    await capture({ id: `${key}#look` });
    const spots = await chrome.evaluate(`window.__stage.impactSpots(${JSON.stringify({ place: fight.place })})`);
    if (!spots.length) { fights[key] = { spots, unplaced: true }; await save(); continue; }
    // Call 1: where it hits.
    await capture({ id: `${key}#where`, spheres: spots.map(spot => ({ ...spot, r: 2.5 })) });
    const where = await chrome.still(), letters = spots.map(spot => spot.label);
    const pick = kept?.pick ?? await (async () => {
      calls++;
      const [answer] = await jev.decide([...about, `Picture "where": the place at this moment, with ${letters.length} lettered red spheres where the fight might hit a building.`].join('\n'),
        [{ key: 'where', primitive: 'choice', instructions: 'Which lettered red sphere in picture "where" is where this event breaks a building? Answer none if it breaks no building.', options: [...letters, 'none'], optionHints: Object.fromEntries([...spots.map(spot => [spot.label, `${spot.label}: the sphere lettered ${spot.label}, on ${spot.from}`]), ['none', 'none: this event breaks no building']]) }], { images: { where } });
      return { pick: answer.value, confidence: answer.confidence ?? null, distribution: answer.distribution ?? {} };
    })();
    if (out) await writeFile(join(out, `${slug}-where.png`), Buffer.from(where, 'base64'));
    if (pick.pick === 'none') {
      fights[key] = { pick, spots, none: true };
      await save();
      if (after) await after({ kind: 'fight', key, base, none: true });
      log(`${key} (${fight.text.slice(0, 24)}…): no damage (${pick.confidence?.toFixed(2)})`);
      continue;
    }
    const chosen = spots.find(spot => spot.label === pick.pick) ?? spots[0], focus = { x: chosen.x, y0: chosen.y - 1, z: chosen.z, w: 2, h: 2, d: 2 };
    // Call 2: how big. Concentric spheres from two sides, a choice on both; a box on the point alone, to compare.
    const rings = SIZES.map((size, i) => ({ x: chosen.x, y: chosen.y, z: chosen.z, r: size / 2, label: `${i + 1}`, outline: true }));
    const views = [['near', 0, null, rings], ['side', 90, 20, rings], ['plain', 0, null, [{ x: chosen.x, y: chosen.y, z: chosen.z, r: 0.6 }]]], stills = [];
    for (const [name, turn, elevation, spheres] of views) { await capture({ id: `${key}#${name}`, focus, radius: 22, yaw: turn * Math.PI / 180, ...(elevation === null ? {} : { elevation }), spheres }); stills.push({ name, still: await chrome.still() }); }
    const size = kept?.size ?? await (async () => {
      calls++;
      const [choice, box] = await jev.decide([...about, `Pictures "near" and "side": close-ups of where the fight hits, from the reader's side and from the side, with four red spheres around the point, labelled 1 to 4: ${SIZES.map((size, i) => `${i + 1} is ${size} m across`).join(', ')}. Picture "plain": the same close-up with only the point marked.`].join('\n'), [
        { key: 'size', primitive: 'choice', instructions: 'Which labelled sphere in pictures "near" and "side" is the size of what this event breaks?', options: SIZES.map((_, i) => `${i + 1}`), optionHints: Object.fromEntries(SIZES.map((size, i) => [`${i + 1}`, `${i + 1}: the sphere ${size} m across`])) },
        { key: 'blast', primitive: 'box', instructions: 'In picture "plain", the part of the building this event breaks around the marked point: its whole extent.' },
      ], { images: Object.fromEntries(stills.map(({ name, still }) => [name, still])) });
      return { pick: choice.value, confidence: choice.confidence ?? null, distribution: choice.distribution ?? {}, box: box.box, boxConfidence: box.confidence ?? null };
    })();
    const across = SIZES[Number(size.pick) - 1] ?? SIZES[1], measured = await chrome.evaluate(`window.__stage.measure(${JSON.stringify({ camera: `${key}#plain`, box: size.box, point: chosen, place: fight.place })})`);
    const boxed = Math.round(Math.max(measured.across, measured.up) * 10) / 10;
    fights[key] = { pick, spots, chosen: chosen.label, size, sphere: { x: chosen.x, y: chosen.y, z: chosen.z, r: across / 2 }, boxed };
    await save();
    if (after) await after({ kind: 'fight', key, base, focus, chosen: `${chosen.label} on ${chosen.from}`, sphere: fights[key].sphere });
    if (out) for (const { name, still } of stills) await writeFile(join(out, `${slug}-${name}.png`), Buffer.from(still, 'base64'));
    log(`${key} (${fight.text.slice(0, 24)}…): ${chosen.label} on ${chosen.from} (${pick.confidence?.toFixed(2)}) → size ${size.pick}: ${across} m (${size.confidence?.toFixed(2)}); the box measures ${boxed} m (${size.boxConfidence?.toFixed(2)})`);
  }
  return { calls, asked, reused, left };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { vendor: { type: 'string' }, out: { type: 'string' }, fresh: { type: 'boolean' }, model: { type: 'string', default: 'jev-1.14.0' } } });
  const [page, novelDir] = positionals.map(path => resolve(path));
  if (!page || !novelDir || !values.vendor) throw new Error('Usage: node playground/impact-choices.mjs <strand-page.html> <novel-dir> --vendor <dir> [--out <dir>] [--fresh]');
  const { jevFromEnv } = await import(pathToFileURL(`${repository}/dist/src/ground/connectors/jev.js`));
  const jev = jevFromEnv({ ...process.env, JEV_MODEL: values.model }), report = `${novelDir}/stage/impacts.json`, out = values.out ? resolve(values.out) : null;
  const fights = values.fresh ? {} : (JSON.parse(await readFile(report, 'utf8').catch(() => 'null'))?.fights ?? {});
  const save = () => writeFile(report, JSON.stringify({ version: 1, model: jev.modelId, askedAt: new Date().toISOString(), sizes: SIZES, fights }, null, 1), { mode: 0o644 });
  if (out) await mkdir(out, { recursive: true });
  const { server, url } = await serve(page, resolve(values.vendor)), chrome = await browser(), started = Date.now();
  let calls = 0;
  try {
    await chrome.open(url);
    const stage = await chrome.evaluate('({ fights: window.__stage.fights, places: window.__stage.places })');
    ({ calls } = await pickImpacts({ chrome, jev, stage, fights, save, again: true, out }));
  } finally { await chrome.close(); server.close(); }
  await save();
  // The run, in brief: how sure the choices were, how often none, and the box against the choice.
  const asked = Object.values(fights).filter(entry => entry.pick), hit = asked.filter(entry => !entry.none), mean = list => Math.round(list.reduce((sum, value) => sum + (value ?? 0), 0) / Math.max(1, list.length) * 100) / 100;
  const ratios = hit.map(entry => entry.boxed / (entry.sphere.r * 2)).sort((a, b) => a - b);
  console.error(`fights ${asked.length}: no damage ${asked.length - hit.length}; where confidence ${mean(asked.map(entry => entry.pick.confidence))}; size confidence ${mean(hit.map(entry => entry.size.confidence))}, sizes ${SIZES.map((size, i) => `${size} m ×${hit.filter(entry => entry.size.pick === `${i + 1}`).length}`).join(', ')}; box confidence ${mean(hit.map(entry => entry.size.boxConfidence))}, box ÷ chosen size (median) ${ratios.length ? Math.round(ratios[Math.floor(ratios.length / 2)] * 100) / 100 : '-'}`);
  console.log(JSON.stringify({ report, fights: asked.length, none: asked.length - hit.length, calls, seconds: (Date.now() - started) / 1000 }));
}
