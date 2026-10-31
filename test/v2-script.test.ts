import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecisionAnswer, DecisionQuestion, DecisionState } from "../src/ground/connectors/jev.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import { Chart } from "../src/v2/em.js";
import type { FlowResult } from "../src/v2/flow.js";
import { placeEm } from "../src/v2/placeEm.js";
import { readingScript } from "../src/v2/script.js";
import { levelOf, spatialMentions } from "../src/v2/spatial.js";

type Card = FlowResult["cards"][number];
const card = (kind: string, sentences: string[], entities: string[], people: [string, string[]][] = []): Card =>
  ({ id: `${kind}:${sentences[0]}`, kind, home: "world", first: sentences[0], last: sentences.at(-1), block: "b1", sentences, entities: entities.map((id) => ({ id, at: [sentences[0]] })), people: people.map(([id, how]) => ({ id, how, at: [sentences[0]] })) }) as unknown as Card;
const entity = (id: string, category: string, type: string, name: string) => [id, { id, category, type, names: [name], proper: [name], first: "x1", seen: [] }] as const;

test("the world script from the reading: each scene's place (its environment first, the place tree's deepest, an unnamed room), who is there, the past, its events", () => {
  const result = {
    chart: { entities: new Map([
      entity("jp", "place", "place", "日本"), entity("city", "place", "place", "学园都市"), entity("d7", "place", "place", "学园都市第七学区"), entity("school", "place", "building", "常盘台中学"),
      entity("a", "person", "person", "御坂美琴"), entity("b", "person", "person", "白井黑子"), entity("c", "person", "person", "上条当麻"), entity("d", "person", "person", "欧提努斯"),
    ]), times: new Map() },
    places: { places: [{ id: "d7", parent: "city" }, { id: "city", parent: "jp" }, { id: "jp", parent: null }, { id: "school", parent: null }], slots: [] },
    scenes: [{ id: "s1", index: 0, chapter: 0, block: "b1", sentences: ["x1", "x2", "x3", "x4"] }, { id: "s2", index: 1, chapter: 0, block: "b1", sentences: ["y1", "y2", "y3", "y4"] }, { id: "s3", index: 2, chapter: 0, block: "b1", sentences: ["z1"] }, { id: "s4", index: 3, chapter: 1, block: "b1", sentences: ["w1"] }],
    cards: [
      // s1: set in 第七学区 by its environment card; the school is only named (the girls' school), the boy only named.
      card("environment", ["x1"], ["city", "d7"]), card("dialogue", ["x2", "x3"], ["school"], [["a", ["speaks"]], ["b", ["addressed"]], ["school", ["described"]]]), card("narration", ["x4"], ["school"], [["c", ["named"]]]),
      // s2: talk of 日本 holds 第七学区, so it stays; its environment names an unnamed room held by 第七学区; one event.
      card("action", ["y1"], [], [["c", ["acts"]]]), card("dialogue", ["y2"], ["jp"], [["a", ["speaks"]]]), card("environment", ["y3"], []), card("narration", ["y4"], []),
      // s3 names no place: it goes on in the room. s4 is in the past.
      card("narration", ["z1"], []), card("action", ["w1"], [], [["d", ["acts"]]]),
    ],
    slots: [{ id: "slot_2_1", kind: "room", scene: "s2", label: "房间", names: ["房间"], sentences: ["y3"], in: "d7" }, { id: "slot_2_2", kind: "building", scene: "s2", label: "大楼", names: ["大楼"], sentences: ["y4"], in: "d7" }, { id: "slot_1_1", kind: "place", scene: "s1", label: "河边", names: ["河边"], sentences: ["x4"], in: null }],
    time: { periods: [{ id: "p1", storyIndex: 0 }, { id: "p2", storyIndex: 3 }], scenes: [{ scene: "s1", periods: ["p1"], flashback: false }, { scene: "s2", periods: ["p2"], flashback: false }, { scene: "s3", periods: [], flashback: false }, { scene: "s4", periods: [], flashback: true }] },
  } as unknown as FlowResult;
  const script = readingScript(result, (id) => (id === "x1" ? "第七学区的车站前。" : ""));
  const [s1, s2, s3, s4] = script.scenes;
  assert.deepEqual([s1.place, s1.placeBy, s1.context], ["d7", "environment", "Environment: 第七学区的车站前。"], "the environment's deepest place, not the school the talk names");
  assert.deepEqual([s1.present, s1.firstSeen, s1.clock], [["a", "b"], ["a", "b"], [0, 0]], "who speaks and is spoken to; someone only named is not there");
  assert.deepEqual([s2.place, s2.placeBy], ["unnamed:slot_2_1", "unnamed"], "the room its environment names; not 日本, which holds the place before");
  assert.deepEqual(script.places["unnamed:slot_2_1"], { label: "房间 (scene 2)", scale: "room", parent: "d7", unnamed: true, held: "em2", scene: "s2" });
  assert.ok(script.scenes.every((scene) => scene.place !== "unnamed:slot_2_2"), "a building only its narration names is not where a scene is set");
  assert.deepEqual(script.places["unnamed:slot_2_2"], { label: "大楼 (scene 2)", scale: "building", parent: "d7", unnamed: true, held: "em2", scene: "s2" }, "but it is a place of the world, where EM² put it");
  assert.deepEqual(script.places["unnamed:slot_1_1"], { label: "河边 (scene 1)", scale: "street", parent: "d7", unnamed: true, held: "scene", scene: "s1" }, "nothing holds it: its scene's place, a guess");
  assert.deepEqual([s2.firstSeen, s2.timeline], [["c"], [{ type: "event", id: "evt_000001", actors: ["c"] }]]);
  assert.deepEqual([s3.place, s3.placeBy, s3.clock], ["unnamed:slot_2_1", "carried", [3, 3]], "no place named: it goes on where it was, at the same time");
  assert.deepEqual([s4.clock, s4.present, s4.firstSeen], [null, ["d"], []], "the past: no clock, and no one is first seen there");
  assert.deepEqual([script.places.d7, script.places.school], [{ label: "学园都市第七学区", parent: "city", scale: "district" }, { label: "常盘台中学", parent: null, scale: "building", near: "d7", nears: ["d7"] }], "the tree's parents; a building by its type, a district by its name; a building the tree puts nowhere is near where its scenes are set");
  assert.equal(script.places.jp.scale, "region", "a place its name gives no scale, holding a city: a region");
});

test("scale is EM's: a place's type, else its name, else a step above what it holds; the tree raises a parent no larger than an open place it holds, and Jev is offered only larger places", async () => {
  const chart = new Chart();
  const text = sectionBlock("日本东京都，东京西部的学园都市第七学区。常盘台中学的七号房。", 1).sentences;
  chart.mint("place", "place", "日本", []);
  chart.mint("place", "city", "东京都", []);
  chart.mint("place", "city", "东京西部的学园都市", []);
  chart.mint("place", "district", "第七学区", []);
  chart.mint("place", "building", "常盘台中学", []);
  chart.mint("place", "room", "七号房", []);
  const asked: DecisionQuestion[][] = [];
  const decide = async (_state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionAnswer[]> => { asked.push(questions); return questions.map((q) => ({ key: q.key, value: "none", confidence: 0.9, distribution: { none: 0.9 } }) as DecisionAnswer); };
  const result = await placeEm(decide, { chart, scenes: [{ id: "s1", index: 0, block: "b1", chapter: 0, sentences: text.map((sentence) => sentence.id) }], cards: [], sentences: text, kinds: {}, text: (id) => text.find((sentence) => sentence.id === id)?.text ?? "", facts: [], descriptions: [] });
  const of = (name: string) => result.places.find((entry) => chart.entities.get(entry.id)!.names[0] === name)!;
  const name = (id: string | null) => (id ? chart.entities.get(id)!.names[0] : null);
  assert.deepEqual([name(of("东京西部的学园都市").parent), name(of("东京都").parent), name(of("第七学区").parent)], ["东京都", "日本", "东京西部的学园都市"], "stated, one after the other");
  assert.deepEqual([of("东京西部的学园都市").scale, of("东京西部的学园都市").scaleBy], ["city", "typing"]);
  assert.deepEqual([of("东京都").scale, of("东京都").scaleBy], ["region", "tree"], "named a city, holding a city: raised");
  assert.deepEqual([of("日本").scale, of("日本").scaleBy], ["region", "holds"], "its name says nothing: a step above what it holds");
  assert.deepEqual([of("七号房").scale, name(of("七号房").parent)], ["room", "常盘台中学"], "a room in its building");
  const school = result.asked.find((entry) => Object.values(entry.keys).includes(of("常盘台中学").id))!, key = Object.entries(school.keys).find(([, id]) => id === of("常盘台中学").id)![0];
  const offered = asked.flat().find((q) => q.key === `tree:${key}`)?.options ?? [];
  assert.ok(offered.length && !offered.includes(of("七号房").id), "a room is never offered to hold a building");
  assert.ok(offered.includes(of("日本").id), "a region is");
});

test("spatial words: tied to who acts or speaks in the line (EM²'s role, else the card), at a level of the world", () => {
  const result = {
    scenes: [{ id: "s1", index: 0, chapter: 0, block: "b1", sentences: ["x1", "x2"] }],
    cards: [card("action", ["x1"], [], [["a", ["acts"]]]), card("action", ["x2"], [], [["b", ["acts"]], ["c", ["named"]]])],
    em: [{ batch: "x1", results: [{ key: "n1", text: "屋顶上", type: "spatial", category: null, outcome: "spatial", sentences: ["x1"] }, { key: "n2", text: "地下通道", type: "spatial", category: null, outcome: "spatial", sentences: ["x2"] }, { key: "n3", text: "手机", type: "routine", category: null, outcome: "routine" }] }],
    roles: { x1: { kind: "action", who: { id: "a", answer: "a", confidence: 0.9 } } },
  } as unknown as FlowResult;
  assert.deepEqual(spatialMentions(result), [
    { text: "屋顶上", sentence: "x1", scene: "s1", level: "roof", who: ["a"] },
    { text: "地下通道", sentence: "x2", scene: "s1", level: "underground", who: ["b"] },
  ]);
  assert.deepEqual(["地面", "街上", "走廊", "上空", "墙面", "门", "大楼三层", "第四十四层", "楼顶边缘"].map(levelOf), ["street", "street", "inside", "sky", "wall", null, "inside", "inside", "roof"]);
});
