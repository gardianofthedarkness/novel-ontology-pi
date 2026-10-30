import { test } from "node:test";
import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BlockProcessor } from "../src/digger/processing/blockProcessor.js";
import { MockDecisionModel } from "../src/ground/connectors/jev.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import { BundleStore } from "../src/ground/connectors/bundle.js";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { addCorrection } from "../src/solidifier/maintenance/corrections.js";
import { loadChangeSet } from "../src/solidifier/merge/changesetStore.js";
import type { WorkingDraft } from "../src/digger/processing/draft.js";

test("block context buffer includes the following block without proposing or processing its source at a held gate", async context => {
  const parent = await mkdtemp(join(tmpdir(), "novel-context-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  let retried = false;
  const decisions: DecisionModel = { modelId: "mock", async decide(state, questions) {
    return questions.map(question => {
      const end = question.key.startsWith("scene_end:");
      const expanded = String(state).includes("READ-ONLY NEIGHBOR CONTEXT");
      if (end && expanded) {
        retried = true;
        assert.ok(String(state).includes("b0008_s0000: 次章的来源"));
        assert.ok(question.options?.every(option => option.startsWith("b0007_")));
      }
      return { key: question.key, value: end ? question.options!.at(-1)! : "NONE", confidence: end && !expanded ? 0.4 : 0.99 };
    });
  } };
  const processor = new BlockProcessor(new BundleStore(join(directory, "ontology")), decisions, async () => "held", {
    novelDir: directory,
    facultyGraph: { decisionRouting: { enabled: true } },
    workModel: { modelId: "mock", async generate(request) {
      assert.ok(!request.system.startsWith("Resolve one uncertain"));
      assert.ok(!request.prompt.includes("次章的来源"));
      return request.system.startsWith("FACULTY: entities-participants") ? JSON.stringify({ newEntities: [], charactersPresent: [], charactersMentioned: [], locationName: null }) : JSON.stringify({ events: [] });
    } },
  });
  await processor.processNovel([{ blockId: "b0008", sectionIndex: 7, text: "当前来源。" }, { blockId: "b0009", sectionIndex: 8, text: "次章的来源。" }]);
  assert.equal(retried, true);
  const changeset = await loadChangeSet(directory, "cs_b0008");
  assert.equal(changeset?.status, "held");
  assert.ok(changeset?.proposals.every(proposal => proposal.provenance.sentenceIds.every(id => id.startsWith("b0007_"))));
  assert.equal(await readFile(join(directory, "ontology", "events.jsonl"), "utf8"), "");
  await assert.rejects(loadChangeSet(directory, "cs_b0009"), { code: "ENOENT" });
});

test("working scene/dialogue drafts exist before extraction or the merge gate, without canonical writes", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "novel-working-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const draftFile = join(directory, "working", "b0001.json");
  const bundle = new BundleStore(join(directory, "ontology"));
  let extractions = 0;
  const processor = new BlockProcessor(bundle, new MockDecisionModel({ "boundary:b0000_s0001": 1, "dlg_turn:b0000_s0001": 1 }), async () => {
    const draft = JSON.parse(await readFile(draftFile, "utf8")) as WorkingDraft;
    assert.equal(draft.stage, "gate");
    assert.equal(await readFile(join(directory, "ontology", "events.jsonl"), "utf8"), "");
    return "held";
  }, {
    novelDir: directory,
    facultyGraph: false,
    workModel: {
      modelId: "mock-work",
      async generate() {
        const draft = JSON.parse(await readFile(draftFile, "utf8")) as WorkingDraft;
        assert.equal(draft.stage, "extraction");
        assert.equal(draft.sceneSpans.length, 2);
        assert.equal(draft.dialogueUnits.length, 2);
        await assert.rejects(access(join(directory, "changesets", "cs_b0001.json")));
        assert.equal(await readFile(join(directory, "ontology", "entities.jsonl"), "utf8"), "");
        if (extractions > 0) {
          assert.equal(draft.completedScenes, 1);
          assert.ok(draft.proposals.some((proposal) => proposal.kind === "create_event"));
        }
        extractions++;
        return JSON.stringify({ locationName: null, newEntities: [], events: [{ summaryEn: `Observed event ${extractions}`, actors: [], affected: [], evidence: [] }] });
      },
    },
  });
  const result = await processor.processNovel([{ blockId: "b0001", chapterIndex: 0, text: "甲走进来。乙笑起来。" }]);
  assert.equal(result.stoppedAt, "b0001");
  assert.equal(extractions, 2);
  assert.equal((await stat(draftFile)).mode & 0o777, 0o600);
  assert.equal((await stat(join(directory, "working"))).mode & 0o777, 0o700);
  assert.equal(await readFile(join(directory, "ontology", "events.jsonl"), "utf8"), "");
  await assert.rejects(access(join(directory, "ontology", "graph.lbug")));
});

test("block processing honors reviewer extraction constraints at a fresh held gate", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "novel-constraints-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  await addCorrection(directory, { blockId: "b0002", key: "extraction:constraints", value: { rejectCharacterNames: ["unknown"], instructions: "不推断身份，使用中文摘要。" }, reason: "未知身份不是命名角色" });
  let observed = false;
  const processor = new BlockProcessor(new BundleStore(join(directory, "ontology")), new MockDecisionModel({}), async () => "held", {
    novelDir: directory,
    facultyGraph: false,
    loadCorrections: async () => [{ id: "corr_0001", blockId: "b0002", key: "extraction:constraints", value: { rejectCharacterNames: ["unknown"], instructions: "不推断身份，使用中文摘要。" }, reason: "未知身份不是命名角色", createdAt: new Date().toISOString() }],
    workModel: {
      modelId: "mock-work",
      async generate(request) {
        observed = request.prompt.includes("不推断身份，使用中文摘要。");
        return JSON.stringify({ newEntities: [{ name: "unknown" }], events: [{ summaryEn: "门打开了。", actors: ["unknown"] }] });
      },
    },
  });
  await processor.processNovel([{ blockId: "b0002", chapterIndex: 1, sectionIndex: 1, text: "门打开了。" }]);
  const changeset = await loadChangeSet(directory, "cs_b0002");
  assert.equal(observed, true);
  assert.equal(changeset?.status, "held");
  assert.ok(changeset?.reviewNotes["recall:pin:extraction:constraints"]);
  assert.equal(changeset?.proposals.filter((proposal) => proposal.kind === "upsert_entity").length, 0);
  assert.ok(changeset?.proposals.every((proposal) => proposal.provenance.sentenceIds.every((id) => id.startsWith("b0001_"))));
  assert.equal(await readFile(join(directory, "ontology", "events.jsonl"), "utf8"), "");
});

test("default faculty ingestion keeps proposals and state previews unapproved until the block review gate", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "novel-faculty-gate-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const processor = new BlockProcessor(new BundleStore(join(directory, "ontology")), new MockDecisionModel(), async changeset => {
    assert.ok(changeset.reviewNotes["faculty:execution"]);
    assert.equal(await readFile(join(directory, "ontology", "events.jsonl"), "utf8"), "");
    const draft = JSON.parse(await readFile(join(directory, "working", "b0001.json"), "utf8")) as WorkingDraft;
    assert.equal(draft.stage, "gate");
    assert.deepEqual(draft.statePreview, []);
    return "held";
  }, { novelDir: directory, workModel: { modelId: "work", async generate(request) {
    if (request.system.startsWith("FACULTY: entities-participants")) return JSON.stringify({ newEntities: [], charactersPresent: [], charactersMentioned: [], locationName: null });
    if (request.system.startsWith("FACULTY: dialogue-adjudication")) return JSON.stringify({ turns: [] });
    return JSON.stringify({ summary: "门打开了。", events: [{ summaryEn: "门打开了。", evidence: ["b0000_s0000"] }] });
  } } });
  await processor.processNovel([{ blockId: "b0001", text: "门打开了。" }]);
  assert.equal((await loadChangeSet(directory, "cs_b0001"))!.status, "held");
  assert.equal(await readFile(join(directory, "ontology", "events.jsonl"), "utf8"), "");
});
