import test from "node:test";
import assert from "node:assert/strict";
import { notesOfUnit, route, ROUTES, type RouteFocus } from "../../src/context/cutBag.js";
import { compose } from "../../src/context/engine.js";
import { moveWhetherMode } from "../../src/context/directorModes.js";

const prepared = {
  scriptSupervisor: {
    digest: { summary: "A chase through a station.", where: "a station", people: [{ who: "a", doing: "running", start: "on the platform", end: "on the stairs", holding: [] }] },
    facts: [
      { sentence: "s2", who: "a", kind: "floor", value: "upper", basis: "implied", sure: 0.7 },
      { sentence: "s3", who: "b", kind: "indoors", value: "", basis: "stated", sure: 0.9 },
      { sentence: "s9", who: "a", kind: "roof", value: "", basis: "stated", sure: 0.9 },
      { sentence: "s1", who: "a", kind: "near", value: "b", basis: "implied", sure: 0.3 },
    ],
    moves: [{ sentence: "s3", who: "a", motion: "elsewhere", to: "the stairs", how: "run", basis: "stated", sure: 0.9 }, { sentence: "s4", who: "b", motion: "step", how: "walk", basis: "implied", sure: 0.6 }],
    items: [{ sentence: "s1", item: "a bag", event: "held", who: "a", to: null }],
  },
  actionDirector: [{ sentence: "s3", attacker: "b", target: "a", attack: "a kick", range: "near", outcome: "miss", sure: 0.8 }],
  dialogueCoverage: { exchanges: [{ sentence: "s3", who: "a", with: ["b"], channel: "phone", sure: 0.9 }], formations: [] },
};
const bag = notesOfUnit("u1", prepared, { heading: { setting: "interior", place: "the station", daytime: "night", confidence: { setting: 0.9, place: 0.7, daytime: 0.6 } }, cuts: [{ id: "cut_1", first: "s1", size: "wide shot", angle: "high", move: "pan", seconds: 4, confidence: 0.6 }] });
const order = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];
const focus = (lines: string[], subject: string | null = null): RouteFocus => ({ unit: "u1", lines, cut: ["s1", "s2", "s3", "s4", "s5"], order, cast: ["a", "b"], subject });

test("every pre-film cast's notes go in the bag, each with its cast, kind, line, people and basis", () => {
  const kinds = new Set(bag.map((note) => `${note.cast}/${note.kind}`));
  for (const expected of ["script supervisor/summary", "script supervisor/state", "script supervisor/fact", "script supervisor/move", "script supervisor/item", "action director/exchange", "dialogue coverage/channel", "screenwriter/heading", "storyboard artist/shot"]) assert.ok(kinds.has(expected), expected);
  assert.equal(bag.find((note) => note.kind === "heading")?.text, "INT. the station — night");
  assert.deepEqual(bag.find((note) => note.kind === "exchange")?.who, ["b", "a"]);
});

test("the key animator is given the mover's notes on its card and before, never later lines or others' moves", () => {
  const given = route("keys", focus(["s3"], "a"), bag).map((item) => item.note);
  assert.ok(given.some((note) => note.kind === "move" && note.sentence === "s3"));
  assert.ok(given.some((note) => note.kind === "fact" && note.sentence === "s2"), "an implied fact before the card");
  assert.ok(!given.some((note) => note.sentence === "s9"), "nothing from after the card but the unit's summary");
  assert.ok(!given.some((note) => note.kind === "move" && note.who.includes("b")), "not b's moves");
  assert.ok(!given.some((note) => note.kind === "fact" && note.sure < 0.5), "not an unsure fact");
  assert.ok(given.some((note) => note.kind === "exchange"), "the blow aimed at the mover");
  assert.ok(given.some((note) => note.kind === "summary"));
});

test("the photographer gets the shot, the heading and who fights or talks to whom in the cut; the layout check the cast's facts", () => {
  const frame = route("frame", focus(["s1"]), bag).map((item) => item.note.kind);
  assert.deepEqual([...new Set(frame)].sort(), ["channel", "exchange", "heading", "shot"]);
  const check = route("layout check", focus(["s3"]), bag).map((item) => item.note);
  assert.deepEqual(check.map((note) => note.sentence).sort(), ["s2", "s3"]);
  assert.ok(check.every((note) => note.kind === "fact"));
  for (const task of Object.keys(ROUTES)) assert.ok(ROUTES[task as keyof typeof ROUTES].length);
});

test("the key animator's Jev request carries the routed notes, and the manifest records them", async () => {
  const composed = await compose(moveWhetherMode, { scene: { id: "u1", place: "the station", when: null }, card: { id: "k", lines: [{ id: "s3", text: "..." }] }, mover: { id: "a", name: "A" }, lines: [], now: {}, pictures: {}, route: focus(["s3"], "a") }, { notes: bag } as never);
  const notes = composed.state.notes as Record<string, { by: string }>;
  assert.ok(Object.values(notes).some((note) => note.by === "script supervisor"));
  assert.ok(composed.manifest.entries.some((entry) => entry.source === "notes" && entry.kept));
});
