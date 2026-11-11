/**
 * The contract a model is written to and checked against (milestones M10a; after gkNextEngine's kit contracts). The
 * writer (the work model or an agent) reads it in the brief; `check` holds a made model to it. Every failure class found
 * once becomes a line here and a check (the user's rule, 2026-11-09: rules from real failures).
 */
import { setting } from "../settings.js";
import type { Measure, Solid } from "./scad.js";

export interface ContractSettings { ground: number; groundShare: number; touch: number; touchShare: number; sizeFactor: number; triangles: number; tries: number; primitives: number; fn: number }
export const contractSettings = () => setting<ContractSettings>("models.contract");

/** The kinds whose front is a front (a vehicle's nose): it faces +x, and it is longer along x than it is wide. */
export const FRONTED = new Set(["a car", "a van or a truck", "a bus", "a train or a carriage", "a motorbike or a bicycle", "a boat", "an aircraft"]);

export function contractText(c: ContractSettings = contractSettings()): string {
  return [
    "You write one object as OpenSCAD code for a 3D replay of a novel. The rules (each is checked):",
    "- Units are metres, Z is up. The object stands on the ground: its lowest point at z = 0, centred on x = 0, y = 0.",
    "- A vehicle, robot or machine faces +x (its front, nose or face toward +x); a vehicle is longer along x than it is wide.",
    "- Its real size: from the lines when they give it, else a typical one for such a thing.",
    "- One module named thing() holds the whole object; the file ends with the call thing(); and has no other top-level geometry.",
    `- Only cube, sphere, cylinder, polyhedron, hull, union, difference, intersection, translate, rotate, scale, mirror, color, linear_extrude, rotate_extrude, for, let, module, function. $fn at most ${c.fn}; at most ${c.primitives} shapes.`,
    "- Low-poly, with a clear silhouette seen from 30 to 100 m away. No colours or textures are needed: the world draws every model in its own style.",
    "- One piece: every part overlaps the part it hangs on by a few centimetres (a rotor on its mast, a wheel on its axle); nothing floats.",
    "- Rotors, blades and propellers are modelled still, as thin boxes; swept blades must stay above the ground (a tall enough tower or mast).",
    "- Reply with the code only: no fences, no prose.",
  ].join("\n");
}

export interface Checked { problems: string[]; warnings: string[] }
/** What a made model breaks (problems: write it again) and what is only worth knowing (warnings). */
export function check(m: Measure, solid: Solid, expected: { kind?: string | null; size?: number[] | null }, c: ContractSettings = contractSettings()): Checked {
  const problems: string[] = [], warnings: string[] = [];
  // The ground and touching, scaled to the thing (the first run of volume 1, 2026-11-09: 9 of 14 failed on rotors a few
  // centimetres off their hub and a 0.65 m robot 6 cm low, none of it visible at 30 m): within groundShare of its height
  // of z = 0; a piece within touch (or touchShare of its longest side) of the body is attached, a piece further floats.
  const tall = m.size[2], longestSide = Math.max(...m.size), groundTolerance = Math.max(c.ground, c.groundShare * tall), reach = Math.max(c.touch, c.touchShare * longestSide);
  if (Math.abs(m.zMin) > groundTolerance) problems.push(`its lowest point is at z = ${m.zMin}, not 0 (the object is ${m.size.join(" × ")} m: every part, swept blades included, must stay above the ground; stand it on z = 0)`);
  if (Math.abs(m.centre[0]) > Math.max(0.5, m.size[0] * 0.25) || Math.abs(m.centre[1]) > Math.max(0.5, m.size[1] * 0.25)) warnings.push(`its middle is at x = ${m.centre[0]}, y = ${m.centre[1]}, not on 0, 0`);
  if (m.triangles > c.triangles) problems.push(`${m.triangles} triangles, more than ${c.triangles}: fewer shapes, a lower $fn`);
  if (!solid.closed) problems.push(`it is not a closed solid (${solid.error ?? "open or self-crossing faces"}): build it from closed shapes only`);
  else if (solid.pieces > 1) {
    const floating = floatingPieces(solid.boxes ?? [], reach);
    if (floating.length) problems.push(`${floating.length} of its ${solid.pieces} pieces float more than ${Math.round(reach * 100) / 100} m from the body (${floating.map((box) => `one round x ${Math.round(((box.min[0] + box.max[0]) / 2) * 10) / 10}, y ${Math.round(((box.min[1] + box.max[1]) / 2) * 10) / 10}, z ${Math.round(((box.min[2] + box.max[2]) / 2) * 10) / 10}`).join("; ")}): make each part overlap the part it hangs on`);
    else warnings.push(`${solid.pieces} pieces, each within ${Math.round(reach * 100) / 100} m of the body: attached as seen`);
  }
  const longest = Math.max(...m.size), known = expected.size?.length ? Math.max(...expected.size) : null;
  if (known && known > 0 && (longest > known * c.sizeFactor || longest < known / c.sizeFactor)) problems.push(`its longest side is ${longest} m, but the reading has it at about ${Math.round(known * 10) / 10} m: make it about that size`);
  if (expected.kind && FRONTED.has(expected.kind) && m.size[0] < m.size[1] * 0.9) warnings.push(`a vehicle should be longer along x (its front) than along y: it is ${m.size[0]} × ${m.size[1]} m`);
  return { problems, warnings };
}

type Box = { min: [number, number, number]; max: [number, number, number] };
const gapOf = (a: Box, b: Box) => Math.hypot(...[0, 1, 2].map((i) => Math.max(0, a.min[i] - b.max[i], b.min[i] - a.max[i])));
/** The pieces not joined to the largest one through pieces each within `reach` of the next. */
export function floatingPieces(boxes: Box[], reach: number): Box[] {
  if (boxes.length < 2) return [];
  const volume = (box: Box) => [0, 1, 2].reduce((v, i) => v * Math.max(0.001, box.max[i] - box.min[i]), 1);
  const body = boxes.reduce((best, box, n) => (volume(box) > volume(boxes[best]) ? n : best), 0), joined = new Set([body]);
  for (let grew = true; grew; ) { grew = false; boxes.forEach((box, n) => { if (!joined.has(n) && [...joined].some((k) => gapOf(boxes[k], box) <= reach)) { joined.add(n); grew = true; } }); }
  return boxes.filter((_, n) => !joined.has(n));
}
