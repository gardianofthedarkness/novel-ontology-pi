import { createHash } from "node:crypto";
import { join } from "node:path";
import { BundleStore } from "../../ground/connectors/bundle.js";
import type { Entity } from "../../ground/ontology/types.js";
import { causalSource } from "../causality/evidence.js";
import type { ReviewAdapter, ReviewEvidence, ReviewFact } from "../merge/reviewTypes.js";
import { rootCastScope } from "../identity/cast.js";
import { buildCalendar, decideYears, type CalendarFile } from "./calendar.js";

/**
 * Calendar review packets (`ut_*`): the years the calendar had to infer.
 * One packet per universe holds every open question "does this book happen
 * in the same year as the one before it?" — accept: the same year; reject:
 * a later year; hold: stays in the same year, still asked. Reviewed through
 * the shared gate at the library (`--scope universe --universe <id>`).
 */
export const calendarPacketId = (calendar: Pick<CalendarFile, "questions" | "universeId">) => calendar.questions.length ? `ut_${createHash("sha256").update(JSON.stringify([calendar.universeId, calendar.questions.map((question) => question.id).sort()])).digest("hex").slice(0, 24)}` : null;

export async function calendarAdapter(root: string, universeId: string, packetId: string, env: NodeJS.ProcessEnv): Promise<ReviewAdapter> {
  const scope = await rootCastScope(root, universeId, env);
  const calendar = await buildCalendar(scope);
  if (calendarPacketId(calendar) !== packetId) throw new Error("Calendar packet is out of date or answered; run novel calendar show for the current one.");
  const title = (sourceId: string) => scope.books.find((book) => book.sourceId === sourceId)?.title ?? sourceId;
  const anchor = async (sourceId: string, timeId: string): Promise<ReviewEvidence[]> => {
    const book = scope.books.find((entry) => entry.sourceId === sourceId);
    if (!book) return [];
    const entities = await new BundleStore(join(book.workspace, "ontology")).loadFile<Entity>("entities.jsonl").catch(() => [] as Entity[]);
    const sentenceId = entities.filter((entity) => entity.id === timeId).at(-1)?.properties?.sentenceId;
    const sentence = typeof sentenceId === "string" ? (await causalSource(book.workspace).catch(() => ({ sentences: [] as { id: string; text: string }[] }))).sentences.find((entry) => entry.id === sentenceId) : undefined;
    return sentence ? [{ id: `${sourceId}:${sentence.id}`, text: sentence.text }] : [];
  };
  const facts: ReviewFact[] = [];
  for (const question of calendar.questions) {
    const evidence = [...await anchor(question.after, question.previousId), ...await anchor(question.sourceId, question.firstId)];
    facts.push({ id: question.id, field: "calendar-year", value: { book: question.sourceId, after: question.after, sameYear: true },
      meaning: { question: `Does "${title(question.sourceId)}" happen in the same year as "${title(question.after)}"? Accept: the same year. Reject: a later year.`, previousBookEnds: question.previousLast, thisBookBegins: question.first },
      evidence, requiredEvidence: evidence.map((entry) => entry.id), requireAllEvidence: true, context: { question } });
  }
  return {
    revision: createHash("sha256").update(JSON.stringify([packetId, calendar.inputs])).digest("hex"), stale: false, applied: false, facts, requireFullReview: true,
    async validate(decisions) {
      if (decisions.some((decision) => "replacement" in decision || "semanticReplacement" in decision)) throw new Error("A year changes only by accept (same year), reject (a later year) or hold.");
      return decisions;
    },
    async apply(decisions) {
      const answered = decisions.filter((decision) => decision.verdict !== "hold").flatMap((decision) => { const question = calendar.questions.find((entry) => entry.id === decision.factId); return question ? [{ sourceId: question.sourceId, after: question.after, verdict: decision.verdict === "accept" ? "same" as const : "later" as const, reason: decision.reason }] : []; });
      const result = answered.length ? await decideYears(scope, answered) : calendar;
      return { verified: answered.filter((entry) => entry.verdict === "same").length, held: decisions.length - answered.length, rejected: answered.filter((entry) => entry.verdict === "later").length, deferredProposals: 0, result: { years: result.books.map((book) => ({ book: book.title, year: book.year, by: book.yearBy })) } };
    },
  };
}
