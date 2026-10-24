import { forwardRef, useEffect, useMemo, useRef } from "react";
import { GraphCanvas, darkTheme, type GraphCanvasRef, type NodeRendererProps } from "reagraph";
import { useFrame, useThree } from "@react-three/fiber";
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, Line, LineSegments, LineBasicMaterial, Quaternion, SRGBColorSpace, Vector3, type Group } from "three";
import { recordColor } from "../archive";
import type { WorldEdge } from "../types";
import type { Position3 } from "../data/spatialLayout";
import { interpolatePose, type OrbitalDraw, type OrbitalMorph, type OrbitalPath } from "../data/orbitalLayout";
import { framePositions, type LabelBus } from "./WorldGraph";
import { ScaleNavigation } from "./ScaleNavigation";

interface GlyphData {
  draw: OrbitalDraw;
  morph: OrbitalMorph | null;
  reducedMotion: boolean;
  transparent: boolean;
  selected: boolean;
  touched: boolean;
}
export const ORBITAL_TRANSITION_MS = 1100;
const noRaycast = () => undefined;

function SphereGlyph({ node, active }: NodeRendererProps) {
  const group = useRef<Group>(null);
  const data = node.data.glyph as GlyphData;
  const { draw, morph, reducedMotion, transparent, selected, touched } = data;
  const color = recordColor(draw.node);
  const nebula = draw.role === "nebula";
  useFrame(({ clock }) => {
    if (!group.current) return;
    const from = morph?.from.get(draw.node.id);
    const pose = from ? interpolatePose(from, draw, reducedMotion ? 1 : (performance.now() - morph!.startedAt) / ORBITAL_TRANSITION_MS) : draw;
    const drift = reducedMotion || selected || !nebula ? 0 : Math.sin(clock.elapsedTime * 0.45 + draw.node.chrono) * 2.2;
    group.current.position.set(pose.position[0] - draw.position[0], pose.position[1] - draw.position[1] + drift, pose.position[2] - draw.position[2]);
    group.current.scale.setScalar(pose.radius / draw.radius);
  });
  const opacity = transparent ? 0.055 : draw.node.state === "proposed" ? 0.3 : draw.node.state === "held" ? 0.5 : nebula ? 0.7 : 0.9;
  return <group ref={group} userData={{ orbitalGlyph: draw.node.id }}>
    {touched && <mesh raycast={noRaycast}><boxGeometry args={[draw.radius * 2.7, draw.radius * 2.7, draw.radius * 2.7]} /><meshBasicMaterial color="#36adff" wireframe transparent opacity={0.95} toneMapped={false} depthTest={false} /></mesh>}
    <mesh raycast={transparent ? noRaycast : undefined}>
      <sphereGeometry args={[draw.radius, 32, 24]} />
      <meshStandardMaterial color={nebula ? color : "#12283c"} emissive={color} emissiveIntensity={selected ? 0.7 : active ? 0.45 : 0.2} metalness={0.35} roughness={0.27} transparent opacity={opacity} depthWrite={!transparent && draw.node.state === "canon"} />
    </mesh>
    <mesh raycast={noRaycast}>
      <sphereGeometry args={[draw.radius * 1.035, 20, 16]} />
      <meshBasicMaterial color={color} wireframe transparent opacity={transparent ? 0.12 : draw.node.state !== "canon" ? 0.34 : 0.035} depthWrite={false} />
    </mesh>
    <mesh raycast={noRaycast}>
      <sphereGeometry args={[draw.radius * 1.22, 24, 16]} />
      <meshBasicMaterial color={color} transparent opacity={transparent ? 0.018 : nebula ? 0.045 : 0.025} depthWrite={false} />
    </mesh>
    {(selected || draw.node.kind === "location" || draw.node.kind === "bigEvent") && <mesh raycast={noRaycast} rotation={[0.8, 0.25, -0.3]}>
      <torusGeometry args={[draw.radius * 1.18, draw.radius * 0.015, 6, 64]} />
      <meshBasicMaterial color={selected ? "#ccf4ff" : color} transparent opacity={transparent ? 0.22 : 0.65} />
    </mesh>}
    {draw.node.kind === "dialogue" && <mesh raycast={noRaycast} rotation={[0, 0, Math.PI / 4]}>
      <torusGeometry args={[draw.radius * 0.6, draw.radius * 0.04, 6, 4]} />
      <meshBasicMaterial color="#f2cbff" />
    </mesh>}
  </group>;
}
/** Canvas-generated picture card face: gradient + kind label + short id.
 * No external image assets and no EPUB-derived art — the card is a
 * placeholder face until real thumbnails are wired (open follow-up). */
const pictureTextures = new Map<string, CanvasTexture>();
function pictureTexture(kind: string, shortId: string): CanvasTexture {
  const key = `${kind}:${shortId}`;
  const existing = pictureTextures.get(key);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 384;
  const context = canvas.getContext("2d")!;
  const gradient = context.createLinearGradient(0, 0, 512, 384);
  gradient.addColorStop(0, "#1d3a52");
  gradient.addColorStop(0.55, "#0f2236");
  gradient.addColorStop(1, "#1a2f45");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 512, 384);
  context.strokeStyle = "#ffd166";
  context.lineWidth = 6;
  context.strokeRect(14, 14, 484, 356);
  context.strokeStyle = "#ffd16655";
  context.lineWidth = 2;
  context.strokeRect(34, 34, 444, 200);
  context.fillStyle = "#ffd166";
  context.font = "700 44px sans-serif";
  context.textAlign = "center";
  context.fillText(kind.toUpperCase(), 256, 300);
  context.fillStyle = "#d8ecff";
  context.font = "400 30px sans-serif";
  context.fillText(shortId, 256, 344);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  pictureTextures.set(key, texture);
  return texture;
}

/** Framed picture card that always faces the camera (billboard).
 * Mirrors SphereGlyph's morph position/scale handling and sets
 * userData.orbitalGlyph so the label/position bus keeps working. */
function PictureGlyph({ node }: NodeRendererProps) {
  const group = useRef<Group>(null);
  const data = node.data.glyph as GlyphData;
  const { draw, morph, reducedMotion, transparent, selected, touched } = data;
  const { camera } = useThree();
  useFrame(() => {
    if (!group.current) return;
    const from = morph?.from.get(draw.node.id);
    const pose = from ? interpolatePose(from, draw, reducedMotion ? 1 : (performance.now() - morph!.startedAt) / ORBITAL_TRANSITION_MS) : draw;
    group.current.position.set(pose.position[0] - draw.position[0], pose.position[1] - draw.position[1], pose.position[2] - draw.position[2]);
    group.current.scale.setScalar(pose.radius / draw.radius);
    group.current.quaternion.copy(camera.quaternion);
  });
  const width = draw.radius * 2;
  const height = draw.radius * 1.5;
  const opacity = transparent ? 0.055 : draw.node.state === "proposed" ? 0.3 : draw.node.state === "held" ? 0.5 : 0.95;
  const shortId = draw.node.id.replace(/^pic-?/i, "").slice(0, 18) || draw.node.id.slice(0, 18);
  return <group ref={group} userData={{ orbitalGlyph: draw.node.id }}>
    {touched && <mesh raycast={noRaycast}><boxGeometry args={[draw.radius * 2.7, draw.radius * 2.7, draw.radius * 2.7]} /><meshBasicMaterial color="#36adff" wireframe transparent opacity={0.95} toneMapped={false} depthTest={false} /></mesh>}
    <mesh raycast={noRaycast}>
      <boxGeometry args={[width * 1.08, height * 1.08, Math.max(1, draw.radius * 0.08)]} />
      <meshStandardMaterial color="#0d1a26" metalness={0.2} roughness={0.6} transparent opacity={opacity} />
    </mesh>
    <mesh position={[0, 0, Math.max(1, draw.radius * 0.05)]}>
      <planeGeometry args={[width, height]} />
      <meshBasicMaterial map={pictureTexture(draw.node.label, shortId)} transparent opacity={opacity} toneMapped={false} />
    </mesh>
    {selected && <mesh raycast={noRaycast} position={[0, 0, Math.max(1, draw.radius * 0.06)]}>
      <planeGeometry args={[width * 1.14, height * 1.14]} />
      <meshBasicMaterial color="#ccf4ff" wireframe transparent opacity={0.65} />
    </mesh>}
  </group>;
}
function renderSphere(props: NodeRendererProps) {
  const draw = (props.node.data.glyph as GlyphData).draw;
  if (draw.node.kind === "picture") return <PictureGlyph {...props} />;
  return <SphereGlyph {...props} />;
}

function AnimatedTimePath({ path, morph, reducedMotion }: { path: OrbitalPath; morph: OrbitalMorph | null; reducedMotion: boolean }) {
  const line = useMemo(() => new Line(new BufferGeometry().setFromPoints(path.points.map((point) => new Vector3(...point))), new LineBasicMaterial({ color: "#51b7ff", transparent: true, opacity: path.preview ? 0.85 : 0.6, depthWrite: false })), [path]);
  const arrowGroups = useRef<(Group | null)[]>([]);
  const arrowCount = path.preview ? 3 : Math.max(1, Math.min(8, path.points.length - 1));
  const arrowIndices = useMemo(() => Array.from({ length: arrowCount }, (_, index) => Math.max(1, Math.round((index + 1) * (path.points.length - 1) / arrowCount))), [path, arrowCount]);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  useFrame(() => {
    const attribute = line.geometry.attributes.position;
    const points = path.points.map((point, index): Position3 => {
      const from = path.fromPoints?.[index];
      return from && morph ? interpolatePose({ position: from, radius: 1 }, { position: point, radius: 1 }, reducedMotion ? 1 : (performance.now() - morph.startedAt) / ORBITAL_TRANSITION_MS).position : point;
    });
    points.forEach((point, index) => attribute.setXYZ(index, ...point));
    attribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    arrowIndices.forEach((pointIndex, index) => {
      const arrow = arrowGroups.current[index];
      if (!arrow) return;
      const end = new Vector3(...points[pointIndex]);
      const direction = end.clone().sub(new Vector3(...points[Math.max(0, pointIndex - 1)])).normalize();
      arrow.position.copy(end);
      arrow.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction));
    });
  });
  return <>
    <primitive object={line} raycast={noRaycast} />
    {arrowIndices.map((pointIndex, index) => <group key={`${index}:${pointIndex}`} ref={(element) => { arrowGroups.current[index] = element; }}>
      <mesh raycast={noRaycast}><coneGeometry args={[path.preview ? 2.6 : 13, path.preview ? 8 : 40, 8]} /><meshBasicMaterial color="#75ceff" toneMapped={false} /></mesh>
    </group>)}
  </>;
}

function VisibleConnections({ edges, bus }: { edges: WorldEdge[]; bus: LabelBus }) {
  const line = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(edges.length * 6), 3));
    return new LineSegments(geometry, new LineBasicMaterial({ color: "#d8bdff", transparent: true, opacity: 0.8, depthWrite: false }));
  }, [edges]);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  useFrame(() => {
    const attribute = line.geometry.attributes.position;
    edges.forEach((edge, index) => {
      const from = bus.positions.get(edge.from) ?? [0, 0, 0], to = bus.positions.get(edge.to) ?? from;
      attribute.setXYZ(index * 2, ...from); attribute.setXYZ(index * 2 + 1, ...to);
    });
    attribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
  });
  return <primitive object={line} raycast={noRaycast} />;
}

function ActivityBounds({ draws, bus }: { draws: OrbitalDraw[]; bus: LabelBus }) {
  const bounds = useRef<Group>(null);
  useFrame(() => {
    if (!bounds.current || draws.length < 2) return;
    const minimum = [Infinity, Infinity, Infinity];
    const maximum = [-Infinity, -Infinity, -Infinity];
    for (const draw of draws) {
      const position = bus.positions.get(draw.node.id) ?? draw.position;
      for (let axis = 0; axis < 3; axis++) {
        minimum[axis] = Math.min(minimum[axis], position[axis] - draw.radius * 1.6);
        maximum[axis] = Math.max(maximum[axis], position[axis] + draw.radius * 1.6);
      }
    }
    bounds.current.position.set(...minimum.map((value, axis) => (value + maximum[axis]) / 2) as Position3);
    bounds.current.scale.set(...minimum.map((value, axis) => Math.max(1, maximum[axis] - value)) as Position3);
  });
  if (draws.length < 2) return null;
  return <group ref={bounds} userData={{ orbitalActivityBounds: true }}><mesh raycast={noRaycast}><boxGeometry args={[1, 1, 1]} /><meshBasicMaterial color="#36adff" wireframe transparent opacity={0.5} toneMapped={false} depthTest={false} depthWrite={false} /></mesh></group>;
}

function OrbitalProjection({ draws, bus, selectedId, revealedId, transitioning, onReveal, onExtremeBack }: { draws: OrbitalDraw[]; bus: LabelBus; selectedId: string | null; revealedId: string | null; transitioning: boolean; onReveal: (id: string | null) => void; onExtremeBack: () => void }) {
  const { camera, scene, size, gl } = useThree();
  const byId = useMemo(() => new Map(draws.map((draw) => [draw.node.id, draw])), [draws]);
  const revealed = useRef(revealedId); revealed.current = revealedId;
  const zoomOut = useRef(-Infinity);
  const backFired = useRef(false);
  useEffect(() => {
    const wheel = (event: WheelEvent) => { if (event.deltaY > 0) zoomOut.current = performance.now(); };
    const surface = gl.domElement.closest(".stage") ?? gl.domElement;
    surface.addEventListener("wheel", wheel as EventListener, { capture: true, passive: true });
    const command = (event: Event) => { if ((event as CustomEvent<{ delta: number }>).detail.delta > 0) zoomOut.current = performance.now(); };
    surface.addEventListener("orbital-zoom", command);
    let pinch = 0;
    const touch = (event: Event) => { const touches = (event as TouchEvent).touches; if (touches.length !== 2) { pinch = 0; return; } const distance = Math.hypot(touches[0].clientX - touches[1].clientX, touches[0].clientY - touches[1].clientY); if (pinch && distance < pinch) zoomOut.current = performance.now(); pinch = distance; };
    surface.addEventListener("touchmove", touch, { passive: true });
    return () => { surface.removeEventListener("wheel", wheel as EventListener, true); surface.removeEventListener("orbital-zoom", command); surface.removeEventListener("touchmove", touch); };
  }, [gl]);
  useFrame(() => {
    bus.positions.clear();
    const candidates: { draw: OrbitalDraw; position: Vector3; pixels: number; priority: number }[] = [];
    let closest: { id: string; pixels: number; score: number } | null = null;
    scene.traverse((object) => {
      const id = object.userData.orbitalGlyph as string | undefined;
      const draw = id ? byId.get(id) : undefined;
      if (!draw) return;
      const world = object.getWorldPosition(new Vector3());
      bus.positions.set(draw.node.id, world.toArray() as Position3);
      const point = world.clone().project(camera);
      const horizontal = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(draw.radius).add(world).project(camera);
      const pixels = Math.abs(horizontal.x - point.x) * size.width / 2;
      const element = bus.targets.get(draw.node.id);
      if (element) element.style.visibility = "hidden";
      const selectedPreview = draws.some((entry) => entry.node.id === selectedId && entry.previewParentId === draw.node.id);
      if (!transitioning && selectedPreview && world.distanceTo(camera.position) < draw.radius * 4) closest = { id: draw.node.id, pixels, score: 1000000 };
      if (point.z > 1 || (!selectedPreview && (Math.abs(point.x) > 1.2 || Math.abs(point.y) > 1.2))) return;
      if (!transitioning && draw.role === "main" && draw.entry?.scope) {
        const score = pixels - Math.hypot(point.x, point.y) * 20 + (selectedId === draw.node.id || selectedPreview ? 10000 : 0);
        if (pixels >= (revealed.current === draw.node.id ? 46 : 64) && (!closest || score > closest.score)) closest = { id: draw.node.id, pixels, score };
      }
      if ((draw.role === "connection" || draw.role === "preview" && pixels < 3) && selectedId !== draw.node.id) return;
      candidates.push({ draw, position: point, pixels, priority: selectedId === draw.node.id ? 0 : draw.role === "preview" ? 1 : draw.role === "main" ? 2 : 3 });
    });
    const next = closest as { id: string; pixels: number; score: number } | null;
    if ((next?.id ?? null) !== revealed.current) onReveal(next?.id ?? null);
    const occupied: { left: number; top: number; right: number; bottom: number }[] = [];
    for (const candidate of candidates.sort((first, second) => first.priority - second.priority)) {
      const element = bus.targets.get(candidate.draw.node.id);
      if (!element) continue;
      const horizontal = (candidate.position.x * 0.5 + 0.5) * size.width;
      const vertical = (-candidate.position.y * 0.5 + 0.5) * size.height + (candidate.draw.role === "preview" ? candidate.pixels + 10 : candidate.pixels + 18);
      const width = element.offsetWidth, height = element.offsetHeight;
      const rectangle = { left: horizontal - width / 2, right: horizontal + width / 2, top: vertical, bottom: vertical + height };
      if (candidate.priority && occupied.some((other) => rectangle.left < other.right && rectangle.right > other.left && rectangle.top < other.bottom && rectangle.bottom > other.top)) continue;
      element.style.visibility = "visible";
      element.style.transform = `translate(${horizontal}px, ${vertical}px) translate(-50%, 0)`;
      occupied.push(rectangle);
    }
    const main = candidates.filter((entry) => entry.draw.role === "main");
    if (main.length && performance.now() - zoomOut.current < 1000) {
      const extent = Math.max(...main.map((entry) => entry.position.x)) - Math.min(...main.map((entry) => entry.position.x));
      if (!backFired.current && extent < 0.08 && main.every((entry) => entry.pixels < 4)) { backFired.current = true; zoomOut.current = -Infinity; onExtremeBack(); }
      else if (extent > 0.2) backFired.current = false;
    }
  });
  return null;
}

function OrbitalFraming({ graphRef, positions, levelKey, reducedMotion, enabled }: { graphRef: { current: GraphCanvasRef | null }; positions: Position3[]; levelKey: string; reducedMotion: boolean; enabled: boolean }) {
  const { camera, size } = useThree();
  const latest = useRef(positions); latest.current = positions;
  const framingEnabled = useRef(enabled); framingEnabled.current = enabled;
  useEffect(() => {
    (camera as { fov: number }).fov = 42; camera.near = 1; camera.far = 2000000; camera.updateProjectionMatrix();
    const timeout = setTimeout(() => { if (framingEnabled.current) framePositions(graphRef, latest.current, 1.2, !reducedMotion, { direction: levelKey.length % 2 ? [0.18, 0.22, 1] : [-0.18, 0.22, 1] }); }, 100);
    return () => clearTimeout(timeout);
  }, [levelKey, reducedMotion, camera, graphRef, size.width, size.height]);
  return null;
}

interface Props {
  draws: OrbitalDraw[];
  paths: OrbitalPath[];
  edges: WorldEdge[];
  bus: LabelBus;
  selectedId: string | null;
  touchedIds?: string[];
  autoFrame?: boolean;
  revealedId: string | null;
  levelKey: string;
  reducedMotion: boolean;
  morph: OrbitalMorph | null;
  onSelect: (draw: OrbitalDraw) => void;
  onEnter: (draw: OrbitalDraw) => void;
  onReveal: (id: string | null) => void;
  onBack: () => void;
}

export const OrbitalGraph = forwardRef<GraphCanvasRef, Props>(function OrbitalGraph({ draws, paths, edges, bus, selectedId, touchedIds = [], autoFrame = true, revealedId, levelKey, reducedMotion, morph, onSelect, onEnter, onReveal, onBack }, ref) {
  const nodes = useMemo(() => draws.map((draw) => ({ id: draw.node.id, label: draw.node.label, size: draw.radius, fill: recordColor(draw.node), fx: draw.position[0], fy: draw.position[1], fz: draw.position[2], data: { glyph: { draw, morph, reducedMotion, selected: selectedId === draw.node.id, touched: touchedIds.includes(draw.node.id), transparent: revealedId === draw.node.id || draws.some((entry) => entry.role === "connection" && entry.previewParentId === draw.node.id) } as GlyphData } })), [draws, morph, reducedMotion, revealedId, selectedId, touchedIds]);
  const theme = useMemo(() => ({ ...darkTheme, canvas: { background: "#050b15", fog: null } }), []);
  return <GraphCanvas ref={ref} nodes={nodes} edges={[]} theme={theme} renderNode={renderSphere} labelType="none" layoutType="forceDirected3d" cameraMode="rotate" draggable={false} animated={false} minDistance={16} maxDistance={1000000} selections={[]} glOptions={{ antialias: true, preserveDrawingBuffer: true }}
    onNodeClick={(node) => onSelect((node.data.glyph as GlyphData).draw)} onNodeDoubleClick={(node) => onEnter((node.data.glyph as GlyphData).draw)}>
    <ambientLight intensity={0.85} /><directionalLight position={[800, 1200, 1800]} intensity={1.5} color="#c4eaff" />
    <gridHelper args={[18000, 90, "#294760", "#122237"]} position={[0, -950, 0]} />
    <axesHelper args={[900]} position={[-1400, -945, -1200]} />
    {paths.map((path) => <AnimatedTimePath key={path.id} path={path} morph={morph} reducedMotion={reducedMotion} />)}
    <VisibleConnections edges={edges} bus={bus} />
    <ActivityBounds draws={draws.filter(draw => touchedIds.includes(draw.node.id))} bus={bus} />
    <OrbitalProjection key={levelKey} draws={draws} bus={bus} selectedId={selectedId} revealedId={revealedId} transitioning={!!morph} onReveal={onReveal} onExtremeBack={onBack} />
    <ScaleNavigation graphRef={ref as { current: GraphCanvasRef | null }} reducedMotion={reducedMotion} />
    <OrbitalFraming graphRef={ref as { current: GraphCanvasRef | null }} positions={draws.filter((draw) => draw.role !== "preview").map((draw) => draw.position)} levelKey={levelKey} reducedMotion={reducedMotion} enabled={autoFrame} />
  </GraphCanvas>;
});
