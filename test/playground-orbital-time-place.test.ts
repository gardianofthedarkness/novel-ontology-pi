import { test } from "node:test";
import assert from "node:assert/strict";
import { atlasArrangement, atlasNodeId, atlasScenes, atlasWorld, pinNodeId, readingOrderProjection, routeCausalArcs, spiralArrangement, spiralNodeId, spiralWorld } from "../apps/playground/src/data/orbitalTimePlace.js";
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

// Stored causes (invented): e1 → e3 across scenes; e1 → e1b inside s1.
const causalWorld = {
  ...world,
  interiors: { ...world.interiors, ch_1: { ...world.interiors.ch_1, nodes: [...world.interiors.ch_1.nodes, node("e1b", "event", "ch_1", 2)], edges: [...world.interiors.ch_1.edges, edge("s1", "e1b", "contains", "ch_1", "Shared source coverage")] } },
  causal: { unresolved: 0, links: [{ id: "c1", from: "e1", to: "e3", fromChapter: "ch_1", toChapter: "ch_2", state: "canon" as const }, { id: "c2", from: "e1", to: "e1b", fromChapter: "ch_1", toChapter: "ch_1", state: "canon" as const }] },
};

test("story time: every scene on one spiral in story order, the flashback first, causes carried", () => {
  const spiral = spiralWorld(causalWorld, data);
  assert.deepEqual(spiral.laneNodes.map((entry) => [entry.id, entry.chrono]), [[spiralNodeId("s2"), 0], [spiralNodeId("s1"), 1], [spiralNodeId("s3"), 2]], "story order, unplaced scenes included");
  assert.equal(spiral.laneNodes[0].viewKind, "↶ back then", "each scene names its period");
  assert.equal(spiral.causal?.links.length, 2);
  const arrangement = spiralArrangement(data, spiral);
  assert.deepEqual(arrangement.extraDraws!.map((draw) => [draw.node.id, draw.previewParentId]).sort(), [["e1", spiralNodeId("s1")], ["e1b", spiralNodeId("s1")], ["e3", spiralNodeId("s3")]], "bubbles hold the records causes join");
  assert.equal(arrangement.envelope, "shell");
  const level = orbitalLevel(spiral);
  const layout = layoutOrbitalLevel(level, [], { main: mainProminence(level), anchors: arrangement.anchors, radiusScale: arrangement.radiusScale });
  assert.ok(finite(layout.draws));
  const paths = arrangement.paths!(layout.draws, null);
  assert.deepEqual(paths.map((path) => path.tone ?? "time"), ["time", "thread"], "the story string and the flashback's thread to where it is told");
});

test("causal arcs bend outward and never share a lane over overlapping spans", () => {
  const draw = (id: string, chrono: number, position: [number, number, number], parent?: string, order?: number) => ({ node: node(id, "event", null, chrono), position, radius: 7, role: (parent ? "preview" : "main") as "preview" | "main", previewParentId: parent, order });
  const draws = [draw("a", 0, [0, 300, 0], "p", 0.2), draw("b", 1, [10, 300, 0], "p", 0.4), draw("c", 2, [0, 300, 10], "p", 0.6), draw("x", 5, [800, -300, 0], "q", 5.5)];
  const arrow = (id: string, from: string, to: string) => ({ id, from, to, links: [], projected: false, state: "canon" as const });
  const routed = new Map(routeCausalArcs([arrow("ab", "a", "b"), arrow("ac", "a", "c"), arrow("ax", "a", "x")], draws).map((entry) => [entry.id, entry.bend!]));
  const length = (vector: number[]) => Math.hypot(...vector);
  assert.ok(length(routed.get("ac")!) > length(routed.get("ab")!), "overlapping spans inside a scene take a higher lane");
  assert.ok(length(routed.get("ax")!) > 4 * length(routed.get("ac")!), "links between scenes arc far out past the spiral");
  assert.ok(routed.get("ab")![1] > 0, "a scene above the axis bends further up (outward)");
});

test("places (space-time): the map on the floor, placed scenes above their place rising in story order", () => {
  assert.deepEqual(atlasScenes(data, { periods: null }).map((scene) => scene.id), ["s1", "s3"], "story order; a scene with no place stays off the map");
  const regrouped = atlasWorld(world, data, { periods: null });
  assert.deepEqual(regrouped.laneNodes.map((entry) => entry.id), [atlasNodeId("s1"), atlasNodeId("s3")]);
  assert.ok(!regrouped.interiors[atlasNodeId("s1")].nodes.some((entry) => entry.id === "s1"), "inside the sphere are the scene's records");
  assert.ok(regrouped.interiors[atlasNodeId("s1")].nodes.some((entry) => entry.id === "e1"));
  const arrangement = atlasArrangement(data, { periods: null }, regrouped);
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

test("places (space-time): periods, the stretch seen in Story time, and record levels decide what floats", () => {
  const evening = { periods: new Set(["t_evening"]) };
  assert.deepEqual(atlasScenes(data, evening).map((scene) => scene.id), ["s1"]);
  assert.deepEqual(atlasWorld(world, data, evening).laneNodes.map((entry) => entry.id), [atlasNodeId("s1")]);
  assert.deepEqual(atlasArrangement(data, evening).floor!.map((mark) => [mark.id, mark.active]), [["station", true], ["school", false]], "places outside the window dim");
  assert.equal(atlasWorld(world, data, { periods: new Set() }).laneNodes.length, 0);
  assert.deepEqual(atlasScenes(data, { periods: null, sceneIds: new Set(["s3", "s2"]) }).map((scene) => scene.id), ["s3"], "only the scenes seen in Story time (and placed)");
  const withEvents = { periods: null, levels: { scene: true, event: true, dialogue: false } };
  const regrouped = atlasWorld(world, data, withEvents);
  const bubbles = atlasArrangement(data, withEvents, regrouped);
  assert.equal(bubbles.envelope, "shell", "scenes envelop their events");
  assert.deepEqual(bubbles.extraDraws!.filter((draw) => draw.role === "preview").map((draw) => [draw.node.id, draw.previewParentId]), [["e1", atlasNodeId("s1")], ["e3", atlasNodeId("s3")]]);
  const eventsOnly = atlasArrangement(data, { ...withEvents, levels: { scene: false, event: true, dialogue: false } }, regrouped);
  assert.equal(eventsOnly.envelope, "hidden");
  assert.ok(eventsOnly.extraDraws!.find((draw) => draw.node.id === "e1")!.radius > bubbles.extraDraws!.find((draw) => draw.node.id === "e1")!.radius, "records are larger when they are the subject");
});

test("before time-place runs, the spiral uses reading order and still carries the causes", () => {
  const order = readingOrderProjection(causalWorld);
  assert.equal(order.available, false);
  assert.deepEqual(order.scenes.map((scene) => [scene.id, scene.index, scene.chapterIndex]), [["s1", 0, 0], ["s2", 1, 0], ["s3", 2, 1]]);
  const spiral = spiralWorld(causalWorld, order);
  assert.equal(spiral.laneNodes[0].viewKind, "Chapter 0 · reading order");
  assert.equal(spiralArrangement(order, spiral).timeKey.label, "READING ORDER →");
  assert.equal(spiralArrangement(order, spiral).extraDraws!.length, 3, "causal endpoints still sit in their bubbles");
});
