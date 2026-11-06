// Geometry for the place holograms, shared by the bakers (architecture-models.mjs, modern-kit-models.mjs): a model's
// meshes read from a glTF (a .glb, or a .gltf with its .bin beside it), every node's transform applied, then sat on y = 0,
// centred on x/z, with positions as int16 (multiply by `step`) and triangles as uint16: positions and triangles only.
import fs from "node:fs";
import { dirname, join } from "node:path";

/** A .glb: its JSON and its binary chunk. */
export function readGlb(file) {
  const bytes = fs.readFileSync(file);
  const jsonLength = bytes.readUInt32LE(12);
  const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
  const binStart = 20 + jsonLength + 8;
  return { gltf, bin: bytes.subarray(binStart, binStart + bytes.readUInt32LE(20 + jsonLength)) };
}
/** A .gltf: its JSON and its one buffer, from the file it names beside it. */
export function readGltf(file) {
  const gltf = JSON.parse(fs.readFileSync(file, "utf8"));
  return { gltf, bin: fs.readFileSync(join(dirname(file), gltf.buffers[0].uri)) };
}
const multiply = (a, b) => { const out = new Array(16).fill(0); for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) for (let k = 0; k < 4; k++) out[c * 4 + r] += a[k * 4 + r] * b[c * 4 + k]; return out; };
function local(node) {
  if (node.matrix) return node.matrix;
  const [x, y, z, w] = node.rotation ?? [0, 0, 0, 1], [sx, sy, sz] = node.scale ?? [1, 1, 1], [tx, ty, tz] = node.translation ?? [0, 0, 0];
  return [(1 - 2 * (y * y + z * z)) * sx, 2 * (x * y + z * w) * sx, 2 * (x * z - y * w) * sx, 0, 2 * (x * y - z * w) * sy, (1 - 2 * (x * x + z * z)) * sy, 2 * (y * z + x * w) * sy, 0, 2 * (x * z + y * w) * sz, 2 * (y * z - x * w) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
}
const turnY = (angle, [tx, ty, tz]) => [Math.cos(angle), 0, -Math.sin(angle), 0, 0, 1, 0, 0, Math.sin(angle), 0, Math.cos(angle), 0, tx, ty, tz, 1];

function accessor({ gltf, bin }, index) {
  const entry = gltf.accessors[index], view = gltf.bufferViews[entry.bufferView];
  const size = { SCALAR: 1, VEC3: 3 }[entry.type], Type = { 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array, 5121: Uint8Array }[entry.componentType];
  const stride = view.byteStride ?? size * Type.BYTES_PER_ELEMENT, start = (view.byteOffset ?? 0) + (entry.byteOffset ?? 0);
  const out = [];
  for (let item = 0; item < entry.count; item++) for (let part = 0; part < size; part++) {
    const at = start + item * stride + part * Type.BYTES_PER_ELEMENT;
    out.push(Type === Float32Array ? bin.readFloatLE(at) : Type === Uint32Array ? bin.readUInt32LE(at) : Type === Uint16Array ? bin.readUInt16LE(at) : bin.readUInt8(at));
  }
  return out;
}

/** One model from parts `[kit, name, offset, angle, scale]`; `load(kit, name)` reads a part's glTF. */
export function bake(parts, load) {
  const positions = [], indices = [];
  for (const [kitName, name, offset = [0, 0, 0], angle = 0, scale = 1] of parts) {
    const glb = load(kitName, name);
    const visit = (nodeIndex, parent) => {
      const node = glb.gltf.nodes[nodeIndex], matrix = multiply(parent, local(node));
      for (const primitive of node.mesh === undefined ? [] : glb.gltf.meshes[node.mesh].primitives) {
        const base = positions.length / 3, points = accessor(glb, primitive.attributes.POSITION);
        for (let i = 0; i < points.length; i += 3) {
          const [x, y, z] = points.slice(i, i + 3);
          positions.push(matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12], matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13], matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14]);
        }
        const triangles = primitive.indices === undefined ? points.map((_, i) => i).slice(0, points.length / 3) : accessor(glb, primitive.indices);
        for (const index of triangles) indices.push(base + index);
      }
      for (const child of node.children ?? []) visit(child, matrix);
    };
    for (const nodeIndex of glb.gltf.scenes[glb.gltf.scene ?? 0].nodes) visit(nodeIndex, multiply(turnY(angle, offset), [scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, scale, 0, 0, 0, 0, 1]));
  }
  // Sit on y = 0, centred on x/z; one vertex per distinct corner (the kits split them by texture seam).
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i++) { min[i % 3] = Math.min(min[i % 3], positions[i]); max[i % 3] = Math.max(max[i % 3], positions[i]); }
  const shift = [(min[0] + max[0]) / 2, min[1], (min[2] + max[2]) / 2];
  // 16-bit positions over the model's largest extent (sub-millimetre at building scale).
  const extent = Math.max(...max.map((value, axis) => value - min[axis])), step = extent / 32767;
  const corners = new Map(), quantized = [], remap = [];
  for (let i = 0; i < positions.length; i += 3) {
    const corner = [0, 1, 2].map((axis) => Math.round((positions[i + axis] - shift[axis]) / step));
    const key = corner.join(",");
    if (!corners.has(key)) { corners.set(key, quantized.length / 3); quantized.push(...corner); }
    remap.push(corners.get(key));
  }
  const triangles = [];
  for (let i = 0; i < indices.length; i += 3) {
    const [a, b, c] = [remap[indices[i]], remap[indices[i + 1]], remap[indices[i + 2]]];
    if (a !== b && b !== c && a !== c) triangles.push(a, b, c);
  }
  if (quantized.length / 3 > 65535) throw new Error("Model too large for 16-bit indices");
  return { size: max.map((value, axis) => Math.round((value - min[axis]) * 1000) / 1000), step, positions: Buffer.from(Int16Array.from(quantized).buffer).toString("base64"), indices: Buffer.from(Uint16Array.from(triangles).buffer).toString("base64") };
}

