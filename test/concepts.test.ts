import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { test } from "node:test";
import { CONCEPTS, LAYERS } from "../src/v2/concepts.js";

// Run from the repository's root (npm test): every pointer of the concept map must still hold, or the map has gone stale.
const holds = (pointer: string) => { const [file, text] = pointer.split("#"), path = resolve(process.cwd(), file); return existsSync(path) && readFileSync(path, "utf8").includes(text); };

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
