import { test } from "node:test";
import assert from "node:assert/strict";
import { pickClips, sceneClips, type StageClip } from "../apps/playground/src/data/stageClips.js";
import type { HoloBeat, HoloScript } from "../apps/playground/src/data/holoScript.js";
import type { MovePlan } from "../apps/playground/src/data/holoNav.js";

const beat = (sceneId: string, record: string, kind: HoloBeat["kind"], at: number): HoloBeat => ({ id: `${sceneId}:${record}`, kind, sceneId, placeId: "place_1", title: kind === "scene" ? "Scene 1" : record, text: kind === "scene" ? `What happens in ${sceneId}` : record, actors: [], present: [], conflict: false, scene: 1, source: { from: at, to: at } });

test("a scene's clip is its stretch with the most moves; a scene where nobody moves gives none", () => {
  const beats = [beat("s1", "card", "scene", 1_000_000), ...Array.from({ length: 14 }, (_, index) => beat("s1", `e${index}`, "event", 1_000_001 + index)), beat("s2", "card", "scene", 2_000_000), beat("s2", "e0", "event", 2_000_001)];
  const script: HoloScript = { title: "School", places: [{ id: "place_1", label: "School", kind: "school", x: 0, z: 0, scenes: 2 }], actors: [], beats };
  const move = (actor: string) => [{ actor, to: "1f-hall", how: "walk" as const, p: 0.9 }];
  const plan: MovePlan = { place: "place_1", kind: "school", starts: {}, moves: { "s1:e10": move("a"), "s1:e11": move("b"), "s1:e13": move("a") } };
  const clips = sceneClips(script, plan);
  assert.equal(clips.length, 1);
  assert.deepEqual([clips[0].from, clips[0].to, clips[0].moves, clips[0].movers], [6, 14, 3, 2]);
  assert.deepEqual([clips[0].title, clips[0].scene], ["What happens in s1", "Scene 1"]);
  assert.equal(clips[0].at, 1_000_006);
});

test("picks spread over building kinds, cap each place, and play in reading order", () => {
  const clip = (id: string, placeId: string, kind: StageClip["kind"], moves: number, at: number): StageClip => ({ id, placeId, sceneId: id, title: id, scene: "Scene 1", place: placeId, kind, from: 0, to: 1, moves, movers: 1, at });
  const picked = pickClips([clip("a", "p1", "city", 9, 50), clip("b", "p1", "city", 8, 10), clip("c", "p1", "city", 7, 20), clip("d", "p2", "school", 1, 40), clip("e", "p3", "city", 5, 30)], { max: 4, perPlace: 2 });
  assert.deepEqual(picked.map((entry) => entry.id), ["b", "e", "d", "a"]);
  // A book told in one place gets all its clips there.
  assert.equal(pickClips(Array.from({ length: 12 }, (_, index) => clip(`s${index}`, "p1", "city", index + 1, index))).length, 10);
});
