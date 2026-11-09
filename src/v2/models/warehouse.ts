/**
 * The model warehouse (milestones M10g–i; docs/v2/models-and-settings.md §8.3–8.4): one registry of sources outside any
 * library (`~/claude-world-first/model-packs/warehouse.json`, or NOVEL_WAREHOUSE), each a folder of SCAD kits or glTF
 * files with a catalogue of evaluated records in gkNextEngine's shape (name, category, footprint, height, triangles,
 * ok), built here with OpenSCAD and the playground's glTF reader. A part is `<source>:<part>`; `kit` (gkNextEngine's
 * kits), `pack` (the baked CC0 packs) and `own` (the universe's models) are the built-in sources. Parts are searched
 * (`find`), drawn (`meshOfPart`, the player's mesh shape) and connected to the world's settings (`usePart`). Nothing
 * here asks a model; a licence outside the allowed set needs the user's recorded OK.
 */
import { existsSync, mkdtempSync, readdirSync, readFileSync, statSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { evaluate, forPlayer, measure, readOff, solidOf } from "./scad.js";
import { KIT_CATEGORIES, KITS, catalogOf, storeOf } from "./models.js";
import { PART_REF, idOfRef, splitRef } from "./partRefs.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
export const PACKS_ROOT = process.env.NOVEL_MODEL_PACKS ?? join(process.env.HOME ?? "", "claude-world-first", "model-packs");
export const REGISTRY_FILE = process.env.NOVEL_WAREHOUSE ?? join(PACKS_ROOT, "warehouse.json");
/** Licences a source may carry without asking (the user, 2026-11-01 CC0; 2026-11-09 MIT; permissive ones alike; CC-BY with its attribution kept). */
export const ALLOWED_LICENCES = ["CC0-1.0", "MIT", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause", "CC-BY-4.0"];
const BAKED_DIR = join(ROOT, "apps", "playground", "src", "data");

export type SourceKind = "scad" | "gltf" | "baked" | "own";
export interface Source { kind: SourceKind; path: string; licence: string; url?: string | null; fetched?: string; by?: string; note?: string; categories?: Record<string, string>; unit?: "m" | "kit"; builtIn?: boolean }
export interface Registry { version: 1; sources: Record<string, Source> }
export interface Part { ref: string; source: string; name: string; category: string; footprint: [number, number]; height: number; triangles: number; ok: boolean; file?: string; params?: string; unit: "m" | "kit"; note?: string }
export interface Mesh { p: number[]; t: number[]; c: number[]; size: [number, number, number] }
interface OurCatalogue { version: 1; kind: SourceKind; at: string; parts: Omit<Part, "ref" | "source" | "unit">[] }
interface GkCatalogue { kits?: { name: string; file: string; modules: { name: string; category: string; footprint: [number, number]; height: number; triangles: number; ok?: boolean; params?: string }[] }[] }

const readJson = <T>(file: string, fallback: T): T => { try { return JSON.parse(readFileSync(file, "utf8")) as T; } catch { return fallback; } };
async function writeJson(file: string, value: unknown) { await mkdir(dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`; await writeFile(temporary, `${JSON.stringify(value, null, 1)}\n`); await rename(temporary, file); }
const absolute = (path: string) => (path.startsWith("/") ? path : join(PACKS_ROOT, path));

/** The built-in sources: gkNextEngine's kits, the baked CC0 packs and (per universe) our own models. */
function builtIn(): Record<string, Source> {
  return {
    kit: { kind: "scad", path: KITS, licence: "MIT", url: "https://github.com/gameknife/gkNextEngine", note: "gkNextEngine's SCAD kits (assets/scad/lib)", unit: "m", builtIn: true },
    pack: { kind: "baked", path: BAKED_DIR, licence: "CC0-1.0", url: "https://kenney.nl, https://kaylousberg.itch.io, https://quaternius.com", note: "the baked CC0 packs (architectureModels.json, vehicleModels.json)", unit: "kit", builtIn: true },
  };
}
export function readRegistry(): Registry {
  const stored = readJson<Registry>(REGISTRY_FILE, { version: 1, sources: {} });
  return { version: 1, sources: { ...builtIn(), ...Object.fromEntries(Object.entries(stored.sources ?? {}).filter(([name]) => !(name in builtIn()))) } };
}
async function writeRegistry(registry: Registry) { await writeJson(REGISTRY_FILE, { version: 1, sources: Object.fromEntries(Object.entries(registry.sources).filter(([, source]) => !source.builtIn)) }); }

/** A source's parts (gk's catalogue shape or ours), with their references. */
export function catalogueOf(name: string, source: Source): Part[] {
  const path = absolute(source.path), unit = source.unit ?? "m";
  if (source.kind === "baked") {
    const out: Part[] = [];
    for (const [file, category] of [["architectureModels.json", "bldg"], ["vehicleModels.json", "veh"]] as const) {
      const library = readJson<{ models?: Record<string, { size: [number, number, number] }> }>(join(path, file), {});
      for (const [id, model] of Object.entries(library.models ?? {})) out.push({ ref: `${name}:${id}`, source: name, name: id, category, footprint: [model.size[0], model.size[2]], height: model.size[1], triangles: 0, ok: true, file, unit: "kit" });
    }
    return out;
  }
  const file = join(path, "catalog.json"), raw = readJson<OurCatalogue & GkCatalogue>(file, { version: 1, kind: source.kind, at: "", parts: [] });
  if (raw.kits) return raw.kits.flatMap((kit) => kit.modules.map((m) => ({ ref: `${name}:${m.name}`, source: name, name: m.name, category: m.category, footprint: m.footprint, height: m.height, triangles: m.triangles, ok: m.ok !== false, file: kit.file, params: m.params, unit })));
  return (raw.parts ?? []).map((part) => ({ ...part, ref: `${name}:${part.name}`, source: name, unit }));
}

/** Our own models of a universe, as a source (`own:<id>`), where a novel is given. */
export async function ownParts(novelDir: string): Promise<Part[]> {
  const catalog = await catalogOf(novelDir);
  return Object.values(catalog.models).filter((record) => record.state === "ok" && record.size).map((record) => ({ ref: `own:${record.id}`, source: "own", name: record.id, category: record.kind, footprint: [record.size![0], record.size![2]], height: record.size![1], triangles: record.triangles ?? 0, ok: true, note: record.label, unit: "m" as const }));
}

/** Every part of every source (and the universe's own, given a novel). */
export async function partsOf(options: { source?: string; novelDir?: string } = {}): Promise<Part[]> {
  const registry = readRegistry(), out: Part[] = [];
  for (const [name, source] of Object.entries(registry.sources)) if (!options.source || options.source === name) out.push(...catalogueOf(name, source));
  if (options.novelDir && (!options.source || options.source === "own")) out.push(...(await ownParts(options.novelDir)));
  return out;
}

/** The sources with their counts by category. */
export async function listSources(options: { source?: string; novelDir?: string } = {}) {
  const registry = readRegistry(), rows = [];
  for (const [name, source] of Object.entries(registry.sources)) {
    if (options.source && options.source !== name) continue;
    const parts = catalogueOf(name, source), categories: Record<string, number> = {};
    for (const part of parts) categories[part.category] = (categories[part.category] ?? 0) + 1;
    rows.push({ name, kind: source.kind, path: absolute(source.path), licence: source.licence, url: source.url ?? null, fetched: source.fetched ?? null, parts: parts.length, ok: parts.filter((part) => part.ok).length, categories, builtIn: !!source.builtIn, note: source.note ?? null });
  }
  if (options.novelDir && (!options.source || options.source === "own")) { const own = await ownParts(options.novelDir); rows.push({ name: "own", kind: "own", path: storeOf(options.novelDir), licence: "ours", url: null, fetched: null, parts: own.length, ok: own.length, categories: Object.fromEntries([...new Set(own.map((part) => part.category))].map((kind) => [kind, own.filter((part) => part.category === kind).length])), builtIn: true, note: "the universe's own models (novel model write|put)" }); }
  return { registry: REGISTRY_FILE, packs: PACKS_ROOT, allowedLicences: ALLOWED_LICENCES, sources: rows };
}

// ---- building a catalogue ----------------------------------------------------------------------------------------

const list = (dir: string, extensions: string[], depth = 3): string[] => {
  if (!existsSync(dir) || depth < 0) return [];
  return readdirSync(dir).flatMap((entry) => { const file = join(dir, entry); const info = statSync(file); return info.isDirectory() ? (entry.startsWith(".") || entry === "meshes" || entry === "node_modules" ? [] : list(file, extensions, depth - 1)) : extensions.includes(extname(entry).toLowerCase()) ? [file] : []; });
};
/** The category of a module from its name (gkNextEngine's contract: the second segment), else the source's map, else misc. */
export function categoryOf(name: string, categories: Record<string, string> = {}): string {
  for (const [pattern, category] of Object.entries(categories)) if (new RegExp(pattern, "i").test(name)) return category;
  const segments = name.split("_").filter(Boolean);
  return segments.length >= 3 ? segments[1].toLowerCase() : "misc";
}
/** The modules of a .scad file that stand alone: no parameter, or every parameter with a default. */
export function modulesOf(code: string): { name: string; params: string }[] {
  const out: { name: string; params: string }[] = [];
  for (const m of code.matchAll(/^\s*module\s+([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)/gm)) {
    const name = m[1], params = m[2].trim();
    if (name.startsWith("_")) continue;
    const needed = params ? params.split(",").map((p) => p.trim()).filter(Boolean).filter((p) => !p.includes("=")) : [];
    if (!needed.length) out.push({ name, params });
  }
  return out;
}
const meshFile = (path: string, name: string) => join(path, "meshes", `${name.replace(/[^\w.-]/g, "_")}.mesh.json`);

/** Evaluate one module of a kit file with OpenSCAD to the player's mesh, measured; null with the error when it fails. */
async function renderModule(file: string, name: string): Promise<{ mesh: Mesh; footprint: [number, number]; height: number; zMin: number; triangles: number; closed: boolean; pieces: number } | { error: string }> {
  const dir = mkdtempSync(join(tmpdir(), "warehouse-")), scad = join(dir, "part.scad"), off = join(dir, "part.off");
  await writeFile(scad, `use <${file}>\n${name}();\n`);
  const run = evaluate(scad, off, 180_000);
  if (!run.ok) return { error: run.error };
  const raw = readOff(off);
  if (!raw.tris.length) return { error: "no geometry" };
  const m = measure(raw), solid = await solidOf(raw);
  return { mesh: forPlayer(raw), footprint: [m.size[0], m.size[1]], height: m.size[2], zMin: m.zMin, triangles: m.triangles, closed: solid.closed, pieces: solid.pieces };
}

async function catalogueScad(path: string, categories: Record<string, string> = {}, onPart?: (part: string) => void): Promise<OurCatalogue> {
  const parts: OurCatalogue["parts"] = [];
  for (const file of list(path, [".scad"])) {
    const code = readFileSync(file, "utf8");
    for (const { name, params } of modulesOf(code)) {
      const made = await renderModule(file, name);
      if ("error" in made) { parts.push({ name, category: categoryOf(name, categories), footprint: [0, 0], height: 0, triangles: 0, ok: false, file: relative(path, file), params, note: made.error.slice(0, 160) }); continue; }
      await writeJson(meshFile(path, name), made.mesh);
      parts.push({ name, category: categoryOf(name, categories), footprint: made.footprint, height: made.height, triangles: made.triangles, ok: made.closed && made.zMin > -0.05 * Math.max(1, made.height), file: relative(path, file), params, ...(made.closed ? {} : { note: "not a closed solid" }), ...(made.zMin <= -0.05 * Math.max(1, made.height) ? { note: `below the ground (z = ${made.zMin})` } : {}) });
      onPart?.(name);
    }
  }
  return { version: 1, kind: "scad", at: new Date().toISOString(), parts };
}

// A glTF/GLB reader (apps/playground/tools/architecture-models-add.mjs, in TypeScript): positions and triangles of a file.
type Gltf = { gltf: { nodes: { mesh?: number; children?: number[]; matrix?: number[]; rotation?: number[]; scale?: number[]; translation?: number[] }[]; meshes: { primitives: { attributes: { POSITION: number; COLOR_0?: number }; indices?: number; material?: number }[] }[]; materials?: { pbrMetallicRoughness?: { baseColorFactor?: number[] } }[]; accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number; type: string; normalized?: boolean }[]; bufferViews: { buffer?: number; byteOffset?: number; byteStride?: number }[]; buffers?: { uri: string }[]; scenes: { nodes: number[] }[]; scene?: number }; buffers: Buffer[] };
function readGltf(file: string): Gltf {
  const bytes = readFileSync(file);
  if (bytes.readUInt32LE(0) === 0x46546c67) {
    const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")), binStart = 20 + jsonLength + 8;
    return { gltf, buffers: [bytes.subarray(binStart, binStart + bytes.readUInt32LE(20 + jsonLength))] };
  }
  const gltf = JSON.parse(bytes.toString("utf8"));
  return { gltf, buffers: (gltf.buffers ?? []).map((buffer: { uri: string }) => (buffer.uri.startsWith("data:") ? Buffer.from(buffer.uri.split(",")[1], "base64") : readFileSync(join(dirname(file), decodeURIComponent(buffer.uri))))) };
}
const multiply = (a: number[], b: number[]) => { const out = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return out; };
function local(node: Gltf["gltf"]["nodes"][number]): number[] {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const SIZES: Record<string, number> = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }, BYTES: Record<number, number> = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 }, SCALE: Record<number, number> = { 5120: 127, 5121: 255, 5122: 32767, 5123: 65535, 5125: 0, 5126: 0 };
function accessor(model: Gltf, index: number): number[] {
  const entry = model.gltf.accessors[index], view = model.gltf.bufferViews[entry.bufferView], bin = model.buffers[view.buffer ?? 0];
  const size = SIZES[entry.type], bytes = BYTES[entry.componentType], stride = view.byteStride ?? size * bytes, start = (view.byteOffset ?? 0) + (entry.byteOffset ?? 0), out: number[] = [];
  const read = (at: number) => entry.componentType === 5120 ? bin.readInt8(at) : entry.componentType === 5121 ? bin.readUInt8(at) : entry.componentType === 5122 ? bin.readInt16LE(at) : entry.componentType === 5123 ? bin.readUInt16LE(at) : entry.componentType === 5125 ? bin.readUInt32LE(at) : bin.readFloatLE(at);
  for (let item = 0; item < entry.count; item++) for (let part = 0; part < size; part++) { const value = read(start + item * stride + part * bytes); out.push(entry.normalized && SCALE[entry.componentType] ? Math.max(value / SCALE[entry.componentType], -1) : value); }
  return out;
}
/** A glTF file as the player's mesh: Y-up, standing on y = 0, centred on x and z; a colour a triangle from the material, grey where none. */
export function meshOfGltf(file: string): Mesh {
  const model = readGltf(file), p: number[] = [], t: number[] = [], c: number[] = [];
  const visit = (nodeIndex: number, parent: number[]) => {
    const node = model.gltf.nodes[nodeIndex], matrix = multiply(parent, local(node));
    for (const primitive of node.mesh === undefined ? [] : model.gltf.meshes[node.mesh].primitives) {
      const at = p.length / 3, points = accessor(model, primitive.attributes.POSITION), base = model.gltf.materials?.[primitive.material ?? -1]?.pbrMetallicRoughness?.baseColorFactor ?? [0.78, 0.78, 0.78, 1];
      for (let i = 0; i < points.length; i += 3) { const [x, y, z] = points.slice(i, i + 3); p.push(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]); }
      const triangles = primitive.indices === undefined ? Array.from({ length: points.length / 3 }, (_, i) => i) : accessor(model, primitive.indices);
      for (let i = 0; i + 2 < triangles.length; i += 3) { t.push(at + triangles[i], at + triangles[i + 1], at + triangles[i + 2]); c.push(Math.round(base[0] * 255), Math.round(base[1] * 255), Math.round(base[2] * 255)); }
    }
    for (const child of node.children ?? []) visit(child, matrix);
  };
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
  for (const nodeIndex of model.gltf.scenes[model.gltf.scene ?? 0].nodes) visit(nodeIndex, identity);
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < p.length; i++) { min[i % 3] = Math.min(min[i % 3], p[i]); max[i % 3] = Math.max(max[i % 3], p[i]); }
  const shift = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2], r3 = (v: number) => Math.round(v * 1000) / 1000;
  return { p: p.map((v, i) => r3(v - shift[i % 3])), t, c, size: [r3(max[0] - min[0]), r3(max[1] - min[1]), r3(max[2] - min[2])] };
}
async function catalogueGltf(path: string, categories: Record<string, string> = {}, onPart?: (part: string) => void): Promise<OurCatalogue> {
  const parts: OurCatalogue["parts"] = [], names = new Set<string>();
  for (const file of list(path, [".glb", ".gltf"])) {
    const stem = basename(file).replace(/\.(glb|gltf)$/i, ""), folder = basename(dirname(file)).toLowerCase();
    let name = stem.replace(/[^\w.-]/g, "_"); if (names.has(name)) name = `${folder}_${name}`; names.add(name);
    try {
      const mesh = meshOfGltf(file), triangles = mesh.t.length / 3;
      if (triangles > 60_000) { parts.push({ name, category: categoryOf(name, categories) === "misc" ? folder : categoryOf(name, categories), footprint: [mesh.size[0], mesh.size[2]], height: mesh.size[1], triangles, ok: false, file: relative(path, file), note: "more than 60,000 triangles" }); continue; }
      await writeJson(meshFile(path, name), mesh);
      parts.push({ name, category: categoryOf(name, categories) === "misc" ? (relative(path, dirname(file)) ? folder : "misc") : categoryOf(name, categories), footprint: [mesh.size[0], mesh.size[2]], height: mesh.size[1], triangles, ok: triangles > 0, file: relative(path, file) });
      onPart?.(name);
    } catch (error) { parts.push({ name, category: folder, footprint: [0, 0], height: 0, triangles: 0, ok: false, file: relative(path, file), note: String((error as Error).message ?? error).slice(0, 160) }); }
  }
  return { version: 1, kind: "gltf", at: new Date().toISOString(), parts };
}

export interface AddOptions { kind?: "scad" | "gltf"; licence: string; url?: string | null; why: string; by?: string; categories?: Record<string, string>; allowedBy?: string; unit?: "m" | "kit"; fetched?: string; onPart?: (part: string) => void }
/** Register a folder already on disk as a source and build its catalogue (kept when a gk-shaped one is already there). */
export async function addSource(name: string, path: string, options: AddOptions) {
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name)) throw new Error("A source's name is lower-case letters, digits, - and _ (e.g. my-kit).");
  if (name in builtIn() || name === "own") throw new Error(`${name} is a built-in source (kit, pack, own): pick another name.`);
  if (!options.why?.trim()) throw new Error("--why <text> is required: say what this source is for.");
  const folder = absolute(path);
  if (!existsSync(folder) || !statSync(folder).isDirectory()) throw new Error(`${folder} is not a folder on disk (novel warehouse fetch downloads one, with the user's OK).`);
  if (!ALLOWED_LICENCES.includes(options.licence) && !options.allowedBy?.trim()) throw new Error(`Licence ${options.licence} is not in the allowed set (${ALLOWED_LICENCES.join(", ")}): ask the user, then pass --allowed-by "<the user's words>".`);
  const kind = options.kind ?? (list(folder, [".scad"], 2).length ? "scad" : list(folder, [".glb", ".gltf"], 3).length ? "gltf" : null);
  if (!kind) throw new Error(`${folder} holds no .scad, .glb or .gltf files.`);
  const existing = readJson<GkCatalogue>(join(folder, "catalog.json"), {});
  const kept = kind === "scad" && Array.isArray(existing.kits) && existing.kits.length > 0;
  if (!kept) { const made = kind === "scad" ? await catalogueScad(folder, options.categories, options.onPart) : await catalogueGltf(folder, options.categories, options.onPart); await writeJson(join(folder, "catalog.json"), made); }
  const registry = readRegistry(), stored = readJson<Registry>(REGISTRY_FILE, { version: 1, sources: {} });
  const source: Source = { kind, path: folder.startsWith(PACKS_ROOT) ? relative(PACKS_ROOT, folder) : folder, licence: options.licence, url: options.url ?? null, fetched: options.fetched ?? new Date().toISOString().slice(0, 10), by: options.by ?? process.env.NOVEL_AGENT ?? undefined, note: options.why, ...(options.categories ? { categories: options.categories } : {}), unit: options.unit ?? "m", ...(options.allowedBy ? { allowedBy: options.allowedBy } as object : {}) };
  registry.sources[name] = source; stored.sources = { ...(stored.sources ?? {}), [name]: source };
  await writeJson(REGISTRY_FILE, { version: 1, sources: Object.fromEntries(Object.entries(stored.sources).filter(([key]) => !(key in builtIn()))) });
  const parts = catalogueOf(name, source), categories: Record<string, number> = {};
  for (const part of parts) categories[part.category] = (categories[part.category] ?? 0) + 1;
  return { name, kind, path: folder, licence: options.licence, parts: parts.length, ok: parts.filter((part) => part.ok).length, failed: parts.filter((part) => !part.ok).map((part) => `${part.name}: ${part.note ?? "failed"}`).slice(0, 20), categories, catalogue: kept ? "kept (gkNextEngine's own)" : "built", registry: REGISTRY_FILE };
}

/** Rebuild a source's catalogue (a kit edited, OpenSCAD updated). */
export async function refreshSource(name: string, options: { onPart?: (part: string) => void } = {}) {
  const source = readRegistry().sources[name];
  if (!source) throw new Error(`No source ${name} (novel warehouse list).`);
  if (source.kind === "baked") throw new Error("The baked packs are rebuilt by apps/playground/tools/*-models.mjs.");
  const folder = absolute(source.path), made = source.kind === "scad" ? await catalogueScad(folder, source.categories, options.onPart) : await catalogueGltf(folder, source.categories, options.onPart);
  await writeJson(join(folder, "catalog.json"), made);
  return { name, parts: made.parts.length, ok: made.parts.filter((part) => part.ok).length, failed: made.parts.filter((part) => !part.ok).map((part) => `${part.name}: ${part.note ?? "failed"}`).slice(0, 20) };
}

/**
 * Download a source into its own new folder under the packs root, with the user's OK (never without: a download needs
 * their permission): a git repository (one folder of it with `path`) or a zip; LICENSE kept, SOURCE.txt written; then added.
 */
export async function fetchSource(name: string, url: string, options: AddOptions & { ok: string; path?: string; limitMB?: number }) {
  if (!options.ok?.trim()) throw new Error("A download needs the user's permission: ask them (name, licence, size), then pass --ok \"<their words>\".");
  if (!/^https:\/\//.test(url)) throw new Error("Only https URLs.");
  if (!/^[a-z][a-z0-9_-]{0,31}$/.test(name) || name in builtIn() || name === "own") throw new Error("A source's name is lower-case letters, digits, - and _, not kit, pack or own.");
  const dest = join(PACKS_ROOT, name), limit = (options.limitMB ?? 200) * 1024 * 1024;
  if (existsSync(dest)) throw new Error(`${dest} exists: novel warehouse add ${name} ${dest} registers it, or pick another name.`);
  await mkdir(PACKS_ROOT, { recursive: true });
  const work = mkdtempSync(join(tmpdir(), "warehouse-fetch-")), notes: string[] = [`url: ${url}`, `fetched: ${new Date().toISOString()}`, `ok: ${options.ok}`, `licence: ${options.licence}`];
  if (/\.zip$/i.test(url)) {
    const response = await fetch(url, { redirect: "follow" });
    if (!response.ok) throw new Error(`${url}: ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length > limit) throw new Error(`${url} is ${Math.round(bytes.length / 1048576)} MB, over the ${Math.round(limit / 1048576)} MB limit (--limit).`);
    await writeFile(join(work, "source.zip"), bytes);
    const unzip = spawnSync("unzip", ["-q", join(work, "source.zip"), "-d", join(work, "unzipped")], { encoding: "utf8" });
    if (unzip.status !== 0) throw new Error(`unzip failed: ${unzip.stderr}`);
    const inner = readdirSync(join(work, "unzipped")).filter((entry) => !entry.startsWith("."));
    const from = inner.length === 1 && statSync(join(work, "unzipped", inner[0])).isDirectory() ? join(work, "unzipped", inner[0]) : join(work, "unzipped");
    const copy = spawnSync("cp", ["-R", from, dest], { encoding: "utf8" }); if (copy.status !== 0) throw new Error(copy.stderr);
    notes.push(`bytes: ${bytes.length}`);
  } else {
    const clone = spawnSync("git", ["clone", "--depth", "1", ...(options.path ? ["--filter=blob:none", "--sparse"] : []), url, join(work, "repo")], { encoding: "utf8", timeout: 600_000 });
    if (clone.status !== 0) throw new Error(`git clone failed: ${clone.stderr.slice(0, 300)}`);
    if (options.path) { const sparse = spawnSync("git", ["-C", join(work, "repo"), "sparse-checkout", "set", options.path], { encoding: "utf8" }); if (sparse.status !== 0) throw new Error(`git sparse-checkout failed: ${sparse.stderr.slice(0, 300)}`); }
    const from = options.path ? join(work, "repo", options.path) : join(work, "repo");
    if (!existsSync(from)) throw new Error(`${options.path} is not in ${url}.`);
    const size = spawnSync("du", ["-sk", from], { encoding: "utf8" }), kb = Number(size.stdout.split(/\s+/)[0] ?? 0);
    if (kb * 1024 > limit) throw new Error(`${url}${options.path ? `/${options.path}` : ""} is ${Math.round(kb / 1024)} MB, over the ${Math.round(limit / 1048576)} MB limit (--limit).`);
    const copy = spawnSync("cp", ["-R", from, dest], { encoding: "utf8" }); if (copy.status !== 0) throw new Error(copy.stderr);
    const commit = spawnSync("git", ["-C", join(work, "repo"), "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim(); notes.push(`commit: ${commit}`);
    for (const licence of ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"]) if (options.path && existsSync(join(work, "repo", licence)) && !existsSync(join(dest, licence))) { const copied = spawnSync("cp", [join(work, "repo", licence), join(dest, licence)]); if (copied.status !== 0) break; }
    spawnSync("rm", ["-rf", join(dest, ".git")]);
  }
  await writeFile(join(dest, "SOURCE.txt"), `${notes.join("\n")}\n`);
  const added = await addSource(name, dest, { ...options, url, fetched: new Date().toISOString().slice(0, 10) });
  return { ...added, downloaded: dest, licenceFile: ["LICENSE", "LICENSE.md", "LICENSE.txt", "LICENCE"].find((file) => existsSync(join(dest, file))) ?? null };
}

// ---- finding parts -----------------------------------------------------------------------------------------------

const tokens = (text: string) => text.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t.length > 1);
const SYNONYMS: Record<string, string[]> = { tree: ["tree", "pine", "oak", "palm", "nature", "plant", "bush"], "street-light": ["lamp", "light", "streetlight", "lantern", "pole"], bench: ["bench", "seat"], bin: ["bin", "trash", "garbage", "can", "dumpster"], car: ["car", "sedan", "veh", "vehicle", "hatchback", "taxi"], bollard: ["bollard", "post", "barrier", "pillar"], lamp: ["light"], vehicle: ["veh", "car", "truck", "bus"], building: ["bldg", "house", "block", "office", "tower"], weapon: ["wpn", "gun", "rifle", "pistol", "knife", "sword"], gun: ["wpn", "rifle", "pistol", "ak"], furniture: ["furn", "chair", "table", "desk", "bed", "sofa"] };
export interface FindOptions { kind?: string | null; category?: string | null; size?: number | null; source?: string | null; top?: number; novelDir?: string; embeddings?: boolean }
/** Parts ranked for a few words: name and category matches, the kinds' categories, size closeness, and embeddings when a local server is up. */
export async function findParts(words: string, options: FindOptions = {}) {
  const all = (await partsOf({ source: options.source ?? undefined, novelDir: options.novelDir })).filter((part) => part.ok);
  const asked = tokens(words), wanted = new Set(asked.flatMap((t) => [t, ...(SYNONYMS[t] ?? [])])), categories = options.kind ? new Set(KIT_CATEGORIES[options.kind] ?? []) : null;
  const scored = all.filter((part) => !options.category || part.category === options.category).map((part) => {
    const own = new Set([...tokens(part.name), ...tokens(part.category), ...tokens(part.note ?? "")]);
    let score = 0;
    for (const t of asked) { if (own.has(t)) score += 2; else if ([...own].some((o) => o.includes(t) || t.includes(o))) score += 0.6; }
    for (const t of wanted) if (own.has(t) && !asked.includes(t)) score += 0.8;
    if (categories?.has(part.category)) score += 1.5;
    if (options.size && options.size > 0) { const longest = Math.max(part.footprint[0], part.footprint[1], part.height); if (longest > 0) score += 1 / (1 + Math.abs(Math.log(longest / options.size))); }
    return { part, score };
  });
  let withEmbeddings = false;
  if (options.embeddings ?? !!process.env.EMBEDDING_BASE_URL) {
    try {
      const { loadEmbedder, cosineSimilarity } = await import("../../ground/connectors/embeddings.js");
      const embedder = loadEmbedder({ provider: process.env.EMBEDDING_PROVIDER, baseUrl: process.env.EMBEDDING_BASE_URL ?? "http://127.0.0.1:8194/v1", model: process.env.EMBEDDING_MODEL ?? "BAAI/bge-small-zh-v1.5", apiKey: null, dimension: null } as Parameters<typeof loadEmbedder>[0]);
      if (embedder) {
        const pool = scored.filter((row) => row.score > 0).sort((a, b) => b.score - a.score).slice(0, 200), texts = [words, ...pool.map((row) => `${row.part.name.replace(/_/g, " ")}, ${row.part.category}, ${row.part.footprint.join(" by ")} by ${row.part.height} m${row.part.note ? `, ${row.part.note}` : ""}`)];
        const vectors = await embedder.embed(texts);
        pool.forEach((row, n) => { row.score += 3 * Math.max(0, cosineSimilarity(vectors[0], vectors[n + 1])); });
        withEmbeddings = true;
      }
    } catch { /* no embedding server: words alone */ }
  }
  const top = scored.filter((row) => row.score > 0).sort((a, b) => b.score - a.score || a.part.name.localeCompare(b.part.name)).slice(0, options.top ?? 20);
  return { words, kind: options.kind ?? null, searched: all.length, embeddings: withEmbeddings, parts: top.map(({ part, score }) => ({ ref: part.ref, category: part.category, size: [part.footprint[0], part.height, part.footprint[1]], unit: part.unit, triangles: part.triangles, score: Math.round(score * 100) / 100, ...(part.note ? { note: part.note } : {}) })) };
}

/** One part's record, or null. */
export async function partOf(ref: string, options: { novelDir?: string } = {}): Promise<Part | null> {
  const split = splitRef(ref);
  if (!split) return null;
  if (split.source === "own") { if (!options.novelDir) return null; return (await ownParts(options.novelDir)).find((part) => part.name === split.part) ?? null; }
  const source = readRegistry().sources[split.source];
  if (!source) return null;
  return catalogueOf(split.source, source).find((part) => part.name === split.part) ?? null;
}

/** A part's mesh in the player's shape (rendered on first use for a kit module; baked for glTF and the packs). */
export async function meshOfPart(ref: string, options: { novelDir?: string } = {}): Promise<Mesh | null> {
  const split = splitRef(ref);
  if (!split) return null;
  if (split.source === "own") { if (!options.novelDir) return null; return readJson<Mesh | null>(join(storeOf(options.novelDir), `${split.part}.mesh.json`), null); }
  const source = readRegistry().sources[split.source];
  if (!source) return null;
  const path = absolute(source.path);
  if (source.kind === "baked") {
    for (const file of ["architectureModels.json", "vehicleModels.json"]) {
      const library = readJson<{ models?: Record<string, { size: [number, number, number]; step: number; positions: string; indices: string }> }>(join(path, file), {}), model = library.models?.[split.part];
      if (!model) continue;
      const positions = new Int16Array(Buffer.from(model.positions, "base64").buffer.slice(0)), indices = new Uint16Array(Buffer.from(model.indices, "base64").buffer.slice(0));
      const p = Array.from(positions, (v) => Math.round(v * model.step * 1000) / 1000), t = Array.from(indices), c: number[] = []; for (let i = 0; i < t.length / 3; i++) c.push(190, 196, 204);
      return { p, t, c, size: model.size };
    }
    return null;
  }
  const cached = readJson<Mesh | null>(meshFile(path, split.part), null);
  if (cached) return cached;
  if (source.kind !== "scad") return null;
  const part = catalogueOf(split.source, source).find((entry) => entry.name === split.part);
  if (!part?.file) return null;
  const made = await renderModule(join(path, part.file), part.name);
  if ("error" in made) return null;
  await writeJson(meshFile(path, part.name), made.mesh);
  return made.mesh;
}

// ---- connecting parts to the configuration -----------------------------------------------------------------------

export const SLOTS = ["prop", "vehicle", "kind", "use", "role"] as const;
/** The setting (or table part) a slot writes, with the value. */
export function slotWrite(slot: string, ref: string | null, options: { floors?: [number, number] } = {}): { key: string; value: unknown; isTable: boolean } {
  const m = slot.match(/^(prop|vehicle|kind|use|role):(.+)$/);
  if (!m) throw new Error(`A slot is prop:<kind>, vehicle:<kind>, kind:<thing kind>, use:<building use> or role:<role> (e.g. prop:tree, vehicle:"a bus").`);
  const [, what, name] = m;
  if (what === "prop") return { key: "fill.props", value: { [name]: ref }, isTable: false };
  if (what === "vehicle") return { key: "models.vehicles", value: { [name]: ref }, isTable: false };
  if (what === "kind") return { key: "models.parts", value: { [name]: ref }, isTable: false };
  if (!ref) throw new Error("A building use or role takes a part (nothing to unset here: novel settings unset models.uses --table).");
  if (what === "use") return { key: "models.uses", value: { uses: { [name]: { fill: { [ref]: options.floors ?? [1, 40] } } } }, isTable: true };
  return { key: "models.uses", value: { roles: { [name]: ref } }, isTable: true };
}
export interface UseOptions { why: string; place?: string; before?: boolean; floors?: [number, number]; by?: string }
/** Connect a part to a slot: the slot's setting written through the schema (checked, layered, logged), the part's record returned with it. */
export async function usePart(novelDir: string, ref: string, slot: string, options: UseOptions) {
  if (!PART_REF.test(ref)) throw new Error(`${ref} is not a part reference <source>:<part> (novel warehouse find).`);
  const part = await partOf(ref, { novelDir });
  if (!part) throw new Error(`No part ${ref} in the warehouse (novel warehouse find "<words>" lists parts; list shows the sources).`);
  if (!part.ok) throw new Error(`${ref} failed its catalogue check (${part.note ?? "not ok"}): pick another.`);
  const write = slotWrite(slot, ref, { floors: options.floors });
  const { settingsSet } = await import("../../cli/commands/extract/settingsCommands.js");
  const set = await settingsSet(novelDir, write.key, JSON.stringify(write.value), { place: options.place, why: options.why, before: options.before, isTable: write.isTable, by: options.by });
  return { connected: { slot, part: ref, size: [part.footprint[0], part.height, part.footprint[1]], unit: part.unit, category: part.category }, pageId: `scad:${idOfRef(ref)}`, ...set };
}
