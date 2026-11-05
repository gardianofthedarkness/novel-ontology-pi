// State facts as regions on the walk graph (the user, 2026-11-03: one observation carries several state updates, some
// stated, some only implied; a roof over someone puts them indoors). A fact from the digest (digest.mjs) is a test on a
// node: does standing here agree with it? The director moves someone whose spot disagrees with what the text says or
// implies to the nearest spot that agrees (an implied move), and records each fact with whether the spot held it.

const FLOOR = 3;
/** The walk graph's node types (world.ts `what`). */
export const TYPE = { outdoor: 1, circulation: 2, room: 3, roof: 4, underground: 5 };

/** A fact strong enough to move someone: stated and fairly sure, or implied and sure (an implied feature, a window or a door
 * guessed, very sure: W10's implied features failed 71%). */
// A fact the text states, or the book's picture shows (the stills cast), binds at even odds; one implied, higher.
export const binding = fact => (fact.basis === 'stated' || fact.basis === 'picture' ? fact.sure >= 0.5 : fact.sure >= (fact.kind === 'feature' ? 0.85 : 0.65));

/**
 * Whether a node agrees with a fact: true, false, or null when it cannot be judged. `node`: { x, y, z, type, edge (metres to
 * its building's outer wall, or to the nearest building outdoors), door (metres to an entrance), street, stairs };
 * `positionOf(id)` where someone else stands ([x, y, z]) or null.
 */
export function holds(fact, node, positionOf = () => null) {
  const k = Math.round(node.y / FLOOR);
  switch (fact.kind) {
    // Indoors is a building's rooms and corridors; underground only when a fact says underground (M4: "indoors" moved
    // someone 72 m into a basement in W9's scene 19).
    case 'indoors': return [TYPE.circulation, TYPE.room].includes(node.type);
    case 'outdoors': return node.type === TYPE.outdoor || node.type === TYPE.roof;
    case 'roof': return node.type === TYPE.roof;
    case 'underground': return node.type === TYPE.underground || node.y < -1;
    case 'floor': return fact.value === 'ground' ? k === 0 && node.type !== TYPE.roof : fact.value === 'upper' ? k >= 1 : typeof fact.value === 'number' ? k === Math.max(0, fact.value - 1) && node.type !== TYPE.roof : null;
    case 'vehicle': return node.type === TYPE.outdoor && !!node.street;
    case 'near': case 'apart': {
      const other = positionOf(fact.value);
      if (!other) return null;
      const metres = Math.hypot(other[0] - node.x, other[2] - node.z), floors = Math.abs(other[1] - node.y) / FLOOR;
      return fact.kind === 'near' ? metres <= 4 && floors < 0.5 : metres >= 8 || floors >= 0.5;
    }
    case 'feature':
      // A window from inside (by an outer wall) or from outside (a shop window: a building beside them).
      if (fact.value === 'window') return node.edge <= 2.5 && node.type !== TYPE.roof && node.type !== TYPE.underground;
      if (fact.value === 'door') return node.door <= 3;
      if (fact.value === 'street') return node.type === TYPE.outdoor && !!node.street;
      if (fact.value === 'stairs') return !!node.stairs;
      if (fact.value === 'wall') return node.edge <= 2;
      if (fact.value === 'edge') return node.type === TYPE.roof && node.edge <= 2;
      return null;
    default: return null;
  }
}

/** How well a node fits facts: the sum of each judged fact's sureness, plus for one that fails, minus. */
export function fit(facts, node, positionOf) {
  let score = 0, judged = 0;
  for (const fact of facts) { const ok = holds(fact, node, positionOf); if (ok === null) continue; judged++; score += ok ? fact.sure : -fact.sure; }
  return { score, judged };
}

/**
 * The best node for someone whose spot fails binding facts: among `nodes` (described), the one that fits best, nearest
 * first among equals (a metre costs 0.01). Only one fitting strictly better than `here` is returned.
 */
export function bestFor(facts, here, nodes, positionOf) {
  const now = fit(facts, here, positionOf).score;
  let best = null;
  for (const node of nodes) {
    const score = fit(facts, node, positionOf).score - Math.hypot(node.x - here.x, node.y - here.y, node.z - here.z) * 0.01;
    if (score > now + 0.05 && (!best || score > best.score)) best = { node, score };
  }
  return best?.node ?? null;
}

/** A fact in words, for the record and the Why panel. */
export function factWords(fact, name = id => id) {
  const value = fact.kind === 'near' || fact.kind === 'apart' ? name(fact.value) : fact.value;
  return `${fact.kind}${value !== null && value !== undefined ? ` ${value}` : ''} (${fact.basis}, ${Math.round(fact.sure * 100)}%)`;
}
