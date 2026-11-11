import { scaleOfName } from "../../digger/stage/scale.js";

/**
 * What the code rules need to know of a language (docs/v3/design.html#world-model §3; src/v2/rules/index.ts): the words and marks
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
  /** A part of a building (a wall, a pillar, a window): where someone is against it, never a place of its own. */
  part: RegExp;
  /** A floor or the top of a building as a whole word (最上层, 第四十四层, 楼顶): a level inside a place, never a place. */
  floor: RegExp;
  /** Words for each level of the world, the most specific first (地下通道 is underground before it is a passage). */
  levels: [RegExp, Level][];
  /** The scale the generic part of a place's name says (第七学区: a district), or null. */
  scaleOfName(label: string): string | null;
  /** What a building is used for, by the words of its name (便利店: a convenience store), the most specific first. */
  buildingUses: [RegExp, BuildingUse][];
  /** What an underground space is, by the words of its name (地下停车场: a car park), the most specific first. */
  undergroundKinds: [RegExp, string][];
  /**
   * The words that say a sentence answers a terrain question about a place (terrain modes rank a place's scenes by them):
   * how high it stands, what kind of ground it is, where it lies. Global patterns: every match counts.
   */
  questionWords: { height: RegExp; ground: RegExp; where: RegExp };
}
/** What a building is used for: the kinds a street's buildings come in (landscape.ts STREET_USES), and a building's own. */
export type BuildingUse = "convenience" | "shop" | "cafe" | "restaurant" | "bar" | "arcade" | "bank" | "mall" | "department" | "office" | "hotel" | "apartment" | "dormitory" | "house" | "school" | "hospital" | "clinic" | "station" | "government" | "church" | "warehouse" | "workshop" | "lab" | "parking" | "cinema";

export const ZH: LanguageRules = {
  name: "zh",
  locative: /^.+[上下里中内外边旁]$/,
  join: /^(?:的|之|里的|内的|中的|里|内|中|，|、|\s)?$/,
  part: /(?:墙|墙壁|墙面|围墙|柱|柱子|支柱|地板|天花板|窗|窗户)$/,
  floor: /^(?:第?[一二三四五六七八九十百\d]+[楼层]|最上层|顶层|楼顶|屋顶|天台|地下[一二三四五六七八九十\d]*层)$/,
  levels: [
    [/地下|地底|下水道|地铁|隧道/, "underground"],
    [/屋顶|楼顶|天台|顶层|最上层|房顶|屋檐/, "roof"],
    [/上空|空中|天上|半空|高空/, "sky"],
    [/墙/, "wall"],
    [/走廊|楼梯|台阶|出口|入口|门口|电梯|室内|屋内|楼内|店内|[一二三四五六七八九十百\d]+[楼层]/, "inside"],
    [/地面|地表|地上|街上|路上|马路|路边|街头|路面/, "street"],
  ],
  scaleOfName: (label) => { const scale = scaleOfName(label); return scale && scale !== "none" ? scale : null; },
  buildingUses: [
    [/便利店/, "convenience"], [/咖啡|西点|甜品|茶馆|奶茶/, "cafe"], [/餐厅|餐馆|饭馆|食堂|拉面|快餐|料理/, "restaurant"], [/酒吧|居酒屋/, "bar"],
    [/游戏厅|游戏中心|电玩/, "arcade"], [/银行/, "bank"], [/百货/, "department"], [/商场|购物中心|商城/, "mall"], [/电影院|影院/, "cinema"],
    [/酒店|宾馆|旅馆|饭店/, "hotel"], [/宿舍|寮/, "dormitory"], [/公寓/, "apartment"], [/住宅|民居|房子|家$/, "house"],
    [/学校|中学|小学|大学|学院|学园|学舍/, "school"], [/医院|医疗/, "hospital"], [/诊所/, "clinic"], [/车站|地铁站|站台|站$/, "station"],
    [/厅$|局$|署$|法院|看守所|警备|派出所|政府/, "government"], [/教会|教堂/, "church"], [/仓库/, "warehouse"], [/研究所|实验室|研究中心|研究设施/, "lab"], [/工厂|作坊|工坊/, "workshop"],
    [/停车场/, "parking"], [/大楼|大厦|写字楼|办公|高楼|塔楼/, "office"], [/商店|店$|铺$|超市/, "shop"],
  ],
  undergroundKinds: [
    [/停车场|车库|停车库/, "parking"], [/共同沟|管廊|管道|电缆/, "utility"], [/防空洞|避难所|防空壕|掩体|避难/, "shelter"],
    [/地下街|商场|商店街|购物|地下商/, "mall"], [/地铁站|站台|检票|车站|站厅/, "station"], [/地下通道|地下道|地道|通道|走廊|连络/, "corridor"],
    [/隧道|地铁|轨道/, "tunnel"], [/下水道|排水|雨水|调节池|水道/, "channel"], [/研究所|实验室|研究/, "lab"], [/基地|军事|军用/, "military"],
    [/地下室|地库|地下[一二三四五六七八九十\d]+层/, "basement"],
  ],
  questionWords: {
    height: /[一二三四五六七八九十百千\d]+[层楼]|高楼|高层|超高|摩天|大厦|塔|屋顶|楼顶|顶层|最上层|俯瞰|仰望|高耸|矮|平房|地下|米高|[十百]米|天际|停机坪|玻璃幕墙/g,
    ground: /街|路|广场|商店|店|车站|公园|住宅|公寓|大楼|学校|工厂|港|河|桥|闹市|繁华|商业|办公|宿舍|森林|山|田|仓库|市场|购物/g,
    where: /旁边|附近|对面|隔壁|角落|尽头|中心|边缘|穿过|沿着|走到|来到|离开|距离|公里|东|西|南|北/g,
  },
};

/** The language the reading is in. */
export const LANGUAGE: LanguageRules = ZH;

/** What a building is used for, by its name in the reading's language, or null. */
export const buildingUseOf = (label: string, language: LanguageRules = LANGUAGE): BuildingUse | null => language.buildingUses.find(([words]) => words.test(label.replace(/ \(scene \d+\)$/, "")))?.[1] ?? null;
/** What an underground space is, by its name in the reading's language (a hall kind of underground.ts), or null. */
export const undergroundKindOf = (label: string, language: LanguageRules = LANGUAGE): string | null => language.undergroundKinds.find(([words]) => words.test(label.replace(/ \(scene \d+\)$/, "")))?.[1] ?? null;
