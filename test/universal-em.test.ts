import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { DecisionModel, DecisionQuestion } from "../src/ground/connectors/jev.js";
import type { Entity, Scene } from "../src/ground/ontology/types.js";
import { BundleStore } from "../src/ground/connectors/bundle.js";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { cutBlocks } from "../src/digger/intake/blocks.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import type { SceneFacultyResult } from "../src/digger/extraction/extraction.js";
import { resolveBlockIdentities } from "../src/digger/processing/blockIdentity.js";
import { formKeys, fullNames, isDescription, loadCast, personOf, saveCast, syncBook, type CastFile } from "../src/solidifier/identity/cast.js";
import { identityPool, personRef, recommend } from "../src/solidifier/identity/recommender.js";
import { resolveNewNames, type NewName } from "../src/solidifier/identity/em.js";
import { openIdentityPackets, runIdentityAfterApply } from "../src/solidifier/identity/afterApply.js";
import { reviewAdapter } from "../src/solidifier/merge/reviewAdapters.js";
import { review as reviewCommand } from "../src/solidifier/merge/review.js";
import { newChangeSet } from "../src/solidifier/merge/changeset.js";

// Invented names: 林晓月 (full name), 晓月 (her short form), 双辫少女 (a description of her), 陈默 (someone else).
const character = (id: string, ...names: string[]): Entity => ({ id, kind: "Character", names: names.map((text, index) => ({ text, lang: "zh", kind: index ? "alias" : "canonical" })), properties: {}, confidence: 0.9 });
const emptyCast = (universeId = "book"): CastFile => ({ version: 1, universeId, nextId: 1, persons: [], merges: [], distinct: [] });
/** Choices answered from a table (label, confidence); probabilities from another; calls counted. */
function fake(choices: Record<string, [string, number]>, probabilities: Record<string, number> = {}) {
  const model = { modelId: "fake", calls: 0, questions: [] as DecisionQuestion[], async decide(_state: string, questions: DecisionQuestion[]) {
    model.calls++; model.questions.push(...questions);
    return questions.map((question) => question.primitive === "choice" ? { key: question.key, value: choices[question.key]?.[0] ?? "NEW_PERSON", confidence: choices[question.key]?.[1] ?? 0.99 } : { key: question.key, value: probabilities[question.key] ?? 0 });
  } };
  return model satisfies DecisionModel;
}

test("full proper names: short forms, descriptions and titles are not; a bracketed name is both of its parts", () => {
  assert.deepEqual(fullNames([{ text: "林晓月", kind: "canonical" }, { text: "晓月", kind: "alias" }, { text: "双辫少女", kind: "alias" }, { text: "会长", kind: "title" }]), ["林晓月"]);
  assert.deepEqual(fullNames([{ text: "夜莺（Nightingale）", kind: "canonical" }, { text: "夜莺", kind: "alias" }]), ["夜莺（Nightingale）", "夜莺", "Nightingale"]);
  assert.deepEqual(formKeys("夜莺（Nightingale）"), ["夜莺（Nightingale）", "夜莺", "Nightingale"]);
  assert.ok(isDescription("双辫少女") && isDescription("戴眼镜的大叔") && !isDescription("林晓月") && !isDescription("陈默"));
});

test("one shared list: a full name met in a second book is the same person; short forms and descriptions are not", () => {
  const cast = emptyCast("u1");
  syncBook(cast, "b1", [character("char_000001", "林晓月", "晓月", "双辫少女"), character("char_000002", "陈默")]);
  const first = personOf(cast, "b1", "char_000001")!;
  const second = syncBook(cast, "b2", [character("char_000001", "林晓月"), character("char_000002", "双辫少女"), character("char_000003", "晓月")]);
  assert.deepEqual(second.joined, [{ entityId: "char_000001", personId: first.id, method: "full-name" }]);
  assert.equal(personOf(cast, "b2", "char_000001")!.id, first.id);
  assert.notEqual(personOf(cast, "b2", "char_000002")!.id, first.id, "a description never joins by itself");
  assert.notEqual(personOf(cast, "b2", "char_000003")!.id, first.id, "a short form never joins by itself");
  // A record extraction bound to a person joins it; a record gone from its book leaves the list.
  syncBook(cast, "b3", [{ ...character("char_000001", "小月"), properties: { person: first.id } }]);
  assert.equal(personOf(cast, "b3", "char_000001")!.id, first.id);
  syncBook(cast, "b2", [character("char_000001", "林晓月")]);
  assert.equal(personOf(cast, "b2", "char_000002"), undefined);
});

test("the universal recommender offers this book, the universe's other people and the block's new names", () => {
  const cast = emptyCast("u1");
  syncBook(cast, "b1", [character("char_000001", "林晓月", "晓月"), character("char_000002", "陈默")]);
  const pool = identityPool({ book: [character("char_000009", "周雨")], cast, sourceId: "b2", books: [{ sourceId: "b1", workspace: "/b1", title: "Book one", readingOrder: 1 }], fresh: [{ key: "n1", name: "双辫少女", aliases: [] }] });
  assert.deepEqual(pool.map((entry) => entry.kind), ["book", "universe", "universe", "new"]);
  const ranked = recommend([{ id: "s1", chapterIndex: 0, index: 0, text: "林晓月和周雨走进教室，双辫少女跟在后面。", present: [], mentioned: [] }], pool).get("s1")!;
  const score = (ref: string) => ranked.find((candidate) => candidate.id === ref)?.score;
  assert.equal(score(personRef(personOf(cast, "b1", "char_000001")!.id)), 1, "named in the scene");
  assert.equal(score("char_000009"), 1);
  assert.ok((score(personRef(personOf(cast, "b1", "char_000002")!.id)) ?? 0) > 0, "the universe's people keep a small prior");
  assert.equal(score("new:n1"), 1);
});

test("universal EM: a full name binds by code; others go to Jev, binding only when confident and raising the uncertain for review", async () => {
  const cast = emptyCast("u1");
  syncBook(cast, "b1", [character("char_000001", "林晓月", "晓月", "双辫少女")]);
  const person = personOf(cast, "b1", "char_000001")!;
  const passage = "林晓月推开门。晓月说：“走吧。”双辫少女点了点头。王五在门外等着。";
  const names: NewName[] = [
    { key: "n1", name: "林晓月", aliases: [], descriptive: false, sceneId: "s1", passage },
    { key: "n2", name: "晓月", aliases: [], descriptive: false, sceneId: "s1", passage },
    { key: "n3", name: "双辫少女", aliases: [], descriptive: true, sceneId: "s1", passage },
    { key: "n4", name: "王五", aliases: [], descriptive: false, sceneId: "s1", passage },
  ];
  const pool = identityPool({ book: [], cast, sourceId: "b2", fresh: names.map(({ key, name, aliases }) => ({ key, name, aliases })) });
  const ranked = recommend([{ id: "s1", chapterIndex: 0, index: 0, text: passage, present: [], mentioned: [] }], pool);
  const label = (ref: string) => pool.find((entry) => entry.ref === ref)!.label;
  // 晓月 is the block's new 林晓月 (who is the universe's 林晓月); 双辫少女 only probably her; 王五 is no one known.
  const decisions = fake({ "who:n2": [label("new:n1"), 0.95], "who:n3": [label(personRef(person.id)), 0.7], "who:n4": ["NEW_PERSON", 0.9] });
  const result = new Map((await resolveNewNames({ names, pool, candidates: () => ranked.get("s1")!, decisions })).map((entry) => [entry.name, entry]));
  assert.equal(result.get("林晓月")!.method, "full-name");
  assert.equal(result.get("林晓月")!.to?.ref, personRef(person.id));
  assert.equal(result.get("晓月")!.method, "jev");
  assert.equal(result.get("晓月")!.to?.ref, personRef(person.id), "a name bound to another new name follows it");
  assert.equal(result.get("双辫少女")!.to, null);
  assert.equal(result.get("双辫少女")!.possible?.entry.ref, personRef(person.id), "uncertain: kept new, raised with its likely match");
  assert.equal(result.get("王五")!.to, null);
  assert.ok(!decisions.questions.some((question) => question.key === "who:n1"), "a full name needs no question");
});

test("at birth, the block's declarations are rewritten before anything is minted", async () => {
  const cast = emptyCast("u1");
  syncBook(cast, "b1", [character("char_000001", "林晓月", "晓月")]);
  const person = personOf(cast, "b1", "char_000001")!;
  const sentences = sectionBlock("林晓月推开门。\n晓月说：“走吧。”\n陈默没有回答。", 0).sentences;
  const span = sentences.map((sentence) => sentence.id);
  const result: SceneFacultyResult = { scene: { newEntities: [{ name: "林晓月", kind: "Character" }, { name: "晓月", kind: "Character" }, { name: "陈默", kind: "Character" }], charactersPresent: ["林晓月", "陈默"], charactersMentioned: [] }, turns: [], notes: [] } as unknown as SceneFacultyResult;
  const decisions = fake({}, {});
  const notes: string[] = [];
  const output = await resolveBlockIdentities({
    chapterIndex: 0, sentences, sceneSpans: [span], sceneResults: new Map([[span[0], Promise.resolve(result)]]), blockDeclarations: null,
    knownEntities: [character("char_000005", "陈默")], universe: { cast, sourceId: "b2", books: [] },
    decide: async (state, questions) => { const answers = await decisions.decide(state, questions); return answers.map((answer) => answer.key === "who:n2" ? { ...answer, value: "林晓月 (new in this block)", confidence: 0.96 } : answer); },
    note: (key, text) => notes.push(`${key}: ${text}`),
  });
  const declared = output.sceneResults.get(span[0])!.scene.newEntities!;
  assert.deepEqual(declared.map((entry) => [entry.name, entry.person ?? null]), [["林晓月", person.id], ["林晓月", person.id], ["陈默", null]]);
  assert.ok(declared[1].aliases!.some((alias) => alias.text === "晓月"), "the short form becomes her alias");
  assert.ok(notes.some((entry) => entry.includes("full name")));
});

async function workspace(lines: string[], entities: Entity[], scenes: (sentences: string[]) => Scene[]) {
  const dir = (await initWorkspace(join(await mkdtemp(join(tmpdir(), "uem-")), "novel"))).novelDir;
  const text = lines.join("\n");
  await writeFile(join(dir, "source", "novel.txt"), text);
  const ids = cutBlocks(text).flatMap((block) => sectionBlock(block.text, block.index).sentences.map((sentence) => sentence.id));
  const bundle = new BundleStore(join(dir, "ontology"));
  for (const entity of entities) await bundle.upsertEntity(entity);
  for (const scene of scenes(ids)) await bundle.upsertScene(scene);
  return dir;
}
const scene = (id: string, sentenceIds: string[], present: string[]): Scene => ({ id, chapterIndex: 0, sentenceIds, charactersPresent: present, charactersMentioned: [], turns: [], dialogues: [], locationId: null }) as unknown as Scene;
const mintPacket = (...ids: string[]) => { const packet = newChangeSet("b0001"); packet.proposals = ids.map((id) => ({ id: `b0001_mint_${id}`, kind: "upsert_entity", payload: { id }, confidence: 0.9, provenance: { blockId: "b0001", sentenceIds: [], patchId: "extraction" } })) as never; return packet; };

test("after apply: a confident match merges through the audited merge; the shared list follows", async () => {
  const dir = await workspace(["林晓月推开教室的门。", "晓月笑了。"], [character("char_000001", "林晓月"), character("char_000002", "晓月")], (ids) => [scene("scene_000001", [ids[0]], ["char_000001"]), scene("scene_000002", [ids[1]], ["char_000002"])]);
  const summary = await runIdentityAfterApply({ novelDir: dir, decisions: fake({}, { "same:0": 0.96, "distinct:0": 0.05 }), changeset: mintPacket("char_000002"), env: {} });
  assert.deepEqual(summary.merged.map((entry) => [entry.keep, entry.drop]), [["char_000001", "char_000002"]]);
  const rows = (await readFile(join(dir, "ontology", "entities.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Entity);
  assert.ok(!rows.some((row) => row.id === "char_000002"));
  assert.deepEqual(rows.filter((row) => row.id === "char_000001").at(-1)!.names.map((name) => name.text), ["林晓月", "晓月"]);
  const cast = await loadCast({ root: dir, universeId: "book" });
  assert.equal(cast.persons.length, 1);
  assert.equal(personOf(cast, "book", "char_000002"), undefined);
});

test("after apply: a less confident match is raised for review; accept merges, reject is remembered", async () => {
  const dir = await workspace(["林晓月推开教室的门。", "晓月笑了。", "陈默站在窗边。"], [character("char_000001", "林晓月"), character("char_000002", "晓月"), character("char_000003", "陈默")], (ids) => [scene("scene_000001", [ids[0], ids[1]], ["char_000001", "char_000002"]), scene("scene_000002", [ids[2]], ["char_000003"])]);
  const summary = await runIdentityAfterApply({ novelDir: dir, decisions: fake({}, { "same:0": 0.75, "distinct:0": 0.1 }), changeset: mintPacket("char_000002"), env: {} });
  assert.equal(summary.merged.length, 0);
  assert.equal(summary.review?.proposals, 1);
  const [packet] = await openIdentityPackets({ root: dir });
  // A standalone book reviews its identity packets through the shared command, book scope (the checklist's next command).
  assert.equal(((await reviewCommand("show", { directory: dir, packetId: packet.id, scope: "book" }, {}, {})) as { facts: { field: string }[] }).facts[0].field, "identity-match");
  const adapter = await reviewAdapter({ directory: dir, packetId: packet.id, scope: "book" }, {});
  assert.equal(adapter.facts[0].field, "identity-match");
  assert.ok(adapter.facts[0].evidence.length >= 2, "both sides' own words");
  await adapter.apply([{ factId: adapter.facts[0].id, verdict: "accept", reason: "晓月 is 林晓月's given name in these lines." }]);
  const rows = (await readFile(join(dir, "ontology", "entities.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Entity);
  assert.ok(!rows.some((row) => row.id === "char_000002"));
  assert.equal((await openIdentityPackets({ root: dir })).length, 0);
  // Rejected: remembered and never asked again.
  const other = await workspace(["林晓月推开教室的门。", "晓月笑了。"], [character("char_000001", "林晓月"), character("char_000002", "晓月")], (ids) => [scene("scene_000001", [ids[0], ids[1]], ["char_000001", "char_000002"])]);
  await runIdentityAfterApply({ novelDir: other, decisions: fake({}, { "same:0": 0.75 }), changeset: mintPacket("char_000002"), env: {} });
  const [second] = await openIdentityPackets({ root: other });
  const review = await reviewAdapter({ directory: other, packetId: second.id, scope: "book" }, {});
  await review.apply([{ factId: review.facts[0].id, verdict: "reject", reason: "Two different people in these lines." }]);
  const again = fake({}, { "same:0": 0.99 });
  await runIdentityAfterApply({ novelDir: other, decisions: again, changeset: mintPacket("char_000002"), env: {} });
  assert.equal(again.calls, 0, "a rejected pair is not asked again");
});

test("after apply without a decision model, the book still joins the shared list", async () => {
  const dir = await workspace(["陈默站在窗边。"], [character("char_000001", "陈默")], (ids) => [scene("scene_000001", [ids[0]], ["char_000001"])]);
  const summary = await runIdentityAfterApply({ novelDir: dir, decisions: null, changeset: mintPacket("char_000001"), env: {} });
  assert.equal(summary.created, 1);
  const cast = await loadCast({ root: dir, universeId: "book" });
  await saveCast({ root: dir, universeId: "book" }, cast);
  assert.equal(cast.persons[0].name, "陈默");
});

test("after apply: a shared description alone never merges automatically, however sure Jev is", async () => {
  // Two different teachers both recorded as "女老师": the names do not tie them, so the match is reviewed.
  const dir = await workspace(["月咏老师走进教室。", "女老师吹响了哨子。"], [character("char_000001", "月咏小萌", "女老师"), character("char_000002", "女老师")], (ids) => [scene("scene_000001", [ids[0], ids[1]], ["char_000001", "char_000002"])]);
  const summary = await runIdentityAfterApply({ novelDir: dir, decisions: fake({}, { "same:0": 0.97, "distinct:0": 0.05 }), changeset: mintPacket("char_000002"), env: {} });
  assert.equal(summary.merged.length, 0);
  assert.equal(summary.review?.proposals, 1);
});

test("review: accepting chained matches follows the earlier merge", async () => {
  const dir = await workspace(["林晓月推开教室的门。", "晓月笑了。", "晓月同学也笑了。"], [character("char_000001", "林晓月"), character("char_000002", "晓月"), character("char_000003", "晓月同学")], (ids) => [scene("scene_000001", [ids[0], ids[1], ids[2]], ["char_000001", "char_000002", "char_000003"])]);
  // 晓月 ~ 林晓月 and 晓月同学 ~ 晓月 are both raised (Jev unsure); accepting one moves 晓月, and the other follows it.
  await runIdentityAfterApply({ novelDir: dir, decisions: fake({}, { "same:0": 0.75, "same:1": 0.75, "same:2": 0.75, "same:3": 0.75 }), changeset: mintPacket("char_000002", "char_000003"), env: {} });
  const [packet] = await openIdentityPackets({ root: dir });
  const review = await reviewAdapter({ directory: dir, packetId: packet.id, scope: "book" }, {});
  assert.ok(review.facts.length >= 2 && !review.stale);
  await review.apply(review.facts.map((fact) => ({ factId: fact.id, verdict: "accept" as const, reason: "One girl under three names in these lines." })));
  const rows = (await readFile(join(dir, "ontology", "entities.jsonl"), "utf8")).split("\n").filter(Boolean).map((line) => JSON.parse(line) as Entity);
  assert.deepEqual([...new Set(rows.map((row) => row.id))], ["char_000001"]);
});
