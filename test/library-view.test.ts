import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { libraryAdd, libraryDecide, libraryInit, libraryPropose, libraryShow, libraryView } from "../src/ground/workspace/library.js";

export async function libraryViewFixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "library-live-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "library");
  await libraryInit(directory);
  const sources = [];
  for (const index of [1, 2]) {
    const file = join(root, `星空 第${index}卷.txt`);
    await writeFile(file, `PRIVATE_STORY_${index} 第一章 旅程。`);
    sources.push((await libraryAdd(directory, file)).source);
  }
  const evidence = (sourceId: string, index: number) => [{ sourceId, field: "text", offset: 0, quote: `PRIVATE_STORY_${index}` }];
  const organization = {
    universes: [{ id: "world", title: "世界", evidence: evidence(sources[0].id, 1) }],
    continuities: [{ id: "canon", title: "正史", universeId: "world", evidence: evidence(sources[0].id, 1) }],
    series: [{ id: "stars", title: "星空", evidence: evidence(sources[0].id, 1) }],
    assignments: sources.map((source, index) => ({ sourceId: source.id, seriesId: "stars", continuityId: "canon", readingOrder: index + 1, status: "confirmed", evidence: evidence(source.id, index + 1), note: "PRIVATE_NOTE" })),
  };
  return { root, directory, sources, organization };
}

test("durable proposals and decisions project safe live events and ghost states without private evidence", async (t) => {
  const { root, directory, organization } = await libraryViewFixture(t);
  const before = await libraryView(directory);
  assert.equal(before.plans.length, 0);
  const revision = (await libraryShow(directory)).revision;
  const proposed = await libraryPropose(directory, organization, revision);
  const pending = await libraryView(directory);
  assert.equal(pending.revision, revision);
  assert.equal(pending.plans[0].state, "proposed");
  assert.equal(pending.events.filter(event => event.type === "library.plan.proposed").length, 1);
  await libraryPropose(directory, organization, revision);
  assert.deepEqual((await libraryView(directory)).events, pending.events);
  await libraryDecide(directory, proposed.planId, proposed.revision, "approve", "PRIVATE_REASON");
  const approved = await libraryView(directory);
  assert.equal(approved.plans.length, 0);
  assert.equal(approved.organization.series[0].title, "星空");
  assert.equal(approved.events.at(-1)?.type, "library.plan.approved");
  assert.equal(approved.totalEvents, 4);
  assert.deepEqual((await libraryView(directory)).events, approved.events);
  const raw = JSON.stringify(approved);
  for (const forbidden of [root, "PRIVATE_STORY", "PRIVATE_NOTE", "PRIVATE_REASON", '"evidence"', '"workspace"']) assert.ok(!raw.includes(forbidden), forbidden);
});

test("held proposals remain distinct; rejection and stale pending plans cannot appear as accepted organization", async (t) => {
  const { root, directory, organization } = await libraryViewFixture(t);
  const pending = await libraryPropose(directory, organization, (await libraryShow(directory)).revision);
  await libraryDecide(directory, pending.planId, pending.revision, "hold", "Need more evidence.");
  assert.equal((await libraryView(directory)).plans[0].state, "held");
  assert.equal((await libraryView(directory)).organization.series.length, 0);
  const next = await libraryPropose(directory, organization, (await libraryShow(directory)).revision);
  await libraryDecide(directory, next.planId, next.revision, "reject", "Unsupported.");
  assert.equal((await libraryView(directory)).plans.length, 0);
  await libraryPropose(directory, organization, (await libraryShow(directory)).revision);
  const extra = join(root, "extra.txt");
  await writeFile(extra, "Another source");
  await libraryAdd(directory, extra);
  assert.equal((await libraryView(directory)).plans.length, 0);
});
