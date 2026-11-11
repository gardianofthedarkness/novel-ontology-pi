import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  changesSince, classify, exportSnapshot, importBundle, latestSnapshot, libraryOf, libraryPaths, readIndex, restoreSnapshot, takeSnapshot,
} from "../../src/ground/workspace/universe.js";

const put = async (root: string, rel: string, text: string) => { await mkdir(join(root, rel, ".."), { recursive: true }); await writeFile(join(root, rel), text); };
const read = (root: string, rel: string) => readFile(join(root, rel), "utf8");

/** A small library: the universe, one book with its ontology, world state, a run's files, a cache and its text. */
async function library(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "universe-"));
  await put(root, "universe/pools.json", "{\"pools\":1}");
  await put(root, "universe/terrain.json", "{\"t\":1}");
  await put(root, "vol-1/novel/source/source.txt", "the book's text");
  await put(root, "vol-1/novel/ontology/source.json", JSON.stringify({ sha256: createHash("sha256").update("the book's text").digest("hex") }));
  await put(root, "vol-1/novel/ontology/scenes.jsonl", "{\"id\":\"s1\"}\n");
  await put(root, "vol-1/novel/stage/world/spawn.json", "{\"spawn\":1}");
  await put(root, "vol-1/reading/data.json", "{\"reading\":1}");
  return root;
}

/** What a run leaves: canon rows, its outputs, its own files, a cache. */
async function playRun(root: string, run: string) {
  await put(root, "vol-1/novel/ontology/scenes.jsonl", `{"id":"s1"}\n{"id":"s1","world":{"run":"${run}"}}\n`);
  await put(root, "vol-1/novel/stage/world/canon.jsonl", `{"run":"${run}","at":"t","file":"scenes.jsonl","id":"s1"}\n`);
  await put(root, "vol-1/novel/stage/director/run.json", `{"run":"${run}"}`);
  await put(root, "vol-1/novel/stage/simulation/index.json", JSON.stringify({ strands: { director: { runs: [{ id: run }], accepted: run } } }));
  await put(root, `vol-1/novel/stage/world/smoothed/${run}.json`, "{\"smoothed\":1}");
  await put(root, `vol-1/novel/stage/world/log/${run}.jsonl`, "{}\n");
  await put(root, `vol-1/novel/stage/simulation/runs/director/${run}.page.json`, "{\"page\":1}");
  await put(root, "vol-1/novel/stage/director/cache/answer.json", "{\"cached\":1}");
}

test("classify: state, a run's files, derived, the text", () => {
  assert.equal(classify("vol-1/novel/stage/world/spawn.json").kind, "state");
  assert.equal(classify("universe/terrain.json").kind, "state");
  assert.deepEqual(classify("vol-1/novel/stage/world/smoothed/d20261105013948.json"), { kind: "run", run: "d20261105013948" });
  assert.deepEqual(classify("vol-1/novel/stage/world/restrand/d20261105013948.json"), { kind: "run", run: "d20261105013948" }, "a run's strands (M17d)");
  assert.deepEqual(classify("vol-1/novel/stage/director/runs/d20261105013948/workflow.json"), { kind: "run", run: "d20261105013948" });
  assert.deepEqual(classify("vol-1/novel/stage/simulation/runs/director/d1.page.json"), { kind: "run", run: "d1" });
  for (const rel of ["vol-1/novel/ontology/graph.lbug", "vol-1/novel/stage/director/cache/x.json", "vol-1/novel/stage/director/shots/a.png", "vol-1/novel/stage/simulation/live/page.json", "vol-1/novel/stage/simulation/live.json"]) assert.equal(classify(rel).kind, "derived", rel);
  assert.equal(classify("vol-1/novel/source/source.txt").kind, "source");
  // The book's album is the book's, as its text is: not a run's state.
  for (const rel of ["vol-1/novel/assets/ill_0009.jpg", "vol-1/novel/assets/portraits/a.png", "vol-1/novel/ontology/illustrations.jsonl", "vol-1/novel/ontology/album.json", "vol-1/novel/ontology/portraits.jsonl", "vol-1/reading/album/assets/ill_0001.jpg", "vol-1/reading/album/ontology/illustrations.jsonl", "vol-1/reading/front.json", "universe/faces/vol-1-ill_0012-B.png", "universe/faces/faces.json"]) assert.equal(classify(rel).kind, "source", rel);
  assert.equal(classify("vol-1/reading/data.json").kind, "state");
  assert.equal(classify("vol-1/novel/ontology/entities.jsonl").kind, "state");
});

test("libraryOf finds the library and the book from a novel folder", async () => {
  const root = await library();
  try {
    assert.deepEqual(libraryOf(join(root, "vol-1", "novel")), { root, book: "vol-1" });
    assert.deepEqual(libraryOf(root), { root, book: null });
    assert.equal(libraryPaths(root).book("vol-1").world.smoothed("d1"), join(root, "vol-1/novel/stage/world/smoothed/d1.json"));
    assert.equal(libraryPaths(root).book("vol-1").world.restrand("d1"), join(root, "vol-1/novel/stage/world/restrand/d1.json"));
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a rerun's restore: back to the before, the run's leftovers gone, nothing lost", async () => {
  const root = await library();
  try {
    const before = await takeSnapshot(root, { book: "vol-1", kind: "before", why: "first run" });
    assert.ok(!Object.keys(before.files).some(rel => rel.includes("source.txt")), "the text is never tracked");
    await playRun(root, "d1");
    const after = await takeSnapshot(root, { book: "vol-1", kind: "after", run: "d1", parent: before.id, why: "run d1" });
    assert.deepEqual(after.books["vol-1"], { accepted: "d1", runs: ["d1"], canon: ["d1"], source: before.books["vol-1"].source });
    assert.deepEqual(after.runs.d1.sort(), ["vol-1/novel/stage/simulation/runs/director/d1.page.json", "vol-1/novel/stage/world/log/d1.jsonl", "vol-1/novel/stage/world/smoothed/d1.json"]);
    assert.deepEqual(await changesSince(root, after.id), []);

    const done = await restoreSnapshot(root, before.id, { graph: false });
    assert.equal(await read(root, "vol-1/novel/ontology/scenes.jsonl"), "{\"id\":\"s1\"}\n");
    for (const rel of ["vol-1/novel/stage/director/run.json", "vol-1/novel/stage/world/canon.jsonl", "vol-1/novel/stage/simulation/index.json"]) assert.ok(!existsSync(join(root, rel)), `${rel} set aside`);
    // A run's own files and the caches stay (named by id, never read without the pointers just restored).
    assert.ok(existsSync(join(root, "vol-1/novel/stage/world/smoothed/d1.json")));
    assert.ok(existsSync(join(root, "vol-1/novel/stage/director/cache/answer.json")));
    assert.deepEqual(await changesSince(root, before.id), []);
    // The guard holds what the restore replaced: restoring it brings the run back.
    assert.ok(done.guard);
    await restoreSnapshot(root, done.guard!, { graph: false });
    assert.equal(await read(root, "vol-1/novel/stage/director/run.json"), "{\"run\":\"d1\"}");
    assert.equal((await latestSnapshot(root, { book: "vol-1", kind: "before" }))?.id, before.id);
    assert.deepEqual((await readIndex(root)).snapshots.map(entry => entry.kind), ["before", "after", "guard", "guard"]);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("a run's result goes to another user: export, import with their own copy of the book", async () => {
  const root = await library(), other = await mkdtemp(join(tmpdir(), "universe-other-"));
  try {
    const before = await takeSnapshot(root, { book: "vol-1", kind: "before", why: "first run" });
    await playRun(root, "d1");
    const after = await takeSnapshot(root, { book: "vol-1", kind: "after", run: "d1", parent: before.id, why: "run d1" });
    const bundle = join(other, "shared.tgz");
    const packed = await exportSnapshot(root, after.id, bundle);
    assert.deepEqual(packed.snapshots, [before.id, after.id]);
    assert.equal(packed.runFiles, 2, "the run's log and smoothing; its page only with --pages");

    const theirs = join(other, "their-library"), text = join(other, "my-copy.txt");
    await writeFile(text, "the book's text");
    const wrong = join(other, "another-book.txt");
    await writeFile(wrong, "another book");
    await assert.rejects(importBundle(bundle, join(other, "refused"), { sources: { "vol-1": wrong } }), /not the text vol-1 was made from/);
    const imported = await importBundle(bundle, theirs, { sources: { "vol-1": text } });
    assert.equal(imported.snapshots.length, 2);
    assert.equal(await read(theirs, "vol-1/novel/stage/director/run.json"), "{\"run\":\"d1\"}");
    assert.equal(await read(theirs, "vol-1/novel/stage/world/smoothed/d1.json"), "{\"smoothed\":1}");
    assert.equal(await read(theirs, "vol-1/novel/source/source.txt"), "the book's text");
    assert.ok(!existsSync(join(theirs, "vol-1/novel/stage/director/cache")), "caches are not shared");
    // Their library can rerun the book: its before came along.
    const theirBefore = await latestSnapshot(theirs, { book: "vol-1", kind: "before" });
    assert.ok(theirBefore);
    await restoreSnapshot(theirs, theirBefore!.id, { graph: false });
    assert.ok(!existsSync(join(theirs, "vol-1/novel/stage/director/run.json")));
  } finally { await rm(root, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); }
});

test("a bundle cannot write outside the library", async () => {
  const root = await library(), other = await mkdtemp(join(tmpdir(), "universe-bad-"));
  try {
    const made = await takeSnapshot(root, { book: "vol-1", kind: "before", why: "x" });
    const folder = join(other, "bad");
    await exportSnapshot(root, made.id, folder);
    const manifest = JSON.parse(await readFile(join(folder, "bundle.json"), "utf8"));
    const [first] = Object.values(manifest.snapshots[0].files);
    manifest.snapshots[0].files["../escape.json"] = first;
    await writeFile(join(folder, "bundle.json"), JSON.stringify(manifest));
    await assert.rejects(importBundle(folder, join(other, "lib")), /outside a library/);
  } finally { await rm(root, { recursive: true, force: true }); await rm(other, { recursive: true, force: true }); }
});

test("a library restored by hand to an older snapshot stands at a known state, not at edits", async () => {
  const { matchingSnapshot } = await import("../../src/ground/workspace/universe.js");
  const root = await library();
  try {
    const before = await takeSnapshot(root, { book: "vol-1", kind: "before", why: "first run" });
    await playRun(root, "d1");
    const after = await takeSnapshot(root, { book: "vol-1", kind: "after", run: "d1", parent: before.id, why: "d1" });
    await restoreSnapshot(root, before.id, { graph: false });
    await playRun(root, "d2");
    await takeSnapshot(root, { book: "vol-1", kind: "after", run: "d2", parent: before.id, why: "d2" });
    await restoreSnapshot(root, after.id, { graph: false });
    // The newest snapshot with the same files (a guard that held d1's state counts as well as d1's own after).
    const at = await matchingSnapshot(root);
    assert.ok(at);
    assert.equal((await readIndex(root)).snapshots.find(entry => entry.id === at)!.digest, after.digest);
    await put(root, "universe/terrain.json", "{\"t\":2}");
    assert.equal(await matchingSnapshot(root), null);
  } finally { await rm(root, { recursive: true, force: true }); }
});
