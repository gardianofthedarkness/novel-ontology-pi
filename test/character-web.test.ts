import test from "node:test";
import assert from "node:assert/strict";
import { fromBundles, type VolumeBundle } from "../apps/playground/character-web/src/model/bundle.js";
import { characterWeb, communities, pairHistory, webLayout, type WebEdge } from "../apps/playground/character-web/src/model/web.js";

// Two invented volumes in bundle shape. Each workspace numbers its own ids, so
// "c1" is a different person in each volume unless a name joins them.
const character = (id: string, ...names: string[]) => ({ id, kind: "Character", names: names.map((text, index) => ({ text, kind: index ? "alias" : "canonical" })) });
const event = (id: string, sentence: string, actors: string[], affected: string[] = [], importance = 0.8) => ({ id, chapterIndex: 0, summary: `${id} happens`, importance, primaryActors: actors, affectedCharacters: affected, sentenceIds: [sentence] });
const volumeOne: VolumeBundle = {
  volume: 1, label: "Volume 1",
  entities: [character("c1", "Aya", "Ay"), character("c2", "Bo"), character("c3", "Cid"), character("c4", "Dee"), character("c5", "Eli"), { id: "l1", kind: "Location", names: [{ text: "Harbor", kind: "canonical" }] }],
  scenes: [
    { id: "s1", chapterIndex: 0, charactersPresent: ["c1"], charactersMentioned: ["c3"], locationId: "l1", summary: "Aya at the harbor. Later.", dialogues: [{ id: "d1", participantIds: ["c1", "c2"] }] },
    { id: "s2", chapterIndex: 0, charactersPresent: [], charactersMentioned: [], locationId: null },
    { id: "s3", chapterIndex: 1, charactersPresent: ["c3", "c4"], charactersMentioned: [], locationId: null, summary: "Cid and Dee" },
    { id: "s4", chapterIndex: 1, charactersPresent: ["c4", "c5"], charactersMentioned: ["c1"], locationId: null, summary: "Dee and Eli" },
  ],
  events: [event("e1", "t1", ["c1"], ["c2"]), event("e2", "t2", ["c2"], ["c1"], 0.9), event("e3", "t3", ["c3"], ["c4"]), event("e4", "t4", ["c4", "c5"]), event("e5", "t1", ["c1"], ["c2"], 0.4)],
  sceneOfSentence: { t1: "s1", t2: "s2", t3: "s3", t4: "s4" },
  stateChanges: [{ id: "x1", characterId: "c1", afterEventId: "e1", relationships: { c2: -0.4 } }, { id: "x2", characterId: "c2", afterEventId: "e2", relationships: { c1: 0.9 } }],
  causes: [{ fromId: "e1", toId: "e2" }],
  portraits: [{ entityId: "c1" }],
};
const volumeTwo: VolumeBundle = {
  volume: 2, label: "Volume 2",
  entities: [character("c1", "Bo"), character("c2", "Fen")],
  scenes: [{ id: "s1", chapterIndex: 0, charactersPresent: ["c1", "c2"], charactersMentioned: [], locationId: null, summary: "Bo meets Fen" }],
  events: [event("e1", "t1", ["c1"], ["c2"])],
  sceneOfSentence: { t1: "s1" }, stateChanges: [], causes: [], portraits: [],
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
