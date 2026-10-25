import { test } from "node:test";
import assert from "node:assert/strict";
import { orbitalLevel, volumeScope, type OrbitalWorld } from "../apps/playground/src/data/orbitalModel.js";
import { layoutOrbitalLevel, layoutOrbitalPreview } from "../apps/playground/src/data/orbitalLayout.js";
import { causalProjection, worldCausalLinks } from "../apps/playground/src/data/causalProjection.js";
import type { CausalLink, WorldEdge, WorldNode } from "../apps/playground/src/types.js";

const record = (id: string, kind: WorldNode["kind"], chrono = 0, parent = "chapter_1"): WorldNode => ({ id, kind, label: id, chrono, state: "canon", lane: "canon", parent, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const contains = (scene: string, event: string, parent = "chapter_1"): WorldEdge => ({ id: `context:Shared source coverage:${scene}:${event}`, from: scene, to: event, kind: "contains", state: "canon", parent });
const causes = (from: string, to: string, parent = "chapter_1"): WorldEdge => ({ id: `${parent}:CAUSES:${from}:${to}`, from, to, kind: "flow", state: "canon", parent });

/** Chapter 1: 30 scenes (so groups form), each with one event; chapter 2: one scene. */
function world(extraEdges: WorldEdge[] = [], causal?: OrbitalWorld["causal"]): OrbitalWorld {
  const scenes = Array.from({ length: 30 }, (_, index) => ({ ...record(`scene-${index}`, "scene", index), summary: `场景 ${index}` }));
  const events = Array.from({ length: 30 }, (_, index) => record(`event-${index}`, "event", index + 0.5));
  const edges = [...scenes.map((scene, index) => contains(scene.id, events[index].id)), ...extraEdges];
  return {
    laneNodes: [record("chapter_1", "bigEvent", 1, null as unknown as string), record("chapter_2", "bigEvent", 2, null as unknown as string)],
    laneEdges: [],
    interiors: {
      chapter_1: { nodes: [...scenes, ...events], edges },
      chapter_2: { nodes: [record("scene-x", "scene", 0, "chapter_2"), record("event-x", "event", 0.5, "chapter_2")], edges: [contains("scene-x", "event-x", "chapter_2")] },
    },
    ...(causal ? { causal } : {}),
  };
}
const chapter = { key: "orbital:chapter:chapter_1", label: "Chapter 1", kind: "chapter" as const, chapterId: "chapter_1" };

test("older snapshots: same-chapter CAUSES edges become directed links; time order never does", () => {
  const links = worldCausalLinks(world([causes("event-0", "event-25")]));
  assert.deepEqual(links.map((link) => [link.from, link.to, link.fromChapter]), [["event-0", "event-25", "chapter_1"]]);
});

test("hidden endpoints project onto the smallest visible containers, keeping event provenance", () => {
  // 30 scenes page into 20 groups: scenes 1–2 share one group, 25–26 another.
  const w = world([causes("event-1", "event-25"), causes("event-2", "event-26"), causes("event-1", "event-2")]);
  const level = orbitalLevel(w, chapter);
  const draws = layoutOrbitalLevel(level, []).draws;
  const result = causalProjection(level, draws, worldCausalLinks(w));
  const across = result.arrows.find((arrow) => arrow.links.some((link) => link.to === "event-25"))!;
  assert.equal(result.arrows.length, 1);
  assert.ok(across.projected, "scene groups stand in for the events");
  assert.notEqual(across.from, across.to);
  assert.deepEqual(across.links.map((link) => link.id).sort(), ["causes:event-1:event-25", "causes:event-2:event-26"], "both event links aggregate onto one group pair");
  assert.equal(result.inside, 1, "event-1 → event-2 stays inside one group sphere");
  assert.equal(result.insideBy.get(across.from), 1);
  assert.ok(draws.some((draw) => draw.node.id === across.from && draw.node.cluster), "arrow starts on a group, not a fabricated scene link");
});

test("at volume scale a revealed chapter's children carry the arrows; unrevealed chapters keep links inside", () => {
  const w = world([causes("event-0", "event-25")]);
  const level = orbitalLevel(w);
  const layout = layoutOrbitalLevel(level, []);
  assert.deepEqual([causalProjection(level, layout.draws, worldCausalLinks(w)).arrows.length, causalProjection(level, layout.draws, worldCausalLinks(w)).inside], [0, 1]);
  const parent = layout.draws.find((draw) => draw.node.id === "chapter_1")!;
  const preview = layoutOrbitalPreview(parent, orbitalLevel(w, parent.entry!.scope!));
  const revealed = causalProjection(level, [...layout.draws, ...preview.draws], worldCausalLinks(w));
  assert.equal(revealed.arrows.length, 1);
  assert.ok(preview.draws.some((draw) => draw.node.id === revealed.arrows[0].from));
});

test("cross-chapter links project chapter to chapter at volume scale and are counted, not dropped, inside a chapter", () => {
  const link: CausalLink = { id: "causes:event-3:event-x", from: "event-3", to: "event-x", fromChapter: "chapter_1", toChapter: "chapter_2", state: "held" };
  const w = world([], { links: [link], unresolved: 0 });
  const volume = orbitalLevel(w);
  const atVolume = causalProjection(volume, layoutOrbitalLevel(volume, []).draws, worldCausalLinks(w));
  assert.deepEqual(atVolume.arrows.map((arrow) => [arrow.from, arrow.to, arrow.projected, arrow.state]), [["chapter_1", "chapter_2", true, "held"]]);
  const inside = orbitalLevel(w, chapter);
  assert.deepEqual(causalProjection(inside, layoutOrbitalLevel(inside, []).draws, worldCausalLinks(w)), { arrows: [], inside: 0, insideBy: new Map(), elsewhere: 1 });
});

test("visible event spheres get direct (unprojected) arrows", () => {
  const w = world([causes("event-0", "event-1")]);
  const scene = orbitalLevel(w, { ...chapter, key: "scene", kind: "scene", sceneId: "scene-0" });
  const draws = [...layoutOrbitalLevel(scene, []).draws, { ...layoutOrbitalLevel(scene, []).draws[0], node: record("event-1", "event", 1.5), role: "preview" as const }];
  const result = causalProjection(scene, draws, worldCausalLinks(w));
  assert.deepEqual(result.arrows.map((arrow) => [arrow.from, arrow.to, arrow.projected]), [["event-0", "event-1", false]]);
  assert.equal(volumeScope.kind, "volume");
});

test("dialogue endpoints project onto their owning scene's sphere, keeping dialogue provenance", () => {
  const causal: OrbitalWorld["causal"] = {
    links: [{ id: "causes:dlg_1:event-25", from: "dlg_1", to: "event-25", fromChapter: "chapter_1", toChapter: "chapter_1", state: "canon" }],
    unresolved: 0,
    dialogueScenes: { dlg_1: "scene-1" },
  };
  const w = world([], causal);
  const level = orbitalLevel(w, chapter);
  const draws = layoutOrbitalLevel(level, []).draws;
  const result = causalProjection(level, draws, worldCausalLinks(w), causal.dialogueScenes);
  assert.equal(result.arrows.length, 1);
  assert.ok(result.arrows[0].projected, "dialogue endpoint stands in as its scene group");
  assert.equal(result.arrows[0].links[0].from, "dlg_1", "provenance keeps the dialogue id, not the scene");
  const noMap = causalProjection(level, draws, worldCausalLinks(w));
  assert.equal(noMap.arrows.length, 0);
  assert.equal(noMap.elsewhere, 1, "without the scene map the dialogue endpoint is elsewhere, never guessed");
});
