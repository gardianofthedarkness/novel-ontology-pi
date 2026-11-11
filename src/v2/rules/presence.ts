/** Presence (matter in a scene): someone is there who speaks, acts or is spoken to; someone only named or described is not. */
export const PRESENT_HOW: ReadonlySet<string> = new Set(["speaks", "acts", "addressed"]);
export const isPresent = (person: { how: readonly string[] }) => person.how.some((how) => PRESENT_HOW.has(how));

/**
 * Credits checked against their unit (docs/v3/design.html#strands §0.6; the user, 2026-11-09: "Yes let's fix it", on the reading
 * crediting people who are not there). A card credits a person as acting, speaking or spoken to through the roles of its
 * lines. A credit is **weak** when the role reached the person through a description (`via`: "the girl", "the Number
 * One", "the big sister") that is not one of that person's aliases, or when the person is the one spoken to. A weak credit
 * puts the person in the unit only when the unit also names them or credits them strongly, or the unit before names or
 * credits them; otherwise the card keeps them as described. An alias is a description that, across the book, credits one
 * person only and credits them at least once in a unit that names them. People the text only describes (slots) exist
 * through their descriptions and are never weak. Volume 1 (library 16): 23 of 443 unit credits demoted, among them the
 * imagined speakers of unit 66 and "the Number One" read as the protagonist at units 140 and 217.
 */
export interface CreditPerson { id: string; how: string[]; at?: string[] }
export interface CreditCard { first: string; people?: CreditPerson[] }
export interface CreditRole { kind?: string; who?: { id: string | null; answer?: string; via?: string; unbacked?: string }; to?: { id: string | null; answer?: string; via?: string; unbacked?: string } }
const CREDIT = new Set(["acts", "speaks", "addressed"]);
const describedOnly = (id: string) => id.startsWith("slot_");
export function corroborateCredits<C extends CreditCard, R extends CreditRole>(cards: readonly C[], roles: Readonly<Record<string, R>>, units: readonly { id: string; sentences: readonly string[] }[]): { cards: C[]; roles: Record<string, R>; demoted: { unit: string; person: string }[] } {
  const unitOf = new Map(units.flatMap((unit) => unit.sentences.map((id) => [id, unit.id] as const)));
  const linesOf = (card: C, person: CreditPerson) => (person.at?.length ? person.at : [card.first]);
  const namedIn = new Map<string, Set<string>>();
  for (const card of cards) for (const person of card.people ?? []) if (person.how.includes("named")) for (const id of linesOf(card, person)) { const unit = unitOf.get(id); if (unit) (namedIn.get(unit) ?? namedIn.set(unit, new Set()).get(unit)!).add(person.id); }
  // Aliases: per description, the people it credits and those it credits where they are named.
  const via = new Map<string, { people: Set<string>; named: Set<string> }>();
  for (const [id, role] of Object.entries(roles)) for (const pick of [role.who, role.to]) {
    if (!pick?.id || !pick.via) continue;
    const entry = via.get(pick.via) ?? via.set(pick.via, { people: new Set(), named: new Set() }).get(pick.via)!;
    entry.people.add(pick.id);
    if (namedIn.get(unitOf.get(id) ?? "")?.has(pick.id)) entry.named.add(pick.id);
  }
  const alias = (pick: { id: string | null; via?: string }) => { const entry = pick.via ? via.get(pick.via) : undefined; return !!entry && entry.people.size === 1 && entry.named.has(pick.id ?? ""); };
  // Per unit and person: credited strongly, weakly.
  const credit = new Map<string, Map<string, { strong: boolean; weak: boolean }>>();
  const at = (unit: string, person: string) => { const map = credit.get(unit) ?? credit.set(unit, new Map()).get(unit)!; return map.get(person) ?? map.set(person, { strong: false, weak: false }).get(person)!; };
  for (const card of cards) for (const person of card.people ?? []) for (const id of linesOf(card, person)) {
    const unit = unitOf.get(id), role = roles[id]; if (!unit || !role) continue;
    if (role.who?.id === person.id && (person.how.includes("acts") || person.how.includes("speaks"))) { const entry = at(unit, person.id); if (role.who.via && !describedOnly(person.id) && !alias(role.who)) entry.weak = true; else entry.strong = true; }
    if (role.to?.id === person.id && person.how.includes("addressed")) { const entry = at(unit, person.id); if (describedOnly(person.id) || alias(role.to)) entry.strong = true; else entry.weak = true; }
  }
  // In reading order: who is in each unit by credit, the unit before deciding a weak credit with this unit's names.
  const kept = new Map<string, Set<string>>(), demoted: { unit: string; person: string }[] = [];
  let before = new Set<string>();
  for (const unit of units) {
    const here = new Set<string>(), names = namedIn.get(unit.id) ?? new Set<string>();
    for (const [person, entry] of credit.get(unit.id) ?? []) {
      if (entry.strong || names.has(person) || before.has(person)) here.add(person);
      else if (entry.weak) demoted.push({ unit: unit.id, person });
    }
    kept.set(unit.id, here); before = new Set([...here, ...names]);
  }
  const weakOnly = (unit: string, person: string) => { const entry = credit.get(unit)?.get(person); return !!entry && entry.weak && !entry.strong && !kept.get(unit)?.has(person); };
  const out = cards.map((card) => {
    if (!card.people?.some((person) => person.how.some((how) => CREDIT.has(how)))) return card;
    const people = card.people.map((person) => {
      if (!person.how.some((how) => CREDIT.has(how))) return person;
      const lines = linesOf(card, person), out = lines.filter((id) => weakOnly(unitOf.get(id) ?? "", person.id));
      if (!out.length) return person;
      // Every line in units that do not back the credit: described. Some: those lines leave the person's credit.
      if (out.length === lines.length) return { ...person, how: [...new Set(person.how.map((how) => (CREDIT.has(how) ? "described" : how)))] };
      return { ...person, at: lines.filter((id) => !out.includes(id)) };
    });
    return { ...card, people };
  });
  // The lines' roles in the units that do not back them lose the person (the speaker unknown, nobody spoken to); the
  // description stays, and `unbacked` keeps who the reading had.
  const dropped = new Set(demoted.map((entry) => `${entry.unit}|${entry.person}`)), backed: Record<string, R> = { ...roles };
  for (const [id, role] of Object.entries(roles)) {
    const unit = unitOf.get(id) ?? "", who = role.who?.id && dropped.has(`${unit}|${role.who.id}`), to = role.to?.id && dropped.has(`${unit}|${role.to.id}`);
    if (!who && !to) continue;
    backed[id] = { ...role, ...(who ? { who: { ...role.who, id: null, answer: "unnamed", unbacked: role.who!.id } } : {}), ...(to ? { to: { ...role.to, id: null, answer: "none", unbacked: role.to!.id } } : {}) };
  }
  return { cards: out, roles: backed, demoted };
}
