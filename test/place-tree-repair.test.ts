import { test } from "node:test";
import assert from "node:assert/strict";
import type { DecisionAnswer, DecisionModel, DecisionQuestion } from "../src/ground/connectors/jev.js";
import type { Entity, Relation, Scene } from "../src/ground/ontology/types.js";
import type { Sentence } from "../src/digger/intake/sectioning.js";
import { flagForRepair, repairPlaceTree } from "../src/digger/timeplace/placeTreeRepair.js";

// An invented book: a city 星城 with a district 第三区 the text never names beside it, a far city 雾港 named only after
// the district's scene (in a chapter title), and a tower 钟楼 already put inside a street that is no larger than it.
const place = (id: string, name: string): Entity => ({ id, kind: "Location", names: [{ text: name, lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 });
const entities = [place("city", "星城"), place("fog", "雾港"), place("d3", "第三区"), place("tower", "钟楼"), place("lane", "北巷")];
const lines = ["她在星城长大。", "那天下着雨。", "第三区的路灯一盏盏亮起。", "她走过空荡的路口。", "第二章 雾港的早晨", "钟楼的钟声响了。"];
const sentences = new Map<string, Sentence>(lines.map((text, n) => [`b0000_s${String(n).padStart(4, "0")}`, { id: `b0000_s${String(n).padStart(4, "0")}`, index: n, paragraphIndex: n, text, startOffset: 0, endOffset: text.length }]));
const scene = (id: string, from: number, to: number, locationId: string): Scene => ({ id, chapterIndex: 0, sentenceIds: [...sentences.keys()].slice(from, to + 1), charactersPresent: ["her"], charactersMentioned: [], turns: [], locationId });
const scenes = [scene("s1", 2, 3, "d3"), scene("s2", 5, 5, "tower")];
const relations: Relation[] = [{ fromId: "tower", toId: "lane", type: "PART_OF", properties: {}, confidence: 1 }];
const scales = { city: "city", fog: "city", d3: "district", tower: "building", lane: "building" };

function recording(answer: (state: string, question: DecisionQuestion) => DecisionAnswer["value"]) {
  const asked: { state: string; question: DecisionQuestion }[] = [];
  const model: DecisionModel = { modelId: "test", async decide(state: string, questions) { asked.push({ state, question: questions[0] }); return questions.map((question) => ({ key: question.key, value: answer(state, question), confidence: 0.6 })); } };
  return { model, asked };
}

test("repair: a place without a larger parent is scored from its scenes and the text before them, never after", () => {
  const flags = flagForRepair({ entities, relations, scenes, sentences, scales });
  assert.deepEqual(flags.map((flag) => `${flag.label}:${flag.why}`), ["第三区:orphan", "钟楼:not larger"]);
  const district = flags[0], city = district.candidates.find((candidate) => candidate.label === "星城")!, fog = district.candidates.find((candidate) => candidate.label === "雾港")!;
  assert.equal(district.candidates[0].label, "星城", "the city named before the scene ranks first");
  assert.deepEqual([city.near, city.evidence[0].where], [2, "before"]);
  assert.deepEqual([fog.near, fog.evidence.length], [null, 0], "a chapter title after the scene does not count");
});

test("repair: Jev's pick becomes a PART_OF proposal, none a suggestion, a new parent for a placed place a note; asked places are not asked again", async () => {
  const { model, asked } = recording((state, question) => (state.includes("第三区 (district)") ? "place_a" : question.options!.includes("keep") ? "place_a" : "none"));
  const first = await repairPlaceTree({ entities, relations, scenes, sentences, scales, decisions: model });
  assert.equal(asked.length, 2);
  assert.ok(asked[0].state.includes("the nearest earlier sentence naming it, 2 sentences before a scene at this place"), "Jev reads the earlier text");
  assert.ok(asked[0].state.includes("The current text"), "and the current text");
  assert.deepEqual(first.proposals.map((proposal) => [proposal.kind, (proposal.payload as Relation).fromId, (proposal.payload as Relation).toId, proposal.confidence]), [["add_relation", "d3", "city", 0.6]]);
  assert.ok(first.notes.some((note) => note.includes("钟楼") && note.includes("by hand")), "a place with a parent is never re-parented by a proposal");
  const again = recording(() => "none");
  const second = await repairPlaceTree({ entities, relations, scenes, sentences, scales, decisions: again.model, memory: first.memory });
  assert.deepEqual([again.asked.length, second.proposals.length], [0, 0], "nothing asked again while what it read is the same");
  const none = recording(() => "none"), quiet = await repairPlaceTree({ entities, relations, scenes, sentences, scales, decisions: none.model });
  assert.ok(quiet.suggestions.some((line) => line.startsWith("第三区") && line.includes("suggests 星城")), "none: the score's best candidate, for a look");
});
