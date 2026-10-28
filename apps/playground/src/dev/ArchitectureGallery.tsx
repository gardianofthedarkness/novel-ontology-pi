import { createRoot } from "react-dom/client";
import { Canvas } from "@react-three/fiber";
import { DoubleSide } from "three";
import { ArchitectureHolograms } from "../components/ArchitectureHolograms";
import { ARCHITECTURE_LABEL, type ArchitectureKind } from "../data/placeArchitecture";
import type { FloorMark } from "../data/orbitalTimePlace";

/** Dev page: every hologram archetype on its own disc (also the candidate sheet a decision model can look at). */
const params = new URLSearchParams(location.search);
const kinds = (params.get("kinds")?.split(",") ?? Object.keys(ARCHITECTURE_LABEL)) as ArchitectureKind[];
const lettered = params.has("letters");
const columns = Number(params.get("columns") ?? 4);

function Cell({ kind, index }: { kind: ArchitectureKind; index: number }) {
  const mark: FloorMark = { id: `gallery-${kind}`, x: 0, z: 0, radius: kind === "city" ? 150 : 120, active: true, architecture: kind, spotX: 0, spotZ: 0 };
  return <figure style={{ margin: 0, position: "relative", background: "#050b15", border: "1px solid #12304a", borderRadius: 10, overflow: "hidden" }}>
    <div style={{ height: 300 }}>
      <Canvas camera={{ position: [260, -944 + 250, 380], fov: 38, near: 1, far: 5000 }} onCreated={({ camera }) => camera.lookAt(0, -944 + 85, 0)}>
        <gridHelper args={[1200, 24, "#294760", "#122237"]} position={[0, -950, 0]} />
        <group position={[0, -944, 0]} rotation={[-Math.PI / 2, 0, 0]}>
          <mesh><circleGeometry args={[mark.radius, 48]} /><meshBasicMaterial color="#16405e" transparent opacity={0.55} depthWrite={false} /></mesh>
          <mesh><ringGeometry args={[mark.radius * 0.94, mark.radius, 48]} /><meshBasicMaterial color="#7cc8ff" transparent opacity={0.85} side={DoubleSide} depthWrite={false} /></mesh>
        </group>
        <ArchitectureHolograms marks={[mark]} reducedMotion={params.has("still")} />
      </Canvas>
    </div>
    {!params.has("bare") && <figcaption style={{ position: "absolute", left: 14, top: 10, font: "600 15px -apple-system, sans-serif", color: "#cdeeff", letterSpacing: ".04em" }}>
      {lettered ? `${String.fromCharCode(65 + index)}` : ARCHITECTURE_LABEL[kind]}
    </figcaption>}
  </figure>;
}

createRoot(document.getElementById("root")!).render(
  <main style={{ display: "grid", gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: 12, padding: 12 }}>
    {kinds.map((kind, index) => <Cell key={kind} kind={kind} index={index} />)}
  </main>,
);
