import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { containmentTargets } from "../src/matching/fragmentMatch.js";
import {
  loadMatchMemory,
  loadDistinctMemory,
  saveMatchMemory,
  saveDistinctMemory,
} from "../src/matching/emFaculty.js";
import { nameDetector } from "../src/autostep/patches/name-detector.js";
import type { PatchContext } from "../src/autostep/patches/types.js";
import { FacultyGraph } from "../src/processing/facultyGraph.js";
import { sectionBlock } from "../src/text/sectioning.js";
import type { DecisionModel } from "../src/connectors/jev.js";
import type { WorkModel } from "../src/connectors/llm.js";
import type { Entity } from "../src/ontology/types.js";

const shokuhou: Entity = {
  id: "char_000100", kind: "Character", properties: {}, confidence: 1,
  names: [
    { text: "食蜂操祈", lang: "zh", kind: "canonical" },
    { text: "食蜂", lang: "zh", kind: "alias" },
  ],
};
const misaka: Entity = {
  id: "char_000101", kind: "Character", properties: {}, confidence: 1,
  names: [{ text: "御坂美琴", lang: "zh", kind: "canonical" }],
};
const target = (e: Entity) => ({ id: e.id, name: e.names[0].text, forms: e.names.map((n) => n.text) });

test("containment: substring in both directions, exact forms and 1-char excluded", () => {
  // Candidate is a strict substring of a target form.
  assert.deepEqual(containmentTargets("美琴", [target(misaka)]).map((t) => t.id), ["char_000101"]);
  // Candidate contains the target's canonical.
  assert.deepEqual(
    containmentTargets("食蜂操祈同学", [{ id: "x", name: "食蜂操祈", forms: ["食蜂操祈"] }]).length, 1);
  // Exact folded equality with ANY form is the ordinary fold, not a fragment.
  assert.equal(containmentTargets("食蜂", [target(shokuhou)]).length, 0);
  // One-character candidates are too weak to ask about.
  assert.equal(containmentTargets("猫", [{ id: "y", name: "猫屋敷", forms: ["猫屋敷"] }]).length, 0);
  // No containment, no match.
  assert.equal(containmentTargets("李雷", [target(misaka)]).length, 0);
});

test("matching.json: distinct verdicts and fragment declines coexist", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-matchmem-"));
  await saveMatchMemory(dir, {
    distinct: [],
    fragmentDeclines: [{ form: "食蜂", entityId: "char_000100", ts: "t0" }],
  });
  // Writing distinct verdicts (the EM path) must not wipe declines.
  await saveDistinctMemory(dir, [{ a: "a", b: "b", sharedScenes: 2, sharedNeighbors: 1, ts: "t1" }]);
  const memory = await loadMatchMemory(dir);
  assert.equal(memory.distinct.length, 1);
  assert.equal(memory.fragmentDeclines.length, 1);
  assert.equal((await loadDistinctMemory(dir)).length, 1);
});

// --- fragment-at-birth through the faculty graph ---

function fragmentRun(opts: {
  answer: string;
  confidence: number;
  declines?: { form: string; entityId: string }[];
  askedKeys?: string[];
}) {
  const sentences = sectionBlock("食蜂操祈走进教室。\n操祈笑着看向窗外。\n众人安静下来。", 0).sentences;
  const registry: Entity = {
    id: "char_000100", kind: "Character", properties: {}, confidence: 1,
    names: [{ text: "食蜂操祈", lang: "zh", kind: "canonical" }],
  };
  const decisions: DecisionModel = {
    modelId: "jev",
    async decide(_state, questions) {
      return questions.map((q) => {
        opts.askedKeys?.push(q.key);
        if (q.key.startsWith("fragment:")) return { key: q.key, value: opts.answer, confidence: opts.confidence };
        if (q.key.startsWith("scene_end:")) return { key: q.key, value: sentences.at(-1)!.id, confidence: 0.99 };
        return { key: q.key, value: "NONE", confidence: 0.99 };
      });
    },
  };
  const work: WorkModel = {
    modelId: "work",
    async generate(request) {
      if (request.system.startsWith("FACULTY: entities-participants")) {
        return JSON.stringify({
          newEntities: [{ name: "操祈", kind: "Character", aliases: [] }],
          charactersPresent: ["食蜂操祈", "操祈"], charactersMentioned: [], locationName: null,
        });
      }
      if (request.system.startsWith("FACULTY: dialogue-adjudication")) return JSON.stringify({ turns: [] });
      return JSON.stringify({ summary: "食蜂操祈走进教室。", events: [] });
    },
  };
  return {
    registry,
    run: new FacultyGraph(decisions, work).run({
      blockId: "b0001", chapterIndex: 0, sentences,
      knownEntities: [registry], fragmentDeclines: opts.declines ?? [],
    }),
  };
}

test("fragment-at-birth: a confidently attached fragment folds as a form", async () => {
  const { run } = fragmentRun({ answer: "食蜂操祈", confidence: 0.95 });
  const result = await run;
  const scene = await [...result.sceneResults.values()][0];
  const declarations = scene.scene.newEntities ?? [];
  assert.ok(!declarations.some((d) => d.name === "操祈"), "fragment not minted");
  assert.ok(declarations.find((d) => d.name === "食蜂操祈")?.aliases?.some((a) => a.text === "操祈"));
  assert.deepEqual(scene.scene.charactersPresent, ["食蜂操祈"]);
  assert.ok(scene.notes.some((n) => n.includes("fragment-at-birth")));
  assert.equal(result.fragmentDeclines.length, 0);
});

test("fragment-at-birth: a declined fragment is minted and the decline is returned for memory", async () => {
  const { run } = fragmentRun({ answer: "NEW_PERSON", confidence: 0.9 });
  const result = await run;
  const scene = await [...result.sceneResults.values()][0];
  assert.ok((scene.scene.newEntities ?? []).some((d) => d.name === "操祈"), "fragment minted as its own entity");
  assert.deepEqual(result.fragmentDeclines, [{ form: "操祈", entityId: "char_000100" }]);
});

test("fragment-at-birth: a remembered decline suppresses the question entirely", async () => {
  const askedKeys: string[] = [];
  const { run } = fragmentRun({
    answer: "食蜂操祈", confidence: 0.99, askedKeys,
    declines: [{ form: "操祈", entityId: "char_000100" }],
  });
  const result = await run;
  const scene = await [...result.sceneResults.values()][0];
  assert.ok(!askedKeys.some((k) => k.startsWith("fragment:")), "no fragment question asked");
  assert.ok((scene.scene.newEntities ?? []).some((d) => d.name === "操祈"), "fragment minted without re-asking");
});

// --- miniloop name patch: containment evidence injection ---

test("name patch injects containment evidence into its existing questions", () => {
  const ctx = {
    blockId: "b0001",
    accepted: { nameCandidates: ["操祈", "韩梅梅"] },
    knownEntities: [{
      id: "char_000100", kind: "Character", properties: {}, confidence: 1,
      names: [{ text: "食蜂操祈", lang: "zh", kind: "canonical" }],
    }],
  } as unknown as PatchContext;
  const qs = nameDetector.buildQuestions(ctx);
  const nick = qs.find((q) => q.key === "nick:操祈")!;
  assert.ok(nick.instructions.includes("containment match"), "nickname question carries the evidence");
  assert.ok(nick.instructions.includes("clone"), "and the distinct-person warning");
  const plain = qs.find((q) => q.key === "nick:韩梅梅")!;
  assert.ok(!plain.instructions.includes("containment match"), "unrelated candidates are untouched");
});
