import { test } from "node:test";
import assert from "node:assert/strict";
import { linkReading, putBook, scanFolder, universeAdd } from "../src/v3/folder.js";
import { worldView } from "../src/v3/world.js";
import { NovelWorkspace } from "../src/v3/workspace.js";
import { shelf } from "./v3-fixture.js";

test("a book's world: scenes with who is present where, its places and its strands, from the reading alone", async () => {
  const { folder, one } = await shelf();
  await scanFolder(folder); await universeAdd(folder, "The Lighthouse"); await putBook(folder, "keeper-1.txt", "the-lighthouse"); await linkReading(folder, "keeper-1.txt", one.novel);
  const world = await worldView(new NovelWorkspace(folder), "keeper-1.txt");
  assert.equal(world.scenes.length, 5);
  assert.ok(world.scenes.some((scene) => scene.present.includes("char_000001")), "Mara is present somewhere");
  assert.ok(world.strands.length >= 1, "at least one strand");
  for (const scene of world.scenes) assert.ok(scene.strand === null || world.strands.some((strand) => strand.id === scene.strand), "a scene's strand is one of the strands");
  assert.equal(world.movables.char_000001[0], "Mara"); assert.equal(world.movables.char_000001[1], "person");
  assert.ok(Array.isArray(world.places) && Array.isArray(world.time));
  assert.equal(await worldView(new NovelWorkspace(folder), "keeper-1.txt").then((again) => again.scenes.length), 5);
  await assert.rejects(worldView(new NovelWorkspace(folder), "keeper-2.txt"), /no reading/);
});

test("the console's search: lines that hold the words, and the names that hold them", async () => {
  const { NovelServer } = await import("../src/v3/server.js");
  const { folder, one } = await shelf();
  await scanFolder(folder); await universeAdd(folder, "The Lighthouse"); await putBook(folder, "keeper-1.txt", "the-lighthouse"); await linkReading(folder, "keeper-1.txt", one.novel);
  const server = new NovelServer(folder);
  const found = await server.handle("novel/search", { id: "keeper-1.txt", query: "rope" }) as { total: number; lines: { line: string; text: string; chapterTitle: string }[]; names: unknown[] };
  assert.equal(found.total, 2); assert.ok(found.lines.every((hit) => /rope/i.test(hit.text)));
  assert.equal(found.lines[0].chapterTitle, "Chapter 2 The Storm");
  const named = await server.handle("novel/search", { id: "keeper-1.txt", query: "reyes" }) as { names: { label: string }[] };
  assert.deepEqual(named.names.map((name) => name.label), ["Captain Reyes"]);
  assert.deepEqual(await server.handle("novel/search", { id: "keeper-1.txt", query: "  " }), { query: "", total: 0, lines: [], names: [] });
});
