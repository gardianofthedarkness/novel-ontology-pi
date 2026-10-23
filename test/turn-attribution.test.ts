import { test } from "node:test";
import assert from "node:assert/strict";
import { turnContext, joinAttributedTurns, attributeBlockTurns } from "../src/processing/turnAttribution.js";
import { DecisionRouter } from "../src/processing/decisionRouter.js";
import { FacultyPool } from "../src/processing/facultyPool.js";
import type { Sentence } from "../src/text/sectioning.js";
import type { NamedTurn } from "../src/extraction/extraction.js";
import { FacultyGraph } from "../src/processing/facultyGraph.js";
import { sectionBlock } from "../src/text/sectioning.js";
import { createExtractor } from "../src/extraction/extraction.js";
import type { Entity, Scene } from "../src/ontology/types.js";
import { newChangeSet } from "../src/merge/changeset.js";

const sentences: Sentence[] = ["小明走来。", "他停下。", "「你好。」", "她回答。", "小红微笑。"].map((text, index) => ({ id: `b0001_s${String(index).padStart(4, "0")}`, index, paragraphIndex: index, text, startOffset: index * 10, endOffset: index * 10 + text.length }));

test("turn evidence crosses arbitrary scene boundaries without widening its writable core", () => {
  const chunk = turnContext(sentences, [sentences[2].id], 2);
  assert.deepEqual(chunk.core, [sentences[2]]);
  assert.deepEqual(chunk.context, sentences);
  assert.throws(() => turnContext(sentences, [sentences[0].id, sentences[2].id]), /contiguous/);
  assert.throws(() => turnContext(sentences, [sentences[2].id], 2, 1), /no truncation/);
  assert.throws(() => turnContext(sentences, [sentences[2].id, sentences[1].id]), /original order/);
  assert.throws(() => turnContext(sentences, [sentences[2].id], -1), /Invalid/);
});

test("neighbor blocks and reviewer constraints are read-only attribution evidence", async () => {
  const before = { ...sentences[0], id: "b0000_s0000", text: "此前小红走来。" };
  const after = { ...sentences[0], id: "b0002_s0000", text: "随后小明离开。" };
  const turns = await attributeBlockTurns({ sentences, contextSentences: [before, ...sentences, after], constraintsText: "REVIEWER CONSTRAINTS: distinguish the two people\n", selectedSpans: [[2, 2]], identities: { newEntities: [{ name: "小红", kind: "Character" }] }, knownNames: [], router: new DecisionRouter(),
    decisions: { modelId: "mock", async decide(state, questions) {
      assert.ok(state.startsWith("REVIEWER CONSTRAINTS:"));
      assert.ok(state.includes(before.id) && state.includes(after.id));
      assert.ok(!questions[0].instructions.includes(before.id));
      return questions.map(question => ({ key: question.key, value: "小红", confidence: 0.99 }));
    } }, pool: new FacultyPool({ modelId: "mock", async generate() { throw new Error("No S2 expected"); } }), note() {},
  });
  assert.deepEqual(turns[0].sentenceIds, [sentences[2].id]);
});

test("oversized attribution states remain unknown without truncation or paid calls", async () => {
  const notes: string[] = [];
  const turns = await attributeBlockTurns({ sentences, selectedSpans: [[2, 2]], identities: { newEntities: [{ name: "小红", kind: "Character" }] }, knownNames: [], router: new DecisionRouter({ maxContextBytes: 1 }),
    decisions: { modelId: "mock", async decide() { assert.fail("Oversized state must not call S1"); } },
    pool: new FacultyPool({ modelId: "mock", async generate() { assert.fail("Oversized state must not call S2"); } }), note(key, message) { notes.push(message); },
  });
  assert.equal(turns[0].speakerName, null);
  assert.deepEqual(turns[0].sentenceIds, [sentences[2].id]);
  assert.ok(notes.some(message => message.includes("oversized")));
});

test("failed structure repair retains provisional spans without guessing a speaker", async () => {
  const source = sentences.map((sentence, index) => ({ ...sentence, text: index === 0 || index === 4 ? "「说话。」" : sentence.text }));
  const notes: string[] = [];
  const turns = await attributeBlockTurns({ sentences: source, selectedSpans: [[0, 4]], identities: { newEntities: [{ name: "小红", kind: "Character" }] }, knownNames: [], router: new DecisionRouter(),
    decisions: { modelId: "mock", async decide() { assert.fail("Unvalidated units must not be attributed"); } },
    pool: new FacultyPool({ modelId: "mock", async generate() { throw new Error("private failure"); } }), note(key, message) { notes.push(message); },
  });
  assert.equal(turns[0].speakerName, null);
  assert.deepEqual(turns[0].sentenceIds, source.map(sentence => sentence.id));
  assert.ok(notes.some(message => message.includes("structure remains unresolved")));
  assert.ok(notes.every(message => !message.includes("private failure")));
});

test("reviewer pins keep their original scene-scoped meaning when block-turn mode is selected", async () => {
  const source = sectionBlock("小红说：“你好。”", 0).sentences;
  const key = `dlg_start:${source[0].id}`;
  let identityCalls = 0;
  const graph = new FacultyGraph({ modelId: "mock", async decide(state, questions) { return questions.map(question => ({ key: question.key, value: source[0].id, confidence: 0.99 })); } }, {
    modelId: "mock", async generate(request) {
      assert.ok(!request.system.startsWith("FACULTY: dialogue-structure") && !request.system.startsWith("FACULTY: speaker-attribution"));
      if (request.system.startsWith("FACULTY: entities-participants")) { identityCalls++; return JSON.stringify({ newEntities: [], charactersPresent: [], charactersMentioned: [], locationName: null }); }
      return JSON.stringify({ events: [] });
    },
  }, { dialogueScope: "block-turn" });
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences: source, knownEntities: [], pins: new Map([[key, "NONE"]]) });
  assert.ok(result.miniloop.appliedPins?.includes(key));
  assert.ok(result.miniloop.changeset.reviewNotes["faculty:pinned-dialogue-scope"]);
  assert.equal(result.miniloop.accepted.blockIdentityDeclarations, undefined);
  assert.equal(identityCalls, 1);
  assert.deepEqual((await result.sceneResults.get(source[0].id))?.turns, []);
  assert.equal(result.miniloop.changeset.status, "pending_review");
});

test("scene joining clips references only and never reassigns an independently attributed speaker", () => {
  const turns: NamedTurn[] = [{ sentenceIds: sentences.slice(1, 4).map(row => row.id), speakerName: "小红", addresseeName: "小明" }];
  const before = structuredClone(turns);
  const joined = [joinAttributedTurns(turns, sentences.slice(0, 3).map(row => row.id)), joinAttributedTurns(turns, sentences.slice(3).map(row => row.id))].flat();
  assert.deepEqual(joined.flatMap(turn => turn.sentenceIds), turns[0].sentenceIds);
  assert.ok(joined.every(turn => turn.speakerName === "小红"));
  assert.deepEqual(turns, before);
});

test("per-turn retry can use a block identity and context outside a scene without invoking S2", async () => {
  const states: string[] = [];
  const router = new DecisionRouter();
  const source = Array.from({ length: 20 }, (_, index) => ({ ...sentences[0], id: `b0001_s${String(index).padStart(4, "0")}`, index, text: index === 10 ? "「你好。」" : index === 0 ? "小红开口。" : "他停下。" }));
  const turns = await attributeBlockTurns({ sentences: source, selectedSpans: [[10, 10]], identities: { newEntities: [{ name: "小红", kind: "Character" }] }, knownNames: [], router,
    decisions: { modelId: "mock", async decide(state, questions) { states.push(state); return questions.map(question => ({ key: question.key, value: "小红", confidence: states.length === 1 ? 0.1 : 0.99 })); } },
    pool: new FacultyPool({ modelId: "mock", async generate() { throw new Error("No fallback expected"); } }), note() {},
  });
  assert.equal(turns[0].speakerName, "小红");
  assert.equal(router.metrics["dialogue-attribution"].retryRecovered, 1);
  assert.equal(router.metrics["dialogue-attribution"].retrySkipped, 0);
  assert.ok(!states[0].includes("小红开口"));
  assert.ok(states[1].includes("小红开口"));
  assert.equal(turns[0].sentenceIds.length, 1);
});

test("speaker fallback preserves the fixed target and cannot add provider-suggested neighboring speech", async () => {
  const router = new DecisionRouter({ enabled: false });
  const turns = await attributeBlockTurns({ sentences, selectedSpans: [[2, 2]], identities: { newEntities: [{ name: "小红", kind: "Character" }] }, knownNames: [], router,
    decisions: { modelId: "mock", async decide(state, questions) { return questions.map(question => ({ key: question.key, value: "unknown", confidence: 0.1 })); } },
    pool: new FacultyPool({ modelId: "mock", async generate(request) { assert.ok(request.system.includes("speaker-attribution")); assert.ok(request.prompt.includes("小红微笑")); return JSON.stringify({ speaker: "小红", addressee: null, first: sentences[0].id, last: sentences[4].id }); } }), note() {},
  });
  assert.equal(turns[0].speakerName, "小红");
  assert.deepEqual(turns[0].sentenceIds, [sentences[2].id]);
});

test("the experimental graph attributes block turns independently and only then joins them into two scenes", async () => {
  const source = sectionBlock("小樱说道：“早上好。”\n小樱坐下。\n小樱说道：“再见。”\n小樱离开。", 0).sentences;
  const ids = source.map(sentence => sentence.id);
  const graph = new FacultyGraph({ modelId: "mock", async decide(state, questions) {
    return questions.map(question => {
      if (question.key.startsWith("speaker:")) {
        assert.ok(state.includes(ids[0]) && state.includes(ids[2]));
        assert.ok(question.options?.includes("小樱"));
        return { key: question.key, value: "小樱", confidence: 0.99 };
      }
      if (question.key.startsWith("scene_end:")) return { key: question.key, value: question.key.endsWith(ids[0]) ? ids[1] : ids[3], confidence: 0.99 };
      if (question.key.startsWith("scene_start:")) return { key: question.key, value: question.key.endsWith(ids[0]) ? ids[2] : "NONE", confidence: 0.99 };
      return { key: question.key, value: "NONE", confidence: 0.99 };
    });
  } }, { modelId: "mock", async generate(request) {
    if (request.system.startsWith("FACULTY: entities-participants")) return JSON.stringify({ newEntities: [{ name: "小樱", kind: "Character", aliases: [] }], charactersPresent: ["小樱"], charactersMentioned: [], locationName: null });
    if (request.system.startsWith("FACULTY: dialogue-structure")) return JSON.stringify({ turns: [{ first: ids[0], last: ids[0] }, { first: ids[2], last: ids[2] }] });
    assert.ok(!request.system.startsWith("FACULTY: speaker-attribution"));
    return JSON.stringify({ events: [] });
  } }, { dialogueScope: "block-turn" });
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences: source, knownEntities: [] });
  assert.equal(result.sceneResults.size, 2);
  assert.deepEqual((result.miniloop.accepted.blockNamedTurns as NamedTurn[]).map(turn => turn.speakerName), ["小樱", "小樱"]);
  assert.deepEqual((await result.sceneResults.get(ids[0]))?.turns.map(turn => turn.sentenceIds), [[ids[0]]]);
  assert.deepEqual((await result.sceneResults.get(ids[2]))?.turns.map(turn => turn.sentenceIds), [[ids[2]]]);
  const declarations = result.miniloop.accepted.blockIdentityDeclarations as NonNullable<import("../src/extraction/extraction.js").LlmScene["newEntities"]>;
  declarations.push({ name: "无来源的名字", kind: "Character" });
  for (const [key, pending] of result.sceneResults) {
    const value = await pending;
    result.sceneResults.set(key, Promise.resolve({ ...value, scene: { ...value.scene, newEntities: [], charactersPresent: [], charactersMentioned: [] } }));
  }
  const output = await createExtractor({ modelId: "unused", async generate() { throw new Error("No new model calls during assembly"); } })({ blockId: "b0001", chapterIndex: 0, sentences: source, miniloop: result.miniloop, sceneResults: result.sceneResults, knownEntities: [], proposals: [], counts: { events: 0, scenes: 0 } });
  const identities = output.proposals.filter(proposal => proposal.kind === "upsert_entity").map(proposal => proposal.payload as Entity);
  assert.equal(identities.length, 1);
  assert.equal(identities[0].names[0].text, "小樱");
  const scenes = output.proposals.filter(proposal => proposal.kind === "create_scene").map(proposal => proposal.payload as Scene);
  assert.ok(scenes.every(scene => scene.turns[0].speakerId === identities[0].id));
  assert.ok(scenes.every(scene => scene.charactersPresent.length === 0));
  const identityProposal = output.proposals.find(proposal => proposal.kind === "upsert_entity")!;
  assert.deepEqual(identityProposal.provenance.sentenceIds, [ids[0], ids[1], ids[2], ids[3]]);
});

test("block identity declarations cannot fuse already distinct owners during assembly", async () => {
  const known: Entity[] = ["小明", "小红"].map((text, index) => ({ id: `char_${index + 1}`, kind: "Character", names: [{ text, lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 }));
  const ids = sentences.map(sentence => sentence.id);
  const miniloop = { changeset: newChangeSet("b0001"), escalations: [], windows: [], accepted: { sceneSpans: [ids], blockIdentityDeclarations: [{ name: "小明", kind: "Character", aliases: [{ text: "小红", kind: "alias" }] }] } };
  const output = await createExtractor({ modelId: "unused", async generate() { throw new Error("Assembly is deterministic"); } })({ blockId: "b0001", chapterIndex: 0, sentences, miniloop, knownEntities: known, proposals: [], counts: { events: 0, scenes: 0 }, sceneResults: new Map([[ids[0], Promise.resolve({ scene: { newEntities: [], events: [], charactersPresent: [], charactersMentioned: [] }, turns: [{ sentenceIds: [ids[2]], speakerName: "小红", addresseeName: null }], notes: [] })]]) });
  assert.equal(output.proposals.filter(proposal => proposal.kind === "upsert_entity").length, 0);
  assert.ok(Object.keys(output.notes).some(key => key.startsWith("faculty:block-identity-conflict:")));
  assert.equal((output.proposals.find(proposal => proposal.kind === "create_scene")!.payload as Scene).turns[0].speakerId, known[1].id);
});

test("folding a later block alias preserves the source provenance of every accepted form", async () => {
  const source = [...sentences, { ...sentences[0], id: "b0001_s0005", index: 5, text: "红红抬头。" }];
  const ids = source.map(sentence => sentence.id);
  const miniloop = { changeset: newChangeSet("b0001"), escalations: [], windows: [], accepted: { sceneSpans: [ids], blockIdentityDeclarations: [{ name: "小红", kind: "Character", aliases: [] }, { name: "小红", kind: "Character", aliases: [{ text: "红红", kind: "nickname" }] }] } };
  const output = await createExtractor({ modelId: "unused", async generate() { throw new Error("Assembly is deterministic"); } })({ blockId: "b0001", chapterIndex: 0, sentences: source, miniloop, knownEntities: [], proposals: [], counts: { events: 0, scenes: 0 }, sceneResults: new Map([[ids[0], Promise.resolve({ scene: { newEntities: [], events: [], charactersPresent: [], charactersMentioned: [] }, turns: [], notes: [] })]]) });
  const entities = output.proposals.filter(proposal => proposal.kind === "upsert_entity");
  assert.equal(entities.length, 1);
  assert.deepEqual((entities[0].payload as Entity).names.map(name => name.text), ["小红", "红红"]);
  assert.deepEqual(entities[0].provenance.sentenceIds, [ids[4], ids[5]]);
});
