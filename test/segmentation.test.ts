import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DecisionAnswer,
  DecisionQuestion,
} from "../src/ground/connectors/jev.js";
import { sectionBlock, type Sentence } from "../src/digger/intake/sectioning.js";
import {
  selectExchanges,
  selectExchangeSpans,
  spansOfKinds,
  tileScenes,
  type DecideFn,
  type SentenceKind,
} from "../src/digger/autostep/segmentation.js";

const GATES = { accept: 0.85, reask: 0.55 };

function makeSentences(count: number): Sentence[] {
  const text = Array.from({ length: count }, (_, i) => `这是第${i}句。`).join("");
  return sectionBlock(text, 1).sentences;
}

/** Decider scripted by question key; unscripted ends run to the region end, starts find nothing. */
function scripted(script: Record<string, string>, confidence = 0.95): DecideFn {
  return async (_state: string, questions: DecisionQuestion[]) => {
    return questions.map((q): DecisionAnswer => {
      let value: string | number = script[q.key] ?? "";
      if (value === "" && q.primitive === "noul") value = 0;
      if (value === "" && q.primitive === "choice") {
        if (q.key.startsWith("scene_end:")) value = q.options![q.options!.length - 1];
        else if (q.key.startsWith("scene_start:")) value = "NONE";
        else if (q.key.startsWith("scene_seam:")) value = "continues";
        else if (q.key.startsWith("dlg_kind:")) value = "narration";
        else value = q.options![0];
      }
      return { key: q.key, value, confidence };
    });
  };
}

const ids = (sentences: Sentence[], a: number, b: number) =>
  sentences.slice(a, b + 1).map((s) => s.id);

function assertPartition(sentences: Sentence[], spans: string[][]) {
  assert.deepEqual(
    spans.flat(),
    sentences.map((s) => s.id),
    "spans tile the block exactly, in order",
  );
}

test("tileScenes: chosen starts tile the block; each scene starts at the last end + 1", async () => {
  const sentences = makeSentences(30);
  const decide = scripted({
    [`scene_end:${sentences[0].id}`]: sentences[29].id, // provisional only
    [`scene_start:${sentences[0].id}`]: sentences[10].id,
  });
  const { spans } = await tileScenes(sentences, decide, { stateSummary: "t", gates: GATES });
  assert.deepEqual(spans, [ids(sentences, 0, 9), ids(sentences, 10, 29)]);
  assertPartition(sentences, spans);
});

test("tileScenes: seam 'continues' + a pointed start closes the open scene at start - 1", async () => {
  const sentences = makeSentences(200);
  const decide = scripted({
    [`scene_end:${sentences[0].id}`]: sentences[70].id, // provisional end
    [`scene_seam:${sentences[60].id}`]: "continues",
    [`scene_start:${sentences[60].id}`]: sentences[100].id,
  });
  const { spans, escalations } = await tileScenes(sentences, decide, { stateSummary: "t", gates: GATES });
  assert.deepEqual(spans, [ids(sentences, 0, 99), ids(sentences, 100, 199)]);
  assertPartition(sentences, spans);
  assert.ok(
    escalations.some((e) => e.reason.includes("possible missed boundary")),
    "the 29-sentence gap past the provisional end is flagged",
  );
});

test("tileScenes: seam 'ended' ratifies the provisional end; the next scene opens at end + 1", async () => {
  const sentences = makeSentences(200);
  const decide = scripted({
    [`scene_end:${sentences[0].id}`]: sentences[50].id,
    [`scene_seam:${sentences[60].id}`]: "ended",
  });
  const { spans } = await tileScenes(sentences, decide, { stateSummary: "t", gates: GATES });
  assert.deepEqual(spans, [ids(sentences, 0, 50), ids(sentences, 51, 199)]);
  assertPartition(sentences, spans);
});

test("tileScenes: an invalid end pick still tiles (the partition never depends on it)", async () => {
  const sentences = makeSentences(120);
  const decide = scripted({
    [`scene_end:${sentences[0].id}`]: "b9999_s9999",
  });
  const { spans } = await tileScenes(sentences, decide, { stateSummary: "t", gates: GATES });
  assertPartition(sentences, spans);
});

test("tileScenes: low-confidence picks escalate but the partition is still produced", async () => {
  const sentences = makeSentences(10);
  const decide = scripted({}, 0.3);
  const { spans, escalations } = await tileScenes(sentences, decide, { stateSummary: "t", gates: GATES });
  assertPartition(sentences, spans);
  assert.ok(escalations.length > 0);
});

/** The sentences' kinds as a script: `kinds` by index (others narration), `turns` the indices where the people change. */
function kindsScript(sentences: Sentence[], kinds: Record<number, SentenceKind>, turns: number[] = []): Record<string, string> {
  return Object.fromEntries([
    ...Object.entries(kinds).map(([index, kind]) => [`dlg_kind:${sentences[Number(index)].id}`, kind]),
    ...turns.map((index) => [`dlg_turn:${sentences[index].id}`, 1 as unknown as string]),
  ]);
}
const spoken = (from: number, to: number, every = 1): Record<number, SentenceKind> =>
  Object.fromEntries(Array.from({ length: to - from + 1 }, (_, i) => from + i).filter((i) => (i - from) % every === 0).map((i) => [i, "spoken"]));

test("selectExchanges: one batched request per window, and an exchange straddling a scene cut links two scenes", async () => {
  const sentences = makeSentences(100);
  const sceneSpans = [ids(sentences, 0, 49), ids(sentences, 50, 99)];
  const calls: DecisionQuestion[][] = [];
  const answer = scripted(kindsScript(sentences, spoken(40, 60, 2)));
  const decide: DecideFn = async (state, questions) => { calls.push(questions); return answer(state, questions); };
  const { units, unitScenes } = await selectExchanges(sentences, sceneSpans, decide, { stateSummary: "t", gates: GATES });
  assert.equal(calls.length, 3, "100 sentences are three requests (40 a window), not a chain of start and end questions");
  assert.deepEqual(calls[0].map((q) => q.key).slice(0, 2), [`dlg_kind:${sentences[0].id}`, `dlg_turn:${sentences[0].id}`]);
  assert.deepEqual(units, [ids(sentences, 40, 60)], "narration between the lines stays inside the exchange");
  assert.deepEqual(unitScenes, [[0, 1]], "exchange straddles the scene cut -> two scene links");
});

test("spansOfKinds: a dialogue runs as long as its people stay, ends where they change or after a long silence", () => {
  const kinds: SentenceKind[] = Array.from({ length: 40 }, () => "narration");
  const turns = new Array(40).fill(0);
  for (const i of [0, 2, 3, 6, 8]) kinds[i] = "spoken";
  kinds[5] = "action"; kinds[7] = "fact";
  for (const i of [10, 12]) kinds[i] = "spoken";
  turns[10] = 1; // someone new speaks: a new exchange
  kinds[21] = "spoken"; // eight quiet sentences after 12: still the same exchange
  kinds[31] = "spoken"; // nine quiet sentences after 21: the earlier exchange ended
  assert.deepEqual(spansOfKinds(kinds, turns).dialogues, [[0, 8], [10, 21], [31, 31]]);
});

test("spansOfKinds: monologues are runs of thought with a few asides; facts are kept apart", () => {
  const kinds: SentenceKind[] = ["thought", "narration", "thought", "action", "narration", "thought", "narration", "narration", "narration", "spoken", "thought", "spoken", "fact", "fact", "narration", "fact"];
  const { dialogues, monologues, facts } = spansOfKinds(kinds, new Array(kinds.length).fill(0));
  assert.deepEqual(monologues, [[0, 5], [10, 10]], "two asides inside a monologue; a third, or a spoken line, ends it");
  assert.deepEqual(facts, [[12, 13], [15, 15]]);
  assert.deepEqual(dialogues, [[9, 11]], "a thought between two lines stays inside the exchange");
});

test("miniloop pipelines: scene tiling and dialogue selection run concurrently", async () => {
  const { Miniloop } = await import("../src/digger/autostep/miniloop.js");
  const sentences = makeSentences(120);
  let inFlight = 0;
  let maxInFlight = 0;
  const slowDecide: DecideFn = async (_state, questions) => {
    inFlight++;
    maxInFlight = Math.max(maxInFlight, inFlight);
    await new Promise((r) => setTimeout(r, 15));
    inFlight--;
    return questions.map((q): DecisionAnswer => {
      let value: string | number = q.options ? q.options[q.options.length - 1] : 0;
      if (q.key.startsWith("scene_start:")) value = "NONE";
      if (q.key.startsWith("scene_seam:")) value = "continues";
      return { key: q.key, value, confidence: 0.95 };
    });
  };
  const loop = new Miniloop({ decide: slowDecide } as never, {});
  const result = await loop.runBlock({
    blockId: "b0001", sentences, knownEntities: [], stateSummary: "t",
  });
  assert.ok(maxInFlight >= 2, `pipelines overlapped (max in-flight decide calls: ${maxInFlight})`);
  const spans = result.accepted["sceneSpans"] as string[][];
  assertPartition(sentences, spans);
  assert.ok(Array.isArray(result.accepted["dialogueUnitScenes"]), "the scene-link join ran after the pipelines");
});

test("the classification prompt names every kind, and asks one turn question a sentence", async () => {
  const sentences = sectionBlock('“我会回来。”\n他站起身。\n天亮之前，学园都市的电车停运。\n我真想留下，他想。', 1).sentences;
  const prompts: DecisionQuestion[] = [];
  const answer = scripted(kindsScript(sentences, { 0: "spoken", 1: "action", 2: "fact", 3: "thought" }));
  const result = await selectExchangeSpans(sentences, async (state, questions) => { prompts.push(...questions); return answer(state, questions); }, { stateSummary: "", gates: GATES });
  const kinds = prompts.filter((q) => q.key.startsWith("dlg_kind:"));
  assert.equal(kinds.length, 4);
  assert.equal(prompts.filter((q) => q.key.startsWith("dlg_turn:") && q.primitive === "noul").length, 4);
  for (const question of kinds) {
    assert.deepEqual(question.options, ["spoken", "thought", "fact", "action", "narration"]);
    assert.match(question.optionHints!.thought, /talking to themself/);
    assert.match(question.optionHints!.fact, /background knowledge/);
  }
  assert.deepEqual(result.spans, [[0, 0]]);
  assert.deepEqual(result.monologues, [[3, 3]]);
  assert.deepEqual(result.facts, [[2, 2]]);
});

test("an uncertain spoken line is escalated", async () => {
  const sentences = sectionBlock("“走吧。”", 0).sentences;
  const result = await selectExchanges(sentences, [sentences.map(sentence => sentence.id)], async (_state, questions) => questions.map(question => ({ key: question.key, value: question.key.startsWith("dlg_kind:") ? "spoken" : 0, confidence: 0.2 })), { stateSummary: "", gates: GATES });
  assert.equal(result.escalations.length, 1);
  assert.match(result.escalations[0].reason, /too uncertain/);
});

test("dialogue streaming only publishes stable spans and monotone complete-through watermarks", async () => {
  const sentences = makeSentences(100);
  const snapshots: { spans: [number, number][]; through: number }[] = [];
  const result = await selectExchangeSpans(sentences, scripted(kindsScript(sentences, { ...spoken(10, 20), ...spoken(36, 44), ...spoken(70, 90, 3) })), { stateSummary: "", gates: GATES, onBatch: async (spans, through) => { snapshots.push({ spans: structuredClone(spans), through }); } });
  assert.equal(snapshots[0].through, 31, "the first window settles all but its last quiet stretch");
  assert.deepEqual(snapshots[0].spans, [[10, 20]], "an exchange still open at the window's end waits");
  assert.equal(snapshots.at(-1)!.through, 99);
  assert.deepEqual(snapshots.at(-1)!.spans, result.spans);
  assert.deepEqual(result.spans, [[10, 20], [36, 44], [70, 88]]);
  assert.ok(snapshots.every((snapshot, index) => !index || snapshot.through >= snapshots[index - 1].through));
});
