import type { DecisionPatch } from "./types.js";
import { dialogueDetector } from "./dialogue-detector.js";
import { nameDetector } from "./name-detector.js";
import { sceneBoundary } from "./scene-boundary.js";
import { speakerAttribution } from "./speaker-attribution.js";
import { presenceDetector } from "./presence-detector.js";

/**
 * v1 patch registry — ORDER MATTERS.
 * Sectioning output flows: scene spans → dialogue units → names/presence
 * → speaker attribution. Later patches consume earlier patches' accepted
 * decisions via PatchContext.accepted.
 *
 * The first two patches (scene-boundary, dialogue-detector) are
 * block-level PREPASS patches (span segmentation, 2026-10-22): their
 * decisions are sequential over the whole block, so the miniloop runs
 * their prepass once before the per-window loop and they return no
 * per-window questions. The rest decide per window as before.
 *
 * The full catalog (state changes, event-worthiness, causal candidates,
 * foreshadowing, ...) lives in docs/system1/index.html as an open discussion
 * list — each new functionality is one new patch added here.
 */
export const PATCH_REGISTRY: DecisionPatch[] = [
  sceneBoundary,
  dialogueDetector,
  nameDetector,
  presenceDetector,
  speakerAttribution,
];
