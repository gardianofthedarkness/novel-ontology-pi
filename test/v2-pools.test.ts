import assert from "node:assert/strict";
import { test } from "node:test";
import { addUnit, centralBuild, dwellingFor, emptyCanvas, holderFor, POOL_SPACING } from "../src/ground/stage/placeCanvas.js";
import { emptyRegistry, evenPick, withPools } from "../src/v2/pools.js";
import type { ReadingScript } from "../src/v2/script.js";

const script = (): ReadingScript => ({
  version: 2, from: "v2-reading", scenes: [],
  places: {
    city: { label: "City", scale: "city", parent: null },
    d7: { label: "District Seven", scale: "district", parent: "city" },
    d6: { label: "District Six", scale: "district", parent: "city" },
    school: { label: "School", scale: "building", parent: "d7" },
    lonely: { label: "Lonely Tower", scale: "building", parent: null, near: "d7", nears: ["d7", "d6"] },
    "unnamed:a": { label: "a tower (scene 1)", scale: "building", parent: "city", unnamed: true, held: "setting", scene: "s1" },
    "unnamed:b": { label: "an alley (scene 2)", scale: "street", parent: "d7", unnamed: true, held: "stated", scene: "s2" },
    "unnamed:c": { label: "a room (scene 2)", scale: "room", parent: "school", unnamed: true, held: "stated", scene: "s2" },
  },
});

test("sampling pools: every nominated area has one a level below; what is not nominated stands in it; the even picks are kept; the universe keeps them across books", () => {
  const first = withPools(script(), emptyRegistry(), "vol-1"), places = first.script.places;
  assert.deepEqual([places["pool:City"], places["pool:District Seven"].scale], [{ label: "City · pool", scale: "district", parent: "city", pool: "city" }, "street"]);
  assert.equal(places["unnamed:a"].parent, "pool:City", "an unnamed place the text puts only in the city: the city's pool");
  assert.equal(places["unnamed:b"].parent, "pool:District Seven", "a pool holds its own scale: an alley in the district's pool street");
  assert.equal(places["unnamed:c"].parent, "school", "held by a building: stays");
  assert.equal(places.school.parent, "d7", "a named building the tree puts somewhere is nominated: stays");
  assert.deepEqual([places.lonely.pools, places.lonely.near], [["pool:District Seven", "pool:District Six"], first.registry.picks["vol-1"].lonely], "two areas, even chances, one pick");
  assert.deepEqual(first.registry.pools["pool:City"].members["vol-1"].map((member) => member.id), ["unnamed:a"]);
  // Even: over many seeds, the two pools each take about half.
  const share = Array.from({ length: 400 }, (_, n) => evenPick(`vol-1:thing${n}`, ["p1", "p2"])).filter((pool) => pool === "p1").length / 400;
  assert.ok(share > 0.4 && share < 0.6, `even chances: ${share}`);
  // Kept: a pick made once stands, whatever the seed says now.
  const forced = { ...first.registry, picks: { "vol-1": { lonely: "pool:District Six" } } };
  assert.equal(withPools(script(), forced, "vol-1").script.places.lonely.near, "pool:District Six");
  // Another book of the universe: the pools are kept; vol 1's members stand in them as markers, before vol 2's own.
  const second = withPools(script(), first.registry, "vol-2"), order = Object.keys(second.script.places);
  assert.deepEqual(Object.keys(second.registry.pools["pool:City"].members), ["vol-1", "vol-2"]);
  assert.ok(order.indexOf("elsewhere:vol-1/unnamed:a") < order.indexOf("unnamed:a") && second.script.places["elsewhere:vol-1/unnamed:a"].parent === "pool:City");
});

test("a pool on the canvas: what a city holds goes into its pool, not a random district; its members kept apart; it grows; a thing the tree puts nowhere goes to a pool", () => {
  const canvas = emptyCanvas();
  centralBuild(canvas, [
    { id: "city", label: "City", scale: "city", parent: null, landscape: "residential" },
    { id: "d7", label: "District Seven", scale: "district", parent: "city", landscape: "residential" },
    { id: "pool:City", label: "City · pool", scale: "district", parent: "city", landscape: "residential", pool: "city" },
  ]);
  assert.equal(holderFor(canvas, "city", "building", "unnamed:a"), "pool:City");
  const before = canvas.places["pool:City"].r;
  for (let n = 0; n < 80; n++) addUnit(canvas, "pool:City", { id: `b${n}`, label: `b${n}`, kind: "building", r: 12 });
  const units = canvas.places["pool:City"].units, gaps = units.flatMap((a, i) => units.slice(i + 1).map((b) => Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) - a.r - b.r));
  assert.ok(Math.min(...gaps) >= POOL_SPACING.building - 0.5, `members apart: ${Math.min(...gaps).toFixed(1)} m`);
  assert.ok(canvas.places["pool:City"].r > before, `the pool grew to hold them: ${before} m, then ${canvas.places["pool:City"].r} m`);
  assert.equal(dwellingFor(canvas, "nowhere"), "pool:City");
});
