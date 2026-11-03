// A controlled test of how precisely Jev picks a building on a map (the user, 2026-11-03: "does jev actually pick more
// precisely with baked in vector visual or semantic description or small thumbnail references"). Cases with a known
// answer, computed from the world's own geometry, at real spots of a few scenes: the tallest building, the nearest, and
// the one nearest the line from you to the tallest. Each case is asked four ways on the same map:
//   plain      the map, its buildings lettered on red spheres, you marked;
//   vectors    the same, with an arrow drawn from you to each building;
//   semantic   the same plain map, each letter described in words (floors, how far, which way on the map);
//   thumbnails the same plain map, and a small close-up picture of each building.
// Paid: one Jev request a case and way. Cached (stage/pick-test/cache in the workspace given), so a rerun is free.
//   JEV_MODEL=jev-1.14.0 node experiments/v2/pick-test.mjs <copy of novel-dir> --scenes scene_000001,scene_000026 [--out report.json]
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const CELL = 2, FLOOR = 3, CANDIDATES = 6, WAYS = ['plain', 'vectors', 'semantic', 'thumbnails'];

/** The right answer of each question over candidates [{ letter, p: [x, y, z], floors, d }] seen from `here`. */
export function answers(here, candidates) {
  const tallest = [...candidates].sort((a, b) => b.floors - a.floors || a.d - b.d)[0], nearest = [...candidates].sort((a, b) => a.d - b.d)[0];
  const ux = tallest.p[0] - here[0], uz = tallest.p[2] - here[2], length = Math.hypot(ux, uz) || 1;
  const onTheWay = candidates.filter(entry => entry !== tallest).map(entry => { const t = ((entry.p[0] - here[0]) * ux + (entry.p[2] - here[2]) * uz) / (length * length); return { entry, t, off: Math.abs((entry.p[0] - here[0]) * uz - (entry.p[2] - here[2]) * ux) / length }; }).filter(entry => entry.t > 0 && entry.t < 1).sort((a, b) => a.off - b.off)[0]?.entry ?? null;
  return { tallest: tallest.letter, nearest: nearest.letter, onTheWay: onTheWay?.letter ?? null };
}
const QUESTIONS = { tallest: 'Which lettered building is the tallest?', nearest: 'Which lettered building is nearest to you (the white sphere marked You)?', onTheWay: 'Of the other lettered buildings, which lies closest to the straight line from you to the tallest one, between you and it?' };
/** Which way a point lies on a north-up map, from `here`. */
const side = (here, p) => { const dx = p[0] - here[0], dz = p[2] - here[2], v = Math.abs(dz) > Math.abs(dx) / 2.4 ? (dz < 0 ? 'upper' : 'lower') : '', h = Math.abs(dx) > Math.abs(dz) / 2.4 ? (dx > 0 ? 'right' : 'left') : ''; return [v, h].filter(Boolean).join(' ') || 'here'; };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelArg] } = parseArgs({ allowPositionals: true, options: { scenes: { type: 'string' }, out: { type: 'string' }, spots: { type: 'string' } } });
  if (!novelArg || !values.scenes) { console.error('usage: node experiments/v2/pick-test.mjs <copy of novel-dir> --scenes a,b [--spots 3] [--out report.json]'); process.exit(2); }
  const novelDir = resolve(novelArg), sceneIds = values.scenes.split(','), spotsPer = Number(values.spots ?? 3);
  const { strandDemo, inlineStrand } = await import('../../world-engine/world/export-strand-demo.mjs'), { browser, serve } = await import('../../world-engine/view/two-view-things.mjs');
  const { VENDOR_FILES, PICKER_MODEL } = await import('../../world-engine/live/sim-jev.mjs');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  const work = join(novelDir, 'stage', 'pick-test'), shots = join(work, 'shots');
  await mkdir(shots, { recursive: true });
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  const template = await readFile(join(repository, 'world-engine', 'view', 'strand-demo.html'), 'utf8');
  const spawn = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'spawn.json'), 'utf8'));
  // PICK_DRY=1: a stand-in that answers the first option, to check the pictures and cases before paying.
  const usage = { requests: 0 }, live = process.env.PICK_DRY ? { modelId: 'dry', decide: async (_state, questions) => questions.map(question => ({ key: question.key, value: question.options[0], confidence: 0.5 })) } : jevFromEnv({ ...process.env, JEV_MODEL: process.env.JEV_MODEL ?? PICKER_MODEL });
  const jev = cachedDecisions({ modelId: live.modelId, decide: (...args) => { usage.requests++; return live.decide(...args); } }, join(work, 'cache'));
  const order = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8')).scenes.map(entry => entry.id).filter(id => sceneIds.includes(id));
  const results = [];
  await strandDemo(novelDir, { from: order[0], to: order.at(-1), worldOnly: true, plain: true, title: 'Pick test', engine: async E => {
    const { world, W } = E, server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true });
    try {
      const page = E.assemble(E.runs);
      await writeFile(join(work, 'index.html'), inlineStrand(template, page, { vendor: true }));
      await chrome.open(server.url);
      const shoot = async (name, size, options) => { await chrome.size(...size); await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: name, frame: size, mask: true, ...options })})`); const png = await chrome.still('png'); await writeFile(join(shots, `${name}.png`), Buffer.from(png, 'base64')); return png; };
      const centre = index => { const lot = world.lots[index]; return [(lot.i0 + lot.nx / 2) * CELL, (lot.height ?? lot.floors ?? 1) * FLOOR, (lot.j0 + lot.nz / 2) * CELL]; };
      for (const scene of E.chosen.filter(entry => sceneIds.includes(entry.id))) {
        const start = spawn.scenes.find(entry => entry.id === scene.id)?.starts?.[0];
        if (!start) continue;
        // The spots: where the scene's first person starts, and as many more about a block away round it.
        const spots = Array.from({ length: spotsPer }, (_, k) => k === 0 ? [start.at[0], 0, start.at[1]] : [start.at[0] + Math.cos(k * 2.1) * 70, 0, start.at[1] + Math.sin(k * 2.1) * 70]);
        for (const [k, here] of spots.entries()) {
          E.reach(here[0], here[2], 260);
          const near = world.lots.map((_, index) => ({ index, p: centre(index), floors: world.lots[index].height ?? world.lots[index].floors ?? 1 })).map(entry => ({ ...entry, d: Math.hypot(entry.p[0] - here[0], entry.p[2] - here[2]) })).filter(entry => entry.d > 20 && entry.d < 240);
          // Six candidates, apart in height and place, so that each question has one answer.
          const picked = [];
          for (const entry of near.sort((a, b) => b.floors - a.floors)) if (picked.length < CANDIDATES && picked.every(other => Math.hypot(other.p[0] - entry.p[0], other.p[2] - entry.p[2]) > 30 && other.floors !== entry.floors)) picked.push(entry);
          if (picked.length < 4) continue;
          const candidates = picked.map((entry, n) => ({ ...entry, letter: String.fromCharCode(65 + n) })), truth = answers(here, candidates);
          const half = Math.max(60, ...candidates.map(entry => entry.d)) + 25, slug = `${scene.id.slice(-3)}-${k}`, labelScale = Math.max(1, half / 40);
          const marks = [...candidates.map(entry => ({ x: entry.p[0], y: entry.p[1] + 4, z: entry.p[2], r: Math.max(4, half / 30), label: entry.letter, labelScale })), { x: here[0], y: 2, z: here[2], r: Math.max(3, half / 40), label: 'You', labelScale, outline: true }];
          const base = { place: scene.placeId, only: [scene.placeId], at: 0, topdown: { x: here[0], z: here[2], half }, spheres: marks };
          const plain = await shoot(`${slug}-plain`, [1024, 1024], base);
          const vectors = await shoot(`${slug}-vectors`, [1024, 1024], { ...base, arrows: candidates.map(entry => ({ at: [here[0], 1, here[2]], vector: [entry.p[0] - here[0], 0, entry.p[2] - here[2]], letter: entry.letter, color: '#ffd36e', length: entry.d * 0.92 })) });
          const thumbs = {};
          for (const entry of candidates) { const lot = world.lots[entry.index], size = Math.max(lot.nx, lot.nz) * CELL; thumbs[`building_${entry.letter}`] = await shoot(`${slug}-thumb-${entry.letter}`, [384, 288], { place: scene.placeId, only: [scene.placeId], at: 0, focus: { x: entry.p[0], z: entry.p[2], y0: 0, w: size, d: size, h: entry.floors * FLOOR }, radius: Math.max(size, entry.floors * FLOOR) * 0.8, elevation: 30, mask: false, spheres: [{ x: entry.p[0], y: entry.floors * FLOOR + 3, z: entry.p[2], r: Math.max(2, size / 6), label: entry.letter, labelScale: Math.max(1, Math.max(size, entry.floors * FLOOR) / 40) }] }); }
          const about = `A top-down map of part of a city, north up, ${Math.round(half * 2)} m across. You are at the white sphere marked You at its middle. Lettered red spheres mark ${candidates.length} buildings.`;
          for (const [question, right] of Object.entries(truth)) {
            if (!right) continue;
            for (const way of WAYS) {
              const hints = way === 'semantic' ? Object.fromEntries(candidates.map(entry => [entry.letter, `${entry.letter}: ${entry.floors} floors, ${Math.round(entry.d)} m from you, toward the ${side(here, entry.p)} of the map`])) : {};
              const images = way === 'thumbnails' ? { map: plain, ...thumbs } : { map: way === 'vectors' ? vectors : plain };
              const state = `${about}${way === 'vectors' ? ' A yellow arrow runs from you to each lettered building.' : ''}${way === 'thumbnails' ? ' Pictures building_A, building_B … show each lettered building close up from the side.' : ''}`;
              const [reply] = await jev.decide(state, [{ key: 'pick', primitive: 'choice', instructions: QUESTIONS[question], options: candidates.map(entry => entry.letter), ...(way === 'semantic' ? { optionHints: hints } : {}) }], { images });
              results.push({ scene: scene.id, spot: k, question, way, right, picked: reply?.value ?? null, confidence: reply?.confidence ?? null, correct: reply?.value === right });
              console.error(`${slug} ${question} ${way}: ${reply?.value} (right ${right})`);
            }
          }
        }
      }
    } finally { await chrome.close(); server.server.close(); }
  } });
  const table = Object.fromEntries(WAYS.map(way => { const of = results.filter(entry => entry.way === way); return [way, { cases: of.length, correct: of.filter(entry => entry.correct).length, accuracy: of.length ? Math.round(100 * of.filter(entry => entry.correct).length / of.length) : null, byQuestion: Object.fromEntries(Object.keys(QUESTIONS).map(question => { const q = of.filter(entry => entry.question === question); return [question, `${q.filter(entry => entry.correct).length}/${q.length}`]; })) }]; }));
  const report = { model: live.modelId, paid: usage.requests, table, results };
  if (values.out) await writeFile(resolve(values.out), JSON.stringify(report, null, 1));
  console.log(JSON.stringify({ paid: usage.requests, table }, null, 1));
}
