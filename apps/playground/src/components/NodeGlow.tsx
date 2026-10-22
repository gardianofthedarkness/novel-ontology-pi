import { AdditiveBlending, CanvasTexture } from "three";
import type { WorldNode } from "../types";

const textures = new Map<string, CanvasTexture>();

function glowTexture(kind: WorldNode["kind"] | "halo"): CanvasTexture {
  const existing = textures.get(kind);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 128;
  const context = canvas.getContext("2d")!;
  const gradient = context.createRadialGradient(64, 64, 6, 64, 64, 64);
  gradient.addColorStop(0, kind === "halo" ? "#ffffff50" : "#ffffff60");
  gradient.addColorStop(0.4, "#ffffff18");
  gradient.addColorStop(1, "#ffffff00");
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  if (kind !== "halo") {
    context.strokeStyle = "white";
    context.lineWidth = 4;
    context.lineCap = context.lineJoin = "round";
    context.shadowColor = "white";
    context.shadowBlur = 10;
    context.beginPath();
    if (kind === "character") {
      context.arc(64, 49, 11, 0, Math.PI * 2);
      context.moveTo(42, 86); context.bezierCurveTo(42, 64, 86, 64, 86, 86);
    } else if (kind === "event") {
      context.moveTo(70, 34); context.lineTo(46, 68); context.lineTo(63, 68); context.lineTo(57, 95); context.lineTo(83, 58); context.lineTo(65, 58); context.closePath();
    } else if (kind === "dialogue") {
      context.roundRect(36, 40, 56, 40, 10);
      context.moveTo(47, 80); context.lineTo(44, 91); context.lineTo(62, 80);
      context.moveTo(49, 58); context.lineTo(79, 58);
    } else if (kind === "location") {
      context.moveTo(64, 92); context.bezierCurveTo(23, 51, 46, 31, 64, 34); context.bezierCurveTo(88, 31, 99, 57, 64, 92);
      context.moveTo(72, 55); context.arc(64, 55, 8, 0, Math.PI * 2);
    } else if (kind === "scene") {
      context.roundRect(35, 39, 58, 50, 5);
      context.moveTo(35, 53); context.lineTo(93, 53);
      for (let offset = 43; offset < 90; offset += 16) { context.moveTo(offset, 40); context.lineTo(offset + 9, 52); }
    } else {
      context.roundRect(43, 39, 44, 54, 4);
      context.moveTo(36, 79); context.lineTo(36, 33); context.lineTo(76, 33);
      context.moveTo(53, 56); context.lineTo(77, 56);
      context.moveTo(53, 69); context.lineTo(73, 69);
    }
    context.stroke();
  }
  const texture = new CanvasTexture(canvas);
  textures.set(kind, texture);
  return texture;
}

export function NodeGlow({ kind, color, size, raised, ghost }: { kind: WorldNode["kind"]; color: string; size: number; raised: boolean; ghost: boolean }) {
  return <>
    <sprite scale={[size * 2.2, size * 2.2, 1]}>
      <spriteMaterial map={glowTexture("halo")} color={color} transparent opacity={raised ? 0.5 : 0.23} blending={AdditiveBlending} depthWrite={false} />
    </sprite>
    <sprite position={[0, kind === "character" ? 83 : size * 0.13, size * 0.3]} scale={[size * 0.85, size * 0.85, 1]}>
      <spriteMaterial map={glowTexture(kind)} color={color} transparent opacity={ghost ? 0.75 : 1} blending={AdditiveBlending} depthWrite={false} />
    </sprite>
  </>;
}
