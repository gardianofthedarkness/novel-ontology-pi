import type { NodeRendererProps } from "reagraph";
import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";
import { Quaternion, type Group } from "three";
import { recordColor } from "../archive";
import type { WorldNode } from "../types";
import { NodeGlow } from "./NodeGlow";

export function ArchiveNode(props: NodeRendererProps) {
  return <ArchiveNodeMesh {...props} />;
}

function ArchiveNodeMesh({ node, selected, active }: NodeRendererProps) {
  const card = useRef<Group>(null);
  const parentRotation = useRef(new Quaternion());
  const camera = useThree((state) => state.camera);
  useFrame(() => {
    const object = card.current;
    if (!object) return;
    object.parent?.getWorldQuaternion(parentRotation.current);
    object.quaternion.copy(parentRotation.current).invert().multiply(camera.quaternion);
  });
  const world = node.data.world as WorldNode;
  const major = world.kind === "bigEvent";
  const width = major ? 340 : world.cluster ? 160 : world.kind === "location" ? 160 : world.kind === "dialogue" ? 145 : 115;
  const height = major ? 360 : world.kind === "location" ? 105 : world.kind === "dialogue" ? 85 : world.kind === "character" ? 165 : 135;
  const depth = major ? 48 : 22;
  const accent = recordColor(world);
  const paper = world.state === "held" ? "#233947" : world.state === "proposed" ? "#493722" : world.lane === "branch" ? "#28243e" : "#142b37";
  const raised = selected || active;
  if (world.kind === "character") {
    return (
      <group>
        <mesh>
          <sphereGeometry args={[57, 36, 24]} />
          <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={raised ? 0.65 : 0.22} metalness={0.35} roughness={0.3} transparent opacity={world.state === "proposed" ? 0.38 : world.state === "held" ? 0.6 : 1} depthWrite={world.state === "canon"} />
        </mesh>
        {world.state !== "canon" && <mesh><sphereGeometry args={[59, 12, 8]} /><meshBasicMaterial color={accent} wireframe transparent opacity={0.45} /></mesh>}
        {raised && <mesh rotation={[Math.PI / 2.5, 0.2, 0]}>
          <torusGeometry args={[71, 1.4, 8, 64]} />
          <meshBasicMaterial color={accent} />
        </mesh>}
        <NodeGlow kind={world.kind} color={accent} size={140} raised={raised} ghost={world.state !== "canon"} />
      </group>
    );
  }
  return (
    <group ref={card}>
      <mesh position={[8, -8, -depth / 2 - 6]}>
        <boxGeometry args={[width, height, 12]} />
        <meshStandardMaterial color="#0d1b28" roughness={0.8} />
      </mesh>
      <mesh>
        <boxGeometry args={[width, height, depth]} />
        <meshStandardMaterial color={paper} emissive={accent} emissiveIntensity={raised ? 0.17 : 0.055} roughness={0.5} transparent opacity={world.state === "proposed" ? 0.4 : world.state === "held" ? 0.65 : 1} depthWrite={world.state === "canon"} />
      </mesh>
      {world.state !== "canon" && <mesh><boxGeometry args={[width + 2, height + 2, depth + 2]} /><meshBasicMaterial color={accent} wireframe transparent opacity={0.55} /></mesh>}
      <mesh position={[-width / 2 + 9, 0, depth / 2 + 1]}>
        <boxGeometry args={[18, height, 3]} />
        <meshStandardMaterial color={accent} emissive={accent} emissiveIntensity={0.8} roughness={0.5} />
      </mesh>
      <mesh position={[-width * 0.17, height / 2 + 13, -3]}>
        <boxGeometry args={[width * 0.42, 26, depth * 0.8]} />
        <meshStandardMaterial color={accent} roughness={0.85} />
      </mesh>
      {[0.34, -0.31].map((offset) => (
        <mesh key={offset} position={[10, height * offset, depth / 2 + 2]}>
          <boxGeometry args={[width * 0.68, 1.5, 1]} />
          <meshBasicMaterial color="#67715f" />
        </mesh>
      ))}
      <mesh position={[width * 0.33, -height * 0.4, depth / 2 + 2]}>
        <ringGeometry args={[5, 7, 24]} />
        <meshBasicMaterial color={accent} />
      </mesh>
      {major && Array.from({ length: 9 }, (_, index) => (
        <mesh key={index} position={[-width * 0.25 + index * 6, -height * 0.4, depth / 2 + 2]}>
          <boxGeometry args={[index % 3 === 0 ? 3 : 1, 14, 1]} />
          <meshBasicMaterial color="#869779" />
        </mesh>
      ))}
      {raised && <mesh position={[0, -height / 2 - 8, 1]}>
        <boxGeometry args={[width + 18, 3, depth + 12]} />
        <meshBasicMaterial color={accent} />
      </mesh>}
      <NodeGlow kind={world.kind} color={accent} size={major ? 245 : 125} raised={raised} ghost={world.state !== "canon"} />
    </group>
  );
}
