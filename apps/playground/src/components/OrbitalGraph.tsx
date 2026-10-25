import { forwardRef, useEffect, useMemo, useRef } from "react";
import { GraphCanvas, darkTheme, type GraphCanvasRef, type NodeRendererProps } from "reagraph";
import { useFrame, useThree } from "@react-three/fiber";
import { BoxGeometry, BufferGeometry, Plane, CanvasTexture, EdgesGeometry, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, RepeatWrapping, RingGeometry, Float32BufferAttribute, Line, LineBasicMaterial, LineDashedMaterial, LineSegments, QuadraticBezierCurve3, Quaternion, SRGBColorSpace, Vector3, type Group } from "three";
import { recordColor } from "../archive";
import type { WorldEdge, WorldNode } from "../types";
import type { Position3 } from "../data/spatialLayout";
import { carryPose, carryTangent, entryFrame, interpolatePose, uncoilEase, type OrbitalPose, type BackdropGhost, type OrbitalDraw, type OrbitalMorph, type OrbitalPath } from "../data/orbitalLayout";
import type { CausalArrow } from "../data/causalProjection";
import { breathOffset, glintLevel, now, rippleOffset, RIPPLE_LIFE, RIPPLE_SPEED, type MotionBus } from "../data/orbitalMotion";
import { framePositions, type LabelBus } from "./WorldGraph";
import { ScaleNavigation } from "./ScaleNavigation";

interface GlyphData {
  draw: OrbitalDraw;
  morph: OrbitalMorph | null;
  reducedMotion: boolean;
  transparent: boolean;
  selected: boolean;
  touched: boolean;
  motion: MotionBus;
}
export const ORBITAL_TRANSITION_MS = 1100;
/** A glyph's morph pose each frame, carrying its velocity into a transition
 * that interrupts another (view only; reduced motion jumps straight there). */
function useCarriedPose(draw: OrbitalDraw, morph: OrbitalMorph | null, reducedMotion: boolean) {
  const state = useRef<{ last: Position3 | null; velocity: Position3; startedAt: number | null; tangent?: Position3 }>({ last: null, velocity: [0, 0, 0], startedAt: null });
  return (delta: number): OrbitalPose => {
    const memory = state.current;
    const from = morph?.from.get(draw.node.id);
    if (morph && memory.startedAt !== morph.startedAt) {
      memory.startedAt = morph.startedAt;
      memory.tangent = from && !reducedMotion ? carryTangent(memory.velocity, ORBITAL_TRANSITION_MS / 1000, from, draw) : undefined;
    }
    const pose = from ? carryPose(from, draw, reducedMotion ? 1 : (performance.now() - morph!.startedAt) / ORBITAL_TRANSITION_MS, memory.tangent) : draw;
    if (memory.last && delta > 0 && delta < 0.2) {
      const follow = Math.min(1, delta * 12);
      memory.velocity = memory.velocity.map((value, axis) => value + ((pose.position[axis] - memory.last![axis]) / delta - value) * follow) as Position3;
    }
    memory.last = pose.position;
    return pose;
  };
}

const noRaycast = () => undefined;

function SphereGlyph({ node, active }: NodeRendererProps) {
  const group = useRef<Group>(null);
  const data = node.data.glyph as GlyphData;
  const { draw, morph, reducedMotion, transparent, selected, touched, motion } = data;
  const carried = useCarriedPose(draw, morph, reducedMotion);
  const body = useRef<MeshStandardMaterial>(null);
  /** Followers for hover swell and selection lift (view only). */
  const hover = useRef(0), lift = useRef(0);
  /** Frosted reveal: 0 = frosted (normal), 1 = cleared (revealed parent). */
  const clear = useRef(transparent ? 1 : 0);
  /** Ghost → canon: when this record's state becomes canon, it clears into solid. */
  const previousState = useRef(draw.node.state);
  const arrival = useRef<{ start: number; from: number } | null>(null);
  const frost = useRef<MeshStandardMaterial>(null);
  const frostPlane = useMemo(() => new Plane(new Vector3(0, -1, 0), 0), []);
  const color = recordColor(draw.node);
  const preimage = draw.role === "preimage";
  const nebula = draw.role === "nebula" || preimage;
  useFrame((_, delta) => {
    if (!group.current) return;
    const pose = carried(delta);
    const t = now();
    hover.current += ((motion.hoveredId === draw.node.id ? 1 : 0) - hover.current) * (reducedMotion ? 1 : Math.min(1, delta * 10));
    lift.current += ((selected && (draw.role === "main" || draw.role === "preview") ? 1 : 0) - lift.current) * (reducedMotion ? 1 : Math.min(1, delta * 6));
    const breath = reducedMotion || (selected && nebula) ? [0, 0, 0] : breathOffset(draw, t);
    const ripple = reducedMotion ? [0, 0, 0] : rippleOffset(draw.position, t, motion.ripples);
    const raise = draw.radius * 0.22 * lift.current;
    group.current.position.set(pose.position[0] - draw.position[0] + breath[0] + ripple[0], pose.position[1] - draw.position[1] + breath[1] + ripple[1] + raise, pose.position[2] - draw.position[2] + breath[2] + ripple[2]);
    const pulse = draw.node.state === "proposed" && !reducedMotion ? 1 + 0.035 * Math.sin(t * 2.2) : 1;
    group.current.scale.setScalar(pose.radius / draw.radius * (1 + 0.08 * hover.current) * pulse);
    // Frost front: the frosted shell keeps only what lies below a horizontal
    // front that sweeps top → bottom as the sphere clears (and back up).
    clear.current += ((transparent ? 1 : 0) - clear.current) * (reducedMotion ? 1 : Math.min(1, delta / 0.12));
    if (previousState.current !== draw.node.state) {
      if (draw.node.state === "canon" && previousState.current !== "canon" && !reducedMotion) arrival.current = { start: t, from: stateOpacity(previousState.current) };
      previousState.current = draw.node.state;
    }
    const arriving = arrival.current ? Math.min(1, (t - arrival.current.start) / 0.9) : 1;
    if (arriving >= 1) arrival.current = null;
    const eased = clear.current * clear.current * (3 - 2 * clear.current);
    if (body.current) body.current.opacity = (arrival.current ? arrival.current.from + (solid - arrival.current.from) * arriving : solid + (0.055 - solid) * eased) * (preimage ? 0.75 : 1);
    if (frost.current) {
      const front = arrival.current ? arriving : clear.current;
      const active = arrival.current !== null || (clear.current > 0.01 && clear.current < 0.99);
      frost.current.visible = active;
      if (active) {
        const centre = group.current.getWorldPosition(new Vector3()).y;
        const reach = draw.radius * group.current.scale.x * 1.02;
        frostPlane.constant = centre + reach * (1 - 2 * front);
        frost.current.color.set(arrival.current ? "#ffe2a8" : "#e8f4ff");
      }
    }
    if (body.current) body.current.emissiveIntensity = baseGlow + 0.35 * hover.current + (reducedMotion ? 0 : 0.7 * glintLevel(motion.glints.get(draw.node.id), t));
  });
  /** Nebula weight: strongly linked entities are solid, weak ones faint —
   * proposed/held keep their own (lower) bands so states stay distinct. */
  const weight = nebula ? Math.min(1, Math.max(0, draw.prominence ?? 0.7)) : 1;
  const opacity = transparent ? 0.055 : draw.node.state === "proposed" ? (nebula ? 0.14 + 0.22 * weight : 0.3) : draw.node.state === "held" ? (nebula ? 0.25 + 0.3 * weight : 0.5) : nebula ? 0.18 + 0.67 * weight : 0.9;
  /** Opacity for a record state, before any reveal (states stay distinct). */
  const stateOpacity = (state: WorldNode["state"]) => state === "proposed" ? (nebula ? 0.14 + 0.22 * weight : 0.3) : state === "held" ? (nebula ? 0.25 + 0.3 * weight : 0.5) : nebula ? 0.18 + 0.67 * weight : 0.9;
  const solid = stateOpacity(draw.node.state);
  const light = nebula && weight < 0.35 && !selected;
  const shown = preimage ? opacity * 0.75 : opacity;
  const segments: [number, number] = light ? [16, 12] : [32, 24];
  const baseGlow = selected ? 0.7 : active ? 0.45 : nebula ? 0.08 + 0.2 * weight : 0.2;
  return <group ref={group} userData={{ orbitalGlyph: draw.node.id }}>
    {touched && <mesh raycast={noRaycast}><boxGeometry args={[draw.radius * 2.7, draw.radius * 2.7, draw.radius * 2.7]} /><meshBasicMaterial color="#36adff" wireframe transparent opacity={0.95} toneMapped={false} depthTest={false} /></mesh>}
    <mesh raycast={transparent || preimage ? noRaycast : undefined}>
      <sphereGeometry args={[draw.radius, ...segments]} />
      <meshStandardMaterial ref={body} color={nebula ? color : "#12283c"} emissive={color} emissiveIntensity={baseGlow} metalness={0.35} roughness={0.27} transparent opacity={shown} depthWrite={!transparent && !preimage && draw.node.state === "canon" && opacity >= 0.5} />
    </mesh>
    <mesh raycast={noRaycast}>
      <sphereGeometry args={[draw.radius * 1.012, 24, 16]} />
      <meshStandardMaterial ref={frost} color="#e8f4ff" roughness={1} metalness={0} transparent opacity={0.26} depthWrite={false} clippingPlanes={[frostPlane]} visible={false} />
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
/** One shared diagonal highlight stripe; each card clones it to move its own offset. */
let sheenSource: CanvasTexture | null = null;
function sheenTexture(): CanvasTexture {
  if (!sheenSource) {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 256;
    const context = canvas.getContext("2d")!;
    const gradient = context.createLinearGradient(0, 256, 256, 0);
    gradient.addColorStop(0, "rgba(255,255,255,0)");
    gradient.addColorStop(0.42, "rgba(255,255,255,0)");
    gradient.addColorStop(0.5, "rgba(255,255,255,0.85)");
    gradient.addColorStop(0.56, "rgba(255,255,255,0.18)");
    gradient.addColorStop(0.62, "rgba(255,255,255,0)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, 256, 256);
    sheenSource = new CanvasTexture(canvas);
    sheenSource.wrapS = sheenSource.wrapT = RepeatWrapping;
  }
  return sheenSource;
}

/** Glass case over an album card (Rhine-style): a clear-coated pane, light
 * catching on the edges, and a highlight band sweeping slowly across —
 * brighter while hovered, still under reduced motion. View only. */
function GlassCase({ id, width, height, depth, opacity, motion, reducedMotion }: { id: string; width: number; height: number; depth: number; opacity: number; motion: MotionBus; reducedMotion: boolean }) {
  const parts = useMemo(() => {
    const sheen = sheenTexture().clone();
    sheen.needsUpdate = true;
    sheen.repeat.set(0.6, 0.6);
    const box = new BoxGeometry(width * 1.1, height * 1.1, depth * 1.6);
    return {
      pane: new MeshPhysicalMaterial({ color: "#d6ecff", transparent: true, opacity: 0.1 * opacity, roughness: 0.06, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.04, depthWrite: false }),
      sheen,
      sheenMaterial: new MeshBasicMaterial({ map: sheen, transparent: true, opacity: 0.22 * opacity, depthWrite: false, toneMapped: false }),
      edges: new EdgesGeometry(box),
      box,
      edgeMaterial: new LineBasicMaterial({ color: "#e6f6ff", transparent: true, opacity: 0.38 * opacity, depthWrite: false, toneMapped: false }),
    };
  }, [width, height, depth, opacity]);
  useEffect(() => () => { parts.pane.dispose(); parts.sheen.dispose(); parts.sheenMaterial.dispose(); parts.edges.dispose(); parts.box.dispose(); parts.edgeMaterial.dispose(); }, [parts]);
  const hover = useRef(0);
  useFrame((_, delta) => {
    hover.current += ((motion.hoveredId === id ? 1 : 0) - hover.current) * Math.min(1, delta * 8);
    if (!reducedMotion) parts.sheen.offset.set((now() * 0.07 + (id.length % 7) * 0.13) % 1, 0);
    parts.sheenMaterial.opacity = (0.22 + 0.35 * hover.current) * opacity;
    parts.edgeMaterial.opacity = (0.38 + 0.4 * hover.current) * opacity;
  });
  return <>
    <mesh raycast={noRaycast} position={[0, 0, depth * 0.9]} material={parts.pane}><planeGeometry args={[width * 1.08, height * 1.08]} /></mesh>
    <mesh raycast={noRaycast} position={[0, 0, depth * 0.95]} material={parts.sheenMaterial}><planeGeometry args={[width * 1.08, height * 1.08]} /></mesh>
    <lineSegments raycast={noRaycast} geometry={parts.edges} material={parts.edgeMaterial} />
  </>;
}

function PictureGlyph({ node }: NodeRendererProps) {
  const group = useRef<Group>(null);
  const data = node.data.glyph as GlyphData;
  const { draw, morph, reducedMotion, transparent, selected, touched } = data;
  const carried = useCarriedPose(draw, morph, reducedMotion);
  const { camera } = useThree();
  useFrame((_, delta) => {
    if (!group.current) return;
    const pose = carried(delta);
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
    {!transparent && <GlassCase id={draw.node.id} width={width} height={height} depth={Math.max(1, draw.radius * 0.08)} opacity={opacity} motion={data.motion} reducedMotion={reducedMotion} />}
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
  const carried = useCarriedPose(draw, morph, reducedMotion);
  const { camera } = useThree();
  useFrame((_, delta) => {
    if (!group.current) return;
    const pose = carried(delta);
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
    {!transparent && <GlassCase id={draw.node.id} width={width} height={height} depth={Math.max(1, draw.radius * 0.08)} opacity={opacity} motion={data.motion} reducedMotion={reducedMotion} />}
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

function VisibleConnections({ edges, bus, color = "#d8bdff", opacity = 0.8 }: { edges: WorldEdge[]; bus: LabelBus; color?: string; opacity?: number }) {
  const line = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array(edges.length * 6), 3));
    return new LineSegments(geometry, new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
  }, [edges, color, opacity]);
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
function CausalArc({ arrow, bus, radii, reducedMotion }: { arrow: CausalArrow; bus: LabelBus; radii: Map<string, number>; reducedMotion: boolean }) {
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
  /** A bead flowing cause → effect, so direction reads without the arrowhead. */
  const bead = useRef<Group>(null);
  const phase = useMemo(() => [...arrow.id].reduce((sum, character) => sum + character.charCodeAt(0), 0) % 100 / 100, [arrow.id]);
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
    if (bead.current) {
      bead.current.visible = !reducedMotion;
      if (!reducedMotion) bead.current.position.copy(curve.getPoint(startT + (endT - startT) * ((now() * 0.35 + phase) % 1)));
    }
    if (head.current) {
      head.current.position.copy(curve.getPoint(endT));
      head.current.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), curve.getTangent(endT).normalize()));
    }
  });
  return <>
    <primitive object={line} raycast={noRaycast} />
    <group ref={bead}><mesh raycast={noRaycast}><sphereGeometry args={[5 * width, 10, 8]} /><meshBasicMaterial color="#ffd9c2" transparent opacity={arrow.state === "canon" ? 0.95 : 0.6} toneMapped={false} /></mesh></group>
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

/** Ground rings for clicks on empty space: they spread with the ripple front. */
const GROUND_Y = -950;
function RippleRings({ motion }: { motion: MotionBus }) {
  const rings = useMemo(() => Array.from({ length: 6 }, () => new Mesh(new RingGeometry(0.97, 1, 96), new MeshBasicMaterial({ color: "#7cc8ff", transparent: true, opacity: 0, depthWrite: false, toneMapped: false }))), []);
  useEffect(() => () => rings.forEach((ring) => { ring.geometry.dispose(); (ring.material as MeshBasicMaterial).dispose(); }), [rings]);
  useFrame(() => {
    const t = now();
    const blank = motion.ripples.filter((ripple) => ripple.kind === "blank");
    rings.forEach((ring, index) => {
      const ripple = blank[index];
      const age = ripple ? t - ripple.start : Infinity;
      ring.visible = age >= 0 && age < RIPPLE_LIFE;
      if (!ripple || !ring.visible) return;
      ring.position.set(ripple.origin[0], GROUND_Y + 4, ripple.origin[2]);
      ring.rotation.set(-Math.PI / 2, 0, 0);
      ring.scale.setScalar(Math.max(1, RIPPLE_SPEED * age));
      (ring.material as MeshBasicMaterial).opacity = 0.75 * (1 - age / RIPPLE_LIFE) ** 2;
    });
  });
  return <>{rings.map((ring, index) => <primitive key={index} object={ring} raycast={noRaycast} />)}</>;
}

/** Subtle depth from the pointer (desktop) or device tilt (phone): a tiny
 * focal offset, at most ~0.6% of the camera distance, easing back to centre. */
function PointerParallax({ graphRef, enabled }: { graphRef: { current: GraphCanvasRef | null }; enabled: boolean }) {
  const { gl } = useThree();
  const target = useRef<[number, number]>([0, 0]);
  const current = useRef<[number, number]>([0, 0]);
  useEffect(() => {
    target.current = [0, 0];
    if (!enabled) return;
    const surface = gl.domElement;
    const move = (event: PointerEvent) => {
      if (event.pointerType !== "mouse") return;
      const rectangle = surface.getBoundingClientRect();
      target.current = [(event.clientX - rectangle.left) / rectangle.width - 0.5, (event.clientY - rectangle.top) / rectangle.height - 0.5];
    };
    const leave = () => { target.current = [0, 0]; };
    const tilt = (event: DeviceOrientationEvent) => {
      if (event.gamma === null || event.beta === null) return;
      target.current = [Math.max(-0.5, Math.min(0.5, event.gamma / 60)), Math.max(-0.5, Math.min(0.5, (event.beta - 45) / 60))];
    };
    surface.addEventListener("pointermove", move);
    surface.addEventListener("pointerleave", leave);
    window.addEventListener("deviceorientation", tilt);
    return () => { surface.removeEventListener("pointermove", move); surface.removeEventListener("pointerleave", leave); window.removeEventListener("deviceorientation", tilt); };
  }, [gl, enabled]);
  useFrame((_, delta) => {
    const controls = graphRef.current?.getControls?.();
    if (!controls) return;
    const ease = Math.min(1, delta * 3);
    const [x, y] = current.current;
    current.current = [x + (target.current[0] - x) * ease, y + (target.current[1] - y) * ease];
    if (Math.abs(current.current[0]) < 1e-4 && Math.abs(current.current[1]) < 1e-4 && Math.abs(x) < 1e-4 && Math.abs(y) < 1e-4) return;
    const reach = controls.distance * 0.012;
    void controls.setFocalOffset(current.current[0] * reach, -current.current[1] * reach, 0, false);
  });
  return null;
}

/** Frost fronts use per-material clipping planes. */
function LocalClipping() {
  const { gl } = useThree();
  useEffect(() => { gl.localClippingEnabled = true; }, [gl]);
  return null;
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

function OrbitalProjection({ draws, bus, selectedId, revealedId, transitioning, enclosure, hoverCard, motion, onReveal, onExtremeBack }: { draws: OrbitalDraw[]; bus: LabelBus; selectedId: string | null; revealedId: string | null; transitioning: boolean; enclosure?: Enclosure; hoverCard?: { current: HTMLDivElement | null }; motion?: MotionBus; onReveal: (id: string | null) => void; onExtremeBack: () => void }) {
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
    const card = hoverCard?.current;
    if (card) {
      // The hover card floats just above the hovered sphere's projected edge.
      const id = motion?.hoveredId;
      const world = id ? bus.positions.get(id) : undefined;
      const hovered = id ? byId.get(id) : undefined;
      const point = world ? new Vector3(...world).project(camera) : null;
      if (!world || !hovered || !point || point.z > 1) card.style.visibility = "hidden";
      else {
        const edge = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).multiplyScalar(hovered.radius).add(new Vector3(...world)).project(camera);
        const pixels = Math.abs(edge.x - point.x) * size.width / 2;
        card.style.transform = `translate(${(point.x * 0.5 + 0.5) * size.width}px, ${(-point.y * 0.5 + 0.5) * size.height - pixels - 12}px) translate(-50%, -100%)`;
        card.style.visibility = "visible";
      }
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
  /** View-only motion state shared with every glyph. */
  motion: MotionBus;
  /** Faint threads from a hovered entity to its visible scenes. */
  hoverEdges?: WorldEdge[];
  hoverCard?: { current: HTMLDivElement | null };
  onHover?: (id: string | null) => void;
  onBlank?: (event: MouseEvent) => void;
}

export const OrbitalGraph = forwardRef<GraphCanvasRef, Props>(function OrbitalGraph({ draws, paths, edges, causal = [], backdrop, bus, selectedId, touchedIds = [], autoFrame = true, revealedId, levelKey, reducedMotion, morph, onSelect, onEnter, onReveal, onBack, motion, hoverEdges = [], hoverCard, onHover, onBlank }, ref) {
  const nodes = useMemo(() => draws.map((draw) => ({ id: draw.node.id, label: draw.node.label, size: draw.radius, fill: recordColor(draw.node), fx: draw.position[0], fy: draw.position[1], fz: draw.position[2], data: { glyph: { draw, morph, reducedMotion, selected: selectedId === draw.node.id, touched: touchedIds.includes(draw.node.id), transparent: revealedId === draw.node.id || draws.some((entry) => entry.role === "connection" && entry.previewParentId === draw.node.id), motion } as GlyphData } })), [draws, morph, reducedMotion, revealedId, selectedId, touchedIds, motion]);
  const theme = useMemo(() => ({ ...darkTheme, canvas: { background: "#050b15", fog: null } }), []);
  const radii = useMemo(() => new Map(draws.map((draw) => [draw.node.id, draw.radius])), [draws]);
  const enclosure = useMemo(() => { const ghost = backdrop?.ghosts.find((entry) => entry.current); return ghost ? { center: ghost.position, radius: ghost.radius } : undefined; }, [backdrop]);
  return <GraphCanvas ref={ref} nodes={nodes} edges={[]} theme={theme} renderNode={renderSphere} labelType="none" layoutType="forceDirected3d" cameraMode="rotate" draggable={false} animated={false} minDistance={16} maxDistance={1000000} selections={[]} glOptions={{ antialias: true, preserveDrawingBuffer: true }}
    onNodeClick={(node) => onSelect((node.data.glyph as GlyphData).draw)} onNodeDoubleClick={(node) => onEnter((node.data.glyph as GlyphData).draw)}
    onNodePointerOver={(node) => { if ((node.data.glyph as GlyphData).draw.role !== "preimage") onHover?.(node.id); }} onNodePointerOut={(node) => { if (motion.hoveredId === node.id) onHover?.(null); }}
    onCanvasClick={(event) => onBlank?.(event)}>
    <ambientLight intensity={0.85} /><directionalLight position={[800, 1200, 1800]} intensity={1.5} color="#c4eaff" />
    <gridHelper args={[18000, 90, "#294760", "#122237"]} position={[0, -950, 0]} />
    <axesHelper args={[900]} position={[-1400, -945, -1200]} />
    {backdrop && <ParentBackdrop ghosts={backdrop.ghosts} path={backdrop.path} morph={morph} reducedMotion={reducedMotion} />}
    {paths.map((path) => <AnimatedTimePath key={path.id} path={path} morph={morph} reducedMotion={reducedMotion} />)}
    <VisibleConnections edges={edges} bus={bus} />
    {hoverEdges.length > 0 && <VisibleConnections edges={hoverEdges} bus={bus} color="#d9cbff" opacity={0.55} />}
    {!reducedMotion && <RippleRings motion={motion} />}
    <LocalClipping />
    <PointerParallax graphRef={ref as { current: GraphCanvasRef | null }} enabled={!reducedMotion} />
    {causal.map((arrow) => <CausalArc key={arrow.id} arrow={arrow} bus={bus} radii={radii} reducedMotion={reducedMotion} />)}
    <ActivityBounds draws={draws.filter(draw => touchedIds.includes(draw.node.id))} bus={bus} />
    <OrbitalProjection key={levelKey} draws={draws} bus={bus} selectedId={selectedId} revealedId={revealedId} transitioning={!!morph} enclosure={enclosure} hoverCard={hoverCard} motion={motion} onReveal={onReveal} onExtremeBack={onBack} />
    <ScaleNavigation graphRef={ref as { current: GraphCanvasRef | null }} reducedMotion={reducedMotion} />
    <OrbitalFraming graphRef={ref as { current: GraphCanvasRef | null }} draws={draws} selectedId={selectedId} enclosure={enclosure} levelKey={levelKey} reducedMotion={reducedMotion} enabled={autoFrame} />
  </GraphCanvas>;
});
