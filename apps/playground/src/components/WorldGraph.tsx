import { forwardRef, useEffect, useMemo, useRef, useState } from "react";
import { GraphCanvas, darkTheme, type GraphCanvasRef, type GraphNode, type GraphEdge } from "reagraph";
import { useFrame, useThree } from "@react-three/fiber";
import { Vector3, type Object3D, type PerspectiveCamera } from "three";
import { ArchiveNode } from "./ArchiveNode";
import { recordColor } from "../archive";
import type { WorldEdge, WorldNode } from "../types";
import type { TimelineTrack } from "../data/timelineLayout";
import { cameraFocus, cameraFrame, keepInside } from "../data/cameraFraming";

export const SCALE = 3;

const archiveTheme = {
  ...darkTheme,
  canvas: { background: "#080f18", fog: null },
  node: { ...darkTheme.node, opacity: 1, selectedOpacity: 1, inactiveOpacity: 1 },
  edge: { ...darkTheme.edge, fill: "#9aaa84", activeFill: "#acbc8e", opacity: 0.85, selectedOpacity: 1, inactiveOpacity: 0.7 },
  arrow: { fill: "#8a947c", activeFill: "#acbc8e" },
};

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

export function scaledPos(node: WorldNode, interior: boolean): [number, number, number] {
  const position = interior ? node.interiorPos : node.lanePos;
  return [position[0] * SCALE, position[1] * SCALE, position[2] * SCALE];
}

export interface LabelBus {
  targets: Map<string, HTMLElement>;
  active: Set<string>;
  positions: Map<string, [number, number, number]>;
  trackTargets: Map<string, HTMLElement>;
}

function toGraphNode(node: WorldNode, interior: boolean, pinned: boolean): GraphNode {
  const position = scaledPos(node, interior);
  return {
    id: node.id, label: node.label, fill: recordColor(node),
    size: node.kind === "bigEvent" ? 70 : node.kind === "character" ? 38 : 32,
    data: { world: node },
    ...(pinned ? { fx: position[0], fy: position[1], fz: position[2] } : {}),
  };
}

function toGraphEdge(edge: WorldEdge): GraphEdge {
  return {
    id: edge.id, source: edge.from, target: edge.to,
    fill: edge.state === "proposed" ? "#d6b57e" : edge.state === "held" ? "#819398" : edge.kind === "cross" ? "#c0a79a" : edge.kind === "speaks" ? "#a79ab4" : "#9aaa84",
    size: edge.weight && Number.isFinite(edge.weight) && edge.weight > 0 ? Math.min(5, 1.5 + Math.log1p(edge.weight)) : edge.kind === "flow" ? 2.5 : 2,
    dashed: edge.state !== "canon" || edge.kind === "cross",
    dashArray: [12, 8],
    arrowPlacement: "mid",
  };
}

function LabelProjector({ bus, selectedId, hoveredId, nodes, tracks, interior }: {
  bus: LabelBus; selectedId: string | null; hoveredId: string | null; nodes: WorldNode[]; tracks: TimelineTrack[]; interior: boolean;
}) {
  const { camera, size, scene } = useThree();
  const point = useRef(new Vector3());
  const records = useMemo(() => new Map(nodes.map((node) => [node.id, node])), [nodes]);
  useFrame(() => {
    bus.positions.clear();
    const candidates: { element: HTMLElement; horizontal: number; vertical: number; priority: number }[] = [];
    scene.traverse((object) => {
      const data = object.userData as { id?: string; type?: string };
      if (data.type !== "node" || !data.id) return;
      const element = bus.targets.get(data.id);
      if (!element) return;
      element.style.visibility = "hidden";
      const node = records.get(data.id);
      if (!node || !bus.active.has(node.id)) return;
      object.getWorldPosition(point.current);
      bus.positions.set(node.id, [point.current.x, point.current.y, point.current.z]);
      const focused = node.id === selectedId || node.id === hoveredId;
      if (!focused && node.state === "canon" && node.kind === "dialogue") return;
      if (node.kind === "character" && interior) { point.current.x += 125; point.current.y -= 10; }
      else if (node.kind !== "bigEvent") point.current.y -= 110;
      point.current.project(camera);
      if (point.current.z > 1 || Math.abs(point.current.x) > 1 || Math.abs(point.current.y) > 1) return;
      candidates.push({ element, horizontal: (point.current.x * 0.5 + 0.5) * size.width, vertical: (-point.current.y * 0.5 + 0.5) * size.height, priority: node.id === selectedId ? 0 : node.id === hoveredId ? 1 : node.kind === "bigEvent" || node.state !== "canon" ? 2 : node.kind === "scene" ? 3 : node.kind === "character" ? 4 : 5 });
    });
    const occupied: { left: number; top: number; right: number; bottom: number }[] = [];
    candidates.sort((first, second) => first.priority - second.priority);
    for (const candidate of candidates) {
      const width = candidate.element.offsetWidth;
      const height = candidate.element.offsetHeight;
      const rectangle = { left: candidate.horizontal - width / 2 - 5, top: candidate.vertical - height / 2 - 5, right: candidate.horizontal + width / 2 + 5, bottom: candidate.vertical + height / 2 + 5 };
      if (candidate.priority > 0 && occupied.some((other) => rectangle.left < other.right && rectangle.right > other.left && rectangle.top < other.bottom && rectangle.bottom > other.top)) continue;
      candidate.element.style.visibility = "visible";
      candidate.element.style.transform = `translate(${candidate.horizontal}px, ${candidate.vertical}px) translate(-50%, -50%)`;
      occupied.push(rectangle);
    }
    for (const track of tracks) {
      const element = bus.trackTargets.get(track.id);
      if (!element) continue;
      point.current.set((track.start[0] + 70) * SCALE, track.start[1] * SCALE + (interior ? 140 : 245), track.start[2] * SCALE).project(camera);
      const visible = point.current.z < 1 && Math.abs(point.current.x) < 1 && Math.abs(point.current.y) < 1;
      element.style.visibility = visible ? "visible" : "hidden";
      element.style.transform = `translate(${(point.current.x * 0.5 + 0.5) * size.width}px, ${(-point.current.y * 0.5 + 0.5) * size.height}px) translate(-50%, -100%)`;
    }
  });
  return null;
}

function TimelineRails({ tracks }: { tracks: TimelineTrack[] }) {
  return <>{tracks.map((track) => {
    const length = (track.end[0] - track.start[0]) * SCALE;
    const color = track.lane === "branch" ? "#9e877a" : "#81946d";
    return <group key={track.id} position={[track.start[0] * SCALE, track.start[1] * SCALE, track.start[2] * SCALE]}>
      <mesh position={[length / 2, 0, 0]}><boxGeometry args={[length, 2.2, 2.2]} /><meshBasicMaterial color={color} /></mesh>
      <mesh position={[length + 8, 0, 0]} rotation={[0, 0, -Math.PI / 2]}><coneGeometry args={[9, 24, 3]} /><meshBasicMaterial color={color} /></mesh>
    </group>;
  })}</>;
}

function OntologyGrid({ positions }: { positions: [number, number, number][] }) {
  const bounds = useMemo(() => {
    const extent = Math.max(1800, ...positions.flatMap((position) => position.map(Math.abs)));
    const size = Math.ceil((extent * 2 + 1800) / 600) * 600;
    const floor = Math.min(-600, ...positions.map((position) => position[1] - 320));
    return { size, floor, back: -size / 2 };
  }, [positions]);
  return <group>
    <gridHelper args={[bounds.size, Math.min(100, bounds.size / 180), "#365e78", "#1a3043"]} position={[0, bounds.floor, 0]} />
    <gridHelper args={[bounds.size, Math.min(100, bounds.size / 180), "#24445b", "#142536"]} position={[0, bounds.floor + bounds.size / 2, bounds.back]} rotation={[Math.PI / 2, 0, 0]} />
    <axesHelper args={[Math.min(bounds.size / 3, 1400)]} position={[-bounds.size / 2, bounds.floor + 2, bounds.back]} />
  </group>;
}

function SemanticZoom({ nodes, openableIds, onOpen, interior, onExit }: { nodes: WorldNode[]; openableIds: string[]; onOpen: (node: WorldNode) => void; interior: boolean; onExit: () => void }) {
  const { camera, scene, gl, size } = useThree();
  const intent = useRef({ at: -Infinity, horizontal: 0, vertical: 0, direction: "in" as "in" | "out" });
  const fired = useRef(false);
  const nodeKey = JSON.stringify([nodes.map((node) => node.id), openableIds]);
  useEffect(() => { fired.current = false; intent.current.at = -Infinity; }, [nodeKey]);
  const available = useMemo(() => new Map(nodes.filter((node) => openableIds.includes(node.id)).map((node) => [node.id, node])), [nodes, openableIds]);
  useEffect(() => {
    const surface = gl.domElement.closest(".stage") ?? gl.domElement;
    const recordIntent = (horizontal: number, vertical: number, direction: "in" | "out") => {
      const rectangle = gl.domElement.getBoundingClientRect();
      intent.current = { at: performance.now(), horizontal: ((horizontal - rectangle.left) / rectangle.width) * 2 - 1, vertical: 1 - ((vertical - rectangle.top) / rectangle.height) * 2, direction };
    };
    const wheel = (event: Event) => {
      const input = event as WheelEvent;
      if (input.deltaY) recordIntent(input.clientX, input.clientY, input.deltaY < 0 ? "in" : "out");
    };
    let pinchDistance = 0;
    const resetPinch = () => { pinchDistance = 0; };
    const touch = (event: Event) => {
      const input = event as TouchEvent;
      if (input.touches.length !== 2) { pinchDistance = 0; return; }
      const [first, second] = input.touches;
      const distance = Math.hypot(first.clientX - second.clientX, first.clientY - second.clientY);
      if (pinchDistance && distance !== pinchDistance) recordIntent((first.clientX + second.clientX) / 2, (first.clientY + second.clientY) / 2, distance > pinchDistance ? "in" : "out");
      pinchDistance = distance;
    };
    surface.addEventListener("wheel", wheel, { passive: true });
    surface.addEventListener("touchstart", resetPinch, { passive: true });
    surface.addEventListener("touchmove", touch, { passive: true });
    surface.addEventListener("touchend", resetPinch, { passive: true });
    surface.addEventListener("touchcancel", resetPinch, { passive: true });
    return () => {
      surface.removeEventListener("wheel", wheel);
      surface.removeEventListener("touchstart", resetPinch);
      surface.removeEventListener("touchmove", touch);
      surface.removeEventListener("touchend", resetPinch);
      surface.removeEventListener("touchcancel", resetPinch);
    };
  }, [gl]);
  useFrame(() => {
    if (fired.current || performance.now() - intent.current.at > 1500) return;
    const usableHeight = Math.max(0.4, (size.height - 300) / size.height);
    const usableWidth = Math.max(0.5, (size.width - 90) / size.width);
    if (interior && intent.current.direction === "out") {
      const points: Vector3[] = [];
      scene.traverse((object) => {
        if (object.userData.type !== "node") return;
        const position = object.getWorldPosition(new Vector3());
        points.push(position.clone().add(new Vector3(-90, -90, 0)).project(camera), position.clone().add(new Vector3(90, 90, 0)).project(camera));
      });
      if (!points.length) return;
      const horizontal = (Math.max(...points.map((point) => point.x)) - Math.min(...points.map((point) => point.x))) / (2 * usableWidth);
      const vertical = (Math.max(...points.map((point) => point.y)) - Math.min(...points.map((point) => point.y))) / (2 * usableHeight);
      if (Math.max(horizontal, vertical) < 0.26) { fired.current = true; onExit(); }
      return;
    }
    if (intent.current.direction !== "in") return;
    const candidates: { node: WorldNode; distance: number }[] = [];
    scene.traverse((object) => {
      if (object.userData.type !== "node") return;
      const node = available.get(object.userData.id);
      if (!node) return;
      const position = object.getWorldPosition(new Vector3());
      const center = position.clone().project(camera);
      if (center.z > 1 || Math.abs(center.x) > 1.2 || Math.abs(center.y) > 1.2) return;
      const height = node.kind === "bigEvent" ? 180 : 75;
      const width = node.kind === "bigEvent" ? 170 : 80;
      const top = position.clone().add(new Vector3(0, height, 0)).project(camera);
      const bottom = position.clone().add(new Vector3(0, -height, 0)).project(camera);
      const left = position.clone().add(new Vector3(-width, 0, 0)).project(camera);
      const right = position.clone().add(new Vector3(width, 0, 0)).project(camera);
      const halfHeight = Math.abs(top.y - bottom.y) / 2;
      const halfWidth = Math.abs(right.x - left.x) / 2;
      if (halfHeight < 0.68 * usableHeight || Math.abs(center.x - intent.current.horizontal) > halfWidth + 0.12 || Math.abs(center.y - intent.current.vertical) > halfHeight + 0.12) return;
      candidates.push({ node, distance: Math.hypot(center.x - intent.current.horizontal, center.y - intent.current.vertical) });
    });
    const next = candidates.sort((first, second) => first.distance - second.distance)[0];
    if (next) { fired.current = true; onOpen(next.node); }
  });
  return null;
}

function Framing({ graphRef, positions, viewKey, reducedMotion }: {
  graphRef: { current: GraphCanvasRef | null }; positions: { current: [number, number, number][] }; viewKey: string; reducedMotion: boolean;
}) {
  const { width, height } = useThree((state) => state.size);
  const scene = useThree((state) => state.scene);
  const camera = useThree((state) => state.camera) as PerspectiveCamera;
  const surface = useThree((state) => state.gl.domElement);
  useEffect(() => {
    camera.fov = 42;
    camera.near = 1;
    camera.far = 2_000_000;
    camera.updateProjectionMatrix();
    let interacted = false;
    const markInteraction = () => { interacted = true; };
    const interactionSurface = surface.closest(".stage") ?? surface;
    interactionSurface.addEventListener("wheel", markInteraction, { passive: true });
    interactionSurface.addEventListener("pointerdown", markInteraction, { passive: true });
    interactionSurface.addEventListener("keydown", markInteraction);
    const apply = () => { if (!interacted) framePositions(graphRef, positions.current, 1.18, !reducedMotion); };
    const settle = () => {
      if (interacted) return;
      const actual: [number, number, number][] = [];
      scene.traverse((object) => {
        if (object.userData.type !== "node") return;
        const position = object.getWorldPosition(new Vector3());
        actual.push([position.x, position.y, position.z]);
      });
      framePositions(graphRef, actual.length ? actual : positions.current, 1.18, !reducedMotion);
    };
    const initial = setTimeout(apply, 100);
    const settled = setTimeout(settle, 900);
    return () => {
      clearTimeout(initial); clearTimeout(settled);
      interactionSurface.removeEventListener("wheel", markInteraction);
      interactionSurface.removeEventListener("pointerdown", markInteraction);
      interactionSurface.removeEventListener("keydown", markInteraction);
    };
  }, [graphRef, positions, viewKey, width, height, reducedMotion, scene, surface, camera]);
  return null;
}

export const JOIN_MS = 1100;

/**
 * The EM join animation (classic view): when entity matching merges
 * two records, the dropped node glides into its survivor, shrinking
 * as it arrives while the survivor briefly swells — then the app
 * settles the merge in the data and the dropped node is gone.
 * Mounted LAST inside the canvas so its per-frame writes win over
 * the layout's pinned positions. If either node is not in this view,
 * it settles immediately (the data must never wait on a camera).
 */
function JoinAnimator({ join, reducedMotion, onSettled }: {
  join: { dropId: string; keepId: string; seq: number } | null;
  reducedMotion: boolean;
  onSettled: (dropId: string) => void;
}) {
  const scene = useThree((state) => state.scene);
  const flight = useRef<{ key: string; from: Vector3; to: Vector3; startedAt: number; settled: boolean } | null>(null);
  useFrame(() => {
    if (!join) {
      flight.current = null;
      return;
    }
    const key = `${join.seq}:${join.dropId}->${join.keepId}`;
    let drop: Object3D | undefined;
    let keep: Object3D | undefined;
    scene.traverse((object) => {
      if (object.userData?.type !== "node") return;
      if (object.userData.id === join.dropId) drop = object;
      if (object.userData.id === join.keepId) keep = object;
    });
    if (!drop || !keep) {
      if (flight.current?.key !== key) {
        flight.current = { key, from: new Vector3(), to: new Vector3(), startedAt: 0, settled: true };
        onSettled(join.dropId);
      }
      return;
    }
    if (flight.current?.key !== key) {
      flight.current = {
        key,
        from: drop.position.clone(),
        to: keep.position.clone(),
        startedAt: performance.now(),
        settled: false,
      };
    }
    const state = flight.current;
    const t = reducedMotion ? 1 : Math.min(1, (performance.now() - state.startedAt) / JOIN_MS);
    const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    drop.position.lerpVectors(state.from, state.to, eased);
    drop.scale.setScalar(Math.max(0.05, 1 - 0.85 * eased));
    keep.scale.setScalar(1 + 0.18 * Math.sin(eased * Math.PI));
    if (t >= 1 && !state.settled) {
      state.settled = true;
      keep.scale.setScalar(1);
      onSettled(join.dropId);
    }
  });
  return null;
}

interface Props {
  nodes: WorldNode[]; edges: WorldEdge[]; interior: boolean; viewId: string;
  tracks: TimelineTrack[]; openableIds: string[];
  contextNodeIds?: string[];
  labelBus: LabelBus; selectedId: string | null; reducedMotion: boolean;
  join: { dropId: string; keepId: string; seq: number } | null;
  onJoinSettled: (dropId: string) => void;
  onNodeClick: (node: WorldNode) => void; onNodeOpen: (node: WorldNode) => void;
  onViewBack: () => void;
}

export const WorldGraph = forwardRef<GraphCanvasRef, Props>(function WorldGraph(
  { nodes, edges, tracks, interior, viewId, openableIds, contextNodeIds, labelBus, selectedId, reducedMotion, join, onJoinSettled, onNodeClick, onNodeOpen, onViewBack }, ref,
) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const positions = useRef<[number, number, number][]>([]);
  positions.current = nodes.map((node) => scaledPos(node, interior));
  const graphNodes = useMemo(() => nodes.map((node) => toGraphNode(node, interior, true)), [nodes, interior]);
  const graphEdges = useMemo(() => {
    const ids = new Set(nodes.map((node) => node.id));
    return edges.filter((edge) => ids.has(edge.from) && ids.has(edge.to) && (!interior || !edge.id.includes(":narrative-order:"))).map(toGraphEdge);
  }, [nodes, edges, interior]);
  const selections = useMemo(() => selectedId ? [selectedId] : [], [selectedId]);
  return (
    <GraphCanvas
      ref={ref}
      nodes={graphNodes}
      edges={graphEdges}
      theme={archiveTheme}
      renderNode={ArchiveNode}
      selections={selections}
      glOptions={{ preserveDrawingBuffer: true, antialias: true }}
      layoutType="forceDirected3d" cameraMode="rotate" draggable={false} labelType="none"
      minDistance={260} maxDistance={1_000_000}
      edgeArrowPosition="end" edgeInterpolation="linear" animated={false}
      onNodeClick={(node) => onNodeClick(node.data.world as WorldNode)}
      onNodePointerOver={(node) => setHoveredId(node.id)}
      onNodePointerOut={() => setHoveredId(null)}
    >
      <ambientLight intensity={0.8} />
      <directionalLight position={[-900, 1800, 2200]} intensity={1.6} color="#fff9e9" />
      <directionalLight position={[1400, -600, 500]} intensity={0.5} color="#cdd4c4" />
      <OntologyGrid positions={contextNodeIds ? nodes.filter((node) => contextNodeIds.includes(node.id)).map((node) => scaledPos(node, interior)) : positions.current} />
      <TimelineRails tracks={tracks} />
      <Framing graphRef={ref as { current: GraphCanvasRef | null }} positions={positions} viewKey={viewId} reducedMotion={reducedMotion} />
      <LabelProjector bus={labelBus} selectedId={selectedId} hoveredId={hoveredId} nodes={nodes} tracks={tracks} interior={interior} />
      <SemanticZoom key={viewId} nodes={nodes} openableIds={openableIds} onOpen={onNodeOpen} interior={interior} onExit={onViewBack} />
      <JoinAnimator join={join} reducedMotion={reducedMotion} onSettled={onJoinSettled} />
    </GraphCanvas>
  );
});
