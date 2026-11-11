// The underground note on each place (docs/v3/design.html#terrain-levels §8.5): how likely the text puts a place below the street,
// gathered from what its units say, with no question of its own. Its evidence: the set dresser's setting of each unit
// (settings.json, a unit called "underground"), and, where the pre-film notes are made, the underground facts on the
// unit's people (prefilm.json). A view input kept per place like its scale, never canon.
//
// A place is noted when at least `minUnits` of its units are underground and they are at least `minShare` of all its
// units. Places inside a noted place inherit its note (its streets, buildings and rooms), so a unit
// in one is underground without being asked again. The layer is the near-ground one unless the evidence says deep; the
// set dresser does not tell the two apart, so today every note says near (`layerBy: 'default'`).

const FACT_SURE = 0.6;

/**
 * script: the world script ({ scenes: [{ id, place }], places: { [id]: { parent, scale, label } } });
 * settings: settings.json's `units` ({ [unit]: { setting, sure } }); facts: per unit, its underground facts' sureness
 * ({ [unit]: number[] }), optional. Returns { places: { [id]: note }, noted: [ids] }.
 */
export function undergroundNotes({ script, settings = {}, facts = {}, minUnits = 2, minShare = 0.5, hand = {} }) {
  const unitsOf = new Map();
  for (const scene of script?.scenes ?? []) if (scene.place) (unitsOf.get(scene.place) ?? unitsOf.set(scene.place, []).get(scene.place)).push(scene.id);
  const places = {};
  for (const [place, units] of unitsOf) {
    const read = units.filter(unit => settings[unit] && settings[unit].setting !== 'not said');
    const under = units.filter(unit => (settings[unit]?.setting === 'underground' && (settings[unit].sure ?? 0) >= 0.5) || (facts[unit] ?? []).some(sure => sure >= FACT_SURE));
    if (!under.length) continue;
    // Of all the place's units: the set dresser reads only units with environment lines (W12: 10 of the city's 144), and
    // 7 of those 10 underground once noted the whole city, and every place in it with it.
    const share = under.length / Math.max(1, units.length), sure = Math.round(share * Math.min(1, under.length / minUnits) * 100) / 100;
    places[place] = { units: units.length, read: read.length, underground: under, share: Math.round(share * 100) / 100, sure, noted: under.length >= minUnits && share >= minShare, layer: 'near', layerBy: 'default' };
  }
  // Inherited: a place inside a noted one is noted with it, by the nearest noted place it stands in.
  const parentOf = id => script?.places?.[id]?.parent ?? null, noted = new Set(Object.keys(places).filter(id => places[id].noted));
  for (const id of Object.keys(script?.places ?? {})) {
    if (noted.has(id)) continue;
    for (let up = parentOf(id), guard = 0; up && guard < 12; up = parentOf(up), guard++) if (noted.has(up)) { places[id] = { ...(places[id] ?? { units: unitsOf.get(id)?.length ?? 0, underground: [], share: 0, sure: 0 }), noted: true, inherited: up, layer: places[up].layer, layerBy: places[up].layerBy }; break; }
  }
  withLayers(places, script, hand, id => ({ units: unitsOf.get(id)?.length ?? 0, underground: [], share: 0, sure: 0, noted: false }));
  return { places, noted: Object.keys(places).filter(id => places[id].noted) };
}

// The other layers by a place's name (docs/v3/design.html#terrain-levels §3.5): words that put it in the air (floating, an airship, a
// city or a fortress in the sky) or in space (the universe, outer space, a satellite, a space station, the moon). A satellite
// town is on the ground; a sky bridge or a roof garden (words of the air on a building) is the surface's, so the air's words
// are whole compounds. In escapes: the books' words stay out of the repository's text.
const AIR_WORDS = ['\u6d6e\u6e38', '\u6d6e\u7a7a', '\u98de\u884c\u8239', '\u98de\u8247', '\u7a7a\u4e2d\u8981\u585e', '\u7a7a\u4e2d\u90fd\u5e02', '\u7a7a\u4e2d\u57ce', '\u5929\u7a7a\u57ce', '\u5929\u7a7a\u4e4b\u57ce'];
const SPACE_WORDS = ['\u5b87\u5b99', '\u592a\u7a7a', '\u536b\u661f', '\u7a7a\u95f4\u7ad9', '\u6708\u7403', '\u6708\u9762'];
const GROUND_WORDS = ['\u536b\u661f\u57ce'];
const AIR_EN = /\b(floating|airship|sky (city|fortress|island))\b/i, SPACE_EN = /\b(orbit|orbital|satellite|space station|outer space|lunar|moon base)\b/i, GROUND_EN = /\bsatellite (town|city)\b/i;
/** The layer a place's name puts it in: 'air', 'space', or null (its name says nothing of another layer). */
export const layerOfName = label => {
  const text = String(label ?? '');
  if (GROUND_WORDS.some(word => text.includes(word)) || GROUND_EN.test(text)) return null;
  if (SPACE_WORDS.some(word => text.includes(word)) || SPACE_EN.test(text)) return 'space';
  if (AIR_WORDS.some(word => text.includes(word)) || AIR_EN.test(text)) return 'air';
  return null;
};
/** The layers a note can give: under the street near the ground ('near'), the deep underground, the air, space; or the surface (a hand's answer only). */
export const NOTE_LAYERS = ['surface', 'near', 'deep', 'air', 'space'];

/**
 * The layer words of the names, then a hand's answers (`hand`: { [place]: layer }, NOTE_LAYERS), each over the underground's
 * evidence and passed down the tree (a building on a floating island floats with it) to the places that have none of their
 * own. A place in the air or in space is no place under the street (`noted` false); a hand's 'near' or 'deep' notes it.
 */
function withLayers(places, script, hand, blank) {
  const parentOf = id => script?.places?.[id]?.parent ?? null, own = new Map();
  for (const [id, place] of Object.entries(script?.places ?? {})) { const layer = layerOfName(place.label ?? place.name); if (layer) own.set(id, { layer, layerBy: 'name' }); }
  for (const [id, layer] of Object.entries(hand ?? {})) if (NOTE_LAYERS.includes(layer)) own.set(id, { layer, layerBy: 'hand' });
  const set = (id, layer, layerBy, from = null) => { places[id] = { ...(places[id] ?? blank(id)), layer, layerBy, noted: layer === 'near' || layer === 'deep', ...(from ? { inherited: from } : {}) }; if (!from) delete places[id].inherited; };
  for (const id of new Set([...Object.keys(script?.places ?? {}), ...own.keys()])) {
    if (own.has(id)) { set(id, own.get(id).layer, own.get(id).layerBy); continue; }
    for (let up = parentOf(id), guard = 0; up && guard < 12; up = parentOf(up), guard++) if (own.has(up)) { set(id, own.get(up).layer, own.get(up).layerBy, up); break; }
  }
}

/** Whether a place (or one it stands in) is noted underground. */
export function notedUnderground(notes, place, script = null) {
  for (let id = place, guard = 0; id && guard < 12; id = script?.places?.[id]?.parent ?? null, guard++) if (notes?.places?.[id]?.noted) return notes.places[id];
  return null;
}

/** The note that puts a place (or one it stands in) in another layer: noted under the street, or in the air or in space. */
export function layerNote(notes, place, script = null) {
  for (let id = place, guard = 0; id && guard < 12; id = script?.places?.[id]?.parent ?? null, guard++) { const note = notes?.places?.[id]; if (note?.noted || note?.layer === 'air' || note?.layer === 'space') return note; if (note?.layer === 'surface') return null; }
  return null;
}

/** Each unit's underground facts' sureness, from the pre-film notes (prefilm.json `units[unit].scriptSupervisor.facts`, kind underground). */
export function factsOf(prefilm) {
  const out = {};
  for (const [unit, notes] of Object.entries(prefilm?.units ?? {})) {
    const sure = (notes?.scriptSupervisor?.facts ?? notes?.facts ?? []).filter(fact => fact?.kind === 'underground').map(fact => fact.sure ?? 0);
    if (sure.length) out[unit] = sure;
  }
  return out;
}

/**
 * Underground stretches (the user, 2026-11-05: yes, a run of underground units filed under a city or a district gets an
 * underground place of its own): units in reading order, at one city- or district-scale place and in one sequence, with
 * underground evidence (the set dresser's setting, or a pre-film underground fact) no more than `maxGap` units apart. A
 * stretch runs from its first such unit to its last, the units between with it (W12: 118–123, with 119 between), and needs
 * `minUnits` with evidence. Each becomes an unnamed place of the street's scale under that place (`id` the reading's slot
 * id), so the terrain loop places it and asks its height, the underground's slices among them.
 * scenes: the reading's units in order ({ id, sequence }); settings: settings.json `units` (with `lines`); facts: per unit,
 * its underground facts ({ sure, sentence }[]).
 */
export function undergroundStretches({ scenes, script, settings = {}, facts = {}, maxGap = 2, minUnits = 2 }) {
  const placeOf = new Map((script?.scenes ?? []).map(scene => [scene.id, scene.place]));
  const wide = id => ['city', 'district'].includes(script?.places?.[id]?.scale);
  const evidence = unit => [...((settings[unit]?.setting === 'underground' && (settings[unit].sure ?? 0) >= 0.5) ? settings[unit].lines ?? [] : []), ...(facts[unit] ?? []).filter(fact => (fact.sure ?? 0) >= FACT_SURE).map(fact => fact.sentence)].filter(Boolean);
  const out = [];
  let run = null;
  const close = () => { if (run && run.evidence.length >= minUnits) out.push(run); run = null; };
  scenes.forEach((scene, index) => {
    const place = placeOf.get(scene.id), lines = evidence(scene.id), here = !!place && wide(place) && lines.length > 0;
    if (run && (place !== run.parent || scene.sequence !== run.sequence || index - run.last > maxGap + 1)) close();
    if (!here) return;
    if (!run) run = { parent: place, sequence: scene.sequence, first: index, last: index, units: [], evidence: [], sentences: [] };
    for (const between of scenes.slice(run.last + 1, index)) if (placeOf.get(between.id) === run.parent) run.units.push(between.id);
    run.units.push(scene.id); run.evidence.push(scene.id); run.sentences.push(...lines.filter(id => !run.sentences.includes(id))); run.last = index;
  });
  close();
  return out.map(({ parent, sequence, units, evidence: by, sentences }) => ({ id: `place_${units[0].slice(-6)}_under`, parent, sequence, units, evidence: by, sentences, label: `the underground space (units ${Number(units[0].slice(-6))}–${Number(units.at(-1).slice(-6))})`, scale: 'street' }));
}

/** Each unit's underground facts with their sentences (for the stretches), from the pre-film notes. */
export function factLinesOf(prefilm) {
  const out = {};
  for (const [unit, notes] of Object.entries(prefilm?.units ?? {})) {
    const found = (notes?.scriptSupervisor?.facts ?? notes?.facts ?? []).filter(fact => fact?.kind === 'underground').map(fact => ({ sure: fact.sure ?? 0, sentence: fact.sentence ?? null }));
    if (found.length) out[unit] = found;
  }
  return out;
}
