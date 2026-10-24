import type { DecisionAnswer, DecisionQuestion } from "../../ground/connectors/jev.js";
import type { NamedTurn } from "../extraction/extraction.js";

export const speakerQuestions = (units: string[][], names: string[]): DecisionQuestion[] => units.map(unit => ({
  key: `speaker:${unit[0]}`, primitive: "choice",
  instructions: `Who alone speaks ALL spoken sentences in ${unit.join(", ")}? Options are exact source names. Choose unknown if mixed speakers or ambiguous; narrator is not a spoken character.`,
  options: [...names.slice(0, 250), "unknown"],
}));

export function readSpeakerGuesses(units: string[][], names: string[], results: DecisionAnswer[]): { turns: NamedTurn[]; valid: boolean } {
  const answers = new Map(results.map(answer => [answer.key, answer]));
  let valid = true;
  const turns: NamedTurn[] = units.map(unit => {
    const speaker = answers.get(`speaker:${unit[0]}`);
    if (!speaker || typeof speaker.value !== "string" || !names.includes(speaker.value) || (speaker.confidence ?? 0) < 0.8) valid = false;
    const speakerName = typeof speaker?.value === "string" && names.includes(speaker.value) ? speaker.value : null;
    return { sentenceIds: [...unit], speakerName, addresseeName: null };
  });
  return { turns, valid };
}
