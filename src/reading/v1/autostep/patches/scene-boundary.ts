import type { DecisionPatch } from "./types.js";
import { EMPTY_OUTCOME } from "./types.js";
import { tileScenes } from "../segmentation.js";

/**
 * Scene Boundary patch — span selection (sector 02, redesigned
 * 2026-10-22 after the span-segmentation experiment).
 *
 * The old design asked one noul per sentence ("does a scene begin
 * here?") over disjoint 40-sentence windows; on real text it produced
 * 77 scenes with a median size of ONE sentence, including scenes of
 * exactly one window (the window edge became the cut). The decision
 * model now POINTS: over 80-sentence batches with a 20-sentence
 * look-back it chooses where scenes START; each scene's end is
 * defined by the next chosen start (start = last end + 1, so scenes
 * tile the block by construction), an end-pick per scene serves as
 * cross-check, and a scene still open at a batch seam gets one
 * continuation query with its tail text injected (see
 * segmentation.ts for the measured reason starts, not ends, are
 * authoritative).
 *
 * Runs as a block-level prepass: start selection is sequential, so it
 * cannot be one batched question set per window. Output is unchanged
 * in shape: ordered scene spans in ctx.accepted["sceneSpans"], the
 * partition every later patch and the extraction step consume.
 * Decisions are pinnable for recall: `scene_start:<anchorId>`,
 * `scene_end:<startId>`, `scene_seam:<firstFollowingId>`.
 */
export const sceneBoundary: DecisionPatch = {
  id: "scene-boundary",
  description:
    "Tiles the block into scenes by Jev end-selection over overlapping batches, with seam continuation queries.",
  gates: { accept: 0.85, reask: 0.55 },

  buildQuestions() {
    return [];
  },

  applyAnswers() {
    return EMPTY_OUTCOME;
  },

  async prepass(ctx, decide, onProgress) {
    const { spans, escalations, unitConfidences } = await tileScenes(
      ctx.sentences,
      decide,
      {
        stateSummary: ctx.stateSummary,
        gates: sceneBoundary.gates,
        onSpan: onProgress
          ? async (soFar) => {
              ctx.accepted["sceneSpans"] = soFar;
              await onProgress();
            }
          : undefined,
      },
    );
    ctx.accepted["sceneSpans"] = spans;
    return { ...EMPTY_OUTCOME, escalations, unitConfidences };
  },
};
