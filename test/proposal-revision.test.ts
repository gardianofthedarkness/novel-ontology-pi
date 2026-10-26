import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { BundleStore } from "../src/ground/connectors/bundle.js";
import { newChangeSet, type ChangeProposal } from "../src/solidifier/merge/changeset.js";
import { loadChangeSet, saveChangeSet } from "../src/solidifier/merge/changesetStore.js";
import { reviseProposals } from "../src/solidifier/merge/revise.js";
import type { Entity, OntEvent, Scene } from "../src/ground/ontology/types.js";
import { rekeyDuplicateProposalIds } from "../src/solidifier/merge/proposalIds.js";
import { semanticFacts, semanticRevision, validateStructure } from "../src/solidifier/merge/semantic.js";
import { semanticPage } from "../src/solidifier/merge/semanticCommands.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";

test("duplicate-ID repair preserves distinct and identical payloads, avoids existing suffixes, and does not mutate the caller", () => {
  const proposal = (id: string, knowledge: string[]): ChangeProposal => ({ id, kind: "set_state_change", payload: { characterId: "char_1", afterEventId: "evt_1", knowledgeAdd: knowledge }, confidence: 0.7, provenance: { blockId: "b0001", sentenceIds: ["b0000_s0000"], patchId: "test" } });
  const original = [proposal("duplicate", ["消息甲"]), proposal("duplicate", ["消息乙"]), proposal("duplicate__duplicate_1", []), proposal("duplicate", ["消息乙"])];
  const before = JSON.stringify(original);
  const repaired = rekeyDuplicateProposalIds(original);
  assert.equal(repaired.renamed.length, 3);
  assert.equal(new Set(repaired.proposals.map(proposal => proposal.id)).size, 4);
  assert.equal(repaired.proposals[2].id, original[2].id);
  assert.deepEqual(repaired.proposals.map(({ id, ...value }) => value), original.map(({ id, ...value }) => value));
  assert.equal(JSON.stringify(original), before);
  assert.equal(rekeyDuplicateProposalIds(repaired.proposals).renamed.length, 0);
});

test("metadata-only semantic packet repair archives every original fact, invalidates old review and touches no canon", async context => {
  const parent = await mkdtemp(join(tmpdir(), "semantic-id-repair-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel"); await initWorkspace(directory);
  const packet = newChangeSet("b0001"); packet.status = "held";
  packet.reviewSource = sectionBlock("甲获知消息后感到紧张。", 0).sentences;
  packet.proposals = ["消息甲", "消息乙"].map(knowledge => ({ id: "same-state", kind: "set_state_change", payload: { characterId: "char_1", afterEventId: "evt_1", knowledgeAdd: [knowledge] }, confidence: 0.7, provenance: { blockId: "b0001", sentenceIds: ["b0000_s0000"], patchId: "test" } }));
  packet.semanticReview = { version: 1, revision: semanticRevision(packet), decisions: [{ factId: "same-state/state", verdict: "accept", reason: "Stale ambiguous review." }] };
  const file = await saveChangeSet(directory, packet);
  const before = await readFile(file, "utf8");
  const canonical = await readFile(join(directory, "ontology", "entities.jsonl"), "utf8");
  await assert.rejects(() => semanticPage(directory, packet.id, { summary: true }), /Duplicate proposal ids/);
  await assert.rejects(() => reviseProposals(directory, packet.id, { rekeyDuplicateIds: true, dropProposalIds: ["same-state"] }, "Mixed repair must fail"), /cannot be combined/);
  await assert.rejects(() => reviseProposals(directory, packet.id, { dropProposalIds: ["same-state"] }, "Bulk removal must fail"), /targeted fact decisions/);
  const result = await reviseProposals(directory, packet.id, { rekeyDuplicateIds: true }, "Only repair duplicate proposal metadata.");
  assert.equal("rekeyed" in result && result.rekeyed, 2);
  assert.equal(result.dropped, 0);
  const repaired = await loadChangeSet(directory, packet.id);
  assert.equal(repaired.status, "held"); assert.equal(repaired.semanticReview, undefined);
  assert.deepEqual(repaired.reviewSource, packet.reviewSource);
  assert.deepEqual(repaired.proposals.map(({ id, ...value }) => value), packet.proposals.map(({ id, ...value }) => value));
  assert.notEqual(semanticRevision(repaired), semanticRevision(packet));
  assert.doesNotThrow(() => validateStructure(repaired));
  assert.equal(new Set(semanticFacts(repaired).map(fact => fact.id)).size, 2);
  assert.equal((await semanticPage(directory, packet.id, { summary: true })).accepted, 0);
  assert.equal((await semanticPage(directory, packet.id, { summary: true })).totalFacts, 2);
  const archived = (await readdir(join(directory, "changesets"))).find(name => name.includes("superseded-revision"))!;
  assert.equal(await readFile(join(directory, "changesets", archived), "utf8"), before);
  assert.equal(await readFile(join(directory, "ontology", "entities.jsonl"), "utf8"), canonical);
  const repairedText = await readFile(file, "utf8");
  const repeated = await reviseProposals(directory, packet.id, { rekeyDuplicateIds: true }, "No duplicates remain.");
  assert.equal("rekeyed" in repeated && repeated.rekeyed, 0);
  assert.equal(await readFile(file, "utf8"), repairedText);
  repaired.status = "approved"; await saveChangeSet(directory, repaired);
  await assert.rejects(() => reviseProposals(directory, packet.id, { rekeyDuplicateIds: true }, "No applied repair."), /unapproved/);
  repaired.status = "held"; await saveChangeSet(directory, repaired);
  await writeFile(join(directory, "events.jsonl"), JSON.stringify({ event: { type: "changeset.applied", changesetId: packet.id } }) + "\n");
  await assert.rejects(() => reviseProposals(directory, packet.id, { rekeyDuplicateIds: true }, "No audit bypass."), /Applied packets/);
});

test("pending revision removes selected defects and dependent references without canonical writes or inferred facts", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "novel-revision-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const known: Entity = { id: "char_1", kind: "Character", names: [{ text: "甲", kind: "canonical", lang: "zh" }], properties: {}, confidence: 1 };
  await new BundleStore(join(directory, "ontology")).upsertEntity(known);
  const changeset = newChangeSet("b0002");
  changeset.status = "held";
  const proposal = (id: string, kind: ChangeProposal["kind"], payload: ChangeProposal["payload"]): ChangeProposal => ({ id, kind, payload, confidence: 0.7, provenance: { blockId: "b0002", sentenceIds: ["b0001_s0001"], patchId: "test" } });
  const event: OntEvent = { id: "evt_2", timelineId: "tl_canon", chapterIndex: 1, chronologicalOrder: 2, eventType: "action", summaryEn: "甲推开门。", evidence: { text: "甲推开门。", sentenceIds: ["b0001_s0001"] }, importance: 0.5, primaryActors: ["char_1", "char_bad", "loc_1"], affectedCharacters: [], confidence: 0.7 };
  changeset.proposals = [
    proposal("wrong_alias", "upsert_entity", { ...known, names: [...known.names, { text: "乙老师", kind: "alias", lang: "zh" }] }),
    proposal("placeholder", "upsert_entity", { ...known, id: "char_bad", names: [{ text: "他们", kind: "canonical", lang: "zh" }] }),
    proposal("place", "upsert_entity", { ...known, id: "loc_1", kind: "Location" }),
    proposal("event", "create_event", event),
    proposal("heading", "create_event", { ...event, id: "evt_heading", summaryEn: "第一章" }),
    proposal("scene", "create_scene", { id: "scene_2", chapterIndex: 1, sentenceIds: [], charactersPresent: ["char_1", "char_bad", "loc_1"], charactersMentioned: ["loc_1"], turns: [{ speakerId: "loc_1", addresseeId: "char_bad", sentenceIds: [] }], locationId: "char_1" }),
    proposal("bad_edge", "add_relation", { fromId: "loc_1", toId: "evt_2", type: "PARTICIPATES_IN", properties: {}, confidence: 1 }),
    proposal("heading_edge", "add_relation", { fromId: "evt_heading", toId: "evt_2", type: "CAUSES", properties: {}, confidence: 1 }),
    proposal("state", "set_state_change", { characterId: "char_bad", afterEventId: "evt_2", relationships: {} }),
  ];
  const file = await saveChangeSet(directory, changeset);
  const before = await readFile(file, "utf8");
  const canonical = await readFile(join(directory, "ontology", "entities.jsonl"), "utf8");
  await assert.rejects(reviseProposals(directory, changeset.id, { removeEntityIds: ["char_1"] }, "不能删除规范身份"));
  assert.equal(await readFile(file, "utf8"), before);
  const result = await reviseProposals(directory, changeset.id, { dropProposalIds: ["wrong_alias", "heading"], removeEntityIds: ["char_bad"], sanitizeTypes: true }, "原文没有支持错误别名、代词身份及章节标题事件");
  assert.equal(result.status, "held");
  assert.equal(await readFile(join(directory, "ontology", "entities.jsonl"), "utf8"), canonical);
  const revised = await loadChangeSet(directory, changeset.id);
  const revisedEvent = revised.proposals.find((entry) => entry.id === "event")!.payload as OntEvent;
  assert.deepEqual(revisedEvent.primaryActors, ["char_1"]);
  assert.equal(revisedEvent.summaryEn, "甲推开门。");
  const scene = revised.proposals.find((entry) => entry.kind === "create_scene")!.payload as Scene;
  assert.deepEqual(scene.charactersPresent, ["char_1"]);
  assert.deepEqual(scene.charactersMentioned, []);
  assert.deepEqual(scene.turns, [{ speakerId: null, addresseeId: null, sentenceIds: [] }]);
  assert.equal(scene.locationId, null);
  assert.ok(!revised.proposals.some((entry) => ["wrong_alias", "heading", "placeholder", "bad_edge", "heading_edge", "state"].includes(entry.id)));
  assert.ok((await readdir(join(directory, "changesets"))).some((name) => name.includes("superseded-revision")));
  assert.equal((await readFile(join(directory, "maintenance.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line))[0].op, "revise-proposals");
  revised.status = "approved";
  await saveChangeSet(directory, revised);
  await assert.rejects(reviseProposals(directory, revised.id, { sanitizeTypes: true }, "不能修改已批准资料"));
});

test("pending retyping retains identity and provenance while mention-only people are not made present", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "novel-retype-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const changeset = newChangeSet("b0001");
  changeset.status = "held";
  const provenance = { blockId: "b0001", sentenceIds: ["b0000_s0001"], patchId: "extraction" };
  const entity = (id: string, name: string): Entity => ({ id, kind: "Character", names: [{ text: name, kind: "canonical", lang: "zh" }], properties: {}, confidence: 0.7 });
  changeset.proposals = [
    { id: "family", kind: "upsert_entity", payload: entity("char_family", "甲家"), confidence: 0.7, provenance },
    { id: "person", kind: "upsert_entity", payload: entity("char_person", "乙"), confidence: 0.7, provenance },
    { id: "scene", kind: "create_scene", payload: { id: "scene_1", chapterIndex: 0, sentenceIds: provenance.sentenceIds, charactersPresent: ["char_family", "char_person"], charactersMentioned: [], turns: [{ speakerId: "char_person", addresseeId: null, sentenceIds: provenance.sentenceIds }], locationId: null }, confidence: 0.7, provenance },
    { id: "edge", kind: "add_relation", payload: { fromId: "char_person", toId: "scene_1", type: "PRESENT_IN", confidence: 0.7, properties: {} }, confidence: 0.7, provenance },
  ];
  const file = await saveChangeSet(directory, changeset);
  const before = await readFile(file, "utf8");
  await assert.rejects(reviseProposals(directory, changeset.id, { retypeEntities: [{ entityId: "char_family", kind: "Organization" }] }, "集体不是个人"));
  assert.equal(await readFile(file, "utf8"), before);
  await reviseProposals(directory, changeset.id, { retypeEntities: [{ entityId: "char_family", kind: "Organization" }], mentionedOnlyEntityIds: ["char_person"], sanitizeTypes: true }, "甲家是集体，乙只在叙述中被提及");
  const revised = await loadChangeSet(directory, changeset.id);
  const family = revised.proposals.find((proposal) => proposal.id === "family")!;
  assert.equal((family.payload as Entity).kind, "Organization");
  assert.equal((family.payload as Entity).id, "char_family");
  assert.deepEqual(family.provenance, provenance);
  const scene = revised.proposals.find((proposal) => proposal.id === "scene")!.payload as Scene;
  assert.deepEqual(scene.charactersPresent, []);
  assert.deepEqual(scene.charactersMentioned, ["char_person"]);
  assert.equal(scene.turns[0].speakerId, null);
  assert.equal((revised.proposals.find((proposal) => proposal.id === "edge")!.payload as { type: string }).type, "MENTIONED_IN");
  assert.equal(await readFile(join(directory, "ontology", "entities.jsonl"), "utf8"), "");
});
