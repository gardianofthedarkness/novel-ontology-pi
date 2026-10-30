import { test } from "node:test";
import assert from "node:assert/strict";
import { addSceneCandidates, candidateKey, candidateNodeId, resolveCandidates, type EntityCandidate } from "../src/digger/processing/entityCandidates.js";
import { touchedDraftIds, type WorkingDraft } from "../src/digger/processing/draft.js";
import { FacultyGraph } from "../src/digger/processing/facultyGraph.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import { createExtractor } from "../src/digger/extraction/extraction.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import type { WorkModel } from "../src/ground/connectors/llm.js";
import type { Entity } from "../src/ground/ontology/types.js";
import type { ChangeProposal } from "../src/solidifier/merge/changeset.js";

const sakura: Entity = { id: "char_000001", kind: "Character", names: [{ text: "小樱", lang: "zh", kind: "canonical" }, { text: "樱", lang: "zh", kind: "alias" }], properties: {}, confidence: 1 };
const school: Entity = { id: "loc_000001", kind: "Location", names: [{ text: "常盘台", lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 };
const entity = (id: string, kind: Entity["kind"], ...names: string[]): ChangeProposal => ({ id: `p-${id}`, kind: "upsert_entity", payload: { id, kind, names: names.map((text, index) => ({ text, lang: "zh", kind: index ? "alias" : "canonical" })), properties: {}, confidence: 0.9 } as Entity, confidence: 0.9, provenance: { blockId: "b0001" } } as ChangeProposal);

test("known entities are recognised by any recorded form; new ones become keyed candidates", () => {
  const list = addSceneCandidates([], { newEntities: [{ name: "黑子", kind: "Character", aliases: [{ text: "白井", kind: "alias" }] }, { name: "樱", kind: "Character" }], charactersPresent: ["小樱", "黑子"], charactersMentioned: ["无名氏"], locationName: "常盘台" }, [sakura, school], { firstSentenceId: "b0001_s003", faculty: "entities-participants" });
  const kuroko = list.find(candidate => candidate.name === "黑子")!;
  assert.equal(kuroko.status, "new");
  assert.equal(kuroko.key, candidateKey("Character", "黑子"));
  assert.deepEqual(kuroko.aliases, ["白井"]);
  assert.equal(kuroko.presence, "present");
  assert.equal(kuroko.firstSentenceId, "b0001_s003");
  const known = list.filter(candidate => candidate.status === "existing");
  assert.deepEqual(known.map(candidate => candidate.existingId).sort(), ["char_000001", "loc_000001"], "a recorded alias is the existing character, never a new one");
  assert.equal(known.find(candidate => candidate.existingId === "loc_000001")!.presence, "location");
  assert.equal(list.some(candidate => candidate.name === "无名氏"), false, "a roster name nobody declared is not invented");
});

test("later scenes add to candidates without duplicating them or moving where they first appeared", () => {
  const first = addSceneCandidates([], { newEntities: [{ name: "黑子", kind: "Character" }], charactersMentioned: ["黑子"] }, [], { firstSentenceId: "b0001_s000", faculty: "entities-participants" });
  const second = addSceneCandidates(first, { newEntities: [{ name: "黑子", kind: "Character", aliases: [{ text: "白井黑子", kind: "alias" }] }], charactersPresent: ["黑子"] }, [], { firstSentenceId: "b0001_s009", faculty: "entities-participants" });
  assert.equal(second.length, 1);
  assert.equal(second[0].firstSentenceId, "b0001_s000");
  assert.deepEqual(second[0].aliases, ["白井黑子"]);
  assert.equal(second[0].presence, "present", "presence only strengthens");
  assert.equal(first[0].presence, "mentioned", "inputs are not mutated");
});

test("extraction links each candidate to the entity it became", () => {
  const list: EntityCandidate[] = addSceneCandidates([], { newEntities: [{ name: "黑子", kind: "Character" }, { name: "风纪委员", kind: "Organization" }], charactersPresent: ["小樱"] }, [sakura], { faculty: "entities-participants" });
  const resolved = resolveCandidates(list, [entity("char_000007", "Character", "白井黑子", "黑子"), entity("loc_000009", "Location", "风纪委员")]);
  assert.equal(resolved.find(candidate => candidate.name === "黑子")!.resolvedId, "char_000007");
  assert.equal(resolved.find(candidate => candidate.name === "风纪委员")!.resolvedId, undefined, "kinds must agree");
  assert.equal(resolved.find(candidate => candidate.existingId === "char_000001")!.resolvedId, "char_000001");
});

test("draft updates announce new candidates under draft ids and known entities under their own ids", () => {
  const base: WorkingDraft = { version: 1, blockId: "b0001", chapterIndex: 0, stage: "miniloop", patchId: "x", updatedAt: "", proposals: [], sceneSpans: [], dialogueUnits: [], turns: [], completedScenes: 0, totalScenes: 0 };
  const candidates = addSceneCandidates([], { newEntities: [{ name: "黑子", kind: "Character" }], charactersPresent: ["小樱"] }, [sakura], { faculty: "entities-participants" });
  const touched = touchedDraftIds(base, { ...base, entityCandidates: candidates });
  assert.deepEqual(touched.sort(), ["char_000001", `draft:b0001:entity:${candidateKey("Character", "黑子")}`].sort());
  assert.deepEqual(touchedDraftIds({ ...base, entityCandidates: candidates }, { ...base, entityCandidates: candidates }), [], "unchanged candidates are not re-announced");
  assert.equal(candidateNodeId("b0001", candidates.find(candidate => candidate.status === "new")!), `draft:b0001:entity:${candidateKey("Character", "黑子")}`);
});

test("the faculty graph streams candidates scene by scene, well before extraction", async () => {
  const sentences = sectionBlock("小樱走进教室。\n黑子跟在后面。\n她们来到常盘台。\n佐天在门口等待。", 0).sentences;
  const ids = sentences.map(sentence => sentence.id);
  const decisions: DecisionModel = {
    modelId: "mock-jev",
    async decide(_state, questions) {
      return questions.map(question => {
        if (question.key.startsWith("scene_end:")) return { key: question.key, value: question.key.endsWith(ids[0]) ? ids[1] : ids[3], confidence: 0.99 };
        if (question.key.startsWith("scene_start:")) return { key: question.key, value: question.key.endsWith(ids[0]) ? ids[2] : "NONE", confidence: 0.99 };
        if (question.key.startsWith("dlg_kind:") || question.key.startsWith("dlg_turn:")) return { key: question.key, value: question.key.startsWith("dlg_kind:") ? "narration" : 0, confidence: 0.99 };
        return { key: question.key, value: "NEW_PERSON", confidence: 0.99 };
      });
    },
  };
  const work: WorkModel = {
    modelId: "mock-work",
    async generate(input) {
      if (input.system.startsWith("FACULTY: entities-participants")) {
        const second = input.prompt.includes(`CORE: ${ids[2]}`);
        return JSON.stringify(second
          ? { newEntities: [{ name: "佐天", kind: "Character" }], charactersPresent: ["佐天", "黑子"], charactersMentioned: [], locationName: "常盘台" }
          : { newEntities: [{ name: "黑子", kind: "Character" }], charactersPresent: ["小樱", "黑子"], charactersMentioned: [], locationName: null });
      }
      if (input.system.startsWith("FACULTY:")) return JSON.stringify({ turns: [] });
      const first = input.prompt.includes(`${ids[0]}:`) ? ids[0] : ids[2];
      return JSON.stringify({ summary: "走路。", events: [{ summaryEn: "走路。", actors: [], evidence: [first] }] });
    },
  };
  const progress: WorkingDraft["entityCandidates"][] = [];
  const graph = new FacultyGraph(decisions, work, { dialogueScope: "scene" });
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences, knownEntities: [sakura, school], onProgress: async update => { if (update.entityCandidates) progress.push(update.entityCandidates); } });
  const sizes = [...new Set(progress.map(list => list!.filter(candidate => candidate.status === "new").length))];
  assert.ok(sizes.includes(1) && sizes.includes(2), `new candidates arrive one scene at a time (${sizes})`);
  const final = progress.at(-1)!;
  assert.equal(final.find(candidate => candidate.name === "黑子")!.firstSentenceId, ids[0]);
  assert.equal(final.find(candidate => candidate.name === "佐天")!.firstSentenceId, ids[2]);
  assert.equal(final.find(candidate => candidate.existingId === "loc_000001")!.presence, "location");
  const output = await createExtractor(work)({ blockId: "b0001", chapterIndex: 0, sentences, miniloop: result.miniloop, knownEntities: [sakura, school], proposals: [], counts: { events: 0, scenes: 0 }, sceneResults: result.sceneResults });
  const resolved = resolveCandidates(final, output.proposals);
  for (const name of ["黑子", "佐天"]) {
    const candidate = resolved.find(entry => entry.name === name)!;
    const minted = output.proposals.find(proposal => proposal.kind === "upsert_entity" && (proposal.payload as Entity).names.some(form => form.text === name));
    assert.ok(minted, `${name} was extracted`);
    assert.equal(candidate.resolvedId, (minted!.payload as Entity).id, `${name} links to its extracted entity`);
  }
});

test("a failing draft consumer never fails identity work", async () => {
  const sentences = sectionBlock("小樱走进教室。\n黑子跟在后面。\n她们来到常盘台。\n佐天在门口等待。", 0).sentences;
  const ids = sentences.map(sentence => sentence.id);
  const decisions: DecisionModel = {
    modelId: "mock-jev",
    async decide(_state, questions) {
      return questions.map(question => {
        if (question.key.startsWith("scene_end:")) return { key: question.key, value: question.key.endsWith(ids[0]) ? ids[1] : ids[3], confidence: 0.99 };
        if (question.key.startsWith("scene_start:")) return { key: question.key, value: question.key.endsWith(ids[0]) ? ids[2] : "NONE", confidence: 0.99 };
        if (question.key.startsWith("dlg_kind:") || question.key.startsWith("dlg_turn:")) return { key: question.key, value: question.key.startsWith("dlg_kind:") ? "narration" : 0, confidence: 0.99 };
        return { key: question.key, value: "NEW_PERSON", confidence: 0.99 };
      });
    },
  };
  const work: WorkModel = {
    modelId: "mock-work",
    async generate(input) {
      if (input.system.startsWith("FACULTY: entities-participants")) {
        const second = input.prompt.includes(`CORE: ${ids[2]}`);
        return JSON.stringify(second
          ? { newEntities: [{ name: "佐天", kind: "Character" }], charactersPresent: ["佐天", "黑子"], charactersMentioned: [], locationName: "常盘台" }
          : { newEntities: [{ name: "黑子", kind: "Character" }], charactersPresent: ["小樱", "黑子"], charactersMentioned: [], locationName: null });
      }
      if (input.system.startsWith("FACULTY:")) return JSON.stringify({ turns: [] });
      const first = input.prompt.includes(`${ids[0]}:`) ? ids[0] : ids[2];
      return JSON.stringify({ summary: "走路。", events: [{ summaryEn: "走路。", actors: [], evidence: [first] }] });
    },
  };
  const graph = new FacultyGraph(decisions, work, { dialogueScope: "scene" });
  const result = await graph.run({ blockId: "b0001", chapterIndex: 0, sentences, knownEntities: [sakura, school], onProgress: async () => { throw new Error("draft consumer failed"); } });
  assert.ok(result.sceneResults.size > 0, "scenes still resolve when draft telemetry fails");
  const scenes = await Promise.all(result.sceneResults.values());
  assert.ok(scenes.some(scene => (scene.scene.newEntities ?? []).length > 0), "identities survive a failing draft consumer");
});
