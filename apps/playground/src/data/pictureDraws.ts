import type { WorldNode } from "../types.js";
import type { OrbitalDraw } from "./orbitalLayout.js";
import { placePictures, type OrbitIllustration } from "./pictureNodes.js";
import type { Position3 } from "./spatialLayout.js";

const labels: Record<string, string> = { cover: "Cover", plate: "Plate", story: "Illustration", paratext: "Paratext" };

export function pictureDraws(sourceNodes: WorldNode[], pictures: OrbitIllustration[], baseDraws: OrbitalDraw[]): OrbitalDraw[] {
  const scenes = sourceNodes.filter((node) => node.kind === "scene").sort((first, second) => first.chrono - second.chrono).map((node) => ({ id: node.id, chrono: node.chrono, sentenceIds: node.sentenceIds ?? [] }));
  const known = new Set(baseDraws.map((draw) => draw.node.id));
  const findDraw = (id: string) => baseDraws.find((draw) => draw.node.id === id) ?? baseDraws.find((draw) => draw.node.cluster?.ids.includes(id));
  const draws: OrbitalDraw[] = [];
  for (const placement of placePictures(scenes, pictures)) {
    if (!placement.placed || known.has(placement.pictureId)) continue;
    const previous = findDraw(placement.prevSceneId);
    const next = placement.nextSceneId ? findDraw(placement.nextSceneId) : undefined;
    if (!previous || next?.node.id === previous.node.id) continue;
    const radius = previous.radius * 0.9 || 16;
    let position: Position3;
    let facing: Position3;
    if (next) {
      facing = next.position.map((value, axis) => value - previous.position[axis]) as Position3;
      const distance = Math.hypot(...facing);
      const padding = Math.max(8, radius * 0.1);
      const start = (previous.radius + padding) / distance;
      const end = 1 - (next.radius + padding) / distance;
      if (!(distance > 0) || start >= end) continue;
      const previousScene = scenes.find((scene) => scene.id === placement.prevSceneId)!;
      const nextScene = scenes.find((scene) => scene.id === placement.nextSceneId)!;
      const fraction = Math.min(end, Math.max(start, (placement.chrono - previousScene.chrono) / Math.max(1, nextScene.chrono - previousScene.chrono)));
      position = previous.position.map((value, axis) => value + facing[axis] * fraction) as Position3;
    } else {
      facing = previous.facing ?? [1, 0, 0];
      const length = Math.hypot(...facing) || 1;
      position = previous.position.map((value, axis) => value + facing[axis] / length * (previous.radius + radius + 24)) as Position3;
    }
    draws.push({
      node: { id: placement.pictureId, label: labels[placement.kind] ?? "Picture", kind: "picture", state: "canon", parent: null, lane: "canon", chrono: placement.chrono, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] },
      role: "main", radius, position, facing, asset: placement.asset,
    });
    known.add(placement.pictureId);
  }
  return draws;
}
