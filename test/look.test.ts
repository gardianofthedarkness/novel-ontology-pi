// The look pass's context (milestones M14): the place tree top down, each place's telling sentences (environment first,
// then what names something a setting answers), the words counted, a model of the universe found by its label in the
// text, the keys a place may set; --place narrows to one place and its children. Inputs injected: no reading on disk.
import { test } from "node:test";
import assert from "node:assert/strict";
import { lookContext } from "../src/cli/commands/extract/lookCommands.js";

const inputs = {
  places: [
    { id: "city", label: "Academy City", parentId: null, sceneIds: ["s1"] },
    { id: "district7", label: "District 7", parentId: "city", sceneIds: ["s2", "s3"] },
    { id: "london", label: "London", parentId: null, sceneIds: ["s4"] },
    { id: "nowhere", label: "Nowhere", parentId: null, sceneIds: [] },
  ],
  scenes: [{ id: "s1", sentences: ["a1", "a2"] }, { id: "s2", sentences: ["b1", "b2"] }, { id: "s3", sentences: ["c1"] }, { id: "s4", sentences: ["d1", "d2"] }],
  kinds: { a1: { kind: "environment" }, a2: { kind: "spoken" }, b1: { kind: "environment" }, b2: { kind: "narration" }, c1: { kind: "fact" }, d1: { kind: "environment" }, d2: { kind: "thought" } },
};
const sentences = new Map([
  ["a1", { text: "Wind turbines turned over every roof of the city, white blades against the clouds." }],
  ["a2", { text: "\"Hurry up,\" she said." }],
  ["b1", { text: "The wide avenue ran between glass towers, lamps already lit." }],
  ["b2", { text: "A bus crawled past the park where the trees were bare." }],
  ["c1", { text: "The subway under District 7 opened in spring." }],
  ["d1", { text: "Rain over the Thames, the bridge grey and empty." }],
  ["d2", { text: "She wondered why." }],
]);
const parts = [{ ref: "own:wind_turbine", source: "own", name: "wind_turbine", category: "a robot or a machine", footprint: [8, 27] as [number, number], height: 38, triangles: 300, ok: true, note: "Wind turbines (wind turbine) stylised", id: "m1", unit: "m" as const }];

test("the tree is top down, a place's environment sentences come first, the words are counted and the universe's own model is found by its label", async () => {
  const out = await lookContext("/nowhere/vol-1/novel", { inputs, sentences, parts, top: 3 });
  assert.deepEqual((out.tree as { id: string }[]).map((place) => place.id), ["city", "district7", "london"], "roots by their scenes, children under their parent, a place with no scenes left out");
  const city = out.tree[0] as { environment: { id: string; kind: string; words: string[] }[]; words: Record<string, number>; parts: { ref: string }[]; depth: number; scenesBelow: number };
  assert.equal(city.depth, 0); assert.equal(city.scenesBelow, 2);
  assert.equal(city.environment[0].id, "a1"); assert.deepEqual(city.environment[0].words.sort(), ["sky", "turbine"]);
  assert.equal(city.words.turbine, 1); assert.equal(city.parts[0]?.ref, "own:wind_turbine", "the model named in the text, by its label");
  const district = out.tree[1] as { environment: { id: string; kind: string }[]; depth: number };
  assert.equal(district.depth, 1); assert.deepEqual(district.environment.map((row) => row.id), ["b1", "b2", "c1"], "environment first, then narration and facts that name something settable");
  assert.ok(out.settable.place.includes("fill.ops") && out.settable.book.includes("fill.streets") && !out.settable.place.includes("talk.earshot"));
  assert.equal(out.book.words.turbine, 1); assert.equal(out.book.parts[0]?.ref, "own:wind_turbine");
});

test("--place narrows to one place and its children; an unknown place is refused", async () => {
  const out = await lookContext("/nowhere/vol-1/novel", { inputs, sentences, parts, place: "city" });
  assert.deepEqual((out.tree as { id: string }[]).map((place) => place.id), ["city", "district7"]);
  await assert.rejects(lookContext("/nowhere/vol-1/novel", { inputs, sentences, parts, place: "mars" }), /No place mars/);
});
