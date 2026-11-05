import { test } from "node:test";
import assert from "node:assert/strict";
import { designationForms, digitForm, introParts, introSentences, introTerms } from "../src/v2/extraction/front.js";
import { Chart } from "../src/v2/extraction/em.js";
import { FactLedger } from "../src/v2/extraction/facts.js";

// A front matter shaped as the publisher's (headings escaped: synopsis, credits, picture markers), in English words.
const SYNOPSIS = "\u7b80\u4ecb", CREDITS = "\u5236\u4f5c\u4fe1\u606f", PICTURE = (n: number) => `\u63d2\u56fe${n}`, AFTERWORD = "\u540e\u8bb0";
const matter = {
  before: [CREDITS, "Translated by a team", "Proofread by another", SYNOPSIS, "A city of espers at Christmas.", "A boy with bad luck meets a nun.",
    PICTURE(1), "“Let us pick the sweets first.”", "the third Level 5, known as “Railgun”", "Misaka",
    "“Wait for me!”", "the nun who remembers every grimoire", "Index",
    PICTURE(2), "“Wah.”", "Sister·No. \u4e8c\u3007\u3007\u3007\u4e00\u53f7", "Last Order"],
  after: [AFTERWORD, "Thanks for reading.", "See you next volume."],
};

test("the front matter's parts by rule: credits counted, the synopsis, each cast entry with its plate, the afterword", () => {
  const parts = introParts(matter);
  assert.equal(parts.credits, 2);
  assert.deepEqual(parts.synopsis, ["A city of espers at Christmas.", "A boy with bad luck meets a nun."]);
  assert.deepEqual(parts.cast.map((entry) => [entry.name, entry.plate]), [["Misaka", 1], ["Index", 1], ["Last Order", 2]]);
  assert.deepEqual(parts.afterword, ["Thanks for reading.", "See you next volume."]);
  assert.deepEqual(introTerms(parts.cast[0]), ["Railgun"], "what the epithet quotes");
  assert.deepEqual(introTerms(parts.cast[2]), ["Sister", "No. \u4e8c\u3007\u3007\u3007\u4e00\u53f7"], "what a middle dot sets off");
  assert.equal(digitForm("No. \u4e8c\u3007\u3007\u3007\u4e00\u53f7"), "No. 20001\u53f7");
  assert.deepEqual(designationForms("No. \u4e8c\u3007\u3007\u3007\u4e00\u53f7"), ["No. 20001\u53f7", "20001\u53f7"], "as the book writes it");
  assert.equal(digitForm("Misaka"), null);
  const { sentences } = introSentences(parts);
  assert.equal(sentences.length, 5, "three cast entries, two synopsis paragraphs");
  assert.match(sentences[0].id, /^intro_s0000$/);
});

test("a person's introduced names join them when the reading meets them; two already apart become one, ids kept", () => {
  const fresh = new Chart();
  fresh.expect(["Misaka Imouto", "10032\u53f7"]);
  const first = fresh.mint("person", "person", "10032\u53f7", ["s5"]);
  assert.equal(fresh.exact("Misaka Imouto")?.id, first.id, "met by one name: the others are theirs from then (EM matches them exactly)");
  const chart = new Chart(), position = (id: string) => Number(id.slice(1));
  const early = chart.mint("person", "person", "10032\u53f7", ["s5"]), other = chart.mint("person", "person", "Kamijou", ["s6"]), late = chart.mint("person", "person", "Misaka Imouto", ["s9"]);
  chart.expect(["Misaka Imouto", "10032\u53f7"]);
  assert.deepEqual(chart.mergeExpected(position), [[late.id, early.id]], "two people of the chart the introduction names as one: the first met kept");
  assert.equal(chart.exact("Misaka Imouto")?.id, early.id);
  assert.ok(!chart.entities.has(late.id));
  assert.equal(chart.entities.get(other.id)?.id, other.id, "no other id changes");
});

test("standing facts ride with every request about the people they name, however far back", () => {
  const cards = Array.from({ length: 6 }, (_, k) => ({ id: `c${k}`, first: `s${k * 10}`, last: `s${k * 10}`, sentences: [`s${k * 10}`] }));
  const text = (id: string) => (id === "s0" ? "Misaka laughed." : id.startsWith("intro") ? "the third Level 5: Misaka." : `Someone spoke (${id}).`);
  const ledger = new FactLedger(cards, text, (id) => (id.startsWith("intro") ? -1 : Number(id.slice(1))));
  ledger.addStanding([{ sentence: "intro_s0000", text: "the third Level 5: Misaka." }]);
  const chart = new Chart(), misaka = chart.mint("person", "person", "Misaka", ["s0"]);
  const about = ledger.about(chart, [misaka.id], 55);
  assert.deepEqual(about.map((fact) => fact.id), ["fact_000001", "fact_intro_001"], "the book's own, and the introduction's");
  assert.deepEqual(ledger.holding("Level 5", 55).map((fact) => fact.id), ["fact_intro_001"]);
});
