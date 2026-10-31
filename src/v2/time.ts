import type { DecisionQuestion } from "../ground/connectors/jev.js";
import type { Sentence } from "../digger/intake/sectioning.js";
import { describeTime, detectTimeMentions, leadingDateCue, needsRoleCheck, parseTimeText, quoteMasks, strongAdvanceCue, type TimeMention } from "../digger/timeplace/lexicon.js";
import { assemblePeriods, dateFor, isMicroJump, type AnchoredMention, type SceneTime, type StoryPeriod } from "../digger/timeplace/periods.js";
import { decideContinuation, ROLE_OPTIONS, verdict, type RoleVerdict, type TimeRole } from "../digger/timeplace/roles.js";
import { describeEntry, placeOnCalendar, type CalendarFile } from "../solidifier/calendar/calendar.js";
import type { Decide } from "./typing.js";

/**
 * Story time in the v2 reading (the user's approval of §2.0.5, 2026-10-30): the v1 time-place faculty's parts on the v2
 * flow's scenes.
 * 1. Every time word where it stands, with its value: the time lexicon's matches, and the time strings the listing found
 *    (parsed by the lexicon; one the lexicon cannot read is left out).
 * 2. Its role, scene by scene in reading order: a strong cue ("it is now …") is ADVANCE by rule; a word that could set the
 *    scene's time is asked (one structured request a scene, with the story's time so far); the rest (in a quote, deep in a
 *    scene) only mention a time.
 * 3. The periods (v1 assembly: an anchor until the next one, the flashback stack, story order, a date derived only from
 *    stated words), with a continuation question after a flashback scene.
 * 4. The calendar (v1, no model): every period on one clock, Year 1 relative.
 * Each scene gets a caption of when it takes place, and each sentence the period it is in.
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

export interface TimeWord { key: string; text: string; sentence: string; start: number; end: number; family: string; gloss: string; scene: string; role: TimeRole; confidence: number | null; decidedBy: RoleVerdict["decidedBy"]; downgraded?: string }
export interface Period { id: string; label: string; gloss: string; role: string; flashback: boolean; toldFrom: string | null; date: StoryPeriod["date"]; partOfDay?: string; storyIndex: number; narrativeIndex: number; anchor: string; scenes: string[]; when: string | null }
export interface SceneWhen { scene: string; periods: string[]; flashback: boolean; inherited: boolean; when: string; continuation?: { continues: boolean; probability: number } }
export interface StoryTime {
  words: TimeWord[]; periods: Period[]; scenes: SceneWhen[];
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

export async function readStoryTime(decide: Decide, input: { scenes: { id: string; chapter: number; sentences: string[] }[]; words: TimeMention[]; text: (sentence: string) => string; position: (sentence: string) => number }): Promise<StoryTime> {
  const { text, position } = input;
  const bySentence = new Map<string, TimeMention[]>();
  for (const word of input.words) bySentence.set(word.sentenceId, [...(bySentence.get(word.sentenceId) ?? []), word]);
  let current: { text: string; gloss: string } | null = null, flashback: { text: string } | null = null, storyDate: StoryPeriod["date"] = null;
  const anchorsByScene = new Map<string, AnchoredMention[]>(), words: TimeWord[] = [];
  for (const scene of input.scenes) {
    const located = scene.sentences.flatMap((id, index) => (bySentence.get(id) ?? []).sort((a, b) => a.start - b.start).map((mention) => ({ mention, index })));
    const verdicts = new Map<TimeMention, RoleVerdict>();
    const beforeStoryDate = (mention: TimeMention) => {
      const date = dateFor(mention, { date: storyDate, partOfDay: undefined });
      return !!(date?.month && date.day && storyDate?.month && storyDate.day) && date.month * 100 + date.day < storyDate.month * 100 + storyDate.day;
    };
    for (const { mention } of located) {
      const sentence = text(mention.sentenceId);
      if (strongAdvanceCue(mention, sentence) || (leadingDateCue(mention, sentence) && !beforeStoryDate(mention))) verdicts.set(mention, { role: "ADVANCE", flashback: 0, confidence: null, decidedBy: "rule" });
    }
    const asked = located.filter(({ mention, index }) => !verdicts.has(mention) && needsRoleCheck(mention, index, text(mention.sentenceId)));
    if (asked.length) {
      const keys = asked.map((_, index) => "t" + (index + 1));
      const shown = new Set<number>();
      for (const { mention, index } of asked) {
        const [before, after] = mention.family === "past-marker" || (mention.value.offset?.amount ?? 0) < 0 ? AROUND_PAST : AROUND;
        for (let at = Math.max(0, index - before); at <= Math.min(scene.sentences.length - 1, index + after); at++) shown.add(at);
      }
      const state = {
        task: "Time words in a passage of a novel. For each, say what it does to WHEN the narrated scene happens (the roles are defined in roles). The story's time so far is in story.",
        roles: { ...ROLES },
        story: { now: current ? `${current.text} (${current.gloss})` : "not yet established", ...(dateText(storyDate) ? { date: `${dateText(storyDate)}: a time word naming this same date is not a flashback, though a later part of the same day can still move the scene forward` } : {}), narration: flashback ? `inside a flashback that began with ${flashback.text}` : "in the story's present (no flashback open)" },
        passage: Object.fromEntries([...shown].sort((a, b) => a - b).map((at) => [scene.sentences[at], text(scene.sentences[at])])),
        times: Object.fromEntries(asked.map(({ mention }, index) => [keys[index], { text: mention.text, means: describeTime(mention), in: mention.sentenceId }])),
      };
      const questions: DecisionQuestion[] = asked.map((_, index) => ({ key: `time:${keys[index]}`, primitive: "choice", instructions: `What does times.${keys[index]} do to when the scene happens?`, options: [...ROLE_OPTIONS], optionHints: { ...ROLE_LABELS } }));
      const replies = await decide(state, questions);
      asked.forEach(({ mention }, index) => verdicts.set(mention, verdict(replies.find((reply) => reply.key === `time:${keys[index]}`), mention)));
    }
    const anchored: AnchoredMention[] = located.map(({ mention, index }) => ({ ...mention, sceneId: scene.id, sentenceIndexInScene: index, verdict: verdicts.get(mention) ?? { role: "REFERENCE", flashback: 0, confidence: null, decidedBy: "default" } }));
    anchorsByScene.set(scene.id, anchored);
    for (const anchor of anchored) {
      words.push({ key: `${anchor.sentenceId}:${anchor.start}`, text: anchor.text, sentence: anchor.sentenceId, start: anchor.start, end: anchor.end, family: anchor.family, gloss: describeTime(anchor), scene: scene.id, role: anchor.verdict.role, confidence: anchor.verdict.confidence, decidedBy: anchor.verdict.decidedBy, ...(anchor.verdict.downgraded ? { downgraded: anchor.verdict.downgraded } : {}) });
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
  const model = { modelId: "v2", decide: (state: Parameters<Decide>[0], questions: DecisionQuestion[]) => decide(state, questions) };
  const assembled = await assemblePeriods(
    input.scenes.map((scene) => ({ id: scene.id, chapterIndex: scene.chapter, sentenceCount: scene.sentences.length })),
    anchorsByScene,
    async (scene, open) => {
      const index = sceneIndex.get(scene.id)!, sentences = (ids: string[]) => ids.map((id) => ({ id, text: text(id) }));
      return decideContinuation({ decisions: model, opening: sentences(input.scenes[index].sentences.slice(0, 4)), previousTail: index > 0 ? sentences(input.scenes[index - 1].sentences.slice(-3)) : [], flashbackText: open.label });
    },
  );
  const calendar = placeOnCalendar("book", [{
    book: { sourceId: "book", workspace: "", title: "this book", readingOrder: null, continuityId: null },
    periods: assembled.periods.map((period) => ({ id: period.id, label: period.label, storyIndex: period.storyIndex, flashback: period.flashback, date: period.date, ...(period.partOfDay ? { partOfDay: period.partOfDay } : {}), ...(period.anchor.value.hour !== undefined ? { hour: period.anchor.value.hour, minute: period.anchor.value.minute ?? 0 } : {}), scenes: period.sceneIds.length })),
  }]);
  const entryOf = new Map(calendar.entries.map((entry) => [entry.timeId, entry]));
  const periods: Period[] = assembled.periods.map((period) => {
    const entry = entryOf.get(period.id);
    return {
      id: period.id, label: period.label, gloss: period.gloss, role: period.role, flashback: period.flashback, toldFrom: period.toldFromId, date: period.date,
      ...(period.partOfDay ? { partOfDay: period.partOfDay } : {}), storyIndex: period.storyIndex, narrativeIndex: period.narrativeIndex, anchor: period.anchor.sentenceId, scenes: period.sceneIds,
      when: entry ? describeEntry(entry) : null,
    };
  });
  const periodById = new Map(periods.map((period) => [period.id, period]));
  // A flashback's caption says how far back (its calendar range only says where it was told); the present line's, its place on the calendar.
  const caption = (period: Period | undefined) => !period ? "time not stated" : period.flashback ? `the past: ${period.gloss.replace(/^-(.+)$/, "$1 before")}` : period.when ?? period.gloss;
  const scenes: SceneWhen[] = assembled.scenes.map((entry: SceneTime) => ({
    scene: entry.sceneId, periods: entry.periodIds, flashback: entry.flashback, inherited: entry.inherited,
    when: caption(periodById.get(entry.periodIds[0])), ...(entry.continuation ? { continuation: entry.continuation } : {}),
  }));
  const sceneOf = new Map(input.scenes.flatMap((scene) => scene.sentences.map((id) => [id, scene.id])));
  const scenePeriods = new Map(scenes.map((scene) => [scene.scene, scene.periods.map((id) => periodById.get(id)!).filter(Boolean)]));
  const periodOf = (sentence: string): Period | null => {
    const list = scenePeriods.get(sceneOf.get(sentence) ?? "") ?? [];
    const at = position(sentence);
    // A period anchored in this scene starts at its time word; one anchored before the scene (inherited) holds from its start.
    const started = list.filter((period) => sceneOf.get(period.anchor) !== sceneOf.get(sentence) || position(period.anchor) <= at);
    return started.at(-1) ?? list[0] ?? null;
  };
  return { words, periods, scenes, calendar: { entries: calendar.entries, conflicts: calendar.conflicts }, periodOf };
}
