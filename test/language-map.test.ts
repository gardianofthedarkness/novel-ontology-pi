import { test } from "node:test";
import assert from "node:assert/strict";
import {
  getLanguageMap,
  languageMapFromTable,
  listLanguageMaps,
  registerLanguageMap,
  resolveLanguageMap,
  setActiveLanguageMap,
  LANGUAGE_MAP_ENV,
} from "../src/text/languageMap.js";
import { foldVariants, formKey } from "../src/text/nameForms.js";

test("the registry ships the zh variant map as default plus an identity map", () => {
  const ids = listLanguageMaps().map((m) => m.id);
  assert.ok(ids.includes("zh-variants"), "zh-variants registered");
  assert.ok(ids.includes("identity"), "identity registered");
  assert.equal(resolveLanguageMap().id, "zh-variants", "default resolution");
  assert.equal(resolveLanguageMap("identity").fold("白井黒子"), "白井黒子");
});

test("an unknown map id fails loudly and names the registered maps", () => {
  assert.throws(() => getLanguageMap("no-such-map"), /zh-variants/);
  assert.throws(() => resolveLanguageMap("no-such-map"), /unknown language map/);
});

test("design code swaps maps without changing: explicit map argument", () => {
  // A toy one-entry table stands in for a future language situation.
  const toy = languageMapFromTable("toy-test-map", "Test-only fold.", { "X": "Y" });
  assert.equal(formKey("aXb", toy), "aYb", "formKey folds under the given map");
  assert.equal(foldVariants("白井黒子", toy), "白井黒子", "the toy map knows no CJK variants");
  assert.equal(
    formKey("白井黒子"),
    "白井黑子",
    "without an argument the active (zh) map still applies — call sites are unchanged",
  );
});

test("design code swaps maps without changing: programmatic + env selection", () => {
  const toy = registerLanguageMap(
    languageMapFromTable("toy-active-map", "Test-only fold.", { "黒": "黑" }),
  );
  try {
    setActiveLanguageMap(toy);
    assert.equal(formKey("白井黒子"), "白井黑子", "active override drives the facade");
    assert.equal(formKey("櫻井"), "櫻井", "…and only the toy table applies");

    setActiveLanguageMap(undefined);
    process.env[LANGUAGE_MAP_ENV] = "identity";
    assert.equal(resolveLanguageMap().id, "identity", "env selects the map");
    assert.equal(formKey("白井黒子"), "白井黒子", "identity map leaves spellings distinct");
  } finally {
    setActiveLanguageMap(undefined);
    delete process.env[LANGUAGE_MAP_ENV];
  }
  assert.equal(resolveLanguageMap().id, "zh-variants", "selection restores to the default");
});
