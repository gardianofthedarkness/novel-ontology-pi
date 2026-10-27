import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describeError } from "../src/ground/errors.js";
import { ERROR_CATALOG } from "../src/ground/errorCatalog.js";
import { diagnose } from "../src/cli/diagnose.js";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import { proposeCausalityLink } from "../src/cli/commands/extract/causalityCommands.js";
import type { OntEvent } from "../src/ground/ontology/types.js";

const failing = (message: string, argv: string[]) => diagnose(describeError(new Error(message), argv), argv);

test("query errors: the variable's table is read from the query, and the fix is a corrected command", async () => {
  const dir = "/books/novel";
  const property = await failing("Binder exception: Cannot find property canonicalName for c.", ["query", dir, "MATCH (c:Character) RETURN c.id, c.canonicalName"]);
  assert.deepEqual(property.span, { argument: 2, text: "c.canonicalName", offset: 33, length: 15 });
  assert.match(property.notes![0], /c is bound to Character in the MATCH pattern; Character has: id, canonical_name/);
  assert.deepEqual(property.suggestions![0], { message: "Use c.canonical_name", applicability: "machine-applicable", command: ["query", dir, "MATCH (c:Character) RETURN c.id, c.canonical_name"] });
  const kind = await failing("Binder exception: Cannot find property kind for n.", ["query", dir, "MATCH (n:Location) RETURN n.kind"]);
  assert.equal(kind.suggestions![0].command![2], "MATCH (n:Location) RETURN label(n)");
  const where = await failing("Parser exception: Invalid input <MATCH (n) WHERE n:>", ["query", dir, "MATCH (n) WHERE n:Location OR n:Organization RETURN n.id"]);
  assert.equal(where.suggestions![0].command![2], "MATCH (n) WHERE label(n) = 'Location' OR label(n) = 'Organization' RETURN n.id");
  const type = await failing("Catalog exception: function TYPE does not exist.", ["query", dir, "MATCH (c:Character)-[r]->() RETURN type(r)"]);
  assert.equal(type.suggestions![0].command![2], "MATCH (c:Character)-[r]->() RETURN label(r)");
  const relationship = await failing("Binder exception: Table IN_SCENE does not exist.", ["query", dir, "MATCH (e:Event)-[:IN_SCENE]->(s:Scene) RETURN e.id"]);
  assert.match(relationship.notes![0], /No relationship joins Event to Scene/);
  const located = await failing("Binder exception: Cannot find property location_id for s.", ["query", dir, "MATCH (s:Scene) WHERE s.location_id = 'x' RETURN s.id"]);
  assert.equal(located.suggestions![0].applicability, "has-placeholders");
  assert.match(located.suggestions![0].command![2], /LOCATED_AT/);
});

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

test("a decision batch is checked against the packet's real facts, with a corrected batch", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "diagnose-review-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = join(parent, "novel");
  await initWorkspace(dir);
  const text = Array.from({ length: 6 }, (_, index) => `甲推动第${index + 1}扇门。`).join("\n");
  await writeFile(join(dir, "source", "novel.txt"), text);
  const sentences = sectionBlock(text, 0).sentences;
  const events: OntEvent[] = [0, 1].map((index) => ({ id: `evt_${index}`, timelineId: "tl_canon", chapterIndex: 0, chronologicalOrder: index, summaryEn: index ? "门开" : "推门", eventType: "action", importance: 0.5, primaryActors: [], affectedCharacters: [], evidence: { text, sentenceIds: sentences.slice(index * 3, index * 3 + 3).map((sentence) => sentence.id) }, confidence: 1 }));
  await mkdir(join(dir, "ontology"), { recursive: true });
  await writeFile(join(dir, "ontology", "events.jsonl"), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  const packet = (await proposeCausalityLink(dir, "evt_0", "evt_1", { reason: "推门导致门开。" })).changesetId;
  const argv = ["review", "decide", dir, packet, "--scope", "book", "--revision", "a".repeat(64), "--decisions", JSON.stringify([{ factId: "wrong-id", verdict: "approve", reason: "原文支持。" }])];
  const report = await failing("Decision #1 has unknown factId \"wrong-id\".", argv);
  assert.match(report.notes![0], new RegExp(`${packet} is pending_review with 1 proposals and 1 reviewable facts`));
  assert.match(report.notes![1], /#1 factId wrong-id is not in .*verdict "approve" means accept/);
  const fixed = JSON.parse(report.suggestions![0].command!.at(-1)!) as { factId: string; verdict: string }[];
  assert.equal(fixed[0].verdict, "accept");
  assert.deepEqual(report.span, { decision: 0, factId: "wrong-id" });
});

test("every code has an explanation, and reports point at it", () => {
  for (const [code, entry] of Object.entries(ERROR_CATALOG)) assert.ok(entry.title && entry.why && entry.fix, code);
  assert.equal(describeError(new Error("Usage: novel inspect <dir>"), ["inspect"]).explain, "novel explain USAGE");
});
