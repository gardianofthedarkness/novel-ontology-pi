import { test } from "node:test";
import assert from "node:assert/strict";
import { libraryActivityPath, libraryReadingPrefix, libraryScope, type LibraryView } from "../apps/playground/src/data/libraryModel.js";
import { orbitalContents, orbitalLevel, type OrbitalWorld } from "../apps/playground/src/data/orbitalModel.js";
import { layoutOrbitalLevel, layoutOrbitalPreview } from "../apps/playground/src/data/orbitalLayout.js";
import { orbitalLocation } from "../apps/playground/src/data/orbitalLocation.js";
import { libraryCausalProjection } from "../apps/playground/src/data/causalProjection.js";

const view = (): LibraryView => ({
  revision: "revision", sources: [{ id: "one", title: "星空一", filename: "星空 第1卷.epub" }, { id: "two", title: "星空二", filename: "星空 第2卷.epub" }],
  organization: { universes: [{ id: "world", title: "世界" }], continuities: [{ id: "canon", title: "正史", universeId: "world" }],
    series: [{ id: "stars", title: "星空" }], assignments: [
      { sourceId: "two", seriesId: "stars", continuityId: "canon", readingOrder: 2, status: "confirmed" },
      { sourceId: "one", seriesId: "stars", continuityId: "canon", readingOrder: 1, status: "confirmed" },
    ] },
  plans: [], events: [], bindings: [{ sourceId: "one", volume: 1 }, { sourceId: "two", volume: 2 }], omittedPlans: 0, totalEvents: 0,
});
const world = (): OrbitalWorld => ({ laneNodes: [], laneEdges: [], interiors: {}, library: view(), sourceId: "one" });

test("universe arrows preserve direction, qualified endpoints and weakest review state without selection", () => {
  const data = world();
  const cause = { id: "cause", universeId: "world", from: { sourceId: "one", unitId: "event" }, to: { sourceId: "two", unitId: "event" }, state: "canon" as const, stale: false };
  data.library!.causal = { links: [cause, { ...cause, id: "pending", state: "proposed" }, { ...cause, id: "held", state: "held" }, { ...cause, id: "reverse", from: cause.to, to: cause.from }], invalidPackets: 0, omittedPackets: 0 };
  const root = orbitalLevel(data, libraryScope);
  const level = orbitalLevel(data, root.main[0].scope!);
  const result = libraryCausalProjection(level, layoutOrbitalLevel(level).draws, data.library);
  assert.deepEqual(result.arrows.map(arrow => [arrow.from, arrow.to, arrow.projected, arrow.state, arrow.links.length]), [
    [level.main[0].node.id, level.main[1].node.id, true, "held", 3],
    [level.main[1].node.id, level.main[0].node.id, true, "canon", 1],
  ]);
  assert.deepEqual(result.arrows[0].links[0], cause);
  const overview = libraryCausalProjection(root, layoutOrbitalLevel(root).draws, data.library);
  assert.equal(overview.arrows.length, 0);
  assert.equal(overview.inside, 4);
  assert.equal(overview.insideBy.get(root.main[0].node.id), 4);
});

test("universe arrows exclude stale links, unresolved membership and speculative organization", () => {
  const data = world();
  data.library!.causal = { links: [{ id: "cause", universeId: "world", from: { sourceId: "one", unitId: "event" }, to: { sourceId: "two", unitId: "event" }, state: "canon", stale: true }], invalidPackets: 0, omittedPackets: 0 };
  const project = () => {
    const root = orbitalLevel(data, libraryScope);
    const level = orbitalLevel(data, root.main[0].scope!);
    return libraryCausalProjection(level, layoutOrbitalLevel(level).draws, data.library);
  };
  assert.equal(project().arrows.length, 0);
  data.library!.causal.links[0].stale = false;
  data.library!.organization.assignments[0].status = "unresolved";
  assert.equal(project().arrows.length, 0);
  data.library!.organization.assignments[0].status = "confirmed";
  data.library!.plans = [{ id: "pending", state: "proposed", organization: structuredClone(data.library!.organization) }];
  const root = orbitalLevel(data, libraryScope);
  const planned = orbitalLevel(data, root.main.find(entry => entry.scope?.planId === "pending")!.scope!);
  assert.equal(libraryCausalProjection(planned, layoutOrbitalLevel(planned).draws, data.library).arrows.length, 0);
  assert.equal(libraryCausalProjection(root, layoutOrbitalLevel(root).draws, data.library).inside, 1);
});

test("cross-series causes draw at library scale and count off-page endpoints at file scale", () => {
  const data = world();
  data.library!.organization.series.push({ id: "moon", title: "月" });
  data.library!.organization.assignments[0].seriesId = "moon";
  data.library!.causal = { links: [{ id: "cause", universeId: "world", from: { sourceId: "one", unitId: "event" }, to: { sourceId: "two", unitId: "event" }, state: "canon", stale: false }], invalidPackets: 0, omittedPackets: 0 };
  const root = orbitalLevel(data, libraryScope);
  const result = libraryCausalProjection(root, layoutOrbitalLevel(root).draws, data.library);
  assert.equal(result.arrows.length, 1);
  assert.equal(result.arrows[0].from, root.main.find(entry => entry.members.includes("one"))!.node.id);
  assert.equal(result.arrows[0].to, root.main.find(entry => entry.members.includes("two"))!.node.id);
  const files = orbitalLevel(data, root.main[0].scope!);
  const scoped = libraryCausalProjection(files, layoutOrbitalLevel(files).draws, data.library);
  assert.equal(scoped.arrows.length, 0);
  assert.equal(scoped.elsewhere, 1);
});

test("revealing a series moves its internal causal projection onto the visible file spheres", () => {
  const data = world();
  data.library!.causal = { links: [{ id: "cause", universeId: "world", from: { sourceId: "one", unitId: "event" }, to: { sourceId: "two", unitId: "event" }, state: "canon", stale: false }], invalidPackets: 0, omittedPackets: 0 };
  const root = orbitalLevel(data, libraryScope);
  const layout = layoutOrbitalLevel(root);
  const files = orbitalLevel(data, root.main[0].scope!);
  const preview = layoutOrbitalPreview(layout.draws[0], files);
  const result = libraryCausalProjection(root, [...layout.draws, ...preview.draws], data.library);
  assert.equal(result.inside, 0);
  assert.deepEqual(result.arrows.map(arrow => [arrow.from, arrow.to]), [[files.main[0].node.id, files.main[1].node.id]]);
});

test("reviewed universe causes project to file spheres with explicit states, never to speculative membership or stale edges", () => {
  const data = world();
  data.library!.causal = { links: [{ id: "cause", universeId: "world", from: { sourceId: "one", unitId: "ev_1" }, to: { sourceId: "two", unitId: "card_1" }, state: "proposed", stale: false }], invalidPackets: 0, omittedPackets: 0 };
  const root = orbitalLevel(data, libraryScope);
  const files = orbitalLevel(data, root.main[0].scope!);
  const edge = files.sourceEdges.find(edge => edge.relationType === "CAUSES")!;
  assert.equal(edge.from, files.main[0].node.id);
  assert.equal(edge.to, files.main[1].node.id);
  assert.equal(edge.state, "proposed");
  assert.equal(edge.derived, true);
  assert.match(edge.relationLabel!, /projected/);
  data.library!.causal.links[0].stale = true;
  assert.equal(orbitalLevel(data, root.main[0].scope!).sourceEdges.filter(edge => edge.relationType === "CAUSES").length, 0);
});

test("series → ordered files → volume uses the same orbital model and reversible source-qualified path", () => {
  const data = world();
  const root = orbitalLevel(data, libraryScope);
  assert.equal(root.main.length, 1);
  const series = orbitalLevel(data, root.main[0].scope!);
  assert.deepEqual(series.main.map(entry => entry.node.library?.sourceId), ["one", "two"]);
  assert.deepEqual(series.main.map(entry => entry.scope?.sourceId), ["one", "two"]);
  assert.deepEqual(orbitalContents(root.main[0].node, root).map(node => node.label), ["星空 第1卷.epub", "星空 第2卷.epub"]);
  assert.deepEqual(libraryReadingPrefix(data).map(scope => scope.kind), ["library", "series"]);
  const layout = layoutOrbitalLevel(series);
  assert.equal(layout.paths.length, 1);
  assert.match(layout.paths[0].id, /^reading-order:/);
  assert.equal(layoutOrbitalLevel(root).paths.length, 0);
  const preview = layoutOrbitalPreview(layoutOrbitalLevel(root).draws[0], series);
  assert.equal(preview.draws.length, 2);
  assert.equal(preview.paths.length, 1);
  const path = [...libraryReadingPrefix(data), series.main[0].scope!];
  const location = orbitalLocation(data, path, orbitalLevel(data, path.at(-1)!), null);
  assert.deepEqual(location.map(crumb => crumb.kind), ["library", "series", "book"]);
  assert.deepEqual(location.map(crumb => crumb.pathIndex), [0, 1, 2]);
  const libraryLocation = orbitalLocation(data, [libraryScope], root, null, root.main[0].node);
  assert.deepEqual(libraryLocation.map(crumb => crumb.kind), ["library", "series"]);
});

test("unknown membership/order is not a fabricated timeline and unattached books are not navigable", () => {
  const data = world();
  data.library!.organization.assignments[0].readingOrder = null;
  data.library!.bindings = [{ sourceId: "one", volume: 1 }];
  const root = orbitalLevel(data, libraryScope);
  const series = orbitalLevel(data, root.main[0].scope!);
  assert.equal(series.main.find(entry => entry.node.library?.sourceId === "two")?.scope, undefined);
  assert.equal(layoutOrbitalLevel(series).paths.length, 0);
  assert.equal(layoutOrbitalPreview(layoutOrbitalLevel(root).draws[0], series).paths.length, 0);
});

test("a pending plan is a distinct ghost, held stays held, approval resolves to reviewed files", () => {
  const data = world();
  const organization = structuredClone(data.library!.organization);
  data.library!.organization = { universes: [], continuities: [], series: [], assignments: [] };
  data.library!.plans = [{ id: "plan-a", state: "proposed", organization }];
  const root = orbitalLevel(data, libraryScope);
  assert.equal(root.main[0].node.state, "proposed");
  const files = orbitalLevel(data, root.main[0].scope!);
  assert.ok(files.main.every(entry => entry.node.state === "proposed"));
  const event = { id: "event", type: "library.plan.proposed", timestamp: "2026-10-25T05:00:00Z", planId: "plan-a", sourceIds: ["one", "two"] };
  assert.equal(libraryActivityPath(data, event).at(-1)?.kind, "series");
  data.library!.plans[0].state = "held";
  assert.equal(orbitalLevel(data, libraryScope).main[0].node.state, "held");
  data.library!.plans = [];
  data.library!.organization = organization;
  const approved = orbitalLevel(data, libraryScope);
  assert.equal(approved.main[0].node.state, "canon");
  assert.equal(libraryActivityPath(data, { ...event, type: "library.plan.approved" }).at(-1)?.kind, "series");
});

test("loading another file never renders the previous file's colliding chapters", () => {
  const data = world();
  data.laneNodes = [{ id: "chapter_0", label: "File one chapter", kind: "bigEvent", state: "canon", parent: null, lane: "canon", chrono: 0, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }];
  const root = orbitalLevel(data, libraryScope);
  const series = orbitalLevel(data, root.main[0].scope!);
  const next = series.main[1].scope!;
  assert.equal(orbitalLevel(data, next).main.length, 0);
  data.sourceId = "two";
  data.laneNodes[0].label = "File two chapter";
  assert.equal(orbitalLevel(data, next).main[0].node.label, "File two chapter");
  assert.equal(orbitalLevel(data, next).scope.sourceId, "two");
});

test("canonical and proposed library groups have distinct positions without implying chronology", () => {
  const data = world();
  data.library!.plans = [{ id: "pending", state: "proposed", organization: structuredClone(data.library!.organization) }];
  const layout = layoutOrbitalLevel(orbitalLevel(data, libraryScope));
  assert.equal(new Set(layout.draws.map(draw => JSON.stringify(draw.position))).size, layout.draws.length);
  assert.equal(layout.paths.length, 0);
});
