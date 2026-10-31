/**
 * The code rules of the v2 reading, in one folder (the user's call, 2026-10-31), so they can be generalized: rule zero
 * (DESIGN.md §6) is never to ask a model what code can compute exactly, and these are what code computes. A rule never
 * calls a model and never writes; the layers of docs/v2/world-model.md call it.
 * - language.ts: what is particular to a language (locatives, what joins two places, the world's levels, the scale a
 *   place's name says), one profile per language (zh first);
 * - typing.ts: what code says of a typed string (a locative makes it spatial; the type most batches gave it);
 * - presence.ts: who is present in a scene (matter);
 * - places.ts: the tree's graded law, the place recommender's weights, what place EM takes by rule.
 * RULES lists every rule with what it decides and where it lives, those not moved here yet included.
 */
export * from "./language.js";
export * from "./places.js";
export * from "./presence.js";
export * from "./typing.js";

export interface CodeRule {
  name: string;
  decides: string;
  /** The layer of docs/v2/world-model.md §3 it serves. */
  layer: 1 | 2 | 3 | 4;
  /** Whether it reads a language's words (its words are in language.ts when it lives here). */
  language: boolean;
  /** Where it lives: here, or the file it is still in. */
  lives: string;
}
const HERE = "src/v2/rules";
export const RULES: CodeRule[] = [
  { name: "locative", decides: "a place word with a locative after it (街上) is spatial, not a place", layer: 1, language: true, lives: `${HERE}/typing.ts` },
  { name: "usual type", decides: "a description takes the type most batches gave it; a tie is no place", layer: 1, language: false, lives: `${HERE}/typing.ts` },
  { name: "levels", decides: "the level of the world a spatial word points at (地下: underground)", layer: 1, language: true, lives: `${HERE}/language.ts` },
  { name: "scale by name", decides: "the scale the generic part of a place's name says (学区: a district), where typing gave none", layer: 2, language: true, lives: `${HERE}/language.ts (its words: src/digger/stage/scale.ts)` },
  { name: "graded law", decides: "a parent is larger than what it holds (a region a region, a building a building)", layer: 2, language: false, lives: `${HERE}/places.ts` },
  { name: "name inside a name", decides: "a place whose name holds another's holds it (学园都市第七学区 in 学园都市)", layer: 2, language: false, lives: `${HERE}/places.ts` },
  { name: "stated", decides: "a named place right before another (X的Y, X，Y) holds it", layer: 2, language: true, lives: `${HERE}/language.ts (join)` },
  { name: "evidence weights", decides: "how much each kind of evidence for a parent weighs, and far levels count half", layer: 2, language: false, lives: `${HERE}/places.ts` },
  { name: "sure parent", decides: "a parent taken without Jev: the text's own word, a score of 2, twice the second", layer: 4, language: false, lives: `${HERE}/places.ts` },
  { name: "setting", decides: "a scene's setting by tiers (environment, action, named), carried on, deepened; two branches go to Jev", layer: 4, language: false, lives: `${HERE}/places.ts` },
  { name: "holder", decides: "an unnamed place stands in the deepest larger place on its scene's address", layer: 4, language: false, lives: `${HERE}/places.ts` },
  { name: "same words", decides: "an unnamed place of this scene or the one before with the same words is that place", layer: 4, language: false, lives: `${HERE}/places.ts` },
  { name: "deeper by an unnamed place", decides: "a building or room the environment names is where the scene is, more closely", layer: 4, language: false, lives: `${HERE}/places.ts` },
  { name: "habit", decides: "words Jev gave one named place twice, and no other, are that place from then on", layer: 4, language: false, lives: `${HERE}/places.ts` },
  { name: "presence", decides: "who speaks, acts or is spoken to is present; someone only named is not", layer: 4, language: false, lives: `${HERE}/presence.ts` },
  { name: "longest name", decides: "a longer name masks the shorter inside it (御坂妹妹 is not 妹妹)", layer: 1, language: false, lives: "src/v2/em.ts (mentions)" },
  { name: "proper or description", decides: "a name that is no proper name is a description (EM²'s or place EM's), a routine thing, or skipped", layer: 4, language: false, lives: "src/v2/em.ts (resolveBatch)" },
  { name: "matter recommender", decides: "a name's candidates by nearness, frequency and shared names", layer: 2, language: false, lives: "src/v2/em.ts (recommend)" },
  { name: "action rule", decides: "an action where nothing that matters acts is narration", layer: 1, language: false, lives: "src/v2/flow.ts" },
  { name: "time words", decides: "time words, their families and roles, holidays as days, the kinds that cannot move time", layer: 1, language: true, lives: "src/v2/time.ts, src/digger/timeplace" },
  { name: "near", decides: "a building the tree puts nowhere, or an unnamed place nothing holds, is sampled near where its scenes are", layer: 4, language: false, lives: "src/v2/script.ts" },
  { name: "card people", decides: "a card's people ranked: who speaks or acts, then who is spoken to, then who is named", layer: 4, language: false, lives: "src/v2/canon.ts (cardPeople)" },
];
