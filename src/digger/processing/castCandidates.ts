/**
 * Cast candidates: which characters are worth asking about for a scene.
 *
 * Extraction sees the whole identity registry and scans every scene for known
 * names, but files a name under "mentioned" unless it confirms the person is
 * physically there. Steps that later decide presence ("who is present?", Jev)
 * must choose from a list; built from recorded casts alone, that list misses
 * whoever extraction filed as mentioned, and the right answer is then not on
 * it. This one list, scored per scene, closes the gap:
 *
 *   1.0  named in the scene's text by a form only one character has
 *        (deterministic, longest form first), or recorded in the scene as
 *        present or mentioned;
 *   0.7 / 0.5 / 0.35  named or recorded one / two / three scenes away in
 *        the same chapter (the same people often continue);
 *   0.5  named only by a form two characters share, or a generic one
 *        ("少女");
 *   0.3–0.5  named or recorded elsewhere in the chapter, more for more scenes;
 *   up to 0.1  named or recorded across the volume (main characters).
 * A character's score is the best of these; ties go to the more frequent
 * character. A score is a reason to ask, not presence: a name in thought,
 * memory or on the phone scores 1 too, and the question decides.
 */
export interface CastSceneInput {
  id: string;
  chapterIndex: number;
  /** Story order within the volume. */
  index: number;
  text: string;
  present: string[];
  mentioned: string[];
}
export interface CastCharacter { id: string; forms: string[] }
export type CastEvidence = "named" | "recorded" | "neighbour" | "shared-name" | "chapter" | "volume";
export interface CastCandidate { id: string; score: number; evidence: CastEvidence }

export const CAST_CANDIDATE_LIMIT = 32;
const GENERIC_FORMS = new Set(["少年", "少女", "幼女", "女孩", "男孩", "修女", "男人", "女人", "老师", "医生", "护士", "姐姐", "妹妹", "哥哥", "弟弟", "大小姐", "小姑娘", "那家伙"]);
const NEIGHBOUR_SCORES = [0.7, 0.5, 0.35];

/** Characters named in a text: longest forms first, so a short form inside a longer name is not counted again. */
export function namedInText(text: string, characters: CastCharacter[]): { unique: Set<string>; weak: Set<string> } {
  const owners = new Map<string, Set<string>>();
  for (const character of characters) for (const form of character.forms) if (form.length >= 2) owners.set(form, (owners.get(form) ?? new Set()).add(character.id));
  const unique = new Set<string>(), weak = new Set<string>();
  let rest = text;
  for (const form of [...owners.keys()].sort((first, second) => second.length - first.length)) {
    if (!rest.includes(form)) continue;
    rest = rest.split(form).join("\u0000".repeat(form.length));
    const ids = owners.get(form)!;
    for (const id of ids) (ids.size === 1 && !GENERIC_FORMS.has(form) ? unique : weak).add(id);
  }
  return { unique, weak };
}

/** Scored candidates per scene, best first, at most `limit` (default 32). */
export function castCandidates(scenes: CastSceneInput[], characters: CastCharacter[], options: { limit?: number } = {}): Map<string, CastCandidate[]> {
  const limit = options.limit ?? CAST_CANDIDATE_LIMIT;
  const known = new Set(characters.map((character) => character.id));
  const ordered = [...scenes].sort((first, second) => first.index - second.index);
  const strong = new Map<string, Map<string, CastEvidence>>(), weak = new Map<string, Set<string>>();
  for (const scene of ordered) {
    const named = namedInText(scene.text, characters);
    const evidence = new Map<string, CastEvidence>();
    for (const id of named.unique) evidence.set(id, "named");
    for (const id of [...scene.present, ...scene.mentioned]) if (known.has(id) && !evidence.has(id)) evidence.set(id, "recorded");
    strong.set(scene.id, evidence);
    weak.set(scene.id, new Set([...named.weak].filter((id) => !evidence.has(id))));
  }
  const share = (list: CastSceneInput[], id: string) => list.length ? list.filter((scene) => strong.get(scene.id)!.has(id)).length / list.length : 0;
  const volumeShare = new Map(characters.map((character) => [character.id, share(ordered, character.id)]));
  const result = new Map<string, CastCandidate[]>();
  for (const [position, scene] of ordered.entries()) {
    const best = new Map<string, CastCandidate>();
    const offer = (id: string, score: number, evidence: CastEvidence) => { if (score > (best.get(id)?.score ?? 0)) best.set(id, { id, score, evidence }); };
    for (const [id, evidence] of strong.get(scene.id)!) offer(id, 1, evidence);
    for (const [distance, score] of NEIGHBOUR_SCORES.entries()) for (const other of [ordered[position - distance - 1], ordered[position + distance + 1]]) {
      if (other?.chapterIndex === scene.chapterIndex) for (const id of strong.get(other.id)!.keys()) offer(id, score, "neighbour");
    }
    for (const id of weak.get(scene.id)!) offer(id, 0.5, "shared-name");
    const chapter = ordered.filter((other) => other.chapterIndex === scene.chapterIndex);
    for (const character of characters) {
      const inChapter = share(chapter, character.id);
      if (inChapter) offer(character.id, 0.3 + 0.2 * inChapter, "chapter");
      else if (volumeShare.get(character.id)!) offer(character.id, 0.1 * volumeShare.get(character.id)!, "volume");
    }
    result.set(scene.id, [...best.values()].sort((first, second) => second.score - first.score || volumeShare.get(second.id)! - volumeShare.get(first.id)! || first.id.localeCompare(second.id)).slice(0, limit));
  }
  return result;
}
