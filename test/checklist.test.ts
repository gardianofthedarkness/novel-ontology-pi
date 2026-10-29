import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { saveChangeSet } from "../src/solidifier/merge/changesetStore.js";
import { bookChecklist } from "../src/cli/commands/extract/checklistCommands.js";
import { rememberTimePlaceAttempt } from "../src/digger/timeplace/afterApply.js";
import { markCausalitySweepPending } from "../src/solidifier/causality/faculty.js";
import type { ChangeSet } from "../src/solidifier/merge/changeset.js";
import { runIdentityAfterApply } from "../src/solidifier/identity/afterApply.js";

async function workspace(context: { after: (callback: () => Promise<void>) => void }) {
  const parent = await mkdtemp(join(tmpdir(), "checklist-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  await writeFile(join(directory, "source", "novel.txt"), "第一章\n黄昏，小明在东区。\n夜里他回家。");
  await writeFile(join(directory, "ontology", "scenes.jsonl"), ["s1", "s2"].map((id) => JSON.stringify({ id, chapterIndex: 0, sentenceIds: [], charactersPresent: [], charactersMentioned: [], locationId: null })).join("\n") + "\n");
  const packet = (id: string, blockId: string, status: ChangeSet["status"]): ChangeSet => ({ id, blockId, proposals: [], status, reviewNotes: {}, createdAt: new Date().toISOString() });
  return { directory, packet };
}

test("the checklist lists each faculty in dependency order with its next command", async (context) => {
  const { directory, packet } = await workspace(context);
  const statusOf = async () => Object.fromEntries((await bookChecklist(directory)).items.map((item) => [item.id, item.status]));
  // Nothing applied yet: extraction is the gap; everything after it waits.
  assert.deepEqual(await statusOf(), { source: "done", album: "optional", blocks: "todo", identities: "blocked", causality: "blocked", "time-place": "blocked", calendar: "blocked", "place-tree": "blocked", strands: "blocked", graph: "blocked" });
  assert.deepEqual(Object.fromEntries((await bookChecklist(directory)).stage!.items.map((item) => [item.id, item.status])), { architecture: "blocked", objects: "blocked", movement: "blocked", stage: "blocked" });
  await saveChangeSet(directory, packet("cs_b0001", "b0001", "approved"));
  await markCausalitySweepPending(directory);
  const after = await bookChecklist(directory);
  const byId = new Map(after.items.map((item) => [item.id, item]));
  assert.equal(byId.get("blocks")!.status, "done");
  assert.equal(byId.get("identities")!.status, "done", "no characters, nothing outside the shared list");
  // Causality waits for story time and strands: causes are ordered by them.
  assert.equal(byId.get("causality")!.status, "blocked");
  assert.match(byId.get("causality")!.note!, /Waits for time-place, strands/);
  assert.equal(byId.get("time-place")!.status, "todo");
  assert.equal(byId.get("time-place")!.counts.scenesWithoutPeriod, 2);
  assert.equal(byId.get("place-tree")!.status, "blocked", "the place tree waits for story time and places");
  assert.equal(after.complete, false);
  assert.ok(after.next[0].startsWith("[time-place] novel timeplace run") && !after.next.some((entry) => entry.startsWith("[causality]")));
  // A waiting packet is reviewed before producing more of the same faculty.
  await saveChangeSet(directory, packet("cs_timeplace_time-place_1", "time-place", "pending_review"));
  const waiting = (await bookChecklist(directory)).items.find((item) => item.id === "time-place")!;
  assert.equal(waiting.status, "review");
  assert.match(waiting.next[0], /^novel review show .* cs_timeplace_time-place_1 --scope book/);
  // Processed scenes without a period (held facts, no time word) are not gaps and are not re-asked.
  await saveChangeSet(directory, packet("cs_timeplace_time-place_1", "time-place", "approved"));
  await rememberTimePlaceAttempt(directory, ["s1", "s2"]);
  const settled = (await bookChecklist(directory)).items.find((item) => item.id === "time-place")!;
  assert.deepEqual([settled.status, settled.counts.processedWithoutPeriod], ["done", 2]);
  assert.match(settled.note!, /not re-asked/);
  // Strands follow story time; with no periods there is nothing to ask.
  const strands = (await bookChecklist(directory)).items.find((item) => item.id === "strands")!;
  assert.deepEqual([strands.status, strands.next], ["done", []]);
  assert.match(strands.note!, /No story periods/);
  // With story time and strands settled, the pending causality sweep is next.
  const causality = (await bookChecklist(directory)).items.find((item) => item.id === "causality")!;
  assert.equal(causality.status, "todo");
  assert.match(causality.next[0], /^novel causality sweep /);
});

test("read mode's stage is listed apart and never holds the analysis open: buildings after the place tree, movement after them and the full extraction, the prep after everything", async (context) => {
  const { directory } = await workspace(context);
  const checklist = await bookChecklist(directory);
  // `complete` and `next` are the analysis alone: the loop that works them never spends Jev on animation, and a universe never waits for it.
  assert.ok(!checklist.items.some((item) => ["architecture", "objects", "movement", "stage"].includes(item.id)));
  assert.ok(!checklist.next.some((entry) => entry.includes("novel stage ")));
  const items = new Map(checklist.stage!.items.map((item) => [item.id, item]));
  assert.deepEqual(items.get("architecture")!.dependsOn, ["time-place", "place-tree"]);
  assert.deepEqual(items.get("objects")!.dependsOn, ["architecture"], "named buildings and things after the buildings, proposed for review");
  assert.deepEqual(items.get("movement")!.dependsOn, ["blocks", "strands", "architecture"]);
  // The prep waits for every analysis step, causality and its reviews included, the stage reports and the objects review.
  assert.deepEqual(new Set(items.get("stage")!.dependsOn), new Set([...checklist.items.map((item) => item.id), "architecture", "objects", "movement"]));
  assert.match(items.get("stage")!.note!, /Waits for .*causality/);
  assert.equal((await bookChecklist(directory, { stage: false })).stage, undefined, "left out on request (the universe checklist, the stage's own readiness checks)");
});

test("identities: characters outside the universe's shared list are a gap until universal EM sees them", async (context) => {
  const { directory, packet } = await workspace(context);
  await saveChangeSet(directory, packet("cs_b0001", "b0001", "approved"));
  await writeFile(join(directory, "ontology", "entities.jsonl"), JSON.stringify({ id: "char_000001", kind: "Character", names: [{ text: "小明", lang: "zh", kind: "canonical" }], properties: {}, confidence: 0.9 }) + "\n");
  const before = (await bookChecklist(directory, { env: {} })).items.find((item) => item.id === "identities")!;
  assert.deepEqual([before.status, before.counts.outsideTheList, before.next[0]?.startsWith("novel em sweep ")], ["todo", 1, true]);
  await runIdentityAfterApply({ novelDir: directory, decisions: null, all: true, env: {} });
  const after = (await bookChecklist(directory, { env: {} })).items.find((item) => item.id === "identities")!;
  assert.deepEqual([after.status, after.counts.outsideTheList], ["done", 0]);
});
