import { forwardRef, useEffect, useMemo, useRef } from "react";
import { GraphCanvas, darkTheme, type GraphCanvasRef, type NodeRendererProps } from "reagraph";
import { useFrame, useThree } from "@react-three/fiber";
import { type Camera, AdditiveBlending, Fog, BoxGeometry, BufferGeometry, CurvePath, LineCurve3, TubeGeometry, DoubleSide, Points, PointsMaterial, Plane, CanvasTexture, EdgesGeometry, Mesh, MeshBasicMaterial, MeshPhysicalMaterial, MeshStandardMaterial, RingGeometry, Float32BufferAttribute, Line, LineBasicMaterial, LineDashedMaterial, LineSegments, QuadraticBezierCurve3, Quaternion, SRGBColorSpace, Vector3, type Group } from "three";
import { recordColor } from "../archive";
import type { WorldEdge, WorldNode } from "../types";
import type { Position3 } from "../data/spatialLayout";
import { carryPose, carryTangent, entryFrame, interpolatePose, morphProgress, OPENING_STAGGER_MS, uncoilEase, type OrbitalPose, type BackdropGhost, type OrbitalDraw, type OrbitalMorph, type OrbitalPath } from "../data/orbitalLayout";
import type { CausalArrow } from "../data/causalProjection";
import { breathOffset, buildInertiaRig, glintLevel, heartbeatRoute, now, pointAlong, rippleOffset, stepInertia, swayOf, RIPPLE_LIFE, RIPPLE_SPEED, type MotionBus } from "../data/orbitalMotion";
import { framePositions, type LabelBus } from "./graphCamera";
import { ScaleNavigation } from "./ScaleNavigation";
import { FacultyEffects } from "./FacultyEffects";
import type { FacultyAnchor } from "../data/facultyEffects";
import type { CalendarPin, FloorMark, TimeMeter } from "../data/orbitalTimePlace";
import { useAlbumTexture } from "./useAlbumTexture";
import { containedImageSize } from "../data/albumImage";

interface GlyphData {
  draw: OrbitalDraw;
  morph: OrbitalMorph | null;
  reducedMotion: boolean;
  transparent: boolean;
  selected: boolean;
  touched: boolean;
  /** Unrelated to the current selection: drawn receded. */
  dimmed: boolean;
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
    const pose = from ? carryPose(from, draw, reducedMotion ? 1 : morphProgress(morph!, draw.node.id, performance.now(), ORBITAL_TRANSITION_MS), memory.tangent) : draw;
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
  const { draw, morph, reducedMotion, transparent, selected, touched, dimmed, motion } = data;
  const carried = useCarriedPose(draw, morph, reducedMotion);
  const body = useRef<MeshStandardMaterial>(null);
  /** Followers for hover swell and selection lift (view only). */
  const hover = useRef(0), lift = useRef(0), dim = useRef(0);
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
    hover.current += ((motion.hoveredId === draw.node.id ? 1 : 0) - hover.current) * (reducedMotion ? 1 : Math.min(1, delta * 14));
    lift.current += ((selected && (draw.role === "main" || draw.role === "preview") ? 1 : 0) - lift.current) * (reducedMotion ? 1 : Math.min(1, delta * 6));
    dim.current += ((dimmed ? 1 : 0) - dim.current) * (reducedMotion ? 1 : Math.min(1, delta * 6));
    const breath = reducedMotion || (selected && nebula) ? [0, 0, 0] : breathOffset(draw, t);
    const ripple = reducedMotion ? [0, 0, 0] : rippleOffset(draw.position, t, motion.ripples);
    const raise = draw.radius * 0.22 * lift.current;
    const sway = swayOf(motion, draw.node.id);
    group.current.position.set(pose.position[0] - draw.position[0] + breath[0] + ripple[0] + sway[0], pose.position[1] - draw.position[1] + breath[1] + ripple[1] + raise + sway[1], pose.position[2] - draw.position[2] + breath[2] + ripple[2] + sway[2]);
    const pulse = draw.node.state === "proposed" && !reducedMotion ? 1 + 0.035 * Math.sin(t * 2.2) : 1;
    group.current.scale.setScalar(pose.radius / draw.radius * (1 + 0.16 * hover.current) * pulse);
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
    if (body.current) body.current.opacity = (arrival.current ? arrival.current.from + (solid - arrival.current.from) * arriving : solid + (0.055 - solid) * eased) * (preimage ? 0.75 : 1) * (1 - 0.72 * dim.current);
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
    if (body.current) body.current.emissiveIntensity = baseGlow + 0.6 * hover.current + (reducedMotion ? 0 : 0.7 * glintLevel(motion.glints.get(draw.node.id), t));
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

/** Glass case over an album card (Rhine-style): a clear, thin slab. The face
 * is nearly invisible; what reads as glass is its thin ivory sides and edges,
 * a little brighter while hovered. View only. */
function GlassCase({ id, width, height, depth, opacity, motion }: { id: string; width: number; height: number; depth: number; opacity: number; motion: MotionBus; reducedMotion: boolean }) {
  const parts = useMemo(() => {
    const box = new BoxGeometry(width * 1.08, height * 1.08, Math.max(depth * 0.5, Math.min(width, height) * 0.035));
    return {
      box,
      pane: new MeshPhysicalMaterial({ color: "#f4efe4", transparent: true, opacity: 0.02 * opacity, roughness: 0.02, metalness: 0, clearcoat: 1, clearcoatRoughness: 0.03, depthWrite: false }),
      edges: new EdgesGeometry(box),
      edgeMaterial: new LineBasicMaterial({ color: "#efe6d4", transparent: true, opacity: 0.5 * opacity, depthWrite: false, toneMapped: false }),
    };
  }, [width, height, depth, opacity]);
  useEffect(() => () => { parts.box.dispose(); parts.pane.dispose(); parts.edges.dispose(); parts.edgeMaterial.dispose(); }, [parts]);
  const hover = useRef(0);
  useFrame((_, delta) => {
    hover.current += ((motion.hoveredId === id ? 1 : 0) - hover.current) * Math.min(1, delta * 8);
    parts.edgeMaterial.opacity = (0.5 + 0.35 * hover.current) * opacity;
  });
  return <group position={[0, 0, depth * 0.6]}>
    <mesh raycast={noRaycast} geometry={parts.box} material={parts.pane} />
    <lineSegments raycast={noRaycast} geometry={parts.edges} material={parts.edgeMaterial} />
  </group>;
}

/** Framed picture card that always faces the camera (billboard).
 * Mirrors SphereGlyph's morph position/scale handling and sets
 * userData.orbitalGlyph so the label/position bus keeps working. */
function PictureGlyph({ node }: NodeRendererProps) {
  const group = useRef<Group>(null);
  const data = node.data.glyph as GlyphData;
  const { draw, morph, reducedMotion, transparent, selected, touched, motion } = data;
  const texture = useAlbumTexture(draw.asset);
  const carried = useCarriedPose(draw, morph, reducedMotion);
  const { camera } = useThree();
  useFrame((_, delta) => {
    if (!group.current) return;
    const pose = carried(delta);
    const sway = swayOf(motion, draw.node.id);
    group.current.position.set(pose.position[0] - draw.position[0] + sway[0], pose.position[1] - draw.position[1] + sway[1], pose.position[2] - draw.position[2] + sway[2]);
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
  const imageSize = texture ? containedImageSize(texture.image.width, texture.image.height, width, height) : [width, height];
  const opacity = transparent ? 0.055 : draw.node.state === "proposed" ? 0.3 : draw.node.state === "held" ? 0.5 : 0.95;
  const shortId = draw.node.id.replace(/^pic-?/i, "").slice(0, 18) || draw.node.id.slice(0, 18);
  return <group ref={group} userData={{ orbitalGlyph: draw.node.id }}>
    {touched && <mesh raycast={noRaycast}><boxGeometry args={[draw.radius * 2.7, draw.radius * 2.7, draw.radius * 2.7]} /><meshBasicMaterial color="#36adff" wireframe transparent opacity={0.95} toneMapped={false} depthTest={false} /></mesh>}
    <mesh raycast={noRaycast}>
      <boxGeometry args={[width * 1.08, height * 1.08, Math.max(1, draw.radius * 0.08)]} />
      <meshStandardMaterial color="#0d1a26" metalness={0.2} roughness={0.6} transparent opacity={opacity} />
    </mesh>
    <mesh position={[0, 0, Math.max(1, draw.radius * 0.05)]}>
      <planeGeometry args={[imageSize[0], imageSize[1]]} />
      <meshBasicMaterial map={texture ?? pictureTexture(draw.node.label, shortId)} transparent opacity={opacity} toneMapped={false} />
    </mesh>
    <mesh position={[0, 0, -Math.max(1, draw.radius * 0.05)]} rotation={[0, Math.PI, 0]}>
      <planeGeometry args={[imageSize[0], imageSize[1]]} />
      <meshBasicMaterial map={texture ?? pictureTexture(draw.node.label, shortId)} transparent opacity={opacity} toneMapped={false} />
    </mesh>
    {!transparent && <GlassCase id={draw.node.id} width={width} height={height} depth={Math.max(1, draw.radius * 0.08)} opacity={opacity} motion={data.motion} reducedMotion={reducedMotion} />}
    {selected && <mesh raycast={noRaycast} position={[0, 0, Math.max(1, draw.radius * 0.06)]}>
      <planeGeometry args={[width * 1.14, height * 1.14]} />
      <meshBasicMaterial color="#ccf4ff" wireframe transparent opacity={0.65} />
    </mesh>}
  </group>;
}
function PortraitGlyph({ node }: NodeRendererProps) {
  const group = useRef<Group>(null);
  const data = node.data.glyph as GlyphData;
  const { draw, morph, reducedMotion, transparent, selected, touched, motion } = data;
  const texture = useAlbumTexture(draw.asset);
  const carried = useCarriedPose(draw, morph, reducedMotion);
  const { camera } = useThree();
  useFrame((_, delta) => {
    if (!group.current) return;
    const pose = carried(delta);
    const sway = swayOf(motion, draw.node.id);
    group.current.position.set(pose.position[0] - draw.position[0] + sway[0], pose.position[1] - draw.position[1] + sway[1], pose.position[2] - draw.position[2] + sway[2]);
    group.current.scale.setScalar(pose.radius / draw.radius);
    group.current.quaternion.copy(camera.quaternion);
  });
  const width = draw.radius * 1.5;
  const height = draw.radius * 2;
  const imageSize = texture ? containedImageSize(texture.image.width, texture.image.height, width, height) : [width, height];
  const opacity = transparent ? 0.055 : draw.node.state === "proposed" ? 0.3 : draw.node.state === "held" ? 0.5 : 0.95;
  const shortId = draw.node.id.replace(/^por-?/i, "").slice(0, 18) || draw.node.id.slice(0, 18);
  return <group ref={group} userData={{ orbitalGlyph: draw.node.id }}>
    {touched && <mesh raycast={noRaycast}><boxGeometry args={[draw.radius * 2.7, draw.radius * 2.7, draw.radius * 2.7]} /><meshBasicMaterial color="#5eead4" wireframe transparent opacity={0.95} toneMapped={false} depthTest={false} /></mesh>}
    <mesh raycast={noRaycast}>
      <boxGeometry args={[width * 1.08, height * 1.08, Math.max(1, draw.radius * 0.08)]} />
      <meshStandardMaterial color="#12211e" metalness={0.2} roughness={0.6} transparent opacity={opacity} />
    </mesh>
    <mesh position={[0, 0, Math.max(1, draw.radius * 0.05)]}>
      <planeGeometry args={[imageSize[0], imageSize[1]]} />
      <meshBasicMaterial map={texture ?? pictureTexture(draw.node.label, shortId)} transparent opacity={opacity} toneMapped={false} />
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
  if (draw.envelope === "hidden") return <group userData={{ orbitalGlyph: draw.node.id }} />;
  return <SphereGlyph {...props} />;
}

/** The flat map of orbital Places: a disc and rim per place on the floor,
 * nested by the place tree — a region is a wide, faint disc under the places
 * inside it, each level raised a hair to stay on top (dim when no scene of
 * the chosen periods is there; a dashed-looking thin rim while the region
 * link is only proposed). */
function FloorMap({ marks }: { marks: FloorMark[] }) {
  return <>{marks.map((mark) => {
    const fill = mark.region ? (mark.active ? 0.16 + 0.06 * (mark.depth ?? 0) : 0.07) : mark.active ? 0.55 : 0.18;
    const rim = mark.region ? 0.985 : 0.94;
    return <group key={mark.id} position={[mark.x, -944 + 1.5 * (mark.depth ?? 0) + (mark.region ? 0 : 0.8), mark.z]} rotation={[-Math.PI / 2, 0, 0]}>
      <mesh raycast={noRaycast}><circleGeometry args={[mark.radius, mark.region ? 72 : 48]} /><meshBasicMaterial color={mark.region ? "#1d5a80" : "#16405e"} transparent opacity={fill} depthWrite={false} toneMapped={false} /></mesh>
      <mesh raycast={noRaycast}><ringGeometry args={[mark.radius * (mark.proposed ? 0.993 : rim), mark.radius, mark.region ? 72 : 48]} /><meshBasicMaterial color={mark.proposed ? "#ffd36b" : "#7cc8ff"} transparent opacity={mark.active ? (mark.region ? 0.6 : 0.85) : 0.22} side={DoubleSide} depthWrite={false} toneMapped={false} /></mesh>
    </group>;
  })}</>;
}

/** A calendar pin's date: large soft lettering (no card), the year and book small beneath. */
function pinTexture(label: string, detail: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 1024; canvas.height = 300;
  const context = canvas.getContext("2d")!;
  context.textAlign = "center";
  context.shadowColor = "rgba(120, 170, 255, 0.55)";
  context.shadowBlur = 28;
  context.fillStyle = "rgba(214, 228, 255, 0.82)";
  context.font = "700 170px sans-serif";
  context.fillText(label, 512, 180);
  context.shadowBlur = 0;
  context.fillStyle = "rgba(160, 186, 232, 0.75)";
  context.font = "400 58px sans-serif";
  context.fillText(detail, 512, 270);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

/** A time meter's note ("time ×0.4"): small soft lettering under the ruler, left-aligned at its tick. */
function meterTexture(label: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512; canvas.height = 120;
  const context = canvas.getContext("2d")!;
  context.shadowColor = "rgba(54, 173, 255, 0.6)";
  context.shadowBlur = 16;
  context.fillStyle = "rgba(159, 216, 255, 0.85)";
  context.font = "500 64px sans-serif";
  context.fillText(label, 8, 84);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}
/** Tick heights (every fifth story moment taller), a note's width and how far under the ruler it hangs (world units). */
const METER_DRAW = { tick: 140, fifth: 300, note: 2200, below: 300 };
/** The time meters on the date backdrop: a ruler per book with a tick per story moment (packed where quiet time is
 * compressed) and the pace where it changes. Outside the fog like the dates, never raycast. */
function TimeMeters({ meters }: { meters: TimeMeter[] }) {
  const rulers = useMemo(() => meters.map((meter) => {
    const positions = [meter.ticks[0], meter.y, meter.z, meter.ticks.at(-1)!, meter.y, meter.z];
    meter.ticks.forEach((x, index) => positions.push(x, meter.y, meter.z, x, meter.y + (index % 5 ? METER_DRAW.tick : METER_DRAW.fifth), meter.z));
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
    const ruler = new LineSegments(geometry, new LineBasicMaterial({ color: "#9fd8ff", transparent: true, opacity: 0.4, depthWrite: false, toneMapped: false, fog: false }));
    ruler.renderOrder = -1;
    return { id: meter.id, ruler };
  }), [meters]);
  useEffect(() => () => { for (const entry of rulers) { entry.ruler.geometry.dispose(); entry.ruler.material.dispose(); } }, [rulers]);
  return <>
    {rulers.map((entry) => <primitive key={entry.id} object={entry.ruler} raycast={noRaycast} />)}
    {meters.flatMap((meter) => meter.zones.map((zone) => <MeterNote key={`${meter.id}:${zone.x}`} label={zone.label} position={[zone.x + METER_DRAW.note / 2, meter.y - METER_DRAW.below, meter.z]} />))}
  </>;
}
function MeterNote({ label, position }: { label: string; position: Position3 }) {
  const texture = useMemo(() => meterTexture(label), [label]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite raycast={noRaycast} renderOrder={-1} position={position} scale={[METER_DRAW.note, METER_DRAW.note * 120 / 512, 1]}><spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} fog={false} /></sprite>;
}

/** Giant calendar pins behind the story: a big date high up and far back
 * where a calendar day starts, a faint pole down to the floor. Never raycast,
 * labelled or framed: a backdrop, not records. */
function CalendarPins({ pins }: { pins: CalendarPin[] }) {
  return <>{pins.map((pin) => <CalendarPinMesh key={pin.id} pin={pin} />)}</>;
}
function CalendarPinMesh({ pin }: { pin: CalendarPin }) {
  const texture = useMemo(() => pinTexture(pin.label, pin.detail), [pin.label, pin.detail]);
  useEffect(() => () => texture.dispose(), [texture]);
  // World-sized lettering far back: it reads as distant scenery and scales with the view like the strands do.
  // Outside the render-distance fog, which would hide anything this far behind the story.
  const floor = -944, width = 4200, tall = width * 300 / 1024, base = pin.card - tall * 0.45, height = Math.max(200, base - floor);
  return <group position={[pin.x, 0, pin.z]}>
    <mesh raycast={noRaycast} renderOrder={-1} position={[0, floor + height / 2, 0]}><cylinderGeometry args={[22, 22, height, 10]} /><meshBasicMaterial color="#a9c4ff" transparent opacity={0.18} depthWrite={false} toneMapped={false} fog={false} /></mesh>
    <mesh raycast={noRaycast} renderOrder={-1} position={[0, floor + 1, 0]} rotation={[-Math.PI / 2, 0, 0]}><ringGeometry args={[90, 140, 40]} /><meshBasicMaterial color="#a9c4ff" transparent opacity={0.25} depthWrite={false} toneMapped={false} fog={false} /></mesh>
    <sprite raycast={noRaycast} renderOrder={-1} position={[0, pin.card, 0]} scale={[width, tall, 1]}><spriteMaterial map={texture} transparent depthWrite={false} toneMapped={false} fog={false} /></sprite>
  </group>;
}

/**
 * Render distance, the way a block game does it: around the point the
 * camera looks at, things stay clear; with distance they fade into the
 * background fog, and past the edge they are not drawn at all (so a whole
 * universe stays light). Labels go a little before their spheres do.
 */
function RenderDistance({ graphRef, radius }: { graphRef: { current: GraphCanvasRef | null }; radius: number }) {
  const { scene, camera } = useThree();
  const fog = useMemo(() => new Fog("#050b15", 1, 2), []);
  useEffect(() => {
    const previous = scene.fog;
    scene.fog = fog;
    // Leaving a universe view: everything drawn again, no fog.
    return () => { scene.fog = previous; scene.traverse((object) => { if (object.userData.orbitalGlyph) { object.visible = true; object.userData.distanceFaded = false; } }); };
  }, [scene, fog]);
  const target = useMemo(() => new Vector3(), []);
  const place = useMemo(() => new Vector3(), []);
  useFrame(() => {
    const controls = graphRef.current?.getControls?.();
    if (!controls) return;
    controls.getTarget(target, false);
    const distance = camera.position.distanceTo(target);
    fog.near = Math.hypot(distance, radius * 0.45);
    fog.far = Math.hypot(distance, radius * 1.05);
    scene.traverse((object) => {
      if (!object.userData.orbitalGlyph) return;
      const away = object.getWorldPosition(place).distanceTo(target);
      object.visible = away <= radius * 1.1;
      object.userData.distanceFaded = away > radius * 0.8;
    });
  });
  return null;
}

/** Arrowheads keep a small fixed size on screen, like a flat graph's,
 * with the tip on the target's surface (capped to a share of the segment). */
const HEAD_PX = 9;
const worldPerPixel = (camera: Camera, width: number, point: Vector3) => {
  const at = point.clone().project(camera);
  const right = new Vector3().setFromMatrixColumn(camera.matrixWorld, 0).add(point).project(camera);
  return 1 / Math.max(0.000001, Math.abs(right.x - at.x) * width / 2);
};
/** Unit arrowhead (length 1, tip at the origin, pointing +Y); scale it to size. */
function ArrowHead({ color, opacity = 1 }: { color: string; opacity?: number }) {
  return <mesh raycast={noRaycast} position={[0, -0.5, 0]}><coneGeometry args={[0.34, 1, 10]} /><meshBasicMaterial color={color} transparent={opacity < 1} opacity={opacity} toneMapped={false} /></mesh>;
}

/** A strand's axis: a near-white cyan core and the design's strong cyan as its glow. */
const STRAND_GLOW = { core: "#c4ecff", halo: "#36adff" };
/** Path tones: the blue time string, an amber flashback thread, a character route, a faint move, a spiral's coil (the design's cyan). */
const PATH_TONES = { time: { color: "#51b7ff", arrow: "#75ceff", opacity: 0.6 }, thread: { color: "#ffc46b", arrow: "#ffc46b", opacity: 0.75 }, route: { color: "#ff9a6b", arrow: "#ffb48c", opacity: 0.95 }, link: { color: "#7cc8ff", arrow: "#7cc8ff", opacity: 0.16 }, coil: { color: "#9fd8ff", arrow: "#9fd8ff", opacity: 0.5 } };

function AnimatedTimePath({ path, morph, reducedMotion, motion, anchors, radii }: { path: OrbitalPath; morph: OrbitalMorph | null; reducedMotion: boolean; motion: MotionBus; anchors: (string | undefined)[]; radii: Map<string, number> }) {
  const { camera, size } = useThree();
  const tone = PATH_TONES[path.tone ?? "time"];
  // A coil glows by how much its strand matters; minor coils stay faint.
  const weight = path.weight ?? 1;
  const line = useMemo(() => new Line(new BufferGeometry().setFromPoints(path.points.map((point) => new Vector3(...point))), new LineBasicMaterial({ color: tone.color, transparent: true, opacity: (path.preview ? 0.85 : path.tone === "coil" ? 0.12 + 0.6 * weight : tone.opacity) * (path.dim ? 0.15 : 1), depthWrite: false })), [path, tone, weight]);
  const arrowGroups = useRef<(Group | null)[]>([]);
  const arrowCount = path.tone === "link" || path.tone === "coil" || path.strand ? 0 : path.tone === "thread" ? 1 : path.tone === "route" ? Math.min(16, path.points.length - 1) : path.preview ? 3 : Math.max(1, Math.min(8, path.points.length - 1));
  const arrowIndices = useMemo(() => Array.from({ length: arrowCount }, (_, index) => Math.max(1, Math.round((index + 1) * (path.points.length - 1) / arrowCount))), [path, arrowCount]);
  /** A character's route: a bead travels it in story order (resting at the start under reduced motion). */
  const bead = useRef<Mesh>(null);
  // WebGL lines are one pixel wide; a route, and a strand's axis, also get a thin tube so they read at a glance.
  // A strand's axis is a bright core inside a soft additive halo, both as strong as the strand matters.
  const [tube, halo] = useMemo(() => {
    if ((path.tone !== "route" && !path.strand) || path.points.length < 2) return [null, null];
    const curve = new CurvePath<Vector3>();
    for (let index = 1; index < path.points.length; index++) curve.add(new LineCurve3(new Vector3(...path.points[index - 1]), new Vector3(...path.points[index])));
    if (!path.strand) return [new TubeGeometry(curve, Math.min(400, 24 * (path.points.length - 1)), 7, 6, false), null];
    // A strand axis is already finely sampled: one tube segment per sample keeps its bends.
    const radius = 12 + 26 * weight, segments = Math.min(1200, path.points.length - 1);
    return [new TubeGeometry(curve, segments, radius, 8, false), new TubeGeometry(curve, segments, radius * 3.2, 10, false)];
  }, [path, weight]);
  useEffect(() => () => { tube?.dispose(); halo?.dispose(); }, [tube, halo]);
  useEffect(() => () => { line.geometry.dispose(); line.material.dispose(); }, [line]);
  useFrame(() => {
    const attribute = line.geometry.attributes.position;
    const points = path.points.map((point, index): Position3 => {
      const from = path.fromPoints?.[index];
      // The opening sequence grows the spine from its head, in step with the spheres.
      const delay = morph?.delays ? OPENING_STAGGER_MS * index / Math.max(1, path.points.length - 1) : 0;
      return from && morph ? interpolatePose({ position: from, radius: 1 }, { position: point, radius: 1 }, reducedMotion ? 1 : morphProgress(morph, "", performance.now() - delay, ORBITAL_TRANSITION_MS)).position : point;
    });
    // The spine is the string the timeline spheres hang on: it sways with them.
    points.forEach((point, index) => {
      const sway = anchors[index] ? swayOf(motion, anchors[index]!) : null;
      if (sway) points[index] = point.map((value, axis) => value + sway[axis]) as Position3;
      attribute.setXYZ(index, ...points[index]);
    });
    attribute.needsUpdate = true;
    line.geometry.computeBoundingSphere();
    if (bead.current && points.length > 1) {
      const travel = reducedMotion ? 0 : (performance.now() / (1400 * (points.length - 1))) % 1;
      const along = travel * (points.length - 1), segment = Math.min(points.length - 2, Math.floor(along)), part = along - segment;
      bead.current.position.set(...points[segment].map((value, axis) => value + (points[segment + 1][axis] - value) * part) as Position3);
    }
    arrowIndices.forEach((pointIndex, index) => {
      const arrow = arrowGroups.current[index];
      if (!arrow) return;
      const end = new Vector3(...points[pointIndex]), start = new Vector3(...points[Math.max(0, pointIndex - 1)]);
      const segment = end.distanceTo(start);
      const direction = end.clone().sub(start).normalize();
      const target = anchors[pointIndex] ? radii.get(anchors[pointIndex]!) ?? 0 : 0;
      const tip = end.clone().addScaledVector(direction, -Math.min(target, segment * 0.5));
      arrow.position.copy(tip);
      arrow.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), direction));
      arrow.scale.setScalar(Math.min(HEAD_PX * worldPerPixel(camera, size.width, tip), Math.max(1, segment * 0.4)));
    });
  });
  return <>
    <primitive object={line} raycast={noRaycast} />
    {tube && <mesh geometry={tube} raycast={noRaycast}><meshBasicMaterial color={path.strand ? STRAND_GLOW.core : tone.color} transparent opacity={path.dim ? 0.08 : path.strand ? 0.3 + 0.65 * weight : 0.8} depthWrite={false} toneMapped={false} /></mesh>}
    {halo && !path.dim && <mesh geometry={halo} raycast={noRaycast}><meshBasicMaterial color={STRAND_GLOW.halo} transparent opacity={0.03 + 0.12 * weight} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>}
    {path.tone === "route" && <mesh ref={bead} raycast={noRaycast}><sphereGeometry args={[34, 16, 12]} /><meshBasicMaterial color={tone.arrow} toneMapped={false} /></mesh>}
    {arrowIndices.map((pointIndex, index) => <group key={`${index}:${pointIndex}`} ref={(element) => { arrowGroups.current[index] = element; }}>
      <ArrowHead color={tone.arrow} />
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

const CROSS_VOLUME_COLOR = "#c9a7ff";
/** A character's part in an event or dialogue (a lit strand's cast): no direction, so no head or bead. */
const PARTICIPATION_COLOR = "#cfe7f7";
const CAUSAL_COLOR = { canon: "#ff8f5a", proposed: "#ffc777", held: "#91c3e0" } as const;
const CAUSAL_SAMPLES = 24;

/** Stored CAUSES links: cause → effect arcs lifted off the time spine.
 * Dashed = projected onto containing spheres; solid = event to event. */
function CausalArc({ arrow, bus, radii, reducedMotion }: { arrow: CausalArrow; bus: LabelBus; radii: Map<string, number>; reducedMotion: boolean }) {
  const { camera, size } = useThree();
  // Cross-volume causes (universe ledger) in violet, book causes in orange; a character's part in a lit strand's records, dim.
  const crossVolume = arrow.links.some((link) => link.universeId);
  const line = useMemo(() => {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array((CAUSAL_SAMPLES + 1) * 3), 3));
    const color = arrow.participation ? PARTICIPATION_COLOR : crossVolume ? CROSS_VOLUME_COLOR : CAUSAL_COLOR[arrow.state];
    const opacity = arrow.participation ? 0.24 : arrow.state === "canon" ? 0.9 : 0.6;
    const material = arrow.projected
      ? new LineDashedMaterial({ color, dashSize: 26, gapSize: 18, transparent: true, opacity, depthWrite: false, toneMapped: false })
      : new LineBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false });
    return new Line(geometry, material);
  }, [arrow.state, arrow.projected, arrow.participation, crossVolume]);
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
    const control = start.clone().add(end).multiplyScalar(0.5).add(arrow.bend ? new Vector3(...arrow.bend) : new Vector3(0, Math.max(60, distance * 0.28), 0));
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
      if (!reducedMotion) {
        bead.current.position.copy(curve.getPoint(startT + (endT - startT) * ((now() * 0.35 + phase) % 1)));
        bead.current.scale.setScalar(Math.min(2.2 * worldPerPixel(camera, size.width, bead.current.position), 4 * width));
      }
    }
    if (head.current) {
      const tip = curve.getPoint(endT);
      head.current.scale.setScalar(Math.min((HEAD_PX + 2 * (width - 1)) * worldPerPixel(camera, size.width, tip), Math.max(1, distance * 0.3)));
      head.current.position.copy(tip);
      head.current.quaternion.copy(new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), curve.getTangent(endT).normalize()));
    }
  });
  return <>
    <primitive object={line} raycast={noRaycast} />
    {!arrow.participation && <group ref={bead}><mesh raycast={noRaycast}><sphereGeometry args={[1, 10, 8]} /><meshBasicMaterial color="#ffd9c2" transparent opacity={arrow.state === "canon" ? 0.95 : 0.6} toneMapped={false} /></mesh></group>}
    {!arrow.participation && <group ref={head}><ArrowHead color={crossVolume ? CROSS_VOLUME_COLOR : CAUSAL_COLOR[arrow.state]} opacity={arrow.state === "canon" ? 0.95 : 0.65} /></group>}
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
    const fade = morph && !reducedMotion ? uncoilEase(morphProgress(morph, "", performance.now(), ORBITAL_TRANSITION_MS)) : 1;
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

/** Soft round sprite shared by the atmosphere layers. */
let dotTexture: CanvasTexture | null = null;
function softDot() {
  if (dotTexture) return dotTexture;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 64;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(32, 32, 0, 32, 32, 32);
  gradient.addColorStop(0, "rgba(255,255,255,1)"); gradient.addColorStop(0.35, "rgba(255,255,255,.45)"); gradient.addColorStop(1, "rgba(255,255,255,0)");
  context.fillStyle = gradient; context.fillRect(0, 0, 64, 64);
  dotTexture = new CanvasTexture(canvas);
  return dotTexture;
}
const seeded = (seed: number) => () => { seed = (seed + 0x6d2b79f5) | 0; let value = Math.imul(seed ^ (seed >>> 15), 1 | seed); value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value; return ((value ^ (value >>> 14)) >>> 0) / 4294967296; };

/**
 * Atmosphere: far stars on a distant shell and nearer dust around the level,
 * so camera moves and parallax read as depth. Decoration only; never
 * raycast. Under reduced motion both layers stay still.
 */
function Atmosphere({ draws, reducedMotion }: { draws: OrbitalDraw[]; reducedMotion: boolean }) {
  const bounds = useMemo(() => {
    if (!draws.length) return { center: [0, 0, 0] as Position3, extent: 3000 };
    const axes = [0, 1, 2].map((axis) => draws.map((draw) => draw.position[axis]));
    const center = axes.map((values) => (Math.min(...values) + Math.max(...values)) / 2) as Position3;
    return { center, extent: Math.max(2000, ...axes.map((values) => Math.max(...values) - Math.min(...values))) };
  }, [draws]);
  const layers = useMemo(() => {
    const random = seeded(7);
    const star = new Float32Array(900 * 3);
    for (let index = 0; index < 900; index++) {
      const theta = random() * Math.PI * 2, phi = Math.acos(2 * random() - 1);
      star.set([Math.sin(phi) * Math.cos(theta), Math.cos(phi) * 0.7 + 0.15, Math.sin(phi) * Math.sin(theta)], index * 3);
    }
    const dust = new Float32Array(320 * 3);
    for (let index = 0; index < 320; index++) dust.set([random() - 0.5, (random() - 0.5) * 0.5, random() - 0.5], index * 3);
    const stars = new Points(new BufferGeometry().setAttribute("position", new Float32BufferAttribute(star, 3)), new PointsMaterial({ map: softDot(), color: "#bcdcff", size: 2.4, sizeAttenuation: false, transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }));
    const motes = new Points(new BufferGeometry().setAttribute("position", new Float32BufferAttribute(dust, 3)), new PointsMaterial({ map: softDot(), color: "#7fc4ff", size: 26, sizeAttenuation: true, transparent: true, opacity: 0.32, depthWrite: false, blending: AdditiveBlending, toneMapped: false }));
    stars.frustumCulled = motes.frustumCulled = false;
    return { stars, motes };
  }, []);
  useEffect(() => () => { for (const layer of Object.values(layers)) { layer.geometry.dispose(); (layer.material as PointsMaterial).dispose(); } }, [layers]);
  useFrame(() => {
    const { stars, motes } = layers;
    stars.position.set(...bounds.center);
    stars.scale.setScalar(Math.max(40000, bounds.extent * 8));
    motes.position.set(...bounds.center);
    motes.scale.set(bounds.extent * 1.8, bounds.extent * 1.8, bounds.extent * 1.8);
    (motes.material as PointsMaterial).size = Math.max(10, bounds.extent / 120);
    if (reducedMotion) return;
    const t = now();
    stars.rotation.y = t * 0.004;
    motes.rotation.y = t * 0.012;
    motes.position.y = bounds.center[1] + Math.sin(t * 0.2) * bounds.extent * 0.01;
  });
  return <><primitive object={layers.stars} raycast={noRaycast} /><primitive object={layers.motes} raycast={noRaycast} /></>;
}

/**
 * Pi heartbeat: while Pi is working, a light pulse runs along the spine to the
 * record it is touching and blooms there, every few seconds. It shows only
 * where Pi already reports activity; it never moves the camera.
 */
const HEARTBEAT_PERIOD = 3.2, HEARTBEAT_TRAVEL = 1.5;
function PiHeartbeat({ spine, targetId, draws, bus }: { spine: Position3[]; targetId: string; draws: OrbitalDraw[]; bus: LabelBus }) {
  const pulse = useRef<Mesh>(null), bloom = useRef<Mesh>(null);
  const target = draws.find((draw) => draw.node.id === targetId);
  const route = useMemo(() => target ? heartbeatRoute(spine, target.position) : [], [spine, target]);
  useFrame(() => {
    if (!pulse.current || !bloom.current || !target || !route.length) return;
    const phase = now() % HEARTBEAT_PERIOD;
    const travelling = phase < HEARTBEAT_TRAVEL;
    const end = bus.positions.get(targetId) ?? target.position;
    const u = phase / HEARTBEAT_TRAVEL;
    const point = travelling ? pointAlong([...route.slice(0, -1), end], u * u * (3 - 2 * u)) : end;
    pulse.current.visible = travelling;
    pulse.current.position.set(...point);
    pulse.current.scale.setScalar(Math.max(18, target.radius * 0.12));
    const age = (phase - HEARTBEAT_TRAVEL) / (HEARTBEAT_PERIOD - HEARTBEAT_TRAVEL);
    bloom.current.visible = !travelling && age < 0.7;
    bloom.current.position.set(...end);
    bloom.current.scale.setScalar(target.radius * (1.05 + age * 0.9));
    bloom.current.quaternion.copy(bloomFacing);
    (bloom.current.material as MeshBasicMaterial).opacity = 0.55 * (1 - age / 0.7) ** 2;
  });
  if (!target) return null;
  return <>
    <mesh ref={pulse} raycast={noRaycast}><sphereGeometry args={[1, 16, 12]} /><meshBasicMaterial color="#bfe6ff" transparent opacity={0.95} blending={AdditiveBlending} depthWrite={false} toneMapped={false} /></mesh>
    <mesh ref={bloom} raycast={noRaycast}><ringGeometry args={[0.96, 1, 96]} /><meshBasicMaterial color="#9fd8ff" transparent opacity={0} blending={AdditiveBlending} depthWrite={false} toneMapped={false} side={DoubleSide} /></mesh>
  </>;
}
const bloomFacing = new Quaternion();
/** Keeps the heartbeat bloom ring facing the camera. */
function FaceCamera() {
  const { camera } = useThree();
  useFrame(() => { bloomFacing.copy(camera.quaternion); });
  return null;
}

/**
 * Camera inertia driver: reads how the camera accelerates (orbit, pan, zoom,
 * framing flights) and steps the floating-in-liquid rig in motion.inertia.
 * Jumps (teleports) are ignored rather than flinging the world.
 */
function CameraInertia({ draws, motion, enabled, graphRef }: { draws: OrbitalDraw[]; motion: MotionBus; enabled: boolean; graphRef: { current: GraphCanvasRef | null } }) {
  const { camera } = useThree();
  useMemo(() => { motion.inertia = buildInertiaRig(draws, motion.inertia); }, [draws, motion]);
  const last = useRef<{ position: Vector3; velocity: Vector3; drive: Vector3 } | null>(null);
  useEffect(() => () => { motion.inertia = undefined; }, [motion]);
  useFrame((_, delta) => {
    const rig = motion.inertia;
    if (!rig) return;
    if (!enabled) { for (const body of rig.bodies.values()) { body.p = [0, 0, 0]; body.v = [0, 0, 0]; } last.current = null; return; }
    const dt = Math.min(Math.max(delta, 1 / 240), 0.1);
    const position = camera.position.clone();
    const target = graphRef.current?.getControls?.()?.getTarget(new Vector3(), false);
    const distance = Math.max(1, target ? position.distanceTo(target) : position.length());
    if (!last.current) { last.current = { position, velocity: new Vector3(), drive: new Vector3() }; return; }
    let velocity = position.clone().sub(last.current.position).divideScalar(dt);
    if (velocity.length() / distance > 25) velocity = new Vector3();
    const acceleration = velocity.clone().sub(last.current.velocity).divideScalar(dt).divideScalar(distance);
    const drive = last.current.drive.lerp(acceleration, 0.5);
    last.current = { position, velocity, drive };
    stepInertia(rig, drive.toArray() as Position3, dt);
  });
  return null;
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

function OrbitalProjection({ draws, bus, selectedId, revealedId, transitioning, opening = false, enclosure, hoverCard, motion, onReveal, onExtremeBack, onCenter, focusIds }: { onCenter?: (ids: string[]) => void; /** With a focus (a lit strand), its characters' names come before scene labels and dimmed labels come last. */ focusIds?: ReadonlySet<string> | null; draws: OrbitalDraw[]; bus: LabelBus; selectedId: string | null; revealedId: string | null; transitioning: boolean; /** Opening sequence: labels wait until records have arrived. */ opening?: boolean; enclosure?: Enclosure; hoverCard?: { current: HTMLDivElement | null }; motion?: MotionBus; onReveal: (id: string | null) => void; onExtremeBack: () => void }) {
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
  /** Centre watch: main spheres inside the middle of the view, sampled a few times a second. */
  const centre = useRef({ at: 0, key: "" });
  useFrame(() => {
    bus.positions.clear();
    const sampleCentre = !!onCenter && !transitioning && performance.now() - centre.current.at > 400;
    const central: string[] = [];
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
      // Beyond the render distance: no label (the sphere itself fades or is not drawn).
      if (!object.visible || object.userData.distanceFaded && selectedId !== draw.node.id) return;
      if (sampleCentre && draw.role === "main" && point.z < 1 && Math.abs(point.x) < 0.45 && Math.abs(point.y) < 0.55) central.push(draw.node.id);
      const selectedPreview = draws.some((entry) => entry.node.id === selectedId && entry.previewParentId === draw.node.id);
      if (!transitioning && selectedPreview && world.distanceTo(camera.position) < draw.radius * 4) closest = { id: draw.node.id, pixels, score: 1000000 };
      if (point.z > 1 || (!selectedPreview && (Math.abs(point.x) > 1.2 || Math.abs(point.y) > 1.2))) return;
      if (!transitioning && draw.role === "main" && draw.entry?.scope) {
        const score = pixels - Math.hypot(point.x, point.y) * 20 + (selectedId === draw.node.id || selectedPreview ? 10000 : 0);
        if (pixels >= (revealed.current === draw.node.id ? 46 : 64) && (!closest || score > closest.score)) closest = { id: draw.node.id, pixels, score };
      }
      if (opening || (draw.role === "connection" || draw.role === "preview" && pixels < 3) && selectedId !== draw.node.id) return;
      candidates.push({ draw, position: point, pixels, priority: selectedId === draw.node.id ? 0 : focusIds && !focusIds.has(draw.node.id) ? 4 : draw.role === "preview" || focusIds && draw.role === "nebula" ? 1 : draw.role === "main" ? 2 : 3 });
    });
    if (sampleCentre) {
      centre.current.at = performance.now();
      const key = central.sort().join("|");
      if (key !== centre.current.key) { centre.current.key = key; onCenter!(central); }
    }
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

/** The view every level opens with, from one steady side (a reset returns to it). */
const ARRIVAL_DIRECTION: Position3 = [0.14, 0.3, 1];

function OrbitalFraming({ graphRef, draws, selectedId, enclosure, levelKey, reducedMotion, enabled, direction, span, resetToken = 0 }: { graphRef: { current: GraphCanvasRef | null }; draws: OrbitalDraw[]; selectedId: string | null; enclosure?: Enclosure; levelKey: string; reducedMotion: boolean; enabled: boolean; direction?: Position3; span?: Position3[]; resetToken?: number }) {
  const { camera, size } = useThree();
  // Narrow (portrait) screens frame fewer neighbours so spheres stay readable.
  const neighbours = size.width / Math.max(1, size.height) < 0.8 ? 2 : 5;
  const positions = span && span.length > 1 && !selectedId ? span : entryFrame(draws, selectedId, neighbours);
  // "Reset view" ignores the selection: it is the level's own arrival view.
  const arrival = span && span.length > 1 ? span : entryFrame(draws, null, neighbours);
  const latest = useRef({ positions, arrival, enclosure }); latest.current = { positions, arrival, enclosure };
  const framingEnabled = useRef(enabled); framingEnabled.current = enabled;
  const lastReset = useRef(resetToken);
  useEffect(() => {
    (camera as { fov: number }).fov = 42; camera.near = 1; camera.far = 2000000; camera.updateProjectionMatrix();
    const reset = resetToken !== lastReset.current;
    lastReset.current = resetToken;
    const timeout = setTimeout(() => { if (framingEnabled.current || reset) framePositions(graphRef, reset ? latest.current.arrival : latest.current.positions, 1.2, !reducedMotion, { direction: direction ?? ARRIVAL_DIRECTION, within: latest.current.enclosure, ignoreSheet: true }); }, 100);
    return () => clearTimeout(timeout);
  }, [levelKey, reducedMotion, camera, graphRef, size.width, size.height, resetToken]);
  return null;
}

interface Props {
  /** Bumped by "Reset view": the camera returns to this level's arrival view. */
  viewToken?: number;
  /** The selection and what it links to; other spheres recede. */
  focusIds?: ReadonlySet<string> | null;
  /** Working faculties to animate, grouped by the sphere they play on. */
  faculties?: FacultyAnchor[];
  /** A flat map on the floor (orbital Places); world units. */
  floor?: FloorMark[];
  /** Giant calendar pins behind the story (orbital Story time); world units. */
  pins?: CalendarPin[];
  /** Rulers on the same backdrop: how story time is compressed. */
  meters?: TimeMeter[];
  /** Minecraft-style render distance (world units) around where the camera looks. */
  renderDistance?: number;
  /** Camera direction for automatic framing (default: a slight side view). */
  frameDirection?: Position3;
  /** What automatic framing frames (default: the selection's neighbourhood or every main sphere). */
  frameSpan?: Position3[];
  /** Main spheres near the centre of the view, reported when the set changes. */
  onCenter?: (ids: string[]) => void;
  /** Record Pi is working on right now (heartbeat target), if any. */
  heartbeatId?: string | null;
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

export const OrbitalGraph = forwardRef<GraphCanvasRef, Props>(function OrbitalGraph({ draws, paths, edges, causal = [], backdrop, bus, selectedId, touchedIds = [], autoFrame = true, revealedId, levelKey, reducedMotion, morph, onSelect, onEnter, onReveal, onBack, motion, hoverEdges = [], hoverCard, onHover, onBlank, heartbeatId, faculties = [], floor = [], pins = [], meters = [], renderDistance, frameDirection, frameSpan, onCenter, viewToken, focusIds }, ref) {
  const nodes = useMemo(() => draws.map((draw) => ({ id: draw.node.id, label: draw.node.label, size: draw.radius, fill: recordColor(draw.node), fx: draw.position[0], fy: draw.position[1], fz: draw.position[2], data: { glyph: { draw, morph, reducedMotion, selected: selectedId === draw.node.id, touched: touchedIds.includes(draw.node.id), dimmed: !!focusIds && !focusIds.has(draw.node.id), transparent: revealedId === draw.node.id || !!draw.envelope || draws.some((entry) => entry.role === "connection" && entry.previewParentId === draw.node.id), motion } as GlyphData } })), [draws, morph, reducedMotion, revealedId, selectedId, touchedIds, motion, focusIds]);
  const theme = useMemo(() => ({ ...darkTheme, canvas: { background: "#050b15", fog: null } }), []);
  const radii = useMemo(() => new Map(draws.map((draw) => [draw.node.id, draw.radius])), [draws]);
  const enclosure = useMemo(() => { const ghost = backdrop?.ghosts.find((entry) => entry.current); return ghost ? { center: ghost.position, radius: ghost.radius } : undefined; }, [backdrop]);
  const spine = useMemo(() => paths.find((path) => !path.preview)?.points ?? [], [paths]);
  /** Which sphere sits on each path point, so the string follows their sway. */
  const pathAnchors = useMemo(() => new Map(paths.map((path) => [path.id, path.points.map((point) => draws.find((draw) => draw.position.every((value, axis) => value === point[axis]))?.node.id)])), [paths, draws]);
  return <GraphCanvas ref={ref} nodes={nodes} edges={[]} theme={theme} renderNode={renderSphere} labelType="none" layoutType="forceDirected3d" cameraMode="pan" draggable={false} animated={false} minDistance={16} maxDistance={1000000} selections={[]} glOptions={{ antialias: true, preserveDrawingBuffer: true }}
    onNodeClick={(node) => onSelect((node.data.glyph as GlyphData).draw)} onNodeDoubleClick={(node) => onEnter((node.data.glyph as GlyphData).draw)}
    onNodePointerOver={(node) => { if ((node.data.glyph as GlyphData).draw.role !== "preimage") onHover?.(node.id); }} onNodePointerOut={(node) => { if (motion.hoveredId === node.id) onHover?.(null); }}
    onCanvasClick={(event) => onBlank?.(event)}>
    <ambientLight intensity={0.85} /><directionalLight position={[800, 1200, 1800]} intensity={1.5} color="#c4eaff" />
    <gridHelper args={[18000, 90, "#294760", "#122237"]} position={[0, -950, 0]} />
    {floor.length ? <FloorMap marks={floor} /> : <axesHelper args={[900]} position={[-1400, -945, -1200]} />}
    {pins.length > 0 && <CalendarPins pins={pins} />}
    {meters.length > 0 && <TimeMeters meters={meters} />}
    {backdrop && <ParentBackdrop ghosts={backdrop.ghosts} path={backdrop.path} morph={morph} reducedMotion={reducedMotion} />}
    {paths.map((path) => <AnimatedTimePath key={path.id} path={path} morph={morph} reducedMotion={reducedMotion} motion={motion} anchors={pathAnchors.get(path.id) ?? []} radii={radii} />)}
    <VisibleConnections edges={edges} bus={bus} />
    {hoverEdges.length > 0 && <VisibleConnections edges={hoverEdges} bus={bus} color="#d9cbff" opacity={0.55} />}
    {!reducedMotion && <RippleRings motion={motion} />}
    <Atmosphere draws={draws} reducedMotion={reducedMotion} />
    <FacultyEffects anchors={faculties} draws={draws} bus={bus} reducedMotion={reducedMotion} />
    <CameraInertia draws={draws} motion={motion} enabled={!reducedMotion} graphRef={ref as { current: GraphCanvasRef | null }} />
    {!reducedMotion && heartbeatId && <><FaceCamera /><PiHeartbeat spine={spine} targetId={heartbeatId} draws={draws} bus={bus} /></>}
    <LocalClipping />
    {renderDistance ? <RenderDistance graphRef={ref as { current: GraphCanvasRef | null }} radius={renderDistance} /> : null}
    <PointerParallax graphRef={ref as { current: GraphCanvasRef | null }} enabled={!reducedMotion} />
    {causal.map((arrow) => <CausalArc key={arrow.id} arrow={arrow} bus={bus} radii={radii} reducedMotion={reducedMotion} />)}
    <ActivityBounds draws={draws.filter(draw => touchedIds.includes(draw.node.id))} bus={bus} />
    <OrbitalProjection key={levelKey} draws={draws} bus={bus} selectedId={selectedId} focusIds={focusIds} revealedId={revealedId} transitioning={!!morph} opening={!!morph?.delays} enclosure={enclosure} hoverCard={hoverCard} motion={motion} onReveal={onReveal} onExtremeBack={onBack} onCenter={onCenter} />
    <ScaleNavigation graphRef={ref as { current: GraphCanvasRef | null }} reducedMotion={reducedMotion} />
    <OrbitalFraming graphRef={ref as { current: GraphCanvasRef | null }} draws={draws} selectedId={selectedId} enclosure={enclosure} levelKey={levelKey} reducedMotion={reducedMotion} enabled={autoFrame} direction={frameDirection} span={frameSpan} resetToken={viewToken} />
  </GraphCanvas>;
});
