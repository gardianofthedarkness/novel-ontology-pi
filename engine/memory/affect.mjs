// Affect v2 (docs/v3/design.html §10.1): arousal and valence computed, not rated. The work model reads only what the text
// shows for a holder at a moment (a beat): what is at stake, on a tenfold ladder, and what came or looms (with how likely
// it now is). This file turns those into tags, per holder in story order:
//
//   value      v(L) = sign(L) (10^|L| - 1), times the probability: the ladder is logarithmic by design.
//   expected   carried, not read: the holder's previous beat's outcome (in the same scene; across scenes, a part of it).
//              Reading "what they expected" from the text was unstable (two runs of volume 1's scenes 1-30 disagreed,
//              r -0.09); carried, the same readings agreed (r 0.69). Expectation learned from history, as in Rutledge et al.
//   surprise   PE = actual - expected (a prediction error).
//   context    B, the holder's adaptation level: a running geometric mean of the magnitudes they have met (Helson), never
//              below 1. The same blow is less to someone who lives among blows (habituation).
//   arousal    A = ln(1 + |PE| / B) / ln(1 + V6): logarithmic in the surprise relative to context (Fechner's
//              S = k log((I + c) / c), c the internal state), 0..1.
//   valence    satisfaction or scare by comparison: a decaying sum of recent signed surprises, current included
//              (Rutledge et al. 2014: momentary happiness from expectations and prediction errors, not from rewards).
//   relevance  the stakes alone (L / 6): high stakes fully expected matter but do not stir.
// Nothing here is about any one book; the constants are general and are not fitted to a book.

export const LADDER = 6;
export const AFFECT_DEFAULTS = { adapt: 0.2, moodDecay: 0.6, moodGain: 1.5, carryAcross: 0.5 };
const value = (level) => Math.sign(level) * (10 ** Math.abs(level) - 1);
const V6 = value(LADDER);

/**
 * Beats as read: { holder, scene, order (story order, then position in the scene), stakes 0..6, actual -6..6, probability 0..1 }.
 * A beat's own `expected` (an older reading) is ignored: expectation is carried from the holder's previous beat.
 */
export function affectOf(beats, options = {}) {
  const { adapt, moodDecay, moodGain, carryAcross } = { ...AFFECT_DEFAULTS, ...options };
  const clampLevel = (x) => Math.max(-LADDER, Math.min(LADDER, Math.round(Number(x) || 0)));
  const state = new Map(); // holder -> { context, mood, outcome, scene }
  const out = new Map();
  for (const beat of [...beats].sort((a, b) => a.order - b.order)) {
    const s = state.get(beat.holder) ?? { context: 1, mood: 0, outcome: 0, scene: null };
    const probability = Math.max(0, Math.min(1, beat.probability ?? 1));
    const actual = value(clampLevel(beat.actual)) * probability;
    const expected = s.scene === null ? 0 : s.scene === beat.scene ? s.outcome : s.outcome * carryAcross;
    const pe = actual - expected;
    const signed = Math.sign(pe) * Math.log1p(Math.abs(pe) / s.context) / Math.log1p(V6);
    const mood = moodDecay * s.mood + signed;
    out.set(beat, {
      arousal: Math.abs(signed),
      valence: Math.tanh(moodGain * mood),
      relevance: Math.max(0, Math.min(LADDER, Math.round(Number(beat.stakes) || 0))) / LADDER,
      surprise: signed,
      expected,
      context: s.context,
    });
    // The context adapts to what came, after this beat is felt: a running mean of logarithms (Helson's adaptation level is
    // a weighted geometric mean), so one extreme beat moves it by a step on the ladder, not to the extreme.
    const logContext = (1 - adapt) * Math.log(s.context) + adapt * Math.log1p(Math.abs(actual));
    state.set(beat.holder, { context: Math.max(1, Math.exp(logContext)), mood, outcome: actual, scene: beat.scene });
  }
  return out;
}
