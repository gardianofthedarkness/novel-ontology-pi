import assert from "node:assert/strict";
import { test } from "node:test";
import type { DecisionAnswer, DecisionQuestion, DecisionState } from "../src/ground/connectors/jev.js";
import { sectionBlock, type Sentence } from "../src/digger/intake/sectioning.js";
import { kindCards, type SentenceKind } from "../src/digger/autostep/segmentation.js";
import { Chart, mentions, nameOverlap, recommend, resolveBatch } from "../src/v2/em.js";
import { lexiconLister } from "../src/v2/listing.js";
import { typeNames, typingDocument } from "../src/v2/typing.js";
import { readFlow } from "../src/v2/flow.js";
import { worldBase } from "../src/v2/base.js";
import { canonRecords } from "../src/v2/canon.js";
import { yamlDocument } from "../src/v2/yaml.js";

const sentences = (text: string, block = 1): Sentence[] => sectionBlock(text, block).sentences;

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
  const types: Record<string, string> = { "type:n1": "person", "type:n2": "place", "type:n3": "time" };
  const detected = await typeNames(async (_state: DecisionState, questions) => { asked = questions; return questions.map((q) => ({ key: q.key, value: types[q.key] ?? (q.key === "proper:n3" ? 0.1 : 0.9), confidence: 0.9 })); }, batch, ["上条当麻", "学园都市", "第二天早上"]);
  assert.deepEqual(asked.slice(0, 2).map((q) => q.instructions), ["What is names.n1?", "Is names.n1 a proper name?"]);
  assert.deepEqual(detected.map((entry) => [entry.type, entry.category, entry.proper]), [["person", "person", 0.9], ["place", "place", 0.9], ["time", "time", 0.1]]);
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
  ], { position, text: () => "", facts: [] });
  assert.deepEqual(first.map((entry) => entry.outcome), ["new", "time"]);
  assert.equal(calls, 0);
  const again = await resolveBatch(decide, chart, batch, [{ key: "n1", text: "上条当麻", type: "person", category: "person", confidence: 0.9, proper: 1, sentences: [batch[1].id] }], { position, text: () => "", facts: [] });
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
  ], { position, text: (id) => text[position(id)]?.text ?? "", facts: [{ first: text[0].id, text: "上条当麻是高中生。" }] });
  assert.deepEqual(results.map((entry) => [entry.outcome, entry.entity]), [["alias", "char_000001"], ["new", "char_000004"]]);
  assert.equal(results[1].unsure, "char_000001", "kept for the world engine's second EM");
  assert.deepEqual(chart.entities.get("char_000001")!.names, ["上条当麻", "上条"]);
  assert.ok(Object.keys(state.candidates as object).includes("char_000001"));
  assert.deepEqual(state.facts, [{ about: "char_000001", text: "上条当麻是高中生。" }]);
});

test("EM: a description is a name only where EM said it: never matched or scanned elsewhere", async () => {
  const chart = new Chart();
  const batch = sentences("上条当麻来了。那个少年笑了。");
  const position = (id: string) => batch.findIndex((sentence) => sentence.id === id);
  chart.mint("person", "person", "上条当麻", [batch[0].id]);
  await resolveBatch(scripted({ "em:n1": ["char_000001", 0.9] }), chart, batch, [{ key: "n1", text: "那个少年", type: "person", category: "person", confidence: 1, proper: 0.1, sentences: [batch[1].id] }], { position, text: () => "", facts: [] });
  assert.deepEqual(chart.entities.get("char_000001")!.names, ["上条当麻", "那个少年"]);
  assert.deepEqual(chart.entities.get("char_000001")!.proper, ["上条当麻"]);
  assert.equal(chart.exact("那个少年"), undefined);
  assert.deepEqual(chart.names().map(([name]) => name), ["上条当麻"]);
  assert.deepEqual(chart.entities.get("char_000001")!.seen, [batch[0].id, batch[1].id], "seen where EM decided it");
});

test("EM: two new names of one person born in one batch see each other", async () => {
  const chart = new Chart();
  const batch = sentences("白井黒子出现了。黒子笑了。");
  const position = (id: string) => batch.findIndex((sentence) => sentence.id === id);
  const results = await resolveBatch(scripted({ "em:n2": ["n1", 0.9], "em:n1": ["new", 0.9] }), chart, batch, [
    { key: "n1", text: "白井黒子", type: "person", category: "person", confidence: 1, proper: 1, sentences: [batch[0].id] },
    { key: "n2", text: "黒子", type: "person", category: "person", confidence: 1, proper: 1, sentences: [batch[0].id, batch[1].id] },
  ], { position, text: () => "", facts: [] });
  assert.deepEqual(results.map((entry) => [entry.outcome, entry.entity]), [["new", "char_000001"], ["alias", "char_000001"]]);
  assert.deepEqual(chart.entities.get("char_000001")!.names, ["白井黒子", "黒子"]);
});

test("the flow: tiling, kinds and listing at once, then EM, the card scan, contexts and the world loop's base", async () => {
  const block = sentences("上条当麻走进教室。「早上好。」上条当麻说。白井黒子跑了过来。学园都市有两百三十万人。");
  const decide = async (state: DecisionState, questions: DecisionQuestion[]): Promise<DecisionAnswer[]> => questions.map((q) => {
    if (q.key.startsWith("dlg_kind:")) { const index = block.findIndex((sentence) => q.key.endsWith(sentence.id)); return { key: q.key, value: ["action", "spoken", "action", "action", "fact"][index] ?? "narration", confidence: 0.9 }; }
    if (q.key.startsWith("dlg_turn:")) return { key: q.key, value: 0, confidence: 0.9 };
    if (q.key.startsWith("proper:")) return { key: q.key, value: 0.9, confidence: 0.9 };
    if (q.key.startsWith("type:")) { const named = (state as { names: Record<string, { text: string }> }).names[q.key.slice(5)].text; return { key: q.key, value: named.length === 4 ? "person" : "time", confidence: 0.9 }; }
    if (q.key.startsWith("scene_start:")) return { key: q.key, value: "NONE", confidence: 0.9 };
    if (q.key.startsWith("scene_end:")) return { key: q.key, value: q.options![q.options!.length - 1], confidence: 0.9 };
    return { key: q.key, value: q.primitive === "noul" ? 0 : q.options![0], confidence: 0.9 };
  });
  const result = await readFlow([{ id: "b0001", chapter: 1, sentences: block }], decide, lexiconLister(["上条当麻", "白井黒子"]));
  assert.equal(result.scenes.length, 1);
  assert.deepEqual([...result.chart.entities.values()].map((entity) => entity.names[0]), ["上条当麻", "白井黒子"]);
  const action = result.cards.find((card) => card.kind === "action")!;
  assert.deepEqual(action.entities.map((hit) => hit.id), ["char_000001"]);
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
  assert.deepEqual(canon.entities.map((entity) => [entity.kind, entity.names[0]]), [["Character", { text: "上条当麻", lang: "zh", kind: "canonical" }], ["Character", { text: "白井黒子", lang: "zh", kind: "canonical" }]]);
  assert.ok(canon.relations.every((relation) => relation.type === "PARTICIPATES_IN" && canon.events.some((event) => event.id === relation.toId)));
  assert.equal(canon.scenes[0].dialogues.length, 1);
});

test("YAML: blocks, inline short lists, quoted strings", () => {
  assert.equal(yamlDocument({ step: "EM", requests: 3, ids: ["s1", "s2"], cards: [{ kind: "fact", text: "a: b" }] }), 'step: EM\nrequests: 3\nids: [s1, s2]\ncards:\n  - kind: fact\n    text: "a: b"\n');
});
