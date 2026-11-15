// The items on the page (the user, 2026-11-15: "too many small items are placed and they dont carry with who ever uses
// them ... many things stack together"; "We actually don't need most of the items at all"; the strict rule chosen).
//
// An item the story acts on twice (used, thrown, broken, given, picked up, put down), or that is in two scenes or more, is
// kept; any other is left off the page (its events stay in the run's record). A kept item is either held, carried with its
// holder every frame (the page's `holds`: who, from which event of a scene to which, or to the scene's end), or loose,
// standing where it was put down or thrown (or where it appeared with nobody holding it) until it is taken again or its
// scene ends (the page's `placed`, each spot with `to`). Nothing is left lying from one scene into the next.
//
// Pure: the run's items with their events (the director's things, or run.json `items`), the page's things (their placed
// spots, written by the director as it played) and the page's scenes in played order.

const ACTED = new Set(['used', 'thrown', 'broken', 'given', 'picked-up', 'put-down']);
const TAKES = new Set(['appears', 'held', 'picked-up', 'used']);

/** Whether the page keeps an item: acted on twice, or in two scenes or more. */
export function keepItem(item) {
  const events = item?.events ?? [];
  return events.filter(event => ACTED.has(event.event)).length >= 2 || new Set(events.map(event => event.scene)).size >= 2;
}

/**
 * An item's time on the page: its holds and its loose spots, from its events in played order. `scenes` are the page's
 * scenes ({id, events: [{id}]}); `placed` are the director's spots for it ({scene, event, x, y, z, place, fit}).
 */
export function itemTimeline(item, scenes, placed = []) {
  const order = new Map(scenes.map((scene, n) => [scene.id, n]));
  const indexOf = new Map(scenes.map(scene => [scene.id, new Map((scene.events ?? []).map((event, n) => [event.id, n]))]));
  // A scene-start event (the digest's, no card) comes before the scene's first card.
  const at = event => (event.card == null ? 0 : indexOf.get(event.scene)?.get(event.card) ?? null);
  const events = (item.events ?? []).map((event, n) => ({ ...event, index: at(event), n })).filter(event => order.has(event.scene) && event.index != null)
    .sort((a, b) => order.get(a.scene) - order.get(b.scene) || a.index - b.index || (a.card == null) - (b.card == null) || a.n - b.n);
  const holds = [], loose = [];
  let hold = null, spot = null, scene = null, broken = null;
  const close = to => { if (hold) { hold.to = to; holds.push(hold); hold = null; } if (spot) { spot.to = to; loose.push(spot); spot = null; } };
  const spotAt = (sceneId, index) => {
    const here = placed.filter(entry => entry.scene === sceneId);
    return here.find(entry => entry.event === index) ?? here.filter(entry => entry.event >= index).sort((a, b) => a.event - b.event)[0] ?? null;
  };
  const lay = (sceneId, index) => { const found = spotAt(sceneId, index); if (found) spot = { scene: sceneId, from: index, to: null, place: found.place, x: found.x, y: found.y, z: found.z, ...(found.fit ? { fit: found.fit } : {}) }; };
  for (const event of events) {
    // A new scene: what was held or lying in the last one ends with it.
    if (event.scene !== scene) { close(null); scene = event.scene; }
    if (TAKES.has(event.event)) {
      if (event.who) { if (hold?.who !== event.who) { close(event.index); hold = { who: event.who, scene, from: event.index, to: null }; } }
      else if (!hold && !spot) lay(scene, event.index);
    } else if (event.event === 'given') {
      if (event.to) { close(event.index); hold = { who: event.to, scene, from: event.index, to: null }; }
    } else if (event.event === 'put-down' || event.event === 'thrown') {
      close(event.index); lay(scene, event.index);
    } else if (event.event === 'broken') broken ??= { scene, event: event.index };
  }
  close(null);
  return { holds, loose, ...(broken ? { broken } : {}) };
}

/**
 * Kept items drawn as their models (the routine shelf's or the universe's, src/world/models/shelf.ts): `models` maps an
 * item's name to { id, mesh } (mesh: the player's {p, t, c, size}). The item takes `scad:<id>` and the model's own size, its
 * loose spots fitted to it; the meshes come back for the page's scadModels. Items with no model keep their shape.
 */
export function bindItemModels(things, models) {
  const scadModels = {};
  // An item the sort found is not an object (blood, a sum of money: { hide: true }) is left off the page.
  const out = (things ?? []).filter(thing => !(thing.holds && models.get(thing.name)?.hide)).map(thing => {
    const bound = thing.holds ? models.get(thing.name) : null;
    if (!bound?.mesh?.size) return thing;
    const [w, h, d] = bound.mesh.size, fit = { sx: w, sy: h, sz: d, turn: 0, stand: false, w, h, d };
    scadModels[bound.id] = bound.mesh;
    return { ...thing, model: `scad:${bound.id}`, shape: 'box', size: w, height: h, depth: d, placed: thing.placed.map(spot => ({ ...spot, fit })) };
  });
  return { things: out, scadModels };
}

/**
 * The page's things with the run's items handled: things that are not the run's items (a story object, a building) as
 * they were; an item kept with its holds and its loose spots; an item not kept left off. `counts` for the record.
 */
export function itemsOnPage(things, items, scenes) {
  const byId = new Map((items ?? []).map(item => [item.id, item]));
  const out = [], counts = { items: 0, kept: 0, holds: 0, loose: 0 };
  for (const thing of things ?? []) {
    const item = byId.get(thing.id);
    if (!item) { out.push(thing); continue; }
    counts.items++;
    if (!keepItem(item)) continue;
    const { holds, loose, broken } = itemTimeline(item, scenes, thing.placed ?? []);
    if (!holds.length && !loose.length) continue;
    counts.kept++; counts.holds += holds.length; counts.loose += loose.length;
    out.push({ ...thing, placed: loose, holds, ...(broken ? { broken } : {}) });
  }
  return { things: out, counts };
}
