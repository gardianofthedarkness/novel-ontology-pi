/**
 * `novel model nominate|list|brief|write|put|check|use|show` (milestones M10; docs/v3/design.html#models-and-settings §3): the
 * book's important things as OpenSCAD models, nominated without a model call, written by the work model (`write`) or by
 * the agent itself (`brief`, then `put`), every one held to the contract (`check`). JSON out, bounded.
 */
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { workModelFromEnv } from "../../../ground/connectors/workModel.js";
import { bindKit, bindPart, logUsage, nominateBuildings, recheckModel, briefOf, catalogOf, checkModel, idOf, kitModules, KIT_CATEGORIES, nominate, nominationsOf, pickParts, propsOf, putModel, readingOf, saveNominations, storeOf, writeModel, type Nomination } from "../../../v2/models/models.js";
import { loadWorkspaceSentences } from "./timeplaceCommands.js";
import { PART_REF } from "../../../v2/models/partRefs.js";

async function sceneMap(novelDir: string, reading?: string) {
  const data = await readingOf(novelDir, reading), out = new Map<string, string>();
  for (const scene of data.scenes ?? []) for (const id of scene.sentences ?? []) out.set(id, scene.id);
  return out;
}
async function rowOf(novelDir: string, thing: string): Promise<Nomination> {
  const rows = await nominationsOf(novelDir), row = rows.find((entry) => entry.label === thing || entry.id === thing);
  if (row) return row;
  const props = await propsOf(novelDir), prop = props[thing];
  if (prop) return { label: thing, id: idOf(thing), kind: prop.kind, scenes: 0, mentions: 0, describing: 0, importance: 0, decision: "own", why: "named by hand", size: prop.size ?? null };
  throw new Error(`No thing "${thing}" in the nominations or the book's things: novel model list ${novelDir}`);
}

export async function modelNominate(novelDir: string, options: { reading?: string; top?: number } = {}) {
  const [props, sentences, sceneOf] = await Promise.all([propsOf(novelDir), loadWorkspaceSentences(novelDir), sceneMap(novelDir, options.reading)]);
  const settings = (await import("../../../v2/settings.js")).setting<{ ownScenes: number; ownMentions: number; top: number }>("models.nominate");
  const terrain = JSON.parse(await readFile(join(resolve(novelDir), "stage", "terrain.json"), "utf8").catch(() => "null")) as { sites?: Record<string, { label?: string; scale?: string; kind?: string; size?: number[] }> } | null;
  const floorsOf = (await import("../../../v2/settings.js")).setting<Record<string, number>>("buildings.floorsOf");
  const things = nominate(props, sentences as Map<string, { text: string }>, sceneOf, { ...settings, ...(options.top ? { top: options.top } : {}) });
  const buildings = nominateBuildings(terrain?.sites ?? {}, sentences as Map<string, { text: string }>, sceneOf, floorsOf, settings);
  const rows = [...things, ...buildings].sort((a, b) => b.importance - a.importance);
  await saveNominations(novelDir, rows);
  const own = rows.filter((row) => row.decision === "own");
  return { things: things.length, buildings: buildings.length, buildingsOwn: buildings.filter((row) => row.decision === "own").length, own: own.length, part: rows.length - own.length, store: storeOf(novelDir), top: rows.slice(0, 25).map(({ label, id, kind, scenes, mentions, importance, decision }) => ({ label, id, kind, scenes, mentions, importance, decision })), next: own.length ? `novel model brief ${novelDir} ${own[0].id}  (or: novel model write ${novelDir} --all)` : null };
}

export async function modelList(novelDir: string, options: { state?: string } = {}) {
  const rows = await nominationsOf(novelDir), catalog = await catalogOf(novelDir);
  const listed = rows.map((row) => { const made = catalog.models[row.id]; return { label: row.label, id: row.id, kind: row.kind, decision: row.decision, importance: row.importance, state: (made?.state ?? (row.decision === "own" ? "todo" : "part to bind")) as string, ...(made?.part ? { part: made.part } : {}), ...(made?.problems?.length ? { problems: made.problems.slice(0, 2) } : {}) }; });
  const wanted = options.state ? listed.filter((row) => (options.state === "made" ? row.state === "ok" : row.state.startsWith(options.state!))) : listed;
  return { count: wanted.length, made: listed.filter((row) => row.state === "ok").length, failed: listed.filter((row) => row.state === "failed").length, todo: listed.filter((row) => row.state === "todo").length, rows: wanted.slice(0, 80) };
}

export async function modelBrief(novelDir: string, thing: string) {
  const row = await rowOf(novelDir, thing), sentences = await loadWorkspaceSentences(novelDir), catalog = await catalogOf(novelDir);
  return { ...briefOf(row, sentences as Map<string, { text: string }>, { record: catalog.models[row.id] ?? null }), put: `novel model put ${novelDir} ${row.id} <file.scad>   (or - to read the code from stdin)` };
}

export async function modelWrite(novelDir: string, thing: string | null, options: { all?: boolean; limit?: number } = {}) {
  const writer = workModelFromEnv(), sentences = (await loadWorkspaceSentences(novelDir)) as Map<string, { text: string }>, catalog = await catalogOf(novelDir);
  const rows = thing ? [await rowOf(novelDir, thing)] : (await nominationsOf(novelDir)).filter((row) => row.decision === "own" && catalog.models[row.id]?.state !== "ok").slice(0, options.limit ?? Infinity);
  if (!rows.length) return { written: 0, note: "nothing to write: every nominated thing has a model (novel model list)" };
  const out = [], usage = { prompt: 0, completion: 0, requests: 0 };
  for (const row of rows) {
    const made = await writeModel(novelDir, row, sentences, writer);
    usage.prompt += made.record.usage?.prompt ?? 0; usage.completion += made.record.usage?.completion ?? 0; usage.requests += made.record.usage?.requests ?? 0;
    out.push({ label: row.label, id: row.id, kind: row.kind, state: made.record.state, tries: made.record.tries, size: made.record.size ?? null, triangles: made.record.triangles ?? null, problems: made.record.problems, warnings: made.record.warnings });
  }
  await logUsage(novelDir, { op: "write", ...usage, things: rows.length });
  return { written: out.filter((row) => row.state === "ok").length, failed: out.filter((row) => row.state === "failed").length, model: writer.modelId, usage, rows: out };
}

export async function modelPut(novelDir: string, thing: string, source: string, options: { by?: string } = {}) {
  const row = await rowOf(novelDir, thing), code = source === "-" ? await new Promise<string>((done) => { let text = ""; process.stdin.on("data", (chunk) => (text += chunk)); process.stdin.on("end", () => done(text)); }) : await readFile(resolve(source), "utf8");
  const made = await putModel(novelDir, row, code, { by: options.by ?? process.env.NOVEL_AGENT ?? "agent" });
  return { label: row.label, id: row.id, state: made.record.state, size: made.record.size ?? null, triangles: made.record.triangles ?? null, solid: made.record.solid ?? null, problems: made.record.problems, warnings: made.record.warnings, next: made.record.state === "ok" ? null : `fix the code and put it again (novel model brief ${novelDir} ${row.id} says the rules)` };
}

export async function modelCheck(novelDir: string, thing: string | null) {
  const rows = thing ? [await rowOf(novelDir, thing)] : (await nominationsOf(novelDir)).filter((row) => true), out = [];
  const catalog = await catalogOf(novelDir);
  for (const row of rows) {
    if (!catalog.models[row.id]) continue;
    const result = await recheckModel(novelDir, row);
    if (result) out.push({ label: row.label, id: row.id, ok: result.ok, state: result.record.state, size: result.record.size ?? null, problems: result.problems, warnings: result.warnings });
  }
  return thing ? out[0] ?? { label: thing, note: "no model kept for it" } : { checked: out.length, ok: out.filter((row) => row.ok).length, failed: out.filter((row) => !row.ok).length, rows: out };
}

export async function modelUse(novelDir: string, thing: string, part: string, options: { why?: string } = {}) {
  if (!PART_REF.test(part)) throw new Error("A part is <source>:<part>: kit:<module> (gkNextEngine's SCAD kits), pack:<model> (the baked CC0 packs), own:<id>, or a source registered with novel warehouse add (novel warehouse find \"<words>\").");
  const row = await rowOf(novelDir, thing);
  const made = await bindPart(novelDir, row, part, process.env.NOVEL_AGENT ?? "agent", options.why);
  return { label: row.label, id: row.id, part, state: made.record.state, size: made.record.size ?? null, problems: made.record.problems, warnings: made.record.warnings };
}

export async function modelShow(novelDir: string, thing: string) {
  const row = await rowOf(novelDir, thing), catalog = await catalogOf(novelDir), record = catalog.models[row.id] ?? null;
  const code = await readFile(join(storeOf(novelDir), `${row.id}.scad`), "utf8").catch(() => null);
  return { nomination: row, record, code };
}

/** The work model binds the things that take a part to the closest kit part (or none), each rendered and checked. */
export async function modelBind(novelDir: string, options: { limit?: number } = {}) {
  const writer = workModelFromEnv(), sentences = (await loadWorkspaceSentences(novelDir)) as Map<string, { text: string }>, catalog = await catalogOf(novelDir);
  const rows = (await nominationsOf(novelDir)).filter((row) => row.decision === "part" && !catalog.models[row.id]).slice(0, options.limit ?? Infinity);
  if (!rows.length) return { bound: 0, note: "nothing to bind (novel model list --state part)" };
  const { picks, usage } = await pickParts(rows, sentences, writer), out = [];
  for (const pick of picks) {
    const row = rows.find((entry) => entry.id === pick.id)!;
    if (!pick.module && !pick.ref) { out.push({ label: row.label, id: row.id, kind: row.kind, part: null }); continue; }
    const made = pick.ref ? await bindPart(novelDir, row, pick.ref, "the configuration (models.parts)") : await bindKit(novelDir, row, pick.module!, "work model");
    out.push({ label: row.label, id: row.id, kind: row.kind, part: pick.ref ?? pick.module, state: made.record.state, problems: made.record.problems });
  }
  await logUsage(novelDir, { op: "bind", ...usage, things: rows.length });
  return { asked: rows.length, bound: out.filter((row) => (row as { state?: string }).state === "part").length, none: out.filter((row) => !row.part).length, failed: out.filter((row) => (row as { state?: string }).state === "failed").length, usage, rows: out };
}

/** The kit parts a kind of thing may take (for an agent choosing by hand). */
export async function modelParts(kind: string) {
  const categories = KIT_CATEGORIES[kind] ?? ["prop"], modules = (await kitModules()).filter((m) => categories.includes(m.category));
  return { kind, categories, count: modules.length, parts: modules.slice(0, 120).map((m) => ({ name: m.name, kit: m.kit, category: m.category, footprint: m.footprint, height: m.height })) };
}
