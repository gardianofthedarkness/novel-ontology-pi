import { test } from "node:test";
import assert from "node:assert/strict";
import { askStrandQuestions, planStrandQuestions, scenePassage, storyStrands, strandProjection } from "../src/digger/timeplace/strandQuestions.js";
import type { StoryScene, TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";

// Invented chapter: Ming and Lan part at the station; the story cuts between
// Ming at the port and Lan at the hill. Scenes m2 and l2 name nobody, so they
// borrow a cast from a nearby scene — which links them into a strand.
const scene = (id: string, index: number, characterIds: string[], placeIds: string[]): StoryScene =>
  ({ id, index, chapterIndex: 0, label: id, times: [{ id: "t", via: index ? "inherited" : "anchor" }], flashback: false, placeIds, placeCarried: false, characterIds });
const scenes = [
  scene("s1", 0, ["ming", "lan"], ["station"]), scene("m1", 1, ["ming"], ["port"]), scene("l1", 2, ["lan"], ["hill"]),
  scene("m2", 3, [], ["port"]), scene("l2", 4, [], ["hill"]), scene("x1", 5, ["ming"], ["port"]), scene("x2", 6, ["lan"], ["hill"]),
  scene("x3", 7, ["ming"], ["port"]), scene("s9", 8, ["ming", "lan"], ["bridge"]),
];
const data: TimePlaceProjection = {
  available: true,
  times: [{ id: "t", label: "that day", gloss: "day", family: "date", role: "ADVANCE", flashback: false, flashbackProbability: 0, decidedBy: "rule", toldFromId: null, date: null, partOfDay: null, chapterIndex: 0, storyIndex: 0, narrativeIndex: 0 } as never],
  scenes, places: [], characters: [], names: { ming: "Ming", lan: "Lan" },
};

test("questions are planned only where a borrowed cast creates a link, within threshold and cap", () => {
  const strands = storyStrands(data);
  const plan = planStrandQuestions(data, strands);
  assert.deepEqual(plan.questions.map((question) => question.sceneId).sort(), ["l2", "m2"]);
  assert.deepEqual(plan.questions[0].characterIds.sort(), ["lan", "ming"]);
  assert.deepEqual(plan.estimate, { questions: 2, calls: 1 });
  assert.equal(planStrandQuestions(data, strands, { maxQuestions: 1 }).overBudget, 1);
  // A chapter smaller than the threshold asks nothing.
  const small = planStrandQuestions(data, strands, { minImpact: 20 });
  assert.equal(small.questions.length, 0);
  assert.equal(small.belowThreshold, 2);
  // Scenes with a recorded cast are never asked about.
  const named = { ...data, scenes: scenes.map((entry) => entry.characterIds.length ? entry : { ...entry, characterIds: ["ming"] }) };
  assert.equal(planStrandQuestions(named, storyStrands(named)).questions.length, 0);
});

test("answers name only listed characters; invalid replies change nothing", async () => {
  const plan = planStrandQuestions(data, storyStrands(data));
  const order = plan.questions.map((question) => question.sceneId);
  const work = { modelId: "fake", generate: async () => `Here: {"P1": [${order[0] === "l2" ? 2 : 1}, 99, "x"], "P2": []}` };
  const { answers, asked } = await askStrandQuestions({ work, plan, names: data.names, passage: (id) => `passage ${id}` });
  const roster = plan.questions[0].characterIds;
  assert.deepEqual(answers.presence!.get(order[0]), [roster[order[0] === "l2" ? 1 : 0]]);
  assert.equal(answers.presence!.has(order[1]), false);
  assert.deepEqual(asked.map((entry) => entry.applied), [true, false]);
  const broken = await askStrandQuestions({ work: { modelId: "fake", generate: async () => "no json" }, plan, names: data.names, passage: () => "" });
  assert.equal(broken.answers.presence!.size, 0);
});

test("only characters on stage count; the mentioned ones are set aside", async () => {
  const plan = planStrandQuestions(data, storyStrands(data));
  const order = plan.questions.map((question) => question.sceneId);
  let prompt = "";
  const work = { modelId: "fake", generate: async (request: { prompt: string }) => { prompt = request.prompt; return `{"P1": {"present": [1], "mentioned": [2]}, "P2": {"present": [], "mentioned": [1]}}`; } };
  const { answers } = await askStrandQuestions({ work, plan, names: data.names, forms: { ming: ["Ming", "Little Ming"] }, passage: (id) => `passage ${id}` });
  const roster = plan.questions[0].characterIds;
  assert.deepEqual(answers.presence!.get(order[0]), [roster[0]]);
  assert.equal(answers.presence!.has(order[1]), false);
  assert.match(prompt, /Ming \(also: Little Ming\)/);
});

test("the list to choose from is the scenes' cast candidates, so someone never recorded can be named", async () => {
  // Kai is in no recorded cast, but the text of l2 names him.
  const candidates = new Map([["m2", [{ id: "ming", score: 1, evidence: "named" as const }]], ["l2", [{ id: "kai", score: 1, evidence: "named" as const }, { id: "lan", score: 0.7, evidence: "neighbour" as const }]]]);
  const plan = planStrandQuestions(data, storyStrands(data), { candidates });
  assert.deepEqual(plan.questions.find((question) => question.sceneId === "l2")!.characterIds, ["kai", "lan"]);
  let prompt = "";
  const work = { modelId: "fake", generate: async (request: { prompt: string }) => { prompt = request.prompt; return "{}"; } };
  await askStrandQuestions({ work, plan, names: { ...data.names, kai: "Kai" }, passage: (id) => `passage ${id}` });
  assert.match(prompt, /1\. (Ming|Kai)\n2\. (Ming|Kai)\n3\. Lan/);
});

test("nobody listed but someone else there: the scene stands alone instead of borrowing a cast", async () => {
  const plan = planStrandQuestions(data, storyStrands(data));
  const order = plan.questions.map((question) => question.sceneId);
  const work = { modelId: "fake", generate: async () => `{"P1": {"present": [], "mentioned": [], "unlisted": true}, "P2": {"present": [1], "unlisted": true}}` };
  const { answers, asked } = await askStrandQuestions({ work, plan, names: data.names, passage: (id) => `passage ${id}` });
  assert.deepEqual([...answers.alone!], [order[0]]);
  assert.ok(answers.presence!.has(order[1]) && !answers.alone!.has(order[1]));
  assert.deepEqual(asked.map((entry) => [entry.unlisted, entry.applied]), [[true, true], [true, true]]);
  const before = storyStrands(data), after = storyStrands(data, { alone: new Set(["l2"]) });
  assert.ok(before.carried.has("l2") && before.before("l1", "l2"));
  assert.ok(!after.carried.has("l2") && !after.before("l1", "l2") && !after.before("l2", "l1"));
  // The viewer marks the scene itself (from the latest report): the same effect.
  const marked = storyStrands({ ...data, scenes: data.scenes.map((entry) => entry.id === "l2" ? { ...entry, alone: true } : entry) });
  assert.ok(!marked.carried.has("l2"));
});

test("a long scene keeps its opening, its close, and the middle sentences that name a listed character", () => {
  const lines = Array.from({ length: 40 }, (_, index) => `${"x".repeat(100)} ${index}`);
  lines[20] = "Lan walks in.";
  const passage = scenePassage(lines, ["Lan"], 1600);
  assert.ok(passage.includes(" 0\n") && passage.includes(" 39"));
  assert.ok(passage.includes("…\nLan walks in.\n…"));
  assert.ok(!passage.includes(" 15\n"));
  assert.equal(scenePassage(["a", "b"], []), "a\nb");
});

test("an answered cast replaces the borrowed one in the strands", () => {
  const before = storyStrands(data);
  const after = storyStrands(data, { presence: new Map([["l2", ["lan"]], ["m2", ["ming"]]]) });
  assert.ok(before.carried.has("l2") && !after.carried.has("l2"));
  assert.ok(after.before("l1", "l2") && after.before("m1", "m2"));
  assert.ok(!after.before("m2", "l2") && !after.before("l2", "m2"));
});

test("the strand view of a workspace reads stored facts and pending time-place proposals", () => {
  const entities = [
    { id: "t1", kind: "TimePoint", names: [{ text: "evening", lang: "en", kind: "canonical" }], properties: { storyIndex: 0 }, confidence: 1 },
    { id: "ming", kind: "Character", names: [{ text: "Ming", lang: "en", kind: "canonical" }], properties: {}, confidence: 1 },
  ];
  const projected = strandProjection({
    scenes: [{ id: "a", chapterIndex: 0, sentenceIds: ["b0000_s0001"], charactersPresent: ["ming"], locationId: null }, { id: "b", chapterIndex: 0, sentenceIds: ["b0000_s0005"], charactersPresent: [], locationId: null }] as never,
    entities: entities as never, relations: [{ fromId: "a", toId: "t1", type: "OCCURS_DURING", properties: { via: "anchor" }, confidence: 1 }] as never,
    pending: [{ kind: "upsert_entity", payload: { id: "port", kind: "Location", names: [{ text: "Port", lang: "en", kind: "canonical" }], properties: {}, confidence: 1 } }, { kind: "add_relation", payload: { fromId: "a", toId: "port", type: "LOCATED_AT", properties: {}, confidence: 1 } }],
  });
  assert.equal(projected.available, true);
  assert.deepEqual(projected.scenes.map((row) => [row.id, row.placeIds, row.placeCarried, row.characterIds]), [["a", ["port"], false, ["ming"]], ["b", ["port"], true, []]]);
  assert.equal(projected.names.port, "Port");
});
