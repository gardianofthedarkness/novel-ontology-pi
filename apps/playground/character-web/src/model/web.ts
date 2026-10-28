/**
 * The character relation web: one model behind both the web and the hall of
 * fame. Input mirrors the ontology (scenes with present/mentioned casts,
 * events with actors/affected, dialogue cards, CAUSES links and the
 * relationship part of StateChange deltas); output is view metrics, never
 * ontology facts. Sharing a scene or an exchange is evidence of contact, not a
 * KNOWS/SPEAKS_TO relation, so edges say what they are made of.
 */
/** `names` are every recorded form; `volumes` the books this character is recorded in. */
export interface WebCharacter { id: string; name: string; names: string[]; volumes: number[]; portrait?: string }
export interface WebScene { id: string; book: number; chapter: number; reading: number; story: number; place: string; title: string; present: string[]; mentioned: string[]; flashback?: boolean }
export interface WebEvent { id: string; sceneId: string; summary: string; importance: number; actors: string[]; affected: string[] }
export interface WebCard { id: string; sceneId: string; participants: string[]; summary: string }
/** One entry of a StateChange's `relationships` map: an additive affinity delta. */
export interface WebDelta { id: string; characterId: string; towardId: string; afterEventId: string; delta: number; note?: string }
export interface WebCause { from: string; to: string }
export interface WebData { title: string; books: { index: number; title: string }[]; characters: WebCharacter[]; scenes: WebScene[]; events: WebEvent[]; cards: WebCard[]; deltas: WebDelta[]; causes: WebCause[] }

export interface WebScope { book?: number; until?: number }

export type Tone = "bond" | "tension" | "neutral";
export interface WebEdge {
  id: string; a: string; b: string;
  scenes: number; cards: number; coActing: number; mentions: number; affinity: number;
  weight: number; tone: Tone; first: number; last: number;
}

export type Tier = "protagonist" | "pillar" | "connector" | "cameo";
export const TIERS: Tier[] = ["protagonist", "pillar", "connector", "cameo"];
export const TIER_LABEL: Record<Tier, string> = { protagonist: "Protagonists", pillar: "Pillars", connector: "Connectors", cameo: "Cameos" };

/** Each part is 0..1 against the strongest character in scope. */
export interface Breakdown { presence: number; agency: number; reach: number; influence: number; bridging: number }
export const BREAKDOWN_LABEL: Record<keyof Breakdown, string> = { presence: "Presence", agency: "Agency", reach: "Reach", influence: "Influence", bridging: "Bridging" };
export const BREAKDOWN_HELP: Record<keyof Breakdown, string> = {
  presence: "Scenes they are in (a mention counts a quarter)",
  agency: "Events they drive, weighted by importance",
  reach: "Distinct characters they share the story with",
  influence: "People their actions affect, plus events downstream through CAUSES",
  bridging: "Other groups of characters they connect to",
};
/** How much each part counts toward the connection score. */
export const WEIGHTS: Breakdown = { presence: 0.25, agency: 0.2, reach: 0.2, influence: 0.2, bridging: 0.15 };

export interface WebNode {
  id: string; name: string; portrait?: string;
  score: number; rank: number; tier: Tier; community: number;
  breakdown: Breakdown;
  raw: { scenes: number; mentionedIn: number; agency: number; partners: number; influence: number; bridges: number; books: number[] };
}
export interface CharacterWeb { nodes: WebNode[]; edges: WebEdge[]; byId: Map<string, WebNode>; scenes: WebScene[]; communities: number }

const pairKey = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const round = (value: number) => Math.round(value * 1000) / 1000;

/** Scenes in scope: one book or all, up to a story-time position. */
export function scopedScenes(data: WebData, scope: WebScope = {}): WebScene[] {
  return data.scenes.filter((scene) => (scope.book === undefined || scene.book === scope.book) && (scope.until === undefined || scene.story <= scope.until)).sort((x, y) => x.story - y.story || x.reading - y.reading);
}

/** Edge weight: what a pair shares, with affinity counted by size, not sign. */
export function edgeWeight(edge: Pick<WebEdge, "scenes" | "cards" | "coActing" | "mentions" | "affinity">): number {
  return edge.scenes + 1.5 * edge.cards + 2 * edge.coActing + 0.5 * edge.mentions + 3 * Math.abs(edge.affinity);
}

export function characterWeb(data: WebData, scope: WebScope = {}): CharacterWeb {
  const scenes = scopedScenes(data, scope);
  const sceneIds = new Set(scenes.map((scene) => scene.id));
  const sceneById = new Map(scenes.map((scene) => [scene.id, scene]));
  const events = data.events.filter((event) => sceneIds.has(event.sceneId));
  const eventIds = new Set(events.map((event) => event.id));
  const pairs = new Map<string, WebEdge>();
  const touch = (a: string, b: string, at: number, field: "scenes" | "cards" | "coActing" | "mentions", amount = 1) => {
    if (a === b) return;
    const id = pairKey(a, b);
    const [first, second] = id.split("|");
    const edge = pairs.get(id) ?? { id, a: first, b: second, scenes: 0, cards: 0, coActing: 0, mentions: 0, affinity: 0, weight: 0, tone: "neutral" as Tone, first: at, last: at };
    edge[field] += amount;
    edge.first = Math.min(edge.first, at);
    edge.last = Math.max(edge.last, at);
    pairs.set(id, edge);
  };
  for (const scene of scenes) {
    for (const [index, a] of scene.present.entries()) for (const b of scene.present.slice(index + 1)) touch(a, b, scene.story, "scenes");
    for (const a of scene.present) for (const b of scene.mentioned) touch(a, b, scene.story, "mentions");
  }
  for (const card of data.cards) {
    const scene = sceneById.get(card.sceneId);
    if (!scene) continue;
    for (const [index, a] of card.participants.entries()) for (const b of card.participants.slice(index + 1)) touch(a, b, scene.story, "cards");
  }
  for (const event of events) {
    const story = sceneById.get(event.sceneId)!.story;
    const involved = [...new Set([...event.actors, ...event.affected])];
    for (const [index, a] of involved.entries()) for (const b of involved.slice(index + 1)) if (event.actors.includes(a) || event.actors.includes(b)) touch(a, b, story, "coActing");
  }
  for (const delta of data.deltas) {
    if (!eventIds.has(delta.afterEventId)) continue;
    const edge = pairs.get(pairKey(delta.characterId, delta.towardId));
    if (edge) edge.affinity += delta.delta;
  }
  const edges = [...pairs.values()].map((edge) => {
    const affinity = round(edge.affinity);
    return { ...edge, affinity, weight: round(edgeWeight({ ...edge, affinity })), tone: (affinity > 0.15 ? "bond" : affinity < -0.15 ? "tension" : "neutral") as Tone };
  }).filter((edge) => edge.weight >= 1).sort((x, y) => y.weight - x.weight || x.id.localeCompare(y.id));

  const community = communities(data.characters.map((character) => character.id), edges);
  // Influence: each person their own actions affect, plus every event downstream of those actions through CAUSES.
  const next = new Map<string, string[]>();
  for (const cause of data.causes) if (eventIds.has(cause.from) && eventIds.has(cause.to)) next.set(cause.from, [...next.get(cause.from) ?? [], cause.to]);
  const downstream = (start: string[]) => {
    const seen = new Set<string>(), queue = [...start];
    while (queue.length) for (const id of next.get(queue.shift()!) ?? []) if (!seen.has(id)) { seen.add(id); queue.push(id); }
    return seen.size;
  };
  const raws = data.characters.map((character) => {
    const own = edges.filter((edge) => edge.a === character.id || edge.b === character.id);
    const partnerCommunities = new Set(own.map((edge) => community.get(edge.a === character.id ? edge.b : edge.a)));
    partnerCommunities.delete(community.get(character.id));
    const present = scenes.filter((scene) => scene.present.includes(character.id));
    return {
      character,
      raw: {
        scenes: present.length,
        mentionedIn: scenes.filter((scene) => scene.mentioned.includes(character.id)).length,
        agency: round(events.filter((event) => event.actors.includes(character.id)).reduce((sum, event) => sum + event.importance, 0)),
        partners: own.length,
        influence: events.filter((event) => event.actors.includes(character.id)).reduce((sum, event) => sum + event.affected.filter((id) => id !== character.id).length, 0)
          + downstream(events.filter((event) => event.actors.includes(character.id)).map((event) => event.id)),
        bridges: partnerCommunities.size,
        books: [...new Set(present.map((scene) => scene.book))].sort(),
      },
    };
  }).filter(({ raw }) => raw.scenes + raw.mentionedIn > 0);
  const max = (pick: (raw: WebNode["raw"]) => number) => Math.max(1e-9, ...raws.map(({ raw }) => pick(raw)));
  const top = { presence: max((raw) => raw.scenes + 0.25 * raw.mentionedIn), agency: max((raw) => raw.agency), reach: max((raw) => raw.partners), influence: max((raw) => raw.influence), bridging: max((raw) => raw.bridges) };
  const scored = raws.map(({ character, raw }) => {
    const breakdown: Breakdown = {
      presence: round((raw.scenes + 0.25 * raw.mentionedIn) / top.presence), agency: round(raw.agency / top.agency),
      reach: round(raw.partners / top.reach), influence: round(raw.influence / top.influence), bridging: round(raw.bridges / top.bridging),
    };
    const score = round((Object.keys(WEIGHTS) as (keyof Breakdown)[]).reduce((sum, key) => sum + WEIGHTS[key] * breakdown[key], 0));
    return { id: character.id, name: character.name, ...(character.portrait ? { portrait: character.portrait } : {}), score, rank: 0, tier: "cameo" as Tier, community: community.get(character.id) ?? 0, breakdown, raw };
  }).sort((x, y) => y.score - x.score || x.name.localeCompare(y.name));
  scored.forEach((node, index) => { node.rank = index + 1; node.tier = tierOf(node, index); });
  return { nodes: scored, edges, byId: new Map(scored.map((node) => [node.id, node])), scenes, communities: new Set(scored.map((node) => node.community)).size };
}

/**
 * Protagonists lead on score; pillars carry their own share of the story;
 * connectors matter more for whom they join than for how often they appear.
 */
export function tierOf(node: Pick<WebNode, "score" | "breakdown" | "raw">, index: number): Tier {
  if (index < 3 && node.score >= 0.55) return "protagonist";
  const bridging = node.raw.bridges >= 2 && node.breakdown.bridging >= 0.5;
  if (bridging && node.breakdown.bridging > node.breakdown.presence + 0.2) return "connector";
  if (node.score >= 0.25) return "pillar";
  return bridging ? "connector" : "cameo";
}

/**
 * Groups by modularity (Louvain's local-moving phase, in a fixed order): a
 * hub joins the group it shares most with instead of absorbing everyone.
 */
export function communities(ids: string[], edges: WebEdge[], resolution = 1): Map<string, number> {
  const adjacency = new Map<string, Map<string, number>>(ids.map((id) => [id, new Map()]));
  for (const edge of edges) {
    adjacency.get(edge.a)?.set(edge.b, edge.weight);
    adjacency.get(edge.b)?.set(edge.a, edge.weight);
  }
  const degree = new Map(ids.map((id) => [id, [...adjacency.get(id)!.values()].reduce((sum, weight) => sum + weight, 0)]));
  const twiceTotal = [...degree.values()].reduce((sum, value) => sum + value, 0) || 1;
  const group = new Map(ids.map((id, index) => [id, index]));
  const groupDegree = new Map(ids.map((id, index) => [index, degree.get(id)!]));
  const order = [...ids].sort((x, y) => degree.get(y)! - degree.get(x)! || x.localeCompare(y));
  for (let pass = 0; pass < 20; pass++) {
    let moved = false;
    for (const id of order) {
      const own = group.get(id)!, k = degree.get(id)!;
      if (!k) continue;
      const links = new Map<number, number>();
      for (const [other, weight] of adjacency.get(id)!) links.set(group.get(other)!, (links.get(group.get(other)!) ?? 0) + weight);
      groupDegree.set(own, groupDegree.get(own)! - k);
      const gain = (target: number) => (links.get(target) ?? 0) - (resolution * groupDegree.get(target)! * k) / twiceTotal;
      let best = own, bestGain = gain(own);
      for (const target of [...links.keys()].sort((x, y) => x - y)) if (gain(target) > bestGain + 1e-9) { best = target; bestGain = gain(target); }
      groupDegree.set(best, groupDegree.get(best)! + k);
      if (best !== own) { group.set(id, best); moved = true; }
    }
    if (!moved) break;
  }
  // Number groups by their strongest member's position in `ids`, so labels are stable.
  const dense = new Map<number, number>();
  for (const id of ids) if (!dense.has(group.get(id)!)) dense.set(group.get(id)!, dense.size);
  return new Map(ids.map((id) => [id, dense.get(group.get(id)!)!]));
}

export interface Placed { x: number; y: number; r: number }
/**
 * Rings by tier (protagonists at the heart), sectors by community, so a group
 * stays on one side as it moves between rings. Positions are in a unit square
 * centred on 0; the caller scales them.
 */
export const RING_RADIUS: Record<Tier, number> = { protagonist: 0.2, pillar: 0.44, connector: 0.67, cameo: 0.88 };
export function webLayout(web: CharacterWeb): Map<string, Placed> {
  const radius = RING_RADIUS;
  const groups = [...new Set(web.nodes.map((node) => node.community))].sort((x, y) => x - y);
  const size = new Map(groups.map((group) => [group, web.nodes.filter((node) => node.community === group).length]));
  const total = web.nodes.length || 1;
  const start = new Map<number, number>();
  let cursor = -Math.PI / 2;
  for (const group of groups) { start.set(group, cursor); cursor += (2 * Math.PI * size.get(group)!) / total; }
  const placed = new Map<string, Placed>();
  for (const tier of TIERS) {
    const ring = web.nodes.filter((node) => node.tier === tier);
    // The few protagonists share the heart evenly; grouping them by community would stack them.
    if (tier === "protagonist") {
      ring.forEach((node, index) => {
        const angle = -Math.PI / 2 + (2 * Math.PI * index) / ring.length;
        const r = ring.length === 1 ? 0 : radius.protagonist;
        placed.set(node.id, { x: round(Math.cos(angle) * r), y: round(Math.sin(angle) * r), r: round(0.035 + 0.05 * node.score) });
      });
      continue;
    }
    for (const group of groups) {
      const members = ring.filter((node) => node.community === group);
      const span = (2 * Math.PI * size.get(group)!) / total;
      members.forEach((node, index) => {
        const angle = start.get(group)! + span * ((index + 0.5) / members.length);
        const r = radius[tier];
        placed.set(node.id, { x: round(Math.cos(angle) * r), y: round(Math.sin(angle) * r), r: round(0.035 + 0.05 * node.score) });
      });
    }
  }
  return placed;
}

export type LogKind = "met" | "together" | "mentioned" | "shift";
export interface LogEntry {
  scene: WebScene; kind: LogKind;
  /** Who mentioned whom, for a "mentioned" entry. */
  speaker?: string;
  events: WebEvent[]; cards: WebCard[];
  shifts: (WebDelta & { running: number })[];
  affinity: number;
}
export interface PairHistory { a: string; b: string; entries: LogEntry[]; together: number; affinity: number; first?: WebScene; turning?: LogEntry }

/** Everything two characters share, in story order, with their running affinity. */
export function pairHistory(data: WebData, a: string, b: string, scope: WebScope = {}): PairHistory {
  const scenes = scopedScenes(data, scope);
  const eventsBy = new Map<string, WebEvent[]>();
  for (const event of data.events) eventsBy.set(event.sceneId, [...eventsBy.get(event.sceneId) ?? [], event]);
  const eventScene = new Map(data.events.map((event) => [event.id, event.sceneId]));
  const deltas = data.deltas.filter((delta) => (delta.characterId === a && delta.towardId === b) || (delta.characterId === b && delta.towardId === a));
  let running = 0, met = false;
  const entries: LogEntry[] = [];
  for (const scene of scenes) {
    const both = scene.present.includes(a) && scene.present.includes(b);
    const mention = !both && ((scene.present.includes(a) && scene.mentioned.includes(b)) ? a : (scene.present.includes(b) && scene.mentioned.includes(a)) ? b : undefined);
    const shared = (eventsBy.get(scene.id) ?? []).filter((event) => [a, b].every((id) => event.actors.includes(id) || event.affected.includes(id)));
    const shifts = deltas.filter((delta) => eventScene.get(delta.afterEventId) === scene.id).map((delta) => ({ ...delta, running: round(running += delta.delta) }));
    if (!both && !mention && !shifts.length) continue;
    const cards = data.cards.filter((card) => card.sceneId === scene.id && card.participants.includes(a) && card.participants.includes(b));
    entries.push({ scene, kind: both ? (met ? (shifts.length ? "shift" : "together") : "met") : mention ? "mentioned" : "shift", ...(mention ? { speaker: mention } : {}), events: shared, cards, shifts, affinity: round(running) });
    if (both) met = true;
  }
  const turning = entries.filter((entry) => entry.shifts.length).sort((x, y) => Math.abs(y.shifts.reduce((s, d) => s + d.delta, 0)) - Math.abs(x.shifts.reduce((s, d) => s + d.delta, 0)))[0];
  return { a, b, entries, together: entries.filter((entry) => entry.kind !== "mentioned" && (entry.scene.present.includes(a) && entry.scene.present.includes(b))).length, affinity: round(running), first: entries.find((entry) => entry.kind === "met")?.scene, ...(turning ? { turning } : {}) };
}

/** A character's own line through the story: where they are, and what they do. */
export function characterArc(data: WebData, id: string, scope: WebScope = {}) {
  return scopedScenes(data, scope).filter((scene) => scene.present.includes(id) || scene.mentioned.includes(id)).map((scene) => ({
    scene, present: scene.present.includes(id),
    events: data.events.filter((event) => event.sceneId === scene.id && (event.actors.includes(id) || event.affected.includes(id))),
  }));
}
