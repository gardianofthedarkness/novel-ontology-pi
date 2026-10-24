import { test } from "node:test";
import assert from "node:assert/strict";
import { DecisionRouter } from "../src/digger/processing/decisionRouter.js";
import { expandDecisionContext, renderSentences } from "../src/digger/processing/facultyContext.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import { setImmediate as nextTurn } from "node:timers/promises";
import { readSpeakerGuesses, speakerQuestions } from "../src/digger/processing/dialogueDecisions.js";

test("shared router retries uncertain faculties before System 2 and reports separate denominators", async () => {
  const router = new DecisionRouter();
  let fallbacks = 0;
  for (const faculty of ["scene", "dialogue", "another-faculty"]) {
    const result = await router.route({ faculty, initial: async () => 0.4, accept: value => value >= 0.8, retry: () => ({ inputBytes: 100, run: async () => 0.9 }), fallback: async () => { fallbacks++; return 1; } });
    assert.equal(result.stage, "retry");
    assert.equal(router.metrics[faculty].processed, 1);
    assert.equal(router.metrics[faculty].retryRecovered, 1);
    assert.equal(router.metrics[faculty].escalated, 0);
  }
  assert.equal(fallbacks, 0);
});

test("confidence alone never bypasses a faculty's structural validator", async () => {
  const router = new DecisionRouter();
  const result = await router.route({ faculty: "dialogue", initial: async () => ({ confidence: 0.99, valid: false }), accept: value => value.confidence >= 0.8 && value.valid, retry: () => ({ inputBytes: 100, run: async () => ({ confidence: 1, valid: false }) }), fallback: async () => ({ confidence: 0, valid: true }), acceptFallback: value => value.valid });
  assert.equal(result.stage, "system2");
  assert.equal(router.metrics.dialogue.retryRecovered, 0);
  assert.equal(router.metrics.dialogue.system2Resolved, 1);
});

test("retry and byte budgets, failures, disabled control and unresolved fallbacks remain explicit", async () => {
  const router = new DecisionRouter({ maxRetryCalls: 1, maxContextBytes: 100 });
  const initial = async () => 0;
  const accept = (value: number) => value > 0;
  const task = { faculty: "test", initial, accept, retry: () => ({ inputBytes: 50, run: async () => { throw new Error("PRIVATE"); } }), fallback: async () => { throw new Error("PRIVATE"); } };
  assert.equal((await router.route(task)).stage, "unresolved");
  assert.equal((await router.route(task)).stage, "unresolved");
  assert.equal(router.metrics.test.retries, 1);
  assert.equal(router.metrics.test.retrySkipped, 1);
  assert.equal(router.metrics.test.failures, 3);
  assert.equal(router.metrics.test.unresolved, 2);
  const disabled = new DecisionRouter({ enabled: false });
  await disabled.route({ ...task, fallback: async () => 1 });
  assert.equal(disabled.metrics.test.retries, 0);
  assert.equal(disabled.metrics.test.escalated, 1);
  const oversized = new DecisionRouter({ maxContextBytes: 1 });
  await oversized.route({ ...task, fallback: async () => 1 });
  assert.equal(oversized.metrics.test.retries, 0);
  const valid = await router.route({ faculty: "valid", initial: async () => 1, accept, retry: task.retry });
  assert.equal(valid.stage, "initial");
  assert.equal(router.metrics.valid.initialAccepted, 1);
  await assert.rejects(router.route({ faculty: "bad", initial: task.retry().run, accept }), error => error instanceof Error && !error.message.includes("PRIVATE"));
  assert.throws(() => new DecisionRouter({ maxRetries: 100 }), /Invalid/);
});

test("expanded context preserves target and options, adds nearest whole neighbors and respects byte bounds", () => {
  const sentences = sectionBlock(Array.from({ length: 100 }, (_, index) => `第${index}句。`).join("\n"), 0).sentences;
  const state = `Allowed choices: NONE, ${sentences[50].id}\n${renderSentences(sentences.slice(48, 53))}`;
  const wider = expandDecisionContext(state, sentences, { margin: 10, maxBytes: 1000 })!;
  assert.ok(wider.endsWith(state));
  assert.ok(wider.includes(`${sentences[47].id}:`));
  assert.ok(wider.includes(`${sentences[53].id}:`));
  assert.ok(Buffer.byteLength(wider, "utf8") <= 1000);
  assert.equal(expandDecisionContext(state, sentences, { maxBytes: 10 }), undefined);
  assert.equal(expandDecisionContext(renderSentences(sentences), sentences), undefined);
  assert.equal(expandDecisionContext("No source addresses", sentences), undefined);
});

test("router shares a bounded retry pool across faculties and passes cancellation signals", async () => {
  const router = new DecisionRouter({ concurrency: 2 });
  let active = 0;
  let peak = 0;
  const results = await Promise.all(Array.from({ length: 12 }, (_, index) => router.route({
    faculty: `faculty-${index % 3}`, initial: async () => false, accept: value => value,
    retry: () => ({ inputBytes: 10, run: async signal => {
      assert.ok(signal instanceof AbortSignal);
      active++;
      peak = Math.max(peak, active);
      await nextTurn();
      active--;
      return true;
    } }),
  })));
  assert.equal(peak, 2);
  assert.ok(results.every(result => result.stage === "retry"));
});

test("dialogue retry keeps original units and questions while validating every speaker", () => {
  const core = sectionBlock("小樱说：“你好。”\n小林说：“再见。”\n两人离开。", 0).sentences;
  const names = ["小樱", "小林"];
  const units = [[core[0].id], [core[1].id]];
  const questions = speakerQuestions(units, names);
  assert.equal(questions.length, 2);
  const answers = questions.map(question => ({ key: question.key, confidence: 0.99, value: question.key.endsWith(core[0].id) ? "小樱" : "小林" }));
  const result = readSpeakerGuesses(units, names, answers);
  assert.equal(result.valid, true);
  assert.deepEqual(result.turns.map(turn => turn.speakerName), names);
  assert.deepEqual(result.turns.map(turn => turn.sentenceIds), [[core[0].id], [core[1].id]]);
  assert.equal(readSpeakerGuesses(units, names, answers.slice(1)).valid, false);
  assert.equal(readSpeakerGuesses(units, names, answers.map(answer => answer.key === `speaker:${core[0].id}` ? { ...answer, value: "invented" } : answer)).valid, false);
  assert.equal(readSpeakerGuesses(units, names, answers.map(answer => ({ ...answer, confidence: 0.1 }))).valid, false);
});

test("faculty policies customize retry settings while retaining the global budget and kill switch", async () => {
  const options = { maxRetryCalls: 1, faculties: { scene: { enabled: false }, speaker: { enabled: true, contextMargin: 64, maxRetries: 2, maxContextBytes: 500 } } };
  const router = new DecisionRouter(options);
  const task = { initial: async () => false, accept: (value: boolean) => value, retry: () => ({ inputBytes: 100, run: async () => true }), fallback: async () => true };
  assert.equal((await router.route({ ...task, faculty: "scene" })).stage, "system2");
  assert.equal(router.metrics.scene.retries, 0);
  assert.equal((await router.route({ ...task, faculty: "speaker" })).stage, "retry");
  assert.equal((await router.route({ ...task, faculty: "speaker" })).stage, "system2");
  assert.equal(router.metrics.speaker.retries, 1);
  assert.equal(router.contextWindow(["scene"]), 0);
  assert.equal(router.contextWindow(["speaker"]), 128);
  const disabled = new DecisionRouter({ ...options, enabled: false });
  assert.equal((await disabled.route({ ...task, faculty: "speaker" })).stage, "system2");
  assert.equal(disabled.metrics.speaker.retries, 0);
  assert.equal(disabled.contextWindow(["speaker"]), 0);
  const oversized = await router.route({ ...task, faculty: "tiny", retry: () => ({ inputBytes: 20000, run: async () => true }) });
  assert.equal(oversized.stage, "system2");
  assert.throws(() => new DecisionRouter({ faculties: { speaker: { contextMargin: -1 } } }), /Invalid/);
});
