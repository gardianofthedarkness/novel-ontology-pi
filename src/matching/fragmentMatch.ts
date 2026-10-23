import { foldVariants } from "./entityMatch.js";

/**
 * Fragment-at-birth (identification policy, 2026-10-23): a new name
 * candidate that CONTAINS or is CONTAINED IN a known character's
 * name — surname-only （黄泉川 for 黄泉川爱穗）, given-name-only
 * （美琴 for 御坂美琴）, short forms （食蜂） — is the dominant live
 * duplicate class. Fragments partition the text (narration uses one
 * form per scene), so structural matching never sees them; they must
 * be judged at the mint decision, by Jev, over the passage.
 *
 * This module is the code half: exact containment over
 * variant-folded form keys. Code never decides sameness — a
 * contained name can be a different person (a relative sharing the
 * surname, a clone, a namesake), which is why every containment hit
 * still faces the strict Jev round at the birth site.
 */

export interface FragmentTarget {
  /** Registry entity id; undefined for same-scene declarations. */
  id?: string;
  /** Canonical display name (the choice option text). */
  name: string;
  /** All recorded forms; forms[0] is treated as canonical. */
  forms: string[];
}

const cpLen = (s: string): number => [...s].length;

/**
 * The targets a candidate name fragment-matches: the candidate's
 * folded form is a strict substring of any of the target's folded
 * forms, or the target's folded canonical is a strict substring of
 * the candidate's folded form. Exact folded equality with any form
 * is NOT a fragment (the ordinary fold owns it). The shorter side
 * must be at least 2 characters.
 */
export function containmentTargets(
  candidate: string,
  targets: FragmentTarget[],
): FragmentTarget[] {
  const folded = foldVariants(candidate);
  if (cpLen(folded) < 2) return [];
  return targets.filter((t) => {
    const foldedForms = t.forms.map((f) => foldVariants(f));
    if (foldedForms.some((f) => f === folded)) return false;
    const contained = foldedForms.some((f) => cpLen(f) > cpLen(folded) && f.includes(folded));
    const canonical = foldVariants(t.name);
    const contains = cpLen(canonical) >= 2 && cpLen(folded) > cpLen(canonical) && folded.includes(canonical);
    return contained || contains;
  });
}
