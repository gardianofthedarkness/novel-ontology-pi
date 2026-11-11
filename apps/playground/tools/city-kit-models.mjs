// Adds the modern city's own models to the baked holograms (src/data/architectureModels.json), all CC0 1.0, so a modern
// street is drawn as one (docs/v3/design.html#model-kit; which use takes which model is config/models.json):
//  - Kenney's City Kit (Suburban) 1.0: 21 detached houses (suburban-01 … suburban-21);
//  - Kenney's City Kit (Industrial) 2.0: 20 factory, warehouse and workshop buildings (industrial-a … industrial-t);
//  - KayKit City Builder Bits 1.0: the six blocks of flats and shops not baked before (kk-block-a … kk-block-f);
//  - Quaternius's Downtown City MegaKit (the free Standard set): its three ready-made brick buildings (brick-small,
//    brick-medium, brick-large), ten to twenty times the edges of the others, so for named buildings only.
// The models already baked stay as they are.
//
//   node apps/playground/tools/city-kit-models.mjs <dir holding the unzipped kits>
//
// The dir holds kenney-city-kit-suburban/extracted, kenney-city-kit-industrial/extracted,
// quaternius-downtown-city-megakit/extracted and KayKit-City-Builder-Bits-1.0.
import fs from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { bake, readGlb, readGltf } from "./bake-geometry.mjs";

const [root] = process.argv.slice(2);
if (!root) throw new Error("Usage: city-kit-models.mjs <dir holding the unzipped kits>");
const kits = {
  suburban: { dir: "kenney-city-kit-suburban/extracted/Models/GLTF format", ext: "glb", credit: "City Kit (Suburban) 1.0 by Kenney, CC0 1.0 (https://kenney.nl/assets/city-kit-suburban)" },
  industrial: { dir: "kenney-city-kit-industrial/extracted/Models/GLB format", ext: "glb", credit: "City Kit (Industrial) 2.0 by Kenney, CC0 1.0 (https://kenney.nl/assets/city-kit-industrial)" },
  city: { dir: "KayKit-City-Builder-Bits-1.0/addons/kaykit_city_builder_bits/Assets/gltf", ext: "gltf", credit: "KayKit City Builder Bits 1.0 by Kay Lousberg, CC0 1.0 (https://github.com/KayKit-Game-Assets)" },
  downtown: { dir: "quaternius-downtown-city-megakit/extracted/Exports/glTF (Godot)", ext: "gltf", credit: "Downtown City MegaKit (Standard) by Quaternius, CC0 1.0 (https://quaternius.com/packs/downtowncitymegakit.html)" },
};
const load = (kit, part) => (kits[kit].ext === "glb" ? readGlb : readGltf)(join(root, kits[kit].dir, `${part}.${kits[kit].ext}`));

/** One model = parts from a kit, as in architecture-models.mjs; here each is one whole building of its kit. */
const MODELS = {
  ...Object.fromEntries(Array.from({ length: 21 }, (_, n) => String(n + 1).padStart(2, "0")).map((n) => [`suburban-${n}`, [["suburban", `house_type${n}`]]])),
  ..."abcdefghijklmnopqrst".split("").reduce((out, letter) => ({ ...out, [`industrial-${letter}`]: [["industrial", `building-${letter}`]] }), {}),
  ..."abcdef".split("").reduce((out, letter) => ({ ...out, [`kk-block-${letter}`]: [["city", `building_${letter.toUpperCase()}_withoutBase`]] }), {}),
  "brick-small": [["downtown", "Building_Small_1"]],
  "brick-medium": [["downtown", "Building_Medium_2_001"]],
  "brick-large": [["downtown", "Building_Large_2"]],
};

const target = fileURLToPath(new URL("../src/data/architectureModels.json", import.meta.url));
const out = JSON.parse(fs.readFileSync(target, "utf8"));
for (const [name, parts] of Object.entries(MODELS)) {
  out.models[name] = bake(parts, load);
  out.credits[name] = kits[parts[0][0]].credit;
}
const kitNames = "City Kit (Suburban) 1.0, City Kit (Industrial) 2.0";
if (!out.source.includes(kitNames)) out.source = out.source.replace("Castle Kit", `Castle Kit, ${kitNames}`);
fs.writeFileSync(target, `${JSON.stringify(out)}\n`);
console.log(Object.entries(MODELS).map(([name]) => `${name} ${out.models[name].size.join("×")}`).join("\n"));
console.log(`${Object.keys(out.models).length} models → ${target} (${(fs.statSync(target).size / 1024).toFixed(0)} KB)`);
