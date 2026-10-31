import assert from "node:assert/strict";
import { test } from "node:test";
import { compose, type Mode } from "../src/v2/context/engine.js";

type Focus = { asked: string[]; ambiguity: number };
type Stores = { facts: { id: string; text: string; score: number }[] };
const mode: Mode<Focus, Stores> = {
  name: "test",
  task: "a task",
  sources: [
    { name: "asked", key: "asked", quota: 0, keep: true, collect: (focus) => focus.asked.map((id) => ({ id, score: 1, fields: { text: `about ${id}` } })) },
    { name: "facts", key: "facts", quota: 4, collect: (_focus, stores) => stores.facts.map((fact) => ({ id: fact.id, score: fact.score, fields: fact.text })) },
  ],
  cutOrder: ["facts"],
  probe: (focus) => ({ ambiguity: focus.ambiguity }),
  questions: (focus) => focus.asked.map((id) => ({ key: `test:${id}`, primitive: "choice" as const, instructions: `Which ${id}?`, options: ["a", "b"] })),
  budget: 10_000,
};
const facts = Array.from({ length: 8 }, (_, n) => ({ id: `f${n + 1}`, text: "x".repeat(100), score: n }));

test("the context engine: quotas scaled by the complexity, the budget cut weakest first in the mode's order, the focus never cut, all of it in the manifest; the same input gives the same document", async () => {
  const calm = await compose(mode, { asked: ["q1"], ambiguity: 0 }, { facts });
  assert.deepEqual(Object.keys(calm.state.facts as object), ["f8", "f7", "f6"], "a simple focus: three quarters of the quota, the strongest first");
  assert.deepEqual([calm.manifest.complexity, calm.manifest.scale], [0, 0.75]);
  const hard = await compose(mode, { asked: ["q1"], ambiguity: 1 }, { facts });
  assert.equal(Object.keys(hard.state.facts as object).length, 6, "the hardest: one and a half times");
  const tight = await compose(mode, { asked: ["q1", "q2"], ambiguity: 1 }, { facts }, { budget: 400 });
  assert.ok(tight.manifest.used <= 400 || !Object.keys(tight.state.facts ?? {}).length);
  assert.deepEqual(Object.keys(tight.state.asked as object), ["q1", "q2"], "the focus is never cut");
  assert.ok(tight.manifest.entries.filter((entry) => entry.cut === "budget").every((entry) => entry.source === "facts"), "cut only from the mode's cut order");
  const kept = Object.keys((tight.state.facts ?? {}) as object), cut = tight.manifest.entries.filter((entry) => entry.cut === "budget").map((entry) => entry.id);
  assert.ok(cut.length && kept.every((id) => cut.every((other) => Number(id.slice(1)) > Number(other.slice(1)))), "the weakest go first");
  assert.equal(tight.manifest.entries.filter((entry) => entry.cut === "quota").length, 2, "and what the quota left out is recorded too");
  assert.deepEqual(tight.questions.map((q) => q.key), ["test:q1", "test:q2"]);
  assert.equal(JSON.stringify(await compose(mode, { asked: ["q1", "q2"], ambiguity: 1 }, { facts }, { budget: 400 })), JSON.stringify(tight), "deterministic");
});

test("the engine for every Jev request: a task from the focus, a ranked source in its own order, a key always there, a mode's own render, and ask() recording the manifest", async () => {
  const { ask } = await import("../src/v2/context/engine.js");
  const ranked: Mode<{ ids: string[] }, null> = {
    name: "ranked", task: (focus) => `${focus.ids.length} asked`, budget: 10_000, cutOrder: [],
    sources: [
      { name: "said", key: "said", quota: 2, ranked: true, collect: (focus) => focus.ids.map((id, n) => ({ id, score: n, fields: id })) },
      { name: "none", key: "none", quota: 4, always: true, collect: () => [] },
    ],
    questions: (focus) => [{ key: "q", primitive: "choice", instructions: "Which?", options: focus.ids }],
    render: (state) => `${state.task}: ${Object.keys(state.said as object).join(", ")}`,
  };
  const composed = await compose(ranked, { ids: ["c", "a", "b"] }, null);
  assert.deepEqual(composed.state, { task: "3 asked", said: { c: "c", a: "a" }, none: {} }, "the recommender's order, its quota scaled to 2 × 0.75; the empty key kept");
  assert.equal(composed.document, "3 asked: c, a");
  const manifests: unknown[] = [], sent: unknown[] = [];
  const decide = Object.assign(async (state: unknown, questions: unknown, request?: unknown) => { sent.push([state, questions, request]); return [{ key: "q", value: "a", confidence: 1 }]; }, { record: (manifest: unknown) => manifests.push(manifest) });
  const { replies } = await ask(decide as never, ranked, { ids: ["c", "a", "b"] }, null, { request: { images: {} } });
  assert.deepEqual([replies[0].value, manifests.length, (sent[0] as unknown[])[0], (sent[0] as unknown[])[2]], ["a", 1, "3 asked: c, a", { images: {} }]);
});

test("terrain's ground: what stands in the part, the place holding it and its city, the facts by Cypher (those about it alone first), its city's surroundings but not another district's", async () => {
  const T = await import("../src/v2/context/terrainModes.js");
  const label = (id: string) => ({ city: "City", d7: "District Seven", d6: "District Six", tokyo: "Tokyo" })[id] ?? id;
  const parentOf = (id: string) => ({ d7: "city", d6: "city", city: "tokyo" })[id] ?? null;
  const sentences = [
    { id: "s1", text: "The station square of District Seven is busy." },
    { id: "s2", text: "City holds the science of the world." },
    { id: "s3", text: "A tower of fifty floors stands in City." },
    { id: "s4", text: "The wind turbines of the city turn slowly." },
    { id: "s5", text: "District Six is a park of a whole district." },
    { id: "s6", text: "City." },
  ];
  const stores = await T.terrainStores({
    entities: [{ id: "city", name: "City", kind: "place" }, { id: "d7", name: "District Seven", kind: "place" }, { id: "d6", name: "District Six", kind: "place" }, { id: "tokyo", name: "Tokyo", kind: "place" }, { id: "p1", name: "someone", kind: "person" }],
    facts: [{ id: "f1", order: 1, sentences: ["s2"], about: [{ id: "city" }] }, { id: "f2", order: 2, sentences: ["s3"], about: [{ id: "city" }, { id: "p1" }] }, { id: "f3", order: 3, sentences: ["s6"], about: [{ id: "city" }] }],
    slots: [{ label: "dormitory", kind: "building", in: "d7" }, { label: "tower of fifty floors", kind: "building", in: "city" }, { label: "tower of fifty floors", kind: "building", in: "city" }, { label: "office", kind: "room", in: "city" }],
    settings: [{ scene: "a", place: "d7" }, { scene: "b", place: "city" }, { scene: "c", place: "d6" }],
    scenes: [{ id: "a", index: 0, environment: [] }, { id: "b", index: 1, environment: [{ id: "environment:s4", first: "s4", text: sentences[3].text }] }, { id: "c", index: 2, environment: [{ id: "environment:s5", first: "s5", text: sentences[4].text }] }],
  }, sentences, parentOf, label);
  const focus = { part: { id: "d7", label: "District Seven", scale: "district" }, holder: { id: "city", label: "City" }, city: { id: "city", label: "City" }, shapes: { donut: "a donut" }, pictures: { map: "the map" } };
  const composed = await (await import("../src/v2/context/engine.js")).compose(T.terrainGroundMode, focus, stores);
  const state = composed.state as Record<string, Record<string, unknown>>;
  assert.deepEqual(state.part, { name: "District Seven", scale: "district", in: "City" });
  assert.deepEqual(Object.keys(state.text), ["s1"]);
  assert.deepEqual(state.standing, { dormitory: "a building", "tower of fifty floors": "a building in City, 2 times" }, "no rooms; the part's own first");
  assert.deepEqual(Object.keys(state.facts), ["f1", "f2", "f3"], "about the city alone first; a bare name last");
  assert.deepEqual(Object.keys(state.environment), ["environment:s4"], "the city's surroundings, not District Six's");
  // The kinds go by level (the user's call): a district's, then the basic shapes; a commercial centre or a park is a street's.
  const district = ["cbd", "dwelling", "industrial", "harbour", "mountain", "oldtown", "village", "farmland", "donut"];
  assert.deepEqual([Object.keys(state.kinds), composed.questions.map((question) => question.key), composed.questions[1].options], [district, ["box", "kind"], district]);
  const street = await (await import("../src/v2/context/engine.js")).compose(T.terrainGroundMode, { ...focus, part: { ...focus.part, scale: "street" } }, stores);
  assert.deepEqual(Object.keys((street.state as Record<string, object>).kinds), ["shopping", "centre", "avenue", "square", "station", "alley", "residential", "waterfront", "park", "stadium", "donut"]);
  // A pool's member (sampled): asked its kind, not where it lies; its own sentences are its text (it has no name to find).
  const sampled = await (await import("../src/v2/context/engine.js")).compose(T.terrainGroundMode, { ...focus, part: { id: "unnamed:s1", label: "a square (scene 1)", scale: "street" }, sampled: true }, { ...stores, own: (id: string) => (id === "unnamed:s1" ? [{ id: "s1", text: sentences[0].text }] : []) });
  assert.deepEqual([sampled.questions.map((question) => question.key), Object.keys((sampled.state as Record<string, object>).text)], [["kind"], ["s1"]]);
  assert.equal(T.TERRAIN_KINDS.district.cbd.ground, "skyscrapers");
  // Each kind its own manifold, and Jev gives its median (the user's calls): a CBD's medians, a mountain's tops.
  const cbd = T.terrainHeights("district", "cbd");
  assert.deepEqual([cbd.measure, cbd.slices[0], T.terrainHeights("district", "mountain").measure, T.terrainHeights("district", "mountain").slices[0].said, T.terrainHeights("district", "donut").slices[0].y],
    ["median", { letter: "A", y: 30, said: "about 10 floors" }, "top", "a hill", 3]);
  assert.match(String(state.kinds.cbd), /highest at its core \(about 2\.1 times its edge\); a wide spread .*; one in 10 far above the rest/);
  // The city level: its own kinds, asked its kind only (it is the map); a district is told its city's kept terrain (within).
  const city = await (await import("../src/v2/context/engine.js")).compose(T.terrainGroundMode, { ...focus, part: { id: "city", label: "City", scale: "city" } }, stores);
  assert.deepEqual([Object.keys((city.state as Record<string, object>).kinds).slice(0, 4), city.questions.map((question) => question.key)], [["metropolis", "city", "town", "oldcity"], ["kind"]]);
  const height = await (await import("../src/v2/context/engine.js")).compose(T.terrainHeightMode, { ...focus, kind: "cbd", ...cbd, within: { City: "metropolis, median 15 m" } }, stores);
  const said = height.state as Record<string, Record<string, unknown>>;
  assert.ok(said.standing["tower of fifty floors"] && Object.keys(said.facts).length && said.heights.A === "30 m: about 10 floors" && said.within.City === "metropolis, median 15 m");
  assert.match(String(height.state.task), /median height .* not the tallest/);
  assert.deepEqual(height.questions.map((question) => [question.key, question.options?.length]), [["height", 6]]);
  await stores.graph?.close();
});

test("the reading's prompts of plain text, composed by the engine, are the digger's own: the tiling window and seam, and a flashback's continuation", async () => {
  const { tilingDocument } = await import("../src/digger/autostep/segmentation.js");
  const { continuationDocument, continuationQuestion } = await import("../src/digger/timeplace/roles.js");
  const R = await import("../src/v2/context/readingModes.js");
  const lines = [{ id: "s1", text: "One." }, { id: "s2", text: "Two." }, { id: "s3", text: "Three." }];
  const window = { kind: "window" as const, summary: "Processing block b0001.", context: lines, questions: [] };
  const seam = { kind: "seam" as const, summary: "Processing block b0001.", open: "s1", tail: lines.slice(0, 2), head: lines.slice(2), questions: [] };
  assert.equal((await compose(R.tilingWindowMode, window, null)).document, tilingDocument(window));
  assert.equal((await compose(R.tilingSeamMode, seam, null)).document, tilingDocument(seam));
  const opening = { previousTail: [], opening: lines, questions: [continuationQuestion("long ago")] };
  const composed = await compose(R.continuationMode, opening, null);
  assert.deepEqual([composed.document, composed.questions[0].key], [continuationDocument([], lines), "time_continuation"]);
});
