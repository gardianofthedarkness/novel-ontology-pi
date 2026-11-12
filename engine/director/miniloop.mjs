// The miniloop (docs/v3/design.html#small-loops; the user, 2026-11-12: "the issue we have right now is smoothing and review
// happen at last. It needs to be right at where conflicts happen, so later miniloops won't get affected by a wrong
// judgement earlier"). A run used to play a whole book, then smooth it and send what the laws held to the review; an
// answer took effect only on a second pass, and every unit after a conflict played on from the wrong state.
//
// Here the review and the smoothing run where the conflict is:
// - the step is a card: after each card, what its laws held (L6 talk out of earshot or a speaker not there, L9 an actor
//   not there, L10 no walk there) is asked at once, as the review asks it (review.mjs heldItems, jev-review.mjs: Jev on
//   the item's lines, the work model beside it), and a sure answer is applied to the world before the next card: the
//   person arrives, stays, is placed with the others, talks from elsewhere, or comes within earshot;
// - the step is a unit where a conflict was: when the unit ends, its strand so far is smoothed (smoother.mjs), and whoever
//   the least-action history puts elsewhere at the unit's end goes on from there into the next unit.
// An answer is applied only when it is sure (`ACCEPT`): Jev at least 0.7, or Jev and the work model agreeing. An unsure
// one leaves the item held, playing its lawful default, for the review at the run's end as before: a wrong judgement
// carried forward is what this loop is for avoiding.
import { heldItems, pinsFrom } from '../review/review.mjs';
import { reviewItems, storesOf } from '../review/jev-review.mjs';

/** The laws the miniloop settles at the card, and the review's kinds they make. */
export const LAWS = new Set(['L6', 'L9', 'L10']);
export const KINDS = new Set(['actor', 'speaker', 'talk', 'reach']);
/** How sure an answer must be to change the world at once. */
export const ACCEPT = { jev: process.env.NOVEL_MINILOOP_ACCEPT ? Number(process.env.NOVEL_MINILOOP_ACCEPT) : 0.7 };
// (NOVEL_MINILOOP_ACCEPT: another threshold, for a rehearsal that must take every answer to try each way it applies.)

/** The verdict an answer lets the miniloop apply, with who settled it, or null (left for the review at the end). */
export function accepted(answer, item, policy = ACCEPT) {
  if (!answer || answer.law) return null;
  const jev = answer.jev ?? {}, work = answer.work ?? null, sure = jev.confidence ?? 0;
  const pick = value => (value != null && item.options.includes(String(value)) ? String(value) : null);
  if (pick(jev.value) && sure >= policy.jev) return { verdict: pick(jev.value), by: 'jev', confidence: sure };
  if (pick(jev.value) && work && String(work.value) === String(jev.value)) return { verdict: pick(jev.value), by: 'jev+work', confidence: sure };
  return null;
}

/** A card's held laws as the review's ledger entries (review.mjs heldItems reads them as it reads a run's ledger). */
export function ledgerOf(conflicts, next) {
  return conflicts.map(conflict => ({ id: next(), state: 'held', kind: 'law', law: conflict.law, subject: conflict.who, value: { scene: conflict.scene, card: conflict.card, why: conflict.why, ...(conflict.to ? { to: conflict.to } : {}) } }));
}

/**
 * The miniloop's reviewer: `settle(conflicts, { pins, script })` asks a card's conflicts and returns the sure answers, each
 * `{ item, verdict, by, confidence }`, already pinned into `pins` (under the laws, as the review's answers are); `record`
 * counts what it asked and applied. `decide` is Jev (as the review by Jev asks it), `work` the work model (or null).
 */
export async function createMiniloop({ novelDir, readingPath, reading, decide, work = null, name = id => id, policy = ACCEPT, log = () => {} }) {
  const stores = await storesOf(novelDir, readingPath);
  // The director plays the reading's segments (segments.mjs): their scenes and cards, not the reading file's.
  stores.cards = new Map((reading.cards ?? []).map(card => [card.id, card]));
  stores.scenes = new Map((reading.scenes ?? []).map(scene => [scene.id, scene]));
  const record = { asked: 0, applied: 0, left: 0, turnedBack: 0, byKind: {}, answers: [] };
  let n = 0;
  const next = () => `ml_${String(++n).padStart(5, '0')}`;

  async function settle(conflicts, { pins, script }) {
    const ledger = ledgerOf(conflicts.filter(conflict => LAWS.has(conflict.law)), next);
    for (const entry of ledger) stores.ledger.set(entry.id, entry);
    const items = heldItems({ ledger, name }).filter(item => KINDS.has(item.kind));
    if (!items.length) return [];
    const answers = await reviewItems(items, { ...stores, pins, script, decide, work, workAll: !!work, concurrency: 4 });
    const out = [];
    for (const answer of answers) {
      const item = items.find(entry => entry.id === answer.item);
      if (!item) continue;
      const row = (record.byKind[item.kind] ??= { asked: 0, applied: 0 });
      row.asked++; record.asked++;
      const ok = accepted(answer, item, policy);
      const kept = { scene: item.scene, card: item.card, kind: item.kind, who: item.subjects, verdict: answer.verdict, jev: answer.jev ? { value: answer.jev.value, confidence: answer.jev.confidence ?? null } : null, work: answer.work ? { value: answer.work.value } : null, line: answer.line ?? null, applied: false };
      if (!ok) { record.left++; record.answers.push(kept); continue; }
      // Under the laws, as an answer of the review's becomes a pin (review.mjs pinsFrom: L2 against someone answered present).
      const { failed } = pinsFrom(pins, [{ item, answer: { verdict: ok.verdict, reason: `the miniloop (${ok.by})` } }], { script });
      if (failed.size) { record.turnedBack++; record.left++; record.answers.push({ ...kept, turnedBack: failed.get(item.id) }); continue; }
      row.applied++; record.applied++;
      record.answers.push({ ...kept, verdict: ok.verdict, by: ok.by, applied: true });
      out.push({ item, ...ok });
    }
    if (out.length) log(`miniloop: ${out.map(entry => `${entry.item.kind} ${entry.item.names?.join('/') ?? ''} → ${entry.verdict} (${entry.by})`).join('; ')}`);
    return out;
  }
  return { settle, record };
}

/**
 * Where the smoothing of a unit's strand so far puts each person at the unit's end, for those it moves more than `least`
 * metres and at most `most`: `{ who: { to: {x,y,z}, shift } }`. `smoothed` is smoother.mjs smoothRun's result.
 */
export function endsOf(smoothed, sceneId, { least = 2, most = Infinity } = {}) {
  const out = {};
  for (const [who, list] of Object.entries(smoothed?.people ?? {})) {
    const last = (list ?? []).filter(moment => moment?.scene === sceneId).at(-1);
    if (last && last.shift > least && last.shift <= most && last.map) out[who] = { to: last.map, shift: last.shift };
  }
  return out;
}
