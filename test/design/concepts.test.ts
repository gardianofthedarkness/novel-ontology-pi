import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { CONCEPTS, LAYERS, STAGES } from "../../src/concepts.js";

// Run from the repository's root (npm test): every pointer of the concept map must still hold, or the map has gone stale.
// A design pointer (`docs/v3/design.html#<section> · <journal> §<heading>`) holds when the design has that section.
const holds = (pointer: string) => {
  const [file, text] = pointer.split("#"), path = resolve(process.cwd(), file);
  if (!existsSync(path)) return false;
  const body = readFileSync(path, "utf8");
  return file === "docs/v3/design.html" ? body.includes(`id="${text.split(" · ")[0]}"`) : body.includes(text);
};

test("the concept map holds: each concept in a layer, its code and its design where it says, what it builds on known", () => {
  const ids = new Set(CONCEPTS.map((concept) => concept.id));
  assert.equal(ids.size, CONCEPTS.length, "every id once");
  for (const concept of CONCEPTS) {
    assert.ok(LAYERS[concept.layer], `${concept.id}: a layer`);
    assert.ok(concept.lives.length && concept.docs.length, `${concept.id}: code and design`);
    for (const pointer of [...concept.lives, ...concept.docs]) assert.ok(holds(pointer), `${concept.id}: ${pointer} no longer holds`);
    for (const used of concept.uses ?? []) assert.ok(ids.has(used), `${concept.id}: builds on ${used}, which is not a concept`);
  }
});

test("the stages hold every layer once", () => {
  const layers = STAGES.flatMap((stage) => stage.layers);
  assert.deepEqual([...layers].sort(), Object.keys(LAYERS).sort(), "each layer in one stage");
});

// The design's sections written from the code (docs/v3/design.html §17.3, §17.4) must be what the code writes today.
test("the design's concept map and street compatibility sections are current", async () => {
  const { spawnSync } = await import("node:child_process");
  for (const script of ["engine/design/concepts-page.mjs", "engine/terrain/compat-page.mjs"]) {
    const run = spawnSync(process.execPath, [script, "--check"], { cwd: process.cwd(), encoding: "utf8" });
    assert.equal(run.status, 0, `run node ${script}: ${run.stdout}${run.stderr}`);
  }
});
