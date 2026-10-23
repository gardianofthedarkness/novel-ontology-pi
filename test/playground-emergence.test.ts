import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createDraftProjector,
  type WorkingDraftView,
} from "../apps/playground/src/events/draftProject.js";
import type { PlaygroundEvent } from "../apps/playground/src/types.js";

const draft = (partial: Partial<WorkingDraftView>): WorkingDraftView => ({
  version: 1,
  blockId: "b0001",
  chapterIndex: 2,
  stage: "miniloop",
  patchId: "scene-boundary",
  updatedAt: "2026-10-22T00:00:00.000Z",
  proposals: [],
  sceneSpans: [],
  dialogueUnits: [],
  turns: [],
  completedScenes: 0,
  totalScenes: 0,
  ...partial,
});

const proposal = (
  id: string,
  kind: string,
  payload: Record<string, unknown>,
): WorkingDraftView["proposals"][number] => ({
  id,
  kind,
  payload,
  confidence: 0.9,
  provenance: { blockId: "b0001", sentenceIds: ["b0001_s0000"], patchId: "extraction" },
});

const added = (events: PlaygroundEvent[]) =>
  events.filter((e) => e.type === "proposal.added") as Extract<
    PlaygroundEvent,
    { type: "proposal.added" }
  >[];

test("emergence: scene spans and dialogue units emerge once, in order, as ghosts in the chapter", () => {
  const projector = createDraftProjector();
  const snap = draft({
    sceneSpans: [
      ["b0001_s0000", "b0001_s0001"],
      ["b0001_s0002", "b0001_s0003"],
    ],
    dialogueUnits: [["b0001_s0002", "b0001_s0003"]],
    turns: [{ speakerId: null, addresseeId: null, sentenceIds: ["b0001_s0002"] }],
  });
  const events = projector.ingest(snap);
  const nodes = added(events);
  assert.deepEqual(
    nodes.map((n) => n.node.id),
    [
      "draft:b0001:scene:b0001_s0000",
      "draft:b0001:scene:b0001_s0002",
      "draft:b0001:dialogue:b0001_s0002",
    ],
  );
  assert.ok(nodes.every((n) => n.node.state === "proposed" && n.node.parent === "chapter_2"));
  // Scene chain flow edge + dialogue containment edge ride along.
  const edges = nodes.flatMap((n) => n.edges);
  assert.ok(edges.some((e) => e.kind === "flow" && e.to === "draft:b0001:scene:b0001_s0002"));
  assert.ok(edges.some((e) => e.kind === "contains" && e.to === "draft:b0001:dialogue:b0001_s0002"));
  // Re-ingesting the same snapshot emits nothing new.
  assert.deepEqual(projector.ingest(snap), []);
});

test("emergence: proposals become ghost nodes (entities before events), relations ride their source node, gate arrives once", () => {
  const projector = createDraftProjector();
  const events = projector.ingest(
    draft({
      stage: "gate",
      patchId: "merge-gate",
      proposals: [
        proposal("p2", "create_event", {
          id: "evt_1",
          summaryEn: "美琴走进车站",
          eventType: "action",
          chronologicalOrder: 7,
        }),
        proposal("p1", "upsert_entity", {
          id: "char_1",
          kind: "Character",
          names: [{ text: "御坂美琴", kind: "canonical" }],
        }),
        proposal("p3", "add_relation", { fromId: "char_1", toId: "evt_1", type: "CAUSES" }),
        proposal("p4", "set_state_change", { characterId: "char_1" }),
      ],
    }),
  );
  const nodes = added(events);
  assert.deepEqual(nodes.map((n) => n.node.id), ["char_1", "evt_1", "char_1"]);
  assert.equal(nodes[0].node.label, "御坂美琴");
  assert.equal(nodes[0].node.kind, "character");
  assert.equal(nodes[1].node.label, "美琴走进车站");
  const relEdge = nodes[2].edges.find((e) => e.kind === "flow");
  assert.equal(relEdge?.relationLabel, "CAUSES");
  // Non-node proposals surface as decision-feed lines, never silently.
  assert.ok(events.some((e) => e.type === "verdict" && e.text.includes("set_state_change")));
  // Gate arrival is the last event, carrying every emerged node id.
  const last = events.at(-1)!;
  assert.equal(last.type, "changeset.pending");
  if (last.type === "changeset.pending") {
    assert.deepEqual(new Set(last.nodeIds), new Set(["char_1", "evt_1"]));
  }
  // Held translation: proposal ids resolve to their node ids.
  assert.deepEqual(projector.nodeIdsForProposals(["p1", "p2", "p4"]), ["char_1", "evt_1"]);
});

test("emergence: a revision round re-emerges the block's ghosts", () => {
  const projector = createDraftProjector();
  const gateSnap = draft({
    stage: "gate",
    proposals: [
      proposal("p1", "upsert_entity", {
        id: "char_1",
        kind: "Character",
        names: [{ text: "白井黑子", kind: "canonical" }],
      }),
    ],
  });
  assert.equal(added(projector.ingest(gateSnap)).length, 1);
  projector.markRevised("cs_b0001");
  const round2 = projector.ingest(
    draft({
      stage: "miniloop",
      proposals: [
        proposal("p9", "upsert_entity", {
          id: "char_1",
          kind: "Character",
          names: [{ text: "白井黑子", kind: "canonical" }],
        }),
      ],
    }),
  );
  assert.equal(added(round2).length, 1);
  assert.deepEqual(projector.nodeIdsForProposals(["p9"]), ["char_1"]);
});
