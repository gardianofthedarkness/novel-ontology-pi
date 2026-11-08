// Dialogue as events (docs/world-first-design.md §8). A dialogue node is a dialogue exchange: a span of one scene, on the
// scene's timeline between the events around it. Its kind and its parties are Jev's, in the scene's composed context; the
// rest is the world's:
// - live: two people face to face. Both are in the scene: a party the world does not have there is added, unless that
//   would put them in two places at once (then it is a conflict). Who came to whom is the geometry's (§8.3).
// - group: three or more face to face: everyone in the scene, held in one top-down box (the geometry's).
// - remote: a phone, video, message, letter or telepathy: one party here, the other not. A remote party the world has in
//   the scene is a conflict.
// - public: one voice to everyone around: the speaker, and everyone in the scene as listeners; marked public.

export const KINDS = {
  live: 'two people talking face to face',
  group: 'three or more people talking together face to face',
  remote: 'over a phone, video, message, letter or telepathy: the two are apart',
  public: 'one voice to everyone around (a shout, an announcement, a loudspeaker)',
};
export const UNNAMED = 'someone the text does not name';

/**
 * A node settled: `kind` and `parties` (ids or null for unnamed) from Jev; `local` (remote: the party here) from Jev's
 * second call; `inScene` everyone the world has in the scene (present and stayed); `elsewhere(id)` whether the world has
 * that person somewhere else at this time. Returns who joins the scene, the listeners, and what conflicts.
 */
export function settle({ kind, parties, local = null, inScene, elsewhere }) {
  const named = parties.filter(Boolean), node = { kind, parties: named, listeners: [], local: null, remote: null, public: kind === 'public', joins: [], conflicts: [], geometry: null };
  const bring = id => {
    if (inScene.includes(id) || node.joins.includes(id)) return true;
    if (elsewhere(id)) { node.conflicts.push(`${id} is elsewhere at this time`); return false; }
    node.joins.push(id);
    return true;
  };
  if (kind === 'live') { named.forEach(bring); node.geometry = named.length === 2 ? 'meeting' : null; }
  if (kind === 'group') { named.forEach(bring); node.listeners = [...new Set([...inScene, ...node.joins])].filter(id => !named.includes(id)); node.geometry = 'box'; }
  if (kind === 'public') { if (named[0]) bring(named[0]); node.listeners = inScene.filter(id => id !== named[0]); }
  if (kind === 'remote') {
    node.local = local && named.includes(local) ? local : named.find(id => inScene.includes(id)) ?? named[0] ?? null;
    node.remote = named.find(id => id !== node.local) ?? null;
    if (node.local) bring(node.local);
    if (node.remote && inScene.includes(node.remote)) node.conflicts.push(`${node.remote}, on the other end, is in the scene`);
  }
  return node;
}
