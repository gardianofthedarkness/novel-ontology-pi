import { test } from "node:test";
import assert from "node:assert/strict";
import { describeTime, detectTimeMentions, leadingDateCue, needsRoleCheck, parseNumber, parseTimeText, strongAdvanceCue } from "../src/digger/timeplace/lexicon.js";
import { assemblePeriods, type AnchoredMention } from "../src/digger/timeplace/periods.js";
import { runTimePlace, timePlaceProposals, type SceneSource } from "../src/digger/timeplace/faculty.js";
import { timePlaceReviewSource } from "../src/digger/timeplace/afterApply.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import type { WorkModel } from "../src/ground/connectors/llm.js";
import type { Entity } from "../src/ground/ontology/types.js";

const mention = (text: string, family = "date") => detectTimeMentions([{ id: "s", text }]).find((entry) => entry.family === family);

test("Chinese numerals and calendar words normalise only what they state", () => {
  assert.equal(parseNumber("二十四"), 24);
  assert.equal(parseNumber("一九五七"), 1957);
  assert.equal(parseNumber("十二"), 12);
  assert.deepEqual(mention("十二月二十四日，凌晨0点0分")!.value, { month: 12, day: 24 });
  assert.deepEqual(mention("晚上七点出门", "clock")!.value, { hour: 19, minute: 0, partOfDay: "evening" }, "evening hours are PM");
  assert.deepEqual(mention("三天前的事", "relative-span")!.value.offset, { amount: -3, unit: "day" });
  assert.deepEqual(mention("第二天早上", "relative-day")!.value.offset, { amount: 1, unit: "day" });
  assert.deepEqual(mention("25日，下雪了")!.value, { day: 25 });
  assert.equal(mention("他只是有一点累", "clock"), undefined, "一点 alone means 'a little'");
  assert.equal(mention("一日之内"), undefined);
  assert.equal(describeTime(mention("十二月二十四日")!), "12-24");
});

test("quoted speech and inner thoughts are marked; they default to reference", () => {
  const [spoken] = detectTimeMentions([{ id: "s", text: "“明天见。”他说。" }]);
  assert.equal(spoken.inQuote, true);
  const [thought] = detectTimeMentions([{ id: "s", text: "（最好在晚上七点前回家吧。" }]);
  assert.equal(thought.inQuote, true);
  assert.equal(needsRoleCheck(spoken, 0), false);
});

test("soft time words are checked only where they can set the scene's time", () => {
  const holiday = mention("在平安夜也照常营业的面包店飘出香味。", "holiday")!;
  assert.equal(needsRoleCheck(holiday, 17, "在平安夜也照常营业的面包店飘出香味。"), false);
  assert.equal(needsRoleCheck(holiday, 0, "在平安夜也照常营业的面包店。"), true, "near the scene start");
  const evening = mention("时间到了傍晚。", "time-of-day")!;
  assert.equal(strongAdvanceCue(evening, "时间到了傍晚。"), true, "rule-decided: 'it is now evening'");
  assert.equal(strongAdvanceCue(mention(">>十二月二十四日，凌晨0点0分")!, ">>十二月二十四日，凌晨0点0分"), true);
  assert.equal(strongAdvanceCue(mention("学校已经是寒假的第三天。", "holiday")!, "学校已经是寒假的第三天。"), false, "a state, not a time move");
});

test("a leading calendar date or forward day sets the scene's time; 'just as' is not a recollection", () => {
  const date = mention("25日，外面下着雪。")!;
  assert.equal(leadingDateCue(date, "25日，外面下着雪。"), true);
  const yesterday = mention("昨天，他出门了。", "relative-day")!;
  assert.equal(leadingDateCue(yesterday, "昨天，他出门了。"), false, "a past day may be a flashback: Jev decides");
  assert.equal(detectTimeMentions([{ id: "s", text: "就在他们吃完晚饭的时候。" }]).length, 0);
});

test("LLM phrases are parsed with the same rules; 'next instant' words are micro jumps", () => {
  assert.deepEqual(parseTimeText("十秒钟")!.value.offset, { amount: 10, unit: "second" });
  assert.deepEqual(parseTimeText("下一刻")!.value.offset, { amount: 1, unit: "second" });
  assert.equal(parseTimeText("在搬来这里之前")!.family, "past-marker");
  assert.equal(mention("在搬来这里之前。", "past-marker")!.text, "在搬来这里之前", "a standalone 'before …' sentence opens a recollection");
});

const anchored = (sceneId: string, text: string, role: "ADVANCE" | "FLASHBACK" | "RETURN", index = 0, flashback = 0): AnchoredMention => {
  // Phrases the rules do not know arrive as the LLM gives them (parsed when possible).
  const found = detectTimeMentions([{ id: `${sceneId}_s`, text }])[0] ?? { text, sentenceId: `${sceneId}_s`, start: 0, end: text.length, ...(parseTimeText(text) ?? { family: "relative-span" as const, value: {} }), inQuote: false, source: "llm" as const };
  return { ...found, sceneId, sentenceIndexInScene: index, verdict: { role, flashback, confidence: 0.9, decidedBy: "jev" } };
};

test("periods run from one anchor to the next; flashbacks are marked and sit before their host in story order", async () => {
  const scenes = ["a", "b", "c", "d", "e"].map((id, index) => ({ id, chapterIndex: index < 3 ? 0 : 1, sentenceCount: 10 }));
  const anchors = new Map<string, AnchoredMention[]>([
    ["a", [anchored("a", "十二月二十四日", "ADVANCE")]],
    ["c", [anchored("c", "三年前", "FLASHBACK", 0, 0.9)]],
    ["e", [anchored("e", "第二天", "ADVANCE")]],
  ]);
  const { periods, scenes: times } = await assemblePeriods(scenes, anchors);
  assert.deepEqual(times.map((scene) => scene.periodIds.length), [1, 1, 1, 1, 1]);
  const [eve, past, next] = periods;
  assert.deepEqual(eve.sceneIds, ["a", "b", "d"], "b inherits; d returns after the flashback scene ends");
  assert.equal(past.flashback, true);
  assert.equal(past.toldFromId, eve.id);
  assert.deepEqual(next.date, { month: 12, day: 25, derived: true }, "第二天 after 12-24 is 12-25, labelled derived");
  assert.deepEqual([past, eve, next].map((period) => period.storyIndex), [0, 1, 2], "the flashback comes first in story order");
  assert.equal(times.find((scene) => scene.sceneId === "b")!.inherited, true);
});

test("a flashback continues past its scene only when the continuation check says so", async () => {
  const scenes = ["a", "b", "c"].map((id) => ({ id, chapterIndex: 0, sentenceCount: 5 }));
  const anchors = new Map([["a", [anchored("a", "十二月二十四日", "ADVANCE")]], ["b", [anchored("b", "很久以前", "FLASHBACK", 0, 0.8)]]]);
  const asked: string[] = [];
  const { periods } = await assemblePeriods(scenes, anchors, async (scene) => { asked.push(scene.id); return { continues: true, probability: 0.8 }; });
  assert.deepEqual(asked, ["c"]);
  assert.deepEqual(periods[1].sceneIds, ["b", "c"]);
});

test("the morning after a night is the next day; dates carry over undated periods", async () => {
  const scenes = ["a", "b", "c"].map((id) => ({ id, chapterIndex: 0, sentenceCount: 5 }));
  const anchors = new Map([["a", [anchored("a", "平安夜", "ADVANCE")]], ["b", [anchored("b", "过了一阵后", "ADVANCE")]], ["c", [anchored("c", "早上", "ADVANCE")]]]);
  const { periods } = await assemblePeriods(scenes, anchors);
  assert.equal(periods.length, 2, "a vague 'after a while' does not open a period");
  assert.deepEqual(periods[1].date, { month: 12, day: 25, derived: true });
});

const sentencesOf = (block: string, index: number) => sectionBlock(block, index).sentences;

test("the faculty asks Jev only about checkable words, keeps quoted ones as reference, and proposes reviewable facts", async () => {
  const one = sentencesOf("十二月二十四日，凌晨。\n小明走进中央区的小巷。\n“明天见。”\n在搬来这里之前。\n他曾在别处生活过。", 0);
  const scenes: SceneSource[] = [
    { id: "scene_1", chapterIndex: 0, sentences: one.slice(0, 3), charactersPresent: ["char_1"], locationId: null },
    { id: "scene_2", chapterIndex: 0, sentences: one.slice(3), charactersPresent: ["char_1"], locationId: null },
  ];
  const known: Entity[] = [{ id: "loc_7", kind: "Location", names: [{ text: "中央区", lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 }];
  const asked: string[] = [];
  const decisions: DecisionModel = {
    modelId: "mock-jev",
    async decide(state, questions) {
      asked.push(...questions.map((question) => question.key));
      return questions.map((question) => ({ key: question.key, value: state.includes("在搬来这里之前") ? "FLASHBACK" : "REFERENCE", confidence: 0.8, distribution: { FLASHBACK: 0.8 } }));
    },
  };
  const work: WorkModel = { modelId: "mock-work", async generate(request) {
    if (request.prompt.includes("小巷")) return JSON.stringify({ times: [], places: [{ text: "中央区", sentenceId: one[1].id, role: "setting", specific: true }, { text: "小巷", sentenceId: one[1].id, role: "setting", specific: false }, { text: "不存在", sentenceId: one[1].id, role: "setting", specific: true }] });
    return JSON.stringify({ times: [], places: [] });
  } };
  const result = await runTimePlace({ scenes, knownEntities: known, mode: "hybrid", work, decisions });
  assert.ok(!asked.some((key) => key.includes(one[2].id)), "the quoted 明天 is never sent to Jev");
  assert.ok(result.mentions.find((entry) => entry.text === "明天")!.verdict.decidedBy === "default");
  assert.equal(result.mentions.find((entry) => entry.text === "十二月二十四日")!.verdict.decidedBy, "rule");
  const flashback = result.periods.find((period) => period.flashback)!;
  assert.equal(flashback.label, "在搬来这里之前");
  assert.equal(result.places.some((place) => place.name === "不存在"), false, "unsupported places are dropped");
  assert.equal(result.usage.workCalls, 2);
  const proposals = timePlaceProposals(result, { entityIds: new Set(["loc_7"]), relationKeys: new Set() });
  const relations = proposals.filter((proposal) => proposal.kind === "add_relation").map((proposal) => proposal.payload as { type: string; fromId: string; toId: string; properties: Record<string, unknown> });
  // "中央区的小巷": the generic alley is kept only as a place inside the known ward (phase 2 place tree).
  const alley = proposals.find((proposal) => proposal.kind === "upsert_entity" && (proposal.payload as Entity).names[0].text === "小巷")?.payload as Entity;
  assert.deepEqual(alley?.properties, { source: "time-place", firstSceneId: "scene_1", generic: true, scopedTo: "loc_7" }, "a generic setting exists only under its stated named parent");
  assert.ok(relations.some((relation) => relation.type === "PART_OF" && relation.fromId === alley.id && relation.toId === "loc_7"), "known place reused as the parent, not re-minted");
  assert.ok(relations.some((relation) => relation.type === "LOCATED_AT" && relation.fromId === "scene_1" && relation.toId === alley.id), "the scene sits in its most specific place");
  assert.ok(!proposals.some((proposal) => proposal.kind === "upsert_entity" && (proposal.payload as Entity).id === "loc_7"), "the known ward is not re-minted");
  const times = proposals.filter((proposal) => proposal.kind === "upsert_entity" && (proposal.payload as Entity).kind === "TimePoint");
  assert.equal(times.length, result.periods.length);
  assert.equal((times.find((proposal) => (proposal.payload as Entity).properties.flashback)!.payload as Entity).properties.flashbackProbability, 0.8);
  const again = timePlaceProposals(result, { entityIds: new Set(["loc_7"]), relationKeys: new Set(relations.map((relation) => `${relation.type}:${relation.fromId}:${relation.toId}`)) });
  assert.equal(again.filter((proposal) => proposal.kind === "add_relation").length, 0, "re-runs never duplicate relations");
  // Every assertion cites original sentences, so the shared review gate can bind it.
  assert.ok(proposals.every((proposal) => proposal.provenance.sentenceIds.length), "no fact without evidence");
  const inherited = proposals.find((proposal) => proposal.kind === "add_relation" && (proposal.payload as { properties: { via?: string } }).properties.via === "inherited");
  if (inherited) assert.ok(inherited.provenance.sentenceIds.length >= 1, "an inherited period cites its time word and the scene's opening");
  const allSentences = new Map(scenes.flatMap((scene) => scene.sentences.map((sentence) => [sentence.id, sentence] as const)));
  const source = timePlaceReviewSource(proposals, allSentences);
  assert.deepEqual(new Set(source.map((sentence) => sentence.id)), new Set(proposals.flatMap((proposal) => proposal.provenance.sentenceIds)), "the packet carries exactly the cited sentences");
});

test("budgets stop paid calls and fall back to rules, with a note", async () => {
  const sentences = sentencesOf("十二月二十四日。\n当时他还小。", 0);
  let calls = 0;
  const decisions: DecisionModel = { modelId: "mock", async decide(_state, questions) { calls++; return questions.map((question) => ({ key: question.key, value: "REFERENCE", confidence: 0.9 })); } };
  const result = await runTimePlace({ scenes: [{ id: "s", chapterIndex: 0, sentences, charactersPresent: [], locationId: null }], knownEntities: [], mode: "programmatic", decisions, budget: { maxDecisionQuestions: 0 } });
  assert.equal(calls, 0);
  assert.ok(result.notes.some((note) => note.includes("budget")));
});

test("a dated flashback is ordered by its date, not only by when it was told", async () => {
  const scenes = ["a", "b", "c", "d"].map((id) => ({ id, chapterIndex: 0, sentenceCount: 5 }));
  const anchors = new Map([
    ["a", [anchored("a", "平安夜", "ADVANCE")]],
    ["b", [anchored("b", "早上", "ADVANCE")]],
    ["c", [anchored("c", "25日", "ADVANCE")]],
    ["d", [anchored("d", "12月24日", "FLASHBACK", 0, 0.8)]],
  ]);
  const { periods } = await assemblePeriods(scenes, anchors);
  const order = [...periods].sort((first, second) => first.storyIndex - second.storyIndex).map((period) => period.label);
  assert.deepEqual(order, ["平安夜", "12月24日", "早上", "25日"], "the 12-24 flashback precedes the morning of the 25th");
});

import { mkdtemp, mkdir as makeDir, writeFile as write, readFile as read, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join as joinPath } from "node:path";
import { timePlaceForNewScenes } from "../src/digger/timeplace/afterApply.js";
import { BundleStore } from "../src/ground/connectors/bundle.js";
import { applyChangeSet } from "../src/solidifier/merge/apply.js";

test("runs continue from the book's stored periods, so block-by-block equals the whole book", async () => {
  const directory = await mkdtemp(joinPath(tmpdir(), "timeplace-"));
  try {
    const text = "十二月二十四日，深夜。\n他走在中央区。\n他继续走。\n第二天早上。\n她醒来了。";
    const sentences = sectionBlock(text, 0).sentences;
    await makeDir(joinPath(directory, "ontology"), { recursive: true });
    const scenes = [[0, 1], [2], [3, 4]].map((indexes, index) => ({ id: `scene_${index + 1}`, chapterIndex: 0, sentenceIds: indexes.map((sentence) => sentences[sentence].id), charactersPresent: [], charactersMentioned: [], turns: [], locationId: null }));
    await write(joinPath(directory, "ontology", "scenes.jsonl"), scenes.map((scene) => JSON.stringify(scene)).join("\n") + "\n");
    const sentenceMap = new Map(sentences.map((sentence) => [sentence.id, sentence]));
    const decisions: DecisionModel = { modelId: "mock", async decide(_state, questions) { return questions.map((question) => ({ key: question.key, value: "ADVANCE", confidence: 0.9 })); } };
    const store = new BundleStore(joinPath(directory, "ontology"));
    const first = await timePlaceForNewScenes({ novelDir: directory, sentences: sentenceMap, mode: "programmatic", decisions, sceneIds: ["scene_1"], provenanceBlockId: "b0001" });
    // Legacy direct approval (no shared-gate decisions): apply without the cited-sentence bundle.
    await applyChangeSet(store, { ...first.changeset!, reviewSource: undefined, status: "approved" });
    const second = await timePlaceForNewScenes({ novelDir: directory, sentences: sentenceMap, mode: "programmatic", decisions, provenanceBlockId: "b0002" });
    assert.equal(second.scenes, 2, "only scenes without time facts");
    const relations = (await read(joinPath(directory, "ontology", "relations.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line));
    const firstPeriods = relations.filter((relation) => relation.fromId === "scene_1" && relation.type === "OCCURS_DURING").map((relation) => relation.toId);
    const inherited = second.changeset!.proposals.filter((proposal) => proposal.kind === "add_relation").map((proposal) => proposal.payload as { fromId: string; toId: string; type: string });
    assert.ok(inherited.some((relation) => relation.fromId === "scene_2" && relation.type === "OCCURS_DURING" && firstPeriods.includes(relation.toId)), "scene 2 continues the period stored by the first run");
    const nextMorning = second.result.periods.find((period) => period.label === "第二天");
    assert.deepEqual(nextMorning?.date, { month: 12, day: 25, derived: true }, "the date carries across runs");
    assert.equal(nextMorning?.narrativeIndex, first.result.periods.length, "narrative order continues");
  } finally { await rm(directory, { recursive: true, force: true }); }
});
