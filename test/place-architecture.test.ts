import { test } from "node:test";
import assert from "node:assert/strict";
import { architectureCandidates, architectureOf, SHORTLIST_SIZE } from "../apps/playground/src/data/placeArchitecture.js";
import { atlasArrangement } from "../apps/playground/src/data/orbitalTimePlace.js";
import type { StoryPlace, TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";

test("a name says outright what it is: the strong kind comes first", () => {
  assert.equal(architectureOf("医院"), "hospital");
  assert.equal(architectureOf("Home_Ground_Hospital"), "hospital");
  assert.equal(architectureOf("圣乔治大教堂"), "church");
  assert.equal(architectureOf("地铁站"), "station");
  assert.equal(architectureOf("伦敦市场"), "market", "a market in a city is a market");
  assert.equal(architectureOf("学园都市"), "city", "a school city is a city");
  assert.equal(architectureOf("第七学区"), "city", "a district gets a skyline");
  assert.equal(architectureOf("废弃大楼"), "skyscraper");
  assert.equal(architectureOf("Windsor Castle"), "castle");
  assert.equal(architectureOf("Harbour Market"), "market", "the head noun (last) decides between two strong kinds");
  assert.equal(architectureOf("Station Square Hospital"), "hospital");
});

test("hints keep several kinds in play, at most one shortlist's worth", () => {
  assert.deepEqual(architectureCandidates("废弃大楼"), ["skyscraper", "office", "home", "school"]);
  assert.deepEqual(architectureCandidates("保安室"), ["office", "home", "school"]);
  assert.deepEqual(architectureCandidates("某某院"), ["hospital", "school", "church", "office"]);
  for (const name of ["购物美食大街", "警备员（Anti-Skill）化学分析中心", "伦敦市场", "Grand Central Hall"]) {
    const shortlist = architectureCandidates(name);
    assert.ok(shortlist.length >= 1 && shortlist.length <= SHORTLIST_SIZE, `${name}: ${shortlist.join(", ")}`);
    assert.equal(new Set(shortlist).size, shortlist.length, "no kind twice");
  }
});

test("a name that hints at no building gets no shortlist; English hints need whole words", () => {
  assert.deepEqual(architectureCandidates("御坂美琴的梦"), []);
  assert.deepEqual(architectureCandidates("Parker"), [], "park is a word, not a prefix");
  assert.equal(architectureOf("Hyde Park"), "park");
});

test("a recorded pick wins over the name, and none means no building", () => {
  assert.equal(architectureOf("废弃大楼", "school"), "school");
  assert.equal(architectureOf("第七学区", "none"), null);
  assert.equal(architectureOf("第七学区", null), "city");
});

test("floor marks carry the building and where the place's own scenes attach", () => {
  const place = (id: string, label: string, sceneIds: string[], parentId: string | null, path: string[], architecture?: StoryPlace["architecture"]): StoryPlace =>
    ({ id, label, sceneIds, statedScenes: sceneIds.length, characterIds: [], parentId, depth: path.length - 1, path, totalScenes: sceneIds.length, architecture });
  const data: TimePlaceProjection = {
    available: true, times: [], characters: [], names: { city: "学园都市", hospital: "医院", dream: "梦境" },
    places: [place("city", "学园都市", [], null, ["city"]), place("hospital", "医院", ["s1"], "city", ["city", "hospital"]), place("dream", "梦境", ["s2"], null, ["dream"]), place("tower", "废弃大楼", [], null, ["tower"], "none")],
    scenes: [
      { id: "s1", index: 0, chapterIndex: 1, label: "s1", times: [], flashback: false, placeIds: ["hospital"], placeCarried: false, characterIds: [] },
      { id: "s2", index: 1, chapterIndex: 1, label: "s2", times: [], flashback: false, placeIds: ["dream"], placeCarried: false, characterIds: [] },
    ],
  };
  const marks = new Map(atlasArrangement(data, { periods: null }).floor!.map((mark) => [mark.id, mark]));
  assert.equal(marks.get("city")!.architecture, "city");
  assert.equal(marks.get("hospital")!.architecture, "hospital");
  assert.equal(marks.get("dream")!.architecture, undefined, "no building named, no hologram");
  assert.equal(marks.get("tower")!.architecture, undefined, "a recorded none hides the hologram");
  const city = marks.get("city")!;
  assert.ok(city.spotZ! < city.z, "a region's own spot sits inside its upper (back) rim");
});
