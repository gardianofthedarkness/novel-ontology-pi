import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { universeFixture } from "./helpers/universeFixture.js";
import { loadUniverseContext, qualifyCausalUnit, universeCandidates, universeCausalView, universeDecide, universeEvidence, universePacket, universePropose, universeSweep } from "../src/solidifier/causality/universe.js";
import { compareOrder } from "../src/solidifier/causality/units.js";
import { libraryDecide, libraryPropose, libraryShow } from "../src/ground/workspace/library.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import { loadCausalityUniverse } from "../src/solidifier/causality/units.js";

test("current scene versions and all dialogue fragments supply source evidence instead of superseded partial cards", async context => {
  const fixture = await universeFixture(context);
  const path = join(fixture.workspaces[0], "ontology", "scenes.jsonl");
  const original = JSON.parse((await readFile(path, "utf8")).trim());
  const first = { ...original, sentenceIds: original.sentenceIds.slice(0, 2), dialogues: [{ ...original.dialogues[0], sentenceIds: [original.sentenceIds[1]] }] };
  const second = { ...original, id: "sc_2", sentenceIds: original.sentenceIds.slice(2), dialogues: [{ ...original.dialogues[0], sentenceIds: original.sentenceIds.slice(2) }] };
  await writeFile(path, [original, first, second].map(record => JSON.stringify(record)).join("\n") + "\n");
  let local = await loadCausalityUniverse(fixture.workspaces[0]);
  assert.equal(local.scenes.length, 2);
  assert.equal(local.units.filter(unit => unit.id === "card_1").length, 1);
  assert.deepEqual(local.byId.get("card_1")!.sentenceIds, original.sentenceIds.slice(1));
  await writeFile(path, [original, first, second, { ...second, dialogues: [] }].map(record => JSON.stringify(record)).join("\n") + "\n");
  local = await loadCausalityUniverse(fixture.workspaces[0]);
  assert.deepEqual(local.byId.get("card_1")!.sentenceIds, [original.sentenceIds[1]]);
});

test("oversized original spans are explicitly deferred without any Jev call or hidden truncation", async context => {
  const fixture = await universeFixture(context);
  const scope = await loadUniverseContext(fixture.directory, "world");
  for (const unit of scope.universe.units) unit.text = "原文".repeat(10000);
  const decisions: DecisionModel = { modelId: "never-called", decide: async () => { throw new Error("Oversized context must not be sent."); } };
  const result = await universeSweep(scope, decisions, 0, 20);
  assert.equal(result.checked, 0);
  assert.equal(result.deferred, result.nominated);
  assert.equal(result.proposed, 0);
  assert.equal(result.packetId, null);
});

test("a later entity identity change invalidates accepted causal support without modifying book relations", async context => {
  const fixture = await universeFixture(context);
  const scope = await loadUniverseContext(fixture.directory, "world");
  const proposed = await universePropose(scope, qualifyCausalUnit(fixture.sources[0].id, "ev_1"), qualifyCausalUnit(fixture.sources[1].id, "ev_1"), "Synthetic.");
  const inspected = await universePacket(scope, proposed.packetId);
  await universeDecide(scope, proposed.packetId, inspected.revision, [{ proposalId: inspected.packet.proposals[0].id, verdict: "accept", reason: "Synthetic.", temporalReason: "Synthetic." }]);
  const path = join(fixture.workspaces[1], "ontology", "entities.jsonl");
  const entity = JSON.parse((await readFile(path, "utf8")).trim()); entity.names[0].text = "另一个人";
  await writeFile(path, JSON.stringify(entity) + "\n");
  const view = await universeCausalView(fixture.directory);
  assert.equal(view.links[0].state, "held");
  assert.equal(view.links[0].stale, true);
});

test("universe nomination qualifies colliding IDs, isolates continuities/worlds, and never treats reading order or names as identity/time", async context => {
  const fixture = await universeFixture(context);
  const scope = await loadUniverseContext(fixture.directory, "world");
  assert.equal(scope.coverage.length, 5);
  assert.equal(scope.coverage.filter(book => book.status === "unprocessed").length, 1);
  const first = qualifyCausalUnit(fixture.sources[0].id, "ev_1"), second = qualifyCausalUnit(fixture.sources[1].id, "ev_1");
  assert.notEqual(first, second);
  assert.equal(compareOrder(scope.universe.byId.get(first)!, scope.universe.byId.get(second)!, scope.universe), null);
  const result = await universeCandidates(scope, 0, 20);
  assert.ok(result.candidates.some(candidate => candidate.from.sourceId === fixture.sources[4].id || candidate.to.sourceId === fixture.sources[4].id), "different series in same reviewed continuity is eligible");
  assert.ok(result.candidates.every(candidate => ![candidate.from.sourceId, candidate.to.sourceId].some(id => [fixture.sources[2].id, fixture.sources[3].id].includes(id))));
  assert.ok(result.candidates.every(candidate => candidate.orderAmbiguous && candidate.legs.includes("cross-file-name-hint-not-identity")));
  assert.equal(result.exhaustive, false);
  const page = await universeCandidates(scope, 1, 1);
  assert.equal(page.candidates[0].fromId, result.candidates[1].fromId);
  assert.equal(page.candidates[0].toId, result.candidates[1].toId);
  await assert.rejects(() => universePropose(scope, first, qualifyCausalUnit(fixture.sources[2].id, "ev_1"), "Not allowed"), /cross continuities/);
  await assert.rejects(() => universePropose(scope, first, qualifyCausalUnit(fixture.sources[3].id, "ev_1"), "Not allowed"), /reviewed universe/);
  await assert.rejects(() => universePropose(scope, first, qualifyCausalUnit(fixture.sources[0].id, "card_1"), "Local"), /per-book/);
});

test("two-book event/dialogue review preserves originals and writes only a reviewed universe ledger", async context => {
  const fixture = await universeFixture(context);
  const before = await Promise.all(fixture.workspaces.map(workspace => readFile(join(workspace, "ontology", "relations.jsonl"), "utf8")));
  const scope = await loadUniverseContext(fixture.directory, "world");
  const from = qualifyCausalUnit(fixture.sources[0].id, "ev_1"), to = qualifyCausalUnit(fixture.sources[1].id, "card_1");
  const proposed = await universePropose(scope, from, to, "水闸被打开引发关闸的呼喊。");
  assert.equal((await universeCausalView(fixture.directory)).links[0].state, "proposed");
  const page = await universeEvidence(scope, from, to, { packetId: proposed.packetId, limit: 1 });
  assert.equal(page.available, true);
  assert.ok(page.sentences[0].text.includes("打开"));
  const secondPage = await universeEvidence(scope, from, to, { packetId: proposed.packetId, offset: 1, limit: 1 });
  assert.ok(secondPage.sentences[0].text.includes("关上"));
  assert.notEqual(page.sentences[0].sourceId, secondPage.sentences[0].sourceId);
  const inspected = await universePacket(scope, proposed.packetId);
  const decision = { proposalId: inspected.packet.proposals[0].id, verdict: "accept" as const, reason: "Both original passages inspected." };
  await assert.rejects(() => universeDecide(scope, proposed.packetId, inspected.revision, [decision]), /temporal/);
  const applied = await universeDecide(scope, proposed.packetId, inspected.revision, [{ ...decision, temporalReason: "The second passage explicitly reacts to the already-opened gate, not the file's reading number." }]);
  assert.equal(applied.applied, 1);
  assert.equal(applied.bookDatabasesModified, false);
  const view = await universeCausalView(fixture.directory);
  assert.equal(view.links[0].state, "canon");
  const raw = JSON.stringify(view);
  for (const privateValue of [fixture.root, "Both original passages", "水闸被打开引发", "The second passage explicitly"]) assert.ok(!raw.includes(privateValue));
  assert.deepEqual(await Promise.all(fixture.workspaces.map(workspace => readFile(join(workspace, "ontology", "relations.jsonl"), "utf8"))), before);
  await assert.rejects(() => universeDecide(scope, proposed.packetId, inspected.revision, [decision]), /changed|Stale/);
});

test("universe Jev batches use original passages and defer excess context without pretending completion", async context => {
  const fixture = await universeFixture(context);
  const scope = await loadUniverseContext(fixture.directory, "world");
  let callCount = 0;
  const decisions: DecisionModel = { modelId: "synthetic", decide: async (state, questions) => {
    callCount++;
    assert.ok(state.includes("水闸"));
    assert.ok(state.includes("Reading order"));
    assert.ok(!state.includes("摘要1 happens"));
    assert.ok(state.length + JSON.stringify(questions).length <= 16000);
    return questions.map(question => ({ key: question.key, value: question.key.startsWith("causal:") ? 0.95 : 0.1 }));
  } };
  const result = await universeSweep(scope, decisions, 0, 20);
  assert.equal(callCount, 1);
  assert.ok(result.checked > 0 && result.checked < 20);
  assert.equal(result.proposed, result.checked);
  assert.equal(result.deferred, result.nominated - result.checked);
  assert.equal(result.complete, false);
  assert.equal(result.embeddingLeg, false);
  const inspected = await universePacket(scope, result.packetId!);
  assert.equal(inspected.packet.proposals.length, result.proposed);
  assert.ok((await universeCausalView(fixture.directory)).links.every(link => link.state === "proposed"));
});

test("source/ontology changes invalidate pending packets and previously accepted support", async context => {
  const fixture = await universeFixture(context);
  const scope = await loadUniverseContext(fixture.directory, "world");
  const proposed = await universePropose(scope, qualifyCausalUnit(fixture.sources[0].id, "ev_1"), qualifyCausalUnit(fixture.sources[1].id, "ev_1"), "Synthetic source-grounded test.");
  const inspected = await universePacket(scope, proposed.packetId);
  const decisions = [{ proposalId: inspected.packet.proposals[0].id, verdict: "accept" as const, reason: "Inspected.", temporalReason: "Explicit textual sequence." }];
  await universeDecide(scope, proposed.packetId, inspected.revision, decisions);
  const eventsPath = join(fixture.workspaces[1], "ontology", "events.jsonl");
  const changed = JSON.parse((await readFile(eventsPath, "utf8")).trim()); changed.summaryEn = "Changed endpoint.";
  await writeFile(eventsPath, JSON.stringify(changed) + "\n");
  assert.equal((await universeCausalView(fixture.directory)).links[0].state, "held");
  assert.equal((await universeCausalView(fixture.directory)).links[0].stale, true);
  await assert.rejects(() => universeDecide(scope, proposed.packetId, inspected.revision, decisions), /changed/);
});

test("unresolved membership cannot enter scope, and a reviewed reclassification invalidates old cross-book support", async context => {
  const fixture = await universeFixture(context);
  const scope = await loadUniverseContext(fixture.directory, "world");
  const from = qualifyCausalUnit(fixture.sources[0].id, "ev_1"), to = qualifyCausalUnit(fixture.sources[1].id, "ev_1");
  const proposed = await universePropose(scope, from, to, "Synthetic source-grounded test.");
  const inspected = await universePacket(scope, proposed.packetId);
  await universeDecide(scope, proposed.packetId, inspected.revision, [{ proposalId: inspected.packet.proposals[0].id, verdict: "accept", reason: "Inspected.", temporalReason: "Explicit textual sequence." }]);
  fixture.organization.assignments[1].status = "unresolved";
  const plan = await libraryPropose(fixture.directory, fixture.organization, (await libraryShow(fixture.directory)).revision);
  await libraryDecide(fixture.directory, plan.planId, plan.revision, "approve", "Uncertain membership stays out.");
  const current = await loadUniverseContext(fixture.directory, "world");
  assert.ok(!current.universe.byId.has(to));
  assert.equal((await universeCausalView(fixture.directory)).links[0].state, "held");
  await assert.rejects(() => universePropose(current, from, to, "No."), /reviewed universe/);
});

test("opposite directions cannot be accepted as a two-link causal cycle", async context => {
  const fixture = await universeFixture(context);
  let scope = await loadUniverseContext(fixture.directory, "world");
  const from = qualifyCausalUnit(fixture.sources[0].id, "ev_1"), to = qualifyCausalUnit(fixture.sources[1].id, "ev_1");
  const first = await universePropose(scope, from, to, "Synthetic test.");
  const inspected = await universePacket(scope, first.packetId);
  await universeDecide(scope, first.packetId, inspected.revision, [{ proposalId: inspected.packet.proposals[0].id, verdict: "accept", reason: "Synthetic.", temporalReason: "Synthetic direction." }]);
  scope = await loadUniverseContext(fixture.directory, "world");
  const reversed = await universePropose(scope, to, from, "Reverse needs holding.");
  const reversePacket = await universePacket(scope, reversed.packetId);
  await assert.rejects(() => universeDecide(scope, reversed.packetId, reversePacket.revision, [{ proposalId: reversePacket.packet.proposals[0].id, verdict: "accept", reason: "Conflicting.", temporalReason: "Conflicting." }]), /causal cycle/);
});
