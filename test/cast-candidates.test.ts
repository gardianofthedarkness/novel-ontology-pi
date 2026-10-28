import { test } from "node:test";
import assert from "node:assert/strict";
import { castCandidates, namedInText } from "../src/digger/processing/castCandidates.js";

// Invented names: Mei Lin and her sister Mei Hua share the surname form "Mei";
// "少年" (a boy) is a generic form of Tao's.
const characters = [
  { id: "lin", forms: ["Mei Lin", "Lin", "Mei"] },
  { id: "hua", forms: ["Mei Hua", "Hua", "Mei"] },
  { id: "tao", forms: ["Wang Tao", "Tao", "少年"] },
  { id: "kai", forms: ["Kai"] },
];

test("names are matched longest first; a shared or generic form only suggests", () => {
  const both = namedInText("Mei Lin waved at Tao. Mei Hua laughed.", characters);
  assert.deepEqual([...both.unique].sort(), ["hua", "lin", "tao"]);
  assert.equal(both.weak.size, 0);
  const shared = namedInText("Mei laughed while the 少年 ran.", characters);
  assert.deepEqual([...shared.unique], []);
  assert.deepEqual([...shared.weak].sort(), ["hua", "lin", "tao"]);
});

test("a scene's candidates: named or recorded first, then neighbours, chapter and volume", () => {
  const scene = (id: string, index: number, chapterIndex: number, text: string, present: string[] = [], mentioned: string[] = []) => ({ id, index, chapterIndex, text, present, mentioned });
  const candidates = castCandidates([
    scene("s0", 0, 0, "Lin opened the door."),
    scene("s1", 1, 0, "Nobody spoke."),
    scene("s2", 2, 0, "Rain.", ["tao"]),
    scene("s3", 3, 0, "Mei sighed.", [], ["kai"]),
    scene("s4", 4, 1, "Morning."),
  ], characters);
  const score = (sceneId: string) => Object.fromEntries(candidates.get(sceneId)!.map((candidate) => [candidate.id, [candidate.score, candidate.evidence]]));
  assert.deepEqual(score("s0").lin, [1, "named"]);
  assert.deepEqual(score("s1").lin, [0.7, "neighbour"]);
  assert.deepEqual(score("s1").tao, [0.7, "neighbour"]);
  assert.deepEqual(score("s0").tao, [0.5, "neighbour"]);
  // Recorded as mentioned counts as found in the scene.
  assert.deepEqual(score("s3").kai, [1, "recorded"]);
  assert.deepEqual(score("s3").hua, [0.5, "shared-name"]);
  // Another chapter only knows the volume's characters, weakly.
  assert.ok(Object.values(score("s4")).every(([value, evidence]) => evidence === "volume" && (value as number) <= 0.1));
  assert.equal(candidates.get("s0")![0].id, "lin");
  assert.equal(castCandidates([scene("s0", 0, 0, "Lin, Hua, Tao and Kai.")], characters, { limit: 2 }).get("s0")!.length, 2);
});
