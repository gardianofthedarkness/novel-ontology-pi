/**
 * Programmatic time-expression detector (time-place faculty, phase 1).
 *
 * Cheap, deterministic and explainable: it finds time vocabulary sentence by
 * sentence and normalises only what the words themselves say (a calendar
 * date, a clock time, "+1 day", "3 years before"). It never invents a date
 * and never decides whether a mention moves the story's time; that is the
 * Jev role check's job. Chinese is the primary target; Japanese and English
 * have basic coverage.
 */
export type TimeFamily =
  | "date"          // 十二月二十四日, 1957年, December 24
  | "clock"         // 七点, 0点0分, 10:30
  | "relative-day"  // 今天, 第二天, 翌日, yesterday
  | "relative-span" // 三天前, 十六年后, three years later
  | "time-of-day"   // 早上, 深夜, 放学后, at dawn
  | "holiday"       // 平安夜, 圣诞节, 寒假
  | "season"        // 冬天, summer
  | "weekday"       // 星期五, Monday
  | "past-marker";  // 当时, 那时候, 很久以前: possible flashback signs

export interface TimeValue {
  year?: number;
  month?: number;
  day?: number;
  hour?: number;
  minute?: number;
  /** Signed offset from the time it is relative to. */
  offset?: { amount: number | null; unit: "second" | "minute" | "hour" | "day" | "week" | "month" | "year" | "century"; };
  partOfDay?: "dawn" | "morning" | "noon" | "afternoon" | "evening" | "night" | "late-night" | "after-school" | "daytime";
  holiday?: string;
  season?: "spring" | "summer" | "autumn" | "winter";
  weekday?: number;
}

export interface TimeMention {
  text: string;
  sentenceId: string;
  /** Character offsets inside the sentence. */
  start: number;
  end: number;
  family: TimeFamily;
  value: TimeValue;
  /** Inside quotation marks: usually dialogue, which rarely moves scene time. */
  inQuote: boolean;
  source: "lexicon" | "llm";
}

const CN_DIGITS: Record<string, number> = { 〇: 0, 零: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const CN_UNITS: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };

/** Chinese or Arabic numerals to a number ("二十四" → 24, "一九五七" → 1957). */
export function parseNumber(text: string): number | null {
  const ascii = text.replace(/[０-９]/g, (digit) => String(digit.charCodeAt(0) - 0xff10));
  if (/^\d+$/.test(ascii)) return Number(ascii);
  if (![...text].every((character) => character in CN_DIGITS || character in CN_UNITS)) return null;
  if (![...text].some((character) => character in CN_UNITS)) return Number([...text].map((character) => CN_DIGITS[character]).join(""));
  let total = 0, section = 0, digit = 0;
  for (const character of text) {
    if (character in CN_DIGITS) { digit = CN_DIGITS[character]; continue; }
    const unit = CN_UNITS[character];
    if (unit === 10000) { total += (section + digit) * unit; section = 0; digit = 0; continue; }
    section += (digit || 1) * unit;
    digit = 0;
  }
  return total + section + digit;
}

const NUM = "[〇零一二三四五六七八九十百千两\\d０-９]";
const RELATIVE_DAYS: Record<string, { amount: number; partOfDay?: TimeValue["partOfDay"] }> = {
  今天: { amount: 0 }, 今日: { amount: 0 }, 这天: { amount: 0 }, 这一天: { amount: 0 }, 那一日: { amount: 0 }, 当天: { amount: 0 }, 那天: { amount: 0 }, 那一天: { amount: 0 }, 同一天: { amount: 0 }, 当日: { amount: 0 },
  明天: { amount: 1 }, 明日: { amount: 1 }, 翌日: { amount: 1 }, 次日: { amount: 1 }, 第二天: { amount: 1 }, 隔天: { amount: 1 }, 第二日: { amount: 1 }, 隔日: { amount: 1 },
  后天: { amount: 2 }, 昨天: { amount: -1 }, 昨日: { amount: -1 }, 前一天: { amount: -1 }, 前天: { amount: -2 },
  今晚: { amount: 0, partOfDay: "evening" }, 当晚: { amount: 0, partOfDay: "evening" }, 那晚: { amount: 0, partOfDay: "evening" }, 今夜: { amount: 0, partOfDay: "night" },
  昨晚: { amount: -1, partOfDay: "evening" }, 昨夜: { amount: -1, partOfDay: "night" }, 明晚: { amount: 1, partOfDay: "evening" },
  今早: { amount: 0, partOfDay: "morning" }, 明早: { amount: 1, partOfDay: "morning" }, 翌朝: { amount: 1, partOfDay: "morning" },
  // Japanese
  昨晩: { amount: -1, partOfDay: "evening" }, 今朝: { amount: 0, partOfDay: "morning" }, 次の日: { amount: 1 }, 翌晩: { amount: 1, partOfDay: "evening" },
};
const PARTS_OF_DAY: Record<string, NonNullable<TimeValue["partOfDay"]>> = {
  黎明: "dawn", 拂晓: "dawn", 清晨: "dawn", 凌晨: "late-night", 早上: "morning", 早晨: "morning", 上午: "morning", 中午: "noon", 正午: "noon",
  下午: "afternoon", 傍晚: "evening", 黄昏: "evening", 日落时分: "evening", 日落时: "evening", 晚上: "evening", 夜晚: "night", 夜里: "night", 夜间: "night", 深夜: "late-night", 半夜: "late-night", 午夜: "late-night",
  放学后: "after-school", 白天: "daytime", 夕方: "evening", 放課後: "after-school",
};
// Eves are nights: a following "morning" belongs to the next day.
const HOLIDAYS: Record<string, { holiday: string; month?: number; day?: number; partOfDay?: TimeValue["partOfDay"] }> = {
  平安夜: { holiday: "christmas-eve", month: 12, day: 24, partOfDay: "night" }, 圣诞夜: { holiday: "christmas-eve", month: 12, day: 24, partOfDay: "night" }, 圣诞节: { holiday: "christmas", month: 12, day: 25 },
  元旦: { holiday: "new-year", month: 1, day: 1 }, 新年: { holiday: "new-year" }, 除夕: { holiday: "new-years-eve", partOfDay: "night" }, 跨年: { holiday: "new-years-eve", partOfDay: "night" }, 年末: { holiday: "year-end" }, 年底: { holiday: "year-end" },
  暑假: { holiday: "summer-break" }, 寒假: { holiday: "winter-break" }, 春假: { holiday: "spring-break" },
  クリスマス: { holiday: "christmas", month: 12, day: 25 }, クリスマスイブ: { holiday: "christmas-eve", month: 12, day: 24, partOfDay: "night" },
};
const SEASONS: Record<string, NonNullable<TimeValue["season"]>> = { 春天: "spring", 夏天: "summer", 秋天: "autumn", 冬天: "winter", 春季: "spring", 夏季: "summer", 秋季: "autumn", 冬季: "winter" };
const PAST_MARKERS = ["很久以前", "很久很久以前", "从前", "那时候", "那个时候", "那时", "当时", "曾经", "小时候", "年幼时", "几年前", "多年前", "数年前", "回想起", "回忆起", "想起了"];
type SpanUnit = NonNullable<TimeValue["offset"]>["unit"];
const SPAN_UNITS: Record<string, SpanUnit> = {
  秒: "second", 秒钟: "second", 分钟: "minute", 小时: "hour", 个小时: "hour", 钟头: "hour", 个钟头: "hour", 天: "day", 日: "day", 周: "week", 星期: "week", 个星期: "week", 个月: "month", 年: "year", 世纪: "century",
};
const WEEKDAYS: Record<string, number> = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 日: 7, 天: 7 };
const EN_MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

interface Rule { family: TimeFamily; pattern: RegExp; value: (match: RegExpExecArray) => TimeValue | null }

const keys = (record: Record<string, unknown>) => Object.keys(record).sort((first, second) => second.length - first.length).join("|");

const RULES: Rule[] = [
  // Calendar dates: (year) month day, or a four-digit year on its own.
  { family: "date", pattern: new RegExp(`(?:(${NUM}{4})年)?(${NUM}{1,3})月(${NUM}{1,3})[日号]`, "g"), value: (m) => {
    const month = parseNumber(m[2]), day = parseNumber(m[3]);
    if (!month || month > 12 || !day || day > 31) return null;
    return { ...(m[1] ? { year: parseNumber(m[1]) ?? undefined } : {}), month, day };
  } },
  { family: "date", pattern: new RegExp(`(${NUM}{4})年(?:(${NUM}{1,2})月)?`, "g"), value: (m) => {
    const year = parseNumber(m[1]); const month = m[2] ? parseNumber(m[2]) : null;
    if (!year || year < 100 || month !== null && (month < 1 || month > 12)) return null;
    return { year, ...(month ? { month } : {}) };
  } },
  { family: "date", pattern: new RegExp(`(?<![${"〇零一二三四五六七八九十两\\d"}])(${NUM}{1,2})月(?![${"〇零一二三四五六七八九十两\\d"}日号份])`, "g"), value: (m) => {
    const month = parseNumber(m[1]); return month && month <= 12 ? { month } : null;
  } },
  // Numeric month/day: "12/24" (not fractions or longer numbers).
  { family: "date", pattern: /(?<![\d/])(1[0-2]|0?[1-9])\/(3[01]|[12]\d|0?[1-9])(?![\d/])/g, value: (m) => m[1].length + m[2].length >= 3 ? { month: Number(m[1]), day: Number(m[2]) } : null },
  // A day of the month on its own: "25日", "二十五号" (not "一日", "三日后").
  { family: "date", pattern: new RegExp(`(?<![月${"〇零一二三四五六七八九十两\\d"}])(\\d{1,2}|[一二三][十]?[一二三四五六七八九]?|十[一二三四五六七八九]?)[日号](?![后前之以内间夜])`, "g"), value: (m) => {
    if (/^[一二三四五六七八九]$/.test(m[1])) return null;
    const day = parseNumber(m[1]); return day && day <= 31 ? { day } : null;
  } },
  // Clock times need clock context: "一点" alone usually means "a little".
  { family: "clock", pattern: new RegExp(`(${NUM}{1,3})点(?:(${NUM}{1,3})分|半|钟|整)`, "g"), value: (m) => {
    const hour = parseNumber(m[1]); if (hour === null || hour > 24) return null;
    const minute = m[0].endsWith("半") ? 30 : m[2] ? parseNumber(m[2]) : 0;
    return minute === null || minute > 59 ? null : { hour, minute };
  } },
  { family: "clock", pattern: new RegExp(`(${keys(PARTS_OF_DAY)})(${NUM}{1,2})点(?:(${NUM}{1,3})分|半)?`, "g"), value: (m) => {
    const raw = parseNumber(m[2]); if (raw === null || raw > 24) return null;
    const partOfDay = PARTS_OF_DAY[m[1]];
    // 晚上七点 is 19:00; 凌晨/早上 hours stay as written.
    const hour = raw < 12 && ["afternoon", "evening", "night"].includes(partOfDay) ? raw + 12 : raw;
    const minute = m[0].endsWith("半") ? 30 : m[3] ? parseNumber(m[3]) : 0;
    return minute === null || minute > 59 ? null : { hour, minute, partOfDay };
  } },
  { family: "clock", pattern: /\b(\d{1,2})[:：](\d{2})\b/g, value: (m) => Number(m[1]) <= 24 && Number(m[2]) <= 59 ? { hour: Number(m[1]), minute: Number(m[2]) } : null },
  // Spans with a direction: 三天前, 十六年后, 几秒之后.
  { family: "relative-span", pattern: new RegExp(`(${NUM}+|几|数|半)(${keys(SPAN_UNITS)})(之前|以前|之后|以后|过后|前|后)`, "g"), value: (m) => {
    const amount = m[1] === "几" || m[1] === "数" ? null : m[1] === "半" ? 0.5 : parseNumber(m[1]);
    const sign = /前/.test(m[3]) ? -1 : 1;
    return { offset: { amount: amount === null ? null : amount * sign, unit: SPAN_UNITS[m[2]] } };
  } },
  { family: "relative-day", pattern: new RegExp(keys(RELATIVE_DAYS), "g"), value: (m) => {
    const entry = RELATIVE_DAYS[m[0]]; return { offset: { amount: entry.amount, unit: "day" }, ...(entry.partOfDay ? { partOfDay: entry.partOfDay } : {}) };
  } },
  { family: "holiday", pattern: new RegExp(keys(HOLIDAYS), "g"), value: (m) => { const { holiday, month, day, partOfDay } = HOLIDAYS[m[0]]; return { holiday, ...(month ? { month } : {}), ...(day ? { day } : {}), ...(partOfDay ? { partOfDay } : {}) }; } },
  { family: "season", pattern: new RegExp(keys(SEASONS), "g"), value: (m) => ({ season: SEASONS[m[0]] }) },
  { family: "weekday", pattern: /(?:星期|礼拜|周)([一二三四五六日天])/g, value: (m) => ({ weekday: WEEKDAYS[m[1]] }) },
  { family: "time-of-day", pattern: new RegExp(keys(PARTS_OF_DAY), "g"), value: (m) => ({ partOfDay: PARTS_OF_DAY[m[0]] }) },
  { family: "past-marker", pattern: new RegExp(PAST_MARKERS.sort((first, second) => second.length - first.length).join("|"), "g"), value: () => ({}) },
  // A short sentence that is only "(在)……之前/以前/那时/的时候。" opens a recollection.
  // ("就在/正在/正当……的时候" is "just as", not a recollection.)
  { family: "past-marker", pattern: /^(?!就在|正在|正当|就当)(?:在)?[^，。！？“”「」]{1,12}(?:之前|以前|那时|那时候|的时候)(?=[。…]*$)/g, value: () => ({}) },
  // English
  { family: "date", pattern: new RegExp(`\\b(${EN_MONTHS.join("|")})\\s+(\\d{1,2})(?:st|nd|rd|th)?(?:,?\\s+(\\d{4}))?`, "gi"), value: (m) => ({ month: EN_MONTHS.indexOf(m[1].toLowerCase()) + 1, day: Number(m[2]), ...(m[3] ? { year: Number(m[3]) } : {}) }) },
  { family: "relative-day", pattern: /\b(today|tonight|tomorrow|yesterday|the next (?:day|morning|evening)|the following (?:day|morning)|the day before|that (?:day|night|morning|evening))\b/gi, value: (m) => {
    const text = m[1].toLowerCase();
    const amount = /tomorrow|next|following/.test(text) ? 1 : /yesterday|before/.test(text) ? -1 : 0;
    return { offset: { amount, unit: "day" }, ...(/night|tonight/.test(text) ? { partOfDay: "night" as const } : /morning/.test(text) ? { partOfDay: "morning" as const } : /evening/.test(text) ? { partOfDay: "evening" as const } : {}) };
  } },
  { family: "relative-span", pattern: /\b(\d+|a|an|one|two|three|four|five|six|seven|eight|nine|ten|several|a few)\s+(second|minute|hour|day|week|month|year|century)s?\s+(ago|earlier|later|before|after)\b/gi, value: (m) => {
    const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
    const raw = m[1].toLowerCase(); const amount = /^\d+$/.test(raw) ? Number(raw) : words[raw] ?? null;
    const sign = /ago|earlier|before/.test(m[3].toLowerCase()) ? -1 : 1;
    return { offset: { amount: amount === null ? null : amount * sign, unit: m[2].toLowerCase() as SpanUnit } };
  } },
  { family: "past-marker", pattern: /\b(long ago|years ago|back then|at that time|in those days|as a child|once upon a time)\b/gi, value: () => ({}) },
];

// Speech and inner-thought brackets: （……） carries a character's thoughts
// in Chinese/Japanese novels, which rarely move the scene's own time.
const OPEN_QUOTES = "“「『（\"‘";
const CLOSE_QUOTES = "”」』）\"’";

/** Which character offsets of a sentence sit inside quotation marks. */
function quoteMask(text: string, startsInside: boolean): boolean[] {
  const mask: boolean[] = [];
  let depth = startsInside ? 1 : 0;
  for (const character of text) {
    if (OPEN_QUOTES.includes(character) && !(character === "\"" && depth > 0)) { depth++; mask.push(true); continue; }
    if (CLOSE_QUOTES.includes(character) && depth > 0) { mask.push(true); depth--; continue; }
    mask.push(depth > 0);
  }
  return mask;
}

/** Per-sentence quotation masks, carrying an open quote across sentences. */
export function quoteMasks(sentences: { id: string; text: string }[]): Map<string, boolean[]> {
  const masks = new Map<string, boolean[]>();
  let openQuote = false;
  for (const sentence of sentences) {
    masks.set(sentence.id, quoteMask(sentence.text, openQuote));
    const opens = [...sentence.text].filter((character) => "“「『（".includes(character)).length;
    const closes = [...sentence.text].filter((character) => "”」』）".includes(character)).length;
    openQuote = openQuote ? closes <= opens : opens > closes;
  }
  return masks;
}

/**
 * Find time mentions in source sentences, in order. Overlapping matches keep
 * the longest (and earliest) one, so "十二月二十四日" is one date, not a
 * date plus a month.
 */
export function detectTimeMentions(sentences: { id: string; text: string }[]): TimeMention[] {
  const mentions: TimeMention[] = [];
  let openQuote = false;
  for (const sentence of sentences) {
    const mask = quoteMask(sentence.text, openQuote);
    const found: TimeMention[] = [];
    for (const rule of RULES) {
      rule.pattern.lastIndex = 0;
      for (let match = rule.pattern.exec(sentence.text); match; match = rule.pattern.exec(sentence.text)) {
        const value = rule.value(match);
        if (!value) continue;
        const start = match.index, end = start + match[0].length;
        found.push({ text: match[0], sentenceId: sentence.id, start, end, family: rule.family, value, inQuote: mask.slice(start, end).some(Boolean), source: "lexicon" });
      }
    }
    found.sort((first, second) => first.start - second.start || (second.end - second.start) - (first.end - first.start));
    for (const mention of found) if (!mentions.some((kept) => kept.sentenceId === mention.sentenceId && kept.start < mention.end && mention.start < kept.end)) mentions.push(mention);
    // A quote left open at the end of a sentence continues into the next.
    const opens = [...sentence.text].filter((character) => "“「『（".includes(character)).length;
    const closes = [...sentence.text].filter((character) => "”」』）".includes(character)).length;
    openQuote = openQuote ? closes <= opens : opens > closes;
  }
  return mentions;
}

/**
 * Whether a mention deserves a Jev role check. Hard time words in narration
 * always do; soft ones (holiday, season, time of day, weekday) only where
 * they can set the scene's time: near the scene's start or leading a
 * sentence ("傍晚，……"). Quoted mentions default to reference: dialogue
 * rarely moves the scene's own time.
 */
export function needsRoleCheck(mention: TimeMention, sentenceIndexInScene: number, sentenceText = ""): boolean {
  if (mention.inQuote) return false;
  const monthOnly = mention.family === "date" && !mention.value.day && !mention.value.year;
  if (["clock", "relative-day", "relative-span", "past-marker"].includes(mention.family) || mention.family === "date" && !monthOnly) return true;
  // Soft words set time only near a scene's start or as a leading time phrase.
  return sentenceIndexInScene < 3 || leadsSentence(mention, sentenceText);
}

/** "傍晚，……" / "时间到了傍晚。" / "Evening came." — a time phrase that carries the sentence. */
export function leadsSentence(mention: Pick<TimeMention, "start" | "end">, sentenceText: string): boolean {
  if (!sentenceText) return mention.start <= 1;
  const after = sentenceText.slice(mention.end, mention.end + 1);
  if (mention.start <= 1 && /[，,。、 ]/.test(after)) return true;
  if (sentenceText.length - (mention.end - mention.start) <= 8) return true;
  return /时间到了|已经是|已是|转眼|到了|进入了|迎来了/.test(sentenceText.slice(Math.max(0, mention.start - 6), mention.start));
}

/** Connectives and deictics the LLM sometimes lists that never anchor time. */
export const NON_ANCHOR_WORDS = new Set(["之后", "之前", "以后", "以前", "后来", "然后", "接着", "随后", "刚才", "刚刚", "现在", "此时", "此刻", "如今", "目前", "这时", "这时候", "这个时候", "就在这时", "正在这时", "就在此时", "与此同时", "同时", "那之后", "不久", "片刻", "迄今为止", "至今", "一直", "最近", "now", "then", "later", "before", "after", "meanwhile", "just then"]);

/** A span needs a quantity to be a time span ("三天后", "几秒之后"). */
export const hasQuantity = (text: string) => /[〇零一二三四五六七八九十百千两几数半\d０-９]|several|few|a |an |one|two|three|four|five|six|seven|eight|nine|ten/i.test(text);

/**
 * Parse a time phrase found by the LLM with the same rules, so its value is
 * known ("十秒钟" → +10 seconds). A span without a direction reads forward.
 */
/** "The next instant" words: the scene continues (micro jump). */
const MOMENT_WORDS = /^(下一刻|下一秒|下一瞬间?|下个瞬间|转瞬|转眼间?|片刻后|片刻之后|不一会儿?|没过多久|一会儿后|稍后|一瞬间|眨眼间)$/;

export function parseTimeText(text: string): Pick<TimeMention, "family" | "value"> | null {
  if (MOMENT_WORDS.test(text.trim())) return { family: "relative-span", value: { offset: { amount: 1, unit: "second" } } };
  const [found] = detectTimeMentions([{ id: "x", text }]).sort((first, second) => (second.end - second.start) - (first.end - first.start));
  if (found) return { family: found.family, value: found.value };
  const span = new RegExp(`(${NUM}+|几|数|半)(${keys(SPAN_UNITS)})`).exec(text);
  if (span) {
    const amount = span[1] === "几" || span[1] === "数" ? null : span[1] === "半" ? 0.5 : parseNumber(span[1]);
    return { family: "relative-span", value: { offset: { amount, unit: SPAN_UNITS[span[2]] } } };
  }
  return null;
}

/**
 * Strong, unambiguous "the story is now at this time" cues, decided by rule
 * (programmatic first): a sentence that is only a time phrase
 * ("十二月二十四日，凌晨0点0分") or "时间到了傍晚" / "转眼已是…". Flashbacks are
 * never rule-decided: Jev judges them.
 */
export function strongAdvanceCue(mention: Pick<TimeMention, "start" | "end" | "family" | "inQuote">, sentenceText: string): boolean {
  if (mention.inQuote || mention.family === "past-marker" || mention.family === "relative-span" || mention.family === "season" || mention.family === "weekday") return false;
  const rest = sentenceText.replace(/^[>《〈\s]+/, "").replace(/[，,。、…!！?？\s>]/g, "");
  if (rest.length <= 18 && /^[〇零一二三四五六七八九十百千两\d０-９年月日号点分时，,、凌晨早上中午下午傍晚晚上夜里深夜午夜黎明清晨平安夜圣诞节第二天翌日次日当天这天那天]+$/.test(rest)) return true;
  // "平安夜开始了。" / "夜晚降临，" — the clause ends on the arrival.
  if (/^(?:就)?(?:开始了|来临了|降临了|到来了|到了)[。，,！!…]/.test(sentenceText.slice(mention.end, mention.end + 5))) return true;
  // "时间到了傍晚" / "转眼已是第二天" — only for words that can name a moment.
  return ["date", "clock", "relative-day", "time-of-day"].includes(mention.family) && /(时间到了|转眼间?(就)?(到了|已是|已经是)?|已经是|已是|终于到了|迎来了)$/.test(sentenceText.slice(Math.max(0, mention.start - 8), mention.start));
}

/**
 * A calendar date or a forward relative day leading a sentence as its time
 * phrase ("25日，……", "第二天，……") sets the scene's time. The caller rules
 * out dates earlier than the story's current date (those may be flashbacks).
 */
export function leadingDateCue(mention: Pick<TimeMention, "start" | "end" | "family" | "value" | "inQuote">, sentenceText: string): boolean {
  if (mention.inQuote || mention.start > 1 || !/^[，,]/.test(sentenceText.slice(mention.end))) return false;
  if (mention.family === "date") return !!mention.value.day;
  return mention.family === "relative-day" && (mention.value.offset?.amount ?? -1) >= 1;
}

/** Short, readable English gloss of a normalised value (for labels and review). */
export function describeTime(mention: Pick<TimeMention, "family" | "value" | "text">): string {
  const { value } = mention;
  const parts: string[] = [];
  if (value.year || value.month || value.day) parts.push([value.year, value.month && String(value.month).padStart(2, "0"), value.day && String(value.day).padStart(2, "0")].filter(Boolean).join("-"));
  if (value.hour !== undefined) parts.push(`${String(value.hour).padStart(2, "0")}:${String(value.minute ?? 0).padStart(2, "0")}`);
  if (value.offset) parts.push(value.offset.amount === null ? `some ${value.offset.unit}s ${mention.text.includes("前") || /ago|before|earlier/i.test(mention.text) ? "before" : "after"}` : value.offset.amount === 0 ? "same day" : `${value.offset.amount > 0 ? "+" : ""}${value.offset.amount} ${value.offset.unit}${Math.abs(value.offset.amount) === 1 ? "" : "s"}`);
  if (value.partOfDay) parts.push(value.partOfDay);
  if (value.holiday) parts.push(value.holiday);
  if (value.season) parts.push(value.season);
  if (value.weekday) parts.push(["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"][value.weekday]);
  if (mention.family === "past-marker") parts.push("past marker");
  return parts.join(" · ") || mention.family;
}
