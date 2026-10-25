import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { bindWorkspaceSource, recallSourceBlock } from "../src/ground/workspace/source.js";
import { ingestNovel } from "../src/cli/commands/extract/ingestCommands.js";

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "novel-source-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "workspace");
  await initWorkspace(directory);
  const first = join(root, "volume-1.txt");
  const second = join(root, "volume-2.txt");
  const text = ["第一章 出发", ...Array.from({ length: 12 }, (_, index) => `段落${index}。${"故事文字".repeat(15)}`)].join("\n\n");
  await writeFile(first, text);
  await writeFile(second, "第一章 后续\n另一本书从同一个章节和块编号开始。");
  return { root, directory, first, second, text };
}

test("binding is idempotent and prevents a second volume from sharing b0001", async (t) => {
  const { directory, first, second } = await fixture(t);
  const source = await bindWorkspaceSource(directory, first);
  assert.deepEqual(await bindWorkspaceSource(directory, first), source);
  await assert.rejects(bindWorkspaceSource(directory, second), /different source/);
  assert.match((await recallSourceBlock(directory, "b0001")).text, /出发/);
});

test("ingest refuses a different source before model calls or approved-block skipping", async (t) => {
  const { directory, first, second } = await fixture(t);
  await bindWorkspaceSource(directory, first);
  await assert.rejects(ingestNovel(directory, second, { env: { TYPESAFE_API_KEY: "synthetic-key", NOVEL_SECRETS_DIR: directory } }), /different source/);
  assert.equal(await readFile(join(directory, "ontology", "entities.jsonl"), "utf8"), "");
});

test("bound recall preserves custom cut size across resumes", async (t) => {
  const { directory, first } = await fixture(t);
  await bindWorkspaceSource(directory, first, 200);
  const block = await recallSourceBlock(directory, "b0002");
  assert.equal(block.id, "b0002");
  assert.deepEqual(await bindWorkspaceSource(directory, first), await bindWorkspaceSource(directory, first, 200));
  await assert.rejects(bindWorkspaceSource(directory, first, 400), /block-size/);
});

test("source replacement and stored source tampering are refused", async (t) => {
  const { directory, first } = await fixture(t);
  const bound = await bindWorkspaceSource(directory, first);
  await writeFile(first, "new version");
  await assert.rejects(bindWorkspaceSource(directory, first), /different source/);
  await writeFile(join(directory, "source", bound.file), "corrupt");
  await assert.rejects(recallSourceBlock(directory, "b0001"), /changed/);
});

test("one unchanged legacy source can bind without renumbering and ambiguous legacy files fail", async (t) => {
  const { directory, first, text } = await fixture(t);
  await writeFile(join(directory, "source", "legacy.txt"), text);
  assert.equal((await recallSourceBlock(directory, "b0001")).id, "b0001");
  const binding = await bindWorkspaceSource(directory, first);
  assert.equal(binding.file, "legacy.txt");
  const other = await fixture(t);
  await writeFile(join(other.directory, "source", "one.txt"), other.text);
  await writeFile(join(other.directory, "source", "two.txt"), other.text);
  await assert.rejects(bindWorkspaceSource(other.directory, other.first), /Ambiguous legacy/);
  await assert.rejects(recallSourceBlock(other.directory, "b0001"), /unambiguous/);
});

test("processing history with no source cannot be silently rebound", async (t) => {
  const { directory, first } = await fixture(t);
  await writeFile(join(directory, "events.jsonl"), '{"event":{"type":"changeset.applied"}}\n');
  await assert.rejects(bindWorkspaceSource(directory, first), /history has no stored source/);
});
