import type { DecisionQuestion } from "../ground/connectors/jev.js";
import type { Sentence } from "../digger/intake/sectioning.js";
import { describeTime, detectTimeMentions, leadingDateCue, needsRoleCheck, parseTimeText, quoteMasks, strongAdvanceCue, type TimeMention } from "../digger/timeplace/lexicon.js";
import { assemblePeriods, dateFor, isMicroJump, shiftDate, type AnchoredMention, type SceneTime, type StoryPeriod } from "../digger/timeplace/periods.js";
import { continuationOf, continuationQuestion, ROLE_OPTIONS, verdict, type RoleVerdict, type TimeRole } from "../digger/timeplace/roles.js";
import { describeEntry, placeOnCalendar, type CalendarFile } from "../solidifier/calendar/calendar.js";
import { ask } from "./context/engine.js";
import { continuationMode, storyTimeMode } from "./context/readingModes.js";
import type { Decide } from "./typing.js";

/**
 * Story time in the v2 reading (the user's approval of §2.0.5, 2026-10-30): the v1 time-place faculty's parts on the v2
 * flow's scenes.
 * 1. Every time word where it stands, with its value: the time lexicon's matches, and the time strings the listing found
 *    (parsed by the lexicon; one the lexicon cannot read is left out).
 * 2. Its role, scene by scene in reading order: a strong cue ("it is now …") is ADVANCE by rule; a word in a spoken line
 *    or a thought (the sentence kinds), or a past marker in a question, only mentions a time; a word that could set the
 *    scene's time is asked (one structured request a scene, with the story's time so far); the rest (in a quote, deep in a
 *    scene) only mention a time. A holiday names a day, not a part of it (平安夜 is the 24th; "evening" after it is the
 *    24th's evening, not the next day's).
 * 3. The periods (v1 assembly: an anchor until the next one, the flashback stack, story order, a date derived only from
 *    stated words), with a continuation question after a flashback scene.
 * 4. The calendar (v1, no model): every period on one clock, Year 1 relative.
 * 5. The time tree (the user's call, 2026-10-31: a tree for time as for places): the story's time as nodes inside nodes,
 *    a year, its days, a day's parts (a part of the day or a clock time), and the past (flashbacks, by how far back). Each
 *    period sits at its node; a coarser word and a finer one of the same day are containment, not a sequence (the day
 *    12-24, then its 00:00), and the story going back on the tree without a flashback is a conflict.
 * Each scene gets a caption of when it takes place (its node's path), and each sentence the period it is in.
 */
export const ROLES: Record<TimeRole, string> = {
  ADVANCE: "from here the narrated scene takes place at this time: the story moves forward, or the story or chapter opens at this time",
  FLASHBACK: "the narration jumps back to an earlier time and tells what happened there as it happens (a recollection or a past episode, not a passing remark)",
  RETURN: "after a flashback, the narration comes back to the story's present",
  REFERENCE: "the time is only mentioned (in speech, a thought, a plan, a habit, background); the scene keeps its time. The answer when unsure",
};
const ROLE_LABELS: Record<TimeRole, string> = { ADVANCE: "the scene is now at this time", FLASHBACK: "jumps back into the past", RETURN: "back to the present", REFERENCE: "only mentioned" };
/** Sentences shown around a time word (before, after); a past marker gets a longer look ahead. */
const AROUND: [number, number] = [3, 2], AROUND_PAST: [number, number] = [2, 4];

/** Why a word was not asked: in a quote, in a spoken line or a thought, a past marker in a question. */
export type Unasked = "quote" | "kind" | "question" | "deep";
export interface TimeWord { key: string; text: string; sentence: string; start: number; end: number; family: string; gloss: string; scene: string; role: TimeRole; confidence: number | null; decidedBy: RoleVerdict["decidedBy"]; downgraded?: string; why?: Unasked }
export interface Period { id: string; label: string; gloss: string; role: string; flashback: boolean; toldFrom: string | null; date: StoryPeriod["date"]; partOfDay?: string; hour?: number; storyIndex: number; narrativeIndex: number; anchor: string; scenes: string[]; when: string | null; node: string }
export interface SceneWhen { scene: string; periods: string[]; flashback: boolean; inherited: boolean; when: string; node: string | null; continuation?: { continues: boolean; probability: number } }
/** A node of the time tree: the story, a year, a season, a day, a part of a day, the past, a time in the past. */
export interface TimeNode { id: string; level: "story" | "year" | "season" | "day" | "part" | "past"; label: string; parent: string | null; periods: string[]; scenes: string[] }
export interface StoryTime {
  words: TimeWord[]; periods: Period[]; scenes: SceneWhen[];
  /** The time tree, root first; and where the story goes back on it without a flashback. */
  tree: TimeNode[]; treeConflicts: { period: string; note: string }[];
  calendar: Pick<CalendarFile, "entries" | "conflicts">;
  /** The period a sentence is in (the latest anchor of its scene at or before it, else what the scene inherits). */
  periodOf: (sentence: string) => Period | null;
}

/** The time words of the book: the lexicon's, and the listed time strings it can read that do not overlap one of them. */
export function timeWords(sentences: Sentence[], listed: string[]): TimeMention[] {
  const words = detectTimeMentions(sentences), masks = quoteMasks(sentences);
  for (const text of new Set(listed)) {
    const parsed = parseTimeText(text);
    if (!parsed) continue;
    for (const sentence of sentences) for (let start = sentence.text.indexOf(text); start >= 0; start = sentence.text.indexOf(text, start + text.length)) {
      const end = start + text.length;
      if (words.some((kept) => kept.sentenceId === sentence.id && kept.start < end && start < kept.end)) continue;
      words.push({ text, sentenceId: sentence.id, start, end, ...parsed, inQuote: (masks.get(sentence.id) ?? []).slice(start, end).some(Boolean), source: "llm" });
    }
  }
  return words;
}

const dateText = (date: StoryPeriod["date"]) => date?.month && date.day ? `${date.year ? `${date.year}-` : ""}${String(date.month).padStart(2, "0")}-${String(date.day).padStart(2, "0")}` : null;

/** Sentence kinds whose time words only mention a time (someone says or thinks it; the narration's time stays). */
const SPOKEN_KINDS = new Set(["spoken", "thought"]);

export async function readStoryTime(decide: Decide, input: { scenes: { id: string; chapter: number; sentences: string[] }[]; words: TimeMention[]; text: (sentence: string) => string; position: (sentence: string) => number; kind?: (sentence: string) => string | undefined }): Promise<StoryTime> {
  const { text, position } = input;
  const bySentence = new Map<string, TimeMention[]>();
  // A holiday names its day; the part of the day it is known for is not stated by it.
  for (const word of input.words) {
    const named = word.family === "holiday" && word.value.partOfDay ? { ...word, value: (({ partOfDay: _, ...rest }) => rest)(word.value) } : word;
    bySentence.set(word.sentenceId, [...(bySentence.get(word.sentenceId) ?? []), named]);
  }
  let current: { text: string; gloss: string } | null = null, flashback: { text: string } | null = null, storyDate: StoryPeriod["date"] = null;
  const anchorsByScene = new Map<string, AnchoredMention[]>(), words: TimeWord[] = [];
  for (const scene of input.scenes) {
    const located = scene.sentences.flatMap((id, index) => (bySentence.get(id) ?? []).sort((a, b) => a.start - b.start).map((mention) => ({ mention, index })));
    const verdicts = new Map<TimeMention, RoleVerdict>();
    const beforeStoryDate = (mention: TimeMention) => {
      const date = dateFor(mention, { date: storyDate, partOfDay: undefined });
      return !!(date?.month && date.day && storyDate?.month && storyDate.day) && date.month * 100 + date.day < storyDate.month * 100 + storyDate.day;
    };
    const why = new Map<TimeMention, Unasked>();
    for (const { mention } of located) {
      const sentence = text(mention.sentenceId);
      if (SPOKEN_KINDS.has(input.kind?.(mention.sentenceId) ?? "")) { verdicts.set(mention, { role: "REFERENCE", flashback: 0, confidence: null, decidedBy: "default" }); why.set(mention, "kind"); }
      else if (mention.family === "past-marker" && /[？?][」』”"]?\s*$/.test(sentence)) { verdicts.set(mention, { role: "REFERENCE", flashback: 0, confidence: null, decidedBy: "rule" }); why.set(mention, "question"); }
      else if (strongAdvanceCue(mention, sentence) || (leadingDateCue(mention, sentence) && !beforeStoryDate(mention))) verdicts.set(mention, { role: "ADVANCE", flashback: 0, confidence: null, decidedBy: "rule" });
    }
    const asked = located.filter(({ mention, index }) => !verdicts.has(mention) && needsRoleCheck(mention, index, text(mention.sentenceId)));
    for (const { mention } of located) if (!verdicts.has(mention) && !asked.some((entry) => entry.mention === mention)) why.set(mention, mention.inQuote ? "quote" : "deep");
    if (asked.length) {
      const keys = asked.map((_, index) => "t" + (index + 1));
      const shown = new Set<number>();
      for (const { mention, index } of asked) {
        const [before, after] = mention.family === "past-marker" || (mention.value.offset?.amount ?? 0) < 0 ? AROUND_PAST : AROUND;
        for (let at = Math.max(0, index - before); at <= Math.min(scene.sentences.length - 1, index + after); at++) shown.add(at);
      }
      const focus = {
        story: { now: current ? `${current.text} (${current.gloss})` : "not yet established", ...(dateText(storyDate) ? { date: `${dateText(storyDate)}: a time word naming this same date is not a flashback, though a later part of the same day can still move the scene forward` } : {}), narration: flashback ? `inside a flashback that began with ${flashback.text}` : "in the story's present (no flashback open)" },
        passage: [...shown].sort((a, b) => a - b).map((at) => ({ id: scene.sentences[at], text: text(scene.sentences[at]) })),
        times: asked.map(({ mention }, index) => ({ key: keys[index], text: mention.text, means: describeTime(mention), in: mention.sentenceId })),
      };
      const questions: DecisionQuestion[] = asked.map((_, index) => ({ key: `time:${keys[index]}`, primitive: "choice", instructions: `What does times.${keys[index]} do to when the scene happens?`, options: [...ROLE_OPTIONS], optionHints: { ...ROLE_LABELS } }));
      const { replies } = await ask(decide, storyTimeMode, { ...focus, questions }, null);
      asked.forEach(({ mention }, index) => verdicts.set(mention, verdict(replies.find((reply) => reply.key === `time:${keys[index]}`), mention)));
    }
    const anchored: AnchoredMention[] = located.map(({ mention, index }) => ({ ...mention, sceneId: scene.id, sentenceIndexInScene: index, verdict: verdicts.get(mention) ?? { role: "REFERENCE", flashback: 0, confidence: null, decidedBy: "default" } }));
    anchorsByScene.set(scene.id, anchored);
    for (const anchor of anchored) {
      const original = located.find((entry) => entry.mention.sentenceId === anchor.sentenceId && entry.mention.start === anchor.start)?.mention;
      const unasked = original ? why.get(original) : undefined;
      words.push({ key: `${anchor.sentenceId}:${anchor.start}`, text: anchor.text, sentence: anchor.sentenceId, start: anchor.start, end: anchor.end, family: anchor.family, gloss: describeTime(anchor), scene: scene.id, role: anchor.verdict.role, confidence: anchor.verdict.confidence, decidedBy: anchor.verdict.decidedBy, ...(anchor.verdict.downgraded ? { downgraded: anchor.verdict.downgraded } : {}), ...(unasked ? { why: unasked } : {}) });
      if (anchor.verdict.role === "FLASHBACK") flashback = { text: anchor.text };
      else if (anchor.verdict.role === "RETURN") flashback = null;
      if ((anchor.verdict.role === "ADVANCE" || anchor.verdict.role === "RETURN") && !flashback && !isMicroJump(anchor)) {
        current = { text: anchor.text, gloss: describeTime(anchor) };
        const date = dateFor(anchor, { date: storyDate });
        if (date) storyDate = date;
      }
    }
  }

  const sceneIndex = new Map(input.scenes.map((scene, index) => [scene.id, index]));
  const assembled = await assemblePeriods(
    input.scenes.map((scene) => ({ id: scene.id, chapterIndex: scene.chapter, sentenceCount: scene.sentences.length })),
    anchorsByScene,
    async (scene, open) => {
      const index = sceneIndex.get(scene.id)!, sentences = (ids: string[]) => ids.map((id) => ({ id, text: text(id) }));
      const { replies: [answer] } = await ask(decide, continuationMode, { opening: sentences(input.scenes[index].sentences.slice(0, 4)), previousTail: index > 0 ? sentences(input.scenes[index - 1].sentences.slice(-3)) : [], questions: [continuationQuestion(open.label)] }, null);
      return continuationOf(answer);
    },
  );
  // The time tree first: it settles the days of parts of the day, and the calendar places what it settled.
  const { tree, conflicts: treeConflicts, nodeOf } = timeTree(assembled.periods);
  const calendar = placeOnCalendar("book", [{
    book: { sourceId: "book", workspace: "", title: "this book", readingOrder: null, continuityId: null },
    periods: assembled.periods.map((period) => ({ id: period.id, label: period.label, storyIndex: period.storyIndex, flashback: period.flashback, date: period.date, ...(period.partOfDay ? { partOfDay: period.partOfDay } : {}), ...(period.anchor.value.hour !== undefined ? { hour: period.anchor.value.hour, minute: period.anchor.value.minute ?? 0 } : {}), scenes: period.sceneIds.length })),
  }]);
  const entryOf = new Map(calendar.entries.map((entry) => [entry.timeId, entry]));
  const periods: Period[] = assembled.periods.map((period) => {
    const entry = entryOf.get(period.id);
    return {
      id: period.id, label: period.label, gloss: period.gloss, role: period.role, flashback: period.flashback, toldFrom: period.toldFromId, date: period.date,
      ...(period.partOfDay ? { partOfDay: period.partOfDay } : {}), ...(period.anchor.value.hour !== undefined ? { hour: period.anchor.value.hour } : {}),
      storyIndex: period.storyIndex, narrativeIndex: period.narrativeIndex, anchor: period.anchor.sentenceId, scenes: period.sceneIds,
      when: entry ? describeEntry(entry) : null, node: nodeOf.get(period.id)!,
    };
  });
  const periodById = new Map(periods.map((period) => [period.id, period]));
  // A scene's caption is its node's path on the time tree: the deepest node among the periods it opens with (its first
  // three sentences), else the one it carries on in.
  const nodeById = new Map(tree.map((node) => [node.id, node]));
  const path = (id: string): string[] => { const node = nodeById.get(id); return !node || node.level === "story" ? [] : [...path(node.parent ?? ""), node.label]; };
  const depth = (id: string) => path(id).length;
  const scenes: SceneWhen[] = assembled.scenes.map((entry: SceneTime) => {
    const scene = input.scenes[sceneIndex.get(entry.sceneId)!], opening = new Set(scene.sentences.slice(0, 3));
    const list = entry.periodIds.map((id) => periodById.get(id)!).filter(Boolean);
    const node = [...list.filter((period) => opening.has(period.anchor)).map((period) => nodeOf.get(period.id)!)].sort((a, b) => depth(b) - depth(a))[0] ?? (list[0] ? nodeOf.get(list[0].id)! : null);
    for (const period of list) { const at = nodeById.get(nodeOf.get(period.id)!); if (at && !at.scenes.includes(entry.sceneId)) at.scenes.push(entry.sceneId); }
    return { scene: entry.sceneId, periods: entry.periodIds, flashback: entry.flashback, inherited: entry.inherited, when: node ? path(node).join(" › ") : "time not stated", node, ...(entry.continuation ? { continuation: entry.continuation } : {}) };
  });
  const sceneOf = new Map(input.scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene.id])));
  const scenePeriods = new Map(scenes.map((scene) => [scene.scene, scene.periods.map((id) => periodById.get(id)!).filter(Boolean)]));
  const periodOf = (sentence: string): Period | null => {
    const list = scenePeriods.get(sceneOf.get(sentence) ?? "") ?? [];
    const at = position(sentence);
    // A period anchored in this scene starts at its time word; one anchored before the scene (inherited) holds from its start.
    const started = list.filter((period) => sceneOf.get(period.anchor) !== sceneOf.get(sentence) || position(period.anchor) <= at);
    return started.at(-1) ?? list[0] ?? null;
  };
  return { words, periods, scenes, tree, treeConflicts, calendar: { entries: calendar.entries, conflicts: calendar.conflicts }, periodOf };
}

const PART_LABEL: Record<string, string> = { "late-night": "late night", dawn: "dawn", morning: "morning", noon: "noon", daytime: "daytime", afternoon: "afternoon", "after-school": "after school", evening: "evening", night: "night" };
/** Where a part of the day starts, in minutes; a late night told after an evening or a night of the same day is past midnight. */
const PART_START: Record<string, number> = { "late-night": 0, dawn: 300, morning: 420, daytime: 420, noon: 690, afternoon: 810, "after-school": 930, evening: 1050, night: 1260 };

/**
 * The time tree from the story periods (no model). The present line walks a cursor in reading order: its year, its day
 * (a date, or "day N" while nothing is dated) and the last minute of that day the story reached. A stated date sets the
 * day; a relative day moves it; a part of the day or a clock time sits inside the cursor's day, and one earlier than the
 * last the story reached that day is the next day (a late night told after an evening or a night is that night, past
 * midnight). The dates of the parts are set here (derived), in place of v1's guess from the part before. Flashbacks hang
 * under the past, by how far back when the words say.
 */
export function timeTree(story: StoryPeriod[]): { tree: TimeNode[]; conflicts: { period: string; note: string }[]; nodeOf: Map<string, string> } {
  const nodes = new Map<string, TimeNode>(), nodeOf = new Map<string, string>(), conflicts: { period: string; note: string }[] = [];
  const add = (id: string, level: TimeNode["level"], label: string, parent: string | null) => { if (!nodes.has(id)) nodes.set(id, { id, level, label, parent, periods: [], scenes: [] }); return id; };
  const root = add("t:story", "story", "the story", null);
  const pad = (value: number) => String(value).padStart(2, "0");
  let year = 1, date = null as StoryPeriod["date"], dayIndex = 0, lastMinute = -1;
  const dayKey = () => date?.month && date.day ? date.month * 31 + date.day : dayIndex;
  const dayNode = () => {
    const parent = add(`t:y${year}`, "year", `Year ${year}`, root);
    if (date?.month && date.day) return add(`t:y${year}:${pad(date.month)}-${pad(date.day)}`, "day", `${pad(date.month)}-${pad(date.day)}`, parent);
    dayIndex = dayIndex || 1;
    return add(`t:y${year}:d${dayIndex}`, "day", `day ${dayIndex}`, parent);
  };
  const moveDays = (days: number) => { if (date?.month && date.day) date = shiftDate(date, days); else dayIndex = (dayIndex || 1) + days; lastMinute = -1; };
  for (const period of [...story].sort((a, b) => a.narrativeIndex - b.narrativeIndex)) {
    const anchor = period.anchor, value = anchor.value;
    let node: string;
    if (period.flashback) {
      const past = add("t:past", "past", "the past", root), offset = value.offset;
      node = offset && offset.amount !== null && offset.amount < 0
        ? add(`t:past:${-offset.amount}${offset.unit}`, "part", `${-offset.amount} ${offset.unit}${-offset.amount === 1 ? "" : "s"} before`, past)
        : add(`t:past:${period.id}`, "part", period.label, past);
    } else {
      const before = dayKey();
      if (period.date?.year && !period.date.derived) year = period.date.year;
      if (period.date?.month && period.date.day && !period.date.derived) {
        if (date?.month && date.day && period.date.month * 31 + period.date.day < before) conflicts.push({ period: period.id, note: `"${period.label}" is told after ${pad(date.month)}-${pad(date.day)} but is earlier, and is not a flashback.` });
        if (!(date?.month === period.date.month && date?.day === period.date.day)) lastMinute = -1;
        date = { ...(period.date.year ? { year: period.date.year } : {}), month: period.date.month, day: period.date.day, derived: false };
      } else if (anchor.family === "relative-day" && value.offset?.amount) moveDays(value.offset.amount);
      const minute = value.hour !== undefined ? value.hour * 60 + (value.minute ?? 0) : period.partOfDay ? PART_START[period.partOfDay] : undefined;
      if (minute !== undefined) {
        const pastMidnight = period.partOfDay === "late-night" && lastMinute >= PART_START.evening;
        const at = pastMidnight ? 1440 + minute : minute;
        if (at < lastMinute) moveDays(1);
        lastMinute = pastMidnight ? at : Math.max(lastMinute, at);
        const part = value.hour !== undefined ? `${pad(value.hour)}:${pad(value.minute ?? 0)}` : period.partOfDay!;
        node = add(`${dayNode()}:${part}`, "part", PART_LABEL[part] ?? part, dayNode());
      } else if (anchor.family === "season" && value.season) node = add(`t:y${year}:${value.season}`, "season", value.season, add(`t:y${year}`, "year", `Year ${year}`, root));
      else node = dayNode();
      // The day the part settled on is its date (derived), where a day is dated.
      if (date?.month && date.day && (!period.date || period.date.derived)) period.date = { ...date, derived: true };
      if (date?.month && date.day && period.date?.derived) period.date = { ...date, derived: true };
    }
    nodeOf.set(period.id, node);
    nodes.get(node)!.periods.push(period.id);
  }
  return { tree: [...nodes.values()], conflicts, nodeOf };
}
