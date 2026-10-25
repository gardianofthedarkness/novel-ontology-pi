import { forwardRef, useEffect, useMemo, useRef } from "react";
import { GraphCanvas, darkTheme, type GraphCanvasRef, type NodeRendererProps } from "reagraph";
import { useFrame, useThree } from "@react-three/fiber";
import { BufferGeometry, CanvasTexture, MeshBasicMaterial, Float32BufferAttribute, Line, LineBasicMaterial, LineDashedMaterial, LineSegments, QuadraticBezierCurve3, Quaternion, SRGBColorSpace, Vector3, type Group } from "three";
import { recordColor } from "../archive";
import type { WorldEdge } from "../types";
import type { Position3 } from "../data/spatialLayout";
import { entryFrame, interpolatePose, uncoilEase, type BackdropGhost, type OrbitalDraw, type OrbitalMorph, type OrbitalPath } from "../data/orbitalLayout";
import type { CausalArrow } from "../data/causalProjection";
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
  /** Nebula weight: strongly linked entities are solid, weak ones faint —
   * proposed/held keep their own (lower) bands so states stay distinct. */
  const weight = nebula ? Math.min(1, Math.max(0, draw.prominence ?? 0.7)) : 1;
  const opacity = transparent ? 0.055 : draw.node.state === "proposed" ? (nebula ? 0.14 + 0.22 * weight : 0.3) : draw.node.state === "held" ? (nebula ? 0.25 + 0.3 * weight : 0.5) : nebula ? 0.18 + 0.67 * weight : 0.9;
  const light = nebula && weight < 0.35 && !selected;
  const segments: [number, number] = light ? [16, 12] : [32, 24];
  return <group ref={group} userData={{ orbitalGlyph: draw.node.id }}>
    {touched && <mesh raycast={noRaycast}><boxGeometry args={[draw.radius * 2.7, draw.radius * 2.7, draw.radius * 2.7]} /><meshBasicMaterial color="#36adff" wireframe transparent opacity={0.95} toneMapped={false} depthTest={false} /></mesh>}
    <mesh raycast={transparent ? noRaycast : undefined}>
      <sphereGeometry args={[draw.radius, ...segments]} />
      <meshStandardMaterial color={nebula ? color : "#12283c"} emissive={color} emissiveIntensity={selected ? 0.7 : active ? 0.45 : nebula ? 0.08 + 0.2 * weight : 0.2} metalness={0.35} roughness={0.27} transparent opacity={opacity} depthWrite={!transparent && draw.node.state === "canon" && opacity >= 0.5} />
    </mesh>
    <mesh raycast={noRaycast}>
      <sphereGeometry args={[draw.radius * 1.035, light ? 10 : 20, light ? 8 : 16]} />
      <meshBasicMaterial color={color} wireframe transparent opacity={transparent ? 0.12 : draw.node.state !== "canon" ? 0.34 : 0.035} depthWrite={false} />
    </mesh>
    <mesh raycast={noRaycast}>
      <sphereGeometry args={[draw.radius * 1.22, light ? 12 : 24, light ? 8 : 16]} />
      <meshBasicMaterial color={color} transparent opacity={transparent ? 0.018 : nebula ? 0.012 + 0.05 * weight : 0.025} depthWrite={false} />
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
    /** Fixed orientation: the card's plane stands perpendicular to the
     * timeline tangent (draw.facing), at all times — never billboarded
     * to the camera. Falls back to the camera only when no tangent exists. */
    if (draw.facing) {
      const tangent = new Vector3(draw.facing[0], draw.facing[1], draw.facing[2]);
      if (tangent.lengthSq() > 1e-6) {
        tangent.normalize();
        group.current.quaternion.setFromUnitVectors(new Vector3(0, 0, 1), tangent);
      } else {
        group.current.quaternion.copy(camera.quaternion);
      }
    } else {
      group.current.quaternion.copy(camera.quaternion);
    }
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
/** A bound portrait: a portrait-orientation framed card billboarded next to
 * its character's sphere. Canvas face only — no external artwork is loaded,
 * so a simulated asset id renders exactly like a real bound portrait. */
function PortraitGlyph({ node }: NodeRendererProps) {
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
  const width = draw.radius * 1.5;
  const height = draw.radius * 2;
  const opacity = transparent ? 0.055 : draw.node.state === "proposed" ? 0.3 : draw.node.state === "held" ? 0.5 : 0.95;
  const shortId = draw.node.id.replace(/^por-?/i, "").slice(0, 18) || draw.node.id.slice(0, 18);
  return <group ref={group} userData={{ orbitalGlyph: draw.node.id }}>
    {touched && <mesh raycast={noRaycast}><boxGeometry args={[draw.radius * 2.7, draw.radius * 2.7, draw.radius * 2.7]} /><meshBasicMaterial color="#5eead4" wireframe transparent opacity={0.95} toneMapped={false} depthTest={false} /></mesh>}
    <mesh raycast={noRaycast}>
      <boxGeometry args={[width * 1.08, height * 1.08, Math.max(1, draw.radius * 0.08)]} />
      <meshStandardMaterial color="#12211e" metalness={0.2} roughness={0.6} transparent opacity={opacity} />
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
  if (draw.node.kind === "portrait") return <PortraitGlyph {...props} />;
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

const CAUSAL_COLOR = { canon: "#ff8f5a", proposed: "#ffc777", held: "#91c3e0" } as const;
const CAUSAL_SAMPLES = 24;

/** Stored CAUSES links: cause → effect arcs lifted off the time spine.
 * Dashed = projected onto containing spheres; solid = event to event. */
function CausalArc({ arrow, bus, radii }: { arrow: CausalArrow; bus: LabelBus; radii: Map<string, number> }) {
  const line = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array((CAUSAL_SAMPLES + 1) * 3), 3));
    const color = CAUSAL_COLOR[arrow.state];
    const opacity = arrow.state === "canon" ? 0.9 : 0.6;
    const material = arrow.projected
      ? new LineDashedMaterial({ color, dashSize: 26, gapSize: 18, transparent: true, opacity, depthWrite: false, toneMapped: false })
      : new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
    return new Line(geometry, material);
  }, [arrow.state, arrow.projected]);
  useEffect(() => () => { line.geometry.dispose(); (line.material as LineBasicMaterial).dispose(); }, [line]);
  const head = useRef<Group>(null);
  const width = Math.min(3, 1 + Math.log2(arrow.links.length));
  useFrame(() => {
    const from = bus.positions.get(arrow.from), to = bus.positions.get(arrow.to);
    line.visible = !!from && !!to;
    if (head.current) head.current.visible = line.visible;
    if (!from || !to) return;
    const start = new Vector3(...from), end = new Vector3(...to);
    const distance = start.distanceTo(end);
    const control = start.clone().add(end).multiplyScalar(0.5).add(new Vector3(0, Math.max(60, distance * 0.28), 0));
    const curve = new QuadraticBezierCurve3(start, control, end);
    const startT = Math.min(0.45, (radii.get(arrow.from) ?? 0) * 1.05 / Math.max(1, distance));
    const endT = 1 - Math.min(0.45, (radii.get(arrow.to) ?? 0) * 1.05 / Math.max(1, distance));
    const attribute = line.geometry.attributes.position;
    for (let index = 0; index <= CAUSAL_SAMPLES; index++) attribute.setXYZ(index, ...curve.getPoint(startT + (endT - startT) * index / CAUSAL_SAMPLES).toArray());
    attribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    if (arrow.projected) line.computeLineDistances();
    if (head.current) {
      head.current.position.copy(curve.getPoint(endT));
      head.current.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), curve.getTangent(endT).normalize()));
    }
  });
  return <>
    <primitive object={line} raycast={noRaycast} />
    <group ref={head}><mesh raycast={noRaycast} position={[0, -9 * width, 0]}><coneGeometry args={[6 * width, 18 * width, 8]} /><meshBasicMaterial color={CAUSAL_COLOR[arrow.state]} transparent opacity={arrow.state === "canon" ? 0.95 : 0.65} toneMapped={false} /></mesh></group>
  </>;
}

/** Previous level as a vague recoiled shadow behind the current world.
 * Separate group: never raycast, labelled, focused or framed; it only
 * fades in with the established level transition. */
function ParentBackdrop({ ghosts, path, morph, reducedMotion }: { ghosts: BackdropGhost[]; path: Position3[]; morph: OrbitalMorph | null; reducedMotion: boolean }) {
  const materials = useMemo(() => ({
    shell: new MeshBasicMaterial({ color: "#7fb6d8", wireframe: true, transparent: true, opacity: 0.028, depthWrite: false, toneMapped: false }),
    current: new MeshBasicMaterial({ color: "#a9d8f2", wireframe: true, transparent: true, opacity: 0.045, depthWrite: false, toneMapped: false }),
    fill: new MeshBasicMaterial({ color: "#5e9cc4", transparent: true, opacity: 0.012, depthWrite: false, toneMapped: false }),
  }), []);
  const spine = useMemo(() => new Line(new BufferGeometry().setFromPoints(path.map((point) => new Vector3(...point))), new LineBasicMaterial({ color: "#51b7ff", transparent: true, opacity: 0.08, depthWrite: false, toneMapped: false })), [path]);
  useEffect(() => () => { spine.geometry.dispose(); spine.material.dispose(); }, [spine]);
  useEffect(() => () => { Object.values(materials).forEach((material) => material.dispose()); }, [materials]);
  useFrame(() => {
    const fade = morph && !reducedMotion ? uncoilEase((performance.now() - morph.startedAt) / ORBITAL_TRANSITION_MS) : 1;
    materials.shell.opacity = 0.028 * fade;
    materials.current.opacity = 0.045 * fade;
    materials.fill.opacity = 0.012 * fade;
    (spine.material as LineBasicMaterial).opacity = 0.08 * fade;
  });
  if (!ghosts.length) return null;
  return <group userData={{ orbitalBackdrop: true }} renderOrder={-1}>
    <primitive object={spine} raycast={noRaycast} />
    {ghosts.map((ghost) => <group key={ghost.id} position={ghost.position}>
      <mesh raycast={noRaycast} material={ghost.current ? materials.current : materials.shell}><sphereGeometry args={[ghost.radius, 14, 9]} /></mesh>
      <mesh raycast={noRaycast} material={materials.fill}><sphereGeometry args={[ghost.radius * 0.995, 16, 10]} /></mesh>
    </group>)}
  </group>;
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

function OrbitalProjection({ draws, bus, selectedId, revealedId, transitioning, enclosure, onReveal, onExtremeBack }: { draws: OrbitalDraw[]; bus: LabelBus; selectedId: string | null; revealedId: string | null; transitioning: boolean; enclosure?: Enclosure; onReveal: (id: string | null) => void; onExtremeBack: () => void }) {
  const { camera, scene, size, gl } = useThree();
  const byId = useMemo(() => new Map(draws.map((draw) => [draw.node.id, draw])), [draws]);
  const revealed = useRef(revealedId); revealed.current = revealedId;
  const zoomOut = useRef(-Infinity);
  const enteredAt = useRef(performance.now());
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
    for (const candidate of candidates.sort((first, second) => first.priority - second.priority || second.pixels - first.pixels)) {
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
      // With a parent ghost, "extreme" means zoomed out far beyond it, so the
      // ghost shrinks to a small orb; otherwise the level must be a speck.
      const outside = enclosure ? camera.position.distanceTo(new Vector3(...enclosure.center)) > enclosure.radius * EXTREME_BACK_ENCLOSURE_FACTOR : extent < 0.06 && main.every((entry) => entry.pixels < 3);
      if (!backFired.current && performance.now() - enteredAt.current > EXTREME_BACK_SETTLE_MS && outside) { backFired.current = true; zoomOut.current = -Infinity; onExtremeBack(); }
      else if (!outside && extent > 0.2) backFired.current = false;
    }
  });
  return null;
}

/** Extreme outward zoom returns a level only once the new level has settled. */
const EXTREME_BACK_SETTLE_MS = 1800;

/** Enclosing parent ghost: the first view stays inside it, and Back by
 * zooming out happens only well beyond it. */
type Enclosure = { center: Position3; radius: number };
const EXTREME_BACK_ENCLOSURE_FACTOR = 12;

function OrbitalFraming({ graphRef, draws, selectedId, enclosure, levelKey, reducedMotion, enabled }: { graphRef: { current: GraphCanvasRef | null }; draws: OrbitalDraw[]; selectedId: string | null; enclosure?: Enclosure; levelKey: string; reducedMotion: boolean; enabled: boolean }) {
  const { camera, size } = useThree();
  // Narrow (portrait) screens frame fewer neighbours so spheres stay readable.
  const positions = entryFrame(draws, selectedId, size.width / Math.max(1, size.height) < 0.8 ? 2 : 5);
  const latest = useRef({ positions, enclosure }); latest.current = { positions, enclosure };
  const framingEnabled = useRef(enabled); framingEnabled.current = enabled;
  useEffect(() => {
    (camera as { fov: number }).fov = 42; camera.near = 1; camera.far = 2000000; camera.updateProjectionMatrix();
    const timeout = setTimeout(() => { if (framingEnabled.current) framePositions(graphRef, latest.current.positions, 1.2, !reducedMotion, { direction: levelKey.length % 2 ? [0.18, 0.22, 1] : [-0.18, 0.22, 1], within: latest.current.enclosure, ignoreSheet: true }); }, 100);
    return () => clearTimeout(timeout);
  }, [levelKey, reducedMotion, camera, graphRef, size.width, size.height]);
  return null;
}

interface Props {
  draws: OrbitalDraw[];
  paths: OrbitalPath[];
  edges: WorldEdge[];
  causal?: CausalArrow[];
  backdrop?: { ghosts: BackdropGhost[]; path: Position3[] };
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

export const OrbitalGraph = forwardRef<GraphCanvasRef, Props>(function OrbitalGraph({ draws, paths, edges, causal = [], backdrop, bus, selectedId, touchedIds = [], autoFrame = true, revealedId, levelKey, reducedMotion, morph, onSelect, onEnter, onReveal, onBack }, ref) {
  const nodes = useMemo(() => draws.map((draw) => ({ id: draw.node.id, label: draw.node.label, size: draw.radius, fill: recordColor(draw.node), fx: draw.position[0], fy: draw.position[1], fz: draw.position[2], data: { glyph: { draw, morph, reducedMotion, selected: selectedId === draw.node.id, touched: touchedIds.includes(draw.node.id), transparent: revealedId === draw.node.id || draws.some((entry) => entry.role === "connection" && entry.previewParentId === draw.node.id) } as GlyphData } })), [draws, morph, reducedMotion, revealedId, selectedId, touchedIds]);
  const theme = useMemo(() => ({ ...darkTheme, canvas: { background: "#050b15", fog: null } }), []);
  const radii = useMemo(() => new Map(draws.map((draw) => [draw.node.id, draw.radius])), [draws]);
  const enclosure = useMemo(() => { const ghost = backdrop?.ghosts.find((entry) => entry.current); return ghost ? { center: ghost.position, radius: ghost.radius } : undefined; }, [backdrop]);
  return <GraphCanvas ref={ref} nodes={nodes} edges={[]} theme={theme} renderNode={renderSphere} labelType="none" layoutType="forceDirected3d" cameraMode="rotate" draggable={false} animated={false} minDistance={16} maxDistance={1000000} selections={[]} glOptions={{ antialias: true, preserveDrawingBuffer: true }}
    onNodeClick={(node) => onSelect((node.data.glyph as GlyphData).draw)} onNodeDoubleClick={(node) => onEnter((node.data.glyph as GlyphData).draw)}>
    <ambientLight intensity={0.85} /><directionalLight position={[800, 1200, 1800]} intensity={1.5} color="#c4eaff" />
    <gridHelper args={[18000, 90, "#294760", "#122237"]} position={[0, -950, 0]} />
    <axesHelper args={[900]} position={[-1400, -945, -1200]} />
    {backdrop && <ParentBackdrop ghosts={backdrop.ghosts} path={backdrop.path} morph={morph} reducedMotion={reducedMotion} />}
    {paths.map((path) => <AnimatedTimePath key={path.id} path={path} morph={morph} reducedMotion={reducedMotion} />)}
    <VisibleConnections edges={edges} bus={bus} />
    {causal.map((arrow) => <CausalArc key={arrow.id} arrow={arrow} bus={bus} radii={radii} />)}
    <ActivityBounds draws={draws.filter(draw => touchedIds.includes(draw.node.id))} bus={bus} />
    <OrbitalProjection key={levelKey} draws={draws} bus={bus} selectedId={selectedId} revealedId={revealedId} transitioning={!!morph} enclosure={enclosure} onReveal={onReveal} onExtremeBack={onBack} />
    <ScaleNavigation graphRef={ref as { current: GraphCanvasRef | null }} reducedMotion={reducedMotion} />
    <OrbitalFraming graphRef={ref as { current: GraphCanvasRef | null }} draws={draws} selectedId={selectedId} enclosure={enclosure} levelKey={levelKey} reducedMotion={reducedMotion} enabled={autoFrame} />
  </GraphCanvas>;
});
