import { readFile, readdir, stat } from "node:fs/promises";
import { join, resolve } from "node:path";
import { BundleStore } from "../../../ground/connectors/bundle.js";
import type { Entity, Relation, Scene } from "../../../ground/ontology/types.js";
import { storedSource } from "../../../ground/workspace/source.js";
import { libraryShow } from "../../../ground/workspace/library.js";
import { cutBlocks } from "../../../digger/intake/blocks.js";
import { nominatePlacePairs, type PlaceTreeMemory } from "../../../digger/timeplace/placeTreeSweep.js";
import { readCausalityMemory } from "../../../solidifier/causality/faculty.js";
import { loadUniverseContext, universeBindings, universeCandidates } from "../../../solidifier/causality/universe.js";
import { atlasAsked, atlasCandidates, atlasContext } from "../../../solidifier/atlas/universeAtlas.js";
import { listChangeSets } from "../../../solidifier/merge/changesetStore.js";
import { loadWorkspaceSentences, strandInputs } from "./timeplaceCommands.js";
import { timePlaceAttempted } from "../../../digger/timeplace/afterApply.js";

/**
 * `novel checklist` — what a completed analysis still lacks, in dependency
 * order, with the exact next command for each gap. A book's analysis is
 * complete when every faculty below is "done":
 *
 *   source ─▶ blocks ─┬─▶ causality (in-book, cross-scene sweep)
 *   (album, optional) ├─▶ time-place ─┬─▶ place-tree
 *                     │               └─▶ strands (who is in each scene; report for the story view)
 *                     └─▶ graph (rebuilt after canon changes)
 *
 * and a universe's when every member book is complete and its cross-book
 * faculties are too:  organization ─▶ books ─┬─▶ atlas (same place / inside, across books)
 *                                            └─▶ universe causality
 *
 * Statuses: done · todo (run `next`) · review (a packet awaits the shared
 * gate: review it before producing more of the same faculty) · blocked (a
 * dependency is not done) · optional. Read-only: nothing is run or written.
 */
export type ChecklistStatus = "done" | "todo" | "review" | "blocked" | "optional";
export interface ChecklistItem { id: string; title: string; status: ChecklistStatus; dependsOn: string[]; counts: Record<string, number | string | boolean>; next: string[]; note?: string }
export interface BookChecklist { novelDir: string; title: string; complete: boolean; items: ChecklistItem[]; next: string[] }

const fold = <T extends { id: string }>(records: T[]) => [...new Map(records.map((record) => [record.id, record])).values()];
const exists = (path: string) => stat(path).then(() => true, () => false);
const quote = (path: string) => /[\s'"]/.test(path) ? `'${path.replace(/'/g, "'\\''")}'` : path;

/** Resolve dependencies: an item whose dependency is not done is blocked (its own counts still show). */
function settle(items: ChecklistItem[]): ChecklistItem[] {
  const byId = new Map(items.map((item) => [item.id, item]));
  for (const item of items) {
    const waiting = item.dependsOn.filter((id) => byId.get(id) && !["done", "optional"].includes(byId.get(id)!.status));
    // Nothing is complete while what it builds on is not: a gap upstream blocks it (its own counts still show).
    if (waiting.length && item.status !== "optional") { item.status = "blocked"; item.next = []; item.note = `Waits for ${waiting.join(", ")}.${item.note ? ` ${item.note}` : ""}`; }
  }
  return items;
}

export async function bookChecklist(novelDir: string, options: { input?: string } = {}): Promise<BookChecklist> {
  const dir = quote(novelDir);
  const store = new BundleStore(join(novelDir, "ontology"));
  const manifest = JSON.parse(await readFile(join(novelDir, "ontology", "manifest.json"), "utf8").catch(() => "{}")) as { title?: string };
  const [entities, relations, scenes] = [fold(await store.loadFile<Entity>("entities.jsonl")), await store.loadFile<Relation>("relations.jsonl"), fold(await store.loadFile<Scene>("scenes.jsonl"))];
  const changesets = await listChangeSets(novelDir).catch(() => []);
  const pending = (test: (id: string, blockId: string) => boolean) => changesets.filter((changeset) => ["pending_review", "held", "revision_requested"].includes(changeset.status) && test(changeset.id, changeset.blockId));
  const reviewCommand = (id: string) => `novel review show ${dir} ${id} --scope book --offset 0 --limit 20`;
  const items: ChecklistItem[] = [];

  // Source: the stored, bound original every fact cites.
  const bound = await storedSource(novelDir);
  const sourceFiles = await readdir(join(novelDir, "source")).catch(() => [] as string[]);
  const sourceFile = bound?.file ?? (sourceFiles.length === 1 ? sourceFiles[0] : null);
  items.push({ id: "source", title: "Stored original source", status: sourceFile ? "done" : "todo", dependsOn: [], counts: { file: sourceFile ?? "none" },
    next: sourceFile ? [] : [options.input ? `novel ingest ${dir} ${quote(options.input)}` : `novel ingest ${dir} <the assigned input>`] });

  // Album (EPUB pictures): optional, imported before ingestion when the host allows it.
  const album = await exists(join(novelDir, "assets"));
  items.push({ id: "album", title: "EPUB illustrations and portraits", status: album ? "done" : "optional", dependsOn: [], counts: { imported: album }, next: [], note: album ? undefined : "Only for EPUB sources whose host allows album import; never required." });

  // Blocks: every block of the source applied through the gate.
  const blocks = sourceFile ? cutBlocks(await readFile(join(novelDir, "source", sourceFile), "utf8"), bound?.blockSize).map((block) => block.id) : [];
  const approved = new Set(changesets.filter((changeset) => /^cs_b\d+$/.test(changeset.id) && changeset.status === "approved").map((changeset) => changeset.blockId));
  const blockReview = pending((id) => /^cs_b\d+$/.test(id));
  const missingBlocks = blocks.filter((id) => !approved.has(id));
  items.push({ id: "blocks", title: "Text extraction (scenes, events, dialogue, entities)", dependsOn: ["source"],
    status: blockReview.length ? "review" : missingBlocks.length ? "todo" : blocks.length ? "done" : "todo",
    counts: { blocks: blocks.length, applied: blocks.length - missingBlocks.length, awaitingReview: blockReview.length, scenes: scenes.length, entities: entities.length },
    next: blockReview.length ? blockReview.map((changeset) => reviewCommand(changeset.id)) : missingBlocks.length ? [options.input ? `novel ingest ${dir} ${quote(options.input)}` : `novel ingest ${dir} <the assigned input>  (continues at ${missingBlocks[0]})`] : [] });

  // In-book causality: the cross-scene sweep after extraction, and its packets reviewed.
  const causalReview = pending((id) => id.startsWith("cs_causality_"));
  const sweepPending = (await readCausalityMemory(novelDir)).sweepPending;
  items.push({ id: "causality", title: "Cross-scene causality (in this book)", dependsOn: ["blocks"],
    status: causalReview.length ? "review" : sweepPending ? "todo" : "done",
    counts: { causalLinks: relations.filter((relation) => relation.type === "CAUSES" || relation.type === "CAUSED_BY").length, awaitingReview: causalReview.length, sweepPending },
    next: causalReview.length ? causalReview.map((changeset) => reviewCommand(changeset.id)) : sweepPending ? [`novel causality sweep ${dir}`] : [],
    note: "Read references/causality.md before reviewing causal packets." });

  // Story time and places: every scene in a period, packets reviewed.
  const timed = new Set(relations.filter((relation) => relation.type === "OCCURS_DURING").map((relation) => relation.fromId));
  const attempted = await timePlaceAttempted(novelDir);
  const untimed = scenes.filter((scene) => !timed.has(scene.id) && !attempted.has(scene.id)).length;
  const triedWithoutPeriod = scenes.filter((scene) => !timed.has(scene.id) && attempted.has(scene.id)).length;
  const timeReview = pending((id, blockId) => id.startsWith("cs_timeplace_") && blockId !== "place-tree");
  items.push({ id: "time-place", title: "Story time and scene places", dependsOn: ["blocks"],
    status: timeReview.length ? "review" : scenes.length && untimed ? "todo" : scenes.length ? "done" : "todo",
    counts: { scenes: scenes.length, scenesWithoutPeriod: untimed, processedWithoutPeriod: triedWithoutPeriod, periods: entities.filter((entity) => entity.kind === "TimePoint").length, awaitingReview: timeReview.length },
    next: timeReview.length ? timeReview.map((changeset) => reviewCommand(changeset.id)) : untimed ? [`novel timeplace run ${dir} --propose`] : [],
    note: triedWithoutPeriod ? `${triedWithoutPeriod} scene(s) were processed but have no period (no time word before them, or their facts were held); they are not re-asked.` : undefined });

  // Place tree: stored places given their one parent where the text says so.
  const places = entities.filter((entity) => entity.kind === "Location");
  const parents = new Set(relations.filter((relation) => relation.type === "PART_OF").map((relation) => relation.fromId));
  const treeReview = pending((id, blockId) => id.startsWith("cs_timeplace_") && blockId === "place-tree");
  let unsettled = 0;
  if (places.length > 1 && !treeReview.length && sourceFile) {
    const memory = JSON.parse(await readFile(join(novelDir, "timeplace", "place-tree.json"), "utf8").catch(() => '{"distinct":[]}')) as PlaceTreeMemory;
    unsettled = nominatePlacePairs({ places: places.filter((place) => !place.properties?.generic), relations, scenes, sentences: await loadWorkspaceSentences(novelDir), memory }).length;
  }
  const swept = await exists(join(novelDir, "timeplace", "place-tree.json"));
  items.push({ id: "place-tree", title: "Place tree (which place is inside which)", dependsOn: ["time-place"],
    status: treeReview.length ? "review" : unsettled ? "todo" : "done",
    counts: { places: places.length, withParent: parents.size, candidatePairs: unsettled, swept, awaitingReview: treeReview.length },
    next: treeReview.length ? treeReview.map((changeset) => reviewCommand(changeset.id)) : unsettled ? [`novel timeplace tree ${dir} --propose`] : [],
    note: unsettled && swept ? "New pairs, or asked pairs with more evidence since, are waiting." : undefined });

  const newest = Math.max(0, ...await Promise.all(["entities", "relations", "events", "scenes"].map((name) => stat(join(novelDir, "ontology", `${name}.jsonl`)).then((info) => info.mtimeMs, () => 0))));

  // Strands: who is in each scene where a borrowed cast would decide the story order ("who is present?",
  // work model). Done when nothing is worth asking, or the latest asked report read the same casts, story
  // time, places and cast candidates as now (its `inputs` fingerprint): new causal links or events do not
  // make it stale. Report only: it feeds the story-strands view; no review packet.
  const strand = timed.size ? await strandInputs(novelDir) : null;
  let asked: { inputs?: string; at: number } | null = null;
  for (const name of (await readdir(join(novelDir, "timeplace")).catch(() => [] as string[])).filter((entry) => /^strands-.+\.json$/.test(entry)).sort().reverse()) {
    const report = JSON.parse(await readFile(join(novelDir, "timeplace", name), "utf8").catch(() => "null")) as { after?: unknown; inputs?: string } | null;
    if (report?.after) { asked = { inputs: report.inputs, at: (await stat(join(novelDir, "timeplace", name))).mtimeMs }; break; }
  }
  // Reports from before the fingerprint: current when newer than the bundle and time-place packets.
  const timeplaceFiles = (await readdir(join(novelDir, "changesets")).catch(() => [] as string[])).filter((name) => name.startsWith("cs_timeplace"));
  const legacyCurrent = async (at: number) => at >= Math.max(newest, ...await Promise.all(timeplaceFiles.map((name) => stat(join(novelDir, "changesets", name)).then((info) => info.mtimeMs, () => 0))));
  const strandPlan = strand?.plan ?? null;
  const toAsk = strandPlan?.questions.length ?? 0;
  const current = !!asked && (asked.inputs ? asked.inputs === strand?.fingerprint : await legacyCurrent(asked.at));
  items.push({ id: "strands", title: "Story strands (who is in each scene, what runs in parallel)", dependsOn: ["time-place"],
    status: !timed.size || !toAsk || current ? "done" : "todo",
    counts: { questions: toAsk, calls: strandPlan?.estimate.calls ?? 0, asked: !!asked, current },
    next: timed.size && toAsk && !current ? [`novel timeplace strands ${dir} --ask`] : [],
    note: !timed.size ? "No story periods to build strands on." : toAsk && !current ? `About ${strandPlan!.estimate.calls} work-model call(s); writes a report the story view uses, nothing to canon.` : undefined });

  // Graph: the queryable graph rebuilt after canon changed.
  const graph = await stat(join(novelDir, "ontology", "graph.lbug")).catch(() => null);
  items.push({ id: "graph", title: "Query graph up to date", dependsOn: ["blocks"], status: !graph || graph.mtimeMs < newest ? "todo" : "done",
    counts: { built: !!graph }, next: !graph || graph.mtimeMs < newest ? [`novel graph build ${quote(join(novelDir, "ontology"))}`] : [] });

  settle(items);
  const complete = items.every((item) => item.status === "done" || item.status === "optional");
  return { novelDir, title: manifest.title ?? novelDir, complete, items, next: items.filter((item) => item.status === "todo" || item.status === "review").flatMap((item) => item.next.map((command) => `[${item.id}] ${command}`)) };
}

export interface UniverseChecklist { library: string; universeId: string; title: string; complete: boolean; books: { sourceId: string; title: string; continuityId: string | null; readingOrder: number | null; workspace: string | null; extracted: boolean; complete: boolean; firstGap: string | null }[]; items: ChecklistItem[]; next: string[] }

export async function universeChecklist(directory: string, universeId: string, env: NodeJS.ProcessEnv = process.env): Promise<UniverseChecklist> {
  const config = await universeBindings(env);
  const library = await libraryShow(resolve(directory));
  const lib = quote(directory);
  const items: ChecklistItem[] = [];
  items.push({ id: "organization", title: "Library organization (series, universes, continuities, reading order)", dependsOn: [],
    status: library.unresolved ? "todo" : "done", counts: { unresolvedAssignments: library.unresolved }, next: library.unresolved ? [`novel library show ${lib} --offset 0 --limit 10  (novel-library skill)`] : [] });
  const context = await atlasContext(directory, universeId, config);
  const books = [];
  for (const entry of context.books) {
    const book = { ...entry, title: entry.title.replace(/\s+/g, " ").trim() };
    if (!book.workspace) { books.push({ ...book, extracted: false, complete: false, firstGap: "no database yet (not extracted)" }); continue; }
    const check = await bookChecklist(book.workspace);
    const gap = check.items.find((item) => !["done", "optional"].includes(item.status));
    const applied = Number(check.items.find((item) => item.id === "blocks")?.counts.applied ?? 0);
    books.push({ ...book, extracted: applied > 0, complete: check.complete, firstGap: gap ? `${gap.id}: ${gap.status}` : null });
  }
  const incomplete = books.filter((book) => !book.complete);
  items.push({ id: "books", title: "Every book of the universe analysed", dependsOn: ["organization"], status: incomplete.length ? "todo" : "done",
    counts: { books: books.length, complete: books.length - incomplete.length, unextracted: books.filter((book) => !book.extracted).length },
    next: incomplete.map((book) => book.workspace ? `novel checklist ${quote(book.workspace)}  (${book.title}: ${book.firstGap})` : `${book.title}: extract it first (its assigned input in NOVEL_JOB.json)`) });
  // Atlas: same place / inside across books. Needs at least two books with places.
  const packets = await readdir(join(directory, "atlas", "packets")).catch(() => [] as string[]);
  const state = JSON.parse(await readFile(join(directory, "atlas", "state.json"), "utf8").catch(() => '{"decisions":[]}')) as { decisions: { packetId: string; kind: "same_place" | "part_of"; a: string; b: string; verdict: string; universeId: string }[] };
  const applied = new Set(state.decisions.map((record) => record.packetId));
  const atlasPending: string[] = [];
  for (const name of packets.filter((entry) => entry.endsWith(".json"))) {
    const packet = JSON.parse(await readFile(join(directory, "atlas", "packets", name), "utf8")) as { id: string; universeId: string; revision: string };
    if (packet.universeId === universeId && !applied.has(packet.id) && packet.revision === context.revision) atlasPending.push(packet.id);
  }
  const candidates = atlasCandidates(context, state.decisions.filter((record) => record.universeId === universeId), await atlasAsked(directory, universeId)).length;
  const booksWithPlaces = new Set(context.places.map((place) => place.sourceId)).size;
  items.push({ id: "atlas", title: "Places joined across books (universe atlas)", dependsOn: ["books"],
    status: booksWithPlaces < 2 ? "optional" : atlasPending.length ? "review" : candidates ? "todo" : "done",
    counts: { booksWithPlaces, candidatePairs: candidates, awaitingReview: atlasPending.length, decisions: state.decisions.filter((record) => record.universeId === universeId).length },
    next: atlasPending.length ? atlasPending.map((id) => `novel review show ${lib} ${id} --scope universe --universe ${universeId} --offset 0 --limit 20`) : candidates ? [`novel atlas sweep ${lib} ${universeId} --propose`] : [],
    note: booksWithPlaces < 2 ? "Needs places in at least two books." : "Run it after each book's place tree, so parents carry across volumes." });
  // Universe causality: reviewed cross-book causes.
  const causal = JSON.parse(await readFile(join(directory, "causality", "state.json"), "utf8").catch(() => '{"decisions":[]}')) as { decisions: { universeId: string; packetId: string }[] };
  const causalPackets = (await readdir(join(directory, "causality", "packets")).catch(() => [] as string[])).filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
  const causalApplied = new Set(causal.decisions.map((record) => record.packetId));
  const causalPending = [];
  for (const id of causalPackets) {
    const packet = JSON.parse(await readFile(join(directory, "causality", "packets", `${id}.json`), "utf8")) as { universeId: string };
    if (packet.universeId === universeId && !causalApplied.has(id)) causalPending.push(id);
  }
  const extracted = books.filter((book) => book.extracted).length;
  // Remaining candidates are counted only once every book is complete (loading the universe is heavy).
  let remaining: number | null = null;
  if (!incomplete.length && extracted >= 2 && !causalPending.length) remaining = (await universeCandidates(await loadUniverseContext(directory, universeId, config), 0, 1)).page.total;
  items.push({ id: "universe-causality", title: "Causes across books", dependsOn: ["books"],
    status: extracted < 2 ? "optional" : causalPending.length ? "review" : remaining === 0 ? "done" : "todo",
    counts: { extractedBooks: extracted, awaitingReview: causalPending.length, decisions: causal.decisions.filter((record) => record.universeId === universeId).length, candidatePairs: remaining ?? "counted once every book is complete" },
    next: causalPending.length ? causalPending.map((id) => `novel review show ${lib} ${id} --scope universe --universe ${universeId} --offset 0 --limit 20`) : [`novel causality universe candidates ${lib} ${universeId} --offset 0 --limit 10`],
    note: "Judge each candidate (propose or leave it); read references/causality.md first." });
  settle(items);
  return { library: directory, universeId, title: context.title, complete: items.every((item) => item.status === "done" || item.status === "optional"), books, items,
    next: items.filter((item) => item.status === "todo" || item.status === "review").flatMap((item) => item.next.map((command) => `[${item.id}] ${command}`)) };
}

export const CHECKLIST_USAGE = "novel checklist <novel-dir> [--input <file>] | novel checklist <library-dir> --universe <universe-id>";

export async function checklistCommand(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<unknown> {
  const [target, flag, value, ...rest] = args;
  if (!target || target.startsWith("--") || rest.length || flag !== undefined && !["--input", "--universe"].includes(flag) || flag && !value) throw new Error(`Usage: ${CHECKLIST_USAGE}`);
  if (flag === "--universe") return universeChecklist(target, value, env);
  return bookChecklist(target, { input: flag === "--input" ? value : undefined });
}
