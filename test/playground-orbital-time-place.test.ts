import { test } from "node:test";
import assert from "node:assert/strict";
import { atlasArrangement, atlasNodeId, atlasScenes, atlasWorld, periodNodeId, pinNodeId, storyArrangement, storyWorld } from "../apps/playground/src/data/orbitalTimePlace.js";
import { orbitalLevel, surroundingEntities, mainProminence } from "../apps/playground/src/data/orbitalModel.js";
import { layoutOrbitalLevel } from "../apps/playground/src/data/orbitalLayout.js";
import type { TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";
import type { WorldEdge, WorldNode } from "../apps/playground/src/types.js";

const node = (id: string, kind: WorldNode["kind"], parent: string | null, chrono: number): WorldNode =>
  ({ id, label: id, kind, parent, chrono, lane: "canon", state: "canon", lanePos: [0, 0, 0], interiorPos: [0, 0, 0], summary: `${id} summary` });
const edge = (from: string, to: string, kind: WorldEdge["kind"], parent: string, relationLabel: string): WorldEdge =>
  ({ id: `${parent}:${relationLabel}:${from}:${to}`, from, to, kind, state: "canon", parent, relationLabel });

// Invented: Ming at the station in the evening; a flashback to his childhood
// told during that evening; the next morning at school.
const world = {
  laneNodes: [node("ch_1", "bigEvent", null, 1), node("ch_2", "bigEvent", null, 2)],
  interiors: {
    ch_1: {
      nodes: [node("s1", "scene", "ch_1", 0), node("s2", "scene", "ch_1", 1), node("e1", "event", "ch_1", 0), node("e2", "event", "ch_1", 1), node("ming", "character", "ch_1", 0)],
      edges: [edge("s1", "e1", "contains", "ch_1", "Shared source coverage"), edge("s2", "e2", "contains", "ch_1", "Shared source coverage"), edge("ming", "s1", "contains", "ch_1", "Present in scene"), edge("ming", "s2", "contains", "ch_1", "Present in scene")],
    },
    ch_2: {
      nodes: [node("s3", "scene", "ch_2", 0), node("e3", "event", "ch_2", 0), node("ming", "character", "ch_2", 0)],
      edges: [edge("s3", "e3", "contains", "ch_2", "Shared source coverage"), edge("ming", "s3", "contains", "ch_2", "Present in scene")],
    },
  },
};
const time = (id: string, label: string, storyIndex: number, sceneIds: string[], flashback = false, toldFromId: string | null = null) =>
  ({ id, label, gloss: label, family: "time-of-day", role: flashback ? "FLASHBACK" : "ADVANCE", flashback, flashbackProbability: flashback ? 0.9 : 0, decidedBy: "jev", toldFromId, date: null, partOfDay: null, chapterIndex: 1, storyIndex, narrativeIndex: storyIndex, anchorSceneId: sceneIds[0], sceneIds });
const data: TimePlaceProjection = {
  available: true,
  times: [time("t_child", "back then", 0, ["s2"], true, "t_evening"), time("t_evening", "evening", 1, ["s1"]), time("t_morning", "next morning", 2, ["s3"])],
  scenes: [
    { id: "s1", index: 0, chapterIndex: 1, label: "s1", times: [{ id: "t_evening", via: "anchor" }], flashback: false, placeIds: ["station"], placeCarried: false, characterIds: ["ming"] },
    { id: "s2", index: 1, chapterIndex: 1, label: "s2", times: [{ id: "t_child", via: "anchor" }], flashback: true, placeIds: [], placeCarried: false, characterIds: ["ming"] },
    { id: "s3", index: 2, chapterIndex: 2, label: "s3", times: [{ id: "t_morning", via: "anchor" }], flashback: false, placeIds: ["school"], placeCarried: false, characterIds: ["ming"] },
  ],
  places: [{ id: "station", label: "Station", sceneIds: ["s1"], statedScenes: 1, characterIds: ["ming"] }, { id: "school", label: "School", sceneIds: ["s3"], statedScenes: 1, characterIds: ["ming"] }],
  characters: [{ id: "ming", label: "Ming", scenes: 3 }],
  names: { station: "Station", school: "School", ming: "Ming" },
};
const finite = (draws: { position: number[]; radius: number }[]) => draws.every((draw) => draw.position.every(Number.isFinite) && Number.isFinite(draw.radius));

test("story time: one sphere per period in story order, flashbacks on a raised track, threaded to when they were told", () => {
  const regrouped = storyWorld(world, data);
  assert.deepEqual(regrouped.laneNodes.map((entry) => [entry.id, entry.chrono, entry.trackId]), [[periodNodeId("t_child"), 0, "flashback"], [periodNodeId("t_evening"), 1, "present"], [periodNodeId("t_morning"), 2, "present"]]);
  assert.deepEqual(regrouped.interiors[periodNodeId("t_evening")].nodes.map((entry) => entry.id).sort(), ["e1", "ming", "s1"]);
  assert.ok(regrouped.interiors[periodNodeId("t_morning")].nodes.every((entry) => entry.parent === periodNodeId("t_morning")));
  const level = orbitalLevel(regrouped);
  assert.equal(level.main[0].node.label, "↶ back then", "periods keep their own names");
  const nebula = surroundingEntities(level, null);
  const layout = layoutOrbitalLevel(level, nebula.nodes, { main: mainProminence(level), nebula: nebula.prominence });
  assert.ok(finite(layout.draws));
  const at = new Map(layout.draws.map((draw) => [draw.node.id, draw.position]));
  assert.ok(at.get(periodNodeId("t_child"))![1] > at.get(periodNodeId("t_evening"))![1], "the flashback is raised");
  const paths = storyArrangement(regrouped).paths!(layout.draws, null);
  assert.deepEqual(paths.map((path) => path.tone ?? "time"), ["time", "thread"]);
  assert.equal(paths[0].points.length, 5, "one story-order string through all three periods");
});

test("places (space-time): the map on the floor, placed scenes above their place rising in story order", () => {
  assert.deepEqual(atlasScenes(data, null).map((scene) => scene.id), ["s1", "s3"], "story order; a scene with no place stays off the map");
  const regrouped = atlasWorld(world, data, null);
  assert.deepEqual(regrouped.laneNodes.map((entry) => entry.id), [atlasNodeId("s1"), atlasNodeId("s3")]);
  assert.ok(!regrouped.interiors[atlasNodeId("s1")].nodes.some((entry) => entry.id === "s1"), "inside the sphere are the scene's records");
  assert.ok(regrouped.interiors[atlasNodeId("s1")].nodes.some((entry) => entry.id === "e1"));
  const arrangement = atlasArrangement(data, null);
  assert.deepEqual(arrangement.floor!.map((mark) => [mark.id, mark.active]), [["station", true], ["school", true]]);
  assert.deepEqual(arrangement.extraDraws!.map((draw) => draw.node.id), [pinNodeId("station"), pinNodeId("school")]);
  const level = orbitalLevel(regrouped);
  const nebula = surroundingEntities(level, null);
  const layout = layoutOrbitalLevel(level, nebula.nodes, { main: mainProminence(level), nebula: nebula.prominence, anchors: arrangement.anchors, radiusScale: arrangement.radiusScale });
  assert.ok(finite(layout.draws));
  const at = new Map(layout.draws.map((draw) => [draw.node.id, draw.position]));
  assert.ok(at.get(atlasNodeId("s3"))![1] > at.get(atlasNodeId("s1"))![1], "later in story time is higher");
  const quiet = arrangement.paths!(layout.draws, null);
  assert.deepEqual(quiet.map((path) => path.tone ?? "time"), ["time", "link", "link", "link"], "story string, one move on the floor, a drop line per scene");
  const traced = arrangement.paths!(layout.draws, "ming");
  assert.equal(traced.at(-1)!.tone, "route");
  assert.equal(traced.at(-1)!.points.length, 2);
  assert.ok(arrangement.focusFor!("ming", layout.draws)!.length >= 2);
});

test("places (space-time): the story-time window decides which scenes float above the map", () => {
  const evening = new Set(["t_evening"]);
  assert.deepEqual(atlasScenes(data, evening).map((scene) => scene.id), ["s1"]);
  assert.deepEqual(atlasWorld(world, data, evening).laneNodes.map((entry) => entry.id), [atlasNodeId("s1")]);
  assert.deepEqual(atlasArrangement(data, evening).floor!.map((mark) => [mark.id, mark.active]), [["station", true], ["school", false]], "places outside the window dim");
  assert.equal(atlasWorld(world, data, new Set()).laneNodes.length, 0);
});
