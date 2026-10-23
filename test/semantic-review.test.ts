import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { newChangeSet, type ChangeProposal } from "../src/merge/changeset.js";
import { materializeSemantic, semanticFacts, semanticRevision, type FactDecision } from "../src/merge/semantic.js";
import { decideFacts, prepareSemantic, semanticPage } from "../src/merge/semanticCommands.js";
import { saveChangeSet, loadChangeSet, setChangeSetStatus } from "../src/merge/changesetStore.js";
import { applyChangeSet } from "../src/merge/apply.js";
import { reviseProposals } from "../src/merge/revise.js";
import { initWorkspace } from "../src/workspace/init.js";
import { sectionBlock } from "../src/text/sectioning.js";
import { BundleStore } from "../src/connectors/bundle.js";
import { loadExtractionCounts } from "../src/processing/counts.js";
import type { Entity, Scene, OntEvent, StateChange } from "../src/ontology/types.js";

function fixture() {
  const packet = newChangeSet("b0001");
  packet.status = "held";
  const source = sectionBlock("小明问小红：「你好吗？」小红回答：「很好。」两人走进教室。", 0).sentences;
  packet.reviewSource = source;
  const entity = (id: string, name: string): Entity => ({ id, kind: "Character", names: [{ text: name, lang: "zh", kind: "canonical" }], properties: {}, confidence: 0.9 });
  const first = entity("char_000001", "小明");
  const second = entity("char_000002", "小红");
  const add = (id: string, kind: ChangeProposal["kind"], payload: ChangeProposal["payload"]) => packet.proposals.push({ id, kind, payload, confidence: 0.9, provenance: { blockId: packet.blockId, sentenceIds: source.map(sentence => sentence.id), patchId: "fixture" } });
  add("first", "upsert_entity", first);
  add("second", "upsert_entity", second);
  add("scene", "create_scene", { id: "scene_000001", chapterIndex: 0, sentenceIds: source.map(sentence => sentence.id), charactersPresent: [first.id, second.id], charactersMentioned: [], locationId: null, turns: [{ speakerId: first.id, addresseeId: second.id, sentenceIds: [source[0].id] }] });
  add("event", "create_event", { id: "evt_000001", timelineId: "tl_canon", chapterIndex: 0, chronologicalOrder: 1, eventType: "dialogue", summaryEn: "小明问候小红。", evidence: { text: source[0].text, sentenceIds: [source[0].id] }, importance: 0.5, primaryActors: [first.id], affectedCharacters: [second.id], confidence: 0.9 });
  add("participation", "add_relation", { fromId: first.id, toId: "evt_000001", type: "PARTICIPATES_IN", properties: {}, confidence: 0.9 });
  add("relationship", "add_relation", { fromId: first.id, toId: second.id, type: "KNOWS", properties: {}, confidence: 0.9 });
  add("emotion", "set_state_change", { characterId: first.id, afterEventId: "evt_000001", emotions: { joy: 0.5 }, relationships: { [second.id]: 0.2 }, knowledgeAdd: [], goalsAdd: [], location: null, possessionsAdd: [], possessionsRemove: [] });
  return { packet, first, second, source };
}

function decision(factId: string, verdict: FactDecision["verdict"] = "accept", replacement?: unknown): FactDecision {
  return { factId, verdict, reason: "依据原文独立核对", ...(replacement === undefined ? {} : { replacement }) };
}

test("fact review excludes segmentation and event detection but retains identities, dialogue, relations, actors and emotions", () => {
  const { packet } = fixture();
  assert.deepEqual(semanticFacts(packet).map(fact => fact.field), ["identity", "identity", "presence", "turn", "actors", "relation", "state"]);
  packet.semanticReview = { version: 1, revision: semanticRevision(packet), decisions: [] };
  const result = materializeSemantic(packet, []);
  assert.equal(result.proposals.length, 2);
  const scene = result.proposals.find(proposal => proposal.kind === "create_scene")!.payload as Scene;
  assert.deepEqual(scene.charactersPresent, []);
  assert.deepEqual(scene.turns[0], { speakerId: null, addresseeId: null, sentenceIds: packet.reviewSource!.slice(0, 1).map(sentence => sentence.id) });
  assert.equal(result.deferredFactIds.length, 7);
  assert.ok(!result.proposals.some(proposal => ["add_relation", "set_state_change", "upsert_entity"].includes(proposal.kind)));
});

test("presence replacement never clears a verified speaker, addressee, actor or source span", () => {
  const { packet } = fixture();
  packet.semanticReview = { version: 1, revision: semanticRevision(packet), decisions: semanticFacts(packet).map(fact => decision(fact.id, "accept", fact.field === "presence" ? [] : undefined)) };
  const result = materializeSemantic(packet, []);
  const scene = result.proposals.find(proposal => proposal.kind === "create_scene")!.payload as Scene;
  assert.deepEqual(scene.charactersPresent, []);
  assert.deepEqual(scene.turns, (packet.proposals.find(proposal => proposal.kind === "create_scene")!.payload as Scene).turns);
  assert.deepEqual((result.proposals.find(proposal => proposal.kind === "create_event")!.payload as OntEvent).primaryActors, ["char_000001"]);
  assert.equal(result.proposals.filter(proposal => proposal.kind === "add_relation").length, 2);
  assert.equal((result.proposals.find(proposal => proposal.kind === "set_state_change")!.payload as unknown as StateChange).emotions.joy, 0.5);
  assert.equal(result.deferredFactIds.length, 0);
});

test("held identities block dependent assertions without leaking proposed aliases or relations", () => {
  const { packet } = fixture();
  packet.semanticReview = { version: 1, revision: semanticRevision(packet), decisions: semanticFacts(packet).map(fact => decision(fact.id, fact.id === "second/identity" ? "hold" : "accept")) };
  const result = materializeSemantic(packet, []);
  assert.ok(result.deferredFactIds.includes("scene/turn/0"));
  assert.ok(result.deferredFactIds.includes("relationship/relation"));
  assert.ok(result.deferredFactIds.includes("emotion/state"));
  assert.ok(!result.proposals.some(proposal => proposal.kind === "add_relation"));
  assert.equal((result.proposals.find(proposal => proposal.kind === "create_scene")!.payload as Scene).turns[0].speakerId, null);
});

test("stale revisions, invalid identities, hallucinated names, wrong endpoint types and corrupt spans fail closed", () => {
  const { packet } = fixture();
  packet.semanticReview = { version: 1, revision: "stale", decisions: [] };
  assert.throws(() => materializeSemantic(packet, []), /stale/);
  packet.semanticReview = { version: 1, revision: semanticRevision(packet), decisions: [decision("scene/turn/0", "accept", { speakerId: "char_000001", addresseeId: "missing" })] };
  assert.ok(materializeSemantic(packet, []).deferredFactIds.includes("scene/turn/0"));
  packet.semanticReview.decisions = [decision("first/identity", "accept", { ...(packet.proposals[0].payload as Entity), id: "stolen" })];
  assert.throws(() => materializeSemantic(packet, []), /identity/);
  packet.semanticReview.decisions = [decision("scene/turn/0", "accept", { speakerId: "place", addresseeId: null })];
  const place: Entity = { id: "place", kind: "Location", names: [], properties: {}, confidence: 1 };
  assert.throws(() => materializeSemantic(packet, [place]), /wrong type/);
  (packet.proposals.find(proposal => proposal.kind === "create_scene")!.payload as Scene).sentenceIds.push("not-source");
  packet.semanticReview.revision = semanticRevision(packet);
  assert.throws(() => materializeSemantic(packet, []), /source references/);
});

test("a model-generated identity form absent from source cannot pass even an accepted decision", () => {
  const { packet } = fixture();
  (packet.proposals[0].payload as Entity).names.push({ text: "不存在的人", lang: "zh", kind: "alias" });
  packet.semanticReview = { version: 1, revision: semanticRevision(packet), decisions: [decision("first/identity")] };
  assert.throws(() => materializeSemantic(packet, []), /original source/);
});

test("real CLI pages, targeted decisions, partial approval and graph queries use no model calls", async context => {
  const parent = await mkdtemp(join(tmpdir(), "semantic-cli-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const { packet } = fixture();
  await saveChangeSet(directory, packet);
  const execute = promisify(execFile);
  const cli = (...args: string[]) => execute(process.execPath, [resolve("dist/src/cli.js"), ...args], { env: { ...process.env, WORK_LLM_API_KEY: "", TYPESAFE_API_KEY: "" } });
  await assert.rejects(cli("changeset", "approve", directory, packet.id), /decisions are missing/);
  assert.equal((await loadChangeSet(directory, packet.id)).status, "held");
  const page = JSON.parse((await cli("changeset", "facts", directory, packet.id, "--limit", "20")).stdout);
  assert.ok(page.facts.every((fact: { evidenceIds: string[] }) => fact.evidenceIds.some(id => page.evidence[id])));
  assert.ok(page.facts.find((fact: { field: string; eventIds: string[] }) => fact.field === "actors").eventIds.every((id: string) => page.events[id]));
  const decisions = [decision("first/identity"), decision("second/identity"), decision("scene/turn/0")];
  await cli("changeset", "decide", directory, packet.id, "--revision", page.revision, "--decisions", JSON.stringify(decisions));
  const approved = JSON.parse((await cli("changeset", "approve", directory, packet.id)).stdout);
  assert.equal(approved.deferredFacts, 4);
  assert.equal(approved.graph.entities, 2);
  assert.equal(approved.graph.scenes, 1);
  assert.equal(approved.graph.relations, 0);
  const store = new BundleStore(join(directory, "ontology"));
  assert.equal((await store.loadFile<Scene>("scenes.jsonl"))[0].turns[0].speakerId, "char_000001");
  assert.equal((await store.loadFile<OntEvent>("events.jsonl"))[0].primaryActors.length, 0);
  assert.equal((await store.loadFile("state-changes.jsonl")).length, 0);
  const query = JSON.parse((await cli("query", directory, "MATCH (c:Character)-[:KNOWS]->(d:Character) RETURN c.id")).stdout);
  assert.deepEqual(query.rows, []);
  assert.match(query.epistemic, /unknown, not false/);
  const held = JSON.parse((await cli("changeset", "facts", directory, packet.id, "--fact", "relationship/relation")).stdout);
  assert.ok(held.sentences.length);
  assert.equal(held.materialization, "held");
  assert.equal(held.heldFacts, 4);
  await assert.rejects(cli("changeset", "approve", directory, packet.id), /already approved/);
  const counts = await loadExtractionCounts(directory, store);
  assert.deepEqual(counts.reservedEntityIds.sort(), ["char_000001", "char_000002"]);
});

test("held identity ids stay reserved after partial application and no merged event is falsely emitted", async context => {
  const parent = await mkdtemp(join(tmpdir(), "semantic-reservations-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const { packet } = fixture();
  await saveChangeSet(directory, packet);
  const page = await semanticPage(directory, packet.id, { summary: true });
  await decideFacts(directory, packet.id, page.revision, [decision("first/identity")]);
  const pending = await loadChangeSet(directory, packet.id);
  const canonical = await prepareSemantic(directory, pending);
  const approved = await setChangeSetStatus(directory, packet.id, "approved");
  const events: { type: string; deferredFactIds?: string[] }[] = [];
  const store = new BundleStore(join(directory, "ontology"));
  await applyChangeSet(store, approved, async event => { events.push(event); }, canonical);
  assert.equal((await store.loadFile<Entity>("entities.jsonl")).length, 1);
  assert.ok((await loadExtractionCounts(directory, store)).reservedEntityIds.includes("char_000002"));
  assert.ok(!events.some(event => event.type === "changeset.merged"));
  assert.equal(events.find(event => event.type === "changeset.applied")!.deferredFactIds!.length, 6);
});

test("oversize fact values are not truncated and unrelated facts remain pageable", async context => {
  const parent = await mkdtemp(join(tmpdir(), "semantic-pages-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const { packet } = fixture();
  (packet.proposals[0].payload as Entity).properties = { value: "原文".repeat(20000) };
  await saveChangeSet(directory, packet);
  await assert.rejects(semanticPage(directory, packet.id), /byte budget/);
  const next = await semanticPage(directory, packet.id, { offset: 1, limit: 2 });
  assert.ok("facts" in next && next.facts.length === 2);
  assert.ok(Buffer.byteLength(JSON.stringify(next)) < 29000);
});

test("decision batches are audited, stale context is rejected and bulk repairs cannot erase dialogue", async context => {
  const parent = await mkdtemp(join(tmpdir(), "semantic-decide-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const { packet, first } = fixture();
  const file = await saveChangeSet(directory, packet);
  const before = await readFile(file, "utf8");
  await assert.rejects(decideFacts(directory, packet.id, "stale", []), /Stale/);
  const revision = (await semanticPage(directory, packet.id, { summary: true })).revision;
  await assert.rejects(decideFacts(directory, packet.id, revision, [decision("not-a-fact")]), /unknown/);
  assert.equal(await readFile(file, "utf8"), before);
  await assert.rejects(reviseProposals(directory, packet.id, { mentionedOnlyEntityIds: [first.id] }, "修正存在状态"), /targeted fact/);
  await decideFacts(directory, packet.id, revision, [decision("first/identity")]);
  await decideFacts(directory, packet.id, revision, [decision("scene/presence", "hold")]);
  assert.equal((await loadChangeSet(directory, packet.id)).semanticReview!.decisions.length, 2);
  const page = await semanticPage(directory, packet.id, { limit: 1 });
  assert.equal("page" in page && page.page.nextOffset, 1);
  const store = new BundleStore(join(directory, "ontology"));
  await store.upsertEntity({ ...first, properties: { externalChange: true } });
  await assert.rejects(prepareSemantic(directory, await loadChangeSet(directory, packet.id)), /context changed/);
  await assert.rejects(decideFacts(directory, packet.id, revision, [decision("first/identity")]), /canonical context/);
  assert.equal((await loadChangeSet(directory, packet.id)).status, "held");
});

test("low-level application cannot bypass semantic preflight", async context => {
  const parent = await mkdtemp(join(tmpdir(), "semantic-apply-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const { packet } = fixture();
  packet.status = "approved";
  const store = new BundleStore(join(directory, "ontology"));
  await assert.rejects(applyChangeSet(store, packet), /canonical context/);
  assert.equal((await store.loadFile("entities.jsonl")).length, 0);
});

test("fact pages display targeted corrections and a repeated accept cannot silently undo them", async context => {
  const parent = await mkdtemp(join(tmpdir(), "semantic-corrections-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const { packet } = fixture();
  await saveChangeSet(directory, packet);
  const revision = (await semanticPage(directory, packet.id, { summary: true })).revision;
  await decideFacts(directory, packet.id, revision, [decision("scene/presence", "accept", [])]);
  const corrected = await semanticPage(directory, packet.id);
  assert.ok("facts" in corrected);
  const presence = corrected.facts.find(row => (row as { id: string }).id === "scene/presence") as { value: unknown; originalCandidate: unknown };
  assert.deepEqual(presence.value, []);
  assert.deepEqual(presence.originalCandidate, ["char_000001", "char_000002"]);
  await decideFacts(directory, packet.id, revision, [decision("scene/presence")]);
  assert.deepEqual((await loadChangeSet(directory, packet.id)).semanticReview!.decisions[0].replacement, []);
});
