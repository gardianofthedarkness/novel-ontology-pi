// Physics per strand (docs/v3/design.html#strands §4; milestones M17c; the user, 2026-11-09: "The destructions and physics
// engine doesn't interfere another strand. If the time is the same by mentioning the two groups united, the strands
// reunify into one"). The world's damage is a layer per strand over the built world:
//
//   - a layer holds what its strand changed: the lots it broke (their units, standing cells and rubble, copied when
//     first written: copy-on-write by lot), the things it stood, moved or took away, the underground's cave-ins, and
//     the hits it has seen;
//   - a scene is played in its strand's layer (`enter`): what the last layer changed is taken out of the world and this
//     one's put in, and only the lots, things and underground cells that differ are reported (the walk graph's windows
//     over them are rebuilt, no others);
//   - a strand that began as a split (`splitFrom`) starts as a copy of the strands its people left; a strand of people
//     first seen, and the past, start from the world as it was built;
//   - a union (`into` at `intoAt`) merges the closed strand's layer into the one that kept the id: a unit broken in
//     either is broken, rubble of either lies, a thing moved by both is where the later scene left it, a cave-in of
//     either is there; the closed strand's scenes read after that are played in the kept one.
//
// What was written before the first scene is entered is the built world itself, common to every layer.
// Pure: the engine hands in its state (`state`) and how to merge one lot (`mergeLot`); tested without a world.

const copyLot = lot => ({ units: lot.units?.slice(), standing: lot.standing?.slice(), rubble: lot.rubble?.slice() });
/** Two lists of cells differ in what stands (or lies) where; a list not there is all zeros. */
const differs = (a, b) => { if (a === b) return false; const length = Math.max(a?.length ?? 0, b?.length ?? 0); for (let n = 0; n < length; n++) if (!a?.[n] !== !b?.[n]) return true; return false; };
const sameThing = (a, b) => a === b || (!!a && !!b && a.i0 === b.i0 && a.i1 === b.i1 && a.j0 === b.j0 && a.j1 === b.j1 && a.top === b.top);
const later = (a, b) => a[0] > b[0] || (a[0] === b[0] && a[1] > b[1]);

/** One lot of two layers, with nothing known of its structure: a cell stands when it stands in both, rubble lies where either left it. */
export const mergeCells = (first, second) => {
  const both = (a, b, join) => (a && b ? a.map((value, n) => (join(value, b[n]) ? 1 : 0)) : (a ?? b)?.slice());
  return { units: both(first.units, second.units, (a, b) => a && b), standing: both(first.standing, second.standing, (a, b) => a && b), rubble: both(first.rubble, second.rubble, (a, b) => a || b) };
};

const NONE = new Map();
/** The underground's damage (world.underDamage): piles by hall and cell, dents and breaches by cell, the beams' marks. */
export const copyUnder = under => ({ piles: new Map([...under.piles].map(([hall, cells]) => [hall, new Map(cells)])), dents: new Map(under.dents), breaches: new Map(under.breaches), marks: [...under.marks] });
const mergeUnder = (into, from) => {
  for (const [hall, cells] of from.piles) { const mine = into.piles.get(hall) ?? into.piles.set(hall, new Map()).get(hall); for (const [key, height] of cells) mine.set(key, Math.max(mine.get(key) ?? 0, height)); }
  for (const [key, depth] of from.dents) into.dents.set(key, Math.max(into.dents.get(key) ?? 0, depth));
  for (const [key, hall] of from.breaches) if (!into.breaches.has(key)) into.breaches.set(key, hall);
  for (const mark of from.marks) if (!into.marks.includes(mark)) into.marks.push(mark);
};
const underDiff = (a, b) => {
  const cells = new Set(), marks = [];
  if (a === b) return { cells: [], marks };
  const maps = (x, y) => { for (const [key, value] of x) if (y.get(key) !== value) cells.add(key); for (const key of y.keys()) if (!x.has(key)) cells.add(key); };
  maps(a.breaches, b.breaches); maps(a.dents, b.dents);
  for (const hall of new Set([...a.piles.keys(), ...b.piles.keys()])) maps(a.piles.get(hall) ?? NONE, b.piles.get(hall) ?? NONE);
  for (const mark of a.marks) if (!b.marks.includes(mark)) marks.push(mark);
  for (const mark of b.marks) if (!a.marks.includes(mark)) marks.push(mark);
  return { cells: [...cells], marks };
};

/** Strands that carry what the layers need (the group builder's: each strand's `splitFrom`, each scene's strand and story rank). */
export const layered = strands => strands?.forkOf instanceof Map && strands?.layer instanceof Map && Array.isArray(strands?.forks) && strands.forks.every(fork => Array.isArray(fork.splitFrom));

/**
 * The layers of a run.
 *   forks    the strands ({ id, splitFrom, into?, intoAt?, past? })
 *   forkOf   scene id -> strand id;  rankOf  scene id -> its place in story order
 *   state    the engine's world: lot(index) -> { units, standing, rubble } as they are now; setLot(index, lot);
 *            things() -> the live Map of things; under() -> the underground's damage; setUnder(damage)
 *   mergeLot (index, first, second) -> one lot of two layers (the engine settles it; `mergeCells` when not given)
 */
export function strandLayers({ forks, forkOf, rankOf, state, mergeLot = (_index, first, second) => mergeCells(first, second) }) {
  const byId = new Map(forks.map(fork => [fork.id, fork])), layers = new Map(), alias = new Map();
  const base = { lots: new Map(), things: new Map(), under: null };
  const unions = forks.filter(fork => fork.into && fork.intoAt).map(fork => ({ fork, rank: rankOf(fork.intoAt) ?? Infinity, done: false })).sort((a, b) => a.rank - b.rank);
  const hits = [], unseenAt = new Map(), playedIn = new Map(), log = [];
  let active = null, rank = -1, stamp = 0;
  const resolve = id => { let at = id; for (let guard = 0; alias.has(at) && guard < 64; guard++) at = alias.get(at); return at; };
  const fresh = () => ({ lots: new Map(), things: new Map(), under: copyUnder(base.under), hits: new Set() });
  const copyLayer = layer => ({ lots: new Map([...layer.lots].map(([index, lot]) => [index, copyLot(lot)])), things: new Map(layer.things), under: copyUnder(layer.under), hits: new Set(layer.hits) });
  /** `from` into `into`; `from` is not used again (its lots are taken, not copied). */
  const merge = (into, from) => {
    const lots = [];
    for (const [index, lot] of from.lots) { into.lots.set(index, into.lots.has(index) ? mergeLot(index, into.lots.get(index), lot) : lot); lots.push(index); }
    for (const [id, thing] of from.things) { const mine = into.things.get(id); if (!mine || later(thing.stamp, mine.stamp)) into.things.set(id, thing); }
    mergeUnder(into.under, from.under);
    for (const id of from.hits) into.hits.add(id);
    return lots;
  };
  const create = (id, sceneId) => {
    const fork = byId.get(id), parents = fork?.past ? [] : [...new Set((fork?.splitFrom ?? []).map(resolve))].filter(parent => parent !== id && layers.has(parent));
    const layer = parents.length ? copyLayer(layers.get(parents[0])) : fresh();
    for (const parent of parents.slice(1)) merge(layer, copyLayer(layers.get(parent)));
    layers.set(id, layer);
    log.push({ at: sceneId, kind: 'begin', strand: id, from: parents, ...(fork?.past ? { past: true } : {}) });
    return layer;
  };
  const unite = (fork, sceneId) => {
    const from = resolve(fork.id), into = resolve(fork.into);
    if (from === into) return;
    const source = layers.get(from), keeper = layers.get(into);
    alias.set(from, into);
    if (!source) return;
    layers.delete(from);
    if (active === from) active = keeper ? null : into;
    if (!keeper) { layers.set(into, source); log.push({ at: sceneId, kind: 'union', strand: from, into, lots: 0, hits: source.hits.size, moved: true }); return; }
    const seen = [...source.hits].filter(id => !keeper.hits.has(id)).length, lots = merge(keeper, source);
    log.push({ at: sceneId, kind: 'union', strand: from, into, lots: lots.length, hits: seen });
  };

  /**
   * Play this scene in its strand's layer: the unions due by its moment are made, the layer is put in the world. Says
   * what changed in the world for the walk: the lots whose cells or rubble differ, the things that stand elsewhere (or
   * not at all), the underground cells and marks that differ. Null for a scene of no strand (the world stays as it is).
   */
  const enter = sceneId => {
    const strand = forkOf.get(sceneId);
    if (!strand) return null;
    const at = rankOf(sceneId) ?? rank;
    base.under ??= copyUnder(state.under());
    const leaving = active ? layers.get(active) : null, was = active;
    const installed = { lots: [...(leaving?.lots.keys() ?? [])], things: [...(leaving?.things.keys() ?? [])] };
    // The engine writes new lists over the ones it was handed: what the layer leaving owns is what stands in the world now.
    if (leaving) for (const index of installed.lots) leaving.lots.set(index, state.lot(index));
    const due = unions.filter(union => !union.done && union.rank <= at);
    if (!due.length && leaving && resolve(strand) === active) {
      rank = at; playedIn.set(sceneId, active); unseenAt.set(sceneId, hits.filter(id => !leaving.hits.has(id)));
      return { strand, layer: active, created: false, switched: false, merged: [], lots: [], things: [], cells: [], marks: [], unseen: unseenAt.get(sceneId) };
    }
    const before = leaving ? copyUnder(state.under()) : base.under, merged = [];
    for (const union of due) { union.done = true; const size = log.length; unite(union.fork, sceneId); if (log.length > size) merged.push(log.at(-1)); }
    const id = resolve(strand), created = !layers.has(id), target = layers.get(id) ?? create(id, sceneId);
    const lots = [], things = [], world = state.things();
    for (const index of new Set([...installed.lots, ...target.lots.keys()])) {
      const now = state.lot(index), want = target.lots.get(index) ?? base.lots.get(index);
      if (!want || (now.units === want.units && now.standing === want.standing && now.rubble === want.rubble)) continue;
      if (differs(now.standing, want.standing) || differs(now.rubble, want.rubble)) lots.push(index);
      state.setLot(index, want);
    }
    for (const thing of new Set([...installed.things, ...target.things.keys()])) {
      const now = world.get(thing) ?? null, want = target.things.has(thing) ? target.things.get(thing).at : base.things.get(thing) ?? null;
      if (sameThing(now, want)) continue;
      if (want) world.set(thing, want); else world.delete(thing);
      things.push({ id: thing, was: now, now: want });
    }
    const under = underDiff(before, target.under);
    state.setUnder(target.under);
    active = id; rank = at; playedIn.set(sceneId, id);
    unseenAt.set(sceneId, hits.filter(hit => !target.hits.has(hit)));
    if (was !== id || merged.length) log.push({ at: sceneId, kind: 'enter', strand: id, from: was, lots: lots.length, things: things.length, under: under.cells.length + under.marks.length, unseen: unseenAt.get(sceneId).length });
    return { strand, layer: id, created, switched: was !== id, merged, lots, things, cells: under.cells, marks: under.marks, unseen: unseenAt.get(sceneId) };
  };

  // A retake (docs/v3/design.html#reviewer-segment): the layers as they stand before a unit, and back to them. The layer playing
  // first takes what stands in the world now (the engine writes new lists over the ones it was handed), then all is copied.
  const checkpoint = () => {
    const playing = active ? layers.get(active) : null;
    if (playing) for (const index of playing.lots.keys()) playing.lots.set(index, state.lot(index));
    return { layers: new Map([...layers].map(([id, layer]) => [id, copyLayer(layer)])), base: { lots: new Map([...base.lots].map(([index, lot]) => [index, copyLot(lot)])), things: new Map(base.things), under: base.under ? copyUnder(base.under) : null },
      alias: new Map(alias), active, rank, stamp, hits: hits.slice(), unseenAt: new Map(unseenAt), playedIn: new Map(playedIn), log: log.length, unions: unions.map(union => union.done) };
  };
  /** The layers back as `checkpoint` took them (the engine puts the world back itself, from its own checkpoint). */
  const restore = point => {
    layers.clear(); for (const [id, layer] of point.layers) layers.set(id, copyLayer(layer));
    base.lots = new Map([...point.base.lots].map(([index, lot]) => [index, copyLot(lot)])); base.things = new Map(point.base.things); base.under = point.base.under ? copyUnder(point.base.under) : null;
    alias.clear(); for (const [from, to] of point.alias) alias.set(from, to);
    active = point.active; rank = point.rank; stamp = point.stamp;
    hits.length = 0; hits.push(...point.hits);
    unseenAt.clear(); for (const [k, v] of point.unseenAt) unseenAt.set(k, v);
    playedIn.clear(); for (const [k, v] of point.playedIn) playedIn.set(k, v);
    log.length = point.log; unions.forEach((union, n) => { union.done = point.unions[n]; });
    // The layer playing owns the world's lots it holds: put its copies in, so a later write is its own again.
    const playing = active ? layers.get(active) : null;
    if (playing) for (const [index, lot] of playing.lots) state.setLot(index, lot);
  };

  return {
    enter, checkpoint, restore,
    /** Before the engine writes a lot: the layer playing gets its own copy of it (the first time), the built one is kept. */
    touch(index) {
      const layer = active ? layers.get(active) : null;
      if (!layer || layer.lots.has(index)) return;
      const now = state.lot(index);
      if (!base.lots.has(index)) base.lots.set(index, now);
      const own = copyLot(now);
      layer.lots.set(index, own); state.setLot(index, own);
    },
    /** A thing stood (`now` its footprint) or taken away (`now` null) by the scene playing; `was` what stood before. */
    thing(id, was, now) {
      const layer = active ? layers.get(active) : null;
      if (!layer) return;
      if (!base.things.has(id)) base.things.set(id, was ?? null);
      layer.things.set(id, { at: now ?? null, stamp: [rank, ++stamp] });
    },
    /** A hit of the scene playing: seen by its strand, and by another only once they are one. */
    hit(id) { const layer = active ? layers.get(active) : null; if (!layer) return; hits.push(id); layer.hits.add(id); },
    /** The hits made before a scene that its strand had not seen when it was played (other strands' own). */
    unseen: sceneId => unseenAt.get(sceneId) ?? [],
    /** The layer a scene was played in (a closed strand's late scene: the one that kept the id). */
    playedIn: sceneId => playedIn.get(sceneId) ?? null,
    active: () => active,
    layerOf: id => layers.get(resolve(id)) ?? null,
    /** The underground's damage of every layer together (a picture of the whole run: each hole with its own moment). */
    underAll() { const all = copyUnder(state.under()); for (const [id, layer] of layers) if (id !== active) mergeUnder(all, layer.under); return all; },
    /** For the run's record: each layer left, and what began, united and changed hands on the way. */
    report: () => ({ layers: [...layers].map(([id, layer]) => ({ strand: id, lots: layer.lots.size, things: layer.things.size, hits: layer.hits.size, open: !byId.get(id)?.into })), log: log.slice(), hits: hits.length }),
  };
}
