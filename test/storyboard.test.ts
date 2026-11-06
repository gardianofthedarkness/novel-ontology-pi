import test from "node:test";
import assert from "node:assert/strict";
import { cutsOf, headingPlaces, type CardShot } from "../src/v2/extraction/storyboard.js";

const shot = (card: string, scene: string, cut: number, size: string, seconds = 4): CardShot => ({ card, scene, first: `${card}a`, last: `${card}b`, cut, size: { [size]: 0.8, "wide shot": 0.2 }, angle: { "eye level": 1 }, move: { static: 1 }, seconds, confidence: 0.7 });

test("cuts: a scene's first card opens one, P(new cut) of a half or more opens one, the shot is the cards' answers averaged", () => {
  const cuts = cutsOf([shot("c1", "s1", 1, "medium shot"), shot("c2", "s1", 0.2, "medium shot"), shot("c3", "s1", 0.7, "close-up", 2), shot("c4", "s2", 0.1, "wide shot")], (scene) => (scene === "s1" ? "q1" : "q2"));
  assert.deepEqual(cuts.map((cut) => [cut.id, cut.scene, cut.sequence, cut.cards.join(","), cut.size, cut.seconds]), [["cut_000001", "s1", "q1", "c1,c2", "medium shot", 8], ["cut_000002", "s1", "q1", "c3", "close-up", 2], ["cut_000003", "s2", "q2", "c4", "wide shot", 4]]);
  assert.equal(cuts[0].first, "c1a"); assert.equal(cuts[0].last, "c2b");
});

test("a heading is offered the places its scenes say (not carried), the unnamed places opened in it, the heading before, and what they stand in", () => {
  const places = { places: [{ id: "city", parent: null }, { id: "district", parent: "city" }, { id: "bar", parent: "district" }], slots: [{ id: "alley", scene: "u2", in: "district" }],
    settings: [{ scene: "u1", place: "bar", by: "environment" }, { scene: "u2", place: "city", by: "carried" }, { scene: "u9", place: "far", by: "named" }], occupancy: [] } as never;
  assert.deepEqual(headingPlaces({ scenes: ["u1", "u2"] }, places, "station"), ["bar", "alley", "station", "district", "city"]);
});
