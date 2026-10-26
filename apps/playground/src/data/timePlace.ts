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
}
export interface StoryPlace { id: string; label: string; sceneIds: string[]; statedScenes: number; characterIds: string[]; /** Proposed, awaiting review. */ proposed?: boolean }
export interface TimePlaceProjection {
  available: boolean;
  times: StoryTime[];
  scenes: StoryScene[];
  places: StoryPlace[];
  characters: { id: string; label: string; scenes: number }[];
  /** Display names for every place and character the scenes refer to. */
  names: Record<string, string>;
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
