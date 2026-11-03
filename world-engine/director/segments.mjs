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
 * Who is in each segment, by its cards' evidence first (someone acts, speaks or is spoken to there): a person enters a
 * scene at the first segment with evidence of them and stays on in its later segments (one place, one time, L1); someone
 * the script has present with no evidence anywhere in the scene is there from its first segment. Weighting second: a
 * memory segment (its type) is the past, so its evidence places nobody now; each entry keeps the segment's share that is
 * happening now (1 − P(exposition) − P(memory)) for the smoothing to weigh.
 */
export function segmentPresence({ segments, cards, scriptScenes }) {
  const segmentOf = new Map(segments.flatMap((segment, k) => segment.sentences.map(id => [id, k])));
  const evidence = segments.map(() => new Set());
  // Evidence by the lines a person appears in (`at`), else by the card's first line.
  for (const card of cards ?? []) for (const person of card.people ?? []) {
    if (!(person.how ?? []).some(how => ['acts', 'speaks', 'addressed'].includes(how))) continue;
    for (const id of person.at?.length ? person.at : [card.first]) { const k = segmentOf.get(id); if (k !== undefined && segments[k].type !== 'memory') evidence[k].add(person.id); }
  }
  const present = segments.map(() => []), byScene = new Map();
  segments.forEach((segment, k) => (byScene.get(segment.scene) ?? byScene.set(segment.scene, []).get(segment.scene)).push(k));
  for (const [scene, ks] of byScene) {
    const script = scriptScenes.get(scene)?.present ?? [], seen = new Set(ks.flatMap(k => [...evidence[k]]));
    const here = new Set(script.filter(id => !seen.has(id)));
    for (const k of ks) { for (const id of evidence[k]) here.add(id); present[k] = [...here]; }
  }
  return segments.map((segment, k) => ({ present: present[k], evidence: [...evidence[k]], now: Math.max(0, Math.round((1 - (segment.distribution?.exposition ?? 0) - (segment.distribution?.memory ?? 0)) * 1000) / 1000) }));
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
  segments.forEach(segment => { const n = k.get(segment.scene) ?? 0; k.set(segment.scene, n + 1); ids.push(segmentId(segment.scene, n)); });
  const parent = new Map(ids.map((id, n) => [id, segments[n].scene]));
  const readingScenes = segments.map((segment, n) => { const scene = reading.scenes[sceneIndex.get(segment.scene)]; return { ...scene, id: ids[n], parent: segment.scene, sentences: segment.sentences, type: segment.type }; });
  const time = reading.time ? { ...reading.time, scenes: ids.map(id => { const entry = reading.time.scenes?.find(item => item.scene === parent.get(id)); return entry ? { ...entry, scene: id } : null; }).filter(Boolean) } : reading.time;
  const scriptOut = script ? { ...script, scenes: ids.map((id, n) => { const own = scriptScenes.get(parent.get(id)); if (!own) return null; const people = new Set(presence[n].present); return { ...own, id, parent: own.id, present: presence[n].present, evidence: presence[n].evidence, now: presence[n].now, timeline: (own.timeline ?? []).filter(event => (event.actors ?? []).some(actor => people.has(actor))) }; }).filter(Boolean) } : script;
  // Spawning places a scene's people once: at its first segment; later segments carry them on (anew only at the first).
  const spawnOf = new Map((spawn?.scenes ?? []).map(scene => [scene.id, scene]));
  const spawnOut = spawn ? { ...spawn, scenes: ids.map(id => { const own = spawnOf.get(parent.get(id)); if (!own) return null; const first = id.endsWith('~1'); return first ? { ...own, id, parent: own.id, starts: (own.starts ?? []).map(start => ({ ...start, scene: id })) } : { ...own, id, parent: own.id, spawn: own.spawn === 'new' ? 'carry' : own.spawn, starts: [] }; }).filter(Boolean) } : spawn;
  return { segments, ids, parent, reading: { ...reading, scenes: readingScenes, cards, time, bySegment: true }, script: scriptOut, spawn: spawnOut };
}

/**
 * The strands file (stage/world/strands.json's shape, experiments/v2/strands.mjs) of a script: each container's fork,
 * layer, lane, the one it continues, and each person's entry (from which, at the same place). `scriptStrands` is
 * src/v2/extraction/strands.ts's (v1's strands on the script, no model call).
 */
export function strandsFile(script, scriptStrands) {
  const { strands, timeline } = scriptStrands(script);
  return { version: 1, from: 'v2-script-segments', scenes: script.scenes.map(scene => ({ id: scene.id, parent: scene.parent ?? null, fork: timeline.forkOf.get(scene.id) ?? null, layer: strands.layer.get(scene.id) ?? null, lane: strands.lane.get(scene.id) ?? null, continues: strands.continues?.get(scene.id) ?? null, entries: timeline.handoffs.get(scene.id) ?? [] })), forks: timeline.forks, checks: strands.checks, strands };
}
