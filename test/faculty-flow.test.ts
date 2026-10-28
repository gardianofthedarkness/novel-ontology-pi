import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { FLOW_EDGES, FLOW_NODES, commandScope, flowNodeOf, flowState } from "../apps/playground/src/data/facultyFlow.js";
import type { LiveActivity } from "../apps/playground/src/data/liveActivity.js";
import { libraryCallSink, observeDecisions, observeWork } from "../src/ground/events/observe.js";
import type { ProcessingEvent } from "../src/ground/events/types.js";

async function sources(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  return (await Promise.all(entries.map((entry) => entry.isDirectory() ? sources(join(directory, entry.name)) : entry.name.endsWith(".ts") ? [join(directory, entry.name)] : []))).flat();
}

test("every faculty name the source can report has a node in the flow graph", async () => {
  // The repo is read from the compiled test's location: dist/test → repo root.
  const root = join(import.meta.dirname, "..", "..");
  const names = new Set<string>();
  for (const file of await sources(join(root, "src"))) {
    const text = await readFile(file, "utf8");
    // System 1 calls are named by their question key prefix; candidate keys are not questions.
    for (const match of text.matchAll(/key(?::| =) `([a-z_-]+)[:$]/g)) if (match[1] !== "existing") names.add(match[1]);
    // Work-model calls are named by their pool faculty, or by an observeWork scope.
    for (const match of text.matchAll(/pool\.generate\("([a-z-]+)"/g)) names.add(match[1]);
    for (const match of text.matchAll(/faculty: "([a-z-]+)" ?\}/g)) names.add(match[1]);
  }
  assert.ok(names.size >= 20, `found only ${names.size} faculty names; the scan has drifted from the source`);
  assert.deepEqual([...names].filter((name) => !flowNodeOf(name)).sort(), []);
});

test("the graph is well formed: unique nodes and edges between known nodes", () => {
  const ids = new Set(FLOW_NODES.map((node) => node.id));
  assert.equal(ids.size, FLOW_NODES.length);
  assert.equal(new Set(FLOW_EDGES.map((edge) => edge.id)).size, FLOW_EDGES.length);
  for (const edge of FLOW_EDGES) assert.ok(ids.has(edge.source) && ids.has(edge.target), edge.id);
  const names = FLOW_NODES.flatMap((node) => node.names);
  assert.equal(new Set(names).size, names.length, "a reported name belongs to one node");
});

const faculty = (name: string, extra: Partial<LiveActivity["faculties"][number]> = {}): LiveActivity["faculties"][number] => ({
  id: `system1:${name}`, label: name, faculty: name, system: "system1", status: "ok", active: 0, calls: 1, timestamp: "2026-10-28T10:00:00Z", blockId: "b0001", ...extra,
});
const live = (faculties: LiveActivity["faculties"], extra: Partial<LiveActivity> = {}): LiveActivity => ({
  count: 0, chapterId: "chapter_0", blockId: "b0001", phase: "", latestTouch: null, faculties, identityEvents: [], telemetryNote: null, ...extra,
});

test("context flows into a firing faculty only from a source that fired before it in the same block", () => {
  const state = flowState(live([
    faculty("scene_start", { calls: 3 }),
    faculty("entities-participants", { system: "work", status: "working", active: 2, calls: 2, timestamp: "2026-10-28T10:00:05Z" }),
    faculty("dlg_start", { timestamp: "2026-10-28T10:00:09Z" }),
    faculty("dialogue-member", { status: "working", active: 1, timestamp: "2026-10-28T10:00:06Z", blockId: "b0002" }),
  ]));
  assert.equal(state.nodes.scenes.status, "done");
  assert.equal(state.nodes.scenes.calls, 3);
  assert.equal(state.nodes.identity.status, "firing");
  assert.ok(state.flowing.has("scenes->identity"));
  assert.ok(!state.flowing.has("identity->birth"), "an idle target receives nothing");
  assert.ok(!state.flowing.has("identity->members"), "another block's work is not fed by this block");
  assert.ok(!state.flowing.has("exchanges->members"), "a source that fired after its target fed nothing");
  assert.equal(state.firing, 2);
});

test("steps feed whatever fires next, failures and unknown names stay visible, review lights the gate", () => {
  const state = flowState(live([
    faculty("scene_end", { status: "working", active: 1 }),
    faculty("causal", { status: "error" }),
    faculty("brand-new-faculty", { calls: 4 }),
  ], { review: { id: "r", timestamp: "t", active: true, volume: 1, chapterIndex: 0, blockId: "b0001", changesetId: "cs", phase: "facts", status: "ok", nodeIds: [] } }));
  assert.ok(state.flowing.has("intake->scenes"));
  assert.ok(!state.flowing.has("recall->scenes"), "feedback from a step is not assumed");
  assert.equal(state.nodes.causality.status, "failed");
  assert.deepEqual(state.unmapped, [{ faculty: "brand-new-faculty", calls: 4, active: 0 }]);
  assert.equal(state.nodes.gate.status, "firing");
});

test("Pi's running command scopes the graph; a finished one does not", () => {
  assert.deepEqual(commandScope("novel causality universe sweep lib u1"), ["universe"]);
  assert.ok(commandScope("novel causality ./novel").includes("causality"));
  assert.ok(commandScope("novel ingest ./novel book.txt").includes("extraction"));
  assert.deepEqual(commandScope("ls -la"), []);
  const running = flowState(live([], { command: { label: "novel timeplace run ./novel", status: "working", timestamp: "t" } }));
  assert.deepEqual([...running.scope].sort(), ["gate", "timeplace"]);
  assert.equal(flowState(live([], { command: { label: "novel timeplace run ./novel", status: "complete", timestamp: "t" } })).scope.size, 0);
});

test("observed clients report each call once, with or without a block, and never fail on telemetry", async () => {
  const events: ProcessingEvent[] = [];
  const emit = async (event: ProcessingEvent) => { events.push(event); };
  const decisions = observeDecisions({ modelId: "jev", decide: async (_state, questions) => questions.map((question) => ({ key: question.key, value: "yes", confidence: 1 })) }, emit);
  await decisions.decide("state", [{ key: "same:a|b", instructions: "?", options: ["yes", "no"] }] as never);
  const work = observeWork({ modelId: "w", generate: async () => { throw new Error("down"); } }, emit, { blockId: "b0003", faculty: "extraction" });
  await assert.rejects(work.generate({ system: "s", prompt: "p" }), /down/);
  assert.deepEqual(events.map((event) => event.type === "faculty.activity" ? [event.faculty, event.system, event.status, event.blockId ?? null] : null), [
    ["same", "system1", "started", null], ["same", "system1", "completed", null],
    ["extraction", "work", "started", "b0003"], ["extraction", "work", "failed", "b0003"],
  ]);
  const broken = observeDecisions({ modelId: "jev", decide: async () => [] }, async () => { throw new Error("log locked"); });
  assert.deepEqual(await broken.decide("state", []), []);
});

test("library faculties log calls apart from the library and join the live faculties", async (t) => {
  const library = await mkdtemp(join(tmpdir(), "novel-library-calls-"));
  t.after(() => rm(library, { recursive: true, force: true }));
  const atlas = observeDecisions({ modelId: "jev", decide: async () => [] }, await libraryCallSink(library), { faculty: "atlas" });
  await atlas.decide("state", [{ key: "atlas:p1|p2", instructions: "?", options: ["same"] }] as never);
  const { readLibraryLive, withLibraryLive } = await import(pathToFileURL(join(process.cwd(), "tools/pi-review/library-live.mjs")).href);
  const view = async () => ({ sources: [], events: [], totalEvents: 0 });
  const live = await readLibraryLive(library, [], view);
  const data = withLibraryLive({ volume: 1, world: {}, feed: [], activity: { faculties: [{ id: "book", faculty: "scene_start" }] } }, live);
  assert.deepEqual(data.activity.faculties.map((entry: { faculty: string }) => entry.faculty), ["scene_start", "atlas"]);
  assert.equal(data.activity.faculties[1].status, "ok");
  assert.equal(flowNodeOf(data.activity.faculties[1].faculty), "atlas");
  assert.ok(!("faculties" in data.world.library), "call telemetry stays out of the public library view");
});
