import { describeTime, type TimeMention, type TimeValue } from "./lexicon.js";
import type { RoleVerdict, TimeRole } from "./roles.js";

/**
 * Period assembly (time-place faculty, phase 1) — deterministic code.
 *
 * A time anchor (a mention whose role is not REFERENCE) opens a period; the
 * scenes that follow belong to it until the next anchor. A FLASHBACK opens a
 * past period told from the current present period; the flashback closes on
 * RETURN, or when the continuation check says a later scene is back in the
 * present. Scenes before any anchor stay "time not stated": no anchor is
 * invented for them.
 *
 * Story order (estimated, for the objective timeline): the present line in
 * reading order, each flashback placed before the period it was told from;
 * flashbacks with a known distance into the past ("三年前") are ordered by it.
 * A derived date is computed only from words that state it: a dated period
 * plus "第二天" gives the next date, labelled derived.
 */
export interface AnchoredMention extends TimeMention {
  sceneId: string;
  sentenceIndexInScene: number;
  verdict: RoleVerdict;
}

export interface StoryPeriod {
  id: string;
  /** The anchor mention that opened it. */
  anchor: AnchoredMention;
  label: string;
  gloss: string;
  role: Exclude<TimeRole, "REFERENCE">;
  flashback: boolean;
  /** Jev's FLASHBACK probability for the anchor (0 for rule decisions). */
  flashbackProbability: number;
  /** For a flashback: the present-line period it was told from. */
  toldFromId: string | null;
  /** Calendar date stated or derived from stated words (never guessed). */
  date: { year?: number; month?: number; day?: number; derived: boolean } | null;
  partOfDay?: TimeValue["partOfDay"];
  chapterIndex: number;
  narrativeIndex: number;
  storyIndex: number;
  sceneIds: string[];
}

export interface SceneTime {
  sceneId: string;
  periodIds: string[];
  /** True when the scene has no anchor of its own and inherits its period. */
  inherited: boolean;
  flashback: boolean;
  /** Continuation decision after a flashback scene, when one was asked. */
  continuation?: { continues: boolean; probability: number };
}

export interface AssemblyScene { id: string; chapterIndex: number; sentenceCount: number }

/** Where earlier blocks left the story: periods so far, the present, an open flashback. */
export interface PeriodSeed { periods: StoryPeriod[]; present: StoryPeriod | null; flashback: StoryPeriod | null }

/** Rebuild a stored period (a TimePoint entity) so later blocks can continue from it. */
export function periodFromEntity(entity: { id: string; names: { text: string }[]; properties: Record<string, unknown>; confidence: number }): StoryPeriod {
  const properties = entity.properties;
  const sentenceId = String(properties.sentenceId ?? "");
  const start = Number(/_(\d+)$/.exec(entity.id)?.[1] ?? 0);
  const text = entity.names[0]?.text ?? String(properties.expression ?? "");
  const anchor: AnchoredMention = {
    text, sentenceId, start, end: start + text.length, family: (properties.family ?? "date") as TimeMention["family"], value: (properties.value ?? {}) as TimeValue,
    inQuote: false, source: (properties.source ?? "lexicon") as TimeMention["source"], sceneId: String(properties.sceneId ?? ""), sentenceIndexInScene: 0,
    verdict: { role: (properties.role ?? "ADVANCE") as TimeRole, flashback: Number(properties.flashbackProbability ?? 0), confidence: typeof properties.confidence === "number" ? properties.confidence : null, decidedBy: (properties.decidedBy ?? "jev") as RoleVerdict["decidedBy"] },
  };
  return {
    id: entity.id, anchor, label: text, gloss: String(properties.gloss ?? ""), role: (properties.role ?? "ADVANCE") as StoryPeriod["role"], flashback: properties.flashback === true,
    flashbackProbability: Number(properties.flashbackProbability ?? 0), toldFromId: (properties.toldFromId as string | null) ?? null, date: (properties.date as StoryPeriod["date"]) ?? null,
    ...(properties.partOfDay ? { partOfDay: properties.partOfDay as TimeValue["partOfDay"] } : {}), chapterIndex: Number(properties.chapterIndex ?? 0),
    narrativeIndex: Number(properties.narrativeIndex ?? 0), storyIndex: Number(properties.storyIndex ?? 0), sceneIds: [],
  };
}

/** Seed from stored periods; `lastSceneTimes` are the periods of the scene just before. */
export function seedFrom(periods: StoryPeriod[], lastSceneTimes: string[] = []): PeriodSeed {
  const ordered = [...periods].sort((first, second) => first.narrativeIndex - second.narrativeIndex);
  const present = [...ordered].reverse().find((period) => !period.flashback) ?? null;
  const last = ordered.at(-1);
  return { periods: ordered, present, flashback: last?.flashback && lastSceneTimes.includes(last.id) ? last : null };
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** A date moved by whole days (derived). */
export function shiftDate(date: NonNullable<StoryPeriod["date"]>, days: number): StoryPeriod["date"] {
  if (!date.month || !date.day) return null;
  const leap = (year?: number) => !!year && (year % 4 === 0 && year % 100 !== 0 || year % 400 === 0);
  let { year, month, day } = date;
  day += days;
  while (day < 1) { month = month === 1 ? 12 : month - 1; if (month === 12 && year) year--; day += month === 2 && leap(year) ? 29 : DAYS_IN_MONTH[month - 1]; }
  for (let length = month === 2 && leap(year) ? 29 : DAYS_IN_MONTH[month - 1]; day > length; length = month === 2 && leap(year) ? 29 : DAYS_IN_MONTH[month - 1]) { day -= length; month = month === 12 ? 1 : month + 1; if (month === 1 && year) year++; }
  return { ...(year ? { year } : {}), month, day, derived: true };
}

/** The date a mention states, or derives from the period it is relative to. */
export function dateFor(mention: TimeMention, reference: Pick<StoryPeriod, "date" | "partOfDay"> | null): StoryPeriod["date"] {
  const value = mention.value;
  if (value.month && value.day) return { ...(value.year ? { year: value.year } : {}), month: value.month, day: value.day, derived: false };
  if (value.year && !value.month) return { year: value.year, derived: false };
  const base = reference?.date;
  if (!base) return null;
  if (mention.family === "relative-day" && value.offset && value.offset.amount !== null) return value.offset.amount === 0 ? { ...base, derived: true } : shiftDate(base, value.offset.amount);
  if (mention.family === "date" && value.day && !value.month && base.month) return { ...(base.year ? { year: base.year } : {}), month: base.month, day: value.day, derived: true };
  if (mention.family === "time-of-day" || mention.family === "clock") {
    // "早上" after "深夜" is the next morning: an earlier part of the day moves the date on.
    const now = value.partOfDay ?? (value.hour !== undefined ? value.hour < 5 ? "late-night" : value.hour < 11 ? "morning" : value.hour < 17 ? "afternoon" : "evening" : undefined);
    const before = reference?.partOfDay;
    if (now && before && DAY_PARTS.indexOf(now) >= 0 && DAY_PARTS.indexOf(now) < DAY_PARTS.indexOf(before) && !(now === "late-night" || before === "late-night" && now === "dawn")) return shiftDate(base, 1);
    return { ...base, derived: true };
  }
  return null;
}

/** Seconds or minutes later, or a vague "after a while": the scene's period
 * continues; no new period (its label would say nothing). */
export const isMicroJump = (mention: TimeMention & { verdict?: RoleVerdict }) => mention.family === "relative-span" && mention.verdict?.role !== "FLASHBACK" && (!mention.value.offset || ["second", "minute"].includes(mention.value.offset.unit));

const DAY_PARTS = ["dawn", "morning", "noon", "daytime", "afternoon", "after-school", "evening", "night", "late-night"];

export const periodIdFor = (mention: Pick<TimeMention, "sentenceId" | "start">) => `time_${mention.sentenceId}_${mention.start}`;

/**
 * Walk scenes in reading order. `askContinuation` is consulted for a scene
 * after a flashback that does not open with its own anchor; without it, a
 * flashback ends at its scene's end (scenes are continuous-time units).
 */
export async function assemblePeriods(
  scenes: AssemblyScene[],
  anchorsByScene: Map<string, AnchoredMention[]>,
  askContinuation?: (scene: AssemblyScene, flashback: StoryPeriod) => Promise<{ continues: boolean; probability: number }>,
  seed?: PeriodSeed,
): Promise<{ periods: StoryPeriod[]; scenes: SceneTime[]; reordered: StoryPeriod[] }> {
  const periods: StoryPeriod[] = [];
  const sceneTimes: SceneTime[] = [];
  let present: StoryPeriod | null = seed?.present ?? null;
  let flashback: StoryPeriod | null = seed?.flashback ?? null;
  /** The latest present-line period with a date: relative words count from it. */
  let dated: StoryPeriod | null = [...(seed?.periods ?? [])].reverse().find((period) => !period.flashback && period.date) ?? null;
  const offset = seed?.periods.length ?? 0;
  const open = (anchor: AnchoredMention, role: StoryPeriod["role"], isFlashback: boolean, toldFrom: StoryPeriod | null, reference: StoryPeriod | null): StoryPeriod => {
    const period: StoryPeriod = {
      id: periodIdFor(anchor), anchor, label: anchor.text, gloss: describeTime(anchor), role, flashback: isFlashback,
      flashbackProbability: anchor.verdict.flashback, toldFromId: toldFrom?.id ?? null, date: dateFor(anchor, reference),
      ...(anchor.value.partOfDay ? { partOfDay: anchor.value.partOfDay } : {}), chapterIndex: 0, narrativeIndex: offset + periods.length, storyIndex: 0, sceneIds: [],
    };
    periods.push(period);
    return period;
  };
  for (const scene of scenes) {
    const anchors = (anchorsByScene.get(scene.id) ?? []).filter((mention) => mention.verdict.role !== "REFERENCE" && !isMicroJump(mention)).sort((first, second) => first.sentenceIndexInScene - second.sentenceIndexInScene || first.start - second.start);
    const opensWithAnchor = !!anchors[0] && anchors[0].sentenceIndexInScene <= 2;
    let continuation: SceneTime["continuation"];
    if (flashback && !opensWithAnchor) {
      continuation = askContinuation ? await askContinuation(scene, flashback) : { continues: false, probability: 0 };
      if (!continuation.continues) flashback = null;
    } else if (flashback && opensWithAnchor && anchors[0].verdict.role === "ADVANCE" && anchors[0].family !== "past-marker" && scene.chapterIndex !== flashback.chapterIndex) {
      // A new chapter opening on a forward time word leaves the flashback.
      flashback = null;
    }
    const memberships: StoryPeriod[] = [];
    const now = () => flashback ?? present;
    if (!opensWithAnchor && now()) memberships.push(now()!);
    for (const anchor of anchors) {
      const role = anchor.verdict.role as StoryPeriod["role"];
      let period: StoryPeriod;
      if (role === "FLASHBACK") {
        period = open(anchor, role, true, present, null);
        flashback = period;
      } else if (role === "RETURN") {
        flashback = null;
        // "Back then" words cannot name the present: rejoin the present line.
        if (anchor.family === "past-marker" && present) { memberships.push(present); continue; }
        period = open(anchor, role, false, null, dated);
        present = period;
        if (period.date) dated = period;
      } else if (flashback) {
        // Moving forward inside the past episode stays in the flashback.
        period = open(anchor, role, true, present, flashback);
        flashback = period;
      } else {
        period = open(anchor, role, false, null, dated);
        present = period;
        if (period.date) dated = period;
      }
      period.chapterIndex = scene.chapterIndex;
      memberships.push(period);
    }
    const unique = [...new Map(memberships.map((period) => [period.id, period])).values()];
    for (const period of unique) if (!period.sceneIds.includes(scene.id)) period.sceneIds.push(scene.id);
    sceneTimes.push({ sceneId: scene.id, periodIds: unique.map((period) => period.id), inherited: !anchors.length, flashback: unique.some((period) => period.flashback), ...(continuation ? { continuation } : {}) });
  }
  const before = new Map((seed?.periods ?? []).map((period) => [period.id, period.storyIndex]));
  orderStory([...(seed?.periods ?? []), ...periods]);
  return { periods, scenes: sceneTimes, reordered: (seed?.periods ?? []).filter((period) => before.get(period.id) !== period.storyIndex) };
}

/** Story order: present line in reading order, flashbacks before their host. */
export function orderStory(periods: StoryPeriod[]): void {
  const pastDistance = (period: StoryPeriod) => {
    const offset = period.anchor.value.offset;
    if (!offset || offset.amount === null || offset.amount >= 0) return null;
    const scale = { second: 1 / 86400, minute: 1 / 1440, hour: 1 / 24, day: 1, week: 7, month: 30, year: 365, century: 36500 }[offset.unit];
    return offset.amount * scale;
  };
  const dayKey = (date: StoryPeriod["date"]) => date?.month && date.day ? (date.year ?? 0) * 10000 + date.month * 100 + date.day : null;
  const present = periods.filter((entry) => !entry.flashback);
  // A dated flashback goes before the first present period dated later
  // (a flashback to 12-24 precedes the morning of 12-25 even when it is
  // told on the 25th); otherwise before the period it was told during.
  const hostOf = (flashback: StoryPeriod): string | null => {
    const key = dayKey(flashback.date);
    if (key !== null && !flashback.date?.year) {
      const later = present.find((period) => { const other = dayKey(period.date); return other !== null && !period.date?.year && other > key; });
      if (later) return later.id;
    }
    return flashback.toldFromId;
  };
  const ordered: StoryPeriod[] = [];
  const flashbacks = periods.filter((period) => period.flashback);
  ordered.push(...flashbacks.filter((period) => !hostOf(period)));
  for (const period of present) {
    const hosted = flashbacks.filter((entry) => hostOf(entry) === period.id)
      .sort((first, second) => (dayKey(first.date) ?? Infinity) - (dayKey(second.date) ?? Infinity) || (pastDistance(first) ?? 0) - (pastDistance(second) ?? 0) || first.narrativeIndex - second.narrativeIndex);
    ordered.push(...hosted, period);
  }
  ordered.forEach((period, index) => { period.storyIndex = index; });
}
