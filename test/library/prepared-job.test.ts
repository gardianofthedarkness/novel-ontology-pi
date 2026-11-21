// Two books prepared by story-graph's library (one world, equal local block ids) make one Pi job of two volumes
// (tools/pi-review/job.mjs): the job reads the prepared workspaces as they are.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { libraryAdd, libraryInit, libraryPrepare } from "story-graph/dist/src/ground/workspace/library.js";

test("two prepared books make one Pi job of two volumes", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "novel-job-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = join(root, "library");
  await libraryInit(library);
  const sources = [];
  for (const [index, content] of ["World One, volume 1. Chapter 1\nA leaves home.", "World One, volume 2. Chapter 1\nA comes home."].entries()) {
    const file = join(root, `volume-${index + 1}.txt`);
    await writeFile(file, content);
    sources.push((await libraryAdd(library, file)).source);
  }
  const prepared = [await libraryPrepare(library, sources[0].id), await libraryPrepare(library, sources[1].id)];
  const { parseJob } = await import(pathToFileURL(join(process.cwd(), "tools/pi-review/job.mjs")).href);
  const job = parseJob({ volumes: prepared.map((entry, index) => ({ id: index + 1, input: entry.input, workspace: entry.workspace })) }, library);
  assert.equal(job.volumes.length, 2);
});
