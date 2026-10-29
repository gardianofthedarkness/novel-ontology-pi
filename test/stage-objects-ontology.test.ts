import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { namedThings, objectIdentities, objectProposals, thingEntityId, type ObjectScenePlace, type ObjectsReport } from "../src/digger/stage/objects.js";
import { joinThings, loadThings, nameAffinity, thingPool, thingRef, type ThingsFile } from "../src/solidifier/identity/things.js";
import { timePlaceReviewSource } from "../src/digger/timeplace/afterApply.js";
import { sectionBlock } from "../src/digger/intake/sectioning.js";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { loadChangeSet, saveChangeSet } from "../src/solidifier/merge/changesetStore.js";
import { review } from "../src/solidifier/merge/review.js";
import type { DecisionModel } from "../src/ground/connectors/jev.js";
import type { Entity, Relation, Scene } from "../src/ground/ontology/types.js";

const place = (id: string, name: string): Entity => ({ id, kind: "Location", names: [{ text: name, lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 });
const item = (id: string, name: string): Entity => ({ id, kind: "Item", names: [{ text: name, lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 });
const match = (id: string, kind: "building" | "shape") => ({ id, kind, score: 1, by: "words" as const });
const report = (scenes: ObjectsReport["scenes"]): ObjectsReport => ({ version: 1, model: "mock", embedder: null, askedAt: "", complete: true, usage: { calls: 1, reused: 0, skipped: 0 }, scenes });
const scenes: ObjectScenePlace[] = [
  { id: "s1", placeId: "p7", placeLabel: "第七学区", events: [{ id: "e1", text: "无人车站前停着直升机，K.L.D.（Kite Lancer Drive）展开", sentenceIds: ["b0_s1"] }, { id: "e2", text: "大楼倒塌", sentenceIds: ["b0_s2"] }] },
  { id: "s2", placeId: "p7", placeLabel: "第七学区", events: [{ id: "e3", text: "直升机飞走", sentenceIds: ["b0_s3"] }] },
];
const detected = report({
  s1: { inputs: "x", rejected: 0, objects: [
    { name: "无人车站", kind: "building", size: 30, airborne: false, event: "e1", match: match("station", "building") },
    { name: "直升机", kind: "object", size: 12, airborne: true, event: "e1", match: match("oval", "shape") },
    { name: "K.L.D.（Kite Lancer Drive）", kind: "object", size: 8, airborne: true, event: "e1", match: match("box", "shape") },
    // Unnamed, the place itself, and nothing to cite: never proposed.
    { name: "大楼", kind: "building", size: 40, airborne: false, event: "e2", match: match("office", "building") },
    { name: "第七学区", kind: "building", size: 40, airborne: false, event: "e2", match: match("office", "building") },
    { name: "飞艇", kind: "object", size: 40, airborne: true, event: null, match: match("oval", "shape") },
  ] },
  s2: { inputs: "x", rejected: 0, objects: [{ name: "直升机", kind: "object", size: 12, airborne: true, event: "e3", match: match("oval", "shape") }] },
});
// Another book of the universe already named the station.
const universe: ThingsFile = { version: 1, universeId: "toaru", nextId: 2, things: [{ id: "thing_1", name: "无人车站", kind: "building", forms: ["无人车站"], members: [{ sourceId: "doc_other", entityId: "loc_obj_x" }] }] };

test("named things: one per name (a building per place), each citing the sentences of the event that names it; unnamed ones, places and uncited ones left out", () => {
  const things = namedThings(detected, scenes, ["第七学区"]);
  assert.deepEqual(things.map((thing) => [thing.name, thing.kind, thing.sightings.map((sighting) => sighting.sceneId)]), [["无人车站", "building", ["s1"]], ["直升机", "object", ["s1", "s2"]], ["K.L.D.（Kite Lancer Drive）", "object", ["s1"]]]);
  assert.deepEqual(things[1].sightings[1].sentenceIds, ["b0_s3"]);
});

test("the identity check binds full proper names to this book and the universe, asks Jev about the rest, and keeps likely matches for review", async () => {
  const things = namedThings(detected, scenes, ["第七学区"]);
  const entities = [place("p7", "第七学区"), item("item_kld", "K.L.D."), item("item_heli", "黑色直升机")];
  let asked: string[] = [];
  const decisions: DecisionModel = { modelId: "mock-jev", async decide(_state, questions) {
    asked = questions.map((question) => question.key);
    // "直升机" may be the black helicopter: likely, not sure.
    return questions.map((question) => ({ key: question.key, value: "黑色直升机", confidence: 0.7 }));
  } };
  const identities = await objectIdentities(things, { entities, things: universe, sourceId: "doc_this", decisions });
  const of = (name: string) => identities.get(things.find((thing) => thing.name === name)!.key)!;
  assert.deepEqual([of("无人车站").ref, of("无人车站").method], [thingRef("thing_1"), "full-name"], "a full name another book named binds to that universe thing");
  assert.deepEqual([of("K.L.D.（Kite Lancer Drive）").ref, of("K.L.D.（Kite Lancer Drive）").method], ["item_kld", "full-name"], "\"X（Y）\" answers to X: the book's K.L.D.");
  assert.deepEqual([of("直升机").ref, of("直升机").method, of("直升机").possible?.label], [null, "new", "黑色直升机"], "below the bind threshold: new, with its likely match");
  assert.equal(asked.length, 1, "only the name that is not a bound full name is asked");

  const sources = new Map([["b0_s1", "无人车站前停着直升机，K.L.D.（Kite Lancer Drive）展开。"], ["b0_s3", "直升机飞走了。"]]);
  const proposals = objectProposals(things, identities, { entities, relations: [], proposed: new Set(), sourceHas: (text, ids) => ids.some((id) => sources.get(id)?.includes(text)) });
  const station = proposals.find((proposal) => proposal.kind === "upsert_entity" && (proposal.payload as Entity).kind === "Location")!.payload as Entity;
  assert.deepEqual([station.names[0].text, station.properties.building, station.properties.universalId], ["无人车站", "station", "thing:thing_1"], "a new record in this book, bound to the universe's thing");
  const heli = proposals.find((proposal) => proposal.kind === "upsert_entity" && (proposal.payload as Entity).kind === "Item")!.payload as Entity;
  assert.match(String(heli.properties.possiblySame), /黑色直升机/);
  const relations = proposals.filter((proposal) => proposal.kind === "add_relation").map((proposal) => proposal.payload as Relation).map((relation) => [relation.type, relation.fromId, relation.toId]);
  assert.deepEqual(relations, [["PART_OF", station.id, "p7"], ["MENTIONED_IN", heli.id, "s1"], ["MENTIONED_IN", heli.id, "s2"], ["MENTIONED_IN", "item_kld", "s1"]]);
  assert.deepEqual(proposals.filter((proposal) => proposal.kind === "add_alias").map((proposal) => proposal.payload), [{ entityId: "item_kld", aliasText: "K.L.D.（Kite Lancer Drive）" }], "a new form of a known thing, carried by its source");
  const again = objectProposals(things, identities, { entities, relations: [], proposed: new Set(proposals.map((proposal) => proposal.id)), sourceHas: () => true });
  assert.deepEqual(again, [], "nothing put to review once is asked again");
});

test("the universe's list: bound records join their thing, the rest become new things; pools offer this book's records and other books' things", () => {
  const file: ThingsFile = structuredClone(universe);
  const station: Entity = { ...place(thingEntityId({ key: "building|p7|无人车站", kind: "building" }), "无人车站"), properties: { source: "stage-objects", universalId: thingRef("thing_1") } };
  const heli: Entity = { ...item("item_obj_h", "直升机"), properties: { source: "stage-objects" } };
  assert.deepEqual(joinThings(file, "doc_this", [station, heli]), { joined: 1, added: 1 });
  assert.deepEqual(joinThings(file, "doc_this", [station, heli]), { joined: 0, added: 0 }, "idempotent");
  assert.deepEqual(file.things.map((thing) => [thing.name, thing.members.length]), [["无人车站", 2], ["直升机", 1]]);
  const pool = thingPool({ book: [heli, place("p7", "第七学区")], things: file, sourceId: "doc_new", kind: "object", generic: () => false });
  assert.deepEqual(pool.map((entry) => [entry.ref, entry.kind]), [["item_obj_h", "book"], ["thing:thing_2", "universe"]]);
  assert.deepEqual([nameAffinity("直升机", ["直升机"]), nameAffinity("直升机", ["黑色直升机"]), nameAffinity("直升机", ["直升"]), nameAffinity("直升机", ["卡车"])], [1, 0.8, 0.8, 0]);
});

test("a stage-objects packet goes through the shared gate: accepted things land in the book and its graph, and join the universe's list", async (context) => {
  const parent = await mkdtemp(join(tmpdir(), "stage-objects-gate-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const directory = join(parent, "novel");
  await initWorkspace(directory);
  const text = "无人车站在第七学区。\n直升机停在无人车站前。";
  await writeFile(join(directory, "source", "novel.txt"), text);
  const sentences = new Map(sectionBlock(text, 0).sentences.map((sentence) => [sentence.id, sentence]));
  const [first, second] = [...sentences.keys()];
  await writeFile(join(directory, "ontology", "entities.jsonl"), JSON.stringify(place("p7", "第七学区")) + "\n");
  await writeFile(join(directory, "ontology", "scenes.jsonl"), JSON.stringify({ id: "scene_1", chapterIndex: 0, sentenceIds: [first, second], charactersPresent: [], charactersMentioned: [], turns: [], locationId: "p7" } as unknown as Scene) + "\n");
  const things = namedThings(report({ scene_1: { inputs: "x", rejected: 0, objects: [
    { name: "无人车站", kind: "building", size: 30, airborne: false, event: "e1", match: match("station", "building") },
    { name: "直升机", kind: "object", size: 12, airborne: false, event: "e2", match: match("oval", "shape") },
  ] } }), [{ id: "scene_1", placeId: "p7", placeLabel: "第七学区", events: [{ id: "e1", text: "", sentenceIds: [first] }, { id: "e2", text: "", sentenceIds: [second] }] }], ["第七学区"]);
  const identities = await objectIdentities(things, { entities: [place("p7", "第七学区")], things: null, sourceId: "book" });
  const proposals = objectProposals(things, identities, { entities: [place("p7", "第七学区")], relations: [], proposed: new Set(), sourceHas: () => false });
  const id = "cs_stage_objects_1";
  await saveChangeSet(directory, { id, blockId: "stage-objects", proposals, status: "pending_review", reviewSource: timePlaceReviewSource(proposals, sentences), reviewNotes: {}, createdAt: new Date().toISOString() });
  const target = { directory, packetId: id, scope: "book" as const };
  const env = { NOVEL_SECRETS_DIR: join(tmpdir(), "no-stage-objects-keys") };
  const page = await review("show", target, {}, env) as { revision: string; facts: { id: string }[] };
  for (const fact of page.facts) {
    let offset: number | null = 0;
    do { offset = ((await review("evidence", target, { factId: fact.id, offset, limit: 5 }, env)) as { page: { nextOffset: number | null } }).page.nextOffset; } while (offset !== null);
  }
  await review("decide", target, { revision: page.revision, decisions: page.facts.map((fact) => ({ factId: fact.id, verdict: "accept", reason: "原文写明它在这里。" })) }, env);
  const applied = await review("apply", target, { revision: page.revision }, env) as { result?: { things?: { added: number } } };
  assert.equal((await loadChangeSet(directory, id)).status, "approved");
  const stored = (await readFile(join(directory, "ontology", "relations.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line) as Relation);
  assert.deepEqual(stored.map((relation) => relation.type).sort(), ["MENTIONED_IN", "PART_OF"], "a building in the place tree, a thing named in its scene");
  assert.equal(applied.result?.things?.added, 2, "both join the universe's list");
  assert.deepEqual((await loadThings({ root: directory, universeId: "book" })).things.map((thing) => [thing.name, thing.kind]).sort(), [["无人车站", "building"], ["直升机", "object"]]);
});
