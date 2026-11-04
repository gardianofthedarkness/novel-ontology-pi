// One unit (the user, 2026-11-04: "examine all the places involving segment versus scene split in our downstream codes,
// unify them"). The reading's tiler cuts segments, and those are the only unit: what the code still calls a scene is a
// segment, and the world engine plays each one as its own container under its own id, in its own place and time. Before,
// the reading had scenes and, beside them, segments cut a second time (M14), played as scene~part with the scene as their
// parent; that split is gone. Kept from it: the cards aligned to the units, presence by physics, and the gate reading each
// unit's kind. Pure: the reading, the world script and the spawn plan in; the views the director plays out.

/**
 * The cards aligned to the segments (the user, 2026-11-03: "aligned"): a card that runs across a segment's boundary (a
 * long dialogue, a card from one scene into the next) is split there into consecutive cards of the same kind, each
 * with the people its own lines have (`at`); the segments stay as Jev cut them.
 */
export function alignCards(cards, segments) {
  const segmentOf = new Map(segments.flatMap((segment, k) => segment.sentences.map(id => [id, k])));
  return (cards ?? []).flatMap(card => {
    const pieces = [];
    for (const id of card.sentences) { const k = segmentOf.get(id) ?? -1, last = pieces.at(-1); if (last && last.k === k) last.sentences.push(id); else pieces.push({ k, sentences: [id] }); }
    if (pieces.length < 2) return [card];
    return pieces.map((piece, n) => { const lines = new Set(piece.sentences); return { ...card, id: n ? `${card.id}#${n + 1}` : card.id, first: piece.sentences[0], last: piece.sentences.at(-1), sentences: piece.sentences, people: (card.people ?? []).map(person => ({ ...person, at: (person.at ?? []).filter(id => lines.has(id)) })).filter(person => !person.at || person.at.length || !(card.people ?? []).some(other => other.at)) }; });
  });
}

/**
 * Who is in each segment, by physics (the user, 2026-11-03: "no one disappears or moves suddenly segment after segment
 * until new presence or next ground truth"): a person is placed where the cards first give evidence of them (acting,
 * speaking or spoken to, by the lines they appear in), and stays at that place, segment after segment, wherever the story
 * is at that place at the same story time, until evidence puts them somewhere else (they have left) or the story's time
 * moves on (a new period: they are not held there). Nobody is placed by the world script alone. A memory segment is the
 * past: its evidence places nobody now. Each entry keeps the segment's share that is now (1 − P(exposition) − P(memory))
 * for the smoothing to weigh.
 *
 * Held is not on stage (W10c, 2026-11-04): with most units placed at the whole city and four moments of story time, everyone
 * once seen was held in every later unit (a median cast of 15, up to 32). `present` is who is in view: given evidence in
 * the segment, named or described in it while held there, or given evidence there within the last `hold` lines (30: a
 * median cast of 4, at most 11). `held` keeps everyone held there; they stay where they were, never moved or removed.
 */
export const HOLD = 30;
export function segmentPresence({ segments, cards, scriptScenes, hold = HOLD }) {
  const segmentOf = new Map(segments.flatMap((segment, k) => segment.sentences.map(id => [id, k])));
  const position = new Map(segments.flatMap(segment => segment.sentences).map((id, n) => [id, n]));
  const evidence = segments.map(() => new Map()), seen = segments.map(() => new Map());
  // Evidence by the lines a person appears in (`at`), else by the card's first line: acting, speaking or spoken to places
  // them; named or described keeps someone already there in view.
  for (const card of cards ?? []) for (const person of card.people ?? []) {
    const acts = (person.how ?? []).some(how => ['acts', 'speaks', 'addressed'].includes(how));
    for (const id of person.at?.length ? person.at : [card.first]) {
      const k = segmentOf.get(id); if (k === undefined) continue;
      const into = acts && segments[k].type !== 'memory' ? evidence[k] : seen[k];
      into.set(person.id, Math.max(into.get(person.id) ?? -1, position.get(id)));
    }
  }
  // Where each person was last given evidence, at what story time and line; segments in story order (the reading's).
  const state = new Map();
  return segments.map((segment, k) => {
    const own = scriptScenes.get(segment.scene), place = own?.place ?? null, time = own?.at?.node ?? null, start = position.get(segment.first);
    const there = ([, where]) => where.place === place && where.time === time;
    const held = [...state].filter(there).map(([id]) => id);
    // In view: given evidence here, named here while there, or seen there within the last `hold` lines.
    const inView = new Set([...evidence[k].keys(), ...[...seen[k].keys()].filter(id => state.has(id) && there([id, state.get(id)])), ...[...state].filter(entry => there(entry) && start - entry[1].at <= hold).map(([id]) => id)]);
    for (const [id, at] of evidence[k]) state.set(id, { place, time, at });
    for (const [id, at] of seen[k]) { const where = state.get(id); if (where && there([id, where])) where.at = Math.max(where.at, at); }
    return { present: [...inView], held: [...new Set([...held, ...evidence[k].keys()])], evidence: [...evidence[k].keys()], now: Math.max(0, Math.round((1 - (segment.distribution?.exposition ?? 0) - (segment.distribution?.memory ?? 0)) * 1000) / 1000) };
  });
}

/**
 * Each scene its own segment (the user, 2026-11-04: the reading's tiler cuts segments, "each scene a segment"): its kind
 * as the reading typed it whole (its unit-type step), else from the block answers over its own sentences (each sentence's blocks, averaged), so the gate fires per segment as M14
 * has it; `change` is left to the scene's cut (beats.mjs).
 */
export function scenesAsSegments(reading) {
  const blocksAt = new Map();
  for (const block of reading.blocks ?? []) for (const id of block.sentences) (blocksAt.get(id) ?? blocksAt.set(id, []).get(id)).push(block);
  return reading.scenes.map(scene => {
    // A unit the reading typed whole (its unit-type step) keeps its own kind; else the blocks over its sentences.
    if (scene.distribution && Object.values(scene.distribution).some(p => p > 0)) return { scene: scene.id, first: scene.sentences[0], last: scene.sentences.at(-1), sentences: scene.sentences, type: scene.type ?? null, confidence: scene.confidence ?? 0, distribution: scene.distribution, smoothed: scene.distribution, change: null };
    const answers = scene.sentences.flatMap(id => blocksAt.get(id) ?? []), sum = {};
    for (const block of answers) for (const [type, p] of Object.entries(block.distribution ?? {})) sum[type] = (sum[type] ?? 0) + p / answers.length;
    const distribution = Object.fromEntries(Object.entries(sum).map(([type, p]) => [type, Math.round(p * 1000) / 1000]));
    const type = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
    const confidence = answers.length ? Math.round(answers.reduce((total, block) => total + (block.confidence ?? 0), 0) / answers.length * 100) / 100 : 0;
    return { scene: scene.id, first: scene.sentences[0], last: scene.sentences.at(-1), sentences: scene.sentences, type, confidence, distribution, smoothed: distribution, change: null };
  });
}

/**
 * The world by unit: the reading's scenes (each one segment), typed from the block answers over their sentences (the gate's
 * windows), the cards aligned to them, who is in each by physics (the world script's view), and the spawn plan's starts
 * for those present. A reading made with segments cut a second time (M14) plays its scenes; its segments are not read.
 */
export function segmentWorld({ reading: given, script, spawn }) {
  if (!given?.scenes?.length) return null;
  const segments = scenesAsSegments(given), cards = alignCards(given.cards, segments), scriptScenes = new Map((script?.scenes ?? []).map(scene => [scene.id, scene]));
  const presence = segmentPresence({ segments, cards, scriptScenes }), ids = segments.map(segment => segment.scene);
  const reading = { ...given, segments, scenes: given.scenes.map((scene, n) => ({ ...scene, type: segments[n].type })), cards };
  const scriptOut = script ? { ...script, scenes: ids.map((id, n) => { const own = scriptScenes.get(id); if (!own) return null; const people = new Set(presence[n].present); return { ...own, present: presence[n].present, evidence: presence[n].evidence, now: presence[n].now, timeline: (own.timeline ?? []).filter(event => (event.actors ?? []).some(actor => people.has(actor))) }; }).filter(Boolean) } : script;
  // The spawn plan's starts for those present by physics (someone held from before is carried, not started again).
  const spawnOf = new Map((spawn?.scenes ?? []).map(scene => [scene.id, scene]));
  const spawnOut = spawn ? { ...spawn, scenes: ids.map((id, n) => { const own = spawnOf.get(id); if (!own) return null; const here = new Set(presence[n].present); return { ...own, starts: (own.starts ?? []).filter(start => start.kind === 'thing' || here.has(start.who)) }; }).filter(Boolean) } : spawn;
  return { segments, ids, reading, script: scriptOut, spawn: spawnOut };
}

/**
 * The strands file (stage/world/strands.json's shape) of a segment script, in story time (the user, 2026-11-03: "we need
 * to make it story objective time order, as strands become forks"). v1's strands (`storyStrands` on the script's
 * projection, `scriptProjection`) give each container its layer (its place in story time, from the evidence of order:
 * a person's worldline, a flashback, stated times) and the lane it continues; a container with nobody in it stands alone
 * (no borrowed cast: nobody is placed without evidence). Then, in story order (layer, then reading order): a container is
 * on the fork of the one it continues, else starts one; each person's entry comes `from` the last container they were
 * in **in story time** (a flashback hands nothing over), at the same place or not. Someone new in a strand comes from
 * nowhere, which is fine.
 */
export function strandsFile(script, { scriptProjection, storyStrands }) {
  const alone = new Set(script.scenes.filter(scene => !scene.present?.length).map(scene => scene.id));
  const strands = storyStrands(scriptProjection(script), { alone });
  const index = new Map(script.scenes.map((scene, n) => [scene.id, n])), byId = new Map(script.scenes.map(scene => [scene.id, scene]));
  const order = [...script.scenes].sort((a, b) => (strands.layer.get(a.id) ?? 0) - (strands.layer.get(b.id) ?? 0) || index.get(a.id) - index.get(b.id));
  const forkOf = new Map(), last = new Map(), entries = new Map();
  for (const scene of order) {
    const previous = strands.continues?.get(scene.id) ?? null;
    forkOf.set(scene.id, previous && forkOf.has(previous) ? forkOf.get(previous) : scene.id);
    const flashback = scene.clock === null;
    entries.set(scene.id, (scene.present ?? []).map(person => { const from = flashback ? null : last.get(person) ?? null; return { person, from, samePlace: !!from && !!scene.place && byId.get(from)?.place === scene.place }; }));
    if (!flashback) for (const person of scene.present ?? []) last.set(person, scene.id);
  }
  const forks = [...new Set(forkOf.values())].map(id => ({ id, scenes: order.filter(scene => forkOf.get(scene.id) === id).map(scene => scene.id) }));
  return { version: 1, from: 'v2-script-segments', order: 'story', scenes: script.scenes.map(scene => ({ id: scene.id, parent: scene.parent ?? null, fork: forkOf.get(scene.id) ?? null, layer: strands.layer.get(scene.id) ?? null, lane: strands.lane.get(scene.id) ?? null, continues: strands.continues?.get(scene.id) ?? null, entries: entries.get(scene.id) ?? [] })), forks, checks: strands.checks, strands };
}
