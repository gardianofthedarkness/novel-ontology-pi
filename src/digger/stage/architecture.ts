import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { DecisionModel } from "../../ground/connectors/jev.js";
import { architectureCandidates, type ArchitectureKind } from "../../ground/stage/placeArchitecture.js";

/**
 * Stage faculty 1 — architecture: which building each place is, a sub-kind
 * of place (tower, church, station, district …, or none). Runs after story
 * time and the place tree, beside strands and causality.
 *
 *   1. The place's name shortlists up to four kinds (loose keywords, head
 *      noun first: placeArchitecture.ts) — a filter, so Jev chooses among
 *      fewer, less noisy options.
 *   2. Jev picks among pictures of the shortlisted buildings
 *      (assets/architecture/<kind>.png), under neutral option names, so the
 *      pictures decide, not the words. "none" when no picture fits.
 *
 * Without Jev the first shortlisted kind stands. A view input: no review
 * packet, never canon. Answers are kept per place and reused while its name
 * and path stay the same.
 */
/** A place as the faculty reads it: its name, its path in the place tree (root first), the places inside it (ids) and its first scenes. */
export interface ArchitecturePlace { id: string; label: string; path: string[]; contains?: string[]; sceneLabels: string[] }
export interface ArchitecturePick {
  label: string;
  kind: ArchitectureKind | "none";
  shortlist: ArchitectureKind[];
  /** jev: the picture choice; name: the first shortlisted kind (no Jev); tree: it contains a district, so it is a city; no hint: the name suggests no building. */
  by: "jev" | "name" | "tree" | "no hint";
  /** What this pick read (name, path, scenes): it is reused while that stays the same. */
  inputs: string;
  confidence?: number;
  probabilities?: Record<string, number>;
}
export interface ArchitectureReport { version: 1; inputs: string; model: string | null; askedAt: string; usage: { calls: number; reused: number }; places: Record<string, ArchitecturePick> }

const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 16);
export const placeInputs = (place: ArchitecturePlace) => hash([place.label, place.path, place.contains ?? [], place.sceneLabels.slice(0, 3)]);
/** What the faculty reads, for the checklist: current while every place's inputs are. */
export const architectureFingerprint = (places: ArchitecturePlace[]) => hash(places.map((place) => [place.id, placeInputs(place)]).sort());

/** The candidate pictures, one PNG per kind, shipped with the CLI (assets/architecture). */
export async function architecturePictures(): Promise<Partial<Record<ArchitectureKind, string>>> {
  let directory = dirname(fileURLToPath(import.meta.url));
  for (;;) {
    const pkg = await readFile(join(directory, "package.json"), "utf8").then((text) => JSON.parse(text) as { name?: string }, () => null);
    if (pkg?.name === "novel-ontology-pi") break;
    const parent = dirname(directory);
    if (parent === directory) return {};
    directory = parent;
  }
  const kinds: ArchitectureKind[] = ["church", "hospital", "station", "market", "castle", "park", "village", "skyscraper", "school", "city", "home", "office"];
  const pictures: Partial<Record<ArchitectureKind, string>> = {};
  for (const kind of kinds) {
    const png = await readFile(join(directory, "assets", "architecture", `${kind}.png`)).catch(() => null);
    if (png) pictures[kind] = png.toString("base64");
  }
  return pictures;
}

const LETTERS = "abcd";

/** One place: the shortlist, then (with Jev and pictures) one picture choice. */
export async function pickPlace(place: ArchitecturePlace, options: { decisions?: DecisionModel; pictures?: Partial<Record<ArchitectureKind, string>>; names?: Record<string, string> } = {}): Promise<{ pick: ArchitecturePick; calls: number }> {
  const shortlist = architectureCandidates(place.label);
  const base = { label: place.label, shortlist, inputs: placeInputs(place) };
  if (!shortlist.length) return { pick: { ...base, kind: "none", by: "no hint" }, calls: 0 };
  const shown = shortlist.filter((kind) => options.pictures?.[kind]);
  if (!options.decisions || shown.length < shortlist.length) return { pick: { ...base, kind: shortlist[0], by: "name" }, calls: 0 };
  const names = shown.map((_, index) => `picture_${LETTERS[index]}`);
  const inside = place.path.slice(0, -1).map((id) => options.names?.[id] ?? id).join(" › ");
  // What the place contains is the plainest sign of a district or a city (学园都市 holds its 学区).
  const contains = (place.contains ?? []).slice(0, 6).map((id) => options.names?.[id] ?? id);
  const state = `A novel names a place "${place.label}"${inside ? `, inside ${inside}` : ""}.${contains.length ? ` Places inside it: ${contains.join(", ")}.` : ""}${place.sceneLabels.length ? ` Scenes there: ${place.sceneLabels.slice(0, 3).join("; ")}.` : ""}`;
  const [answer] = await options.decisions.decide(state, [{
    key: "building", primitive: "choice", options: [...names, "none"],
    // Neutral option names: the pictures, not the words, have to decide.
    optionHints: { ...Object.fromEntries(names.map((name) => [name, `the building in \`${name}\``])), none: "none of the pictures fits this place" },
    instructions: "The pictures are monochrome hologram line drawings of places on a map. Which one best represents the place in `state`: a single building, a site, or a whole district or city? Pick none only when no picture fits at all.",
  }], { images: Object.fromEntries(names.map((name, index) => [name, options.pictures![shown[index]]!])) });
  const kindOf = (option: string): ArchitectureKind | "none" | null => option === "none" ? "none" : shown[names.indexOf(option)] ?? null;
  const kind = kindOf(String(answer?.value ?? "")) ?? shortlist[0];
  const probabilities = answer?.distribution ? Object.fromEntries(Object.entries(answer.distribution).map(([option, value]) => [kindOf(option) ?? option, Math.round(value * 1000) / 1000])) : undefined;
  return { pick: { ...base, kind, by: "jev", ...(answer?.confidence !== undefined ? { confidence: answer.confidence } : {}), ...(probabilities ? { probabilities } : {}) }, calls: 1 };
}

/** Every place, reusing earlier picks whose inputs have not changed; a few places at a time. */
export async function pickArchitecture(places: ArchitecturePlace[], options: { decisions?: DecisionModel; pictures?: Partial<Record<ArchitectureKind, string>>; names?: Record<string, string>; previous?: ArchitectureReport | null; concurrency?: number } = {}): Promise<ArchitectureReport> {
  const picks: Record<string, ArchitecturePick> = {};
  let calls = 0, reused = 0, next = 0;
  const worker = async () => {
    while (next < places.length) {
      const place = places[next++];
      const earlier = options.previous?.places[place.id];
      // A pick made without Jev is redone once Jev is available.
      if (earlier && earlier.inputs === placeInputs(place) && (earlier.by !== "name" || !options.decisions)) { picks[place.id] = earlier; reused++; continue; }
      const result = await pickPlace(place, options);
      picks[place.id] = result.pick;
      calls += result.calls;
    }
  };
  await Promise.all(Array.from({ length: Math.max(1, Math.min(options.concurrency ?? 4, places.length)) }, worker));
  // The tree outranks the picture: a place that contains a district is a city (学园都市 holds its 学区, whatever its name suggests),
  // all the way up the tree, whatever order the places come in.
  for (let changed = true; changed;) {
    changed = false;
    for (const place of places) if (picks[place.id].kind !== "city" && (place.contains ?? []).some((id) => picks[id]?.kind === "city")) { picks[place.id] = { ...picks[place.id], kind: "city", by: "tree" }; changed = true; }
  }
  const ordered = Object.fromEntries(places.map((place) => [place.id, picks[place.id]]));
  return { version: 1, inputs: architectureFingerprint(places), model: options.decisions?.modelId ?? null, askedAt: new Date().toISOString(), usage: { calls, reused }, places: ordered };
}
