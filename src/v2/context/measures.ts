/**
 * The measures a text gives of a place (the user, 2026-11-01): a number and a unit of height in the sentences naming it
 * (五十层, 两百米高, 地下三层, 50 floors, 200 m tall), found by pattern, no model. Each is offered to Jev in the place's
 * height question as a slice of its own, "as the text says", beside its kind's slices, at every level.
 *
 * Floors count when the unit is a building's (层 followed by what a building is or has, 階, F, floors, storeys); metres only
 * beside a word of height or depth (高, 深, 地下, tall, high, deep), so a distance walked is never offered as a height.
 * Under the street (地下) a measure is negative: how deep.
 */
export interface Measure {
  /** Its height in metres (three a floor); negative, how deep under the street. */
  y: number;
  /** Its floors, when the text gave floors. */
  floors: number | null;
  /** What it says, for the slice (never the text's own words: a slice is drawn in the pictures, which may be published). */
  said: string;
  /** The text's own words, for the run's log and tests only. */
  phrase: string;
  /** In the place's own name (五十层的高层大楼), which is offered first. */
  named: boolean;
}

const DIGIT: Record<string, number> = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9, 几: 5, 数: 5 };
const UNIT: Record<string, number> = { 十: 10, 百: 100, 千: 1000, 万: 10000 };
/** A number in digits (full-width too) or Chinese numerals: 五十 50, 一百二十 120, 十几 15, 几十 50, 上百 100. */
export function numberOf(text: string): number | null {
  const plain = text.replace(/[０-９．]/g, (c) => (c === "．" ? "." : String(c.charCodeAt(0) - 0xff10)));
  if (/^\d+(?:\.\d+)?$/.test(plain)) return Number(plain);
  let total = 0, section = 0, digit: number | null = null;
  for (const ch of plain.replace(/^上/, "")) {
    if (ch in DIGIT) digit = DIGIT[ch];
    else if (ch in UNIT) {
      if (UNIT[ch] === 10000) { total = (total + section + (digit ?? 0)) * 10000; section = 0; } else section += (digit ?? 1) * UNIT[ch];
      digit = null;
    } else return null;
  }
  const value = total + section + (digit ?? 0);
  return value > 0 ? value : null;
}

const NUM = String.raw`([0-9０-９]+(?:[.．][0-9０-９]+)?|上?[零〇一二两三四五六七八九十百千万几数]+)\s*(?:多|余|来)?\s*`;
// 层 is also a layer (一层灰尘): a floor only after 地下 or 第, or before what a building is or has.
const FLOORS = new RegExp(String.raw`(地下|第)\s*${NUM}(?:层|層|階)|${NUM}(?:层(?=楼|高|的|以上|以下|左右|建筑|大楼|大厦|公寓|住宅|塔)|層(?=楼|樓|高|的|の|以上|建)|階(?:建て)?|F\b|floors?\b|stor(?:e)?ys?\b)`, "giu");
const METRES = new RegExp(String.raw`${NUM}(?:米|公尺|m\b|meters?\b|metres?\b)`, "giu");
const HEIGHT_BEFORE = /(高|深|地下|tall|high|deep|height|depth)[^。！？.!?]{0,6}$/i, HEIGHT_AFTER = /^\s*(?:多|左右)?\s*(高|深|tall|high|deep)/i;

/** The measures of height in a place's texts, its name first (`texts[0]`, when `named`), each height once, at most `max`. */
export function measuresIn(texts: string[], { named = true, max = 3 }: { named?: boolean; max?: number } = {}): Measure[] {
  const found = new Map<number, Measure & { count: number }>();
  texts.forEach((text, n) => {
    const own = named && n === 0;
    const add = (y: number, floors: number | null, phrase: string) => {
      if (!Number.isFinite(y) || y === 0 || Math.abs(y) > 1000) return;
      const key = Math.round(y), was = found.get(key);
      if (was) { was.count++; was.named ||= own; return; }
      const said = floors !== null ? (y < 0 ? `${floors} floor${floors === 1 ? "" : "s"} under the street` : `${floors} floor${floors === 1 ? "" : "s"}`) : y < 0 ? `${-y} m under the street` : `${y} m`;
      found.set(key, { y: key, floors, said, phrase, named: own, count: 1 });
    };
    for (const m of text.matchAll(FLOORS)) { const floors = numberOf(m[2] ?? m[3]); if (floors && floors <= 300) add((m[1] === "地下" ? -3 : 3) * floors, floors, m[0].trim()); }
    for (const m of text.matchAll(METRES)) {
      const value = numberOf(m[1]), before = text.slice(Math.max(0, m.index! - 8), m.index), after = text.slice(m.index! + m[0].length, m.index! + m[0].length + 8);
      const cue = before.match(HEIGHT_BEFORE)?.[1] ?? after.match(HEIGHT_AFTER)?.[1];
      if (value && cue) add(/深|地下|deep|depth/i.test(cue) ? -value : value, null, m[0].trim());
    }
  });
  return [...found.values()].sort((a, b) => Number(b.named) - Number(a.named) || b.count - a.count).slice(0, max).map(({ count, ...measure }) => measure);
}
