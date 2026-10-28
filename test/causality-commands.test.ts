/**
 * Agent-path causality commands — synthetic fixtures only.
 *
 * Covers: candidate listing (graph-only without an embedder), propose
 * validation (self-link, existing link, order contradiction, success +
 * pending_review changeset), and the on-demand sweep with a stub Jev.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import {
  listCausalityCandidates,
  proposeCausalityLink,
  runCausalitySweep,
} from "../src/cli/commands/extract/causalityCommands.js";
import { listChangeSets, setChangeSetStatus } from "../src/solidifier/merge/changesetStore.js";
import { applyChangeSet } from "../src/solidifier/merge/apply.js";
import { BundleStore } from "../src/ground/connectors/bundle.js";
import type { Entity, OntEvent, Relation, Scene } from "../src/ground/ontology/types.js";
import { checkCausalLinks } from "../src/solidifier/causality/checklist.js";
import { loadCausalityUniverse } from "../src/solidifier/causality/units.js";

const entities: Entity[] = [
  { id: "char_a", kind: "Character", names: [{ text: "A", lang: "", kind: "canonical" }], properties: {}, confidence: 1 },
  { id: "char_b", kind: "Character", names: [{ text: "B", lang: "", kind: "canonical" }], properties: {}, confidence: 1 },
];

function event(id: string, order: number, actors: string[], sentenceIds: string[]): OntEvent {
  return {
    id,
    timelineId: "tl_canon",
    chapterIndex: 0,
    chronologicalOrder: order,
    summaryEn: `${id} happens.`,
    eventType: "action",
    importance: 0.5,
    primaryActors: actors,
    affectedCharacters: [],
    evidence: { sentenceIds, text: `${id} happens.` },
    confidence: 1,
  };
}

const scenes: Scene[] = [
  {
    id: "sc_1",
    chapterIndex: 0,
    sentenceIds: ["s1", "s2"],
    charactersPresent: ["char_a"],
    charactersMentioned: [],
    turns: [],
    dialogues: [{ id: "card_1", sentenceIds: ["s2"], participantIds: ["char_a"], summary: "A speaks." }],
    locationId: "loc_1",
  },
  {
    id: "sc_2",
    chapterIndex: 0,
    sentenceIds: ["s3", "s4"],
    charactersPresent: ["char_b"],
    charactersMentioned: [],
    turns: [],
    dialogues: [{ id: "card_2", sentenceIds: ["s4"], participantIds: ["char_b"], summary: "B answers." }],
    locationId: "loc_1",
  },
];

const events: OntEvent[] = [
  event("ev_1", 1, ["char_a"], ["s1"]),
  event("ev_2", 2, ["char_a", "char_b"], ["s3"]),
];

async function writeNovelDir(parent: string, relations: Relation[] = []): Promise<string> {
  const dir = join(parent, "novel");
  await mkdir(join(dir, "ontology", "changesets"), { recursive: true });
  const write = async (file: string, rows: unknown[]) =>
    writeFile(join(dir, "ontology", file), rows.map((row) => JSON.stringify(row)).join("\n") + "\n", "utf8");
  await writeFile(join(dir, "ontology", "manifest.json"), JSON.stringify({ version: 1, embeddingModel: null, embeddingDimension: null }), "utf8");
  await write("entities.jsonl", entities);
  await write("events.jsonl", events);
  await write("scenes.jsonl", scenes);
  await write("relations.jsonl", relations);
  await write("state-changes.jsonl", []);
  return dir;
}

const stubDecisions: DecisionModel = {
  modelId: "stub-jev",
  decide: async (_state, questions) =>
    questions.map((question) => ({
      key: question.key,
      value: question.key.startsWith("causal:") ? 0.95 : 0.1,
    })),
};

test("bounded sweeps resume past rejected candidates instead of repeating the first page", async context => {
  const parent = await mkdtemp(join(tmpdir(), "causality-resume-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const model: DecisionModel = { modelId: "reject", decide: async (_state, questions) => questions.map(question => ({ key: question.key, value: question.key.startsWith("causal:") ? 0.1 : 0.9 })) };
  const first = await runCausalitySweep(dir, { env: {}, limit: 1, decisions: model });
  assert.equal(first.complete, false);
  const second = await runCausalitySweep(dir, { env: {}, limit: 1, decisions: model });
  assert.equal(second.evaluatedTotal, 2);
  let result = second;
  for (let attempt = 0; attempt < 20 && !result.complete; attempt++) result = await runCausalitySweep(dir, { env: {}, limit: 1, decisions: model });
  assert.equal(result.complete, true);
  const finished = await runCausalitySweep(dir, { env: {}, limit: 1, decisions: model });
  assert.equal(finished.nominated, 0);
  assert.equal(finished.evaluatedTotal, result.evaluatedTotal);
});

test("a sweep reports the whole pool left and stops once the top-ranked pairs keep holding no link", async context => {
  const parent = await mkdtemp(join(tmpdir(), "causality-settle-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const reject: DecisionModel = { modelId: "reject", decide: async (_state, questions) => questions.map(question => ({ key: question.key, value: question.key.startsWith("causal:") ? 0.1 : 0.9 })) };
  const first = await runCausalitySweep(dir, { env: {}, limit: 1, decisions: reject, stopAfterMisses: 2 });
  assert.equal(first.complete, false);
  assert.equal(first.missesInARow, 1);
  assert.ok(first.remaining >= 1, "the true count left, not a capped page");
  const second = await runCausalitySweep(dir, { env: {}, limit: 1, decisions: reject, stopAfterMisses: 2 });
  assert.equal(second.remaining, first.remaining - 1);
  assert.equal(second.complete, second.remaining === 0 || second.missesInARow >= 2);
  assert.equal(second.complete, true);
  if (second.remaining > 0) assert.match(second.note!, /held no causal link/);
});

test("causal checklist fails closed on missing, duplicate, and invalid veto scores", async context => {
  const parent = await mkdtemp(join(tmpdir(), "causality-veto-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const universe = await loadCausalityUniverse(dir);
  const candidates = (await listCausalityCandidates(dir, { env: {}, limit: 1 })).candidates;
  for (const veto of [undefined, Number.NaN, Number.POSITIVE_INFINITY, -1, 1.1]) {
    const decisions: DecisionModel = { modelId: "invalid-stub", decide: async () => [{ key: "causal:0", value: 0.99 }, ...(veto === undefined ? [] : [{ key: "succession:0", value: veto }])] };
    assert.equal((await checkCausalLinks(decisions, candidates, universe))[0].verdict, "uncertain");
  }
  const duplicate: DecisionModel = { modelId: "duplicate-stub", decide: async () => [{ key: "causal:0", value: 0.99 }, { key: "succession:0", value: 0.1 }, { key: "succession:0", value: 0.9 }] };
  assert.equal((await checkCausalLinks(duplicate, candidates, universe))[0].verdict, "uncertain");
});

test("bounded sweep sends only its nominated budget and does not claim a full sweep", async context => {
  const parent = await mkdtemp(join(tmpdir(), "causality-bounded-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  await writeFile(join(dir, "ontology", "causality.json"), JSON.stringify({ sweepPending: true }));
  let questionsSent = 0;
  const decisions: DecisionModel = { modelId: "bounded-stub", decide: async (state, questions) => { questionsSent += questions.length; return stubDecisions.decide(state, questions); } };
  const result = await runCausalitySweep(dir, { env: {}, limit: 1, decisions });
  assert.equal(result.nominated, 1);
  assert.equal(questionsSent, 2);
  assert.equal(JSON.parse(await readFile(join(dir, "ontology", "causality.json"), "utf8")).sweepPending, true);
  await assert.rejects(() => runCausalitySweep(dir, { env: {}, limit: 0, decisions }), /1.*500/);
  await assert.rejects(() => listCausalityCandidates(dir, { env: {}, chapterIndex: -1 }), /Chapter/);
  await assert.rejects(() => listCausalityCandidates(dir, { env: {}, limit: 501 }), /limit/);
});

test("causality candidates: graph-only listing without an embedder, unit filter works", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "causality-cmd-cand-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const all = await listCausalityCandidates(dir, { env: {} });
  assert.equal(all.embeddingLeg, false, "no embedder configured in test env");
  assert.ok(all.candidates.length > 0);
  assert.ok(all.candidates.some((c) => c.fromId === "ev_1" && c.toId === "ev_2"));
  const filtered = await listCausalityCandidates(dir, { env: {}, unitId: "card_2" });
  assert.ok(filtered.candidates.length > 0);
  assert.ok(filtered.candidates.every((c) => c.fromId === "card_2" || c.toId === "card_2"));
  await assert.rejects(() => listCausalityCandidates(dir, { env: {}, unitId: "nope" }), /Unknown unit/);
});

test("causality propose: validates and lands a pending_review changeset; refuses bad links", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "causality-cmd-propose-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  await assert.rejects(() => proposeCausalityLink(dir, "ev_1", "ev_1"), /cannot cause itself/);
  await assert.rejects(() => proposeCausalityLink(dir, "ev_2", "ev_1"), /contradicts/, "reversed novel-sequence order refused");
  await assert.rejects(() => proposeCausalityLink(dir, "ev_1", "ghost"), /Unknown to unit/);
  const ok = await proposeCausalityLink(dir, "ev_1", "card_2", { reason: "A's arrival prompts B's answer." });
  assert.equal(ok.fromId, "ev_1");
  assert.equal(ok.toId, "card_2");
  const changesets = await listChangeSets(dir);
  const created = changesets.find((c) => c.id === ok.changesetId);
  assert.ok(created);
  assert.equal(created!.status, "pending_review");
  assert.equal(created!.proposals[0].kind, "add_relation");
  assert.equal((created!.proposals[0].payload as Relation).type, "CAUSES");
  assert.equal(created!.proposals[0].provenance.patchId, "causality-agent");
  // A second proposal for the same pair is refused once the link is
  // canon: simulate canon by writing the relation, then propose again.
  const dir2 = await writeNovelDir(join(parent, "second"), [
    { fromId: "ev_1", toId: "ev_2", type: "CAUSES", properties: {}, confidence: 1 },
  ]);
  await assert.rejects(() => proposeCausalityLink(dir2, "ev_1", "ev_2"), /already exists/);
});

test("causality sweep: stub Jev proposes through the gate shape and clears the flag", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "causality-cmd-sweep-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  await writeFile(join(dir, "ontology", "causality.json"), JSON.stringify({ sweepPending: true }), "utf8");
  const result = await runCausalitySweep(dir, { env: {}, decisions: stubDecisions });
  assert.ok(result.changesetId, "confident links land in a changeset");
  assert.ok(result.proposed > 0);
  const memory = JSON.parse(await readFile(join(dir, "ontology", "causality.json"), "utf8"));
  assert.equal(memory.sweepPending, false);
  const changesets = await listChangeSets(dir);
  assert.ok(changesets.some((c) => c.id === result.changesetId && c.status === "pending_review"));
});

test("causality propose: gate round-trip — approve and apply lands the link in canon", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "causality-cmd-roundtrip-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const dir = await writeNovelDir(parent);
  const ok = await proposeCausalityLink(dir, "ev_1", "card_2", { reason: "round-trip test" });
  const approved = await setChangeSetStatus(dir, ok.changesetId, "approved");
  await applyChangeSet(new BundleStore(join(dir, "ontology")), approved);
  const relations = (await readFile(join(dir, "ontology", "relations.jsonl"), "utf8"))
    .trim().split("\n").map((line) => JSON.parse(line) as Relation);
  assert.ok(relations.some((r) => r.fromId === "ev_1" && r.toId === "card_2" && r.type === "CAUSES"),
    "agent-adjudicated link reaches canon through approve + apply");
});
