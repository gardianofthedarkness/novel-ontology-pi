// The rooms' furniture (the architect's rooms: world-engine/digest/rooms.mjs), baked as the vehicles are (bake-geometry.mjs)
// into src/data/furnitureModels.json, in metres (the kit's units are about 1.5 times a metre: a bed 3 long, a chair 1.26 tall;
// scaled by 0.68), all CC0 1.0:
//  - KayKit Furniture Bits 1.0 by Kay Lousberg (https://github.com/KayKit-Game-Assets/KayKit-Furniture-Bits-1.0).
// Only the models the rooms' recipes use are baked.
//
//   node apps/playground/tools/furniture-models.mjs <dir holding the unzipped kit>
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bake, readGltf } from "./bake-geometry.mjs";
import { FURNITURE_MODELS } from "../../../world-engine/digest/rooms.mjs";

const [root] = process.argv.slice(2);
if (!root) throw new Error("Usage: furniture-models.mjs <dir holding the unzipped kit>");
const dir = "KayKit-Furniture-Bits-1.0-main/addons/kaykit_furniture_bits/Assets/gltf", credit = "KayKit Furniture Bits 1.0 by Kay Lousberg, CC0 1.0 (https://github.com/KayKit-Game-Assets)", SCALE = 0.68;
const out = { source: "Furniture baked from a CC0 kit (apps/playground/tools/furniture-models.mjs), in metres", models: {}, credits: {} };
for (const name of FURNITURE_MODELS) { out.models[`kk-furniture-${name}`] = bake([["furniture", name, [0, 0, 0], 0, SCALE]], (_, file) => readGltf(join(root, dir, `${file}.gltf`))); out.credits[`kk-furniture-${name}`] = credit; }
const target = fileURLToPath(new URL("../src/data/furnitureModels.json", import.meta.url));
fs.writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(Object.entries(out.models).map(([name, model]) => `${name} ${model.size.map((v) => v.toFixed(2)).join("×")}`).join("\n"), `\n→ ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
