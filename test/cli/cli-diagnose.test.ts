import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeError } from "../../src/ground/errors.js";
import { ERROR_CATALOG } from "../../src/ground/errorCatalog.js";
import { diagnose } from "../../src/cli/diagnose.js";
import { initWorkspace } from "../../src/ground/workspace/init.js";
import { sectionBlock } from "../../src/reading/text/sectioning.js";
import type { OntEvent } from "../../src/ground/ontology/types.js";

const failing = (message: string, argv: string[]) => diagnose(describeError(new Error(message), argv), argv);

test("ids, options and paths are diagnosed from the workspace itself", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "diagnose-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = join(parent, "novel");
  await initWorkspace(dir);
  await writeFile(join(dir, "ontology", "entities.jsonl"), ["char_000001", "char_000002"].map((id, index) => JSON.stringify({ id, kind: "Character", names: [{ text: index ? "乙" : "甲", lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 })).join("\n") + "\n");
  await writeFile(join(dir, "events.jsonl"), JSON.stringify({ ts: "2026-10-27T00:00:00Z", event: { type: "entity.merged", keepId: "char_000001", dropId: "char_000003" } }) + "\n");
  const merged = await failing(`No entity char_000003 in ${dir}.`, ["fix", "merge", dir, "char_000002", "char_000003", "--reason", "x"]);
  assert.match(merged.notes![0], /char_000003 was merged into char_000001/);
  assert.deepEqual(merged.suggestions![0], { message: "Use char_000001", applicability: "machine-applicable", command: ["fix", "merge", dir, "char_000002", "char_000001", "--reason", "x"] });
  const unknown = await failing(`No entity char_000009 in ${dir}.`, ["fix", "merge", dir, "char_000001", "char_000009"]);
  assert.match(unknown.notes![0], /nearest ids: char_00000\d \((甲|乙)\)/);
  const option = await failing("Invalid or duplicate review option --ofset; show takes --scope, --universe, --offset, --limit, each once with a value.", ["review", "show", dir, "cs_b0001", "--ofset", "0"]);
  assert.deepEqual([option.aspect, option.code, option.suggestions![0].command], ["usage", "UNKNOWN_OPTION", ["review", "show", dir, "cs_b0001", "--offset", "0"]]);
  const path = await failing(`not a novel workspace: ${parent} — no ontology/manifest.json`, ["inspect", parent]);
  assert.match(path.notes![0], new RegExp(`Workspaces near .*${dir.replace(/[/\\]/g, ".")}`));
  assert.deepEqual(path.suggestions![0].command, ["inspect", dir]);
  const usage = await failing("Usage: novel review show|evidence|decide|apply <root> <packet> --scope book|universe|library ...", ["review", "show", dir]);
  assert.deepEqual(usage.suggestions![0].command, ["review", "show", dir, "<packet>"]);
});

test("every code has an explanation, and reports point at it", () => {
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) assert.ok(entry.title && entry.why && entry.fix, code);
  assert.equal(describeError(new Error("Usage: novel inspect <dir>"), ["inspect"]).explain, "novel explain USAGE");
});
