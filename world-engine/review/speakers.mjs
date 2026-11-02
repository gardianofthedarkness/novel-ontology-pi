// Who says each line, settled by the world (docs/v2/world-ontology.md §6 "Speaker of a line", §7b class S; Track B W6).
// The reading gives each spoken line its speaker when Jev was sure (EM²); below its threshold, no one, and Jev's own
// guess kept as the answer it gave. The world played the line: it knows who was there and where. A line is settled
//
//   by the review     the main agent answered who says it (a pin): always;
//   by the reading    its sure speaker, there when the line was played;
//   by the world      the reading unsure, and Jev's own guess (at least 20%) there (and, speaking to someone there,
//                     within earshot of them); or else, Jev guessing no one absent, exactly one person there the card
//                     says speaks.
//
// What none of these settles is held: a question for the review (who says it, of those there), never a default. A sure
// speaker the world has nowhere is the laws' (L6), held already. Pure: no files, no model calls.

export const EARSHOT = 25;
/** How sure Jev's own guess must be for the world to confirm it. */
export const GUESS = 0.2;
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/**
 * Each spoken line of the cards played (`cards`: playedLine's, with `positions` once the card was played and the reading's
 * card people by id in `people`): `{ line, scene, card, who, to, by, gate: 'applied'|'held', candidates, why }`.
 * `pins.speaker[line]` is the review's answer (an id, or null for none of those there); `pins.notSpeaker[line]` one the
 * review or an audit ruled out. `route: 'review'` (the class's audits too often wrong) holds what the world would settle.
 */
export function settleSpeakers({ cards, reading, pins = {}, peopleOf = () => [], route = null }) {
  const out = [];
  for (const card of cards) {
    const here = card.positions ?? {}, people = peopleOf(card.card);
    const speaking = people.filter(person => person.how.includes('speaks') && here[person.id]).map(person => person.id);
    for (const line of card.lines ?? []) {
      const role = reading.roles?.[line.id];
      if (role?.kind !== 'spoken') continue;
      const sure = role.who?.id ?? null, guess = sure ? null : role.who?.answer ?? null, to = role.to?.id ?? role.to?.answer ?? null;
      const base = { line: line.id, scene: card.scene, card: card.card, to: to && here[to] ? to : null, candidates: Object.keys(here).sort() };
      // An audit or the review said this one does not say it: never settled on them again by rule.
      const ruledOut = pins.notSpeaker?.[line.id] ?? null;
      if (pins.speaker && line.id in pins.speaker) { out.push({ ...base, who: pins.speaker[line.id], by: 'review', gate: 'applied', why: 'the main agent answered' }); continue; }
      if (sure) {
        if (pins.notSpeaker?.[line.id] === sure) { out.push({ ...base, who: null, by: 'review', gate: 'held', why: 'the review said the reading\'s speaker does not say it: who does?' }); continue; }
        out.push(here[sure] ? { ...base, who: sure, by: 'reading', gate: 'applied', why: 'the reading\'s, there when it was said' } : { ...base, who: null, by: 'reading', gate: 'held', why: 'the reading\'s speaker is not there (L6)', law: 'L6' });
        continue;
      }
      // The reading unsure: Jev's own guess, if the world has them there and, speaking to someone there, within earshot.
      if (route === 'review') { out.push({ ...base, who: null, by: 'world', gate: 'held', why: 'the world\'s speakers go to the review while their audits find too many wrong' }); continue; }
      if (guess && guess !== 'none' && guess !== ruledOut && here[guess] && guess !== base.to && (role.who.confidence ?? 0) >= GUESS) {
        const far = base.to && (gap(here[guess], here[base.to]) > EARSHOT || Math.abs(here[guess].y - here[base.to].y) > 3);
        if (!far) { out.push({ ...base, who: guess, by: 'world', gate: 'applied', why: `Jev's guess (${Math.round((role.who.confidence ?? 0) * 100)}%), there${base.to ? ' and within earshot' : ''}` }); continue; }
      }
      const only = speaking.filter(id => id !== base.to && id !== ruledOut);
      // Jev's guess someone not there: perhaps a voice from elsewhere (a phone, a broadcast); the review says.
      if (guess && guess !== 'none' && !here[guess]) { out.push({ ...base, who: null, by: 'world', gate: 'held', why: `Jev's guess (${Math.round((role.who.confidence ?? 0) * 100)}%) is not there: from elsewhere, or someone there?`, guess, candidates: [...base.candidates, guess] }); continue; }
      if (only.length === 1) { out.push({ ...base, who: only[0], by: 'world', gate: 'applied', why: 'the only one there the card says speaks' }); continue; }
      out.push({ ...base, who: null, by: 'world', gate: 'held', why: only.length ? `${only.length} there the card says speak` : 'no one there the card says speaks' });
    }
  }
  return out;
}
