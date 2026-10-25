import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  libraryAdd, libraryDecide, libraryEvidence, libraryHistory, libraryInit,
  libraryPlan, libraryPrepare, libraryPropose, libraryShow, type LibraryOrganization,
} from "../src/ground/workspace/library.js";
import { recallSourceBlock } from "../src/ground/workspace/source.js";
import { createZip } from "../src/digger/intake/album/zip.js";

const execute = promisify(execFile);
const epub = () => createZip([
  { name: "META-INF/container.xml", data: Buffer.from('<container><rootfile full-path="content.opf"/></container>') },
  { name: "content.opf", data: Buffer.from('<package><metadata><dc:title>同一世界 第一卷</dc:title></metadata><manifest><item id="body" href="body.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="body"/></spine></package>') },
  { name: "body.xhtml", data: Buffer.from('<html><body><h1>第一章 出发</h1><p>这本书属于同一世界。</p><p>明天再见。</p></body></html>') },
]);

async function fixture(t: { after: (fn: () => Promise<void>) => void }) {
  const root = await mkdtemp(join(tmpdir(), "novel-library-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const library = join(root, "library");
  await libraryInit(library);
  const entries = [];
  for (const [index, content] of ["同一世界 第一卷。第一章\n小明出门。", "同一世界 第二卷。第一章\n小明回家。", "另一世界。第一章\n也有一个小明。"].entries()) {
    const file = join(root, `volume-${index + 1}.txt`);
    await writeFile(file, content);
    entries.push(await libraryAdd(library, file));
  }
  const sources = entries.map((entry) => entry.source);
  const evidence = (index: number) => [{ sourceId: sources[index].id, field: "text" as const, offset: 0, quote: index === 2 ? "另一世界" : "同一世界" }];
  const plan: LibraryOrganization = {
    universes: [{ id: "shared", title: "同一世界", evidence: evidence(0) }, { id: "other", title: "另一世界", evidence: evidence(2) }],
    continuities: [{ id: "main", universeId: "shared", title: "正史", evidence: evidence(0) }, { id: "unrelated", universeId: "other", title: "正史", evidence: evidence(2) }],
    series: [{ id: "series", title: "同一世界", evidence: evidence(0) }, { id: "different", title: "另一故事", evidence: evidence(2) }],
    assignments: sources.map((source, index) => ({ sourceId: source.id, seriesId: index === 2 ? "different" : "series", continuityId: index === 2 ? "unrelated" : "main",
      readingOrder: index === 2 ? 1 : index + 1, status: "confirmed", evidence: evidence(index), note: "根据原文和卷次；不是故事时间。" })),
  };
  const planFile = join(root, "organization.json");
  await writeFile(planFile, JSON.stringify(plan));
  const propose = async (body = plan) => {
    await writeFile(planFile, JSON.stringify(body));
    return libraryPropose(library, planFile, (await libraryShow(library)).revision);
  };
  return { root, library, sources, plan, planFile, propose };
}

test("registration deduplicates bytes and does not infer grouping from matching names", async (t) => {
  const { root, library, sources } = await fixture(t);
  const before = await libraryShow(library);
  assert.equal(before.unresolved, 3);
  assert.deepEqual(before.organization.series, []);
  const alias = join(root, "renamed.txt");
  await writeFile(alias, "同一世界 第一卷。第一章\n小明出门。");
  const duplicate = await libraryAdd(library, alias);
  assert.equal(duplicate.status, "already_registered");
  assert.equal(duplicate.source.id, sources[0].id);
  assert.equal(duplicate.revision, before.revision);
  await assert.rejects(libraryAdd(library, alias, "different label"), /relabel/);
  await assert.rejects(libraryInit(library), /EEXIST/);
});

test("organization is proposed then independently approved, scoped and source qualified", async (t) => {
  const { library, sources, propose } = await fixture(t);
  const pending = await propose();
  assert.equal((await libraryShow(library)).unresolved, 3);
  assert.equal(pending.status, "pending_review");
  assert.equal((await libraryPlan(library, pending.planId)).stale, false);
  await libraryDecide(library, pending.planId, pending.revision, "approve", "Reviewed source evidence and reading volume numbers.");
  const series = await libraryShow(library, { kind: "series", id: "series" });
  assert.deepEqual(series.sources.map((entry) => entry.id), sources.slice(0, 2).map((entry) => entry.id));
  assert.notEqual(series.sources[0].workspace, series.sources[1].workspace);
  assert.notEqual(`${series.sources[0].referenceNamespace}b0001`, `${series.sources[1].referenceNamespace}b0001`);
  const other = await libraryShow(library, { kind: "universe", id: "other" });
  assert.deepEqual(other.sources.map((entry) => entry.id), [sources[2].id]);
  assert.deepEqual(other.organization.assignments.map((entry) => entry.sourceId), [sources[2].id]);
  assert.deepEqual(other.organization.universes.map((entry) => entry.id), ["other"]);
  assert.equal((await libraryHistory(library)).checkpoints.length, 5);
  await assert.rejects(libraryShow(library, { kind: "series", id: "unknown" }), /Unknown library scope/);
});

test("stale catalog and altered plan cannot be approved", async (t) => {
  const { root, library, propose } = await fixture(t);
  const pending = await propose();
  const extra = join(root, "new.txt");
  await writeFile(extra, "新故事");
  await libraryAdd(library, extra);
  assert.equal((await libraryPlan(library, pending.planId)).stale, true);
  await assert.rejects(libraryDecide(library, pending.planId, pending.revision, "approve", "review"), /Stale library revision/);
  const { library: other, propose: proposeOther } = await fixture(t);
  const altered = await proposeOther();
  const path = join(other, "plans", `${altered.planId}.json`);
  const parsed = JSON.parse(await readFile(path, "utf8"));
  parsed.organization.assignments[0].readingOrder = 20;
  await writeFile(path, JSON.stringify(parsed));
  await assert.rejects(libraryDecide(other, altered.planId, altered.revision, "approve", "review"), /Plan changed/);
});

test("hold and reject are audited but leave organization unchanged", async (t) => {
  const { library, propose } = await fixture(t);
  for (const decision of ["hold", "reject"] as const) {
    const pending = await propose();
    const result = await libraryDecide(library, pending.planId, pending.revision, decision, "Evidence insufficient.");
    assert.equal(result.appliedOrganization, false);
    assert.equal((await libraryShow(library)).unresolved, 3);
    await assert.rejects(libraryDecide(library, pending.planId, pending.revision, "approve", "old review"), /Stale/);
  }
  assert.equal((await libraryHistory(library)).checkpoints.length, 6);
});

test("false quotes, missing assignments, bad references and duplicate reading positions fail closed", async (t) => {
  const { plan, propose } = await fixture(t);
  const quote = structuredClone(plan);
  quote.assignments[0].evidence[0].quote = "Invented evidence";
  await assert.rejects(propose(quote), /does not match/);
  const missing = structuredClone(plan);
  missing.assignments.pop();
  await assert.rejects(propose(missing), /every source/);
  const repeated = structuredClone(plan);
  repeated.assignments[1].readingOrder = 1;
  await assert.rejects(propose(repeated), /Duplicate reading position/);
  const invalid = structuredClone(plan);
  invalid.assignments[0].continuityId = "missing";
  await assert.rejects(propose(invalid), /unknown continuity/);
  const unsafe = structuredClone(plan);
  unsafe.series[0].id = "../escape";
  await assert.rejects(propose(unsafe), /Invalid group ID/);
});

test("unresolved membership is excluded while unknown reading order remains explicit", async (t) => {
  const { library, plan, propose } = await fixture(t);
  plan.assignments[0].readingOrder = null;
  plan.assignments[1].status = "unresolved";
  const pending = await propose(plan);
  await libraryDecide(library, pending.planId, pending.revision, "approve", "Only one supported member.");
  const scoped = await libraryShow(library, { kind: "series", id: "series" });
  assert.equal(scoped.sources.length, 1);
  assert.equal(scoped.sources[0].assignment.readingOrder, null);
  assert.equal(scoped.unresolved, 1);
});

test("reordering or inserting a prequel preserves stable workspace and source identities", async (t) => {
  const { library, sources, plan, propose } = await fixture(t);
  const first = await propose();
  await libraryDecide(library, first.planId, first.revision, "approve", "Initial order.");
  const before = await libraryShow(library, { kind: "series", id: "series" });
  plan.assignments[1].readingOrder = 0;
  const next = await propose(plan);
  await libraryDecide(library, next.planId, next.revision, "approve", "A prequel goes first in this reading plan.");
  const after = await libraryShow(library, { kind: "series", id: "series" });
  assert.deepEqual(after.sources.map((entry) => entry.id), [sources[1].id, sources[0].id]);
  assert.equal(after.sources[1].workspace, before.sources[0].workspace);
  assert.equal(after.sources[1].referenceNamespace, before.sources[0].referenceNamespace);
});

test("different series can share a world without losing continuity isolation", async (t) => {
  const { library, sources, plan, propose } = await fixture(t);
  plan.continuities.push({ id: "reboot", universeId: "shared", title: "別連続性", evidence: plan.assignments[1].evidence });
  plan.assignments[1].continuityId = "reboot";
  plan.assignments[1].seriesId = "different";
  const pending = await propose(plan);
  await libraryDecide(library, pending.planId, pending.revision, "approve", "Separate continuities despite a shared setting.");
  const world = await libraryShow(library, { kind: "universe", id: "shared" });
  assert.equal(world.sources.length, 2);
  const main = await libraryShow(library, { kind: "continuity", id: "main" });
  assert.deepEqual(main.sources.map((entry) => entry.id), [sources[0].id]);
});

test("bounded evidence is original text with exact offsets and refuses modified source", async (t) => {
  const { library, sources } = await fixture(t);
  const page = await libraryEvidence(library, sources[0].id, 3, 4);
  assert.equal(page.text, "界 第一");
  assert.equal(page.nextOffset, 7);
  await assert.rejects(libraryEvidence(library, sources[0].id, 0, 2001), /limit/);
  await assert.rejects(libraryEvidence(library, sources[0].id, 99999), /exceeds/);
  await writeFile(join(library, "sources", `${sources[0].id}.txt`), "changed");
  await assert.rejects(libraryEvidence(library, sources[0].id), /changed/);
});

test("offline preparation isolates equal local block IDs, is idempotent and never ingests", async (t) => {
  const { library, sources } = await fixture(t);
  const first = await libraryPrepare(library, sources[0].id);
  const second = await libraryPrepare(library, sources[1].id);
  assert.equal(first.modelCalls, 0);
  assert.equal(second.modelCalls, 0);
  assert.equal((await libraryPrepare(library, sources[0].id)).status, "already_prepared");
  assert.notEqual(first.workspace, second.workspace);
  const { parseJob } = await import(pathToFileURL(join(process.cwd(), "tools/pi-review/job.mjs")).href);
  const job = parseJob({ volumes: [first, second].map((entry, index) => ({ id: index + 1, input: entry.input, workspace: entry.workspace })) }, library);
  assert.equal(job.volumes.length, 2);
  for (const prepared of [first, second]) {
    assert.deepEqual(await readdir(join(prepared.workspace, "changesets")), []);
    assert.equal(await readFile(join(prepared.workspace, "ontology", "entities.jsonl"), "utf8"), "");
    const block = await recallSourceBlock(prepared.workspace, "b0001");
    assert.equal(block.id, "b0001");
    assert.match(block.text, prepared === first ? /第一卷/ : /第二卷/);
  }
});

test("EPUB catalog uses metadata, supports bounded text evidence and preserves album intake", async (t) => {
  const { root, library } = await fixture(t);
  const file = join(root, "book.epub");
  await writeFile(file, epub());
  const registered = await libraryAdd(library, file);
  assert.equal(registered.source.title, "同一世界 第一卷");
  assert.match((await libraryEvidence(library, registered.source.id)).text, /明天再见/);
  const prepared = await libraryPrepare(library, registered.source.id);
  assert.match(await readFile(prepared.input, "utf8"), /明天再见/);
  const album = JSON.parse(await readFile(join(prepared.workspace, "ontology", "album.json"), "utf8"));
  assert.equal(join(prepared.workspace, album.sourceText), prepared.storedInput);
  assert.equal((await libraryPrepare(library, registered.source.id)).status, "already_prepared");
});

test("CLI exposes the separate library workflow and rejects incomplete/unknown flags", async (t) => {
  const { library, plan } = await fixture(t);
  const cli = join(dirname(fileURLToPath(import.meta.url)), "../src/cli/cli.js");
  const result = await execute(process.execPath, [cli, "library", "show", library]);
  assert.equal(JSON.parse(result.stdout).sources.length, 3);
  const revision = JSON.parse(result.stdout).revision;
  const pending = JSON.parse((await execute(process.execPath, [cli, "library", "propose", library, "--organization", JSON.stringify(plan), "--revision", revision])).stdout);
  const reread = JSON.parse((await execute(process.execPath, [cli, "library", "plan", library, pending.planId])).stdout);
  assert.equal(reread.stale, false);
  assert.equal(reread.revision, pending.revision);
  await assert.rejects(execute(process.execPath, [cli, "library", "propose", library, "--organization", JSON.stringify("/private/unapproved-file"), "--revision", revision]), /must be a JSON object/);
  await assert.rejects(execute(process.execPath, [cli, "library", "show", library, "--series"]), /Invalid or duplicate/);
  await assert.rejects(execute(process.execPath, [cli, "library", "show", library, "--auto-approve"]), /Invalid or duplicate/);
});
