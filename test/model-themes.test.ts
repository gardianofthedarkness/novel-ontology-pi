import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { otherKeys, SWITCH_THEME, themedKeys, themedModel, type ModelThemes } from "../apps/playground/src/data/modelThemes.js";

const themes = JSON.parse(readFileSync(new URL("../../apps/playground/src/data/modelThemes.json", import.meta.url), "utf8")) as ModelThemes;
const all = Object.keys(themes.models);

test("a thing takes the theme of the manifold under it: a windmill on modern ground is the tall wind turbine, on ancient ground the old windmill", () => {
  assert.equal(themedModel(themes, "windmill", "modern"), "wind-turbine");
  assert.equal(themedModel(themes, "windmill", "ancient"), "windmill");
  assert.equal(themedModel(themes, "wind-turbine", "ancient"), "windmill");
  assert.equal(themedModel(themes, "windmill", "scifi"), "wind-turbine-scifi");
  assert.equal(themedModel(themes, "fountain", "ancient"), "fountain", "a model of any theme stays itself");
  assert.equal(themedModel(themes, "wagon", "modern"), "wagon", "no modern cart in the library: the wagon stays");
  assert.ok(themes.categories["tall-building"].modern!.includes(themedModel(themes, "keep", "modern", "a")!), "a keep on modern ground is one of the modern tall buildings");
});

test("Jev is offered fewer, more precise models: the theme's own and those of any theme, with switching theme last; switching offers the others", () => {
  const modern = themedKeys(themes, all, "modern"), ancient = themedKeys(themes, all, "ancient");
  assert.ok(modern.includes("wind-turbine") && !modern.includes("windmill") && !modern.includes("wagon") && modern.includes("fountain"));
  assert.ok(ancient.includes("windmill") && ancient.includes("wagon") && !ancient.includes("wind-turbine") && !ancient.some((key) => key.startsWith("skyscraper")));
  assert.ok(otherKeys(themes, all, "modern").includes("windmill") && otherKeys(themes, all, "modern").includes("wind-turbine-scifi") && !otherKeys(themes, all, "modern").includes("fountain"));
  assert.equal(SWITCH_THEME, "switch-theme");
});
