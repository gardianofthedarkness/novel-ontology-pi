/**
 * The routine shelf (the user, 2026-11-15: "Some of them are routine objects, make sure they are search come up enabled so
 * later books can always reuse them"): the warehouse's built-in source `routine`, outside every universe, holding models of
 * ordinary objects any book could have (a plastic bag, a bucket, a phone). Each is named at birth in plain English
 * (`plastic_shopping_bag`), the names books gave it kept beside it, so a later book's item is recalled by its English name or
 * by its own name, for nothing (the user, 2026-11-09: "custom build models be recalled at 100% without cost, if the exact
 * name is assigned at birth"); `novel warehouse find` reaches it by its words too. A model is written from the English name
 * and kind only, never from a book's lines, so it is any book's.
 *
 * On disk (`<packs>/routine`): `<name>.scad` (the truth), `meshes/<name>.mesh.json` (the player's mesh), `catalog.json` (our
 * catalogue shape: a part per model, its note the English words and every name given it), `names.json` (each name given it
 * → the model). The shelf is rebuilt by its own puts, never by `novel warehouse refresh`.
 */
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { evaluate, forPlayer, measure, readOff, solidOf } from "./scad.js";
import { check, contractSettings, contractText } from "./contract.js";
import { slugOf } from "./partRefs.js";

export const ROUTINE = "routine";
export const shelfDir = (packsRoot: string) => join(packsRoot, ROUTINE);

export interface ShelfPart { name: string; category: string; footprint: [number, number]; height: number; triangles: number; ok: boolean; file: string; note: string; by?: string; at?: string; usage?: { prompt: number; completion: number; requests: number } }
interface ShelfCatalogue { version: 1; kind: "own"; at: string; parts: ShelfPart[] }
type Names = Record<string, string>;

const readJson = <T>(file: string, fallback: T): T => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; } };
async function writeJson(file: string, value: unknown) { await mkdir(dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`); await rename(temporary, file); }
const catalogueOf = (dir: string) => readJson<ShelfCatalogue>(join(dir, "catalog.json"), { version: 1, kind: "own", at: "", parts: [] });
const namesOf = (dir: string) => readJson<Names>(join(dir, "names.json"), {});
/** A name as the shelf keys it: an English name's slug, a book's name as it is (trimmed). */
const keyOf = (name: string) => (/^[\x20-\x7e]+$/.test(name.trim()) ? slugOf(name) : name.trim());

/** The shelf's model for a name, exactly: its English name, or any name a book gave it; null when it has none. */
export function recall(dir: string, name: string): { ref: string; name: string; part: ShelfPart } | null {
  const want = keyOf(name), names = namesOf(dir), slug = names[want] ?? names[name.trim()] ?? want;
  const part = catalogueOf(dir).parts.find((entry) => entry.name === slug && entry.ok);
  return part ? { ref: `${ROUTINE}:${part.name}`, name: part.name, part } : null;
}

/** Keep another name for a model already on the shelf (a later book's own word for it), so it is recalled by that too. */
export async function addName(dir: string, model: string, name: string) {
  const catalogue = catalogueOf(dir), part = catalogue.parts.find((entry) => entry.name === model);
  if (!part) throw new Error(`No model ${model} on the routine shelf`);
  const names = namesOf(dir), key = keyOf(name);
  if (names[key] === model) return { model, name, added: false };
  names[key] = model;
  if (!part.note.split(" ").includes(name.trim())) part.note = `${part.note} ${name.trim()}`.trim();
  await writeJson(join(dir, "names.json"), names); await writeJson(join(dir, "catalog.json"), { ...catalogue, at: new Date().toISOString() });
  return { model, name, added: true };
}

/** The contract's check of a model's code, in a scratch folder: the mesh and measure when it passes, the problems when not. */
async function checked(code: string, expected: { kind: string; size?: number[] | null }) {
  const scratch = mkdtempSync(join(tmpdir(), "shelf-")), scad = join(scratch, "model.scad"), off = join(scratch, "model.off");
  await writeFile(scad, code.endsWith("\n") ? code : `${code}\n`);
  const run = evaluate(scad, off);
  if (!run.ok) return { ok: false as const, problems: [`OpenSCAD: ${run.error}`], warnings: [] as string[] };
  const raw = readOff(off);
  if (!raw.tris.length) return { ok: false as const, problems: ["no geometry"], warnings: [] as string[] };
  const m = measure(raw), solid = await solidOf(raw), found = check(m, solid, expected);
  return found.problems.length ? { ok: false as const, ...found } : { ok: true as const, mesh: forPlayer(raw), measure: m, ...found };
}

/**
 * Put a model on the shelf under its English name: checked to the contract, then its code, mesh and catalogue record kept,
 * and every name given (the English words and the books' names) recorded. A name already on the shelf is not replaced.
 */
export async function shelve(dir: string, model: { english: string; kind: string; names?: string[]; size?: number[] | null; code: string; by: string; usage?: ShelfPart["usage"] }) {
  const name = slugOf(model.english);
  if (!name) throw new Error("A routine model needs an English name");
  const catalogue = catalogueOf(dir);
  if (catalogue.parts.some((entry) => entry.name === name && entry.ok)) return { name, ok: true, kept: "already on the shelf", problems: [] as string[], warnings: [] as string[] };
  const result = await checked(model.code, { kind: model.kind, size: model.size ?? null });
  if (!result.ok) return { name, ok: false, problems: result.problems, warnings: result.warnings };
  await mkdir(join(dir, "meshes"), { recursive: true });
  await writeFile(join(dir, `${name}.scad`), model.code.endsWith("\n") ? model.code : `${model.code}\n`);
  await writeJson(join(dir, "meshes", `${name}.mesh.json`), result.mesh);
  const given = [...new Set([model.english.trim(), ...(model.names ?? []).map((entry) => entry.trim())].filter(Boolean))];
  const part: ShelfPart = { name, category: model.kind, footprint: [result.measure.size[0], result.measure.size[1]], height: result.measure.size[2], triangles: result.measure.triangles, ok: true, file: `${name}.scad`, note: given.join(" "), by: model.by, at: new Date().toISOString(), ...(model.usage ? { usage: model.usage } : {}) };
  catalogue.parts = [...catalogue.parts.filter((entry) => entry.name !== name), part];
  const names = namesOf(dir);
  for (const entry of given) names[keyOf(entry)] = name;
  await writeJson(join(dir, "catalog.json"), { ...catalogue, at: new Date().toISOString() }); await writeJson(join(dir, "names.json"), names);
  return { name, ok: true, problems: [] as string[], warnings: result.warnings };
}

/** The shelf's mesh for one of its models (the player's shape), or null. */
export const meshOf = (dir: string, name: string) => (existsSync(join(dir, "meshes", `${name}.mesh.json`)) ? readJson<{ p: number[]; t: number[]; c: number[]; size: [number, number, number] } | null>(join(dir, "meshes", `${name}.mesh.json`), null) : null);

type Writer = { modelId?: string; generateWithInfo(request: { system: string; prompt: string; maxTokens?: number; jsonSchema?: Record<string, unknown> }): Promise<{ text: string; usage: { promptTokens: number | null; completionTokens: number | null } }> };

export interface Sorted { name: string; object: boolean; routine: boolean; english: string; state?: "broken"; kind: string; size: [number, number, number] | null }
/**
 * The work model, once for a book's items: which are things at all (not a substance, a sum of money, a document's contents
 * or a part of a body), which of those are routine (an ordinary object any story could have) and which this story's own
 * (named, unique, made for it), each with a plain English name, its kind, and a typical size. A damaged or broken one is
 * the same object in a state (its English name the object's, `state` "broken"), so it takes the same model.
 * (The first sort of volume 1, 2026-11-15: blood, a sum of money and a "broken phone" beside the phone came back as objects.)
 */
export async function sortItems(items: { name: string; kind?: string | null; lines?: string[] }[], writer: Writer) {
  const schema = { type: "object", properties: { items: { type: "array", items: { type: "object", properties: { index: { type: "integer" }, object: { type: "boolean" }, routine: { type: "boolean" }, english: { type: "string" }, state: { type: "string" }, kind: { type: "string" }, size: { type: "array", items: { type: "number" } } }, required: ["index", "object", "routine", "english", "kind", "size"] } } }, required: ["items"] };
  const prompt = [
    "Things named in a novel, to be shown as 3D objects. For each, say:",
    "- object: false when it is not a solid object one could hold or set down: a substance or liquid on its own (blood, water),",
    "  a sum of money as an amount, the contents of a text, a part of a body, a sound, a light. Otherwise true.",
    "- routine: true when it is an ordinary object any story could have (a plastic bag, a bucket, a phone, a kitchen knife);",
    "  false when it is this story's own (a named or unique thing, a special weapon or device made for this story).",
    "- english: a plain, generic English name for the object, two to four words, lower case, as a catalogue would list it",
    "  (\"plastic shopping bag\", \"folding umbrella\"); the same object in any book should get the same name.",
    "- state: \"broken\" when the name is a damaged or broken one of an object; its english is then the whole object's name",
    "  (a broken phone: english \"mobile phone\", state \"broken\"). Otherwise leave it out.",
    "- kind: a few words for what sort of thing it is (\"a bag or a box\", \"a handheld thing\", \"a small weapon\", \"furniture\").",
    "- size: its typical size in metres, [length, height, width].",
    "Give back every thing by its number: {\"items\": [{\"index\": 1, \"object\": true, \"routine\": true, \"english\": \"...\", \"kind\": \"...\", \"size\": [l, h, w]}, ...]}.",
    "",
    ...items.map((item, n) => `${n + 1}. ${item.name}${item.kind ? ` (${item.kind})` : ""}${item.lines?.length ? `: ${item.lines.slice(0, 2).join(" / ")}` : ""}`),
  ].join("\n");
  const reply = await writer.generateWithInfo({ system: "You sort the objects of a novel for a 3D model warehouse. Reply in JSON.", prompt, maxTokens: 4000, jsonSchema: schema });
  // The answer by each object's number (a model may rewrite names); an array or {items: [...]} alike.
  const parsed = JSON.parse(reply.text.replace(/^```\w*\n?/m, "").replace(/```\s*$/m, "").trim()) as { items?: (Omit<Sorted, "name"> & { index?: number })[] } | (Omit<Sorted, "name"> & { index?: number })[];
  const rows = Array.isArray(parsed) ? parsed : parsed.items ?? [];
  const byIndex = new Map(rows.map((row, n) => [Number(row.index ?? n + 1), row]));
  const sorted = items.map((item, n) => { const row = byIndex.get(n + 1); return row && typeof row.english === "string" ? { name: item.name, object: row.object !== false, routine: row.object !== false && !!row.routine, english: row.english.trim().toLowerCase(), ...(row.state === "broken" ? { state: "broken" as const } : {}), kind: row.kind ?? item.kind ?? "a thing", size: Array.isArray(row.size) && row.size.length === 3 ? row.size as [number, number, number] : null } : null; }).filter((row): row is Sorted => !!row);
  return { sorted, usage: { prompt: reply.usage.promptTokens ?? 0, completion: reply.usage.completionTokens ?? 0, requests: 1 } };
}

/** The work model writes a routine model from its English name, kind and typical size only (no book's lines), checked to the contract. */
export async function writeRoutine(dir: string, item: { english: string; kind: string; size: [number, number, number] | null; names: string[] }, writer: Writer) {
  const tries = contractSettings().tries, usage = { prompt: 0, completion: 0, requests: 0 };
  let code = "", feedback = "", last: Awaited<ReturnType<typeof shelve>> | null = null;
  for (let n = 1; n <= tries; n++) {
    const prompt = [`The object: ${item.english} (${item.kind}), an ordinary one, as anyone would recognise it.${item.size ? ` Typical size about ${item.size.map((v) => Math.round(v * 100) / 100).join(" × ")} m.` : ""}`,
      `Begin the code with one comment line: // ${item.english}`,
      ...(feedback ? ["", "Your last code:", code, "", `The check failed: ${feedback}. Fix it and reply with the whole code again.`] : [])].join("\n");
    const reply = await writer.generateWithInfo({ system: contractText(), prompt, maxTokens: 4000 });
    usage.prompt += reply.usage.promptTokens ?? 0; usage.completion += reply.usage.completionTokens ?? 0; usage.requests++;
    code = reply.text.replace(/^```\w*\n?/m, "").replace(/```\s*$/m, "").trim();
    last = await shelve(dir, { english: item.english, kind: item.kind, names: item.names, size: item.size, code, by: `work model${writer.modelId ? ` ${writer.modelId}` : ""}`, usage: { ...usage } });
    if (last.ok) break;
    feedback = last.problems.join("; ");
  }
  return { ...last!, usage };
}
