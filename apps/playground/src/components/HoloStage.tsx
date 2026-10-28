import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { AdditiveBlending, BufferGeometry, DoubleSide, Float32BufferAttribute, Group, Line, LineBasicMaterial, Mesh, MeshBasicMaterial, QuadraticBezierCurve3, TubeGeometry, Vector3, type PerspectiveCamera } from "three";
import { ArchitectureHolograms } from "./ArchitectureHolograms";
import { ARCHITECTURE_LABEL } from "../data/placeArchitecture";
import type { FloorMark } from "../data/orbitalTimePlace";
import type { HoloActor, HoloBeat, HoloScript } from "../data/holoScript";
import "../holo.css";

/**
 * Holo stage (places phase 2, exploration): a place replayed like a game.
 * Diorama — a holotable around the building, the cast as pawns walking to
 * where each event happens, speech over the speaker, conflicts flashing red.
 * Cutscene — the same moment from eye level, letterboxed, with a visual-novel
 * dialogue box. Journey — every place on one table, the cast travelling
 * between buildings scene by scene. HUD: party roster, quest log, replay
 * timeline. View only: nothing here writes to the archive.
 */
export type HoloMode = "diorama" | "cutscene" | "journey";
interface Props {
  script: HoloScript; mode: HoloMode; reducedMotion: boolean;
  onMode: (mode: HoloMode) => void; onClose: () => void;
  /** Journey: open a place's own stage. */
  onEnterPlace?: (placeId: string) => void;
  initialBeat?: number;
  /** Start playing on open (off for still frames). */
  autoplay?: boolean;
}

const FLOOR = -944;
const SPOT = new Vector3(0, FLOOR, 215);
/** Where a place's own building stands on its stage. */
const BUILDING = new Vector3(0, FLOOR, -40);
const MAX_TOKENS = 10;
const GLYPH: Record<HoloBeat["kind"], string> = { scene: "◇", event: "◆", dialogue: "❝", travel: "➝" };
/** Crossed swords, drawn (the ⚔ character is missing from many fonts). */
const Clash = () => <svg className="holo-clash" viewBox="0 0 16 16" aria-hidden="true"><path d="M2.5 2.5l11 11M13.5 2.5l-11 11M9.6 13.4l3.8-3.8M2.6 9.6l3.8 3.8M2.5 2.5h2.6M2.5 2.5v2.6M13.5 2.5h-2.6M13.5 2.5v2.6" stroke="currentColor" strokeWidth="1.7" fill="none" strokeLinecap="round" /></svg>;

interface Target { position: Vector3; visible: boolean; active: boolean; speaking: boolean; hop: boolean }
/** Shared between React (what each beat wants) and the frame loop (where things are). */
interface Bus {
  targets: Map<string, Target>; positions: Map<string, Vector3>; anchors: Map<string, HTMLElement>;
  places: Map<string, Vector3>; pulse: { at: number; conflict: boolean; position: Vector3; armed: boolean }; clash: string[];
  focus: { speaker: string | null; listener: string | null }; drag: number;
  /** Journey bursts cover a whole building. */
  pulseScale: number;
}

const duration = (beat: HoloBeat) => beat.kind === "scene" ? 2600 : beat.kind === "travel" ? 2400 : Math.min(7000, Math.max(2400, 1600 + [...(beat.quote ?? beat.text)].length * 45));

/** Where everyone stands for a beat. */
function stagePositions(script: HoloScript, beat: HoloBeat, mode: HoloMode, cast: HoloActor[]): Map<string, Target> {
  const targets = new Map<string, Target>();
  if (mode === "journey") {
    // Everyone at the last place they were seen, in a small ring around its building.
    const at = new Map<string, string>();
    for (const entry of script.beats.slice(0, script.beats.indexOf(beat) + 1)) for (const id of entry.present) at.set(id, entry.placeId);
    const crowd = new Map<string, number>();
    for (const actor of cast) {
      const placeId = at.get(actor.id);
      const place = placeId ? script.places.find((entry) => entry.id === placeId) : undefined;
      if (!place) { targets.set(actor.id, { position: new Vector3(0, FLOOR, 0), visible: false, active: false, speaking: false, hop: false }); continue; }
      const slot = crowd.get(place.id) ?? 0; crowd.set(place.id, slot + 1);
      const angle = Math.PI * 0.25 + slot * 0.62, ring = 118 + 20 * Math.floor(slot / 8);
      targets.set(actor.id, { position: new Vector3(place.x + Math.cos(angle) * ring, FLOOR, place.z + Math.sin(angle) * ring), visible: true, active: beat.actors.includes(actor.id), speaking: false, hop: beat.kind === "travel" && beat.actors.includes(actor.id) });
    }
    return targets;
  }
  const standby = cast.filter((actor) => beat.present.includes(actor.id) && !beat.actors.includes(actor.id));
  const acting = beat.kind === "scene" ? [] : beat.actors.filter((id) => cast.some((actor) => actor.id === id));
  // Standing by: an arc in front of the building.
  standby.forEach((actor, index) => {
    const angle = Math.PI * (0.18 + 0.64 * (standby.length === 1 ? 0.5 : index / (standby.length - 1)));
    targets.set(actor.id, { position: new Vector3(Math.cos(angle) * 330, FLOOR, 60 + Math.sin(angle) * 250), visible: true, active: false, speaking: false, hop: false });
  });
  if (beat.kind === "scene") {
    const everyone = cast.filter((actor) => beat.present.includes(actor.id));
    everyone.forEach((actor, index) => {
      const angle = Math.PI * (0.22 + 0.56 * (everyone.length === 1 ? 0.5 : index / (everyone.length - 1)));
      targets.set(actor.id, { position: new Vector3(Math.cos(angle) * 250, FLOOR, 40 + Math.sin(angle) * 230), visible: true, active: false, speaking: false, hop: false });
    });
  }
  // A conflict: the first two face off across the spot, anyone else behind them.
  if (beat.conflict && acting.length >= 2) {
    acting.forEach((id, index) => {
      const position = index < 2 ? new Vector3(SPOT.x + (index ? 78 : -78), FLOOR, SPOT.z + (index ? -10 : 10)) : new Vector3(SPOT.x + (index - 2.5) * 46, FLOOR, SPOT.z - 92);
      targets.set(id, { position, visible: true, active: true, speaking: false, hop: false });
    });
    for (const actor of cast) if (!targets.has(actor.id)) targets.set(actor.id, { position: new Vector3(0, FLOOR, -380), visible: false, active: false, speaking: false, hop: false });
    return targets;
  }
  // Acting: gathered at the spot, the speaker (first) in front.
  acting.forEach((id, index) => {
    const angle = index === 0 ? Math.PI / 2 : Math.PI * (1.25 + (index - 1) * 0.5 / Math.max(1, acting.length - 1)) - (acting.length === 2 ? Math.PI * 0.25 : 0);
    const radius = index === 0 ? 34 : 62;
    targets.set(id, { position: new Vector3(SPOT.x + Math.cos(angle) * radius, FLOOR, SPOT.z + Math.sin(angle) * radius * 0.7), visible: true, active: true, speaking: beat.kind === "dialogue" && index === 0, hop: false });
  });
  for (const actor of cast) if (!targets.has(actor.id)) targets.set(actor.id, { position: new Vector3(Math.cos(actor.label.length) * 520, FLOOR, -380), visible: false, active: false, speaking: false, hop: false });
  return targets;
}

function Token({ actor, bus, reducedMotion }: { actor: HoloActor; bus: Bus; reducedMotion: boolean }) {
  const group = useRef<Group>(null), marker = useRef<Mesh>(null), halo = useRef<Mesh>(null);
  const start = useRef<{ from: Vector3; span: number } | null>(null);
  const lastTarget = useRef<Vector3 | null>(null);
  useFrame(({ clock }, delta) => {
    const target = bus.targets.get(actor.id), node = group.current;
    if (!target || !node) return;
    if (lastTarget.current !== target.position) { lastTarget.current = target.position; start.current = { from: node.position.clone().setY(FLOOR), span: Math.max(1, node.position.clone().setY(FLOOR).distanceTo(target.position)) }; }
    const step = reducedMotion ? 1 : 1 - Math.exp(-delta * (target.hop ? 1.6 : 3.2));
    const ground = new Vector3(node.position.x, FLOOR, node.position.z).lerp(target.position, step);
    const left = ground.distanceTo(target.position) / (start.current?.span ?? 1);
    const hop = target.hop && !reducedMotion ? Math.sin(Math.PI * Math.min(1, Math.max(0, 1 - left))) * Math.min(160, (start.current?.span ?? 0) * 0.35) : 0;
    node.position.set(ground.x, FLOOR + hop, ground.z);
    const shown = node.scale.x + ((target.visible ? 1 : 0.001) - node.scale.x) * (reducedMotion ? 1 : Math.min(1, delta * 5));
    node.scale.setScalar(Math.max(0.001, shown));
    bus.positions.set(actor.id, node.position);
    const time = clock.getElapsedTime();
    if (marker.current) { marker.current.visible = target.active; marker.current.rotation.y = time * 2; marker.current.position.y = 44 + Math.sin(time * 3) * 2.5; }
    if (halo.current) { const pulse = target.speaking && !reducedMotion ? (time * 1.4) % 1 : 0; halo.current.visible = target.speaking; halo.current.scale.setScalar(1 + pulse * 2.4); (halo.current.material as MeshBasicMaterial).opacity = 0.7 * (1 - pulse); }
  });
  const additive = { transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false } as const;
  return <group ref={group} position={[0, FLOOR, -600]} scale={0.001}>
    <mesh rotation-x={-Math.PI / 2} position-y={0.8}><ringGeometry args={[10, 13.5, 40]} /><meshBasicMaterial color={actor.color} opacity={0.95} side={DoubleSide} {...additive} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position-y={0.6}><circleGeometry args={[10, 32]} /><meshBasicMaterial color={actor.color} opacity={0.18} {...additive} /></mesh>
    <mesh ref={halo} rotation-x={-Math.PI / 2} position-y={1}><ringGeometry args={[13, 15, 40]} /><meshBasicMaterial color={actor.color} opacity={0.6} side={DoubleSide} {...additive} /></mesh>
    <mesh position-y={11}><cylinderGeometry args={[4.2, 8.5, 20, 16]} /><meshBasicMaterial color={actor.color} opacity={0.55} {...additive} /></mesh>
    <mesh position-y={25.5}><sphereGeometry args={[5.6, 20, 14]} /><meshBasicMaterial color={actor.color} opacity={0.9} {...additive} /></mesh>
    <mesh position-y={60}><cylinderGeometry args={[0.5, 0.5, 120, 6]} /><meshBasicMaterial color={actor.color} opacity={0.12} {...additive} /></mesh>
    <mesh ref={marker} position-y={44}><octahedronGeometry args={[4.6]} /><meshBasicMaterial color="#fff6c8" wireframe opacity={0.95} {...additive} /></mesh>
  </group>;
}

/** The holotable: rings, spokes and a soft edge glow. */
function Table({ radius }: { radius: number }) {
  const lines = useMemo(() => {
    const points: number[] = [];
    for (const ring of [0.35, 0.6, 0.82, 1]) for (let index = 0; index < 96; index++) {
      const a = (index / 96) * Math.PI * 2, b = ((index + 1) / 96) * Math.PI * 2;
      points.push(Math.cos(a) * radius * ring, 0, Math.sin(a) * radius * ring, Math.cos(b) * radius * ring, 0, Math.sin(b) * radius * ring);
    }
    for (let index = 0; index < 24; index++) { const a = (index / 24) * Math.PI * 2; points.push(Math.cos(a) * radius * 0.35, 0, Math.sin(a) * radius * 0.35, Math.cos(a) * radius, 0, Math.sin(a) * radius); }
    return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(points, 3));
  }, [radius]);
  return <group position={[0, FLOOR - 0.5, 0]}>
    <lineSegments geometry={lines}><lineBasicMaterial color="#2c6f99" transparent opacity={0.35} depthWrite={false} /></lineSegments>
    <mesh rotation-x={-Math.PI / 2}><circleGeometry args={[radius, 96]} /><meshBasicMaterial color="#0b2a44" transparent opacity={0.55} depthWrite={false} /></mesh>
    <mesh rotation-x={-Math.PI / 2} position-y={0.3}><ringGeometry args={[radius * 0.985, radius * 1.03, 128]} /><meshBasicMaterial color="#7cc8ff" transparent opacity={0.75} blending={AdditiveBlending} depthWrite={false} side={DoubleSide} /></mesh>
  </group>;
}

/** The ring that bursts where an event happens (red for a conflict), and the arc between two people in a clash. */
function Effects({ bus, reducedMotion }: { bus: Bus; reducedMotion: boolean }) {
  const ring = useRef<Mesh>(null);
  const bolt = useMemo(() => { const line = new Line(new BufferGeometry().setAttribute("position", new Float32BufferAttribute(new Array(16 * 3).fill(0), 3)), new LineBasicMaterial({ color: "#ff5a6e", transparent: true, blending: AdditiveBlending, depthWrite: false, toneMapped: false })); line.frustumCulled = false; return line; }, []);
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime() * 1000;
    if (ring.current) {
      const age = (time - bus.pulse.at) / 1300, shown = age >= 0 && age < 1 && !reducedMotion;
      ring.current.visible = shown;
      if (shown) { ring.current.position.copy(bus.pulse.position).setY(FLOOR + 1.5); ring.current.scale.setScalar(((bus.pulse.conflict ? 40 : 26) + age * (bus.pulse.conflict ? 150 : 90)) * bus.pulseScale); const material = ring.current.material as MeshBasicMaterial; material.opacity = 0.85 * (1 - age); material.color.set(bus.pulse.conflict ? "#ff5a6e" : "#7ce6ff"); }
    }
    const [first, second] = bus.clash.map((id) => bus.positions.get(id));
    bolt.visible = !!first && !!second;
    if (first && second) {
      const position = bolt.geometry.getAttribute("position");
      for (let index = 0; index < 16; index++) {
        const along = index / 15, jitter = index === 0 || index === 15 || reducedMotion ? 0 : (Math.sin(time * 0.05 + index * 7.1) * 0.5 + Math.sin(time * 0.031 + index * 3.3) * 0.5) * 9;
        position.setXYZ(index, first.x + (second.x - first.x) * along + jitter, FLOOR + 22 + Math.sin(Math.PI * along) * 14 + jitter * 0.6, first.z + (second.z - first.z) * along - jitter);
      }
      position.needsUpdate = true;
      (bolt.material as LineBasicMaterial).opacity = reducedMotion ? 0.8 : 0.55 + 0.45 * Math.abs(Math.sin(time * 0.02));
    }
  });
  return <><mesh ref={ring} rotation-x={-Math.PI / 2} visible={false}><ringGeometry args={[0.92, 1, 64]} /><meshBasicMaterial transparent blending={AdditiveBlending} depthWrite={false} side={DoubleSide} toneMapped={false} /></mesh><primitive object={bolt} /></>;
}

/** Glowing arcs of the trips so far (journey), newest brightest. */
function Trails({ script, beatIndex, colors }: { script: HoloScript; beatIndex: number; colors: Map<string, string> }) {
  const trips = useMemo(() => script.beats.slice(0, beatIndex + 1).filter((beat) => beat.kind === "travel").slice(-14), [script, beatIndex]);
  const lines = useMemo(() => trips.flatMap((beat, order) => {
    const from = script.places.find((place) => place.id === beat.from), to = script.places.find((place) => place.id === beat.placeId);
    if (!from || !to) return [];
    const a = new Vector3(from.x, FLOOR + 2, from.z), b = new Vector3(to.x, FLOOR + 2, to.z);
    const curve = new QuadraticBezierCurve3(a, a.clone().lerp(b, 0.5).setY(FLOOR + 40 + a.distanceTo(b) * 0.22), b);
    const recent = (order + 1) / trips.length;
    return [new Mesh(new TubeGeometry(curve, 48, 1.6 + 2.6 * recent, 6), new MeshBasicMaterial({ color: colors.get(beat.actors[0]) ?? "#ffd36b", transparent: true, opacity: 0.18 + 0.62 * recent, blending: AdditiveBlending, depthWrite: false, toneMapped: false }))];
  }), [trips, script, colors]);
  useEffect(() => () => { for (const line of lines) { line.geometry.dispose(); (line.material as MeshBasicMaterial).dispose(); } }, [lines]);
  return <>{lines.map((line, index) => <primitive key={index} object={line} />)}</>;
}

/** Camera per mode: a slow orbit over the table, eye level behind the listener, or high over the journey map. */
function Rig({ bus, mode, extent, reducedMotion }: { bus: Bus; mode: HoloMode; extent: number; reducedMotion: boolean }) {
  const target = useMemo(() => new Vector3(0, FLOOR + 60, 80), []), desired = useMemo(() => new Vector3(), []), look = useMemo(() => new Vector3(), []);
  useFrame(({ camera, clock }, delta) => {
    const time = clock.getElapsedTime(), orbit = (reducedMotion ? 0 : time * 0.035) + bus.drag;
    // A tall (phone) screen sees less sideways: step back, and frame the subject in the middle.
    const aspect = (camera as PerspectiveCamera).aspect || 1.6, back = Math.min(2.2, Math.max(1, 1.25 / aspect)), portrait = aspect < 1;
    if (mode === "cutscene") {
      // Establishing shot: low, behind and beside the speaker, the building rising behind them.
      const speaker = bus.focus.speaker ? bus.positions.get(bus.focus.speaker) : undefined;
      const subject = speaker ?? SPOT;
      const away = new Vector3(subject.x - BUILDING.x, 0, subject.z - BUILDING.z);
      const from = away.lengthSq() > 1 ? away.normalize() : new Vector3(0.3, 0, 1).normalize();
      const side = new Vector3(-from.z, 0, from.x).multiplyScalar(portrait ? 0 : 85);
      desired.set(subject.x + from.x * 280 * back + side.x, FLOOR + 40, subject.z + from.z * 280 * back + side.z);
      look.set(subject.x + (BUILDING.x - subject.x) * 0.4 + side.x * 0.45, FLOOR + 50, subject.z + (BUILDING.z - subject.z) * 0.4 + side.z * 0.45);
    } else if (mode === "journey") {
      look.set(0, FLOOR, 0);
      desired.set(Math.sin(orbit) * extent * 0.95 * back, FLOOR + extent * 0.78 * back, Math.cos(orbit) * extent * 0.95 * back);
    } else {
      look.set(0, FLOOR + 70, 90);
      desired.set(Math.sin(orbit * 2 + 0.35) * 640 * back, FLOOR + 380 * back, Math.cos(orbit * 2 + 0.35) * 640 * back + 120);
    }
    const ease = reducedMotion ? 1 : 1 - Math.exp(-delta * 2.2);
    camera.position.lerp(desired, ease);
    target.lerp(look, ease);
    camera.lookAt(target);
  });
  return null;
}

/** Pins HTML (name plates, speech, place labels) to points in the scene. */
function Anchors({ bus }: { bus: Bus }) {
  const point = useMemo(() => new Vector3(), []);
  useFrame(({ camera, size }) => {
    for (const [key, element] of bus.anchors) {
      const [kind, id] = [key.slice(0, key.indexOf(":")), key.slice(key.indexOf(":") + 1)];
      const at = kind === "actor" || kind === "bubble" ? bus.positions.get(id) : kind === "place" ? bus.places.get(id) : kind === "spot" ? bus.pulse.position : undefined;
      if (!at) { element.style.opacity = "0"; continue; }
      point.copy(at); point.y += Number(element.dataset.lift ?? 0); point.project(camera);
      const hidden = point.z > 1 || (kind === "actor" && (bus.targets.get(id)?.visible === false));
      element.style.opacity = hidden ? "0" : "";
      // Cards and bubbles stay on screen; name plates may follow their pawn off the edge.
      const half = kind === "actor" ? 0 : ((element.firstElementChild as HTMLElement | null)?.offsetWidth ?? 0) / 2 + 8;
      const x = Math.min(size.width - half, Math.max(half, ((point.x + 1) / 2) * size.width));
      element.style.transform = `translate(${x}px, ${((1 - point.y) / 2) * size.height}px)`;
    }
  });
  return null;
}

/** Text appearing at ~30 characters a second, by the clock (a slow frame never slows the reading). */
function useTypewriter(text: string, key: string, instant: boolean) {
  const [shown, setShown] = useState(0);
  const length = [...text].length;
  useEffect(() => {
    setShown(instant ? length : 0);
    if (instant) return;
    const start = performance.now();
    const timer = setInterval(() => { const count = Math.min(length, Math.floor((performance.now() - start) / 32)); setShown(count); if (count >= length) clearInterval(timer); }, 40);
    return () => clearInterval(timer);
  }, [length, key, instant]);
  return [...text].slice(0, shown).join("");
}

export function HoloStage({ script, mode, reducedMotion, onMode, onClose, onEnterPlace, initialBeat = 0, autoplay = true }: Props) {
  const [index, setIndex] = useState(() => Math.min(Math.max(0, initialBeat), Math.max(0, script.beats.length - 1)));
  const [playing, setPlaying] = useState(autoplay && !reducedMotion);
  const [speed, setSpeed] = useState(1);
  const beat = script.beats[index];
  const cast = useMemo(() => script.actors.slice(0, MAX_TOKENS), [script]);
  const colors = useMemo(() => new Map(script.actors.map((actor) => [actor.id, actor.color])), [script]);
  const label = (id: string) => script.actors.find((actor) => actor.id === id)?.label ?? id;
  const bus = useRef<Bus>({ targets: new Map(), positions: new Map(), anchors: new Map(), places: new Map(), pulse: { at: -1e9, conflict: false, position: SPOT.clone(), armed: false }, clash: [], focus: { speaker: null, listener: null }, drag: 0, pulseScale: 1 }).current;
  const journey = mode === "journey";
  const extent = useMemo(() => Math.max(600, ...script.places.map((place) => Math.hypot(place.x, place.z) + 220)), [script]);

  useEffect(() => { setIndex((current) => Math.min(current, Math.max(0, script.beats.length - 1))); }, [script]);
  // What this beat asks of the stage.
  useEffect(() => {
    if (!beat) return;
    bus.targets = stagePositions(script, beat, mode, cast);
    bus.places = new Map(script.places.map((place) => [place.id, new Vector3(place.x, FLOOR, place.z)]));
    const where = journey ? bus.places.get(beat.placeId) ?? SPOT : SPOT;
    // The burst starts on the frame clock (PulseClock), where the rings are drawn.
    bus.pulse = { ...bus.pulse, conflict: beat.conflict, position: where.clone(), armed: beat.kind === "event" || beat.kind === "dialogue" || (journey && beat.kind !== "travel") };
    bus.clash = beat.conflict && beat.actors.length >= 2 && !journey ? beat.actors.slice(0, 2) : [];
    bus.pulseScale = journey ? 3.2 : 1;
    bus.focus = { speaker: beat.actors[0] ?? null, listener: beat.actors[1] ?? beat.present.find((id) => id !== beat.actors[0]) ?? null };
  }, [beat, script, mode, cast, journey, bus]);

  useEffect(() => {
    if (!playing || !beat) return;
    if (index >= script.beats.length - 1) { setPlaying(false); return; }
    const timer = setTimeout(() => setIndex((current) => current + 1), duration(beat) / speed);
    return () => clearTimeout(timer);
  }, [playing, index, beat, speed, script.beats.length]);

  useEffect(() => {
    const key = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
      else if (event.key === " ") { event.preventDefault(); setPlaying((value) => !value); }
      else if (event.key === "ArrowRight") setIndex((current) => Math.min(script.beats.length - 1, current + 1));
      else if (event.key === "ArrowLeft") setIndex((current) => Math.max(0, current - 1));
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [onClose, script.beats.length]);

  const speech = beat?.kind === "dialogue" ? beat.quote ?? beat.text : "";
  const typed = useTypewriter(mode === "cutscene" ? (beat?.quote ?? beat?.text ?? "") : speech, beat?.id ?? "", reducedMotion);
  const anchor = (key: string, lift: number) => (element: HTMLElement | null) => { if (element) { element.dataset.lift = String(lift); bus.anchors.set(key, element); } else bus.anchors.delete(key); };
  const sceneBeats = script.beats.filter((entry) => entry.kind === "scene").length;
  const place = journey ? script.places.find((entry) => entry.id === beat?.placeId) : script.places[0];
  const logStart = Math.max(0, Math.min(index - 4, script.beats.length - 11));
  const dragFrom = useRef<number | null>(null);

  if (!beat) return <div className="holo" role="dialog" aria-label="Holo stage"><div className="holo-empty"><p>No scene here has records loaded yet.</p><button onClick={onClose}>Close</button></div></div>;
  const kindLabel = place?.kind ? ARCHITECTURE_LABEL[place.kind] : "Place";
  return <div className={`holo holo-${mode}`} role="dialog" aria-label={`Holo stage: ${script.title}`}>
    <div className="holo-canvas" onPointerDown={(event) => { dragFrom.current = event.clientX; }} onPointerMove={(event) => { if (dragFrom.current !== null && mode !== "cutscene") { bus.drag += (event.clientX - dragFrom.current) * -0.004; dragFrom.current = event.clientX; } }} onPointerUp={() => { dragFrom.current = null; }} onPointerLeave={() => { dragFrom.current = null; }}>
      <Canvas camera={{ position: [0, FLOOR + 900, 1400], fov: mode === "cutscene" ? 46 : 42, near: 1, far: 20000 }} dpr={[1, 2]} gl={{ antialias: true, preserveDrawingBuffer: true }}>
        <color attach="background" args={["#040a13"]} />
        <fog attach="fog" args={["#040a13", journey ? extent * 1.4 : 900, journey ? extent * 3.2 : 2600]} />
        <Table radius={journey ? extent : 470} />
        <ArchitectureHolograms reducedMotion={reducedMotion} marks={journey
          ? script.places.map((entry): FloorMark => ({ id: entry.id, x: entry.x, z: entry.z, radius: 70 + Math.min(70, entry.scenes * 4), active: entry.id === beat.placeId || script.beats.slice(Math.max(0, index - 6), index + 1).some((recent) => recent.placeId === entry.id), architecture: entry.kind ?? undefined, spotX: entry.x, spotZ: entry.z }))
          : [{ id: `stage:${script.places[0]?.id}`, x: BUILDING.x, z: BUILDING.z, radius: 250, active: true, architecture: script.places[0]?.kind ?? undefined, spotX: BUILDING.x, spotZ: BUILDING.z }]} />
        {!journey && <mesh rotation-x={-Math.PI / 2} position={[SPOT.x, FLOOR + 0.6, SPOT.z]}><ringGeometry args={[78, 80, 64]} /><meshBasicMaterial color={beat.conflict ? "#ff5a6e" : "#7ce6ff"} transparent opacity={beat.kind === "scene" ? 0.15 : 0.45} blending={AdditiveBlending} depthWrite={false} /></mesh>}
        {cast.map((actor) => <Token key={actor.id} actor={actor} bus={bus} reducedMotion={reducedMotion} />)}
        <Effects bus={bus} reducedMotion={reducedMotion} />
        <PulseClock bus={bus} />
        {journey && <Trails script={script} beatIndex={index} colors={colors} />}
        <Rig bus={bus} mode={mode} extent={extent} reducedMotion={reducedMotion} />
        <Anchors bus={bus} />
      </Canvas>
    </div>

    <div className="holo-anchors" aria-hidden="true">
      {cast.map((actor) => <div key={actor.id} ref={anchor(`actor:${actor.id}`, 58)} className="holo-anchor"><span className={`holo-nameplate${beat.actors.includes(actor.id) && beat.kind !== "scene" ? " is-active" : ""}`} style={{ "--actor": actor.color } as CSSProperties}>{actor.label}</span></div>)}
      {journey && script.places.map((entry) => <div key={entry.id} ref={anchor(`place:${entry.id}`, -6)} className="holo-anchor holo-anchor-below"><span className={`holo-placelabel${entry.id === beat.placeId ? " is-here" : ""}`} onClick={() => onEnterPlace?.(entry.id)}>{entry.label}</span></div>)}
      {mode === "diorama" && beat.kind === "dialogue" && beat.actors[0] && <div ref={anchor(`bubble:${beat.actors[0]}`, 74)} className="holo-anchor" key={`bubble:${beat.id}`}><div className="holo-bubble" style={{ "--actor": colors.get(beat.actors[0]) } as CSSProperties}><b>{label(beat.actors[0])}</b><p>{typed}<i className="holo-caret" /></p></div></div>}
      {mode === "diorama" && beat.kind === "event" && <div ref={anchor("spot:", 120)} className="holo-anchor" key={`event:${beat.id}`}><div className={`holo-eventcard${beat.conflict ? " is-conflict" : ""}`}><span>{beat.conflict ? <><Clash />CONFLICT</> : "◆ EVENT"}</span><p>{beat.text}</p></div></div>}
    </div>

    <header className="holo-top">
      <div className="holo-title">
        <span className="holo-kind">{journey ? "JOURNEY" : kindLabel.toUpperCase()}</span>
        <h2>{script.title}</h2>
        <small>{journey ? `${script.places.length} places · ${sceneBeats} scenes · ${script.beats.filter((entry) => entry.kind === "travel").length} trips` : `${sceneBeats} scenes · ${script.actors.length} characters`}{beat.when ? ` · ${beat.when}` : ""}</small>
      </div>
      <nav className="holo-modes" aria-label="Stage mode">
        {(["diorama", "cutscene", "journey"] as const).map((value) => <button key={value} aria-pressed={mode === value} onClick={() => onMode(value)}>{value === "diorama" ? "Diorama" : value === "cutscene" ? "Cutscene" : "Journey"}</button>)}
      </nav>
      <button className="holo-exit" onClick={onClose} aria-label="Leave the hologram">✕ <span>Exit</span></button>
    </header>

    {mode !== "cutscene" && <aside className="holo-party" aria-label="Party">
      <h3>PARTY</h3>
      {script.actors.slice(0, 9).map((actor) => <div key={actor.id} className={`holo-member${beat.present.includes(actor.id) ? " is-here" : ""}${beat.actors.includes(actor.id) && beat.kind !== "scene" ? " is-acting" : ""}`} style={{ "--actor": actor.color } as CSSProperties}>
        <i>{[...actor.label][0]}</i><span>{actor.label}</span><meter min={0} max={script.actors[0].beats} value={actor.beats} />
      </div>)}
    </aside>}

    {mode !== "cutscene" && <aside className="holo-log" aria-label="Quest log">
      <h3>QUEST LOG <small>{index + 1} / {script.beats.length}</small></h3>
      <ol>{script.beats.slice(logStart, logStart + 11).map((entry, offset) => <li key={entry.id} className={`${entry === beat ? "is-now" : ""}${logStart + offset < index ? " is-done" : ""}${entry.conflict ? " is-conflict" : ""} kind-${entry.kind}`}>
        <button onClick={() => setIndex(logStart + offset)}><b>{entry.conflict ? <Clash /> : GLYPH[entry.kind]}</b><span>{entry.kind === "scene" ? `${entry.title} — ${entry.text}` : entry.kind === "travel" ? `${entry.title}: ${entry.text}` : entry.kind === "dialogue" ? `${entry.title}: ${entry.quote ?? entry.text}` : entry.text}</span></button>
      </li>)}</ol>
    </aside>}

    {beat.kind === "scene" && mode !== "journey" && <div className="holo-chapter" key={beat.id}><small>{beat.when ?? "Time not stated"}</small><strong>{beat.title}</strong><p>{beat.text}</p></div>}
    {journey && <div className="holo-journeycard" key={beat.id}><span>{beat.kind === "travel" ? "➝ ON THE MOVE" : beat.conflict ? <><Clash />SCENE</> : "◇ SCENE"} {beat.scene}</span><strong>{beat.kind === "travel" ? beat.title : place?.label}</strong><p>{beat.text}</p></div>}

    {mode === "cutscene" && <>
      <div className="holo-letterbox top" /><div className="holo-letterbox bottom" />
      {beat.kind !== "scene" && <div className={`holo-vn${beat.conflict ? " is-conflict" : ""}`}>
        <div className="holo-portraits">
          {beat.actors.slice(0, 1).map((id) => <i key={id} className="is-speaker" style={{ "--actor": colors.get(id) } as CSSProperties}>{[...label(id)][0]}</i>)}
          {beat.actors.slice(1, 3).map((id) => <i key={id} style={{ "--actor": colors.get(id) } as CSSProperties}>{[...label(id)][0]}</i>)}
        </div>
        <div className="holo-vnbox">
          <b style={{ "--actor": colors.get(beat.actors[0] ?? "") ?? "#8fd6ff" } as CSSProperties}>{beat.kind === "dialogue" ? label(beat.actors[0] ?? "") : beat.conflict ? <><Clash />CONFLICT</> : "NARRATION"}</b>
          <p>{beat.kind === "dialogue" && beat.quote ? `「${typed}」` : typed}<i className="holo-caret" /></p>
          {beat.kind === "dialogue" && beat.quote && <small>{beat.text}</small>}
          <span className="holo-next">▼</span>
        </div>
      </div>}
      {beat.conflict && beat.actors.length >= 2 && <div className="holo-versus" key={`vs:${beat.id}`}><span style={{ "--actor": colors.get(beat.actors[0]) } as CSSProperties}>{label(beat.actors[0])}</span><b>VS</b><span style={{ "--actor": colors.get(beat.actors[1]) } as CSSProperties}>{label(beat.actors[1])}</span></div>}
    </>}

    <footer className="holo-timeline" aria-label="Replay">
      <div className="holo-controls">
        <button onClick={() => setIndex(Math.max(0, index - 1))} aria-label="Previous beat">⏮</button>
        <button onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Play"} className="holo-play">{playing ? "❚❚" : "▶"}</button>
        <button onClick={() => setIndex(Math.min(script.beats.length - 1, index + 1))} aria-label="Next beat">⏭</button>
        <button onClick={() => setSpeed(speed >= 4 ? 1 : speed * 2)} aria-label="Speed" className="holo-speed">{speed}×</button>
      </div>
      <div className="holo-track" onClick={(event) => { const box = event.currentTarget.getBoundingClientRect(); setIndex(Math.min(script.beats.length - 1, Math.max(0, Math.floor(((event.clientX - box.left) / box.width) * script.beats.length)))); }}>
        {script.beats.map((entry, at) => <i key={entry.id} className={`kind-${entry.kind}${entry.conflict ? " is-conflict" : ""}${at <= index ? " is-done" : ""}`} style={{ left: `${(at / Math.max(1, script.beats.length - 1)) * 100}%` }} />)}
        <span className="holo-playhead" style={{ left: `${(index / Math.max(1, script.beats.length - 1)) * 100}%` }} />
      </div>
      <div className="holo-legend"><span className="kind-scene">◇ scene</span><span className="kind-event">◆ event</span><span className="kind-dialogue">❝ dialogue</span><span className="is-conflict"><Clash />conflict</span>{journey && <span className="kind-travel">➝ trip</span>}</div>
    </footer>
  </div>;
}

/** Starts each beat's burst on the frame clock (the beat is set outside the frame loop). */
function PulseClock({ bus }: { bus: Bus }) {
  useFrame(({ clock }) => { if (bus.pulse.armed) bus.pulse = { ...bus.pulse, at: clock.getElapsedTime() * 1000, armed: false }; });
  return null;
}
