// The director's loop (docs/v2/director-camera.md; the user's design, 2026-11-02): a line's scenes played forward card by
// card on the world the terrain built, people starting where spawning put them. Only dialogue and action cards are played:
// - an action card: each person acting is asked, on the camera operator's shots (src/v2/context/camera.ts), which way they
//   go (fourteen lettered arrows, stays, or with someone), then where (a spot inside the arrow's wedge), and only when no
//   spot fits, a rough box on a plan and then the exact box and its height (src/v2/context/directorModes.ts);
// - a dialogue card: those spoken to come within speaking distance of the speaker (a rule, no question).
// Each move is walked on the world's path integral (its windowed walk graph, rooms through their doors). Nothing is
// replayed: the engine is built once (export-strand-demo.mjs's `engine` hook) and the page written once a scene.
//   npm run build && node world-engine/director/director.mjs <novel-dir> --reading <reading>/v2/data.json --from <scene> --to <scene>
//     [--budget 60] [--stand-in] [--live]
// --stand-in answers every question by rule (no model call), for trying the loop; without it Jev is asked (paid).
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const repository = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..'), load = path => import(pathToFileURL(join(repository, path)).href);
const C = await load('dist/src/v2/context/camera.js'), M = await load('dist/src/v2/context/directorModes.js'), { ask } = await load('dist/src/v2/context/engine.js');
const S = await load('dist/apps/playground/src/data/skeleton.js'), { loadWorkspaceSentences } = await load('dist/src/cli/commands/extract/timeplaceCommands.js');
const { strandDemo, inlineStrand } = await import('../world/export-strand-demo.mjs');
const { browser, serve } = await import('../view/two-view-things.mjs');
const { VENDOR_FILES, PICKER_MODEL } = await import('../live/sim-jev.mjs');
import { copyFile } from 'node:fs/promises';

const CELL = 2, FLOOR = 3, PRESENT = new Set(['speaks', 'acts', 'addressed']);
const seeded = text => { let h = 2166136261; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } let s = h >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const round = value => Math.round(value * 10) / 10;

/** A stand-in director (no model): arrows by turn, every other spot question answered "none" so boxes are tried too. */
export function standIn() {
  let n = 0;
  return { modelId: 'stand-in-director', async decide(_state, questions) {
    n++;
    return questions.map(question => {
      if (question.primitive === 'box') return { key: question.key, value: { left: 0.42, top: 0.42, right: 0.58, bottom: 0.58 }, confidence: 0.5 };
      const options = question.options ?? [];
      const value = question.key === 'direction' ? options[n % Math.min(6, options.length)] : question.key === 'spot' ? (n % 2 ? options[0] : 'none') : question.key === 'how' ? 'walk' : question.key === 'height' ? (options.find(o => /ground/.test(question.optionHints?.[o] ?? '')) ?? options[0]) : options[0];
      return { key: question.key, value, confidence: 0.5 };
    });
  } };
}

export async function direct(novelDir, { reading, from, to, jev, budget = Infinity, live = null, log = console.error }) {
  const text = await loadWorkspaceSentences(novelDir), line = id => ({ id, text: text.get(id)?.text ?? '' });
  const names = new Map(reading.chart.entities.map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]));
  const nameForms = new Map(reading.chart.entities.map(entity => [entity.id, [...new Set([...(entity.proper ?? []), ...(entity.names ?? [])])].filter(form => form.length >= 2)]));
  const sceneOf = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
  const cardsOf = new Map();
  for (const card of reading.cards) { const id = sceneOf.get(card.first); if (id && ['action', 'dialogue'].includes(card.kind)) (cardsOf.get(id) ?? cardsOf.set(id, []).get(id)).push(card); }
  const out = join(novelDir, 'stage', 'director'), shots = join(out, 'shots'), work = join(out, 'page');
  await mkdir(shots, { recursive: true }); await mkdir(work, { recursive: true });
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  const template = await readFile(join(repository, 'world-engine', 'view', 'strand-demo.html'), 'utf8');
  const record = { version: 1, model: jev.modelId, from, to, startedAt: new Date().toISOString(), scenes: [] };
  const save = () => writeFile(join(out, 'run.json'), JSON.stringify(record, null, 1));
  let calls = 0;
  // Jev's image service comes and goes (503 "Image processing is unavailable", 529 overloaded): a request is tried again
  // after a pause, up to four times, before the run stops.
  const decide = Object.assign(async (state, questions, options) => {
    calls++;
    for (let attempt = 0; ; attempt++) {
      try { return await jev.decide(state, questions, options); } catch (error) {
        if (attempt >= 4 || !/ 50[23] | 529 /.test(String(error?.message))) throw error;
        log(`Jev unavailable (${String(error.message).slice(0, 60)}), again in ${20 * (attempt + 1)} s`);
        await new Promise(done => setTimeout(done, 20000 * (attempt + 1)));
      }
    }
  }, { record: () => {} });

  let result = null;
  await strandDemo(novelDir, { from, to, worldOnly: true, plain: true, title: 'Director', engine: async E => {
    const { world, W } = E, server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true });
    let page = null, lotsShown = -1;
    try {
      // The page as far as the loop has played, loaded again only when the world has grown (or a scene is done).
      const show = async (force = false) => {
        if (!force && page && world.lots.length === lotsShown) return page;
        page = E.assemble(E.runs); lotsShown = world.lots.length;
        await writeFile(join(work, 'index.html'), inlineStrand(template, page, { vendor: true }));
        await chrome.evaluate('delete window.__stage').catch(() => {});
        await chrome.open(server.url);
        return page;
      };
      const dense = id => { const { i, j, k } = W.cellOf(world, id), g = page.world; return ((k + g.ok) * g.NZ + (j + g.oj)) * g.NX + (i + g.oi); };
      const at = id => { const p = W.nodePos(world, id); return [p.x, p.y, p.z]; };
      const lotOf = (x, z) => world.lotAt.get(W.cellKey(Math.floor(x / CELL), Math.floor(z / CELL)));
      const lotName = index => { const lot = world.lots[index]; return lot.label ?? `the ${lot.role ?? 'building'} (${lot.height ?? lot.floors} floors)`; };
      // What stands at a point, in words: a building's room, corridor or stairs on a floor, its roof, open ground, the air.
      const said = ([x, y, z]) => {
        const index = lotOf(x, z), k = Math.round(y / FLOOR);
        if (index === undefined) return y < -1 ? 'underground' : y < 1.5 ? `open ground (${['', 'the street', 'a plaza', 'the avenue'][world.ground.get(W.cellKey(Math.floor(x / CELL), Math.floor(z / CELL))) ?? 0] || 'outside'})` : `the open air, ${Math.round(y)} m up`;
        const lot = world.lots[index], i = Math.floor(x / CELL) - lot.i0, j = Math.floor(z / CELL) - lot.j0;
        if (k >= lot.floors) return k === lot.floors ? `the roof of ${lotName(index)}` : `the air over ${lotName(index)}`;
        if (k < 0) return `under ${lotName(index)}`;
        const cell = lot.skeleton.cells[S.cellIndex(lot.skeleton, i, j, k)], room = lot.rooms.find(box => box.floor <= k && k <= box.top && i >= box.i0 && i <= box.i1 && j >= box.j0 && j <= box.j1);
        return cell === S.STAIR ? `the stairs of ${lotName(index)}, floor ${k + 1}` : cell === S.CORRIDOR ? `a corridor of ${lotName(index)}, floor ${k + 1}` : room ? `${room.kind === 'room' ? 'a room' : room.kind === 'hall' ? 'a hall' : 'a hall rising through floors'} of ${lotName(index)}, floor ${room.floor + 1}` : `a wall of ${lotName(index)}, floor ${k + 1}`;
      };
      // The walkable nodes round a point (within `radius` metres), with what each is: the pool spots and boxes are taken from.
      const around = (x, z, radius) => {
        E.reach(x, z, radius + 16);
        const built = E.graphOf({ x, z }, radius + 24), { graph, type, lot } = built, nodes = [];
        for (let id = 0; id < type.length; id++) if (type[id] && graph.offsets[id + 1] > graph.offsets[id] && Math.abs(graph.x[id] - x) <= radius && Math.abs(graph.z[id] - z) <= radius) nodes.push({ id, x: graph.x[id], y: graph.y[id], z: graph.z[id], type: type[id], lot: lot[id] });
        return { built, nodes };
      };
      const walk = (scene, key, from, targets, how) => {
        if (!targets.length) return null;
        const field = E.solve(scene.placeId, key, targets, how, from[0]), built = E.graphOf(W.nodePos(world, from[0]));
        return E.sampleWalk(built.graph, field, from[0], from[1], seeded(key));
      };
      const shoot = async (name, size, options) => {
        await chrome.size(...size);
        const view = await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: name, frame: size, people: true, mask: true, ...options })})`);
        const png = await chrome.still('png');
        await writeFile(join(shots, `${name}.png`), Buffer.from(png, 'base64'));
        return { view, png };
      };

      for (const scene of E.chosen) {
        const run = E.runs[scene.id], reads = reading.scenes.find(entry => entry.id === scene.id), sceneRecord = { scene: scene.id, cards: [] };
        record.scenes.push(sceneRecord);
        if (!run || !reads) continue;
        const positions = Object.fromEntries(Object.entries(run.starts).filter(([, value]) => value));
        const cards = (cardsOf.get(scene.id) ?? []).filter(card => card.people.some(person => positions[person.id] && person.how.some(how => PRESENT.has(how))));
        scene.events = []; run.events = []; scene.cast = [...new Set([...(scene.cast ?? []), ...Object.keys(positions)])];
        await live?.phase(`scene ${Number(scene.id.slice(-3))}: ${cards.length} cards`);
        await show(true);
        const placeName = names.get(scene.placeId) ?? scene.placeId, when = reading.time?.scenes?.find(entry => entry.scene === scene.id)?.when ?? null;
        for (const card of cards) {
          const cardRecord = { card: card.id, kind: card.kind, moves: [] };
          sceneRecord.cards.push(cardRecord);
          const event = { id: card.id, text: card.sentences.map(id => text.get(id)?.text ?? '').join('').slice(0, 120), actors: card.people.filter(person => positions[person.id] && person.how.some(how => PRESENT.has(how))).map(person => person.id) };
          scene.events.push(event);
          const moveTo = (person, path, how, why) => {
            if (!path || path.length < 2) { cardRecord.moves.push({ person, why, moved: false }); return; }
            E.moves.set(`${scene.id}|${card.id}|${person}`, { person, how: how === 'run' ? 'run' : 'walk', path, ensemble: [] });
            positions[person] = [path.at(-1), positions[person][1]];
            cardRecord.moves.push({ person, why, moved: true, steps: path.length, to: said(at(path.at(-1))) });
          };
          if (card.kind === 'dialogue') {
            // Those spoken to come within speaking distance (2–4 m) of the first speaker, on the speaker's floor.
            const speaker = card.people.find(person => positions[person.id] && person.how.includes('speaks'))?.id;
            if (speaker) for (const person of card.people.filter(entry => entry.id !== speaker && positions[entry.id] && entry.how.includes('addressed'))) {
              const a = at(positions[speaker][0]), b = at(positions[person.id][0]);
              if (Math.hypot(a[0] - b[0], a[2] - b[2]) <= 5 && Math.abs(a[1] - b[1]) < 1) continue;
              const { nodes } = around(a[0], a[2], 8), ring = nodes.filter(node => Math.abs(node.y - a[1]) < 1 && Math.hypot(node.x - a[0], node.z - a[2]) >= 2 && Math.hypot(node.x - a[0], node.z - a[2]) <= 4).map(node => node.id);
              moveTo(person.id, walk(scene, `${scene.id}|${card.id}|${person.id}|talk`, positions[person.id], ring, 'walk'), 'walk', `spoken to by ${names.get(speaker)}`);
            }
          } else for (const person of card.people.filter(entry => positions[entry.id] && entry.how.includes('acts')).map(entry => entry.id)) {
            if (calls >= budget) { cardRecord.moves.push({ person, why: 'budget spent' }); continue; }
            const here = at(positions[person][0]), mover = { id: person, name: names.get(person) ?? person }, slug = `${scene.id.slice(-3)}-${card.id.replace(/[^a-z0-9_]/gi, '_')}-${person}`;
            await show();
            await chrome.evaluate(`window.__stage.pose(${JSON.stringify(Object.fromEntries(Object.entries(positions).map(([who, [node]]) => [who, dense(node)])))})`);
            const others = Object.keys(positions).filter(who => who !== person).map(who => ({ id: who, name: names.get(who) ?? who }));
            const now = Object.fromEntries(Object.entries(positions).map(([who, [node]]) => { const p = at(node); return [names.get(who) ?? who, `${said(p)}${who === person ? '' : `, ${Math.round(Math.hypot(p[0] - here[0], p[2] - here[2]))} m from ${mover.name}`}`]; }));
            // The text: the card's own lines; before it, the scene's lines naming the mover, saying where or describing the place, nearest first.
            const first = reads.sentences.indexOf(card.sentences[0]), forms = nameForms.get(person) ?? [mover.name], spatial = new Set((reading.spatial ?? []).filter(entry => entry.scene === scene.id).map(entry => entry.sentence));
            const others_ = reads.sentences.map((id, n) => ({ id, n })).filter(({ id, n }) => !card.sentences.includes(id) && (Math.abs(n - first) <= 4 || spatial.has(id) || reading.kinds[id]?.kind === 'environment' || forms.some(form => (text.get(id)?.text ?? '').includes(form))));
            const context = others_.sort((a, b) => Math.abs(a.n - first) - Math.abs(b.n - first)).map(({ id }) => line(id));
            const base = { scene: { id: scene.id, place: placeName, when }, card: { id: card.id, lines: card.sentences.map(line) }, mover, lines: context, now };
            const shotBase = { place: scene.placeId, at: (await chrome.evaluate(`window.__stage.sceneCard(${JSON.stringify(scene.id)})`))?.at ?? 0, only: [scene.placeId], mover: person };
            // a. The direction: every arrow, said by what it meets.
            const arrows = C.DIRECTIONS.map(direction => {
              let blocked = false, meets = null;
              for (const metres of [2, 5, 10, 20]) { const p = C.arrowEnd(here, direction.vector, metres), what = said(p); if (what !== said(here)) { meets = `${what} (${metres} m)`; blocked = metres === 2 && /a wall/.test(what); break; } }
              return { ...direction, said: meets ?? `more of ${said(here)}`, blocked };
            });
            // First the text alone: does this person go anywhere in this card?
            const whether = await ask(decide, M.moveWhetherMode, { ...base, pictures: {} }, null);
            const goes = String(whether.replies.find(entry => entry.key === 'moves')?.value ?? 'stays') === 'goes', said_ = whether.replies.find(entry => entry.key === 'line')?.value ?? null;
            if (!goes) { cardRecord.moves.push({ person, direction: 'stays', line: said_, moved: false }); continue; }
            const a = await shoot(`${slug}-a`, [1440, 900], { ...shotBase, focus: { x: here[0], z: here[2], y0: here[1], w: 6, d: 6, h: 3 }, radius: 16, elevation: 35, arrows: arrows.map(arrow => ({ at: here, vector: arrow.vector, letter: arrow.letter, color: arrow.color, length: 9, blocked: arrow.blocked })) });
            const asked = await ask(decide, M.moveDirectionMode, { ...base, pictures: { arrows: `${mover.name} now, from 35° above; the lettered arrows go out of them (warm rise, cool fall, level ones flat).` }, arrows: arrows.map(arrow => ({ letter: arrow.letter, said: `${arrow.rise}, toward ${arrow.said}` })), others }, null, { request: { images: { arrows: a.png } } });
            const reply = key => asked.replies.find(entry => entry.key === key)?.value;
            const choice = String(reply('direction') ?? 'stays'), how = String(reply('how') ?? 'walk'), because = reply('line') ?? null;
            const moveRecord = { person, direction: choice, how, line: because };
            if (choice === 'stays') { cardRecord.moves.push({ ...moveRecord, moved: false }); continue; }
            if (choice.startsWith('with:')) {
              const leader = choice.slice(5), there = positions[leader] ? at(positions[leader][0]) : null;
              if (!there) { cardRecord.moves.push({ ...moveRecord, moved: false }); continue; }
              const { nodes } = around(there[0], there[2], 6), near = nodes.filter(node => Math.abs(node.y - there[1]) < 1 && Math.hypot(node.x - there[0], node.z - there[2]) <= 2.5).map(node => node.id);
              moveTo(person, walk(scene, `${slug}|with`, positions[person], near, how), how, `with ${names.get(leader)}`);
              continue;
            }
            const arrow = arrows.find(entry => entry.letter === choice) ?? arrows[0], reach = C.REACH[how] ?? C.REACH.walk;
            // The spots are looked for within 100 m (a flight's far end is boxed, not listed): the world streams in no further.
            const pool = around(here[0], here[2], Math.min(reach, 100) + 10), wedge = C.wedgeOnGround(here, arrow.vector, reach);
            // b. The spot: rooms, roofs, open ground and people inside the wedge, nearest first.
            const spots = [], groups = new Map();
            for (const node of pool.nodes) {
              if (!C.inWedge(here, arrow.vector, [node.x, node.y, node.z], 60) || Math.hypot(node.x - here[0], node.y - here[1], node.z - here[2]) < 2.5) continue;
              const what = said([node.x, node.y, node.z]).replace(/ \(.*\)$/, ''), band = node.type === 1 ? `${what}, about ${Math.max(5, Math.round(Math.hypot(node.x - here[0], node.z - here[2]) / 5) * 5)} m ahead` : what;
              (groups.get(band) ?? groups.set(band, []).get(band)).push(node);
            }
            for (const [what, nodes] of groups) { const d = Math.min(...nodes.map(node => Math.hypot(node.x - here[0], node.y - here[1], node.z - here[2]))); if (!/a wall/.test(what)) spots.push({ what, nodes: nodes.map(node => node.id), d }); }
            for (const other of others) { const p = at(positions[other.id][0]); if (C.inWedge(here, arrow.vector, p, 60) && Math.hypot(p[0] - here[0], p[2] - here[2]) <= reach) spots.push({ what: `beside ${other.name}`, nodes: pool.nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) <= 2).map(node => node.id), d: Math.hypot(p[0] - here[0], p[2] - here[2]) }); }
            const offered = spots.filter(spot => spot.nodes.length).sort((x, y) => x.d - y.d).slice(0, 16).map((spot, n) => ({ ...spot, letter: String.fromCharCode(65 + n) }));
            let targets = null, how2 = how;
            if (offered.length) {
              const b = await shoot(`${slug}-b`, [1440, 900], { ...shotBase, focus: { x: here[0], z: here[2], y0: here[1], w: 6, d: 6, h: 3 }, radius: Math.max(16, reach * 0.7), elevation: 35, arrows: [{ at: here, vector: arrow.vector, letter: arrow.letter, color: arrow.color, length: Math.min(reach, 30) }], ...(wedge ? { wedge: { points: wedge, y: here[1], color: arrow.color } } : {}) });
              const spotAsked = await ask(decide, M.moveSpotMode, { ...base, direction: `toward ${arrow.said} (arrow ${arrow.letter}, ${how})`, pictures: { wedge: `${mover.name}, the chosen arrow and its wedge, as far as a ${how} reaches.` }, spots: offered.map(spot => ({ letter: spot.letter, said: `${spot.what} (${Math.round(spot.d)} m)` })) }, null, { request: { images: { wedge: b.png } } });
              const spot = String(spotAsked.replies.find(entry => entry.key === 'spot')?.value ?? 'none'), chosen = offered.find(entry => entry.letter === spot);
              moveRecord.spot = chosen ? chosen.what : 'none';
              if (chosen) targets = chosen.nodes;
            }
            if (!targets && calls < budget) {
              // c1: a rough box on the plan along the arrow.
              const frame = C.frameAlong(here, arrow.vector, reach), half = (frame[2] - frame[0]) / 2, step = half > 60 ? 20 : half > 25 ? 10 : 5;
              const c1 = await shoot(`${slug}-c1`, [1024, 1024], { ...shotBase, topdown: { x: (frame[0] + frame[2]) / 2, z: (frame[1] + frame[3]) / 2, half }, grid: { box: frame, step, y: here[1] }, arrows: [{ at: here, vector: arrow.vector, letter: arrow.letter, color: arrow.color, length: Math.min(reach, half) }], ...(wedge ? { wedge: { points: wedge, y: here[1], color: arrow.color } } : {}) });
              const roughAsked = await ask(decide, M.moveRoughMode, { ...base, direction: `toward ${arrow.said} (arrow ${arrow.letter}, ${how})`, pictures: { plan: `straight down, north up, ${Math.round(half * 2)} m across, a grid of ${step} m; ${mover.name}'s arrow and its wedge drawn.` } }, null, { request: { images: { plan: c1.png } } });
              const roughReply = roughAsked.replies.find(entry => entry.key === 'box'), roughBox = roughReply?.box ?? roughReply?.value, map = c1.view?.map;
              if (roughBox?.left !== undefined && map) {
                const rough = C.planToGround([roughBox.left, roughBox.top, roughBox.right, roughBox.bottom], map), mid = [(rough[0] + rough[2]) / 2, (rough[1] + rough[3]) / 2], zoom = Math.max(6, (rough[2] - rough[0]) * 0.75, (rough[3] - rough[1]) * 0.75);
                // c2: the rough box zoomed top-down, and its column from the side with its heights lettered.
                const spot = around(mid[0], mid[1], zoom + 4);
                const standing = [...new Set(spot.nodes.filter(node => node.lot >= 0 && node.lot < world.lots.length && node.x >= rough[0] && node.x <= rough[2] && node.z >= rough[1] && node.z <= rough[3]).map(node => node.lot))].map(index => ({ name: lotName(index), bottom: 0, floors: world.lots[index].height ?? world.lots[index].floors }));
                const roofs = Math.max(0, ...standing.map(entry => entry.floors * FLOOR)), slices = C.columnSlices(standing, { top: how === 'flight' ? 60 : how === 'leap' ? roofs + 15 : roofs + 5 });
                const side = C.sideView(rough, arrow.vector, slices), radius = Math.max(12, side.focus.h * 0.55), distance = radius / Math.tan(Math.PI / 8);
                const plan = await shoot(`${slug}-c2-plan`, [1024, 1024], { ...shotBase, topdown: { x: mid[0], z: mid[1], half: zoom }, grid: { box: [mid[0] - zoom, mid[1] - zoom, mid[0] + zoom, mid[1] + zoom], step: 1, y: 0 } });
                const heights = await shoot(`${slug}-c2-side`, [1440, 900], { ...shotBase, focus: side.focus, radius, vague: { near: distance * 1.05, far: distance * 1.9 }, yaw: side.yaw, elevation: side.elevation, slices: slices.map(slice => ({ box: rough, y: slice.y, label: `${slice.letter} ${slice.said}` })) });
                const exactAsked = await ask(decide, M.moveExactMode, { ...base, direction: `toward ${arrow.said} (arrow ${arrow.letter}, ${how})`, slices: slices.map(slice => ({ letter: slice.letter, said: slice.said })), pictures: { plan: `the rough box's ground close up, straight down, north up, ${Math.round(zoom * 2)} m across, a grid of 1 m.`, heights: 'the rough box\'s column from the side, its heights lettered.' } }, null, { request: { images: { plan: plan.png, heights: heights.png } } });
                const exactReply = exactAsked.replies.find(entry => entry.key === 'box'), exactBox = exactReply?.box ?? exactReply?.value, height = slices.find(slice => slice.letter === exactAsked.replies.find(entry => entry.key === 'height')?.value) ?? slices.find(slice => slice.y === 0);
                const exact = exactBox?.left !== undefined && plan.view?.map ? C.planToGround([exactBox.left, exactBox.top, exactBox.right, exactBox.bottom], plan.view.map) : rough;
                moveRecord.box = exact; moveRecord.height = height ? height.said : null;
                // The cells a person can stand on in the box, at the height said (in the air: the nearest under it).
                const inBox = spot.nodes.filter(node => node.x >= exact[0] - 1 && node.x <= exact[2] + 1 && node.z >= exact[1] - 1 && node.z <= exact[3] + 1);
                const y = height?.y ?? 0, best = Math.min(...inBox.map(node => Math.abs(node.y - y) + (height?.air && node.y > y ? 100 : 0)));
                targets = inBox.filter(node => Math.abs(node.y - y) + (height?.air && node.y > y ? 100 : 0) <= best + 0.5).map(node => node.id);
                if (height?.air) moveRecord.air = true;
                if (how === 'flight' || how === 'leap') how2 = 'run';
              }
            }
            if (!targets?.length) { cardRecord.moves.push({ ...moveRecord, moved: false, why: 'no place to stand there' }); continue; }
            const path = walk(scene, slug, positions[person], targets, how2);
            moveTo(person, path, how2, null);
            Object.assign(cardRecord.moves.at(-1), moveRecord);
            await save();
          }
          run.events.push({ at: Object.fromEntries(Object.entries(positions).map(([who, value]) => [who, value])) });
        }
        log(`${scene.id}: ${cards.length} cards, ${sceneRecord.cards.reduce((n, card) => n + card.moves.filter(move => move.moved).length, 0)} moves, ${calls} calls so far`);
        await save();
        const data = await show(true);
        if (live) await live.world({ ...E.snapshot(true), moment: `director: scene ${Number(scene.id.slice(-3))} played` }, data);
      }
      result = { data: page, calls };
    } finally { await chrome.close(); server.server.close(); }
  } });
  record.finishedAt = new Date().toISOString(); record.calls = calls;
  await save();
  return { record, ...result };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, budget: { type: 'string' }, 'stand-in': { type: 'boolean' }, live: { type: 'boolean' } } });
  if (!novelDir || !values.reading || !values.from || !values.to) { console.error('usage: node world-engine/director/director.mjs <novel-dir> --reading <data.json> --from <scene> --to <scene> [--budget 60] [--stand-in] [--live]'); process.exit(2); }
  const reading = JSON.parse(await readFile(values.reading, 'utf8'));
  let jev = standIn();
  if (!values['stand-in']) {
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
    jev = cachedDecisions(jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL }), join(resolve(novelDir), 'stage', 'director', 'cache'));
  }
  let live = null;
  if (values.live) { const { createLive } = await import('../live/sim-jev.mjs'); live = await createLive(resolve(novelDir), { command: 'sim direct', lines: [{ id: 'director', title: 'The director: cards played forward' }], model: jev.modelId }); jev = live.watch(jev); }
  try {
    const { record } = await direct(resolve(novelDir), { reading, from: values.from, to: values.to, jev, budget: values.budget ? Number(values.budget) : Infinity, live });
    const moves = record.scenes.flatMap(scene => scene.cards.flatMap(card => card.moves));
    console.log(JSON.stringify({ calls: record.calls, scenes: record.scenes.length, cards: record.scenes.reduce((n, scene) => n + scene.cards.length, 0), moved: moves.filter(move => move.moved).length, stayed: moves.filter(move => move.direction === 'stays').length, unmoved: moves.filter(move => move.moved === false && move.direction !== 'stays').length }));
    await live?.finish('done');
  } catch (error) { await live?.finish('failed', { error: String(error?.message ?? error).slice(0, 300) }); throw error; }
}
