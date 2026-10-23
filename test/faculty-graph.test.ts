import { test } from "node:test";
import assert from "node:assert/strict";
import { setImmediate as nextTurn } from "node:timers/promises";
import { FacultyPool } from "../src/processing/facultyPool.js";
import { FacultyGraph } from "../src/processing/facultyGraph.js";
import { sourceChunks, renderSentences } from "../src/processing/facultyContext.js";
import { sectionBlock } from "../src/text/sectioning.js";
import { createExtractor } from "../src/extraction/extraction.js";
import type { DecisionModel } from "../src/connectors/jev.js";
import type { WorkModel } from "../src/connectors/llm.js";
import type { Entity, Scene } from "../src/ontology/types.js";
import { groundFacultyProposals } from "../src/processing/facultyGrounding.js";
import { previewFacultyStates } from "../src/processing/facultyContinuity.js";
import type { OntologyStore } from "../src/ontology/store.js";

const request = { system: "Return JSON", prompt: "source", maxTokens: 100 };
const character: Entity = { id: "char_000001", kind: "Character", names: [{ text: "小樱", lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 };

test("faculty pool bounds concurrency, reserves adjudication capacity, deduplicates and redacts errors", async () => {
  const releases: (() => void)[] = [];
  const started: string[] = [];
  const work: WorkModel = { modelId: "mock", async generate(input) { started.push(input.prompt); await new Promise<void>(resolve => releases.push(resolve)); return "{}"; } };
  const pool = new FacultyPool(work, { concurrency: 3 });
  const first = pool.generate("summary", request);
  const duplicate = pool.generate("summary", request);
  const second = pool.generate("summary", { ...request, prompt: "second" });
  const third = pool.generate("summary", { ...request, prompt: "third" });
  await nextTurn();
  assert.deepEqual(started, ["source", "second"]);
  const urgent = pool.generate("dialogue", { ...request, prompt: "urgent" }, 2);
  await nextTurn();
  assert.deepEqual(started, ["source", "second", "urgent"]);
  releases.splice(0).forEach(release => release());
  await nextTurn();
  releases.splice(0).forEach(release => release());
  await Promise.all([first, duplicate, second, third, urgent]);
  assert.equal(pool.metrics.peakActive, 3);
  assert.equal(pool.metrics.cacheHits, 1);
  assert.equal(pool.metrics.calls, 4);
  const failure = new FacultyPool({ modelId: "bad", generate() { throw new Error("PRIVATE provider payload"); } });
  await assert.rejects(failure.generate("dialogue", request), error => error instanceof Error && !error.message.includes("PRIVATE"));
  await assert.rejects(new FacultyPool(work, { maxInputBytes: 1 }).generate("summary", request), /byte budget/);
  const observer = new FacultyPool({ modelId: "mock", generate: async () => "{}" }, { onCall: () => { throw new Error("observer failed"); } });
  assert.equal(await observer.generate("summary", request), "{}");
  const budget = new FacultyPool({ modelId: "mock", generate: async () => "{}" }, { maxCalls: 1 });
  await budget.generate("summary", request);
  await assert.rejects(budget.generate("summary", { ...request, prompt: "another" }), /budget exhausted/);
});

test("faculty source chunks retain every sentence once and never truncate oversized text", () => {
  const sentences = sectionBlock(Array.from({ length: 70 }, (_, index) => `第${index}句，保持原文。`).join("\n"), 0).sentences;
  const chunks = sourceChunks(sentences, { maxBytes: 300, maxSentences: 7, margin: 2 });
  assert.deepEqual(chunks.flatMap(chunk => chunk.core.map(sentence => sentence.id)), sentences.map(sentence => sentence.id));
  for (const chunk of chunks) assert.ok(Buffer.byteLength(renderSentences(chunk.context), "utf8") <= 300);
  assert.throws(() => sourceChunks(sectionBlock("长".repeat(1000), 0).sentences, { maxBytes: 30 }), /not truncated/);
});

test("closed scenes start identity and understanding before dialogue or segmentation finishes; final proposals remain ordered", async () => {
  const sentences = sectionBlock("小樱说道：“早上好。”\n小樱坐下。\n小樱说道：“再见。”\n小樱离开。", 0).sentences;
  const ids = sentences.map(sentence => sentence.id);
  let understandingStarted = false;
  let dialogueFinished = false;
  let segmentationFinished = false;
  let releaseDialogue!: () => void;
  const waitDialogue = new Promise<void>(resolve => { releaseDialogue = resolve; });
  const decisions: DecisionModel = {
    modelId: "mock-jev",
    async decide(_state, questions) {
      return Promise.all(questions.map(async question => {
        if (question.key.startsWith("dlg_start:")) { await waitDialogue; dialogueFinished = true; return { key: question.key, value: "NONE", confidence: 0.99 }; }
        if (question.key.startsWith("scene_end:")) return { key: question.key, value: question.key.endsWith(ids[0]) ? ids[1] : ids[3], confidence: 0.99 };
        if (question.key.startsWith("scene_start:")) { if (question.key.endsWith(ids[0])) return { key: question.key, value: ids[2], confidence: 0.99 }; segmentationFinished = true; return { key: question.key, value: "NONE", confidence: 0.99 }; }
        return { key: question.key, value: "unknown", confidence: 0.2 };
      }));
    },
  };
  const work: WorkModel = {
    modelId: "mock-work",
    async generate(input) {
      await nextTurn();
      if (input.system.startsWith("FACULTY: entities-participants")) return JSON.stringify({ newEntities: [], charactersPresent: ["小樱"], charactersMentioned: [], locationName: null });
      if (input.system.startsWith("FACULTY: dialogue-adjudication")) {
        const first = input.prompt.includes(`CORE: ${ids[0]}`) ? ids[0] : ids[2];
        return JSON.stringify({ turns: [{ first, last: first, speaker: "小樱", addressee: null }] });
      }
      if (!understandingStarted) {
        assert.equal(dialogueFinished, false);
        assert.equal(segmentationFinished, false);
        understandingStarted = true;
        releaseDialogue();
      }
      const first = input.prompt.includes(`${ids[0]}:`) ? ids[0] : ids[2];
      return JSON.stringify({ summary: "小樱说话。", events: [{ summaryEn: "小樱说话。", actors: ["小樱"], evidence: [first], stateChanges: [{ character: "小樱", emotions: { 高兴: 0.2 } }] }] });
    },
  };
  const graph = new FacultyGraph(decisions, work);
  assert.equal(graph.router.policyFor("scene-boundaries").enabled, false);
  assert.equal(graph.router.policyFor("dialogue-boundaries").enabled, false);
  assert.equal(graph.router.policyFor("dialogue-attribution").enabled, true);
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences, knownEntities: [character] });
  assert.equal(understandingStarted, true);
  assert.equal(result.sceneResults.size, 2);
  assert.ok(graph.pool.metrics.peakActive >= 2);
  const output = await createExtractor(work)({ blockId: "b0001", chapterIndex: 0, sentences, miniloop: result.miniloop, knownEntities: [character], proposals: [], counts: { events: 0, scenes: 0 }, sceneResults: result.sceneResults });
  const scenes = output.proposals.filter(proposal => proposal.kind === "create_scene").map(proposal => proposal.payload as Scene);
  assert.deepEqual(scenes.map(scene => scene.sentenceIds), [ids.slice(0, 2), ids.slice(2)]);
  assert.deepEqual(scenes.map(scene => scene.turns[0].speakerId), [character.id, character.id]);
  assert.equal(output.proposals.filter(proposal => proposal.kind === "set_state_change").length, 2);
  assert.ok(scenes.every(scene => scene.summary === "小樱说话。"));
  assert.deepEqual(groundFacultyProposals(output.proposals, [character], sentences), {});
  const preview = await previewFacultyStates({ listEvents: async () => [], getStateAt: async () => null } as unknown as OntologyStore, output.proposals);
  assert.equal(preview.length, 1);
  assert.equal(preview[0].emotions["高兴"], 0.4);
  const broken = structuredClone(output.proposals);
  const state = broken.find(proposal => proposal.kind === "set_state_change")!;
  (state.payload as Record<string, unknown>).characterId = "missing";
  assert.ok(Object.values(groundFacultyProposals(broken, [character], sentences)).some(note => note.includes("State owner")));
});

test("valid dialogue rows survive context-only records and unknown speaker names", async () => {
  const sentences = sectionBlock(Array.from({ length: 25 }, () => "小樱说：“你好。”").join("\n"), 0).sentences;
  const decisions: DecisionModel = { modelId: "jev", async decide(_state, questions) { return questions.map(question => ({ key: question.key, value: question.key.startsWith("scene_end:") ? sentences.at(-1)!.id : "NONE", confidence: 0.99 })); } };
  const work: WorkModel = { modelId: "work", async generate(request) {
    if (request.system.startsWith("FACULTY: entities-participants")) return JSON.stringify({ newEntities: [], charactersPresent: ["小樱"], charactersMentioned: [], locationName: null });
    if (request.system.startsWith("FACULTY: dialogue-adjudication")) {
      const core = request.prompt.match(/CORE: ([^\n]+)/)![1].split(", ");
      const first = core[0];
      return JSON.stringify({ turns: [
        ...(first === sentences[24].id ? [{ first: sentences[23].id, last: sentences[23].id, speaker: "小樱" }] : []),
        { first, last: first, speaker: first === sentences[0].id ? "unsupported" : "小樱" },
      ] });
    }
    return JSON.stringify({ summary: "小樱说话。", events: [] });
  } };
  const graph = new FacultyGraph(decisions, work, { decisionRouting: { enabled: true } });
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences, knownEntities: [character] });
  const scene = await result.sceneResults.get(sentences[0].id)!;
  assert.equal(scene.turns.length, 2);
  assert.equal(scene.turns[0].speakerName, null);
  assert.deepEqual(scene.turns[1].sentenceIds, [sentences[24].id]);
  assert.ok(scene.notes.some(note => note.includes("source turn was preserved")));
  assert.equal(graph.router.metrics["dialogue-attribution"].retries, 0);
  assert.equal(graph.router.metrics["dialogue-attribution"].retrySkipped, 2);
});

test("dialogue recall pins take priority over automatic restructuring and remain auditable", async () => {
  const sentences = sectionBlock("小樱说：“你好。”", 0).sentences;
  const key = `dlg_start:${sentences[0].id}`;
  const decisions: DecisionModel = { modelId: "jev", async decide(_state, questions) { return questions.map(question => ({ key: question.key, value: sentences[0].id, confidence: 0.99 })); } };
  const work: WorkModel = { modelId: "work", async generate(request) {
    assert.ok(!request.system.startsWith("FACULTY: dialogue-adjudication"));
    if (request.system.startsWith("FACULTY: entities-participants")) return JSON.stringify({ newEntities: [], charactersPresent: ["小樱"], charactersMentioned: [], locationName: null });
    return JSON.stringify({ events: [] });
  } };
  const graph = new FacultyGraph(decisions, work);
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences, knownEntities: [character], pins: new Map([[key, "NONE"]]) });
  assert.ok(result.miniloop.appliedPins?.includes(key));
  assert.ok(result.miniloop.changeset.reviewNotes["faculty:dialogue-pins"]);
  assert.deepEqual((await result.sceneResults.get(sentences[0].id)!).turns, []);
});

test("invalid faculty output keeps complete source scenes and explicit unresolved notes without invented evidence or identities", async () => {
  const sentences = sectionBlock("小樱说道：“你好。”", 0).sentences;
  const decisions: DecisionModel = { modelId: "jev", async decide(_state, questions) { return questions.map(question => ({ key: question.key, value: question.key.startsWith("scene_end:") ? sentences[0].id : "NONE", confidence: 0.99 })); } };
  const work: WorkModel = { modelId: "bad", async generate() { return JSON.stringify({ newEntities: [{ name: "INVENTED", kind: "Character" }], events: [{ summaryEn: "假摘要", evidence: ["bogus"] }], turns: [{ first: "bogus", last: "bogus", speaker: "INVENTED" }] }); } };
  const graph = new FacultyGraph(decisions, work);
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences, knownEntities: [] });
  const output = await createExtractor(work)({ blockId: "b0001", chapterIndex: 0, sentences, miniloop: result.miniloop, knownEntities: [], proposals: [], counts: { events: 0, scenes: 0 }, sceneResults: result.sceneResults });
  assert.equal(output.proposals.filter(proposal => proposal.kind === "create_scene").length, 1);
  assert.equal(output.proposals.filter(proposal => proposal.kind === "create_event" || proposal.kind === "upsert_entity").length, 0);
  assert.ok(Object.values(output.notes).some(note => note.includes("requires Pi review")));
  assert.deepEqual((output.proposals[0].payload as Scene).sentenceIds, sentences.map(sentence => sentence.id));
});

test("scene boundaries retry System 1 with wider context before any System 2 escalation", async () => {
  const sentences = sectionBlock(Array.from({ length: 100 }, (_, index) => `第${index}句叙述。`).join("\n"), 0).sentences;
  const decisions: DecisionModel = { modelId: "jev", async decide(state, questions) {
    return questions.map(question => ({ key: question.key, value: question.key.startsWith("scene_end:") ? question.options!.at(-1)! : question.key.startsWith("scene_seam:") ? "continues" : "NONE", confidence: question.key.startsWith("scene_end:") && !state.includes("READ-ONLY NEIGHBOR CONTEXT") ? 0.4 : 0.99 }));
  } };
  const work: WorkModel = { modelId: "work", async generate(request) {
    assert.ok(!request.system.startsWith("Resolve one uncertain"));
    return request.system.startsWith("FACULTY: entities-participants") ? JSON.stringify({ newEntities: [], charactersPresent: [], charactersMentioned: [], locationName: null }) : JSON.stringify({ events: [] });
  } };
  const graph = new FacultyGraph(decisions, work, { decisionRouting: { enabled: true } });
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences, knownEntities: [] });
  assert.equal(graph.router.metrics["scene-boundaries"].retryRecovered, 1);
  assert.equal(graph.router.metrics["scene-boundaries"].escalated, 0);
  assert.equal(result.miniloop.changeset.status, "pending_review");
});

test("dialogue retries keep the same questions and units while using neighboring blocks read-only", async () => {
  const sentences = sectionBlock("小樱说：“你好。”\n小林说：“再见。”\n两人离开。", 1).sentences;
  const neighbors = sectionBlock("此前小樱与小林一起走来。", 0).sentences;
  let originalQuestions: unknown;
  const decisions: DecisionModel = { modelId: "jev", async decide(state, questions, options) {
    if (state.includes("READ-ONLY NEIGHBOR CONTEXT") && questions[0].key.startsWith("speaker:")) {
      assert.ok(state.includes(neighbors[0].id));
      assert.ok(options?.signal);
      assert.deepEqual(questions, originalQuestions);
      return questions.map(question => ({ key: question.key, confidence: 0.99, value: question.key.endsWith(sentences[0].id) ? "小樱" : "小林" }));
    }
    if (questions[0].key.startsWith("speaker:")) originalQuestions = structuredClone(questions);
    return questions.map(question => ({ key: question.key, value: question.key.startsWith("scene_end:") ? sentences[2].id : question.key === `dlg_start:${sentences[0].id}` || question.key === `dlg_end:${sentences[0].id}` ? sentences[0].id : question.key === `dlg_start:${sentences[1].id}` || question.key === `dlg_end:${sentences[1].id}` ? sentences[1].id : question.key.startsWith("speaker:") ? "unknown" : "NONE", confidence: question.key.startsWith("speaker:") ? 0.2 : 0.99 }));
  } };
  const work: WorkModel = { modelId: "work", async generate(request) {
    assert.ok(!request.system.startsWith("FACULTY: dialogue-adjudication"));
    return request.system.startsWith("FACULTY: entities-participants") ? JSON.stringify({ newEntities: [], charactersPresent: ["小樱", "小林"], charactersMentioned: [], locationName: null }) : JSON.stringify({ events: [] });
  } };
  const graph = new FacultyGraph(decisions, work);
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences, contextSentences: [...neighbors, ...sentences], knownEntities: [] });
  const scene = await result.sceneResults.get(sentences[0].id)!;
  assert.deepEqual(scene.turns.map(turn => turn.speakerName), ["小樱", "小林"]);
  assert.deepEqual(scene.turns.map(turn => turn.sentenceIds), [[sentences[0].id], [sentences[1].id]]);
  assert.equal(graph.router.metrics["dialogue-attribution"].retryRecovered, 1);
  assert.equal(graph.router.metrics["dialogue-attribution"].escalated, 0);
  assert.equal(graph.router.metrics["scene-boundaries"].retries, 0);
  assert.equal(graph.router.metrics["dialogue-boundaries"].retries, 0);
});
