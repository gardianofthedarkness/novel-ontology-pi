import { mentions, type Chart } from "./em.js";

/**
 * The facts (the user's call, 2026-10-30): the source of truth for every EM. Each fact card of the book is a fact, kept in
 * reading order, so the facts grow as the book does. Who a fact is about is found the way EM finds people: by their names
 * (every proper name EM has given them so far, so a fact read before a name was known is found once it is; a longer name
 * masks the shorter inside it), and by the descriptions EM² resolved in it (linked). A fact about a concept (an ability, a
 * network) is about its owner too. EM and EM² ask the ledger, as they run,
 * for the latest facts about each candidate and about the string being decided, before the place they decide, and give
 * them to Jev as evidence.
 * A fact's time is the latest time node read at or before it. Facts are ordered by reading order for now; once the calendar
 * places the time nodes, a later fact about the same thing (an update) is ordered by story time instead.
 */
export const FACT_RECENT = 2;
/** Characters of a fact's text a request carries. */
export const FACT_CLIP = 160;

export interface FactEntry {
  id: string; card: string; first: string; last: string; sentences: string[]; text: string;
  /** The fact's place in reading order (its first sentence's). */
  order: number;
  /** The latest time node at or before it (settle). */
  time: string | null;
  /** Who and what it is about (settle): by a name in it, by a description EM² resolved in it, or as the owner of a concept it names. */
  about: { id: string; via: "name" | "description" | "concept" }[];
}

export class FactLedger {
  readonly facts: FactEntry[];
  private readonly linked = new Map<string, Set<string>>();
  private readonly scanned = new Map<string, { size: number; ids: Set<string> }>();

  constructor(cards: { id: string; first: string; last: string; sentences: string[] }[], text: (sentence: string) => string, position: (sentence: string) => number) {
    this.facts = [...cards].sort((a, b) => position(a.first) - position(b.first)).map((card, index) => ({
      id: `fact_${String(index + 1).padStart(6, "0")}`, card: card.id, first: card.first, last: card.last, sentences: card.sentences,
      text: card.sentences.map(text).join(""), order: position(card.first), time: null, about: [],
    }));
  }

  /** The entities a fact names, with the chart's names as they are now (rescanned when the chart has more names). */
  private named(fact: FactEntry, names: [string, string][]): Set<string> {
    const cached = this.scanned.get(fact.id);
    if (cached && cached.size === names.length) return cached.ids;
    const ids = new Set(mentions(fact.text, names).map((hit) => hit.id));
    this.scanned.set(fact.id, { size: names.length, ids });
    return ids;
  }

  /** The latest facts before `before` (a position) that are about any of `ids` (or a concept one of them owns), newest first. */
  about(chart: Chart, ids: string[], before: number, limit = FACT_RECENT): FactEntry[] {
    const names = chart.names(), out: FactEntry[] = [];
    ids = [...ids, ...[...chart.entities.values()].filter((entity) => entity.owners?.some((owner) => ids.includes(owner.id))).map((entity) => entity.id)];
    for (let index = this.facts.length - 1; index >= 0 && out.length < limit; index--) {
      const fact = this.facts[index];
      if (fact.order >= before) continue;
      const named = this.named(fact, names), linked = this.linked.get(fact.id);
      if (ids.some((id) => named.has(id) || linked?.has(id))) out.push(fact);
    }
    return out;
  }

  /** The latest facts before `before` whose text holds `text`, newest first. */
  holding(text: string, before: number, limit = FACT_RECENT): FactEntry[] {
    const out: FactEntry[] = [];
    for (let index = this.facts.length - 1; index >= 0 && out.length < limit; index--) if (this.facts[index].order < before && this.facts[index].text.includes(text)) out.push(this.facts[index]);
    return out;
  }

  /** EM² resolved a description in these sentences to `entity`: the facts holding them are about it. */
  link(sentences: string[], entity: string): void {
    for (const fact of this.facts) if (fact.sentences.some((id) => sentences.includes(id))) this.linked.set(fact.id, (this.linked.get(fact.id) ?? new Set()).add(entity));
  }

  /** At the end of the reading: who each fact is about, and its time. */
  settle(chart: Chart, position: (sentence: string) => number): void {
    const names = chart.names();
    const times = [...chart.times.values()].flatMap((node) => node.seen.map((id) => [position(id), node.id] as const)).sort((a, b) => a[0] - b[0]);
    for (const fact of this.facts) {
      const named = this.named(fact, names), linked = this.linked.get(fact.id) ?? new Set<string>();
      const owners = [...named].flatMap((id) => (chart.entities.get(id)?.owners ?? []).map((owner) => owner.id)).filter((id) => id !== "many" && !named.has(id) && !linked.has(id));
      fact.about = [...[...named].map((id) => ({ id, via: "name" as const })), ...[...linked].filter((id) => !named.has(id)).map((id) => ({ id, via: "description" as const })), ...[...new Set(owners)].map((id) => ({ id, via: "concept" as const }))];
      const last = fact.order + fact.sentences.length - 1;
      fact.time = times.filter(([at]) => at <= last).at(-1)?.[1] ?? null;
    }
  }
}

/** Facts as a request carries them: once each, keyed by id, with what they were fetched for. */
export function factEvidence(found: { fact: FactEntry; for: string }[]): Record<string, { about: string[]; text: string }> {
  const out: Record<string, { about: string[]; text: string }> = {};
  for (const { fact, for: key } of found.sort((a, b) => a.fact.order - b.fact.order)) {
    const entry = out[fact.id] ?? { about: [], text: fact.text.length > FACT_CLIP ? `${fact.text.slice(0, FACT_CLIP - 1)}…` : fact.text };
    if (!entry.about.includes(key)) entry.about.push(key);
    out[fact.id] = entry;
  }
  return out;
}
