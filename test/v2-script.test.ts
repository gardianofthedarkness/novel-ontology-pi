import assert from "node:assert/strict";
import { test } from "node:test";
import type { FlowResult } from "../src/v2/flow.js";
import { readingScript } from "../src/v2/script.js";

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
    slots: [{ id: "slot_2_1", kind: "room", scene: "s2", label: "房间", names: ["房间"], sentences: ["y3"], in: "d7" }, { id: "slot_2_2", kind: "building", scene: "s2", label: "大楼", names: ["大楼"], sentences: ["y4"], in: "d7" }],
    time: { periods: [{ id: "p1", storyIndex: 0 }, { id: "p2", storyIndex: 3 }], scenes: [{ scene: "s1", periods: ["p1"], flashback: false }, { scene: "s2", periods: ["p2"], flashback: false }, { scene: "s3", periods: [], flashback: false }, { scene: "s4", periods: [], flashback: true }] },
  } as unknown as FlowResult;
  const script = readingScript(result, (id) => (id === "x1" ? "第七学区的车站前。" : ""));
  const [s1, s2, s3, s4] = script.scenes;
  assert.deepEqual([s1.place, s1.placeBy, s1.context], ["d7", "environment", "Environment: 第七学区的车站前。"], "the environment's deepest place, not the school the talk names");
  assert.deepEqual([s1.present, s1.firstSeen, s1.clock], [["a", "b"], ["a", "b"], [0, 0]], "who speaks and is spoken to; someone only named is not there");
  assert.deepEqual([s2.place, s2.placeBy], ["unnamed:slot_2_1", "unnamed"], "the room its environment names; not 日本, which holds the place before");
  assert.deepEqual(script.places["unnamed:slot_2_1"], { label: "房间 (scene 2)", scale: "room", parent: "d7", unnamed: true });
  assert.equal(script.places["unnamed:slot_2_2"], undefined, "a building only its narration names is not where it is set");
  assert.deepEqual([s2.firstSeen, s2.timeline], [["c"], [{ type: "event", id: "evt_000001", actors: ["c"] }]]);
  assert.deepEqual([s3.place, s3.placeBy, s3.clock], ["unnamed:slot_2_1", "carried", [3, 3]], "no place named: it goes on where it was, at the same time");
  assert.deepEqual([s4.clock, s4.present, s4.firstSeen], [null, ["d"], []], "the past: no clock, and no one is first seen there");
  assert.deepEqual([script.places.d7, script.places.school], [{ label: "学园都市第七学区", parent: "city", scale: "district" }, { label: "常盘台中学", parent: null, scale: "building" }], "the tree's parents; a building by its type, a district by its name");
  assert.equal(script.places.jp.scale, "region", "a place its name gives no scale, holding a city: a region");
});
