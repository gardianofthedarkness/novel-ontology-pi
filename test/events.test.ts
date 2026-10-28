import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, appendFile, mkdir, rm, access, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventLog, eventLogPath, readEventBatch, validateCursor, cursorId, type LogIdentity } from "../src/ground/events/log.js";
import { newChangeSet } from "../src/solidifier/merge/changeset.js";
import { saveChangeSet, setChangeSetStatus, loadChangeSet } from "../src/solidifier/merge/changesetStore.js";
import { applyChangeSet } from "../src/solidifier/merge/apply.js";
import { BundleStore } from "../src/ground/connectors/bundle.js";
import { BlockProcessor } from "../src/digger/processing/blockProcessor.js";
import { MockDecisionModel } from "../src/ground/connectors/jev.js";
import type { ChangeProposal } from "../src/solidifier/merge/changeset.js";

const proposal = (): ChangeProposal => ({
  id: "p1", kind: "upsert_entity", confidence: 0.9,
  payload: { id: "char_1", kind: "Character", names: [], properties: {}, confidence: 0.9 },
  provenance: { blockId: "b1", sentenceIds: ["s1"], patchId: "fixture" },
});

test("event log serializes concurrent appenders with stable byte IDs across reopen; credentials are excluded", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "novel-events-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const log = new EventLog(root);
  const records = await Promise.all(Array.from({ length: 20 }, (_, i) => new EventLog(root).append({ type: "block.started", blockId: `第${i}章` })));
  assert.deepEqual(await readEventBatch(log.path, 0), records);
  assert.equal(Number(records.at(-1)!.id), Buffer.byteLength(await readFile(log.path, "utf8")));
  const fakeCredentials = "test-only-secret-never-log";
  const p = { ...proposal(), apiKey: fakeCredentials, payload: { Authorization: fakeCredentials } };
  await log.emit({ type: "proposal.added", changesetId: "cs", proposal: p });
  const raw = await readFile(log.path, "utf8");
  assert.ok(!raw.includes(fakeCredentials));
  assert.ok(!raw.includes("payload"));
  assert.equal(await validateCursor(log.path, records[3].id), Number(records[3].id));
  await assert.rejects(validateCursor(log.path, cursorId(1)));
  await assert.rejects(validateCursor(log.path, cursorId(raw.length + 1000)));
  await access(log.path);
  await assert.rejects(access(`${log.path}.lock`));
});

test("reader keeps half a UTF-8 line pending; writer refuses partial history and releases its lock", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "novel-half-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const log = new EventLog(root);
  const record = await log.append({ type: "block.started", blockId: "汉字" });
  const bytes = await readFile(log.path);
  const split = bytes.indexOf(Buffer.from("汉")) + 1;
  await writeFile(log.path, bytes.subarray(0, split));
  assert.deepEqual(await readEventBatch(log.path, 0), []);
  await assert.rejects(log.append({ type: "block.started", blockId: "bad" }), /incomplete tail/);
  await assert.rejects(access(`${log.path}.lock`));
  await appendFile(log.path, bytes.subarray(split));
  assert.deepEqual(await readEventBatch(log.path, 0), [record]);
  const second = await log.append({ type: "sectioned", blockId: "汉字", sentences: 1 });
  assert.deepEqual(await readEventBatch(log.path, Number(record.id)), [second]);
});

test("persisted gate states precede their facts; failed writes cannot claim success", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "novel-gate-events-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const cs = newChangeSet("b1");
  cs.status = "pending_review";
  cs.proposals = [proposal()];
  await saveChangeSet(root, cs);
  await saveChangeSet(root, cs); // no duplicate proposal/status fact on an unchanged save
  for (const status of ["held", "revision_requested", "approved"] as const) {
    await setChangeSetStatus(root, cs.id, status, { p1: "test-only-review-secret" });
    assert.equal((await loadChangeSet(root, cs.id)).status, status);
    const last = (await readEventBatch(eventLogPath(root), 0)).at(-1)!;
    assert.equal(last.event.type, `changeset.${status}`);
    assert.ok(!JSON.stringify(last).includes("test-only-review-secret"));
  }
  const log = new EventLog(root);
  const approved = await loadChangeSet(root, cs.id);
  const before = await readFile(log.path, "utf8");
  // A real BundleStore failure: ontology directory is absent.
  await assert.rejects(applyChangeSet(new BundleStore(join(root, "ontology")), approved, log.emit));
  assert.equal(await readFile(log.path, "utf8"), before);
  assert.equal((await loadChangeSet(root, cs.id)).status, "approved");
  await mkdir(join(root, "ontology"));
  const materialized = await applyChangeSet(new BundleStore(join(root, "ontology")), approved, log.emit);
  assert.deepEqual(materialized, { applied: 1, processed: 1, deferred: 0 });
  assert.equal((await readEventBatch(log.path, 0)).at(-1)!.event.type, "changeset.merged");
  assert.ok((await readFile(join(root, "ontology", "entities.jsonl"), "utf8")).includes("char_1"));
  assert.equal((await loadChangeSet(root, cs.id)).status, "approved"); // no invented merged status
  approved.proposals = [{ ...proposal(), kind: "add_alias" }];
  const deferred = await applyChangeSet(new BundleStore(join(root, "ontology")), approved, log.emit);
  assert.deepEqual(deferred, { applied: 0, processed: 1, deferred: 1 });
  const last = (await readEventBatch(log.path, 0)).at(-1)!.event;
  assert.equal(last.type, "changeset.applied");
  if (last.type === "changeset.applied") assert.deepEqual(last.unsupportedProposalIds, ["p1"]);

  // A deterministic filesystem failure before state rename must add no facts.
  const failed = newChangeSet("failed");
  await mkdir(join(root, "changesets", `${failed.id}.json`));
  const beforeFailure = await readFile(log.path, "utf8");
  await assert.rejects(saveChangeSet(root, failed));
  assert.equal(await readFile(log.path, "utf8"), beforeFailure);
});

test("real BlockProcessor + mocked model records whole gate decisions, not scripted verdicts", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "novel-processor-events-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  for (const decision of ["held", "revision_requested", "approved"] as const) {
    const novelDir = join(root, decision);
    await mkdir(novelDir);
    await mkdir(join(novelDir, "ontology"));
    const processor = new BlockProcessor(new BundleStore(join(novelDir, "ontology")), new MockDecisionModel(), async () => decision, { novelDir });
    const result = await processor.processNovel([{ blockId: "b1", text: "她走进房间。" }]);
    const events = (await readEventBatch(eventLogPath(novelDir), 0)).map((r) => r.event);
    assert.deepEqual(events.slice(0, 2).map((e) => e.type), ["block.started", "sectioned"]);
    // Gate states still precede their facts; draft.updated transport
    // facts (Phase B) may interleave anywhere after sectioning.
    const firstGateFact = events.findIndex((e) => e.type.startsWith("changeset."));
    assert.equal(events[firstGateFact].type, "changeset.pending");
    assert.equal((await loadChangeSet(novelDir, "cs_b1")).status, decision);
    assert.equal(events.filter((e) => e.type === "changeset.merged").length, decision === "approved" ? 1 : 0);
    assert.equal(result.stoppedAt, decision === "approved" ? null : "b1");
    assert.ok(events.every((e) => e.type !== ("verdict" as string) && e.type !== "graph.rebuilt"));
  }
});

test("failed model/reviewer and a partially written bundle never produce a merge success or leak errors", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "novel-failed-processing-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const secret = "fixture-authorization-must-not-be-logged";
  const processor = new BlockProcessor(new BundleStore(join(root, "ontology")), {
    modelId: "fixture-failure", decide: async () => { throw new Error(secret); },
  }, async () => "approved", { novelDir: root });
  await assert.rejects(processor.processNovel([{ blockId: "b1", text: "A sentence." }]));
  const log = new EventLog(root);
  // The failing model's calls are reported as failed faculty calls: never a merge, never the error text.
  const failed = await readEventBatch(log.path, 0);
  assert.deepEqual(failed.slice(0, 2).map((r) => r.event.type), ["block.started", "sectioned"]);
  const calls = failed.slice(2).map((r) => r.event.type === "faculty.activity" ? r.event.status : r.event.type);
  assert.ok(calls.length > 0 && calls.every((status) => status === "started" || status === "failed"), calls.join(", "));
  assert.equal(calls.at(-1), "failed");
  assert.ok(!JSON.stringify(failed).includes(secret));
  const reviewFailure = new BlockProcessor(new BundleStore(join(root, "ontology")), new MockDecisionModel(), async () => { throw new Error(secret); }, { novelDir: root });
  await assert.rejects(reviewFailure.processNovel([{ blockId: "b2", text: "A sentence." }]));
  assert.equal((await loadChangeSet(root, "cs_b2")).status, "pending_review");
  assert.equal((await readEventBatch(log.path, 0)).at(-1)!.event.type, "changeset.pending");
  await mkdir(join(root, "ontology"));
  // Fixture: the first real bundle append succeeds, then a second append fails.
  await mkdir(join(root, "ontology", "events.jsonl"));
  const cs = newChangeSet("partial");
  cs.status = "approved";
  cs.proposals = [proposal(), { ...proposal(), id: "fixture-event", kind: "create_event" }];
  const before = await readFile(log.path, "utf8");
  await assert.rejects(applyChangeSet(new BundleStore(join(root, "ontology")), cs, log.emit));
  assert.ok((await readFile(join(root, "ontology", "entities.jsonl"), "utf8")).includes("char_1"));
  assert.equal(await readFile(log.path, "utf8"), before);
  assert.ok(!before.includes(secret));
});

test("a competing log lock is preserved and replay detects file replacement after cursor validation", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "novel-log-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const log = new EventLog(root);
  await writeFile(`${log.path}.lock`, "fixture-other-writer");
  await assert.rejects(log.append({ type: "block.started", blockId: "locked" }), { code: "EEXIST" });
  assert.equal(await readFile(`${log.path}.lock`, "utf8"), "fixture-other-writer");
  await rm(`${log.path}.lock`);
  const record = await log.append({ type: "block.started", blockId: "original" });
  const identity: LogIdentity = {};
  await validateCursor(log.path, record.id, identity);
  await writeFile(join(root, "replacement"), await readFile(log.path));
  await rename(join(root, "replacement"), log.path);
  await assert.rejects(readEventBatch(log.path, Number(record.id), identity), /replaced/);
});

test("draft.updated: BlockProcessor announces every published draft batch; the log round-trips it", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "novel-draft-events-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "ontology"));
  const processor = new BlockProcessor(new BundleStore(join(root, "ontology")), new MockDecisionModel(), async () => "approved", { novelDir: root });
  await processor.processNovel([{ blockId: "b0007", text: "她走进房间。她说：你好。" }]);
  const events = (await readEventBatch(eventLogPath(root), 0)).map((r) => r.event);
  const drafts = events.filter((e) => e.type === "draft.updated");
  assert.ok(drafts.length >= 2, `expected several draft batches, got ${drafts.length}`);
  assert.ok(drafts.every((e) => e.type === "draft.updated" && e.blockId === "b0007" && typeof e.patchId === "string"));
  // The announced draft is fetchable state: the file on disk is a real
  // working draft for the same block, ending at the gate stage — while
  // the last ANNOUNCEMENT is a decision batch (the gate transition is
  // changeset.pending's fact, not a draft batch).
  const onDisk = JSON.parse(await readFile(join(root, "working", "b0007.json"), "utf8"));
  assert.equal(onDisk.blockId, "b0007");
  assert.equal(onDisk.stage, "gate");
  assert.notEqual(drafts.at(-1)!.type === "draft.updated" && drafts.at(-1)!.stage, "gate");
});

test("projectEvent passes entity match facts through with ids only", async () => {
  const { projectEvent } = await import("../src/ground/events/types.js");
  assert.deepEqual(
    projectEvent({ type: "entity.merged", keepId: "char_a", dropId: "char_b" }),
    { type: "entity.merged", keepId: "char_a", dropId: "char_b" },
  );
  assert.deepEqual(
    projectEvent({ type: "entity.distinct", aId: "char_a", bId: "char_b" }),
    { type: "entity.distinct", aId: "char_a", bId: "char_b" },
  );
});
