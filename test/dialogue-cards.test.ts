import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { attributeDialogueCards, joinDialogueCards } from "../src/digger/processing/dialogueCards.js";
import { DecisionRouter } from "../src/digger/processing/decisionRouter.js";
import { FacultyPool } from "../src/digger/processing/facultyPool.js";
import { FacultyGraph } from "../src/digger/processing/facultyGraph.js";
import { createExtractor } from "../src/digger/extraction/extraction.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import { materializeSemantic, semanticFacts, semanticRevision } from "../src/solidifier/merge/semantic.js";
import { decideFacts, semanticPage } from "../src/solidifier/merge/semanticCommands.js";
import { newChangeSet } from "../src/solidifier/merge/changeset.js";
import { saveChangeSet } from "../src/solidifier/merge/changesetStore.js";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { BundleStore } from "../src/ground/connectors/bundle.js";
import { buildGraphFromBundle, LadybugStore } from "../src/ground/connectors/ladybug.js";
import { mergeEntities, removeEntity } from "../src/solidifier/maintenance/fixes.js";
import type { Entity, Scene } from "../src/ground/ontology/types.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import type { WorkModel } from "../src/ground/connectors/llm.js";

const entity = (id: string, name: string): Entity => ({ id, kind: "Character", names: [{ text: name, lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 });
const cast = [entity("char_000001", "甲"), entity("char_000002", "乙"), entity("char_000003", "丙")];
const source = sectionBlock("甲说：「你好。」乙回答：「请进。」甲点头。旁白提到丙。", 0).sentences;
const unusedWork: WorkModel = { modelId: "unused", async generate() { throw new Error("Unexpected work request"); } };

test("cards support both monologues and three-person exchanges without a one-winner choice", async () => {
  for (const members of [["甲"], ["甲", "乙", "丙"]]) {
    const sentences = sectionBlock(members.length === 1 ? "甲说：「今天停课。」甲继续说：「明天见。」" : "甲问：「今天停课吗？」乙说：「是的。」丙插话：「明天见。」", 0).sentences;
    const decisions: DecisionModel = { modelId: "mock", async decide(_state, questions) {
      return questions.map(question => ({ key: question.key, value: members.some(name => question.instructions.startsWith(`Does ${name} `)) ? "participates" : "not-participating", confidence: 1 }));
    } };
    const cards = await attributeDialogueCards({ blockId: "b0001", sentences, selectedSpans: [[0, sentences.length - 1]], identities: {}, knownEntities: cast, decisions, router: new DecisionRouter(), pool: new FacultyPool(unusedWork), note() {} });
    assert.deepEqual(cards[0].participantNames, members);
    assert.equal(cards.length, 1);
  }
});

test("one exchange keeps alternating voices and independent members, excluding a mentioned candidate", async () => {
  const decisions: DecisionModel = { modelId: "mock", async decide(state, questions) {
    assert.ok(state.includes("TARGET EXCHANGE"));
    assert.ok(questions.every(question => question.key.startsWith("dialogue-member:")));
    assert.ok(questions.every(question => question.options?.length === 3));
    return questions.map(question => ({ key: question.key, value: question.instructions.includes("丙") ? "not-participating" : "participates", confidence: 0.99 }));
  } };
  const result = await attributeDialogueCards({ blockId: "b0001", sentences: source, selectedSpans: [[0, source.length - 1]], identities: {}, knownEntities: cast, decisions, router: new DecisionRouter(), pool: new FacultyPool(unusedWork), note() {} });
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].participantNames, ["甲", "乙"]);
  assert.deepEqual(result[0].unresolvedNames, []);
  assert.deepEqual(result[0].sentenceIds, source.map(sentence => sentence.id));
  const halves = [joinDialogueCards(result, source.slice(0, 2).map(sentence => sentence.id)), joinDialogueCards(result, source.slice(2).map(sentence => sentence.id))];
  assert.equal(halves[0][0].id, halves[1][0].id);
  assert.deepEqual(halves.flat().flatMap(card => card.sentenceIds), result[0].sentenceIds);
});

test("membership widens S1 context, shares one bounded S2 call, and preserves unknowns", async () => {
  const sentences = sectionBlock(Array.from({ length: 80 }, (_, index) => `第${index}处甲乙丙留下记号。`).join("\n"), 0).sentences;
  const router = new DecisionRouter({ enabled: true });
  let fallbackCalls = 0;
  const decisions: DecisionModel = { modelId: "mock", async decide(state, questions) {
    return questions.map(question => ({ key: question.key, value: state.startsWith("READ-ONLY") && question.instructions.includes("甲") ? "participates" : "unknown", confidence: 0.99 }));
  } };
  const work: WorkModel = { modelId: "mock", async generate(request) {
    fallbackCalls++;
    assert.ok(request.system.startsWith("FACULTY: dialogue-participants"));
    assert.ok(request.prompt.startsWith("READ-ONLY"));
    return JSON.stringify({ memberships: [{ name: "乙", participates: true }, { name: "丙", participates: null }] });
  } };
  const cards = await attributeDialogueCards({ blockId: "b0001", sentences, selectedSpans: [[40, 42]], identities: {}, knownEntities: cast, decisions, router, pool: new FacultyPool(work), note() {} });
  assert.deepEqual(cards[0].participantNames, ["甲", "乙"]);
  assert.deepEqual(cards[0].unresolvedNames, ["丙"]);
  assert.equal(fallbackCalls, 1);
  assert.equal(router.metrics["dialogue-participants"].retryRecovered, 1);
  assert.equal(router.metrics["dialogue-participants"].system2Resolved, 1);
  assert.equal(router.metrics["dialogue-participants"].unresolved, 1);
});

test("oversized exchange context keeps original source and unresolved candidates without calls", async () => {
  const sentences = sectionBlock("甲".repeat(5000) + "。", 0).sentences;
  let calls = 0;
  const decisions: DecisionModel = { modelId: "mock", async decide() { calls++; return []; } };
  const cards = await attributeDialogueCards({ blockId: "b0001", sentences, selectedSpans: [[0, 0]], identities: {}, knownEntities: cast, decisions, router: new DecisionRouter(), pool: new FacultyPool(unusedWork), note() {} });
  assert.equal(calls, 0);
  assert.deepEqual(cards[0].sentenceIds, [sentences[0].id]);
  // Only the candidate the passage names stays undecided; 乙 and 丙 are not named near it.
  assert.deepEqual(cards[0].unresolvedNames, ["甲"]);
});

test("only characters named near an exchange are asked about; an unknown about anyone else is not a fact", async () => {
  const people = [...cast, entity("char_000004", "丁")];
  const asked: string[][] = [];
  const decisions: DecisionModel = { modelId: "mock", async decide(_state, questions) {
    asked.push(questions.map(question => /^Does (\S+) /.exec(question.instructions)![1]));
    return questions.map(question => ({ key: question.key, value: question.instructions.startsWith("Does 甲 ") ? "participates" : "unknown", confidence: 0.99 }));
  } };
  const sentences = sectionBlock("甲问：「走吗？」乙说：「走。」", 0).sentences;
  const named = await attributeDialogueCards({ blockId: "b0001", sentences, selectedSpans: [[0, sentences.length - 1]], identities: {}, knownEntities: people, decisions, router: new DecisionRouter(), pool: new FacultyPool(unusedWork), note() {} });
  assert.deepEqual(asked[0], ["甲", "乙"], "丙 and 丁 are not named near the exchange");
  assert.deepEqual([named[0].participantNames, named[0].unresolvedNames], [["甲"], ["乙"]]);
  // A passage naming no one: the block's present characters are asked, and an unknown about them is dropped.
  asked.length = 0;
  const unnamed = sectionBlock("「走吗？」「走。」", 0).sentences;
  const pronouns = await attributeDialogueCards({ blockId: "b0001", sentences: unnamed, selectedSpans: [[0, unnamed.length - 1]], identities: { charactersPresent: ["丁"] }, knownEntities: people, decisions, router: new DecisionRouter(), pool: new FacultyPool(unusedWork), note() {} });
  assert.deepEqual(asked[0], ["丁"]);
  assert.deepEqual([pronouns[0].participantNames, pronouns[0].unresolvedNames], [[], []]);
});

test("default faculty graph emits multi-person cards, not speaker/turn adjudication, through extraction", async () => {
  const decisions: DecisionModel = { modelId: "mock", async decide(_state, questions) {
    assert.ok(questions.every(question => !question.key.startsWith("speaker:")));
    return questions.map(question => ({ key: question.key, confidence: 0.99, value:
      question.key.startsWith("scene_end:") ? source.at(-1)!.id :
      question.key.startsWith("dlg_kind:") ? [source[0].id, source[1].id].some(id => question.key.endsWith(`:${id}`)) ? "spoken" : "narration" :
      question.key.startsWith("dlg_turn:") ? 0 :
      question.key.startsWith("dialogue-member:") ? question.instructions.includes("丙") ? "not-participating" : "participates" : "NONE" }));
  } };
  const work: WorkModel = { modelId: "mock", async generate(request) {
    assert.ok(!/FACULTY: (speaker-attribution|dialogue-structure|dialogue-adjudication)/.test(request.system));
    return request.system.startsWith("FACULTY: entities-participants") ? JSON.stringify({ newEntities: [], charactersPresent: ["甲", "乙"], charactersMentioned: ["丙"], locationName: null }) : JSON.stringify({ summary: "甲乙交谈。", events: [] });
  } };
  const graph = new FacultyGraph(decisions, work);
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences: source, knownEntities: cast });
  const output = await createExtractor(work)({ blockId: "b0001", chapterIndex: 0, sentences: source, miniloop: result.miniloop, knownEntities: cast, proposals: [], counts: { events: 0, scenes: 0 }, sceneResults: result.sceneResults });
  const scene = output.proposals.find(proposal => proposal.kind === "create_scene")!.payload as Scene;
  assert.deepEqual(scene.turns, []);
  assert.equal(scene.dialogues?.length, 1);
  assert.deepEqual(scene.dialogues![0].participantIds, cast.slice(0, 2).map(character => character.id));
  assert.ok(!output.proposals.some(proposal => proposal.kind === "add_relation" && ["SPEAKS_TO", "ADDRESSES", "KNOWS"].includes(String((proposal.payload as { type?: string }).type))));
});

function packetFixture() {
  const packet = newChangeSet("b0001");
  packet.reviewSource = source;
  packet.status = "held";
  const card = { id: "dialogue:b0001:exchange", sentenceIds: source.map(sentence => sentence.id), participantIds: cast.map(character => character.id) };
  const scene: Scene = { id: "scene_1", chapterIndex: 0, sentenceIds: [...card.sentenceIds], turns: [], dialogues: [card], charactersPresent: [], charactersMentioned: [], locationId: null };
  packet.proposals.push({ id: "scene-proposal", kind: "create_scene", payload: scene, confidence: 1, provenance: { blockId: packet.blockId, sentenceIds: [...card.sentenceIds], patchId: "fixture" } });
  return { packet, scene };
}

test("membership holds and dependency holds do not erase supported members or text", () => {
  const { packet } = packetFixture();
  const facts = semanticFacts(packet);
  assert.deepEqual(facts.map(fact => fact.field), ["dialogue-member", "dialogue-member", "dialogue-member"]);
  packet.semanticReview = { version: 1, revision: semanticRevision(packet), decisions: facts.map((fact, index) => ({ factId: fact.id, verdict: index === 2 ? "hold" : "accept", reason: "原文支持" })) };
  const result = materializeSemantic(packet, cast.slice(0, 1));
  const scene = result.proposals[0].payload as Scene;
  assert.deepEqual(scene.dialogues![0].participantIds, [cast[0].id]);
  assert.deepEqual(scene.dialogues![0].sentenceIds, source.map(sentence => sentence.id));
  assert.equal(result.deferredFactIds.length, 2);
  assert.equal(result.verifiedFacts, 1);
  assert.ok(!result.proposals.some(proposal => proposal.kind === "add_relation"));
});

test("scene-cut card fragments share one membership fact and decision", () => {
  const { packet, scene } = packetFixture();
  scene.dialogues![0].participantIds = [cast[0].id];
  scene.sentenceIds = source.slice(0, 2).map(sentence => sentence.id);
  scene.dialogues![0].sentenceIds = [...scene.sentenceIds];
  const second: Scene = { ...scene, id: "scene_2", sentenceIds: source.slice(2).map(sentence => sentence.id), dialogues: [{ ...scene.dialogues![0], sentenceIds: source.slice(2).map(sentence => sentence.id) }] };
  packet.proposals.push({ ...packet.proposals[0], id: "second-scene", payload: second });
  const facts = semanticFacts(packet);
  assert.equal(facts.length, 1);
  assert.deepEqual(facts[0].sentenceIds, source.map(sentence => sentence.id));
  packet.semanticReview = { version: 1, revision: semanticRevision(packet), decisions: [{ factId: facts[0].id, verdict: "accept", reason: "原文支持" }] };
  const result = materializeSemantic(packet, cast);
  assert.ok(result.proposals.every(proposal => (proposal.payload as Scene).dialogues![0].participantIds[0] === cast[0].id));
});

test("real fact CLI backend persists independent decisions, aliases remap members, and Ladybug exposes cards", async context => {
  const parent = await mkdtemp(join(tmpdir(), "dialogue-cards-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const store = new BundleStore(join(directory, "ontology"));
  for (const character of cast) await store.upsertEntity(character);
  const { packet, scene } = packetFixture();
  await saveChangeSet(directory, packet);
  const page = await semanticPage(directory, packet.id);
  assert.equal(page.unreviewed, 3);
  const facts = semanticFacts(packet);
  await decideFacts(directory, packet.id, page.revision, facts.map((fact, index) => ({ factId: fact.id, verdict: index === 2 ? "reject" : "accept", reason: "原文核对" })));
  const decided = await semanticPage(directory, packet.id);
  assert.equal(decided.unreviewed, 0);
  assert.equal(decided.rejected, 1);
  await promisify(execFile)(process.execPath, ["dist/src/cli/cli.js", "changeset", "approve", directory, packet.id]);
  assert.deepEqual((await store.loadFile<Scene>("scenes.jsonl"))[0].dialogues![0].participantIds, [cast[0].id, cast[1].id]);
  await mergeEntities(directory, cast[0].id, cast[1].id, "测试同一身份的审计重定向");
  const updated = (await store.loadFile<Scene>("scenes.jsonl"))[0];
  assert.deepEqual(updated.dialogues![0].participantIds, [cast[0].id]);
  await removeEntity(directory, cast[0].id, "测试移除");
  const graphPath = join(directory, "ontology", "graph.lbug");
  await buildGraphFromBundle(join(directory, "ontology"), graphPath);
  const graph = new LadybugStore(graphPath);
  try {
    const rows = await graph.run("MATCH (s:Scene) RETURN s.dialogue_cards_json AS cards");
    assert.deepEqual(JSON.parse(String(rows[0].cards))[0].participantIds, []);
    assert.deepEqual(await graph.run("MATCH (:Character)-[r:SPEAKS_TO]->(:Character) RETURN r"), []);
  } finally { await graph.close(); }
});
