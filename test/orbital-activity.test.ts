import test from "node:test";
import assert from "node:assert/strict";
import { copyOrbitalBookmark, orbitalActivityBatchPath, orbitalActivityPath, orbitalTouchAncestors } from "../apps/playground/src/data/orbitalActivity.js";
import { orbitalLevel, progressiveNebula, volumeScope, type OrbitalWorld } from "../apps/playground/src/data/orbitalModel.js";
import { layoutOrbitalLevel } from "../apps/playground/src/data/orbitalLayout.js";
import type { WorldNode, WorldEdge } from "../apps/playground/src/types.js";

const node = (id: string, kind: WorldNode["kind"], chrono = 0): WorldNode => ({ id, kind, chrono, parent: "chapter", label: id, lane: "canon", state: "proposed", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const edge = (from: string, to: string): WorldEdge => ({ id: `${from}:${to}`, from, to, kind: "contains", state: "proposed", parent: "chapter" });
const world = (nodes: WorldNode[], edges: WorldEdge[] = []): OrbitalWorld => ({ laneNodes: [node("chapter", "bigEvent")], laneEdges: [], interiors: { chapter: { nodes, edges } } });

test("activity follows a ghost through nested scene groups to a terminal scene without flattening chronology", () => {
  const scenes = Array.from({ length: 430 }, (_, index) => node(`scene-${index}`, "scene", index));
  const records = Array.from({ length: 80 }, (_, index) => node(`dialogue-${index}`, "dialogue", index));
  const input = world([...scenes, ...records], records.map(record => edge("scene-227", record.id)));
  const before = structuredClone(input);
  const route = orbitalActivityPath(input, "dialogue-43", "chapter");
  assert.equal(route.targetId, "dialogue-43");
  assert.deepEqual(route.path.slice(0, 2).map(scope => scope.kind), ["volume", "chapter"]);
  assert.ok(route.path.some(scope => scope.kind === "scenes"));
  assert.ok(route.path.some(scope => scope.kind === "scene" && scope.sceneId === "scene-227"));
  assert.equal(route.path.at(-1)?.kind, "scene");
  assert.ok(route.path.every(scope => ["volume", "chapter", "scenes", "scene"].includes(scope.kind)));
  for (const scope of route.path.slice(1)) {
    const level = orbitalLevel(input, scope);
    assert.ok(scope.kind === "scene" || level.main.length <= 20);
    assert.deepEqual(level.main.map(entry => entry.node.chrono), level.main.map(entry => entry.node.chrono).sort((first, second) => first - second));
  }
  const local = orbitalLevel(input, route.path.at(-1));
  assert.equal(local.main.length, 80);
  assert.ok(local.main.every(entry => !entry.scope && !entry.node.cluster));
  assert.ok(local.main.some(entry => entry.node.id === "dialogue-43"));
  assert.ok(layoutOrbitalLevel(local, []).paths.length > 0);
  assert.deepEqual(input, before);
});

test("parallel dialogue ghosts remain in the orbital hierarchy before their scene arrives and keep their ID afterward", () => {
  const dialogue = node("draft:b0001:dialogue:b0000_s0001", "dialogue");
  const initial = world([dialogue]);
  const pending = orbitalActivityPath(initial, dialogue.id, "chapter");
  assert.equal(pending.targetId, dialogue.id);
  assert.equal(pending.path.at(-1)?.kind, "chapter");
  const scene = node("draft:b0001:scene:b0000_s0000", "scene");
  const updated = world([scene, dialogue], [edge(scene.id, dialogue.id)]);
  const linked = orbitalActivityPath(updated, dialogue.id, "chapter");
  assert.equal(linked.targetId, dialogue.id);
  assert.equal(linked.path.at(-1)?.sceneId, scene.id);
  assert.equal(updated.interiors.chapter.nodes.filter(record => record.id === dialogue.id).length, 1);
});

test("new characters stay weighted nebula in the current orbital level; containing scenes highlight at upper layers", () => {
  const input = world([node("scene", "scene"), node("character", "character"), node("event", "event")], [edge("scene", "event"), edge("character", "scene")]);
  const scenePath = orbitalActivityPath(input, "event", "chapter").path;
  const route = orbitalActivityPath(input, "character", "chapter", [], [], scenePath);
  assert.deepEqual(route.path, scenePath);
  const level = orbitalLevel(input, route.path.at(-1));
  assert.ok(progressiveNebula(level, route.path.length, "character").nodes.some(record => record.id === "character"));
  const ancestors = orbitalTouchAncestors(input.interiors.chapter.nodes, input.interiors.chapter.edges, "event");
  assert.ok(ancestors.has("scene"));
  assert.ok(!ancestors.has("character"));
  assert.equal(orbitalActivityPath(input, "removed", "chapter").targetId, null);
});

test("activity falls back to the real scene when a legacy dialogue event is intentionally replaced by exchange cards", () => {
  const scene = node("scene", "scene");
  const legacy = node("legacy-dialogue", "dialogue");
  const card = { ...node("card", "dialogue"), dialogue: { cardId: "exchange", participantIds: [], participantLabels: [] } };
  const input = world([scene, legacy, card], [edge(scene.id, legacy.id), edge(scene.id, card.id)]);
  const route = orbitalActivityPath(input, legacy.id, "chapter");
  assert.equal(route.targetId, scene.id);
  assert.equal(route.path.at(-1)?.kind, "chapter");
  assert.ok(orbitalLevel(input, route.path.at(-1)).main.some(entry => entry.node.id === route.targetId));
});

test("reading bookmarks preserve independent level, selection, camera, zoom and focal offset snapshots", () => {
  const bookmark = copyOrbitalBookmark({ path: [{ key: "group", label: "原文", kind: "scenes", ids: ["a", "b"] }], selectedId: "a", revealedId: "b", camera: { position: [11, 22, 33], target: [1, 2, 3], up: [0, 1, 0], zoom: 1.7, focalOffset: [2, 3, 0] } });
  const copy = copyOrbitalBookmark(bookmark);
  copy.path[0].ids!.push("new-ghost");
  copy.camera!.position[0] = 999;
  assert.deepEqual(bookmark.path[0].ids, ["a", "b"]);
  assert.deepEqual(bookmark.camera?.position, [11, 22, 33]);
  assert.equal(bookmark.selectedId, "a");
  assert.equal(bookmark.revealedId, "b");
  assert.equal(bookmark.camera?.zoom, 1.7);
  assert.deepEqual(bookmark.camera?.focalOffset, [2, 3, 0]);
});

test("activity preserves directly visible scene edits but descends for hidden event and dialogue edits", () => {
  const input = world([node("scene-a", "scene"), node("scene-b", "scene", 1), node("event", "event"), node("dialogue", "dialogue")], [edge("scene-a", "event"), edge("scene-b", "dialogue")]);
  const preferred = [volumeScope, orbitalActivityPath(input, "scene-a", "chapter").path[1]];
  const before = structuredClone(preferred);
  for (const id of ["scene-a", "scene-b"]) {
    const route = orbitalActivityPath(input, id, "chapter", [], [], preferred);
    assert.deepEqual(route.path, preferred);
    assert.equal(route.targetId, id);
  }
  for (const [id, sceneId] of [["event", "scene-a"], ["dialogue", "scene-b"]]) {
    const route = orbitalActivityPath(input, id, "chapter", [], [], preferred);
    assert.equal(route.path.at(-1)?.sceneId, sceneId);
    assert.equal(route.targetId, id);
  }
  assert.deepEqual(preferred, before);
});

test("a batch chooses the lowest shared scene group and ascends when touches span groups", () => {
  const scenes = Array.from({ length: 430 }, (_, index) => node(`scene-${index}`, "scene", index));
  const records = [node("a", "event"), node("b", "dialogue"), node("c", "event")];
  const input = world([...scenes, ...records], [edge("scene-227", "a"), edge("scene-228", "b"), edge("scene-0", "c")]);
  const scenePath = orbitalActivityPath(input, "a", "chapter").path;
  const common = orbitalActivityBatchPath(input, ["a", "b"], "chapter");
  assert.equal(common.path.at(-1)?.kind, "scenes");
  assert.deepEqual(common.path, scenePath.slice(0, -1));
  assert.equal(common.targetId, "scene-228");
  assert.deepEqual(orbitalActivityBatchPath(input, ["a", "b"], "chapter", [], [], scenePath.slice(0, 2)), common);
  assert.deepEqual(orbitalActivityBatchPath(input, ["a", "b"], "chapter", [], [], common.path), common);
  const wide = orbitalActivityBatchPath(input, ["a", "b", "c"], "chapter", [], [], scenePath);
  assert.equal(wide.path.at(-1)?.kind, "chapter");
  assert.ok(orbitalLevel(input, wide.path.at(-1)).main.some(entry => entry.node.id === wide.targetId && entry.members.includes("scene-0")));
});

test("a batch in one scene descends from an overview and stays stable for subsequent record edits", () => {
  const input = world([node("scene", "scene"), node("event", "event"), node("dialogue", "dialogue"), node("person", "character")], [edge("scene", "event"), edge("event", "dialogue")]);
  const route = orbitalActivityBatchPath(input, ["event", "dialogue"], "chapter");
  assert.equal(route.path.at(-1)?.sceneId, "scene");
  assert.equal(route.targetId, "dialogue");
  const preferred = route.path.slice(0, -1);
  assert.deepEqual(orbitalActivityBatchPath(input, ["event", "dialogue"], "chapter", [], [], preferred), route);
  for (const ids of [["event"], ["dialogue"], ["dialogue", "event"]]) {
    assert.deepEqual(orbitalActivityBatchPath(input, ids, "chapter", [], [], route.path), { path: route.path, targetId: ids.at(-1) });
  }
  const mixed = orbitalActivityBatchPath(input, ["event", "person"], "chapter", [], [], route.path);
  assert.deepEqual(mixed.path, route.path);
  assert.equal(mixed.targetId, "person");
  assert.deepEqual(orbitalActivityPath(input, "scene", "chapter", [], [], route.path), { path: preferred, targetId: "scene" });
});

test("touching another scene's records routes to that terminal scene instead of retaining an ancestor proxy", () => {
  const input = world([node("scene-a", "scene"), node("scene-b", "scene", 1), node("a", "event"), node("b", "event")], [edge("scene-a", "a"), edge("scene-b", "b")]);
  const initial = orbitalActivityPath(input, "a", "chapter");
  const next = orbitalActivityPath(input, "b", "chapter", [], [], initial.path);
  assert.equal(next.path.at(-1)?.sceneId, "scene-b");
  assert.equal(next.targetId, "b");
  assert.deepEqual(orbitalActivityPath(input, "a", "chapter", [], [], next.path), initial);
});

test("multi-chapter batches choose volume and highlight the latest touched chapter", () => {
  const input = world([node("scene-a", "scene"), node("a", "event")], [edge("scene-a", "a")]);
  input.laneNodes.push({ ...node("other", "bigEvent"), parent: null });
  input.interiors.other = { nodes: [{ ...node("scene-b", "scene"), parent: "other" }, { ...node("b", "event"), parent: "other" }], edges: [{ ...edge("scene-b", "b"), parent: "other" }] };
  const before = structuredClone(input);
  const preferred = orbitalActivityPath(input, "a", "chapter").path;
  const route = orbitalActivityBatchPath(input, ["a", "b"], "chapter", [], [], preferred);
  assert.deepEqual(route, { path: [volumeScope], targetId: "other" });
  assert.deepEqual(input, before);
  assert.deepEqual(orbitalActivityBatchPath(input, ["chapter", "b"], "chapter").path, [volumeScope]);
});

test("shared nebula IDs use the requested chapter rather than another interior's copy", () => {
  const input = world([node("scene", "scene"), node("event", "event"), node("person", "character")], [edge("scene", "event")]);
  input.laneNodes.push({ ...node("other", "bigEvent"), parent: null });
  input.interiors.other = { nodes: [{ ...node("person", "character"), parent: "other" }], edges: [] };
  const preferred = orbitalActivityPath(input, "event", "chapter").path;
  assert.deepEqual(orbitalActivityBatchPath(input, ["event", "person"], "chapter", [], [], preferred), { path: preferred, targetId: "person" });
});

test("a stale preferred group's ancestor proxy does not retain hidden record edits", () => {
  const scenes = Array.from({ length: 430 }, (_, index) => node(`scene-${index}`, "scene", index));
  const input = world([...scenes, node("event", "event")], [edge("scene-227", "event")]);
  const preferred = orbitalActivityPath(input, "event", "chapter").path.slice(0, -1).map(scope => ({ ...scope, ...(scope.ids ? { ids: scope.ids.filter(id => id !== "scene-227") } : {}) }));
  const before = structuredClone(preferred);
  const route = orbitalActivityPath(input, "event", "chapter", [], [], preferred);
  assert.equal(route.path.at(-1)?.sceneId, "scene-227");
  assert.equal(route.targetId, "event");
  assert.deepEqual(preferred, before);
});

test("batch routing tolerates missing IDs, empty refreshes and an activity-only chapter interior", () => {
  const input = world([node("scene", "scene"), node("event", "event")], [edge("scene", "event")]);
  const preferred = orbitalActivityPath(input, "event", "chapter").path;
  for (const ids of [[], ["removed"]]) assert.deepEqual(orbitalActivityBatchPath(input, ids, "chapter", [], [], preferred), { path: preferred, targetId: null });
  assert.deepEqual(orbitalActivityBatchPath(input, ["removed", "event", "removed"], "chapter").path, preferred);
  const empty: OrbitalWorld = { laneNodes: input.laneNodes, laneEdges: [], interiors: {} };
  assert.deepEqual(orbitalActivityPath(empty, "event", "chapter", input.interiors.chapter.nodes, input.interiors.chapter.edges).path, preferred);
  assert.deepEqual(orbitalActivityBatchPath(empty, [], "missing"), { path: [volumeScope], targetId: null });
});

test("ancestry ignores synthetic relations and terminates on containment cycles", () => {
  const nodes = [node("scene", "scene"), node("event", "event"), node("card", "dialogue"), node("unrelated", "scene")];
  const edges = [edge("scene", "event"), edge("event", "card"), edge("card", "event"), { ...edge("unrelated", "card"), id: "view-membership" }, { ...edge("unrelated", "event"), id: "chapter:narrative-order:1" }];
  assert.deepEqual(orbitalTouchAncestors(nodes, edges, "card"), new Set(["card", "event", "scene"]));
  assert.equal(orbitalActivityPath(world(nodes, edges), "card", "chapter").path.at(-1)?.sceneId, "scene");
});
