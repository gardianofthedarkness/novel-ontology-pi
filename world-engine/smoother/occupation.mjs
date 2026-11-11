// Who is on the stage (docs/v3/design.html#world-ontology §5a; Track B W5b, the research handoff's injection, annihilation and
// detector efficiency): per person, a hidden on-or-off state at each scene of their strand, a two-state hidden Markov
// chain smoothed forward and backward. Its readings:
//
//   the script has them present       a detection that can miss (η) and seldom lies
//   they act or speak on a card        strong: someone acting is most likely there (or acting from afar)
//   they are spoken to                 fair
//   they are only named                weak: a mention is not a presence
//   the review answered                present, or remote / not present: near certain
//
// A missed detection is not absence: someone who acts but whom the script left out is likely there, and the chain says how
// likely. Staying on from one scene to the next of a strand is its transition. Pure.

import { setting } from '../../dist/src/v2/settings.js';
export const { eta: ETA, falseAlarm: FALSE_ALARM, stay: STAY, enter: ENTER, first: FIRST } = setting('occupation.hmm');
const LR = setting('occupation.likelihood');

/**
 * P(on the stage) for each person at each scene of each strand they are read in: `{ [who]: { [scene]: p } }`, and the
 * proposals where it disagrees with the script (`present` above `high` though the script leaves them out, `absent` below
 * `low` though it has them).
 */
export function occupation({ reading, script, strands, pins = {}, high = 0.9, low = 0.1 }) {
  const sceneOf = new Map(reading.scenes.flatMap(scene => scene.sentences.map(id => [id, scene.id])));
  const scriptOf = new Map(script.scenes.map(scene => [scene.id, new Set(scene.present ?? [])]));
  const seen = new Map();
  const note = (scene, who, how) => { const key = `${scene}|${who}`; const ways = seen.get(key) ?? seen.set(key, new Set()).get(key); ways.add(how); };
  for (const card of reading.cards ?? []) { const scene = sceneOf.get(card.first); if (scene) for (const person of card.people ?? []) for (const how of person.how) note(scene, person.id, how); }
  const forks = new Map();
  for (const scene of strands?.scenes ?? []) (forks.get(scene.fork) ?? forks.set(scene.fork, []).get(scene.fork)).push(scene.id);
  const out = {}, proposals = [];
  for (const scenes of forks.values()) {
    const people = new Set(scenes.flatMap(scene => [...(scriptOf.get(scene) ?? []), ...[...seen.keys()].filter(key => key.startsWith(`${scene}|`)).map(key => key.slice(scene.length + 1))]));
    for (const who of people) {
      // The likelihood ratio on:off of each scene's readings.
      const ratio = scenes.map(scene => {
        const pinned = pins.present?.[`${scene}|${who}`], remote = pins.remote?.[`${scene}|${who}`];
        if (pinned === true) return 1000;
        if (pinned === false || remote) return 0.001;
        const inScript = scriptOf.get(scene)?.has(who) ?? false, ways = seen.get(`${scene}|${who}`) ?? new Set();
        const script = inScript ? ETA / FALSE_ALARM : (1 - ETA) / (1 - FALSE_ALARM);
        return script * [...ways].reduce((product, how) => product * (LR[how] ?? 1), 1);
      });
      // Forward and backward over the two states, normalised each step.
      const forward = [], backward = new Array(scenes.length);
      let on = FIRST;
      ratio.forEach((r, k) => { if (k) on = on * STAY + (1 - on) * ENTER; const a = on * r, b = 1 - on; on = a / (a + b); forward.push(on); });
      let next = [1, 1];
      for (let k = scenes.length - 1; k >= 0; k--) {
        backward[k] = next;
        const r = ratio[k], onNext = next[0] * r, offNext = next[1];
        const fromOn = STAY * onNext + (1 - STAY) * offNext, fromOff = ENTER * onNext + (1 - ENTER) * offNext, sum = fromOn + fromOff;
        next = [fromOn / sum, fromOff / sum];
      }
      scenes.forEach((scene, k) => {
        const a = forward[k] * backward[k][0], b = (1 - forward[k]) * backward[k][1], p = a / (a + b);
        (out[who] ??= {})[scene] = Math.round(p * 1000) / 1000;
        const inScript = scriptOf.get(scene)?.has(who) ?? false;
        if (!inScript && p >= high && pins.present?.[`${scene}|${who}`] === undefined) proposals.push({ scene, who, p, propose: 'present', ways: [...(seen.get(`${scene}|${who}`) ?? [])] });
        if (inScript && p <= low && pins.present?.[`${scene}|${who}`] === undefined) proposals.push({ scene, who, p, propose: 'absent', ways: [...(seen.get(`${scene}|${who}`) ?? [])] });
      });
    }
  }
  return { on: out, proposals };
}
