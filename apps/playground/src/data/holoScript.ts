import type { WorldEdge, WorldNode } from "../types.js";
import { storyOrderScenes } from "./orbitalTimePlace.js";
import { architectureOf, type ArchitectureKind } from "./placeArchitecture.js";
import { dateLine, placeLinks, placeTreeLayout, scenePeriod, type StoryScene, type TimePlaceProjection } from "./timePlace.js";

/**
 * Holo stage (places phase 2, exploration): a place's scenes replayed like a
 * game — who is there, what happens in reading order inside each scene, who
 * speaks, where it turns into a conflict — and, across places, who travels
 * from one building to the next. Built only from what the archive already
 * holds: scene presence, event participants, dialogue cards and the text of
 * the records (names and quotes in it); conflict is a keyword guess here.
 */
export type BeatKind = "scene" | "event" | "dialogue" | "travel";
export interface HoloBeat {
  id: string; kind: BeatKind; sceneId: string; placeId: string;
  /** Short heading (scene title, speaker, "A → B"). */
  title: string;
  /** What happens (record summary); a quote when the record carries one. */
  text: string; quote?: string;
  /** Characters on the move or in the exchange; speaker first for dialogue. */
  actors: string[];
  /** Everyone in the scene (the rest stand by). */
  present: string[];
  conflict: boolean;
  /** Travel: where the actors come from. */
  from?: string;
  /** 1-based scene number on this stage, and when it is (period label). */
  scene: number; when?: string;
  /** The source sentences it tells (sentenceKey of the first and last), when the record carries them: read mode finds a page's beats by these. */
  source?: { from: number; to: number };
}
export interface HoloActor { id: string; label: string; color: string; beats: number }
export interface HoloPlace { id: string; label: string; kind: ArchitectureKind | null; x: number; z: number; scenes: number }
export interface HoloScript { title: string; places: HoloPlace[]; actors: HoloActor[]; beats: HoloBeat[] }

interface WorldLike { interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }> }

const CONFLICT = /战斗|交战|打斗|搏斗|格斗|攻击|袭击|冲突|对峙|争执|争吵|激战|厮杀|追杀|追捕|追赶|威胁|反击|爆炸|开枪|枪声|开火|殴打|拳头|砍|刺伤|绑架|劫持|闯入|制服|逃跑|逃离|拼命|惨叫|fight|attack|clash|battle|argu|threat|chase|shoot|punch|ambush|escape/i;
export const isConflict = (text: string) => CONFLICT.test(text);
/** Words someone says in a record: a quote right after a speech verb (说/道/问/喊 …, says/asks), not a quoted name. */
export function quoteOf(text: string): string | undefined {
  const match = /(?:说|道|问|喊|叫|答|吼|骂|嘀咕|念叨|宣布|回应|表示|告诉|：|:|says?|said|asks?|asked|shouts?|shouted|replies|replied)\s*[「『“"]([^」』”"]{2,80})[」』”"]?/i.exec(text);
  return match?.[1]?.replace(/[‘’']/g, "").trim() || undefined;
}

/** A sentence id (b0003_s0012) as a number that sorts in reading order. */
export const sentenceKey = (id: string) => { const match = /^b(\d+)_s(\d+)$/.exec(id); return match ? Number(match[1]) * 1_000_000 + Number(match[2]) : NaN; };
const rangeOf = (node: WorldNode | undefined) => node?.sourceRange ? { from: node.sourceRange.startBlock * 1_000_000 + node.sourceRange.startSentence, to: node.sourceRange.endBlock * 1_000_000 + node.sourceRange.endSentence } : undefined;

export const ACTOR_COLORS = ["#5ee7ff", "#ffb86b", "#ff6fae", "#9dff7a", "#b49bff", "#ffd84d", "#6fffd2", "#ff8a7a", "#8fb8ff", "#f5a3ff"];

/** Everything the world says about one scene, ids local to the loaded book. */
function sceneIndex(world: WorldLike) {
  const nodes = new Map<string, WorldNode>(), edges: WorldEdge[] = [];
  for (const graph of Object.values(world.interiors)) { for (const node of graph.nodes) nodes.set(node.id, node); edges.push(...graph.edges); }
  const records = new Map<string, WorldNode[]>(), present = new Map<string, string[]>(), participants = new Map<string, string[]>();
  const push = <T,>(map: Map<string, T[]>, key: string, value: T) => map.set(key, [...(map.get(key) ?? []), value]);
  for (const edge of edges) {
    const from = nodes.get(edge.from), to = nodes.get(edge.to);
    if (!from || !to) continue;
    if (edge.kind === "contains" && from.kind === "scene" && (to.kind === "event" || to.kind === "dialogue")) push(records, from.id, to);
    if (edge.relationLabel === "Present in scene" && from.kind === "character") push(present, to.id, from.id);
    if (edge.relationType === "PARTICIPATES_IN" && from.kind === "character") push(participants, to.id, from.id);
  }
  // Dialogue cards are listed under their scene by id.
  for (const node of nodes.values()) if (node.dialogue && node.id.startsWith("view-card:")) { const scene = node.id.split(":")[1]; if (!(records.get(scene) ?? []).includes(node)) push(records, scene, node); }
  const characters = [...nodes.values()].filter((node) => node.kind === "character");
  return { nodes, records, present, participants, characters };
}

/** Where a text first names someone: the full name, or a short form (the first word of a spaced name, the
 * first two characters — a surname — of a longer CJK name); -1 if never. */
function mention(text: string, label: string): number {
  const full = text.indexOf(label);
  const shortForm = label.includes(" ") ? label.split(" ")[0] : [...label].length >= 3 ? [...label].slice(0, 2).join("") : "";
  const short = shortForm.length >= 2 ? text.search(new RegExp(`${shortForm.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}${/^[A-Za-z]/.test(shortForm) ? "\\b" : ""}`)) : -1;
  return full < 0 ? short : short < 0 ? full : Math.min(full, short);
}
/** Characters a text names, in the order it names them. */
function named(text: string, characters: WorldNode[]): string[] {
  return characters.map((character) => [character.id, mention(text, character.label)] as const).filter(([, at]) => at >= 0).sort((first, second) => first[1] - second[1]).map(([id]) => id);
}
const SPEECH = /说|道|问|喊|叫|答|吼|骂|开口|回应|回答|表示|抱怨|念叨|嘀咕|宣布|告诉|says?|said|asks?|asked|shouts?|replies|replied/i;
/** Who speaks: the person named last before the first speech verb (a card lists its people, not who talks). */
export function speakerOf(text: string, actors: string[], labelOf: (id: string) => string): string | undefined {
  const verb = SPEECH.exec(text)?.index ?? -1;
  if (verb < 0) return undefined;
  let best: string | undefined, at = -1;
  for (const id of actors) { const where = mention(text.slice(0, verb), labelOf(id)); if (where > at) { at = where; best = id; } }
  return best;
}

const unique = <T,>(values: T[]) => [...new Set(values)];

/** One scene's beats: its title card, then its records in reading order (a dialogue card and the event telling the same thing become one dialogue beat). */
function sceneBeats(scene: StoryScene, local: string, placeId: string, number: number, when: string | undefined, index: ReturnType<typeof sceneIndex>): HoloBeat[] {
  const node = index.nodes.get(local);
  const present = unique([...(index.present.get(local) ?? []), ...scene.characterIds.map((id) => id.slice(id.indexOf(":") + 1))]).filter((id) => index.nodes.has(id));
  const cast = present.map((id) => index.nodes.get(id)!).concat(index.characters.filter((character) => !present.includes(character.id)));
  const title = node?.summary ?? node?.label ?? scene.label;
  const sceneSource = rangeOf(node);
  const beats: HoloBeat[] = [{ id: `scene:${scene.id}`, kind: "scene", sceneId: scene.id, placeId, title: `Scene ${number}`, text: title, actors: present, present, conflict: false, scene: number, when, ...(sceneSource ? { source: sceneSource } : {}) }];
  const records = [...(index.records.get(local) ?? [])].sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id));
  const seen = new Map<string, HoloBeat>();
  for (const record of records) {
    const text = record.summary ?? record.label;
    const card = record.dialogue?.participantIds?.length ? record.dialogue : undefined;
    const earlier = seen.get(text);
    if (earlier) {
      // The same moment told twice (card + event): keep one beat, as dialogue when either is.
      if (card || record.kind === "dialogue") {
        earlier.kind = "dialogue";
        earlier.actors = unique([...earlier.actors, ...(card?.participantIds ?? [])]);
        const speaker = speakerOf(text, earlier.actors, (id) => index.nodes.get(id)?.label ?? id);
        if (speaker) earlier.actors = [speaker, ...earlier.actors.filter((id) => id !== speaker)];
        earlier.title = index.nodes.get(earlier.actors[0])?.label ?? earlier.title;
      }
      const also = rangeOf(record);
      if (also) earlier.source = earlier.source ? { from: Math.min(earlier.source.from, also.from), to: Math.max(earlier.source.to, also.to) } : also;
      continue;
    }
    const dialogue = !!card || record.kind === "dialogue";
    // Events: people in the order the text names them (the one who acts first); dialogue: the speaker first.
    let actors = unique([...named(text, cast), ...(card?.participantIds ?? []), ...(index.participants.get(record.id) ?? [])]).filter((id) => index.nodes.has(id));
    const speaker = dialogue ? speakerOf(text, actors, (id) => index.nodes.get(id)?.label ?? id) : undefined;
    if (speaker) actors = [speaker, ...actors.filter((id) => id !== speaker)];
    const source = rangeOf(record);
    const beat: HoloBeat = { id: `${scene.id}:${record.id}`, kind: dialogue ? "dialogue" : "event", sceneId: scene.id, placeId, title: dialogue ? index.nodes.get(actors[0])?.label ?? "Dialogue" : "Event", text, quote: quoteOf(text), actors, present: unique([...present, ...actors]), conflict: isConflict(text), scene: number, when, ...(source ? { source } : {}) };
    seen.set(text, beat);
    beats.push(beat);
  }
  // Everyone who acts in the scene is on stage for it.
  beats[0].present = beats[0].actors = unique(beats.flatMap((beat) => beat.present));
  for (const beat of beats) beat.present = beats[0].present;
  return beats;
}

function finish(title: string, places: HoloPlace[], beats: HoloBeat[], names: Map<string, string>): HoloScript {
  // One person, two records ("白井" and "白井黑子"): a name that starts exactly one longer name is that person.
  const ids = unique(beats.flatMap((beat) => [...beat.actors, ...beat.present]));
  const alias = new Map<string, string>();
  for (const id of ids) {
    const label = names.get(id) ?? id;
    const longer = ids.filter((other) => other !== id && [...label].length >= 2 && (names.get(other) ?? other).startsWith(label));
    if (longer.length === 1) alias.set(id, longer[0]);
  }
  const canonical = (list: string[]) => unique(list.map((id) => alias.get(id) ?? id));
  for (const beat of beats) { beat.actors = canonical(beat.actors); beat.present = canonical(beat.present); }
  const counts = new Map<string, number>();
  for (const beat of beats) for (const id of beat.actors) counts.set(id, (counts.get(id) ?? 0) + 1);
  const actors = [...counts].sort((first, second) => second[1] - first[1]).map(([id, beats], rank): HoloActor => ({ id, label: names.get(id) ?? id, color: ACTOR_COLORS[rank % ACTOR_COLORS.length], beats }));
  return { title, places, actors, beats };
}

function context(data: TimePlaceProjection, world: WorldLike, volume: number | null) {
  const index = sceneIndex(world);
  const local = (scene: StoryScene) => scene.book !== undefined ? (scene.book === volume ? scene.id.slice(scene.id.indexOf(":") + 1) : null) : scene.id;
  const times = new Map(data.times.map((time) => [time.id, time]));
  const when = (scene: StoryScene) => { const time = times.get(scenePeriod(scene) ?? ""); return time ? [time.label, dateLine(time)].filter(Boolean).join(" · ") : undefined; };
  const names = new Map([...index.nodes.values()].filter((node) => node.kind === "character").map((node) => [node.id, node.label]));
  // Scenes the loaded book can replay (others' records are not loaded), in story order.
  const scenes = storyOrderScenes(data).filter((scene) => scene.placeIds.length && local(scene) && index.nodes.has(local(scene)!));
  return { index, local, when, names, scenes };
}

/** A place's stage: every replayable scene there, in story order. */
export function placeScript(data: TimePlaceProjection, world: WorldLike, placeId: string, volume: number | null = null): HoloScript {
  const { index, local, when, names, scenes } = context(data, world, volume);
  const place = data.places.find((entry) => entry.id === placeId);
  // Places of one name (book places a universe has not merged yet) are one stage, as on the journey.
  const same = new Set(data.places.filter((entry) => entry.id === placeId || (!!place && entry.label === place.label)).map((entry) => entry.id));
  const inside = (scene: StoryScene) => (data.places.find((entry) => entry.id === scene.placeIds[0])?.path ?? scene.placeIds).some((id) => same.has(id));
  const here = scenes.filter(inside);
  const beats = here.flatMap((scene, number) => sceneBeats(scene, local(scene)!, placeId, number + 1, when(scene), index));
  const label = place?.label ?? data.names[placeId] ?? placeId;
  return finish(label, [{ id: placeId, label, kind: architectureOf(label, place?.architecture), x: 0, z: 0, scenes: here.length }], beats, names);
}

/** The journey: every placed scene of the projection in story order (scene level: who is where, not what they do),
 * with a travel beat whenever someone's next scene is somewhere else. */
export function journeyScript(data: TimePlaceProjection, size = 1600): HoloScript {
  const times = new Map(data.times.map((time) => [time.id, time]));
  // Places of one name (book places a universe has not merged yet) stand as one building.
  const byName = new Map<string, string>();
  for (const place of data.places) if (!byName.has(place.label)) byName.set(place.label, place.id);
  const canonical = (id: string) => byName.get(data.places.find((place) => place.id === id)?.label ?? "") ?? id;
  const scenes = storyOrderScenes(data).filter((scene) => scene.placeIds.length).map((scene) => ({ ...scene, placeIds: [canonical(scene.placeIds[0]), ...scene.placeIds.slice(1)] }));
  const used = unique(scenes.map((scene) => scene.placeIds[0]));
  const links = placeLinks({ ...data, scenes }).filter((link) => used.includes(link.from) && used.includes(link.to) && link.from !== link.to);
  const layout = placeTreeLayout(data.places.filter((place) => used.includes(place.id)).map((place) => ({ ...place, parentId: place.parentId && used.includes(canonical(place.parentId)) ? canonical(place.parentId) : null })), links, 600);
  const places = used.flatMap((id): HoloPlace[] => {
    const point = layout.get(id), place = data.places.find((entry) => entry.id === id);
    const label = place?.label ?? data.names[id] ?? id;
    return point ? [{ id, label, kind: architectureOf(label, place?.architecture), x: (point.x - 300) / 300 * size / 2, z: (point.y - 300) / 300 * size / 2, scenes: scenes.filter((scene) => scene.placeIds[0] === id).length }] : [];
  });
  const names = new Map([...Object.entries(data.names), ...data.characters.map((character) => [character.id, character.label] as const)]);
  const at = new Map<string, string>();
  const beats: HoloBeat[] = [];
  scenes.forEach((scene, number) => {
    const placeId = scene.placeIds[0];
    const time = times.get(scenePeriod(scene) ?? "");
    const when = time ? [time.label, dateLine(time)].filter(Boolean).join(" · ") : undefined;
    const present = unique(scene.characterIds);
    // Two places of one name (book places not merged yet) are not a trip.
    const movers = present.filter((id) => at.has(id) && at.get(id) !== placeId && (data.names[at.get(id)!] ?? at.get(id)) !== (data.names[placeId] ?? placeId));
    for (const from of unique(movers.map((id) => at.get(id)!))) {
      const group = movers.filter((id) => at.get(id) === from);
      beats.push({ id: `travel:${scene.id}:${from}`, kind: "travel", sceneId: scene.id, placeId, from, title: `${data.names[from] ?? from} → ${data.names[placeId] ?? placeId}`, text: group.map((id) => names.get(id) ?? id).join("、"), actors: group, present: group, conflict: false, scene: number + 1, when });
    }
    for (const id of present) at.set(id, placeId);
    beats.push({ id: `scene:${scene.id}`, kind: "scene", sceneId: scene.id, placeId, title: `Scene ${number + 1}`, text: scene.label, actors: present, present, conflict: isConflict(scene.label), scene: number + 1, when });
  });
  return finish(data.universe?.title ?? "Journey", places, beats, names);
}
