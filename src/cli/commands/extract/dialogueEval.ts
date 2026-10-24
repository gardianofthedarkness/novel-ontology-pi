import { readFile } from "node:fs/promises";
import type { DialogueCard } from "../../../ground/ontology/types.js";

function normalize(value: unknown): DialogueCard[] {
  if (!Array.isArray(value)) throw new Error("Dialogue evaluation expects an array of cards");
  const cards = new Map<string, DialogueCard>();
  for (const row of value) {
    const strings = (items: unknown): items is string[] => Array.isArray(items) && items.every(item => typeof item === "string" && !!item) && new Set(items).size === items.length;
    if (!row || typeof row !== "object" || typeof row.id !== "string" || !row.id || !strings(row.sentenceIds) || !row.sentenceIds.length || !strings(row.participantIds) || !strings(row.unresolvedParticipantIds ?? [])) throw new Error("Invalid dialogue evaluation card");
    const previous = cards.get(row.id);
    cards.set(row.id, { id: row.id, sentenceIds: [...new Set([...(previous?.sentenceIds ?? []), ...row.sentenceIds])], participantIds: [...new Set([...(previous?.participantIds ?? []), ...row.participantIds])], unresolvedParticipantIds: [...new Set([...(previous?.unresolvedParticipantIds ?? []), ...row.unresolvedParticipantIds ?? []])] });
  }
  if (cards.size > 500) throw new Error("Evaluate at most 500 logical cards per batch; no truncation is performed");
  return [...cards.values()].map(card => ({ ...card, unresolvedParticipantIds: card.unresolvedParticipantIds?.filter(id => !card.participantIds.includes(id)) })).sort((first, second) => first.id < second.id ? -1 : first.id > second.id ? 1 : 0);
}

function maximumOverlap(weights: number[][], columns: number): number[] {
  const size = Math.max(weights.length, columns);
  const rowPotential = Array(size + 1).fill(0);
  const columnPotential = Array(size + 1).fill(0);
  const matchedRow = Array(size + 1).fill(0);
  const previousColumn = Array(size + 1).fill(0);
  for (let row = 1; row <= size; row++) {
    matchedRow[0] = row;
    let currentColumn = 0;
    const minimum = Array(size + 1).fill(Infinity);
    const reached = Array(size + 1).fill(false);
    do {
      reached[currentColumn] = true;
      const currentRow = matchedRow[currentColumn];
      let delta = Infinity;
      let nextColumn = 0;
      for (let column = 1; column <= size; column++) {
        if (reached[column]) continue;
        const cost = -(weights[currentRow - 1]?.[column - 1] ?? 0) - rowPotential[currentRow] - columnPotential[column];
        if (cost < minimum[column]) { minimum[column] = cost; previousColumn[column] = currentColumn; }
        if (minimum[column] < delta) { delta = minimum[column]; nextColumn = column; }
      }
      for (let column = 0; column <= size; column++) {
        if (reached[column]) { rowPotential[matchedRow[column]] += delta; columnPotential[column] -= delta; }
        else minimum[column] -= delta;
      }
      currentColumn = nextColumn;
    } while (matchedRow[currentColumn] !== 0);
    do {
      const nextColumn = previousColumn[currentColumn];
      matchedRow[currentColumn] = matchedRow[nextColumn];
      currentColumn = nextColumn;
    } while (currentColumn !== 0);
  }
  const assignment = Array(weights.length).fill(-1);
  for (let column = 1; column <= size; column++) if (matchedRow[column] && matchedRow[column] <= weights.length && column <= columns) assignment[matchedRow[column] - 1] = column - 1;
  return assignment;
}

export function scoreDialogueCards(goldInput: unknown, predictedInput: unknown, minimumOverlap = 0.5) {
  if (!Number.isFinite(minimumOverlap) || minimumOverlap <= 0 || minimumOverlap > 1) throw new Error("Dialogue source IoU threshold must be in (0, 1]");
  const gold = normalize(goldInput);
  const predicted = normalize(predictedInput);
  const overlap = gold.map(expected => predicted.map(actual => {
    const references = new Set(expected.sentenceIds);
    const intersection = actual.sentenceIds.filter(id => references.has(id)).length;
    return intersection / new Set([...expected.sentenceIds, ...actual.sentenceIds]).size;
  }));
  const assignment = maximumOverlap(overlap.map(row => row.map(weight => weight >= minimumOverlap ? weight : 0)), predicted.length);
  const used = new Set<number>();
  let correct = 0, wrong = 0, missing = 0, ignoredUncertain = 0, exactCards = 0;
  const matches = gold.map((expected, index) => {
    const matched = assignment[index];
    const actualIndex = matched >= 0 && overlap[index][matched] >= minimumOverlap ? matched : -1;
    const actual = predicted[actualIndex];
    if (actual) used.add(actualIndex);
    const known = new Set(expected.participantIds);
    const uncertain = new Set(expected.unresolvedParticipantIds ?? []);
    const actualMembers = new Set(actual?.participantIds ?? []);
    const correctMembers = [...actualMembers].filter(id => known.has(id));
    const wrongMembers = [...actualMembers].filter(id => !known.has(id) && !uncertain.has(id));
    const missingMembers = [...known].filter(id => !actualMembers.has(id));
    correct += correctMembers.length; wrong += wrongMembers.length; missing += missingMembers.length;
    ignoredUncertain += [...actualMembers].filter(id => uncertain.has(id) && !known.has(id)).length;
    if (actual && !uncertain.size && !wrongMembers.length && !missingMembers.length && known.size) exactCards++;
    return { goldId: expected.id, predictedId: actual?.id ?? null, sourceIoU: actual ? overlap[index][actualIndex] : 0, correct: correctMembers, wrong: wrongMembers, missing: missingMembers };
  });
  const unmatchedPredicted = predicted.filter((_card, index) => !used.has(index));
  const unmatchedParticipantAssertions = unmatchedPredicted.reduce((total, card) => total + card.participantIds.length, 0);
  const ratio = (numerator: number, denominator: number) => denominator ? numerator / denominator : null;
  const precision = ratio(correct, correct + wrong + unmatchedParticipantAssertions);
  const recall = ratio(correct, correct + missing);
  return {
    policy: "dialogue-card-v1", minimumSourceIoU: minimumOverlap, goldCards: gold.length, predictedCards: predicted.length,
    correctParticipants: correct, wrongParticipants: wrong, missingParticipants: missing, ignoredUncertainParticipants: ignoredUncertain,
    unmatchedParticipantAssertions, matchedParticipantPrecision: ratio(correct, correct + wrong),
    precision, recall, f1: precision === null || recall === null ? null : precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    exactParticipantCards: exactCards, exactSetDenominator: gold.filter(card => card.participantIds.length && !card.unresolvedParticipantIds?.length).length,
    unresolvedPredictedCards: predicted.filter(card => !card.participantIds.length).length,
    unmatchedGoldCards: matches.filter(match => match.predictedId === null).length, unmatchedPredictedCards: unmatchedPredicted.length,
    splitGoldCards: overlap.filter(row => row.filter(weight => weight > 0).length > 1).length,
    mergedPredictedCards: predicted.filter((_card, index) => overlap.filter(row => row[index] > 0).length > 1).length,
    matches, unmatchedPredictedIds: unmatchedPredicted.map(card => card.id),
    identityPolicy: "Exact participant IDs; supply independently frozen identity equivalences before scoring, never infer aliases from predictions",
  };
}

export async function evalDialogueCards(goldPath: string, predictedPath: string) {
  const [gold, predicted] = await Promise.all([readFile(goldPath, "utf8").then(JSON.parse), readFile(predictedPath, "utf8").then(JSON.parse)]);
  return scoreDialogueCards(gold, predicted);
}
