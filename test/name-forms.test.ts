import { test } from "node:test";
import assert from "node:assert/strict";
import { foldVariants } from "../src/ground/language/nameForms.js";
import { nominateMatchCandidates } from "../src/solidifier/matching/entityMatch.js";
import type { Entity } from "../src/ground/ontology/types.js";

test("variant fold: shinjitai and traditional forms share one key", () => {
  assert.equal(foldVariants("白井黒子"), "白井黑子");
  assert.equal(foldVariants("櫻井"), "樱井");
  assert.equal(foldVariants("渡邊"), "渡边");
  assert.equal(foldVariants("齊藤"), "齐藤");
  assert.equal(foldVariants("廣瀨"), "广濑");
  assert.equal(foldVariants("陸八魔亞瑠"), "陆八魔亚瑠");
  assert.equal(foldVariants("Anna Sprengel"), "Anna Sprengel", "Latin untouched");
  assert.equal(foldVariants("御坂美琴"), "御坂美琴", "already-canonical unchanged");
});

test("variant fold is idempotent", () => {
  for (const s of ["白井黒子", "櫻井", "陸八魔亞瑠", "國木田独歩"]) {
    assert.equal(foldVariants(foldVariants(s)), foldVariants(s));
  }
});

test("match nomination catches variant pairs beyond the old hand table", () => {
  const mk = (id: string, text: string): Entity => ({
    id,
    kind: "Character",
    names: [{ text, lang: "zh", kind: "canonical" }],
    properties: {},
    confidence: 1,
  });
  const pairs = nominateMatchCandidates([
    mk("char_000001", "櫻井"),
    mk("char_000002", "樱井"),
    mk("char_000003", "御坂美琴"),
  ]);
  assert.equal(pairs.length, 1);
  assert.match(pairs[0].reasons.join(" "), /script-variant/);
});
