import test from "node:test";
import assert from "node:assert/strict";
import { fromBundles, type VolumeBundle } from "../apps/playground/src/data/castBundle.js";
import { castArrangement, castCharacterId, castNodeId, castWorld } from "../apps/playground/src/data/orbitalCast.js";
import { TIER_HEIGHT, characterWeb, communities, pairHistory, webLayout, webLayout3d, type WebEdge } from "../apps/playground/src/data/castWeb.js";

// Two invented volumes in bundle shape. Each workspace numbers its own ids, so
// "c1" is a different person in each volume unless a name joins them.
const character = (id: string, ...names: string[]) => ({ id, kind: "Character", names: names.map((text, index) => ({ text, kind: index ? "alias" : "canonical" })) });
const event = (id: string, sceneId: string, actors: string[], affected: string[] = [], importance = 0.8) => ({ id, chapterIndex: 0, summary: `${id} happens`, importance, primaryActors: actors, affectedCharacters: affected, sceneId });
const volumeOne: VolumeBundle = {
  volume: 1, label: "Volume 1",
  entities: [character("c1", "Aya", "Ay"), character("c2", "Bo"), character("c3", "Cid"), character("c4", "Dee"), character("c5", "Eli"), { id: "l1", kind: "Location", names: [{ text: "Harbor", kind: "canonical" }] }],
  scenes: [
    { id: "s1", chapterIndex: 0, charactersPresent: ["c1"], charactersMentioned: ["c3"], locationId: "l1", summary: "Aya at the harbor. Later.", dialogues: [{ id: "d1", participantIds: ["c1", "c2"] }] },
    { id: "s2", chapterIndex: 0, charactersPresent: [], charactersMentioned: [], locationId: null },
    { id: "s3", chapterIndex: 1, charactersPresent: ["c3", "c4"], charactersMentioned: [], locationId: null, summary: "Cid and Dee" },
    { id: "s4", chapterIndex: 1, charactersPresent: ["c4", "c5"], charactersMentioned: ["c1"], locationId: null, summary: "Dee and Eli" },
  ],
  events: [event("e1", "s1", ["c1"], ["c2"]), event("e2", "s2", ["c2"], ["c1"], 0.9), event("e3", "s3", ["c3"], ["c4"]), event("e4", "s4", ["c4", "c5"]), event("e5", "s1", ["c1"], ["c2"], 0.4)],
  stateChanges: [{ id: "x1", characterId: "c1", afterEventId: "e1", relationships: { c2: -0.4 } }, { id: "x2", characterId: "c2", afterEventId: "e2", relationships: { c1: 0.9 } }],
  causes: [{ fromId: "e1", toId: "e2" }],
  portraits: [{ entityId: "c1" }],
};
const volumeTwo: VolumeBundle = {
  volume: 2, label: "Volume 2",
  entities: [character("c1", "Bo"), character("c2", "Fen")],
  scenes: [{ id: "s1", chapterIndex: 0, charactersPresent: ["c1", "c2"], charactersMentioned: [], locationId: null, summary: "Bo meets Fen" }],
  events: [event("e1", "s1", ["c1"], ["c2"])],
  stateChanges: [], causes: [], portraits: [],
};

test("bundles become the web's input: namespaced ids, scene casts from events, cards, deltas and causes", () => {
  const data = fromBundles([volumeOne], "volume", (volume, id) => `p/${volume}/${id}`);
  assert.deepEqual(data.characters.map((entry) => entry.id), ["v1:c1", "v1:c2", "v1:c3", "v1:c4", "v1:c5"]);
  assert.equal(data.characters[0].portrait, "p/1/c1");
  assert.deepEqual(data.characters[0].names, ["Aya", "Ay"]);
  const [s1, s2] = data.scenes;
  assert.deepEqual(s1.present.sort(), ["v1:c1", "v1:c2"], "an affected character is in the scene");
  assert.equal(s1.place, "Harbor");
  assert.equal(s1.title, "Aya at the harbor");
  assert.equal(s2.title, "e2 happens", "a scene without a summary is titled by its main event");
  assert.deepEqual(s2.present.sort(), ["v1:c1", "v1:c2"], "a scene without a recorded cast takes its events' people");
  assert.equal(data.events.find((entry) => entry.id === "v1:e2")?.sceneId, "v1:s2");
  assert.deepEqual(data.cards.map((card) => card.id), ["v1:s1:d1"]);
  assert.deepEqual(data.deltas.map((delta) => [delta.characterId, delta.towardId, delta.delta]), [["v1:c1", "v1:c2", -0.4], ["v1:c2", "v1:c1", 0.9]]);
  assert.deepEqual(data.causes, [{ from: "v1:e1", to: "v1:e2" }]);
});

test("volumes stay apart by default and join only by a shared name in series view", () => {
  assert.equal(fromBundles([volumeOne, volumeTwo]).characters.length, 7);
  const series = fromBundles([volumeOne, volumeTwo], "series-by-name");
  assert.equal(series.characters.length, 6);
  assert.deepEqual(series.characters.find((entry) => entry.id === "v1:c2")?.volumes, [1, 2]);
  assert.ok(series.scenes.find((scene) => scene.id === "v2:s1")?.present.includes("v1:c2"));
});

test("the web: ties say what they are made of, scores show their parts, layout places everyone", () => {
  const data = fromBundles([volumeOne]);
  const web = characterWeb(data);
  const aya = web.byId.get("v1:c1")!, bo = web.byId.get("v1:c2")!;
  const tie = web.edges.find((edge) => edge.id === "v1:c1|v1:c2")!;
  assert.deepEqual([tie.scenes, tie.cards, tie.coActing, tie.affinity, tie.tone], [2, 1, 3, 0.5, "bond"]);
  assert.equal(aya.rank, 1);
  assert.equal(aya.raw.influence, 3, "two people affected by her actions, one event downstream");
  assert.equal(aya.raw.scenes, 2);
  assert.equal(aya.raw.mentionedIn, 1);
  assert.ok(Math.abs(aya.score - Object.entries(aya.breakdown).reduce((sum, [part, value]) => sum + ({ presence: 0.25, agency: 0.2, reach: 0.2, influence: 0.2, bridging: 0.15 } as Record<string, number>)[part] * value, 0)) < 0.002);
  assert.ok(bo.community === aya.community && web.byId.get("v1:c4")!.community !== aya.community, "two groups of characters");
  const layout = webLayout(web);
  assert.equal(layout.size, web.nodes.length);
  assert.ok([...layout.values()].every((point) => Math.hypot(point.x, point.y) <= 0.9));
  // 3D keeps the flat plan and lifts each tier to its step, the stronger a little higher.
  const lifted = webLayout3d(web);
  for (const node of web.nodes) {
    const flat = layout.get(node.id)!, raised = lifted.get(node.id)!;
    assert.deepEqual([raised.x, raised.z, raised.r], [flat.x, flat.y, flat.r]);
    assert.ok(raised.y >= TIER_HEIGHT[node.tier] && raised.y <= TIER_HEIGHT[node.tier] + 0.08);
  }
  const top = web.nodes.filter((node) => node.tier === "protagonist").map((node) => lifted.get(node.id)!.y);
  const rest = web.nodes.filter((node) => node.tier !== "protagonist").map((node) => lifted.get(node.id)!.y);
  if (top.length && rest.length) assert.ok(Math.min(...top) > Math.max(...rest), "protagonists stand on the top step");
});

test("the web grows with the story: scope cuts scenes, and a pair's log keeps its running affinity", () => {
  const data = fromBundles([volumeOne]);
  assert.equal(characterWeb(data, { until: 1 }).edges.length, 1);
  const early = characterWeb(data, { until: 2 });
  assert.ok(!early.byId.has("v1:c5"), "a character not yet in the story is not ranked");
  const history = pairHistory(data, "v1:c1", "v1:c2");
  assert.deepEqual(history.entries.map((entry) => [entry.scene.id, entry.kind, entry.affinity]), [["v1:s1", "met", -0.4], ["v1:s2", "shift", 0.5]]);
  assert.equal(history.together, 2);
  assert.equal(history.turning?.scene.id, "v1:s2");
  assert.deepEqual(history.names, { "v1:c1": "Aya", "v1:c2": "Bo" }, "a pair is named even before either is in the web");
  const mention = pairHistory(data, "v1:c1", "v1:c3").entries[0];
  assert.deepEqual([mention.kind, mention.speaker], ["mentioned", "v1:c1"]);
});

test("communities: a hub joins the group it shares most with instead of absorbing everyone", () => {
  const tie = (a: string, b: string, weight: number): WebEdge => ({ id: `${a}|${b}`, a, b, weight, scenes: 0, cards: 0, coActing: 0, mentions: 0, affinity: 0, tone: "neutral", first: 0, last: 0 });
  const groups = communities(["hub", "a1", "a2", "b1", "b2"], [tie("hub", "a1", 5), tie("hub", "a2", 5), tie("a1", "a2", 5), tie("b1", "b2", 6), tie("hub", "b1", 1)]);
  assert.equal(groups.get("hub"), groups.get("a1"));
  assert.notEqual(groups.get("hub"), groups.get("b1"));
  assert.equal(groups.get("b1"), groups.get("b2"));
});

test("the live snapshot's cast keeps provenance at home: events carry their scene, never sentence ids or quotes", async (t) => {
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { pathToFileURL } = await import("node:url");
  const directory = await mkdtemp(join(tmpdir(), "novel-cast-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  await mkdir(join(directory, "ontology"));
  await writeFile(join(directory, "ontology", "state-changes.jsonl"), [
    { id: "x1", characterId: "c1", afterEventId: "e1", emotions: { joy: 0.2 }, relationships: { c2: 0.3 } },
    { id: "x2", characterId: "c2", afterEventId: "e1", emotions: { fear: 0.4 }, relationships: {} },
  ].map((row) => JSON.stringify(row)).join("\n") + "\n");
  const { castProjection } = await import(pathToFileURL(join(process.cwd(), "tools/pi-review/cast.mjs")).href);
  const cast = await castProjection(directory, {
    volume: 3,
    entities: [{ id: "c1", kind: "Character", names: [{ text: "Aya", kind: "canonical", lang: "en" }] }, { id: "i1", kind: "Item", names: [{ text: "Key", kind: "canonical" }] }],
    scenes: [{ id: "s1", chapterIndex: 2, sentenceIds: ["t1", "t2"], charactersPresent: ["c1"], charactersMentioned: [], locationId: null, summary: "Aya waits", dialogues: [{ id: "d1", participantIds: ["c1", "c2"], sentenceIds: ["t2"] }] }],
    events: [{ id: "e1", chapterIndex: 2, summaryEn: "Aya opens the door", importance: 0.7, primaryActors: ["c1"], affectedCharacters: ["c2"], evidence: { text: "a private quote", sentenceIds: ["t2"] } }],
    relations: [{ type: "CAUSES", fromId: "e0", toId: "e1" }, { type: "PRESENT_IN", fromId: "c1", toId: "s1" }],
  });
  const text = JSON.stringify(cast);
  assert.ok(!text.includes("sentenceIds") && !text.includes("private quote"));
  assert.equal(cast.events[0].sceneId, "s1");
  assert.deepEqual(cast.entities.map((entity: { id: string }) => entity.id), ["c1"], "only characters and places travel");
  assert.deepEqual(cast.stateChanges.map((change: { id: string }) => change.id), ["x1"], "only relationship deltas travel");
  assert.deepEqual(cast.causes, [{ fromId: "e0", toId: "e1" }]);
  assert.equal(fromBundles([cast]).events[0].sceneId, "v3:s1");
});

test("orbital Characters: one sphere per character holding their scenes, on the steps, with ties as orbit paths", () => {
  const data = fromBundles([volumeOne]);
  const web = characterWeb(data);
  // The book's world as the snapshot has it: chapter interiors with scenes and the records they contain.
  const scene = (id: string) => ({ id, label: id, kind: "scene" as const, state: "canon" as const, parent: "ch", lane: "canon" as const, chrono: 0, lanePos: [0, 0, 0] as [number, number, number], interiorPos: [0, 0, 0] as [number, number, number] });
  const world = { interiors: { ch: { nodes: [scene("s1"), scene("s2"), scene("s4"), { ...scene("e1"), kind: "event" as const }], edges: [{ id: "c1", from: "s1", to: "e1", kind: "contains" as const, state: "canon" as const, parent: "ch" }] } } };
  const regrouped = castWorld(world as never, web);
  assert.deepEqual(regrouped.laneNodes.map((node) => node.id), web.nodes.map((node) => castNodeId(node.id)));
  const aya = regrouped.interiors[castNodeId("v1:c1")];
  assert.deepEqual(aya.nodes.map((node) => node.id).sort(), ["e1", "s1", "s2"], "her scenes and what they hold, nothing else");
  assert.ok(aya.nodes.every((node) => node.parent === castNodeId("v1:c1")));
  assert.equal(castCharacterId(castNodeId("v1:c1")), "v1:c1");
  const arrangement = castArrangement(web);
  const heights = web.nodes.map((node) => [node.tier, arrangement.anchors!.get(castNodeId(node.id))![1]] as const);
  const top = Math.min(...heights.filter(([tier]) => tier === "protagonist").map(([, y]) => y));
  assert.ok(heights.filter(([tier]) => tier !== "protagonist").every(([, y]) => y < top), "protagonists on the top step");
  const draws = web.nodes.map((node) => ({ node: { id: castNodeId(node.id) }, position: arrangement.anchors!.get(castNodeId(node.id))!.map((value) => value * 3) as [number, number, number] })) as never[];
  assert.ok(arrangement.paths!(draws, null).every((path) => path.tone === "link"), "at rest, the strongest ties are faint links");
  const mine = arrangement.paths!(draws, castNodeId("v1:c1"));
  assert.ok(mine.length > 0 && mine.every((path) => path.tone === "link" && path.id.includes("v1:c1")), "a selected character shows only its own ties, still thin");
  const watched = castArrangement(web, { pair: ["v1:c1", "v1:c2"], watching: true }).paths!(draws, null);
  assert.equal(watched.find((path) => path.id === "pair:v1:c1|v1:c2")?.tone, "route", "a watched pair's tie carries the moving bead");
  assert.equal(castArrangement(web, { pair: ["v1:c1", "v1:c2"] }).paths!(draws, null).find((path) => path.id.startsWith("pair:"))?.tone, "thread");
});

test("a journey narrows Story time and Places to one character's scenes, in a book or a universe", async () => {
  const { journeyCharacter, journeyProjection } = await import("../apps/playground/src/data/journey.js");
  const scene = (id: string) => ({ id, index: 0, chapterIndex: 0, label: id, times: [], flashback: false, placeIds: [], placeCarried: false, characterIds: [] });
  const book = { available: true, times: [], scenes: ["s1", "s2", "s3"].map(scene), places: [], characters: [{ id: "c1", label: "Aya", scenes: 2 }], names: {} };
  const journey = { volume: 2, characterId: "c1", label: "Aya", sceneIds: ["s1", "s3"] };
  assert.deepEqual(journeyProjection(book, journey).scenes.map((entry) => entry.id), ["s1", "s3"]);
  assert.equal(journeyCharacter(book, journey), "c1");
  // A universe prefixes the book's ids with its volume; another book's scenes never join.
  const universe = { ...book, scope: "universe" as const, scenes: ["2:s1", "2:s2", "3:s1"].map(scene), characters: [{ id: "2:c1", label: "Aya", scenes: 1 }] };
  assert.deepEqual(journeyProjection(universe, journey).scenes.map((entry) => entry.id), ["2:s1"]);
  assert.equal(journeyCharacter(universe, journey), "2:c1");
  assert.equal(journeyCharacter({ ...book, characters: [] }, journey), null);
});

test("a journey tunnel: their scenes along the axis in story order, each place on its own side, chapter rings and one route", async () => {
  const { journeyArrangement, journeyNodeId, journeyScenes, journeyWorld, placeBearings } = await import("../apps/playground/src/data/orbitalJourney.js");
  const data = fromBundles([volumeOne]);
  const steps = journeyScenes(data, "v1:c1");
  assert.deepEqual(steps.map((step) => step.id), ["v1:s1", "v1:s2"], "every scene she is in, in reading order without story time");
  assert.equal(steps[0].place, "Harbor");
  assert.deepEqual(steps[0].others, ["Bo"]);
  assert.ok(steps[0].events.length === 2 && steps[1].events.length === 1);
  // Story order, when known, outranks reading order.
  assert.deepEqual(journeyScenes(data, "v1:c1", (id) => (id === "s2" ? 0 : 1)).map((step) => step.id), ["v1:s2", "v1:s1"]);
  const world = journeyWorld({ interiors: { ch: { nodes: [{ id: "s1", kind: "scene" }, { id: "e1", kind: "event" }], edges: [{ id: "x", from: "s1", to: "e1", kind: "contains" }] } } } as never, steps, "Aya");
  assert.deepEqual(world.laneNodes.map((node) => node.id), steps.map((step) => journeyNodeId(step.id)));
  assert.deepEqual(world.interiors[journeyNodeId("v1:s1")].nodes.map((node) => node.id), ["e1"], "inside a scene sphere: its records");
  const tunnel = [{ ...steps[0], place: "Harbor", chapter: 0 }, { ...steps[1], id: "b", place: "Hill", chapter: 0 }, { ...steps[1], id: "c", place: "Harbor", chapter: 1 }];
  const arrangement = journeyArrangement(tunnel, "Aya");
  const [a, b, c] = tunnel.map((step) => arrangement.anchors!.get(journeyNodeId(step.id))!);
  assert.ok(a[2] > b[2] && b[2] > c[2], "time runs down the axis");
  const side = (point: number[]) => Math.atan2(point[1], point[0]);
  assert.ok(Math.abs(side(a) - side(c)) < 0.4 && Math.abs(side(a) - side(b)) > 1, "a return to a place comes back on its side");
  assert.equal(placeBearings(tunnel).size, 2);
  const paths = arrangement.paths!(tunnel.map((step) => ({ node: { id: journeyNodeId(step.id) }, position: arrangement.anchors!.get(journeyNodeId(step.id))!.map((value) => value * 3) })) as never[], null);
  assert.deepEqual(paths.filter((path) => path.id.startsWith("journey-ring")).length, 2, "a ring where each chapter begins");
  assert.equal(paths.find((path) => path.id === "journey-route")?.points.length, 3);
});
