import { test } from "node:test";
import assert from "node:assert/strict";
import { isConflict, journeyScript, placeScript, quoteOf, speakerOf } from "../apps/playground/src/data/holoScript.js";
import type { StoryPlace, StoryScene, TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";
import type { WorldEdge, WorldNode } from "../apps/playground/src/types.js";

// Invented: Mira and Tomas meet in an old tower, quarrel, then Mira goes to the harbour.
const node = (id: string, kind: WorldNode["kind"], label: string, chrono = 0, extra: Partial<WorldNode> = {}): WorldNode =>
  ({ id, label, kind, state: "canon", parent: "chapter_1", lane: "canon", chrono, lanePos: [0, 0, 0], interiorPos: [0, 0, 0], summary: label, ...extra });
const edge = (from: string, to: string, kind: WorldEdge["kind"], extra: Partial<WorldEdge> = {}): WorldEdge => ({ id: `${from}:${to}`, from, to, kind, state: "canon", parent: "chapter_1", ...extra });
const world = { interiors: { chapter_1: {
  nodes: [
    node("mira", "character", "Mira Vale"), node("tomas", "character", "Tomas Reed"),
    node("s1", "scene", "Mira and Tomas climb the tower", 1), node("s2", "scene", "Mira at the harbour", 10),
    node("e1", "event", "Mira finds a lantern on the stairs.", 2),
    node("card", "dialogue", "Tomas asks “why did you come back?”", 3, { id: "view-card:s1:0", dialogue: { participantIds: ["tomas", "mira"], participantLabels: ["Tomas Reed", "Mira Vale"] } }),
    node("e2", "event", "Tomas asks “why did you come back?”", 3),
    node("e3", "event", "They argue and Tomas shoves the door shut.", 4),
    node("e4", "event", "Mira waits for the ferry.", 11),
  ],
  edges: [
    edge("mira", "s1", "contains", { relationLabel: "Present in scene" }), edge("tomas", "s1", "contains", { relationLabel: "Present in scene" }),
    edge("mira", "s2", "contains", { relationLabel: "Present in scene" }),
    ...["e1", "e2", "e3"].map((id) => edge("s1", id, "contains")), edge("s2", "e4", "contains"),
    edge("tomas", "e3", "speaks", { relationType: "PARTICIPATES_IN" }),
  ],
} } };
const scene = (id: string, index: number, place: string, characterIds: string[]): StoryScene => ({ id, index, chapterIndex: 1, label: id, times: [], flashback: false, placeIds: [place], placeCarried: false, characterIds });
const place = (id: string, label: string, sceneIds: string[]): StoryPlace => ({ id, label, sceneIds, statedScenes: sceneIds.length, characterIds: [], path: [id] });
const data: TimePlaceProjection = {
  available: true, times: [], characters: [], names: { tower: "Old Tower", harbour: "Harbour Market", mira: "Mira Vale", tomas: "Tomas Reed" },
  places: [place("tower", "Old Tower", ["s1"]), place("harbour", "Harbour Market", ["s2"])],
  scenes: [scene("s1", 0, "tower", ["mira", "tomas"]), scene("s2", 1, "harbour", ["mira"])],
};

test("a place's stage: a title card per scene, then its records in reading order", () => {
  const script = placeScript(data, world, "tower");
  assert.equal(script.title, "Old Tower");
  assert.equal(script.places[0].kind, "skyscraper");
  assert.deepEqual(script.beats.map((beat) => beat.kind), ["scene", "event", "dialogue", "event"], "the card and the event telling the same line are one dialogue beat");
  const [card, find, line, shove] = script.beats;
  assert.deepEqual(card.present.sort(), ["mira", "tomas"]);
  assert.deepEqual(find.actors, ["mira"], "a record names its people");
  assert.equal(line.actors[0], "tomas", "the speaker leads a dialogue beat");
  assert.equal(line.quote, "why did you come back?");
  assert.ok(shove.conflict && shove.actors.includes("tomas"));
  assert.deepEqual(script.actors.map((actor) => actor.id), ["tomas", "mira"].sort((a, b) => script.actors.findIndex((x) => x.id === a) - script.actors.findIndex((x) => x.id === b)));
});

test("the journey: travel beats when someone's next scene is elsewhere", () => {
  const script = journeyScript(data);
  assert.deepEqual(script.places.map((entry) => [entry.label, entry.kind]), [["Old Tower", "skyscraper"], ["Harbour Market", "market"]]);
  const travel = script.beats.filter((beat) => beat.kind === "travel");
  assert.equal(travel.length, 1);
  assert.deepEqual([travel[0].from, travel[0].placeId, travel[0].actors], ["tower", "harbour", ["mira"]]);
  assert.ok(script.beats.indexOf(travel[0]) < script.beats.findIndex((beat) => beat.id === "scene:s2"), "the trip comes before the scene it leads to");
});

test("conflict and quotes are read from the text", () => {
  assert.ok(isConflict("滨面拼命冲下楼梯") && isConflict("They fight on the roof"));
  assert.ok(!isConflict("白井与大叔看到方形箱子"));
  assert.equal(quoteOf("喊道“把这扇门打开”"), "把这扇门打开");
  assert.equal(quoteOf("他就是“恶宠饲养家”"), undefined, "a quoted name is not speech");
  assert.equal(quoteOf("no quote here"), undefined);
});

test("the speaker is whoever the text names just before the speech verb, not the card's first name", () => {
  const labels: Record<string, string> = { kuroko: "白井黑子", karei: "碧海华丽" };
  assert.equal(speakerOf("背对电视而坐的女性以“恶宠饲养家”碧海华丽之名开口，抱怨上面", ["kuroko", "karei"], (id) => labels[id]), "karei");
  assert.equal(speakerOf("白井黑子回应碧海，叫她别动。", ["karei", "kuroko"], (id) => labels[id]), "kuroko");
  assert.equal(speakerOf("两人沉默不语。", ["kuroko"], (id) => labels[id]), undefined, "no speech verb, no guess");
});
