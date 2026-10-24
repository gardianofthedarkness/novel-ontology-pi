/**
 * Name-form keys for identity matching (sector 04) — the design-facing
 * facade over the language management path (languageMap.ts).
 *
 * Design code (extraction, matching, fragment checks) calls ONLY
 * these two functions. Which language map produces the key is a
 * language-management decision — selected through the registry in
 * languageMap.ts (NOVEL_LANGUAGE_MAP / setActiveLanguageMap / the
 * explicit `map` argument) — never a property of the matching design.
 * A future language situation is solved by registering or selecting a
 * different map; nothing here or downstream changes.
 *
 * Keys only: stored name forms are never rewritten. A variant
 * spelling that resolves to a known entity is still recorded on that
 * entity as its own form, in the novel's original script.
 */
import {
  activeLanguageMap,
  type LanguageMap,
} from "./languageMap.js";

/** Fold a name (or any text) into its matching key under `map`
 *  (default: the active language map). */
export const foldVariants = (s: string, map?: LanguageMap): string =>
  (map ?? activeLanguageMap()).fold(s);

/** The identity key for a name form: its fold under the active map. */
export const formKey = (form: string, map?: LanguageMap): string =>
  foldVariants(form, map);
