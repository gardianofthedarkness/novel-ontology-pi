// Strands by interaction (src/reading/strands.ts groupStrands; docs/v3/design.html#strands §0; milestones M17e; the user,
// 2026-11-09: "As long as the group splits on different things and no longer interact with each other on semantic scale,
// they become two strands. When they reunited the strands become one. Whether scale is building street what ever depends
// on the context"). A scene's group is whom it has acting; a split is part of a group acting while the rest next appears
// out of its view; a union is an interaction between strands; a strand lands only if its group has a dialogue or an
// action in its next segment; a union stands only if the next action keeps them together.
import assert from "node:assert/strict";
import { test } from "node:test";
import { builtTree, groupStrands, placeTree, strandBeats, strandsDocument, type GroupOptions, type StrandBeats } from "../../src/reading/strands.js";
import { forkTimeline } from "../../src/play/stage/environment.js";
import type { ReadingScript, ScriptScene } from "../../src/reading/script.js";

const places: ReadingScript["places"] = {
  city: { label: "city", scale: "city", parent: null }, port: { label: "port", scale: "city", parent: null },
  north: { label: "north", scale: "district", parent: "city" }, south: { label: "south", scale: "district", parent: "city" },
  school: { label: "school", scale: "building", parent: "north" }, dorm: { label: "dorm", scale: "building", parent: "north" },
  mall: { label: "mall", scale: "building", parent: "south" }, cafe: { label: "cafe", scale: "building", parent: null },
  pier: { label: "pier", scale: "street", parent: "port" },
};
type Scene = ScriptScene & { evidence?: string[] };
let clock = 0;
/** A scene: who acts in it (`evidence`), who is in view besides (`present`). */
const scene = (id: string, place: string | null, acting: string[], extra: Partial<Scene> = {}): Scene => ({ id, chapter: 0, place, placeBy: "environment", clock: [clock, clock++], evidence: acting, present: [...acting, ...((extra.present as string[] | undefined) ?? [])], stayed: [], firstSeen: [], timeline: [], ...extra, ...(extra.present ? { present: [...acting, ...extra.present] } : {}) });
/** The scenes in story order as given (a flashback keeps no clock). */
const book = (...scenes: Scene[]): ReadingScript => ({ version: 2, from: "v2-reading", places, scenes: scenes.map((entry, n) => (entry.clock === null ? entry : { ...entry, clock: [n, n] })) });
/** Each scene acting together and with a beat of its people, unless told otherwise. */
const beatsOf = (script: ReadingScript, given: Record<string, StrandBeats> = {}): Record<string, StrandBeats> => Object.fromEntries((script.scenes as Scene[]).map((entry) => [entry.id, given[entry.id] ?? { links: entry.evidence!.length > 1 ? [entry.evidence!] : [], beats: entry.evidence!.length ? [entry.evidence!] : [] }]));
const strandsOf = (script: ReadingScript, given: Record<string, StrandBeats> = {}, options: GroupOptions = {}) => {
  const strands = groupStrands(script, { beats: beatsOf(script, given), ...options });
  return { strands, forks: Object.fromEntries(strands.forks.map((fork) => [fork.id, fork])), of: (id: string) => strands.forkOf.get(id), count: (kind: string) => strands.checks.filter((check) => check.kind === kind).length };
};
// a and b act together; a goes off while b is told elsewhere; they meet again.
const apart = (...more: Scene[]) => book(scene("s1", "school", ["a", "b"]), scene("s2", "school", ["a"]), scene("s3", "dorm", ["b"]), scene("s4", "school", ["a"]), ...more);

test("a split: part of a group acts while the rest is next told out of its view, in any place, at any scale", () => {
  const { forks, of, count } = strandsOf(apart(scene("s5", "school", ["a", "b"])));
  assert.deepEqual([of("s1"), of("s2"), of("s3"), of("s4"), of("s5")], ["s1", "s2", "s1", "s2", "s1"]);
  assert.deepEqual([forks.s2.splitFrom, forks.s2.into, forks.s2.intoAt, forks.s1.unites, forks.s1.open], [["s1"], "s1", "s5", ["s2"], true]);
  assert.deepEqual([count("split"), count("union")], [1, 1]);
  assert.equal(forks.s2.envelope, "school", "its area is read from its scenes: one building here");
  assert.equal(forks.s1.envelope, "north", "the school and the dorm are in the north");
});

test("held in view is not apart: a split needs the rest out of view of the people here", () => {
  const held = strandsOf(book(scene("s1", "school", ["a", "b"]), scene("s2", "school", ["a"], { present: ["b"] }), scene("s3", "school", ["b"]), scene("s4", "school", ["a"])));
  assert.equal(held.strands.forks.length, 1, "b is in view while a acts");
  const seen = strandsOf(book(scene("s1", "school", ["a", "b"]), scene("s2", "school", ["a"]), scene("s3", "school", ["c"], { present: ["a", "b"] }), scene("s4", "school", ["a"])));
  assert.equal(seen.strands.forks.length, 1, "the rest's next appearance has a in view: they are together");
});

test("latency: a strand lands only if its group has a dialogue or an action in its next segment", () => {
  const short = strandsOf(book(scene("s1", "school", ["a", "b"]), scene("s2", "school", ["a"]), scene("s3", "dorm", ["b"]), scene("s5", "school", ["a", "b"])));
  assert.equal(short.strands.forks.length, 1, "a apart for one scene folds back");
  assert.deepEqual(short.strands.checks.filter((check) => check.kind === "folded").map((check) => [check.sceneId, check.otherId]), [["s2", "s1"]]);
  const quiet = strandsOf(apart(scene("s5", "school", ["a", "b"])), { s4: { links: [], beats: [] } });
  assert.equal(quiet.strands.forks.length, 1, "its next segment has no dialogue or action of theirs");
});

test("a union is an interaction: acting side by side with none stays apart; without beats acting together is one", () => {
  const beside = strandsOf(apart(scene("s5", "school", ["a", "b"]), scene("s6", "school", ["a"]), scene("s7", "dorm", ["b"])), { s5: { links: [], beats: [["a"], ["b"]] } });
  assert.deepEqual([beside.of("s5"), beside.forks.s2.open, beside.count("beside"), beside.count("union")], ["s2", true, 1, 0]);
  const plain = groupStrands(apart(scene("s5", "school", ["a", "b"])));
  assert.deepEqual(plain.forks.map((fork) => fork.id), ["s1", "s2"], "no beats: everyone acting in one scene is linked");
});

test("an action aimed at someone there is an interaction: the one aimed at takes part", () => {
  const aimed = strandsOf(apart(scene("s5", "school", ["a"], { present: ["b"] }), scene("s6", "school", ["a", "b"])), { s5: { links: [["a", "b"]], beats: [["a"]], aimed: ["b"] } });
  assert.deepEqual([aimed.forks.s2.intoAt, aimed.of("s5")], ["s5", "s1"]);
});

test("a union is refused only when both sides leave it at once", () => {
  const met = apart(scene("s5", "school", ["a", "b"]), scene("s6", "mall", ["a"]), scene("s7", "dorm", ["b"]), scene("s8", "mall", ["a"]));
  const { strands, forks, of } = strandsOf(met);
  assert.deepEqual(strands.checks.filter((check) => check.kind === "refused").map((check) => check.sceneId), ["s5"]);
  assert.deepEqual([forks.s2.open, of("s6"), of("s8")], [true, "s2", "s2"], "each went straight back to their own: the meeting did not hold");
  const stayed = strandsOf(apart(scene("s5", "school", ["a", "b"]), scene("s6", "mall", ["a"]), scene("s7", "mall", ["a"])));
  assert.deepEqual([stayed.count("refused"), stayed.forks.s2.intoAt], [0, "s5"], "b is not told again: nothing says they parted");
});

test("the strand begun first keeps its id at a union", () => {
  const { forks } = strandsOf(book(scene("s1", "school", ["a"]), scene("s2", "mall", ["b"]), scene("s3", "mall", ["b"]), scene("s4", "school", ["a"]), scene("s5", "mall", ["b"]), scene("s6", "mall", ["a", "b"]), scene("s7", "mall", ["a", "b"])));
  assert.deepEqual([forks.s2.into, forks.s1.open], ["s1", true], "s2 had more scenes, s1 began first");
});

test("the past is a closed strand of its own; a strand of nobody folds into the first strand of someone", () => {
  const past = strandsOf(book(scene("s0", "school", []), scene("s1", "school", ["a"]), scene("s2", "mall", ["a", "z"], { clock: null }), scene("s3", "school", ["a"])));
  assert.deepEqual([past.of("s0"), past.of("s2"), past.forks.s2.past, past.forks.s2.open, past.of("s3")], ["s1", "s2", true, false, "s1"]);
  assert.deepEqual(past.strands.handoffs.get("s2"), [{ person: "a", from: null, samePlace: false }, { person: "z", from: null, samePlace: false }]);
});

test("one stated time in two places apart is a conflict to look at", () => {
  const at = { node: "t:y1:07-20:noon", stated: true };
  const { strands } = strandsOf(book(scene("s1", "school", ["a"], { at }), scene("s2", "mall", ["a"], { at })));
  assert.deepEqual(strands.checks.filter((check) => check.kind === "conflict"), [{ kind: "conflict", sceneId: "s2", status: "one stated time in two places apart", otherId: "s1", characterId: "a" }]);
});

test("the place tree: inside, apart only on evidence, and the smallest place holding several", () => {
  const { apart: isApart, holding, within } = placeTree(places, { tree: { cafe: { parent: "south" } } });
  assert.deepEqual([within("school", "city"), isApart("school", "mall"), isApart("school", "north"), isApart("school", "pier"), isApart("cafe", "south")], [true, true, false, true, false]);
  assert.deepEqual([holding(["school", "dorm"]), holding(["school", "cafe"]), holding(["school", null]), holding(["school", "pier"]), holding([])], ["north", "city", "school", null, null]);
});

test("the beats of a reading: conversations, actions, events and actions aimed at someone there", () => {
  const units = [{ id: "u1", sentences: ["l1", "l2", "l3"] }, { id: "u2", sentences: ["l4"] }];
  const cards = [
    { id: "dialogue:l1", kind: "dialogue", first: "l1", sentences: ["l1", "l2"], inside: ["action:l2"], people: [{ id: "a", how: ["speaks"], at: ["l1"] }, { id: "b", how: ["addressed"], at: ["l1"] }, { id: "loc_1", how: ["acts"], at: ["l1"] }] },
    { id: "action:l2", kind: "action", first: "l2", sentences: ["l2"], people: [{ id: "a", how: ["acts"], at: ["l2"] }, { id: "b", how: ["acts"], at: ["l2"] }] },
    { id: "action:l3", kind: "action", first: "l3", sentences: ["l3"], people: [{ id: "c", how: ["acts"], at: ["l3"] }, { id: "a", how: ["named"], at: ["l3"] }, { id: "z", how: ["named"], at: ["l3"] }] },
    { id: "thought:l4", kind: "thought", first: "l4", sentences: ["l4"], people: [{ id: "a", how: ["acts"], at: ["l4"] }] },
  ];
  const roles = { l3: { kind: "action", who: { id: "c" } } };
  const script = { scenes: [scene("u1", "school", ["a", "b", "c"], { timeline: [{ type: "event", id: "e1", actors: ["b", "c", "loc_1"] }] }), scene("u2", "school", ["a"])] };
  const beats = strandBeats(cards, roles, units, script);
  assert.deepEqual(beats.u1.links, [["a", "b"], ["a", "b"], ["c", "a"], ["b", "c"]], "a place credited with acting takes part in nothing");
  assert.deepEqual(beats.u1.beats, [["a", "b"], ["c"]], "a conversation is one beat, an action inside it none of its own");
  assert.deepEqual(beats.u1.aimed, ["a"], "z is named but not there");
  assert.equal(beats.u2, undefined, "a thought is no beat");
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
});

test("the file keeps its shape, and the per-fork timeline reads the same strands", () => {
  const script = apart(scene("s5", "school", ["a", "b"]));
  const strands = groupStrands(script, { beats: beatsOf(script) }), file = strandsDocument(script, strands, "test");
  assert.deepEqual([file.version, file.envelope], [2, "context"]);
  assert.deepEqual(file.scenes[1], { id: "s2", fork: "s2", layer: 1, lane: 1, continues: null, envelope: "school", entries: [{ person: "a", from: "s1", samePlace: true }] });
  assert.deepEqual(Object.keys(file.forks[1]).sort(), ["envelope", "from", "id", "into", "intoAt", "open", "people", "scenes", "splitFrom", "to", "unites"]);
  const timeline = forkTimeline(script.scenes.map((entry, index) => ({ id: entry.id, index, placeId: entry.place, flashback: entry.clock === null, cast: entry.present })), strands);
  assert.deepEqual([...timeline.forkOf], [...strands.forkOf].sort((a, b) => strands.layer.get(a[0])! - strands.layer.get(b[0])!));
});
