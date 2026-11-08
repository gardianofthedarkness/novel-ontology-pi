/**
 * Themes of the place holograms' models (modelThemes.json, built with architectureModels.json): each model is modern,
 * ancient, sci-fi or any, and many belong to a category (a windmill, a cart, a tall building) whose models are listed by
 * theme. A thing is drawn in the theme of the manifold it stands on: the era of the landscape patch under it (a modern
 * district, an ancient village). So a windmill in a modern district is a tall three-blade wind turbine, and one in a
 * village the old windmill: a category's models narrow to fewer, more precise ones for that theme. Jev chooses among the
 * theme's models (and the shapes), with switching theme as the last option, for the case the manifold does not tell
 * (a futuristic thing in a modern city); a switched choice is kept as it is.
 */
export type Theme = "modern" | "ancient" | "scifi";
export interface ModelThemes { themes: Theme[]; models: Record<string, { theme: Theme | "any"; category?: string }>; categories: Record<string, Partial<Record<Theme | "any", string[]>>> }

/** The last option of a model question: none of this theme's models fits, so ask again among the other themes'. */
export const SWITCH_THEME = "switch-theme";

const themeOf = (themes: ModelThemes, id: string) => themes.models[id]?.theme ?? "any";
/** The models a theme offers: its own and those of any theme, in the order given. */
export const themedKeys = (themes: ModelThemes, keys: string[], theme: Theme) => keys.filter((key) => { const own = themeOf(themes, key); return own === "any" || own === theme; });
/** The models the other themes offer (what switching theme asks among). */
export const otherKeys = (themes: ModelThemes, keys: string[], theme: Theme) => keys.filter((key) => { const own = themeOf(themes, key); return own !== "any" && own !== theme; });

/**
 * A model as drawn on a manifold of a theme: itself when it is of that theme (or any), else its category's model of that
 * theme (one of them, by `seed`); a model with no such counterpart stays itself.
 */
export function themedModel(themes: ModelThemes, id: string | null, theme: Theme, seed = ""): string | null {
  if (!id) return id;
  const own = themeOf(themes, id), category = themes.models[id]?.category ?? (themes.categories[id] ? id : undefined);
  if (own === theme || own === "any" && !themes.categories[id]) return id;
  const choices = category ? themes.categories[category]?.[theme] ?? [] : [];
  if (!choices.length) return id;
  const hash = [...seed].reduce((sum, char) => (Math.imul(sum, 31) + char.charCodeAt(0)) >>> 0, 7);
  return choices[hash % choices.length];
}
