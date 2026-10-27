import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describeError, EXIT_CODES, graphSchema, NovelError } from "../src/ground/errors.js";

const cli = fileURLToPath(new URL("../src/cli/cli.js", import.meta.url));
const run = (...args: string[]) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: process.env.HOME, NOVEL_SECRETS_DIR: join(tmpdir(), "no-cli-error-keys") } });

test("errors say what kind of problem it is, what to change and what to run next", () => {
  const dir = "/books/novel";
  const query = (message: string) => describeError(new Error(message), ["query", dir, "MATCH (e) RETURN e"]);
  assert.match(query("Binder exception: Table Entity does not exist.").hint!, /no Entity table: entities are stored per kind \(Character, Location/);
  assert.match(query("Binder exception: Table HAS_NAME does not exist.").hint!, /Relationship tables: CAUSES, CAUSED_BY/);
  assert.match(query("Binder exception: Cannot find property canonicalName for c.").hint!, /Use canonical_name/);
  assert.match(query("Binder exception: Cannot find property location_id for s.").hint!, /LOCATED_AT relationship/);
  assert.match(query("Catalog exception: function TYPE does not exist.").hint!, /label\(r\)/);
  const outdated = query("Binder exception: Table TimePoint does not exist.");
  assert.deepEqual([outdated.aspect, outdated.code, outdated.next], ["graph", "GRAPH_OUTDATED", [`novel graph build ${dir}/ontology`]], "a table the schema has is a graph built by an older version");
  assert.ok(query("Binder exception: Table Sentence does not exist.").hint!.includes("Source text is not in the graph"));
  assert.ok((query("Parser exception: Invalid input").details!.schema as ReturnType<typeof graphSchema>).nodes.Character.includes("canonical_name"));
  const stale = describeError(new Error("Stale review revision or canonical context; read current review show/evidence again."), ["review", "apply", dir, "cs_b0001", "--scope", "book", "--revision", "x"]);
  assert.deepEqual([stale.aspect, stale.next], ["stale", [`novel review show ${dir} cs_b0001 --scope book --offset 0 --limit 20`]]);
  assert.equal(describeError(new Error("Mention-only identity char_1 must be a retained Character."), ["changeset", "revise", dir, "cs_b0002"]).code, "DECISION_REFUSED");
  assert.equal(describeError(new Error("Evidence needs two distinct known event/dialogue endpoints."), ["causality", "evidence", dir, "scene_1", "scene_2"]).code, "CAUSAL_ENDPOINTS");
  assert.equal(describeError(new Error("No entity char_9 in /books/novel"), ["fix", "merge", dir]).aspect, "not_found");
  assert.equal(describeError(new Error("Usage: novel init <novel-dir>"), ["init"]).aspect, "usage");
  assert.equal(describeError(new Error("something odd"), []).aspect, "internal");
  const typed = describeError(new NovelError("Decision #2 repeats factId f1", { aspect: "review", code: "DECISION_INVALID" }), []);
  assert.deepEqual([typed.error, typed.aspect], ["Decision #2 repeats factId f1", "review"]);
  assert.deepEqual([EXIT_CODES.usage, EXIT_CODES.path, EXIT_CODES.query, EXIT_CODES.review, EXIT_CODES.model, EXIT_CODES.internal], [2, 3, 4, 5, 6, 1]);
});

test("the CLI prints one JSON report on stderr and exits with the aspect's code", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "cli-errors-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const usage = run("inspect");
  assert.equal(usage.status, 2);
  assert.deepEqual([JSON.parse(usage.stderr).aspect, JSON.parse(usage.stderr).code], ["usage", "USAGE"]);
  assert.match(JSON.parse(usage.stderr).error, /^Usage: novel inspect/, "the message keeps its text (no Error: prefix)");
  const missing = run("inspect", join(parent, "nowhere"));
  assert.equal(missing.status, 3);
  assert.equal(JSON.parse(missing.stderr).code, "WORKSPACE_NOT_FOUND");
});
