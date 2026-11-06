import { test } from "node:test";
import assert from "node:assert/strict";
import { nominateCausalCandidates } from "../src/solidifier/causality/candidates.js";
import { checkCausalLinks } from "../src/solidifier/causality/checklist.js";
import { compareOrder, type CausalityUniverse, type CausalUnit } from "../src/solidifier/causality/units.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import type { StrandView } from "../src/digger/timeplace/strandView.js";

// Invented chapter, told in this order: s1 (Ming at the port), s2 (Lan at the hill, in parallel),
// s3 (a flashback, told third but happening first), s4 (Ming at the port again).
// Story time: s3 → s1 → s4, and s2 runs in parallel with s1 and s4.
const unit = (id: string, sceneId: string, actors: string[]): CausalUnit => ({ id, kind: "event", sceneId, chapterIndex: 0, text: id, summary: id, actors, locationId: null, sentenceIds: [], scenePosition: null });
const units = [unit("e1", "s1", ["ming"]), unit("e2", "s2", ["lan"]), unit("e3", "s3", ["ming"]), unit("e4", "s4", ["ming"])];
const story = new Map([["s3", 0], ["s1", 1], ["s4", 2]]);
const strands: StrandView = {
  before: (a, b) => story.has(a) && story.has(b) && story.get(a)! < story.get(b)!,
  has: (sceneId) => ["s1", "s2", "s3", "s4"].includes(sceneId),
  cast: (sceneId) => (sceneId === "s2" ? ["lan"] : ["ming"]),
};
const universe: CausalityUniverse = {
  strands, units, byId: new Map(units.map((entry) => [entry.id, entry])), events: [], relations: [], stateChanges: [],
  scenes: ["s1", "s2", "s3", "s4"].map((id) => ({ id, chapterIndex: 0, sentenceIds: [], charactersPresent: [], charactersMentioned: [], locationId: null }) as never),
  sceneIndexInChapter: new Map([["s1", 0], ["s2", 1], ["s3", 2], ["s4", 3]]), sceneEvents: new Map(), eventScene: new Map(),
};

test("causes are ordered by story time from the strands: a flashback told later happens first", () => {
  assert.equal(compareOrder(universe.byId.get("e3")!, universe.byId.get("e1")!, universe), -1);
  assert.equal(compareOrder(universe.byId.get("e4")!, universe.byId.get("e1")!, universe), 1);
  assert.equal(compareOrder(universe.byId.get("e1")!, universe.byId.get("e2")!, universe), null, "parallel strands: story time orders neither");
  // Without strands, telling order would put the flashback after s1.
  assert.equal(compareOrder(universe.byId.get("e3")!, universe.byId.get("e1")!, { ...universe, strands: null }), 1);
});

test("the same person's nearby scenes nominate pairs in story order; parallel pairs are kept, flagged and ranked lower", () => {
  const candidates = nominateCausalCandidates(universe);
  const pair = (from: string, to: string) => candidates.find((candidate) => candidate.fromId === from && candidate.toId === to);
  assert.ok(pair("e3", "e1")?.legs.includes("same-person-nearby"), "flashback cause before its later effect");
  assert.ok(!pair("e1", "e3"), "never against story time");
  assert.ok(pair("e1", "e4"));
  // Lan's scene shares no one with Ming's and is parallel: nothing nominates it here.
  assert.ok(!candidates.some((candidate) => [candidate.fromId, candidate.toId].includes("e2")));
  // A shared actor across parallel strands: kept in telling order, flagged, half the score.
  const shared = { ...universe, units: units.map((entry) => entry.id === "e2" ? { ...entry, actors: ["lan", "ming"] } : entry) };
  shared.byId = new Map(shared.units.map((entry) => [entry.id, entry]));
  const across = nominateCausalCandidates(shared).find((candidate) => candidate.fromId === "e1" && candidate.toId === "e2")!;
  assert.deepEqual([across.parallel, across.orderAmbiguous], [true, true]);
  const ordered = nominateCausalCandidates(shared).find((candidate) => candidate.fromId === "e1" && candidate.toId === "e4")!;
  assert.ok(across.codeScore < ordered.codeScore);
});

test("with embedding vectors, pairs of the same person in nearby scenes are kept even when their texts read differently", () => {
  // Orthogonal vectors: no pair is similar enough for the embedding leg.
  const vectors = new Map(units.map((entry, index) => [entry.id, [0, 1, 2, 3].map((axis) => (axis === index ? 1 : 0))]));
  const candidates = nominateCausalCandidates(universe, { vectors });
  assert.ok(candidates.some((candidate) => candidate.fromId === "e3" && candidate.toId === "e1" && candidate.legs.includes("same-person-nearby")));
  assert.ok(candidates.every((candidate) => candidate.legs.some((leg) => leg === "same-person-nearby" || leg.startsWith("embedding:"))));
});

test("Jev is told when a pair runs in parallel strands", async () => {
  let state = "";
  const decisions: DecisionModel = { modelId: "fake", decide: async (snapshot: string, questions) => { state = snapshot; return questions.map((question) => ({ key: question.key, value: 0.1 })); } };
  await checkCausalLinks(decisions, [{ fromId: "e1", toId: "e2", legs: ["shared-actor"], codeScore: 0.5, orderAmbiguous: true, parallel: true }], universe);
  assert.match(state, /parallel strands/);
  assert.match(state, /a message, a call, news, a person arriving/);
});
