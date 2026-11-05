// The vehicles' own models (the settei cast's 'a car': docs/v2/directing/casts/settei.md), baked as the buildings are
// (bake-geometry.mjs) into src/data/vehicleModels.json, all CC0 1.0:
//  - KayKit City Builder Bits 1.0: five cars (car-hatchback, car-sedan, car-stationwagon, car-taxi, car-police).
// The other vehicle kinds (a bus, a van, a train, a bike, a helicopter, a plane, a drone, a boat) have no CC0 model on
// disk; the page builds them from parts (world-engine/view/strand-demo.html, vehicleForm).
//
//   node apps/playground/tools/vehicle-models.mjs <dir holding the unzipped kits>
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bake, readGltf } from "./bake-geometry.mjs";

const [root] = process.argv.slice(2);
if (!root) throw new Error("Usage: vehicle-models.mjs <dir holding the unzipped kits>");
const dir = "KayKit-City-Builder-Bits-1.0/addons/kaykit_city_builder_bits/Assets/gltf", credit = "KayKit City Builder Bits 1.0 by Kay Lousberg, CC0 1.0 (https://github.com/KayKit-Game-Assets)";
const MODELS = { "car-hatchback": "car_hatchback", "car-sedan": "car_sedan", "car-stationwagon": "car_stationwagon", "car-taxi": "car_taxi", "car-police": "car_police" };
const out = { source: "Vehicle models baked from CC0 kits (apps/playground/tools/vehicle-models.mjs)", models: {}, credits: {} };
for (const [name, part] of Object.entries(MODELS)) { out.models[name] = bake([[ "city", part ]], (_, file) => readGltf(join(root, dir, `${file}.gltf`))); out.credits[name] = credit; }
const target = fileURLToPath(new URL("../src/data/vehicleModels.json", import.meta.url));
fs.writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(Object.entries(out.models).map(([name, model]) => `${name} ${model.size.join("×")}`).join("\n"), `\n→ ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
