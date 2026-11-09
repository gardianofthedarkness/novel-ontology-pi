/**
 * Models as code (milestones M10b–c): which of a book's things get a model of their own (nominate), what a writer needs
 * (brief), a model written by the work model (write) or handed in by an agent (put), held to the contract (check), or a
 * thing bound to a warehouse part (use). Models are kept per universe (<library>/universe/models; a copy without a
 * library keeps them in <novel>/stage/models): <id>.scad (the source of truth), <id>.off and <id>.mesh.json (derived),
 * catalog.json (one record a thing: state, size, checks, tries, who wrote it, tokens). A model is a look, never canon.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { setting, universeFor } from "../settings.js";
import { check, contractSettings, contractText } from "./contract.js";
import { evaluate, forPlayer, measure, readOff, solidOf, type Measure, type Solid } from "./scad.js";

/** Kinds that can have a model of their own, and kinds that take a warehouse part (small, handheld, many alike). */
export const OWN_KINDS = new Set(["a car", "a van or a truck", "a bus", "a train or a carriage", "a motorbike or a bicycle", "a boat", "a helicopter", "an aircraft", "a drone", "a robot or a machine", "a heavy weapon", "a sign or a screen", "furniture"]);
export const PART_KINDS = new Set(["a small weapon", "a handheld thing", "a bag or a box"]);
const BIG = new Set(["a helicopter", "an aircraft", "a train or a carriage", "a robot or a machine", "a heavy weapon", "a boat", "a bus"]);

export interface Prop { kind: string; shape?: string; size?: number[]; vehicle?: boolean; airborne?: number; sure?: number; evidence?: string[] }
export interface Nomination { label: string; id: string; kind: string; scenes: number; mentions: number; describing: number; importance: number; decision: "own" | "part"; why: string; size: number[] | null }
export interface Record_ { id: string; label: string; kind: string; state: "ok" | "failed" | "part"; by?: string; at: string; tries?: number; size?: [number, number, number]; triangles?: number; solid?: Solid; problems?: string[]; warnings?: string[]; part?: string; usage?: { prompt: number; completion: number; requests: number } }
export interface Catalog { version: 1; models: Record<string, Record_>; names: Record<string, string> }

export const idOf = (label: string) => { let h = 2166136261; for (const c of label) { h ^= c.codePointAt(0)!; h = Math.imul(h, 16777619); } return `m${(h >>> 0).toString(16).padStart(8, "0")}`; };

export function storeOf(novelDir: string): string { const universe = universeFor(resolve(novelDir)); return universe ? join(universe, "models") : join(resolve(novelDir), "stage", "models"); }
async function readJson<T>(file: string, fallback: T): Promise<T> { return JSON.parse(await readFile(file, "utf8").catch(() => "null")) ?? fallback; }
async function writeJson(file: string, value: unknown) { await mkdir(dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`); await rename(temporary, file); }
export const catalogOf = (novelDir: string) => readJson<Catalog>(join(storeOf(novelDir), "catalog.json"), { version: 1, models: {}, names: {} });

/** The book's things (the settei cast's labels: universe/props.json, else the book's own stage/props.json). */
export async function propsOf(novelDir: string): Promise<Record<string, Prop>> {
  const universe = universeFor(resolve(novelDir)), file = universe && existsSync(join(universe, "props.json")) ? join(universe, "props.json") : join(resolve(novelDir), "stage", "props.json");
  return (await readJson<{ labels?: Record<string, Prop> }>(file, {})).labels ?? {};
}

/** The reading the book was read into (for its scenes): --reading, else <novel>/../reading/data.json, else the director's reading path. */
export async function readingOf(novelDir: string, given?: string): Promise<{ scenes?: { id: string; sentences: string[] }[] }> {
  const candidates = [given, join(resolve(novelDir), "..", "reading", "data.json")];
  const path = JSON.parse(await readFile(join(resolve(novelDir), "stage", "director", "reading-path.json"), "utf8").catch(() => "null"))?.path;
  if (path) candidates.push(path);
  for (const file of candidates) if (file && existsSync(file)) return readJson(file, {});
  throw new Error(`No reading for ${novelDir}: give --reading <data.json>.`);
}

/**
 * Rank the book's things: importance (scenes, sentences, a vehicle, a big kind) and description (sentences that say more
 * than its name). A thing of a kind that can have its own model gets one when seen in enough scenes or named enough; the
 * rest, and the small kinds, take a warehouse part. No model call.
 */
export function nominate(props: Record<string, Prop>, sentences: Map<string, { text: string }>, sceneOf: Map<string, string>, options = setting<{ ownScenes: number; ownMentions: number; top: number }>("models.nominate")): Nomination[] {
  const rows: Nomination[] = [];
  const all = [...sentences.entries()];
  for (const [label, prop] of Object.entries(props)) {
    if (!OWN_KINDS.has(prop.kind) && !PART_KINDS.has(prop.kind)) continue;
    const ids = new Set(prop.evidence ?? []);
    if (label.length >= 2) for (const [id, sentence] of all) if (sentence.text.includes(label)) ids.add(id);
    const mentions = ids.size, scenes = new Set([...ids].map((id) => sceneOf.get(id)).filter(Boolean)).size;
    const describing = [...ids].filter((id) => (sentences.get(id)?.text.length ?? 0) - label.length >= 24).length;
    const importance = Math.round((scenes * 2 + Math.min(mentions, 30) * 0.5 + (prop.vehicle ? 2 : 0) + (BIG.has(prop.kind) ? 1 : 0) + Math.min(describing, 10) * 0.2) * 10) / 10;
    const own = OWN_KINDS.has(prop.kind) && (scenes >= options.ownScenes || mentions >= options.ownMentions);
    rows.push({ label, id: idOf(label), kind: prop.kind, scenes, mentions, describing, importance, decision: own ? "own" : "part", why: own ? `${prop.kind}, ${scenes} scenes, ${mentions} sentences` : OWN_KINDS.has(prop.kind) ? `seen too little (${scenes} scenes, ${mentions} sentences)` : `${prop.kind}: a warehouse part`, size: prop.size ?? null });
  }
  rows.sort((a, b) => b.importance - a.importance || a.label.localeCompare(b.label));
  let owned = 0;
  for (const row of rows) if (row.decision === "own" && ++owned > options.top) { row.decision = "part"; row.why = `beyond the book's top ${options.top}`; }
  return rows;
}

/** Everything a writer needs for one thing, bounded: its lines (most telling first), kind, size, the contract, the checks. */
export function briefOf(row: Nomination, sentences: Map<string, { text: string }>, extra: { record?: Record_ | null } = {}) {
  const lines = [...sentences.entries()].filter(([, s]) => s.text.includes(row.label)).map(([id, s]) => ({ id, text: s.text.length > 240 ? `${s.text.slice(0, 239)}…` : s.text })).sort((a, b) => b.text.length - a.text.length).slice(0, 6);
  return { thing: row.label, id: row.id, kind: row.kind, readingSize: row.size, decision: row.decision, scenes: row.scenes, mentions: row.mentions, lines, contract: contractText(), checks: ["on the ground", "its size against the reading's", "one piece", "a closed solid", "the triangle budget"], made: extra.record ? { state: extra.record.state, problems: extra.record.problems ?? [], tries: extra.record.tries ?? 0 } : null };
}

/** Hold a model's code to the contract: evaluate, measure, check; the record and the player's mesh when it passes. */
export async function checkModel(store: string, id: string, expected: { kind: string; size?: number[] | null }): Promise<{ ok: boolean; measure?: Measure; solid?: Solid; problems: string[]; warnings: string[] }> {
  const scad = join(store, `${id}.scad`), off = join(store, `${id}.off`);
  const run = evaluate(scad, off);
  if (!run.ok) return { ok: false, problems: [`OpenSCAD: ${run.error}`], warnings: [] };
  const mesh = readOff(off), m = measure(mesh), solid = await solidOf(mesh), checked = check(m, solid, expected);
  if (!checked.problems.length) await writeJson(join(store, `${id}.mesh.json`), forPlayer(mesh));
  return { ok: !checked.problems.length, measure: m, solid, ...checked };
}

/** Put a model's code in the store (the agent's own, or the work model's), check it, and record it in the catalog. */
export async function putModel(novelDir: string, row: { label: string; id: string; kind: string; size: number[] | null }, code: string, info: { by: string; tries?: number; usage?: Record_["usage"] }) {
  const store = storeOf(novelDir); await mkdir(store, { recursive: true });
  await writeFile(join(store, `${row.id}.scad`), code.endsWith("\n") ? code : `${code}\n`);
  const result = await checkModel(store, row.id, { kind: row.kind, size: row.size });
  const catalog = await catalogOf(novelDir), mesh = result.ok ? JSON.parse(await readFile(join(store, `${row.id}.mesh.json`), "utf8")) as { size: [number, number, number] } : null;
  const record: Record_ = { id: row.id, label: row.label, kind: row.kind, state: result.ok ? "ok" : "failed", by: info.by, at: new Date().toISOString(), tries: info.tries ?? 1, ...(mesh ? { size: mesh.size } : {}), ...(result.measure ? { triangles: result.measure.triangles } : {}), ...(result.solid ? { solid: result.solid } : {}), problems: result.problems, warnings: result.warnings, ...(info.usage ? { usage: info.usage } : {}) };
  catalog.models[row.id] = record; catalog.names[row.label] = row.id;
  await writeJson(join(store, "catalog.json"), catalog);
  return { record, ...result };
}

type Writer = { generateWithInfo(request: { system: string; prompt: string; maxTokens?: number; jsonSchema?: Record<string, unknown> }): Promise<{ text: string; usage: { promptTokens: number | null; completionTokens: number | null } }> };
/** The work model writes a thing's model from its brief; the check's problems go back to it, at most `tries` times. */
export async function writeModel(novelDir: string, row: Nomination, sentences: Map<string, { text: string }>, writer: Writer) {
  const brief = briefOf(row, sentences), tries = contractSettings().tries, usage = { prompt: 0, completion: 0, requests: 0 };
  let code = "", last: Awaited<ReturnType<typeof putModel>> | null = null, feedback = "";
  for (let n = 1; n <= tries; n++) {
    const prompt = [`The object: ${row.label} (${row.kind}).${row.size ? ` The reading puts its size at about ${row.size.map((v) => Math.round(v * 10) / 10).join(" × ")} m.` : ""}`, ...(row.kind === "a building" ? [BUILDING_BRIEF] : []), "The novel's lines about it:", ...brief.lines.map((line) => `- ${line.text}`), ...(feedback ? ["", "Your last code:", code, "", `The check failed: ${feedback}. Fix it and reply with the whole code again.`] : [])].join("\n");
    const reply = await writer.generateWithInfo({ system: brief.contract, prompt, maxTokens: 4000 });
    usage.prompt += reply.usage.promptTokens ?? 0; usage.completion += reply.usage.completionTokens ?? 0; usage.requests++;
    code = reply.text.replace(/^```\w*\n?/m, "").replace(/```\s*$/m, "").trim();
    last = await putModel(novelDir, row, code, { by: "work model", tries: n, usage });
    if (last.ok) break;
    feedback = last.problems.join("; ");
  }
  return last!;
}

export async function saveNominations(novelDir: string, rows: Nomination[]) { await writeJson(join(resolve(novelDir), "stage", "models", "nominations.json"), { at: new Date().toISOString(), rows }); }
export async function nominationsOf(novelDir: string): Promise<Nomination[]> { return (await readJson<{ rows?: Nomination[] }>(join(resolve(novelDir), "stage", "models", "nominations.json"), {})).rows ?? []; }

/**
 * The warehouse (milestones M10d): gkNextEngine's SCAD kits (MIT; kept beside our CC0 packs in
 * ~/claude-world-first/model-packs/gknextengine-scad, or NOVEL_SCAD_KITS) with their catalogue: every module's category,
 * footprint and height. A thing bound to a kit part (`kit:<module>`) is rendered from that module and checked like a model.
 */
export const KITS = process.env.NOVEL_SCAD_KITS ?? join(process.env.HOME ?? "", "claude-world-first", "model-packs", "gknextengine-scad");
export interface KitModule { name: string; kit: string; file: string; category: string; footprint: [number, number]; height: number; triangles: number }
let kitCache: KitModule[] | null = null;
export async function kitModules(): Promise<KitModule[]> {
  if (kitCache) return kitCache;
  const catalog = await readJson<{ kits?: { name: string; file: string; modules: { name: string; category: string; footprint: [number, number]; height: number; triangles: number; ok?: boolean; paramList?: unknown[] }[] }[] }>(join(KITS, "catalog.json"), {});
  kitCache = (catalog.kits ?? []).flatMap((kit) => kit.modules.filter((m) => m.ok !== false).map((m) => ({ name: m.name, kit: kit.name, file: kit.file, category: m.category, footprint: m.footprint, height: m.height, triangles: m.triangles })));
  return kitCache;
}
/** The kit categories a kind of thing may take a part from. */
export const KIT_CATEGORIES: Record<string, string[]> = { "a small weapon": ["wpn", "item"], "a handheld thing": ["item", "prop", "wpn"], "a bag or a box": ["item", "prop", "cargo"], "a heavy weapon": ["wpn", "veh", "prop"], "a car": ["veh", "vehicle"], "a van or a truck": ["veh", "vehicle"], "a bus": ["veh"], "a train or a carriage": ["veh"], "a boat": ["boat", "veh"], "a helicopter": ["veh"], "an aircraft": ["veh"], "a drone": ["veh", "prop"], "a robot or a machine": ["prop", "veh"], "a sign or a screen": ["prop"], "furniture": ["furn", "prop"] };

/** Render a kit module as a thing's model: a wrapper file that uses the kit and calls the module, checked like any model. */
export async function bindKit(novelDir: string, row: { label: string; id: string; kind: string; size: number[] | null }, moduleName: string, by: string) {
  const module = (await kitModules()).find((m) => m.name === moduleName);
  if (!module) throw new Error(`No kit module ${moduleName} (the catalogue at ${KITS})`);
  const store = storeOf(novelDir); await mkdir(store, { recursive: true });
  await writeFile(join(store, `${row.id}.scad`), `// ${row.id}: the kit part ${module.name} (${module.kit}, gkNextEngine, MIT)\nuse <${join(KITS, module.file)}>\nmodule thing() { ${module.name}(); }\nthing();\n`);
  // A part keeps its own size (a kit's pistol is a pistol): only the ground, the solid and the budget are held to the contract.
  const result = await checkModel(store, row.id, { kind: row.kind, size: null });
  const catalog = await catalogOf(novelDir), mesh = result.ok ? JSON.parse(await readFile(join(store, `${row.id}.mesh.json`), "utf8")) as { size: [number, number, number] } : null;
  const record: Record_ = { id: row.id, label: row.label, kind: row.kind, state: result.ok ? "part" : "failed", part: `kit:${module.name}`, by, at: new Date().toISOString(), ...(mesh ? { size: mesh.size } : {}), ...(result.measure ? { triangles: result.measure.triangles } : {}), ...(result.solid ? { solid: result.solid } : {}), problems: result.problems, warnings: result.warnings };
  catalog.models[row.id] = record; catalog.names[row.label] = row.id;
  await writeJson(join(store, "catalog.json"), catalog);
  return { record, ...result };
}

/**
 * Bind a thing to any warehouse part (`<source>:<part>`; src/v2/models/warehouse.ts): a kit module is rendered and checked
 * as `bindKit` does; a glTF, baked or own part's mesh is copied in as the thing's, at the part's own size.
 */
export async function bindPart(novelDir: string, row: { label: string; id: string; kind: string; size: number[] | null }, ref: string, by: string, why?: string) {
  if (ref.startsWith("kit:")) return bindKit(novelDir, row, ref.slice(4), by);
  const WH = await import("./warehouse.js"), part = await WH.partOf(ref, { novelDir }), mesh = part ? await WH.meshOfPart(ref, { novelDir }) : null;
  if (!part || !mesh) throw new Error(`No part ${ref} in the warehouse (novel warehouse find "<words>"; list shows the sources).`);
  const store = storeOf(novelDir); await mkdir(store, { recursive: true });
  await writeJson(join(store, `${row.id}.mesh.json`), mesh);
  const catalog = await catalogOf(novelDir);
  const record: Record_ = { id: row.id, label: row.label, kind: row.kind, state: "part", part: ref, by, at: new Date().toISOString(), size: mesh.size, triangles: mesh.t.length / 3, problems: [], warnings: [`${part.category}, ${part.unit === "kit" ? "kit units" : "metres"}${why ? `; bound: ${why}` : ""}`] };
  catalog.models[row.id] = record; catalog.names[row.label] = row.id;
  await writeJson(join(store, "catalog.json"), catalog);
  return { record, ok: true, problems: [] as string[], warnings: record.warnings ?? [] };
}

/** The work model picks a kit part for each thing that takes one (a shortlist by kind; "none" when nothing fits). */
export async function pickParts(rows: Nomination[], sentences: Map<string, { text: string }>, writer: Writer, batch = 15) {
  const modules = await kitModules(), picks: { id: string; module: string | null; ref?: string }[] = [], usage = { prompt: 0, completion: 0, requests: 0 };
  // The warehouse's slot for a kind (`models.parts`, novel warehouse use <part> for kind:<kind>; milestones M10i): a thing
  // of that kind takes the part the configuration names, and the work model is not asked about it.
  const slots = setting<Record<string, string | null>>("models.parts"), asked = rows.filter((row) => { const ref = slots[row.kind]; if (ref) { picks.push({ id: row.id, module: null, ref }); return false; } return true; });
  for (let n = 0; n < asked.length; n += batch) {
    const group = asked.slice(n, n + batch), categories = [...new Set(group.flatMap((row) => KIT_CATEGORIES[row.kind] ?? ["prop"]))];
    const shortlist = modules.filter((m) => categories.includes(m.category)).map((m) => `${m.name} (${m.category}, ${m.footprint.join("×")} m, ${m.height} m tall)`);
    const items = group.map((row) => { const line = [...sentences.values()].find((s) => s.text.includes(row.label))?.text ?? ""; return `${row.id}: ${row.label} (${row.kind})${line ? ` — ${line.slice(0, 120)}` : ""}`; });
    const reply = await writer.generateWithInfo({ system: "You match things from a novel to the closest 3D part in a parts library, or none when no part is that kind of thing. Reply with a JSON object {\"<id>\": \"<module name>\" | \"none\"} for every id given.", prompt: [`Parts (name, category, footprint, height):`, ...shortlist, "", "Things:", ...items].join("\n"), jsonSchema: { type: "object" }, maxTokens: 2000 });
    usage.prompt += reply.usage.promptTokens ?? 0; usage.completion += reply.usage.completionTokens ?? 0; usage.requests++;
    let answer: Record<string, string> = {}; try { answer = JSON.parse(reply.text); } catch { /* none picked */ }
    for (const row of group) { const name = answer[row.id]; picks.push({ id: row.id, module: name && name !== "none" && modules.some((m) => m.name === name) ? name : null }); }
  }
  return { picks, usage };
}

/** Check a kept model again (after the contract changed, or by hand) and update its record; no model call. */
export async function recheckModel(novelDir: string, row: { label: string; id: string; kind: string; size: number[] | null }) {
  const store = storeOf(novelDir), catalog = await catalogOf(novelDir), record = catalog.models[row.id];
  if (!record || !existsSync(join(store, `${row.id}.scad`))) return null;
  const part = record.part?.startsWith("kit:") ? record.part : null, result = await checkModel(store, row.id, { kind: row.kind, size: part ? null : row.size });
  const mesh = result.ok ? JSON.parse(await readFile(join(store, `${row.id}.mesh.json`), "utf8")) as { size: [number, number, number] } : null;
  catalog.models[row.id] = { ...record, state: result.ok ? (part ? "part" : "ok") : "failed", ...(mesh ? { size: mesh.size } : {}), ...(result.measure ? { triangles: result.measure.triangles } : {}), ...(result.solid ? { solid: result.solid } : {}), problems: result.problems, warnings: result.warnings, rechecked: new Date().toISOString() } as Record_;
  await writeJson(join(store, "catalog.json"), catalog);
  return { ...result, record: catalog.models[row.id] };
}

/**
 * Named landmarks (milestones M11): the terrain's building sites the text names (not a word like "the building" in a
 * scene), seen in enough scenes, nominated as "a building" with their use, the lot's footprint and floors as their size.
 */
export function nominateBuildings(sites: Record<string, { label?: string; scale?: string; kind?: string; size?: number[] }>, sentences: Map<string, { text: string }>, sceneOf: Map<string, string>, floorsOf: Record<string, number>, options = setting<{ ownScenes: number; ownMentions: number; top: number }>("models.nominate")): Nomination[] {
  const rows: Nomination[] = [], seen = new Set<string>(), all = [...sentences.entries()];
  for (const [id, site] of Object.entries(sites)) {
    const label = String(site.label ?? "");
    if (site.scale !== "building" || id.startsWith("unnamed:") || label.includes(" (scene ") || label.length < 2 || seen.has(label)) continue;
    seen.add(label);
    const ids = all.filter(([, s]) => s.text.includes(label)).map(([sid]) => sid), scenes = new Set(ids.map((sid) => sceneOf.get(sid)).filter(Boolean)).size;
    const floors = floorsOf[site.kind ?? ""] ?? 4, size = site.size?.length === 2 ? [site.size[0], site.size[1], floors * 3] : null;
    const own = scenes >= options.ownScenes || ids.length >= options.ownMentions;
    rows.push({ label, id: idOf(label), kind: "a building", scenes, mentions: ids.length, describing: ids.filter((sid) => (sentences.get(sid)?.text.length ?? 0) - label.length >= 24).length, importance: Math.round((scenes * 2 + Math.min(ids.length, 30) * 0.5 + 2) * 10) / 10, decision: own ? "own" : "part", why: own ? `a named ${site.kind ?? "building"}, ${scenes} scenes` : "a named building seen too little", size });
  }
  return rows;
}
export const BUILDING_BRIEF = "A building (a landmark the text names): its footprint about the lot's width × depth (x × y) and its height about its floors × 3 m unless the lines say otherwise; walls, rows of windows as shallow boxes, a roof, and the parts the lines name (a sign, a gate, a tower, a fence); its entrance toward -y; no interior. It is centred on x = 0, y = 0 and stands on z = 0.";

/** The store's usage ledger (usage.json): every write's or bind's work-model requests and tokens, for the cost line. */
export async function logUsage(novelDir: string, entry: { op: string; requests: number; prompt: number; completion: number; things: number }) {
  const file = join(storeOf(novelDir), "usage.json"), ledger = await readJson<{ entries: unknown[] }>(file, { entries: [] });
  ledger.entries.push({ at: new Date().toISOString(), ...entry });
  await writeJson(file, ledger);
}
