import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Canvas, useThree } from "@react-three/fiber";
import { BoxGeometry, BufferGeometry, CanvasTexture, Color, DoubleSide, Float32BufferAttribute, InstancedMesh, LineBasicMaterial, LineLoop, LineSegments, Matrix4, Mesh, MeshBasicMaterial, MeshLambertMaterial, Object3D, Shape, ShapeGeometry, SRGBColorSpace, Sprite, SpriteMaterial, Vector2, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { useChromeInsets } from "./useChromeInsets";
import type { WorldFill, WorldMap } from "../data/timePlace";
import "../places-world.css";

/**
 * The Places page as the world engine left it: every place of the book on one canvas (each a circle in its parent's
 * frame), each place's manifolds (one per patch of its landscape, outlined and tinted by its type) filled with their latest
 * fills, and the nominated buildings on the lots they borrowed. Nothing is filled here: the fills come from the places
 * registry by version and are laid out as they are; a new patch only adds one. Drag to orbit, pinch or scroll to zoom.
 */
interface Props { map: WorldMap; /** "?volume=N" or "", for the fills. */ bookQuery: string; /** The book picker and status, as in every view. */ bookBar?: ReactNode }

/** Ground and buildings by landscape type. */
const TYPE_COLOR: Record<string, string> = { skyscrapers: "#7aa2ff", commercial: "#ffb36b", residential: "#8fd694", industrial: "#b58cff", harbour: "#5fc4d8", park: "#4fbf6f", stadium: "#ff7aa8", village: "#e0c27a", castle: "#d9a77f", farm: "#c9d66b" };
const colorOf = (types: string[]) => TYPE_COLOR[types[0]] ?? "#9aa5b1";
const GOLD = "#ffd36e";
const FLOOR = 3;

/** A label that faces the camera, `size` metres tall. */
function textSprite(text: string, color: string, size: number) {
  const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d")!, font = `600 42px system-ui, "PingFang SC", sans-serif`;
  ctx.font = font; const width = Math.ceil(ctx.measureText(text).width) + 24; canvas.width = width; canvas.height = 60;
  ctx.font = font; ctx.textBaseline = "middle"; ctx.fillStyle = "rgba(6,12,18,.7)"; ctx.fillRect(0, 0, width, 60); ctx.fillStyle = color; ctx.fillText(text, 12, 31);
  const texture = new CanvasTexture(canvas); texture.colorSpace = SRGBColorSpace;
  const sprite = new Sprite(new SpriteMaterial({ map: texture, depthTest: false, transparent: true })); sprite.scale.set(size * width / 60, size, 1); sprite.renderOrder = 10;
  return sprite;
}

/** Every fill the map names, fetched once by version (they never change; the browser caches them too). */
function useFills(map: WorldMap, bookQuery: string) {
  const [fills, setFills] = useState<Map<string, WorldFill>>(new Map());
  useEffect(() => {
    let live = true;
    const glue = bookQuery ? `${bookQuery}&` : "?", versions = [...new Set([...map.manifolds.map((entry) => entry.version), ...map.grounds.map((entry) => entry.version)])];
    for (const version of versions) {
      if (fills.has(version)) continue;
      fetch(`api/places/fill${glue}version=${version}`).then((response) => response.ok ? response.json() as Promise<WorldFill> : null).then((fill) => {
        if (live && fill) setFills((current) => new Map(current).set(version, fill));
      }).catch(() => {});
    }
    return () => { live = false; };
    // Fills already here stay; only new versions are asked for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [map, bookQuery]);
  return fills;
}

/** The world in three.js: rings, manifolds, buildings, roads, nominated buildings and labels; rebuilt when the map or its fills change. */
function World({ map, fills, selected }: { map: WorldMap; fills: Map<string, WorldFill>; selected: string | null }) {
  const { scene } = useThree();
  useEffect(() => {
    const added: Object3D[] = [], add = (object: Object3D) => { scene.add(object); added.push(object); };
    const at = new Map(map.places.map((place) => [place.id, place])), unit = new BoxGeometry(1, 1, 1), matrix = new Matrix4(), turn = new Matrix4(), scale = new Matrix4();
    const ring = (x: number, z: number, r: number, color: string, opacity: number) => {
      const points = Array.from({ length: 96 }, (_, n) => { const a = n / 96 * Math.PI * 2; return [x + Math.cos(a) * r, 0.3, z + Math.sin(a) * r]; }).flat();
      add(new LineLoop(new BufferGeometry().setAttribute("position", new Float32BufferAttribute(points, 3)), new LineBasicMaterial({ color, transparent: true, opacity })));
    };
    for (const place of map.places) {
      if (!place.open) continue;
      const lit = place.id === selected;
      ring(place.x, place.z, place.r, lit ? "#ffffff" : "#5d7f96", lit ? 0.9 : 0.35 + 0.15 / (1 + place.depth));
      const tag = textSprite(place.label, lit ? "#ffffff" : "#cfe3f0", Math.min(24, Math.max(6, place.r * 0.06))); tag.position.set(place.x, Math.min(30, Math.max(10, place.r * 0.08)), place.z - place.r * 0.92); add(tag);
    }
    // A nominated building stands on a fill building's lot: that fill building is not drawn under it.
    const borrowed = new Set(map.buildings.map((building) => `${building.place}|${building.x}|${building.z}`));
    // Each manifold: its outline and a faint ground in its type's colour, then its fill's buildings.
    for (const manifold of map.manifolds) {
      const place = at.get(manifold.place); if (!place) continue;
      const color = colorOf(manifold.types), fill = fills.get(manifold.version);
      if (manifold.outline?.length) {
        const points = manifold.outline.map(([x, z]) => [place.x + x, 0.4, place.z + z]).flat();
        add(new LineLoop(new BufferGeometry().setAttribute("position", new Float32BufferAttribute(points, 3)), new LineBasicMaterial({ color, transparent: true, opacity: 0.8 })));
        const shape = new Shape(manifold.outline.map(([x, z]) => new Vector2(place.x + x, -(place.z + z))));
        const ground = new Mesh(new ShapeGeometry(shape), new MeshBasicMaterial({ color, transparent: true, opacity: 0.1, side: DoubleSide, depthWrite: false })); ground.rotation.x = -Math.PI / 2; add(ground);
      }
      const rows = (fill?.buildings ?? []).filter(([x, z]) => !borrowed.has(`${manifold.place}|${x}|${z}`));
      if (!rows.length) continue;
      const mesh = new InstancedMesh(unit, new MeshLambertMaterial({ color: new Color(color).lerp(new Color("#0b1620"), 0.35) }), rows.length);
      rows.forEach(([x, z, w, d, angle, floors], n) => {
        const h = Math.max(1, floors) * FLOOR;
        mesh.setMatrixAt(n, matrix.makeTranslation(place.x + x, h / 2, place.z + z).multiply(turn.makeRotationY(-angle)).multiply(scale.makeScale(w, h, d)));
      });
      mesh.instanceMatrix.needsUpdate = true; add(mesh);
    }
    // Each place's ground: its roads.
    for (const ground of map.grounds) {
      const place = at.get(ground.place), roads = fills.get(ground.version)?.roads ?? [];
      if (!place || !roads.length) continue;
      const points = roads.flatMap(([ax, az, bx, bz]) => [place.x + ax, 0.2, place.z + az, place.x + bx, 0.2, place.z + bz]);
      add(new LineSegments(new BufferGeometry().setAttribute("position", new Float32BufferAttribute(points, 3)), new LineBasicMaterial({ color: "#3d5566", transparent: true, opacity: 0.7 })));
    }
    // The nominated buildings: gold, a little taller than what is round them, named.
    const named = map.buildings.filter((building) => at.has(building.place));
    if (named.length) {
      const mesh = new InstancedMesh(unit, new MeshLambertMaterial({ color: GOLD, emissive: new Color(GOLD).multiplyScalar(0.35) }), named.length);
      named.forEach((building, n) => {
        const place = at.get(building.place)!, h = Math.max(2, building.floors) * FLOOR + 1;
        mesh.setMatrixAt(n, matrix.makeTranslation(place.x + building.x, h / 2, place.z + building.z).multiply(turn.makeRotationY(-building.angle)).multiply(scale.makeScale(Math.max(4, building.w), h, Math.max(4, building.d))));
        const tag = textSprite(building.name, GOLD, 5); tag.position.set(place.x + building.x, h + 5, place.z + building.z); add(tag);
      });
      mesh.instanceMatrix.needsUpdate = true; add(mesh);
    }
    return () => { for (const object of added) { scene.remove(object); object.traverse((part) => { const mesh = part as Mesh; mesh.geometry?.dispose?.(); const material = mesh.material as { dispose?: () => void; map?: { dispose(): void } } | undefined; material?.map?.dispose(); material?.dispose?.(); }); } unit.dispose(); };
  }, [map, fills, selected, scene]);
  return null;
}

/** Orbit, pinch and zoom; glides to a focus (a place's circle, a building) when it changes. */
function Controls({ focus }: { focus: { x: number; z: number; r: number } }) {
  const { camera, gl } = useThree(), controls = useRef<OrbitControls | null>(null);
  useEffect(() => {
    const orbit = new OrbitControls(camera, gl.domElement); orbit.enableDamping = true; orbit.maxPolarAngle = Math.PI * 0.47; controls.current = orbit;
    let frame = 0; const tick = () => { orbit.update(); frame = requestAnimationFrame(tick); }; tick();
    return () => { cancelAnimationFrame(frame); orbit.dispose(); };
  }, [camera, gl]);
  useEffect(() => {
    const orbit = controls.current; if (!orbit) return;
    const target = new Vector3(focus.x, 0, focus.z), reach = Math.max(40, focus.r * 2.2), from = camera.position.clone(), to = target.clone().add(new Vector3(0, reach * 0.75, reach * 0.65)), start = orbit.target.clone();
    let t = 0, frame = 0; const step = () => { t = Math.min(1, t + 0.05); const e = t * t * (3 - 2 * t); camera.position.lerpVectors(from, to, e); orbit.target.lerpVectors(start, target, e); if (t < 1) frame = requestAnimationFrame(step); }; step();
    return () => cancelAnimationFrame(frame);
  }, [focus, camera]);
  return null;
}

export function PlacesWorld({ map: given, bookQuery, bookBar }: Props) {
  // The live data arrives as a new object on every update: keep one map while its content stays the same, so the scene is
  // not rebuilt and the camera not sent back on every update.
  const key = JSON.stringify([given.builtAt, given.places.map((place) => [place.id, place.x, place.z, place.r]), given.manifolds.map((manifold) => manifold.version), given.grounds.map((ground) => ground.version), given.buildings.map((building) => [building.id, building.x, building.z])]);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const map = useMemo(() => given, [key]);
  const insets = useChromeInsets(), fills = useFills(map, bookQuery);
  const [selected, setSelected] = useState<string | null>(null), [panelOpen, setPanelOpen] = useState(true);
  const byId = useMemo(() => new Map(map.places.map((place) => [place.id, place])), [map]);
  // What is filled, framed: every manifold (each its patch's circle, else its place's), or the chosen place's, or a chosen
  // building's neighbourhood. A place's circle is mostly open ground round its fills, so it frames only without any.
  const focus = useMemo(() => {
    const building = map.buildings.find((entry) => entry.id === selected), chosen = byId.get(building?.place ?? selected ?? "");
    if (building && chosen) return { x: chosen.x + building.x, z: chosen.z + building.z, r: 60 };
    const circles = map.manifolds.filter((manifold) => !chosen || manifold.place === chosen.id).flatMap((manifold) => {
      const place = byId.get(manifold.place); if (!place) return [];
      return [manifold.centre && manifold.radius ? { x: place.x + manifold.centre[0], z: place.z + manifold.centre[1], r: manifold.radius } : { x: place.x, z: place.z, r: Math.min(place.r, 200) }];
    });
    const frame = circles.length ? circles : chosen ? [chosen] : map.places.filter((entry) => !entry.parent || !byId.has(entry.parent));
    const x0 = Math.min(...frame.map((entry) => entry.x - entry.r)), x1 = Math.max(...frame.map((entry) => entry.x + entry.r)), z0 = Math.min(...frame.map((entry) => entry.z - entry.r)), z1 = Math.max(...frame.map((entry) => entry.z + entry.r));
    return Number.isFinite(x0) ? { x: (x0 + x1) / 2, z: (z0 + z1) / 2, r: Math.max(x1 - x0, z1 - z0) / 2 } : { x: 0, z: 0, r: 200 };
  }, [selected, map, byId]);
  const children = (parent: string | null) => map.places.filter((place) => (place.parent && byId.has(place.parent) ? place.parent : null) === parent && place.open);
  const types = [...new Set(map.manifolds.flatMap((manifold) => manifold.types))];
  const since = (born: unknown) => typeof born === "string" ? born : born && typeof born === "object" && "scene" in born ? `since ${String((born as { scene: unknown }).scene)}` : null;
  const tree = (parent: string | null, depth: number): ReactNode => children(parent).map((place) => {
    const manifolds = map.manifolds.filter((manifold) => manifold.place === place.id), buildings = map.buildings.filter((building) => building.place === place.id);
    return <li key={place.id} style={{ marginLeft: depth ? 12 : 0 }}>
      <button className={selected === place.id ? "is-on" : ""} onClick={() => setSelected(selected === place.id ? null : place.id)}><b>{place.label}</b> <span>{place.scale ?? "place"} · {Math.round(place.r)} m{place.temporary ? " · temporary" : ""}</span></button>
      {(manifolds.length > 0 || buildings.length > 0) && <ul className="pw-parts">
        {manifolds.map((manifold) => <li key={manifold.id} className="pw-manifold"><i style={{ background: colorOf(manifold.types) }} />{manifold.types.join(" + ") || "landscape"}{manifold.era ? ` · ${manifold.era}` : ""}{since(manifold.born) ? ` · ${since(manifold.born)}` : ""} · {manifold.buildings} buildings · fill {manifold.version.slice(0, 6)}{fills.has(manifold.version) ? "" : " (loading)"}</li>)}
        {buildings.map((building) => <li key={building.id}><button className={`pw-building${selected === building.id ? " is-on" : ""}`} onClick={() => setSelected(building.id)}><i />{building.name}<span>{building.kind === "staged" ? "staged" : building.scene ? `named in ${building.scene}` : "named"}</span></button></li>)}
      </ul>}
      <ul>{tree(place.id, depth + 1)}</ul>
    </li>;
  });
  return <div className="places-world" style={insets}>
    {bookBar}
    <Canvas className="pw-stage" camera={{ fov: 45, near: 1, far: 50000, position: [focus.x, focus.r * 1.6, focus.z + focus.r * 1.4] }} dpr={[1, 2]}>
      <color attach="background" args={["#060c12"]} />
      <ambientLight intensity={0.7} />
      <directionalLight position={[300, 600, 200]} intensity={0.9} />
      <World map={map} fills={fills} selected={selected} />
      <Controls focus={focus} />
    </Canvas>
    <aside className={`pw-panel${panelOpen ? "" : " is-folded"}`} aria-label="Places">
      <header><span className="eyebrow">PLACES · WORLD</span><button onClick={() => setPanelOpen(!panelOpen)} aria-expanded={panelOpen}>{panelOpen ? "Fold" : "Places"}</button></header>
      {panelOpen && <>
        <p className="pw-note">Every place's manifolds at their latest fill, with the nominated buildings on their lots: from {map.runs.length} accepted run{map.runs.length === 1 ? "" : "s"}.</p>
        <div className="pw-legend">{types.map((type) => <span key={type}><i style={{ background: TYPE_COLOR[type] ?? "#9aa5b1" }} />{type}</span>)}<span><i style={{ background: GOLD }} />nominated</span></div>
        <ul className="pw-tree">{tree(null, 0)}</ul>
      </>}
    </aside>
  </div>;
}
