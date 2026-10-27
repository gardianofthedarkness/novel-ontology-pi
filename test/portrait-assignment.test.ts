import { test } from "node:test";
import assert from "node:assert/strict";
import { access, chmod, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { albumAssign, portraitReadiness } from "../src/cli/commands/extract/portraitCommands.js";
import { bindPortraitsAtBirth, finalizePortraits, type PortraitRecord } from "../src/digger/intake/album/portraits.js";
import { initWorkspace } from "../src/ground/workspace/init.js";
import { bindWorkspaceSource } from "../src/ground/workspace/source.js";
import type { Entity } from "../src/ground/ontology/types.js";

const character: Entity = { id: "char_a", kind: "Character", names: [{ text: "御坂美琴", lang: "zh", kind: "canonical" }], properties: {}, confidence: 1 };
const orphan: PortraitRecord = { entityId: null, name: "御坂美琴", portrait: "assets/portraits/a.png", sourceIllustration: "ill_1", sourceAsset: "assets/plate.png", ocrText: "御坂美琴", ocrConfidence: 0.99, matchKind: "exact-line" };

async function fixture(context: { after: (fn: () => Promise<void>) => void }) {
  const parent = await mkdtemp(join(tmpdir(), "portrait-assignment-"));
  context.after(() => rm(parent, { recursive: true, force: true }));
  const workspace = join(parent, "novel");
  await initWorkspace(workspace);
  const input = join(parent, "input.txt");
  await writeFile(input, "Chapter 1\n\n御坂美琴走进了房间。\n");
  await bindWorkspaceSource(workspace, input);
  await writeFile(join(workspace, "ontology/entities.jsonl"), JSON.stringify(character) + "\n");
  const complete = async () => {
    await writeFile(join(workspace, "changesets/cs_b0001.json"), JSON.stringify({ id: "cs_b0001", status: "approved" }));
    await writeFile(join(workspace, "events.jsonl"), JSON.stringify({ event: { type: "changeset.applied", changesetId: "cs_b0001" } }) + "\n");
  };
  const album = async () => {
    await mkdir(join(workspace, "assets"));
    await writeFile(join(workspace, "ontology/illustrations.jsonl"), JSON.stringify({ id: "ill_1", asset: "assets/plate.png", kind: "plate" }) + "\n");
  };
  return { parent, workspace, complete, album };
}

async function interpreter(parent: string, ready: boolean, fail = false) {
  const path = join(parent, "test-python");
  await writeFile(path, `#!${process.execPath}
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join} from 'node:path';
if (process.env.WORK_LLM_API_KEY || process.env.TYPESAFE_API_KEY) process.exit(9);
if (!process.argv[2].endsWith('/tools/album-portraits/portraits.py')) process.exit(8);
if (process.argv.includes('--check')) { console.log(JSON.stringify({ready:${ready},missingPackages:${ready ? "[]" : "['pillow']"}})); }
else {
  if (${fail}) process.exit(4);
  const workspace = process.argv[3];
  mkdirSync(join(workspace,'assets/portraits'),{recursive:true});
  writeFileSync(join(workspace,'assets/portraits/a.png'),'test-crop');
  let records = '';
  try {records=readFileSync(join(workspace,'ontology/portraits.jsonl'),'utf8');} catch {}
  if (!records) writeFileSync(join(workspace,'ontology/portraits.jsonl'),JSON.stringify(${JSON.stringify(orphan)})+'\\n');
  console.log(JSON.stringify({created:records?0:1}));
}
`);
  await chmod(path, 0o700);
  return path;
}

test("portrait command waits for every block's audited application and an album", async (context) => {
  const { workspace, complete, album } = await fixture(context);
  const pending = await albumAssign(workspace, true);
  assert.equal("reason" in pending && pending.reason, "finish_volume_extraction_and_review");
  await complete();
  assert.equal((await portraitReadiness(workspace)).reason, "album_missing_use_matching_epub_intake");
  await album();
  assert.equal((await portraitReadiness(workspace)).ready, true);
  await writeFile(join(workspace, "events.jsonl"), "");
  assert.equal((await portraitReadiness(workspace)).ready, false);
  await assert.rejects(access(join(workspace, "ontology/portraits.jsonl")));
});

test("portrait preflight is read-only and reports missing optional dependencies", async (context) => {
  const { parent, workspace, complete, album } = await fixture(context);
  await complete(); await album();
  const env = { NOVEL_PORTRAIT_PYTHON: await interpreter(parent, false) };
  const result = await albumAssign(workspace, true, env);
  assert.equal(result.status, "setup_required");
  assert.equal((await albumAssign(workspace, false, env)).status, "setup_required");
  await assert.rejects(access(join(workspace, "ontology/portraits.jsonl")));
  await assert.rejects(access(join(workspace, "ontology/.portrait-assignment.lock")));
});

test("portrait workflow binds crops idempotently without models, secrets or canonical edits (test cropper)", async (context) => {
  const { parent, workspace, complete, album } = await fixture(context);
  await complete(); await album();
  const before = await readFile(join(workspace, "ontology/entities.jsonl"), "utf8");
  const env = { NOVEL_PORTRAIT_PYTHON: await interpreter(parent, true), NOVEL_HOST_VISION: "0", WORK_LLM_API_KEY: "not-forwarded", TYPESAFE_API_KEY: "not-forwarded" };
  assert.equal((await albumAssign(workspace, true, env)).status, "ready");
  const first = await albumAssign(workspace, false, env);
  assert.equal(first.status, "complete");
  assert.equal("bound" in first && first.bound, 1);
  assert.equal("pendingCharacters" in first && first.pendingCharacters, 0);
  assert.equal("visualFallbackAvailable" in first && first.visualFallbackAvailable, false);
  const portraits = await readFile(join(workspace, "ontology/portraits.jsonl"), "utf8");
  assert.equal(JSON.parse(portraits).entityId, character.id);
  assert.equal((await albumAssign(workspace, false, env)).status, "complete");
  assert.equal(await readFile(join(workspace, "ontology/portraits.jsonl"), "utf8"), portraits);
  assert.equal(await readFile(join(workspace, "ontology/entities.jsonl"), "utf8"), before);
});

test("portrait cropper failure and concurrent assignment fail closed", async (context) => {
  const { parent, workspace, complete, album } = await fixture(context);
  await complete(); await album();
  const env = { NOVEL_PORTRAIT_PYTHON: await interpreter(parent, true, true) };
  await assert.rejects(albumAssign(workspace, false, env), /cropper failed/);
  await assert.rejects(access(join(workspace, "ontology/.portrait-assignment.lock")));
  await writeFile(join(workspace, "ontology/.portrait-assignment.lock"), "existing");
  await assert.rejects(albumAssign(workspace, false, env), /EEXIST/);
  assert.equal(await readFile(join(workspace, "ontology/.portrait-assignment.lock"), "utf8"), "existing");
});

test("portrait binding only targets Characters and stale visual tasks are cleared", async (context) => {
  const portraits = [{ ...orphan }];
  assert.equal(bindPortraitsAtBirth([{ ...character, kind: "Location" }], portraits), 0);
  const { workspace } = await fixture(context);
  await writeFile(join(workspace, "ontology/portraits.jsonl"), JSON.stringify(orphan) + "\n");
  await writeFile(join(workspace, "ontology/portrait-tasks.jsonl"), "stale\n");
  await finalizePortraits(workspace, { entities: [character], mergedPairs: [], hostSupportsVisualInput: false });
  assert.equal(await readFile(join(workspace, "ontology/portrait-tasks.jsonl"), "utf8"), "");
});

test("portrait assignment rejects changed source and symlink metadata", async (context) => {
  const { parent, workspace, complete, album } = await fixture(context);
  await complete(); await album();
  await writeFile(join(workspace, "source/input.txt"), "changed");
  await assert.rejects(albumAssign(workspace, true), /Stored source changed/);
  const linked = join(parent, "linked");
  await mkdir(linked);
  await symlink(join(workspace, "ontology"), join(linked, "ontology"));
  await assert.rejects(albumAssign(linked, true), /symlink/);
});

test("an empty canonical cast is a no-op, not a cropper failure or dependency requirement", async (context) => {
  const { workspace, complete, album } = await fixture(context);
  await complete(); await album();
  await writeFile(join(workspace, "ontology/entities.jsonl"), "");
  const result = await albumAssign(workspace, false, { NOVEL_PORTRAIT_PYTHON: "/missing/python" });
  assert.equal(result.status, "complete");
  assert.equal("pendingCharacters" in result && result.pendingCharacters, 0);
  await assert.rejects(access(join(workspace, "ontology/portraits.jsonl")));
});
