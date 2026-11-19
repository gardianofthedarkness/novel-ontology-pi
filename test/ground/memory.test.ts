import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LadybugStore } from "../../src/ground/connectors/ladybug.js";
import { indexMemories, recall, type MemoryRecord } from "../../src/ground/ontology/memory.js";

// Made-up memories of one person (a), nothing from any book.
const mem = (id: string, branchId: string, kind: MemoryRecord["kind"], source: MemoryRecord["source"], at: number,
  learned: number, summaryEn: string, arousal: number, valence: number, relevance: number, central: number,
  confidence: number, cues: string[], heardFromId?: string): MemoryRecord => ({
  id, holderId: "a", branchId, kind, source, atOrder: at, learnedOrder: learned, summaryEn, arousal, valence, relevance,
  central, confidence, cues, evidence: [`s_${id}`], ...(heardFromId ? { heardFromId } : {}),
});
const MEMORIES = [
  mem("m1", "canon", "episode", "did", 5, 5, "met b at the cafe, small talk", 0.1, 0.3, 0.3, 1, 1, ["b", "cafe"]),
  mem("m2", "canon", "episode", "did", 10, 10, "b lied about the key", 0.2, -0.2, 0.6, 1, 1, ["b"]),
  mem("m3", "canon", "episode", "did", 20, 20, "b attacked a at the station", 0.95, -0.9, 0.9, 1, 1, ["b", "station"]),
  mem("m4", "canon", "episode", "saw", 20, 20, "a poster on the station wall", 0.95, -0.9, 0.1, 0, 1, ["station", "poster"]),
  mem("m5", "canon", "episode", "saw", 21, 21, "a pigeon at the cafe", 0.05, 0, 0, 1, 1, ["cafe"]),
  mem("m6", "canon", "belief", "told", 8, 35, "c says b took the key at night", 0.5, -0.5, 0.7, 1, 0.6, ["b", "c"], "c"),
  mem("m7", "canon", "episode", "did", 50, 50, "b apologised", 0.6, 0.6, 0.8, 1, 1, ["b"]),
  mem("m8", "b1", "episode", "did", 32, 32, "on the branch, a followed b to the cafe", 0.5, -0.3, 0.7, 1, 1, ["b", "cafe"]),
  mem("m9", "b2", "episode", "did", 33, 33, "on another branch, a left the city", 0.7, -0.4, 0.8, 1, 1, ["station"]),
];

async function withStore(fn: (store: LadybugStore) => Promise<void>): Promise<void> {
  const dir = await mkdtemp(join(tmpdir(), "memory-test-"));
  const store = new LadybugStore(join(dir, "g.lbug"));
  try {
    await store.initSchema();
    for (const id of ["a", "b", "c"]) await store.run(`CREATE (:Character {id: $id, canonical_name: $id, importance: 1.0})`, { id });
    for (const id of ["cafe", "station"]) await store.run(`CREATE (:Location {id: $id, canonical_name: $id})`, { id });
    await store.run(`CREATE (:Item {id: 'poster', canonical_name: 'poster'})`);
    await indexMemories((c, p) => store.run(c, p), MEMORIES);
    await fn(store);
  } finally {
    await store.close();
    await rm(dir, { recursive: true, force: true });
  }
}
const ids = (rows: { id: string }[]) => rows.map((r) => r.id);

test("recall walls off later memories and other branches", async () => {
  await withStore(async (store) => {
    const run = (c: string, p?: Record<string, unknown>) => store.run(c, p);
    const at15 = ids(await recall(run, { holderId: "a", lineage: [["canon", 15]], cues: ["b"] }));
    assert.deepEqual(at15.sort(), ["m1", "m2"]);
    const at40 = ids(await recall(run, { holderId: "a", lineage: [["canon", 40]], cues: ["b"] }));
    assert.ok(at40.includes("m6"), "told at 35, known at 40");
    assert.ok(!at40.includes("m7") && !at40.includes("m8") && !at40.includes("m9"));
    const b1 = ids(await recall(run, { holderId: "a", lineage: [["canon", 30], ["b1", 40]], cues: ["b"] }));
    assert.ok(b1.includes("m8") && !b1.includes("m6") && !b1.includes("m9"), "canon's after the fork is not the branch's");
  });
});

test("recall ranks by arousal, cues, the peripheral trade-off and retroactive tagging", async () => {
  await withStore(async (store) => {
    const run = (c: string, p?: Record<string, unknown>) => store.run(c, p);
    const byB = await recall(run, { holderId: "a", lineage: [["canon", 40]], cues: ["b"] });
    assert.equal(byB[0].id, "m3", "the arousing one first");
    const at = (rows: typeof byB, id: string) => rows.find((r) => r.id === id)!;
    assert.ok(at(byB, "m1").tag > 0 && at(byB, "m5").tag === 0, "the later attack tags earlier memories of b, not the pigeon");
    const at15 = await recall(run, { holderId: "a", lineage: [["canon", 15]], cues: ["b"] });
    assert.equal(at(at15, "m1").tag, 0, "no tag from an attack that has not happened yet");
    // The poster and the attack share the moment and the arousal; the poster, a peripheral detail, has faded more.
    assert.ok(at(byB, "m4").retention < at(byB, "m3").retention);
    const byStation = await recall(run, { holderId: "a", lineage: [["canon", 40]], cues: ["station"] });
    assert.ok(at(byStation, "m4").score > at(byB, "m4").score, "a cue brings the detail back");
    const angry = await recall(run, { holderId: "a", lineage: [["canon", 40]], cues: ["b"], mood: -1 });
    assert.ok(at(angry, "m6").score > at(byB, "m6").score, "mood-congruent recall");
    // The felt arousal fades slowly with age; the stored one keeps setting how fast the memory itself fades.
    assert.ok(at(byB, "m3").felt < 0.95 && at(byB, "m3").felt > 0.9);
    const later = await recall(run, { holderId: "a", lineage: [["canon", 40]], cues: ["b"], nowTime: 400 });
    assert.ok(at(later, "m3").felt < at(byB, "m3").felt && at(later, "m3").retention < at(byB, "m3").retention, "age is measured on story time when given");
  });
});
