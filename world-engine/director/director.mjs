// The director's loop (docs/v2/director-camera.md; the user's design, 2026-11-02): a line's scenes played forward card by
// card on the world the terrain built, people starting where spawning put them. Only dialogue and action cards are played:
// - an action card: each person acting is asked, on the camera operator's shots (src/v2/context/camera.ts), which way they
//   go (fourteen lettered arrows, stays, or with someone), then where (a spot inside the arrow's wedge), and only when no
//   spot fits, a rough box on a plan and then the exact box and its height (src/v2/context/directorModes.ts);
// - a dialogue card: those spoken to come within speaking distance of the speaker (a rule, no question).
// Each move is walked on the world's path integral (its windowed walk graph, rooms through their doors). Nothing is
// replayed: the engine is built once (export-strand-demo.mjs's `engine` hook) and the page written once a scene.
//   npm run build && node world-engine/director/director.mjs <novel-dir> --reading <reading>/v2/data.json --from <scene> --to <scene>
//     [--budget 60] [--stand-in] [--live] [--pace 6]
// --pace: seconds the live view is given to play each move before the next question (6 with --live).
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
const { VENDOR_FILES, PICKER_MODEL, retried } = await import('../live/sim-jev.mjs');
const { passScene } = await import('./pass.mjs');
const { withSystem2 } = await import('./system2.mjs');
const { writeWorldLog } = await import('../log/write-log.mjs');
import { copyFile } from 'node:fs/promises';

const CELL = 2, FLOOR = 3, PRESENT = new Set(['speaks', 'acts', 'addressed']);
const seeded = text => { let h = 2166136261; for (const c of text) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619); } let s = h >>> 0; return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; };
const round = value => Math.round(value * 10) / 10;

/**
 * A stand-in director (no model), answering about as the text does: the pass finds a move in one sentence of twelve, a card
 * goes somewhere one time in three and breaks something one time in fifteen; arrows by turn; every other spot question
 * answered "none" so the boxes are tried too.
 */
export function standIn() {
  let n = 0;
  return { modelId: 'stand-in-director', async decide(_state, questions) {
    n++;
    return questions.map((question, k) => {
      if (question.primitive === 'box') return { key: question.key, value: { left: 0.42, top: 0.42, right: 0.58, bottom: 0.58 }, box: { left: 0.42, top: 0.42, right: 0.58, bottom: 0.58 }, confidence: 0.5 };
      const options = question.options ?? [], turn = n + k;
      const value = question.key.endsWith('|show') ? (turn % 12 ? 'none' : 'moves') : question.key === 'moves' ? (n % 3 ? 'stays' : 'goes') : question.key === 'breaks' ? (n % 15 ? 'no' : 'yes')
        : question.key === 'direction' ? options[n % Math.min(6, options.length)] : question.key === 'spot' ? (n % 2 ? options[0] : 'none') : question.key === 'how' ? 'walk'
        : question.key === 'height' ? (options.find(o => /ground/.test(question.optionHints?.[o] ?? '')) ?? options[0]) : options[0];
      return { key: question.key, value, confidence: 0.5 };
    });
  } };
}

/** The reader's view of a reading: kinds, marks (not everyday things) and the names they point at. */
export async function readerView(reading, text) {
  const { sentenceMarks } = await import('../../experiments/v2/marks.mjs');
  const marks = Object.fromEntries(Object.entries(await sentenceMarks(reading, text)).map(([id, found]) => [id, found.filter(([, , type]) => type !== 'r')]).filter(([, found]) => found.length));
  const names = Object.fromEntries([...reading.chart.entities.map(entity => [entity.id, [entity.proper?.[0] ?? entity.names?.[0] ?? entity.id, entity.category ?? null]]), ...(reading.slots ?? []).map(slot => [slot.id, [slot.label, slot.kind ?? 'person']])]);
  return { version: 2, kinds: Object.fromEntries(Object.entries(reading.kinds ?? {}).map(([id, entry]) => [id, entry.kind])), marks, names };
}

export async function direct(novelDir, { reading, from, to, jev, workModel = null, budget = Infinity, live = null, pace = 0, log = console.error }) {
  // A card's line with its kind (spoken, action, environment, thought, fact, narration) and, spoken, who says it: the
  // reader colours sentences by kind, and the page puts a spoken line in a bubble over its speaker.
  // Who says a line is the reading's (EM², a Jev question during extraction): its answer and how sure; below its accept
  // threshold no one.
  const spoken = id => (reading.roles?.[id]?.kind === 'spoken' ? reading.roles[id].who ?? null : null);
  const text = await loadWorkspaceSentences(novelDir), line = id => ({ id, text: text.get(id)?.text ?? '', kind: reading.kinds?.[id]?.kind ?? null, ...(spoken(id)?.id ? { who: spoken(id).id } : {}), ...(spoken(id) ? { sure: spoken(id).confidence ?? null } : {}) });
  const names = new Map([...reading.chart.entities.map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]), ...(reading.slots ?? []).map(slot => [slot.id, slot.label])]);
  const nameForms = new Map(reading.chart.entities.map(entity => [entity.id, [...new Set([...(entity.proper ?? []), ...(entity.names ?? [])])].filter(form => form.length >= 2)]));
  const sceneOf = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
  const cardsOf = new Map();
  for (const card of reading.cards) { const id = sceneOf.get(card.first); if (id && ['action', 'dialogue'].includes(card.kind)) (cardsOf.get(id) ?? cardsOf.set(id, []).get(id)).push(card); }
  const out = join(novelDir, 'stage', 'director'), shots = join(out, 'shots'), work = join(out, 'page');
  await mkdir(shots, { recursive: true }); await mkdir(work, { recursive: true });
  // The reading as the reader shows it over the whole book (World · Live's play/reading.json): every sentence's kind, and the
  // names, descriptions and times detected in it with whom or what they mean (experiments/v2/marks.mjs, as the reading's page).
  await writeFile(join(out, 'reading.json'), JSON.stringify(await readerView(reading, new Map([...text].map(([id, entry]) => [id, entry.text])))));
  for (const [path, file] of Object.entries(VENDOR_FILES)) { await mkdir(dirname(join(work, 'vendor', path)), { recursive: true }); await copyFile(join(repository, file), join(work, 'vendor', path)); }
  const template = await readFile(join(repository, 'world-engine', 'view', 'strand-demo.html'), 'utf8');
  const record = { version: 1, model: jev.modelId, from, to, startedAt: new Date().toISOString(), scenes: [] };
  const save = () => writeFile(join(out, 'run.json'), JSON.stringify(record, null, 1));
  let calls = 0;
  /**
   * What the player shows of the run (strand-demo.html's card list): every card played, in order, with its own lines as
   * written, who moved and what Jev answered, the producer's camera, and its event on the timeline.
   */
  const payload = () => ({ model: record.model, cards: record.scenes.flatMap(scene => scene.cards.map(card => ({ scene: scene.scene, event: card.event, card: card.card, kind: card.pass ? 'pass' : card.kind, lines: card.lines, camera: card.camera ?? null,
    moves: card.moves.map(move => ({ who: move.person, name: names.get(move.person) ?? move.person, moved: !!move.moved, direction: move.direction ?? null, how: move.how ?? null, spot: move.spot ?? null, height: move.height ?? null, boxed: !!move.box, to: move.to ?? null, why: move.why ?? null, line: move.line ?? null })) }))) });
  // Jev's service comes and goes: a request is tried again after a pause (sim-jev.mjs retried).
  // System 2 (system2.mjs, Track B W3): what Jev answers below 0.5 is asked of the work model with the same context; both
  // answers kept with the card (or the scene, for its pass) being asked about.
  let asking = null;
  const asked = withSystem2((state, questions, options) => retried(() => jev.decide(state, questions, options), log), workModel, { note: entry => { if (asking) (asking.system2 ??= []).push(entry); } });
  const decide = Object.assign(async (state, questions, options) => { calls++; return asked(state, questions, options); }, { record: () => {} });

  let result = null;
  await strandDemo(novelDir, { from, to, worldOnly: true, plain: true, title: 'Director', engine: async E => {
    const { world, W } = E, server = await serve(join(work, 'index.html'), join(work, 'vendor')), chrome = await browser({ gpu: true });
    let page = null, lotsShown = -1;
    // Every scene's line as played so far (its starts and events with their walks), kept in world nodes and made the page's
    // own whenever the page is written: a page loaded later (World · Live's frame, the Player) holds the whole line, every
    // card in it to replay (the user, 2026-11-02: tapping a played sentence replayed nothing once the run was over).
    const played = new Map();
    try {
      // The page as far as the loop has played, loaded again only when the world has grown (or a scene is done).
      const show = async (force = false) => {
        if (!force && page && world.lots.length === lotsShown) return page;
        page = E.assemble(E.runs); lotsShown = world.lots.length;
        await writeFile(join(work, 'index.html'), inlineStrand(template, withLine(page), { vendor: true }));
        await chrome.evaluate('delete window.__stage').catch(() => {});
        await chrome.open(server.url);
        return page;
      };
      // A scene's piece of the line on the page's grid as it stands now.
      function pieceOf({ scene, run }) {
        const starts = Object.fromEntries(Object.entries(run.starts).map(([who, value]) => [who, dense(value[0])]));
        const events = scene.events.map(event => ({ id: event.id, actors: event.actors ?? [], text: event.text, camera: event.camera ?? null, spots: [], hit: E.hits?.get(event.id) ?? null, hitThings: null, trace: null,
          moves: scene.cast.map(person => E.moves.get(`${scene.id}|${event.id}|${person}`)).filter(Boolean).map(move => ({ person: move.person, how: move.how, with: null, path: move.path.map(dense), ensemble: (move.ensemble ?? []).map(other => other.map(dense)) })) }));
        return { scene: scene.id, starts, events, cast: scene.cast, grid: gridKey() };
      }
      const withLine = data => ({ ...data, scenes: data.scenes.map(entry => { const piece = played.has(entry.id) ? pieceOf(played.get(entry.id)) : null; return piece ? { ...entry, starts: piece.starts, events: piece.events, cast: piece.cast } : entry; }) });
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
      // A move's walk: one draw of the path integral, and six more from the same field (the traces the player draws round it,
      // the spread of where the walk might have gone).
      const walk = (scene, key, from, targets, how) => {
        if (!targets.length) return null;
        const field = E.solve(scene.placeId, key, targets, how, from[0]), built = E.graphOf(W.nodePos(world, from[0]));
        const path = E.sampleWalk(built.graph, field, from[0], from[1], seeded(key));
        if (path) path.ensemble = Array.from({ length: 6 }, (_, n) => E.sampleWalk(built.graph, field, from[0], from[1], seeded(`${key}|${n}`))).filter(Boolean);
        // Why no walk was found (the user's Why panel: people chose a place and never went): where they stand is not on the
        // walk round them and their target, or the walk has no way from there to it.
        else walk.failed = field.part && field.part.local[from[0]] < 0 ? 'where they stand is off the walk' : 'no way there on foot';
        return path;
      };
      const shoot = async (name, size, options) => {
        await chrome.size(...size);
        const view = await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: name, frame: size, people: true, mask: true, ...options })})`);
        const png = await chrome.still('png');
        await writeFile(join(shots, `${name}.png`), Buffer.from(png, 'base64'));
        return { view, png };
      };

      // The live world's snapshot with the cards in its notes (World · Live's Cards panel reads them there).
      // `focus`: where the live view's Follow Jev looks (the card's people), else the engine's own.
      const noted = (moment, focus = null, extend = null) => { const shot = E.snapshot(true); return { ...shot, moment, ...(focus ? { focus } : {}), notes: { ...shot.notes, director: payload(), ...(extend ? { extend } : {}) } }; };
      // Streamed (docs/v2/world-engine-redesign.md §4): after every card, the scene's piece of the line (its starts and events so
      // far) in the live notes, which World · Live's frame plays on from where it is; the whole page only when the world grid
      // has changed (the frame then loads it, and takes the pieces after).
      const gridKey = () => `${page.world.NX}x${page.world.NZ}+${page.world.oi},${page.world.oj},${page.world.ok}`;
      let lastPiece = null, sentGrid = null, seq = 0;
      const stream = async (moment, focus = null, whole = false) => {
        if (!live) return;
        const full = gridKey() !== sentGrid;
        await live.world(noted(moment, focus, lastPiece ? { ...lastPiece, seq: ++seq, ...(focus ? { focus } : {}) } : null), full || whole ? { ...withLine(page), director: payload() } : null);
        if (full) sentGrid = gridKey();
      };
      const spawn = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'spawn.json'), 'utf8').catch(() => 'null'));
      const script = JSON.parse(await readFile(join(novelDir, 'stage', 'world', 'script.json'), 'utf8'));
      let before = null;
      const where = new Map();
      // The page's line grown in place to this moment (strand-demo.html `extend`): the scene's starts and its events so far,
      // each with its moves as walked; the page is loaded again only when the world has grown.
      const grow = async (scene, run) => {
        await show();
        played.set(scene.id, { scene, run });
        lastPiece = pieceOf({ scene, run });
        return chrome.evaluate(`window.__stage.extend(${JSON.stringify(lastPiece)})`);
      };
      for (const scene of E.chosen) {
        const run = E.runs[scene.id], reads = reading.scenes.find(entry => entry.id === scene.id), sceneRecord = { scene: scene.id, cards: [] };
        record.scenes.push(sceneRecord);
        asking = sceneRecord;
        if (!run || !reads) continue;
        // The world state (docs/v2/world-engine-redesign.md §1): who stands where carries through the story. Someone seen before
        // carries on from where they are; seen for the first time, they start at spawning's start (spawning happens once);
        // standing outside the scene's place, they travel to their start in it (walked; beyond 300 m they arrive off-page).
        const own = script.scenes.find(entry => entry.id === scene.id), spawned = spawn?.scenes?.find(entry => entry.id === scene.id);
        const startNode = who => {
          const start = spawned?.starts.find(entry => entry.who === who);
          if (!start) return run.starts[who]?.[0] ?? null;
          E.reach(start.at[0], start.at[1], 24);
          const built = E.graphOf({ x: start.at[0], z: start.at[1] });
          return W.nodeNear(world, built, start.at[0], start.at[1], Math.round(start.y / FLOOR)) ?? W.nodeNear(world, built, start.at[0], start.at[1], null);
        };
        const inside = node => {
          const box = spawned?.target?.box; if (!box || spawned.target.kind === 'area') return true;
          const [x, , z] = at(node), [cx, cz, w, d, angle] = box, dx = x - cx, dz = z - cz, u = dx * Math.cos(angle) + dz * Math.sin(angle), v = -dx * Math.sin(angle) + dz * Math.cos(angle);
          return Math.abs(u) <= w / 2 + 8 && Math.abs(v) <= d / 2 + 8;
        };
        // A scene's people start together (the user, 2026-11-02: two people of one conversation spawned a kilometre apart, and
        // a scene going on from the last played far from it): the anchor is where those already here stand (the one nearest
        // their middle); with none here, spawning's start of the first present (one placed by the text's own words first).
        // Someone new starts a few metres from the anchor; someone from elsewhere walks to it (off-page beyond 300 m).
        const present = [...new Set(own?.present ?? Object.keys(run.starts).filter(id => run.starts[id]))];
        for (const who of present) if (E.names && !E.names[who]) E.names[who] = names.get(who) ?? who;
        const here = present.filter(who => where.get(who) && inside(where.get(who)[0]));
        let anchor = null;
        if (here.length) {
          const points = here.map(who => at(where.get(who)[0])), mid = [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length);
          anchor = where.get(here.reduce((best, who) => { const p = at(where.get(who)[0]), q = at(where.get(best)[0]); return Math.hypot(p[0] - mid[0], p[2] - mid[2]) < Math.hypot(q[0] - mid[0], q[2] - mid[2]) ? who : best; }, here[0]))[0];
        } else {
          const by = who => spawned?.starts.find(entry => entry.who === who)?.by;
          const first = present.find(who => ['spatial', 'part'].includes(by(who))) ?? present[0];
          anchor = first ? startNode(first) : null;
        }
        // A spot a few metres from the anchor on its level, the same for the same person each time.
        const beside = (who, spread = [1.5, 4]) => {
          if (anchor === null || anchor === undefined) return null;
          const p = at(anchor), { nodes } = around(p[0], p[2], spread[1] + 2), ring = nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) >= spread[0] && Math.hypot(node.x - p[0], node.z - p[2]) <= spread[1]);
          return ring.length ? ring[Math.floor(seeded(`${scene.id}|${who}|beside`)() * ring.length)].id : anchor;
        };
        const positions = {}, travels = [];
        sceneRecord.spawned = []; sceneRecord.carried = []; sceneRecord.offPage = [];
        for (const who of present) {
          const was = where.get(who);
          if (was && here.includes(who)) { positions[who] = was; sceneRecord.carried.push(who); continue; }
          const dest = beside(who);
          if (dest === null || dest === undefined) { if (was) positions[who] = was; continue; }
          if (!was) { positions[who] = [dest, 0]; sceneRecord.spawned.push(who); continue; }
          const a = at(was[0]), b = at(dest);
          if (Math.hypot(a[0] - b[0], a[2] - b[2]) <= 300) { positions[who] = was; travels.push({ who, from: was, dest }); }
          else { positions[who] = [dest, was[1]]; sceneRecord.offPage.push(who); }
        }
        for (const key of Object.keys(run.starts)) delete run.starts[key];
        Object.assign(run.starts, positions);
        sceneRecord.starts = Object.fromEntries(Object.entries(positions).map(([who, [node]]) => [who, at(node).map(Math.round)]));
        // The director's pass (pass.mjs): the narration and description sentences that move someone present join the cards,
        // as actions of those they name, in reading order.
        const passed = await passScene({ reading, text, decide, scene: reads, place: names.get(scene.placeId) ?? scene.placeId, people: Object.fromEntries(Object.keys(positions).map(id => [id, names.get(id) ?? id])) });
        sceneRecord.pass = passed;
        const moving = Object.entries(passed).filter(([, entry]) => entry.show === 'moves' && entry.who.length).map(([id, entry]) => ({ id: `pass:${id}`, kind: 'action', first: id, sentences: [id], people: entry.who.map(who => ({ id: who, how: ['acts'] })), pass: true }));
        const position = new Map(reads.sentences.map((id, n) => [id, n]));
        const cards = [...(cardsOf.get(scene.id) ?? []), ...moving].filter(card => card.people.some(person => positions[person.id] && person.how.some(how => PRESENT.has(how)))).sort((a, b) => (position.get(a.first) ?? 0) - (position.get(b.first) ?? 0));
        scene.events = []; run.events = []; scene.cast = [...new Set([...(scene.cast ?? []), ...Object.keys(positions)])];
        // Those coming from elsewhere walk in first (an event of their own, before the scene's cards).
        if (travels.length) {
          const meet = at(travels[0].dest), event = { id: `arrive:${scene.id}`, text: `(${travels.map(entry => names.get(entry.who) ?? entry.who).join('、')} come here)`, actors: travels.map(entry => entry.who), camera: { focus: { x: meet[0], z: meet[2], y0: meet[1], w: 6, d: 6, h: 3 }, radius: 30, elevation: 40, yaw: 0 } };
          scene.events.push(event);
          for (const entry of travels) {
            const p = at(entry.dest), { nodes } = around(p[0], p[2], 6), near = nodes.filter(node => Math.abs(node.y - p[1]) < 1 && Math.hypot(node.x - p[0], node.z - p[2]) <= 2.5).map(node => node.id);
            const path = walk(scene, `${scene.id}|${entry.who}|arrive`, entry.from, near.length ? near : [entry.dest], 'walk');
            if (path && path.length > 1) { E.moves.set(`${scene.id}|${event.id}|${entry.who}`, { person: entry.who, how: 'walk', path: [...path], ensemble: path.ensemble ?? [] }); positions[entry.who] = [path.at(-1), entry.from[1]]; }
            else positions[entry.who] = [entry.dest, entry.from[1]];
          }
          run.events.push({ at: { ...positions } });
          sceneRecord.arrivals = travels.map(entry => entry.who);
        }
        await live?.phase(`scene ${Number(scene.id.slice(-3))}: ${cards.length} cards`);
        await show(true);
        await grow(scene, run);
        await stream(`scene ${Number(scene.id.slice(-3))} begins${sceneRecord.arrivals?.length ? ` · ${sceneRecord.arrivals.map(who => names.get(who) ?? who).join(', ')} come in` : ''}`);
        if (pace && sceneRecord.arrivals?.length) await new Promise(done => setTimeout(done, pace * 1000));
        const placeName = names.get(scene.placeId) ?? scene.placeId, when = reading.time?.scenes?.find(entry => entry.scene === scene.id)?.when ?? null;
        for (const card of cards) {
          const cardRecord = { card: card.id, kind: card.kind, ...(card.pass ? { pass: true } : {}), event: scene.events.length, lines: card.sentences.map(line), moves: [] };
          asking = cardRecord;
          await live?.phase(`scene ${Number(scene.id.slice(-3))} · card ${cards.indexOf(card) + 1}/${cards.length}${card.pass ? ' · from the pass' : ''} · ${card.people.filter(person => positions[person.id]).map(person => names.get(person.id) ?? person.id).join(', ')}`);
          sceneRecord.cards.push(cardRecord);
          const event = { id: card.id, text: card.sentences.map(id => text.get(id)?.text ?? '').join('').slice(0, 120), actors: card.people.filter(person => positions[person.id] && person.how.some(how => PRESENT.has(how))).map(person => person.id) };
          scene.events.push(event);
          const moveTo = (person, path, how, why) => {
            if (!path || path.length < 2) { cardRecord.moves.push({ person, why, moved: false }); return; }
            E.moves.set(`${scene.id}|${card.id}|${person}`, { person, how: how === 'run' ? 'run' : 'walk', path: [...path], ensemble: path.ensemble ?? [] });
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
            const played = await grow(scene, run);
            const others = Object.keys(positions).filter(who => who !== person).map(who => ({ id: who, name: names.get(who) ?? who }));
            const now = Object.fromEntries(Object.entries(positions).map(([who, [node]]) => { const p = at(node); return [names.get(who) ?? who, `${said(p)}${who === person ? '' : `, ${Math.round(Math.hypot(p[0] - here[0], p[2] - here[2]))} m from ${mover.name}`}`]; }));
            // The text: the card's own lines; before it, the scene's lines naming the mover, saying where or describing the place, nearest first.
            const first = reads.sentences.indexOf(card.sentences[0]), forms = nameForms.get(person) ?? [mover.name], spatial = new Set((reading.spatial ?? []).filter(entry => entry.scene === scene.id).map(entry => entry.sentence));
            const others_ = reads.sentences.map((id, n) => ({ id, n })).filter(({ id, n }) => !card.sentences.includes(id) && (Math.abs(n - first) <= 4 || spatial.has(id) || reading.kinds[id]?.kind === 'environment' || forms.some(form => (text.get(id)?.text ?? '').includes(form))));
            const context = others_.sort((a, b) => Math.abs(a.n - first) - Math.abs(b.n - first)).map(({ id }) => line(id));
            const base = { scene: { id: scene.id, place: placeName, when }, card: { id: card.id, lines: card.sentences.map(line) }, mover, lines: context, now };
            // Every picture is of the line as played to this moment: people where their walks ended, buildings as broken.
            const shotBase = { place: scene.placeId, at: Math.max(0, (played?.end ?? 0) - 0.02), only: [scene.placeId], mover: person };
            // a. The direction: every arrow, said by what it meets.
            const arrows = C.DIRECTIONS.map(direction => {
              let blocked = false, meets = null;
              for (const metres of [2, 5, 10, 20]) { const p = C.arrowEnd(here, direction.vector, metres), what = said(p); if (what !== said(here)) { meets = `${what} (${metres} m)`; blocked = metres === 2 && /a wall/.test(what); break; } }
              return { ...direction, said: meets ?? `more of ${said(here)}`, blocked };
            });
            // First the text alone: does this person go anywhere in this card?
            const whether = await ask(decide, M.moveWhetherMode, { ...base, pictures: {} }, null);
            const goes = String(whether.replies.find(entry => entry.key === 'moves')?.value ?? 'stays') === 'goes', said_ = whether.replies.find(entry => entry.key === 'line')?.value ?? null;
            // Destruction only on clear evidence (the user, 2026-11-02: routine things blasted): Jev sure of it, 0.7 or more.
            { const breaks = whether.replies.find(entry => entry.key === 'breaks'); if (breaks?.value === 'yes' && (breaks.confidence ?? 0) >= 0.7) cardRecord.breaks = true; }
            if (!goes) { cardRecord.moves.push({ person, direction: 'stays', line: said_, moved: false }); continue; }
            cardRecord.camera ??= { focus: { x: here[0], z: here[2], y0: here[1], w: 6, d: 6, h: 3 }, radius: 16, elevation: 35, yaw: 0 };
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
            moveTo(person, path, how2, path ? null : walk.failed);
            Object.assign(cardRecord.moves.at(-1), moveRecord);
            await save();
          }
          // Destruction (docs/v2/world-engine-redesign.md §3): a card the text says breaks something is asked where it hits (lettered
          // red spheres on the world as played) and how big (spheres of 4, 8, 16 and 32 m from two sides); the blast is applied
          // to the world and played before the next card.
          if (cardRecord.breaks && calls < budget) {
            const played = await grow(scene, run), at_ = Math.max(0, (played?.end ?? 0) - 0.02), slug = `${scene.id.slice(-3)}-${card.id.replace(/[^a-z0-9_]/gi, '_')}-hit`;
            await chrome.evaluate(`window.__stage.capture(${JSON.stringify({ id: `${slug}-look`, place: scene.placeId, at: at_, only: [scene.placeId], frame: [1440, 900] })})`);
            const spots = await chrome.evaluate(`window.__stage.impactSpots(${JSON.stringify({ place: scene.placeId })})`) ?? [];
            const about = `A still of a 3D model of a place in a novel, as the story stands at this card. Blue lattices are the buildings' corridors and orange their stairs; small labelled figures are people.\nThe card: ${event.text}`;
            if (spots.length) {
              // Framed on the spots: their middle, far enough back to hold them all.
              const mid = [spots.reduce((sum, spot) => sum + spot.x, 0) / spots.length, spots.reduce((sum, spot) => sum + spot.y, 0) / spots.length, spots.reduce((sum, spot) => sum + spot.z, 0) / spots.length];
              const spread = Math.max(10, ...spots.map(spot => Math.hypot(spot.x - mid[0], spot.z - mid[2])));
              const where = await shoot(`${slug}-where`, [1440, 900], { place: scene.placeId, at: at_, only: [scene.placeId], focus: { x: mid[0], z: mid[2], y0: mid[1] - 1, w: 2, d: 2, h: 2 }, radius: spread * 1.3 + 4, elevation: 35, spheres: spots.map(spot => ({ ...spot, r: 2.5 })) });
              const letters = spots.map(spot => spot.label);
              const [pick] = await decide(`${about}\nPicture "where": the place at this moment, with ${letters.length} lettered red spheres where it might break a building.`, [{ key: 'where', primitive: 'choice', instructions: 'Which lettered red sphere in picture "where" is where this card breaks something? Answer none if it breaks nothing.', options: [...letters, 'none'], optionHints: Object.fromEntries([...spots.map(spot => [spot.label, `${spot.label}: on ${spot.from}`]), ['none', 'it breaks nothing']]) }], { images: { where: where.png } });
              const chosen = spots.find(spot => spot.label === pick?.value);
              cardRecord.hit = { pick: pick?.value ?? null };
              if (chosen) {
                const SIZES = [4, 8, 16, 32], focus = { x: chosen.x, y0: chosen.y - 1, z: chosen.z, w: 2, h: 2, d: 2 }, rings = SIZES.map((size, n) => ({ x: chosen.x, y: chosen.y, z: chosen.z, r: size / 2, label: `${n + 1}`, outline: true }));
                const near = await shoot(`${slug}-near`, [1440, 900], { place: scene.placeId, at: at_, only: [scene.placeId], focus, radius: 22, spheres: rings }), side = await shoot(`${slug}-side`, [1440, 900], { place: scene.placeId, at: at_, only: [scene.placeId], focus, radius: 22, yaw: Math.PI / 2, elevation: 20, spheres: rings });
                const [size] = await decide(`${about}\nPictures "near" and "side": where it hits, close up from two sides, four red spheres round the point labelled 1 to 4: ${SIZES.map((size, n) => `${n + 1} is ${size} m across`).join(', ')}.`, [{ key: 'size', primitive: 'choice', instructions: 'Which labelled sphere is the size of what this card breaks?', options: SIZES.map((_, n) => `${n + 1}`) }], { images: { near: near.png, side: side.png } });
                const r = (SIZES[Number(size?.value) - 1] ?? 8) / 2;
                E.reach(chosen.x, chosen.z, r + 16);
                E.hitSphere(scene, { id: event.id }, { x: chosen.x, y: chosen.y, z: chosen.z, r }, 0.9, `${scene.id}|${event.id}|hit`);
                cardRecord.hit = { pick: chosen.label, on: chosen.from, across: r * 2, struck: !!E.hits.get(event.id) };
              }
            }
          }
          run.events.push({ at: Object.fromEntries(Object.entries(positions).map(([who, value]) => [who, value])) });
          // A card no one was asked about: the producer's camera on the people of the card, as they stood when it began.
          if (!cardRecord.camera) { const points = event.actors.filter(who => positions[who]).map(who => at(positions[who][0])); if (points.length) { const mid = [0, 1, 2].map(n => points.reduce((sum, p) => sum + p[n], 0) / points.length); cardRecord.camera = { focus: { x: mid[0], z: mid[2], y0: mid[1], w: 6, d: 6, h: 3 }, radius: 16, elevation: 35, yaw: 0 }; } }
          // The producer's camera rides with the card's event: the player and World · Live follow it card by card.
          event.camera = cardRecord.camera ?? null;
          // Streamed: the line as far as this card, played on in World · Live; a moment to watch a move before the next question.
          await grow(scene, run);
          const went = cardRecord.moves.filter(move => move.moved);
          await stream(`scene ${Number(scene.id.slice(-3))} · card ${cards.indexOf(card) + 1}/${cards.length}${went.length ? ` · ${went.map(move => names.get(move.person) ?? move.person).join(', ')} moved` : ''}`, cardRecord.camera ? { x: cardRecord.camera.focus.x, z: cardRecord.camera.focus.z, r: 24 } : null);
          if (pace && went.length) await new Promise(done => setTimeout(done, pace * 1000));
        }
        // The scene done: the live page written whole (every card so far), so a view loaded now can replay any of them.
        await stream(`scene ${Number(scene.id.slice(-3))} played`, null, true);
        before = { scene, reads, positions: { ...positions } };
        for (const [who, value] of Object.entries(positions)) where.set(who, value);
        log(`${scene.id}: ${cards.length} cards, ${sceneRecord.cards.reduce((n, card) => n + card.moves.filter(move => move.moved).length, 0)} moves, ${calls} calls so far`);
        await save();
      }
      result = { data: { ...withLine(page), title: `The director · ${from} – ${to}`, director: payload() }, calls };
      // The run as a playable run of the book (stage/simulation/index.json, the Player's list): replayed card by card. A
      // stand-in's run (rule-made answers) is not one: it is only for trying the loop.
      if (jev.modelId !== 'stand-in-director') {
      const folder = join(novelDir, 'stage', 'simulation'), id = `d${record.startedAt.replace(/\D/g, '').slice(0, 14)}`;
      await mkdir(join(folder, 'runs', 'director'), { recursive: true });
      await writeFile(join(folder, 'runs', 'director', `${id}.page.json`), JSON.stringify(result.data));
      const index = JSON.parse(await readFile(join(folder, 'index.json'), 'utf8').catch(() => 'null')) ?? { version: 2, strands: {} };
      const entry = index.strands.director ??= { title: 'The director', runs: [] };
      entry.runs.push({ id, scenes: E.chosen.length, page: `runs/director/${id}.page.json` }); entry.accepted = id;
      await writeFile(join(folder, 'index.json'), JSON.stringify(index, null, 1));
      // The run's world log, the laws over it and its proposals to the ontology (Track B W1, W2: logged, nothing applied).
      const written = await writeWorldLog(novelDir, { run: id, reading });
      log(`world log: ${JSON.stringify(written.log)}; laws broken: ${Object.entries(written.laws).filter(([, law]) => law.broken).map(([law, { broken }]) => `${law} ${broken}`).join(', ') || 'none'}`);
      }
    } finally { await chrome.close(); server.server.close(); }
  } });
  record.finishedAt = new Date().toISOString(); record.calls = calls;
  await save();
  return { record, ...result };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { values, positionals: [novelDir] } = parseArgs({ allowPositionals: true, options: { reading: { type: 'string' }, from: { type: 'string' }, to: { type: 'string' }, budget: { type: 'string' }, 'stand-in': { type: 'boolean' }, live: { type: 'boolean' }, pace: { type: 'string' } } });
  if (!novelDir || !values.reading || !values.from || !values.to) { console.error('usage: node world-engine/director/director.mjs <novel-dir> --reading <data.json> --from <scene> --to <scene> [--budget 60] [--stand-in] [--live]'); process.exit(2); }
  const reading = JSON.parse(await readFile(values.reading, 'utf8'));
  let jev = standIn();
  if (!values['stand-in']) {
    const { jevFromEnv } = await load('dist/src/ground/connectors/jev.js'), { cachedDecisions } = await load('dist/src/digger/timeplace/cache.js');
    jev = cachedDecisions(jevFromEnv({ ...process.env, JEV_MODEL: PICKER_MODEL }), join(resolve(novelDir), 'stage', 'director', 'cache'));
  }
  // System 2's work model (WORK_LLM_*), cached as Jev is; without one, system 2 is off and says so.
  let workModel = null;
  if (!values['stand-in'] && process.env.WORK_LLM_API_KEY) {
    const { workModelFromEnv } = await load('dist/src/ground/connectors/workModel.js'), { cachedWork } = await load('dist/src/digger/timeplace/cache.js');
    workModel = cachedWork(workModelFromEnv(process.env), join(resolve(novelDir), 'stage', 'director', 'cache-work'));
  } else if (!values['stand-in']) console.error('system 2 off: no work model configured (WORK_LLM_API_KEY)');
  let live = null;
  if (values.live && values['stand-in']) { console.error('a stand-in run does not write the live view (its answers are made by rule)'); process.exit(2); }
  if (values.live) { const { createLive } = await import('../live/sim-jev.mjs'); live = await createLive(resolve(novelDir), { command: 'sim direct', lines: [{ id: 'director', title: 'The director: cards played forward' }], model: jev.modelId }); jev = live.watch(jev); }
  try {
    const { record } = await direct(resolve(novelDir), { reading, from: values.from, to: values.to, jev, workModel, budget: values.budget ? Number(values.budget) : Infinity, live, pace: values.pace ? Number(values.pace) : values.live ? 6 : 0 });
    const moves = record.scenes.flatMap(scene => scene.cards.flatMap(card => card.moves));
    const second = record.scenes.flatMap(scene => [...(scene.system2 ?? []), ...scene.cards.flatMap(card => card.system2 ?? [])]);
    console.error(`system 2: ran on ${second.length} answers, the work model's used for ${second.filter(entry => entry.used === 'work').length}, differing from Jev's on ${second.filter(entry => entry.work && String(entry.work.value) !== String(entry.jev.value)).length}`);
    console.log(JSON.stringify({ calls: record.calls, scenes: record.scenes.length, cards: record.scenes.reduce((n, scene) => n + scene.cards.length, 0), moved: moves.filter(move => move.moved).length, stayed: moves.filter(move => move.direction === 'stays').length, unmoved: moves.filter(move => move.moved === false && move.direction !== 'stays').length }));
    await live?.finish('done');
  } catch (error) { await live?.finish('failed', { error: String(error?.message ?? error).slice(0, 300) }); throw error; }
}
