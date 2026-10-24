import { test } from "node:test";
import assert from "node:assert/strict";
import { orbitalContents, orbitalLevel, progressiveNebula, representativeScene, volumeScope, type OrbitalWorld } from "../apps/playground/src/data/orbitalModel.js";
import { helixPoint, interpolatePose, layoutOrbitalLevel, layoutOrbitalPreview, nestedEntityConnections, visibleOrbitalEdges } from "../apps/playground/src/data/orbitalLayout.js";
import type { WorldEdge, WorldNode } from "../apps/playground/src/types.js";

const record = (id: string, kind: WorldNode["kind"], chrono = 0): WorldNode => ({ id, kind, label: id, chrono, state: "canon", lane: "canon", parent: "chapter", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const relation = (from: string, to: string, weight = 1): WorldEdge => ({ id: `${from}:${to}`, from, to, weight, kind: "contains", state: "canon", parent: "chapter" });
const worldWith = (nodes: WorldNode[], edges: WorldEdge[] = []): OrbitalWorld => ({ laneNodes: [record("chapter", "bigEvent")], laneEdges: [], interiors: { chapter: { nodes, edges } } });
const chapter = { key: "chapter", label: "Chapter", kind: "chapter" as const, chapterId: "chapter" };
const scenes = (count: number) => Array.from({ length: count }, (_, index) => ({ ...record(`scene-${index}`, "scene", index), summary: `原文摘要 ${index}` }));

test("orbital hierarchy recursively pages scenes and retains all chapter nebula at each depth", () => {
  const nodes = [...scenes(20000), record("character", "character"), { ...record("ghost", "character"), state: "proposed" as const }, record("location", "location")];
  const world = worldWith(nodes);
  const before = structuredClone(world);
  let scope = chapter as Parameters<typeof orbitalLevel>[1];
  let depth = 0;
  while (true) {
    const level = orbitalLevel(world, scope);
    assert.equal(level.nebula.length, 3);
    assert.equal(level.nebula.find((node) => node.id === "ghost")?.state, "proposed");
    assert.ok(level.main.length <= 20);
    const first = level.main[0];
    if (!first.node.cluster) { assert.equal(first.node.id, "scene-0"); break; }
    assert.equal(level.main.flatMap((entry) => entry.members).length, scope?.ids?.length ?? 20000);
    scope = first.scope;
    assert.ok(++depth < 8);
  }
  assert.equal(depth, 3);
  assert.deepEqual(world, before);
});

test("representative labels use the most connected stored summary, not generated text", () => {
  const nodes = [...scenes(2), record("person", "character"), record("location", "location")];
  const edges = [relation("person", "scene-1", 9), relation("location", "scene-1", 5)];
  assert.equal(representativeScene(nodes, edges)?.summary, "原文摘要 1");
  assert.equal(orbitalLevel(worldWith(nodes, edges), volumeScope).main[0].node.label, "原文摘要 1");
  assert.equal(representativeScene(nodes.map((node) => ({ ...node, summary: undefined })), edges), undefined);
});

test("parallel story tracks stay separate, aligned and straight; gravity moves only nebula", () => {
  const nodes = [...scenes(40).map((node, index) => ({ ...node, chrono: Math.floor(index / 2), trackId: index % 2 ? "b" : "a" })), record("person", "character")];
  const level = orbitalLevel(worldWith(nodes, [relation("person", "scene-0", 50)]), chapter);
  assert.equal(level.main.length, 20);
  assert.ok(level.main.every((entry) => new Set(entry.members.map((id) => nodes.find((node) => node.id === id)!.trackId)).size === 1));
  const layout = layoutOrbitalLevel(level);
  const changed = layoutOrbitalLevel({ ...level, sourceEdges: [relation("person", "scene-39", 50)] });
  assert.deepEqual(layout.draws.filter((draw) => draw.role === "main"), changed.draws.filter((draw) => draw.role === "main"));
  assert.notDeepEqual(layout.draws.at(-1)!.position, changed.draws.at(-1)!.position);
  for (const track of ["a", "b"]) {
    const entries = layout.draws.filter((draw) => draw.role === "main" && draw.node.trackId === track);
    assert.equal(new Set(entries.map((draw) => draw.position[1])).size, 1);
    assert.ok(entries.every((draw, index) => draw.position[2] === 0 && (!index || draw.position[0] > entries[index - 1].position[0])));
  }
  const offsets = Array.from({ length: 11 }, (_, index) => {
    const first = helixPoint(index / 10, 0, 2, 165), second = helixPoint(index / 10, 1, 2, 165);
    assert.equal(first[0], second[0]); assert.equal(first[2], second[2]);
    return second[1] - first[1];
  });
  assert.ok(offsets.every((value) => Math.abs(value - offsets[0]) < 1e-8));
});

test("preview stays inside the enclosing sphere and promotion uncoils to exact local positions", () => {
  const world = worldWith(scenes(20));
  const parent = layoutOrbitalLevel(orbitalLevel(world)).draws[0];
  const level = orbitalLevel(world, chapter);
  const preview = layoutOrbitalPreview(parent, level);
  const local = layoutOrbitalLevel(level);
  assert.equal(preview.draws.length, 20);
  for (const draw of preview.draws) {
    assert.ok(Math.hypot(...draw.position.map((value, axis) => value - parent.position[axis])) + draw.radius < parent.radius);
    const target = local.draws.find((entry) => entry.node.id === draw.node.id)!;
    assert.deepEqual(interpolatePose(draw, target, 0), { position: draw.position, radius: draw.radius });
    assert.deepEqual(interpolatePose(draw, target, 1), { position: target.position, radius: target.radius });
    assert.ok(interpolatePose(draw, target, 0.5).position.every(Number.isFinite));
  }
  for (const tracks of [1, 2, 20]) for (let track = 0; track < tracks; track++) for (let sample = 0; sample <= 100; sample++) {
    assert.ok(Math.hypot(...helixPoint(sample / 100, track, tracks, parent.radius)) + 13 < parent.radius);
  }
});

test("one stored turn per sphere appears only below its scene; legacy summary dialogue is not duplicated", () => {
  const nodes = [record("scene", "scene"), record("legacy", "dialogue"), { ...record("turn-0", "dialogue"), dialogue: { turn: 0, speakerId: null } }, { ...record("turn-1", "dialogue"), dialogue: { turn: 1, speakerId: null }, state: "held" as const }, record("loose", "event")];
  const edges = nodes.slice(1, 4).map((node) => relation("scene", node.id));
  const world = worldWith(nodes, edges);
  const overview = orbitalLevel(world, chapter);
  assert.ok(overview.main.every((entry) => entry.node.kind !== "dialogue"));
  assert.ok(overview.main.some((entry) => entry.members.includes("loose")));
  const bottom = orbitalLevel(world, overview.main.find((entry) => entry.node.id === "scene")!.scope);
  assert.deepEqual(bottom.main.map((entry) => entry.node.id), ["turn-0", "turn-1"]);
  assert.equal(bottom.main[1].node.state, "held");
  assert.deepEqual(orbitalContents(nodes[0], bottom).map((node) => node.id), ["turn-0", "turn-1"]);
});

test("terminal scenes expose all events and dialogue without record or dialogue child pages", () => {
  const scene = record("scene", "scene");
  const event = record("event", "event", -1);
  const turns = Array.from({ length: 85 }, (_, index) => ({ ...record(`turn-${index}`, "dialogue", index), dialogue: { turn: index, speakerId: null }, state: index === 42 ? "held" as const : "canon" as const }));
  const nodes = [scene, event, ...turns, record("legacy", "dialogue"), record("person", "character"), record("place", "location"), record("unrelated", "event")];
  const edges = [relation(scene.id, event.id), ...turns.map(turn => relation(event.id, turn.id)), relation(scene.id, "legacy"), relation("person", scene.id), relation("place", event.id), { ...relation(scene.id, "unrelated"), id: "view-membership" }];
  const world = worldWith(nodes, edges);
  const before = structuredClone(world);
  const overview = orbitalLevel(world, chapter);
  const bottom = orbitalLevel(world, overview.main.find(entry => entry.node.id === scene.id)!.scope);
  assert.deepEqual(bottom.main.map(entry => entry.node.id), [event.id, ...turns.map(turn => turn.id)]);
  assert.ok(bottom.main.every(entry => !entry.scope && !entry.node.cluster));
  assert.deepEqual(orbitalContents(scene, bottom), bottom.main.map(entry => entry.node));
  assert.equal(bottom.main.find(entry => entry.node.id === "turn-42")?.node.state, "held");
  assert.deepEqual(bottom.nebula.map(node => node.id), ["person", "place"]);
  assert.ok(overview.main.every(entry => entry.node.kind === "scene" || entry.node.id === "unrelated"));
  assert.deepEqual(world, before);
});

test("unassigned events and dialogues appear directly in chapter chronology until a scene arrives", () => {
  const loose = Array.from({ length: 45 }, (_, index) => record(`loose-${index}`, index % 2 ? "dialogue" : "event", index));
  const world = worldWith([...scenes(21).map(node => ({ ...node, chrono: node.chrono * 3 })), ...loose]);
  const level = orbitalLevel(world, chapter);
  assert.ok(loose.every(node => level.main.some(entry => entry.node.id === node.id && !entry.scope && !entry.node.cluster)));
  assert.equal(level.main.filter(entry => entry.scope).length, 20);
  assert.deepEqual(level.main.map(entry => entry.node.chrono), level.main.map(entry => entry.node.chrono).sort((first, second) => first - second));
});

test("relations show only selected visible endpoints and never projected aggregates or time links", () => {
  const level = orbitalLevel(worldWith([record("scene", "scene"), record("person", "character")]), chapter);
  const draws = layoutOrbitalLevel(level).draws;
  const edges = [relation("person", "scene"), relation("person", "hidden"), { ...relation("person", "scene"), id: "view-aggregate" }, { ...relation("person", "scene"), id: "chapter:narrative-order:1" }];
  assert.deepEqual(visibleOrbitalEdges(edges, draws, "person"), [edges[0]]);
  assert.deepEqual(visibleOrbitalEdges(edges, draws, null), []);
});

test("surroundings reveal progressively by scoped link strength rather than persisting every entity", () => {
  const entities = Array.from({ length: 40 }, (_, index) => record(`person-${index}`, "character"));
  const nodes = [...scenes(100), ...entities];
  const edges = entities.map((node, index) => relation(node.id, "scene-0", index + 1));
  const world = worldWith(nodes, edges);
  const root = progressiveNebula(orbitalLevel(world), 1);
  const middle = progressiveNebula(orbitalLevel(world, chapter), 2);
  const leaf = orbitalLevel(world, { ...chapter, key: "scene-0", kind: "scene", sceneId: "scene-0" });
  assert.equal(root.nodes.length, 5);
  assert.equal(middle.nodes.length, 10);
  assert.equal(progressiveNebula(leaf, 4).nodes.length, 40);
  assert.equal(root.nodes[0].id, "person-39");
  assert.equal(root.eligible, 40);
  assert.ok(progressiveNebula(orbitalLevel(world), 1, "person-0").nodes.some((node) => node.id === "person-0"));
  const ghost = { ...record("candidate", "character"), state: "proposed" as const };
  assert.ok(progressiveNebula(orbitalLevel(worldWith([...nodes, ghost], edges)), 1).nodes.some((node) => node.id === ghost.id));
});

test("selected entities connect to every linked nested scene without claiming event actors were physically present", () => {
  const nodes = [...scenes(40), record("person", "character"), record("event", "event")];
  const edges = [relation("person", "scene-0"), relation("person", "scene-39"), relation("person", "event"), relation("scene-5", "event"), relation("scene-6", "event")];
  const level = orbitalLevel(worldWith(nodes, edges), chapter);
  const layout = layoutOrbitalLevel(level);
  const result = nestedEntityConnections(level, layout.draws, "person");
  assert.deepEqual(new Set(result.edges.map((edge) => edge.to)), new Set(["scene-0", "scene-39", "scene-5", "scene-6"]));
  assert.equal(result.draws.length, 4);
  assert.ok(result.edges.find((edge) => edge.to === "scene-5")?.relationLabel?.includes("not a presence claim"));
  for (const port of result.draws) {
    const parent = layout.draws.find((draw) => draw.node.id === port.previewParentId)!;
    assert.ok(Math.hypot(...port.position.map((value, axis) => value - parent.position[axis])) < parent.radius);
  }
  const chapterNode = orbitalLevel(worldWith(nodes, edges)).main[0].node;
  assert.deepEqual(orbitalContents(chapterNode, level).map((node) => node.id), scenes(40).map((node) => node.id));
  assert.deepEqual(orbitalContents(level.main[0].node, level).map((node) => node.id), ["scene-0", "scene-1"]);
  assert.deepEqual(orbitalContents(nodes[5], level).map((node) => node.id), ["event"]);
});
