import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { sourceGrep, sourceSimilar } from "../src/cli/commands/extract/sourceCommands.js";
import { landscapeItem, loadPool, makeBatch, worldAnswer, worldBatch, worldPool, writePool, type PoolItem } from "../src/cli/commands/extract/worldCommands.js";

const book = async (worldFirst: boolean) => {
  const { novelDir } = await initWorkspace(join(await mkdtemp(join(tmpdir(), "world-review-")), "novel"), { worldFirst });
  await writeFile(join(novelDir, "source", "novel.txt"), "第一章\n上条当麻跑进了便利店。\n那个刺猬头少年喘着气，看着白衣修女。\n茵蒂克丝咬住了他的头。\n");
  return novelDir;
};
const item = (id: string): PoolItem => ({ id, kind: "identity", scene: "scene_000001", subjects: ["char_000001", "char_000002"], names: ["上条当麻", "刺猬头少年"], question: "Are 上条当麻 and 刺猬头少年 the same person?", options: ["same", "different"], evidence: ["merged on world evidence"], status: "open", attempts: 0, at: new Date().toISOString() });

test("the original text, searched: a regular expression, and the passages most like a text, each with its sentence id", async () => {
  const novelDir = await book(false);
  const grep = await sourceGrep(novelDir, "刺猬头|白衣") as { total: number; hits: { sentence: string; text: string }[] };
  assert.equal(grep.total, 1);
  assert.match(grep.hits[0].text, /刺猬头少年/);
  assert.match(grep.hits[0].sentence, /^b\d+_s\d+$/);
  await assert.rejects(sourceGrep(novelDir, "("), /Not a regular expression/);
  const similar = await sourceSimilar(novelDir, "茵蒂克丝咬了上条的头") as { hits: { text: string; score: number }[] };
  assert.ok(similar.hits[0].text.includes("茵蒂克丝"), "the passage that words it alike comes first");
});

test("the world's review pool: a batch for the main agent; an answer must be one of the item's options, with a reason; only in a world-first book", async () => {
  const novelDir = await book(true);
  await writePool(novelDir, [item("wi_0000000000000001"), item("wi_0000000000000002")]);
  const batch = await makeBatch(novelDir, await loadPool(novelDir));
  assert.deepEqual((await worldPool(novelDir)).waiting, [{ batch: batch.id, items: 2, answered: 0 }]);
  const shown = await worldBatch(novelDir, batch.id) as { items: { item: string; options: string[] }[]; how: string };
  assert.equal(shown.items.length, 2);
  assert.match(shown.how, /novel source grep/);
  await assert.rejects(worldAnswer(novelDir, batch.id, "wi_0000000000000001", "maybe", "why"), /Answer with one of/);
  await assert.rejects(worldAnswer(novelDir, batch.id, "wi_0000000000000001", "same", " "), /--reason is required/);
  await worldAnswer(novelDir, batch.id, "wi_0000000000000001", "same", "b0001_s0002 calls 上条当麻 刺猬头少年");
  assert.equal((await loadPool(novelDir)).find((entry) => entry.id === "wi_0000000000000001")?.status, "answered");
  await assert.rejects(worldPool(await book(false)), /not a world-first workspace/);
});

test("a landscape Jev is unsure of is a question for the main agent: any landscape (or none), asked again only when the pick's inputs change", async () => {
  const novelDir = await book(true);
  const pick = { label: "第七学区", type: "commercial" as const, inputs: "abc", confidence: 0.4, probabilities: { commercial: 0.4, residential: 0.35, skyscrapers: 0.2 } };
  const item = landscapeItem("loc_000002", pick);
  assert.match(item.id, /^wi_[a-f0-9]{16}$/);
  assert.equal(item.id, landscapeItem("loc_000002", pick).id);
  assert.notEqual(item.id, landscapeItem("loc_000002", { ...pick, inputs: "abd" }).id);
  assert.ok(item.options.includes("park") && item.options.includes("none"));
  assert.match(item.evidence[0], /commercial 40%, residential 35%/);
  await writePool(novelDir, [item]);
  const batch = await makeBatch(novelDir, await loadPool(novelDir));
  await worldAnswer(novelDir, batch.id, item.id, "residential", "b0002_s0010 calls it a district of student dorms");
  assert.equal((await loadPool(novelDir))[0].status, "answered");
});
