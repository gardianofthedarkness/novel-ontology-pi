import { cameraBasis } from "./cameraFraming.js";
import type { Position3 } from "./spatialLayout.js";

export function zoomDistance(distance: number, delta: number, options: { mode?: number; height?: number; fine?: boolean; min?: number; max?: number } = {}): number {
  const minimum = options.min ?? 16, maximum = Math.max(minimum, options.max ?? 1000000);
  const current = Number.isFinite(distance) ? Math.max(minimum, Math.min(maximum, distance)) : minimum;
  if (!Number.isFinite(delta)) return current;
  const pixels = delta * (options.mode === 1 ? 16 : options.mode === 2 ? options.height ?? 800 : 1);
  const bounded = Math.max(-160, Math.min(160, pixels));
  return Math.max(minimum, Math.min(maximum, current * Math.exp(bounded * 0.0045 * (options.fine ? 0.25 : 1))));
}

export function zoomPose(position: Position3, target: Position3, distance: number, options: { horizontal: number; vertical: number; aspect: number; fov: number; up?: Position3 }): { position: Position3; target: Position3 } {
  const offset = position.map((value, axis) => value - target[axis]) as Position3;
  const current = Math.max(0.001, Math.hypot(...offset));
  const { right, up } = cameraBasis(offset, options.up);
  const tangent = Math.tan(options.fov * Math.PI / 360);
  const anchor = target.map((value, axis) => value + right[axis] * options.horizontal * current * tangent * options.aspect + up[axis] * options.vertical * current * tangent) as Position3;
  const factor = distance / current;
  return {
    position: position.map((value, axis) => anchor[axis] + (value - anchor[axis]) * factor) as Position3,
    target: target.map((value, axis) => anchor[axis] + (value - anchor[axis]) * factor) as Position3,
  };
}
