/**
 * What kind of building a place is, for the hologram drawn on its disc in
 * orbital Places. Two stages: the place's name (Chinese, Japanese, English)
 * shortlists the kinds it could be — loosely, so a hint like 院 or 楼 keeps
 * several in play — and a decision model that looks at the shortlisted
 * models' pictures picks one (or none) and is recorded on the place. Until a
 * place has a recorded pick, the shortlist's first kind stands. A name that
 * hints at no building gets no shortlist and no hologram.
 */
export type ArchitectureKind = "church" | "hospital" | "station" | "market" | "castle" | "park" | "village" | "skyscraper" | "school" | "city" | "home" | "office";

const word = (english: string) => new RegExp(`\\b(?:${english})\\b`, "i");
/** Names that say outright what they are. Earlier rules rank first ("伦敦市场" is a market before a city). */
const STRONG: [ArchitectureKind, RegExp, RegExp][] = [
  ["church", /教会|教堂|圣堂|聖堂|礼拜堂|禮拜堂|修道院|神殿|寺院|神社|寺$|庙|廟/, word("church|cathedral|chapel|abbey|basilica|temple|monastery|shrine")],
  ["hospital", /医院|醫院|病院|诊所|診所|医务室|医務室|保健室|病房/, word("hospital|clinic|infirmary|ward \\d+")],
  ["station", /车站|車站|地铁|地鐵|站前|站$|駅|机场|機場|码头|碼頭|港口/, word("station|subway|metro|railway|terminal|airport|harbou?r|port")],
  ["market", /市场|市場|商店街|商场|商場|购物|購物|美食|集市|商店|百货|百貨|超市|便利店/, word("market|bazaar|mall|shops?|stores?|arcade|supermarket")],
  ["castle", /城堡|宫殿|宮殿|王宫|王宮|要塞|堡垒|堡壘|城塞|王城/, word("castle|palace|fortress|citadel")],
  ["park", /公园|公園|广场|廣場|花园|花園|庭园|庭園|森林|河边|河邊|海边|海邊/, word("park|garden|plaza|square|forest|riverside")],
  ["village", /风车|風車|磨坊|农场|農場|村|乡|鄉/, word("farm|mill|village|hamlet")],
  ["skyscraper", /大厦|大廈|大楼|大樓|高楼|高樓|摩天|塔楼|塔樓|ビル|タワー/, word("tower|skyscraper|high-?rise")],
  ["city", /都市|城市|市区|市區|市街|市内|市內|学区|學區|街区|街區|都$|区$|區$|市$|镇$|鎮$|^(东京|東京|伦敦|倫敦|巴黎|纽约|紐約|罗马|羅馬)/, word("city|town|district|downtown|metropolis|london|tokyo|paris|rome|new york")],
  ["school", /学校|學校|学园|學園|学院|學院|中学|中學|高中|高校|大学|大學|小学|小學|教室|校舍/, word("school|academy|college|university|classroom|campus")],
  ["home", /宿舍|寮|公寓|住宅|住所|家$|宅$|房间|房間|卧室|臥室/, word("apartment|dorm|dormitory|home|house|flat|bedroom|residence")],
  ["office", /保安室|警备|警備|办公|辦公|事务所|事務所|研究所|实验室|實驗室|支部|本部|总部|總部|警察局|警署/, word("office|headquarters|laboratory|lab|bureau|agency|police")],
];
/** Hints that keep several kinds in play (the decision model tells them apart). */
const LOOSE: [RegExp, ArchitectureKind[]][] = [
  [/院/, ["hospital", "school", "church", "office"]],
  [/楼|樓|廈|厦|ビル/, ["skyscraper", "office", "home", "school"]],
  [/塔/, ["skyscraper", "castle", "church"]],
  [/馆|館|会馆|會館/, ["office", "school", "home"]],
  [/堂/, ["church", "school", "office"]],
  [/宫|宮/, ["castle", "church"]],
  [/城/, ["castle", "city"]],
  [/场|場/, ["market", "park", "station", "city"]],
  [/街|路|道|巷/, ["market", "city", "park"]],
  [/店|铺|鋪|屋$/, ["market", "home"]],
  [/园|園/, ["park", "school"]],
  [/室|房|屋|舍|居/, ["home", "office", "school"]],
  [/所$|局$|署$/, ["office"]],
  [/区|區|市|镇|鎮|州|县|縣/, ["city"]],
  [word("building|block"), ["skyscraper", "office", "home"]],
  [word("hall"), ["office", "school", "church"]],
  [word("street|road|avenue|alley|lane"), ["market", "city", "park"]],
  [word("cent(?:er|re)|plaza"), ["office", "market", "park"]],
  [word("room|quarters|lodge|inn"), ["home", "office"]],
];
/** At most this many go to the decision model (one picture each). */
export const SHORTLIST_SIZE = 4;

/** The kinds a place name could be, most likely first; empty when the name hints at no building. */
export function architectureCandidates(label: string): ArchitectureKind[] {
  const name = label.replace(/[_·・]/g, " ").trim();
  const found: ArchitectureKind[] = [];
  for (const [kind, chinese, english] of STRONG) if (chinese.test(name) || english.test(name)) found.push(kind);
  for (const [pattern, kinds] of LOOSE) if (pattern.test(name)) found.push(...kinds);
  return [...new Set(found)].slice(0, SHORTLIST_SIZE);
}

/** The building to draw: the recorded pick when there is one ("none": no building), else the name's likeliest. */
export function architectureOf(label: string, decided?: ArchitectureKind | "none" | null): ArchitectureKind | null {
  if (decided === "none") return null;
  return decided ?? architectureCandidates(label)[0] ?? null;
}

export const ARCHITECTURE_LABEL: Record<ArchitectureKind, string> = {
  church: "Church", hospital: "Hospital", station: "Station", market: "Market", castle: "Castle", park: "Park",
  village: "Village", skyscraper: "Tower", school: "School", city: "City", home: "Home", office: "Office",
};
