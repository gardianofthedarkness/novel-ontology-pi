import { test } from "node:test";
import assert from "node:assert/strict";
import { orbitalLevel, volumeScope, type OrbitalScope, type OrbitalWorld } from "../apps/playground/src/data/orbitalModel.js";
import { orbitalLocation } from "../apps/playground/src/data/orbitalLocation.js";
import { acceptsSnapshot, bookQuery, libraryBooks, parseBookParam, viewedBook } from "../apps/playground/src/data/bookCatalog.js";
import type { WorldEdge, WorldNode } from "../apps/playground/src/types.js";

const record = (id: string, kind: WorldNode["kind"], chrono = 0, extra: Partial<WorldNode> = {}): WorldNode => ({ id, kind, label: id, chrono, state: "canon", lane: "canon", parent: "chapter_1", lanePos: [0, 0, 0], interiorPos: [0, 0, 0], ...extra });
const contains = (from: string, to: string): WorldEdge => ({ id: `${from}:${to}`, from, to, kind: "contains", state: "canon", parent: "chapter_1" });
const scenes = Array.from({ length: 30 }, (_, index) => record(`scene-${index}`, "scene", index, { summary: `摘要 ${index + 1}` }));
const event = record("event-a", "event", 14.5, { label: "当麻 meets 茵蒂克丝" });
const world: OrbitalWorld = {
  laneNodes: [record("chapter_1", "bigEvent", 1, { label: "Chapter 1 · 序章", parent: null })],
  laneEdges: [],
  interiors: { chapter_1: { nodes: [...scenes, event], edges: [contains("scene-14", "event-a")] } },
};
const book = { id: 2, title: "创约·魔法禁书目录2", sourceFile: "创约·魔禁 02.epub" };
const chapter: OrbitalScope = { key: "orbital:chapter:chapter_1", label: "Chapter 1", kind: "chapter", chapterId: "chapter_1" };

test("location path starts at the original book file and names the entered chapter", () => {
  const level = orbitalLevel(world, chapter);
  const crumbs = orbitalLocation(world, [volumeScope, chapter], level, book);
  assert.deepEqual(crumbs.map((crumb) => [crumb.kind, crumb.label, crumb.pathIndex]), [["book", "创约·魔禁 02.epub", 0], ["chapter", "Chapter 1 · 序章", 1]]);
  assert.equal(crumbs[0].detail, "创约·魔法禁书目录2");
  assert.ok(crumbs.every((crumb) => !crumb.selection), "an overview without a selection claims no scene");
});

test("entered scene groups show ordinal ranges and stored summaries", () => {
  const level = orbitalLevel(world, chapter);
  const group = level.main.find((entry) => entry.scope?.kind === "scenes")!;
  const crumbs = orbitalLocation(world, [volumeScope, chapter, group.scope!], orbitalLevel(world, group.scope!), book);
  const last = crumbs.at(-1)!;
  assert.equal(last.kind, "scenes");
  assert.match(last.label, /^Scenes \d+–\d+$/);
  assert.match(last.detail ?? "", /^摘要 \d+$/);
  assert.equal(last.pathIndex, 2);
});

test("a selected event identifies its owning scene, marked as a selection", () => {
  const level = orbitalLevel(world, chapter);
  const crumbs = orbitalLocation(world, [volumeScope, chapter], level, book, event);
  assert.deepEqual(crumbs.slice(2).map((crumb) => [crumb.kind, crumb.label, crumb.detail, crumb.selection]), [["scene", "Scene 15", "摘要 15", true], ["record", "Event", "当麻 meets 茵蒂克丝", true]]);
  const orphan = orbitalLocation(world, [volumeScope, chapter], level, book, record("event-b", "event", 3));
  assert.equal(orphan.at(-2)?.label, "Scene not recorded");
});

test("a selected group sphere is shown as a range, not as one exact scene", () => {
  const level = orbitalLevel(world, chapter);
  const group = level.main.find((entry) => entry.node.cluster)!;
  const crumb = orbitalLocation(world, [volumeScope, chapter], level, book, group.node).at(-1)!;
  assert.equal(crumb.kind, "scenes");
  assert.match(crumb.label, /^Scenes \d+–\d+$/);
});

test("book catalog falls back to IDs and never exposes paths", () => {
  assert.deepEqual(libraryBooks({ availableVolumes: [1, 2, 0] }), [{ id: 1, title: "Book 1", sourceFile: null }, { id: 2, title: "Book 2", sourceFile: null }]);
  assert.deepEqual(libraryBooks({ books: [{ id: 3, title: " ", sourceFile: "/Users/owner/x/fake 01.epub" }] }), [{ id: 3, title: "Book 3", sourceFile: "fake 01.epub" }]);
});

test("pinned reading book is kept unless the owner explicitly follows Pi", () => {
  assert.equal(viewedBook(1, false, 2), 1, "an active-book change does not replace the pin");
  assert.equal(viewedBook(1, true, 2), 2);
  assert.equal(viewedBook(1, true, null), 1);
  assert.equal(viewedBook(null, false, 2), null);
  assert.equal(bookQuery(2), "?volume=2");
  assert.equal(bookQuery(null), "");
  assert.equal(parseBookParam("?phone=1&book=12"), 12);
  assert.equal(parseBookParam("?book=../1"), null);
});

test("responses for another book are discarded", () => {
  assert.equal(acceptsSnapshot(2, { volume: 1 }), false);
  assert.equal(acceptsSnapshot(2, { volume: 2 }), true);
  assert.equal(acceptsSnapshot(null, { volume: 1 }), true);
});
