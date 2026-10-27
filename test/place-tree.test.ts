import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { mostSpecific, parentMap, placePath, treeViolation } from "../src/ground/ontology/placeTree.js";
import { statedContainment } from "../src/digger/timeplace/containment.js";
import { placeIdFor, runTimePlace, timePlaceProposals, type SceneSource } from "../src/digger/timeplace/faculty.js";
import { sweepPlaceTree } from "../src/digger/timeplace/placeTreeSweep.js";
import { timePlaceReviewSource } from "../src/digger/timeplace/afterApply.js";
import type { PlaceMention } from "../src/digger/timeplace/vocabulary.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { loadChangeSet, saveChangeSet } from "../src/solidifier/merge/changesetStore.js";
import { approveBook } from "../src/solidifier/merge/approve.js";
import { digest, semanticFacts, semanticRevision } from "../src/solidifier/merge/semantic.js";
import { decideFacts, semanticContext } from "../src/solidifier/merge/semanticCommands.js";
import { review } from "../src/solidifier/merge/review.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import type { WorkModel } from "../src/ground/connectors/llm.js";
import type { Entity, Relation, Scene } from "../src/ground/ontology/types.js";

const part = (fromId: string, toId: string): Relation => ({ fromId, toId, type: "PART_OF", properties: {}, confidence: 1 });
const place = (id: string, name: string, properties: Record<string, unknown> = {}): Entity => ({ id, kind: "Location", names: [{ text: name, lang: "zh", kind: "canonical" }], properties, confidence: 1 });
const mention = (text: string, sentence: string, specific = true, within?: string): PlaceMention => {
  const start = sentence.indexOf(text);
  return { text, sentenceId: "s1", start, end: start + text.length, role: "setting", specific, inQuote: false, source: "llm", ...(within ? { within } : {}) };
};

test("places form a strict tree: one parent each, no loops; paths run root first", () => {
  const stored = [part("ward", "city"), part("hospital", "ward")];
  assert.equal(treeViolation(stored, [part("station", "ward")]), null);
  assert.equal(treeViolation(stored, [part("hospital", "ward")]), null, "restating the same parent is fine");
  assert.match(treeViolation(stored, [part("hospital", "city")])!, /exactly one parent/);
  assert.match(treeViolation(stored, [part("city", "hospital")])!, /loop/);
  assert.match(treeViolation([], [part("a", "a")])!, /inside itself/);
  const parents = parentMap(stored);
  assert.deepEqual(placePath("hospital", parents), ["city", "ward", "hospital"]);
  assert.deepEqual(mostSpecific(["city", "hospital", "ward", "park"], parents).sort(), ["hospital", "park"]);
});

test("containment is read only where one sentence states it, under a named parent", () => {
  const sentence = "他走到东京都新宿区的车站前，又去了涩谷区。";
  const found = statedContainment([mention("东京都", sentence), mention("新宿区", sentence), mention("车站前", sentence, false), mention("涩谷区", sentence)], () => sentence);
  const pairs = found.map((entry) => `${entry.child.text}⊂${entry.parent.text}`);
  assert.deepEqual(pairs.sort(), ["新宿区⊂东京都", "车站前⊂新宿区"], "adjacent and 的-joined only; a later place after a comma is not inside");
  const generic = "屋顶的仓库。";
  assert.deepEqual(statedContainment([mention("屋顶", generic, false), mention("仓库", generic, false)], () => generic), [], "a generic place never contains anything");
  const claimed = "医院在东区，离车站不远。";
  const llm = statedContainment([mention("医院", claimed, true, "东区"), mention("东区", claimed)], () => claimed);
  assert.deepEqual(llm.map((entry) => [entry.child.text, entry.parent.text, entry.via]), [["医院", "东区", "llm"]]);
  assert.deepEqual(statedContainment([mention("医院", claimed, true, "星城")], () => claimed), [], "a claimed parent must be a place in that sentence");
});

test("extraction proposes stated parents, scopes generic places under them, and links each scene to its most specific place", async () => {
  const sentences = sectionBlock("小明走到东京都新宿区的车站前。\n他等了很久。", 0).sentences;
  const scenes: SceneSource[] = [{ id: "scene_1", chapterIndex: 0, sentences, charactersPresent: [], locationId: null }];
  const known = [place("loc_tokyo", "东京都")];
  const work: WorkModel = { modelId: "mock-work", async generate() {
    return JSON.stringify({ times: [], places: [
      { text: "东京都", sentenceId: sentences[0].id, role: "setting", specific: true },
      { text: "新宿区", sentenceId: sentences[0].id, role: "setting", specific: true, within: "东京都" },
      { text: "车站前", sentenceId: sentences[0].id, role: "setting", specific: false },
    ] });
  } };
  const result = await runTimePlace({ scenes, knownEntities: known, mode: "hybrid", work });
  const proposals = timePlaceProposals(result, { entityIds: new Set(["loc_tokyo"]), relationKeys: new Set() });
  const relations = proposals.filter((proposal) => proposal.kind === "add_relation").map((proposal) => proposal.payload as Relation);
  const entities = proposals.filter((proposal) => proposal.kind === "upsert_entity").map((proposal) => proposal.payload as Entity);
  const ward = placeIdFor("text:新宿区");
  const station = entities.find((entity) => entity.names[0].text === "车站前")!;
  assert.ok(station, "a generic place with a named parent is kept");
  assert.deepEqual(station.properties, { source: "time-place", firstSceneId: "scene_1", generic: true, scopedTo: ward });
  assert.deepEqual(relations.filter((relation) => relation.type === "PART_OF").map((relation) => `${relation.fromId}>${relation.toId}`).sort(), [`${station.id}>${ward}`, `${ward}>loc_tokyo`].sort());
  assert.deepEqual(relations.filter((relation) => relation.type === "LOCATED_AT").map((relation) => relation.toId), [station.id], "only the most specific place; its ancestors are implied");
  assert.ok(proposals.every((proposal) => proposal.provenance.sentenceIds.length), "every fact cites a sentence");
  // The stored tree wins: a place that already has a parent is never given a second one.
  const stored = timePlaceProposals(result, { entityIds: new Set(["loc_tokyo", ward]), relationKeys: new Set(), parents: new Map([[ward, "loc_elsewhere"]]) });
  assert.ok(!stored.some((proposal) => proposal.kind === "add_relation" && (proposal.payload as Relation).type === "PART_OF" && (proposal.payload as Relation).fromId === ward));
});

test("the sweep nominates pairs, keeps the deepest judged parent, and remembers 'neither'", async () => {
  const text = "他从星城回到东区。\n东区医院的灯还亮着。\n星城的医院很多。\n东区和西区隔着一条河。";
  const sentences = new Map(sectionBlock(text, 0).sentences.map((sentence) => [sentence.id, sentence]));
  const entities = [place("city", "星城"), place("d7", "东区"), place("hospital", "东区医院"), place("d10", "西区")];
  const asked: string[] = [];
  const decisions: DecisionModel = { modelId: "mock-jev", async decide(_state, questions) {
    asked.push(...questions.map((question) => question.key));
    return questions.map((question) => {
      const [, a, b] = question.key.split(":");
      const inside = (child: string, parent: string) => a === child && b === parent ? 0 : a === parent && b === child ? 1 : -1;
      const pick = [inside("d7", "city"), inside("hospital", "d7"), inside("hospital", "city")].find((index) => index >= 0);
      const value = pick === undefined ? "neither" : question.options![pick];
      return { key: question.key, value, confidence: 0.9, distribution: { [value]: 0.9 } };
    });
  } };
  const result = await sweepPlaceTree({ entities, relations: [], scenes: [], sentences, decisions });
  const links = result.proposals.map((proposal) => `${(proposal.payload as Relation).fromId}>${(proposal.payload as Relation).toId}`).sort();
  assert.deepEqual(links, ["d7>city", "hospital>d7"], "the hospital keeps its deepest judged parent, not the city");
  assert.ok(result.memory.distinct.some((entry) => entry.pair === "d10|d7"), "a confident 'neither' is remembered");
  assert.ok(result.proposals.every((proposal) => proposal.provenance.sentenceIds.length));
  const again = await sweepPlaceTree({ entities, relations: [part("d7", "city"), part("hospital", "d7")], scenes: [], sentences, decisions, memory: result.memory });
  assert.equal(again.proposals.length, 0, "settled and remembered pairs are not asked again");
  const offline = await sweepPlaceTree({ entities, relations: [], scenes: [], sentences });
  assert.deepEqual(offline.proposals.map((proposal) => (proposal.payload as Relation).fromId), ["hospital"], "without Jev only name-prefix pairs are proposed");
});

test("the shared gate refuses an accepted second parent", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "place-tree-gate-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const text = "东区医院在星城。\n东区医院的灯还亮着。";
  await writeFile(join(directory, "source", "novel.txt"), text);
  const sentences = new Map(sectionBlock(text, 0).sentences.map((sentence) => [sentence.id, sentence]));
  await writeFile(join(directory, "ontology", "entities.jsonl"), [place("city", "星城"), place("d7", "东区"), place("hospital", "东区医院")].map((entity) => JSON.stringify(entity)).join("\n") + "\n");
  await writeFile(join(directory, "ontology", "relations.jsonl"), JSON.stringify(part("hospital", "d7")) + "\n");
  await writeFile(join(directory, "ontology", "scenes.jsonl"), JSON.stringify({ id: "scene_1", chapterIndex: 0, sentenceIds: [...sentences.keys()], charactersPresent: [], charactersMentioned: [], locationId: null } as unknown as Scene) + "\n");
  const proposals = [{ id: "pt_rel_hospital_city", kind: "add_relation" as const, payload: { ...part("hospital", "city"), properties: { via: "sweep" } }, confidence: 0.9, provenance: { blockId: "place-tree", sentenceIds: [[...sentences.keys()][0]], patchId: "place-tree" } }];
  const id = "cs_timeplace_place-tree_1";
  await saveChangeSet(directory, { id, blockId: "place-tree", proposals, status: "pending_review", reviewSource: timePlaceReviewSource(proposals, sentences), reviewNotes: {}, createdAt: new Date().toISOString() });
  const target = { directory, packetId: id, scope: "book" as const };
  const env = { NOVEL_SECRETS_DIR: join(tmpdir(), "no-place-tree-keys") };
  const page = await review("show", target, {}, env) as { revision: string; facts: { id: string }[] };
  let offset: number | null = 0;
  do { offset = ((await review("evidence", target, { factId: page.facts[0].id, offset, limit: 5 }, env)) as { page: { nextOffset: number | null } }).page.nextOffset; } while (offset !== null);
  await assert.rejects(review("decide", target, { revision: page.revision, decisions: [{ factId: page.facts[0].id, verdict: "accept", reason: "原文说医院在星城。" }] }, env), /exactly one parent/);
});

test("apply refuses a second parent decided before the first applied (inter-packet race)", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "place-tree-race-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const text = "东区医院在星城。\n东区医院的灯还亮着。";
  await writeFile(join(directory, "source", "novel.txt"), text);
  const sentences = new Map(sectionBlock(text, 0).sentences.map((sentence) => [sentence.id, sentence]));
  await writeFile(join(directory, "ontology", "entities.jsonl"), [place("city", "星城"), place("d7", "东区"), place("d8", "西区"), place("hospital", "东区医院")].map((entity) => JSON.stringify(entity)).join("\n") + "\n");
  await writeFile(join(directory, "ontology", "scenes.jsonl"), JSON.stringify({ id: "scene_1", chapterIndex: 0, sentenceIds: [...sentences.keys()], charactersPresent: [], charactersMentioned: [], locationId: null } as unknown as Scene) + "\n");
  const makePacket = async (id: string, toId: string) => {
    const proposals = [{ id: `pt_rel_hospital_${toId}`, kind: "add_relation" as const, payload: { ...part("hospital", toId), properties: { via: "sweep" } }, confidence: 0.9, provenance: { blockId: "place-tree", sentenceIds: [[...sentences.keys()][0]], patchId: "place-tree" } }];
    await saveChangeSet(directory, { id, blockId: "place-tree", proposals, status: "pending_review", reviewSource: timePlaceReviewSource(proposals, sentences), reviewNotes: {}, createdAt: new Date().toISOString() });
    // Stage an accepted decision the way the gate's apply path does, before
    // either packet is applied: both decide against the same stored tree.
    const packet = await loadChangeSet(directory, id);
    const revision = semanticRevision(packet, digest(await semanticContext(directory)));
    const fact = semanticFacts(packet).find((entry) => entry.field === "relation")!;
    await decideFacts(directory, id, revision, [{ factId: fact.id, verdict: "accept", reason: "原文说医院在该区。" }]);
  };
  await makePacket("cs_timeplace_place-tree_a", "d7");
  await makePacket("cs_timeplace_place-tree_b", "d8");
  await approveBook(directory, "cs_timeplace_place-tree_a");
  await assert.rejects(approveBook(directory, "cs_timeplace_place-tree_b"), /exactly one parent/);
  assert.equal((await loadChangeSet(directory, "cs_timeplace_place-tree_b")).status, "pending_review", "a refused packet stays pending, never approved-but-unapplied");
  const stored = (await readFile(join(directory, "ontology", "relations.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Relation);
  assert.deepEqual(stored.map((relation) => [relation.fromId, relation.toId]), [["hospital", "d7"]], "only the first parent lands");
});
