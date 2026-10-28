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
  assert.deepEqual(await statusOf(), { source: "done", album: "optional", blocks: "todo", causality: "blocked", "time-place": "blocked", "place-tree": "blocked", strands: "blocked", graph: "blocked" });
  await saveChangeSet(directory, packet("cs_b0001", "b0001", "approved"));
  await markCausalitySweepPending(directory);
  const after = await bookChecklist(directory);
  const byId = new Map(after.items.map((item) => [item.id, item]));
  assert.equal(byId.get("blocks")!.status, "done");
  assert.equal(byId.get("causality")!.status, "todo");
  assert.match(byId.get("causality")!.next[0], /^novel causality sweep /);
  assert.equal(byId.get("time-place")!.status, "todo");
  assert.equal(byId.get("time-place")!.counts.scenesWithoutPeriod, 2);
  assert.equal(byId.get("place-tree")!.status, "blocked", "the place tree waits for story time and places");
  assert.equal(after.complete, false);
  assert.ok(after.next[0].startsWith("[causality]") && after.next.some((entry) => entry.startsWith("[time-place] novel timeplace run")));
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
});
