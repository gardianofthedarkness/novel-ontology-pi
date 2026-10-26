import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { cutBlocks } from "../../../digger/intake/blocks.js";
import { BlockProcessor, type ReviewDecision } from "../../../digger/processing/blockProcessor.js";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import { buildGraphFromBundle } from "../../../ground/connectors/ladybug.js";
import { jevFromEnv } from "../../../ground/connectors/jev.js";
import { workModelFromEnv, type HttpWorkModel } from "../../../ground/connectors/workModel.js";
import { loadCorrections } from "../../../solidifier/maintenance/corrections.js";
import { loadConfig } from "../../config.js";
import { resolveJevKey } from "../../../ground/connectors/secrets.js";
import { EventLog } from "../../../ground/events/log.js";
import { listChangeSets, saveChangeSet } from "../../../solidifier/merge/changesetStore.js";
import type { Entity, OntEvent, Relation, Scene } from "../../../ground/ontology/types.js";
import { loadExtractionCounts } from "../../../digger/processing/counts.js";
import { facultyOptionsFromEnv } from "../../../digger/processing/facultyOptions.js";
import { runEntityMatching, loadMatchMemory, saveMatchMemory } from "../../../solidifier/matching/emFaculty.js";
import { loadEmbedder } from "../../../ground/connectors/embeddings.js";
import {
  clearCausalitySweepPending,
  markCausalitySweepPending,
  readCausalityMemory,
  runCausalityPass,
} from "../../../solidifier/causality/faculty.js";
import { albumPortraits, emitAlbumAnchors } from "./albumCommands.js";
import { bindWorkspaceSource, sourceHash } from "../../../ground/workspace/source.js";

export interface IngestOptions {
  /** Legacy miniloop-only smoke option; a configured work model requires fact review. */
  autoApprove?: boolean;
  /** Stop after this many blocks. */
  maxBlocks?: number;
  /** Target block size in chars for the block cutter. */
  blockSize?: number;
  /** Force the extraction step off even when a work LLM is configured. */
  noExtract?: boolean;
  /** Skip the per-block causality faculty + chapter sweep (default: on). */
  noCausality?: boolean;
  /** Run the time-place faculty after each applied block (phase 1, opt-in). */
  timePlace?: boolean;
  env?: NodeJS.ProcessEnv;
}

/**
 * `novel ingest <novel-dir> <file>` — the full processing loop for one
 * text file: cut blocks -> section -> System 1 miniloop (live Jev) ->
 * ChangeSets -> merge gate -> bundle + rebuilt graph.
 *
 * Review modes:
 *  - default: the FIRST block's ChangeSet is saved and the run stops at
 *    the gate ("held"). Review it with `novel changeset show`, then
 *    `novel changeset approve` to apply it, and re-run ingest to roll on.
 *    This is the main-agent workflow: the agent reads each ChangeSet and
 *    only then lets the run continue.
 *  - --auto-approve: legacy miniloop-only smoke runs apply in-process.
 *    Work-model extraction rejects this flag; use the fact-review gate.
 *
 * The known-entity registry is the bundle itself: entities.jsonl is
 * re-read (last write wins) before every block, so names merged by
 * earlier blocks or earlier runs are known to later ones.
 */
export async function ingestNovel(
  novelDir: string,
  file: string,
  opts: IngestOptions = {},
) {
  const env = opts.env ?? process.env;
  const facultyGraph = facultyOptionsFromEnv(env);
  const ontologyDir = join(novelDir, "ontology");
  try {
    await stat(join(ontologyDir, "manifest.json"));
  } catch {
    throw new Error(
      `${novelDir} is not a novel workspace (missing ontology/manifest.json). Run \`novel init ${novelDir}\` first.`,
    );
  }
  if (!resolveJevKey(env)) {
    throw new Error(
      "Jev API key missing. Run `novel jev login` to store it securely, or set TYPESAFE_API_KEY.",
    );
  }

  const text = await readFile(file, "utf8");
  // Keep a copy of the source inside the workspace: the recall
  // protocol (sector 09) re-runs a single block from it, in a later
  // session, without the original file at hand.
  const source = await bindWorkspaceSource(novelDir, file, opts.blockSize);
  if (sourceHash(text) !== source.sha256) throw new Error("Input changed while binding the source; retry with a stable file.");
  const allBlocks = cutBlocks(text, source.blockSize);
  const selectedBlocks = opts.maxBlocks ? allBlocks.slice(0, opts.maxBlocks) : allBlocks;
  const existing = await listChangeSets(novelDir);
  const unresolved = existing.find((changeset) => changeset.status !== "approved" && selectedBlocks.some((block) => block.id === changeset.blockId));
  if (unresolved) throw new Error(`Existing ${unresolved.status} packet ${unresolved.id}; review, revise or recall it before ingesting again.`);
  const approved = new Set(existing
    .filter((changeset) => changeset.status === "approved")
    .map((changeset) => changeset.blockId));
  let processingLog = "";
  try {
    processingLog = await readFile(join(novelDir, "events.jsonl"), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const applied = new Set(processingLog.split("\n").filter(Boolean)
    .map((line) => JSON.parse(line) as { event: { type: string; changesetId?: string } })
    .filter((record) => record.event.type === "changeset.applied")
    .map((record) => record.event.changesetId));
  for (const block of selectedBlocks) {
    if (approved.has(block.id) && !applied.has(`cs_${block.id}`)) {
      throw new Error(`Block ${block.id} is approved without an applied record; inspect the gate before resuming.`);
    }
  }
  const skippedBlocks = selectedBlocks.filter((block) => approved.has(block.id)).map((block) => block.id);
  const blocks = selectedBlocks.filter((block) => !approved.has(block.id));

  const bundle = new BundleStore(ontologyDir);
  const log = new EventLog(novelDir);
  const loadKnownEntities = async (): Promise<Entity[]> => {
    const rows = await bundle.loadFile<Entity>("entities.jsonl");
    const byId = new Map<string, Entity>();
    for (const e of rows) byId.set(e.id, e);
    return [...byId.values()];
  };
  const loadCounts = () => loadExtractionCounts(novelDir, bundle);

  // Extraction (sector 08) runs when a work LLM is configured and not
  // explicitly disabled. Its absence is reported, never silent.
  let workModel: HttpWorkModel | null = null;
  if (!opts.noExtract) {
    try {
      workModel = workModelFromEnv(env);
    } catch {
      workModel = null;
    }
  }

  const review = async (): Promise<ReviewDecision> =>
    opts.autoApprove ? "approved" : "held";
  if (opts.autoApprove && workModel) throw new Error("Live semantic extraction requires fact review; --auto-approve cannot bypass it");

  const emPerBlock: { blockId: string; nominated: number; merged: number; distinct: number; uncertain: number }[] = [];
  const causalityPerBlock: { blockId: string; nominated: number; proposed: number; uncertain: number; rejected: number; embedded: number; embeddingLeg: boolean; graphLeg: boolean }[] = [];
  const cfg = loadConfig(env);

  // Album pre-process (intake, not a faculty, not a post-pass): when
  // the workspace has an album, every block's pictures are known from
  // intake data alone (offsets + sectioning) before any model runs.
  // Never fatal to ingest: no album means nothing to emit.
  try {
    await emitAlbumAnchors(novelDir, allBlocks, processingLog, log.emit);
  } catch { /* no album in this workspace: ingest is unchanged */ }

  const processor = new BlockProcessor(bundle, jevFromEnv(env), review, {
    novelDir,
    emit: log.emit,
    loadKnownEntities,
    loadCounts,
    loadCorrections: () => loadCorrections(novelDir),
    workModel: workModel ?? undefined,
    facultyGraph,
    semanticReview: !!workModel,
    entityMatching: true,
    onEntityMatching: (blockId, summary) => emPerBlock.push({
      blockId,
      nominated: summary.nominated,
      merged: summary.merged.length,
      distinct: summary.distinct.length,
      uncertain: summary.uncertain.length,
    }),
    causality: !opts.noCausality,
    ...(opts.timePlace ? { timePlace: { mode: workModel ? "hybrid" as const : "programmatic" as const } } : {}),
    embedder: loadEmbedder({
      provider: cfg.embeddings.provider,
      model: cfg.embeddings.model,
      dimension: cfg.embeddings.dimension,
      baseUrl: cfg.embeddings.baseUrl,
      apiKey: env.EMBEDDING_API_KEY?.trim() ? env.EMBEDDING_API_KEY.trim() : null,
    }),
    onCausality: (blockId, summary) => causalityPerBlock.push({ blockId, ...summary }),
  });

  const result = await processor.processNovel(
    blocks.map((b) => ({ blockId: b.id, text: b.text, chapterIndex: b.chapterIndex, sectionIndex: b.index })),
  );

  // Chapter-completion sweep (owner cadence, 2026-10-23): old x old
  // pairs are reviewed only when a whole first-level node completes.
  // Completion is observed as full coverage of the file's blocks by
  // (merged in this run ∪ applied in earlier runs and skipped now),
  // with canon changed since the last sweep — in gate mode applies
  // land via `novel changeset approve` between runs, and the
  // post-apply EM pass marks that in matching.json (sweepPending).
  let emChapterSweep: { nominated: number; merged: number; distinct: number; uncertain: number } | null = null;
  const coveredBlocks = new Set([...result.mergedBlocks, ...skippedBlocks]);
  if (selectedBlocks.length > 0 && selectedBlocks.every((b) => coveredBlocks.has(b.id))) {
    const memory = await loadMatchMemory(novelDir);
    if (result.mergedBlocks.length > 0 || memory.sweepPending) {
      try {
        const summary = await runEntityMatching({
          novelDir,
          decisions: jevFromEnv(env),
          events: log.emit,
          data: {
            entities: await loadKnownEntities(),
            events: await bundle.loadFile<OntEvent>("events.jsonl"),
            scenes: await bundle.loadFile<Scene>("scenes.jsonl"),
            relations: await bundle.loadFile<Relation>("relations.jsonl"),
          },
        });
        emChapterSweep = {
          nominated: summary.nominated,
          merged: summary.merged.length,
          distinct: summary.distinct.length,
          uncertain: summary.uncertain.length,
        };
        const after = await loadMatchMemory(novelDir);
        await saveMatchMemory(novelDir, { ...after, sweepPending: false });
      } catch {
        emChapterSweep = null;
      }
    }
  }

  // Chapter-close causality sweep (same cadence as EM): old x old pairs
  // are judged only when a whole first-level node completes, or when
  // canon changed since the last sweep (gate-mode applies between runs
  // mark causality.json sweepPending via `novel changeset approve`).
  // Confident links land in a pending_review changeset for the gate —
  // the sweep never writes canon directly.
  let causalityChapterSweep: { changesetId: string | null; nominated: number; proposed: number; uncertain: number; rejected: number; embedded: number; embeddingLeg: boolean } | null = null;
  if (!opts.noCausality && selectedBlocks.length > 0 && selectedBlocks.every((b) => coveredBlocks.has(b.id))) {
    const causalityMemory = await readCausalityMemory(novelDir);
    if (result.mergedBlocks.length > 0 || causalityMemory.sweepPending) {
      try {
        const pass = await runCausalityPass({
          novelDir,
          decisions: jevFromEnv(env),
          embedder: loadEmbedder({
            provider: cfg.embeddings.provider,
            model: cfg.embeddings.model,
            dimension: cfg.embeddings.dimension,
            baseUrl: cfg.embeddings.baseUrl,
            apiKey: env.EMBEDDING_API_KEY?.trim() ? env.EMBEDDING_API_KEY.trim() : null,
          }),
        });
        let changesetId: string | null = null;
        if (pass.proposals.length > 0) {
          const changeset = {
            id: `cs_causality_sweep_${Date.now()}`,
            blockId: "causality-sweep",
            proposals: pass.proposals,
            status: "pending_review" as const,
            reviewNotes: {
              "causality-faculty": `Chapter-close sweep: ${pass.summary.nominated} nominated, ${pass.summary.proposed} proposed, ${pass.summary.uncertain} uncertain, ${pass.summary.rejected} rejected${pass.summary.embeddingLeg ? " (embedding leg on)" : " (graph patterns only)"}.`,
            },
            createdAt: new Date().toISOString(),
          };
          await saveChangeSet(novelDir, changeset);
          changesetId = changeset.id;
        }
        causalityChapterSweep = { changesetId, ...pass.summary };
        await clearCausalitySweepPending(novelDir);
      } catch {
        causalityChapterSweep = null;
      }
    }
  }

  let graph: Awaited<ReturnType<typeof buildGraphFromBundle>> | null = null;
  if (result.mergedBlocks.length > 0) {
    graph = await buildGraphFromBundle(
      ontologyDir,
      join(ontologyDir, "graph.lbug"),
      log.emit,
    );
  }

  // End of everything (blocks + chapter sweep + EM, cast stable):
  // portrait finalization. Best-effort and never fatal to ingest: no
  // album / no portraits file means nothing to do. Portraits only ever
  // bind to canon entities (entities.jsonl holds applied entities), so
  // a held block's not-yet-canon figures cannot claim a portrait early.
  let album: Awaited<ReturnType<typeof albumPortraits>> | null = null;
  try {
    album = await albumPortraits(novelDir, env);
    if (!album.portraitsFile) album = null;
  } catch {
    album = null;
  }

  return {
    status: "ok",
    novelDir,
    file,
    source,
    reviewMode: opts.autoApprove ? "auto-approve" : "gate",
    extraction: workModel ? "live" : "off",
    workModel: workModel?.modelId ?? null,
    blocksTotal: blocks.length,
    blocksInFile: allBlocks.length,
    skippedBlocks,
    mergedBlocks: result.mergedBlocks,
    stoppedAt: result.stoppedAt,
    stopReason: result.stopReason,
    entityMatching: { perBlock: emPerBlock, chapterSweep: emChapterSweep },
    causality: { perBlock: causalityPerBlock, chapterSweep: causalityChapterSweep },
    graph,
    album,
  };
}
