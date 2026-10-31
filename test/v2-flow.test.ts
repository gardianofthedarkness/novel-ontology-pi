import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecisionAnswer, DecisionQuestion, DecisionState } from "../src/ground/connectors/jev.js";
import { sectionBlock, type Sentence } from "../src/digger/intake/sectioning.js";
import { kindCards, type SentenceKind } from "../src/digger/autostep/segmentation.js";
import { Chart, mentions, nameOverlap, recommend, resolveBatch } from "../src/v2/em.js";
import { lexiconLister } from "../src/v2/listing.js";
import { typeNames, typingDocument } from "../src/v2/typing.js";
import { readFlow } from "../src/v2/flow.js";
import { resolveRoles } from "../src/v2/roles.js";
import { FactLedger } from "../src/v2/facts.js";
import { worldBase } from "../src/v2/base.js";
import { canonRecords } from "../src/v2/canon.js";
import { yamlDocument } from "../src/v2/yaml.js";
import { readStoryTime, timeWords } from "../src/v2/time.js";

const sentences = (text: string, block = 1): Sentence[] => sectionBlock(text, block).sentences;
const noFacts = () => new FactLedger([], () => "", () => 0);

test("cards: runs of one kind, a new card where the carrier changes, exchanges nested over the runs inside them", () => {
  const ids = ["s1", "s2", "s3", "s4", "s5", "s6", "s7"];
  const kinds: SentenceKind[] = ["environment", "environment", "spoken", "action", "spoken", "fact", "fact"];
  const turns = [0, 0.9, 0, 0, 0, 0, 0.8];
  const cards = kindCards(ids, kinds, turns);
  const of = (kind: string) => cards.filter((card) => card.kind === kind).map((card) => [card.first, card.last]);
  assert.deepEqual(of("environment"), [["s1", "s1"], ["s2", "s2"]], "the carrier changes at s2: two environment cards");
  assert.deepEqual(of("fact"), [["s6", "s6"], ["s7", "s7"]]);
  const dialogue = cards.find((card) => card.kind === "dialogue")!;
  assert.deepEqual([dialogue.first, dialogue.last, dialogue.home], ["s3", "s5", "world"]);
  assert.deepEqual(dialogue.inside, ["spoken:s3", "action:s4", "spoken:s5"], "the action between the lines is its own card, inside the exchange");
  assert.equal(cards.find((card) => card.kind === "fact")!.home, "ontology");
});

test("typing: one structured document a batch, each string by path, types grouped into EM's categories", async () => {
  const batch = sentences("上条当麻走进学园都市。第二天早上，他拿起手机。");
  const document = typingDocument(batch, ["上条当麻", "学园都市", "第二天早上"]);
  assert.deepEqual(Object.keys(document.names), ["n1", "n2", "n3"]);
  assert.deepEqual(document.names.n1.in, [batch[0].id]);
  let asked: DecisionQuestion[] = [];
  const types: Record<string, string> = { "type:n1": "person", "type:n2": "place", "type:n3": "time", "type:n4": "routine" };
  const detected = await typeNames(async (_state: DecisionState, questions) => { asked = questions; return questions.map((q) => ({ key: q.key, value: types[q.key] ?? (q.key === "proper:n3" ? 0.1 : 0.9), confidence: 0.9 })); }, batch, ["上条当麻", "学园都市", "第二天早上", "手机"]);
  assert.deepEqual(asked.slice(0, 2).map((q) => q.instructions), ["What is names.n1?", "Is names.n1 a proper name?"]);
  assert.deepEqual(detected.map((entry) => [entry.type, entry.category, entry.proper]), [["person", "person", 0.9], ["place", "place", 0.9], ["time", "time", 0.1], ["routine", null, 0.9]], "an everyday thing is no entity");
  assert.ok(asked[0].options!.includes("concept"), "a concept (an ability, a network) is one of the types");
});

test("names: a longer name masks the shorter inside it; overlap of names", () => {
  const found = mentions("御坂妹妹看着御坂。", [["御坂妹妹", "p2"], ["御坂", "p1"]]);
  assert.deepEqual(found.map((hit) => [hit.name, hit.id]), [["御坂妹妹", "p2"], ["御坂", "p1"]]);
  assert.equal(nameOverlap("上条", "上条当麻"), 1);
  assert.equal(nameOverlap("黒子", "白井"), 0);
});

/** Jev scripted by question key (an option, with its confidence). */
const scripted = (script: Record<string, [string, number]>) => async (_state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionAnswer[]> =>
  questions.map((q) => { const [value, confidence] = script[q.key] ?? ["new", 0.9]; return { key: q.key, value, confidence, distribution: { [value]: confidence } }; });

test("EM: an exact name is that entity, with no model call; a new name with no candidates is minted; times go to the times", async () => {
  const chart = new Chart();
  const batch = sentences("上条当麻跑了。上条当麻停下。第二天早上。");
  const position = (id: string) => batch.findIndex((sentence) => sentence.id === id);
  let calls = 0;
  const decide = async (state: DecisionState, questions: DecisionQuestion[]) => { calls++; return scripted({})(state, questions); };
  const first = await resolveBatch(decide, chart, batch, [
    { key: "n1", text: "上条当麻", type: "person", category: "person", confidence: 0.9, proper: 1, sentences: [batch[0].id, batch[1].id] },
    { key: "n2", text: "第二天早上", type: "time", category: "time", confidence: 0.9, proper: 1, sentences: [batch[2].id] },
  ], { position, text: () => "", facts: noFacts() });
  assert.deepEqual(first.map((entry) => entry.outcome), ["new", "time"]);
  assert.equal(calls, 0);
  const again = await resolveBatch(decide, chart, batch, [{ key: "n1", text: "上条当麻", type: "person", category: "person", confidence: 0.9, proper: 1, sentences: [batch[1].id] }], { position, text: () => "", facts: noFacts() });
  assert.deepEqual([again[0].outcome, again[0].entity], ["exact", "char_000001"]);
  assert.equal(calls, 0);
  assert.deepEqual(chart.entities.get("char_000001")!.seen, [batch[0].id, batch[1].id]);
});

test("EM: the recommender's best three go to Jev with the facts that name them; a sure answer is an alias, an unsure one new", async () => {
  const chart = new Chart();
  const text = sentences("上条当麻来了。白井黒子来了。御坂美琴来了。上条走了。那个少年回来了。");
  const position = (id: string) => text.findIndex((sentence) => sentence.id === id);
  chart.mint("person", "person", "上条当麻", [text[0].id]);
  chart.mint("person", "person", "白井黒子", [text[1].id]);
  chart.mint("person", "person", "御坂美琴", [text[2].id]);
  const ranked = recommend(chart, { key: "n1", text: "上条", type: "person", category: "person", confidence: 1, proper: 1, sentences: [text[3].id] }, position);
  assert.equal(ranked[0].id, "char_000001", "shares its name and is near");
  assert.equal(ranked.length, 3);
  let state: Record<string, unknown> = {};
  const decide = async (given: DecisionState, questions: DecisionQuestion[]) => { state = given as Record<string, unknown>; return scripted({ "em:n1": ["char_000001", 0.92], "em:n2": ["char_000001", 0.4] })(given, questions); };
  const results = await resolveBatch(decide, chart, text.slice(3), [
    { key: "n1", text: "上条", type: "person", category: "person", confidence: 1, proper: 1, sentences: [text[3].id] },
    { key: "n2", text: "那个少年", type: "person", category: "person", confidence: 1, proper: 1, sentences: [text[4].id] },
  ], { position, text: (id) => text[position(id)]?.text ?? "", facts: new FactLedger([text[0], text[1]].map((sentence) => ({ id: `fact:${sentence.id}`, first: sentence.id, last: sentence.id, sentences: [sentence.id] })), (id) => (id === text[0].id ? "上条当麻是高中生。" : "那个少年总是倒霉。"), position) });
  assert.deepEqual(results.map((entry) => [entry.outcome, entry.entity]), [["alias", "char_000001"], ["new", "char_000004"]]);
  assert.equal(results[1].unsure, "char_000001", "kept for the world engine's second EM");
  assert.deepEqual(chart.entities.get("char_000001")!.names, ["上条当麻", "上条"]);
  assert.ok(Object.keys(state.candidates as object).includes("char_000001"));
  assert.deepEqual(state.facts, { fact_000001: { about: ["char_000001", "names.n1"], text: "上条当麻是高中生。" }, fact_000002: { about: ["names.n2"], text: "那个少年总是倒霉。" } }, "the facts are the evidence: the latest about each candidate, and those that hold the name");
  assert.deepEqual(results.map((entry) => entry.facts), [["fact_000001"], ["fact_000001", "fact_000002"]]);
});

test("EM: a description of a person, a vehicle or a weapon is no one's name (EM² resolves it); everyday things are routine; a place's description is a name only where EM said it", async () => {
  const chart = new Chart();
  const batch = sentences("上条当麻来到常盘台中学。那个少年拿起手机，跳上那辆车，看向天空之眼。清扫机器人经过学校。");
  const position = (id: string) => batch.findIndex((sentence) => sentence.id === id);
  chart.mint("person", "person", "上条当麻", [batch[0].id]);
  chart.mint("place", "building", "常盘台中学", [batch[0].id]);
  chart.mint("thing", "object", "天空之眼", []);
  let calls = 0;
  const results = await resolveBatch(async (state, questions) => { calls++; return scripted({ "em:n6": ["loc_000001", 0.9] })(state, questions); }, chart, batch, [
    { key: "n1", text: "那个少年", type: "person", category: "person", confidence: 1, proper: 0.1, sentences: [batch[1].id] },
    { key: "n2", text: "手机", type: "object", category: "thing", confidence: 1, proper: 0.2, sentences: [batch[1].id] },
    { key: "n3", text: "那辆车", type: "vehicle", category: "thing", confidence: 1, proper: 0.1, sentences: [batch[1].id] },
    { key: "n4", text: "天空之眼", type: "object", category: "thing", confidence: 1, proper: 0.9, sentences: [batch[1].id] },
    { key: "n5", text: "清扫机器人", type: "routine", category: null, confidence: 1, proper: 0.3, sentences: [batch[2].id] },
    { key: "n6", text: "学校", type: "building", category: "place", confidence: 1, proper: 0.2, sentences: [batch[2].id] },
  ], { position, text: () => "", facts: noFacts() });
  assert.deepEqual(results.map((entry) => [entry.outcome, entry.entity]), [["description", undefined], ["routine", undefined], ["description", undefined], ["exact", "item_000001"], ["routine", undefined], ["alias", "loc_000001"]]);
  assert.deepEqual(results[2].sentences, [batch[1].id]);
  assert.equal(calls, 1, "only the place is asked");
  assert.equal([...chart.entities.values()].filter((entity) => entity.category === "thing").length, 1, "no everyday thing joins the chart");
  assert.deepEqual(chart.entities.get("loc_000001")!.names, ["常盘台中学", "学校"]);
  assert.equal(chart.exact("学校"), undefined);
  assert.deepEqual(chart.names().map(([name]) => name).sort(), ["上条当麻", "天空之眼", "常盘台中学"].sort());
  assert.deepEqual(chart.entities.get("loc_000001")!.seen, [batch[0].id, batch[2].id], "seen where EM decided it");
});

test("EM: a concept the story names is an entity, and whose it is is asked until it is known; a fact about it is about its owner", async () => {
  const chart = new Chart();
  const fact = sentences("幻想杀手能消除一切异能。", 0), batch = sentences("上条当麻举起右手。幻想杀手消除了攻击。超能力也一样。"), later = sentences("幻想杀手又一次发动了。", 2);
  const all = [...fact, ...batch, ...later], position = (id: string) => all.findIndex((sentence) => sentence.id === id);
  const facts = new FactLedger([{ id: "fact:0", first: fact[0].id, last: fact[0].id, sentences: [fact[0].id] }], (id) => all.find((sentence) => sentence.id === id)?.text ?? "", position);
  chart.mint("person", "person", "上条当麻", [batch[0].id]);
  const asked: { state: Record<string, unknown>; questions: DecisionQuestion[] }[] = [];
  const decide = async (state: DecisionState, questions: DecisionQuestion[]) => { asked.push({ state: state as Record<string, unknown>, questions }); return scripted({ "own:concept_000001": ["char_000001", 0.9] })(state, questions); };
  const results = await resolveBatch(decide, chart, batch, [
    { key: "n1", text: "幻想杀手", type: "concept", category: "concept", confidence: 1, proper: 0.9, sentences: [batch[1].id] },
    { key: "n2", text: "超能力", type: "concept", category: "concept", confidence: 1, proper: 0.1, sentences: [batch[2].id] },
  ], { position, text: () => "", facts });
  assert.deepEqual(results.map((entry) => [entry.outcome, entry.entity]), [["new", "concept_000001"], ["skip", undefined]], "a concept with no name of its own is no entity");
  assert.equal(asked.length, 1, "only whose it is is asked");
  assert.deepEqual(asked[0].questions.map((q) => [q.key, q.options]), [["own:concept_000001", ["char_000001", "many", "none"]]]);
  assert.deepEqual(Object.keys((asked[0].state as { facts: Record<string, unknown> }).facts), ["fact_000001"], "with the facts that name it");
  assert.deepEqual(results[0].owner, { answer: "char_000001", confidence: 0.9 });
  assert.deepEqual(chart.entities.get("concept_000001")!.owners, [{ id: "char_000001", from: batch[1].id, confidence: 0.9 }]);
  // Known by name and owned: no request.
  const again = await resolveBatch(decide, chart, later, [{ key: "n1", text: "幻想杀手", type: "concept", category: "concept", confidence: 1, proper: 0.9, sentences: [later[0].id] }], { position, text: () => "", facts });
  assert.deepEqual([again[0].outcome, asked.length], ["exact", 1]);
  assert.deepEqual(facts.about(chart, ["char_000001"], position(later[0].id)).map((entry) => entry.id), ["fact_000001"], "a fact about the concept is about its owner");
  facts.settle(chart, position);
  assert.deepEqual(facts.facts[0].about, [{ id: "concept_000001", via: "name" }, { id: "char_000001", via: "concept" }]);
});

test("EM: two new names of one person born in one batch see each other", async () => {
  const chart = new Chart();
  const batch = sentences("白井黒子出现了。黒子笑了。");
  const position = (id: string) => batch.findIndex((sentence) => sentence.id === id);
  const results = await resolveBatch(scripted({ "em:n2": ["n1", 0.9], "em:n1": ["new", 0.9] }), chart, batch, [
    { key: "n1", text: "白井黒子", type: "person", category: "person", confidence: 1, proper: 1, sentences: [batch[0].id] },
    { key: "n2", text: "黒子", type: "person", category: "person", confidence: 1, proper: 1, sentences: [batch[0].id, batch[1].id] },
  ], { position, text: () => "", facts: noFacts() });
  assert.deepEqual(results.map((entry) => [entry.outcome, entry.entity]), [["new", "char_000001"], ["alias", "char_000001"]]);
  assert.deepEqual(chart.entities.get("char_000001")!.names, ["白井黒子", "黒子"]);
});

test("EM²: who says, acts and is spoken to; a description means a cast member, or opens a slot (a person, a crowd, a vehicle); named vehicles act; flashbacks; facts as evidence; habits next time", async () => {
  const chart = new Chart();
  const text = sentences("上条当麻走在街上。「姐姐大人！」白井黑子喊道。少女回过头。「你是谁？」那个少女问。警备员们包围了大楼。「走吧。」那是三年前的事。锤头鲨开走了。一辆货车冲了过来。", 1);
  const id = (index: number) => text[index].id;
  const kinds: Record<string, { kind: string }> = Object.fromEntries(text.map((sentence, index) => [sentence.id, { kind: ["action", "spoken", "action", "spoken", "action", "spoken", "action", "action", "action"][index] }]));
  chart.mint("person", "person", "上条当麻", [id(0)]);
  chart.mint("person", "person", "白井黑子", [id(1)]);
  chart.mint("person", "person", "御坂美琴", []);
  chart.mint("thing", "vehicle", "锤头鲨", [id(7)]);
  const named = new Map([[id(0), ["char_000001"]], [id(1), ["char_000002"]], [id(7), ["item_000001"]]]);
  const fact = sentences("御坂美琴被叫作姐姐大人。", 0);
  const all = [...fact, ...text], position = (sentence: string) => all.findIndex((entry) => entry.id === sentence);
  const ledger = () => new FactLedger([{ id: `fact:${fact[0].id}`, first: fact[0].id, last: fact[0].id, sentences: [fact[0].id] }], (sentence) => all.find((entry) => entry.id === sentence)?.text ?? "", position);
  const asked: { state: Record<string, unknown>; questions: DecisionQuestion[] }[] = [];
  const answers: Record<string, [string, number]> = {
    [`role:who:${id(0)}`]: ["char_000001", 0.9],
    [`role:who:${id(1)}`]: ["char_000002", 0.95], [`role:to:${id(1)}`]: ["d1", 0.8],
    [`role:who:${id(2)}`]: ["d2", 0.9],
    [`role:who:${id(3)}`]: ["d3", 0.9], [`role:to:${id(3)}`]: ["d3", 0.7],
    [`role:who:${id(4)}`]: ["d4", 0.8],
    [`role:who:${id(5)}`]: ["char_000001", 0.4], [`role:to:${id(5)}`]: ["none", 0.6],
    [`role:who:${id(6)}`]: ["time", 0.8],
    [`role:who:${id(7)}`]: ["item_000001", 0.9],
    [`role:who:${id(8)}`]: ["d5", 0.9],
  };
  const decide = async (state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionAnswer[]> => {
    asked.push({ state: state as Record<string, unknown>, questions });
    const descriptions = (state as { descriptions?: Record<string, { text: string }> }).descriptions ?? {};
    return questions.map((q) => {
      const ref = q.key.startsWith("ref:") ? descriptions[q.key.slice(4)].text : null;
      if (q.primitive === "noul") return { key: q.key, value: 0.9 };
      const [value, confidence] = ref === "姐姐大人" ? ["char_000003", 0.9] : ref === "警备员们" ? ["crowd", 0.9] : ref ? ["new", 0.9] : answers[q.key] ?? ["none", 0.9];
      const distribution: Record<string, number> = q.key === `role:to:${id(3)}` ? { d3: 0.7, char_000001: 0.2 } : { [value]: confidence };
      return { key: q.key, value, confidence, distribution };
    });
  };
  const descriptions = [{ text: "姐姐大人", type: "person" as const }, { text: "少女", type: "person" as const }, { text: "那个少女", type: "person" as const }, { text: "警备员们", type: "crowd" as const }, { text: "货车", type: "vehicle" as const }];
  const facts = ledger();
  const result = await resolveRoles(decide, {
    scenes: [{ id: "scene_000001", sentences: text.map((sentence) => sentence.id) }], kinds, chart, named, descriptions,
    recommended: new Map([["scene_000001", [{ id: "char_000003", score: 2 }]]]), facts, text: (sentence) => all.find((entry) => entry.id === sentence)?.text ?? "", position,
  });
  assert.equal(asked.length, 1, "nine lines: one request");
  const state = asked[0].state as { cast: Record<string, unknown>; things: Record<string, unknown>; facts: Record<string, { about: string[] }> };
  assert.deepEqual(Object.keys(state.cast).slice(0, 2), ["char_000001", "char_000002"], "the people named in the passage first");
  assert.ok("char_000003" in state.cast, "the recommender's people");
  assert.deepEqual(Object.keys(state.things), ["item_000001"], "the things the passage names, for actions");
  assert.deepEqual(state.facts.fact_000001.about, ["char_000003", "descriptions.d1"], "the facts about the cast and the ones that hold a description");
  assert.ok(asked[0].questions.find((q) => q.key === `role:who:${id(6)}`)!.options!.includes("time"));
  assert.ok(!asked[0].questions.find((q) => q.key === `role:who:${id(1)}`)!.options!.includes("time"), "only an action may go back in time");
  assert.ok(!asked[0].questions.find((q) => q.key === `role:who:${id(1)}`)!.options!.includes("d5"), "a vehicle says nothing");
  assert.deepEqual(asked[0].questions.find((q) => q.key === "ref:d5")!.options, ["item_000001", "new", "general", "none"], "a vehicle's description means a vehicle");
  assert.deepEqual(result.references.map((entry) => [entry.text, entry.entity]), [["姐姐大人", "char_000003"], ["少女", "slot_000001_1"], ["那个少女", "slot_000001_2"], ["警备员们", "slot_000001_3"], ["货车", "slot_000001_4"]]);
  assert.deepEqual(result.slots.map((slot) => [slot.id, slot.kind, slot.names]), [["slot_000001_1", "person", ["少女"]], ["slot_000001_2", "person", ["那个少女"]], ["slot_000001_3", "crowd", ["警备员们"]], ["slot_000001_4", "vehicle", ["货车"]]]);
  assert.deepEqual(result.references[0].facts, ["fact_000001"]);
  assert.equal(result.roles[id(1)].to!.id, "char_000003", "a line said to 姐姐大人 is said to whom it means");
  assert.deepEqual(result.roles[id(1)].to!.via, "姐姐大人");
  assert.deepEqual([result.roles[id(2)].who.id, result.roles[id(2)].who.via], ["slot_000001_1", "少女"]);
  assert.deepEqual([result.roles[id(3)].to!.answer, result.roles[id(3)].to!.id], ["char_000001", null], "never said to the one who says it: the next answer, below 0.5");
  assert.equal(result.roles[id(4)].who.id, "slot_000001_3", "a crowd acts");
  assert.deepEqual([result.roles[id(5)].who.id, result.roles[id(5)].who.answer], [null, "char_000001"], "below ROLE_ACCEPT: no one sure");
  assert.deepEqual([result.roles[id(6)].who.id, result.roles[id(6)].who.answer], [null, "time"], "the story goes back in time");
  assert.equal(result.roles[id(7)].who.id, "item_000001", "a named vehicle acts");
  assert.equal(result.roles[id(7)].matters, 0.9, "and EM² says whether it matters");
  assert.deepEqual([result.roles[id(8)].who.id, result.roles[id(8)].who.via], ["slot_000001_4", "货车"], "so does an unnamed one, through its description");
  assert.deepEqual(result.habits, [{ text: "姐姐大人", entity: "char_000003", count: 1, speakers: { char_000002: 1 } }]);
  assert.deepEqual(chart.names().map(([name]) => name).sort(), ["上条当麻", "御坂美琴", "锤头鲨", "白井黑子"].sort(), "nothing joins the chart");
  // A description resolved in a fact makes the fact about the person (the fact sentence is asked when it holds one).
  facts.link([fact[0].id], "char_000003");
  facts.settle(chart, position);
  assert.deepEqual(facts.facts[0].about, [{ id: "char_000003", via: "name" }]);

  // The next scene: the slots of the scene before are offered, and a description's habit comes with it.
  asked.length = 0;
  const next = sentences("「姐姐大人。」", 2), more = [...all, ...next];
  await resolveRoles(decide, {
    scenes: [{ id: "scene_000001", sentences: text.map((sentence) => sentence.id) }, { id: "scene_000002", sentences: [next[0].id] }], kinds: { ...kinds, [next[0].id]: { kind: "spoken" } }, chart, named, descriptions,
    recommended: new Map([["scene_000001", [{ id: "char_000003", score: 2 }]]]), facts: ledger(), text: (sentence) => more.find((entry) => entry.id === sentence)?.text ?? "", position: (sentence) => more.findIndex((entry) => entry.id === sentence),
  });
  const second = asked[1].state as { cast: Record<string, unknown>; descriptions: Record<string, { meant?: string }> };
  assert.ok("slot_000001_1" in second.cast && "char_000003" in second.cast);
  assert.equal(second.descriptions.d1.meant, "御坂美琴 ×1 (in lines of 白井黑子 ×1)");
});

test("story time: each time word's role, the periods with their dates, flashbacks, the calendar, and facts ranked by story time", async () => {
  const block = sentences("十二月二十四日，上条当麻走在街上。御坂美琴向他走来。三年前，那个少女第一次来到学园都市。她还很小。第二天早上，上条醒了过来。天空很晴朗。");
  const scenes = [{ id: "scene_000001", chapter: 1, sentences: [block[0].id, block[1].id] }, { id: "scene_000002", chapter: 1, sentences: [block[2].id, block[3].id] }, { id: "scene_000003", chapter: 1, sentences: [block[4].id, block[5].id] }];
  const text = (id: string) => block.find((sentence) => sentence.id === id)?.text ?? "", position = (id: string) => block.findIndex((sentence) => sentence.id === id);
  const words = timeWords(block, ["三年前", "那个少女"]);
  assert.deepEqual(words.map((word) => word.text).sort(), ["三年前", "十二月二十四日", "早上", "第二天"].sort(), "a listed string the lexicon cannot read is no time word");
  const asked: DecisionQuestion[][] = [];
  const decide = async (state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionAnswer[]> => {
    asked.push(questions);
    const times = (state as { times?: Record<string, { text: string }> }).times ?? {};
    // A word with 前 jumps back; a forward word inside a flashback comes back to the present; else the scene moves on.
    const inside = (state as { story?: { narration: string } }).story?.narration.startsWith("inside");
    return questions.map((q) => { const value = q.key === "time_continuation" ? "RETURNS_TO_PRESENT" : times[q.key.slice(5)]?.text.includes("前") ? "FLASHBACK" : inside ? "RETURN" : "ADVANCE"; return { key: q.key, value, confidence: 0.9, distribution: { [value]: 0.9 } }; });
  };
  const time = await readStoryTime(decide, { scenes, words, text, position });
  assert.deepEqual(time.words.map((word) => [word.text, word.role, word.decidedBy]), [["十二月二十四日", "ADVANCE", "rule"], ["三年前", "FLASHBACK", "jev"], ["第二天", "RETURN", "jev"], ["早上", "RETURN", "jev"]]);
  assert.ok(asked.flat().some((q) => q.key.startsWith("time:") && q.optionHints?.FLASHBACK), "a structured question with short labels");
  const [christmas, past, next, morning] = time.periods;
  assert.deepEqual(christmas.date, { month: 12, day: 24, derived: false });
  assert.equal(past.flashback, true);
  assert.deepEqual([next.date, morning.date, morning.partOfDay], [{ month: 12, day: 25, derived: true }, { month: 12, day: 25, derived: true }, "morning"], "the next day, derived from the stated date");
  assert.ok(past.storyIndex < christmas.storyIndex, "the flashback is earlier in the story");
  assert.deepEqual(time.scenes.map((scene) => scene.when), ["Year 1 › 12-24", "the past › 3 years before", "Year 1 › 12-25 › morning"], "each scene's caption: its node's path on the time tree");
  assert.equal(morning.when, "Year 1 · 12-25 · morning");
  assert.deepEqual(time.tree.map((node) => [node.id, node.parent]), [["t:story", null], ["t:y1", "t:story"], ["t:y1:12-24", "t:y1"], ["t:past", "t:story"], ["t:past:3year", "t:past"], ["t:y1:12-25", "t:y1"], ["t:y1:12-25:morning", "t:y1:12-25"]]);
  assert.deepEqual(time.treeConflicts, []);

  // A holiday names its day: a heading's 平安夜, then 00:00 and an evening of the same day, is containment, not a conflict
  // or a new day; a time word in a thought only mentions a time.
  const eve = sentences("序章 平安夜的街道。十二月二十四日，凌晨0点0分，城市被雪覆盖。当时究竟发生了什么？时间到了傍晚。", 2);
  const eveScenes = [{ id: "scene_000010", chapter: 1, sentences: eve.slice(0, 3).map((sentence) => sentence.id) }, { id: "scene_000011", chapter: 1, sentences: [eve[3].id] }];
  const eveText = (id: string) => eve.find((sentence) => sentence.id === id)?.text ?? "", evePosition = (id: string) => eve.findIndex((sentence) => sentence.id === id);
  const eveTime = await readStoryTime(decide, { scenes: eveScenes, words: timeWords(eve, []), text: eveText, position: evePosition, kind: (id) => id === eve[2].id ? "thought" : "narration" });
  assert.deepEqual(eveTime.words.filter((word) => word.text === "当时").map((word) => [word.role, word.why]), [["REFERENCE", "kind"]]);
  assert.deepEqual(eveTime.periods.filter((period) => period.label === "傍晚").map((period) => period.date), [{ month: 12, day: 24, derived: true }], "the evening of the 24th");
  assert.deepEqual(eveTime.scenes.map((scene) => scene.when), ["Year 1 › 12-24 › 00:00", "Year 1 › 12-24 › evening"]);
  assert.deepEqual([eveTime.treeConflicts, eveTime.calendar.conflicts], [[], []]);
  assert.equal(time.periodOf(block[1].id)?.id, christmas.id);
  // Facts rank by story time: the flashback's fact is the earliest, though it is read second.
  const facts = new FactLedger([0, 3, 5].map((index) => ({ id: `fact:${index}`, first: block[index].id, last: block[index].id, sentences: [block[index].id] })), text, position);
  facts.byStory(time.periodOf);
  const chart = new Chart();
  assert.deepEqual(facts.holding("", 99, 3).map((fact) => fact.first), [block[5].id, block[0].id, block[3].id], "newest in story time first");
  assert.deepEqual(facts.facts.map((fact) => fact.period), [christmas.id, past.id, morning.id]);
  assert.equal(chart.entities.size, 0);
});

test("the flow: tiling, kinds and listing at once, then EM, the card scan, contexts and the world loop's base", async () => {
  const block = sentences("上条当麻走进教室。「早上好。」上条当麻说。白井黒子跑了过来。学园都市有两百三十万人。远处的机器发出声音。清扫机器人经过。锤头鲨停在路边。");
  const decide = async (state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionAnswer[]> => questions.map((q) => {
    if (q.key.startsWith("dlg_kind:")) { const index = block.findIndex((sentence) => q.key.endsWith(sentence.id)); return { key: q.key, value: ["action", "spoken", "action", "action", "fact", "action", "action", "action"][index] ?? "narration", confidence: 0.9 }; }
    if (q.key.startsWith("dlg_turn:")) return { key: q.key, value: 0, confidence: 0.9 };
    if (q.key.startsWith("proper:")) return { key: q.key, value: 0.9, confidence: 0.9 };
    if (q.key.startsWith("type:")) { const named = (state as { names: Record<string, { text: string }> }).names[q.key.slice(5)].text; return { key: q.key, value: named.length === 4 ? "person" : "time", confidence: 0.9 }; }
    if (q.key.startsWith("scene_start:")) return { key: q.key, value: "NONE", confidence: 0.9 };
    if (q.key.startsWith("scene_end:")) return { key: q.key, value: q.options![q.options!.length - 1], confidence: 0.9 };
    if (q.key.startsWith("role:who:")) {
      const sentence = block.find((entry) => q.key.endsWith(entry.id))!, named = ["上条当麻", "白井黒子"].findIndex((name) => sentence.text.includes(name));
      return { key: q.key, value: named >= 0 ? `char_00000${named + 1}` : sentence.text.includes("机器") ? "none" : "char_000001", confidence: 0.9 };
    }
    return { key: q.key, value: q.primitive === "noul" ? 0 : q.options![0], confidence: 0.9 };
  });
  const typed: Record<string, string> = { 清扫机器人: "routine", 锤头鲨: "vehicle" };
  const robot = async (state: DecisionState, questions: DecisionQuestion[]) => (await decide(state, questions)).map((answer) => {
    const named = answer.key.startsWith("type:") ? (state as { names: Record<string, { text: string }> }).names[answer.key.slice(5)].text : "";
    if (typed[named]) return { ...answer, value: typed[named] };
    if (answer.key.startsWith("role:who:") && answer.key.endsWith(block[7].id)) return { ...answer, value: "item_000001" };
    if (answer.key.startsWith("role:matters:")) return { ...answer, value: answer.key.endsWith(block[7].id) ? 0.1 : 0.9 };
    return answer;
  });
  const result = await readFlow([{ id: "b0001", chapter: 1, sentences: block }], robot, lexiconLister(["上条当麻", "白井黒子", "清扫机器人", "锤头鲨"]));
  assert.equal(result.scenes.length, 1);
  assert.deepEqual([...result.chart.entities.values()].map((entity) => [entity.id, entity.names[0]]).sort(), [["char_000001", "上条当麻"], ["char_000002", "白井黒子"], ["item_000001", "锤头鲨"]], "the cleaning robot is an everyday thing: no entity");
  assert.equal(result.em.flatMap((batch) => batch.results).find((entry) => entry.text === "清扫机器人")?.outcome, "routine");
  const action = result.cards.find((card) => card.kind === "action")!;
  assert.deepEqual(action.entities.map((hit) => hit.id), ["char_000001"]);
  assert.deepEqual(action.people.map((person) => [person.id, person.how]), [["char_000001", ["named", "acts"]]]);
  const said = block.find((sentence) => sentence.text.includes("早上好"))!.id;
  assert.equal(result.roles[said].who.id, "char_000001", "the line that names no one: who says it, from EM²");
  assert.ok(result.steps.some((step) => step.step === "roles (EM²)"));
  const background = block[5].id;
  assert.deepEqual([result.kinds[background].kind, result.kinds[background].was], ["narration", "action"], "an action where nothing that matters acts is narration");
  assert.deepEqual([result.kinds[block[6].id].kind, result.kinds[block[6].id].was, result.kinds[block[6].id].actor], ["narration", "action", undefined], "so is an everyday thing's");
  assert.deepEqual([result.kinds[block[7].id].kind, result.kinds[block[7].id].actor], ["narration", "item_000001"], "and one EM² calls background, whoever acts in it");
  assert.equal(result.roles[background], undefined);
  assert.ok(result.cards.some((card) => card.kind === "narration" && card.first === background), "the cards are cut again");
  assert.deepEqual(result.facts.map((fact) => [fact.id, fact.first]), [["fact_000001", block[4].id]]);
  assert.ok(result.steps.some((step) => step.step === "EM"));
  const base = worldBase(result, (id) => block.find((sentence) => sentence.id === id)?.text ?? "");
  assert.equal(base.scenes[0].events.length, 2);
  assert.ok(base.scenes[0].events[1].actors.includes("char_000002"), "who takes part in an action card: the people it names");
  assert.equal(base.facts.length, 1);
  assert.deepEqual(base.roster.characters.map((entry) => entry.names), [["上条当麻"], ["白井黒子"]]);
  // The same reading as a workspace's canon: action cards are the events (with the base's ids), the people they name their actors.
  const canon = canonRecords(result, (id) => block.find((sentence) => sentence.id === id)?.text ?? "");
  assert.deepEqual(canon.scenes.map((scene) => scene.id), ["scene_000001"]);
  assert.deepEqual(canon.events.map((event) => event.id), base.scenes[0].events.map((event) => event.id));
  assert.deepEqual(canon.entities.filter((entity) => entity.kind === "Character").map((entity) => [entity.kind, entity.names[0]]), [["Character", { text: "上条当麻", lang: "zh", kind: "canonical" }], ["Character", { text: "白井黒子", lang: "zh", kind: "canonical" }]]);
  assert.ok(canon.relations.every((relation) => relation.type === "PARTICIPATES_IN" && canon.events.some((event) => event.id === relation.toId)));
  assert.equal(canon.scenes[0].dialogues.length, 1);
});

test("YAML: blocks, inline short lists, quoted strings", () => {
  assert.equal(yamlDocument({ step: "EM", requests: 3, ids: ["s1", "s2"], cards: [{ kind: "fact", text: "a: b" }] }), 'step: EM\nrequests: 3\nids: [s1, s2]\ncards:\n  - kind: fact\n    text: "a: b"\n');
});
