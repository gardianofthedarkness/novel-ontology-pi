import { useEffect, useMemo, useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, CircleGeometry, DoubleSide, Group, Line, LineDashedMaterial, Mesh, MeshBasicMaterial, Object3D, RingGeometry, SphereGeometry, TetrahedronGeometry, Vector3 } from "three";
import type { OrbitalDraw } from "../data/orbitalLayout";
import type { FacultyAnchor, FacultyEffect, FacultyFamily } from "../data/facultyEffects";
import { now } from "../data/orbitalMotion";
import type { LabelBus } from "./graphCamera";

/**
 * Live faculty animations in the orbital world (see data/facultyEffects.ts).
 * Each working faculty plays its own small effect on the sphere where its
 * block is being built; a chip above the sphere names who is working. All
 * of it is decoration: never raycast, never moves the camera. Under reduced
 * motion only the chips show.
 */
const noRaycast = () => undefined;
const COLOURS: Record<FacultyFamily, string> = { digger: "#5dcaa5", work: "#a59cff", assembly: "#85b7eb" };
const geometry = {
  ring: new RingGeometry(0.965, 1, 64),
  arc: (start: number, length: number) => new RingGeometry(0.94, 1, 24, 1, start, length),
  disk: new CircleGeometry(1, 48),
  bead: new SphereGeometry(1, 12, 8),
  shard: new TetrahedronGeometry(1),
};
const UP = new Vector3(0, 1, 0);

/** One effect: its objects and how they move with time t (seconds). */
function buildEffect({ kind, family }: FacultyEffect, radius: number): { root: Group; billboard?: Group; update: (t: number) => void; dispose: () => void } {
  const root = new Group();
  const materials: MeshBasicMaterial[] = [];
  const extras: { dispose: () => void }[] = [];
  const material = (opacity = 0.8) => {
    const value = new MeshBasicMaterial({ color: COLOURS[family], transparent: true, opacity, blending: AdditiveBlending, depthWrite: false, toneMapped: false, side: DoubleSide });
    materials.push(value);
    return value;
  };
  const mesh = (shape: BufferGeometry, parent: Object3D = root, opacity?: number) => {
    const value = new Mesh(shape, material(opacity));
    value.raycast = noRaycast;
    parent.add(value);
    return value;
  };
  const fade = (target: Mesh | Line, opacity: number) => { (target.material as MeshBasicMaterial).opacity = Math.max(0, opacity); };
  const phase = (t: number, period: number, offset = 0) => ((t + offset) % period) / period;
  const r = radius;
  let update: (t: number) => void = () => undefined;
  let billboard: Group | undefined;
  switch (kind) {
    case "voice": {
      // Voice ripples leaving the scene sideways.
      billboard = new Group(); root.add(billboard);
      const arcs = [0, 1, 2].map(() => { const shape = geometry.arc(-0.55, 1.1); extras.push(shape); return mesh(shape, billboard); });
      update = (t) => arcs.forEach((arc, index) => { const p = phase(t, 1.2, index * 0.4); arc.scale.setScalar(r * (1.12 + 0.55 * p)); fade(arc, 0.85 * Math.sin(Math.PI * p)); });
      break;
    }
    case "quote-open": case "quote-close": {
      // Opening or closing quote arc beside the scene.
      billboard = new Group(); root.add(billboard);
      const shape = kind === "quote-open" ? geometry.arc(Math.PI - 0.75, 1.5) : geometry.arc(-0.75, 1.5);
      extras.push(shape);
      const arc = mesh(shape, billboard);
      update = (t) => { const p = phase(t, 1.6); arc.scale.setScalar(r * 1.22); fade(arc, 0.9 * Math.sin(Math.PI * Math.min(1, p * 1.4))); };
      break;
    }
    case "gate-front": case "gate-back": {
      // A gate flashing at the scene's front or back edge (along time, x).
      const shape = new RingGeometry(0.9, 1, 48);
      extras.push(shape);
      const gate = mesh(shape);
      gate.rotation.y = Math.PI / 2;
      gate.position.x = (kind === "gate-front" ? -1 : 1) * r * 1.06;
      gate.scale.setScalar(r * 0.92);
      update = (t) => fade(gate, 0.9 * Math.sin(Math.PI * phase(t, 1.6)) ** 2);
      break;
    }
    case "seam": {
      // A dashed stitch running around the scene, across time.
      const points = Array.from({ length: 65 }, (_, index) => new Vector3(0, Math.cos(index / 64 * Math.PI * 2), Math.sin(index / 64 * Math.PI * 2)));
      const line = new Line(new BufferGeometry().setFromPoints(points), new LineDashedMaterial({ color: COLOURS[family], dashSize: 0.12, gapSize: 0.1, transparent: true, depthWrite: false, toneMapped: false }));
      line.computeLineDistances();
      line.raycast = noRaycast;
      line.scale.setScalar(r * 1.03);
      root.add(line);
      extras.push(line.geometry, line.material as LineDashedMaterial);
      update = (t) => { line.rotation.x = t * 0.9; fade(line, 0.45 + 0.45 * Math.sin(t * 4.4)); };
      break;
    }
    case "birth": {
      // A seed buds off the surface and floats free.
      const seed = mesh(geometry.bead);
      const direction = new Vector3(0.55, 0.75, 0.35).normalize();
      update = (t) => { const p = phase(t, 1.8); seed.position.copy(direction).multiplyScalar(r * (1 + 0.8 * p)); seed.scale.setScalar(r * (0.04 + 0.12 * Math.min(1, p * 2))); fade(seed, p < 0.7 ? 0.9 : 0.9 * (1 - (p - 0.7) / 0.3)); };
      break;
    }
    case "fragment": {
      // Small shards split off and drift.
      const directions = [new Vector3(1, 0.4, 0.2), new Vector3(0.8, -0.5, -0.4), new Vector3(0.3, 0.9, -0.5)].map((value) => value.normalize());
      const shards = directions.map(() => mesh(geometry.shard));
      update = (t) => shards.forEach((shard, index) => { const p = phase(t, 1.5, index * 0.2); shard.position.copy(directions[index]).multiplyScalar(r * (1.02 + 0.7 * p)); shard.rotation.set(t * 2 + index, t * 3, 0); shard.scale.setScalar(r * 0.11); fade(shard, 0.9 * (1 - p)); });
      break;
    }
    case "orbit": {
      // A bead circling slowly: weighing who spoke.
      const ring = mesh(geometry.ring, root, 0.35);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(r * 1.7);
      const bead = mesh(geometry.bead, root, 0.95);
      bead.scale.setScalar(r * 0.08);
      update = (t) => { const angle = t * 2.1; bead.position.set(Math.cos(angle) * r * 1.7, 0, Math.sin(angle) * r * 1.7); };
      break;
    }
    case "scales": {
      // A ring tilting like scales: deciding.
      const pivot = new Group(); root.add(pivot);
      const ring = mesh(geometry.ring, pivot, 0.75);
      ring.rotation.x = -Math.PI / 2;
      ring.scale.setScalar(r * 1.6);
      update = (t) => { pivot.rotation.z = 0.26 * Math.sin(t * 2.4); pivot.rotation.x = 0.1 * Math.sin(t * 1.3); };
      break;
    }
    case "stack": {
      // Rings stacking upward: building the exchange.
      const rings = [-0.6, 0, 0.6].map((height) => { const ring = mesh(geometry.ring); ring.rotation.x = -Math.PI / 2; ring.position.y = height * r; ring.scale.setScalar(r * Math.sqrt(1 - height * height) * 1.18); return ring; });
      update = (t) => { const p = phase(t, 2.4); rings.forEach((ring, index) => fade(ring, 0.85 * Math.max(0, Math.sin(Math.PI * Math.min(1, Math.max(0, p * 2.2 - index * 0.45)))))); };
      break;
    }
    case "ripple": {
      // Ground ripples gathering who is present.
      const rings = [0, 1].map(() => { const ring = mesh(geometry.ring); ring.rotation.x = -Math.PI / 2; ring.position.y = -r * 1.25; return ring; });
      update = (t) => rings.forEach((ring, index) => { const p = phase(t, 2, index); ring.scale.setScalar(r * (0.3 + 1.9 * p)); fade(ring, 0.7 * (1 - p)); });
      break;
    }
    case "scan": {
      // A reading band scanning the scene from top to bottom.
      const band = mesh(geometry.disk, root, 0.32);
      band.rotation.x = -Math.PI / 2;
      update = (t) => { const p = phase(t, 2.6); const y = r * (0.95 - 1.9 * p); band.position.y = y; band.scale.setScalar(Math.sqrt(Math.max(0, r * r - y * y)) * 1.02 + 0.001); };
      break;
    }
    case "assembly": {
      // Threads drawing inward as the draft assembles.
      const directions = [new Vector3(-1, 0.6, 0.4), new Vector3(1, 0.6, -0.3), new Vector3(-0.7, -0.6, -0.5), new Vector3(0.8, -0.5, 0.6)].map((value) => value.normalize());
      const beads = directions.map(() => mesh(geometry.bead));
      update = (t) => beads.forEach((bead, index) => { const p = phase(t, 1.4, index * 0.35); bead.position.copy(directions[index]).multiplyScalar(r * (2.6 - 1.55 * p)); bead.scale.setScalar(r * 0.05); fade(bead, 0.9 * Math.sin(Math.PI * p)); });
      break;
    }
    default: {
      // Unknown faculty: a soft working glow.
      const shell = mesh(geometry.bead, root, 0.12);
      shell.scale.setScalar(r * 1.08);
      update = (t) => fade(shell, 0.08 + 0.1 * Math.sin(t * 3) ** 2);
    }
  }
  return { root, billboard, update, dispose: () => { materials.forEach((value) => value.dispose()); extras.forEach((value) => value.dispose()); } };
}

function AnchorEffects({ anchor, draw, bus }: { anchor: FacultyAnchor; draw: OrbitalDraw; bus: LabelBus }) {
  const group = useRef<Group>(null);
  const { camera } = useThree();
  const key = anchor.effects.map((effect) => effect.faculty).join("|");
  const effects = useMemo(() => anchor.effects.map((effect) => buildEffect(effect, draw.radius)), [key, draw.radius]);
  useEffect(() => () => effects.forEach((effect) => effect.dispose()), [effects]);
  useFrame(() => {
    if (!group.current) return;
    group.current.position.set(...(bus.positions.get(anchor.id) ?? draw.position));
    const t = now();
    for (const effect of effects) {
      effect.billboard?.quaternion.copy(camera.quaternion);
      effect.update(t);
    }
  });
  return <group ref={group}>{effects.map((effect, index) => <primitive key={index} object={effect.root} />)}</group>;
}

/** Keeps each faculty chip above its sphere on screen. */
function ChipTracker({ anchors, draws, bus }: { anchors: FacultyAnchor[]; draws: Map<string, OrbitalDraw>; bus: LabelBus }) {
  const { camera, size } = useThree();
  useFrame(() => {
    for (const anchor of anchors) {
      const chip = document.querySelector<HTMLElement>(`[data-faculty-anchor="${CSS.escape(anchor.id)}"]`);
      const draw = draws.get(anchor.id);
      if (!chip || !draw) continue;
      const centre = new Vector3(...(bus.positions.get(anchor.id) ?? draw.position));
      const top = centre.clone().addScaledVector(UP.clone().applyQuaternion(camera.quaternion), draw.radius * 1.35).project(camera);
      const visible = top.z < 1 && Math.abs(top.x) < 1.1 && Math.abs(top.y) < 1.1;
      chip.style.visibility = visible ? "visible" : "hidden";
      if (visible) chip.style.transform = `translate(${(top.x * 0.5 + 0.5) * size.width}px, ${(-top.y * 0.5 + 0.5) * size.height}px) translate(-50%, -100%)`;
    }
  });
  return null;
}

export function FacultyEffects({ anchors, draws, bus, reducedMotion }: { anchors: FacultyAnchor[]; draws: OrbitalDraw[]; bus: LabelBus; reducedMotion: boolean }) {
  const byId = useMemo(() => new Map(draws.map((draw) => [draw.node.id, draw])), [draws]);
  return <>
    <ChipTracker anchors={anchors} draws={byId} bus={bus} />
    {!reducedMotion && anchors.map((anchor) => { const draw = byId.get(anchor.id); return draw ? <AnchorEffects key={anchor.id} anchor={anchor} draw={draw} bus={bus} /> : null; })}
  </>;
}
