/**
 * Name-form folding for identity matching (sector 04).
 *
 * `foldVariants` maps every CJK variant character — Japanese
 * shinjitai （黒， 櫻）, traditional （國， 亞）, Taiwan/Hong Kong
 * regional variants — to ONE canonical simplified form, using the
 * generated table in variantTable.ts (OpenCC dictionaries; see
 * tools/gen-variant-map.py). It produces MATCHING KEYS ONLY: stored
 * name forms are never rewritten — the novel's original spellings
 * remain the data, and a variant spelling that resolves to a known
 * entity is still recorded on that entity as its own form.
 */
import { VARIANT_FOLD } from "./variantTable.js";

const FOLD = new Map<string, string>(Object.entries(VARIANT_FOLD));

export const foldVariants = (s: string): string =>
  [...s].map((ch) => FOLD.get(ch) ?? ch).join("");

/** The identity key for a name form: its variant fold. */
export const formKey = (form: string): string => foldVariants(form);
