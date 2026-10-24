import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { nominateStructuralCandidates } from "../src/solidifier/matching/structuralMatch.js";
import { loadDistinctMemory, runEntityMatching } from "../src/solidifier/matching/emFaculty.js";
import type { ProcessingEvent } from "../src/ground/events/types.js";
import { FacultyGraph } from "../src/digger/processing/facultyGraph.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import type { WorkModel } from "../src/ground/connectors/llm.js";
import type { Entity, OntEvent, Relation, Scene } from "../src/ground/ontology/types.js";

const ent = (id: string, canonical: string, extraForms: string[] = []): Entity => ({
  id, kind: "Character", confidence: 0.9, properties: {},
  names: [{ text: canonical, lang: "und", kind: "canonical" }, ...extraForms.map((text) => ({ text, lang: "und", kind: "alias" as const }))],
});
const ev = (id: string, order: number, actors: string[], sentence: string): OntEvent => ({
  id, timelineId: "tl_canon", chapterIndex: 0, chronologicalOrder: order,
  eventType: "action", summaryEn: `${id} summary`, importance: 0.5,
  evidence: { text: "", sentenceIds: [sentence] },
  primaryActors: actors, affectedCharacters: [], confidence: 0.9,
});
const scene = (id: string, sentences: string[]): Scene => ({
  id, chapterIndex: 0, sentenceIds: sentences, charactersPresent: [], charactersMentioned: [], turns: [], locationId: null,
});

// Twin records (Anna / 安娜） that never share a scene cast or an event,
// but draw identical scenes and the same companion; a co-acting
// companion （美绪） who must be vetoed; an alias-linked record.
function fixture() {
  const entities = [
    ent("char_a", "Anna"),
    ent("char_b", "安娜"),
    ent("char_c", "Kenji"),
    ent("char_d", "美绪"),
    ent("char_e", "Anna", ["Anna S."]),
  ];
  const events = [
    ev("e1", 1, ["char_a"], "q1"), ev("e2", 2, ["char_b"], "q1"),
    ev("e3", 3, ["char_a"], "q3"), ev("e4", 4, ["char_b"], "q3"),
    ev("e5", 5, ["char_a", "char_c"], "q2"), ev("e6", 6, ["char_b", "char_c"], "q2"),
    ev("e7", 7, ["char_a", "char_d"], "q1"), ev("e8", 8, ["char_d"], "q3"),
    ev("e9", 9, ["char_d", "char_c"], "q2"), ev("e10", 10, ["char_b", "char_d"], "q4"),
  ];
  const scenes = [scene("sc1", ["q1", "q2"]), scene("sc2", ["q3", "q4"])];
  const relations: Relation[] = events.flatMap((e) =>
    e.primaryActors.map((a) => ({ fromId: a, toId: e.id, type: "PARTICIPATES_IN" as const, properties: {}, confidence: 1 })));
  return { entities, events, scenes, relations };
}

test("structural nomination: twins nominated, co-actor companions vetoed, aliases excluded", () => {
  const { entities, events, scenes, relations } = fixture();
  const pairs = nominateStructuralCandidates(entities, events, scenes, relations)
    .map((c) => [c.aId, c.bId].sort().join("|"));
  assert.ok(pairs.includes("char_a|char_b"), `twin pair nominated (got ${pairs.join(", ")})`);
  assert.ok(!pairs.includes("char_a|char_d"), "co-actor companion vetoed despite high scene overlap");
  assert.ok(!pairs.some((p) => p.includes("char_e")), "alias-linked record excluded");
});

test("structural nomination: remembered-distinct pairs skip until evidence grows materially", () => {
  const { entities, events, scenes, relations } = fixture();
  const same = nominateStructuralCandidates(entities, events, scenes, relations, {
    distinct: [{ a: "char_a", b: "char_b", sharedScenes: 2, sharedNeighbors: 1, ts: "t" }],
  });
  assert.ok(!same.some((c) => [c.aId, c.bId].sort().join("|") === "char_a|char_b"));
  const grown = nominateStructuralCandidates(entities, events, scenes, relations, {
    distinct: [{ a: "char_a", b: "char_b", sharedScenes: 0, sharedNeighbors: 0, ts: "t" }],
  });
  assert.ok(grown.some((c) => [c.aId, c.bId].sort().join("|") === "char_a|char_b"));
});

test("EM faculty: confident verdict merges through the audited path and rewires state changes", async () => {
  const { entities, events, scenes, relations } = fixture();
  const novelDir = await mkdtemp(join(tmpdir(), "novel-em-"));
  const onto = join(novelDir, "ontology");
  await mkdir(onto, { recursive: true });
  const write = (name: string, rows: unknown[]) =>
    writeFile(join(onto, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await write("entities.jsonl", entities);
  await write("events.jsonl", events);
  await write("scenes.jsonl", scenes);
  await write("relations.jsonl", relations);
  await write("state-changes.jsonl", [{
    id: "st1", characterId: "char_b", afterEventId: "e2",
    emotions: {}, knowledgeAdd: [], goalsAdd: [],
    relationships: { char_b: 0.5, char_c: 0.1 }, location: null,
    possessionsAdd: [], possessionsRemove: [],
  }]);
  const decisions: DecisionModel = {
    modelId: "mock-jev",
    async decide(_state, questions) {
      return questions.map((q) => ({
        key: q.key,
        value: q.key.startsWith("same:") ? 0.95 : q.key.startsWith("distinct:") ? 0.05 : 0.05,
        confidence: 0.95,
      }));
    },
  };
  const summary = await runEntityMatching({
    novelDir, decisions,
    data: { entities, events, scenes, relations },
  });
  assert.equal(summary.merged.length, 1);
  assert.equal(summary.merged[0].keepId, "char_a");
  assert.equal(summary.merged[0].dropId, "char_b");
  const after = (await readFile(join(onto, "entities.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Entity);
  assert.ok(!after.some((e) => e.id === "char_b"), "dropped record removed");
  const keep = [...after].reverse().find((e) => e.id === "char_a")!;
  assert.ok(keep.names.some((n) => n.text === "安娜"), "dropped forms folded onto the keeper");
  const states = (await readFile(join(onto, "state-changes.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(states[0].characterId, "char_a", "state owner rewired");
  assert.equal(states[0].relationships.char_a, 0.5, "self-relationship target rewired");
  const audit = await readFile(join(novelDir, "maintenance.jsonl"), "utf8");
  assert.ok(audit.includes('"op":"merge"'), "merge audited");
});

test("EM faculty: distinct verdicts are remembered and suppress re-nomination", async () => {
  const { entities, events, scenes, relations } = fixture();
  const novelDir = await mkdtemp(join(tmpdir(), "novel-em-distinct-"));
  const onto = join(novelDir, "ontology");
  await mkdir(onto, { recursive: true });
  const write = (name: string, rows: unknown[]) =>
    writeFile(join(onto, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await write("entities.jsonl", entities);
  await write("events.jsonl", events);
  await write("scenes.jsonl", scenes);
  await write("relations.jsonl", relations);
  const decisions: DecisionModel = {
    modelId: "mock-jev",
    async decide(_state, questions) {
      return questions.map((q) => ({
        key: q.key,
        value: q.key.startsWith("same:") ? 0.1 : q.key.startsWith("distinct:") ? 0.9 : 0.05,
        confidence: 0.9,
      }));
    },
  };
  const first = await runEntityMatching({ novelDir, decisions, data: { entities, events, scenes, relations } });
  assert.equal(first.distinct.length, 1);
  const memory = await loadDistinctMemory(novelDir);
  assert.equal(memory.length, 1);
  const second = await runEntityMatching({ novelDir, decisions, data: { entities, events, scenes, relations } });
  assert.equal(second.nominated, 0, "remembered pair is not re-reviewed");
});

test("EM faculty: a confident merge emits entity.merged and a distinct verdict emits entity.distinct", async () => {
  const { entities, events, scenes, relations } = fixture();
  const novelDir = await mkdtemp(join(tmpdir(), "novel-em-events-"));
  const onto = join(novelDir, "ontology");
  await mkdir(onto, { recursive: true });
  const write = (name: string, rows: unknown[]) =>
    writeFile(join(onto, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await write("entities.jsonl", entities);
  await write("events.jsonl", events);
  await write("scenes.jsonl", scenes);
  await write("relations.jsonl", relations);
  const emitted: ProcessingEvent[] = [];
  const sink = async (e: ProcessingEvent) => { emitted.push(e); };
  const confident: DecisionModel = {
    modelId: "mock-jev",
    async decide(_state, questions) {
      return questions.map((q) => ({
        key: q.key,
        value: q.key.startsWith("same:") ? 0.95 : 0.05,
        confidence: 0.95,
      }));
    },
  };
  await runEntityMatching({ novelDir, decisions: confident, data: { entities, events, scenes, relations }, events: sink });
  assert.deepEqual(emitted, [{ type: "entity.merged", keepId: "char_a", dropId: "char_b" }]);

  const novelDir2 = await mkdtemp(join(tmpdir(), "novel-em-events2-"));
  const onto2 = join(novelDir2, "ontology");
  await mkdir(onto2, { recursive: true });
  const write2 = (name: string, rows: unknown[]) =>
    writeFile(join(onto2, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await write2("entities.jsonl", entities);
  await write2("events.jsonl", events);
  await write2("scenes.jsonl", scenes);
  await write2("relations.jsonl", relations);
  emitted.length = 0;
  const distinctModel: DecisionModel = {
    modelId: "mock-jev",
    async decide(_state, questions) {
      return questions.map((q) => ({
        key: q.key,
        value: q.key.startsWith("same:") ? 0.1 : q.key.startsWith("distinct:") ? 0.9 : 0.05,
        confidence: 0.9,
      }));
    },
  };
  await runEntityMatching({ novelDir: novelDir2, decisions: distinctModel, data: { entities, events, scenes, relations }, events: sink });
  assert.deepEqual(emitted, [{ type: "entity.distinct", aId: "char_a", bId: "char_b" }]);
});

test("EM faculty: chained confident verdicts in one pass resolve through earlier merges", async () => {
  // Three records of one person (Anna / 安娜 / アンナ), each pair
  // structurally identical; Jev calls all three pairs confident.
  // The second and third merges name records the first merge may
  // already have dropped — the pass must resolve, not crash.
  const twins = ["t_a", "t_b", "t_c"];
  const entities = [
    ent("t_a", "Anna"), ent("t_b", "安娜"), ent("t_c", "アンナ"), ent("t_d", "Kenji"),
  ];
  const events: OntEvent[] = [];
  let order = 0;
  for (const x of twins) {
    events.push(ev(`ev_${x}_1`, ++order, [x], "q1"));
    events.push(ev(`ev_${x}_3`, ++order, [x], "q3"));
    events.push(ev(`ev_${x}_d`, ++order, [x, "t_d"], "q2"));
  }
  const scenes = [scene("sc1", ["q1", "q2"]), scene("sc2", ["q3"])];
  const relations: Relation[] = events.flatMap((e) =>
    e.primaryActors.map((a) => ({ fromId: a, toId: e.id, type: "PARTICIPATES_IN" as const, properties: {}, confidence: 1 })));
  const novelDir = await mkdtemp(join(tmpdir(), "novel-em-chain-"));
  const onto = join(novelDir, "ontology");
  await mkdir(onto, { recursive: true });
  const write = (name: string, rows: unknown[]) =>
    writeFile(join(onto, name), rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
  await write("entities.jsonl", entities);
  await write("events.jsonl", events);
  await write("scenes.jsonl", scenes);
  await write("relations.jsonl", relations);
  const emitted: ProcessingEvent[] = [];
  const decisions: DecisionModel = {
    modelId: "mock-jev",
    async decide(_state, questions) {
      return questions.map((q) => ({
        key: q.key,
        value: q.key.startsWith("same:") ? 0.95 : 0.05,
        confidence: 0.95,
      }));
    },
  };
  const summary = await runEntityMatching({
    novelDir, decisions,
    data: { entities, events, scenes, relations },
    events: async (e) => { emitted.push(e); },
  });
  assert.equal(summary.merged.length, 2, "three records collapse via two merges");
  assert.equal(emitted.filter((e) => e.type === "entity.merged").length, 2);
  const after = (await readFile(join(onto, "entities.jsonl"), "utf8")).trim().split("\n").map((l) => JSON.parse(l) as Entity);
  const ids = new Set(after.map((e) => e.id));
  assert.deepEqual([...ids].sort(), ["t_a", "t_d"]);
  const keep = [...after].reverse().find((e) => e.id === "t_a")!;
  for (const form of ["Anna", "安娜", "アンナ"]) {
    assert.ok(keep.names.some((n) => n.text === form), `form ${form} folded onto the survivor`);
  }
});

// --- alias-at-birth through the faculty graph ---

const sakura: Entity = { id: "char_000001", kind: "Character", names: [{ text: "小樱", lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 };

function birthRun(birthConfidence: number) {
  const sentences = sectionBlock("小樱站在门口。\n蜂蜜色少女笑着挥手。\n小樱说：“你好。”", 0).sentences;
  const decisions: DecisionModel = {
    modelId: "jev",
    async decide(_state, questions) {
      return questions.map((q) => {
        if (q.key.startsWith("birth:")) return { key: q.key, value: "小樱", confidence: birthConfidence };
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
          newEntities: [{ name: "蜂蜜色少女", kind: "Character", descriptive: true, aliases: [] }],
          charactersPresent: ["小樱", "蜂蜜色少女"], charactersMentioned: [], locationName: null,
        });
      }
      if (request.system.startsWith("FACULTY: dialogue-adjudication")) return JSON.stringify({ turns: [] });
      return JSON.stringify({ summary: "小樱与少女交谈。", events: [] });
    },
  };
  return new FacultyGraph(decisions, work).run({ blockId: "b0001", chapterIndex: 0, sentences, knownEntities: [sakura] });
}

test("alias-at-birth: a descriptive candidate Jev confidently attaches is born as an alias", async () => {
  const result = await birthRun(0.99);
  const scene = await [...result.sceneResults.values()][0];
  const declarations = scene.scene.newEntities ?? [];
  assert.ok(!declarations.some((d) => d.name === "蜂蜜色少女"), "no standalone descriptive entity declared");
  const host = declarations.find((d) => d.name === "小樱");
  assert.ok(host?.aliases?.some((a) => a.text === "蜂蜜色少女"), "description folded as the character's alias");
  assert.deepEqual(scene.scene.charactersPresent, ["小樱"]);
  assert.ok(scene.notes.some((n) => n.includes("alias-at-birth")), "decision is visible in the scene notes");
});

test("alias-at-birth: an under-threshold attachment is refused and the figure is minted", async () => {
  const result = await birthRun(0.6);
  const scene = await [...result.sceneResults.values()][0];
  const declarations = scene.scene.newEntities ?? [];
  assert.ok(declarations.some((d) => d.name === "蜂蜜色少女"), "descriptive candidate survives as a new entity");
  assert.ok(scene.notes.some((n) => n.includes("kept as a new entity")));
});
