#!/usr/bin/env node
/**
 * Terrain and spawns before the world plays (the user's call, 2026-10-31; docs/v2/world-engine-v2.md §2.0.7), once the
 * whole extraction is done and the world loop has said where each scene happens:
 *
 * 1. Terrain: the book's main sites (the places its scenes happen in), in story order of their first scene, each placed in
 *    the place that holds it on the place tree (a district in its city, a street in its district) by Jev, on a picture of
 *    that place from above: its ground (its landscape, the manifold the engine fills), the sites placed in it so far by
 *    name, and boxes to choose from (O over the middle, A–H round the edge). Then, up to `turns` times, whether the box
 *    fits, and a better box if not. Evidence: the sentences that name the site, and its scenes' environment cards (the
 *    reading's base layer). Kept in stage/terrain.json: the engine bears each site toward where Jev put it, instead of
 *    toward the place it has most travel with, and its canvas keeps the sites clear of one another as before.
 * 2. Spawns: scene by scene, does it carry straight on from the scene before (the same moment and surroundings: people are
 *    where it left them, and walk on) or start anew (time moved on, or the place and what is around changed a lot:
 *    everyone present is placed afresh, at birth, not walked from where they were hours before)? A rule where the time
 *    tree and the world loop say it (a new day or part of the day, into or out of the past: anew; the same place and time,
 *    carrying on: carries on); the rest asked of Jev together, each with both scenes' place, time, environment cards, the
 *    scene before's end and this scene's opening. Kept in stage/world/spawn.json; the engine asks a new start for every
 *    person present in a scene that starts anew, with the scene's environment and who is already where in its question.
 *
 * Both are recorded on the live page (stage/simulation/live: every question with its picture, each outcome), so the host's
 * play/live page shows them as they happen and keeps them after. Jev's answers are cached under stage/terrain-cache.
 *
 *   npm run build && node playground/terrain.mjs <novel-dir> [--turns 1] [--max-sites 30]
 */
import { mkdir, mkdtemp, readFile, rename, writeFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { browser, serve } from './two-view-things.mjs';
import { createLive, PICKER_MODEL, VENDOR_FILES } from './sim-jev.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..'), load = path => import(pathToFileURL(`${repository}/${path}`).href);
const round = value => Math.round(value * 10) / 10;
const clip = (text, size) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
/** How far a parent's picture reaches (metres from the middle to the top), at least, by the parent's scale. */
const HALF = { region: 1600, city: 760, district: 320, street: 140, building: 60 };
/** The sides of the eight boxes round the edge, A north and then clockwise. */
const SIDES = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const OPEN = new Set(['region', 'city', 'district', 'street']);

async function replace(file, body) { const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, body, { mode: 0o644 }); await rename(temporary, file); }

export async function terrainAndSpawns(novelDir, { jev: given = null, turns = 1, maxSites = 30, live: givenLive = null, log = () => {} } = {}) {
  const L = await load('dist/src/ground/stage/landscape.js'), C = await load('dist/src/ground/stage/placeCanvas.js');
  const { stageInputs } = await load('dist/src/cli/commands/extract/stageCommands.js');
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  const inputs = await stageInputs(novelDir), script = inputs.world;
  if (!script) throw new Error('Terrain and spawns need the world loop\'s script (stage/world/script.json): run the world loop first.');
  const manifest = JSON.parse(await readFile(join(novelDir, 'ontology', 'manifest.json'), 'utf8'));
  const baseScenes = manifest.v2Reading?.out ? JSON.parse(await readFile(join(manifest.v2Reading.out, 'base', 'scenes.json'), 'utf8').catch(() => '[]')) : [];
  const base = new Map(baseScenes.map(scene => [scene.id, scene]));
  const sentences = [...(await loadWorkspaceSentences(novelDir)).values()];
  const name = id => inputs.names[id] ?? script.places?.[id]?.label ?? id;
  const tree = new Map((inputs.placeTree ?? inputs.data.places).map(place => [place.id, place]));
  const scaleOf = id => inputs.scale?.places[id]?.scale ?? null;
  const typeOf = id => L.groundFor(inputs.landscape?.places[id], (tree.get(id)?.path ?? [id]).filter(at => at !== id).reverse(), at => inputs.landscape?.places[at], scaleOf(id) ?? 'district').type ?? 'residential';
  const jev = cachedDecisions(given ?? jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL }), join(novelDir, 'stage', 'terrain-cache'));
  const live = givenLive ?? await createLive(novelDir, { command: 'terrain', lines: [{ id: 'terrain', title: 'Terrain: where the main sites lie' }, { id: 'spawns', title: 'Spawns: which scenes carry on, which start anew' }], model: jev.modelId });
  const asking = live.watch(jev);
  let calls = 0;
  const decide = async (state, questions, options) => { calls++; return asking.decide(state, questions, options); };

  // The sites: every place a scene happens in (the world loop's), in story order of its first scene; each one's parent.
  const firstScene = new Map(), sceneCount = new Map();
  script.scenes.forEach((scene, index) => { if (!scene.place || String(scene.place).startsWith('spot:')) return; if (!firstScene.has(scene.place)) firstScene.set(scene.place, index); sceneCount.set(scene.place, (sceneCount.get(scene.place) ?? 0) + 1); });
  // A site's ancestors that hold scenes of their own come first; a site with no open parent (the top of the tree) is not placed.
  const parentOf = id => { const path = tree.get(id)?.path ?? [id]; return [...path].reverse().slice(1).find(at => OPEN.has(scaleOf(at) ?? '')) ?? null; };
  const order = [...new Set([...firstScene.keys()].flatMap(id => [...(tree.get(id)?.path ?? [id])].filter(at => at === id || firstScene.has(at))))]
    .filter(id => parentOf(id)).sort((a, b) => (firstScene.get(a) ?? Infinity) - (firstScene.get(b) ?? Infinity)).slice(0, maxSites);
  const environmentOf = id => script.scenes.filter(scene => scene.place === id).flatMap(scene => (base.get(scene.id)?.environment ?? []).map(card => clip(card.text, 160))).slice(0, 3);
  const evidence = id => {
    const label = name(id), naming = sentences.filter(sentence => sentence.text.includes(label) && sentence.text.length >= label.length + 6);
    const parent = parentOf(id), others = [name(parent), ...order.filter(other => other !== id && parentOf(other) === parent).map(name)];
    return [...naming.slice(0, 3), ...naming.slice(3).filter(sentence => others.some(other => sentence.text.includes(other))).slice(0, 2)].map(sentence => clip(sentence.text, 140));
  };

  // The picture: the parent's ground from above (its landscape, filled), the sites placed in it so far (where its canvas
  // bears them), and the boxes asked about. Drawn by the landscape page in headless Chrome, as the district box loop does.
  const library = JSON.parse(await readFile(join(repository, 'apps/playground/src/data/architectureModels.json'), 'utf8'));
  const mapData = (parent, half, placed, boxes) => {
    const landscape = L.firstLandscape(parent, typeOf(parent)), filled = L.fillLandscape(landscape), typeById = Object.fromEntries(landscape.patches.map(p => [p.id, p.type]));
    const circle = (x, z, r) => Array.from({ length: 48 }, (_, n) => { const t = n / 48 * Math.PI * 2; return [round(x + r * Math.cos(t)), round(z + r * Math.sin(t))]; });
    return {
      title: `${name(parent)}: its sites`, extent: half, roads: filled.fabric.roads.map(r => ({ a: r.a.map(round), b: r.b.map(round), width: r.width, level: r.level })),
      buildings: [...filled.fabric.buildings.map(b => ({ x: round(b.x), z: round(b.z), w: round(b.w), d: round(b.d), angle: b.angle, floors: b.floors, k: b.kind })), ...filled.landmarks.map(m => ({ ...m, k: m.kind, ...(m.kind === 'skyscraper' ? { form: 'sky-spire' } : {}) })), ...filled.keeps.map(k => ({ ...k, k: 'keep' }))],
      named: [], places: [], walls: filled.walls.map(([a, b]) => ({ a, b })),
      fields: filled.fabric.lots.filter(lot => ['farm', 'park'].includes(typeById[filled.owner[lot.id]])).map(lot => ({ pts: lot.pts.map(p => p.map(round)), o: 0.06 })),
      outlines: [{ pts: circle(0, 0, L.circleOf(landscape, 0)), label: `${name(parent)} (${typeOf(parent)})`, at: [0, 0] }, ...placed.map(site => ({ pts: circle(site.at[0], site.at[1], site.r), label: site.label, at: site.at }))],
      boxes, models: Object.fromEntries(Object.entries(library.models).filter(([id]) => /^(skyscraper|tower|office|block-wide|keep|fountain)/.test(id))),
    };
  };
  const work = await mkdtemp(join(tmpdir(), 'terrain-'));
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  const page = (await readFile(join(repository, 'playground', 'landscape-mock.html'), 'utf8')).replace('https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js', './vendor/three.module.js').replace('https://cdn.jsdelivr.net/npm/three@0.160.0/examples/jsm/', './vendor/addons/');
  await writeFile(join(work, 'index.html'), page);
  const { server, url } = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser();
  const draw = async (data, view) => { await chrome.evaluate(`window.__stage.load(${JSON.stringify(data)})`); await chrome.evaluate(`window.__stage.view(${JSON.stringify(view)})`); return chrome.still('png'); };

  const terrainFile = join(novelDir, 'stage', 'terrain.json'), spawnFile = join(novelDir, 'stage', 'world', 'spawn.json');
  const terrain = { version: 1, model: jev.modelId, askedAt: new Date().toISOString(), sites: {}, order: [] };
  try {
    await chrome.open(url);
    // 1. Terrain, parent by parent as sites come in story order; each parent's canvas holds what is placed in it.
    await live.line(0, { status: 'running', sites: order.length }); await live.phase('terrain');
    const canvases = new Map();
    const canvasOf = parent => { if (!canvases.has(parent)) { const canvas = C.emptyCanvas(); C.bear(canvas, { id: parent, label: name(parent), scale: scaleOf(parent) ?? 'city', parent: null, landscape: typeOf(parent) }); canvases.set(parent, canvas); } return canvases.get(parent); };
    for (const [n, id] of order.entries()) {
      const parent = parentOf(id), canvas = canvasOf(parent), host = canvas.places[parent];
      const placed = Object.values(canvas.places).filter(place => place.parent === parent).map(place => ({ label: place.label, at: place.at, r: place.r }));
      const scale = scaleOf(id) ?? 'district', type = typeOf(id);
      const size = OPEN.has(scale) ? Math.max(C.LEAST[scale] ?? 60, (L.LANDSCAPES[type]?.radius ?? [60, 120]).reduce((a, b) => a + b) / 2) : C.LEAST[scale] ?? 20;
      const reach = Math.max(L.circleOf(host.landscape ?? { patches: [] }, 0), ...placed.map(site => Math.hypot(...site.at) + site.r));
      const half = Math.max(HALF[scaleOf(parent) ?? 'city'] ?? 300, Math.round((reach + 2 * size + 30) * 1.1));
      const edge = reach + size + 15, candidates = [{ key: 'O', x: 0, z: 0, where: 'over the middle' }, ...SIDES.map((where, k) => { const angle = -Math.PI / 2 + k * Math.PI / 4; return { key: 'ABCDEFGH'[k], x: Math.cos(angle) * edge, z: Math.sin(angle) * edge, where }; })]
        .map(c => ({ ...c, x0: round(c.x - size), x1: round(c.x + size), z0: round(c.z - size), z1: round(c.z + size) }));
      const facts = evidence(id), environment = environmentOf(id);
      const state = {
        task: `Where does ${name(id)} lie in ${name(parent)}? A site of a novel's story, placed on a map of the place that holds it.`,
        place: { name: name(parent), ground: `${typeOf(parent)}: ${L.LANDSCAPES[typeOf(parent)]?.hint ?? ''}` },
        site: { name: name(id), scale, ground: `${type}: ${L.LANDSCAPES[type]?.hint ?? ''}`, scenes: sceneCount.get(id) ?? 0 },
        ...(placed.length ? { placed: placed.map(site => site.label) } : {}),
        text: facts, ...(environment.length ? { environment } : {}),
        picture: `map: ${name(parent)} from above, north up, ${half * 2} m from top to bottom. Its own ground is filled and outlined in the middle; the sites placed so far are outlined and named. Boxes: O over the middle, A–H round the edge (A north, then clockwise).`,
      };
      const choiceStill = await draw(mapData(parent, half, placed, candidates.map(c => ({ ...c, label: c.key, faint: c.key !== 'O' }))), { mode: 'top', target: [0, 0], half });
      const [where] = await decide(state, [{ key: 'where', primitive: 'choice', instructions: `Where in ${name(parent)} does ${name(id)} lie, as far as the text tells? O: over the middle of ${name(parent)}. A–H: beside what is placed so far, toward that side. With nothing in the text about where it lies, pick a box beside the others rather than over one.`, options: candidates.map(c => c.key), optionHints: Object.fromEntries(candidates.map(c => [c.key, `${c.key}: ${c.where}`])) }], { images: { map: choiceStill } });
      const picked = candidates.find(c => c.key === where?.value) ?? candidates[0];
      let box = { x0: picked.x0, x1: picked.x1, z0: picked.z0, z1: picked.z1 };
      const turnsTaken = [];
      const toMetres = ({ left, right, top, bottom }) => { const a = 4 / 3; return { x0: round(-half * a + 2 * half * a * left), x1: round(-half * a + 2 * half * a * right), z0: round(-half + 2 * half * top), z1: round(-half + 2 * half * bottom) }; };
      for (let turn = 1; turn <= turns; turn++) {
        const still = await draw(mapData(parent, half, placed, [{ ...box, label: `${name(id)}${turn === 1 ? '' : ` (turn ${turn})`}` }]), { mode: 'top', target: [0, 0], half });
        const [fit, better] = await decide({ ...state, picture: `map: as before, with a white box labelled ${name(id)}: where it would lie now.` }, [
          { key: 'fit', primitive: 'choice', instructions: `Does the white box show where ${name(id)} lies in ${name(parent)}, and about how much ground it takes, as far as the text tells?`, options: ['fits', 'adjust'], optionHints: { fits: 'fits: keep it', adjust: 'adjust: a better box is needed (it sits where the text does not put it, over another site, or is the wrong size)' } },
          { key: 'box', primitive: 'box', instructions: `Draw the box where ${name(id)} lies on picture "map": as the text tells, beside the sites it borders, clear of the other named sites unless the text puts it inside one.` },
        ], { images: { map: still } });
        const suggested = better?.box ? toMetres(better.box) : null;
        turnsTaken.push({ turn, box, fit: fit?.value ?? null, confidence: fit?.confidence ?? null, suggested });
        if (fit?.value === 'fits' || !suggested) break;
        box = { x0: Math.min(suggested.x0, suggested.x1), x1: Math.max(suggested.x0, suggested.x1), z0: Math.min(suggested.z0, suggested.z1), z1: Math.max(suggested.z0, suggested.z1) };
      }
      const toward = [round((box.x0 + box.x1) / 2), round((box.z0 + box.z1) / 2)];
      C.bear(canvas, { id, label: name(id), scale, parent, landscape: OPEN.has(scale) ? type : null, toward });
      const at = canvas.places[id].at;
      terrain.sites[id] = { label: name(id), parent, parentLabel: name(parent), scale, ground: type, toward, at, box, choice: { pick: picked.key, where: picked.where, confidence: where?.confidence ?? null, top: Object.entries(where?.distribution ?? {}).sort((a, b) => b[1] - a[1]).slice(0, 3) }, turns: turnsTaken, evidence: { text: facts, environment } };
      terrain.order.push(id);
      await replace(terrainFile, JSON.stringify(terrain, null, 1));
      const after = Object.values(canvas.places).filter(place => place.parent === parent).map(place => ({ label: place.label, at: place.at, r: place.r }));
      await live.outcome({ subject: name(id), text: `${name(id)} lies ${picked.where === 'over the middle' ? 'by the middle' : `to the ${picked.where}`} of ${name(parent)} (${n + 1} of ${order.length}); its circle at (${Math.round(at[0])}, ${Math.round(at[1])}) m`, picture: await draw(mapData(parent, half, after, []), { mode: 'top', target: [0, 0], half }) });
      log(`terrain ${n + 1}/${order.length}: ${name(id)} in ${name(parent)} → ${picked.key} (${picked.where}) ${where?.confidence ?? ''}`);
    }
    // The whole: each parent with every site placed in it, from above and in 3D.
    for (const [parent, canvas] of canvases) {
      const placed = Object.values(canvas.places).filter(place => place.parent === parent).map(place => ({ label: place.label, at: place.at, r: place.r }));
      const half = Math.max(HALF[scaleOf(parent) ?? 'city'] ?? 300, Math.round((Math.max(0, ...placed.map(site => Math.hypot(...site.at) + site.r)) + 40) * 1.1));
      await live.outcome({ subject: name(parent), text: `${name(parent)}: ${placed.length} site${placed.length === 1 ? '' : 's'} placed (${placed.map(site => site.label).join(', ')})`, picture: await draw(mapData(parent, half, placed, []), { mode: 'persp', target: [0, 0], distance: half * 2.2, yaw: 0.9, elevation: 0.55 }) });
    }
    await live.line(0, { status: 'done', placed: terrain.order.length });

    // 2. Spawns: carry on, or start anew.
    await live.line(1, { status: 'running' }); await live.phase('spawns');
    const spawns = { version: 1, model: jev.modelId, askedAt: new Date().toISOString(), scenes: {} };
    const when = id => base.get(id)?.time?.when ?? null, past = id => !!base.get(id)?.time?.flashback;
    // A scene's opening and end, from its text in the base layer.
    const opening = id => clip(base.get(id)?.text ?? '', 220), ending = id => { const body = base.get(id)?.text ?? ''; return body.length > 220 ? `…${body.slice(-219)}` : body; };
    const ask = [];
    script.scenes.forEach((scene, index) => {
      if (!index) { spawns.scenes[scene.id] = { spawn: 'new', by: 'rule', why: 'the first scene' }; return; }
      const before = script.scenes[index - 1], samePlace = scene.place === before.place, sameTime = when(scene.id) === when(before.id);
      if (past(scene.id) !== past(before.id)) spawns.scenes[scene.id] = { spawn: 'new', by: 'rule', why: past(scene.id) ? 'into the past' : 'back from the past' };
      else if (!sameTime && when(scene.id) && when(before.id)) spawns.scenes[scene.id] = { spawn: 'new', by: 'rule', why: `the time moved on: ${when(before.id)} → ${when(scene.id)}` };
      else if (samePlace && ['same', 'after'].includes(scene.relation) && scene.chapter === before.chapter) spawns.scenes[scene.id] = { spawn: 'continue', by: 'rule', why: 'the same place and time, carrying on' };
      else ask.push({ scene, before, samePlace });
    });
    const BATCH = 8;
    for (let start = 0; start < ask.length; start += BATCH) {
      const group = ask.slice(start, start + BATCH);
      const state = {
        task: 'Scenes of a novel, each with the scene before it. For each, say whether it carries straight on from the scene before (the same moment or minutes later, the same surroundings or a short walk away, so the people who were there are where it left them), or starts anew (time has passed, or the place and what is around changed a lot, so the people in it are placed afresh).',
        scenes: Object.fromEntries(group.map(({ scene, before, samePlace }) => [scene.id, {
          before: { place: name(before.place), when: when(before.id), environment: (base.get(before.id)?.environment ?? []).slice(-2).map(card => clip(card.text, 140)), end: ending(before.id) },
          now: { place: name(scene.place), ...(samePlace ? { samePlace: true } : {}), when: when(scene.id), environment: (base.get(scene.id)?.environment ?? []).slice(0, 2).map(card => clip(card.text, 140)), opening: opening(scene.id), relation: scene.relation },
          people: { stillThere: (scene.present ?? []).filter(person => (before.present ?? []).includes(person)).map(name), new: (scene.present ?? []).filter(person => !(before.present ?? []).includes(person)).map(name) },
        }])),
      };
      const answers = await decide(state, group.map(({ scene }) => ({ key: `carry:${scene.id}`, primitive: 'noul', instructions: `Does scenes.${scene.id} carry straight on from the scene before it?`, noulCriteria: { true: 'it carries straight on: the same moment or minutes later, the same surroundings or a short walk away', false: 'it starts anew: time has passed, or the place and its surroundings changed a lot' } })));
      for (const { scene } of group) {
        const p = Number(answers.find(answer => answer.key === `carry:${scene.id}`)?.value ?? 0);
        spawns.scenes[scene.id] = { spawn: p >= 0.5 ? 'continue' : 'new', by: 'jev', p: Math.round(p * 100) / 100 };
      }
    }
    for (const scene of script.scenes) spawns.scenes[scene.id] = { ...spawns.scenes[scene.id], when: when(scene.id), place: scene.place, environment: (base.get(scene.id)?.environment ?? []).slice(0, 2).map(card => clip(card.text, 160)) };
    await mkdir(dirname(spawnFile), { recursive: true });
    await replace(spawnFile, JSON.stringify(spawns, null, 1));
    const fresh = Object.values(spawns.scenes).filter(entry => entry.spawn === 'new').length;
    await live.outcome({ subject: 'spawns', text: `${fresh} of ${script.scenes.length} scenes start anew (everyone present placed afresh); ${script.scenes.length - fresh} carry on. Asked of Jev: ${ask.length}, by rule: ${script.scenes.length - ask.length}.` });
    await live.line(1, { status: 'done', fresh });
    if (!givenLive) await live.finish('done', { calls });
    return { calls, sites: terrain.order.length, spawns: { new: fresh, carry: script.scenes.length - fresh, asked: ask.length } };
  } catch (error) {
    if (!givenLive) await live.finish('failed', { error: String(error?.message ?? error).slice(0, 300) });
    throw error;
  } finally { await chrome.close(); server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { turns: { type: 'string', default: '1' }, 'max-sites': { type: 'string', default: '30' } } });
  const [novelDir] = positionals;
  if (!novelDir) { console.error('usage: node playground/terrain.mjs <novel-dir> [--turns 1] [--max-sites 30]'); process.exit(2); }
  console.log(JSON.stringify(await terrainAndSpawns(resolve(novelDir), { turns: Number(values.turns), maxSites: Number(values['max-sites']), log: line => console.error(line) })));
}
