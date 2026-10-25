import { test } from "node:test";
import assert from "node:assert/strict";
import { orbitalLevel, volumeScope, type OrbitalWorld } from "../apps/playground/src/data/orbitalModel.js";
import { helixPoint, layoutOrbitalLevel, layoutParentBackdrop } from "../apps/playground/src/data/orbitalLayout.js";
import type { WorldNode } from "../apps/playground/src/types.js";

const record = (id: string, kind: WorldNode["kind"], chrono = 0, extra: Partial<WorldNode> = {}): WorldNode => ({ id, kind, label: id, chrono, state: "canon", lane: "canon", parent: "chapter", lanePos: [0, 0, 0], interiorPos: [0, 0, 0], ...extra });
const scenes = (count: number) => Array.from({ length: count }, (_, index) => ({ ...record(`scene-${index}`, "scene", index), summary: `摘要 ${index}` }));
const distance = (first: number[], second: number[]) => Math.hypot(...first.map((value, axis) => value - second[axis]));

test("the parent level recoils behind the entered world: the entered ghost encloses it, siblings follow the helix", () => {
  const world: OrbitalWorld = { laneNodes: [record("chapter", "bigEvent", 0, { parent: null as unknown as string })], laneEdges: [], interiors: { chapter: { nodes: scenes(100), edges: [] } } };
  const chapterScope = { key: "orbital:chapter:chapter", label: "Chapter", kind: "chapter" as const, chapterId: "chapter" };
  const parentLevel = orbitalLevel(world, chapterScope);
  const parentDraws = layoutOrbitalLevel(parentLevel, []).draws;
  const entered = parentLevel.main[7];
  const childDraws = layoutOrbitalLevel(orbitalLevel(world, entered.scope!), []).draws;
  const { ghosts, path } = layoutParentBackdrop(parentDraws, entered.node.id, childDraws);
  assert.equal(ghosts.length, parentLevel.main.length);
  const current = ghosts.find((ghost) => ghost.current)!;
  assert.equal(current.id, entered.node.id);
  const center = [0, 1, 2].map((axis) => childDraws.reduce((sum, draw) => sum + draw.position[axis], 0) / childDraws.length);
  assert.ok(distance(current.position, center) < 1e-6, "the entered sphere's ghost is centred on the current world");
  assert.ok(childDraws.every((draw) => distance(draw.position, current.position) + draw.radius < current.radius), "it encloses every current sphere");
  const others = ghosts.filter((ghost) => !ghost.current);
  assert.ok(new Set(others.map((ghost) => Math.round(ghost.position[2]))).size > 3, "siblings are coiled, not on the straight spine");
  const before = others.filter((ghost) => parentLevel.main.findIndex((entry) => entry.node.id === ghost.id) < 7);
  assert.ok(before.every((ghost) => ghost.position[0] < current.position[0]), "chronology still runs along +x");
  assert.equal(path.length, 121);
  const childIds = new Set(childDraws.map((draw) => draw.node.id));
  assert.ok(ghosts.every((ghost) => !childIds.has(ghost.id) || ghost.current === false), "ghosts are separate from foreground draws");
});

test("recoiling uses the preview helix form, so parallel tracks keep their offset", () => {
  const nodes = [...scenes(3).map((node) => ({ ...node, trackId: "a" })), ...scenes(3).map((node) => ({ ...node, id: `${node.id}-b`, trackId: "b" }))];
  const world: OrbitalWorld = { laneNodes: [record("chapter", "bigEvent", 0, { parent: null as unknown as string })], laneEdges: [], interiors: { chapter: { nodes, edges: [] } } };
  const level = orbitalLevel(world, { key: "c", label: "C", kind: "chapter", chapterId: "chapter" });
  const draws = layoutOrbitalLevel(level, []).draws;
  const { ghosts } = layoutParentBackdrop(draws, "scene-1", [{ ...draws[0], position: [0, 0, 0], radius: 100 }]);
  const a = ghosts.find((ghost) => ghost.id === "scene-2")!, b = ghosts.find((ghost) => ghost.id === "scene-2-b")!;
  assert.notDeepEqual(a.position, b.position);
  assert.ok(Math.abs(a.position[0] - b.position[0]) < 1e-6, "equal chronology aligns across tracks");
  assert.equal(helixPoint(0.5, 0, 1, 10)[0], 0);
});

test("no backdrop at the top level or without the entered entry", () => {
  const world: OrbitalWorld = { laneNodes: [record("chapter", "bigEvent")], laneEdges: [], interiors: {} };
  const draws = layoutOrbitalLevel(orbitalLevel(world, volumeScope), []).draws;
  assert.deepEqual(layoutParentBackdrop(draws, "missing", draws), { ghosts: [], path: [] });
});
