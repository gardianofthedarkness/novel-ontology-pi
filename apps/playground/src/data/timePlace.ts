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
  /** A stated clock time ("下午三点" → 15:00). */
  clock?: { hour: number; minute: number };
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
  /** Answered "nobody known is here, someone else is": strands never borrow a cast for it. */
  alone?: boolean;
  /** Universe views: the book (volume) and continuity of this scene. */
  book?: number;
  continuityId?: string | null;
}
import type { ArchitectureKind } from "./placeArchitecture.js";

export interface StoryPlace {
  id: string; label: string; sceneIds: string[]; statedScenes: number; characterIds: string[];
  /** Proposed, awaiting review. */ proposed?: boolean;
  /** Place tree (phase 2): the place this one is inside, its depth and root-first path of ids. */
  parentId?: string | null; parentProposed?: boolean; depth?: number; path?: string[];
  /** Scenes here or anywhere inside this place. */ totalScenes?: number;
  /** A generic place ("车站前") that exists only inside its named parent. */ generic?: boolean;
  /** Universe views: the books it appears in, and its book places (`<volume>:<id>`). */ books?: number[]; members?: string[];
  /** The building a decision model picked from the name's shortlist ("none": not a building). */ architecture?: ArchitectureKind | "none";
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
  /** The universe calendar (one clock): every period on its day; books are marks on it. */
  calendar?: CalendarView | null;
  /** The buildings the story names at its places (novel stage objects): one entry per name at a place, with the scenes that name it in reading order. Not canon. */
  buildings?: PlaceBuilding[];
  /** The stage simulation records (docs/stage-simulation-records.md), trimmed: each simulated place's lots, the things placed, the hits and who moved. Not canon. */
  simulation?: PlaceSimulation;
}
export interface PlaceBuilding { id: string; name: string; placeId: string; model: string | null; size: number | null; sceneIds: string[] }
/**
 * A lot of a simulated place, on its grid of 2 m cells: named when the story names it (from `since`, a scene id; null: from the
 * start). Its skeleton has one digit per cell, floor by floor (0 mass, 1 corridor, 2 stair); a room is [floor, i0, j0, i1, j1].
 */
export interface SimulationLot { name: string | null; since: string | null; label: string | null; role: string | null; model: string; i0: number; j0: number; nx: number; nz: number; floors: number; skeleton: string; rooms: number[][] }
/** What one hit took from a lot: skeleton cells destroyed, fallen, and cut off from the ground (with its rooms), and the structural units [kind, i, j, k] blasted or fallen (a fallen one also has where it came to rest). */
export interface SimulationHitPart { lot: number; destroyed: number[]; fell: number[]; cutOff: number[]; cutRooms: number[]; blasted: number[][]; fallen: number[][] }
export interface PlaceSimulation {
  strands: { id: string; title: string; from: string | null; to: string | null }[];
  places: Record<string, { strand: string; label: string; kind: string; grid: { nx: number; nz: number }; lots: SimulationLot[] }>;
  /** Placements in the place's metres (x, z across its grid, y up), with the fitted extent. */
  things: { id: string; name: string; model: string | null; shape: string | null; placements: { scene: string; place: string; x: number; y: number; z: number; w: number; h: number; d: number; turn: number }[] }[];
  /** An impact: its sphere (metres), strength, what each lot it reached lost, and the things it broke. */
  hits: { scene: string; place: string; event: number; x: number; y: number; z: number; r: number; strength: number; lots: SimulationHitPart[]; things: string[] }[];
  migrations: { scene: string; person: string; from: string; to: string }[];
}

/** Calendar minutes: ordering keys from the backend (`novel calendar`), not real date arithmetic. */
export interface CalendarSpan { start: number; end: number }
export interface CalendarViewEntry {
  /** The period (time) id as this projection holds it. */
  id: string;
  book: number | null;
  label: string;
  year: number | null; month: number | null; day: number | null;
  /** "15:00" or a part of the day ("evening"). */
  time: string | null;
  span: CalendarSpan;
  /** stated / derived (from stated words) / between (a range between dated neighbours). */
  placed: "stated" | "derived" | "between";
  flashback: boolean;
  scenes: number;
}
export interface CalendarView {
  books: { sourceId: string; volume: number | null; title: string; readingOrder: number | null; year: number | null; yearBy: string | null; span: CalendarSpan | null }[];
  entries: CalendarViewEntry[];
  conflicts: string[];
  /** Years waiting for review (a book whose dates go back from the previous book's). */
  questions: number;
}

export const CALENDAR_DAY = 1440;
/** The day a calendar minute falls on (the backend's ordering key: 31-day months, 12-month years). */
export function calendarDay(minute: number): { year: number; month: number; day: number } {
  const index = Math.floor(minute / CALENDAR_DAY);
  return { year: Math.floor(index / 372), month: Math.floor((index % 372) / 31) + 1, day: (index % 31) + 1 };
}
export const calendarDayKey = (day: { year: number; month: number; day: number }) => `${day.year}-${day.month}-${day.day}`;
/** "Year 1 · 12月25日" (years nobody states are relative: Year 1 is the first dated book). */
export const calendarDayLabel = (day: { year: number; month: number; day: number }) => `Year ${day.year} · ${day.month}月${day.day}日`;
/** "15:00", "evening", "all day" — when in its day a period sits. */
export const calendarTimeLabel = (entry: Pick<CalendarViewEntry, "time" | "span" | "placed">) => entry.placed === "between" ? "undated" : entry.time ? (PART_OF_DAY[entry.time] ?? entry.time) : entry.span.end - entry.span.start >= CALENDAR_DAY ? "that day" : "";

/**
 * The calendar's days, earliest first, each with its periods in clock order.
 * An undated period (a range between dated neighbours) is listed under the
 * day its range starts, marked as undated.
 */
export function calendarDays(view: CalendarView): { key: string; label: string; entries: CalendarViewEntry[] }[] {
  const days = new Map<string, { key: string; label: string; start: number; entries: CalendarViewEntry[] }>();
  for (const entry of view.entries) {
    const day = entry.placed === "between" || entry.year === null ? calendarDay(entry.span.start) : { year: entry.year, month: entry.month!, day: entry.day! };
    const key = calendarDayKey(day);
    const bucket = days.get(key) ?? { key, label: calendarDayLabel(day), start: Math.floor(entry.span.start / CALENDAR_DAY), entries: [] };
    bucket.entries.push(entry);
    days.set(key, bucket);
  }
  return [...days.values()].sort((first, second) => first.start - second.start).map(({ key, label, entries }) => ({ key, label, entries: entries.sort((first, second) => (first.placed === "between" ? 1 : 0) - (second.placed === "between" ? 1 : 0) || first.span.start - second.span.start || first.span.end - second.span.end) }));
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
  /** A region's own disc (its own content, kept clear of its children), when it has one: the spot is its centre. */
  own?: number;
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
  // Settle: only pushes now, until nothing overlaps (links and the inward pull may have left a little).
  for (let step = 0, overlap = true; overlap && step < 2000; step++) {
    overlap = false;
    for (let first = 0; first < items.length; first++) for (let second = first + 1; second < items.length; second++) {
      const a = items[first], b = items[second];
      let dx = b.x - a.x, dy = b.y - a.y;
      if (!dx && !dy) { dx = 0.5; dy = 0.3; }
      const distance = Math.hypot(dx, dy), least = a.r + b.r + gap / 2;
      if (distance >= least) continue;
      overlap = true;
      const push = (least - distance) / 2 + 0.01;
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

/** What the place-tree layout needs of a place. */
export type TreePlace = Pick<StoryPlace, "id" | "parentId" | "sceneIds">;

/**
 * The place tree as nested circles, unscaled (around the origin, in the
 * units of `ownRadius`): each place that contains others is a region whose
 * circle packs its children; places linked by moves sit closer; no two
 * circles at one level overlap. A place's own content (its own scenes on the
 * map, its own grid on the stage) is a disc of `ownRadius`; a region with
 * content of its own keeps that disc above its children, never on top of
 * them, and its spot is that disc's centre.
 */
export function placeTreeCircles(places: TreePlace[], links: { from: string; to: string; count: number }[], options: { ownRadius?: (place: TreePlace) => number; gap?: number; rootGap?: number } = {}): Map<string, PlaceSpot> {
  const ownRadius = options.ownRadius ?? ((place: TreePlace) => place.sceneIds.length ? 8 + 4 * Math.sqrt(place.sceneIds.length) : 0);
  const ids = new Set(places.map((place) => place.id));
  const byId = new Map(places.map((place) => [place.id, place]));
  const parentOf = (place: TreePlace) => place.parentId && ids.has(place.parentId) && place.parentId !== place.id ? place.parentId : null;
  const children = new Map<string, TreePlace[]>();
  const roots: TreePlace[] = [];
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
  const ownAt = new Map<string, { x: number; y: number }>();
  const LABEL = 16, GAP = options.gap ?? 22;
  const measure = (place: TreePlace, seen: Set<string>): number => {
    const own = ownRadius(place);
    const kids = (children.get(place.id) ?? []).filter((kid) => !seen.has(kid.id));
    if (!kids.length) { radius.set(place.id, own || 8); return own || 8; }
    for (const kid of kids) measure(kid, new Set([...seen, place.id]));
    const packed = packCircles(kids.map((kid) => ({ id: kid.id, r: radius.get(kid.id)! })), lifted(new Set(kids.map((kid) => kid.id))), GAP);
    const items = kids.map((kid) => ({ id: kid.id, x: packed.get(kid.id)!.x, y: packed.get(kid.id)!.y, r: radius.get(kid.id)! }));
    // The region's own disc sits above its children, a gap clear of the highest of them.
    if (own) {
      items.push({ id: "", x: 0, y: Math.min(...items.map((item) => item.y - item.r)) - GAP - own, r: own });
    }
    // Centre the region on what it holds; children sit a little low, leaving the upper rim for its label.
    const cx = (Math.min(...items.map((item) => item.x - item.r)) + Math.max(...items.map((item) => item.x + item.r))) / 2;
    const cy = (Math.min(...items.map((item) => item.y - item.r)) + Math.max(...items.map((item) => item.y + item.r))) / 2 - LABEL / 2;
    let enclose = 0;
    for (const item of items) {
      const at = { x: item.x - cx, y: item.y - cy };
      if (item.id) offset.set(item.id, at); else ownAt.set(place.id, at);
      enclose = Math.max(enclose, Math.hypot(at.x, at.y) + item.r);
    }
    const r = Math.max(2 * (own || 8), enclose + LABEL + 6);
    radius.set(place.id, r);
    return r;
  };
  for (const root of roots) measure(root, new Set());
  const top = packCircles(roots.map((root) => ({ id: root.id, r: radius.get(root.id)! })), lifted(new Set(roots.map((root) => root.id))), options.rootGap ?? 36);
  const absolute = new Map<string, { x: number; y: number }>();
  const place = (id: string, at: { x: number; y: number }, seen: Set<string>) => {
    absolute.set(id, at);
    for (const kid of children.get(id) ?? []) if (!seen.has(kid.id) && offset.has(kid.id)) place(kid.id, { x: at.x + offset.get(kid.id)!.x, y: at.y + offset.get(kid.id)!.y }, new Set([...seen, id]));
  };
  for (const root of roots) place(root.id, top.get(root.id) ?? { x: 0, y: 0 }, new Set());
  return new Map(places.filter((entry) => absolute.has(entry.id)).map((entry) => {
    const at = absolute.get(entry.id)!, r = radius.get(entry.id)!, region = (children.get(entry.id) ?? []).some((kid) => offset.has(kid.id)), own = ownAt.get(entry.id);
    const spot = own ? { x: at.x + own.x, y: at.y + own.y } : { x: at.x, y: region ? at.y - r + Math.min(44, r) : at.y };
    return [entry.id, { x: at.x, y: at.y, r, depth: pathOf(entry.id).length - 1, region, spotX: spot.x, spotY: spot.y, ...(own ? { own: ownRadius(entry) } : {}) }];
  }));
}

/**
 * The place tree as nested circles (schematic, not geography) fitted to a
 * square canvas: each place that contains others is a region whose circle
 * packs its children; busy places are larger; places linked by moves sit
 * closer. Without parents every place is a top-level circle, as before the tree.
 */
export function placeTreeLayout(places: StoryPlace[], links: { from: string; to: string; count: number }[], size = 600): Map<string, PlaceSpot> {
  const circles = placeTreeCircles(places, links);
  const placed = [...circles.values()];
  if (!placed.length) return new Map();
  // Fit the canvas (labels below leaves need a margin).
  const margin = 40;
  const [minX, maxX] = [Math.min(...placed.map((point) => point.x - point.r)), Math.max(...placed.map((point) => point.x + point.r))];
  const [minY, maxY] = [Math.min(...placed.map((point) => point.y - point.r)), Math.max(...placed.map((point) => point.y + point.r + 14))];
  const scale = Math.min(3, (size - 2 * margin) / Math.max(1, maxX - minX), (size - 2 * margin) / Math.max(1, maxY - minY));
  const offsetX = (size - (maxX - minX) * scale) / 2, offsetY = (size - (maxY - minY) * scale) / 2;
  const fit = (x: number, y: number) => ({ x: Math.round(offsetX + (x - minX) * scale), y: Math.round(offsetY + (y - minY) * scale) });
  return new Map([...circles].map(([id, point]) => {
    const at = fit(point.x, point.y), r = Math.round(point.r * scale);
    // A region without a disc of its own keeps its spot just inside its upper rim, in canvas pixels.
    const spot = point.region && !point.own ? { x: at.x, y: Math.round(at.y - r + Math.min(44, r)) } : fit(point.spotX, point.spotY);
    return [id, { ...point, x: at.x, y: at.y, r, spotX: spot.x, spotY: spot.y, ...(point.own ? { own: point.own * scale } : {}) }];
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
 * Story time. Causal work does too: causes are judged on story time and the
 * strands, and its arcs run across them — the sweep, a proposal, the
 * causality faculty's calls and the review of a causal packet. Any other new
 * work points to Narrative.
 */
export function followTarget(change: { times: string[]; places: string[] }, command: { label: string; status: string } | null | undefined, otherWork: boolean, work: { faculty?: string; changesetId?: string } = {}): FollowView | null {
  if (change.times.length) return "story";
  if (change.places.length) return "places";
  if (command && /\btimeplace\b/.test(command.label) && command.status === "working") return "story";
  const causal = (command && /\bcausality\b/.test(command.label) && command.status === "working") || /causal/i.test(work.faculty ?? "") || /^cs_causality_/.test(work.changesetId ?? "");
  if (causal) return "story";
  return otherWork ? "narrative" : null;
}
