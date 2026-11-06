// Bakes more models into the place holograms' library (src/data/architectureModels.json) from model files (GLB, or glTF
// with its .bin), keeping every model already there: positions and triangles only, each model sitting on y = 0 and centred
// on x/z, positions int16 (multiply by `step`). Each new model is credited in the library's `credits` (its source and
// licence), and gets its theme and category in src/data/modelThemes.json.
//
//   node apps/playground/tools/architecture-models-add.mjs <recipe.json>
//
// recipe.json: { "models": { "<id>": { "parts": [["<file>", [x, y, z]?, angle?, scale?]], "theme": "modern|ancient|scifi|any",
//   "category": "<category or null>", "credit": "<source, licence>" } } }; files are read relative to the recipe.
import fs from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const [recipeFile] = process.argv.slice(2);
if (!recipeFile) throw new Error("Usage: architecture-models-add.mjs <recipe.json>");
const recipe = JSON.parse(fs.readFileSync(recipeFile, "utf8")), base = dirname(resolve(recipeFile));

/** A GLB, or a glTF and its buffers (a .bin beside it or a data URI). */
function readModel(file) {
  const bytes = fs.readFileSync(file);
  if (bytes.readUInt32LE(0) === 0x46546c67) {
    const jsonLength = bytes.readUInt32LE(12), gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8")), binStart = 20 + jsonLength + 8;
    return { gltf, buffers: [bytes.subarray(binStart, binStart + bytes.readUInt32LE(20 + jsonLength))] };
  }
  const gltf = JSON.parse(bytes.toString("utf8"));
  return { gltf, buffers: (gltf.buffers ?? []).map((buffer) => (buffer.uri.startsWith("data:") ? Buffer.from(buffer.uri.split(",")[1], "base64") : fs.readFileSync(join(dirname(file), decodeURIComponent(buffer.uri))))) };
}
const multiply = (a, b) => { const out = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return out; };
function local(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const turnY = (angle, [tx, ty, tz]) => [Math.cos(angle), 0, -Math.sin(angle), 0, 0, 1, 0, 0, Math.sin(angle), 0, Math.cos(angle), 0, tx, ty, tz, 1];
const TYPES = { 5120: [Int8Array, 127], 5121: [Uint8Array, 255], 5122: [Int16Array, 32767], 5123: [Uint16Array, 65535], 5125: [Uint32Array, 0], 5126: [Float32Array, 0] };
function accessor({ gltf, buffers }, index) {
  const entry = gltf.accessors[index], view = gltf.bufferViews[entry.bufferView], bin = buffers[view.buffer ?? 0];
  const size = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 }[entry.type], [Type, scale] = TYPES[entry.componentType];
  const stride = view.byteStride ?? size * Type.BYTES_PER_ELEMENT, start = (view.byteOffset ?? 0) + (entry.byteOffset ?? 0), out = [];
  const read = { 5120: (at) => bin.readInt8(at), 5121: (at) => bin.readUInt8(at), 5122: (at) => bin.readInt16LE(at), 5123: (at) => bin.readUInt16LE(at), 5125: (at) => bin.readUInt32LE(at), 5126: (at) => bin.readFloatLE(at) }[entry.componentType];
  for (let item = 0; item < entry.count; item++) for (let part = 0; part < size; part++) {
    const value = read(start + item * stride + part * Type.BYTES_PER_ELEMENT);
    out.push(entry.normalized && scale ? Math.max(value / scale, -1) : value);
  }
  return out;
}

function bake(parts) {
  const positions = [], indices = [];
  for (const [file, offset = [0, 0, 0], angle = 0, scale = 1] of parts) {
    const model = readModel(join(base, file));
    const visit = (nodeIndex, parent) => {
      const node = model.gltf.nodes[nodeIndex], matrix = multiply(parent, local(node));
      for (const primitive of node.mesh === undefined ? [] : model.gltf.meshes[node.mesh].primitives) {
        const at = positions.length / 3, points = accessor(model, primitive.attributes.POSITION);
        for (let i = 0; i < points.length; i += 3) { const [x, y, z] = points.slice(i, i + 3); positions.push(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]); }
        const triangles = primitive.indices === undefined ? points.map((_, i) => i).slice(0, points.length / 3) : accessor(model, primitive.indices);
        for (const index of triangles) indices.push(at + index);
      }
      for (const child of node.children ?? []) visit(child, matrix);
    };
    for (const nodeIndex of model.gltf.scenes[model.gltf.scene ?? 0].nodes) visit(nodeIndex, multiply(turnY(angle, offset), [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]));
  }
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3], positions[i]); max[i % 3] = Math.max(max[i % 3], positions[i]); }
  const shift = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2], extent = Math.max(...max.map((value, axis) => value - min[axis])), step = extent / 32767;
  const corners = new Map(), quantized = [], remap = [];
  for (let i = 0; i < positions.length; i += 3) {
    const corner = [0, 1, 2].map((axis) => Math.round((positions[i + axis] - shift[axis]) / step)), key = corner.join(",");
    if (!corners.has(key)) { corners.set(key, quantized.length / 3); quantized.push(...corner); }
    remap.push(corners.get(key));
  }
  const triangles = [];
  for (let i = 0; i < indices.length; i += 3) { const [a, b, c] = [remap[indices[i]], remap[indices[i + 1]], remap[indices[i + 2]]]; if (a !== b && b !== c && a !== c) triangles.push(a, b, c); }
  if (quantized.length / 3 > 65535) throw new Error("Model too large for 16-bit indices");
  return { size: max.map((value, axis) => Math.round((value - min[axis]) * 1000) / 1000), step, positions: Buffer.from(Int16Array.from(quantized).buffer).toString("base64"), indices: Buffer.from(Uint16Array.from(triangles).buffer).toString("base64") };
}

const libraryFile = fileURLToPath(new URL("../src/data/architectureModels.json", import.meta.url)), themesFile = fileURLToPath(new URL("../src/data/modelThemes.json", import.meta.url));
const library = JSON.parse(fs.readFileSync(libraryFile, "utf8")), themes = JSON.parse(fs.readFileSync(themesFile, "utf8"));
library.credits ??= {};
for (const [id, { parts, theme, category = null, credit }] of Object.entries(recipe.models)) {
  library.models[id] = bake(parts);
  library.credits[id] = credit;
  themes.models[id] = { theme, ...(category ? { category } : {}) };
  if (category) ((themes.categories[category] ??= {})[theme] ??= []).includes(id) || themes.categories[category][theme].push(id);
  console.log(`${id}: ${library.models[id].size.join(" × ")} (${theme}${category ? `, ${category}` : ""})`);
}
fs.writeFileSync(libraryFile, `${JSON.stringify(library)}\n`);
fs.writeFileSync(themesFile, `${JSON.stringify(themes, null, 1)}\n`);
console.log(`${Object.keys(library.models).length} models → ${libraryFile} (${(fs.statSync(libraryFile).size / 1024).toFixed(0)} KB)`);
