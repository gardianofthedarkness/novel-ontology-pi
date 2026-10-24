import test from "node:test";
import assert from "node:assert/strict";
import { scoreDialogueCards } from "../src/cli/commands/extract/dialogueEval.js";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const card = (id: string, sentenceIds: string[], participantIds: string[]) => ({ id, sentenceIds, participantIds });
test("actual eval dialogues CLI reads card arrays without network or database writes", async context => {
  const directory = await mkdtemp(join(tmpdir(), "dialogue-eval-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const goldPath = join(directory, "gold.json");
  const predictedPath = join(directory, "predicted.json");
  await writeFile(goldPath, JSON.stringify([card("gold", ["s1"], ["甲", "乙"])]));
  await writeFile(predictedPath, JSON.stringify([card("predicted", ["s1"], ["甲"])]));
  const disableNetwork = "data:text/javascript," + encodeURIComponent('globalThis.fetch = () => { throw new Error("Unexpected network request"); };');
  const result = await promisify(execFile)(process.execPath, ["--import", disableNetwork, "dist/src/cli/cli.js", "eval", "dialogues", goldPath, predictedPath]);
  const report = JSON.parse(result.stdout);
  assert.equal(report.correctParticipants, 1);
  assert.equal(report.wrongParticipants, 0);
  assert.equal(report.missingParticipants, 1);
});
test("card scoring separates wrong, missing, unknown and correct membership without speaker labels", () => {
  const result = scoreDialogueCards([card("gold", ["s1", "s2"], ["甲", "乙"])], [card("predicted", ["s1", "s2"], ["甲", "丙"])]);
  assert.equal(result.correctParticipants, 1);
  assert.equal(result.wrongParticipants, 1);
  assert.equal(result.missingParticipants, 1);
  assert.equal(result.precision, 0.5);
  assert.equal(result.recall, 0.5);
  const empty = scoreDialogueCards([card("gold", ["s1"], ["甲"])], [card("empty", ["s1"], [])]);
  assert.equal(empty.precision, null);
  assert.equal(empty.recall, 0);
  assert.equal(empty.exactParticipantCards, 0);
  assert.equal(empty.unresolvedPredictedCards, 1);
});

test("matching uses maximum total source overlap, not participant agreement or greedy pairing", () => {
  const result = scoreDialogueCards([
    card("gold1", ["s1", "s2", "s3", "s4"], ["甲"]),
    card("gold2", ["s2", "s3", "s4"], ["乙"]),
  ], [card("pred1", ["s1", "s2", "s3", "s4"], ["乙"]), card("pred2", ["s1", "s2"], ["甲"])], 0.3);
  assert.deepEqual(result.matches.map(match => match.predictedId), ["pred2", "pred1"]);
  assert.equal(result.correctParticipants, 2);
  const swapped = scoreDialogueCards([card("gold", ["s1"], ["甲"])], [card("right-source", ["s1"], ["乙"]), card("wrong-source", ["s2"], ["甲"])]);
  assert.equal(swapped.matches[0].predictedId, "right-source");
  assert.equal(swapped.correctParticipants, 0);
});

test("scene fragments reassemble by logical ID, while unmatched predictions and split cards remain visible", () => {
  const gold = [card("gold", ["s1", "s2"], ["甲", "乙"])];
  const joined = scoreDialogueCards(gold, [card("same", ["s1"], ["甲", "乙"]), card("same", ["s2"], ["甲", "乙"])]);
  assert.equal(joined.predictedCards, 1);
  assert.equal(joined.exactParticipantCards, 1);
  const split = scoreDialogueCards(gold, [card("left", ["s1"], ["甲"]), card("right", ["s2"], ["乙"])]);
  assert.equal(split.splitGoldCards, 1);
  assert.equal(split.unmatchedPredictedCards, 1);
  assert.equal(split.wrongParticipants, 0);
  assert.equal(split.unmatchedParticipantAssertions, 1);
  assert.equal(split.missingParticipants, 1);
});

test("ambiguous gold is explicit and invalid or oversized evaluation inputs fail without truncation", () => {
  const result = scoreDialogueCards([{ ...card("gold", ["s1"], ["甲"]), unresolvedParticipantIds: ["乙"] }], [card("pred", ["s1"], ["甲", "乙"])]);
  assert.equal(result.ignoredUncertainParticipants, 1);
  assert.equal(result.wrongParticipants, 0);
  assert.equal(result.exactSetDenominator, 0);
  assert.throws(() => scoreDialogueCards([], [card("bad", [], [])]), /Invalid/);
  assert.throws(() => scoreDialogueCards([], [], 0), /threshold/);
  assert.throws(() => scoreDialogueCards(Array.from({ length: 501 }, (_, index) => card(String(index), [String(index)], [])), []), /500/);
  assert.equal(scoreDialogueCards([], []).precision, null);
});
