// The walk's bands (docs/v2/terrain-levels.md §8.1–8.2): the street with what lies just under it (basements, malls, the
// subway), and the halls more than 20 m down (storm water, deep facilities, a street laid 30 m under). All of these are the
// shallow layer, real halls with real depths (the user, 2026-11-05); the deep layer is a virtual space with no depth of its
// own, left by the virtual elevator. The bands are the solver's: each is walked on its own, and a walk whose targets lie in
// the other band goes to a portal in its own (a lift, a shaft, stairs, a ladder; the virtual elevator in the deep layer),
// rides it, and walks on from its other end, so a long street walk never holds a 90 m lift at a flat cost.
// Pure: the director hands in its own portals, legs and positions, so the choice is tested without a world.

/** How a walk goes, in words for "no way there" (L10 says by what means). */
export const meansOf = how => { const kind = String(how ?? 'walk').split(':')[0]; return kind === 'ride' ? 'riding' : kind === 'climb' ? 'climbing' : 'on foot'; };

/** Where each band is, in words for "no way there" (L10 says where). */
export const LAYER_WORDS = { near: 'at street level and just under it', deep: 'more than 20 m down' };

/**
 * A walk between the layers. `portals`: { foot, top, up, down, virtual } (foot in the deep layer, top above it; up and
 * down the ride's cost as metres walked); `walkIn(from, targets, layer)` a leg inside one layer (a path of nodes, or null);
 * `at(node)` [x, y, z]. The portals are tried cheapest first (metres to it as the crow flies, the ride, metres on from it),
 * at most `tries` of them. Returns { path, portal } or { path: null, why }.
 */
export function acrossLayers({ from, targets, mine, portals, walkIn, at, how = 'walk', tries = 4, search = 120 }) {
  const there = mine === 'near' ? 'deep' : 'near', p = at(from), q = at(targets[0]), flat = (u, v) => Math.hypot(u[0] - v[0], u[2] - v[2]);
  if (!portals.length) return { path: null, why: `no way between the street and the halls more than 20 m down: no lift, shaft, stairs or ladder within ${search} m` };
  const ranked = portals.map(portal => {
    const enter = mine === 'near' ? portal.top : portal.foot, leave = mine === 'near' ? portal.foot : portal.top, ride = mine === 'near' ? portal.down : portal.up;
    return { ...portal, enter, leave, ride, score: flat(p, at(enter)) + ride + flat(at(leave), q) };
  }).sort((a, b) => a.score - b.score);
  let why = null;
  for (const portal of ranked.slice(0, tries)) {
    const name = portal.virtual ? 'virtual lift' : 'lift';
    const first = portal.enter === from ? [from] : walkIn(from, [portal.enter], mine);
    if (!first) { why = `no way ${meansOf(how)} ${LAYER_WORDS[mine]} to the ${name} ${Math.round(flat(p, at(portal.enter)))} m off`; continue; }
    const rest = targets.includes(portal.leave) ? [portal.leave] : walkIn(portal.leave, targets, there);
    if (!rest) { why = `no way ${meansOf(how)} ${LAYER_WORDS[there]} from the ${name} to there`; continue; }
    const foot = at(portal.foot);
    return { path: [...first, ...rest], portal: { by: name, down: mine === 'near', at: { x: Math.round(foot[0]), z: Math.round(foot[2]) }, depth: Math.round(-foot[1]) } };
  }
  return { path: null, why };
}
