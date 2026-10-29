import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { BundleStore } from "../src/ground/connectors/bundle.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import { proposeCausalityLink } from "../src/cli/commands/extract/causalityCommands.js";
import { reviewCommand } from "../src/cli/commands/extract/reviewCommands.js";
import { loadChangeSet, saveChangeSet } from "../src/solidifier/merge/changesetStore.js";
import { review } from "../src/solidifier/merge/review.js";
import { libraryPropose, libraryShow } from "../src/ground/workspace/library.js";
import { loadUniverseContext, qualifyCausalUnit, universeCausalView, universePropose } from "../src/solidifier/causality/universe.js";
import { universeFixture } from "./helpers/universeFixture.js";
import type { ReviewTarget } from "../src/solidifier/merge/reviewTypes.js";
import type { OntEvent } from "../src/ground/ontology/types.js";
import type { ChangeSet } from "../src/solidifier/merge/changeset.js";

interface Page {
  revision: string;
  stale: boolean;
  facts: { id: string; meaning: unknown; evidencePage: { nextOffset: number | null } }[];
  page: { nextOffset: number | null };
  staged?: boolean;
  applied?: boolean;
  accepted?: number;
  verified?: number;
  held?: number;
  rejected?: number;
  result?: { applied: number; deferredFacts: number; appliedOrganization?: boolean };
}

const run = (operation: string, target: ReviewTarget, options = {}) => review(operation, target, options, { NOVEL_SECRETS_DIR: join(tmpdir(), "no-unified-review-keys") }) as Promise<Page>;
const accept = (factId: string) => ({ factId, verdict: "accept", reason: "原文明确支持该因果关系。", temporalReason: "第二卷原文明确回指第一卷的先行原因。" });

async function bookFixture(context: { after: (callback: () => Promise<void>) => void }) {
  const parent = await mkdtemp(join(tmpdir(), "unified-book-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const original = Array.from({ length: 12 }, (_, index) => `甲推动第${index + 1}扇门。`).join("\n");
  await writeFile(join(directory, "source", "novel.txt"), original);
  const sentences = sectionBlock(original, 0).sentences;
  const events: OntEvent[] = [0, 1].map(index => ({ id: `evt_${index}`, timelineId: "tl_canon", chapterIndex: 0, chronologicalOrder: index, summaryEn: index ? "门开启了" : "甲推门", eventType: "action", importance: 0.5, primaryActors: [], affectedCharacters: [], evidence: { text: original, sentenceIds: sentences.slice(index * 6, index * 6 + 6).map(sentence => sentence.id) }, confidence: 1 }));
  await writeFile(join(directory, "ontology", "events.jsonl"), events.map(event => JSON.stringify(event)).join("\n") + "\n");
  const proposed = await proposeCausalityLink(directory, "evt_0", "evt_1", { reason: "原文推门导致门打开。" });
  const target: ReviewTarget = { directory, packetId: proposed.changesetId, scope: "book" };
  return { directory, target, proposed, sentences };
}

async function readEvidence(target: ReviewTarget, factId: string) {
  let offset: number | null = 0;
  do { offset = (await run("evidence", target, { factId, offset, limit: 2 })).page.nextOffset; } while (offset !== null);
}

test("standalone causality uses the same fact gate: staged decisions, complete evidence, explicit apply and no duplicate write", async context => {
  const { directory, target } = await bookFixture(context);
  const path = join(directory, "changesets", `${target.packetId}.json`);
  const predecessor = await readFile(path, "utf8");
  const page = await run("show", target);
  assert.equal(page.facts.length, 1);
  assert.equal(await readFile(path, "utf8"), predecessor);
  const factId = page.facts[0].id;
  await assert.rejects(run("decide", target, { revision: page.revision, decisions: [accept(factId)] }), /Incomplete original evidence/);
  await readEvidence(target, factId);
  const staged = await run("decide", target, { revision: page.revision, decisions: [accept(factId)] });
  assert.equal(staged.staged, true);
  assert.equal(staged.applied, false);
  assert.equal((await new BundleStore(join(directory, "ontology")).loadFile("relations.jsonl")).length, 0);
  assert.equal(await readFile(path, "utf8"), predecessor);
  const applied = await run("apply", target, { revision: page.revision });
  assert.equal(applied.result?.applied, 1);
  assert.equal((await new BundleStore(join(directory, "ontology")).loadFile("relations.jsonl")).length, 1);
  const inspected = await run("show", target);
  assert.equal(inspected.applied, true);
  assert.equal(inspected.accepted, 1);
  assert.equal(inspected.verified, 1);
  await assert.rejects(run("apply", target, { revision: page.revision }), /already applied/);
  assert.deepEqual((await loadChangeSet(directory, target.packetId)).proposals, JSON.parse(predecessor).proposals);
});

test("shared review refuses no-decision apply, stale evidence, unknown facts, duplicate decisions and endpoint correction", async context => {
  const { directory, target } = await bookFixture(context);
  const page = await run("show", target);
  const factId = page.facts[0].id;
  await assert.rejects(run("apply", target, { revision: page.revision }), /explicit decisions/);
  await assert.rejects(run("decide", target, { revision: page.revision, decisions: [accept("missing")] }), /Decision #1 has unknown factId "missing"/);
  await assert.rejects(run("decide", target, { revision: page.revision, decisions: [accept(factId), accept(factId)] }), /Duplicate/);
  try {
    await run("decide", target, { revision: page.revision, decisions: [accept(factId), accept(factId)] });
    assert.fail("duplicate decisions should be refused");
  } catch (error) {
    const info = (error as { info?: { aspect?: string; code?: string } }).info;
    assert.equal(info?.aspect, "review", "duplicate decisions classify as review, not internal");
    assert.equal(info?.code, "DECISION_INVALID");
  }
  await readEvidence(target, factId);
  await assert.rejects(run("decide", target, { revision: page.revision, decisions: [{ ...accept(factId), semanticReplacement: { fromId: "different" } }] }), /relation evidence workflow/);
  const packet = await loadChangeSet(directory, target.packetId);
  packet.reviewNotes.new = "修订了提案。";
  packet.createdAt = new Date(Date.now() + 1000).toISOString();
  await saveChangeSet(directory, packet);
  await assert.rejects(run("decide", target, { revision: page.revision, decisions: [accept(factId)] }), /Stale/);
  const fresh = await run("show", target);
  assert.notEqual(fresh.revision, page.revision);
  await assert.rejects(run("decide", target, { revision: fresh.revision, decisions: [accept(factId)] }), /Incomplete original evidence/);
});

test("held and rejected causal assertions never become canonical", async context => {
  const { directory, target } = await bookFixture(context);
  const page = await run("show", target);
  await run("decide", target, { revision: page.revision, decisions: [{ factId: page.facts[0].id, verdict: "hold", reason: "证据不足，暂缓。" }] });
  const applied = await run("apply", target, { revision: page.revision });
  assert.equal(applied.result?.deferredFacts, 1);
  assert.equal((await new BundleStore(join(directory, "ontology")).loadFile("relations.jsonl")).length, 0);
  const rejected = await bookFixture(context);
  const shown = await run("show", rejected.target);
  await run("decide", rejected.target, { revision: shown.revision, decisions: [{ factId: shown.facts[0].id, verdict: "reject", reason: "原文否定该关系。" }] });
  const excluded = await run("apply", rejected.target, { revision: shown.revision });
  assert.equal(excluded.rejected, 1);
  assert.equal(excluded.verified, 0);
  assert.equal((await new BundleStore(join(rejected.directory, "ontology")).loadFile("relations.jsonl")).length, 0);
});

test("universe decisions are staged without writing the ledger, require temporal evidence, and apply only to their scope", async context => {
  const fixture = await universeFixture(context);
  const world = await loadUniverseContext(fixture.directory, "world");
  const proposed = await universePropose(world, qualifyCausalUnit(fixture.sources[0].id, "ev_1"), qualifyCausalUnit(fixture.sources[1].id, "ev_1"), "原文明示前卷开闸导致城镇进水。");
  const target: ReviewTarget = { directory: fixture.directory, packetId: proposed.packetId, scope: "universe", universeId: "world" };
  const page = await run("show", target);
  const factId = page.facts[0].id;
  await readEvidence(target, factId);
  await assert.rejects(run("decide", target, { revision: page.revision, decisions: [{ factId, verdict: "accept", reason: "因果明确" }] }), /temporalReason/);
  await run("decide", target, { revision: page.revision, decisions: [accept(factId)] });
  assert.equal((await universeCausalView(fixture.directory)).links.filter(link => link.state === "canon").length, 0);
  const before = await readFile(join(fixture.workspaces[0], "ontology", "events.jsonl"), "utf8");
  await run("apply", target, { revision: page.revision });
  assert.equal((await universeCausalView(fixture.directory)).links.filter(link => link.state === "canon").length, 1);
  assert.equal(await readFile(join(fixture.workspaces[0], "ontology", "events.jsonl"), "utf8"), before);
  await assert.rejects(run("apply", target, { revision: page.revision }), /already applied/);
});

test("library organization uses the same show/decide/apply contract and stays atomic", async context => {
  const fixture = await universeFixture(context);
  const before = await libraryShow(fixture.directory);
  const plan = await libraryPropose(fixture.directory, fixture.organization, before.revision);
  const target: ReviewTarget = { directory: fixture.directory, packetId: plan.planId, scope: "library" };
  const page = await run("show", target);
  assert.ok(page.facts.length > 1);
  await run("decide", target, { revision: page.revision, decisions: page.facts.map(fact => accept(fact.id)) });
  assert.equal((await libraryShow(fixture.directory)).generation, before.generation);
  const result = await run("apply", target, { revision: page.revision });
  assert.equal(result.result?.appliedOrganization, true);
  assert.equal((await libraryShow(fixture.directory)).generation, before.generation + 1);
});

test("one shared CLI parser rejects unknown scope, duplicate flags and faculty-specific bypass flags", async () => {
  for (const args of [
    ["show", "/tmp/root", "packet", "--scope", "faculty"],
    ["show", "/tmp/root", "packet", "--limit", "1", "--limit", "2"],
    ["apply", "/tmp/root", "packet", "--auto-approve", "yes"],
    ["apply", "/tmp/root", "packet", "--revision", "stale"],
    ["decide", "/tmp/root", "packet", "--revision", "a".repeat(64), "--decisions", "x".repeat(64001)],
  ]) await assert.rejects(reviewCommand(args, {}));
});

test("ingestion uses the same staging gate, preserves semantic corrections and leaves identity-dependent facts held", async context => {
  const { directory, sentences } = await bookFixture(context);
  const sentenceIds = sentences.map(sentence => sentence.id);
  const provenance = { blockId: "b0001", sentenceIds, patchId: "synthetic" };
  const entity = (id: string, text: string) => ({ id, kind: "Character" as const, names: [{ text, lang: "zh", kind: "canonical" as const }], properties: {}, confidence: 1 });
  const packet: ChangeSet = { id: "cs_b0001", blockId: "b0001", status: "pending_review", createdAt: new Date().toISOString(), reviewNotes: {}, reviewSource: sentences,
    proposals: [
      { id: "first", kind: "upsert_entity", payload: entity("char_a", "甲"), provenance, confidence: 1 },
      { id: "second", kind: "upsert_entity", payload: entity("char_b", "乙"), provenance, confidence: 1 },
      { id: "scene", kind: "create_scene", payload: { id: "scene_0", chapterIndex: 0, sentenceIds, charactersPresent: ["char_a", "char_b"], charactersMentioned: [], locationId: null, turns: [] }, provenance, confidence: 1 },
      { id: "knows", kind: "add_relation", payload: { fromId: "char_a", toId: "char_b", type: "KNOWS", properties: {}, confidence: 1 }, provenance, confidence: 1 },
    ] };
  await saveChangeSet(directory, packet);
  const target: ReviewTarget = { directory, packetId: packet.id, scope: "book" };
  const page = await run("show", target);
  await run("decide", target, { revision: page.revision, decisions: [accept("first/identity"), { ...accept("scene/presence"), semanticReplacement: ["甲"] }, accept("knows/relation"), { factId: "second/identity", verdict: "hold", reason: "原文不支持该人物。" }] });
  await run("decide", target, { revision: page.revision, decisions: [accept("scene/presence")] });
  assert.equal((await loadChangeSet(directory, packet.id)).semanticReview, undefined);
  await run("apply", target, { revision: page.revision });
  const canonical = new BundleStore(join(directory, "ontology"));
  assert.equal((await canonical.loadFile("entities.jsonl")).length, 1);
  assert.deepEqual((await canonical.loadFile<{ charactersPresent: string[] }>("scenes.jsonl"))[0].charactersPresent, ["char_a"]);
  assert.equal((await canonical.loadFile("relations.jsonl")).length, 0);
  assert.deepEqual((await loadChangeSet(directory, packet.id)).proposals, packet.proposals);
  const inspected = await run("show", target);
  assert.equal(inspected.accepted, 3);
  assert.equal(inspected.verified, 2);
  assert.equal(inspected.held, 2);
});

test("changed original text and canonical causal context invalidate staged acceptance", async context => {
  const { directory, target } = await bookFixture(context);
  const page = await run("show", target);
  const factId = page.facts[0].id;
  await readEvidence(target, factId);
  await run("decide", target, { revision: page.revision, decisions: [accept(factId)] });
  const original = await readFile(join(directory, "source", "novel.txt"), "utf8");
  await writeFile(join(directory, "source", "novel.txt"), original.replace("第1", "第一"));
  await assert.rejects(run("apply", target, { revision: page.revision }), /Stale/);
  assert.equal((await loadChangeSet(directory, target.packetId)).status, "pending_review");
});

test("partial library acceptance holds the whole organization and unseen plan pages cannot authorize a decision", async context => {
  const fixture = await universeFixture(context);
  const before = await libraryShow(fixture.directory);
  const plan = await libraryPropose(fixture.directory, fixture.organization, before.revision);
  const target: ReviewTarget = { directory: fixture.directory, packetId: plan.planId, scope: "library" };
  const first = await run("show", target, { limit: 1 });
  await assert.rejects(run("decide", target, { revision: first.revision, decisions: [accept(first.facts[0].id)] }), /every current assertion/);
  await run("show", target);
  await run("decide", target, { revision: first.revision, decisions: [accept(first.facts[0].id)] });
  const applied = await run("apply", target, { revision: first.revision });
  assert.equal(applied.result?.appliedOrganization, false);
  assert.deepEqual((await libraryShow(fixture.directory)).organization, before.organization);
});

test("accepting the rest of a page accepts only what that page showed and this batch does not name; unread pages and named holds stay held", async context => {
  const { directory, sentences } = await bookFixture(context);
  const provenance = { blockId: "b0001", sentenceIds: sentences.map(sentence => sentence.id), patchId: "synthetic" };
  const entity = (id: string, text: string) => ({ id, kind: "Character" as const, names: [{ text, lang: "zh", kind: "canonical" as const }], properties: {}, confidence: 1 });
  const packet: ChangeSet = { id: "cs_b0001", blockId: "b0001", status: "pending_review", createdAt: new Date().toISOString(), reviewNotes: {}, reviewSource: sentences,
    proposals: [["first", "char_a", "甲"], ["door", "char_d", "门"], ["second", "char_b", "乙"], ["fan", "char_f", "扇"]].map(([id, entityId, text]) => ({ id, kind: "upsert_entity" as const, payload: entity(entityId, text), provenance, confidence: 1 })) };
  await saveChangeSet(directory, packet);
  const target: ReviewTarget = { directory, packetId: packet.id, scope: "book" };
  const rest = (offset: number) => ({ rest: "accept", offset, reason: "其余事实与所引原文一致。" });
  const first = await run("show", target, { limit: 2 });
  const [kept, held] = first.facts.map(fact => fact.id);
  await assert.rejects(run("decide", target, { revision: first.revision, decisions: [rest(2)] }), /No page at offset 2 was read/);
  const decided = await run("decide", target, { revision: first.revision, decisions: [{ factId: held, verdict: "hold", reason: "原文不足以确认。" }, rest(0)] }) as Page & { restAccepted: number };
  assert.equal(decided.restAccepted, 1);
  const second = await run("show", target, { offset: 2, limit: 2 });
  const later = await run("decide", target, { revision: second.revision, decisions: [rest(2), rest(0)] }) as Page & { restAccepted: number; restLeftOnHold?: { factId: string; problem: string }[] };
  // 乙 never occurs in the source: the gate refuses it, so it stays on hold and is named; the named hold is not flipped.
  assert.deepEqual(later.restLeftOnHold?.map(entry => entry.factId), ["second/identity"]);
  assert.match(later.restLeftOnHold![0].problem, /must occur in the original source/);
  assert.equal(later.restAccepted, 1);
  const shown = await run("show", target, { limit: 20 }) as unknown as { facts: { id: string; decision: { verdict: string } }[] };
  assert.deepEqual(Object.fromEntries(shown.facts.map(fact => [fact.id, fact.decision.verdict])), { [kept]: "accept", [held]: "hold", "second/identity": "hold", "fan/identity": "accept" });
  await assert.rejects(run("decide", target, { revision: first.revision, decisions: [{ rest: "hold", offset: 0, reason: "x" }] }), /only "accept" is allowed/);
});
