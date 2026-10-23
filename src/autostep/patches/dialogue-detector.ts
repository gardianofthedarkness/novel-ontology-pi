import type { DecisionPatch } from "./types.js";
import { EMPTY_OUTCOME } from "./types.js";
import { selectExchanges } from "../segmentation.js";

/**
 * Dialogue Detector patch — exchange selection (sector 03, redesigned
 * 2026-10-22 alongside scene span selection).
 *
 * The old design classified every sentence (dialogue / narration /
 * interior monologue / description) plus a continues-previous noul,
 * and grouped the fragments; on real text the median "unit" was ONE
 * sentence — it found lines, not conversations. The unit is now the
 * EXCHANGE: one ongoing conversation between the same people, brief
 * narration beats included. Jev selects each exchange's start and end
 * sentence over overlapping 80-sentence batches; spans overlapping by
 * >= 3 sentences across batches merge as the same exchange.
 *
 * Hierarchy: scenes (partition) -> exchanges -> turns. An exchange
 * belongs to ONE scene, or TWO when the conversation straddles a
 * scene cut (links in ctx.accepted["dialogueUnitScenes"], span
 * indices aligned with ctx.accepted["dialogueUnits"]). The speaker
 * patch works per window over the exchanges clipped to that window
 * and produces the turns; per-sentence classification survives only
 * there, where it belongs.
 *
 * Runs as a block-level prepass after scene-boundary (it needs the
 * finished partition for scene links). Selection endpoints are
 * pinnable for recall: `dlg_start:<firstId>` / `dlg_end:<startId>`.
 */
export const dialogueDetector: DecisionPatch = {
  id: "dialogue-detector",
  description:
    "Selects dialogue exchanges (start/end) over overlapping batches and links each to its scene or scene pair.",
  gates: { accept: 0.85, reask: 0.55 },

  buildQuestions() {
    return [];
  },

  applyAnswers() {
    return EMPTY_OUTCOME;
  },

  async prepass(ctx, decide) {
    const sceneSpans =
      (ctx.accepted["sceneSpans"] as string[][] | undefined) ?? [];
    const { units, unitScenes, escalations, unitConfidences } =
      await selectExchanges(ctx.sentences, sceneSpans, decide, {
        stateSummary: ctx.stateSummary,
        gates: dialogueDetector.gates,
      });
    ctx.accepted["dialogueUnits"] = units;
    ctx.accepted["dialogueUnitScenes"] = unitScenes;
    return { ...EMPTY_OUTCOME, escalations, unitConfidences };
  },
};
