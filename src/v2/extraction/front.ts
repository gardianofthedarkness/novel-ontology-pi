/**
 * The book's introduction in the reading (the user, 2026-11-05: "are we using the introduction parts to leverage our overall
 * understanding?"; "so it becomes basically part of the reading pipeline?"). The book's text starts at its prologue; the
 * EPUB's front matter before it (src/v2/album.ts `matterOf`: <reading>/v2/front.json) holds the publisher's synopsis and
 * its introduction of the main cast: each a line of theirs, what they are (their epithet), and their name. It is no unit
 * of the story (no scene, no story time): it is read by rule into its parts, its cast's other names typed once, and
 * given to the reading as standing knowledge (flow.ts): its lines are standing facts (facts.ts), every EM and EM² request
 * about those people carries them; each person's other names join them when the reading meets them (em.ts Chart
 * `expect`), and two people of the chart that the introduction names as one are one.
 */
import type { Sentence } from "../../digger/intake/sectioning.js";

// Headings of the front matter, as the publisher's pages have them (escaped: the repository carries no book text).
const HEADINGS: Record<string, "cover" | "title" | "credits" | "synopsis" | "contents" | "afterword"> = {
  "\u5c01\u9762": "cover", "\u6807\u9898": "title", "\u5236\u4f5c\u4fe1\u606f": "credits", "\u7b80\u4ecb": "synopsis",
  "\u76ee\u5f55": "contents", "\u540e\u8bb0": "afterword",
};
/** A picture's place in the text ("\u63d2\u56fe3"). */
const PICTURE = /^\u63d2\u56fe\s*\d+$/;
const QUOTED = /^[“\u300c"\u300e]/;
const PUNCTUATION = /[\uff0c\u3002\uff01\uff1f“”\u300c\u300d\uff1a:,.!?\u3001]/;

export interface IntroCast { name: string; epithet: string; quote: string | null; plate: number | null }
export interface IntroParts { synopsis: string[]; cast: IntroCast[]; contents: string[]; afterword: string[]; credits: number }

/**
 * The front matter's parts, by rule: its headings start its sections (credits are counted, not kept); a cast entry is a
 * quoted line, then what the person is, then their name (short, no punctuation), wherever it stands; the picture before it
 * is its plate.
 */
export function introParts(matter: { before: string[]; after: string[] }): IntroParts {
  const out: IntroParts = { synopsis: [], cast: [], contents: [], afterword: [], credits: 0 };
  const paragraphs = matter.before;
  let section: string | null = null, plate: number | null = null, pictures = 0;
  for (let at = 0; at < paragraphs.length; at++) {
    const text = paragraphs[at].trim(), heading = HEADINGS[text];
    if (heading) { section = heading; continue; }
    if (PICTURE.test(text)) { pictures++; plate = pictures; section = section === "synopsis" ? null : section; continue; }
    const epithet = paragraphs[at + 1]?.trim(), name = paragraphs[at + 2]?.trim();
    const plain = (part: string) => !QUOTED.test(part) && !HEADINGS[part] && !PICTURE.test(part);
    if (QUOTED.test(text) && epithet && name && plain(epithet) && plain(name) && name.length <= 16 && !PUNCTUATION.test(name)) {
      out.cast.push({ name, epithet, quote: text, plate }); at += 2; continue;
    }
    if (section === "synopsis") out.synopsis.push(text);
    else if (section === "contents") out.contents.push(text);
    else if (section === "credits") out.credits++;
  }
  let afterword = false;
  for (const paragraph of matter.after) { const text = paragraph.trim(); if (HEADINGS[text] === "afterword") { afterword = true; continue; } if (afterword) out.afterword.push(text); }
  return out;
}

/** The introduction as sentences (ids intro_sNNNN): each cast entry one (what they are, their name, their line), then the synopsis's paragraphs. */
export function introSentences(parts: IntroParts): { sentences: Sentence[]; castOf: Map<string, number> } {
  const sentences: Sentence[] = [], castOf = new Map<string, number>();
  const add = (text: string) => { const id = `intro_s${String(sentences.length).padStart(4, "0")}`; sentences.push({ id, text, startOffset: 0, endOffset: text.length } as Sentence); return id; };
  parts.cast.forEach((entry, index) => castOf.set(add(`${entry.epithet}\uff1a${entry.name}\u3002${entry.quote ?? ""}`), index));
  for (const paragraph of parts.synopsis) add(paragraph);
  return { sentences, castOf };
}

const NUMERALS: Record<string, string> = { "\u3007": "0", "\u96f6": "0", "\u4e00": "1", "\u4e8c": "2", "\u4e09": "3", "\u56db": "4", "\u4e94": "5", "\u516d": "6", "\u4e03": "7", "\u516b": "8", "\u4e5d": "9" };
/** A run of three or more Chinese numerals as digits (\u68c0\u4f53\u756a\u53f7\u4e00\u3007\u3007\u4e09\u4e8c\u53f7 → \u68c0\u4f53\u756a\u53f710032\u53f7), else null. */
export function digitForm(text: string): string | null {
  const run = /[\u3007\u96f6\u4e00\u4e8c\u4e09\u56db\u4e94\u516d\u4e03\u516b\u4e5d]{3,}/;
  return run.test(text) ? text.replace(new RegExp(run.source, "g"), (found) => [...found].map((c) => NUMERALS[c]).join("")) : null;
}

/**
 * A numbered designation's forms as a book writes them: its digits in place (\u68c0\u4f53\u756a\u53f710032\u53f7), and the number with its
 * counter alone (10032\u53f7: vol 1 writes the serial numbers so).
 */
export function designationForms(text: string): string[] {
  const digits = digitForm(text);
  if (!digits) return [];
  const short = digits.match(/\d{3,}\u53f7?/)?.[0];
  return [...new Set([digits, ...(short && short.endsWith("\u53f7") ? [short] : [])])];
}

/**
 * The strings of a cast entry that may be another name of theirs, by rule: what its epithet quotes (“\u8d85\u7535\u78c1\u70ae”), and the
 * parts of it set off by a middle dot (\u59b9\u59b9\u4eec·\u68c0\u4f53\u756a\u53f7\u4e00\u3007\u3007\u4e09\u4e8c\u53f7); typing says which are names of the person (the rest:
 * an ability, a title, a group). The digits of a numbered designation are a form of it too.
 */
export function introTerms(entry: IntroCast): string[] {
  const quoted = [...entry.epithet.matchAll(/[“\u300c\u300e"]([^”\u300d\u300f"]{1,16})[”\u300d\u300f"]/g)].map((match) => match[1]);
  const dotted = entry.epithet.includes("·") && entry.epithet.length <= 24 ? entry.epithet.split("·").map((part) => part.trim()).filter((part) => part && part.length <= 16) : [];
  return [...new Set([...quoted, ...dotted].filter((term) => term !== entry.name))];
}
