import type { DecisionQuestion, DecisionState } from "../ground/connectors/jev.js";

/**
 * What answer options mean, once a request (the user's call, 2026-10-31; docs/v2/world-engine-v2.md §2.0.5, measured):
 * Jev sends each choice question's options with their meanings, and each noul question with its yes and no. On vol 1 the
 * questions were most of what the reading sent (17.6 million characters for 2.3 million of states), because every
 * question repeated the same meanings: EM² the whole cast's, the sentence kinds the six kinds'. Here a meaning that two or
 * more questions of a request give an option the same way goes into the state once (`answerOptions`, by option name) and
 * leaves the questions; a yes-and-no that two or more noul questions share goes into the state once (`yesNo`) and each
 * question names it. A meaning only some questions give an option, or that differs between them (`none` for who says a
 * line and for who it is said to), stays in its questions. A state that is text, not a document, is left as it is.
 */
export function hintsOnce(state: DecisionState, questions: DecisionQuestion[]): { state: DecisionState; questions: DecisionQuestion[] } {
  if (!state || typeof state !== "object" || Array.isArray(state) || questions.length < 2) return { state, questions };
  const given = new Map<string, Map<string, number>>();
  for (const question of questions) for (const option of question.options ?? []) {
    const hint = question.optionHints?.[option];
    if (hint === undefined || hint === option) continue;
    const ways = given.get(option) ?? new Map<string, number>();
    ways.set(hint, (ways.get(hint) ?? 0) + 1);
    given.set(option, ways);
  }
  const shared = new Map<string, string>();
  for (const [option, ways] of given) { const [[hint, count]] = [...ways]; if (ways.size === 1 && count >= 2) shared.set(option, hint); }
  const criteria = new Map<string, { name: string; count: number; value: { true: string; false: string } }>();
  for (const question of questions) if (question.primitive === "noul" && question.noulCriteria) {
    const key = JSON.stringify(question.noulCriteria), entry = criteria.get(key) ?? { name: `c${criteria.size + 1}`, count: 0, value: question.noulCriteria };
    entry.count++;
    criteria.set(key, entry);
  }
  const yesNo = [...criteria.values()].filter((entry) => entry.count >= 2);
  if (!shared.size && !yesNo.length) return { state, questions };
  const named = new Map([...criteria].filter(([, entry]) => entry.count >= 2).map(([key, entry]) => [key, entry.name]));
  return {
    state: {
      ...(state as Record<string, unknown>),
      ...(shared.size ? { answerOptions: Object.fromEntries(shared) } : {}),
      ...(yesNo.length ? { yesNo: Object.fromEntries(yesNo.map((entry) => [entry.name, entry.value])) } : {}),
    },
    questions: questions.map((question) => {
      const name = question.noulCriteria ? named.get(JSON.stringify(question.noulCriteria)) : undefined;
      if (name) { const { noulCriteria: _, ...rest } = question; return { ...rest, instructions: `${question.instructions} (Yes and no: yesNo.${name}.)` }; }
      if (!question.optionHints) return question;
      const kept = Object.fromEntries(Object.entries(question.optionHints).filter(([option]) => !shared.has(option)));
      const { optionHints: _, ...rest } = question;
      return Object.keys(kept).length ? { ...rest, optionHints: kept } : rest;
    }),
  };
}
