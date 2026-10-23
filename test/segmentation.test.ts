import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DecisionAnswer,
  DecisionQuestion,
} from "../src/connectors/jev.js";
import { sectionBlock, type Sentence } from "../src/text/sectioning.js";
import {
  selectExchanges,
  selectExchangeSpans,
  tileScenes,
  type DecideFn,
} from "../src/autostep/segmentation.js";

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
      if (value === "" && q.primitive === "choice") {
        if (q.key.startsWith("scene_end:")) value = q.options![q.options!.length - 1];
        else if (q.key.startsWith("scene_start:")) value = "NONE";
        else if (q.key.startsWith("scene_seam:")) value = "continues";
        else if (q.key.startsWith("dlg_start:")) value = "NONE";
        else if (q.key.startsWith("dlg_end:")) value = q.options![0];
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

test("selectExchanges: >=3-sentence overlap merges across batches and links two scenes", async () => {
  const sentences = makeSentences(100);
  const sceneSpans = [ids(sentences, 0, 49), ids(sentences, 50, 99)];
  const decide = scripted({
    [`dlg_start:${sentences[0].id}`]: sentences[10].id,
    [`dlg_end:${sentences[10].id}`]: sentences[70].id,
    [`dlg_start:${sentences[71].id}`]: "NONE",
    [`dlg_start:${sentences[60].id}`]: sentences[65].id,
    [`dlg_end:${sentences[65].id}`]: sentences[90].id,
    [`dlg_start:${sentences[91].id}`]: "NONE",
  });
  const { units, unitScenes } = await selectExchanges(sentences, sceneSpans, decide, { stateSummary: "t", gates: GATES });
  assert.deepEqual(units, [ids(sentences, 10, 90)]);
  assert.deepEqual(unitScenes, [[0, 1]], "exchange straddles the scene cut -> two scene links");
});

test("selectExchanges: a 1-2 sentence graze trims instead of merging", async () => {
  const sentences = makeSentences(100);
  const sceneSpans = [ids(sentences, 0, 99)];
  const decide = scripted({
    [`dlg_start:${sentences[0].id}`]: sentences[10].id,
    [`dlg_end:${sentences[10].id}`]: sentences[70].id,
    [`dlg_start:${sentences[71].id}`]: "NONE",
    [`dlg_start:${sentences[60].id}`]: sentences[69].id,
    [`dlg_end:${sentences[69].id}`]: sentences[75].id,
    [`dlg_start:${sentences[76].id}`]: "NONE",
  });
  const { units, unitScenes } = await selectExchanges(sentences, sceneSpans, decide, { stateSummary: "t", gates: GATES });
  assert.deepEqual(units, [ids(sentences, 10, 70), ids(sentences, 71, 75)]);
  assert.deepEqual(unitScenes, [[0], [0]]);
});

test("miniloop pipelines: scene tiling and dialogue selection run concurrently", async () => {
  const { Miniloop } = await import("../src/autostep/miniloop.js");
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
      if (q.key.startsWith("scene_start:") || q.key.startsWith("dlg_start:")) value = "NONE";
      if (q.key.startsWith("scene_seam:")) value = "continues";
      if (q.key.startsWith("dlg_end:")) value = q.options![0];
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

test("dialogue prompts retain brief narration but split long non-verbal gaps within the same scene", async () => {
  const sentences = sectionBlock('“我会回来。”\n他站起身。\n“天亮之前。”\n风吹过街道。\n雪落在窗沿。\n远处的灯熄灭了。\n“我还会等你。”', 1).sentences;
  const prompts: DecisionQuestion[] = [];
  const answer = scripted({
    [`dlg_start:${sentences[0].id}`]: sentences[0].id,
    [`dlg_end:${sentences[0].id}`]: sentences[2].id,
    [`dlg_start:${sentences[3].id}`]: sentences[6].id,
    [`dlg_end:${sentences[6].id}`]: sentences[6].id,
  });
  const decide: DecideFn = async (state, questions) => {
    prompts.push(...questions);
    return answer(state, questions);
  };
  const result = await selectExchanges(sentences, [ids(sentences, 0, 6)], decide, { stateSummary: "同一场景，同一说话人", gates: GATES });
  assert.deepEqual(result.units, [ids(sentences, 0, 2), ids(sentences, 6, 6)]);
  assert.deepEqual(result.unitScenes, [[0], [0]]);
  const starts = prompts.filter(question => question.key.startsWith("dlg_start:"));
  const ends = prompts.filter(question => question.key.startsWith("dlg_end:"));
  assert.ok(starts.length >= 2 && ends.length >= 2);
  for (const question of starts) {
    assert.match(question.instructions, /sentence level/);
    assert.match(question.instructions, /Three or more consecutive non-verbal sentences/);
    assert.match(question.instructions, /even with the same speakers in the same scene/);
    assert.match(question.instructions, /One or two brief narration/);
  }
  for (const question of ends) {
    assert.match(question.instructions, /BEFORE any gap of three or more/);
    assert.match(question.instructions, /LAST spoken sentence/);
    assert.match(question.instructions, /same speakers resume in the same scene/);
  }
});

test("uncertain NONE dialogue decisions are escalated and streamed coverage reaches EOF", async () => {
  const sentences = sectionBlock("他没有说话。", 0).sentences;
  const result = await selectExchanges(sentences, [sentences.map(sentence => sentence.id)], async (_state, questions) => questions.map(question => ({ key: question.key, value: "NONE", confidence: 0.2 })), { stateSummary: "", gates: GATES });
  assert.equal(result.escalations.length, 1);
  assert.match(result.escalations[0].reason, /absence decision/);
});

test("dialogue streaming only publishes stable spans and monotone complete-through watermarks", async () => {
  const sentences = makeSentences(100);
  const snapshots: { spans: [number, number][]; through: number }[] = [];
  const result = await selectExchangeSpans(sentences, scripted({
    [`dlg_start:${sentences[0].id}`]: sentences[10].id,
    [`dlg_end:${sentences[10].id}`]: sentences[70].id,
    [`dlg_start:${sentences[60].id}`]: sentences[65].id,
    [`dlg_end:${sentences[65].id}`]: sentences[90].id,
  }), { stateSummary: "", gates: GATES, onBatch: async (spans, through) => { snapshots.push({ spans: structuredClone(spans), through }); } });
  assert.equal(snapshots[0].through, 9);
  assert.deepEqual(snapshots[0].spans, []);
  assert.equal(snapshots.at(-1)!.through, 99);
  assert.deepEqual(snapshots.at(-1)!.spans, result.spans);
  assert.ok(snapshots.every((snapshot, index) => !index || snapshot.through >= snapshots[index - 1].through));
});
