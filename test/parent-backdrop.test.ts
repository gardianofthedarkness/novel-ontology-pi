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

test("entry framing centres the entered sphere with its neighbours; without one it frames the whole timeline", async () => {
  const { entryFrame } = await import("../apps/playground/src/data/orbitalLayout.js");
  const world: OrbitalWorld = { laneNodes: [record("chapter", "bigEvent", 0, { parent: null as unknown as string })], laneEdges: [], interiors: { chapter: { nodes: scenes(12), edges: [] } } };
  const draws = layoutOrbitalLevel(orbitalLevel(world, { key: "c", label: "C", kind: "chapter", chapterId: "chapter" }), []).draws;
  const framed = entryFrame(draws, "scene-6");
  assert.equal(framed.length, 5);
  const xs = framed.map((point) => point[0]);
  const entered = draws.find((draw) => draw.node.id === "scene-6")!.position[0];
  assert.ok(Math.min(...xs) < entered && Math.max(...xs) > entered, "neighbours on both sides");
  assert.equal(entryFrame(draws, "scene-0").length, 5, "clamped at the start of the spine");
  assert.equal(entryFrame(draws, null).length, 12, "Back or first load frames every timeline sphere");
  assert.ok(!entryFrame(draws, null).some((point) => draws.find((draw) => draw.role === "nebula" && draw.position === point)), "nebula never widens the frame");
});

test("the first view after entering stays inside the enclosing parent ghost", async () => {
  const { keepInside } = await import("../apps/playground/src/data/cameraFraming.js");
  const sphere = { center: [0, 0, 0] as [number, number, number], radius: 7500 };
  const far = keepInside([0, 1500, 9000], [0, 0, 0], sphere);
  assert.ok(Math.hypot(...far) <= 7500 * 0.8 + 1e-6, "pulled inside along the same view ray");
  assert.ok(Math.abs(far[1] / far[2] - 1500 / 9000) < 1e-9, "viewing direction is preserved");
  assert.deepEqual(keepInside([0, 0, 2000], [0, 0, 0], sphere), [0, 0, 2000], "already inside: unchanged");
  const nearEdge = keepInside([5500, 0, 9000], [5500, 0, 0], sphere);
  assert.ok(Math.hypot(...nearEdge) <= 7500 * 0.8 + 1e-6 || nearEdge[2] === 300, "a target near the ghost's edge still gets an inside (or minimum-distance) view");
  const outside = keepInside([9000, 0, 50000], [9000, 0, 0], sphere);
  assert.ok(Math.abs(Math.hypot(...outside.map((value, axis) => value - [9000, 0, 0][axis])) - 7500 * 0.8) < 1e-6, "a target outside the ghost still gets a capped distance");
});
