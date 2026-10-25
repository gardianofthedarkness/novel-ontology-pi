import type { Position3 } from "./spatialLayout.js";

interface FrameOptions {
  width: number;
  height: number;
  fov: number;
  padding?: number;
  margin?: number;
  inset?: { left: number; right: number; top: number; bottom: number };
  direction?: Position3;
  up?: Position3;
  zoom?: number;
}

const dot = (first: Position3, second: Position3) => first.reduce((sum, value, axis) => sum + value * second[axis], 0);
const cross = (first: Position3, second: Position3): Position3 => [first[1] * second[2] - first[2] * second[1], first[2] * second[0] - first[0] * second[2], first[0] * second[1] - first[1] * second[0]];
const unit = (value: Position3): Position3 => {
  const length = Math.hypot(...value);
  return length > 0.001 && Number.isFinite(length) ? value.map((coordinate) => coordinate / length) as Position3 : [0, 0, 1];
};

export function cameraBasis(direction: Position3, up: Position3 = [0, 1, 0]): { right: Position3; up: Position3; direction: Position3 } {
  const forward = unit(direction);
  const requestedUp = unit(up);
  const safeUp: Position3 = Math.abs(dot(requestedUp, forward)) > 0.999 ? Math.abs(forward[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0] : requestedUp;
  const right = unit(cross(safeUp, forward));
  return { right, up: unit(cross(forward, right)), direction: forward };
}

function viewport(options: FrameOptions) {
  const width = Math.max(1, options.width), height = Math.max(1, options.height);
  const inset = options.inset ?? { left: 0, right: 0, top: 0, bottom: 0 };
  const usableWidth = Math.max(1, width - inset.left - inset.right);
  const usableHeight = Math.max(1, height - inset.top - inset.bottom);
  const { direction, right, up } = cameraBasis(options.direction ?? [0.8, 0.42, 1], options.up);
  const tangent = Math.tan(Math.max(1, Math.min(150, options.fov)) * Math.PI / 360) / Math.max(0.001, options.zoom ?? 1);
  const horizontal = (inset.left + usableWidth / 2) / width * 2 - 1;
  const vertical = 1 - (inset.top + usableHeight / 2) / height * 2;
  return { width, height, usableWidth, usableHeight, direction, right, up, tangent, horizontal, vertical };
}

function frameAt(center: Position3, distance: number, view: ReturnType<typeof viewport>) {
  const { right, up, direction, horizontal, vertical, tangent, width, height } = view;
  const target = center.map((value, axis) => value - right[axis] * horizontal * distance * tangent * width / height - up[axis] * vertical * distance * tangent) as Position3;
  return { center, target, position: target.map((value, axis) => value + direction[axis] * distance) as Position3 };
}

export function cameraFrame(points: Position3[], options: FrameOptions): { target: Position3; position: Position3; center: Position3 } | null {
  const valid = points.filter((point) => point.every(Number.isFinite));
  if (!valid.length) return null;
  const view = viewport(options);
  const { right, up, direction, tangent, width, height, usableWidth, usableHeight } = view;
  const center = [0, 1, 2].map((axis) => (Math.min(...valid.map((point) => point[axis])) + Math.max(...valid.map((point) => point[axis]))) / 2) as Position3;
  const extent = (basis: Position3) => Math.max(...valid.map((point) => Math.abs(dot(point.map((value, axis) => value - center[axis]) as Position3, basis)))) + (options.margin ?? 160);
  const distance = Math.max(extent(right) / (tangent * width / height * usableWidth / width), extent(up) / (tangent * usableHeight / height)) * (options.padding ?? 1.18) + extent(direction);
  return frameAt(center, distance, view);
}

export function cameraFocus(center: Position3, radius: number, position: Position3, options: FrameOptions): ReturnType<typeof cameraFrame> {
  if (!center.every(Number.isFinite) || !position.every(Number.isFinite) || !Number.isFinite(radius) || radius <= 0) return null;
  const view = viewport({ ...options, zoom: 1 });
  const available = Math.min(view.usableWidth, view.usableHeight);
  const minimumPixels = Math.max(12, Math.min(28, available * 0.12));
  const maximumPixels = Math.max(minimumPixels, Math.min(180, available * 0.38));
  const readablePixels = Math.min(maximumPixels, Math.max(minimumPixels, available * 0.24));
  const depth = dot(position.map((value, axis) => value - center[axis]) as Position3, view.direction) / Math.max(0.001, options.zoom ?? 1);
  const pixelScale = radius * view.height / (2 * view.tangent);
  const pixels = depth > radius ? pixelScale / depth : Infinity;
  const distance = pixels < minimumPixels ? pixelScale / readablePixels : pixels > maximumPixels ? pixelScale / maximumPixels : depth;
  return frameAt(center, Math.max(16, Math.min(1000000, Math.max(radius * 1.1, distance))), view);
}

/** Pull the camera along its view ray so it stays inside a sphere (e.g. the
 * faint parent ghost that encloses the current level). When the target lies
 * outside the sphere, the camera distance is still capped at its radius. */
export function keepInside(position: Position3, target: Position3, sphere: { center: Position3; radius: number }, fraction = 0.8, minimum = 300): Position3 {
  const offset = position.map((value, axis) => value - target[axis]);
  const distance = Math.hypot(...offset);
  const toTarget = target.map((value, axis) => value - sphere.center[axis]);
  const radius = sphere.radius * fraction;
  if (!distance) return position;
  const unit = offset.map((value) => value / distance);
  if (Math.hypot(...toTarget) >= radius) return distance <= radius ? position : target.map((value, axis) => value + unit[axis] * radius) as Position3;
  const along = unit.reduce((sum, value, axis) => sum + value * toTarget[axis], 0);
  const limit = -along + Math.sqrt(along * along - toTarget.reduce((sum, value) => sum + value * value, 0) + radius * radius);
  const chosen = Math.min(distance, Math.max(minimum, limit));
  return target.map((value, axis) => value + unit[axis] * chosen) as Position3;
}
