import { test } from "node:test";
import assert from "node:assert/strict";
import { keyedPlan, pageScene, paginate, placePlan, reelWindow, type ReadSentence } from "../apps/playground/src/data/readMode.js";
import { sentenceKey, type HoloScript } from "../apps/playground/src/data/holoScript.js";

const sentence = (index: number, text: string, paragraph = false): ReadSentence => ({ id: `b0001_s${String(index).padStart(4, "0")}`, text, ...(paragraph ? { paragraph } : {}) });

test("pages end at a paragraph once full, or at a sentence when a paragraph runs long", () => {
  const text = [sentence(0, "一".repeat(300), true), sentence(1, "二".repeat(200)), sentence(2, "三".repeat(200), true), sentence(3, "四".repeat(100), true)];
  const pages = paginate(text, 400);
  assert.deepEqual(pages.map((page) => [page.from, page.to]), [[sentenceKey("b0001_s0000"), sentenceKey("b0001_s0001")], [sentenceKey("b0001_s0002"), sentenceKey("b0001_s0003")]]);
  assert.equal(pages[1].paragraphs.length, 2);
  const long = paginate([sentence(0, "长".repeat(300), true), sentence(1, "长".repeat(300)), sentence(2, "长".repeat(300))], 400);
  assert.equal(long.length, 2, "a paragraph past 1.6 pages breaks at a sentence");
  assert.equal(long[1].paragraphs[0][0].paragraph, undefined, "the next page continues the paragraph");
});

const key = (index: number) => sentenceKey(`b0001_s${String(index).padStart(4, "0")}`);
const script: HoloScript = { title: "Tower", places: [{ id: "tower", label: "Tower", kind: "skyscraper", x: 0, z: 0, scenes: 2 }], actors: [], beats: [
  { id: "scene:s1", kind: "scene", sceneId: "s1", placeId: "tower", title: "Scene 1", text: "", actors: [], present: [], conflict: false, scene: 1, source: { from: key(0), to: key(40) } },
  { id: "s1:e1", kind: "event", sceneId: "s1", placeId: "tower", title: "Event", text: "", actors: [], present: [], conflict: false, scene: 1, source: { from: key(5), to: key(8) } },
  { id: "s1:e2", kind: "event", sceneId: "s1", placeId: "tower", title: "Event", text: "", actors: [], present: [], conflict: false, scene: 1, source: { from: key(30), to: key(33) } },
  { id: "scene:s2", kind: "scene", sceneId: "s2", placeId: "tower", title: "Scene 2", text: "", actors: [], present: [], conflict: false, scene: 2, source: { from: key(41), to: key(60) } },
] };

test("a page replays what it tells: its records, and a scene's card only where the scene starts", () => {
  assert.deepEqual(reelWindow(script, { from: key(0), to: key(10) }, ["s1"]), { from: 0, to: 1 });
  assert.deepEqual(reelWindow(script, { from: key(25), to: key(45) }, ["s1", "s2"]), { from: 2, to: 3 });
  // Only narration of the scene on this page: its card.
  assert.deepEqual(reelWindow(script, { from: key(15), to: key(20) }, ["s1"]), { from: 0, to: 0 });
  const scenes = [{ id: "s1", placeId: "tower", from: key(0), to: key(40) }, { id: "s2", placeId: null, from: key(41), to: key(60) }];
  assert.equal(pageScene({ from: key(35), to: key(55) }, scenes).main!.id, "s2", "the scene the page mostly tells");
  assert.equal(pageScene({ from: key(35), to: key(45) }, scenes).main!.id, "s1");
});

test("the prepared plan's moves are keyed by event id; the stage's beats by scene and record", () => {
  const plan = keyedPlan({ place: "tower", kind: "skyscraper", starts: { s1: { a: "floor-3" } }, moves: { e2: [{ actor: "a", to: "roof", how: "climb up", p: 0.9 }] } }, script);
  assert.deepEqual(Object.keys(plan.moves), ["s1:e2"]);
  assert.equal(plan.starts.s1.a, "floor-3");
});

test("a universe stage finds the loaded book's prepared plan under its book prefix", () => {
  const plan = { place: "loc_1", kind: "skyscraper" as const, starts: { s1: { a: "floor-3" } }, moves: { e1: [{ actor: "a", to: "roof", how: "climb up" as const, p: 0.9 }] } };
  const stage = { inputs: "", preparedAt: "", architecture: {}, places: { loc_1: plan }, counts: {} };
  assert.equal(placePlan(stage, "3:loc_1", 3), plan);
  assert.equal(placePlan(stage, "4:loc_1", 3), null, "another book's place is not this plan");
  const universe: HoloScript = { ...script, beats: [{ ...script.beats[0], id: "scene:3:s1", sceneId: "3:s1" }, { ...script.beats[1], id: "3:s1:e1", sceneId: "3:s1" }] };
  const keyed = keyedPlan(plan, universe);
  assert.deepEqual([Object.keys(keyed.moves), keyed.starts["3:s1"]], [["3:s1:e1"], { a: "floor-3" }]);
});
