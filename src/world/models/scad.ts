/**
 * Models as code (milestones M10a; docs/v3/design.html#models-and-settings §3): OpenSCAD turns a model's code into a coloured mesh
 * (the manifold backend, OFF with a colour on each face); the mesh is measured, checked as a closed solid with
 * manifold-3d, and written for the player Y-up (OpenSCAD is Z-up: (x, y, z) → (x, z, -y); the front stays +x).
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const OPENSCAD = process.env.OPENSCAD ?? "openscad";

export interface Mesh { verts: [number, number, number][]; tris: [number, number, number][]; colours: [number, number, number][] }
export interface Measure { size: [number, number, number]; zMin: number; centre: [number, number]; triangles: number }
export interface Solid { closed: boolean; pieces: number; volume: number; genus: number | null; error?: string; boxes?: { min: [number, number, number]; max: [number, number, number] }[] }

/** Evaluate a .scad file to an OFF file; the errors and warnings OpenSCAD gives, when it fails. */
export function evaluate(scadFile: string, offFile: string, timeoutMs = 120_000): { ok: true } | { ok: false; error: string } {
  const run = spawnSync(OPENSCAD, ["--backend=manifold", "-o", offFile, scadFile], { encoding: "utf8", timeout: timeoutMs });
  if (run.error) return { ok: false, error: `openscad could not run (${run.error.message}): brew install --cask openscad@snapshot, or OPENSCAD=<path>` };
  if (run.status !== 0) return { ok: false, error: `${run.stderr}`.split("\n").filter((line) => /ERROR|WARNING|error/i.test(line)).slice(0, 6).join(" | ") || `openscad ended with ${run.status}` };
  const said = `${run.stderr}`.split("\n").filter((line) => /^ERROR|^WARNING: (Ignoring|Unable|variable|Too many)/.test(line)).slice(0, 6);
  if (said.some((line) => line.startsWith("ERROR"))) return { ok: false, error: said.join(" | ") };
  return { ok: true };
}

/** An OFF file's vertices, its faces as triangles and each triangle's colour (0–255; grey where it has none). */
export function readOff(offFile: string): Mesh {
  const lines = readFileSync(offFile, "utf8").split("\n").map((line) => line.trim()).filter((line) => line && !line.startsWith("#"));
  if (!lines[0]?.startsWith("OFF")) throw new Error(`${offFile} is not an OFF file`);
  const [nv, nf] = lines[1].split(/\s+/).map(Number), verts: [number, number, number][] = [], tris: [number, number, number][] = [], colours: [number, number, number][] = [];
  for (let n = 0; n < nv; n++) { const [x, y, z] = lines[2 + n].split(/\s+/).map(Number); verts.push([x, y, z]); }
  for (let n = 0; n < nf; n++) {
    const parts = lines[2 + nv + n].split(/\s+/).map(Number), k = parts[0], idx = parts.slice(1, 1 + k), rest = parts.slice(1 + k);
    const rgb: [number, number, number] = rest.length >= 3 ? (rest.slice(0, 3).every((v) => v <= 1) && rest.slice(0, 3).some((v) => v % 1 !== 0) ? [rest[0] * 255, rest[1] * 255, rest[2] * 255].map(Math.round) as [number, number, number] : [rest[0], rest[1], rest[2]]) : [200, 200, 200];
    for (let i = 1; i < k - 1; i++) { tris.push([idx[0], idx[i], idx[i + 1]]); colours.push(rgb); }
  }
  return { verts, tris, colours };
}

export function measure(mesh: Mesh): Measure {
  const min = [0, 1, 2].map((i) => Math.min(...mesh.verts.map((v) => v[i]))), max = [0, 1, 2].map((i) => Math.max(...mesh.verts.map((v) => v[i])));
  const r2 = (v: number) => Math.round(v * 100) / 100;
  return { size: [r2(max[0] - min[0]), r2(max[1] - min[1]), r2(max[2] - min[2])], zMin: r2(min[2]), centre: [r2((max[0] + min[0]) / 2), r2((max[1] + min[1]) / 2)], triangles: mesh.tris.length };
}

type Box3 = { min: number[]; max: number[] };
type ManifoldModule = { setup(): void; Manifold: new (mesh: unknown) => { volume(): number; genus(): number; boundingBox(): Box3; decompose(): { boundingBox(): Box3; delete(): void }[]; delete(): void }; Mesh: new (options: Record<string, unknown>) => { merge(): boolean } };
let manifold: ManifoldModule | null = null;
/** manifold-3d's closed-solid check: whether the mesh is a closed solid, in how many separate pieces, its volume. */
export async function solidOf(mesh: Mesh): Promise<Solid> {
  if (!manifold) {
    const loaded = (await import("manifold-3d")) as unknown as { default: () => Promise<ManifoldModule> };
    manifold = await loaded.default(); manifold.setup();
  }
  try {
    const m = new manifold.Mesh({ numProp: 3, vertProperties: new Float32Array(mesh.verts.flat()), triVerts: new Uint32Array(mesh.tris.flat()) }); m.merge();
    const solid = new manifold.Manifold(m), parts = solid.decompose(), r = (v: number) => Math.round(v * 1000) / 1000, out = { closed: true, pieces: parts.length, volume: Math.round(solid.volume() * 1000) / 1000, genus: solid.genus(), boxes: parts.map((part) => { const box = part.boundingBox(); return { min: [r(box.min[0]), r(box.min[1]), r(box.min[2])] as [number, number, number], max: [r(box.max[0]), r(box.max[1]), r(box.max[2])] as [number, number, number] }; }) };
    for (const part of parts) part.delete(); solid.delete();
    return out;
  } catch (error) { return { closed: false, pieces: 0, volume: 0, genus: null, error: String((error as Error).message ?? error).slice(0, 120) }; }
}

/** The mesh for the player: Y-up positions (x, z, -y), triangle indices, a colour per triangle, its size (x length, y height, z width). */
export function forPlayer(mesh: Mesh): { p: number[]; t: number[]; c: number[]; size: [number, number, number] } {
  const r3 = (v: number) => Math.round(v * 1000) / 1000, m = measure(mesh);
  return { p: mesh.verts.flatMap(([x, y, z]) => [r3(x), r3(z), r3(-y)]), t: mesh.tris.flat(), c: mesh.colours.flat(), size: [m.size[0], m.size[2], m.size[1]] };
}
