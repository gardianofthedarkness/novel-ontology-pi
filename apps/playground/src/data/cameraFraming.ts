import type { Position3 } from "./spatialLayout.js";

interface FrameOptions {
  width: number;
  height: number;
  fov: number;
  padding?: number;
  margin?: number;
  inset?: { left: number; right: number; top: number; bottom: number };
  direction?: Position3;
}

const dot = (first: Position3, second: Position3) => first.reduce((sum, value, axis) => sum + value * second[axis], 0);
const cross = (first: Position3, second: Position3): Position3 => [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]];
const unit = (value: Position3): Position3 => {
  const length = Math.hypot(...value);
  return length > 0.001 && Number.isFinite(length) ? value.map((coordinate) => coordinate / length) as Position3 : [0, 0, 1];
};

export function cameraFrame(points: Position3[], options: FrameOptions): { target: Position3; position: Position3; center: Position3 } | null {
  const valid = points.filter((point) => point.every(Number.isFinite));
  if (!valid.length) return null;
  const width = Math.max(1, options.width), height = Math.max(1, options.height);
  const inset = options.inset ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const usableWidth = Math.max(width * 0.2, width - inset.left - inset.right);
  const usableHeight = Math.max(height * 0.2, height - inset.top - inset.bottom);
  const direction = unit(options.direction ?? [0.8, 0.42, 1]);
  const right = unit(cross(Math.abs(direction[1]) > 0.98 ? [0, 0, 1] : [0, 1, 0], direction));
  const up = unit(cross(direction, right));
  const center = [0, 1, 2].map((axis) => (Math.min(...valid.map((point) => point[axis])) + Math.max(...valid.map((point) => point[axis]))) / 2) as Position3;
  const extent = (basis: Position3) => Math.max(...valid.map((point) => Math.abs(dot(point.map((value, axis) => value - center[axis]) as Position3, basis)))) + (options.margin ?? 160);
  const tangent = Math.tan(Math.max(1, Math.min(150, options.fov)) * Math.PI / 360);
  const distance = Math.max(extent(right) / (tangent * width / height * usableWidth / width), extent(up) / (tangent * usableHeight / height)) * (options.padding ?? 1.18) + extent(direction);
  const horizontal = (inset.left + usableWidth / 2) / width * 2 - 1;
  const vertical = 1 - (inset.top + usableHeight / 2) / height * 2;
  const target = center.map((value, axis) => value - right[axis] * horizontal * distance * tangent * width / height - up[axis] * vertical * distance * tangent) as Position3;
  return { center, target, position: target.map((value, axis) => value + direction[axis] * distance) as Position3 };
}
