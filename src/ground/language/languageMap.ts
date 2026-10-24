/**
 * Language management — the ONE place language-specific knowledge lives.
 *
 * A LanguageMap folds name text into a matching key for a particular
 * language/script situation (character variants, regional spellings,
 * script forms). Matching, extraction and every other design module
 * consume maps ONLY through this registry and the facade in
 * nameForms.ts — they never import a specific map or its data table.
 *
 * Swapping in a different language situation is therefore a data
 * operation, not a design change:
 *  - ship a new table (data) and register a map built from it with
 *    `languageMapFromTable` + `registerLanguageMap`, or
 *  - select an already-registered map by id — programmatically via
 *    `setActiveLanguageMap`, or per process via the NOVEL_LANGUAGE_MAP
 *    environment variable.
 * Nothing downstream changes: design code keeps calling
 * foldVariants / formKey (nameForms.ts) and gets the active map.
 *
 * Maps produce MATCHING KEYS ONLY. Stored name forms are never
 * rewritten — the novel's original spellings remain the data (the
 * original-language rule, roadmap decision #7).
 */
import { VARIANT_FOLD } from "./variantTable.js";

export interface LanguageMap {
  /** Stable selection id, e.g. "zh-variants". */
  readonly id: string;
  /** What this map folds and why, in one line. */
  readonly description: string;
  /** Fold text into its matching key under this map. */
  fold(text: string): string;
}

/**
 * Build a LanguageMap from a per-character fold table — the shape
 * every generated variant table takes. Characters absent from the
 * table fold to themselves.
 */
export const languageMapFromTable = (
  id: string,
  description: string,
  table: Readonly<Record<string, string>>,
): LanguageMap => {
  const fold = new Map<string, string>(Object.entries(table));
  return {
    id,
    description,
    fold: (text: string) =>
      [...text].map((ch) => fold.get(ch) ?? ch).join(""),
  };
};

const REGISTRY = new Map<string, LanguageMap>();

export const registerLanguageMap = (map: LanguageMap): LanguageMap => {
  REGISTRY.set(map.id, map);
  return map;
};

export const listLanguageMaps = (): LanguageMap[] => [...REGISTRY.values()];

export const getLanguageMap = (id: string): LanguageMap => {
  const map = REGISTRY.get(id);
  if (!map) {
    throw new Error(
      `unknown language map "${id}" — registered maps: ${[...REGISTRY.keys()].join(", ")}`,
    );
  }
  return map;
};

/** No folding at all: names match only when spelled identically. */
export const IDENTITY_LANGUAGE_MAP: LanguageMap = {
  id: "identity",
  description: "No folding — exact-spelling matching keys.",
  fold: (text: string) => text,
};

/**
 * Chinese text with Japanese / traditional / regional character
 * variants (the Index-corpus situation): every variant character —
 * Japanese shinjitai (黒, 櫻), traditional (國, 亞), Taiwan/Hong Kong
 * regional forms — folds to ONE canonical simplified form. The table
 * is generated data (variantTable.ts; tools/gen-variant-map.py from
 * the OpenCC dictionaries).
 */
export const ZH_VARIANT_LANGUAGE_MAP: LanguageMap = languageMapFromTable(
  "zh-variants",
  "CJK variant characters (JP shinjitai, traditional, TW/HK regional) fold to one simplified canonical form.",
  VARIANT_FOLD,
);

registerLanguageMap(ZH_VARIANT_LANGUAGE_MAP);
registerLanguageMap(IDENTITY_LANGUAGE_MAP);

export const DEFAULT_LANGUAGE_MAP_ID = ZH_VARIANT_LANGUAGE_MAP.id;
export const LANGUAGE_MAP_ENV = "NOVEL_LANGUAGE_MAP";

let activeOverride: LanguageMap | undefined;

/**
 * Programmatically select the active map (pass undefined to clear).
 * This is the seam a future per-novel language setting plugs into.
 */
export const setActiveLanguageMap = (
  map: LanguageMap | string | undefined,
): void => {
  activeOverride =
    map === undefined ? undefined : typeof map === "string" ? getLanguageMap(map) : map;
};

/**
 * Resolution order: explicit id → programmatic override →
 * NOVEL_LANGUAGE_MAP env → the default map.
 */
export const resolveLanguageMap = (id?: string): LanguageMap => {
  if (id !== undefined) return getLanguageMap(id);
  if (activeOverride) return activeOverride;
  const fromEnv = process.env[LANGUAGE_MAP_ENV];
  if (fromEnv) return getLanguageMap(fromEnv);
  return getLanguageMap(DEFAULT_LANGUAGE_MAP_ID);
};

export const activeLanguageMap = (): LanguageMap => resolveLanguageMap();
