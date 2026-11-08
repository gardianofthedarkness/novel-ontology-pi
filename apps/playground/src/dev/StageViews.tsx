import { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { ArchitectureHolograms, buildingBox } from "../components/ArchitectureHolograms";
import { navGrid, navPositions, type NavBox } from "../data/holoNav";
import type { ArchitectureKind } from "../data/placeArchitecture";
import type { FloorMark } from "../data/orbitalTimePlace";

/**
 * Dev page (exploration): one building straight from the front or the side,
 * with a flat (orthographic) camera, so a box a decision model draws on the
 * picture maps back to the building exactly — front: across and up; side:
 * deep and up. Floors are labelled in the left margin. The frame and the nav
 * spots are published on window.__view for the mapping.
 *   stage-views.html?kind=skyscraper&view=front|side&size=640
 */
const params = new URLSearchParams(location.search);
const kind = (params.get("kind") ?? "skyscraper") as ArchitectureKind;
const view = params.get("view") === "side" ? "side" : "front";
const size = Number(params.get("size") ?? 640);
const FLOOR = -944;
const mark: FloorMark = { id: `view-${kind}`, x: 0, z: 0, radius: 150, active: true, architecture: kind, spotX: 0, spotZ: 0 };

function Views() {
  const [box, setBox] = useState<NavBox | null>(null);
  useEffect(() => { void buildingBox(mark, kind).then(setBox); }, []);
  if (!box) return null;
  const grid = navGrid(kind), at = navPositions(grid, box, FLOOR);
  // One frame for both views: the building, the street in front and the alley behind, the basement below.
  const across = view === "front" ? box.width : box.depth;
  const span = Math.max(across + 2 * 150, box.height * 1.35);
  const zoom = size / span;
  const centreH = view === "front" ? box.x : box.z, centreV = FLOOR + box.height / 2;
  // Pixel ↔ world: front x → right; side looks along −x, so the front (+z, the street) is on the left.
  const toPixel = (point: [number, number, number]) => [size / 2 + (view === "front" ? point[0] - centreH : centreH - point[2]) * zoom, size / 2 - (point[1] - centreV) * zoom];
  const spots = grid.spots.map((spot) => ({ id: spot.id, label: spot.label, world: at.get(spot.id)!, pixel: toPixel(at.get(spot.id)!) }));
  (window as unknown as { __view: unknown }).__view = { kind, view, size, zoom, centreH, centreV, box, floor: FLOOR, spots };
  const floors = spots.filter((spot) => /^floor-\d|^roof$|^basement$/.test(spot.id));
  const camera = view === "front" ? [centreH, centreV, 3000] : [3000, centreV, centreH];
  return <div style={{ position: "relative", width: size, height: size }}>
    <Canvas orthographic camera={{ position: camera as [number, number, number], zoom, near: 1, far: 8000 }} onCreated={({ camera: made }) => made.lookAt(view === "front" ? centreH : 0, centreV, view === "front" ? 0 : centreH)} style={{ width: size, height: size }}>
      <gridHelper args={[3000, 60, "#294760", "#122237"]} position={[0, FLOOR - 1, 0]} />
      <ArchitectureHolograms marks={[mark]} reducedMotion />
    </Canvas>
    {/* Floor labels in the margin, at each floor's height; the ground line; front and back for the side view. */}
    {floors.map((spot) => <span key={spot.id} style={{ position: "absolute", left: 8, top: spot.pixel[1] - 8, font: "600 13px -apple-system, sans-serif", color: "#8fd6ff" }}>{spot.label}</span>)}
    {view === "side" && <><span style={{ position: "absolute", left: 8, top: toPixel([0, FLOOR, 0])[1] + 14, font: "600 12px -apple-system, sans-serif", color: "#ffd36b" }}>◀ FRONT (street)</span>
      <span style={{ position: "absolute", right: 8, top: toPixel([0, FLOOR, 0])[1] + 14, font: "600 12px -apple-system, sans-serif", color: "#ffd36b" }}>BACK (alley) ▶</span></>}
    <span style={{ position: "absolute", right: 8, top: 8, font: "700 12px -apple-system, sans-serif", letterSpacing: ".12em", color: "#cdeeff" }}>{view === "front" ? "FRONT VIEW" : "SIDE VIEW"}</span>
  </div>;
}

createRoot(document.getElementById("root")!).render(<Views />);
