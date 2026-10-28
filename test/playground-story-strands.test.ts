import { test } from "node:test";
import assert from "node:assert/strict";
import { storyStrands } from "../apps/playground/src/data/storyStrands.js";
import { shapeChange, spiralArrangement, spiralNodeId, strandCast, strandSummary } from "../apps/playground/src/data/orbitalTimePlace.js";
import type { OrbitalDraw } from "../apps/playground/src/data/orbitalLayout.js";
import type { WorldNode } from "../apps/playground/src/types.js";
import type { StoryScene, TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";

// Invented: Ming and Lan leave the station together (s1), then the story cuts
// between Ming at the port (m1, m2) and Lan at the hill (l1, l2) until they
// meet at the bridge (s6). A recap scene (fb) is told after s6. Lan's second
// scene has no recorded cast and carries hers.
const scene = (id: string, index: number, characterIds: string[], placeIds: string[], flashback = false): StoryScene =>
  ({ id, index, chapterIndex: 0, label: id, times: [{ id: "t_day", via: index ? "inherited" : "anchor" }], flashback, placeIds, placeCarried: false, characterIds });
const data: TimePlaceProjection = {
  available: true,
  times: [{ id: "t_day", label: "that day", gloss: "day", family: "date", role: "ADVANCE", flashback: false, flashbackProbability: 0, decidedBy: "rule", toldFromId: null, date: null, partOfDay: null, chapterIndex: 0, storyIndex: 0, narrativeIndex: 0, anchorSceneId: "s1", sceneIds: [] } as never],
  scenes: [
    scene("s1", 0, ["ming", "lan"], ["station"]),
    scene("m1", 1, ["ming"], ["port"]),
    scene("l1", 2, ["lan"], ["hill"]),
    scene("m2", 3, ["ming"], ["port"]),
    scene("l2", 4, [], ["hill"]),
    scene("s6", 5, ["ming", "lan"], ["bridge"]),
    scene("fb", 6, ["ming"], [], true),
    scene("s7", 7, ["ming"], ["bridge"]),
  ],
  places: [], characters: [], names: {},
};

test("strands split where casts part, stay parallel, and merge where they meet", () => {
  const strands = storyStrands(data);
  assert.ok(strands.before("s1", "m1") && strands.before("s1", "l1"));
  assert.ok(strands.before("m2", "s6") && strands.before("l2", "s6"));
  for (const [a, b] of [["m1", "l1"], ["m1", "l2"], ["m2", "l1"], ["m2", "l2"]]) assert.ok(!strands.before(a, b) && !strands.before(b, a), `${a} ∥ ${b}`);
  assert.ok(strands.carried.has("l2"));
  assert.ok(strands.forks.has("s1"));
  assert.ok(strands.merges.has("s6"));
  assert.notEqual(strands.lane.get("m1"), strands.lane.get("l1"));
  assert.equal(strands.parallelPairs >= 4, true);
});

test("a flashback is placed before the scene it is told at, not after its teller", () => {
  const strands = storyStrands(data);
  assert.ok(strands.before("fb", "s7"));
  assert.ok(!strands.before("s6", "fb"));
});

test("Story time strands put parallel strands on separate coils, one moment at one angle", () => {
  const arrangement = spiralArrangement(data, undefined, null, "strands");
  const strands = storyStrands(data);
  const at = (id: string) => arrangement.anchors!.get(spiralNodeId(id))!;
  if (strands.layer.get("m1") === strands.layer.get("l1")) {
    assert.equal(at("m1")[0], at("l1")[0]);
    assert.equal(at("m1")[2], at("l1")[2]);
  }
  assert.ok(Math.abs(at("m1")[1] - at("l1")[1]) > 400);
  assert.equal(arrangement.timeKey.label, "STORY STRANDS →");
  const line = spiralArrangement(data, undefined, null, "line");
  assert.equal(line.timeKey.label, "STORY TIME →");
});

test("time and place check each other: splits and meetings by place, open ends, one person in two places", () => {
  const strands = storyStrands(data);
  assert.deepEqual(strands.checks.find((check) => check.kind === "split"), { kind: "split", sceneId: "s1", status: "places differ" });
  assert.deepEqual(strands.checks.find((check) => check.kind === "merge"), { kind: "merge", sceneId: "s6", status: "meets" });
  // Lan goes to Ming at the port instead: she joins his strand's place.
  const joins = storyStrands({ ...data, scenes: data.scenes.map((entry) => entry.id === "s6" ? { ...entry, placeIds: ["port"] } : entry) });
  assert.equal(joins.checks.find((check) => check.kind === "merge")?.status, "joins");
  // The chapter ends before they meet.
  const apart = storyStrands({ ...data, scenes: data.scenes.slice(0, 5) });
  assert.equal(apart.checks.find((check) => check.kind === "apart")?.count, 2);
  // Both scenes state the same evening, at two places, with Ming in each.
  const evening = { ...data.times[0], id: "t_eve", date: { month: 12, day: 24, derived: false }, partOfDay: "evening" };
  const twice = storyStrands({ ...data, times: [...data.times, evening], scenes: data.scenes.map((entry) => ["m1", "m2"].includes(entry.id) ? { ...entry, times: [{ id: "t_eve", via: "anchor" as const }], placeIds: [entry.id === "m1" ? "port" : "hill"] } : entry) });
  assert.equal(twice.checks.filter((check) => check.kind === "conflict").length, 1);
  assert.match(strandSummary(strands.checks), /splits: 1 at different places/);
});

test("the arrangement changes shape with a signature and shreds in story order", () => {
  const line = spiralArrangement(data, undefined, null, "line"), strands = spiralArrangement(data, undefined, null, "strands");
  assert.notEqual(line.morphKey, strands.morphKey);
  const draws = ["s1", "s6"].map((id) => ({ node: { id: spiralNodeId(id) }, position: [0, 0, 0], radius: 1, role: "main" })) as never;
  const delays = strands.morphDelays!(draws);
  assert.ok(delays.get(spiralNodeId("s1"))! < delays.get(spiralNodeId("s6"))!);
});

test("coils stack above the line, never under the floor", () => {
  const strands = spiralArrangement(data, undefined, null, "strands"), line = spiralArrangement(data, undefined, null, "line");
  const lowest = (anchors: Map<string, number[]>) => Math.min(...[...anchors.values()].map((point) => point[1]));
  assert.ok(lowest(strands.anchors!) >= lowest(line.anchors!) - 1);
});

test("only the user's switch reframes; new evidence glides with the caption of the shape shown", () => {
  assert.equal(shapeChange(undefined, "line:a"), null);
  assert.equal(shapeChange("line:a", "line:a"), null);
  assert.deepEqual(shapeChange("line:a", "strands:b"), { caption: "Shredding the story line into strands…", reframe: true });
  assert.deepEqual(shapeChange("strands:b", "line:a"), { caption: "Weaving the strands back into one line…", reframe: true });
  assert.deepEqual(shapeChange("line:a", "line:c"), { caption: "Story line moving to new evidence…", reframe: false });
  assert.equal(shapeChange("strands:b", "strands:c")?.reframe, false);
});

test("a universe lays its books' strands in reading order", () => {
  // Book 2 is read first; book 1 opens with a scene before any time word, so it leads story order.
  const book = (volume: number) => data.scenes.map((entry) => ({ ...entry, id: `${volume}:${entry.id}`, index: entry.index + (volume === 2 ? 0 : 100), book: volume, times: volume === 1 && entry.index === 0 ? [] : entry.times }));
  const universe: TimePlaceProjection = { ...data, scope: "universe", scenes: [...book(1), ...book(2)], books: [1, 2].map((volume) => ({ volume, sourceId: `s${volume}`, title: `Book ${volume}`, continuityId: null, readingOrder: volume === 2 ? 1 : 2 })) };
  const anchors = spiralArrangement(universe, undefined, null, "strands").anchors!;
  const x = (volume: number) => Math.max(...data.scenes.map((entry) => anchors.get(spiralNodeId(`${volume}:${entry.id}`))![0]));
  assert.ok(x(2) < x(1));
});

test("the place check names only what happened", () => {
  assert.equal(strandSummary([]), "no splits · no meetings");
  assert.equal(strandSummary([{ kind: "split", sceneId: "a", status: "same place" }, { kind: "apart", sceneId: "b", status: "chapter ends apart", count: 2 }]), "splits: 1 at one place (doubtful) · no meetings · 1 chapter ends with strands apart");
});

test("the calendar, not a file, focuses Story time: a chosen day frames every scene that day", () => {
  const day = (id: string, date: number) => ({ id, book: null, label: id, year: 1, month: 6, day: date, time: null, span: { start: 0, end: 0 }, placed: "stated" as const, flashback: false, scenes: 1 });
  const dated: TimePlaceProjection = { ...data,
    scenes: data.scenes.map((entry) => ({ ...entry, times: [{ id: entry.index < 4 ? "t_first" : "t_second", via: "anchor" as const }] })),
    calendar: { books: [], conflicts: [], questions: 0, entries: [day("t_first", 1), day("t_second", 2)] } };
  const draws = (arrangement: ReturnType<typeof spiralArrangement>) => [...arrangement.anchors!].map(([id, point]) => ({ node: { id }, position: point, role: "main" }) as never);
  const second = spiralArrangement(dated, undefined, null, "strands", "1-6-2");
  assert.equal(second.bookFrame!(draws(second))!.length, 4, "the four scenes on 6月2日");
  assert.equal(second.bookKey, "story:day:1-6-2");
  assert.equal(spiralArrangement(dated, undefined, null, "strands", "1-6-9").bookFrame!(draws(second)), null, "a day with no scenes frames nothing");
  assert.equal(spiralArrangement(dated, undefined, null, "strands").bookFrame, undefined, "a single book with no day chosen keeps its own arrival frame");
});

test("a precomputed spiral is drawn as stored: knots, cyan coils, glowing axes; newer scenes wait below it", () => {
  const knot = (id: string, k: number, lane = 0) => ({ id, x: k * 9, q: [lane * 50, 10] as [number, number] });
  const stored: TimePlaceProjection = { ...data, spiral: { builtAt: "2026-10-28T20:00:00Z", scale: { dx: 9, knot: 14, width: 900, height: 300 }, links: [], days: [],
    runs: [
      { id: "ming", lane: 0, knots: [knot("s1", 0), knot("m1", 1), knot("m2", 3), knot("s6", 5), knot("s7", 7)], track: [[0, 0, 10], [9, 3, 12], [27, 1, 9]], axis: [[0, 0, 0], [27, 0, 0]] },
      { id: "lan", lane: 0, knots: [knot("l1", 2, 1), knot("l2", 4, 1)], track: [[18, 50, 10], [36, 50, 10]], axis: [[18, 50, 0], [36, 50, 0]] },
    ] } };
  const arrangement = spiralArrangement(stored, undefined, null, "strands");
  assert.equal(arrangement.timeKey.label, "STORY SPIRAL →");
  const at = (id: string) => arrangement.anchors!.get(spiralNodeId(id))!;
  assert.ok(at("l1")[1] > at("m1")[1], "the cross-section as solved");
  assert.ok(at("fb")[1] < at("s1")[1] - 100, "a scene not in the stored spiral waits below it");
  assert.ok(Math.abs((at("m1")[0] - at("s1")[0]) - 40) < 1e-6, "a quiet story layer is one step along time");
  const draws = [...arrangement.anchors!].map(([id, point]) => ({ node: { id, chrono: 0 }, position: point.map((value) => value * 3), role: "main" }) as never);
  const paths = arrangement.paths!(draws, null);
  const tracks = paths.filter((path) => path.id.startsWith("spiral-track:")), axes = paths.filter((path) => path.strand);
  assert.deepEqual(tracks.map((track) => track.tone), ["coil", "coil"], "every coil in the design's cyan");
  assert.deepEqual(axes.map((axis) => [axis.strandId, Number(axis.weight!.toFixed(3))]), [["ming", 1], ["lan", Number(Math.sqrt(2 / 5).toFixed(3))]], "an axis glows by how much its strand matters: the busiest strand fully, a minor one less");
  const lit = arrangement.strandPeriod!("spiral-axis:lan", 0)!;
  assert.deepEqual(lit.ids, ["l1", "l2"].map(spiralNodeId), "a tap on an axis lights that strand's scenes");
  assert.equal(lit.strandId, "lan");
  // A phone opens on a stretch of time about as long as the floor box is deep, not the whole book.
  const later: TimePlaceProjection = { ...stored, spiral: { ...stored.spiral!, runs: [...stored.spiral!.runs, { id: "late", lane: 0, knots: [knot("s8", 600)], track: [], axis: [] }] } };
  const framed = (aspect: number) => { const arranged = spiralArrangement(later, undefined, null, "strands", null, aspect); return arranged.initialFrame!([...arranged.anchors!].map(([id, point]) => ({ node: { id, chrono: 0 }, position: point.map((value) => value * 3), role: "main" }) as never)).length; };
  assert.equal(framed(0.46), 7, "the late scene (and the newer one waiting after it) is left for the reader to fly to");
  assert.equal(framed(6), 9, "a very wide screen opens on more time");
});

test("a lit strand's cast: its records, its characters gathered above it, dim arcs routed in lanes", () => {
  // Invented: Ming and Lan take part in the bridge scene's events; Ming alone speaks at the port; Ren (not drawn yet) joins the bridge.
  const node = (id: string, kind: WorldNode["kind"], chrono = 0, extra: Partial<WorldNode> = {}) => ({ id, kind, label: id, chrono, state: "canon", ...extra }) as WorldNode;
  const world = { interiors: {
    "spiral:bridge": { nodes: [node("ev_meet", "event", 1), node("ev_cross", "event", 2), node("ming", "character"), node("lan", "character"), node("ren", "character"), node("loc_bridge", "location")],
      edges: [{ id: "e1", from: "ming", to: "ev_meet", relationType: "PARTICIPATES_IN" }, { id: "e2", from: "lan", to: "ev_meet", relationType: "PARTICIPATES_IN" }, { id: "e3", from: "ren", to: "ev_cross", relationType: "PARTICIPATES_IN" }] },
    "spiral:port": { nodes: [node("dl_call", "dialogue", 1, { dialogue: { participantIds: ["ming"], speakerId: "ming" } }), node("ev_idle", "event", 2), node("ming", "character")], edges: [] },
  } } as never;
  const draw = (id: string, role: OrbitalDraw["role"], position: [number, number, number]): OrbitalDraw => ({ node: node(id, role === "main" ? "scene" : "character"), position, radius: 30, role });
  const draws = [draw("spiral:bridge", "main", [0, 100, 0]), draw("spiral:port", "main", [4000, 100, 0]), draw("ming", "nebula", [90000, 0, 0]), draw("lan", "nebula", [-90000, 0, 0])];
  const cast = strandCast(world, ["spiral:bridge", "spiral:port"], draws);
  assert.deepEqual(cast.draws.filter((entry) => entry.role === "connection").map((entry) => entry.node.id).sort(), ["dl_call", "ev_cross", "ev_meet"], "events and dialogues someone takes part in; not an event nobody is in");
  assert.ok(cast.draws.some((entry) => entry.node.id === "ren" && entry.role === "nebula"), "a character not drawn yet joins beside the strand");
  for (const id of ["ming", "lan"]) {
    const [x, y] = cast.moves.get(id)!;
    assert.ok(y > 1000 && x > -2000 && x < 6000, `${id} moves from far away to just above the lit stretch`);
  }
  assert.ok(cast.moves.get("ming")![0] > cast.moves.get("lan")![0], "Ming sits over the middle of the scenes she is in (both), Lan over the bridge");
  assert.deepEqual(cast.arcs.map((arc) => `${arc.from}>${arc.to}`).sort(), ["lan>ev_meet", "ming>dl_call", "ming>ev_meet", "ren>ev_cross"]);
  assert.ok(cast.arcs.every((arc) => arc.participation && arc.bend), "dim participation arcs, bent like the causal arcs");
  const ming = cast.arcs.filter((arc) => arc.from === "ming").map((arc) => Math.hypot(...arc.bend!));
  assert.notEqual(Math.round(ming[0]), Math.round(ming[1]), "one character's overlapping arcs take different lanes");
  assert.deepEqual(new Set(cast.ids), new Set(["ev_meet", "ev_cross", "dl_call", "ming", "lan", "ren"]));
});
