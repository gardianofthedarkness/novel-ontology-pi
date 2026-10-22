import { test } from "node:test";
import assert from "node:assert/strict";
import { projectSceneGraph, expandSceneGraph, revealSceneNode, SCENE_PAGE_SIZE, sceneIndex, scopeForNode, type SceneScope } from "../apps/playground/src/data/sceneHierarchy.js";
import { arrangeSceneExpansion } from "../apps/playground/src/data/sceneExpansionLayout.js";
import { arrangeTimeline } from "../apps/playground/src/data/timelineLayout.js";
import type { WorldEdge, WorldNode } from "../apps/playground/src/types.js";

const record = (id: string, kind: WorldNode["kind"], chrono: number): WorldNode => ({ id, label: id, kind, chrono, parent: "chapter", lane: "canon", state: "canon", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const link = (from: string, to: string): WorldEdge => ({ id: `${from}:${to}`, from, to, kind: "contains", state: "canon", parent: "chapter" });
const scenes = (count: number) => Array.from({ length: count }, (_, position) => record(`scene-${position}`, "scene", position));

test("two hundred scenes condense to twenty chronological ranges without deleting data", () => {
  const nodes = scenes(200);
  const before = structuredClone(nodes);
  const view = projectSceneGraph(nodes, []);
  assert.equal(view.nodes.length, 20);
  assert.equal(view.totalScenes, 200);
  assert.deepEqual(view.nodes.flatMap((node) => node.cluster!.ids), nodes.map((node) => node.id));
  assert.equal(view.nodes[0].label, "Scenes 1–10");
  assert.equal(view.nodes[19].label, "Scenes 191–200");
  assert.ok(view.nodes.every((node) => node.cluster?.recordCount === 10));
  assert.deepEqual(nodes, before);
  assert.deepEqual(projectSceneGraph([...nodes].reverse(), []), view);
});

test("hierarchy recursively adds levels for large datasets, not a fixed overview/detail pair", () => {
  const nodes = scenes(20000);
  let scope: SceneScope | undefined;
  let depth = 0;
  while (true) {
    const view = projectSceneGraph(nodes, [], scope);
    assert.ok(view.nodes.length <= 20);
    const first = view.nodes[0];
    if (!first.cluster) { assert.equal(first.id, "scene-0"); break; }
    scope = scopeForNode(first, scope)!;
    depth++;
    assert.ok(depth < 8);
  }
  assert.equal(depth, 3);
});

test("all scene neighbors, isolated records and ghosts remain reachable with bounded expansion", () => {
  const nodes = [...scenes(23), ...Array.from({ length: 57 }, (_, position) => record(`event-${position}`, "event", position)), record("isolated", "character", 9), { ...record("ghost", "character", 1), state: "proposed" as const }];
  const edges = nodes.filter((node) => node.kind === "event" || node.id === "ghost").map((node) => link("scene-0", node.id));
  const seen = new Set<string>();
  const visit = (scope?: SceneScope, depth = 0) => {
    assert.ok(depth < 10);
    const view = projectSceneGraph(nodes, edges, scope, 6);
    assert.ok(view.nodes.filter((node) => node.kind !== "character" && node.id !== scope?.focusSceneId).length <= 6);
    for (const node of view.nodes) {
      if (!node.cluster) seen.add(node.id);
      const next = scopeForNode(node, scope);
      if (next) visit(next, depth + 1);
    }
  };
  visit();
  assert.equal(seen.size, nodes.length);
  assert.ok(seen.has("ghost"));
  const first = projectSceneGraph(nodes, edges, undefined, 6);
  assert.equal(first.nodes.find((node) => node.id === "ghost")?.state, "proposed");
});

test("shared records choose stable owners while each scene expands its full neighborhood", () => {
  const nodes = [...scenes(2), record("shared", "character", 1)];
  const edges = [link("shared", "scene-1"), link("shared", "scene-0")];
  assert.equal(sceneIndex(nodes, edges).owner.get("shared"), "scene-0");
  for (const sceneId of ["scene-0", "scene-1"]) {
    const view = projectSceneGraph(nodes, edges, { key: sceneId, label: sceneId, focusSceneId: sceneId });
    assert.deepEqual(view.nodes.map((node) => node.id), [sceneId, "shared"]);
    assert.equal(view.edges.length, 1);
  }
});

test("aggregate edges are marked derived, preserve counts and exclude chronology-only links", () => {
  const nodes = [...scenes(40), record("shared", "character", 0)];
  const edges = [link("shared", "scene-0"), link("shared", "scene-3"), link("shared", "scene-4"), { ...link("scene-0", "scene-39"), id: "chapter:narrative-order:39" }];
  const before = structuredClone({ nodes, edges });
  const view = projectSceneGraph(nodes, edges);
  assert.ok(view.edges.length > 0);
  assert.ok(view.edges.every((edge) => edge.derived && edge.relationLabel?.includes("projected relationships")));
  assert.ok(view.edges.every((edge) => view.nodes.some((node) => node.id === edge.from) && view.nodes.some((node) => node.id === edge.to)));
  assert.equal(view.edges.reduce((sum, edge) => sum + edge.weight!, 0), 3);
  assert.deepEqual({ nodes, edges }, before);
});

test("known simultaneous stories keep separate group boundaries and straight chronological rails", () => {
  const nodes = scenes(200).map((node, position) => ({ ...node, chrono: Math.floor(position / 2), trackId: position % 2 ? "battle-b" : "battle-a" }));
  const view = projectSceneGraph(nodes, []);
  assert.equal(view.nodes.length, 20);
  assert.ok(view.nodes.every((node) => new Set(node.cluster!.ids.map((id) => nodes.find((record) => record.id === id)!.trackId)).size === 1));
  const chronological = arrangeTimeline(view.nodes, view.edges, true, "chronology");
  assert.equal(chronological.tracks.length, 2);
  for (const track of chronological.tracks) {
    const members = chronological.nodes.filter((node) => `${node.lane}:${node.trackId}` === track.id).sort((first, second) => first.chrono - second.chrono);
    assert.equal(new Set(members.map((node) => node.interiorPos[1])).size, 1);
    assert.equal(new Set(members.map((node) => node.interiorPos[2])).size, 1);
    assert.ok(members.every((node, position) => !position || node.interiorPos[0] > members[position - 1].interiorPos[0]));
  }
  for (const time of new Set(chronological.nodes.map((node) => node.chrono))) assert.equal(new Set(chronological.nodes.filter((node) => node.chrono === time).map((node) => node.interiorPos[0])).size, 1);
  assert.equal(arrangeTimeline(view.nodes, view.edges, true, "cloud").tracks.length, 0);
});

test("chronology does not infer dozens of parallel tracks from disconnected scenes", () => {
  const nodes = scenes(12);
  const view = arrangeTimeline(nodes, [], true, "chronology");
  assert.equal(view.tracks.length, 1);
  assert.equal(new Set(view.nodes.map((node) => node.interiorPos[1])).size, 1);
  assert.equal(new Set(view.nodes.map((node) => node.interiorPos[2])).size, 1);
  assert.deepEqual(view.nodes.map((node) => node.chrono), nodes.map((node) => node.chrono));
});

test("the default scene threshold is twenty regardless of viewport and gate states do not change groups", () => {
  assert.equal(SCENE_PAGE_SIZE, 20);
  const nodes = scenes(200);
  const canonical = projectSceneGraph(nodes, []);
  const held = projectSceneGraph(nodes.map((node) => ({ ...node, state: "held" })), []);
  assert.deepEqual(canonical.nodes.map((node) => node.id), held.nodes.map((node) => node.id));
  assert.ok(held.nodes.every((node) => node.cluster?.held === 10 && node.state === "held"));
});

test("record group drill carries the focus scene and preserves stored language and summaries", () => {
  const focus = { ...record("scene", "scene", 0), label: "上条当麻", summary: "已存储的摘要。" };
  const nodes = [focus, ...Array.from({ length: 200 }, (_, position) => record(`event-${position}`, "event", position))];
  const edges = nodes.slice(1).map((node) => link(focus.id, node.id));
  const scope = scopeForNode(focus)!;
  const view = projectSceneGraph(nodes, edges, scope);
  assert.ok(view.nodes.length <= 21);
  assert.equal(view.nodes[0], focus);
  const next = scopeForNode(view.nodes[1], scope)!;
  assert.equal(next.focusSceneId, focus.id);
  assert.ok(projectSceneGraph(nodes, edges, next).nodes.some((node) => node.summary === focus.summary));
  assert.equal(scopeForNode(focus, scope), null);
});

test("twenty scenes stay ungrouped even with many chapter characters and unrelated records", () => {
  const characters = Array.from({ length: 35 }, (_, position) => record(`person-${position}`, "character", position));
  const nodes = [...scenes(20), ...characters, record("loose-event", "event", 10)];
  const view = projectSceneGraph(nodes, []);
  assert.equal(view.nodes.filter((node) => node.kind === "scene" && !node.cluster).length, 20);
  assert.equal(view.nodes.filter((node) => node.kind === "character").length, 35);
  const focus = scopeForNode(nodes[0])!;
  const level = projectSceneGraph(nodes, [], focus);
  assert.deepEqual(level.nodes.filter((node) => node.kind === "character"), characters);
  assert.ok(level.nodes.some((node) => node.id === "scene-0"));
});

test("expansion adds neighboring nodes without replacing the parent, siblings or chapter characters", () => {
  const nodes = [...scenes(42), record("person", "character", 0), record("event", "event", 0)];
  const edges = [link("person", "scene-0"), link("scene-0", "event")];
  const initial = expandSceneGraph(nodes, edges, []);
  assert.equal(initial.nodes.filter((node) => node.kind === "scene").length, 20);
  const group = initial.nodes.find((node) => node.cluster?.ids.includes("scene-0"))!;
  const request = scopeForNode(group)!;
  const expanded = expandSceneGraph(nodes, edges, [request]);
  assert.ok(initial.nodes.every((node) => expanded.nodes.some((candidate) => candidate.id === node.id)));
  assert.ok(expanded.nodes.some((node) => node.id === "scene-0"));
  assert.equal(expanded.nodes.filter((node) => node.id === "person").length, 1);
  const detailed = expandSceneGraph(nodes, edges, [request, scopeForNode(nodes[0])!]);
  assert.ok(detailed.nodes.some((node) => node.id === "event"));
  assert.ok(expanded.nodes.every((node) => detailed.nodes.some((candidate) => candidate.id === node.id)));
  assert.ok(detailed.edges.some((edge) => edge.from === "person" && edge.to === "scene-0" && !edge.derived));
  assert.ok(detailed.edges.some((edge) => edge.id.startsWith("view-membership:") && edge.derived));
});

test("existing node positions remain exactly fixed across in-place expansion in both modes", () => {
  const nodes = [...scenes(42), ...Array.from({ length: 6 }, (_, position) => record(`person-${position}`, "character", position)), ...Array.from({ length: 5 }, (_, position) => record(`event-${position}`, "event", position))];
  const edges = nodes.filter((node) => node.kind !== "scene").map((node) => link("scene-0", node.id));
  const initial = expandSceneGraph(nodes, edges, []);
  const group = initial.nodes.find((node) => node.cluster?.ids.includes("scene-0"))!;
  const requests = [scopeForNode(group)!];
  for (const structure of ["cloud", "chronology"] as const) {
    const before = arrangeSceneExpansion(initial, structure);
    const after = arrangeSceneExpansion(expandSceneGraph(nodes, edges, requests), structure);
    for (const node of before.nodes) assert.deepEqual(after.nodes.find((candidate) => candidate.id === node.id)?.interiorPos, node.interiorPos);
    const detailed = arrangeSceneExpansion(expandSceneGraph(nodes, edges, [...requests, scopeForNode(nodes[0])!]), structure);
    for (const node of after.nodes) assert.deepEqual(detailed.nodes.find((candidate) => candidate.id === node.id)?.interiorPos, node.interiorPos);
    assert.ok(detailed.nodes.every((node) => node.interiorPos.every(Number.isFinite)));
  }
});

test("several branches can stay expanded; collapsing one drops its descendants, not unrelated expansions", () => {
  const nodes = [...scenes(80), record("person", "character", 0)];
  const initial = expandSceneGraph(nodes, [], []);
  const first = scopeForNode(initial.nodes[0])!;
  const second = scopeForNode(initial.nodes[1])!;
  const requests = [first, scopeForNode(nodes[0])!, second];
  const view = expandSceneGraph(nodes, [], requests);
  assert.equal(view.expanded.length, 3);
  const collapsed = expandSceneGraph(nodes, [], requests.filter((scope) => scope.key !== first.key));
  assert.deepEqual(collapsed.expanded.map((scope) => scope.key), [second.key]);
  assert.ok(collapsed.nodes.some((node) => node.id === "person"));
  assert.ok(collapsed.nodes.some((node) => node.id === "scene-4"));
  assert.ok(!collapsed.nodes.some((node) => node.id === "scene-0"));
});

test("jumping to a hidden scene reveals its hierarchy in place without losing previous branches", () => {
  const nodes = [...scenes(1000), record("person", "character", 0)];
  const initial = expandSceneGraph(nodes, [], []);
  const previous = scopeForNode(initial.nodes[0])!;
  const requests = revealSceneNode(nodes, [], [previous], nodes[999]);
  const view = expandSceneGraph(nodes, [], requests);
  assert.ok(view.expanded.some((scope) => scope.key === previous.key));
  assert.ok(view.expanded.some((scope) => scope.key === "scene-999"));
  assert.ok(view.nodes.some((node) => node.id === "scene-999"));
  assert.ok(initial.nodes.every((node) => view.nodes.some((candidate) => candidate.id === node.id)));
  assert.equal(view.nodes.filter((node) => node.id === "person").length, 1);
});

test("collapsing an earlier branch keeps the positions of other open branches and characters", () => {
  const nodes = [...scenes(80), record("person", "character", 0), record("event", "event", 4)];
  const edges = [link("scene-4", "event")];
  const initial = expandSceneGraph(nodes, edges, []);
  const requests = [scopeForNode(initial.nodes[0])!, scopeForNode(initial.nodes[1])!, scopeForNode(nodes[4])!];
  for (const mode of ["cloud", "chronology"] as const) {
    const before = arrangeSceneExpansion(expandSceneGraph(nodes, edges, requests), mode);
    const retained = new Map(before.nodes.map((node) => [node.id, node.interiorPos]));
    const after = arrangeSceneExpansion(expandSceneGraph(nodes, edges, requests.slice(1)), mode, retained);
    for (const node of after.nodes) if (retained.has(node.id)) assert.deepEqual(node.interiorPos, retained.get(node.id));
    assert.ok(after.nodes.some((node) => node.id === "event"));
  }
});
