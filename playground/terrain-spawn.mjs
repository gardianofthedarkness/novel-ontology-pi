#!/usr/bin/env node
/**
 * Terrain spawning (docs/v2/visual-context-engine.md §5), the spawning department's first faculty, on the visual context
 * engine's first modes. Jev has its own player: a headless copy of the engine page (playground/terrain-world.html) that
 * builds the same world from the same events and draws each shot at its own frame; the user watches the run's event
 * stream on the live page with a camera of their own.
 *
 * For each city-grade place of the volume (by how much the text names it), its ground first (Jev's landscape pick, no
 * question), then which of the volume's districts and streets are parts of it (one text request a city), then each part in
 * story order:
 *   1. overview: the city's skyline from the side and above (1440×900) and the city from straight above (1024×1024, a
 *      grid in metres, the parts so far outlined and named); Jev boxes where the part lies on the map and picks what it is:
 *      a manifold (a landscape type, whose fill spawns its buildings) or a basic shape of ground; never a building;
 *   2. conflict check (code): ancient ground over modern or modern over ancient, a size far from the part's scale, or a box
 *      taking more than a quarter of the map: zoom into the box (the conflict drawn in red) and ask again, twice at most;
 *   3. height: the area from the side and above with lettered ghost slices at every height the engine has, the city vague
 *      behind, and a red dotted line wherever a slice cuts a building; Jev picks a letter;
 *   4. the proposal blinks in the live view; in step mode the run waits for the user's next step (the user can wander the
 *      world meanwhile); then it commits, and a manifold's fill spawns its buildings, rising live.
 * Every shot, question, answer, proposal, conflict, wait and commit goes to stage/terrain/stream.jsonl (shots beside it),
 * which the host's play/terrain page plays as it is written. What it placed is kept in stage/terrain/city.json. Jev's
 * answers are cached under stage/terrain/cache.
 *
 *   npm run build && node playground/terrain-spawn.mjs <novel-dir> [--run]
 */
import { copyFile, mkdir, mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { browser, serve } from './two-view-things.mjs';
import { PICKER_MODEL, VENDOR_FILES } from './sim-jev.mjs';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..'), load = path => import(pathToFileURL(`${repository}/${path}`).href);
const round = value => Math.round(value * 10) / 10;
const clip = (text, size) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
/** The basic shapes of ground the terrain faculty may place besides the manifolds (the user's list, 2026-10-31). */
export const SHAPES = {
  plateau: 'a plateau: raised flat ground with sloping sides', basin: 'a basin: a hollow below the ground around it', hill: 'a hill: a rounded rise',
  platform: 'a platform: a flat deck raised above the ground', cut: 'a cut: a trench or a pit dug into the ground', ramp: 'a ramp: ground sloping up from one side to the other',
  rectangle: 'a rectangle: a plain block of ground', sphere: 'a sphere', donut: 'a donut: a ring, as a torus',
};
const SHAPE_HEIGHT = { plateau: 20, basin: 15, hill: 40, platform: 24, cut: 10, ramp: 15, rectangle: 20 };
/** How large a part's ground is, by its scale (a radius in metres): what a box far from it is asked about again. */
const SCALE_RADIUS = { district: [120, 700], street: [20, 160], city: [300, 3000] };
const OVERVIEW = [1440, 900], MAP = [1024, 1024], ZOOMS = 2;

async function replace(file, body) { const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, body, { mode: 0o644 }); await rename(temporary, file); }

export async function terrainSpawn(novelDir, { jev: given = null, run = false, log = () => {} } = {}) {
  const L = await load('dist/src/ground/stage/landscape.js');
  const { stageInputs } = await load('dist/src/cli/commands/extract/stageCommands.js');
  const { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
  const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
  const folder = join(novelDir, 'stage', 'terrain'), shotsFolder = join(folder, 'shots');
  await mkdir(shotsFolder, { recursive: true });
  const inputs = await stageInputs(novelDir), script = inputs.world;
  const manifest = JSON.parse(await readFile(join(novelDir, 'ontology', 'manifest.json'), 'utf8'));
  const reading = manifest.v2Reading?.out ?? null;
  const base = reading ? JSON.parse(await readFile(join(reading, 'base', 'scenes.json'), 'utf8').catch(() => '[]')) : [];
  const kinds = reading ? JSON.parse(await readFile(join(reading, 'v2', 'data.json'), 'utf8').catch(() => '{}')).kinds ?? {} : {};
  const sentences = [...(await loadWorkspaceSentences(novelDir)).values()];
  const name = id => inputs.names[id] ?? id, scaleOf = id => inputs.scale?.places[id]?.scale ?? null;
  const typeOf = id => { const own = inputs.landscape?.places[id]?.type; return own && own !== 'none' && L.LANDSCAPES[own] ? own : 'residential'; };
  const jev = cachedDecisions(given ?? jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL }), join(folder, 'cache'));

  // The stream: one line an event, written whole; the headless page gets the same world events.
  const streamFile = join(folder, 'stream.jsonl');
  await rename(streamFile, join(folder, `stream-${Date.now()}.jsonl`)).catch(() => {});
  await writeFile(streamFile, '', { mode: 0o644 });
  let chrome = null, shotCount = 0, calls = 0;
  const emit = async (event, { world = false } = {}) => {
    await writeFile(streamFile, `${JSON.stringify({ ...event, at: new Date().toISOString() })}\n`, { flag: 'a' });
    if (world && chrome) await chrome.evaluate(`window.__world.apply(${JSON.stringify(event)})`);
  };
  // Step mode (the user's call): after each proposal the run waits for the user's next step from the live page.
  const stepFile = join(folder, 'step.json');
  await replace(stepFile, JSON.stringify({ mode: run ? 'run' : 'step', n: 0 }));
  let seen = 0, mode = run ? 'run' : 'step';
  const readStep = async () => JSON.parse(await readFile(stepFile, 'utf8').catch(() => '{}'));
  const wait = async why => {
    let step = await readStep();
    if (step.mode !== mode) { mode = step.mode; await emit({ t: 'mode', mode }); }
    if (mode === 'run') { seen = step.n ?? seen; return; }
    await emit({ t: 'wait', why });
    for (;;) {
      await new Promise(done => setTimeout(done, 700));
      step = await readStep();
      if (step.mode !== mode) { mode = step.mode; await emit({ t: 'mode', mode }); }
      if (mode === 'run' || (step.n ?? 0) > seen) { seen = step.n ?? seen; break; }
    }
    await emit({ t: 'resume' });
  };
  const shoot = async (mode, spec) => {
    const png = await chrome.evaluate(`window.__world.shot(${JSON.stringify(spec)})`), id = `s${++shotCount}`, file = `shots/${id}-${mode}.png`;
    await writeFile(join(folder, file), Buffer.from(png, 'base64'), { mode: 0o644 });
    await emit({ t: 'shot', id, mode, camera: spec.camera, frame: spec.frame, file });
    return { id, png };
  };
  const ask = async (phase, state, questions, shots) => {
    calls++;
    await emit({ t: 'ask', phase, shots: shots.map(([, shot]) => shot.id), questions: questions.map(q => ({ key: q.key, instructions: q.instructions, ...(q.options ? { options: q.options } : {}) })), state });
    const answers = await jev.decide(state, questions, shots.length ? { images: Object.fromEntries(shots.map(([name, shot]) => [name, shot.png])) } : {});
    const kept = answers.map(answer => ({ key: answer.key, value: typeof answer.value === 'number' ? round(answer.value * 100) / 100 : answer.value, confidence: answer.confidence ?? null, ...(answer.box ? { box: answer.box } : {}), ...(answer.distribution ? { top: Object.entries(answer.distribution).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([option, p]) => [option, Math.round(p * 100) / 100]) } : {}) }));
    await emit({ t: 'answer', phase, answers: kept });
    return answers;
  };

  // The cities, by how much the text names them; the districts and streets the volume names, as candidate parts.
  const mentions = label => sentences.filter(sentence => sentence.text.includes(label)).length;
  const cities = Object.keys(inputs.scale?.places ?? {}).filter(id => scaleOf(id) === 'city').map(id => ({ id, label: name(id), mentions: mentions(name(id)) })).filter(city => city.mentions).sort((a, b) => b.mentions - a.mentions);
  const firstAt = label => sentences.findIndex(sentence => sentence.text.includes(label));
  const candidates = Object.keys(inputs.scale?.places ?? {}).filter(id => ['district', 'street'].includes(scaleOf(id))).map(id => ({ id, label: name(id), scale: scaleOf(id), at: firstAt(name(id)) })).filter(part => part.at >= 0).sort((a, b) => a.at - b.at);
  const naming = label => sentences.filter(sentence => sentence.text.includes(label) && sentence.text.length >= label.length + 6);
  const sceneIds = id => script?.scenes.filter(scene => scene.place === id || script.places?.[scene.place]?.parent === id).map(scene => scene.id) ?? [];
  const cardsOf = part => [
    ...naming(part.label).slice(0, 4).map(sentence => ({ kind: kinds[sentence.id]?.kind ?? 'narration', text: clip(sentence.text, 200), lit: true })),
    ...sceneIds(part.id).flatMap(id => base.find(scene => scene.id === id)?.environment ?? []).slice(0, 3).map(card => ({ kind: 'environment', text: clip(card.text, 200), lit: true })),
  ];

  const work = await mkdtemp(join(tmpdir(), 'terrain-world-'));
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  await copyFile(join(repository, 'playground', 'terrain-world.html'), join(work, 'index.html'));
  const { server, url } = await serve(join(work, 'index.html'), join(work, 'vendor'));
  chrome = await browser();
  const kept = { version: 1, model: jev.modelId, askedAt: new Date().toISOString(), cities: {} };
  try {
    await chrome.open(`${url}?jev=1`);
    await emit({ t: 'run', cities: cities.map(city => city.label), model: jev.modelId, mode });
    // Which city each candidate part is in: one text question a city, a yes or no for each part.
    const membership = new Map();
    for (const city of cities) {
      const keys = candidates.map((part, k) => [`p${k + 1}`, part]);
      const answers = await ask('which parts are in this city', {
        task: `Places a novel names. For each, say whether it is part of ${city.label} (a district or a street of it).`,
        city: city.label, parts: Object.fromEntries(keys.map(([key, part]) => [key, { name: part.label, scale: part.scale, text: naming(part.label).slice(0, 2).map(sentence => clip(sentence.text, 120)) }])),
      }, keys.map(([key, part]) => ({ key: `in:${key}`, primitive: 'noul', instructions: `Is parts.${key} (${part.label}) part of ${city.label}?`, noulCriteria: { true: `it lies in ${city.label}`, false: `it lies elsewhere, or the text does not put it in ${city.label}` } })), []);
      for (const [key, part] of keys) { const p = Number(answers.find(answer => answer.key === `in:${key}`)?.value ?? 0); if (p >= 0.5 && p > (membership.get(part.id)?.p ?? 0)) membership.set(part.id, { city: city.id, p }); }
    }

    let offsetX = 0;
    for (const city of cities) {
      // The city's own ground: its landscape type (Jev's pick, or the scale's), filled; cities side by side along x.
      let landscape = L.firstLandscape(city.id, typeOf(city.id), { by: 'jev' });
      // Room on the map for the city to grow into (its ground starts as one patch and grows with each part).
      const radius = Math.max(1200, L.circleOf(landscape, 0) * 3);
      const offset = [offsetX + radius, 0];
      offsetX += radius * 2 + 400;
      const toWorld = ([x, z]) => [round(x + offset[0]), round(z + offset[1])];
      const outlineOf = patch => Array.from({ length: 72 }, (_, n) => { const t = n / 72 * Math.PI * 2, r = L.reachOf(patch, [patch.x + Math.cos(t), patch.z + Math.sin(t)]); return toWorld([patch.x + r * Math.cos(t), patch.z + r * Math.sin(t)]); });
      const baseOf = new Map([[landscape.patches[0].id, 0]]);
      const fillOf = () => { const filled = L.fillLandscape(landscape); return { buildings: [...filled.fabric.buildings.map(b => { const [x, z] = toWorld([b.x, b.z]); const owner = filled.owner[b.lot] ?? String(b.lot).split(':')[0]; return [x, z, round(b.w), round(b.d), round(b.angle * 1000) / 1000, b.floors, b.kind, baseOf.get(owner) ?? 0]; }), ...filled.landmarks.map(m => { const [x, z] = toWorld([m.x, m.z]); return [x, z, m.w, m.d, m.angle ?? 0, m.floors, 'landmark', 0]; })], roads: filled.fabric.roads.map(r => [...toWorld(r.a), ...toWorld(r.b), r.width]) }; };
      let fill = fillOf();
      await emit({ t: 'city', city: { id: city.id, label: city.label, offset, radius, type: typeOf(city.id) }, patches: landscape.patches.map(patch => ({ type: patch.type, outline: outlineOf(patch) })), fill }, { world: true });
      kept.cities[city.id] = { label: city.label, offset, ground: typeOf(city.id), parts: [] };
      const parts = candidates.filter(part => membership.get(part.id)?.city === city.id);
      const placed = [];
      for (const [n, part] of parts.entries()) {
        const cards = cardsOf(part), environment = cards.filter(card => card.kind === 'environment').map(card => card.text), text = cards.filter(card => card.kind !== 'environment').map(card => card.text);
        await emit({ t: 'part', n: n + 1, of: parts.length, city: city.label, cityId: city.id, part: { id: part.id, label: part.label, scale: part.scale }, cards });
        const outlines = () => placed.map(entry => ({ pts: entry.outline ?? [[entry.box[0], entry.box[1]], [entry.box[2], entry.box[1]], [entry.box[2], entry.box[3]], [entry.box[0], entry.box[3]]], label: entry.label, at: [(entry.box[0] + entry.box[2]) / 2, (entry.box[1] + entry.box[3]) / 2] }));
        const kindOptions = [...Object.keys(L.LANDSCAPES), ...Object.keys(SHAPES)], kindHints = { ...Object.fromEntries(Object.keys(L.LANDSCAPES).map(type => [type, `${type}: ${L.LANDSCAPES[type].hint} (its buildings spawn on it)`])), ...SHAPES };
        const textState = { city: { name: city.label, ground: `${typeOf(city.id)}: ${L.LANDSCAPES[typeOf(city.id)].hint}` }, part: { name: part.label, scale: part.scale }, ...(placed.length ? { placed: placed.map(entry => `${entry.label} (${entry.kind})`) } : {}), text, ...(environment.length ? { environment } : {}) };
        // 1. Overview: the skyline and the map, framed on the city as it stands now (its ground, the parts so far) with room round it.
        const extent = Math.max(L.circleOf(landscape, 0), ...placed.map(entry => Math.hypot((entry.box[0] + entry.box[2]) / 2 - offset[0], (entry.box[1] + entry.box[3]) / 2 - offset[1]) + Math.max(entry.box[2] - entry.box[0], entry.box[3] - entry.box[1]) / 2));
        const centre = [offset[0], 0, offset[1]], R = Math.max(350, extent * 1.6), yaw = -0.62, elevation = 0.5;
        const skyline = await shoot('skyline', { camera: { kind: 'persp', fov: 38, position: [centre[0] + Math.sin(yaw) * R * 1.7 * Math.cos(elevation), R * 1.7 * Math.sin(elevation), centre[2] + Math.cos(yaw) * R * 1.7 * Math.cos(elevation)], target: centre }, frame: OVERVIEW, layers: { outlines: outlines(), labelSize: R / 22, screenLabels: 0.032 } });
        const half = R * 1.12, step = R > 1500 ? 250 : R > 600 ? 100 : 50;
        const map = await shoot('map', { camera: { kind: 'top', target: centre, half }, frame: MAP, layers: { outlines: outlines(), grid: { x0: centre[0] - half, z0: centre[2] - half, x1: centre[0] + half, z1: centre[2] + half, step }, labelSize: R / 26, screenLabels: 0.028 } });
        const answers = await ask('overview: where, and what', { task: `Where does ${part.label} lie in ${city.label}, and what is its ground? Terrain only: a manifold (a landscape type, whose buildings spawn on it) or a basic shape of ground, never a building.`, ...textState, kinds: kindHints, pictures: { skyline: `${city.label}'s skyline from the side and above.`, map: `${city.label} from straight above, north up, ${Math.round(half * 2)} m across; grid lines every ${step} m; the parts placed so far outlined and named.` } }, [
          { key: 'box', primitive: 'box', instructions: `Box where ${part.label} lies on picture "map", as large as its ground is.` },
          { key: 'kind', primitive: 'choice', instructions: `What is ${part.label}'s ground (the kinds are in kinds)?`, options: kindOptions, optionHints: kindHints },
        ], [['skyline', skyline], ['map', map]]);
        const kind = String(answers.find(answer => answer.key === 'kind')?.value ?? 'residential'), shape = SHAPES[kind] ? kind : null;
        const fromMap = (box, target, h) => box ? [round(target[0] - h + box.left * 2 * h), round(target[2] - h + box.top * 2 * h), round(target[0] - h + box.right * 2 * h), round(target[2] - h + box.bottom * 2 * h)] : null;
        const expected = SCALE_RADIUS[part.scale] ?? [60, 300], fallback = (expected[0] + expected[1]) / 2;
        let box = fromMap(answers.find(answer => answer.key === 'box')?.box, centre, half) ?? [centre[0] - fallback, centre[2] - fallback, centre[0] + fallback, centre[2] + fallback];
        // 2. Conflicts, and zooms.
        const conflictsOf = candidate => {
          const reasons = [], boxes = [], r = Math.max(candidate[2] - candidate[0], candidate[3] - candidate[1]) / 2;
          if (!shape) {
            const local = { x0: candidate[0] - offset[0], z0: candidate[1] - offset[1], x1: candidate[2] - offset[0], z1: candidate[3] - offset[1] };
            const trial = L.patchFromBox(kind, `p${landscape.patches.length}`, city.id, local);
            for (const patch of landscape.patches) if (L.LANDSCAPES[patch.type].era !== L.LANDSCAPES[kind].era && L.overlaps(trial, patch)) { reasons.push(`${L.LANDSCAPES[kind].era} ${kind} over ${L.LANDSCAPES[patch.type].era} ${patch.type}`); boxes.push([round(patch.x - patch.R + offset[0]), round(patch.z - patch.R + offset[1]), round(patch.x + patch.R + offset[0]), round(patch.z + patch.R + offset[1])]); }
          }
          if (r > expected[1] * 1.6) reasons.push(`${Math.round(r * 2)} m across is too big for a ${part.scale}`);
          if (r < expected[0] * 0.5) reasons.push(`${Math.round(r * 2)} m across is too small for a ${part.scale}`);
          if ((candidate[2] - candidate[0]) * (candidate[3] - candidate[1]) > 0.25 * (2 * half) ** 2) reasons.push('it takes more than a quarter of the map');
          return { reasons, boxes };
        };
        for (let zoom = 1; zoom <= ZOOMS; zoom++) {
          const { reasons, boxes } = conflictsOf(box);
          if (!reasons.length) break;
          const zc = [(box[0] + box[2]) / 2, 0, (box[1] + box[3]) / 2], zh = Math.max(120, Math.max(box[2] - box[0], box[3] - box[1]) * 0.9);
          await emit({ t: 'conflict', reasons, boxes, zoom: [round(zc[0] - zh), round(zc[2] - zh), round(zc[0] + zh), round(zc[2] + zh)] }, { world: true });
          const zoomSide = await shoot('zoom-skyline', { camera: { kind: 'persp', fov: 38, position: [zc[0] + Math.sin(yaw) * zh * 2.4 * Math.cos(elevation), zh * 2.4 * Math.sin(elevation), zc[2] + Math.cos(yaw) * zh * 2.4 * Math.cos(elevation)], target: zc }, frame: OVERVIEW, layers: { outlines: outlines(), boxes: [{ box, colour: 0xffd666, label: `${part.label}?` }], labelSize: zh / 14, screenLabels: 0.03 } });
          const zoomMap = await shoot('zoom-map', { camera: { kind: 'top', target: zc, half: zh }, frame: MAP, layers: { outlines: outlines(), boxes: [{ box, colour: 0xffd666, label: `${part.label}?` }], grid: { x0: zc[0] - zh, z0: zc[2] - zh, x1: zc[0] + zh, z1: zc[2] + zh, step: zh > 500 ? 100 : zh > 200 ? 50 : 20 }, labelSize: zh / 14, screenLabels: 0.03 } });
          const again = await ask(`zoom ${zoom}: where, again`, { task: `Where does ${part.label} lie, closer up? The yellow box is the last answer; it ${reasons.join('; ')} (drawn in red where it conflicts).`, ...textState, kind, pictures: { skyline: `the area from the side and above.`, map: `the area from straight above, north up, ${Math.round(zh * 2)} m across.` } }, [{ key: 'box', primitive: 'box', instructions: `Box where ${part.label} lies on picture "map", as large as its ground is.` }], [['skyline', zoomSide], ['map', zoomMap]]);
          box = fromMap(again.find(answer => answer.key === 'box')?.box, zc, zh) ?? box;
        }
        await emit({ t: 'conflict', reasons: [], boxes: [] }, { world: true });
        // 3. Height: lettered ghost slices at every height the engine has, through the area.
        const inside = fill.buildings.filter(([x, z]) => x >= box[0] && x <= box[2] && z >= box[1] && z <= box[3]);
        const roofs = [...new Set(inside.map(b => b[5] * 3 + (b[7] ?? 0)).sort((a, b) => b - a))];
        const tallest = roofs[0] ?? 0, median = roofs[Math.floor(roofs.length / 2)] ?? 0;
        const levels = [[-60, 'deep underground'], [-12, 'the subway'], [-5, 'just under the street'], [0, 'the street'], [6, 'two floors up'], [15, 'five floors up'], ...(median > 20 ? [[median, 'the roofs around'] ] : []), ...(tallest > 30 ? [[tallest, 'the tallest roof'], [tallest + 40, 'the sky above the roofs']] : [[60, 'the sky']])]
          .filter(([y], k, all) => all.findIndex(([other]) => Math.abs(other - y) < 3) === k).sort((a, b) => a[0] - b[0]).map(([y, what], k) => ({ letter: 'ABCDEFGHIJ'[k], y: Math.round(y), what }));
        const ghosts = levels.map(level => ({ box, y: level.y, label: `${level.letter} · ${level.y} m · ${level.what}` }));
        const cuts = levels.flatMap(level => inside.filter(b => (b[7] ?? 0) < level.y && (b[7] ?? 0) + b[5] * 3 > level.y).slice(0, 60).map(b => ({ box: [b[0] - b[2] / 2, b[1] - b[3] / 2, b[0] + b[2] / 2, b[1] + b[3] / 2], y: level.y })));
        const size = Math.max(box[2] - box[0], box[3] - box[1]), span = levels.at(-1).y - levels[0].y, distance = Math.max(size * 2.3, span * 2.1, 260), hc = [(box[0] + box[2]) / 2, (levels[0].y + levels.at(-1).y) / 2, (box[1] + box[3]) / 2];
        const heights = await shoot('height', { camera: { kind: 'persp', fov: 40, position: [hc[0] + Math.sin(yaw) * distance * Math.cos(0.38), hc[1] + distance * Math.sin(0.38), hc[2] + Math.cos(yaw) * distance * Math.cos(0.38)], target: hc }, frame: OVERVIEW, layers: { ghosts, cuts, dash: Math.max(1.5, distance / 120), seeThrough: true, labelSize: Math.max(8, distance / 40), screenLabels: 0.03, vague: { near: distance * 0.9, far: distance * 2.6 } } });
        const [level] = await ask('height', { task: `At what height is ${part.label}'s ground (${kind})? The picture shows its area with a lettered ghost slice at each height the world has; red dotted lines are where a slice cuts a building.`, ...textState, kind, heights: Object.fromEntries(levels.map(entry => [entry.letter, `${entry.y} m: ${entry.what}`])), pictures: { heights: 'the area from the side and above, the city faint behind.' } },
          [{ key: 'height', primitive: 'choice', instructions: `Which lettered slice is the height of ${part.label}'s ground?`, options: levels.map(entry => entry.letter), optionHints: Object.fromEntries(levels.map(entry => [entry.letter, `${entry.letter}: ${entry.y} m, ${entry.what}`])) }], [['heights', heights]]);
        const y = levels.find(entry => entry.letter === level?.value)?.y ?? 0;
        // 4. Proposal (blinking in the live view), the user's step, then the commit and what it spawns.
        const local = { x0: box[0] - offset[0], z0: box[1] - offset[1], x1: box[2] - offset[0], z1: box[3] - offset[1] };
        const patch = shape ? null : L.patchFromBox(kind, `p${landscape.patches.length}`, city.id, local, { by: 'jev' });
        const proposal = { id: part.id, label: part.label, kind, box, y, ...(patch ? { outline: outlineOf(patch) } : { shape: { kind, height: SHAPE_HEIGHT[kind] ?? null } }) };
        await emit({ t: 'proposal', part: proposal }, { world: true });
        await wait(`${part.label}: ${kind} at ${y} m. Look around, then step on to commit it.`);
        let spawn = { buildings: [], roads: [] };
        if (patch) {
          // What the new manifold spawns: the buildings and roads of the fill that were not there before (older ground wins).
          const key = b => `${Math.round(b[0])},${Math.round(b[1])},${Math.round(b[2])}`, before = new Set(fill.buildings.map(key)), roadsBefore = new Set(fill.roads.map(road => road.map(Math.round).join()));
          landscape = { ...landscape, patches: [...landscape.patches, patch] }; baseOf.set(patch.id, y);
          fill = fillOf();
          spawn = { buildings: fill.buildings.filter(b => !before.has(key(b))), roads: fill.roads.filter(road => !roadsBefore.has(road.map(Math.round).join())) };
        }
        await emit({ t: 'commit', part: proposal, spawn }, { world: true });
        placed.push({ label: part.label, kind, box, outline: proposal.outline ?? null });
        kept.cities[city.id].parts.push({ id: part.id, label: part.label, scale: part.scale, kind, box, y, ...(patch ? { patch: { ...patch, base: y } } : { shape: proposal.shape }) });
        await replace(join(folder, 'city.json'), JSON.stringify(kept, null, 1));
        log(`${city.label} › ${part.label}: ${kind} at ${y} m, ${spawn.buildings.length} buildings spawned`);
      }
    }
    const parts = Object.values(kept.cities).reduce((sum, city) => sum + city.parts.length, 0);
    await emit({ t: 'done', parts, cities: cities.length, calls });
    return { calls, cities: cities.length, parts, shots: shotCount };
  } finally { await chrome.close(); server.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { run: { type: 'boolean' } } });
  const [novelDir] = positionals;
  if (!novelDir) { console.error('usage: node playground/terrain-spawn.mjs <novel-dir> [--run]'); process.exit(2); }
  console.log(JSON.stringify(await terrainSpawn(resolve(novelDir), { run: values.run, log: line => console.error(line) })));
}
