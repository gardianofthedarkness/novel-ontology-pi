import { test } from "node:test";
import assert from "node:assert/strict";
import { storyStrands } from "../apps/playground/src/data/storyStrands.js";
import type { StoryScene, TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";
import { forkTimeline, walkTimeline, type Mover, type Outcome, type TimelineScene } from "../src/digger/stage/environment.js";

// Invented, as in the story-strands test: Ming and Lan leave the station together (s1), then the story
// cuts between Ming at the port (m1, m2) and Lan at the hill (l1, l2) until they meet at the bridge (s6).
// A recap (fb) is told after s6; Ming stays on the bridge (s7).
const story = (id: string, index: number, characterIds: string[], placeIds: string[], flashback = false): StoryScene =>
  ({ id, index, chapterIndex: 0, label: id, times: [{ id: "t_day", via: index ? "inherited" : "anchor" }], flashback, placeIds, placeCarried: false, characterIds });
const data: TimePlaceProjection = {
  available: true,
  times: [{ id: "t_day", label: "that day", gloss: "day", family: "date", role: "ADVANCE", flashback: false, flashbackProbability: 0, decidedBy: "rule", toldFromId: null, date: null, partOfDay: null, chapterIndex: 0, storyIndex: 0, narrativeIndex: 0, anchorSceneId: "s1", sceneIds: [] } as never],
  scenes: [story("s1", 0, ["ming", "lan"], ["station"]), story("m1", 1, ["ming"], ["port"]), story("l1", 2, ["lan"], ["hill"]), story("m2", 3, ["ming"], ["port"]),
    story("l2", 4, ["lan"], ["hill"]), story("s6", 5, ["ming", "lan"], ["bridge"]), story("fb", 6, ["ming"], [], true), story("s7", 7, ["ming"], ["bridge"])],
  places: [], characters: [], names: {},
};
const scene = (id: string, index: number, placeId: string | null, cast: string[], events: [string, string[]][] = [], flashback = false): TimelineScene =>
  ({ id, index, placeId, flashback, cast, events: events.map(([eventId, actors]) => ({ id: eventId, actors })) });
const scenes = [scene("s1", 0, "station", ["ming", "lan"], [["e_s1", ["ming"]]]), scene("m1", 1, "port", ["ming"], [["e_m1", ["ming"]]]), scene("l1", 2, "hill", ["lan"], [["e_l1", ["lan"]]]),
  scene("m2", 3, "port", ["ming"]), scene("l2", 4, "hill", ["lan"]), scene("s6", 5, "bridge", ["ming", "lan"], [["e_s6", ["lan"]]]), scene("fb", 6, null, ["ming"], [], true), scene("s7", 7, "bridge", ["ming"], [["e_s7", ["ming"]]])];

/** Arrivals come in at the door; each turn follows the script, else stays; every turn is recorded. */
function scripted(script: Record<string, Outcome<string>>) {
  const turns: string[] = [], seeds = new Map<string, string>();
  const mover: Mover<string> = {
    start: ({ scene: at, carried }) => carried ?? (at.placeId ? `${at.placeId}:door` : null),
    act: ({ event, person, seed }) => { turns.push(`${event.id}:${person}`); seeds.set(`${event.id}:${person}`, seed); return script[`${event.id}:${person}`] ?? { kind: "stay" }; },
  };
  return { mover, turns, seeds };
}
const script: Record<string, Outcome<string>> = {
  "e_s1:lan": { kind: "with", leader: "ming" }, "e_m1:ming": { kind: "move", to: "port:pier" }, "e_l1:lan": { kind: "move", to: "hill:top" },
  "e_s6:lan": { kind: "move", to: "bridge:middle" }, "e_s6:ming": { kind: "with", leader: "lan" },
};

test("forks follow the strands; each person is handed along their own world line, a flashback hands nothing on", () => {
  const timeline = forkTimeline(scenes, storyStrands(data));
  const fork = (id: string) => timeline.forkOf.get(id)!;
  // Ming's and Lan's lines part after the station: one goes on in its fork, the other opens one that comes from it.
  assert.equal(new Set([fork("s1"), fork("m1"), fork("l1")]).size, 2);
  assert.equal(fork("m2"), fork("m1"));
  assert.equal(fork("l2"), fork("l1"));
  const side = timeline.forks.find((entry) => entry.id !== fork("s1") && [fork("m1"), fork("l1")].includes(entry.id))!;
  assert.ok(side.from.includes(fork("s1")) && timeline.forks.find((entry) => entry.id === fork("s1"))!.to.includes(side.id));
  const from = (id: string) => Object.fromEntries(timeline.handoffs.get(id)!.map((handoff) => [handoff.person, `${handoff.from}${handoff.samePlace ? " (here)" : ""}`]));
  assert.deepEqual(from("s1"), { ming: "null", lan: "null" });
  assert.deepEqual(from("m1"), { ming: "s1" });
  assert.deepEqual(from("m2"), { ming: "m1 (here)" });
  assert.deepEqual(from("s6"), { ming: "m2", lan: "l2" });
  assert.deepEqual(from("fb"), { ming: "null" });
  assert.deepEqual(from("s7"), { ming: "s6 (here)" });
});

test("the walk: positions carry over at one place, arrivals start afresh, everyone acts on their own, a follower goes where the leader goes", async () => {
  const timeline = forkTimeline(scenes, storyStrands(data));
  const { mover, turns } = scripted(script);
  const { scenes: runs, walked } = await walkTimeline(timeline, scenes, mover);
  assert.equal(walked, scenes.length);
  assert.deepEqual(runs.s1.ends, { ming: "station:door", lan: "station:door" }, "a follower of someone who stays stays");
  assert.equal(runs.m2.starts.ming, "port:pier");
  assert.equal(runs.l2.starts.lan, "hill:top");
  assert.deepEqual(runs.s6.starts, { ming: "bridge:door", lan: "bridge:door" });
  assert.deepEqual(runs.s6.ends, { ming: "bridge:middle", lan: "bridge:middle" });
  assert.equal(runs.fb.starts.ming, null);
  assert.equal(runs.s7.starts.ming, "bridge:middle", "the recap in between hands nothing on");
  // The event's actors act first; a scene holds only its own cast, never everyone seen at the place.
  assert.deepEqual(turns.filter((turn) => turn.startsWith("e_s6")), ["e_s6:lan", "e_s6:ming"]);
  assert.deepEqual(Object.keys(runs.s7.starts), ["ming"]);
  const ahead = scripted({ "e_s6:lan": { kind: "with", leader: "ming" } });
  await assert.rejects(walkTimeline(timeline, scenes, ahead.mover), /only go with someone already handled in e_s6/);
});

test("a later run walks only the scenes whose people's histories changed; seeds stay put", async () => {
  const timeline = forkTimeline(scenes, storyStrands(data));
  const first = scripted(script), again = scripted(script);
  const { scenes: runs } = await walkTimeline(timeline, scenes, first.mover);
  await walkTimeline(timeline, scenes, again.mover);
  assert.deepEqual([...again.seeds], [...first.seeds], "the same history samples with the same seeds");
  // A new event on Ming's port scene: his later scenes walk again, Lan's line and the recap do not.
  const changed = scenes.map((entry) => entry.id === "m2" ? scene("m2", 3, "port", ["ming"], [["e_m2", ["ming"]]]) : entry);
  const rerun = await walkTimeline(forkTimeline(changed, storyStrands(data)), changed, scripted(script).mover, { previous: runs });
  assert.equal(rerun.walked, 3);
  assert.equal(rerun.reused, 5);
  assert.equal(rerun.scenes.l2, runs.l2);
  assert.notEqual(rerun.scenes.s7.key, runs.s7.key);
  const other = await walkTimeline(timeline, scenes, scripted(script).mover, { previous: runs, version: "engine 2" });
  assert.equal(other.walked, scenes.length, "a new mover walks everything again");
});

test("forks that do not wait on each other walk side by side, within the concurrency", async () => {
  const timeline = forkTimeline(scenes, storyStrands(data));
  const peak = async (concurrency: number) => {
    let running = 0, most = 0;
    const mover: Mover<string> = {
      start: async () => { running++; most = Math.max(most, running); await new Promise((resolve) => setTimeout(resolve, 5)); running--; return null; },
      act: () => ({ kind: "stay" }),
    };
    await walkTimeline(timeline, scenes, mover, { concurrency });
    return most;
  };
  assert.ok(await peak(6) >= 2, "Ming's port and Lan's hill run together");
  assert.equal(await peak(1), 1);
});

test("the direction question: 14 cube directions, 4 direct ones held to evidence of a power, going with someone, or none", async () => {
  const { DIRECTION_OPTIONS, DIRECTION_VECTORS, directionQuestion, isDirect } = await import("../src/digger/stage/directions.js");
  assert.equal(DIRECTION_OPTIONS.length, 18);
  assert.equal(DIRECTION_OPTIONS.filter(isDirect).length, 4);
  assert.deepEqual(DIRECTION_VECTORS["up-right-away"], [1, -1, 1]);
  const question = directionQuestion("dir_1", "食蜂操祈", ["御坂美琴"]);
  assert.deepEqual(question.options!.slice(-2), ["with:御坂美琴", "none"]);
  assert.match(question.instructions, /direct-\* direction only when the text directly says or shows that 食蜂操祈 uses a superhuman ability/);
});
