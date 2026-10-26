import { test } from "node:test";
import assert from "node:assert/strict";
import { locateRecord, narrativeChapters } from "../apps/playground/src/data/narrative.js";
import type { WorldEdge, WorldNode } from "../apps/playground/src/types.js";

const node = (id: string, kind: WorldNode["kind"], parent: string | null, chrono: number, extra: Partial<WorldNode> = {}): WorldNode =>
  ({ id, label: id, kind, parent, chrono, lane: "canon", state: "canon", lanePos: [0, 0, 0], interiorPos: [0, 0, 0], ...extra });
const edge = (from: string, to: string, kind: WorldEdge["kind"], parent: string, relationLabel?: string, relationType?: string): WorldEdge =>
  ({ id: `${parent}:${relationLabel ?? relationType ?? kind}:${from}:${to}`, from, to, kind, state: "canon", parent, relationLabel, relationType });

// Invented two-chapter world: Ming walks to the station, then meets Hong.
const world = {
  laneNodes: [node("ch_b", "bigEvent", null, 2), node("ch_a", "bigEvent", null, 1)],
  bigEventLabels: { ch_a: "Chapter A", ch_b: "Chapter B" },
  interiors: {
    ch_a: {
      nodes: [
        node("sc_2", "scene", "ch_a", 2, { summary: "Ming reaches the station" }),
        node("sc_1", "scene", "ch_a", 1, { summary: "Ming leaves home" }),
        node("ev_2", "event", "ch_a", 2), node("ev_1", "event", "ch_a", 1), node("ev_3", "event", "ch_a", 3),
        node("ming", "character", "ch_a", 0), node("station", "location", "ch_a", 0),
      ],
      edges: [
        edge("sc_1", "ev_1", "contains", "ch_a", "Shared source coverage"),
        edge("sc_2", "ev_2", "contains", "ch_a", "Shared source coverage"),
        edge("ming", "sc_1", "contains", "ch_a", "Present in scene"),
        edge("ming", "sc_2", "contains", "ch_a", "Present in scene"),
        edge("sc_2", "station", "speaks", "ch_a", undefined, "LOCATED_AT"),
      ],
    },
    ch_b: { nodes: [node("sc_3", "scene", "ch_b", 1, { summary: "Ming meets Hong" })], edges: [] },
  },
};

test("chapters, scenes and records follow reading order, numbered across the book", () => {
  const chapters = narrativeChapters(world);
  assert.deepEqual(chapters.map((chapter) => chapter.title), ["Chapter A", "Chapter B"]);
  assert.deepEqual(chapters[0].scenes.map((scene) => [scene.node.id, scene.number]), [["sc_1", 1], ["sc_2", 2]]);
  assert.equal(chapters[1].scenes[0].number, 3);
  assert.deepEqual(chapters[0].scenes[1].locations.map((place) => place.id), ["station"]);
  assert.deepEqual(chapters[0].cast.map((entry) => [entry.node.id, entry.scenes]), [["ming", 2]]);
  assert.deepEqual(chapters[0].loose.map((record) => record.id), ["ev_3"], "a record no scene covers stays visible");
});

test("live proposals join their chapter with their state, and new characters show in the cast", () => {
  const ghost = node("ev_9", "event", "ch_b", 2, { state: "proposed" });
  const hong = node("hong", "character", "ch_b", 0, { state: "proposed" });
  const chapters = narrativeChapters(world, [ghost, hong], [edge("sc_3", "ev_9", "contains", "ch_b", "Shared source coverage")]);
  assert.deepEqual(chapters[1].scenes[0].records.map((record) => [record.id, record.state]), [["ev_9", "proposed"]]);
  assert.equal(chapters[1].counts.proposed, 2);
  assert.deepEqual(chapters[1].cast.map((entry) => entry.node.id), ["hong"]);
});

test("a record is located in its chapter and scene", () => {
  const chapters = narrativeChapters(world);
  assert.equal(locateRecord(chapters, "ev_2")?.scene?.node.id, "sc_2");
  assert.equal(locateRecord(chapters, "ch_b")?.scene, null);
  assert.equal(locateRecord(chapters, "ev_3")?.chapter.node.id, "ch_a");
  assert.equal(locateRecord(chapters, "missing"), null);
});
