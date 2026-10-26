/**
 * Causality Jev checklist — one batched `decide` call per pass, EM-style.
 *
 * Each nominated pair gets TWO noul questions in one packet:
 * - causal: does the text support that A directly brings about B (a direct
 *   cause), rather than mere succession, shared topic, or coincidence?
 * - succession: is the connection mere temporal succession, shared topic, or
 *   coincidence — with no direct causal bringing-about?
 *
 * The succession question is the safety valve: a pair Jev scores high on
 * both is contradictory, and contradictions resolve to "uncertain" (held for
 * the reviewer), never to a proposed link. A bad CAUSES link is permanent
 * canon; a miss is cheap — the sweep re-nominates it next chapter.
 *
 * Threshold (ratified): confident at causal >= 0.85 with succession <= 0.5.
 * Uncertain: causal >= 0.6 without confidence, or a contradiction. Below
 * that: rejected. Only confident pairs become proposals.
 */

import type { DecisionModel } from "../../ground/connectors/jev.js";
import type { CausalCandidate } from "./candidates.js";
import { unitDossier, type CausalityUniverse } from "./units.js";

/** Ratified Jev threshold for a systematic CAUSES proposal. */
export const CAUSALITY_THRESHOLD = 0.85;
/** Succession score above which a confident causal score is treated as contradictory. */
export const SUCCESSION_VETO = 0.5;
/** Floor below which a pair is rejected outright rather than held. */
export const CAUSALITY_UNCERTAIN_FLOOR = 0.6;

export interface CausalVerdict extends CausalCandidate {
  causalScore: number;
  successionScore: number;
  verdict: "confident" | "uncertain" | "rejected";
}

export async function checkCausalLinks(
  decisions: DecisionModel,
  candidates: CausalCandidate[],
  universe: CausalityUniverse,
): Promise<CausalVerdict[]> {
  if (candidates.length === 0) return [];
  const dossier = candidates
    .map((candidate, index) => {
      const from = universe.byId.get(candidate.fromId);
      const to = universe.byId.get(candidate.toId);
      const orderNote = candidate.orderAmbiguous
        ? "Order on the novel sequence is ambiguous for this pair; judge direction from the text."
        : "Novel-sequence order: the first unit precedes the second.";
      return (
        `Pair ${index} (${candidate.fromId} -> ${candidate.toId}) [legs: ${candidate.legs.join(", ")}]\n` +
        `${orderNote}\n` +
        `A: ${from ? unitDossier(from) : candidate.fromId}\n` +
        `B: ${to ? unitDossier(to) : candidate.toId}`
      );
    })
    .join("\n\n");
  const questions = candidates.flatMap((_, index) => [
    {
      key: `causal:${index}`,
      primitive: "noul" as const,
      instructions: `Pair ${index}: does the text support that A directly brings about B — A is a direct cause of B — rather than A merely preceding B, sharing a topic with B, or coinciding with B?`,
      criteria: "Direct textual support required. Succession, correlation, or shared topic alone is NOT causation.",
    },
    {
      key: `succession:${index}`,
      primitive: "noul" as const,
      instructions: `Pair ${index}: is the connection between A and B mere temporal succession, shared topic, or coincidence — with no direct causal bringing-about?`,
      criteria: "Answer yes when the pair is only succession, topic overlap, or coincidence.",
    },
  ]);
  const timelineRule = universe.units.some(unit => unit.origin)
    ? "Cross-file story time is UNKNOWN unless the original passages establish direction. Reading order, filenames, chapter indices and publication order do NOT establish story time. Name overlap is a nomination hint, NOT confirmed entity identity. Reject unsupported direction/identity; succession, correlation and shared names alone are NOT causation."
    : "A cause must precede its effect on the novel sequence, and succession, correlation, or shared topic alone is NOT causation.";
  const answers = await decisions.decide(
    `Causality checklist. Judge each nominated pair on direct textual support and temporal consistency: ${timelineRule} Score honestly; contradictory pairs are held, not proposed.\n\n${dossier}`,
    questions,
  );
  const scoreOf = (key: string): number | null => {
    const matching = answers.filter((entry) => entry.key === key);
    const answer = matching.length === 1 ? matching[0] : undefined;
    return typeof answer?.value === "number" && Number.isFinite(answer.value) && answer.value >= 0 && answer.value <= 1 ? answer.value : null;
  };
  return candidates.map((candidate, index) => {
    const causal = scoreOf(`causal:${index}`);
    const succession = scoreOf(`succession:${index}`);
    const causalScore = causal ?? 0;
    const successionScore = succession ?? 1;
    const verdict: CausalVerdict["verdict"] =
      causal === null || succession === null ? "uncertain" : causalScore >= CAUSALITY_THRESHOLD && successionScore <= SUCCESSION_VETO
        ? "confident"
        : causalScore >= CAUSALITY_UNCERTAIN_FLOOR
          ? "uncertain"
          : "rejected";
    return { ...candidate, causalScore, successionScore, verdict };
  });
}
