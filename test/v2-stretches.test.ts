import test from "node:test";
import assert from "node:assert/strict";
import type { DecisionAnswer, DecisionQuestion, DecisionState } from "../src/ground/connectors/jev.js";
import { tileStretches } from "../src/v2/extraction/stretches.js";

// Ten sentences: a change of place at s3, a change of kind at s6, and at s8 a one-line wobble Jev half believes.
const sentences = Array.from({ length: 10 }, (_, n) => ({ id: `s${n}`, text: `第${n}句。`, index: n, paragraphIndex: 0, startOffset: n * 4, endOffset: n * 4 + 4 }));
const boundaries: Record<string, Record<string, number>> = {
  s3: { continues: 0.05, elsewhere: 0.9, kind: 0.05 },
  s6: { continues: 0.15, elsewhere: 0.05, kind: 0.8 },
  s8: { continues: 0.45, elsewhere: 0.0, kind: 0.55 },
  s9: { continues: 0.45, elsewhere: 0.0, kind: 0.55 },
};
/** Jev, by rule: the boundaries above, else continues; a stretch's kind by the sentences it holds. */
const asked: string[] = [];
const decide = async (state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionAnswer[]> => questions.map((question) => {
  asked.push(question.key.split(":")[0]);
  if (question.key.startsWith("stretch:")) { const distribution: Record<string, number> = boundaries[question.key.slice(8)] ?? { continues: 0.95, elsewhere: 0.02, kind: 0.03 }; const value = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0][0]; return { key: question.key, value, confidence: distribution[value], distribution }; }
  const text = String((state as { stretches?: Record<string, string> }).stretches?.[question.key.replace("stretch_type:", "stretch_")] ?? "");
  const fight = /第[67]句/.test(text), wobble = /第8句/.test(text) && !/第7句/.test(text);
  const distribution: Record<string, number> = fight ? { confrontation: 0.85, routine: 0.15 } : wobble ? { routine: 0.5, interior: 0.5 } : { routine: 0.9, confrontation: 0.1 };
  const value = Object.entries(distribution).sort((a, b) => b[1] - a[1])[0][0];
  return { key: question.key, value, confidence: distribution[value], distribution };
});

test("one tiling: a change of place or time begins a stretch elsewhere, a change of kind one of another kind; types smoothed between", async () => {
  const stretches = await tileStretches(sentences, decide);
  assert.deepEqual(stretches.map((stretch) => [stretch.sentences[0], stretch.sentences.at(-1), stretch.start, stretch.type]), [
    ["s0", "s2", "elsewhere", "routine"],
    ["s3", "s5", "elsewhere", "routine"],
    ["s6", "s7", "kind", "confrontation"],
    ["s8", "s9", "kind", "routine"],
  ]);
  assert.equal(stretches[0].change, null, "the block's first stretch begins with the block");
  assert.equal(stretches[1].change, 0.9);
  assert.ok(stretches.every((stretch) => Math.abs(Object.values(stretch.smoothed).reduce((a, b) => a + b, 0) - 1) < 0.01));
  assert.ok(stretches.flatMap((stretch) => stretch.sentences).join() === sentences.map((sentence) => sentence.id).join(), "every sentence in exactly one stretch, in order");
  assert.deepEqual([...new Set(asked)].sort(), ["stretch", "stretch_type"], "one tiling: the boundary of each sentence and the kind of each stretch, nothing else");
});
