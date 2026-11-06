// Bakes a few Kenney CC0 kits (https://kenney.nl — City Kit Commercial 2.1,
// Fantasy Town Kit 2.0, Castle Kit) into the bare geometry the place
// holograms draw: positions and triangles only (no textures, normals or
// UVs), each model sitting on y = 0 and centred on x/z. Positions are int16
// (multiply by `step` for model units).
//
//   node apps/playground/tools/architecture-models.mjs <dir with the unzipped kits>
//
// Writes src/data/architectureModels.json.
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bake, readGlb } from "./bake-geometry.mjs";

const [root] = process.argv.slice(2);
if (!root) throw new Error("Usage: architecture-models.mjs <dir with kenney_city-kit-commercial_2.1, kenney_fantasy-town-kit_2.0, kenney_castle-kit>");
const kit = { city: "kenney_city-kit-commercial_2.1", town: "kenney_fantasy-town-kit_2.0", castle: "kenney_castle-kit" };

/** One model = parts from a kit, each moved (model units), turned about y and scaled. */
const MODELS = {
  "skyscraper-a": [["city", "building-skyscraper-a"]],
  "skyscraper-b": [["city", "building-skyscraper-b"]],
  "skyscraper-e": [["city", "building-skyscraper-e"]],
  ...Object.fromEntries("abcdefghijklm".split("").map((letter) => [`tower-${letter}`, [["city", `low-detail-building-${letter}`]]])),
  "block-wide-a": [["city", "low-detail-building-wide-a"]],
  "block-wide-b": [["city", "low-detail-building-wide-b"]],
  "office-c": [["city", "building-c"]],
  "office-h": [["city", "building-h"]],
  "office-k": [["city", "building-k"]],
  market: [["town", "stall-red", [-0.62, 0, -0.2], 0.25], ["town", "stall-green", [0.62, 0, -0.2], -0.25], ["town", "stall", [0, 0, 0.55], Math.PI], ["town", "cart", [1.25, 0, 0.75], 1.1]],
  keep: [["castle", "tower-square-base"], ["castle", "tower-square-mid-windows", [0, 1, 0]], ["castle", "tower-square-mid", [0, 2, 0]], ["castle", "tower-square-top-roof-high", [0, 3, 0]],
    ["castle", "tower-hexagon-base", [1.35, 0, 0.45]], ["castle", "tower-hexagon-mid", [1.35, 1.31, 0.45]], ["castle", "tower-hexagon-roof", [1.35, 1.77, 0.45]],
    ["castle", "wall", [0.55, 0, 0.75]]],
  fountain: [["town", "fountain-round-detail"], ["town", "tree-high-round", [-1.2, 0, -0.8], 0, 0.5], ["town", "tree-high", [1.25, 0, -0.6], 0, 0.45], ["town", "tree", [1.0, 0, 0.95], 0, 0.4]],
  windmill: [["town", "windmill"]],
};

const out = { source: "Kenney (kenney.nl), CC0 1.0: City Kit Commercial 2.1, Fantasy Town Kit 2.0, Castle Kit", models: Object.fromEntries(Object.entries(MODELS).map(([name, parts]) => [name, bake(parts, (kitName, part) => readGlb(join(root, kit[kitName], "Models", "GLB format", `${part}.glb`)))])) };
const target = fileURLToPath(new URL("../src/data/architectureModels.json", import.meta.url));
fs.writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(`${Object.keys(out.models).length} models → ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
