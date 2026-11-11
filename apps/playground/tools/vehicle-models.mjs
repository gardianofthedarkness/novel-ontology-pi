// The vehicles' own models (the settei cast's 'a car': docs/v3/design.html#directing-notes; which one a vehicle is, the
// transport specialist's: engine/casts/transport.mjs), baked as the buildings are (bake-geometry.mjs) into
// src/data/vehicleModels.json, all CC0 1.0:
//  - KayKit City Builder Bits 1.0: five cars (car-hatchback, car-sedan, car-stationwagon, car-taxi, car-police);
//  - Kenney Car Kit 3.1 (the user's download, kenney_car-kit.zip): cars, vans and trucks (kn-*), when its folder is given.
// The other vehicle kinds (a bus, a train, a bike, a helicopter, a plane, a drone, a boat) have no CC0 model on disk; the
// page builds them from parts (engine/view/strand-demo.html, vehicleForm).
//
//   node apps/playground/tools/vehicle-models.mjs <dir holding the unzipped kits> [<the Car Kit's unzipped folder>]
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bake, readGltf } from "./bake-geometry.mjs";

import { readGlb } from "./bake-geometry.mjs";
const [root, kenney] = process.argv.slice(2);
if (!root) throw new Error("Usage: vehicle-models.mjs <dir holding the unzipped kits>");
const dir = "KayKit-City-Builder-Bits-1.0/addons/kaykit_city_builder_bits/Assets/gltf", credit = "KayKit City Builder Bits 1.0 by Kay Lousberg, CC0 1.0 (https://github.com/KayKit-Game-Assets)";
const MODELS = { "car-hatchback": "car_hatchback", "car-sedan": "car_sedan", "car-stationwagon": "car_stationwagon", "car-taxi": "car_taxi", "car-police": "car_police" };
const out = { source: "Vehicle models baked from CC0 kits (apps/playground/tools/vehicle-models.mjs)", models: {}, credits: {} };
for (const [name, part] of Object.entries(MODELS)) { out.models[name] = bake([[ "city", part ]], (_, file) => readGltf(join(root, dir, `${file}.gltf`))); out.credits[name] = credit; }
// Kenney's road vehicles (the transport specialist's choices: engine/casts/transport.mjs VEHICLE_MODELS).
const KENNEY = ["sedan", "sedan-sports", "hatchback-sports", "suv", "suv-luxury", "taxi", "police", "race", "van", "delivery", "delivery-flat", "truck", "truck-flat", "ambulance", "firetruck", "garbage-truck", "tractor"];
if (kenney) for (const part of KENNEY) { out.models[`kn-${part}`] = bake([["car", part]], (_, file) => readGlb(join(kenney, "Models", "GLB format", `${file}.glb`))); out.credits[`kn-${part}`] = "Car Kit 3.1 by Kenney (www.kenney.nl), CC0 1.0"; }
const target = fileURLToPath(new URL("../src/data/vehicleModels.json", import.meta.url));
fs.writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(Object.entries(out.models).map(([name, model]) => `${name} ${model.size.join("×")}`).join("\n"), `\n→ ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
