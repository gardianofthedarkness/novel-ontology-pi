import type { ChangeProposal } from "../../solidifier/merge/changeset.js";
import type { IllustrationKind } from "../../digger/intake/album/album.js";

/** Transport facts, not the Playground's layout-dependent view model. */
export type ProcessingEvent =
  | { type: "block.started"; blockId: string }
  | { type: "sectioned"; blockId: string; sentences: number }
  | { type: "proposal.added"; changesetId: string; proposal: Pick<ChangeProposal, "id" | "kind" | "confidence" | "provenance"> }
  | { type: "changeset.pending" | "changeset.approved" | "changeset.held" | "changeset.revision_requested" | "changeset.accumulating"; changesetId: string; proposalIds: string[] }
  | { type: "changeset.applied"; changesetId: string; target: "store"; processed: number; unsupportedProposalIds: string[]; deferredFactIds?: string[]; rejectedFactIds?: string[]; verifiedFacts?: number }
  | { type: "changeset.merged"; changesetId: string; target: "store" }
  | { type: "graph.rebuilt"; counts: { entities: number; events: number; scenes: number; relations: number; branches: number } }
  | { type: "draft.updated"; blockId: string; patchId: string; stage: "miniloop" | "extraction" | "gate"; touchedIds?: string[] }
  /** blockId is omitted for work across the whole novel (a time-place run, a matching sweep). */
  | { type: "faculty.activity"; blockId?: string; callId: string; faculty: string; system: "system1" | "system2" | "work"; status: "started" | "completed" | "failed" }
  | { type: "entity.merged"; keepId: string; dropId: string }
  | { type: "entity.distinct"; aId: string; bId: string }
  /** Album pre-process: intake-known picture anchors for one block (sentence identities, not canon). */
  | { type: "album.anchored"; blockId: string; pictures: { id: string; asset: string; kind: IllustrationKind; sentenceId: string | null }[] };

export interface EventRecord {
  version: 1;
  /** Zero-padded decimal byte offset immediately after this record's newline. */
  id: string;
  timestamp: string;
  event: ProcessingEvent;
}

export type EventSink = (event: ProcessingEvent) => Promise<void>;

/** Explicit projection: never serialize model objects, errors, payload properties or review notes. */
export function projectEvent(event: ProcessingEvent): ProcessingEvent {
  switch (event.type) {
    case "block.started": return { type: event.type, blockId: event.blockId };
    case "sectioned": return { type: event.type, blockId: event.blockId, sentences: event.sentences };
    case "proposal.added": {
      const p = event.proposal;
      return { type: event.type, changesetId: event.changesetId, proposal: {
        id: p.id, kind: p.kind, confidence: p.confidence,
        provenance: { blockId: p.provenance.blockId, sentenceIds: [...p.provenance.sentenceIds], patchId: p.provenance.patchId },
      } };
    }
    case "changeset.pending": case "changeset.approved": case "changeset.held":
    case "changeset.revision_requested": case "changeset.accumulating":
      return { type: event.type, changesetId: event.changesetId, proposalIds: [...event.proposalIds] };
    case "changeset.applied": return { type: event.type, changesetId: event.changesetId, target: "store", processed: event.processed, unsupportedProposalIds: [...event.unsupportedProposalIds], ...(event.deferredFactIds ? { deferredFactIds: [...event.deferredFactIds], rejectedFactIds: [...event.rejectedFactIds ?? []], verifiedFacts: event.verifiedFacts } : {}) };
    case "changeset.merged": return { type: event.type, changesetId: event.changesetId, target: "store" };
    case "graph.rebuilt": {
      const c = event.counts;
      return { type: event.type, counts: { entities: c.entities, events: c.events, scenes: c.scenes, relations: c.relations, branches: c.branches } };
    }
    case "draft.updated": return { type: event.type, blockId: event.blockId, patchId: event.patchId, stage: event.stage, ...(event.touchedIds ? { touchedIds: [...event.touchedIds] } : {}) };
    case "faculty.activity": return { type: event.type, ...(event.blockId ? { blockId: event.blockId } : {}), callId: event.callId, faculty: event.faculty, system: event.system, status: event.status };
    case "entity.merged": return { type: event.type, keepId: event.keepId, dropId: event.dropId };
    case "entity.distinct": return { type: event.type, aId: event.aId, bId: event.bId };
    case "album.anchored": return { type: event.type, blockId: event.blockId, pictures: event.pictures.map((p) => ({ id: p.id, asset: p.asset, kind: p.kind, sentenceId: p.sentenceId })) };
    default: throw new Error("Unsupported processing event");
  }
}
