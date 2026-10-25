/**
 * Causality faculty — systematic path (Jev-determined) + shared builders.
 *
 * Per-block: called with touchedIds = the block's new event + dialogue-card
 * ids, so only pairs touching new units are judged (EM precedent). Sweep:
 * called with no touchedIds, so every unlinked pair in the universe is
 * eligible. Both paths funnel through the same gate/apply machinery as every
 * other proposal — the faculty never writes canon directly.
 *
 * Provenance constraint (gate design): a per-block changeset's reviewSource
 * is that block's sentences, so a per-block proposal may only cite
 * sentences from its own block. Cross-block pairs therefore cite the NEW
 * unit's sentences; the Jev dossier (both units' texts) is summarized in the
 * changeset reviewNotes by the caller. Sweep changesets carry no
 * reviewSource, so sweep proposals cite the union of both units' sentences.
 *
 * Failures (Jev or embedder) throw: the per-block hook catches them and
 * records a reviewNote, the sweep/CLI surfaces them. A pass never
 * half-applies.
 */

import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { ChangeProposal } from "../merge/changeset.js";
import type { DecisionModel } from "../../ground/connectors/jev.js";
import {
  appendEmbeddingSidecar,
  loadEmbeddingSidecar,
  updateManifestEmbedding,
  type Embedder,
  type EmbeddingRecord,
} from "../../ground/connectors/embeddings.js";
import { nominateCausalCandidates } from "./candidates.js";
import { checkCausalLinks, type CausalVerdict } from "./checklist.js";
import { loadCausalityUniverse, type UniverseExtras } from "./units.js";

export interface CausalitySummary {
  nominated: number;
  proposed: number;
  uncertain: number;
  rejected: number;
  /** Units newly embedded during this pass (0 when no embedder configured). */
  embedded: number;
  /** Whether the embedding leg ran (embedder configured and vectors present). */
  embeddingLeg: boolean;
  /** Whether the graph-pattern leg ran (always, when units exist). */
  graphLeg: boolean;
}

export interface CausalityPassInput {
  novelDir: string;
  decisions: DecisionModel;
  embedder?: Embedder | null;
  /** Per-block mode: only pairs touching these unit ids. Null = full sweep. */
  touchedIds?: Set<string> | null;
  extras?: UniverseExtras;
  /** Provenance block id for proposals. Defaults to "causality-sweep". */
  provenanceBlockId?: string;
}

export interface CausalityPassResult {
  proposals: ChangeProposal[];
  summary: CausalitySummary;
  verdicts: CausalVerdict[];
}

/** Build one systematic CAUSES proposal from a confident verdict. */
export function causalityProposal(
  verdict: CausalVerdict,
  provenance: { blockId: string; sentenceIds: string[] },
): ChangeProposal {
  return {
    id: `causality_${verdict.fromId}_causes_${verdict.toId}`,
    kind: "add_relation",
    payload: {
      fromId: verdict.fromId,
      toId: verdict.toId,
      type: "CAUSES",
      properties: {},
      confidence: verdict.causalScore,
    },
    confidence: verdict.causalScore,
    provenance: {
      blockId: provenance.blockId,
      sentenceIds: provenance.sentenceIds,
      patchId: "causality-faculty",
    },
  };
}

/**
 * Ensure every unit with text has a sidecar vector: load the cached sidecar,
 * embed the missing units (batched) when an embedder is configured, append
 * the new records, and record model + dimension in the bundle manifest.
 * Throws on embedder failure — callers decide whether that is fatal.
 */
export async function ensureUnitVectors(
  novelDir: string,
  universe: { units: { id: string; kind: "event" | "dialogue"; text: string }[]; byId: Map<string, unknown> },
  embedder: Embedder | null,
): Promise<{ vectors: Map<string, number[]>; embedded: number }> {
  const ontologyDir = joinOntologyDir(novelDir);
  const sidecar = await loadEmbeddingSidecar(ontologyDir);
  const vectors = new Map<string, number[]>();
  for (const [id, record] of sidecar) if (universe.byId.has(id)) vectors.set(id, record.vector);
  let embedded = 0;
  if (embedder) {
    const missing = universe.units.filter((unit) => !vectors.has(unit.id) && unit.text.trim().length > 0);
    if (missing.length > 0) {
      const newRecords: EmbeddingRecord[] = [];
      for (let start = 0; start < missing.length; start += 100) {
        const batch = missing.slice(start, start + 100);
        const batchVectors = await embedder.embed(batch.map((unit) => unit.text));
        batch.forEach((unit, index) => {
          vectors.set(unit.id, batchVectors[index]);
          newRecords.push({
            id: unit.id,
            kind: unit.kind,
            model: embedder.model,
            dimension: batchVectors[index].length,
            vector: batchVectors[index],
          });
        });
      }
      await appendEmbeddingSidecar(ontologyDir, newRecords);
      embedded = newRecords.length;
      // Prefer the embedder's reported dimension; fall back to the
      // vectors just written (embedders that only know it post-call).
      const dimension = embedder.dimension ?? (newRecords.length ? newRecords[0].dimension : null);
      if (dimension !== null) {
        await updateManifestEmbedding(ontologyDir, embedder.model, dimension);
      }
    }
  }
  return { vectors, embedded };
}

export async function runCausalityPass(input: CausalityPassInput): Promise<CausalityPassResult> {
  const universe = await loadCausalityUniverse(input.novelDir, input.extras ?? {});
  const { vectors, embedded } = await ensureUnitVectors(input.novelDir, universe, input.embedder ?? null);

  const candidates = nominateCausalCandidates(universe, {
    touchedIds: input.touchedIds ?? null,
    vectors: vectors.size > 0 ? vectors : undefined,
  });
  const verdicts = await checkCausalLinks(input.decisions, candidates, universe);

  const provenanceBlockId = input.provenanceBlockId ?? "causality-sweep";
  const proposals: ChangeProposal[] = [];
  for (const verdict of verdicts) {
    if (verdict.verdict !== "confident") continue;
    const from = universe.byId.get(verdict.fromId);
    const to = universe.byId.get(verdict.toId);
    if (!from || !to) continue;
    // Per-block passes cite only in-block (touched) sentences; sweeps cite both.
    const touched = input.touchedIds ?? null;
    const sentenceIds = touched
      ? [...new Set([
          ...(touched.has(verdict.fromId) ? from.sentenceIds : []),
          ...(touched.has(verdict.toId) ? to.sentenceIds : []),
        ])]
      : [...new Set([...from.sentenceIds, ...to.sentenceIds])];
    proposals.push(causalityProposal(verdict, { blockId: provenanceBlockId, sentenceIds }));
  }

  return {
    proposals,
    verdicts,
    summary: {
      nominated: candidates.length,
      proposed: proposals.length,
      uncertain: verdicts.filter((v) => v.verdict === "uncertain").length,
      rejected: verdicts.filter((v) => v.verdict === "rejected").length,
      embedded,
      embeddingLeg: vectors.size > 0,
      graphLeg: universe.units.length > 0,
    },
  };
}

/** Sweep-pending flag file: <novelDir>/causality.json. */
export interface CausalityMemory {
  sweepPending: boolean;
}

export function causalityMemoryPath(novelDir: string): string {
  return joinOntologyDir(novelDir) + "/causality.json";
}

function joinOntologyDir(novelDir: string): string {
  return join(novelDir, "ontology");
}

export async function markCausalitySweepPending(novelDir: string): Promise<void> {
  const path = causalityMemoryPath(novelDir);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, JSON.stringify({ sweepPending: true }, null, 2) + "\n", "utf8");
}

export async function readCausalityMemory(novelDir: string): Promise<CausalityMemory> {
  try {
    const parsed = JSON.parse(await readFile(causalityMemoryPath(novelDir), "utf8")) as CausalityMemory;
    return { sweepPending: parsed.sweepPending === true };
  } catch {
    return { sweepPending: false };
  }
}

export async function clearCausalitySweepPending(novelDir: string): Promise<void> {
  try {
    await writeFile(causalityMemoryPath(novelDir), JSON.stringify({ sweepPending: false }, null, 2) + "\n", "utf8");
  } catch {
    // Best effort; a stale flag only triggers one extra sweep.
  }
}
