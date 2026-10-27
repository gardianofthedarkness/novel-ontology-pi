import { test } from "node:test";
import assert from "node:assert/strict";
import { universeIds, universeStoryRows, type TimePlaceProjection, type StoryScene, type StoryTime } from "../apps/playground/src/data/timePlace.js";
import { bookNodeId, spiralArrangement, spiralNodeId } from "../apps/playground/src/data/orbitalTimePlace.js";

// Invented universe: two books in the main line, one in an alternate line.
const scene = (book: number, id: string, index: number, continuityId: string, time: string | null): StoryScene => ({ id: `${book}:${id}`, index, chapterIndex: 0, label: id, times: time ? [{ id: `${book}:${time}`, via: "anchor" }] : [], flashback: false, placeIds: [], placeCarried: false, characterIds: [], book, continuityId });
const time = (book: number, id: string, storyIndex: number, continuityId: string, sceneIds: string[]): StoryTime => ({ id: `${book}:${id}`, label: id, gloss: id, family: "time-of-day", role: "ADVANCE", flashback: false, flashbackProbability: 0, decidedBy: "jev", toldFromId: null, date: null, partOfDay: null, chapterIndex: 0, storyIndex, narrativeIndex: storyIndex, anchorSceneId: sceneIds[0], sceneIds, book, continuityId });
const data: TimePlaceProjection = {
  scope: "universe", universe: { id: "star", title: "Star" }, available: true,
  continuities: [{ id: "main", title: "Main" }, { id: "alt", title: "Alt" }],
  books: [{ volume: 2, sourceId: "b", title: "Two", continuityId: "main", readingOrder: 2 }, { volume: 1, sourceId: "a", title: "One", continuityId: "main", readingOrder: 1 }, { volume: 3, sourceId: "c", title: "Side", continuityId: "alt", readingOrder: 1 }],
  scenes: [scene(1, "s0", 0, "main", null), scene(1, "s1", 1, "main", "dusk"), scene(2, "s1", 2, "main", "dawn"), scene(3, "s1", 3, "alt", "rain")],
  times: [time(1, "dusk", 0, "main", ["1:s1"]), time(2, "dawn", 1, "main", ["2:s1"]), time(3, "rain", 0, "alt", ["3:s1"])],
  places: [{ id: "u:a::east", label: "East", sceneIds: [], statedScenes: 0, characterIds: [], members: ["1:east", "2:east2"] }],
  characters: [], names: {},
};

test("universe story rows: continuities in turn, books in reading order, each book's untimed scenes before its periods", () => {
  const rows = universeStoryRows(data);
  assert.deepEqual(rows.map((row) => [row.continuityId, row.book, row.time?.id ?? "untimed"]), [["main", 1, "untimed"], ["main", 1, "1:dusk"], ["main", 2, "2:dawn"], ["alt", 3, "3:rain"]]);
});

test("universe spirals: one per continuity, a marker where each book starts, and a frame for the reader's book", () => {
  const arrangement = spiralArrangement(data, undefined, 2);
  const z = (id: string) => arrangement.anchors!.get(spiralNodeId(id))![2];
  assert.ok(Math.abs(z("3:s1") - z("2:s1")) > 2 * 260, "the alternate continuity runs on its own spiral, beside the main one");
  assert.ok(Math.abs(z("1:s1") - z("2:s1")) <= 2 * 260, "books of one continuity share a spiral");
  assert.deepEqual(arrangement.extraDraws!.filter((draw) => draw.node.viewKind === "Book").map((draw) => draw.node.id).sort(), [bookNodeId(1), bookNodeId(2), bookNodeId(3)]);
  const draws = [...arrangement.anchors!].map(([id, position]) => ({ node: { id, label: id, kind: "bigEvent", state: "canon", parent: null, lane: "canon", chrono: 0, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }, position: position.map((value) => value * 3) as [number, number, number], radius: 10, role: "main" as const }));
  assert.equal(arrangement.bookFrame!(draws as never)!.length, 1, "book 2's one scene");
  assert.equal(arrangement.bookKey, "story:2");
  assert.ok(arrangement.renderDistance! > 0, "a universe gets a render distance");
  assert.equal(spiralArrangement({ ...data, scope: undefined, books: undefined, continuities: undefined }, undefined, 2).renderDistance, undefined, "a single book does not");
});

test("one book's ids map into the universe projection", () => {
  const ids = universeIds(data, 2);
  assert.deepEqual([ids.scene("s1"), ids.time("dawn"), ids.place("east2"), ids.place("unknown")], ["2:s1", "2:dawn", "u:a::east", "unknown"]);
  assert.equal(universeIds({ ...data, scope: "book" }, 2).scene("s1"), "s1");
});
