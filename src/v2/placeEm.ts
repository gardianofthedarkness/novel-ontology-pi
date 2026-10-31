import type { DecisionAnswer } from "../ground/connectors/jev.js";
import { compose, type Manifest } from "./context/engine.js";
import { placeParentMode, placeRefMode, settingMode, type PlaceStores } from "./context/placeModes.js";
import { mentions, type Chart } from "./em.js";
import type { FactEntry } from "./facts.js";
import type { FlowCard, FlowScene } from "./flow.js";
import { describedCandidates, fallbackParents, placeIndex, recommendParents, settingTiers, type Candidate } from "./placeRecommend.js";
import { ACCEPT, chooseSetting, deeperByUnnamed, HABIT, holderIn, isPresent, mayHold, rankOf, sameWords, SCALES, sureParent } from "./rules/index.js";
import { ReadingGraph } from "./readingGraph.js";
import type { SpatialMention } from "./spatial.js";
import type { Decide } from "./typing.js";

/**
 * Place EM (docs/v2/world-model.md §5; layer 4): the places of the reading, decided as spacetime, apart from matter. Places
 * are a tree graded by scale, so each named place needs one parent from a few larger candidates, and most descriptions of
 * places are a building or a room of the scene's own setting. The place recommender (layer 2) ranks; what it is sure of is
 * taken by rule, and Jev is asked only the rest, on a state the context engine (layer 3) composes, one request a batch:
 * 1. the tree: a named place's parent is taken when the best candidate has name or stated evidence and leads the second
 *    clearly; the rest go to Jev (`place-parent`); assembled surest first, never closing a loop; scales checked against it
 *    (a place its type and name say nothing of is a step above what it holds; a parent no larger than an open place it
 *    holds is raised);
 * 2. settings: each scene's place by the recommender's tiers (environment, action, named; carried on where nothing is
 *    named; deeper where the scene sets a place under it); Jev (`setting`) where the environment names places on two
 *    branches of the tree;
 * 3. unnamed places, scene by scene: the same words as an unnamed place of this scene or the one before are that place;
 *    words naming a larger named place are held by it; a building, a room or a street is a new unnamed place held by the
 *    setting (the deepest place on its address larger than it); a district, a city or a region may be a named place, and
 *    so may a description of the same scale as a named place on the address (学校 in a scene set in 常盘台中学): only those
 *    go to Jev (`place-ref`), with the address's candidates. The recommender learns as the book goes (the user's call,
 *    2026-10-31, as EM²'s habits do for people): what the same words have meant is a prior, and words Jev has given the same
 *    named place twice, and nothing else, are taken by rule after that (`habit`). A building or room the environment names
 *    deepens the setting;
 * 4. occupancy evidence: everyone present is at the scene's setting at its time; each spatial word adds a level for who it is
 *    tied to. Occupancy itself is the world engine's (its scene continuity keeps everyone where they were); this is the
 *    text's evidence, which interrupts or corrects it at the step it comes in (the user's call, 2026-10-31).
 */
export interface PlaceParent { id: string; parent: string | null; by: "name" | "stated" | "jev" | "none"; confidence: number; scale: string | null; scaleBy: "typing" | "name" | "holds" | "tree" | null; candidates?: [string, number][] }
export interface UnnamedPlace { id: string; kind: "place" | "building" | "room"; scene: string; label: string; names: string[]; sentences: string[]; in: string | null; scale?: string; held: "stated" | "setting" | "same" | "none" }
export interface PlaceReference { text: string; scene: string; sentences: string[]; entity: string | null; answer: string; confidence: number; by: "rule" | "habit" | "jev" }
/** What a description of a place has meant (learned as the book goes): a prior for the recommender, and a rule once it holds. */
export interface PlaceHabit { text: string; place: string; count: number }
export interface Setting { scene: string; place: string | null; by: "environment" | "action" | "named" | "carried" | "unnamed" | "jev" | "none"; confidence?: number }
export interface Occupancy { who: string; place: string; scene: string; time: string | null; by: "setting" | "spatial"; level?: string | null; sentence?: string }
export interface PlaceAsked { mode: string; keys: Record<string, string>; manifest: Manifest }
/** The tree's laws, checked (docs/v2/world-model.md §2.1): n places, r roots, n − r links, no loop, every link graded by scale. */
export interface TreeLaws { places: number; roots: number; links: number; linksAreNMinusR: boolean; loops: number; ungraded: [string, string][] }
/** occupancy: the text's evidence of who is where (the world engine's continuity holds occupancy itself). */
export interface PlaceResult { places: PlaceParent[]; slots: UnnamedPlace[]; settings: Setting[]; occupancy: Occupancy[]; references: PlaceReference[]; habits: PlaceHabit[]; asked: PlaceAsked[]; laws: TreeLaws }

export interface PlaceEmInput {
  chart: Chart;
  scenes: FlowScene[];
  cards: FlowCard[];
  sentences: { id: string; text: string }[];
  kinds: Record<string, { kind: string }>;
  text: (sentence: string) => string;
  /** The settled fact ledger. */
  facts: FactEntry[];
  time?: { scenes: { scene: string; flashback: boolean; continuation?: { continues: boolean }; node: string | null }[] } | null;
  /** Every description of a place EM found (its typed scale, and the sentences that hold it). */
  descriptions: { text: string; type: string; sentences: string[] }[];
  spatial?: SpatialMention[];
}
/** Questions a request asks at most. */
const BATCH = 12;
const round = (value: number) => Number(value.toFixed(3));
const pick = (replies: DecisionAnswer[], key: string) => { const reply = replies.find((entry) => entry.key === key), value = String(reply?.value ?? "none"); return { value, confidence: Number(reply?.distribution?.[value] ?? reply?.confidence ?? 0) }; };

export async function placeEm(decide: Decide, input: PlaceEmInput): Promise<PlaceResult> {
  const { chart } = input, index = placeIndex(input), { label } = index, places = index.places;
  const graph = await ReadingGraph.build({
    entities: [...chart.entities.values()].map((entity) => ({ id: entity.id, name: label(entity.id), kind: entity.category, scale: index.scale.get(entity.id) ?? null })),
    scenes: input.scenes.map((scene) => ({ id: scene.id, index: scene.index })),
    names: [...index.sceneNames].flatMap(([scene, of]) => [...of].map(([place, count]) => ({ scene, place, count: count.any, environment: count.environment > 0 }))),
    facts: input.facts.map((fact) => ({ id: fact.id, at: fact.order, scene: index.sceneOf.get(fact.first) ?? null, about: fact.about.map((entry) => entry.id) })),
  });
  try {
    const parentOf = new Map<string, string | null>(), asked: PlaceAsked[] = [];
    const address = (id: string) => { const path: string[] = []; for (let at: string | null = id, n = 0; at && n < 16; at = parentOf.get(at) ?? null, n++) path.unshift(at); return path; };
    const loops = (child: string, parent: string) => address(parent).includes(child);
    const factOf = new Map(input.facts.map((fact) => [fact.id, fact]));
    const stores: PlaceStores = { index, graph, text: input.text, fact: (id) => factOf.get(id), address: (id) => address(id).map(label), scenes: new Map(input.scenes.map((scene) => [scene.id, scene])), kinds: input.kinds };
    const ask = async <F>(mode: Parameters<typeof compose<F, PlaceStores>>[0], focus: F, keys: Record<string, string>) => {
      const composed = await compose(mode, focus, stores);
      asked.push({ mode: mode.name, keys, manifest: composed.manifest });
      return composed.questions.length ? decide(composed.state, composed.questions) : [];
    };

    // 1. The tree.
    type Choice = { id: string; parent: string | null; by: PlaceParent["by"]; confidence: number; candidates: Candidate[] };
    const choices: Choice[] = [], unsure: { key: string; id: string; candidates: Candidate[] }[] = [];
    for (const place of places) {
      const candidates = await recommendParents(index, place.id, graph), sure = sureParent(candidates);
      if (sure) choices.push({ id: place.id, parent: sure.candidate.id, by: sure.by, confidence: Math.min(1, sure.candidate.score / 3), candidates });
      else { const offered = candidates.length ? candidates : fallbackParents(index, place.id); if (offered.length) unsure.push({ key: "q" + (unsure.length + 1), id: place.id, candidates: offered }); else choices.push({ id: place.id, parent: null, by: "none", confidence: 1, candidates: [] }); }
    }
    const assemble = (list: Choice[]) => {
      parentOf.clear();
      for (const choice of [...list].sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id))) parentOf.set(choice.id, choice.parent && !loops(choice.id, choice.parent) ? choice.parent : null);
    };
    assemble(choices);
    for (let start = 0; start < unsure.length; start += BATCH) {
      const chunk = unsure.slice(start, start + BATCH), replies = await ask(placeParentMode, { asked: chunk }, Object.fromEntries(chunk.map((entry) => [entry.key, entry.id])));
      for (const entry of chunk) {
        const { value, confidence } = pick(replies, `tree:${entry.key}`), offered = entry.candidates.slice(0, 4).map((candidate) => candidate.id);
        const parent = offered.includes(value) && confidence >= ACCEPT ? value : null;
        choices.push({ id: entry.id, parent, by: parent ? "jev" : "none", confidence, candidates: entry.candidates });
      }
    }
    assemble(choices);
    const byId = new Map(choices.map((choice) => [choice.id, choice]));
    // Scales checked against the tree, from the bottom up.
    const scaleOf = new Map(places.map((place) => [place.id, { scale: index.scale.get(place.id) ?? null, by: (index.scaleBy.get(place.id) ?? null) as PlaceParent["scaleBy"] }]));
    for (let pass = 0; pass < SCALES.length; pass++) for (const place of places) {
      const parent = parentOf.get(place.id), child = scaleOf.get(place.id)!;
      if (!parent || rankOf(child.scale) < 0) continue;
      const above = scaleOf.get(parent)!, step = SCALES[Math.min(rankOf(child.scale) + 1, SCALES.length - 1)];
      if (rankOf(above.scale) < 0) scaleOf.set(parent, { scale: step, by: "holds" });
      else if (rankOf(child.scale) >= SCALES.indexOf("street") && rankOf(above.scale) <= rankOf(child.scale) && SCALES.indexOf(step) > rankOf(above.scale)) scaleOf.set(parent, { scale: step, by: "tree" });
    }
    const scale = (id: string) => scaleOf.get(id)?.scale ?? null;
    const tree: PlaceParent[] = places.map((place) => {
      const choice = byId.get(place.id)!, parent = parentOf.get(place.id) ?? null;
      return { id: place.id, parent, by: parent ? choice.by : "none", confidence: round(choice.confidence), scale: scale(place.id), scaleBy: scaleOf.get(place.id)!.by, ...(choice.candidates.length ? { candidates: choice.candidates.slice(0, 4).map((candidate): [string, number] => [candidate.id, candidate.score]) } : {}) };
    });

    // 2. Settings.
    const timeOf = new Map((input.time?.scenes ?? []).map((scene) => [scene.scene, scene]));
    const depth = (id: string) => address(id).length, under = (id: string, top: string) => id !== top && address(id).includes(top);
    const settings = new Map<string, Setting>(), branched: { key: string; scene: string; candidates: Candidate[]; before: string | null }[] = [];
    let previous: string | null = null;
    for (const scene of input.scenes) {
      const when = timeOf.get(scene.id), past = !!when?.flashback, tiers = settingTiers(index, scene.id);
      const { place, by, branched: off } = chooseSetting({ ...tiers, previous, past, continues: when?.continuation?.continues !== false, depth, under });
      // Places its environment names on two branches of the tree: which one is Jev's to say.
      if (off.length) branched.push({ key: "s" + (branched.length + 1), scene: scene.id, before: previous, candidates: [...tiers.environment.map(([id, count]): Candidate => ({ id, score: count, evidence: [{ kind: "setting", weight: count, count }] })), ...(previous && !tiers.environment.some(([id]) => id === previous) ? [{ id: previous, score: 0.5, evidence: [{ kind: "adjacent" as const, weight: 0.5, count: 1 }] }] : [])].sort((a, b) => b.score - a.score || a.id.localeCompare(b.id)) });
      settings.set(scene.id, { scene: scene.id, place, by });
      if (!past && place) previous = place;
    }
    for (let start = 0; start < branched.length; start += BATCH) {
      const chunk = branched.slice(start, start + BATCH), replies = await ask(settingMode, { asked: chunk }, Object.fromEntries(chunk.map((entry) => [entry.key, entry.scene])));
      for (const entry of chunk) {
        const { value, confidence } = pick(replies, `setting:${entry.key}`);
        if (entry.candidates.slice(0, 5).some((candidate) => candidate.id === value) && confidence >= ACCEPT) settings.set(entry.scene, { scene: entry.scene, place: value, by: "jev", confidence: round(confidence) });
      }
    }

    // 3. Unnamed places, scene by scene.
    const groups = new Map<string, Map<string, { type: string; sentences: string[] }>>();
    for (const description of input.descriptions) for (const sentence of description.sentences) {
      const scene = index.sceneOf.get(sentence);
      if (!scene) continue;
      const of = groups.get(scene) ?? new Map(), entry = of.get(description.text) ?? { type: description.type, sentences: [] };
      if (!entry.sentences.includes(sentence)) entry.sentences.push(sentence);
      of.set(description.text, entry); groups.set(scene, of);
    }
    const names = places.flatMap((place) => place.names.map((name): [string, string] => [name, place.id])).sort((a, b) => b[0].length - a[0].length);
    const slots: UnnamedPlace[] = [], references: PlaceReference[] = [], habits = new Map<string, string[]>(), slotsOf = new Map<string, UnnamedPlace[]>();
    let previousSlots: UnnamedPlace[] = [];
    for (const scene of input.scenes) {
      const here = [...(groups.get(scene.id) ?? new Map<string, { type: string; sentences: string[] }>())].sort((a, b) => a[0].localeCompare(b[0]));
      const sceneSlots: UnnamedPlace[] = [], setting = settings.get(scene.id)?.place ?? null, path = setting ? address(setting) : [];
      const open = (text: string, type: string, sentences: string[], holder: string | null, held: UnnamedPlace["held"]) => {
        const kind: UnnamedPlace["kind"] = type === "building" || type === "room" ? type : "place";
        const slot: UnnamedPlace = { id: `place_${scene.id.slice(-6)}_${sceneSlots.length + 1}`, kind, scene: scene.id, label: text, names: [text], sentences: [...sentences], in: holder, ...(kind === "place" && SCALES.includes(type) ? { scale: type } : {}), held: holder ? held : "none" };
        sceneSlots.push(slot); slots.push(slot);
        references.push({ text, scene: scene.id, sentences, entity: slot.id, answer: "unnamed", confidence: 1, by: "rule" });
      };
      const toAsk: { key: string; text: string; scale: string | null; type: string; sentences: string[]; candidates: Candidate[] }[] = [];
      for (const [text, entry] of here) {
        const own = SCALES.includes(entry.type) ? entry.type : null;
        const same = sameWords(text, [...sceneSlots, ...previousSlots]);
        if (same) { for (const id of entry.sentences) if (!same.sentences.includes(id)) same.sentences.push(id); references.push({ text, scene: scene.id, sentences: entry.sentences, entity: same.id, answer: same.id, confidence: 1, by: "rule" }); continue; }
        const inWords = mentions(text, names).map((hit) => hit.id).find((id) => rankOf(own) < 0 || rankOf(scale(id)) < 0 || rankOf(scale(id)) > rankOf(own));
        // May it be a named place? A district, a city or a region may (这座城市); so may one of the same scale as a named place
        // on the address (学校 in a scene set in 常盘台中学). Only those go to Jev.
        const candidates = describedCandidates({ ...index, scale: new Map(places.map((place) => [place.id, scale(place.id)])) }, { text, scale: own }, path, habits);
        // Learned: the same words have meant one named place, and only it, often enough; and it is a candidate here.
        const learned = new Set(habits.get(text) ?? []);
        if (learned.size === 1 && (habits.get(text) ?? []).length >= HABIT && candidates.some((candidate) => learned.has(candidate.id))) {
          const [place] = learned;
          references.push({ text, scene: scene.id, sentences: entry.sentences, entity: place, answer: place, confidence: 1, by: "habit" });
          habits.set(text, [...(habits.get(text) ?? []), place]);
          continue;
        }
        if (candidates.length && (rankOf(own) >= SCALES.indexOf("district") || entry.type === "place" || candidates.some((candidate) => rankOf(scale(candidate.id)) === rankOf(own)))) { toAsk.push({ key: "d" + (toAsk.length + 1), text, scale: own, type: entry.type, sentences: entry.sentences, candidates }); continue; }
        open(text, entry.type, entry.sentences, inWords ?? holderIn(path, own, scale), inWords ? "stated" : "setting");
      }
      if (toAsk.length) {
        const replies = await ask(placeRefMode, { scene: scene.id, address: path, asked: toAsk }, Object.fromEntries(toAsk.map((entry) => [entry.key, `${scene.id}:${entry.text}`])));
        for (const entry of toAsk) {
          const { value, confidence } = pick(replies, `place:${entry.key}`), offered = entry.candidates.slice(0, 4).map((candidate) => candidate.id);
          if (offered.includes(value) && confidence >= ACCEPT) {
            references.push({ text: entry.text, scene: scene.id, sentences: entry.sentences, entity: value, answer: value, confidence: round(confidence), by: "jev" });
            habits.set(entry.text, [...(habits.get(entry.text) ?? []), value]);
          } else if (value === "general" && confidence >= ACCEPT) references.push({ text: entry.text, scene: scene.id, sentences: entry.sentences, entity: null, answer: "general", confidence: round(confidence), by: "jev" });
          else open(entry.text, entry.type, entry.sentences, holderIn(path, entry.scale, scale), "setting");
        }
      }
      slotsOf.set(scene.id, sceneSlots);
      previousSlots = sceneSlots;
    }
    // A building or a room the environment names, in the setting: where the scene is, more closely (rooms first).
    for (const scene of input.scenes) {
      const environment = new Set(scene.sentences.filter((id) => input.kinds[id]?.kind === "environment")), setting = settings.get(scene.id)!;
      const inner = deeperByUnnamed(slotsOf.get(scene.id) ?? [], environment, setting.place, (holder) => !!setting.place && address(setting.place).includes(holder));
      if (inner) settings.set(scene.id, { scene: scene.id, place: inner.id, by: "unnamed" });
    }

    // 4. Occupancy: who is where, at what time, at what level.
    const occupancy: Occupancy[] = [];
    const cardsOf = new Map<string, FlowCard[]>();
    for (const card of input.cards) { const scene = index.sceneOf.get(card.first); if (scene) cardsOf.set(scene, [...(cardsOf.get(scene) ?? []), card]); }
    for (const scene of input.scenes) {
      const place = settings.get(scene.id)?.place, time = timeOf.get(scene.id)?.node ?? null;
      if (!place) continue;
      const present = new Set((cardsOf.get(scene.id) ?? []).flatMap((card) => card.people.filter((person) => chart.entities.get(person.id)?.category === "person" && isPresent(person)).map((person) => person.id)));
      for (const who of [...present].sort()) occupancy.push({ who, place, scene: scene.id, time, by: "setting" });
      for (const mention of (input.spatial ?? []).filter((entry) => entry.scene === scene.id)) for (const who of mention.who) occupancy.push({ who, place, scene: scene.id, time, by: "spatial", level: mention.level, sentence: mention.sentence });
    }
    const links = tree.filter((entry) => entry.parent), roots = tree.length - links.length;
    const laws: TreeLaws = { places: tree.length, roots, links: links.length, linksAreNMinusR: links.length === tree.length - roots, loops: tree.filter((entry) => entry.parent && address(entry.parent).includes(entry.id)).length,
      ungraded: links.filter((entry) => !mayHold(scale(entry.parent!), entry.scale)).map((entry): [string, string] => [entry.id, entry.parent!]) };
    const learned: PlaceHabit[] = [...habits].flatMap(([text, list]) => [...new Set(list)].map((place) => ({ text, place, count: list.filter((entry) => entry === place).length }))).sort((a, b) => b.count - a.count || a.text.localeCompare(b.text));
    return { places: tree, slots, settings: input.scenes.map((scene) => settings.get(scene.id)!), occupancy, references, habits: learned, asked, laws };
  } finally {
    await graph.close();
  }
}
