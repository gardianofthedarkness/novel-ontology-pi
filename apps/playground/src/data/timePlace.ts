/**
 * Story time and places (time-place faculty, phase 1) — viewer data and
 * pure helpers for the Story time and Places views. The snapshot's
 * `timePlace` projection carries the facts; everything here is layout.
 */
export interface StoryTime {
  id: string;
  label: string;
  gloss: string;
  family: string;
  role: string;
  flashback: boolean;
  flashbackProbability: number;
  decidedBy: string | null;
  toldFromId: string | null;
  date: { year?: number; month?: number; day?: number; derived: boolean } | null;
  partOfDay: string | null;
  chapterIndex: number;
  storyIndex: number;
  narrativeIndex: number;
  anchorSceneId: string | null;
  sceneIds: string[];
  /** Proposed by the faculty, still awaiting review (not canon). */
  proposed?: boolean;
  /** Universe views: the book (volume) and continuity this period belongs to. */
  book?: number;
  continuityId?: string | null;
}
export interface StoryScene {
  id: string;
  index: number;
  chapterIndex: number;
  label: string;
  times: { id: string; via: "anchor" | "inherited" }[];
  flashback: boolean;
  placeIds: string[];
  placeCarried: boolean;
  characterIds: string[];
  /** Universe views: the book (volume) and continuity of this scene. */
  book?: number;
  continuityId?: string | null;
}
export interface StoryPlace {
  id: string; label: string; sceneIds: string[]; statedScenes: number; characterIds: string[];
  /** Proposed, awaiting review. */ proposed?: boolean;
  /** Place tree (phase 2): the place this one is inside, its depth and root-first path of ids. */
  parentId?: string | null; parentProposed?: boolean; depth?: number; path?: string[];
  /** Scenes here or anywhere inside this place. */ totalScenes?: number;
  /** A generic place ("车站前") that exists only inside its named parent. */ generic?: boolean;
  /** Universe views: the books it appears in, and its book places (`<volume>:<id>`). */ books?: number[]; members?: string[];
}
export interface UniverseBook { volume: number; sourceId: string; title: string; continuityId: string | null; readingOrder: number | null }
export interface TimePlaceProjection {
  available: boolean;
  times: StoryTime[];
  scenes: StoryScene[];
  places: StoryPlace[];
  characters: { id: string; label: string; scenes: number }[];
  /** Display names for every place and character the scenes refer to. */
  names: Record<string, string>;
  /** "universe": every hosted book of the reader's universe, ids qualified by volume (`<volume>:<id>`, places `u:…`). */
  scope?: "book" | "universe";
  universe?: { id: string; title: string };
  books?: UniverseBook[];
  continuities?: { id: string; title: string }[];
}

/** Map one book's ids into a universe projection (identity for a book projection). */
export function universeIds(data: TimePlaceProjection | null | undefined, volume: number | null) {
  if (data?.scope !== "universe" || volume === null) return { scene: (id: string) => id, time: (id: string) => id, place: (id: string) => id };
  const placeOf = new Map((data.places ?? []).flatMap((place) => (place.members ?? []).map((member) => [member, place.id] as const)));
  return { scene: (id: string) => `${volume}:${id}`, time: (id: string) => `${volume}:${id}`, place: (id: string) => placeOf.get(`${volume}:${id}`) ?? id };
}

export const PART_OF_DAY: Record<string, string> = { dawn: "dawn", morning: "morning", noon: "noon", afternoon: "afternoon", evening: "evening", night: "night", "late-night": "late night", "after-school": "after school", daytime: "daytime" };

/** "12-25 · morning (derived)" — what we know of a period's calendar position. */
export function dateLine(time: Pick<StoryTime, "date" | "partOfDay">): string {
  const date = time.date && (time.date.month || time.date.year) ? [time.date.year, time.date.month && String(time.date.month).padStart(2, "0"), time.date.day && String(time.date.day).padStart(2, "0")].filter(Boolean).join("-") : "";
  const part = time.partOfDay ? PART_OF_DAY[time.partOfDay] ?? time.partOfDay : "";
  return [date, part].filter(Boolean).join(" · ") + (date && time.date?.derived ? " (derived)" : "");
}

/** Rows for the story spine: story order, with "time not stated" first when any scene lacks a period. */
export function storyRows(data: TimePlaceProjection): { time: StoryTime | null; scenes: StoryScene[] }[] {
  const byId = new Map(data.scenes.map((scene) => [scene.id, scene]));
  const rows = data.times.map((time) => ({ time, scenes: time.sceneIds.map((id) => byId.get(id)!).filter(Boolean).sort((first, second) => first.index - second.index) }));
  const unplaced = data.scenes.filter((scene) => !scene.times.length);
  return unplaced.length ? [{ time: null, scenes: unplaced }, ...rows] : rows;
}

/** Universe story rows: each continuity in turn; within it, books in reading order, each book's
 * "time not stated" scenes just before its own periods (no cross-book reordering is invented). */
export function universeStoryRows(data: TimePlaceProjection): { time: StoryTime | null; scenes: StoryScene[]; book: number | null; continuityId: string | null }[] {
  const byId = new Map(data.scenes.map((scene) => [scene.id, scene]));
  const lanes = [...(data.continuities ?? []).map((continuity) => continuity.id as string | null), null];
  const rows: { time: StoryTime | null; scenes: StoryScene[]; book: number | null; continuityId: string | null }[] = [];
  for (const lane of lanes) {
    const books = (data.books ?? []).filter((book) => (book.continuityId ?? null) === lane || lane === null && !lanes.includes(book.continuityId ?? null)).sort((first, second) => (first.readingOrder ?? Infinity) - (second.readingOrder ?? Infinity) || first.volume - second.volume);
    for (const book of books) {
      const unplaced = data.scenes.filter((scene) => scene.book === book.volume && !scene.times.length).sort((first, second) => first.index - second.index);
      if (unplaced.length) rows.push({ time: null, scenes: unplaced, book: book.volume, continuityId: lane });
      for (const time of data.times.filter((entry) => entry.book === book.volume).sort((first, second) => first.storyIndex - second.storyIndex)) {
        rows.push({ time, scenes: time.sceneIds.map((id) => byId.get(id)!).filter(Boolean).sort((first, second) => first.index - second.index), book: book.volume, continuityId: lane });
      }
    }
  }
  return rows;
}

/** Each scene's main period: its own anchor if it has one, else the last inherited. */
export function scenePeriod(scene: StoryScene): string | null {
  return scene.times.find((time) => time.via === "anchor")?.id ?? scene.times.at(-1)?.id ?? null;
}

/** Where reading order runs backwards in story time (a flashback is read). */
export function readingJumps(data: TimePlaceProjection): { sceneId: string; from: number; to: number }[] {
  const story = new Map(data.times.map((time) => [time.id, time.storyIndex]));
  const jumps: { sceneId: string; from: number; to: number }[] = [];
  let previous: number | null = null;
  for (const scene of [...data.scenes].sort((first, second) => first.index - second.index)) {
    const period = scenePeriod(scene);
    const current = period ? story.get(period) ?? null : null;
    if (current !== null && previous !== null && current < previous) jumps.push({ sceneId: scene.id, from: previous, to: current });
    if (current !== null) previous = current;
  }
  return jumps;
}

/** A character's route through places, in story order (stated and carried visits). */
export function characterTrack(data: TimePlaceProjection, characterId: string): { placeId: string; sceneIds: string[]; carried: boolean; timeLabel: string }[] {
  const story = new Map(data.times.map((time) => [time.id, time]));
  const ranked = data.scenes.filter((scene) => scene.characterIds.includes(characterId) && scene.placeIds.length)
    .map((scene) => ({ scene, rank: story.get(scenePeriod(scene) ?? "")?.storyIndex ?? -1 }))
    .sort((first, second) => first.rank - second.rank || first.scene.index - second.scene.index);
  const steps: { placeId: string; sceneIds: string[]; carried: boolean; timeLabel: string }[] = [];
  for (const { scene } of ranked) {
    const placeId = scene.placeIds[0];
    const last = steps.at(-1);
    const timeLabel = story.get(scenePeriod(scene) ?? "")?.label ?? "time not stated";
    if (last && last.placeId === placeId) { last.sceneIds.push(scene.id); last.carried &&= scene.placeCarried; continue; }
    steps.push({ placeId, sceneIds: [scene.id], carried: scene.placeCarried, timeLabel });
  }
  return steps;
}

/** Where each character is during one story period (their latest scene in it). */
export function whereDuring(data: TimePlaceProjection, timeId: string): Map<string, { placeId: string; carried: boolean }> {
  const result = new Map<string, { placeId: string; carried: boolean }>();
  for (const scene of data.scenes.filter((entry) => entry.times.some((time) => time.id === timeId) && entry.placeIds.length).sort((first, second) => first.index - second.index)) {
    for (const id of scene.characterIds) result.set(id, { placeId: scene.placeIds[0], carried: scene.placeCarried });
  }
  return result;
}

/** Movement between places: consecutive scenes (reading order) at different places. */
export function placeLinks(data: TimePlaceProjection): { from: string; to: string; count: number }[] {
  const counts = new Map<string, number>();
  const ordered = [...data.scenes].sort((first, second) => first.index - second.index).filter((scene) => scene.placeIds.length);
  for (let index = 1; index < ordered.length; index++) {
    const from = ordered[index - 1].placeIds[0], to = ordered[index].placeIds[0];
    if (from === to) continue;
    const key = [from, to].sort().join("\u0000");
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts].map(([key, count]) => { const [from, to] = key.split("\u0000"); return { from, to, count }; });
}

/**
 * Deterministic schematic layout (no geography): busy places toward the
 * centre, linked places pulled together, all others pushed apart.
 */
export function placeLayout(places: StoryPlace[], links: { from: string; to: string; count: number }[], size = 600): Map<string, { x: number; y: number; r: number }> {
  const nodes = places.map((place, index) => {
    const angle = index * 2.399963; // golden angle spiral start
    const radius = 40 + 22 * Math.sqrt(index);
    return { id: place.id, x: size / 2 + Math.cos(angle) * radius, y: size / 2 + Math.sin(angle) * radius, r: 8 + 4 * Math.sqrt(place.sceneIds.length) };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (let step = 0; step < 220; step++) {
    const cooling = 1 - step / 240;
    for (const first of nodes) for (const second of nodes) {
      if (first === second) continue;
      const dx = first.x - second.x, dy = first.y - second.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const push = (first.r + second.r + 36) ** 2 / distance / distance * 2.4 * cooling;
      first.x += dx / distance * push; first.y += dy / distance * push;
    }
    for (const link of links) {
      const from = byId.get(link.from), to = byId.get(link.to);
      if (!from || !to) continue;
      const dx = to.x - from.x, dy = to.y - from.y;
      const distance = Math.max(1, Math.hypot(dx, dy));
      const pull = (distance - (from.r + to.r + 50)) * 0.02 * Math.min(3, link.count) * cooling;
      from.x += dx / distance * pull; from.y += dy / distance * pull;
      to.x -= dx / distance * pull; to.y -= dy / distance * pull;
    }
    for (const node of nodes) {
      node.x += (size / 2 - node.x) * 0.01; node.y += (size / 2 - node.y) * 0.01;
      node.x = Math.min(size - node.r - 4, Math.max(node.r + 4, node.x)); node.y = Math.min(size - node.r - 4, Math.max(node.r + 4, node.y));
    }
  }
  // Fill the canvas: scale the settled layout to the available box (labels need a margin).
  const margin = 56;
  const xs = nodes.map((node) => node.x), ys = nodes.map((node) => node.y);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const scale = Math.min(3, (size - 2 * margin) / Math.max(1, maxX - minX), (size - 2 * margin) / Math.max(1, maxY - minY));
  const offsetX = (size - (maxX - minX) * scale) / 2, offsetY = (size - (maxY - minY) * scale) / 2;
  return new Map(nodes.map((node) => [node.id, { x: Math.round(offsetX + (node.x - minX) * scale), y: Math.round(offsetY + (node.y - minY) * scale), r: Math.round(node.r) }]));
}

/** "星城 › 东区 › 医院": a place as its path through the place tree. */
export function placePathLabel(place: Pick<StoryPlace, "id" | "label" | "path"> | undefined, names: Map<string, string> | Record<string, string>): string {
  if (!place) return "";
  const name = (id: string) => (names instanceof Map ? names.get(id) : names[id]) ?? id;
  return (place.path?.length ? place.path : [place.id]).map((id) => id === place.id ? place.label : name(id)).join(" › ");
}

export interface PlaceSpot {
  /** Centre and radius of the place's circle; a region's circle holds its children. */
  x: number; y: number; r: number; depth: number; region: boolean;
  /** Where the place's own scenes, label and routes attach: the centre of a
   * leaf, just inside the upper rim of a region (clear of its children). */
  spotX: number; spotY: number;
}

/** Compact, deterministic circle packing around the origin: overlapping
 * circles push apart, linked ones pull together, everything falls inward. */
function packCircles(nodes: { id: string; r: number }[], links: { from: string; to: string; count: number }[], gap: number): Map<string, { x: number; y: number }> {
  const mean = nodes.reduce((sum, node) => sum + node.r, 0) / Math.max(1, nodes.length);
  const items = nodes.map((node, index) => ({ ...node, x: Math.cos(index * 2.399963) * (mean + gap) * 1.3 * Math.sqrt(index), y: Math.sin(index * 2.399963) * (mean + gap) * 1.3 * Math.sqrt(index) }));
  const byId = new Map(items.map((item) => [item.id, item]));
  for (let step = 0; step < 300; step++) {
    const cooling = 1 - step / 320;
    for (const item of items) { item.x -= item.x * 0.03 * cooling; item.y -= item.y * 0.03 * cooling; }
    for (const link of links) {
      const from = byId.get(link.from), to = byId.get(link.to);
      if (!from || !to) continue;
      const dx = to.x - from.x, dy = to.y - from.y, distance = Math.max(1, Math.hypot(dx, dy));
      const pull = (distance - (from.r + to.r + gap * 2)) * 0.01 * Math.min(3, link.count) * cooling;
      if (pull <= 0) continue;
      from.x += dx / distance * pull; from.y += dy / distance * pull; to.x -= dx / distance * pull; to.y -= dy / distance * pull;
    }
    for (let first = 0; first < items.length; first++) for (let second = first + 1; second < items.length; second++) {
      const a = items[first], b = items[second];
      let dx = b.x - a.x, dy = b.y - a.y;
      if (!dx && !dy) { dx = 0.5; dy = 0.3; }
      const distance = Math.hypot(dx, dy), least = a.r + b.r + gap;
      if (distance >= least) continue;
      const push = (least - distance) / 2;
      a.x -= dx / distance * push; a.y -= dy / distance * push; b.x += dx / distance * push; b.y += dy / distance * push;
    }
  }
  if (items.length) {
    // Centre the cluster on its enclosing box.
    const cx = (Math.min(...items.map((item) => item.x - item.r)) + Math.max(...items.map((item) => item.x + item.r))) / 2;
    const cy = (Math.min(...items.map((item) => item.y - item.r)) + Math.max(...items.map((item) => item.y + item.r))) / 2;
    for (const item of items) { item.x -= cx; item.y -= cy; }
  }
  return new Map(items.map((item) => [item.id, { x: item.x, y: item.y }]));
}

/**
 * The place tree as nested circles (schematic, not geography): each place
 * that contains others is a region whose circle packs its children; busy
 * places are larger; places linked by moves sit closer. Without parents
 * every place is a top-level circle, as before the tree.
 */
export function placeTreeLayout(places: StoryPlace[], links: { from: string; to: string; count: number }[], size = 600): Map<string, PlaceSpot> {
  const ids = new Set(places.map((place) => place.id));
  const byId = new Map(places.map((place) => [place.id, place]));
  const parentOf = (place: StoryPlace) => place.parentId && ids.has(place.parentId) && place.parentId !== place.id ? place.parentId : null;
  const children = new Map<string, StoryPlace[]>();
  const roots: StoryPlace[] = [];
  for (const place of places) { const parent = parentOf(place); if (parent) children.set(parent, [...(children.get(parent) ?? []), place]); else roots.push(place); }
  const pathOf = (id: string) => { const path: string[] = []; const seen = new Set<string>(); for (let at: string | null = id; at && !seen.has(at); at = byId.get(at) ? parentOf(byId.get(at)!) : null) { seen.add(at); path.unshift(at); } return path; };
  /** Moves lifted to the circles packed together at one level. */
  const lifted = (level: Set<string>) => {
    const counts = new Map<string, number>();
    for (const link of links) {
      const from = pathOf(link.from).find((id) => level.has(id)), to = pathOf(link.to).find((id) => level.has(id));
      if (!from || !to || from === to) continue;
      const key = [from, to].sort().join("\u0000");
      counts.set(key, (counts.get(key) ?? 0) + link.count);
    }
    return [...counts].map(([key, count]) => { const [from, to] = key.split("\u0000"); return { from, to, count }; });
  };
  const radius = new Map<string, number>();
  const offset = new Map<string, { x: number; y: number }>();
  const LABEL = 16, GAP = 22;
  const measure = (place: StoryPlace, seen: Set<string>): number => {
    const own = 8 + 4 * Math.sqrt(place.sceneIds.length);
    const kids = (children.get(place.id) ?? []).filter((kid) => !seen.has(kid.id));
    if (!kids.length) { radius.set(place.id, own); return own; }
    for (const kid of kids) measure(kid, new Set([...seen, place.id]));
    const packed = packCircles(kids.map((kid) => ({ id: kid.id, r: radius.get(kid.id)! })), lifted(new Set(kids.map((kid) => kid.id))), GAP);
    // Children sit a little low, leaving the upper rim for the region's label and own scenes.
    let enclose = 0;
    for (const kid of kids) { const at = packed.get(kid.id)!; offset.set(kid.id, { x: at.x, y: at.y + LABEL / 2 }); enclose = Math.max(enclose, Math.hypot(at.x, at.y + LABEL / 2) + radius.get(kid.id)!); }
    const r = Math.max(own * 2, enclose + LABEL + 6);
    radius.set(place.id, r);
    return r;
  };
  for (const root of roots) measure(root, new Set());
  const top = packCircles(roots.map((root) => ({ id: root.id, r: radius.get(root.id)! })), lifted(new Set(roots.map((root) => root.id))), 36);
  const absolute = new Map<string, { x: number; y: number }>();
  const place = (id: string, at: { x: number; y: number }, seen: Set<string>) => {
    absolute.set(id, at);
    for (const kid of children.get(id) ?? []) if (!seen.has(kid.id) && offset.has(kid.id)) place(kid.id, { x: at.x + offset.get(kid.id)!.x, y: at.y + offset.get(kid.id)!.y }, new Set([...seen, id]));
  };
  for (const root of roots) place(root.id, top.get(root.id) ?? { x: 0, y: 0 }, new Set());
  const placed = places.filter((entry) => absolute.has(entry.id));
  if (!placed.length) return new Map();
  // Fit the canvas (labels below leaves need a margin).
  const margin = 40;
  const [minX, maxX] = [Math.min(...placed.map((entry) => absolute.get(entry.id)!.x - radius.get(entry.id)!)), Math.max(...placed.map((entry) => absolute.get(entry.id)!.x + radius.get(entry.id)!))];
  const [minY, maxY] = [Math.min(...placed.map((entry) => absolute.get(entry.id)!.y - radius.get(entry.id)!)), Math.max(...placed.map((entry) => absolute.get(entry.id)!.y + radius.get(entry.id)! + 14))];
  const scale = Math.min(3, (size - 2 * margin) / Math.max(1, maxX - minX), (size - 2 * margin) / Math.max(1, maxY - minY));
  const offsetX = (size - (maxX - minX) * scale) / 2, offsetY = (size - (maxY - minY) * scale) / 2;
  return new Map(placed.map((entry) => {
    const at = absolute.get(entry.id)!, r = radius.get(entry.id)! * scale;
    const x = offsetX + (at.x - minX) * scale, y = offsetY + (at.y - minY) * scale;
    const region = (children.get(entry.id) ?? []).length > 0;
    return [entry.id, { x: Math.round(x), y: Math.round(y), r: Math.round(r), depth: pathOf(entry.id).length - 1, region, spotX: Math.round(x), spotY: Math.round(region ? y - r + Math.min(44, r) : y) }];
  }));
}

/**
 * What a live update established in story time and places: periods and
 * places that are new, or that were proposed and are now confirmed. Drives
 * the follow-Pi tab switch and the "just emerged" highlight.
 */
export function timePlaceEmergence(previous: TimePlaceProjection | null, next: TimePlaceProjection): { times: string[]; places: string[] } {
  if (!previous) return { times: [], places: [] };
  const before = <T extends { id: string; proposed?: boolean }>(rows: T[]) => new Map(rows.map((row) => [row.id, !!row.proposed]));
  const times = before(previous.times), places = before(previous.places);
  const fresh = <T extends { id: string; proposed?: boolean }>(rows: T[], seen: Map<string, boolean>) => rows.filter((row) => !seen.has(row.id) || (seen.get(row.id) && !row.proposed)).map((row) => row.id);
  return { times: fresh(next.times, times), places: fresh(next.places, places) };
}

export type FollowView = "narrative" | "story" | "places";
/**
 * Which view following Pi should show. Time-place facts that just emerged
 * win (periods before places); Pi running the time-place faculty points to
 * Story time; any other new work points to Narrative.
 */
export function followTarget(change: { times: string[]; places: string[] }, command: { label: string; status: string } | null | undefined, otherWork: boolean): FollowView | null {
  if (change.times.length) return "story";
  if (change.places.length) return "places";
  if (command && /\btimeplace\b/.test(command.label) && command.status === "working") return "story";
  return otherWork ? "narrative" : null;
}
