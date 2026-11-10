/**
 * A book's world as the console's Characters, Places and Strands views show it (docs/v3/plan.md §1.5a; docs/v2/world-model.md):
 * time an ordered tree (the calendar: story > year > day > part of day), places an unordered tree (what holds what),
 * people and things movables, each present at a place at a time scene by scene, and the strands: groups of movables that
 * stay together, splitting when the group parts and uniting when it meets again. Built from the reading alone, with the
 * builders the director uses (src/v2/extraction/script.ts readingScript, world-engine/director/segments.mjs segmentWorld
 * and strandsFile, src/v2/extraction/strands.ts groupStrands); no model is asked. Read-only.
 */
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readingScript, type ReadingScript } from "../v2/extraction/script.js";
import { groupStrands, strandBeats, strandsDocument, type GroupStrands, type StrandFork } from "../v2/extraction/strands.js";
import type { NovelWorkspace, OpenBook } from "./workspace.js";

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

export interface WorldTimeNode { id: string; level: string; label: string; parent: string | null }
export interface WorldPlace { id: string; label: string; scale: string | null; parent: string | null; unnamed: boolean }
export interface WorldScene {
  id: string; index: number; chapter: number; first: string | null;
  /** Its node on the time tree, and whether the scene states its time or inherits it. */
  node: string | null; stated: boolean; when: string | null; flashback: boolean;
  place: string | null; placeBy: string;
  present: string[]; things: { id: string; holder: string | null }[];
  strand: string | null; lane: number | null; story: number | null;
}
export interface WorldStrand { id: string; lane: number; scenes: string[]; people: string[]; envelope: string | null; splitFrom: string[]; into: string | null; intoAt: string | null; open: boolean; past: boolean }
export interface WorldView {
  book: { id: string; title: string };
  time: WorldTimeNode[];
  places: WorldPlace[];
  scenes: WorldScene[];
  strands: WorldStrand[];
  /** id -> [label, category, unnamed 1/0]. */
  movables: Record<string, [string, string, number]>;
  checks: Record<string, number>;
}

interface ReadingData {
  scenes: { id: string; index: number; chapter: number; sentences: string[] }[];
  chart: { entities: { id: string; category: string; proper?: string[]; names?: string[] }[]; times?: { text: string }[] };
  time?: { tree?: { id: string; level: string; label: string; parent: string | null }[]; scenes?: { scene: string; node?: string | null; inherited?: boolean; when?: string; flashback?: boolean }[] };
  slots?: unknown;
}

const kept = new WeakMap<object, WorldView>();

/** The world of a book with a reading (kept while the reading is the same). */
export async function worldView(ws: NovelWorkspace, name: string): Promise<WorldView> {
  const open: OpenBook = await ws.book(name), data = open.reading as ReadingData | null, index = open.index;
  if (!data || !index) throw new Error(`${open.book.path} has no reading linked, so it has no world yet.`);
  const known = kept.get(data);
  if (known) return known;
  const result = { ...data, chart: { ...data.chart, entities: new Map(data.chart.entities.map((entity) => [entity.id, entity])), times: new Map((data.chart.times ?? []).map((node) => [node.text, node])) } };
  const text = (id: string) => index.line(id)?.text ?? "";
  const script: ReadingScript = readingScript(result as never, text);
  // Who is present in each unit by the director's own reading of it (credits checked), and the strands it plays.
  const segments = await import(pathToFileURL(join(repository, "world-engine", "director", "segments.mjs")).href) as {
    segmentWorld: (input: { reading: unknown; script: ReadingScript }) => { script: ReadingScript; reading: unknown } | null;
    strandsFile: (script: ReadingScript, builder: unknown, options: { reading: unknown }) => { strands: GroupStrands };
  };
  const world = segments.segmentWorld({ reading: data, script });
  const played = world?.script ?? script;
  const { strands } = segments.strandsFile(played, { groupStrands, strandBeats, strandsDocument }, { reading: world?.reading ?? null });

  const when = new Map((data.time?.scenes ?? []).map((scene) => [scene.scene, scene]));
  const firstOf = new Map(data.scenes.map((scene) => [scene.id, scene.sentences[0] ?? null]));
  const order = new Map(strands.order.map((id, n) => [id, n]));
  const symbols = new Map(index.symbols.map((symbol) => [symbol.id, symbol]));
  const movables: WorldView["movables"] = {};
  const own = (id: string) => { if (movables[id]) return; const symbol = symbols.get(id); movables[id] = [symbol?.label ?? id, symbol?.category ?? (id.startsWith("slot_") ? "person" : "thing"), symbol?.unnamed || id.startsWith("slot_") ? 1 : 0]; };

  const scenes: WorldScene[] = played.scenes.map((scene, n) => {
    const time = when.get(scene.id);
    for (const id of scene.present) own(id);
    for (const thing of scene.things ?? []) own(thing.id);
    return {
      id: scene.id, index: n, chapter: scene.chapter, first: firstOf.get(scene.id) ?? null,
      node: scene.at?.node ?? time?.node ?? null, stated: scene.at?.stated ?? !time?.inherited, when: time?.when ?? null, flashback: Boolean(time?.flashback),
      place: scene.place, placeBy: scene.placeBy, present: scene.present, things: scene.things ?? [],
      strand: strands.forkOf.get(scene.id) ?? null, lane: strands.lane.get(scene.id) ?? null, story: order.get(scene.id) ?? null,
    };
  });
  const strandList: WorldStrand[] = strands.forks.map((fork: StrandFork) => ({
    id: fork.id, lane: strands.lane.get(fork.scenes[0]) ?? 0, scenes: fork.scenes, people: fork.people, envelope: fork.envelope,
    splitFrom: fork.splitFrom ?? [], into: fork.into ?? null, intoAt: fork.intoAt ?? null, open: fork.open, past: Boolean(fork.past),
  }));
  const places: WorldPlace[] = Object.entries(played.places).map(([id, place]) => ({ id, label: place.label, scale: place.scale, parent: place.parent, unnamed: Boolean(place.unnamed) }));
  const checks: Record<string, number> = {};
  for (const check of strands.checks) checks[check.kind] = (checks[check.kind] ?? 0) + 1;
  const view: WorldView = {
    book: { id: open.book.id, title: open.book.title },
    time: (data.time?.tree ?? []).map((node) => ({ id: node.id, level: node.level, label: node.label, parent: node.parent })),
    places, scenes, strands: strandList, movables, checks,
  };
  kept.set(data, view);
  return view;
}
