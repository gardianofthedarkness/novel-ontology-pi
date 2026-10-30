import type { DecisionModel } from "../../ground/connectors/jev.js";
import type { Sentence } from "../intake/sectioning.js";
import type { DialogueTurn, Entity } from "../../ground/ontology/types.js";
import { newChangeSet, type ChangeSet } from "../../solidifier/merge/changeset.js";
import type { PatchContext } from "./patches/types.js";
import { PATCH_REGISTRY } from "./patches/index.js";
import { linkExchangeScenes } from "./segmentation.js";
import {
  nominateCandidateSpans,
  scanKnownNames,
  type CandidateNomination,
  type NameScanHit,
} from "./patches/name-detector.js";

/** One window's structured decisions, snapshotted for the extraction step. */
export interface WindowRecord {
  sentenceIds: string[];
  dialogueUnits: string[][];
  turns: DialogueTurn[];
  charactersPresent: string[];
  charactersMentioned: string[];
}

export interface MiniloopResult {
  changeset: ChangeSet;
  escalations: { patchId: string; unitId: string; reason: string }[];
  accepted: Record<string, unknown>;
  windows: WindowRecord[];
  /** Correction keys this run honored instead of deciding (sector 09 recall). */
  appliedPins?: string[];
}

export interface MiniloopProgress {
  blockId: string;
  patchId: string;
  proposals: ChangeSet["proposals"];
  sceneSpans: string[][];
  dialogueUnits: string[][];
  turns: DialogueTurn[];
}

/**
 * The System 1 autostep miniloop.
 *
 * Rolls over ONE block of novel text (a chapter, or a long block) that has
 * already been auto-sectioned into sentences. Block-level segmentation
 * pipelines (scene tiling, dialogue selection, name refinement) run
 * CONCURRENTLY first — each sequential in its own decisions, none
 * waiting on another — then, for each window, the remaining patches run
 * in registry order; each patch asks the decision model (Jev) ONE
 * batched call of typed questions and interprets the answers.
 *
 * Recursion: a patch whose unit confidence falls between its gates
 * triggers a re-ask with an expanded window; below the re-ask gate the
 * unit is escalated to the work LLM (adjudication happens one level up).
 *
 * CRITICAL INVARIANT: the miniloop NEVER writes to the ontology main
 * graph. Everything it concludes becomes proposals accumulated in the
 * block's ChangeSet, which the main agent reviews at the merge gate.
 */
export class Miniloop {
  constructor(
    private decisions: DecisionModel,
    private opts: {
      windowSize?: number;
      /**
       * Zero-context candidate refinement (sector 04): given the code's
       * nominated spans, return the candidate name forms for Jev to
       * judge. Backed by the work LLM when configured; when absent, the
       * raw nominated spans are the candidates.
       */
      refineNameCandidates?: (
        nominations: CandidateNomination[],
        sentences: Sentence[],
      ) => Promise<string[]>;
    } = {},
  ) {}

  async runBlock(input: {
    blockId: string;
    sentences: Sentence[];
    knownEntities: Entity[];
    stateSummary: string;
    /**
     * Pinned decisions from the recall protocol (sector 09): when the
     * reviewing agent has traced a cascade back to one early decision,
     * its correction is honored here — the question is still asked
     * (the record shows what the loop WOULD have decided), but the
     * applied answer is the pin, at full confidence.
     */
    pinnedAnswers?: Map<string, unknown>;
    onProgress?: (progress: MiniloopProgress) => Promise<void>;
  }): Promise<MiniloopResult> {
    const changeset = newChangeSet(input.blockId);
    const escalations: MiniloopResult["escalations"] = [];
    const windowSize = this.opts.windowSize ?? 40;

    const ctx: PatchContext = {
      blockId: input.blockId,
      sentences: input.sentences,
      windowSentenceIds: [],
      knownEntities: input.knownEntities,
      stateSummary: input.stateSummary,
      accepted: {},
    };
    // Deterministic half of the name patch: free, certain, no model call.
    ctx.accepted["nameHits"] = scanKnownNames(ctx);
    // Presence candidates, per the presence patch's documented design:
    // the characters the name scan found mentioned in this block. (The
    // previous scene's carry-over joins here once scene state threads
    // through the loop.)
    ctx.accepted["presenceCandidates"] = [
      ...new Set(
        (ctx.accepted["nameHits"] as NameScanHit[]).map((h) => h.entityId),
      ),
    ];
    // New-name candidates (sector 04): code nominates spans, the
    // optional zero-context refiner extracts the name forms, and the
    // name patch's Jev questions judge them — once per block, in the
    // first window (the list is cleared after it). The refinement is
    // a pipeline of its own: it runs concurrently with segmentation
    // below and lands before the first window needs it.
    const nominations = nominateCandidateSpans(input.sentences, input.knownEntities);
    ctx.accepted["nameCandidates"] = nominations.map((n) => n.span);

    const windows: WindowRecord[] = [];
    const seenProposalIds = new Set<string>();
    const appliedPins: string[] = [];
    // Pin-aware decision channel, shared by the prepass and the window
    // loop (sector 09): a pinned key keeps the question on the record
    // but the applied answer is the reviewing agent's correction, at
    // full confidence.
    const decideWithPins = async (
      state: Parameters<DecisionModel["decide"]>[0],
      questions: Parameters<DecisionModel["decide"]>[1],
    ) => {
      const decided = await this.decisions.decide(state, questions);
      return decided.map((a) => {
        if (input.pinnedAnswers?.has(a.key)) {
          if (!appliedPins.includes(a.key)) appliedPins.push(a.key);
          return { ...a, value: input.pinnedAnswers.get(a.key) as string | number, confidence: 1 };
        }
        return a;
      });
    };
    const absorbOutcome = (
      patchId: string,
      outcome: { proposals: ChangeSet["proposals"]; escalations: { unitId: string; reason: string }[] },
    ) => {
      for (const p of outcome.proposals) {
        if (seenProposalIds.has(p.id)) continue;
        seenProposalIds.add(p.id);
        changeset.proposals.push(p);
      }
      escalations.push(
        ...outcome.escalations.map((e) => ({ patchId, ...e })),
      );
    };
    // Block-level pipelines run CONCURRENTLY (the owner's pipelining
    // model, 2026-10-22): scene tiling, dialogue selection, and the
    // name-candidate refinement are independent decision pipelines —
    // each is sequential in its own calls (a span's start depends on
    // the last), but no pipeline waits on another, so the prepass
    // costs the LONGEST pipeline, not the sum. They write disjoint
    // accepted keys; the one true dependency — dialogue exchanges
    // link to scenes — is a pure join computed after all land.
    const snapshotProgress = async (patchId: string) => {
      await input.onProgress?.({
        blockId: input.blockId,
        patchId,
        proposals: [...changeset.proposals],
        sceneSpans: ((ctx.accepted["sceneSpans"] as string[][] | undefined) ?? []).map((span) => [...span]),
        dialogueUnits: ((ctx.accepted["dialogueUnits"] as string[][] | undefined) ?? []).map((unit) => [...unit]),
        turns: [],
      });
    };
    const pipelines: Promise<void>[] = [];
    if (this.opts.refineNameCandidates) {
      const refine = this.opts.refineNameCandidates;
      pipelines.push(
        (async () => {
          ctx.accepted["nameCandidates"] = await refine(nominations, input.sentences);
        })(),
      );
    }
    for (const patch of PATCH_REGISTRY) {
      if (!patch.prepass) continue;
      pipelines.push(
        (async () => {
          const outcome = await patch.prepass!(ctx, decideWithPins, () => snapshotProgress(patch.id));
          absorbOutcome(patch.id, outcome);
          await snapshotProgress(patch.id);
        })(),
      );
    }
    await Promise.all(pipelines);
    // The join: link dialogue exchanges to the scene partition.
    const unitSpans = ctx.accepted["dialogueUnitSpans"] as [number, number][] | undefined;
    const sceneSpans = ctx.accepted["sceneSpans"] as string[][] | undefined;
    if (unitSpans && sceneSpans) {
      ctx.accepted["dialogueUnitScenes"] = linkExchangeScenes(input.sentences, unitSpans, sceneSpans);
    }
    // Block-level dialogue exchanges from the prepass; the window loop
    // projects (clips) them per window for the speaker patch, and the
    // block-level list is restored into `accepted` at the end.
    const blockDialogueUnits = (
      (ctx.accepted["dialogueUnits"] as string[][] | undefined) ?? []
    ).map((u) => [...u]);
    const identityRegistry = input.knownEntities.filter((entity) => entity.kind === "Character").map((entity) => `${entity.id}: ${entity.names.map((form) => form.text).join(" / ")}`).join("\n");
    let firstWindow = true;
    for (let w = 0; w < input.sentences.length; w += windowSize) {
      ctx.windowSentenceIds = input.sentences
        .slice(w, w + windowSize)
        .map((s) => s.id);
      const priorPresent = (ctx.accepted["charactersPresent"] as string[] | undefined) ?? [];
      ctx.accepted["presenceCandidates"] = [...new Set([
        ...(ctx.accepted["nameHits"] as NameScanHit[]).filter((hit) => ctx.windowSentenceIds.includes(hit.sentenceId)).map((hit) => hit.entityId),
        ...priorPresent,
      ])].filter((id) => input.knownEntities.some((entity) => entity.id === id && entity.kind === "Character"));
      ctx.accepted["charactersPresent"] = [];
      ctx.accepted["charactersMentioned"] = [];
      ctx.accepted["turns"] = [];
      // Project the block-level exchanges into this window: the
      // speaker patch attributes turns over the clipped units.
      const windowIdSet = new Set(ctx.windowSentenceIds);
      ctx.accepted["dialogueUnits"] = blockDialogueUnits
        .map((u) => u.filter((id) => windowIdSet.has(id)))
        .filter((u) => u.length > 0);
      ctx.accepted["sceneSpans"] = ctx.accepted["sceneSpans"] ?? [];

      for (const patch of PATCH_REGISTRY) {
        const questions = patch.buildQuestions(ctx);
        if (questions.length === 0) continue;
        // State handed to Jev: compact summary + the window's sentences.
        const windowText = ctx.windowSentenceIds
          .map(
            (id) =>
              `${id}: ${input.sentences.find((s) => s.id === id)?.text ?? ""}`,
          )
          .join("\n");
        const decided = await decideWithPins(
          `${ctx.stateSummary}\nIDENTITY REGISTRY (not evidence of presence):\n${identityRegistry}\n---\n${windowText}`,
          questions,
        );
        const outcome = patch.applyAnswers(ctx, decided);
        absorbOutcome(patch.id, outcome);
        await input.onProgress?.({
          blockId: input.blockId,
          patchId: patch.id,
          proposals: [...changeset.proposals],
          sceneSpans: ((ctx.accepted["sceneSpans"] as string[][] | undefined) ?? []).map((span) => [...span]),
          dialogueUnits: [...windows.flatMap((window) => window.dialogueUnits), ...((ctx.accepted["dialogueUnits"] as string[][] | undefined) ?? [])].map((unit) => [...unit]),
          turns: [...windows.flatMap((window) => window.turns), ...((ctx.accepted["turns"] as DialogueTurn[] | undefined) ?? []).filter((turn) => turn.sentenceIds.some((id) => ctx.windowSentenceIds.includes(id)))].map((turn) => ({ ...turn, sentenceIds: [...turn.sentenceIds] })),
        });
      }

      windows.push({
        sentenceIds: [...ctx.windowSentenceIds],
        dialogueUnits: ((ctx.accepted["dialogueUnits"] as string[][] | undefined) ?? []).map((u) => [...u]),
        turns: ((ctx.accepted["turns"] as DialogueTurn[] | undefined) ?? []).map((t) => ({ ...t, sentenceIds: [...t.sentenceIds] })),
        charactersPresent: [...((ctx.accepted["charactersPresent"] as string[] | undefined) ?? [])],
        charactersMentioned: [...((ctx.accepted["charactersMentioned"] as string[] | undefined) ?? [])],
      });
      if (firstWindow) {
        // Candidates are judged once per block (see above); later
        // windows must not re-ask the same new-vs-nickname questions.
        ctx.accepted["nameCandidates"] = [];
        firstWindow = false;
      }
    }

    // `accepted` reports the block-level exchanges (the per-window
    // projections were working state for the speaker patch).
    ctx.accepted["dialogueUnits"] = blockDialogueUnits;
    changeset.status = "pending_review";
    return { changeset, escalations, accepted: ctx.accepted, windows, appliedPins };
  }
}
