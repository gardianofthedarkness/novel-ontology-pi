import type { Relation } from "./types.js";

/**
 * Place tree (time-place faculty, phase 2). A place is not a single point
 * but a path: Location -PART_OF-> Location links each place to the one
 * place it is inside (child -> parent). The links form a strict tree — one
 * parent per place, no cycles — so every place has exactly one path to its
 * root. Scenes are LOCATED_AT their most specific place; the ancestors are
 * implied by the tree and never stored on the scene.
 */
export function parentMap(relations: Pick<Relation, "fromId" | "toId" | "type">[]): Map<string, string> {
  const parents = new Map<string, string>();
  for (const relation of relations) if (relation.type === "PART_OF" && !parents.has(relation.fromId)) parents.set(relation.fromId, relation.toId);
  return parents;
}

/** Why adding these PART_OF links would break the tree, or null when they keep it. */
export function treeViolation(existing: Pick<Relation, "fromId" | "toId" | "type">[], added: Pick<Relation, "fromId" | "toId" | "type">[]): string | null {
  const parents = parentMap(existing);
  for (const relation of added.filter((entry) => entry.type === "PART_OF")) {
    if (relation.fromId === relation.toId) return `A place cannot be inside itself (${relation.fromId}).`;
    const current = parents.get(relation.fromId);
    if (current && current !== relation.toId) return `${relation.fromId} already has a parent place (${current}); a place has exactly one parent. Hold one of them.`;
    parents.set(relation.fromId, relation.toId);
  }
  for (const start of parents.keys()) {
    const seen = new Set<string>();
    for (let at: string | undefined = start; at; at = parents.get(at)) {
      if (seen.has(at)) return `PART_OF links form a loop through ${at}; a place cannot contain its own ancestor.`;
      seen.add(at);
    }
  }
  return null;
}

/** Root-first path of place ids ending at `id` (stops on a loop). */
export function placePath(id: string, parents: Map<string, string>): string[] {
  const path: string[] = [];
  const seen = new Set<string>();
  for (let at: string | undefined = id; at && !seen.has(at); at = parents.get(at)) { seen.add(at); path.unshift(at); }
  return path;
}

export function isAncestor(ancestor: string, of: string, parents: Map<string, string>): boolean {
  const seen = new Set<string>();
  for (let at = parents.get(of); at && !seen.has(at); at = parents.get(at)) { if (at === ancestor) return true; seen.add(at); }
  return false;
}

/** Drop places that are ancestors of another place in the set: the deepest ones remain. */
export function mostSpecific(ids: Iterable<string>, parents: Map<string, string>): string[] {
  const list = [...new Set(ids)];
  return list.filter((id) => !list.some((other) => other !== id && isAncestor(id, other, parents)));
}
