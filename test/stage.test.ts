import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { MockDecisionModel, type DecisionAnswer, type DecisionModel, type DecisionQuestion } from "../src/ground/connectors/jev.js";
import { pickArchitecture, type ArchitecturePlace } from "../src/digger/stage/architecture.js";
import { pickScales, scaleOfName, stageKindOf, SCALE_HINTS, type ScalePlace } from "../src/digger/stage/scale.js";
import { askMovement, sceneCallLimit, type MovementScene } from "../src/digger/stage/movement.js";
import { prepareStage } from "../src/digger/stage/prep.js";
import { navGrid } from "../src/ground/stage/holoNav.js";
import { describeError } from "../src/ground/errors.js";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { stageInputs } from "../src/cli/commands/extract/stageCommands.js";

/** A decision model that records what it was asked and answers from a function. */
function recording(answer: (state: string, question: DecisionQuestion) => DecisionAnswer["value"]) {
  const asked: { state: string; questions: DecisionQuestion[]; images: string[] }[] = [];
  const model: DecisionModel = { modelId: "test", async decide(state, questions, options) { asked.push({ state, questions, images: Object.keys(options?.images ?? {}) }); return questions.map((question) => ({ key: question.key, value: answer(state, question) })); } };
  return { model, asked };
}

const place = (id: string, label: string, contains: string[] = []): ArchitecturePlace => ({ id, label, path: [id], contains, sceneLabels: [] });

test("buildings: the name shortlists, Jev picks among pictures under neutral names, and a place holding a district is a city", async () => {
  const places = [place("tower", "废弃大楼"), place("city", "学园都市", ["d7"]), place("d7", "第七学区"), place("nowhere", "某处")];
  // Without Jev the first shortlisted kind stands; a name with no hint gets no building.
  const plain = await pickArchitecture(places);
  assert.deepEqual(Object.fromEntries(Object.entries(plain.places).map(([id, pick]) => [id, `${pick.kind}/${pick.by}`])), { tower: "skyscraper/name", city: "city/name", d7: "city/name", nowhere: "none/no hint" });
  // With Jev and pictures: one picture choice per place; the options say nothing about the kinds.
  const pictures = { skyscraper: "AA==", office: "AA==", home: "AA==", school: "AA==", city: "AA==", park: "AA==" };
  const { model, asked } = recording((state, question) => state.includes("学园都市") ? "picture_b" : question.options![0]);
  const picked = await pickArchitecture(places, { decisions: model, pictures });
  assert.equal(picked.places.tower.kind, "skyscraper");
  assert.equal(picked.places.tower.by, "jev");
  assert.ok(asked.every((call) => call.questions[0].options!.every((option) => /^picture_[a-d]$|^none$/.test(option))), "neutral option names");
  assert.ok(asked.find((call) => call.state.includes("学园都市"))!.state.includes("Places inside it: d7"), "what a place contains is told");
  // Jev read 学园都市 as a school (picture_b), but it holds a district: a city.
  assert.deepEqual([picked.places.city.kind, picked.places.city.by], ["city", "tree"]);
  // Asked again with nothing changed: every pick is reused.
  const again = recording(() => "none");
  const reused = await pickArchitecture(places, { decisions: again.model, pictures, previous: picked });
  assert.deepEqual([again.asked.length, reused.usage.reused], [0, 4]);
});

test("buildings: a place holding a city is a city all the way up the tree, whatever order the places come in", async () => {
  const tree = [place("country", "某国", ["city"]), place("city", "学园", ["d7"]), place("d7", "第七学区")];
  for (const places of [tree, [...tree].reverse()]) {
    const picks = (await pickArchitecture(places)).places;
    assert.deepEqual(Object.fromEntries(Object.entries(picks).map(([id, pick]) => [id, pick.kind])), { country: "city", city: "city", d7: "city" }, places.map((entry) => entry.id).join(","));
  }
});

test("scale: Jev picks region to room from the name and the tree; without Jev the name's generic part stands, and is asked again once Jev is there", async () => {
  const places: ScalePlace[] = [{ id: "city", label: "学园都市", path: ["city"], contains: ["d7"] }, { id: "d7", label: "第七学区", path: ["city", "d7"], contains: ["street"] },
    { id: "street", label: "购物美食大街", path: ["city", "d7", "street"] }, { id: "paris", label: "巴黎", path: ["paris"] }];
  // The generic part of the name (通名), longest first; Latin words and brackets after a Chinese name do not count as its end.
  assert.deepEqual(["第七学区", "购物美食大街", "保安室", "小馆Diner", "秘密住宅（Secret Residence）", "加利福尼亚州", "巴黎"].map(scaleOfName), ["district", "street", "room", "building", "building", "region", null]);
  const plain = await pickScales(places);
  assert.deepEqual(Object.values(plain.places).map((pick) => `${pick.scale}/${pick.by}`), ["city/name", "district/name", "street/name", "none/none"]);
  const names = { city: "学园都市", d7: "第七学区", street: "购物美食大街", paris: "巴黎" };
  const { model, asked } = recording((state) => (state.includes("巴黎") ? "city" : state.includes("购物美食大街.") ? "street" : state.includes("第七学区.") ? "district" : "city"));
  const picked = await pickScales(places, { decisions: model, names, previous: plain });
  assert.equal(asked.length, 4, "picks made from the name alone are asked again once Jev is there");
  assert.deepEqual(asked[0].questions[0].options, Object.keys(SCALE_HINTS));
  const street = asked.find((call) => call.state.startsWith("A place named in a novel: 购物美食大街"))!.state;
  assert.ok(street.includes("学园都市 › 第七学区 › 购物美食大街"), "the place's path in the tree, by name");
  assert.ok(asked.find((call) => call.state.startsWith("A place named in a novel: 学园都市"))!.state.includes("Places the novel puts inside it: 第七学区"));
  assert.deepEqual([picked.places.paris.scale, picked.places.paris.by], ["city", "jev"]);
  const again = recording(() => "none");
  assert.deepEqual((await pickScales(places, { decisions: again.model, names, previous: picked })).usage, { calls: 0, reused: 4 });
  assert.deepEqual(["room", "building", "street", "district", "city", "region", "none"].map((scale) => stageKindOf(scale as never)), ["site", "site", "street", "district", "district", "district", null]);
});

const scene: MovementScene = { id: "s1", placeId: "tower", placeLabel: "废弃大楼", kind: "skyscraper", opening: "白井走进废弃大楼。", cast: ["a", "b"],
  events: [{ id: "e1", text: "白井爬上楼梯到三楼。", actors: ["a"] }, { id: "e2", text: "大家在说话。", actors: [] }] };

test("movement: who moves (named people on an even chance, others only when sure), then where, how and which way; unstated starts are never told", async () => {
  const { model, asked } = recording((state, question) => {
    if (question.key.startsWith("stated_")) return 0.1;
    if (question.key.startsWith("start_")) return "floor-1";
    // e1: a (named) at 0.6 moves, b (not named) at 0.7 does not; e2: nobody.
    if (question.key === "moves_0") return state.includes("爬上") ? 0.6 : 0.1;
    if (question.key === "moves_1") return state.includes("爬上") ? 0.7 : 0.1;
    if (question.key.startsWith("to_")) return "floor-3";
    if (question.key.startsWith("how_")) return "climb up";
    return "up";
  });
  const report = await askMovement([scene], { decisions: model, names: { a: "白井", b: "大叔" } });
  assert.equal(report.complete, true);
  assert.deepEqual(Object.keys(report.scenes.s1.events.e1.a), ["moves", "to", "how", "direction"]);
  assert.equal(report.scenes.s1.events.e1.b.to, undefined, "someone the event does not name moves only above 0.8");
  assert.ok(asked.slice(1).every((call) => !/白井 — 1F/.test(call.state) && call.state.includes("somewhere in the building (not stated)")), "an assumed start is not told to Jev");
  // The prep checks the chain: climbing to 3F from an unstated start puts the start below it.
  const plan = prepareStage({ version: 1, inputs: "x", model: null, askedAt: "", usage: { calls: 0, reused: 0 }, places: { tower: { label: "废弃大楼", kind: "skyscraper", shortlist: ["skyscraper"], by: "name", inputs: "" } } }, report);
  const grid = navGrid("skyscraper"), height = (id: string) => grid.spots.find((spot) => spot.id === id)!.v;
  assert.deepEqual(plan.places.tower.moves.e1, [{ actor: "a", to: "floor-3", how: "climb up", p: 0.6 }]);
  assert.ok(height(plan.places.tower.starts.s1.a) < height("floor-3"), plan.places.tower.starts.s1.a);
  assert.equal(plan.places.tower.notes!.s1.a.assumed, true);
  assert.equal(plan.architecture.tower, "skyscraper");
  // Unchanged inputs are reused; a budget too small for a scene leaves it for a later run.
  const quiet = new MockDecisionModel();
  assert.equal((await askMovement([scene], { decisions: quiet, names: { a: "白井", b: "大叔" }, previous: report })).usage.reused, 1);
  const short = await askMovement([scene], { decisions: quiet, names: { a: "白井", b: "大叔" }, maxCalls: 1 });
  assert.deepEqual([short.complete, short.usage.skipped, Object.keys(short.scenes).length], [false, 1, 0]);
});

test("movement: --max-calls is never exceeded, even when every event has movers and scenes run side by side", async () => {
  const busy = Array.from({ length: 8 }, (_, index): MovementScene => ({ id: `s${index}`, placeId: "tower", placeLabel: "废弃大楼", kind: "office", opening: "", cast: ["a", "b"],
    events: Array.from({ length: 5 }, (_, at) => ({ id: `s${index}e${at}`, text: "两人跑上楼。", actors: ["a"] })) }));
  // Everyone moves in every event: each scene costs the most it can (its opening, then two calls per event).
  const { model, asked } = recording((_, question) => question.primitive === "noul" ? 1 : question.options![0]);
  const report = await askMovement(busy, { decisions: model, names: {}, maxCalls: 40 });
  assert.equal(sceneCallLimit(busy[0]), 11);
  assert.ok(asked.length <= 40, `${asked.length} calls against a budget of 40`);
  assert.deepEqual([report.usage.calls, report.complete, Object.keys(report.scenes).length], [asked.length, false, 3]);
});

test("the stage reads reviewed canon only: present people and recorded participants, never someone only mentioned or named in the evidence", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "stage-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  await writeFile(join(directory, "source", "novel.txt"), "第一章\n甲在钟塔。\n");
  const character = (id: string, name: string) => ({ id, kind: "Character", names: [{ text: name, lang: "zh", kind: "canonical" }], properties: {}, confidence: 0.9 });
  const lines = (records: unknown[]) => records.map((record) => JSON.stringify(record)).join("\n") + "\n";
  await writeFile(join(directory, "ontology", "entities.jsonl"), lines([character("char_a", "甲"), character("char_b", "乙"), character("char_c", "丙"), character("char_d", "丁"),
    { id: "loc_tower", kind: "Location", names: [{ text: "钟塔大厦", lang: "zh", kind: "canonical" }], properties: {}, confidence: 0.9 }]));
  await writeFile(join(directory, "ontology", "scenes.jsonl"), lines([
    { id: "s1", chapterIndex: 0, sentenceIds: ["b0001_s0001", "b0001_s0002"], charactersPresent: ["char_a"], charactersMentioned: ["char_b"], locationId: "loc_tower" },
    { id: "s2", chapterIndex: 1, sentenceIds: ["b0002_s0001"], charactersPresent: ["char_a"], charactersMentioned: [], locationId: null }]));
  // 乙 is only mentioned; 丙 is named in the evidence (in speech); 丁 is recorded taking part.
  await writeFile(join(directory, "ontology", "events.jsonl"), lines([
    { id: "evt_1", summary: "甲在钟塔里对丁说起乙和丙。", primaryActors: ["char_a"], evidence: { text: "甲说：「乙和丙去哪了？」", sentenceIds: ["b0001_s0001"] } },
    { id: "evt_2", summary: "甲上楼。", primaryActors: ["char_a"], evidence: { text: "甲上楼。", sentenceIds: ["b0002_s0001"] } }]));
  await writeFile(join(directory, "ontology", "relations.jsonl"), lines([{ id: "rel_1", type: "PARTICIPATES_IN", fromId: "char_d", toId: "evt_1", properties: {}, confidence: 0.9 }]));
  await mkdir(join(directory, "stage"), { recursive: true });
  await writeFile(join(directory, "stage", "architecture.json"), JSON.stringify({ version: 1, inputs: "x", model: null, askedAt: "", usage: { calls: 0, reused: 0 }, places: { loc_tower: { label: "钟塔大厦", kind: "skyscraper", shortlist: ["skyscraper"], by: "name", inputs: "" } } }));
  // s2's place awaits review: it is not staged, so nothing is paid for it.
  await mkdir(join(directory, "changesets"), { recursive: true });
  await writeFile(join(directory, "changesets", "cs_timeplace_time-place_1.json"), JSON.stringify({ id: "cs_timeplace_time-place_1", blockId: "time-place", status: "pending_review", reviewNotes: {}, createdAt: new Date().toISOString(),
    proposals: [{ id: "p1", kind: "add_relation", confidence: 0.9, payload: { id: "rel_2", type: "LOCATED_AT", fromId: "s2", toId: "loc_tower", properties: {}, confidence: 0.9 } }] }));
  const inputs = await stageInputs(directory);
  assert.deepEqual(inputs.movementScenes.map((entry) => entry.id), ["s1"]);
  const [staged] = inputs.movementScenes;
  assert.deepEqual(staged.cast, ["char_a", "char_d"]);
  assert.deepEqual(staged.events.map((event) => event.actors), [["char_d", "char_a"]]);
  assert.deepEqual([inputs.estimate, inputs.limit], [3, 3]);
});

test("movement asks who goes together: at the opening for each pair of the cast, per event for each mover and anyone else present; older answers keep theirs and only get the pairs", async () => {
  const pair: MovementScene = { ...scene, events: [{ id: "e1", text: "白井拉着大叔跑上三楼。", actors: ["a", "b"] }] };
  const { model, asked } = recording((state, question) => {
    if (question.key.startsWith("stated_")) return 0.9;
    if (question.key.startsWith("start_")) return "floor-1";
    if (question.key.startsWith("together_")) return 0.8;
    if (question.key === "moves_0") return 0.9;
    if (question.key === "moves_1") return 0.2;
    if (question.key.startsWith("with_")) return 0.9;
    if (question.key.startsWith("to_")) return "floor-3";
    if (question.key.startsWith("how_")) return "run";
    return "up";
  });
  const report = await askMovement([pair], { decisions: model, names: { a: "白井", b: "大叔" } });
  assert.deepEqual(report.scenes.s1.startPairs, [["a", "b", 0.8]]);
  assert.deepEqual(report.scenes.s1.pairs, { e1: [["a", "b", 0.9]] }, "the mover and the one dragged along, though Jev did not say 大叔 moves");
  assert.equal(asked.length, 3, "the pairs ride along in the opening and the where-and-how requests");
  // Answers from before pairs were asked: kept as they were, only the pairs asked.
  const older = structuredClone(report);
  delete older.scenes.s1.pairs; delete older.scenes.s1.startPairs;
  older.scenes.s1.events.e1.a.to = { "floor-2": 1 };
  const topUp = recording((state, question) => (question.key.startsWith("together_") || question.key.startsWith("with_") ? 0.7 : "floor-9"));
  const again = await askMovement([pair], { decisions: topUp.model, names: { a: "白井", b: "大叔" }, previous: older });
  assert.ok(topUp.asked.flatMap((call) => call.questions.map((question) => question.key)).every((key) => /^(together|with)_/.test(key)), "nothing but pairs asked");
  assert.deepEqual([again.scenes.s1.events.e1.a.to, again.scenes.s1.pairs, again.usage.calls], [{ "floor-2": 1 }, { e1: [["a", "b", 0.7]] }, 2]);
});

test("a stage step run too early is reported as waiting on the checklist, not as a bug", () => {
  const report = describeError(new Error("Animation prep waits for every other step: causality (todo). See novel checklist."), ["stage", "prep", "/books/vol-1/novel"]);
  assert.deepEqual([report.aspect, report.code, report.next], ["usage", "STEP_WAITING", ["novel checklist /books/vol-1/novel"]]);
  assert.equal(describeError(new Error("Movement needs each place's building first: run `novel stage architecture /b`."), ["stage", "movement", "/b"]).code, "STEP_WAITING");
  assert.equal(describeError(new Error("Movement waits for the steps it builds on: strands (todo). See novel checklist."), ["stage", "movement", "/b"]).code, "STEP_WAITING");
});
