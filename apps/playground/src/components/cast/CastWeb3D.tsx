import { Canvas, useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { useEffect, useMemo, useRef, useState } from "react";
import { BufferGeometry, CanvasTexture, Float32BufferAttribute, Fog, Line, LineBasicMaterial, QuadraticBezierCurve3, SRGBColorSpace, Sprite, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { RING_RADIUS, TIERS, TIER_HEIGHT, webLayout3d, type CharacterWeb, type Tier, type WebEdge, type WebNode } from "../../data/castWeb";

const SPREAD = 1.6;
const TIER_COLOR: Record<Tier, string> = { protagonist: "#f2c46d", pillar: "#7fd1c7", connector: "#b9a3ff", cameo: "#8ea3b5" };
const TONE_COLOR = { bond: "#6fd39b", tension: "#ff7a6b", neutral: "#7f93a6" } as const;
const SEGMENTS = 24;

/** A disc like the flat web's: portrait or first glyph, ringed in its tier colour. */
const textures = new Map<string, CanvasTexture>();
function discTexture(node: WebNode): CanvasTexture {
  const key = `${node.id}|${node.tier}|${node.portrait ?? ""}`;
  const cached = textures.get(key);
  if (cached) return cached;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 160;
  const context = canvas.getContext("2d")!;
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  const paint = (image?: HTMLImageElement) => {
    context.clearRect(0, 0, 160, 160);
    context.save();
    context.beginPath();
    context.arc(80, 80, 70, 0, Math.PI * 2);
    context.fillStyle = "#15293a";
    context.fill();
    context.clip();
    if (image) {
      const side = Math.min(image.width, image.height);
      context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 10, 10, 140, 140);
    } else {
      context.fillStyle = "#e7f2f8";
      context.font = "600 72px -apple-system, 'PingFang SC', 'Noto Sans CJK SC', sans-serif";
      context.textAlign = "center";
      context.textBaseline = "middle";
      context.fillText([...node.name][0] ?? "?", 80, 84);
    }
    context.restore();
    context.beginPath();
    context.arc(80, 80, 72, 0, Math.PI * 2);
    context.lineWidth = node.tier === "protagonist" ? 9 : 6;
    context.strokeStyle = TIER_COLOR[node.tier];
    context.stroke();
    texture.needsUpdate = true;
  };
  paint();
  if (node.portrait) {
    const image = new Image();
    image.onload = () => paint(image);
    image.src = node.portrait;
  }
  textures.set(key, texture);
  return texture;
}

interface Motion { position: Vector3; size: number }
interface Props {
  web: CharacterWeb;
  selected: string[];
  reducedMotion: boolean;
  /** A tie to carry a travelling light along: the pair being watched. */
  pulse?: string;
  onPick: (id: string, additive: boolean) => void;
}

export function CastWeb3D(props: Props) {
  const labels = useRef(new Map<string, HTMLSpanElement>());
  const [hover, setHover] = useState<string | null>(null);
  return (
    <div className="web3d" onMouseLeave={() => setHover(null)}>
      <Canvas camera={{ position: [1.2, 2.3, 3.9], fov: 40, near: 0.05, far: 40 }} dpr={[1, 2]} onPointerMissed={() => setHover(null)}>
        <Scene {...props} hover={hover} setHover={setHover} labels={labels} />
      </Canvas>
      <div className="labels3d" aria-hidden="true">
        {props.web.nodes.map((node) => (
          <span key={node.id} ref={(element) => { if (element) labels.current.set(node.id, element); else labels.current.delete(node.id); }}
            className={`label3d tier-${node.tier}`}>{node.name}</span>
        ))}
      </div>
    </div>
  );
}

function Scene({ web, selected, reducedMotion, pulse, onPick, hover, setHover, labels }: Props & { hover: string | null; setHover: (id: string | null) => void; labels: React.RefObject<Map<string, HTMLSpanElement>> }) {
  const { camera, gl, scene, size } = useThree();
  const targets = useMemo(() => webLayout3d(web), [web]);
  const motion = useRef(new Map<string, Motion>());
  const sprites = useRef(new Map<string, Sprite>());
  const lines = useRef(new Map<string, Line>());
  const bead = useRef<Sprite>(null);
  const controls = useRef<OrbitControls | null>(null);
  const focus = hover ?? (selected.length === 1 ? selected[0] : null);
  const pairEdge = selected.length === 2 ? web.edges.find((edge) => selected.includes(edge.a) && selected.includes(edge.b))?.id : undefined;
  const neighbours = useMemo(() => {
    const map = new Map<string, Set<string>>();
    for (const edge of web.edges) {
      map.set(edge.a, new Set([...map.get(edge.a) ?? [], edge.b]));
      map.set(edge.b, new Set([...map.get(edge.b) ?? [], edge.a]));
    }
    return map;
  }, [web]);
  const strongest = Math.max(1, ...web.edges.map((edge) => edge.weight));
  // A phone-sized stage comes closer and names fewer cameos.
  const narrow = size.width < 520;
  const crowded = web.nodes.filter((node) => node.tier === "cameo").length > (narrow ? 10 : 28);
  useEffect(() => { camera.position.setLength(narrow ? 4.2 : 4.7); }, [camera, narrow]);

  useEffect(() => { scene.fog = new Fog("#0a141c", 4.2, 9); return () => { scene.fog = null; }; }, [scene]);
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement);
    orbit.target.set(0, 0.25, 0);
    orbit.enableDamping = true;
    orbit.dampingFactor = 0.08;
    orbit.minDistance = 1.2;
    orbit.maxDistance = 6;
    orbit.maxPolarAngle = Math.PI * 0.47;
    orbit.autoRotateSpeed = 0.35;
    controls.current = orbit;
    return () => orbit.dispose();
  }, [camera, gl]);
  useEffect(() => { if (controls.current) controls.current.autoRotate = !reducedMotion && !focus && selected.length === 0; }, [reducedMotion, focus, selected.length]);

  const curve = useMemo(() => new QuadraticBezierCurve3(new Vector3(), new Vector3(), new Vector3()), []);
  const scratch = useMemo(() => new Vector3(), []);
  const lit = (edge: WebEdge) => pairEdge ? edge.id === pairEdge : focus ? edge.a === focus || edge.b === focus : true;
  const tieCurve = (a: Vector3, b: Vector3) => {
    // Ties arc over the floor, bowed toward the heart, so crossings separate in depth.
    const mid = scratch.copy(a).add(b).multiplyScalar(0.5);
    const lift = 0.06 + 0.12 * a.distanceTo(b);
    curve.v0.copy(a);
    curve.v1.set(mid.x * 0.65, Math.max(a.y, b.y) + lift, mid.z * 0.65);
    curve.v2.copy(b);
    return curve;
  };

  useFrame((state, delta) => {
    controls.current?.update();
    // Exponential smoothing: every change glides, and a new target mid-glide just bends the path.
    const k = reducedMotion ? 1 : 1 - Math.exp(-delta * 5);
    for (const node of web.nodes) {
      const target = targets.get(node.id)!;
      const goal = new Vector3(target.x * SPREAD, target.y * SPREAD, target.z * SPREAD);
      const current = motion.current.get(node.id) ?? { position: goal.clone().multiplyScalar(1.25).setY(goal.y + 0.6), size: 0 };
      current.position.lerp(goal, k);
      // A chosen character stands a little larger.
      current.size += (target.r * SPREAD * 1.45 * (selected.includes(node.id) ? 1.25 : 1) - current.size) * k;
      motion.current.set(node.id, current);
      const sprite = sprites.current.get(node.id);
      if (sprite) { sprite.position.copy(current.position); sprite.scale.setScalar(Math.max(0.001, current.size)); }
    }
    for (const id of [...motion.current.keys()]) if (!targets.has(id)) motion.current.delete(id);
    for (const edge of web.edges) {
      const line = lines.current.get(edge.id), a = motion.current.get(edge.a), b = motion.current.get(edge.b);
      if (!line || !a || !b) continue;
      const points = tieCurve(a.position, b.position).getPoints(SEGMENTS);
      const attribute = line.geometry.getAttribute("position") as Float32BufferAttribute;
      points.forEach((point, index) => attribute.setXYZ(index, point.x, point.y, point.z));
      attribute.needsUpdate = true;
      line.geometry.computeBoundingSphere();
    }
    // The watched pair's tie carries a light from one to the other.
    const watched = pulse ? web.edges.find((edge) => edge.id === pulse) : undefined;
    if (bead.current) {
      const a = watched && motion.current.get(watched.a), b = watched && motion.current.get(watched.b);
      bead.current.visible = !!(a && b);
      if (a && b) bead.current.position.copy(tieCurve(a.position, b.position).getPoint((state.clock.elapsedTime * 0.45) % 1));
    }
    // Labels follow their discs on screen; names on a crowded outer ring wait to be in play.
    const half = { x: size.width / 2, y: size.height / 2 };
    for (const node of web.nodes) {
      const element = labels.current?.get(node.id), current = motion.current.get(node.id);
      if (!element || !current) continue;
      const projected = scratch.copy(current.position).setY(current.position.y - current.size * 0.55).project(camera);
      const near = !focus || node.id === focus || neighbours.get(focus)?.has(node.id);
      const named = !(node.tier === "cameo" && crowded) || selected.includes(node.id) || node.id === focus || !!(focus && neighbours.get(focus)?.has(node.id));
      const visible = projected.z < 1 && named;
      element.style.transform = `translate(-50%, 0) translate(${(projected.x * half.x + half.x).toFixed(1)}px, ${(-projected.y * half.y + half.y).toFixed(1)}px)`;
      // The far side of the bowl recedes: labels there fade with depth unless they are in play.
      const depth = Math.min(1, Math.max(0, (camera.position.distanceTo(current.position) - 2.6) / 2.4));
      const inPlay = node.id === focus || selected.includes(node.id) || node.tier === "protagonist";
      element.style.opacity = visible ? (near ? (inPlay ? "1" : (1 - 0.65 * depth).toFixed(2)) : "0.15") : "0";
    }
  });

  const pointer = (id: string | null) => (event: ThreeEvent<PointerEvent>) => { event.stopPropagation(); setHover(id); gl.domElement.style.cursor = id ? "pointer" : ""; };
  return (
    <>
      {TIERS.map((tier) => <TierRing key={tier} radius={RING_RADIUS[tier] * SPREAD} height={TIER_HEIGHT[tier] * SPREAD} tier={tier} />)}
      {web.edges.map((edge) => {
        const on = lit(edge);
        const opacity = focus || pairEdge ? (on ? 0.95 : 0.04) : 0.1 + 0.55 * (edge.weight / strongest) ** 0.5;
        return (
          <primitive key={edge.id} object={tieLine(lines.current, edge.id)}>
            <lineBasicMaterial attach="material" color={TONE_COLOR[edge.tone]} transparent opacity={opacity} depthWrite={false} />
          </primitive>
        );
      })}
      {web.nodes.map((node) => {
        const near = !focus || node.id === focus || neighbours.get(focus)?.has(node.id);
        const chosen = selected.includes(node.id);
        return (
          <sprite key={node.id} ref={(sprite) => { if (sprite) sprites.current.set(node.id, sprite); else sprites.current.delete(node.id); }}
            onPointerOver={pointer(node.id)} onPointerOut={pointer(null)}
            onClick={(event) => { event.stopPropagation(); onPick(node.id, event.shiftKey || event.metaKey); }}>
            <spriteMaterial attach="material" map={discTexture(node)} transparent opacity={near || chosen ? 1 : 0.25} depthWrite={false} />
          </sprite>
        );
      })}
      <sprite ref={bead} scale={0.07} visible={false}>
        <spriteMaterial attach="material" color="#fff3d0" transparent opacity={0.95} depthWrite={false} />
      </sprite>
    </>
  );
}

/** One line object per tie, kept across renders so the frame loop can move its points. */
function tieLine(store: Map<string, Line>, id: string): Line {
  let line = store.get(id);
  if (!line) {
    const geometry = new BufferGeometry();
    geometry.setAttribute("position", new Float32BufferAttribute(new Float32Array((SEGMENTS + 1) * 3), 3));
    line = new Line(geometry, new LineBasicMaterial());
    line.frustumCulled = false;
    store.set(id, line);
  }
  return line;
}

function TierRing({ radius, height, tier }: { radius: number; height: number; tier: Tier }) {
  const ring = useMemo(() => {
    const points: number[] = [];
    for (let index = 0; index <= 96; index++) {
      const angle = (index / 96) * Math.PI * 2;
      points.push(Math.cos(angle) * radius, height, Math.sin(angle) * radius);
    }
    const geometry = new BufferGeometry().setAttribute("position", new Float32BufferAttribute(points, 3));
    return new Line(geometry, new LineBasicMaterial({ color: TIER_COLOR[tier], transparent: true, opacity: tier === "protagonist" ? 0.35 : 0.16, depthWrite: false }));
  }, [radius, height, tier]);
  return <primitive object={ring} />;
}
