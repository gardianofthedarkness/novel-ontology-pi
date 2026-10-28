import { test } from "node:test";
import assert from "node:assert/strict";
import { MockDecisionModel, type DecisionAnswer, type DecisionModel, type DecisionQuestion } from "../src/ground/connectors/jev.js";
import { pickArchitecture, type ArchitecturePlace } from "../src/digger/stage/architecture.js";
import { askMovement, type MovementScene } from "../src/digger/stage/movement.js";
import { prepareStage } from "../src/digger/stage/prep.js";
import { navGrid } from "../apps/playground/src/data/holoNav.js";
import { describeError } from "../src/ground/errors.js";

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

test("a stage step run too early is reported as waiting on the checklist, not as a bug", () => {
  const report = describeError(new Error("Animation prep waits for every other step: causality (todo). See novel checklist."), ["stage", "prep", "/books/vol-1/novel"]);
  assert.deepEqual([report.aspect, report.code, report.next], ["usage", "STEP_WAITING", ["novel checklist /books/vol-1/novel"]]);
  assert.equal(describeError(new Error("Movement needs each place's building first: run `novel stage architecture /b`."), ["stage", "movement", "/b"]).code, "STEP_WAITING");
});
