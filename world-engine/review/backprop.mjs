// Back-propagation from a pin (docs/v2/world-ontology.md §5a; Track B W5): when the main agent pins an anchor (two people
// met face to face at a card), the person's positions between their last anchor and the new one are hypotheses, and are
// re-derived: a bridge on the path integral from the last anchor to the new one (the walk drawn with the new anchor's h,
// so it ends there by construction), and each moment of the span (a scene's start) placed on it by its share of the
// span's play. Of the bridge's draws, the one that changes the history least is kept (J: metres moved, a floor counted
// as 3 m; blasts are left as they were, so no destruction energy changes); a revision above a limit is held for the
// review instead of applied. A first cut: the span keeps to their stay round the meeting (a scene elsewhere is the
// script's to say), and only scene starts are re-placed; the cards' moves are played again forward from them.

/** Ranks that are anchors (world-log.mjs RANKS): pinned, stated, met. */
const ANCHOR = new Set(['pinned', 'stated', 'met']);
/** The most a revision may move people in all (metres, J) before it goes to the review instead (§7b class R). */
export const REVISION_LIMIT = 300;
export const FLOOR = 3;
/** How far round the meeting a span reaches (m): their stay there, not the scenes they came from. */
export const LOCAL = 60;

const order = id => Number(String(id).split(':').at(-1));
export const gapOf = (a, b) => Math.hypot(a.x - b.x, a.z - b.z) + FLOOR * Math.round(Math.abs(a.y - b.y) / FLOOR);

/**
 * The spans the pins' anchors re-derive, from the last run's world log: for each meeting pinned (`pins.meet`: who came
 * face to face with whom, on which cards of which scene), the person's last anchor before it in the strand, the target
 * (where the one they met stood at that card, as the log has it), and the moments between (their scene starts at the
 * anchor's place, after the last anchor, up to the anchor's own scene).
 */
export function spansOf({ pins, log }) {
  const out = [];
  // Who came to whom is a choice (§5a: between discrete choices, the least change is kept): each way round is a span,
  // grouped by the meeting, and the director keeps the one whose bridge changes the history least.
  for (const meet of (pins.meet ?? []).flatMap(entry => [entry, { ...entry, who: entry.to, to: entry.who }])) {
    const ofWho = log.filter(row => (row.kind === 'presence' || row.kind === 'position') && row.who === meet.who).sort((a, b) => order(a.id) - order(b.id));
    const ofTo = log.filter(row => (row.kind === 'presence' || row.kind === 'position') && row.who === meet.to).sort((a, b) => order(a.id) - order(b.id));
    const atScene = ofWho.find(row => row.scene === meet.scene && row.kind === 'presence');
    if (!atScene) continue;
    const strand = atScene.strand, place = atScene.place, cards = new Set(meet.cards ?? []);
    // Where the one they met stood when they met: at the card, else their latest record in that scene.
    const inScene = ofTo.filter(row => row.scene === meet.scene), target = (inScene.find(row => cards.has(row.card)) ?? inScene.at(-1))?.at;
    if (!target) continue;
    const before = ofWho.filter(row => row.strand === strand && order(row.id) <= order(atScene.id));
    const lastAnchor = [...before].reverse().find(row => ANCHOR.has(row.rank) && row.id !== atScene.id) ?? null;
    // The span keeps to their stay round the meeting (a scene's place is often only the city): their scene starts back
    // from it, while each is within LOCAL metres of where they stood at its scene's start, and after their last anchor.
    const moments = [];
    for (const row of [...before].reverse()) {
      if (lastAnchor && order(row.id) <= order(lastAnchor.id)) break;
      if (row.kind !== 'presence') continue;
      if (gapOf(row.at, atScene.at) > LOCAL) break;
      moments.unshift(row);
    }
    if (!moments.length) continue;
    const from = lastAnchor && gapOf(lastAnchor.at, atScene.at) <= LOCAL ? lastAnchor : moments[0];
    out.push({ who: meet.who, to: meet.to, scene: meet.scene, item: meet.item ?? null, group: meet.item ?? `${meet.scene}|${[meet.who, meet.to].sort().join('|')}`, strand, place, target, from: from.at, fromRecord: from === lastAnchor ? lastAnchor.id : null, moments: moments.map(row => ({ scene: row.scene, record: row.id, old: row.at })) });
  }
  return out;
}

/**
 * Of a bridge's draws (each a list of points from the last anchor to the new one), the one that changes the history
 * least: each moment k of n placed at the point its share of the span puts it (k / n of the way: the span's play), J the
 * metres between where the draw has them and where the history had them. Returns the points, J and which draw.
 */
export function leastChange(draws, moments) {
  let best = null;
  draws.forEach((points, draw) => {
    if (!points?.length) return;
    const n = moments.length, placed = moments.map((moment, k) => points[Math.min(points.length - 1, Math.round(((k + 1) / (n + 1)) * (points.length - 1)))]);
    const J = moments.reduce((sum, moment, k) => sum + gapOf(placed[k], moment.old), 0);
    if (!best || J < best.J) best = { draw, placed, J };
  });
  return best;
}
