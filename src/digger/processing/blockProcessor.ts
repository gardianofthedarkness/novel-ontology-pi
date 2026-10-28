import { sectionBlock } from "../intake/sectioning.js";
import { randomUUID } from "node:crypto";
import { Miniloop } from "../autostep/miniloop.js";
import {
  pinsForBlock,
  type Correction,
} from "../../solidifier/maintenance/corrections.js";
import type { DecisionModel } from "../../ground/connectors/jev.js";
import type { WorkModel } from "../../ground/connectors/llm.js";
import type {
  ExtractionInput,
  ExtractionOutput,
} from "../extraction/extraction.js";
import { createCandidateRefiner, createExtractor } from "../extraction/extraction.js";
import type { OntologyStore } from "../../ground/ontology/store.js";
import type { Entity } from "../../ground/ontology/types.js";
import type { ChangeSet } from "../../solidifier/merge/changeset.js";
import { applyChangeSet } from "../../solidifier/merge/apply.js";
import { saveChangeSet } from "../../solidifier/merge/changesetStore.js";
import { EventLog } from "../../ground/events/log.js";
import type { EventSink } from "../../ground/events/types.js";
import { saveWorkingDraft, touchedDraftIds, type WorkingDraft } from "./draft.js";
import { resolveCandidates } from "./entityCandidates.js";
import { timePlaceForNewScenes } from "../timeplace/afterApply.js";
import { EXTRACTION_CONSTRAINTS_KEY, parseExtractionConstraints } from "../extraction/constraints.js";
import { FacultyGraph, type FacultyGraphOptions } from "./facultyGraph.js";
import { groundFacultyProposals } from "./facultyGrounding.js";
import { previewFacultyStates } from "./facultyContinuity.js";
import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import type { OntEvent, Relation, Scene } from "../../ground/ontology/types.js";
import { runIdentityAfterApply, type IdentitySummary } from "../../solidifier/identity/afterApply.js";
import { castScope, loadCast } from "../../solidifier/identity/cast.js";
import { runCausalityPass } from "../../solidifier/causality/faculty.js";
import type { StateChange } from "../../ground/ontology/types.js";

export type ReviewDecision = "approved" | "held" | "revision_requested";

/**
 * The outer processing loop — how a whole novel gets ingested.
 *
 *   for each block (chapter, or a long block of text):
 *     1. section the block into sentences          (code)
 *     2. run the System 1 miniloop                 (Jev patches)
 *        -> accumulates a ChangeSet of proposals
 *     3. per-scene extraction with the work LLM     (sector 08;
 *        -> appends event/causality proposals        runs when a work
 *        to the same ChangeSet                       model is wired)
 *     4. MERGE GATE: hand the ChangeSet to the main agent.
 *        - approved            -> apply to the main graph, next block
 *        - held                -> stop; nothing applied; awaiting the user
 *        - revision_requested  -> re-run the miniloop for the noted parts
 *                                 only, present a revised ChangeSet
 *   ... until the novel is done.
 *
 * The main agent is the reviewer because it holds what the miniloop
 * cannot: the whole conversation, the user's intent, long-range memory
 * of earlier chapters, and every other capability.
 */
export class BlockProcessor {
  constructor(
    private store: OntologyStore,
    private decisions: DecisionModel,
    private review: (cs: ChangeSet) => Promise<ReviewDecision>,
    private observation: {
      novelDir?: string;
      semanticReview?: boolean;
      emit?: EventSink;
      /**
       * Loads the entities the miniloop should treat as already known
       * (the cumulative per-novel name registry). Called before EVERY
       * block, so entities merged by earlier blocks — or earlier runs —
       * are visible to the name scan and the presence patch. When not
       * provided, blocks start with an empty registry.
       */
      loadKnownEntities?: () => Promise<Entity[]>;
      /**
       * The work LLM. When provided, the extraction step (sector 08)
       * runs between the miniloop and the merge gate, and the
       * zero-context candidate refiner is available to the miniloop.
       * When absent, blocks produce miniloop-only ChangeSets.
       */
      workModel?: WorkModel;
      facultyGraph?: false | FacultyGraphOptions;
      /**
       * Universal EM after each block is applied in-process (the gate
       * path runs it from approveBook): the book joins the universe's
       * shared character list and its new characters are checked
       * against the book and the universe. Confident matches merge;
       * less confident ones are raised for review. Only the ingest CLI
       * enables this; EM failures never block ingestion.
       */
      entityMatching?: boolean;
      onEntityMatching?: (blockId: string, summary: IdentitySummary) => void;
      /**
       * The causality faculty (systematic path): after extraction, run
       * the hybrid candidate + Jev checklist pass over pairs touching
       * the block's new events and dialogue cards. Confident verdicts
       * join the block's ChangeSet as add_relation proposals for the
       * same gate review as everything else. Only the ingest CLI
       * enables this; faculty failures never block ingestion (a
       * reviewNote records them, EM precedent).
       */
      causality?: boolean;
      /**
       * Time-place faculty at birth (phase 1, opt-in): after a block is
       * applied, its new scenes get time/place facts in their own
       * pending ChangeSet, reviewed by the same gate. Advisory: a failure
       * never blocks ingestion.
       */
      timePlace?: { mode: import("../timeplace/faculty.js").VocabularyMode };
      /** Optional embedder for the faculty's embedding leg (null = graph patterns only). */
      embedder?: import("../../ground/connectors/embeddings.js").Embedder | null;
      onCausality?: (blockId: string, summary: import("../../solidifier/causality/faculty.js").CausalitySummary) => void;
      /** Distinct event/scene counts in the bundle, for ID/order sequencing. */
      loadCounts?: () => Promise<{ events: number; scenes: number; reservedEntityIds?: string[] }>;
      /**
       * Recall corrections (sector 09): pinned decisions the reviewing
       * agent has issued for specific blocks. Loaded once per run; the
       * pins for each block are honored by its miniloop pass.
       */
      loadCorrections?: () => Promise<Correction[]>;
    } = {},
  ) {}

  async processNovel(blocks: { blockId: string; text: string; chapterIndex?: number; sectionIndex?: number }[]): Promise<{
    mergedBlocks: string[];
    stoppedAt: string | null;
    stopReason: string | null;
  }> {
    const mergedBlocks: string[] = [];
    const miniloop = new Miniloop(this.decisions, {
      refineNameCandidates: this.observation.workModel
        ? createCandidateRefiner(this.observation.workModel)
        : undefined,
    });
    const extract = this.observation.workModel
      ? createExtractor(this.observation.workModel)
      : undefined;
    const emit = this.observation.emit ?? (this.observation.novelDir ? new EventLog(this.observation.novelDir).emit : undefined);

    const corrections = this.observation.loadCorrections
      ? await this.observation.loadCorrections()
      : [];
    for (const [blockIndex, block] of blocks.entries()) {
      const observationId = randomUUID();
      await emit?.({ type: "block.started", blockId: block.blockId });
      const { sentences } = sectionBlock(block.text, block.sectionIndex ?? mergedBlocks.length);
      await emit?.({ type: "sectioned", blockId: block.blockId, sentences: sentences.length });
      let revisionRounds = 0;
      for (;;) {
        let draft: WorkingDraft = {
          version: 1, blockId: block.blockId, chapterIndex: block.chapterIndex ?? 0,
          stage: "miniloop", patchId: "starting", updatedAt: new Date().toISOString(),
          proposals: [], sceneSpans: [], dialogueUnits: [], turns: [], completedScenes: 0, totalScenes: 0,
        };
        let publishing = Promise.resolve();
        const publish = (update: Partial<WorkingDraft> | ((current: WorkingDraft) => Partial<WorkingDraft>), announce = false) => {
          publishing = publishing.then(async () => {
            const previous = draft;
            draft = { ...draft, ...(typeof update === "function" ? update(draft) : update), updatedAt: new Date().toISOString() };
            if (this.observation.novelDir) {
              await saveWorkingDraft(this.observation.novelDir, draft);
              // Phase B (decision #15): the working-draft stream is the
              // live view's source of truth. Only progress publishes
              // announce — a draft.updated fact means "a new batch of
              // decisions landed", never the empty initial draft or the
              // gate transition (changeset.pending already says that).
              if (announce) {
                await emit?.({ type: "draft.updated", blockId: draft.blockId, patchId: draft.patchId, stage: draft.stage, touchedIds: touchedDraftIds(previous, draft) });
              }
            }
          });
          return publishing;
        };
        await publish({});
        const knownEntities = this.observation.loadKnownEntities
          ? await this.observation.loadKnownEntities()
          : [];
        const pins = pinsForBlock(corrections, block.blockId);
        const constraintsValue = corrections.find(correction => correction.blockId === block.blockId && correction.key === EXTRACTION_CONSTRAINTS_KEY)?.value;
        const constraints = constraintsValue ? parseExtractionConstraints(constraintsValue) : undefined;
        const legacyPins = [...pins.keys()].some(key => !key.startsWith("scene_") && !key.startsWith("dlg_") && key !== EXTRACTION_CONSTRAINTS_KEY);
        let callSequence = 0;
        let telemetry = Promise.resolve();
        const observedDecisions: DecisionModel = {
          modelId: this.decisions.modelId,
          decide: async (state, questions, options) => {
            const callId = `${observationId}:system1:${revisionRounds}:${++callSequence}`;
            const faculty = (questions[0]?.key.split(":")[0] ?? "decisions").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64);
            await emit?.({ type: "faculty.activity", blockId: block.blockId, callId, faculty, system: "system1", status: "started" });
            try {
              const result = await this.decisions.decide(state, questions, options);
              await emit?.({ type: "faculty.activity", blockId: block.blockId, callId, faculty, system: "system1", status: "completed" });
              return result;
            } catch (error) {
              await emit?.({ type: "faculty.activity", blockId: block.blockId, callId, faculty, system: "system1", status: "failed" });
              throw error;
            }
          },
        };
        const graphOptions = this.observation.facultyGraph || {};
        const graph = this.observation.workModel && this.observation.facultyGraph !== false && !legacyPins
          ? new FacultyGraph(observedDecisions, this.observation.workModel, { ...graphOptions, onCall: call => {
            graphOptions.onCall?.(call);
            telemetry = telemetry.then(() => emit?.({ type: "faculty.activity", blockId: block.blockId, callId: `${observationId}:${revisionRounds}:${call.callId}`, faculty: call.faculty, system: call.system ?? "work", status: call.status }));
          } }) : undefined;
        const margin = graph?.router.contextWindow(["scene-boundaries", "dialogue-boundaries", "dialogue-attribution", "dialogue-participants"]) ?? 0;
        const contextSentences = margin > 0 ? [
          ...(blockIndex > 0 ? sectionBlock(blocks[blockIndex - 1].text, blocks[blockIndex - 1].sectionIndex ?? blockIndex - 1).sentences.slice(-margin) : []),
          ...sentences,
          ...(blockIndex + 1 < blocks.length ? sectionBlock(blocks[blockIndex + 1].text, blocks[blockIndex + 1].sectionIndex ?? blockIndex + 1).sentences.slice(0, margin) : []),
        ] : sentences;
        // Universal EM at birth sees the universe's shared character list.
        const universe = graph && this.observation.novelDir ? await castScope(this.observation.novelDir).then(async (scope) => ({ cast: await loadCast(scope), sourceId: scope.sourceId, books: scope.books })).catch(() => undefined) : undefined;
        const faculty = await graph?.run({ blockId: block.blockId, chapterIndex: block.chapterIndex ?? 0, sentences, contextSentences, knownEntities, pins, constraints, universe, onProgress: async progress => publish(progress, true) });
        const result = faculty?.miniloop ?? await miniloop.runBlock({
          blockId: block.blockId,
          sentences,
          knownEntities,
          stateSummary: `Processing block ${block.blockId}.`,
          pinnedAnswers: pins,
          onProgress: async (progress) => publish({ ...progress, totalScenes: progress.sceneSpans.length }, true),
        });
        if (legacyPins && this.observation.workModel && this.observation.facultyGraph !== false) result.changeset.reviewNotes["faculty:legacy-pins"] = "Used the legacy execution path to honor reviewer pins whose window-scoped keys cannot be reinterpreted safely by the scene graph.";
        for (const key of pins.keys()) if (key !== EXTRACTION_CONSTRAINTS_KEY && !result.appliedPins?.includes(key)) result.changeset.reviewNotes[`recall:unapplied:${key}`] = "The pinned question did not occur in this revision. The correction was not silently reinterpreted; Pi must check its applicability.";
        for (const key of result.appliedPins ?? []) {
          result.changeset.reviewNotes[`recall:pin:${key}`] =
            "Decision pinned by a reviewing-agent correction (sector 09 recall); the miniloop honored the pin instead of its own judgment.";
        }
        if (extract) {
          await publish({ stage: "extraction", patchId: "extraction" });
          // Sector 08: extraction reads the miniloop's structured
          // scenes and returns the block's FINAL proposal list —
          // stubs fleshed or dropped, aliases folded, events,
          // relations and state changes appended — before anything
          // is saved or shown to the gate.
          const counts = this.observation.loadCounts
            ? await this.observation.loadCounts()
            : { events: 0, scenes: 0 };
          const out: ExtractionOutput = await extract({
            blockId: block.blockId,
            chapterIndex: block.chapterIndex ?? 0,
            sentences,
            miniloop: result,
            knownEntities,
            proposals: result.changeset.proposals,
            counts,
            constraints,
            sceneResults: faculty?.sceneResults,
            // Candidates resolve in the same write that adds the entities
            // they became, so the view never shows both at once.
            onProgress: async (progress) => publish(current => ({ ...progress, ...(current.entityCandidates?.length ? { entityCandidates: resolveCandidates(current.entityCandidates, progress.proposals) } : {}) }), true),
          } satisfies ExtractionInput);
          result.changeset.proposals = out.proposals;
          Object.assign(result.changeset.reviewNotes, out.notes);
          if (faculty) {
            Object.assign(result.changeset.reviewNotes, groundFacultyProposals(out.proposals, knownEntities, sentences));
            await publish({ patchId: "continuity-relations", statePreview: await previewFacultyStates(this.store, out.proposals) });
          }
        }
        if (this.observation.causality && this.observation.novelDir) {
          try {
            const newEvents = result.changeset.proposals
              .filter((p) => p.kind === "create_event")
              .map((p) => p.payload as OntEvent);
            const newScenes = result.changeset.proposals
              .filter((p) => p.kind === "create_scene")
              .map((p) => p.payload as Scene);
            const newStateChanges = result.changeset.proposals
              .filter((p) => p.kind === "set_state_change")
              .map((p) => ({ ...(p.payload as Omit<StateChange, "id">), id: p.id }));
            const touchedIds = new Set([
              ...newEvents.map((event) => event.id),
              ...newScenes.flatMap((scene) => (scene.dialogues ?? []).map((card) => card.id)),
            ]);
            const pass = await runCausalityPass({
              novelDir: this.observation.novelDir,
              decisions: this.decisions,
              embedder: this.observation.embedder ?? null,
              touchedIds,
              extras: {
                events: newEvents,
                scenes: newScenes,
                stateChanges: newStateChanges,
                sentenceTexts: new Map(sentences.map((sentence) => [sentence.id, sentence.text])),
              },
              provenanceBlockId: block.blockId,
            });
            if (pass.proposals.length) result.changeset.proposals.push(...pass.proposals);
            if (pass.summary.nominated > 0 || pass.summary.embedded > 0) {
              result.changeset.reviewNotes["causality-faculty"] =
                `Causality pass: ${pass.summary.nominated} nominated, ${pass.summary.proposed} proposed, ${pass.summary.uncertain} uncertain, ${pass.summary.rejected} rejected${pass.summary.embeddingLeg ? " (embedding leg on)" : " (graph patterns only)"}.`;
            }
            this.observation.onCausality?.(block.blockId, pass.summary);
          } catch (error) {
            // Advisory, EM precedent: a failed pass never blocks the block.
            result.changeset.reviewNotes["causality-faculty"] =
              `Causality pass failed (${error instanceof Error ? error.message : String(error)}); no CAUSES proposals from this block.`;
          }
        }
        if (this.observation.semanticReview) result.changeset.reviewSource = sentences;
        if (this.observation.novelDir) await saveChangeSet(this.observation.novelDir, result.changeset);
        await telemetry;
        await publish(current => ({ stage: "gate", patchId: "merge-gate", proposals: result.changeset.proposals, ...(current.entityCandidates?.length ? { entityCandidates: resolveCandidates(current.entityCandidates, result.changeset.proposals) } : {}) }));
        // No event emissions here: saveChangeSet is the emitter of record
        // for proposal.added / changeset.<status> — it fires them only
        // after the persisted state is visible, deduped by status change.
        const decision = await this.review(result.changeset);
        result.changeset.status = decision;
        if (this.observation.novelDir) await saveChangeSet(this.observation.novelDir, result.changeset);
        if (decision === "approved") {
          result.changeset.status = "approved";
          await applyChangeSet(this.store, result.changeset, emit);
          mergedBlocks.push(block.blockId);
          if (this.observation.timePlace && this.observation.novelDir) {
            try {
              const sceneIds = result.changeset.proposals.filter((proposal) => proposal.kind === "create_scene").map((proposal) => (proposal.payload as Scene).id);
              const output = sceneIds.length ? await timePlaceForNewScenes({ novelDir: this.observation.novelDir, sentences: new Map(sentences.map((sentence) => [sentence.id, sentence])), mode: this.observation.timePlace.mode, work: this.observation.workModel, decisions: this.decisions, sceneIds, provenanceBlockId: block.blockId , reviewSource: !!this.observation.semanticReview, remember: true }) : null;
              if (output?.changeset) {
                await saveChangeSet(this.observation.novelDir, output.changeset);
                // Semantic hosts review time-place packets through the shared gate (novel review); legacy hosts approve here.
                const verdict = output.changeset.reviewSource ? "pending_review" : await this.review(output.changeset);
                output.changeset.status = verdict;
                await saveChangeSet(this.observation.novelDir, output.changeset);
                if (verdict === "approved") await applyChangeSet(this.store, output.changeset, emit);
                result.changeset.reviewNotes["time-place"] = `${output.changeset.id}: ${output.result.periods.length} period(s), ${output.result.periods.filter((period) => period.flashback).length} flashback(s) — ${verdict}.`;
              }
            } catch (error) {
              result.changeset.reviewNotes["time-place"] = `Time-place pass failed (${error instanceof Error ? error.message : String(error)}); scenes keep no time facts until \`novel timeplace run\`.`;
            }
          }
          if (this.observation.entityMatching && this.observation.novelDir) {
            try {
              const summary = await runIdentityAfterApply({
                novelDir: this.observation.novelDir,
                decisions: this.decisions,
                changeset: result.changeset,
                events: this.observation.emit ?? new EventLog(this.observation.novelDir).emit,
              });
              result.changeset.reviewNotes["identity"] = `Universal EM after apply: ${summary.joined} joined known people, ${summary.created} new, ${summary.checked} checked, ${summary.merged.length} merged${summary.review ? `, ${summary.review.proposals} raised for review (${summary.review.packetId})` : ""}.`;
              this.observation.onEntityMatching?.(block.blockId, summary);
            } catch (error) {
              result.changeset.reviewNotes["identity"] = `Universal EM after apply failed (${error instanceof Error ? error.message : String(error)}); \`novel em sweep\` retries.`;
            }
          }
          break;
        }
        if (decision === "held") {
          return {
            mergedBlocks,
            stoppedAt: block.blockId,
            stopReason: "Change set held by the main agent at the merge gate.",
          };
        }
        // revision_requested
        revisionRounds++;
        if (revisionRounds > 2) {
          return {
            mergedBlocks,
            stoppedAt: block.blockId,
            stopReason: "Revision rounds exhausted; needs the user's call.",
          };
        }
        // TODO: re-run only the noted proposals' patches (reviewNotes),
        // not the whole block — granularity is an open design question.
      }
    }
    return { mergedBlocks, stoppedAt: null, stopReason: null };
  }
}
