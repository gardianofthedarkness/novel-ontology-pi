import { useEffect, useMemo, useRef, useState } from "react";
import { useFrame } from "@react-three/fiber";
import { AdditiveBlending, BoxGeometry, BufferAttribute, BufferGeometry, CylinderGeometry, DoubleSide, EdgesGeometry, ExtrudeGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineLoop, LineSegments, Mesh, MeshBasicMaterial, Shape as Outline } from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { FloorMark } from "../data/orbitalTimePlace";
import type { ArchitectureKind } from "../data/placeArchitecture";
import type { NavBox } from "../data/holoNav";

/**
 * Orbital Places: a hologram of the building a place's name names, standing
 * on its disc — cyan outlines over a faint glass volume, brightest at the
 * floor. Kenney CC0 low-poly models (baked by tools/architecture-models.mjs)
 * and two drawn here (church, station). A city's skyline rises along the
 * back of its region's rim, clear of the places inside; everything stays
 * below the first scene so the columns above remain the subject. A place
 * rises out of its disc when it first appears; a faint scan ring climbs it.
 */
interface BakedModel { size: number[]; step: number; positions: string; indices: string }
interface Shape { fill: BufferGeometry; edges: BufferGeometry; width: number; depth: number; height: number }
type Shapes = Map<string, Shape>;

const noRaycast = () => undefined;
const EDGE = "#8fd6ff", PROPOSED = "#ffd36b", FILL = "#2b86c4";
/** Buildings the story names at a place: warm, so they read apart from the generic skyline. */
const NAMED_EDGE = "#ffe7b0", NAMED_FILL = "#b97f2c";
/** World units above the floor where the lowest scene sphere floats; buildings stay under it. */
const CEILING = 215;
const RISE_SECONDS = 1.6, SCAN_SECONDS = 7;

const bytes = (base64: string) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
/** Position-only, non-indexed: what merging and outlining need. */
const bare = (geometry: BufferGeometry) => { const flat = geometry.index ? geometry.toNonIndexed() : geometry; for (const name of Object.keys(flat.attributes)) if (name !== "position") flat.deleteAttribute(name); return flat; };

function shapeOf(geometry: BufferGeometry): Shape {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!, height = Math.max(1e-6, box.max.y - box.min.y);
  const edges = new EdgesGeometry(geometry, 24);
  // A projection rising from the floor: bright at the base, fading upward.
  const position = edges.getAttribute("position"), colors = new Float32Array(position.count * 3);
  for (let index = 0; index < position.count; index++) colors.fill(1 - 0.62 * ((position.getY(index) - box.min.y) / height), index * 3, index * 3 + 3);
  edges.setAttribute("color", new Float32BufferAttribute(colors, 3));
  return { fill: geometry, edges, width: box.max.x - box.min.x, depth: box.max.z - box.min.z, height };
}

function bakedGeometry(model: BakedModel) {
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(Float32Array.from(new Int16Array(bytes(model.positions)), (value) => value * model.step), 3));
  geometry.setIndex(new BufferAttribute(new Uint16Array(bytes(model.indices)), 1));
  return geometry;
}

const block = (width: number, height: number, depth: number, x: number, y: number, z: number) => new BoxGeometry(width, height, depth).translate(x, y + height / 2, z);
/** A pitched roof: a triangular prism along z. */
function gable(width: number, rise: number, length: number, y: number, z: number) {
  const outline = new Outline();
  outline.moveTo(-width / 2, 0); outline.lineTo(width / 2, 0); outline.lineTo(0, rise); outline.closePath();
  return new ExtrudeGeometry(outline, { depth: length, bevelEnabled: false }).translate(0, y, z - length / 2);
}
const merged = (parts: BufferGeometry[]) => mergeGeometries(parts.map(bare))!;

/** Nave, pitched roof, bell tower with spire and cross facing the viewer, a round apse behind. */
const church = () => merged([
  block(1.2, 1.1, 2.4, 0, 0, -0.2), gable(1.36, 0.78, 2.5, 1.1, -0.2),
  block(0.72, 2.0, 0.72, 0, 0, 1.25), block(0.84, 0.1, 0.84, 0, 2.0, 1.25),
  pyramid(0.56, 1.3).translate(0, 2.1 + 0.65, 1.25),
  block(0.05, 0.44, 0.05, 0, 3.38, 1.25), block(0.28, 0.05, 0.05, 0, 3.6, 1.25),
  new CylinderGeometry(0.6, 0.6, 0.95, 14, 1, false, Math.PI / 2, Math.PI).translate(0, 0.475, -1.4),
]);
/** A platform under a barrel vault on columns, with a clock tower at one end. */
const station = () => merged([
  block(3.2, 0.14, 1.5, 0, 0, 0),
  ...[-1.45, -0.48, 0.48, 1.45].flatMap((x) => [block(0.07, 0.72, 0.07, x, 0.14, 0.62), block(0.07, 0.72, 0.07, x, 0.14, -0.62)]),
  new CylinderGeometry(0.72, 0.72, 3.3, 16, 1, true, 0, Math.PI).rotateZ(Math.PI / 2).translate(0, 0.86, 0),
  block(0.44, 1.9, 0.44, 1.95, 0, 0.25), block(0.56, 0.1, 0.56, 1.95, 1.9, 0.25), pyramid(0.36, 0.5).translate(1.95, 2.0 + 0.25, 0.25),
  new CylinderGeometry(0.16, 0.16, 0.04, 20).rotateX(Math.PI / 2).translate(1.95, 1.5, 0.48),
]);
/** Two cottages and a mill tower carrying the kit's windmill sails. */
const village = (sails: BufferGeometry) => merged([
  block(0.9, 0.6, 0.7, -1.05, 0, 0.55), gable(1.0, 0.45, 0.8, 0.6, 0.55).translate(-1.05, 0, 0),
  block(0.7, 0.5, 0.6, -0.95, 0, -0.55), gable(0.8, 0.38, 0.7, 0.5, -0.55).translate(-0.95, 0, 0),
  new CylinderGeometry(0.34, 0.5, 1.8, 8).translate(0.6, 0.9, 0), new CylinderGeometry(0, 0.45, 0.5, 8).translate(0.6, 2.05, 0),
  sails.clone().scale(0.55, 0.55, 0.55).rotateY(Math.PI / 2).translate(0.6, 0.9, 0.45),
]);
/** A four-sided spire (a cone with four faces, turned square to the walls). */
function pyramid(radius: number, height: number) { return new CylinderGeometry(0, radius, height, 4, 1).rotateY(Math.PI / 4); }
/** The red-cross sign standing on a hospital's roof. */
const cross = (y: number) => [block(0.14, 0.52, 0.08, 0, y, 0.1), block(0.52, 0.14, 0.08, 0, y + 0.19, 0.1)];

let loading: Promise<Shapes> | null = null;
/** The models, loaded once; a failed load (a dropped connection) is forgotten, so the next stage tries again. */
function loadShapes(): Promise<Shapes> {
  return loading ??= import("../data/architectureModels.json").then(({ default: data }) => {
    const models = data.models as Record<string, BakedModel>;
    const shapes: Shapes = new Map(Object.entries(models).map(([name, model]) => [name, shapeOf(bakedGeometry(model))]));
    const wide = models["office-k"];
    shapes.set("hospital", shapeOf(merged([bakedGeometry(wide), ...cross(wide.size[1] + 0.06)])));
    shapes.set("church", shapeOf(church()));
    shapes.set("station", shapeOf(station()));
    shapes.set("village", shapeOf(village(bakedGeometry(models.windmill))));
    return shapes;
  }).catch((error: unknown) => { loading = null; throw error; });
}

/** Load the building models ahead (they are their own chunk), so a replay does not start on an empty stage. */
export const preloadArchitecture = () => loadShapes().then(() => undefined);

const VARIANTS: Record<ArchitectureKind, string[]> = {
  church: ["church"], hospital: ["hospital"], station: ["station"], market: ["market"], castle: ["keep"], park: ["fountain"], village: ["village"],
  skyscraper: ["skyscraper-a", "skyscraper-b", "skyscraper-e"], school: ["office-h"], home: ["office-c"], office: ["block-wide-b"],
  city: "abcdefghijklm".split("").map((letter) => `tower-${letter}`),
};

/** Deterministic per place: the same place always gets the same skyline. */
function random(seed: string) {
  let state = 2166136261;
  for (const char of seed) state = Math.imul(state ^ char.charCodeAt(0), 16777619);
  return () => { state = Math.imul(state ^ (state >>> 15), 2246822507) ^ Math.imul(state ^ (state >>> 13), 3266489909); return ((state >>>= 0) % 100000) / 100000; };
}

interface Placed { shape: Shape; x: number; z: number; scale: number; turn: number }
/** Where each building of a place stands (relative to the disc's centre), how tall it all is, and the scan ring's radius. */
function arrange(mark: FloorMark, kind: ArchitectureKind, shapes: Shapes): { items: Placed[]; height: number; scan: number; centre: [number, number] } {
  const next = random(mark.id), pick = (names: string[]) => shapes.get(names[Math.floor(next() * names.length)])!;
  const spot: [number, number] = [(mark.spotX ?? mark.x) - mark.x, (mark.spotZ ?? mark.z) - mark.z];
  if (kind === "city") {
    const towers = VARIANTS.city;
    if (mark.region) {
      // A skyline along the back of the rim, parted where the region's own scenes rise.
      const count = Math.max(8, Math.min(26, Math.round(mark.radius / 38)));
      const gapAt = Math.atan2(spot[1], spot[0]), gap = Math.atan2(80, mark.radius);
      const tallest = Math.max(80, Math.min(CEILING, mark.radius * 0.24));
      const items: Placed[] = [];
      for (let index = 0; index < count; index++) {
        const along = index / (count - 1), angle = Math.PI * (0.92 + 1.16 * along);
        const away = Math.abs(Math.atan2(Math.sin(angle - gapAt), Math.cos(angle - gapAt)));
        if (away < gap) continue;
        const shape = pick(towers), footprint = Math.min(70, (mark.radius * 1.16 * Math.PI) / count * 0.62);
        const height = tallest * (0.45 + 0.55 * Math.sin(Math.PI * along)) * (0.7 + 0.45 * next());
        const scale = Math.min(footprint / Math.max(shape.width, shape.depth), height / shape.height);
        items.push({ shape, x: Math.cos(angle) * mark.radius * 0.9, z: Math.sin(angle) * mark.radius * 0.9, scale, turn: -angle + Math.PI / 2 });
      }
      return { items, height: tallest, scan: mark.radius * 0.9, centre: [0, 0] };
    }
    // A downtown around the place's own plaza (its scenes rise from the middle).
    const count = 7, ring = mark.radius * 0.58, tallest = Math.min(CEILING, Math.max(70, mark.radius * 1.1));
    const items = Array.from({ length: count }, (_, index): Placed => {
      const angle = Math.PI * (0.75 + (1.5 * index) / (count - 1)), shape = pick(towers);
      const height = tallest * (0.55 + 0.45 * Math.sin(Math.PI * (index / (count - 1)))) * (0.75 + 0.35 * next());
      const scale = Math.min((mark.radius * 0.36) / Math.max(shape.width, shape.depth), height / shape.height);
      return { shape, x: Math.cos(angle) * ring, z: Math.sin(angle) * ring, scale, turn: -angle + Math.PI / 2 };
    });
    return { items, height: tallest, scan: ring * 1.25, centre: [0, 0] };
  }
  // One building, on the place's spot (a region's sits inside its upper rim, clear of the places within).
  const shape = pick(VARIANTS[kind]);
  const footprint = mark.region ? Math.min(220, mark.radius * 0.34) : Math.min(260, mark.radius * 1.15);
  const scale = Math.min(footprint / Math.max(shape.width, shape.depth), CEILING / shape.height);
  return { items: [{ shape, x: spot[0], z: spot[1], scale, turn: 0 }], height: shape.height * scale, scan: (Math.hypot(shape.width, shape.depth) * scale) / 2 * 1.08, centre: spot };
}

/** The box a place's hologram fills (stage units): what its nav grid's spots are laid out in. */
export async function buildingBox(mark: FloorMark, kind: ArchitectureKind): Promise<NavBox> {
  const { items } = arrange(mark, kind, await loadShapes());
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, height = 0;
  for (const item of items) {
    const across = (item.turn ? Math.max(item.shape.width, item.shape.depth) : item.shape.width) * item.scale / 2, deep = (item.turn ? Math.max(item.shape.width, item.shape.depth) : item.shape.depth) * item.scale / 2;
    minX = Math.min(minX, item.x - across); maxX = Math.max(maxX, item.x + across); minZ = Math.min(minZ, item.z - deep); maxZ = Math.max(maxZ, item.z + deep);
    height = Math.max(height, item.shape.height * item.scale);
  }
  return { x: mark.x + (minX + maxX) / 2, z: mark.z + (minZ + maxZ) / 2, width: maxX - minX, depth: maxZ - minZ, height };
}

const circle = (() => { const points: number[] = []; for (let index = 0; index < 64; index++) { const angle = (index / 64) * Math.PI * 2; points.push(Math.cos(angle), 0, Math.sin(angle)); } return new BufferGeometry().setAttribute("position", new Float32BufferAttribute(points, 3)); })();
const easeOut = (value: number) => 1 - (1 - value) ** 3;

function PlaceHologram({ mark, kind, shapes, order, reducedMotion }: { mark: FloorMark; kind: ArchitectureKind; shapes: Shapes; order: number; reducedMotion: boolean }) {
  const born = useRef<number | null>(null);
  const tone = mark.proposed ? PROPOSED : EDGE;
  // Rebuilt only when where and how it stands changes, not for each new mark object of the same place (a live refresh, a period filter).
  const footprint = [mark.id, mark.x, mark.z, mark.radius, mark.depth ?? 0, !!mark.region, mark.spotX ?? "", mark.spotZ ?? ""].join("|");
  const { group, lift, materials, scan } = useMemo(() => {
    const edge = new LineBasicMaterial({ color: tone, vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const fill = new MeshBasicMaterial({ color: FILL, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
    const ring = new LineBasicMaterial({ color: tone, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
    const { items, height, scan: radius, centre } = arrange(mark, kind, shapes);
    const group = new Group(), lift = new Group();
    group.position.set(mark.x, -944 + 1.5 * (mark.depth ?? 0) + 1, mark.z);
    group.add(lift);
    for (const item of items) {
      const building = new Group();
      building.position.set(item.x, 0, item.z);
      building.rotation.y = item.turn;
      building.scale.setScalar(item.scale);
      const body = new Mesh(item.shape.fill, fill), outline = new LineSegments(item.shape.edges, edge);
      body.raycast = noRaycast; outline.raycast = noRaycast;
      building.add(body, outline);
      lift.add(building);
    }
    const loop = new LineLoop(circle, ring);
    loop.raycast = noRaycast;
    loop.position.set(centre[0], 0, centre[1]);
    loop.scale.setScalar(radius);
    loop.userData.height = height;
    group.add(loop);
    return { group, lift, materials: { edge, fill, ring }, scan: loop };
  }, [footprint, kind, shapes, tone]); // eslint-disable-line react-hooks/exhaustive-deps -- the footprint is every field of the mark it reads
  useEffect(() => () => { materials.edge.dispose(); materials.fill.dispose(); materials.ring.dispose(); }, [materials]);
  const level = useRef(0);
  useFrame(({ clock }) => {
    const time = clock.getElapsedTime();
    born.current ??= time + Math.min(order, 12) * 0.09;
    const risen = reducedMotion ? 1 : easeOut(Math.max(0, Math.min(1, (time - born.current) / RISE_SECONDS)));
    // Dim when no scene of the chosen periods is here; glide between the two.
    const target = mark.active ? 1 : 0.28;
    level.current += (target - level.current) * (reducedMotion ? 1 : 0.08);
    lift.scale.y = Math.max(0.001, risen);
    materials.edge.opacity = 0.62 * risen * level.current;
    materials.fill.opacity = 0.075 * risen * level.current;
    if (reducedMotion) { scan.visible = false; return; }
    const sweep = ((time - born.current) / SCAN_SECONDS) % 1;
    scan.position.y = sweep * scan.userData.height * 1.04;
    materials.ring.opacity = 0.42 * Math.sin(Math.PI * sweep) * risen * level.current;
  });
  return <primitive object={group} />;
}

/**
 * The buildings the story names at a place (placeBuildings.ts): warm arcs
 * along the front of its disc (row after row outward when many), clear of the
 * generic skyline at the back. One
 * standing by the chosen moment is drawn full; one named later stands low
 * and faint, and rises when the moment reaches it.
 */
function NamedBuildings({ mark, shapes, reducedMotion }: { mark: FloorMark; shapes: Shapes; reducedMotion: boolean }) {
  const named = mark.named ?? [];
  const layout = [mark.id, mark.x, mark.z, mark.radius, mark.depth ?? 0, !!mark.region, ...named.map((entry) => `${entry.id}:${entry.model}`)].join("|");
  const { group, parts } = useMemo(() => {
    const group = new Group();
    group.position.set(mark.x, -944 + 1.5 * (mark.depth ?? 0) + 1, mark.z);
    const base = mark.radius * (mark.region ? 0.9 : 0.95), spread = Math.PI * 0.9, across = Math.max(22, Math.min(64, mark.radius * 0.26));
    const perRow = Math.max(1, Math.floor((spread * base) / (across * 1.2)));
    const parts = named.map((entry, index) => {
      const next = random(entry.id), variants = VARIANTS[entry.model as ArchitectureKind] ?? VARIANTS.office;
      const shape = shapes.get(variants[Math.floor(next() * variants.length)]) ?? shapes.get(VARIANTS.office[0])!;
      const row = Math.floor(index / perRow), inRow = Math.min(perRow, named.length - row * perRow), ring = base + row * across * 1.4;
      const angle = Math.PI / 2 + ((index % perRow) - (inRow - 1) / 2) * Math.min(0.42, spread / inRow);
      const height = Math.max(60, Math.min(CEILING * 0.8, across * 2.2)) * (0.85 + 0.3 * next());
      const scale = Math.min(across / Math.max(shape.width, shape.depth), height / shape.height);
      const edge = new LineBasicMaterial({ color: NAMED_EDGE, vertexColors: true, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, toneMapped: false });
      const fill = new MeshBasicMaterial({ color: NAMED_FILL, transparent: true, opacity: 0, blending: AdditiveBlending, depthWrite: false, side: DoubleSide, toneMapped: false });
      const building = new Group();
      building.position.set(Math.cos(angle) * ring, 0, Math.sin(angle) * ring);
      building.rotation.y = -angle + Math.PI / 2;
      const body = new Mesh(shape.fill, fill), outline = new LineSegments(shape.edges, edge);
      body.raycast = noRaycast; outline.raycast = noRaycast;
      building.add(body, outline);
      group.add(building);
      return { id: entry.id, building, scale, edge, fill, level: 0, rise: 0 };
    });
    return { group, parts };
  }, [layout, shapes]); // eslint-disable-line react-hooks/exhaustive-deps -- the layout key holds every field of the mark it reads
  useEffect(() => () => { for (const part of parts) { part.edge.dispose(); part.fill.dispose(); } }, [parts]);
  const standing = useMemo(() => new Map(named.map((entry) => [entry.id, entry.standing])), [named]);
  useFrame(() => {
    const active = mark.active ? 1 : 0.28, ease = reducedMotion ? 1 : 0.1;
    for (const part of parts) {
      const up = standing.get(part.id) ?? false;
      part.level += ((up ? 1 : 0.22) - part.level) * ease;
      part.rise += ((up ? 1 : 0.35) - part.rise) * ease;
      part.building.scale.set(part.scale, part.scale * Math.max(0.001, part.rise), part.scale);
      part.edge.opacity = 0.9 * part.level * active;
      part.fill.opacity = 0.12 * part.level * active;
    }
  });
  return <primitive object={group} />;
}

export function ArchitectureHolograms({ marks, reducedMotion }: { marks: FloorMark[]; reducedMotion: boolean }) {
  const built = useMemo(() => marks.filter((mark): mark is FloorMark & { architecture: ArchitectureKind } => !!mark.architecture), [marks]);
  const storied = useMemo(() => marks.filter((mark) => mark.named?.length), [marks]);
  const [shapes, setShapes] = useState<Shapes | null>(null);
  useEffect(() => {
    if ((!built.length && !storied.length) || shapes) return;
    let live = true;
    loadShapes().then((loaded) => { if (live) setShapes(loaded); }, () => undefined);
    return () => { live = false; };
  }, [built.length, storied.length, shapes]);
  if (!shapes) return null;
  return <>
    {built.map((mark, order) => <PlaceHologram key={`${mark.id}:${mark.architecture}`} mark={mark} kind={mark.architecture} shapes={shapes} order={order} reducedMotion={reducedMotion} />)}
    {storied.map((mark) => <NamedBuildings key={`named:${mark.id}`} mark={mark} shapes={shapes} reducedMotion={reducedMotion} />)}
  </>;
}
