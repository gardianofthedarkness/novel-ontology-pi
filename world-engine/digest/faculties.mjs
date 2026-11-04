// The faculties as a reading step (the user, 2026-11-04: "make them a reading step"). They read the text, not the world:
// none takes Jev's decisions, positions or walks, and none needs the terrain. So they run once per reading, before any
// play, and every run reads their results (stage 1 ends with them; the director only plays):
//
//   generalist     every unit, in reading order, its memory carried (digest.mjs digestScenes): moves, facts, items, talk,
//                  breaks, the background and the cast
//   scale          every beat of the gate (scaleBeats): its frame, reach, angle and duration
//   journeys       where the gate fires it (journeysOf), offered the places the story has by then: the named places the
//                  city carries, and the unnamed ones that have happened in story time (a box is the engine's to find)
//   choreography   where it fires (exchangesOf)
//   conversation   where it fires (talkOf)
//   ambience       where it fires (crowdOf)
//
// Who is in a unit is the reading's: its cast by physics from the cards (segments.mjs segmentPresence), with the review's
// pins over it when a workspace has them (the world's evidence comes back here, and a rerun pays only for what changed).
// Pure but for the work model: the reading, the world script and a work model in; the faculties by unit out.
import * as DG from './digest.mjs';
import * as G from '../director/gate.mjs';
import * as SG from '../director/segments.mjs';

export const PRESENT = new Set(['speaks', 'acts', 'addressed']);

/** The spans of a unit where a faculty fires (the gate's windows joined where they overlap), sixty lines a request. */
export function firedSpans(gate, scene, faculty) {
  const order = scene.sentences, spans = [];
  for (const window of gate.windows.filter(entry => entry.scene === scene.id && entry.fired.includes(faculty))) {
    const a = order.indexOf(window.first), b = order.indexOf(window.last), ids = order.slice(Math.max(0, a), b < 0 ? order.length : b + 1), last = spans.at(-1);
    if (last && ids.some(id => last.includes(id))) last.push(...ids.filter(id => !last.includes(id))); else spans.push(ids);
  }
  return spans.flatMap(span => Array.from({ length: Math.ceil(span.length / 60) }, (_, k) => span.slice(k * 60, (k + 1) * 60)));
}

/**
 * The place a journey names in words, when one offered fits: its id as given, a label the same as the words, or a label
 * within the words or the words within it (two characters at least); a place near the unit first, then the longest label.
 * Null when none fits (the words stay, the engine finds a landmark).
 */
export function placeOfWords(words, places) {
  const said = String(words ?? '').trim();
  if (!said) return null;
  if (places.some(place => place.id === said)) return said;
  const fits = places.filter(place => place.label && place.label.length >= 2 && (place.label === said || said.includes(place.label) || (said.length >= 2 && place.label.includes(said))));
  fits.sort((a, b) => (b.label === said) - (a.label === said) || (b.near ? 1 : 0) - (a.near ? 1 : 0) || b.label.length - a.label.length);
  return fits[0]?.id ?? null;
}

/** A journey with its places as ids where the words fit one offered (placeOfWords); the words kept as `said`. */
export function placedJourney(journey, places) {
  const id = words => placeOfWords(words, places) ?? words, said = {};
  for (const key of ['from', 'to']) if (journey[key] && id(journey[key]) !== journey[key]) said[key] = journey[key];
  const via = (journey.via ?? []).map(id);
  return { ...journey, from: journey.from ? id(journey.from) : journey.from, to: id(journey.to), via, ...(Object.keys(said).length ? { said } : {}) };
}

/**
 * Every faculty over a reading. `text`: sentence id → its text; `work`: a work model (cached by the caller); `strandsOf`:
 * (script) → the strands file (segments.mjs strandsFile with the TypeScript pieces bound); `pins`: the review's presence
 * pins ({ "unit|who": true | false }); `from`/`to`: unit ids to read (all when absent). Returns { units, usage }.
 */
export async function readFaculties({ reading: given, script, text, work, strandsOf, pins = {}, from = null, to = null, log = () => {} }) {
  const world = SG.segmentWorld({ reading: given, script, spawn: null }), reading = world.reading, scenes = reading.scenes;
  const strands = strandsOf(world.script), forkOf = new Map((strands.scenes ?? []).map(entry => [entry.id, entry.fork]));
  const gate = G.gateOf(G.windowsOf(reading), { strandOf: scene => forkOf.get(scene) ?? null });
  const ids = scenes.map(scene => scene.id), first = from ? ids.indexOf(from) : 0, last = to ? ids.lastIndexOf(to) : ids.length - 1;
  const line = id => text.get(id) ?? '', kind = id => reading.kinds?.[id]?.kind ?? null;
  const names = new Map([...reading.chart.entities.map(entity => [entity.id, entity.proper?.[0] ?? entity.names?.[0] ?? entity.id]), ...(reading.slots ?? []).map(slot => [slot.id, slot.label])]);
  const own = new Map(world.script.scenes.map(entry => [entry.id, entry]));
  // The cast of a unit: by physics from the cards, those the cards name there, the review's pins over both.
  const castOf = scene => {
    const found = new Set([...(own.get(scene.id)?.present ?? []), ...Object.entries(pins).filter(([key, value]) => value && key.startsWith(`${scene.id}|`)).map(([key]) => key.slice(scene.id.length + 1))]);
    for (const card of reading.cards) if (scene.sentences.includes(card.first)) for (const person of card.people ?? []) if ((person.how ?? []).some(how => PRESENT.has(how))) found.add(person.id);
    return [...found].filter(id => pins[`${scene.id}|${id}`] !== false).map(id => ({ id, name: names.get(id) ?? id }));
  };
  // The places a journey may name at a unit: the named places the city carries, and the unnamed ones born by then in story
  // order (the world script's clock, then the strands' layers, then reading order).
  const layer = new Map((strands.scenes ?? []).map(entry => [entry.id, entry.layer ?? 0])), index = new Map(ids.map((id, n) => [id, n]));
  const clock = id => own.get(id)?.clock ?? [Infinity, Infinity];
  const rank = new Map([...ids].sort((a, b) => clock(a)[0] - clock(b)[0] || clock(a)[1] - clock(b)[1] || (layer.get(a) ?? 0) - (layer.get(b) ?? 0) || index.get(a) - index.get(b)).map((id, n) => [id, n]));
  const bornAt = new Map(), born = (place, r) => { for (let id = place, guard = 0; id && guard < 12; id = script.places?.[id]?.parent ?? null, guard++) if (!(bornAt.get(id) <= r)) bornAt.set(id, r); };
  for (const entry of world.script.scenes) if (entry.place) born(entry.place, rank.get(entry.id));
  const nominated = id => !String(id).startsWith('unnamed:') && !script.places?.[id]?.unnamed;
  // Near a unit, offered first and marked: its own place, the places of the units either side, each with its parent, its
  // siblings and its children in the tree (W10b: 14 of 81 journeys said in words a place the tree has, near where they were).
  const parentOf = id => script.places?.[id]?.parent ?? null, childrenOf = new Map();
  for (const [id, place] of Object.entries(script.places ?? {})) if (place.parent) (childrenOf.get(place.parent) ?? childrenOf.set(place.parent, []).get(place.parent)).push(id);
  const nearOf = scene => {
    const at = index.get(scene.id), near = new Set();
    for (const id of [ids[at - 1], scene.id, ids[at + 1]].map(unit => unit && own.get(unit)?.place).filter(Boolean)) {
      near.add(id); const parent = parentOf(id);
      if (parent) { near.add(parent); for (const sibling of childrenOf.get(parent) ?? []) near.add(sibling); }
      for (const child of childrenOf.get(id) ?? []) near.add(child);
    }
    return near;
  };
  const placesAt = scene => {
    const near = nearOf(scene);
    return Object.entries(script.places ?? {}).filter(([id]) => nominated(id) || (bornAt.get(id) ?? Infinity) <= rank.get(scene.id))
      .map(([id, place]) => ({ id, label: place.label ?? names.get(id) ?? id, scale: place.scale ?? null, ...(near.has(id) ? { near: true } : {}) }))
      .sort((a, b) => (b.near ? 1 : 0) - (a.near ? 1 : 0));
  };

  const meters = Object.fromEntries(['generalist', 'scale', 'journeys', 'choreography', 'conversation', 'ambience'].map(id => [id, DG.metered(work)]));
  const units = {}, chosen = scenes.slice(first, last + 1);
  // The generalist first, in reading order (its memory carries from unit to unit); the others need its summary.
  await DG.digestScenes(meters.generalist, {
    scenes: chosen, line, kind, peopleOf: castOf, cardOf: new Map(reading.cards.flatMap(card => card.sentences.map(id => [id, card.id]))),
    placeOf: scene => { const place = own.get(scene.id)?.place; return names.get(place) ?? script.places?.[place]?.label ?? place ?? ''; },
    whenOf: scene => reading.time?.scenes?.find(entry => entry.scene === scene.id)?.when ?? null,
    onScene: async result => { (units[result.scene] ??= {}).generalist = result; log(`generalist ${result.scene}: ${result.moves.length} moves, ${result.facts.length} facts`); },
  });
  for (const scene of chosen) {
    const unit = (units[scene.id] ??= {}), digest = unit.generalist?.digest ?? null, people = castOf(scene), base = { scene, line, kind, people, digest };
    const beats = gate.beats.map((beat, n) => ({ ...beat, n })).filter(beat => beat.scene === scene.id);
    if (beats.length) {
      const span = beat => { const a = scene.sentences.indexOf(beat.first), b = scene.sentences.indexOf(beat.last); return scene.sentences.slice(Math.max(0, a), (b < 0 ? scene.sentences.length : b + 1)).slice(0, 40); };
      // Each scale kept with its beat's first sentence, so a run finds its beat whatever it numbers them.
      unit.scale = (await DG.scaleBeats(meters.scale, { ...base, beats: beats.map(beat => ({ ...beat, sentences: span(beat) })) })).map(entry => ({ ...entry, first: beats.find(beat => beat.n === entry.n)?.first ?? null }));
    }
    const fired = faculty => firedSpans(gate, scene, faculty);
    const journeys = fired('journeys'), choreography = fired('choreography'), conversation = fired('conversation'), ambience = fired('ambience');
    if (journeys.length) { const places = placesAt(scene); unit.journeys = (await DG.journeysOf(meters.journeys, { ...base, spans: journeys, places })).map(journey => placedJourney(journey, places)); }
    if (choreography.length) unit.choreography = await DG.exchangesOf(meters.choreography, { ...base, spans: choreography });
    if (conversation.length) unit.conversation = await DG.talkOf(meters.conversation, { ...base, spans: conversation });
    if (ambience.length) unit.ambience = await DG.crowdOf(meters.ambience, { ...base, spans: ambience });
    unit.cast = people.map(person => person.id);
    log(`faculties ${scene.id}: ${['scale', 'journeys', 'choreography', 'conversation', 'ambience'].filter(id => unit[id]).join(', ') || 'none fired'}`);
  }
  return { units, usage: Object.fromEntries(Object.entries(meters).map(([id, meter]) => [id, meter.usage])) };
}
