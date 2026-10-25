/**
 * Agent-path causality commands (Solidifier skill category).
 *
 * After a full run, the main agent — not Jev — adjudicates: it lists
 * candidates (the same hybrid nomination the systematic path uses), reads
 * the texts, and proposes links it judges causal. Proposals go through the
 * same semantic fact gate and apply machinery as every other proposal;
 * nothing here writes canon directly.
 *
 * - `novel causality candidates <novel-dir> [--unit ID] [--chapter N] [--limit N]`
 * - `novel causality propose <novel-dir> <from> <to> [--reason "..."]`
 * - `novel causality sweep <novel-dir>` (systematic Jev pass on demand)
 */

import { loadConfig } from "../../config.js";
import { loadEmbedder } from "../../../ground/connectors/embeddings.js";
import { jevFromEnv } from "../../../ground/connectors/jev.js";
import { saveChangeSet } from "../../../solidifier/merge/changesetStore.js";
import { nominateCausalCandidates, type CausalCandidate } from "../../../solidifier/causality/candidates.js";
import {
  clearCausalitySweepPending,
  ensureUnitVectors,
  runCausalityPass,
} from "../../../solidifier/causality/faculty.js";
import {
  alreadyLinked,
  compareOrder,
  loadCausalityUniverse,
} from "../../../solidifier/causality/units.js";
import type { ChangeProposal } from "../../../solidifier/merge/changeset.js";

function embedderFromEnv(env: NodeJS.ProcessEnv) {
  const cfg = loadConfig(env);
  return loadEmbedder({
    provider: cfg.embeddings.provider,
    model: cfg.embeddings.model,
    dimension: cfg.embeddings.dimension,
    baseUrl: cfg.embeddings.baseUrl,
    apiKey: env.EMBEDDING_API_KEY?.trim() ? env.EMBEDDING_API_KEY.trim() : null,
  });
}

export async function listCausalityCandidates(
  novelDir: string,
  opts: { unitId?: string; chapterIndex?: number; limit?: number; env?: NodeJS.ProcessEnv } = {},
): Promise<{
  candidates: (CausalCandidate & { fromKind: string; toKind: string; fromSummary: string; toSummary: string })[];
  embeddingLeg: boolean;
  embedded: number;
}> {
  const env = opts.env ?? process.env;
  const universe = await loadCausalityUniverse(novelDir);
  const { vectors, embedded } = await ensureUnitVectors(novelDir, universe, embedderFromEnv(env));
  const touched = opts.unitId ? new Set([opts.unitId]) : null;
  if (touched && !universe.byId.has(opts.unitId!)) throw new Error(`Unknown unit id ${opts.unitId}.`);
  let candidates = nominateCausalCandidates(universe, {
    touchedIds: touched,
    vectors: vectors.size > 0 ? vectors : undefined,
  });
  if (opts.chapterIndex !== undefined) {
    candidates = candidates.filter((candidate) => {
      const from = universe.byId.get(candidate.fromId);
      const to = universe.byId.get(candidate.toId);
      return from?.chapterIndex === opts.chapterIndex || to?.chapterIndex === opts.chapterIndex;
    });
  }
  if (opts.limit !== undefined) candidates = candidates.slice(0, opts.limit);
  return {
    candidates: candidates.map((candidate) => {
      const from = universe.byId.get(candidate.fromId)!;
      const to = universe.byId.get(candidate.toId)!;
      return {
        ...candidate,
        fromKind: from.kind,
        toKind: to.kind,
        fromSummary: from.summary || from.text.slice(0, 200),
        toSummary: to.summary || to.text.slice(0, 200),
      };
    }),
    embeddingLeg: vectors.size > 0,
    embedded,
  };
}

/**
 * Agent-adjudicated CAUSES proposal. The agent has judged this pair causal;
 * the gate still reviews it. Refuses self-links, already-linked pairs, and
 * pairs whose novel-sequence order contradicts the proposed direction
 * (the agent should swap from/to instead). Order-ambiguous pairs are
 * allowed — the agent adjudicates direction from the text.
 */
export async function proposeCausalityLink(
  novelDir: string,
  fromId: string,
  toId: string,
  opts: { reason?: string } = {},
): Promise<{ changesetId: string; proposalId: string; fromId: string; toId: string }> {
  const universe = await loadCausalityUniverse(novelDir);
  const from = universe.byId.get(fromId);
  const to = universe.byId.get(toId);
  if (!from) throw new Error(`Unknown from unit ${fromId}.`);
  if (!to) throw new Error(`Unknown to unit ${toId}.`);
  if (fromId === toId) throw new Error("A unit cannot cause itself.");
  if (alreadyLinked(universe, fromId, toId)) {
    throw new Error(`A CAUSES link already exists between ${fromId} and ${toId}.`);
  }
  const order = compareOrder(from, to, universe);
  if (order === 1) {
    throw new Error(
      `Novel-sequence order contradicts ${fromId} -> ${toId}: the to unit precedes the from unit. Swap from/to if the direction is reversed.`,
    );
  }
  const proposal: ChangeProposal = {
    id: `causality-agent_${fromId}_causes_${toId}`,
    kind: "add_relation",
    payload: {
      fromId,
      toId,
      type: "CAUSES",
      properties: {},
      // Agent assertion at the systematic threshold, not a Jev score.
      // The gate reviewer still judges the link; see reviewNotes.
      confidence: 0.85,
    },
    confidence: 0.85,
    provenance: {
      blockId: "causality-agent",
      sentenceIds: [...new Set([...from.sentenceIds, ...to.sentenceIds])],
      patchId: "causality-agent",
    },
  };
  const changeset = {
    id: `cs_causality_agent_${Date.now()}`,
    blockId: "causality-agent",
    proposals: [proposal],
    status: "pending_review" as const,
    reviewNotes: {
      "causality-agent": `Main-agent-adjudicated CAUSES link ${fromId} -> ${toId} (not a Jev verdict; confidence 0.85 marks the agent's assertion at the systematic threshold).${opts.reason ? ` Agent reason: ${opts.reason}` : ""}${order === null ? " Novel-sequence order is ambiguous for this pair; direction is the agent's judgment from the text." : ""}`,
    },
    createdAt: new Date().toISOString(),
  };
  await saveChangeSet(novelDir, changeset);
  return { changesetId: changeset.id, proposalId: proposal.id, fromId, toId };
}

/** On-demand systematic sweep: the Jev-determined pass, outside ingest. */
export async function runCausalitySweep(
  novelDir: string,
  opts: { env?: NodeJS.ProcessEnv; decisions?: import("../../../ground/connectors/jev.js").DecisionModel } = {},
): Promise<{
  changesetId: string | null;
  nominated: number;
  proposed: number;
  uncertain: number;
  rejected: number;
  embedded: number;
  embeddingLeg: boolean;
}> {
  const env = opts.env ?? process.env;
  const pass = await runCausalityPass({
    novelDir,
    decisions: opts.decisions ?? jevFromEnv(env),
    embedder: embedderFromEnv(env),
  });
  let changesetId: string | null = null;
  if (pass.proposals.length > 0) {
    const changeset = {
      id: `cs_causality_sweep_${Date.now()}`,
      blockId: "causality-sweep",
      proposals: pass.proposals,
      status: "pending_review" as const,
      reviewNotes: {
        "causality-faculty": `On-demand sweep: ${pass.summary.nominated} nominated, ${pass.summary.proposed} proposed, ${pass.summary.uncertain} uncertain, ${pass.summary.rejected} rejected${pass.summary.embeddingLeg ? " (embedding leg on)" : " (graph patterns only)"}.`,
      },
      createdAt: new Date().toISOString(),
    };
    await saveChangeSet(novelDir, changeset);
    changesetId = changeset.id;
  }
  await clearCausalitySweepPending(novelDir);
  return { changesetId, ...pass.summary };
}

export function causalityCommandsHelp(): Record<string, string> {
  return {
    "novel causality candidates <novel-dir> [--unit ID] [--chapter N] [--limit N]":
      "List hybrid-nominated CAUSES candidates (graph patterns + embedding top-K) for agent adjudication. No proposals are created.",
    "novel causality propose <novel-dir> <from> <to> [--reason \"...\"]":
      "Agent-adjudicated CAUSES proposal (event or dialogue-card ids). Lands in a pending_review changeset for the gate; refuses self-links, existing links, and order-contradicted directions.",
    "novel causality sweep <novel-dir>":
      "On-demand systematic sweep: Jev-determined CAUSES pass over the whole universe (same machinery as the ingest chapter-close sweep).",
  };
}

// Re-exported for cli.ts help assembly without importing the whole module twice.
export const CAUSALITY_COMMANDS_HELP = causalityCommandsHelp();
