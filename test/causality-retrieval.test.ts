import { test } from "node:test";
import assert from "node:assert/strict";
import { nominateCausalCandidates, causalReachability } from "../src/solidifier/causality/candidates.js";
import { compareOrder, type CausalUnit, type CausalityUniverse } from "../src/solidifier/causality/units.js";

function fixture(): CausalityUniverse {
  const units: CausalUnit[] = ["early", "middle", "query", "same", "future"].map((id, index) => ({
    id, kind: index % 2 ? "dialogue" : "event", sceneId: id === "same" ? "query" : id,
    chapterIndex: 0, scenePosition: index, text: id, summary: id, actors: [], locationId: null, sentenceIds: [id],
  }));
  return { units, byId: new Map(units.map(unit => [unit.id, unit])), scenes: [], events: [], relations: [], stateChanges: [],
    sceneIndexInChapter: new Map([["early", 0], ["middle", 1], ["query", 2], ["future", 3]]), sceneEvents: new Map(), eventScene: new Map() };
}

test("retrieval filters same-scene and future neighbors before top-K, then softly favors earlier matches", () => {
  const universe = fixture();
  const vectors = new Map([["early", [0.9, Math.sqrt(1 - 0.9 ** 2)]], ["middle", [0.95, Math.sqrt(1 - 0.95 ** 2)]], ["query", [1, 0]], ["same", [1, 0]], ["future", [1, 0]]]);
  const candidates = nominateCausalCandidates(universe, { vectors, topK: 1 });
  const incoming = candidates.filter(candidate => candidate.toId === "query");
  assert.deepEqual(incoming.map(candidate => candidate.fromId), ["early"]);
  assert.ok(incoming[0].legs.includes("embedding:0.90"));
  assert.ok(candidates.every(candidate => universe.byId.get(candidate.fromId)!.sceneId !== universe.byId.get(candidate.toId)!.sceneId));
  assert.ok(candidates.every(candidate => compareOrder(universe.byId.get(candidate.fromId)!, universe.byId.get(candidate.toId)!, universe) === -1));
  const queried = nominateCausalCandidates(universe, { vectors, touchedIds: new Set(["query"]) });
  assert.ok(queried.length > 0 && queried.every(candidate => candidate.toId === "query"));
  const weak = new Map(vectors);
  weak.set("early", [0.49, Math.sqrt(1 - 0.49 ** 2)]);
  assert.ok(!nominateCausalCandidates(universe, { vectors: weak }).some(candidate => candidate.fromId === "early" && candidate.toId === "query"));
});

test("canonical causal paths prune shortcuts directionally, including inverse serialization and cycles", () => {
  const universe = fixture();
  for (const unit of universe.units) unit.actors = ["person"];
  universe.relations = [
    { fromId: "early", toId: "middle", type: "CAUSES", confidence: 1, properties: {} },
    { fromId: "query", toId: "middle", type: "CAUSED_BY", confidence: 1, properties: {} },
  ];
  const reaches = causalReachability(universe);
  assert.equal(reaches("early", "query"), true);
  assert.equal(reaches("query", "early"), false);
  assert.ok(!nominateCausalCandidates(universe).some(candidate => candidate.fromId === "early" && candidate.toId === "query"));
  universe.relations.push({ fromId: "query", toId: "early", type: "CAUSES", confidence: 1, properties: {} });
  assert.equal(causalReachability(universe)("early", "future"), false);
});

test("known story order overrides reading order; unknown scene time is not guessed", () => {
  const universe = fixture();
  for (const unit of universe.units) unit.actors = ["person"];
  universe.storyIndex = new Map([["early", 3], ["middle", 1], ["query", 2]]);
  const candidates = nominateCausalCandidates(universe);
  assert.ok(candidates.some(candidate => candidate.fromId === "query" && candidate.toId === "early"));
  assert.ok(!candidates.some(candidate => candidate.fromId === "early" && candidate.toId === "query"));
  assert.ok(!candidates.some(candidate => candidate.fromId === "future" || candidate.toId === "future"));
  const excludedPairs = new Set(candidates.map(candidate => `${candidate.fromId}|${candidate.toId}`));
  assert.deepEqual(nominateCausalCandidates(universe, { excludedPairs }), []);
});
