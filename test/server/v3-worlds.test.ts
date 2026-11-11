import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findWorlds } from "../../src/server/worlds.js";

async function library(root: string, books: Record<string, string[]>, accepted?: string): Promise<void> {
  await mkdir(join(root, "universe"), { recursive: true });
  for (const [book, runs] of Object.entries(books)) {
    for (const run of runs) await mkdir(join(root, book, "novel", "stage", "director", "runs", run), { recursive: true });
    await mkdir(join(root, book, "novel", "stage", "simulation"), { recursive: true });
    if (accepted) await writeFile(join(root, book, "novel", "stage", "simulation", "index.json"), JSON.stringify({ strands: { director: { accepted } } }));
  }
}

test("worlds: libraries in a folder up to two levels down, books in volume order, read only unless the console made them", async () => {
  const folder = await mkdtemp(join(tmpdir(), "v3-worlds-"));
  await library(join(folder, "hosts", "lib-a"), { "vol-2": ["d20260101000000"], "vol-1": ["d20250101000000", "d20250102000000"] }, "d20250102000000");
  await library(join(folder, ".novel", "worlds", "made"), { "vol-1": [] });
  await mkdir(join(folder, "deep", "er", "still", "universe"), { recursive: true });
  await mkdir(join(folder, "not-a-world", "vol-1"), { recursive: true });
  const worlds = await findWorlds(folder);
  assert.deepEqual(worlds.map((world) => [world.name, world.readOnly]), [["made", false], ["lib-a", true]]);
  const a = worlds.find((world) => world.name === "lib-a")!;
  assert.deepEqual(a.books.map((book) => [book.book, book.runs.length]), [["vol-1", 2], ["vol-2", 1]]);
  assert.equal(a.books[0].accepted, "d20250102000000");
  // A library opened as the folder itself.
  assert.deepEqual((await findWorlds(join(folder, "hosts", "lib-a"))).map((world) => world.name), ["lib-a"]);
});
