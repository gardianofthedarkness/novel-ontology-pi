import { scaleOfName } from "../../digger/stage/scale.js";

/**
 * What the code rules need to know of a language (docs/v2/world-model.md §3; src/v2/rules/index.ts): the words and marks
 * that say where a place is against another, which level of the world a word points at, and what the generic part of a
 * place's name says of its scale. One profile per language; the reading uses LANGUAGE. A new language is a new profile
 * here, and no rule elsewhere changes.
 */
export type Level = "underground" | "street" | "inside" | "roof" | "wall" | "sky";
export interface LanguageRules {
  name: string;
  /** A place word with a locative after it is a spatial relation, not a place (街上: on the street). */
  locative: RegExp;
  /** What may stand between two named places for the first to hold the second (X的Y, X，Y, XY). */
  join: RegExp;
  /** Words for each level of the world, the most specific first (地下通道 is underground before it is a passage). */
  levels: [RegExp, Level][];
  /** The scale the generic part of a place's name says (第七学区: a district), or null. */
  scaleOfName(label: string): string | null;
}

export const ZH: LanguageRules = {
  name: "zh",
  locative: /^.+[上下里中内外边旁]$/,
  join: /^(?:的|之|里的|内的|中的|里|内|中|，|、|\s)?$/,
  levels: [
    [/地下|地底|下水道|地铁|隧道/, "underground"],
    [/屋顶|楼顶|天台|顶层|最上层|房顶|屋檐/, "roof"],
    [/上空|空中|天上|半空|高空/, "sky"],
    [/墙/, "wall"],
    [/走廊|楼梯|台阶|出口|入口|门口|电梯|室内|屋内|楼内|店内|[一二三四五六七八九十百\d]+[楼层]/, "inside"],
    [/地面|地表|地上|街上|路上|马路|路边|街头|路面/, "street"],
  ],
  scaleOfName: (label) => { const scale = scaleOfName(label); return scale && scale !== "none" ? scale : null; },
};

/** The language the reading is in. */
export const LANGUAGE: LanguageRules = ZH;
