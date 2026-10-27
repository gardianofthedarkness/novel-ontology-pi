import { test } from "node:test";
import assert from "node:assert/strict";
import { placePathLabel, placeTreeLayout, type StoryPlace, type TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";
import { atlasArrangement, atlasNodeId, pinNodeId } from "../apps/playground/src/data/orbitalTimePlace.js";

// Invented: a city with two districts; a hospital and a station square in one of them.
const place = (id: string, label: string, sceneIds: string[], parentId: string | null, path: string[], totalScenes = sceneIds.length): StoryPlace =>
  ({ id, label, sceneIds, statedScenes: sceneIds.length, characterIds: [], proposed: false, parentId, parentProposed: id === "east", depth: path.length - 1, path, totalScenes });
const places = [
  place("city", "City", ["s0"], null, ["city"], 5),
  place("west", "West Ward", [], "city", ["city", "west"], 3),
  place("east", "East Ward", ["s4"], "city", ["city", "east"], 1),
  place("hospital", "Hospital", ["s1", "s2"], "west", ["city", "west", "hospital"]),
  place("square", "Station Square", ["s3"], "west", ["city", "west", "square"]),
  place("harbour", "Harbour", ["s5"], null, ["harbour"]),
];

test("the place tree lays out as nested circles: children inside their region, siblings apart", () => {
  const layout = placeTreeLayout(places, [{ from: "hospital", to: "square", count: 2 }, { from: "hospital", to: "harbour", count: 1 }], 600);
  assert.equal(layout.size, places.length);
  const within = (child: string, parent: string) => { const a = layout.get(child)!, b = layout.get(parent)!; return Math.hypot(a.x - b.x, a.y - b.y) + a.r <= b.r + 1; };
  for (const entry of places) if (entry.parentId) assert.ok(within(entry.id, entry.parentId), `${entry.id} lies inside ${entry.parentId}`);
  const [hospital, square] = [layout.get("hospital")!, layout.get("square")!];
  assert.ok(Math.hypot(hospital.x - square.x, hospital.y - square.y) >= hospital.r + square.r, "siblings do not overlap");
  assert.ok(Math.hypot(layout.get("city")!.x - layout.get("harbour")!.x, layout.get("city")!.y - layout.get("harbour")!.y) >= layout.get("city")!.r + layout.get("harbour")!.r, "roots do not overlap");
  assert.deepEqual(["city", "west", "east", "hospital", "harbour"].map((id) => layout.get(id)!.region), [true, true, false, false, false]);
  assert.deepEqual([layout.get("hospital")!.depth, layout.get("city")!.depth], [2, 0]);
  const city = layout.get("city")!;
  assert.ok(city.spotY < city.y && city.spotY > city.y - city.r, "a region's own scenes gather inside its upper rim");
  for (const point of layout.values()) assert.ok(point.x - point.r >= -1 && point.x + point.r <= 601 && point.y - point.r >= -1 && point.y + point.r <= 601, "fits the canvas");
  // Without parents every place is a separate top-level circle.
  const flat = placeTreeLayout(places.map((entry) => ({ ...entry, parentId: null, path: [entry.id] })), [], 600);
  assert.ok([...flat.values()].every((point) => !point.region));
});

test("paths read root first, and orbital Places nests the floor and frames a region's columns", () => {
  assert.equal(placePathLabel(places[3], { city: "City", west: "West Ward" }), "City › West Ward › Hospital");
  const data: TimePlaceProjection = {
    available: true, times: [], places, characters: [], names: { city: "City", west: "West Ward", east: "East Ward", hospital: "Hospital", square: "Station Square", harbour: "Harbour" },
    scenes: ["s0", "s1", "s2", "s3", "s4", "s5"].map((id, index) => ({ id, index, chapterIndex: 0, label: id, times: [], flashback: false, placeIds: [places.find((entry) => entry.sceneIds.includes(id))!.id], placeCarried: false, characterIds: [] })),
  };
  const arrangement = atlasArrangement(data, { periods: null });
  const marks = new Map(arrangement.floor!.map((mark) => [mark.id, mark]));
  assert.deepEqual([marks.get("city")!.region, marks.get("hospital")!.region, marks.get("east")!.proposed], [true, false, true]);
  assert.ok(arrangement.floor!.findIndex((mark) => mark.id === "city") < arrangement.floor!.findIndex((mark) => mark.id === "hospital"), "outer discs are drawn first");
  const draws = [...arrangement.anchors!].map(([id, position]) => ({ node: { id, label: id, viewKind: "Scene", kind: "scene", state: "canon", parent: null, lane: "canon", chrono: 0, summary: "", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }, position: position.map((value: number) => value * 3), radius: 10, role: "main" }));
  const framed = arrangement.focusFor!(pinNodeId("west"), draws as never)!;
  assert.equal(framed.length, 3 + 1, "the West Ward frames the hospital's and the square's columns, down to the map");
  assert.ok(arrangement.anchors!.has(atlasNodeId("s0")), "a scene naming only the region still rises from it");
});
