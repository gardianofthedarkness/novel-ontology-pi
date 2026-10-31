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
