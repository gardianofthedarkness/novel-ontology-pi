import { useEffect, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import type { GraphCanvasRef } from "reagraph";
import { Vector3, type PerspectiveCamera } from "three";
import { zoomDistance, zoomPose } from "../data/scaleNavigation";
import type { Position3 } from "../data/spatialLayout";

export function ScaleNavigation({ graphRef, reducedMotion }: { graphRef: { current: GraphCanvasRef | null }; reducedMotion: boolean }) {
  const { camera, gl } = useThree();
  const lastWheel = useRef(-Infinity);
  useFrame(() => {
    const controls = graphRef.current?.getControls?.();
    if (!controls) return;
    controls.dollyToCursor = false;
    controls.infinityDolly = false;
    controls.dollySpeed = 1.4;
    controls.smoothTime = reducedMotion ? 0 : 0.14;
    controls.draggingSmoothTime = reducedMotion ? 0 : 0.08;
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
    stage.addEventListener("wheel", wheel, { capture: true, passive: false });
    stage.addEventListener("orbital-zoom", command);
    return () => { stage.removeEventListener("wheel", wheel, true); stage.removeEventListener("orbital-zoom", command); };
  }, [camera, gl, graphRef, reducedMotion]);
  return null;
}
