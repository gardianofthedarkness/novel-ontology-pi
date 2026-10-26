import type { GraphCanvasRef } from "reagraph";
import { Vector3, type PerspectiveCamera } from "three";
import { cameraFocus, cameraFrame, keepInside } from "../data/cameraFraming";

/**
 * Camera framing and the label bus shared by the orbital renderer (they
 * outlived the retired classic WebGL view they started in).
 */
export function framePositions(
  ref: { current: GraphCanvasRef | null },
  positions: [number, number, number][],
  pad = 1.18,
  animated = true,
  options?: { margin?: number; direction?: [number, number, number]; preserveDirection?: boolean; focusRadius?: number; within?: { center: [number, number, number]; radius: number }; ignoreSheet?: boolean },
): void {
  if (!positions.length) return;
  const controls = ref.current?.getControls?.();
  if (!controls) return;
  const camera = controls.camera as PerspectiveCamera;
  const currentPosition = controls.getPosition(new Vector3(), false);
  const currentTarget = controls.getTarget(new Vector3(), false);
  controls.stop();
  void controls.setLookAt(...currentPosition.toArray(), ...currentTarget.toArray(), false);
  const stage = document.querySelector<HTMLElement>(".stage");
  const height = stage?.clientHeight || window.innerHeight;
  const width = stage?.clientWidth || window.innerWidth;
  const bounds = stage?.getBoundingClientRect();
  const sheet = document.querySelector<HTMLElement>(".inspector-sheet:not([hidden])")?.getBoundingClientRect();
  const toolbar = document.querySelector<HTMLElement>(".scene-toolbar")?.getBoundingClientRect();
  const sequence = document.querySelector<HTMLElement>(".scene-sequence")?.getBoundingClientRect();
  const transport = document.querySelector<HTMLElement>(".pipeline")?.getBoundingClientRect();
  const inset = { left: 28, right: 65, top: Math.max(95, (sequence?.bottom ?? toolbar?.bottom ?? 170) - (bounds?.top ?? 0) + 18), bottom: transport && bounds ? bounds.bottom - transport.top + 32 : 200 };
  if (sheet && bounds && !options?.ignoreSheet) {
    if (sheet.width > width * 0.55) inset.bottom = Math.max(inset.bottom, bounds.bottom - sheet.top + 16);
    else inset.right = Math.max(inset.right, bounds.right - sheet.left + 18);
  }
  const direction = options?.direction ?? (positions.length === 1 || options?.preserveDirection
    ? camera.getWorldDirection(new Vector3()).negate().toArray() as [number, number, number]
    : document.querySelector('.structure-switch button[aria-pressed="true"]')?.textContent?.includes("Chronology") ? [0.08, 0.25, 1] as [number, number, number] : undefined);
  const framing = { width, height, fov: camera.fov || 45, inset, padding: pad, margin: options?.margin ?? (positions.length === 1 ? 105 : 190), direction, up: camera.up.toArray() as [number, number, number] };
  const frame = options?.focusRadius !== undefined
    ? cameraFocus(positions[0], options.focusRadius, currentPosition.toArray() as [number, number, number], { ...framing, zoom: camera.zoom })
    : cameraFrame(positions, framing);
  if (!frame) return;
  if (options?.within) frame.position = keepInside(frame.position, frame.target, options.within);
  void controls.zoomTo(1, false);
  void controls.setFocalOffset(0, 0, 0, false);
  void controls.setLookAt(...frame.position, ...frame.target, animated);
}

export interface LabelBus {
  targets: Map<string, HTMLElement>;
  active: Set<string>;
  positions: Map<string, [number, number, number]>;
  trackTargets: Map<string, HTMLElement>;
}
