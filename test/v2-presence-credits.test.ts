// Credits checked against their unit (src/v2/rules/presence.ts corroborateCredits; docs/v2/strands.md §0.6): a credit
// through a description or as the one spoken to puts a person in a unit only when the unit names them or credits them
// strongly, or the unit before names or credits them. Aliases (one person per description, named with it somewhere) and
// people the text only describes (slots) are strong.
import assert from "node:assert/strict";
import { test } from "node:test";
import { corroborateCredits, type CreditCard, type CreditRole } from "../src/v2/rules/presence.js";

const units = [
  { id: "u1", sentences: ["a1", "a2"] },
  { id: "u2", sentences: ["b1"] },
  { id: "u3", sentences: ["c1"] },
  { id: "u4", sentences: ["d1", "d2"] },
];
const roles: Record<string, CreditRole> = {
  a1: { kind: "spoken", who: { id: "char_a" }, to: { id: "char_b" } },
  b1: { kind: "spoken", who: { id: "char_c", via: "the big sister" } },
  c1: { kind: "action", who: { id: "char_d", via: "the third" }, to: { id: "char_f" } },
  c2: { kind: "action", who: { id: "slot_1", via: "a woman" } },
  d1: { kind: "action", who: { id: "char_d", via: "the third" }, to: { id: "char_f" } },
};
const cards: (CreditCard & { id: string })[] = [
  { id: "k1", first: "a1", people: [{ id: "char_a", how: ["speaks"], at: ["a1"] }, { id: "char_b", how: ["addressed", "named"], at: ["a1", "a2"] }] },
  { id: "k2", first: "b1", people: [{ id: "char_c", how: ["speaks", "described"], at: ["b1"] }] },
  { id: "k3", first: "c1", people: [{ id: "char_d", how: ["acts"], at: ["c1"] }, { id: "char_f", how: ["addressed"], at: ["c1", "d1"] }] },
  { id: "k4", first: "d1", people: [{ id: "char_d", how: ["acts", "named"], at: ["d1", "d2"] }, { id: "char_f", how: ["named"], at: ["d2"] }] },
];

test("a credit through a description the unit does not back leaves the person described", () => {
  const { cards: out, demoted } = corroborateCredits(cards, roles, units);
  const person = (card: string, id: string) => out.find((entry) => entry.id === card)!.people!.find((entry) => entry.id === id)!;
  assert.deepEqual(person("k2", "char_c").how, ["described"]);
  assert.deepEqual(demoted.find((entry) => entry.person === "char_c"), { unit: "u2", person: "char_c" });
});

test("the roles of lines a unit does not back lose the person, keeping who the reading had", () => {
  const { roles: backed } = corroborateCredits(cards, roles, units);
  assert.deepEqual(backed.b1, { kind: "spoken", who: { id: null, answer: "unnamed", via: "the big sister", unbacked: "char_c" } });
  assert.deepEqual(backed.c1.to, { id: null, answer: "none", unbacked: "char_f" });
  assert.deepEqual(backed.d1, roles.d1);
});

test("named in the unit, or a strong credit, backs a weak one", () => {
  const { cards: out } = corroborateCredits(cards, roles, units);
  const k1 = out.find((entry) => entry.id === "k1")!;
  assert.deepEqual(k1.people!.find((entry) => entry.id === "char_a")!.how, ["speaks"]);
  assert.deepEqual(k1.people!.find((entry) => entry.id === "char_b")!.how, ["addressed", "named"]);
});

test("an alias (one person per description, named with it somewhere) is a strong credit", () => {
  const { cards: out, demoted } = corroborateCredits(cards, roles, units);
  assert.deepEqual(out.find((entry) => entry.id === "k3")!.people!.find((entry) => entry.id === "char_d")!.how, ["acts"]);
  assert.ok(!demoted.some((entry) => entry.person === "char_d"));
  // The same description crediting a second person is no alias any more.
  const shared = { ...roles, b1: { kind: "spoken", who: { id: "char_c", via: "the third" } } };
  assert.ok(corroborateCredits(cards, shared, units).demoted.some((entry) => entry.person === "char_d" && entry.unit === "u3"));
});

test("a credit spanning units keeps the units that back it and drops the lines of those that do not", () => {
  const { cards: out, demoted } = corroborateCredits(cards, roles, units);
  const f = out.find((entry) => entry.id === "k3")!.people!.find((entry) => entry.id === "char_f")!;
  assert.deepEqual(f, { id: "char_f", how: ["addressed"], at: ["d1"] });
  assert.deepEqual(demoted.filter((entry) => entry.person === "char_f"), [{ unit: "u3", person: "char_f" }]);
});

test("people the text only describes are never weak, and a second pass changes nothing", () => {
  const withSlot = [...cards, { id: "k5", first: "c2", people: [{ id: "slot_1", how: ["acts"], at: ["c2"] }] }];
  const unitsWithSlot = units.map((unit) => (unit.id === "u3" ? { ...unit, sentences: ["c1", "c2"] } : unit));
  const once = corroborateCredits(withSlot, roles, unitsWithSlot);
  assert.ok(!once.demoted.some((entry) => entry.person === "slot_1"));
  const twice = corroborateCredits(once.cards, once.roles, unitsWithSlot);
  assert.deepEqual(twice.cards, once.cards);
  assert.deepEqual(twice.demoted, []);
});
