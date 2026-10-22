import assert from "node:assert/strict";
import { test } from "node:test";
import type {
  DecisionAnswer,
  DecisionQuestion,
} from "../src/connectors/jev.js";
import { sectionBlock, type Sentence } from "../src/text/sectioning.js";
import {
  selectExchanges,
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
