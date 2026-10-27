import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { GraphCanvasRef } from "reagraph";
import { Vector3, type PerspectiveCamera } from "three";
import type CameraControls from "camera-controls";
import { zoomDistance, zoomPose } from "../data/scaleNavigation";
import type { Position3 } from "../data/spatialLayout";

export function ScaleNavigation({ graphRef, reducedMotion }: { graphRef: { current: GraphCanvasRef | null }; reducedMotion: boolean }) {
  const { camera, gl } = useThree();
  const lastWheel = useRef(-Infinity);
  const rotating = useRef(false), space = useRef(false);
  useFrame(() => {
    const controls = graphRef.current?.getControls?.();
    if (!controls) return;
    controls.dollyToCursor = false;
    controls.infinityDolly = false;
    controls.dollySpeed = 1.4;
    // Map-style navigation (tried against orbit-on-left-drag, which swung the
    // whole timeline around on a short drag): left drag pans, right drag (or
    // Shift / Space + drag) turns, two fingers pinch and turn. Turning is
    // gentler than the default and never goes under the floor.
    const { ACTION } = controls.constructor as unknown as typeof CameraControls;
    if (!rotating.current) controls.mouseButtons.left = ACTION.TRUCK;
    controls.mouseButtons.right = ACTION.ROTATE;
    controls.touches.one = ACTION.TOUCH_TRUCK;
    controls.touches.two = ACTION.TOUCH_DOLLY_ROTATE;
    controls.azimuthRotateSpeed = 0.55;
    controls.polarRotateSpeed = 0.45;
    controls.minPolarAngle = Math.PI * 0.08;
    controls.maxPolarAngle = Math.PI * 0.56;
    controls.smoothTime = reducedMotion ? 0 : 0.22;
    controls.draggingSmoothTime = reducedMotion ? 0 : 0.1;
    if (camera.zoom !== 1) {
      const distance = controls.distance / camera.zoom;
      void controls.zoomTo(1, false);
      void controls.dollyTo(Math.max(16, Math.min(1000000, distance)), false);
    }
  });
  useEffect(() => {
    const stage = gl.domElement.closest(".stage") ?? gl.domElement;
    const apply = (delta: number, horizontal: number, vertical: number, mode = 0, fine = false) => {
      const controls = graphRef.current?.getControls?.();
      if (!controls || !delta) return;
      const now = performance.now();
      if (now - lastWheel.current > 180) {
        const position = controls.getPosition(new Vector3(), false);
        const target = controls.getTarget(new Vector3(), false);
        controls.stop();
        void controls.setLookAt(...position.toArray(), ...target.toArray(), false);
      }
      lastWheel.current = now;
      const position = controls.getPosition(new Vector3()).toArray() as Position3;
      const target = controls.getTarget(new Vector3()).toArray() as Position3;
      const current = Math.hypot(...position.map((value, axis) => value - target[axis]));
      const rectangle = gl.domElement.getBoundingClientRect();
      const distance = zoomDistance(current, delta, { mode, fine, height: rectangle.height });
      const pose = zoomPose(position, target, distance, { horizontal, vertical, aspect: rectangle.width / Math.max(1, rectangle.height), fov: (camera as PerspectiveCamera).fov, up: camera.up.toArray() as Position3 });
      void controls.setLookAt(...pose.position, ...pose.target, !reducedMotion);
    };
    const wheel = (event: Event) => {
      const input = event as WheelEvent;
      if (!graphRef.current?.getControls?.()) return;
      input.preventDefault();
      input.stopImmediatePropagation();
      const rectangle = gl.domElement.getBoundingClientRect();
      apply(input.deltaY, (input.clientX - rectangle.left) / rectangle.width * 2 - 1, 1 - (input.clientY - rectangle.top) / rectangle.height * 2, input.deltaMode, input.shiftKey);
    };
    const command = (event: Event) => apply((event as CustomEvent<{ delta: number }>).detail.delta, 0, 0);
    // Shift (or Space, handled by the graph) + drag turns instead of panning: trackpads have no easy right drag.
    const press = (event: Event) => {
      const controls = graphRef.current?.getControls?.();
      if (!controls || (event as PointerEvent).button !== 0) return;
      const { ACTION } = controls.constructor as unknown as typeof CameraControls;
      rotating.current = (event as PointerEvent).shiftKey || space.current;
      controls.mouseButtons.left = rotating.current ? ACTION.ROTATE : ACTION.TRUCK;
    };
    const release = () => { rotating.current = false; };
    const key = (event: KeyboardEvent) => { if (event.code === "Space") space.current = event.type === "keydown"; };
    const grab = (event: Event) => gl.domElement.classList.toggle("is-grabbing", event.type === "pointerdown");
    stage.addEventListener("wheel", wheel, { capture: true, passive: false });
    stage.addEventListener("orbital-zoom", command);
    gl.domElement.addEventListener("pointerdown", press, true);
    gl.domElement.addEventListener("pointerdown", grab);
    window.addEventListener("pointerup", release);
    window.addEventListener("pointerup", grab);
    window.addEventListener("keydown", key);
    window.addEventListener("keyup", key);
    return () => { window.removeEventListener("keydown", key); window.removeEventListener("keyup", key); stage.removeEventListener("wheel", wheel, true); stage.removeEventListener("orbital-zoom", command); gl.domElement.removeEventListener("pointerdown", press, true); gl.domElement.removeEventListener("pointerdown", grab); window.removeEventListener("pointerup", release); window.removeEventListener("pointerup", grab); };
  }, [camera, gl, graphRef, reducedMotion]);
  return null;
}
