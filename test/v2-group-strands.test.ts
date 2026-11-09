// Strands as groups in envelopes (src/v2/extraction/strands.ts groupStrands; docs/v2/strands.md; milestones M17a): a
// strand is a group, the area that envelops it and its stretch of story time. A sub-group is its own strand only when
// it is told in another envelope while the rest is told elsewhere; where the text has the groups together they are one
// strand again, under the id of the one with the most scenes.
import assert from "node:assert/strict";
import { test } from "node:test";
import { builtTree, envelopes, groupStrands, strandsDocument } from "../src/v2/extraction/strands.js";
import { forkTimeline } from "../src/digger/stage/environment.js";
import { problemsOf } from "../src/v2/settings.js";
import type { ReadingScript, ScriptScene } from "../src/v2/extraction/script.js";

const places: ReadingScript["places"] = {
  city: { label: "city", scale: "city", parent: null }, port: { label: "port", scale: "city", parent: null },
  north: { label: "north", scale: "district", parent: "city" }, south: { label: "south", scale: "district", parent: "city" },
  school: { label: "school", scale: "building", parent: "north" }, dorm: { label: "dorm", scale: "building", parent: "north" },
  mall: { label: "mall", scale: "building", parent: "south" }, cafe: { label: "cafe", scale: "building", parent: null },
  pier: { label: "pier", scale: "street", parent: "port" },
};
let clock = 0;
const scene = (id: string, place: string | null, present: string[], extra: Partial<ScriptScene> = {}): ScriptScene => ({ id, chapter: 0, place, placeBy: "environment", clock: [clock, clock++], present, stayed: [], firstSeen: [], timeline: [], ...extra });
const book = (...scenes: ScriptScene[]): ReadingScript => ({ version: 2, from: "v2-reading", places, scenes });
const forksOf = (script: ReadingScript, options = {}) => { const strands = groupStrands(script, options); return { strands, forks: Object.fromEntries(strands.forks.map((fork) => [fork.id, fork])), of: (id: string) => strands.forkOf.get(id) }; };

test("an envelope is the first place at the scale on the way up; apart only on evidence", () => {
  const { envelopeOf, apart } = envelopes(places);
  assert.deepEqual([envelopeOf("school"), envelopeOf("north"), envelopeOf("city"), envelopeOf("cafe"), envelopeOf("pier"), envelopeOf(null)], ["north", "north", "city", null, "port", null]);
  assert.equal(apart("north", "south"), true, "side by side under the city");
  assert.equal(apart("north", "city"), false, "the whole city is not elsewhere");
  assert.equal(apart("north", null), false, "a place nobody knows the district of is not elsewhere");
  assert.equal(apart("north", "port"), true, "two cities");
  assert.equal(envelopes(places, { envelope: "building" }).apart("school", "dorm"), true);
  assert.equal(envelopes(places, { envelope: "city" }).envelopeOf("mall"), "city");
  assert.throws(() => envelopes(places, { envelope: "village" }), /not a place scale/);
  assert.equal(envelopes(places, { tree: { cafe: { parent: "south" } } }).envelopeOf("cafe"), "south", "the built world knows the cafe's district");
});

test("a sub-group told in another envelope while the rest is told at home is a strand; together again they are one, under the larger's id", () => {
  const { strands, forks, of } = forksOf(book(scene("s1", "school", ["a", "b", "c"]), scene("s2", "mall", ["a"]), scene("s3", "dorm", ["b", "c"]), scene("s4", "school", ["a", "b", "c"])));
  assert.deepEqual([of("s1"), of("s2"), of("s3"), of("s4")], ["s1", "s2", "s1", "s1"]);
  assert.deepEqual(forks.s2, { id: "s2", scenes: ["s2"], people: ["a"], from: ["s1"], to: ["s1"], envelope: "south", unites: [], open: false, splitFrom: ["s1"], into: "s1", intoAt: "s4" });
  assert.deepEqual([forks.s1.splitFrom, forks.s1.intoAt], [[], undefined], "the strand that stayed began from nobody and closes nowhere");
  assert.deepEqual([forks.s1.unites, forks.s1.open, forks.s1.envelope, forks.s1.to, forks.s1.from], [["s2"], true, "north", ["s2"], ["s2"]]);
  assert.deepEqual(strands.checks.map((check) => [check.kind, check.sceneId, check.otherId]), [["split", "s2", "s1"], ["union", "s4", "s2"]]);
  assert.equal(strands.continues.get("s3"), "s1"); assert.equal(strands.continues.get("s4"), "s3"); assert.equal(strands.continues.get("s2"), null);
  // The per-person entries are each person's own line, as before.
  const into = Object.fromEntries(strands.handoffs.get("s4")!.map((entry) => [entry.person, entry]));
  assert.deepEqual([into.a.from, into.a.samePlace, into.b.from, into.b.samePlace], ["s2", false, "s3", false]);
});

test("a walk inside the envelope, a coarse placement and a place of no known district are not splits", () => {
  for (const [away, why] of [["dorm", "another building of the district"], ["city", "the whole city"], ["cafe", "nobody knows its district"]] as const) {
    const { strands } = forksOf(book(scene("s1", "school", ["a", "b"]), scene("s2", away, ["a"]), scene("s3", "school", ["b"]), scene("s4", "school", ["a", "b"])));
    assert.equal(strands.forks.length, 1, why); assert.equal(strands.forks[0].envelope, away === "cafe" ? "north" : "north", why);
  }
});

test("the whole group moving, one going ahead, and one going alone with nobody told meanwhile keep the strand; its envelope follows", () => {
  const moved = forksOf(book(scene("s1", "school", ["a", "b"]), scene("s2", "mall", ["a", "b"])));
  assert.deepEqual([moved.strands.forks.length, moved.forks.s1.envelope], [1, "south"]);
  const ahead = forksOf(book(scene("s1", "school", ["a", "b"]), scene("s2", "mall", ["a"]), scene("s3", "mall", ["b"]), scene("s4", "mall", ["a", "b"])));
  assert.deepEqual([ahead.strands.forks.length, ahead.forks.s1.envelope], [1, "south"], "b is next told where a went: the group moved");
  const alone = forksOf(book(scene("s1", "school", ["a", "b"]), scene("s2", "mall", ["a"]), scene("s3", "school", ["a", "b"])));
  assert.deepEqual([alone.strands.forks.length, alone.forks.s1.envelope], [1, "north"], "nothing is told of b while a is away");
});

test("one comes back while the other stays: no union, the strand stays open with the one who stayed", () => {
  const { forks, of } = forksOf(book(scene("s1", "school", ["a", "b", "c", "d"]), scene("s2", "mall", ["a", "d"]), scene("s3", "dorm", ["b", "c"]), scene("s4", "school", ["a", "b", "c"]), scene("s5", "mall", ["d"])));
  assert.deepEqual([of("s2"), of("s4"), of("s5")], ["s2", "s1", "s2"]);
  assert.deepEqual([forks.s2.open, forks.s2.to, forks.s1.unites], [true, ["s1"], []]);
});

test("someone of a strand that closed into another is on the one that kept the id", () => {
  const { forks, of } = forksOf(book(scene("s1", "school", ["a", "b", "c", "d"]), scene("s2", "mall", ["a", "d"]), scene("s3", "dorm", ["b", "c"]), scene("s4", "school", ["a", "b", "c"]), scene("s5", "school", ["d", "b"])));
  assert.deepEqual([forks.s2.into, of("s5")], ["s1", "s1"]);
  assert.equal(Object.keys(forks).length, 2);
});

test("a scene of nobody, or of people first seen, is on the strand being told unless its place is apart", () => {
  const { strands, forks, of } = forksOf(book(scene("s1", "school", ["a"]), scene("s2", "school", []), scene("s3", "pier", ["x"]), scene("s4", "dorm", ["y"]), scene("s5", "pier", [])));
  assert.deepEqual([of("s2"), of("s3"), of("s4"), of("s5")], ["s1", "s3", "s1", "s3"]);
  assert.deepEqual([forks.s3.open, forks.s3.envelope, forks.s3.from, forks.s1.people], [true, "port", [], ["a", "y"]]);
  assert.ok(strands.checks.some((check) => check.kind === "apart" && check.count === 2), "the chapter ends with two strands open");
});

test("a scene of nobody is never a strand of its own: the open strand it looks at, else the telling", () => {
  const { strands, of } = forksOf(book(scene("s1", "school", ["a"]), scene("s2", "pier", []), scene("s3", "pier", ["x"]), scene("s4", "mall", []), scene("s5", "school", []), scene("s6", "pier", ["x"]), scene("s7", "mall", [])));
  assert.deepEqual([of("s2"), of("s3"), of("s4"), of("s5"), of("s7")], ["s1", "s3", "s3", "s1", "s3"], "the pier with nobody before anyone is there, the mall from the port's telling, the school from the school's strand");
  assert.deepEqual(strands.forks.map((fork) => fork.id), ["s1", "s3"]);
});

test("a sampling pool is no envelope of its own: the area it samples is", () => {
  const pooled: ReadingScript["places"] = { ...places, somewhere: { label: "somewhere in the city", scale: "district", parent: "city", pool: "city" }, alley: { label: "alley", scale: "street", parent: "somewhere" } };
  const { envelopeOf, apart } = envelopes(pooled);
  assert.deepEqual([envelopeOf("somewhere"), envelopeOf("alley")], ["city", "city"]);
  assert.equal(apart(envelopeOf("alley"), "north"), false, "somewhere in the city is not elsewhere than the north district");
  const script: ReadingScript = { version: 2, from: "v2-reading", places: pooled, scenes: [scene("s1", "school", ["a", "b"]), scene("s2", "alley", ["a"]), scene("s3", "school", ["b"]), scene("s4", "school", ["a", "b"])] };
  assert.equal(groupStrands(script).forks.length, 1);
  assert.equal(groupStrands(script, { tree: { alley: { parent: "south" } } }).forks.length, 2, "built in the south district, it is elsewhere");
});

test("the built tree: a place that owns or borrows a slot stands under the nearest place above it", () => {
  const slots = {
    "slot:d1": { id: "slot:d1", parent: "city", owner: "south" },
    "slot:s1": { id: "slot:s1", parent: "slot:d1" },
    "slot:b1": { id: "slot:b1", parent: "slot:s1", owner: "cafe", sharers: [{ book: "vol-1", mention: "m1" }, { book: "vol-2", mention: "m2" }] },
    "slot:b2": { id: "slot:b2", parent: "slot:s1", sharers: [{ book: "vol-1", mention: "m3" }] },
    "slot:b3": { id: "slot:b3", parent: "slot:gone", owner: "lost" },
  };
  assert.deepEqual(builtTree(slots, "vol-1"), { south: { parent: "city" }, cafe: { parent: "south" }, m1: { parent: "cafe" }, m3: { parent: "south" } });
  assert.deepEqual(Object.keys(builtTree(slots)).sort(), ["cafe", "m1", "m2", "m3", "south"]);
  assert.deepEqual(builtTree(null), {});
  assert.equal(envelopes(places, { tree: builtTree(slots, "vol-1") }).envelopeOf("cafe"), "south");
});

test("the past is its own closed strand and hands nothing on; story order is the clock's, then the reading's", () => {
  const past = forksOf(book(scene("s1", "school", ["a"]), scene("s2", "mall", ["a", "z"], { clock: null }), scene("s3", "school", ["a"])));
  assert.deepEqual([past.of("s2"), past.forks.s2.past, past.forks.s2.open, past.of("s3")], ["s2", true, false, "s1"]);
  assert.deepEqual([past.forks.s2.splitFrom, past.forks.s2.intoAt], [[], undefined], "the past starts from nothing of the present and closes into nothing");
  assert.deepEqual(past.strands.handoffs.get("s2"), [{ person: "a", from: null, samePlace: false }, { person: "z", from: null, samePlace: false }]);
  assert.deepEqual(past.strands.handoffs.get("s3"), [{ person: "a", from: "s1", samePlace: true }]);
  const told = forksOf(book(scene("s1", "school", ["a"], { clock: [0, 0] }), scene("s2", "mall", ["a"], { clock: [2, 2] }), scene("s3", "dorm", ["a"], { clock: [1, 1] })));
  assert.deepEqual(told.strands.order, ["s1", "s3", "s2"]);
  assert.deepEqual([told.strands.handoffs.get("s2")![0].from, told.strands.handoffs.get("s3")![0].from, told.strands.continues.get("s2")], ["s3", "s1", "s3"]);
});

test("the envelope scale and the built world's tree change what is apart", () => {
  const script = () => book(scene("s1", "school", ["a", "b"]), scene("s2", "dorm", ["a"]), scene("s3", "school", ["b"]), scene("s4", "cafe", ["a"]), scene("s5", "school", ["b"]));
  assert.equal(forksOf(script()).strands.forks.length, 1);
  assert.equal(forksOf(script(), { envelope: "building" }).strands.forks.length, 2, "at the building scale the dorm is elsewhere");
  assert.equal(forksOf(script(), { envelope: "city" }).strands.forks.length, 1);
  assert.equal(forksOf(script(), { tree: { cafe: { parent: "south" } } }).strands.forks.length, 2, "the cafe is in the south district");
});

test("one stated time in two envelopes is a conflict to look at", () => {
  const at = { node: "t:y1:07-20:noon", stated: true };
  const { strands } = forksOf(book(scene("s1", "school", ["a"], { at }), scene("s2", "mall", ["a"], { at })));
  assert.deepEqual(strands.checks.filter((check) => check.kind === "conflict"), [{ kind: "conflict", sceneId: "s2", status: "one stated time in two envelopes", otherId: "s1", characterId: "a" }]);
});

test("the file keeps the old shape, and the per-fork timeline reads the same strands", () => {
  const script = book(scene("s1", "school", ["a", "b", "c"]), scene("s2", "mall", ["a"]), scene("s3", "dorm", ["b", "c"]), scene("s4", "school", ["a", "b", "c"]));
  const strands = groupStrands(script), file = strandsDocument(script, strands, "test");
  assert.deepEqual(file.scenes[1], { id: "s2", fork: "s2", layer: 1, lane: 1, continues: null, envelope: "south", entries: [{ person: "a", from: "s1", samePlace: false }] });
  assert.deepEqual(Object.keys(file.forks[0]).sort(), ["envelope", "from", "id", "open", "people", "scenes", "splitFrom", "to", "unites"]);
  const timeline = forkTimeline(script.scenes.map((entry, index) => ({ id: entry.id, index, placeId: entry.place, flashback: entry.clock === null, cast: entry.present })), strands);
  assert.deepEqual([...timeline.forkOf], [...strands.forkOf].sort((a, b) => strands.layer.get(a[0])! - strands.layer.get(b[0])!));
});

test("strands.envelope is a setting: a place scale, for a universe or a book", () => {
  assert.deepEqual(problemsOf("strands.envelope", "city", "book"), []);
  assert.match(problemsOf("strands.envelope", "village")[0], /place scale/);
  assert.match(problemsOf("strands.envelope", "street", "place")[0], /may not be set by a place/);
});
