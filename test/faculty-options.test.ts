import { test } from "node:test";
import assert from "node:assert/strict";
import { facultyOptionsFromEnv } from "../src/digger/processing/facultyOptions.js";
import { ingestNovel } from "../src/cli/commands/extract/ingestCommands.js";
import { runRecall } from "../src/cli/commands/extract/recallCommands.js";

test("CLI faculty scope defaults to dialogue cards and retains explicit historical modes", () => {
  assert.deepEqual(facultyOptionsFromEnv({}), { dialogueScope: "card" });
  assert.deepEqual(facultyOptionsFromEnv({ NOVEL_DIALOGUE_SCOPE: "card" }), { dialogueScope: "card" });
  assert.deepEqual(facultyOptionsFromEnv({ NOVEL_DIALOGUE_SCOPE: "scene" }), { dialogueScope: "scene" });
  assert.deepEqual(facultyOptionsFromEnv({ NOVEL_DIALOGUE_SCOPE: " block-turn " }), { dialogueScope: "block-turn" });
  assert.throws(() => facultyOptionsFromEnv({ NOVEL_DIALOGUE_SCOPE: "invalid" }), /NOVEL_DIALOGUE_SCOPE/);
});

test("ingest and recall validate faculty scope before any workspace writes or calls", async () => {
  const env = { NOVEL_DIALOGUE_SCOPE: "invalid" };
  await assert.rejects(ingestNovel("/not-a-workspace", "/not-a-source", { env }), /NOVEL_DIALOGUE_SCOPE/);
  await assert.rejects(runRecall("/not-a-workspace", "b0001", { env }), /NOVEL_DIALOGUE_SCOPE/);
});
