// Identity from the world (docs/v2/world-ontology.md §6 "EM merge or split", §7b class I; Track B W6): two identities never
// present together, in the same strand, with the same people round them, may be one person. The reading names people
// it knows (char_…) and keeps each scene's unnamed ones as slots of that scene (slot_<scene>_<n>: "the little girl"),
// so the same person met twice is two slots, or a slot and a name. The world log knows who was where; these are its
// proposals, each a question for the review (same or different), never merged by default. Pure.

const PEOPLE = new Set(['person', 'people', undefined, null]);

/**
 * Proposals from a run's world log (`log`: presence records), the reading's slots and the strands: each `{ a, b, why,
 * score }`, the best first, at most `limit`. Two slots of one label in different scenes of a strand, never together; a
 * slot and a named person never together, the person in a scene next to the slot's in the strand, sharing companions.
 */
export function identityProposals({ log, slots = [], strands, limit = 12 }) {
  const scenesOf = new Map(), withOf = new Map(), order = new Map((strands?.scenes ?? []).map((scene, n) => [scene.id, { fork: scene.fork, n }]));
  const present = new Map();
  for (const row of log.filter(entry => entry.kind === 'presence')) (present.get(row.scene) ?? present.set(row.scene, new Set()).get(row.scene)).add(row.who);
  for (const [scene, people] of present) for (const who of people) { (scenesOf.get(who) ?? scenesOf.set(who, new Set()).get(who)).add(scene); const other = withOf.get(who) ?? withOf.set(who, new Set()).get(who); for (const them of people) if (them !== who) other.add(them); }
  const slotOf = new Map(slots.map(slot => [slot.id, slot]));
  const together = (a, b) => [...(scenesOf.get(a) ?? [])].some(scene => scenesOf.get(b)?.has(scene));
  const shared = (a, b) => [...(withOf.get(a) ?? [])].filter(who => who !== b && withOf.get(b)?.has(who));
  const forks = who => new Set([...(scenesOf.get(who) ?? [])].map(scene => order.get(scene)?.fork).filter(Boolean));
  const next = (a, b) => [...(scenesOf.get(a) ?? [])].some(sa => [...(scenesOf.get(b) ?? [])].some(sb => order.get(sa)?.fork === order.get(sb)?.fork && Math.abs((order.get(sa)?.n ?? -9) - (order.get(sb)?.n ?? 9)) === 1));
  const out = [];
  const people = [...scenesOf.keys()].filter(who => who.startsWith('char_') || (slotOf.has(who) && PEOPLE.has(slotOf.get(who).kind)));
  const slotsHere = people.filter(who => slotOf.has(who)), named = people.filter(who => who.startsWith('char_'));
  // One label's slots in strand order, each asked about the next one of that label in its strand only (a word as common
  // as "girl" would otherwise pair with every girl of the book).
  const firstAt = who => Math.min(...[...(scenesOf.get(who) ?? [])].map(scene => order.get(scene)?.n ?? Infinity));
  const pairs = [];
  for (const label of new Set(slotsHere.map(who => slotOf.get(who).label))) for (const fork of new Set(slotsHere.flatMap(who => [...forks(who)]))) {
    const line = slotsHere.filter(who => slotOf.get(who).label === label && forks(who).has(fork)).sort((x, y) => firstAt(x) - firstAt(y));
    for (let k = 0; k + 1 < line.length; k++) pairs.push([line[k], line[k + 1]]);
  }
  for (const [a, b] of pairs) {
    const la = slotOf.get(a).label;
    if (together(a, b) || out.some(entry => entry.a === a && entry.b === b)) continue;
    const common = shared(a, b);
    out.push({ a, b, why: `"${la}" in ${[...scenesOf.get(a)].join(', ')} and in ${[...scenesOf.get(b)].join(', ')}, never together${common.length ? `, both with ${common.join(', ')}` : ''}`, score: 2 + common.length });
  }
  // A description and a named person: each description's two likeliest only.
  for (const a of slotsHere) for (const [b, common] of named.filter(b => !together(a, b) && next(a, b)).map(b => [b, shared(a, b)]).filter(([, common]) => common.length >= 2).sort((x, y) => y[1].length - x[1].length).slice(0, 2)) {
    out.push({ a, b, why: `"${slotOf.get(a).label}" (${[...scenesOf.get(a)].join(', ')}) is never with ${b}, who is in a scene beside it in the strand, and both are with ${common.join(', ')}`, score: common.length });
  }
  return out.sort((x, y) => y.score - x.score || x.a.localeCompare(y.a)).slice(0, limit);
}
