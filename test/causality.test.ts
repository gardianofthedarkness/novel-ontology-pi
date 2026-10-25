/**
 * Causality faculty tests — synthetic fixtures only (no commercial text).
 *
 * Covers: uniform search units + novel-sequence ordering, hybrid candidate
 * generation (graph legs + embedding leg, already-linked exclusion),
 * the Jev checklist verdicts (confident / contradiction-uncertain /
 * rejected), the faculty pass end-to-end (proposals through the gate
 * shape, sidecar + manifest writes), the embeddings client, and the
 * gate's acceptance of dialogue-card CAUSES endpoints.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockDecisionModel, type DecisionModel } from "../src/ground/connectors/jev.js";
import {
  cosineSimilarity,
  loadEmbedder,
  loadEmbeddingSidecar,
  OpenAICompatibleEmbedder,
  topKSimilar,
} from "../src/ground/connectors/embeddings.js";
import { nominateCausalCandidates } from "../src/solidifier/causality/candidates.js";
import { checkCausalLinks } from "../src/solidifier/causality/checklist.js";
import { runCausalityPass } from "../src/solidifier/causality/faculty.js";
import {
  alreadyLinked,
  compareOrder,
  loadCausalityUniverse,
} from "../src/solidifier/causality/units.js";
import { materializeSemantic, semanticFacts, semanticRevision, validateStructure } from "../src/solidifier/merge/semantic.js";
import { newChangeSet } from "../src/solidifier/merge/changeset.js";
import type { Entity, OntEvent, Relation, Scene, StateChange } from "../src/ground/ontology/types.js";

const entities: Entity[] = [
  { id: "char_a", kind: "Character", names: [{ text: "A", lang: "", kind: "canonical" }], properties: {}, confidence: 1 },
  { id: "char_b", kind: "Character", names: [{ text: "B", lang: "", kind: "canonical" }], properties: {}, confidence: 1 },
];

function event(
  id: string,
  chapterIndex: number,
  chronologicalOrder: number,
  actors: string[],
  sentenceIds: string[],
  summaryEn: string,
): OntEvent {
  return {
    id,
    timelineId: "tl_canon",
    chapterIndex,
    chronologicalOrder,
    summaryEn,
    eventType: "action",
    importance: 0.5,
    primaryActors: actors,
    affectedCharacters: [],
    evidence: { sentenceIds, text: summaryEn },
    confidence: 1,
  };
}

const scenes: Scene[] = [
  {
    id: "sc_1",
    chapterIndex: 0,
    sentenceIds: ["s1", "s2", "s3", "s4"],
    charactersPresent: ["char_a"],
    charactersMentioned: [],
    turns: [],
    dialogues: [{ id: "card_1", sentenceIds: ["s3"], participantIds: ["char_a"], summary: "A speaks." }],
    locationId: "loc_1",
  },
  {
    id: "sc_2",
    chapterIndex: 0,
    sentenceIds: ["s5", "s6", "s7", "s8"],
    charactersPresent: ["char_b"],
    charactersMentioned: [],
    turns: [],
    dialogues: [{ id: "card_2", sentenceIds: ["s7"], participantIds: ["char_b"], summary: "B answers." }],
    locationId: "loc_1",
  },
  {
    id: "sc_3",
    chapterIndex: 1,
    sentenceIds: ["s9", "s10"],
    charactersPresent: ["char_a"],
    charactersMentioned: [],
    turns: [],
    dialogues: [],
    locationId: "loc_2",
  },
];

const events: OntEvent[] = [
  event("ev_1", 0, 1, ["char_a"], ["s1"], "A enters."),
  event("ev_2", 0, 2, ["char_a", "char_b"], ["s5"], "A meets B."),
  event("ev_3", 0, 3, ["char_b"], ["s6"], "B leaves."),
  event("ev_4", 1, 4, ["char_a"], ["s9"], "A returns home."),
];

const stateChanges: StateChange[] = [
  {
    id: "st_1",
    characterId: "char_b",
    afterEventId: "ev_1",
    emotions: {},
    knowledgeAdd: ["A arrived"],
    goalsAdd: [],
    relationships: {},
    location: null,
    possessionsAdd: [],
    possessionsRemove: [],
  },
];

async function writeNovelDir(
  parent: string,
  opts: { relations?: Relation[] } = {},
): Promise<string> {
  const dir = join(parent, "novel");
  await mkdir(join(dir, "ontology"), { recursive: true });
  const write = async (file: string, rows: unknown[]) =>
    writeFile(join(dir, "ontology", file), rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  await writeFile(join(dir, "ontology", "manifest.json"), JSON.stringify({ version: 1, embeddingModel: null, embeddingDimension: null }), "utf8");
  await write("entities.jsonl", entities);
  await write("events.jsonl", events);
  await write("scenes.jsonl", scenes);
  await write("relations.jsonl", opts.relations ?? []);
  await write("state-changes.jsonl", stateChanges);
  return dir;
}

/** Decision stub: every causal question scores `causal`, every succession question `succession`. */
function stubDecisions(causal: number, succession: number): DecisionModel {
  return {
    modelId: "stub-jev",
    decide: async (_state, questions) =>
      questions.map((question) => ({
        key: question.key,
        value: question.key.startsWith("causal:") ? causal : succession,
      })),
  };
}

test("causality units: events and dialogue cards are uniform units on the novel sequence", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "causality-units-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const universe = await loadCausalityUniverse(dir);
  assert.equal(universe.units.length, 6, "4 events + 2 dialogue cards");
  const card1 = universe.byId.get("card_1")!;
  assert.equal(card1.kind, "dialogue");
  assert.equal(card1.sceneId, "sc_1");
  const ev1 = universe.byId.get("ev_1")!;
  assert.equal(ev1.sceneId, "sc_1", "event resolves to its scene via evidence overlap");
  assert.equal(compareOrder(ev1, universe.byId.get("ev_2")!, universe), -1);
  assert.equal(compareOrder(universe.byId.get("card_1")!, universe.byId.get("card_2")!, universe), -1);
  assert.equal(compareOrder(ev1, universe.byId.get("card_2")!, universe), -1, "cross-scene order via scene order");
  assert.equal(compareOrder(ev1, universe.byId.get("ev_4")!, universe), -1, "cross-chapter order via chapter index");
  assert.equal(alreadyLinked(universe, "ev_1", "ev_2"), false);
  const linked = await loadCausalityUniverse(dir);
  linked.relations.push({ fromId: "ev_1", toId: "ev_2", type: "CAUSES", properties: {}, confidence: 1 });
  assert.equal(alreadyLinked(linked, "ev_2", "ev_1"), true, "either direction counts as linked");
});

test("causality candidates: graph legs nominate, embedding leg adds, linked pairs excluded", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "causality-candidates-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const universe = await loadCausalityUniverse(dir);
  const graphOnly = nominateCausalCandidates(universe, {});
  const pair = (from: string, to: string) => graphOnly.find((c) => c.fromId === from && c.toId === to);
  assert.ok(pair("ev_1", "ev_2")?.legs.includes("shared-actor"));
  assert.ok(pair("ev_1", "card_2")?.legs.includes("state-chain"), "char_b delta after ev_1, then card_2 involves char_b");
  assert.ok(pair("ev_1", "ev_3")?.legs.includes("shared-location"), "same scene location, no shared actor");
  assert.ok(pair("ev_1", "ev_4")?.legs.includes("shared-actor"), "cross-chapter pair via shared actor");
  assert.ok(!pair("ev_4", "card_2") && !graphOnly.some((c) => (c.fromId === "card_2" && c.toId === "ev_4")), "mere succession is not nominated: no shared actor, location, or state chain");
  assert.ok(!graphOnly.some((c) => c.fromId === c.toId), "no self-pairs");

  const vectors = new Map<string, number[]>([
    ["ev_1", [1, 0]],
    ["ev_2", [0.99, 0.14]],
    ["ev_3", [0, 1]],
    ["card_1", [1, 0]],
    ["card_2", [0, 1]],
  ]);
  const hybrid = nominateCausalCandidates(universe, { vectors });
  assert.ok(hybrid.find((c) => c.fromId === "ev_1" && c.toId === "ev_2")?.legs.some((leg) => leg.startsWith("embedding:")), "near-identical vectors nominate");
  assert.ok(!hybrid.some((c) => c.legs.length === 1 && c.legs[0] === "embedding:0.00"), "floor blocks weak similarities");

  const linkedUniverse = await loadCausalityUniverse(dir);
  linkedUniverse.relations.push({ fromId: "ev_1", toId: "ev_2", type: "CAUSES", properties: {}, confidence: 1 });
  const excluded = nominateCausalCandidates(linkedUniverse, {});
  assert.ok(!excluded.some((c) => (c.fromId === "ev_1" && c.toId === "ev_2") || (c.fromId === "ev_2" && c.toId === "ev_1")), "already-linked pairs never re-nominated");

  const touched = nominateCausalCandidates(universe, { touchedIds: new Set(["card_2"]) });
  assert.ok(touched.length > 0 && touched.every((c) => c.fromId === "card_2" || c.toId === "card_2"), "per-block passes only touch new units");
});

test("causality checklist: confident, contradiction-uncertain, rejected", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "causality-checklist-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const universe = await loadCausalityUniverse(dir);
  const candidates = [
    { fromId: "ev_1", toId: "ev_2", legs: ["shared-actor"], codeScore: 1, orderAmbiguous: false },
    { fromId: "ev_1", toId: "card_2", legs: ["state-chain"], codeScore: 1, orderAmbiguous: false },
    { fromId: "ev_2", toId: "ev_3", legs: ["shared-actor"], codeScore: 1, orderAmbiguous: false },
  ];
  const decisions = new MockDecisionModel({
    "causal:0": 0.92, "succession:0": 0.1,
    "causal:1": 0.91, "succession:1": 0.8,
    "causal:2": 0.3, "succession:2": 0.9,
  });
  const verdicts = await checkCausalLinks(decisions, candidates, universe);
  assert.deepEqual(verdicts.map((v) => v.verdict), ["confident", "uncertain", "rejected"]);
});

test("causality faculty: confident verdicts become gate proposals; mock Jev rejects all", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "causality-faculty-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const pass = await runCausalityPass({ novelDir: dir, decisions: stubDecisions(0.95, 0.1) });
  assert.ok(pass.summary.nominated > 0);
  assert.ok(pass.proposals.length > 0, "confident pairs propose");
  for (const proposal of pass.proposals) {
    assert.equal(proposal.kind, "add_relation");
    assert.equal((proposal.payload as Relation).type, "CAUSES");
    assert.equal(proposal.provenance.patchId, "causality-faculty");
    assert.equal(proposal.confidence, 0.95);
  }
  assert.ok(pass.proposals.some((p) => (p.payload as Relation).toId === "card_2" || (p.payload as Relation).fromId === "card_1"), "dialogue cards appear as endpoints");

  const rejected = await runCausalityPass({ novelDir: dir, decisions: new MockDecisionModel() });
  assert.equal(rejected.proposals.length, 0, "unanswered nouls score 0 and reject");
  assert.equal(rejected.summary.proposed, 0);
});

test("causality faculty: embedder writes the sidecar and manifest; sweep provenance cites both units", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "causality-embed-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const fakeEmbedder = {
    model: "fake-local",
    dimension: null as number | null,
    embed: async (texts: string[]) => texts.map((_, i) => [1 - i * 0.01, i * 0.01]),
  };
  const pass = await runCausalityPass({ novelDir: dir, decisions: stubDecisions(0.95, 0.1), embedder: fakeEmbedder });
  assert.ok(pass.summary.embedded > 0);
  assert.equal(pass.summary.embeddingLeg, true);
  const sidecar = await loadEmbeddingSidecar(join(dir, "ontology"));
  assert.ok(sidecar.size > 0);
  assert.equal(sidecar.get("ev_1")?.model, "fake-local");
  const manifest = JSON.parse(await readFile(join(dir, "ontology", "manifest.json"), "utf8"));
  assert.equal(manifest.embeddingModel, "fake-local");
  assert.equal(manifest.embeddingDimension, 2);
  // Sweep (no touchedIds) cites both units' sentences.
  const sweepProposal = pass.proposals.find((p) => (p.payload as Relation).fromId === "ev_1" && (p.payload as Relation).toId === "ev_2");
  assert.ok(sweepProposal, "ev_1 -> ev_2 proposed");
  assert.ok(sweepProposal!.provenance.sentenceIds.includes("s1") && sweepProposal!.provenance.sentenceIds.includes("s5"), "sweep cites both sides");
});

test("embeddings: cosine, top-K, client validation, unconfigured returns null", async () => {
  assert.equal(cosineSimilarity([1, 0], [1, 0]), 1);
  assert.ok(Math.abs(cosineSimilarity([1, 0], [0, 1])) < 1e-9);
  assert.equal(cosineSimilarity([0, 0], [1, 0]), 0);
  const ranked = topKSimilar([1, 0], [
    { id: "a", vector: [1, 0] },
    { id: "b", vector: [0, 1] },
    { id: "c", vector: [0.9, 0.1] },
  ], 2);
  assert.deepEqual(ranked.map((r) => r.id), ["a", "c"]);

  assert.equal(loadEmbedder({ provider: null, model: null, dimension: null, baseUrl: null, apiKey: null }), null);
  assert.throws(
    () => loadEmbedder({ provider: "mystery", model: "m", dimension: null, baseUrl: null, apiKey: null }),
    /EMBEDDING_BASE_URL/,
  );
  const fetchOk = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ embedding: [0.5, 0.5], index: 0 }, { embedding: [1, 0], index: 1 }] }),
  }) as unknown as Response;
  const client = new OpenAICompatibleEmbedder("http://127.0.0.1:9/v1", "fake", null, null, fetchOk as unknown as typeof fetch);
  const vectors = await client.embed(["a", "b"]);
  assert.equal(vectors.length, 2);
  assert.equal(client.dimension, 2);
  const fetchBad = async () => ({
    ok: true,
    status: 200,
    json: async () => ({ data: [{ embedding: [0.5], index: 0 }] }),
  }) as unknown as Response;
  const mismatch = new OpenAICompatibleEmbedder("http://127.0.0.1:9/v1", "fake", 768, null, fetchBad as unknown as typeof fetch);
  await assert.rejects(() => mismatch.embed(["a"]), /dimension mismatch/);
});

test("gate: CAUSES with a dialogue-card endpoint validates and materializes", async () => {
  const packet = newChangeSet("b0001");
  packet.status = "held";
  packet.reviewSource = [
    { id: "s1", text: "A enters.", index: 0, paragraphIndex: 0, startOffset: 0, endOffset: 9 },
    { id: "s2", text: "A speaks.", index: 1, paragraphIndex: 0, startOffset: 10, endOffset: 19 },
    { id: "s3", text: "B answers.", index: 2, paragraphIndex: 0, startOffset: 20, endOffset: 31 },
  ];
  const scene: Scene = {
    id: "sc_1",
    chapterIndex: 0,
    sentenceIds: ["s1", "s2", "s3"],
    charactersPresent: ["char_a"],
    charactersMentioned: [],
    turns: [],
    dialogues: [{ id: "card_1", sentenceIds: ["s2"], participantIds: ["char_a"], summary: "A speaks." }],
    locationId: null,
  };
  packet.proposals = [
    {
      id: "b0001_scene",
      kind: "create_scene",
      payload: scene,
      confidence: 1,
      provenance: { blockId: "b0001", sentenceIds: ["s1", "s2", "s3"], patchId: "test" },
    },
    {
      id: "b0001_event",
      kind: "create_event",
      payload: event("ev_1", 0, 1, ["char_a"], ["s1"], "A enters."),
      confidence: 1,
      provenance: { blockId: "b0001", sentenceIds: ["s1"], patchId: "test" },
    },
    {
      id: "causality_ev_1_causes_card_1",
      kind: "add_relation",
      payload: { fromId: "ev_1", toId: "card_1", type: "CAUSES", properties: {}, confidence: 0.9 },
      confidence: 0.9,
      provenance: { blockId: "b0001", sentenceIds: ["s1"], patchId: "causality-faculty" },
    },
  ];
  assert.doesNotThrow(() => validateStructure(packet));
  const facts = semanticFacts(packet);
  assert.ok(facts.some((fact) => fact.field === "relation"), "relation fact exists for the dialogue-endpoint link");
  packet.semanticReview = {
    version: 1,
    revision: semanticRevision(packet),
    decisions: facts.map((fact) => ({ factId: fact.id, verdict: "accept" as const, reason: "synthetic test" })),
  };
  const result = materializeSemantic(packet, entities);
  assert.equal(result.deferredFactIds.length, 0, "dialogue-endpoint CAUSES materializes, not deferred");
  assert.ok(result.proposals.some((p) => p.kind === "add_relation" && (p.payload as Relation).toId === "card_1"));
});
