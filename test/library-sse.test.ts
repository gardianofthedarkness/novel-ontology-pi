import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { libraryAdd, libraryInit, libraryShow, libraryView, type LibrarySource } from "../src/ground/workspace/library.js";

const execute = promisify(execFile);

test("real library CLI updates stream protected snapshots as ghosts then reviewed series without prompts or private payloads", async (t) => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "library-sse-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = join(root, "library");
  await libraryInit(directory);
  const sources: LibrarySource[] = [];
  for (const index of [1, 2]) {
    const file = join(root, `星空 ${index}.txt`);
    await writeFile(file, `PRIVATE_SOURCE_${index}`);
    sources.push((await libraryAdd(directory, file)).source);
  }
  const dist = join(root, "frontend");
  await mkdir(join(dist, "assets"), { recursive: true });
  await writeFile(join(dist, "index.html"), '<script type="module" src="/assets/app.js"></script>');
  await writeFile(join(dist, "assets/app.js"), "export const synthetic = true;");
  const host = await import(pathToFileURL(join(process.cwd(), "tools/pi-review/serve.mjs")).href);
  const { readLibraryLive } = await import(pathToFileURL(join(process.cwd(), "tools/pi-review/library-live.mjs")).href);
  const { applySnapshotChanges } = await import(pathToFileURL(join(process.cwd(), "tools/pi-review/snapshot-delta.mjs")).href);
  const viewer = await host.createViewer({ port: 0, expiresAt: Date.now() + 30000, dist,
    watchPaths: [], libraryDirectory: directory,
    libraryBindings: sources.map((source, index) => ({ sourceId: source.id, volume: index + 1 })),
    libraryReader: (directory: string, bindings: unknown[]) => readLibraryLive(directory, bindings, libraryView),
    readLive: async ({ volume }: { volume: string }) => ({ volume: volume === "2" ? 2 : 1,
      world: { laneNodes: [], laneEdges: [], interiors: {}, bigEventLabels: {} }, feed: [], status: "idle" }),
  });
  t.after(viewer.close);
  const baseURL = new URL(viewer.privatePath, viewer.origin).href;
  const controller = new AbortController();
  t.after(() => controller.abort());
  const response = await fetch(`${baseURL}api/live/stream`, { signal: controller.signal });
  assert.equal(response.status, 200);
  const reader = response.body!.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  let current: any;
  const readPacket = async () => {
    for (;;) {
      const boundary = buffer.indexOf("\n\n");
      if (boundary >= 0) {
        const packet = buffer.slice(0, boundary);
        buffer = buffer.slice(boundary + 2);
        const type = packet.match(/^event: (.+)/)?.[1];
        const data = JSON.parse(packet.match(/\ndata: (.+)/)![1]);
        if (type === "snapshot") current = data;
        if (type === "patch") current = applySnapshotChanges(current, data);
        return current;
      }
      const chunk = await reader.read();
      if (chunk.done) throw new Error("SSE ended before the library update.");
      buffer += chunk.value;
    }
  };
  const until = async (predicate: (value: any) => boolean) => {
    let timer: ReturnType<typeof setTimeout>;
    try {
      return await Promise.race([
        (async () => { for (;;) { const value = await readPacket(); if (predicate(value)) return value; } })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Library SSE did not publish within five seconds.")), 5000); }),
      ]);
    } finally { clearTimeout(timer!); }
  };
  const initial = await until(value => !!value?.world.library);
  assert.equal(initial.world.library.plans.length, 0);
  const evidence = (source: LibrarySource) => [{ sourceId: source.id, field: "filename", quote: source.filename }];
  const organization = {
    universes: [{ id: "world", title: "世界", evidence: evidence(sources[0]) }],
    continuities: [{ id: "canon", title: "正史", universeId: "world", evidence: evidence(sources[0]) }],
    series: [{ id: "stars", title: "星空", evidence: evidence(sources[0]) }],
    assignments: sources.map((source, index) => ({ sourceId: source.id, seriesId: "stars", continuityId: "canon", readingOrder: index + 1, status: "confirmed", evidence: evidence(source), note: "PRIVATE_NOTE" })),
  };
  const cli = join(dirname(fileURLToPath(import.meta.url)), "../src/cli/cli.js");
  const { createLibraryAccess } = await import(pathToFileURL(join(process.cwd(), "tools/pi-review/library-access.mjs")).href);
  const { authorize } = await import(pathToFileURL(join(process.cwd(), "tools/pi-review/guard.mjs")).href);
  const library = { directory, bindings: sources.map((source, index) => ({ sourceId: source.id, volume: index + 1 })) };
  const access = await createLibraryAccess(library, sources.map((source, index) => ({ id: index + 1, input: join(root, source.filename) })));
  const scope = { library, novel: "unavailable", input: "", skill: "", sourcePaths: [], blockIds: [], maxBlocks: 1 };
  const command = async (args: string[]) => {
    const permitted = authorize(["novel", ...args].map(value => JSON.stringify(value)).join(" "), scope);
    await access.before(permitted.args, true);
    const { stdout } = await execute(process.execPath, [cli, ...permitted.args]);
    await access.credit(permitted.args, stdout);
    return JSON.parse(stdout);
  };
  const proposed = await command(["library", "propose", directory, "--organization", JSON.stringify(organization), "--revision", (await libraryShow(directory)).revision]);
  const pending = await until(value => value?.world.library.plans.length === 1);
  assert.equal(pending.world.library.plans[0].state, "proposed");
  assert.equal(pending.libraryActivity.latest.type, "library.plan.proposed");
  const decision = ["library", "decide", directory, proposed.planId, "--revision", proposed.revision, "--decision", "approve", "--reason", "PRIVATE_REVIEW_REASON"];
  await assert.rejects(command(decision), /EVERY current plan page/);
  await command(["library", "show", directory]);
  const inspected = await command(["library", "plan", directory, proposed.planId]);
  assert.equal(inspected.page.nextOffset, null);
  await command(decision);
  const approved = await until(value => value?.libraryActivity.latest.type === "library.plan.approved");
  assert.equal(approved.world.library.plans.length, 0);
  assert.equal(approved.world.library.organization.series[0].id, "stars");
  assert.equal(approved.libraryActivity.count, 4);
  const second = await (await fetch(`${baseURL}api/live?volume=2`)).json() as { world: { sourceId: string } };
  assert.equal(second.world.sourceId, sources[1].id);
  const reconnected = await (await fetch(`${baseURL}api/live`)).json() as { libraryActivity: { latest: { id: string } }; world: { library: { events: unknown[] } } };
  assert.equal(reconnected.libraryActivity.latest.id, approved.libraryActivity.latest.id);
  assert.deepEqual(reconnected.world.library.events, approved.world.library.events);
  const body = JSON.stringify(approved);
  for (const privateValue of [root, "PRIVATE_SOURCE", "PRIVATE_NOTE", "PRIVATE_REVIEW_REASON", '"evidence"', '"workspace"']) assert.ok(!body.includes(privateValue), privateValue);
  assert.equal((await fetch(new URL("/api/live", viewer.url))).status, 401);
  assert.equal((await fetch(`${baseURL}api/live`, { method: "POST" })).status, 405);
});
