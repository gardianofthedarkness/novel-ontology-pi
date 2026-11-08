// Adds the modern kit's models to the baked holograms (src/data/architectureModels.json), from Kay Lousberg's KayKit packs
// (CC0 1.0, github.com/KayKit-Game-Assets): City Builder Bits for buildings a scene takes place in (a school, a dormitory,
// a shopping centre), and Space Base Bits for what lies deep underground (an experiment lab, a military bunker, a quantum
// facility) and the subway's tunnels. The models already baked from Kenney's kits stay as they are.
//
//   node apps/playground/tools/modern-kit-models.mjs <dir holding KayKit-City-Builder-Bits-1.0 and KayKit-Space-Base-Bits-1.0>
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bake, readGltf } from "./bake-geometry.mjs";

const [root] = process.argv.slice(2);
if (!root) throw new Error("Usage: modern-kit-models.mjs <dir holding KayKit-City-Builder-Bits-1.0 and KayKit-Space-Base-Bits-1.0>");
const kit = { city: "KayKit-City-Builder-Bits-1.0/addons/kaykit_city_builder_bits/Assets/gltf", base: "KayKit-Space-Base-Bits-1.0/addons/kaykit_space_base_bits/Assets/gltf" };

/** One model = parts from a kit, each moved (model units), turned about y and scaled, as in architecture-models.mjs. */
const MODELS = {
  // Buildings a scene happens in (the world's school, home and mall roles).
  "kk-school": [["city", "building_B_withoutBase", [-0.55, 0, 0]], ["city", "building_B_withoutBase", [0.55, 0, 0]], ["city", "building_A_withoutBase", [0, 0, 0.75], Math.PI / 2]],
  "kk-dormitory": [["city", "building_H_withoutBase"]],
  "kk-apartment": [["city", "building_G_withoutBase"]],
  "kk-mall": [["city", "building_E_withoutBase", [-0.55, 0, 0]], ["city", "building_F_withoutBase", [0.55, 0, 0]], ["city", "building_C_withoutBase", [0, 0, 0.8]]],
  // Deep underground: a facility's halls as the kit's base modules (drawn, never walked).
  "kk-lab": [["base", "basemodule_A", [-0.8, 0, 0]], ["base", "basemodule_B", [0.8, 0, 0]], ["base", "structure_low", [0, 0, 0.9]]],
  "kk-military": [["base", "basemodule_garage", [0, 0, 0]], ["base", "cargodepot_A", [1.4, 0, 0.2]], ["base", "containers_B", [-1.3, 0, 0.4]]],
  "kk-quantum": [["base", "drill_structure", [0, 0, 0]], ["base", "structure_tall", [1.2, 0, 0]], ["base", "basemodule_C", [-1.2, 0, 0.2]]],
  // The subway's tunnels, as dressing along a line.
  "kk-tunnel": [["base", "tunnel_straight_A"]],
  "kk-tunnel-bend": [["base", "tunnel_diagonal_long_A"]],
};

const target = fileURLToPath(new URL("../src/data/architectureModels.json", import.meta.url));
const out = JSON.parse(fs.readFileSync(target, "utf8"));
for (const [name, parts] of Object.entries(MODELS)) {
  out.models[name] = bake(parts, (kitName, part) => readGltf(join(root, kit[kitName], `${part}.gltf`)));
  out.credits[name] = `KayKit ${parts[0][0] === "city" ? "City Builder Bits" : "Space Base Bits"} 1.0 by Kay Lousberg, CC0 1.0 (https://github.com/KayKit-Game-Assets)`;
}
fs.writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(Object.entries(MODELS).map(([name]) => `${name} ${out.models[name].size.join("×")}`).join("\n"));
console.log(`${Object.keys(out.models).length} models → ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
