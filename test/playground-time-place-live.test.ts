import { test } from "node:test";
import assert from "node:assert/strict";
import { followTarget, timePlaceEmergence, type TimePlaceProjection } from "../apps/playground/src/data/timePlace.js";

const projection = (times: { id: string; proposed?: boolean }[], places: { id: string; proposed?: boolean }[]): TimePlaceProjection => ({
  available: times.length > 0, scenes: [], characters: [], names: {},
  times: times.map((time, index) => ({ id: time.id, label: time.id, gloss: "", family: "time-of-day", role: "ADVANCE", flashback: false, flashbackProbability: 0, decidedBy: "jev", toldFromId: null, date: null, partOfDay: null, chapterIndex: 0, storyIndex: index, narrativeIndex: index, anchorSceneId: null, sceneIds: [], proposed: time.proposed })),
  places: places.map((place) => ({ id: place.id, label: place.id, sceneIds: [], statedScenes: 0, characterIds: [], proposed: place.proposed })),
});

test("new or newly confirmed periods and places count as emerged; unchanged ones do not", () => {
  const before = projection([{ id: "t1" }, { id: "t2", proposed: true }], [{ id: "p1", proposed: true }]);
  const after = projection([{ id: "t1" }, { id: "t2" }, { id: "t3", proposed: true }], [{ id: "p1", proposed: true }, { id: "p2" }]);
  assert.deepEqual(timePlaceEmergence(before, after), { times: ["t2", "t3"], places: ["p2"] });
  assert.deepEqual(timePlaceEmergence(null, after), { times: [], places: [] }, "the first snapshot is not a live change");
});

test("following Pi: periods, then places, then the time-place run, then other work", () => {
  assert.equal(followTarget({ times: ["t"], places: ["p"] }, null, true), "story");
  assert.equal(followTarget({ times: [], places: ["p"] }, null, true), "places");
  assert.equal(followTarget({ times: [], places: [] }, { label: "novel timeplace run", status: "working" }, true), "story");
  assert.equal(followTarget({ times: [], places: [] }, { label: "novel timeplace run", status: "ok" }, true), "narrative");
  assert.equal(followTarget({ times: [], places: [] }, null, false), null);
});
