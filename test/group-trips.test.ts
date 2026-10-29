import { test } from "node:test";
import assert from "node:assert/strict";
import { groupTrips, type TripStory } from "../src/digger/timeplace/trips.js";

const scene = (id: string, index: number, place: string, cast: string[], extra: Partial<TripStory["scenes"][number]> = {}): TripStory["scenes"][number] => ({ id, index, flashback: false, placeIds: [place], placeCarried: false, characterIds: cast, ...extra });
const story = (scenes: TripStory["scenes"]): TripStory => ({ scenes,
  places: [{ id: "city", path: ["city"] }, { id: "d7", path: ["city", "d7"] }, { id: "tower", path: ["tower"] }, { id: "station", path: ["station"] }, { id: "station2", path: ["station2"] }],
  names: { city: "学园都市", d7: "第七学区", tower: "钟塔", station: "车站", station2: "车站" } });

test("a group trip is two or more people arriving together from one scene at another place", () => {
  const trips = groupTrips(story([scene("s1", 0, "tower", ["a", "b", "c"]), scene("s2", 1, "station", ["a", "b"]), scene("s3", 2, "tower", ["c"])]),
    { events: [{ eventType: "movement", primaryActors: ["b"], sceneId: "s2" }] });
  assert.deepEqual(trips, [{ from: "s1", to: "s2", people: ["a", "b"], fromPlace: "tower", toPlace: "station", guessed: false, nested: false, backed: true }], "c stays: one person at the same place is no trip");
});

test("not a trip: alone, a flashback, two places of one name; a borrowed place is a guess, a place inside the other is marked", () => {
  assert.equal(groupTrips(story([scene("s1", 0, "tower", ["a", "b"]), scene("s2", 1, "station", ["a"]), scene("s3", 2, "station", ["b"])])).length, 0, "they arrive one at a time");
  assert.equal(groupTrips(story([scene("s1", 0, "tower", ["a", "b"]), scene("s2", 1, "station", ["a", "b"], { flashback: true })])).length, 0, "a flashback hands nothing on");
  assert.deepEqual(groupTrips(story([scene("s1", 0, "city", ["a", "b"]), scene("s2", 1, "d7", ["a", "b"])])).map((trip) => trip.nested), [true], "the city's district may only name the place more closely");
  assert.equal(groupTrips(story([scene("s1", 0, "station", ["a", "b"]), scene("s2", 1, "station2", ["a", "b"])])).length, 0, "two places of one name");
  // A flashback in between does not break the world line, and the strands' answered cast decides who is there.
  const trips = groupTrips(story([scene("s1", 0, "tower", ["a"]), scene("fb", 1, "city", ["a", "b"], { flashback: true }), scene("s2", 2, "station", ["x"], { placeCarried: true })]), { presence: new Map([["s1", ["a", "b"]], ["s2", ["a", "b"]]]) });
  assert.deepEqual(trips.map((trip) => [trip.from, trip.to, trip.guessed, trip.backed]), [["s1", "s2", true, false]]);
  assert.equal(groupTrips(story([scene("s1", 0, "tower", ["a", "b"]), scene("s2", 1, "station", ["a", "b"])]), { onStrands: (id) => id !== "s2" }).length, 0, "both scenes must be on the strands");
});
