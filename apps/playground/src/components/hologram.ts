import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, LineBasicMaterial, MeshBasicMaterial } from "three";

/**
 * The stage's hologram look, one for every 3D view of the app (the atlas's places, the simulated places, the Places
 * world), as the engine's own pages draw it: cyan edges over a faint fill, both additive; buildings the story names warm;
 * Jev's things gold; damage red.
 */
export const HOLO = {
  edge: "#8fd6ff", fill: "#2b86c4", proposed: "#ffd36b",
  namedEdge: "#ffe7b0", namedFill: "#b97f2c",
  thingEdge: "#ffd36e", thingFill: "#ffd36e", damage: "#ff4d5e",
} as const;

/** Hologram edges: additive lines that never hide what is behind them. */
export const holoEdge = (color: string = HOLO.edge, opacity = 0.62) => new LineBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
/** Hologram fill: an additive glow, seen from both sides. */
export const holoFill = (color: string = HOLO.fill, opacity = 0.075) => new MeshBasicMaterial({ color, transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });

/**
 * The edges of boxes standing on the ground, as one line geometry: each box [x, z, w, d, angle, height] (centre, size,
 * turn about the vertical, height) gives its 12 edges, and a line round it at every `storey` metres up, as the
 * holograms draw floors.
 */
export function boxEdges(boxes: number[][], storey = 0): BufferGeometry {
  const points: number[] = [];
  for (const [x, z, w, d, angle, height] of boxes) {
    const cos = Math.cos(-angle), sin = Math.sin(-angle), corner = (u: number, v: number) => [x + u * cos - v * sin, z + u * sin + v * cos];
    const ring = [corner(-w / 2, -d / 2), corner(w / 2, -d / 2), corner(w / 2, d / 2), corner(-w / 2, d / 2)];
    const levels = [0, height];
    if (storey > 0) for (let y = storey; y < height - 0.5; y += storey) levels.push(y);
    for (const y of levels) for (let n = 0; n < 4; n++) { const [ax, az] = ring[n], [bx, bz] = ring[(n + 1) % 4]; points.push(ax, y, az, bx, y, bz); }
    for (const [cx, cz] of ring) points.push(cx, 0, cz, cx, height, cz);
  }
  return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(points, 3));
}
