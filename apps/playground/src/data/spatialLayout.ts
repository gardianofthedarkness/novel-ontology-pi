import type { WorldEdge, WorldNode } from "../types.js";

export type Position3 = [number, number, number];
export interface Affinity { from: string; to: string; strength: number }

const edgeWeight = (edge: WorldEdge) => {
  const supplied = edge.weight;
  return supplied !== undefined && Number.isFinite(supplied) && supplied > 0
    ? Math.min(supplied, 100)
    : edge.kind === "contains" ? 1.4 : edge.kind === "speaks" ? 1.2 : edge.kind === "flow" ? 0.65 : 0.8;
};

export function relationshipAffinities(nodes: WorldNode[], edges: WorldEdge[]): Affinity[] {
  const adjacent = new Map(nodes.map((node) => [node.id, new Map<string, number>()]));
  for (const edge of [...edges].sort((first, second) => first.id.localeCompare(second.id))) {
    if (edge.from === edge.to || !adjacent.has(edge.from) || !adjacent.has(edge.to)) continue;
    const weight = edgeWeight(edge);
    for (const [from, to] of [[edge.from, edge.to], [edge.to, edge.from]]) {
      const neighbors = adjacent.get(from)!;
      neighbors.set(to, (neighbors.get(to) ?? 0) + weight);
    }
  }
  const bounded = new Map([...adjacent].map(([id, neighbors]) => [id, [...neighbors].sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0])).slice(0, 24)]));
  const pairs = new Map<string, Affinity>();
  for (const node of [...nodes].sort((first, second) => first.id.localeCompare(second.id))) {
    const direct = adjacent.get(node.id)!;
    const scores = new Map([...direct].map(([id, weight]) => [id, Math.log1p(weight)]));
    for (const [neighbor, weight] of bounded.get(node.id)!) {
      const degree = adjacent.get(neighbor)!.size;
      for (const [other, nextWeight] of bounded.get(neighbor)!) {
        if (other === node.id) continue;
        const shared = 0.45 * Math.sqrt(Math.log1p(weight) * Math.log1p(nextWeight)) / Math.sqrt(Math.max(1, degree - 1));
        scores.set(other, (scores.get(other) ?? 0) + shared);
      }
    }
    const indirect = [...scores].filter(([id]) => !direct.has(id)).sort((first, second) => second[1] - first[1] || first[0].localeCompare(second[0])).slice(0, 12);
    for (const [other, strength] of [...scores].filter(([id]) => direct.has(id)).concat(indirect)) {
      const [from, to] = [node.id, other].sort();
      const key = JSON.stringify([from, to]);
      const previous = pairs.get(key);
      if (!previous || strength > previous.strength) pairs.set(key, { from, to, strength });
    }
  }
  return [...pairs.values()].sort((first, second) => first.from.localeCompare(second.from) || first.to.localeCompare(second.to));
}

function direction(id: string): Position3 {
  let hash = 2166136261;
  for (const character of id) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  hash = Math.imul(hash ^ hash >>> 16, 0x85ebca6b);
  hash = Math.imul(hash ^ hash >>> 13, 0xc2b2ae35);
  hash = (hash ^ hash >>> 16) >>> 0;
  const vertical = ((hash % 2001) / 1000 - 1) * 0.92;
  const angle = (hash / 4294967296) * Math.PI * 2;
  const radius = Math.sqrt(1 - vertical * vertical);
  return [Math.cos(angle) * radius, vertical, Math.sin(angle) * radius];
}

export function arrangeRelationships(nodes: WorldNode[], edges: WorldEdge[], anchors: Map<string, Position3>, options: { centers?: Map<string, Position3> } = {}): Map<string, Position3> {
  const records = [...nodes].sort((first, second) => first.id.localeCompare(second.id));
  const affinities = relationshipAffinities(records, edges);
  const adjacent = new Map(records.map((node) => [node.id, [] as { id: string; strength: number }[]]));
  for (const affinity of affinities) {
    adjacent.get(affinity.from)!.push({ id: affinity.to, strength: affinity.strength });
    adjacent.get(affinity.to)!.push({ id: affinity.from, strength: affinity.strength });
  }
  const positions = new Map<string, Position3>([...anchors].map(([id, position]) => [id, [...position]]));
  const centers = new Map<string, Position3>(options.centers);
  const pending = records.filter((node) => !anchors.has(node.id));
  for (let round = 0; round < 6; round++) {
    const discovered = new Map<string, Position3>();
    for (const node of pending) {
      if (centers.has(node.id)) continue;
      const connected = adjacent.get(node.id)!.filter((neighbor) => anchors.has(neighbor.id) || centers.has(neighbor.id));
      if (!connected.length) continue;
      const total = connected.reduce((sum, neighbor) => sum + neighbor.strength, 0);
      discovered.set(node.id, [0, 1, 2].map((axis) => connected.reduce((sum, neighbor) => sum + (anchors.get(neighbor.id) ?? centers.get(neighbor.id))![axis] * neighbor.strength, 0) / total) as Position3);
    }
    for (const [id, position] of discovered) centers.set(id, position);
  }
  const radius = 110 + Math.sqrt(pending.length) * 13;
  for (const node of pending) {
    const center = centers.get(node.id) ?? [0, 0, 0];
    centers.set(node.id, center);
    const unit = direction(node.id);
    positions.set(node.id, center.map((value, axis) => value + unit[axis] * radius) as Position3);
  }
  for (let iteration = 0; iteration < 90; iteration++) {
    const forces = new Map(pending.map((node) => [node.id, [0, 0, 0] as Position3]));
    for (const affinity of affinities) {
      const first = positions.get(affinity.from)!;
      const second = positions.get(affinity.to)!;
      const delta = second.map((value, axis) => value - first[axis]);
      const distance = Math.max(1, Math.hypot(...delta));
      const target = 70 + 135 / (1 + affinity.strength);
      const spring = Math.min(3, affinity.strength) * (distance - target) * 0.025;
      for (let axis = 0; axis < 3; axis++) {
        if (forces.has(affinity.from)) forces.get(affinity.from)![axis] += delta[axis] / distance * spring;
        if (forces.has(affinity.to)) forces.get(affinity.to)![axis] -= delta[axis] / distance * spring;
      }
    }
    const cells = new Map<string, WorldNode[]>();
    const cellSize = 100;
    for (const node of records) {
      const position = positions.get(node.id)!;
      const key = position.map((value) => Math.floor(value / cellSize)).join(",");
      const occupants = cells.get(key) ?? [];
      occupants.push(node);
      cells.set(key, occupants);
    }
    for (const node of pending) {
      const position = positions.get(node.id)!;
      const force = forces.get(node.id)!;
      const cell = position.map((value) => Math.floor(value / cellSize));
      for (let horizontal = -1; horizontal <= 1; horizontal++) for (let vertical = -1; vertical <= 1; vertical++) for (let depth = -1; depth <= 1; depth++) {
        const neighbors = cells.get([cell[0] + horizontal, cell[1] + vertical, cell[2] + depth].join(",")) ?? [];
        for (const other of neighbors) {
          if (other.id === node.id) continue;
          const delta = position.map((value, axis) => value - positions.get(other.id)![axis]);
          const distance = Math.max(0.01, Math.hypot(...delta));
          const clearance = other.kind === "bigEvent" ? 115 : 88;
          if (distance >= clearance) continue;
          const unit = distance <= 0.01 ? direction(`${node.id}:${other.id}`) : delta.map((value) => value / distance);
          for (let axis = 0; axis < 3; axis++) force[axis] += unit[axis] * (clearance - distance) * 0.3;
        }
      }
      const center = centers.get(node.id)!;
      const offset = position.map((value, axis) => value - center[axis]);
      const distance = Math.max(1, Math.hypot(...offset));
      const shell = (radius * 0.6 - distance) * 0.012;
      for (let axis = 0; axis < 3; axis++) force[axis] += offset[axis] / distance * shell - offset[axis] * 0.0015;
    }
    const cooling = 1 - iteration / 110;
    for (const node of pending) {
      const force = forces.get(node.id)!;
      const length = Math.max(1, Math.hypot(...force) / 18);
      const position = positions.get(node.id)!;
      for (let axis = 0; axis < 3; axis++) position[axis] += force[axis] / length * cooling;
    }
  }
  return positions;
}
