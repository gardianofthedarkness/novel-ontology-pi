// Affect v2 (docs/v3/design.html §10.1): arousal and valence computed, not rated. The work model reads only what the text
// shows for a holder at a moment (a beat): what is at stake, on a tenfold ladder, what they expected for it and what came
// (with how likely it now is). This file turns those into tags, per holder in story order:
//
//   value      v(L) = sign(L) (10^|L| - 1), times the probability for what came: the ladder is logarithmic by design.
//   surprise   PE = actual - expected (a prediction error).
//   context    B, the holder's adaptation level: a running average of the magnitudes they have met (Helson), never below 1.
//              The same blow is less to someone who lives among blows (habituation).
//   arousal    A = ln(1 + |PE| / B) / ln(1 + V6): logarithmic in the surprise relative to context (Fechner's
//              S = k log((I + c) / c), c the internal state), 0..1.
//   valence    satisfaction or scare by comparison: a decaying sum of recent signed surprises, current included
//              (Rutledge et al. 2014: momentary happiness from expectations and prediction errors, not from rewards).
//   relevance  the stakes alone (L / 6): high stakes fully expected matter but do not stir.
// Nothing here is about any one book; the constants are general and are not fitted to a book.

export const LADDER = 6;
export const AFFECT_DEFAULTS = { adapt: 0.2, moodDecay: 0.6, moodGain: 1.5 };
const value = (level) => Math.sign(level) * (10 ** Math.abs(level) - 1);
const V6 = value(LADDER);

/** A beat as read: { holder, order (story order, then beat index as a fraction), stakes 0..6, expected -6..6, actual -6..6, probability 0..1 }. */
export function affectOf(beats, options = {}) {
  const { adapt, moodDecay, moodGain } = { ...AFFECT_DEFAULTS, ...options };
  const clampLevel = (x) => Math.max(-LADDER, Math.min(LADDER, Math.round(Number(x) || 0)));
  const state = new Map(); // holder -> { context, mood }
  const out = new Map();
  for (const beat of [...beats].sort((a, b) => a.order - b.order)) {
    const s = state.get(beat.holder) ?? { context: 1, mood: 0 };
    const probability = Math.max(0, Math.min(1, beat.probability ?? 1));
    const expected = value(clampLevel(beat.expected)), actual = value(clampLevel(beat.actual)) * probability;
    const pe = actual - expected;
    const signed = Math.sign(pe) * Math.log1p(Math.abs(pe) / s.context) / Math.log1p(V6);
    const mood = moodDecay * s.mood + signed;
    out.set(beat, {
      arousal: Math.abs(signed),
      valence: Math.tanh(moodGain * mood),
      relevance: Math.max(0, Math.min(LADDER, Math.round(Number(beat.stakes) || 0))) / LADDER,
      surprise: signed,
      context: s.context,
    });
    // The context adapts to what came (its magnitude), after this beat is felt.
    state.set(beat.holder, { context: Math.max(1, (1 - adapt) * s.context + adapt * Math.abs(actual)), mood });
  }
  return out;
}
