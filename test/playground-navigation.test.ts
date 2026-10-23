import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraBasis, cameraFocus, cameraFrame } from "../apps/playground/src/data/cameraFraming.js";
import { zoomDistance, zoomPose } from "../apps/playground/src/data/scaleNavigation.js";
import type { Position3 } from "../apps/playground/src/data/spatialLayout.js";

const close = (actual: number, expected: number) => assert.ok(Math.abs(actual - expected) < 0.000001, `${actual} != ${expected}`);
const subtract = (first: Position3, second: Position3): Position3 => first.map((value, axis) => value - second[axis]) as Position3;
const dot = (first: Position3, second: Position3) => first.reduce((sum, value, axis) => sum + value * second[axis], 0);

test("zoom changes by the same proportion at every scale and reverses without drift", () => {
  const ratio = zoomDistance(1000, 80) / 1000;
  for (const distance of [20, 1000, 100000]) {
    close(zoomDistance(distance, 80) / distance, ratio);
    close(zoomDistance(zoomDistance(distance, 80), -80), distance);
    assert.ok(zoomDistance(distance, 80) > distance);
  }
  assert.ok(zoomDistance(100000, 80) - 100000 > zoomDistance(1000, 80) - 1000);
});

test("wheel units normalize consistently, fine control is slower and limits stay finite", () => {
  close(zoomDistance(1000, 32), zoomDistance(1000, 2, { mode: 1 }));
  close(zoomDistance(1000, 32), zoomDistance(1000, 0.04, { mode: 2, height: 800 }));
  assert.ok(zoomDistance(1000, 80, { fine: true }) < zoomDistance(1000, 80));
  assert.ok(zoomDistance(1000, -80, { fine: true }) > zoomDistance(1000, -80));
  assert.equal(zoomDistance(16, -100000), 16);
  assert.equal(zoomDistance(1000000, 100000), 1000000);
  assert.equal(zoomDistance(NaN, 80), zoomDistance(16, 80));
  assert.equal(zoomDistance(1000, Infinity), 1000);
});

test("cursor-anchored dolly preserves the inspected point and rotated camera direction", () => {
  const target: Position3 = [350, -200, 900];
  const position: Position3 = [-650, 800, -1100];
  const options = { horizontal: 0.6, vertical: -0.4, aspect: 1.5, fov: 45, up: [0, 1, 0] as Position3 };
  const distance = Math.hypot(...subtract(position, target));
  const basis = cameraBasis(subtract(position, target), options.up);
  const tangent = Math.tan(options.fov * Math.PI / 360);
  const anchor = target.map((value, axis) => value + basis.right[axis] * options.horizontal * distance * tangent * options.aspect + basis.up[axis] * options.vertical * distance * tangent) as Position3;
  const pose = zoomPose(position, target, distance / 4, options);
  close(Math.hypot(...subtract(pose.position, pose.target)), distance / 4);
  const direction = cameraBasis(subtract(pose.position, pose.target)).direction;
  direction.forEach((value, axis) => close(value, basis.direction[axis]));
  const relative = subtract(anchor, pose.position);
  const depth = -dot(relative, direction);
  close(dot(relative, basis.right) / (depth * tangent * options.aspect), options.horizontal);
  close(dot(relative, basis.up) / (depth * tangent), options.vertical);
  const restored = zoomPose(pose.position, pose.target, distance, options);
  restored.position.forEach((value, axis) => close(value, position[axis]));
  restored.target.forEach((value, axis) => close(value, target[axis]));
});

test("focus centers the selected point in the usable viewport after rotating, panning or changing lens zoom", () => {
  const center: Position3 = [1234, -567, 890];
  const inset = { left: 28, right: 380, top: 180, bottom: 120 };
  const width = 1280, height = 800;
  for (const direction of [[-1, 0.4, -0.8], [0, 1, 0.00001], [0.4, -0.2, 1]] as Position3[]) {
    for (const zoom of [0.25, 1, 4]) {
      const up: Position3 = [0, 1, 0];
      const frame = cameraFrame([center], { width, height, fov: 45, direction, up, zoom, inset })!;
      const basis = cameraBasis(subtract(frame.position, frame.target), up);
      const relative = subtract(center, frame.position);
      const depth = -dot(relative, basis.direction);
      const tangent = Math.tan(45 * Math.PI / 360) / zoom;
      const horizontal = dot(relative, basis.right) / (depth * tangent * width / height);
      const vertical = dot(relative, basis.up) / (depth * tangent);
      close((horizontal + 1) / 2 * width, (inset.left + width - inset.right) / 2);
      close((1 - vertical) / 2 * height, (inset.top + height - inset.bottom) / 2);
    }
  }
});

test("camera basis supports changed up vectors without degenerating at a pole", () => {
  for (const direction of [[0, 1, 0], [0, 0, 1], [1, 2, 3]] as Position3[]) {
    const basis = cameraBasis(direction, [0, 0, 1]);
    close(dot(basis.right, basis.up), 0);
    close(dot(basis.right, basis.direction), 0);
    close(dot(basis.up, basis.direction), 0);
    for (const vector of [basis.right, basis.up, basis.direction]) close(Math.hypot(...vector), 1);
  }
});

const focusOptions = { width: 1280, height: 542, fov: 42, direction: [0, 0, 1] as Position3, inset: { left: 28, right: 408, top: 217, bottom: 129 } };

test("inspection preserves comfortable apparent size instead of fitting the relationship network", () => {
  const center: Position3 = [800, 400, 100];
  for (const [radius, depth] of [[48, 600], [165, 1800], [13, 170]]) {
    const position: Position3 = [center[0] + 400, center[1] - 200, center[2] + depth];
    const frame = cameraFocus(center, radius, position, focusOptions)!;
    close(frame.position[2] - center[2], depth);
    assert.deepEqual(frame.center, center);
  }
});

test("a tiny selected sphere moves closer to readable size at every hierarchy scale", () => {
  for (const radius of [3, 13, 48, 115, 165, 1650]) {
    const depth = radius * 200;
    const frame = cameraFocus([0, 0, 0], radius, [0, 0, depth], focusOptions)!;
    const pixels = radius * focusOptions.height / (2 * Math.tan(focusOptions.fov * Math.PI / 360) * frame.position[2]);
    assert.ok(frame.position[2] < depth);
    close(pixels, 196 * 0.24);
  }
});

test("oversized or behind-camera selections retreat only enough to fit the selected sphere", () => {
  for (const depth of [-100, 0, 20]) {
    const frame = cameraFocus([0, 0, 0], 115, [0, 0, depth], focusOptions)!;
    const pixels = 115 * focusOptions.height / (2 * Math.tan(focusOptions.fov * Math.PI / 360) * frame.position[2]);
    close(pixels, 196 * 0.38);
    assert.ok(frame.position[2] > 115);
  }
});

test("adaptive focus is stable on repeated clicks and centers the actual subscene after rotation", () => {
  const center: Position3 = [345, -678, 901];
  const direction: Position3 = [-0.6, 0.2, -0.7];
  const basis = cameraBasis(direction);
  for (const size of [{ width: 1280, height: 542 }, { width: 390, height: 844 }]) {
    const options = { ...focusOptions, ...size, direction, inset: { left: 18, right: 48, top: 200, bottom: 260 } };
    const position = center.map((value, axis) => value + basis.direction[axis] * 5000 + basis.right[axis] * 200) as Position3;
    const first = cameraFocus(center, 13, position, options)!;
    const second = cameraFocus(center, 13, first.position, options)!;
    first.position.forEach((value, axis) => close(second.position[axis], value));
    const relative = subtract(center, first.position);
    const depth = -dot(relative, basis.direction);
    const tangent = Math.tan(options.fov * Math.PI / 360);
    const horizontal = dot(relative, basis.right) / (depth * tangent * size.width / size.height);
    const vertical = dot(relative, basis.up) / (depth * tangent);
    close((horizontal + 1) / 2 * size.width, (18 + size.width - 48) / 2);
    close((1 - vertical) / 2 * size.height, (200 + size.height - 260) / 2);
    assert.deepEqual(first.center, center);
  }
});

test("adaptive focus preserves optical apparent size when normalizing a changed lens", () => {
  const frame = cameraFocus([0, 0, 0], 48, [0, 0, 1200], { ...focusOptions, zoom: 2 })!;
  close(frame.position[2], 600);
});

test("adaptive focus rejects invalid records rather than moving the camera to non-finite coordinates", () => {
  assert.equal(cameraFocus([NaN, 0, 0], 48, [0, 0, 1000], focusOptions), null);
  assert.equal(cameraFocus([0, 0, 0], Infinity, [0, 0, 1000], focusOptions), null);
  assert.equal(cameraFocus([0, 0, 0], 0, [0, 0, 1000], focusOptions), null);
  assert.equal(cameraFocus([0, 0, 0], 48, [Infinity, 0, 1000], focusOptions), null);
});
