import type { DecisionQuestion } from "../../ground/connectors/jev.js";
import type { FlowScene } from "../flow.js";
import type { Candidate, PlaceIndex } from "../placeRecommend.js";
import type { ReadingGraph } from "../readingGraph.js";
import type { Item, Mode } from "./engine.js";

/**
 * The context engine's place modes (docs/v2/world-model.md §6): what Jev sees when place EM asks which place holds a place
 * (`place-parent`), where a scene is set (`setting`), and which named place a description means (`place-ref`). Each is
 * asked only where the place recommender is unsure; its candidates are the options, with why each was put forward.
 * Evidence: the sentences that name the places, facts by Cypher over the reading's graph, the candidates' addresses.
 */
export interface PlaceStores {
  index: PlaceIndex;
  graph: ReadingGraph | null;
  text: (sentence: string) => string;
  fact: (id: string) => { text: string; about: { id: string }[] } | undefined;
  /** A named place's address, its outermost place first (its labels). */
  address: (id: string) => string[];
  scenes: Map<string, FlowScene>;
  kinds: Record<string, { kind: string }>;
}
const CLIP = 140, BUDGET = 9000, LATEST = Number.MAX_SAFE_INTEGER;
const clip = (text: string, size = CLIP) => (text.length > size ? `${text.slice(0, size - 1)}…` : text);
const SAY: Record<string, string> = { name: "its name holds the other's", stated: "named right after it", sentence: "named in one sentence with it", setting: "set in one scene with it", adjacent: "in scenes side by side", fact: "facts about both" };
/** Why a candidate was put forward, in words. */
export const why = (candidate: Candidate) => candidate.evidence.filter((entry) => entry.kind !== "scale").map((entry) => `${SAY[entry.kind]}${entry.count > 1 ? ` ${entry.count}×` : ""}`).join("; ") || "nothing in the text links them";
const place = (stores: PlaceStores, id: string) => ({ name: stores.index.label(id), scale: stores.index.scale.get(id) ?? "not said", ...(stores.address(id).length > 1 ? { in: stores.address(id).slice(0, -1).join(" › ") } : {}) });
const candidateItems = (stores: PlaceStores, candidates: Candidate[]): Item[] => [...new Map(candidates.map((candidate) => [candidate.id, candidate])).values()].map((candidate) => ({ id: candidate.id, fields: place(stores, candidate.id), score: candidate.score }));
const options = (candidates: Candidate[], top: number) => candidates.slice(0, top).map((candidate) => candidate.id);
const hints = (stores: PlaceStores, candidates: Candidate[]) => Object.fromEntries(candidates.map((candidate) => [candidate.id, `${stores.index.label(candidate.id)} (${stores.index.scale.get(candidate.id) ?? "scale not said"})`]));
const ambiguity = (candidates: Candidate[]) => (candidates.length < 2 || !candidates[0].score ? 1 : 1 - (candidates[0].score - candidates[1].score) / candidates[0].score);
const mean = (values: number[]) => (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0);

export interface ParentFocus { asked: { key: string; id: string; candidates: Candidate[] }[] }
export const PARENT_TOP = 4;
export const placeParentMode: Mode<ParentFocus, PlaceStores> = {
  name: "place-parent",
  task: "Named places of a novel. Places nest: a room in a building, a building on a street, a street in a district, a district in a city, a city in a region. For each place asked about, say which of its candidates holds it (the place it lies in, one level up or more), or none: none of them does, or the text does not say. Each candidate comes with why it was put forward.",
  sources: [
    { name: "asked", key: "asked", quota: 0, keep: true, collect: (focus, stores) => focus.asked.map((entry) => ({ id: entry.key, score: 1, fields: { ...place(stores, entry.id), named: (stores.index.sentencesOf.get(entry.id) ?? []).slice(0, 2).map((id) => clip(stores.text(id))), candidates: Object.fromEntries(entry.candidates.slice(0, PARENT_TOP).map((candidate) => [candidate.id, why(candidate)])) } })) },
    { name: "candidates", key: "places", quota: 0, keep: true, collect: (focus, stores) => candidateItems(stores, focus.asked.flatMap((entry) => entry.candidates.slice(0, PARENT_TOP))) },
    { name: "facts", key: "facts", quota: 6, collect: async (focus, stores) => {
      if (!stores.graph) return [];
      const found = new Map<string, number>();
      for (const entry of focus.asked) {
        for (const id of await stores.graph.factsAbout(entry.id, LATEST, 2)) found.set(id, Math.max(found.get(id) ?? 0, 1));
        for (const candidate of entry.candidates.slice(0, 2)) for (const id of await stores.graph.factsAboutBoth(entry.id, candidate.id, 2)) found.set(id, 2);
      }
      return [...found].flatMap(([id, score]) => { const fact = stores.fact(id); return fact ? [{ id, score, fields: { text: clip(fact.text), about: fact.about.map((entry) => entry.id).filter((about) => stores.index.scale.has(about)).map(stores.index.label) } }] : []; });
    } },
    { name: "passages", key: "passages", quota: 4, collect: (focus, stores) => {
      const found = new Map<string, number>();
      for (const entry of focus.asked) for (const candidate of entry.candidates.slice(0, PARENT_TOP)) for (const evidence of candidate.evidence) if (evidence.kind === "stated" || evidence.kind === "sentence") for (const id of evidence.at ?? []) found.set(id, Math.max(found.get(id) ?? 0, evidence.kind === "stated" ? 2 : 1));
      return [...found].map(([id, score]) => ({ id, score, fields: clip(stores.text(id), 160) }));
    } },
  ],
  cutOrder: ["passages", "facts"],
  probe: (focus) => ({ ambiguity: mean(focus.asked.map((entry) => ambiguity(entry.candidates))), evidence: 1 - Math.min(1, mean(focus.asked.map((entry) => (entry.candidates[0]?.evidence.length ?? 0) / 3))), density: focus.asked.length / 12 }),
  weights: { ambiguity: 2 },
  questions: (focus, kept): DecisionQuestion[] => focus.asked.map((entry) => ({ key: `tree:${entry.key}`, primitive: "choice", instructions: `Which place holds asked.${entry.key}?`, options: [...options(entry.candidates, PARENT_TOP), "none"], optionHints: { ...Object.fromEntries(kept.candidates.filter((item) => options(entry.candidates, PARENT_TOP).includes(item.id)).map((item) => [item.id, `${(item.fields as { name: string }).name} (${(item.fields as { scale: string }).scale})`])), none: "none of them, or the text does not say" } })),
  budget: BUDGET,
};

export interface SettingFocus { asked: { key: string; scene: string; candidates: Candidate[]; before: string | null }[] }
export const SETTING_TOP = 5;
export const settingMode: Mode<SettingFocus, PlaceStores> = {
  name: "setting",
  task: "Scenes of a novel. For each scene asked about, say where it takes place: one of its candidates (the named places it names, and where the scene before took place), or none: none of them (somewhere the story does not name).",
  sources: [
    { name: "scenes", key: "scenes", quota: 0, keep: true, collect: (focus, stores) => focus.asked.map((entry) => {
      const scene = stores.scenes.get(entry.scene)!, environment = scene.sentences.filter((id) => stores.kinds[id]?.kind === "environment").slice(0, 3);
      return { id: entry.key, score: 1, fields: { opening: scene.sentences.slice(0, 2).map((id) => clip(stores.text(id))), ...(environment.length ? { environment: environment.map((id) => clip(stores.text(id))) } : {}), ...(entry.before ? { before: stores.index.label(entry.before) } : {}), candidates: Object.fromEntries(entry.candidates.slice(0, SETTING_TOP).map((candidate) => [candidate.id, why(candidate)])) } };
    }) },
    { name: "candidates", key: "places", quota: 0, keep: true, collect: (focus, stores) => candidateItems(stores, focus.asked.flatMap((entry) => entry.candidates.slice(0, SETTING_TOP))) },
  ],
  cutOrder: [],
  probe: (focus) => ({ ambiguity: mean(focus.asked.map((entry) => ambiguity(entry.candidates))) }),
  questions: (focus, kept): DecisionQuestion[] => focus.asked.map((entry) => ({ key: `setting:${entry.key}`, primitive: "choice", instructions: `Where does scenes.${entry.key} take place?`, options: [...options(entry.candidates, SETTING_TOP), "none"], optionHints: { ...Object.fromEntries(kept.candidates.filter((item) => options(entry.candidates, SETTING_TOP).includes(item.id)).map((item) => [item.id, `${(item.fields as { name: string }).name} (${(item.fields as { scale: string }).scale})`])), none: "none of these: somewhere the story does not name" } })),
  budget: BUDGET,
};

export interface RefFocus { scene: string; address: string[]; asked: { key: string; text: string; scale: string | null; sentences: string[]; candidates: Candidate[] }[] }
export const REF_TOP = 4;
export const placeRefMode: Mode<RefFocus, PlaceStores> = {
  name: "place-ref",
  task: "Descriptions of places in a scene of a novel (这座城市, 学区, 那条街), with the passage that holds them and where the scene is set. For each, say which named place it means here, or unnamed: a place here the story does not name, or general: no particular place (a kind of place, said in general).",
  sources: [
    { name: "setting", key: "setting", quota: 0, keep: true, collect: (focus, stores) => (focus.address.length ? [{ id: "address", score: 1, fields: focus.address.map(stores.index.label).join(" › ") }] : []) },
    { name: "descriptions", key: "descriptions", quota: 0, keep: true, collect: (focus) => focus.asked.map((entry) => ({ id: entry.key, score: 1, fields: { text: entry.text, scale: entry.scale ?? "not said", in: entry.sentences.slice(0, 3) } })) },
    { name: "passage", key: "passage", quota: 0, keep: true, collect: (focus, stores) => [...new Set(focus.asked.flatMap((entry) => entry.sentences.slice(0, 3)))].map((id) => ({ id, score: 1, fields: clip(stores.text(id), 160) })) },
    { name: "candidates", key: "places", quota: 0, keep: true, collect: (focus, stores) => candidateItems(stores, focus.asked.flatMap((entry) => entry.candidates.slice(0, REF_TOP))) },
  ],
  cutOrder: [],
  probe: (focus) => ({ ambiguity: mean(focus.asked.map((entry) => ambiguity(entry.candidates))), density: focus.asked.length / 8 }),
  questions: (focus, kept): DecisionQuestion[] => focus.asked.map((entry) => ({ key: `place:${entry.key}`, primitive: "choice", instructions: `Which place does descriptions.${entry.key} mean here?`, options: [...options(entry.candidates, REF_TOP), "unnamed", "general"], optionHints: { ...Object.fromEntries(kept.candidates.filter((item) => options(entry.candidates, REF_TOP).includes(item.id)).map((item) => [item.id, `${(item.fields as { name: string }).name} (${(item.fields as { scale: string }).scale})`])), unnamed: "a place here the story does not name (none of these)", general: "no particular place: a kind of place, said in general" } })),
  budget: BUDGET,
};
