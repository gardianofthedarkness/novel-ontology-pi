// Strands, not scenes (M14; the user, 2026-11-03: "all of our design should revolve around strands, there should be no
// scene level processing in world engine … the minimum unit of processing is cards and blocks of sentence"; then: by
// segment, aligned to cards, the page too; a card's evidence first, weighting second). The world engine plays segments:
// the stretches Jev cut where the kind of action changes (the reading's `segments`), each its own container on the page,
// in its scene's place and time. Scenes stay as the novel's (canon's) and as the parent each segment's world data is
// looked up in. Pure: the reading, the world script and the spawn plan in; their segment views out.

/** A segment's id: its scene's and its place in the scene (scene_000040~3). */
export const segmentId = (scene, k) => `${scene}~${k + 1}`;
/** The scene a container belongs to (a segment's parent, a scene its own). */
export const sceneOfContainer = id => String(id).split('~')[0];

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
 */
export function segmentPresence({ segments, cards, scriptScenes }) {
  const segmentOf = new Map(segments.flatMap((segment, k) => segment.sentences.map(id => [id, k])));
  const evidence = segments.map(() => new Set());
  // Evidence by the lines a person appears in (`at`), else by the card's first line.
  for (const card of cards ?? []) for (const person of card.people ?? []) {
    if (!(person.how ?? []).some(how => ['acts', 'speaks', 'addressed'].includes(how))) continue;
    for (const id of person.at?.length ? person.at : [card.first]) { const k = segmentOf.get(id); if (k !== undefined && segments[k].type !== 'memory') evidence[k].add(person.id); }
  }
  // Where each person was last given evidence, and at what story time; segments in story order (the reading's).
  const state = new Map();
  return segments.map((segment, k) => {
    const own = scriptScenes.get(segment.scene), place = own?.place ?? null, time = own?.at?.node ?? null;
    for (const id of evidence[k]) state.set(id, { place, time });
    const present = [...state].filter(([, where]) => where.place === place && where.time === time).map(([id]) => id);
    return { present, evidence: [...evidence[k]], now: Math.max(0, Math.round((1 - (segment.distribution?.exposition ?? 0) - (segment.distribution?.memory ?? 0)) * 1000) / 1000) };
  });
}

/**
 * The world as segments: the reading's scenes, the world script's scenes and the spawn plan's, one entry a segment (its
 * scene's place, time and chapter; its own people), in story order. `parent` maps each segment back to its scene.
 */
export function segmentWorld({ reading, script, spawn }) {
  if (!reading.segments?.length) return null;
  const segments = reading.segments, cards = alignCards(reading.cards, segments), scriptScenes = new Map((script?.scenes ?? []).map(scene => [scene.id, scene]));
  const presence = segmentPresence({ segments, cards, scriptScenes });
  const sceneIndex = new Map(reading.scenes.map((scene, n) => [scene.id, n])), k = new Map(), ids = [];
  // A scene that is one segment (the reading's one tiling, 2026-11-04: every scene is a stretch) keeps its own id.
  const parts = new Map(); for (const segment of segments) parts.set(segment.scene, (parts.get(segment.scene) ?? 0) + 1);
  segments.forEach(segment => { const n = k.get(segment.scene) ?? 0; k.set(segment.scene, n + 1); ids.push(parts.get(segment.scene) === 1 ? segment.scene : segmentId(segment.scene, n)); });
  const firstOfScene = new Set(segments.map((segment, n) => (n === 0 || segments[n - 1].scene !== segment.scene ? ids[n] : null)).filter(Boolean));
  const parent = new Map(ids.map((id, n) => [id, segments[n].scene]));
  const readingScenes = segments.map((segment, n) => { const scene = reading.scenes[sceneIndex.get(segment.scene)]; return { ...scene, id: ids[n], parent: segment.scene, sentences: segment.sentences, type: segment.type }; });
  const time = reading.time ? { ...reading.time, scenes: ids.map(id => { const entry = reading.time.scenes?.find(item => item.scene === parent.get(id)); return entry ? { ...entry, scene: id } : null; }).filter(Boolean) } : reading.time;
  const scriptOut = script ? { ...script, scenes: ids.map((id, n) => { const own = scriptScenes.get(parent.get(id)); if (!own) return null; const people = new Set(presence[n].present); return { ...own, id, parent: own.id, present: presence[n].present, evidence: presence[n].evidence, now: presence[n].now, timeline: (own.timeline ?? []).filter(event => (event.actors ?? []).some(actor => people.has(actor))) }; }).filter(Boolean) } : script;
  // Spawning places a scene's people once each: a person's start goes with the segment where they first appear in the
  // scene (the scene's first segment may be narration with nobody in it); anew only at the scene's first segment.
  const spawnOf = new Map((spawn?.scenes ?? []).map(scene => [scene.id, scene])), seen = new Map();
  const spawnOut = spawn ? { ...spawn, scenes: ids.map((id, n) => {
    const own = spawnOf.get(parent.get(id)); if (!own) return null;
    const placed = seen.get(own.id) ?? seen.set(own.id, new Set()).get(own.id), here = presence[n].present.filter(who => !placed.has(who));
    for (const who of here) placed.add(who);
    const starts = (own.starts ?? []).filter(start => here.includes(start.who)).map(start => ({ ...start, scene: id }));
    return { ...own, id, parent: own.id, ...(firstOfScene.has(id) ? {} : { spawn: own.spawn === 'new' ? 'carry' : own.spawn }), starts };
  }).filter(Boolean) } : spawn;
  return { segments, ids, parent, reading: { ...reading, scenes: readingScenes, cards, time, bySegment: true }, script: scriptOut, spawn: spawnOut };
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
