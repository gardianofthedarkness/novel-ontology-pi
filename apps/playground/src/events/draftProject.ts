import type { PlaygroundEvent, WorldEdge, WorldNode } from "../types.js";

/**
 * Draft projector — Phase B (decision #15): the agent-activity live view.
 *
 * The CLI's processing stream carries transport facts only, so a live
 * `proposal.added` fact has no payload to render. The WORKING DRAFT is
 * the live view's source of truth: the block processor republishes it
 * after every decision batch (`<novelDir>/working/<blockId>.json`), and
 * the watch stream announces each republication as `draft.updated`.
 *
 * This projector diffs successive draft snapshots of a block and emits
 * the playground events that make new nodes EMERGE in place, batch by
 * batch: Jev's scene spans and dialogue units first (as draft ghosts),
 * then extraction's proposals as ghost nodes/edges in the chapter's
 * interior — and, when the draft reaches the gate, the changeset's
 * arrival. Node conventions (ids, labels, kind mapping, parenting)
 * mirror the pi-review snapshot projection so the live view and the
 * review snapshot show the same world.
 *
 * Gate verdicts themselves keep arriving over the transport stream
 * (held / approved / merged); `nodeIdsForProposals` lets the SSE source
 * translate their proposal ids into the node ids emitted here, so a
 * held changeset lights up its actual ghost nodes.
 */

/** Mirror of the CLI's WorkingDraft (src/processing/draft.ts). */
export interface WorkingDraftView {
  version: 1;
  blockId: string;
  chapterIndex: number;
  stage: "miniloop" | "extraction" | "gate";
  patchId: string;
  updatedAt: string;
  proposals: DraftProposal[];
  sceneSpans: string[][];
  dialogueUnits: string[][];
  turns: { speakerId: string | null; addresseeId: string | null; sentenceIds: string[] }[];
  completedScenes: number;
  totalScenes: number;
}

/** Mirror of the CLI's ChangeProposal (transport-unsafe fields omitted). */
export interface DraftProposal {
  id: string;
  kind: string;
  payload: Record<string, any>;
  confidence: number;
  provenance: { blockId: string; sentenceIds: string[]; patchId: string };
}

interface BlockState {
  emittedNodes: Map<string, WorldNode>;
  emittedEdges: Set<string>;
  processedProposals: Set<string>;
  proposalNodes: Map<string, string[]>;
  gateEmitted: boolean;
  seq: number;
}

const text = (value: unknown, max = 100): string =>
  String(value ?? "").replace(/[\u0000-\u001f]/g, " ").slice(0, max);

const pct = (confidence: number) => `${Math.round(confidence * 100)}%`;

const sentenceOrdinal = (id: string | undefined): number => {
  const n = Number(id?.split("_s")[1] ?? 0);
  return Number.isFinite(n) ? n : 0;
};

export interface DraftProjector {
  /** Diff one draft snapshot; returns the emergence events it causes. */
  ingest(draft: WorkingDraftView): PlaygroundEvent[];
  /** Node ids a set of proposal ids produced (held/revision translation). */
  nodeIdsForProposals(proposalIds: string[]): string[];
  /** A revision was requested: the block re-runs, its ghosts re-emerge. */
  markRevised(changesetId: string): void;
}

export function createDraftProjector(): DraftProjector {
  const blocks = new Map<string, BlockState>();

  const fresh = (): BlockState => ({
    emittedNodes: new Map(),
    emittedEdges: new Set(),
    processedProposals: new Set(),
    proposalNodes: new Map(),
    gateEmitted: false,
    seq: 0,
  });

  function ingest(draft: WorkingDraftView): PlaygroundEvent[] {
    const changesetId = `cs_${draft.blockId}`;
    const parent = `chapter_${draft.chapterIndex}`;
    let st = blocks.get(draft.blockId);
    // A draft that returns to the miniloop after reaching the gate is
    // a revision round: forget the round's emissions so the revised
    // ghosts emerge again (the app replaces nodes by id).
    if (st && st.gateEmitted && draft.stage === "miniloop") {
      st = fresh();
      blocks.set(draft.blockId, st);
    }
    if (!st) {
      st = fresh();
      blocks.set(draft.blockId, st);
    }
    const state = st;
    const out: PlaygroundEvent[] = [];

    const position = (): { lanePos: [number, number, number]; interiorPos: [number, number, number] } => {
      const k = state.seq++;
      const angle = k * 2.399963;
      const r = 30 * Math.sqrt(k + 1);
      return {
        lanePos: [draft.chapterIndex * 210 + (k % 5) * 30, -170 - Math.floor(k / 5) * 34, 0],
        interiorPos: [Math.cos(angle) * r, Math.sin(angle) * r, 0],
      };
    };

    const emitNode = (node: WorldNode, edges: WorldEdge[]): void => {
      const freshEdges = edges.filter((e) => !state.emittedEdges.has(e.id));
      for (const e of freshEdges) state.emittedEdges.add(e.id);
      state.emittedNodes.set(node.id, node);
      out.push({ type: "proposal.added", changesetId, node, edges: freshEdges });
    };

    const ghostNode = (
      partial: Partial<WorldNode> & Pick<WorldNode, "id" | "label" | "kind">,
    ): WorldNode => ({
      state: "proposed",
      parent,
      lane: "canon",
      chrono: state.seq,
      ...position(),
      ...partial,
    });

    // 1) Jev's scene spans — the tiling itself emerging, span by span.
    let prevSpanId: string | null = null;
    draft.sceneSpans.forEach((span, i) => {
      if (!span.length) return;
      const id = `draft:${draft.blockId}:scene:${span[0]}`;
      if (!state.emittedNodes.has(id)) {
        const edges: WorldEdge[] = [];
        if (prevSpanId && state.emittedNodes.has(prevSpanId)) {
          edges.push({
            id: `draft-edge:flow:${prevSpanId}:${id}`,
            from: prevSpanId,
            to: id,
            kind: "flow",
            state: "proposed",
            parent,
          });
        }
        emitNode(
          ghostNode({
            id,
            label: `Scene draft ${i + 1} · Jev`,
            subLabel: `scene · proposed · ${span.length} sentences`,
            kind: "scene",
            chrono: sentenceOrdinal(span[0]),
          }),
          edges,
        );
      }
      prevSpanId = id;
    });

    // 2) Dialogue units inside those spans, with speaker links when
    //    the speaker is a node this projector has already emitted.
    for (const unit of draft.dialogueUnits) {
      if (!unit.length) continue;
      const id = `draft:${draft.blockId}:dialogue:${unit[0]}`;
      if (state.emittedNodes.has(id)) continue;
      const span = draft.sceneSpans.find((s) => s.includes(unit[0]));
      const turn = draft.turns.find((t) => t.sentenceIds.includes(unit[0]));
      const edges: WorldEdge[] = [];
      if (span?.length) {
        const sceneId = `draft:${draft.blockId}:scene:${span[0]}`;
        if (state.emittedNodes.has(sceneId)) {
          edges.push({
            id: `draft-edge:contains:${sceneId}:${id}`,
            from: sceneId,
            to: id,
            kind: "contains",
            state: "proposed",
            parent,
          });
        }
      }
      if (turn?.speakerId && state.emittedNodes.has(turn.speakerId)) {
        edges.push({
          id: `draft-edge:speaks:${turn.speakerId}:${id}`,
          from: turn.speakerId,
          to: id,
          kind: "speaks",
          state: "proposed",
          parent,
        });
      }
      emitNode(
        ghostNode({
          id,
          label: `Dialogue · ${unit.length} sentence${unit.length === 1 ? "" : "s"}`,
          subLabel: `dialogue · proposed · ${turn?.speakerId ? "speaker attributed" : "speaker unresolved"}`,
          kind: "dialogue",
          chrono: sentenceOrdinal(unit[0]),
        }),
        edges,
      );
    }

    // 3) Extraction proposals — entities & scenes first (they parent
    //    and anchor), then events, then relations, then the rest as
    //    decision-feed lines so nothing vanishes silently.
    const proposals = draft.proposals.filter((p) => !state.processedProposals.has(p.id));
    const order = (p: DraftProposal): number =>
      p.kind === "upsert_entity" || p.kind === "create_scene"
        ? 0
        : p.kind === "create_event"
          ? 1
          : p.kind === "add_relation"
            ? 2
            : 3;
    proposals.sort((a, b) => order(a) - order(b));

    for (const p of proposals) {
      state.processedProposals.add(p.id);
      const payload = p.payload ?? {};
      const produced: string[] = [];
      state.proposalNodes.set(p.id, produced);

      if (p.kind === "upsert_entity") {
        if (payload.needsExtraction && payload.candidateName) {
          const id = `draft:${p.id}`;
          if (!state.emittedNodes.has(id)) {
            emitNode(
              ghostNode({
                id,
                label: text(`${payload.candidateName} · candidate`),
                subLabel: `Character · proposed · unconfirmed name`,
                kind: "character",
              }),
              [],
            );
          }
          produced.push(id);
        } else if (payload.id) {
          const names = (payload.names ?? []) as { text?: string; kind?: string }[];
          const label = names.find((n) => n.kind === "canonical")?.text ?? names[0]?.text ?? payload.id;
          if (!state.emittedNodes.has(payload.id)) {
            emitNode(
              ghostNode({
                id: payload.id,
                label: text(label),
                subLabel: `${payload.kind ?? "entity"} · proposed · ${payload.id}`,
                kind: payload.kind === "Character" ? "character" : "location",
              }),
              [],
            );
          }
          produced.push(payload.id);
        }
      } else if (p.kind === "create_scene" && payload.id) {
        if (!state.emittedNodes.has(payload.id)) {
          emitNode(
            ghostNode({
              id: payload.id,
              label: text(payload.label ?? `Scene ${payload.id}`),
              subLabel: `scene · proposed · ${payload.id}`,
              kind: "scene",
            }),
            [],
          );
        }
        produced.push(payload.id);
      } else if (p.kind === "create_event" && payload.id) {
        if (!state.emittedNodes.has(payload.id)) {
          emitNode(
            ghostNode({
              id: payload.id,
              label: text(payload.summaryEn ?? payload.id),
              subLabel: `event · proposed · ${payload.id}`,
              kind: payload.eventType === "dialogue" ? "dialogue" : "event",
              chrono: Number(payload.chronologicalOrder ?? state.seq),
            }),
            [],
          );
        }
        produced.push(payload.id);
      } else if (p.kind === "add_relation") {
        const from = payload.fromId as string | undefined;
        const to = payload.toId as string | undefined;
        const fromNode = from ? state.emittedNodes.get(from) : undefined;
        // The edge rides on a re-emission of its source node (the app
        // replaces nodes by id, so this never duplicates the node).
        if (from && to && fromNode && state.emittedNodes.has(to)) {
          const edge: WorldEdge = {
            id: `draft-edge:relation:${p.id}`,
            from,
            to,
            kind: payload.type === "CAUSES" || payload.type === "PRECEDES" ? "flow" : "speaks",
            state: "proposed",
            parent,
            relationLabel: String(payload.type ?? ""),
          };
          if (!state.emittedEdges.has(edge.id)) emitNode(fromNode, [edge]);
        }
      } else {
        out.push({
          type: "verdict",
          patch: p.provenance?.patchId ?? "extraction",
          text: `◈ ${p.kind} proposed · ${pct(p.confidence ?? 0)}`,
        });
      }
    }

    // 4) The gate arrival, once per round.
    if (draft.stage === "gate" && !state.gateEmitted) {
      state.gateEmitted = true;
      out.push({
        type: "changeset.pending",
        changesetId,
        label: `ChangeSet ${changesetId}`,
        nodeIds: [...state.emittedNodes.keys()],
      });
    }
    return out;
  }

  return {
    ingest,
    nodeIdsForProposals(proposalIds: string[]): string[] {
      const ids: string[] = [];
      for (const st of blocks.values()) {
        for (const pid of proposalIds) {
          const nodes = st.proposalNodes.get(pid);
          if (nodes) ids.push(...nodes);
        }
      }
      return [...new Set(ids)];
    },
    markRevised(changesetId: string): void {
      // The block re-runs from scratch: forget the round entirely so
      // the revised ghosts emerge again (the app replaces by id).
      blocks.delete(changesetId.replace(/^cs_/, ""));
    },
  };
}
