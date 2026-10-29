import type { DecisionAnswer, DecisionQuestion } from "../../ground/connectors/jev.js";
import type { Entity } from "../../ground/ontology/types.js";
import type { Sentence } from "../intake/sectioning.js";
import type { LlmScene, SceneFacultyResult } from "../extraction/extraction.js";
import { STANDALONE, type CastBook, type CastFile } from "../../solidifier/identity/cast.js";
import { resolveNewNames, type NewName, type Resolution } from "../../solidifier/identity/em.js";
import { identityPool, recommend } from "../../solidifier/identity/recommender.js";

/**
 * Universal EM at birth, once per block: every Character name the block's
 * faculties declared, against the universal recommender (this book, the
 * universe's other books, the block's other new names). Declarations are
 * rewritten before extraction mints anything: a name that is someone
 * already known becomes that someone's alias; a name that is a person from
 * another book is minted as that person (`person`); a name that may be
 * someone carries the likely match (`possibleSame`) for review.
 */
export interface BlockUniverse { cast: CastFile; sourceId: string; books: CastBook[] }
type Declaration = NonNullable<LlmScene["newEntities"]>[number];

const PASSAGE_CHARS = 1600;
const isCharacter = (declaration: Declaration) => !!declaration?.name?.trim() && (declaration.kind ?? "Character") === "Character";

/** The text around a name's first mention in its scene. */
function passageAround(sentences: Sentence[], forms: string[]): string {
  const at = Math.max(0, sentences.findIndex((sentence) => forms.some((form) => sentence.text.includes(form))));
  const window = sentences.slice(Math.max(0, at - 6), at + 8).map((sentence) => sentence.text).join("\n");
  return window.length > PASSAGE_CHARS ? `${window.slice(0, PASSAGE_CHARS)}…` : window;
}

export async function resolveBlockIdentities(input: {
  chapterIndex: number;
  sentences: Sentence[];
  sceneSpans: string[][];
  sceneResults: Map<string, Promise<SceneFacultyResult>>;
  blockDeclarations: Declaration[] | null;
  knownEntities: Entity[];
  universe?: BlockUniverse;
  decide: (state: string, questions: DecisionQuestion[]) => Promise<DecisionAnswer[]>;
  note: (key: string, text: string) => void;
}): Promise<{ sceneResults: Map<string, SceneFacultyResult>; blockDeclarations: Declaration[] | null; resolutions: Resolution[] }> {
  const byId = new Map(input.sentences.map((sentence) => [sentence.id, sentence]));
  const settled = new Map<string, SceneFacultyResult>();
  for (const [key, pending] of input.sceneResults) { const result = await pending.catch(() => null); if (result) settled.set(key, result); }
  const spanOf = (sentenceId: string) => input.sceneSpans.find((span) => span.includes(sentenceId))?.[0];
  const known = new Set(input.knownEntities.filter((entity) => entity.kind === "Character").flatMap((entity) => entity.names.map((name) => name.text)));
  // One new name per distinct name, at its first scene; aliases gathered from every declaration of it.
  const names = new Map<string, NewName>();
  const add = (declaration: Declaration, sceneKey: string | undefined) => {
    const name = declaration.name!.trim();
    if (known.has(name) || !sceneKey) return;
    const aliases = (declaration.aliases ?? []).flatMap((alias) => alias?.text?.trim() ? [alias.text.trim()] : []).filter((alias) => alias !== name);
    const existing = names.get(name);
    if (existing) { existing.aliases = [...new Set([...existing.aliases, ...aliases])]; existing.descriptive ||= !!declaration.descriptive; return; }
    const span = input.sceneSpans.find((entry) => entry[0] === sceneKey) ?? [];
    names.set(name, { key: "n" + (names.size + 1), name, aliases, descriptive: !!declaration.descriptive, sceneId: sceneKey, passage: passageAround(span.map((id) => byId.get(id)!).filter(Boolean), [name, ...aliases]) });
  };
  for (const [key, result] of settled) for (const declaration of result.scene.newEntities ?? []) if (isCharacter(declaration)) add(declaration, key);
  for (const declaration of input.blockDeclarations ?? []) if (isCharacter(declaration)) add(declaration, spanOf(input.sentences.find((sentence) => sentence.text.includes(declaration.name!))?.id ?? ""));
  if (!names.size) return { sceneResults: settled, blockDeclarations: input.blockDeclarations, resolutions: [] };

  const pool = identityPool({ book: input.knownEntities, cast: input.universe?.cast, sourceId: input.universe?.sourceId ?? STANDALONE, books: input.universe?.books, fresh: [...names.values()].map(({ key, name, aliases }) => ({ key, name, aliases })) });
  const scenes = input.sceneSpans.map((span, index) => ({ id: span[0], chapterIndex: input.chapterIndex, index, text: span.map((id) => byId.get(id)?.text ?? "").join("\n"), present: [], mentioned: [] }));
  const ranked = recommend(scenes, pool);
  const resolutions = await resolveNewNames({ names: [...names.values()], pool, candidates: (name) => ranked.get(name.sceneId) ?? [], decisions: { modelId: "faculty-graph", decide: input.decide } });

  // Rewrite every declaration of a resolved name.
  const outcome = new Map(resolutions.map((resolution) => [resolution.name, resolution]));
  const rewrite = (declaration: Declaration): Declaration => {
    if (!isCharacter(declaration)) return declaration;
    const resolution = outcome.get(declaration.name!.trim());
    if (!resolution) return declaration;
    const aliases = [{ text: declaration.name!.trim(), kind: "alias" }, ...(declaration.aliases ?? [])];
    const to = resolution.to;
    if (to) return { name: to.name, kind: "Character", aliases, identityBound: true, emNote: resolution.note, ...(to.kind === "universe" ? { person: to.ref.slice("person:".length) } : {}) };
    return { ...declaration, emNote: resolution.note, ...(resolution.possible ? { possibleSame: [{ ref: resolution.possible.entry.ref, label: resolution.possible.entry.label, where: resolution.possible.entry.where, confidence: resolution.possible.confidence }] } : {}) };
  };
  const rewritten = new Map<string, SceneFacultyResult>();
  for (const [key, result] of settled) rewritten.set(key, { ...result, scene: { ...result.scene, newEntities: (result.scene.newEntities ?? []).map(rewrite) } });
  for (const resolution of resolutions) if (resolution.method !== "new" || resolution.possible) input.note(`identity:${resolution.name}`, resolution.note);
  return { sceneResults: rewritten, blockDeclarations: input.blockDeclarations?.map(rewrite) ?? null, resolutions };
}
