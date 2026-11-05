// The pre-film casts as a reading step (the user, 2026-11-04: "make them a reading step"; "there's no faculty now, they
// are all different casts"). They read the text, not the world:
// none takes Jev's decisions, positions or walks, and none needs the terrain. So they run once per reading, before any
// play, and every run reads their results (stage 1 ends with them; the director only plays):
//
//   scriptSupervisor  every unit, in reading order, its memory carried (digest.mjs digestScenes): moves, facts, items, talk,
//                  breaks, the background and the cast
//   cinematographer   every beat of the gate (scaleBeats): its frame, reach, angle and duration
//   blocking          where the gate fires it (journeysOf), offered the places the story has by then: the named places the
//                  city carries, and the unnamed ones that have happened in story time (a box is the engine's to find)
//   actionDirector    where it fires (exchangesOf)
//   dialogueCoverage  where it fires (talkOf)
//   backgroundAction  where it fires (crowdOf)
//
// Who is in a unit is the reading's: its cast by physics from the cards (segments.mjs segmentPresence), with the review's
// pins over it when a workspace has them (the world's evidence comes back here, and a rerun pays only for what changed).
// Pure but for the work model: the reading, the world script and a work model in; the casts' notes by unit out.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as DG from './digest.mjs';
import { prefilmOf } from '../director/specialists.mjs';
import * as G from '../director/gate.mjs';
import * as SG from '../director/segments.mjs';

export const PRESENT = new Set(['speaks', 'acts', 'addressed']);

/** The spans of a unit where a cast fires (the gate's windows joined where they overlap), sixty lines a request. */
export function firedSpans(gate, scene, cast) {
  const order = scene.sentences, spans = [];
  for (const window of gate.windows.filter(entry => entry.scene === scene.id && entry.fired.includes(cast))) {
    const a = order.indexOf(window.first), b = order.indexOf(window.last), ids = order.slice(Math.max(0, a), b < 0 ? order.length : b + 1), last = spans.at(-1);
    if (last && ids.some(id => last.includes(id))) last.push(...ids.filter(id => !last.includes(id))); else spans.push(ids);
  }
  return spans.flatMap(span => Array.from({ length: Math.ceil(span.length / 60) }, (_, k) => span.slice(k * 60, (k + 1) * 60)));
}

/**
 * The place a journey names in words, when one offered fits: its id as given, a label the same as the words, or a label
 * within the words or the words within it (two characters at least); the label ending latest in the words first, then a
 * place near the unit, then the longest label.
 * Null when none fits (the words stay, the engine finds a landmark).
 */
export function placeOfWords(words, places) {
  const said = String(words ?? '').trim();
  if (!said) return null;
  if (places.some(place => place.id === said)) return said;
  // A label as the text names it: without the world script's marks (" (scene 8)" for an unnamed place, " · pool").
  const bare = label => String(label ?? '').replace(/\s*\(scene \d+\)\s*$/, '').replace(/\s*·\s*pool$/, '').trim();
  const fits = places.map(place => ({ ...place, label: bare(place.label) })).filter(place => place.label.length >= 2 && (place.label === said || said.includes(place.label) || (said.length >= 2 && place.label.includes(said))));
  // The label ending latest in the words first: the head of a Chinese phrase comes last (混合大厦间的小巷 is an alley).
  const end = place => said.includes(place.label) ? said.lastIndexOf(place.label) + place.label.length : said.length;
  fits.sort((a, b) => (b.label === said) - (a.label === said) || end(b) - end(a) || (b.near ? 1 : 0) - (a.near ? 1 : 0) || b.label.length - a.label.length);
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
 * Every pre-film cast over a reading. `text`: sentence id → its text; `work`: a work model (cached by the caller); `strandsOf`:
 * (script) → the strands file (segments.mjs strandsFile with the TypeScript pieces bound); `pins`: the review's presence
 * pins ({ "unit|who": true | false }); `from`/`to`: unit ids to read (all when absent); `parallel`: requests at once.
 * Returns { units, usage }.
 */
export async function readPrefilm({ reading: given, script, text, work, strandsOf, pins = {}, from = null, to = null, parallel = 12, log = () => {} }) {
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
  // A place first told inside a unit (its `scene`) has happened there too, not only where it is a unit's own place.
  for (const [id, place] of Object.entries(script.places ?? {})) if (place?.scene && rank.has(place.scene)) born(id, rank.get(place.scene));
  const nominated = id => !String(id).startsWith('unnamed:') && !script.places?.[id]?.unnamed;
  // Near a unit, offered first and marked: its own place, the places of the units either side, each with its parent, its
  // siblings and its children in the tree, and the places first told in those units (W10b: 14 of 81 journeys said in words a place the tree has, near where they were).
  const parentOf = id => script.places?.[id]?.parent ?? null, childrenOf = new Map();
  for (const [id, place] of Object.entries(script.places ?? {})) if (place.parent) (childrenOf.get(place.parent) ?? childrenOf.set(place.parent, []).get(place.parent)).push(id);
  const nearOf = scene => {
    const at = index.get(scene.id), near = new Set();
    for (const id of [ids[at - 1], scene.id, ids[at + 1]].map(unit => unit && own.get(unit)?.place).filter(Boolean)) {
      near.add(id); const parent = parentOf(id);
      if (parent) { near.add(parent); for (const sibling of childrenOf.get(parent) ?? []) near.add(sibling); }
      for (const child of childrenOf.get(id) ?? []) near.add(child);
    }
    // And the places first told in those units (an alley of the unit, whose parent is its district's pool).
    const units = new Set([ids[at - 1], scene.id, ids[at + 1]].filter(Boolean));
    for (const [id, place] of Object.entries(script.places ?? {})) if (units.has(place?.scene)) near.add(id);
    return near;
  };
  const placesAt = scene => {
    const near = nearOf(scene);
    return Object.entries(script.places ?? {}).filter(([id]) => nominated(id) || (bornAt.get(id) ?? Infinity) <= rank.get(scene.id))
      .map(([id, place]) => ({ id, label: place.label ?? names.get(id) ?? id, scale: place.scale ?? null, ...(near.has(id) ? { near: true } : {}) }))
      .sort((a, b) => (b.near ? 1 : 0) - (a.near ? 1 : 0));
  };

  const meters = Object.fromEntries(['scriptSupervisor', 'cinematographer', 'blocking', 'actionDirector', 'dialogueCoverage', 'backgroundAction'].map(id => [id, DG.metered(work)]));
  const found = {}, chosen = scenes.slice(first, last + 1), tasks = [];
  // What needs only a unit's summary runs as soon as that summary is in, every cast at once, `parallel` requests at a
  // time in one lane (the user, 2026-11-04: "parallel for different faculties if they don't have dependencies"). Only the
  // summaries wait on each other, the memory carried from unit to unit.
  const lane = DG.limiter(parallel), through = Object.fromEntries(Object.entries(meters).map(([id, meter]) => [id, lane(meter)]));
  const specialists = async (scene, digest) => {
    const unit = (found[scene.id] ??= {}), people = castOf(scene), base = { scene, line, kind, people, digest };
    const beats = gate.beats.map((beat, n) => ({ ...beat, n })).filter(beat => beat.scene === scene.id);
    const span = beat => { const a = scene.sentences.indexOf(beat.first), b = scene.sentences.indexOf(beat.last); return scene.sentences.slice(Math.max(0, a), (b < 0 ? scene.sentences.length : b + 1)).slice(0, 40); };
    const fired = cast => firedSpans(gate, scene, cast);
    const journeys = fired('blocking'), exchanges = fired('actionDirector'), talk = fired('dialogueCoverage'), crowds = fired('backgroundAction');
    await Promise.all([
      // Each scale kept with its beat's first sentence, so a run finds its beat whatever it numbers them.
      beats.length && DG.scaleBeats(through.cinematographer, { ...base, beats: beats.map(beat => ({ ...beat, sentences: span(beat) })) }).then(list => { unit.cinematographer = list.map(entry => ({ ...entry, first: beats.find(beat => beat.n === entry.n)?.first ?? null })); }),
      journeys.length && (async () => { const places = placesAt(scene); unit.blocking = (await DG.journeysOf(through.blocking, { ...base, spans: journeys, places })).map(journey => placedJourney(journey, places)); })(),
      exchanges.length && DG.exchangesOf(through.actionDirector, { ...base, spans: exchanges }).then(list => { unit.actionDirector = list; }),
      talk.length && DG.talkOf(through.dialogueCoverage, { ...base, spans: talk }).then(said => { unit.dialogueCoverage = said; }),
      crowds.length && DG.crowdOf(through.backgroundAction, { ...base, spans: crowds }).then(list => { unit.backgroundAction = list; }),
    ]);
    unit.cast = people.map(person => person.id);
    log(`casts ${scene.id}: ${['cinematographer', 'blocking', 'actionDirector', 'dialogueCoverage', 'backgroundAction'].filter(id => unit[id]).join(', ') || 'none fired'}`);
  };
  await DG.digestScenes(meters.scriptSupervisor, {
    scenes: chosen, line, kind, peopleOf: castOf, cardOf: new Map(reading.cards.flatMap(card => card.sentences.map(id => [id, card.id]))),
    placeOf: scene => { const place = own.get(scene.id)?.place; return names.get(place) ?? script.places?.[place]?.label ?? place ?? ''; },
    whenOf: scene => reading.time?.scenes?.find(entry => entry.scene === scene.id)?.when ?? null,
    ahead: through.scriptSupervisor, onSummary: (scene, digest) => tasks.push(specialists(scene, digest)),
    onScene: async result => { (found[result.scene] ??= {}).scriptSupervisor = result; log(`script supervisor ${result.scene}: ${result.moves.length} moves, ${result.facts.length} facts`); },
  });
  await Promise.all(tasks);
  // In reading order, each unit's entries in the order they always had.
  const ORDER = ['scriptSupervisor', 'cinematographer', 'blocking', 'actionDirector', 'dialogueCoverage', 'backgroundAction', 'cast'];
  const units = Object.fromEntries(chosen.filter(scene => found[scene.id]).map(scene => [scene.id, Object.fromEntries(ORDER.filter(key => key in found[scene.id]).map(key => [key, found[scene.id][key]]))]));
  return { units, usage: Object.fromEntries(Object.entries(meters).map(([id, meter]) => [id, meter.usage])) };
}

/** The pre-film casts' notes beside a reading (`dir`: the reading's v2 folder): prefilm.json, else an older casts.json, with the cast ids. */
export async function loadPrefilm(dir) {
  const read = name => readFile(join(dir, name), 'utf8').then(JSON.parse);
  // With what the text has in use (in-use.json, experiments/v2/in-use.mjs) merged into the notes, where it has been made.
  const notes = prefilmOf(await read('prefilm.json').catch(() => read('faculties.json')).catch(() => null)), inUse = await read('in-use.json').catch(() => null);
  return inUse ? (await import('./in-use.mjs')).withInUse(notes, inUse) : notes;
}
