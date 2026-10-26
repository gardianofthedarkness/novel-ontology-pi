import { test } from "node:test";
import assert from "node:assert/strict";
import { IdentityNameIndex, identityChoices } from "../src/ground/language/identityLabels.js";
import { formKey } from "../src/ground/language/nameForms.js";
import { nameDetector, scanKnownNames } from "../src/digger/autostep/patches/name-detector.js";
import type { PatchContext } from "../src/digger/autostep/patches/types.js";
import type { Entity } from "../src/ground/ontology/types.js";

const character = (id: string, name: string, aliases: string[] = []): Entity => ({ id, kind: "Character", names: [{ text: name, lang: "zh", kind: "canonical" }, ...aliases.map(text => ({ text, lang: "zh", kind: "alias" as const }))], properties: {}, confidence: 1 });

test("identity index never picks the last owner of an ambiguous form", () => {
  const index = new IdentityNameIndex();
  index.set(formKey("小明"), "char_1");
  index.set(formKey("小明"), "char_1");
  assert.equal(index.get(formKey("小明")), "char_1");
  index.set(formKey("小明"), "char_2");
  assert.equal(index.get(formKey("小明")), undefined);
  assert.deepEqual(index.owners(formKey("小明")), ["char_1", "char_2"]);
});

test("semantic choices map complete literal names and registered aliases, not IDs, substrings or regex operators", () => {
  const entity = character("char_000001", "A+B(一)", ["小明"]);
  const choices = identityChoices([entity], ["none"]);
  assert.deepEqual(choices.options.map(option => option.label), ["A+B(一)"]);
  assert.equal(choices.resolve(" A+B(一) ")?.id, entity.id);
  assert.equal(choices.resolve("小明")?.id, entity.id);
  for (const value of ["char_000001", "AAB一", "A+B", "小", ".*", "none", "小明的妹妹"]) assert.equal(choices.resolve(value), undefined);
  assert.equal(choices.resolve("小明", "Location"), undefined);
});

test("same-name and shared-alias choices are explicit and never first-match wins", () => {
  const first = character("char_1", "小明", ["阿明"]);
  const second = character("char_2", "小明", ["阿明"]);
  const choices = identityChoices([first, second]);
  assert.equal(choices.resolve("小明"), undefined);
  assert.equal(choices.resolve("阿明"), undefined);
  assert.equal(new Set(choices.options.map(option => option.label)).size, 2);
  for (const option of choices.options) assert.equal(choices.resolve(option.label)?.id, option.entity.id);
  assert.deepEqual(scanKnownNames({ knownEntities: [first, second], sentences: [{ id: "s1", text: "小明看向阿明。" }] } as unknown as PatchContext), []);
  const reserved = identityChoices([character("char_3", "none")], ["none"]);
  assert.equal(reserved.resolve("none"), undefined);
  assert.equal(reserved.resolve(reserved.options[0].label)?.id, "char_3");
  const collision = identityChoices([first, second, character("char_4", "第三人", ["小明 [Character; option 1]"])]);
  assert.ok(!collision.options.slice(0, 2).some(option => option.label === "小明 [Character; option 1]"));
  for (const option of collision.options) assert.equal(collision.resolve(option.label)?.id, option.entity.id);
  const widthCollision = identityChoices([character("char_5", "A"), character("char_6", "Ａ")]);
  assert.equal(widthCollision.resolve("A"), undefined);
  assert.equal(widthCollision.resolve("Ａ"), undefined);
  for (const option of widthCollision.options) assert.equal(widthCollision.resolve(option.label)?.id, option.entity.id);
});

test("nickname questions expose semantic labels and backend binds only a known unique choice", () => {
  const entity = character("char_000001", "御坂美琴");
  const context = { blockId: "b0001", accepted: { nameCandidates: ["超电磁炮"] }, knownEntities: [entity] } as unknown as PatchContext;
  const questions = nameDetector.buildQuestions(context);
  assert.deepEqual(questions.find(question => question.key === "nick:超电磁炮")?.options, ["御坂美琴", "none"]);
  assert.ok(!JSON.stringify(questions).includes(entity.id));
  const answers = (value: string) => [{ key: "newname:超电磁炮", value: 0.01 }, { key: "nick:超电磁炮", value, confidence: 0.99 }];
  assert.deepEqual(nameDetector.applyAnswers(context, answers("御坂美琴")).proposals[0].payload, { entityId: entity.id, aliasText: "超电磁炮" });
  assert.equal(nameDetector.applyAnswers(context, answers(entity.id)).proposals.length, 0);
  assert.equal(nameDetector.applyAnswers(context, answers("御坂")).proposals.length, 0);
});
