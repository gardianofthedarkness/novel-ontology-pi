import assert from "node:assert/strict";
import { test } from "node:test";
import { addUnit, centralBuild, dwellInGround, dwellInStreets, dwellingFor, emptyCanvas, holderFor, POOL_SPACING, tiedSpot } from "../src/v2/world/placeCanvas.js";
import { buildingUseOf } from "../src/v2/rules/language.js";
import { continuityTies, emptyRegistry, evenPick, withPools } from "../src/v2/extraction/pools.js";
import type { ReadingScript } from "../src/v2/extraction/script.js";

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

test("continuity ties places: once for each character going from the one's scene to the other's, and for each character in one scene set in both", () => {
  const scene = (id: string, place: string | null, present: string[]) => ({ id, chapter: 0, place, placeBy: "named" as const, clock: null, present, stayed: [], firstSeen: [], timeline: [] });
  const ties = continuityTies({
    version: 2, from: "v2-reading",
    places: {
      city: { label: "City", scale: "city", parent: null },
      "unnamed:alley": { label: "alley", scale: "street", parent: "pool:City", unnamed: true, held: "setting", scene: "s1" },
      "unnamed:square": { label: "square", scale: "street", parent: "pool:City", unnamed: true, held: "setting", scene: "s2" },
      "unnamed:hall": { label: "hall", scale: "building", parent: "pool:City", unnamed: true, held: "setting", scene: "s2" },
      "unnamed:pier": { label: "pier", scale: "street", parent: "pool:City", unnamed: true, held: "setting", scene: "s4" },
    },
    scenes: [scene("s1", "city", ["kamijou", "index"]), scene("s2", "city", ["kamijou"]), scene("s3", null, ["misaka"]), scene("s4", "city", ["misaka"])],
  });
  assert.equal(ties["unnamed:alley"]["unnamed:square"], 1, "kamijou goes from the alley's scene to the square's");
  assert.equal(ties["unnamed:square"]["unnamed:alley"], 1, "symmetric");
  assert.equal(ties["unnamed:square"]["unnamed:hall"], 1, "one character in a scene set in both");
  assert.equal(ties["unnamed:alley"]["unnamed:pier"], undefined, "no character goes between them");
  assert.equal(ties["unnamed:alley"].city, 3, "both characters in one scene set in both, and kamijou going on to the city's next");
});

test("a pool samples a member nearest the members continuity ties it to, the more ties the nearer; one tied to none, nearest the middle", () => {
  const canvas = emptyCanvas();
  centralBuild(canvas, [
    { id: "city", label: "City", scale: "city", parent: null, landscape: "residential" },
    { id: "pool:City", label: "City · pool", scale: "district", parent: "city", landscape: "residential", pool: "city" },
  ]);
  addUnit(canvas, "pool:City", { id: "east", label: "east", kind: "street", r: 30, at: [400, 0] });
  addUnit(canvas, "pool:City", { id: "west", label: "west", kind: "street", r: 30, at: [-400, 0] });
  const member = { id: "m", kind: "street" as const, r: 30 };
  assert.equal(tiedSpot(canvas, "pool:City", member, undefined), undefined, "tied to none: the pool's middle, as before");
  const east = tiedSpot(canvas, "pool:City", member, { east: 3 })!, d = (at: number[], x: number) => Math.hypot(at[0] - x, at[1]);
  assert.ok(d(east, 400) < 30 + 30 + POOL_SPACING.street + 8, `right beside the one it is tied to: ${east}`);
  assert.ok(d(east, 400) >= 30 + 30 + POOL_SPACING.street - 0.5, "kept apart as any member");
  const leaning = tiedSpot(canvas, "pool:City", member, { east: 3, west: 1 })!;
  assert.ok(d(leaning, 400) < d(leaning, -400), `nearer the one with more ties: ${leaning}`);
});

test("a pool's building tied to one of its streets dwells in that street's building of its use; one of a use the street lacks is left for Jev; one tied to none stays", () => {
  const canvas = emptyCanvas();
  centralBuild(canvas, [
    { id: "city", label: "City", scale: "city", parent: null, landscape: "residential" },
    { id: "pool:City", label: "City · pool", scale: "district", parent: "city", landscape: "residential", pool: "city" },
  ]);
  for (const id of ["street", "cafe", "hospital", "lonely"]) addUnit(canvas, "pool:City", { id, label: { street: "大道", cafe: "西点屋", hospital: "医院", lonely: "咖啡店" }[id]!, kind: id === "street" ? "street" : "building", r: 12 });
  const building = (lot: string, use: string, x: number) => ({ lot: `street:${lot}`, x, z: 40, w: 10, d: 12, angle: 0, floors: 3, kind: "shop", use });
  const streets = new Map([["street", [building("row0", "cafe", 100), building("row1", "shop", 120), building("row2", "cafe", 140)]]]);
  const ties = { cafe: { street: 2 }, street: { cafe: 2, hospital: 1 }, hospital: { street: 1 } };
  const { dwells, forJev } = dwellInStreets(canvas.places["pool:City"], streets, ties, (unit) => buildingUseOf(unit.label));
  const cafe = canvas.places["pool:City"].units.find((unit) => unit.id === "cafe")!;
  assert.deepEqual(dwells, { cafe: "street" });
  assert.ok([100, 140].includes(cafe.at[0]) && cafe.at[1] === 40, `in one of the street's cafés: ${cafe.at}`);
  assert.deepEqual(forJev, ["hospital"], "a hospital on a street with none: for Jev");
  assert.equal(canvas.places["pool:City"].units.find((unit) => unit.id === "lonely")!.dwells, undefined, "tied to no street: stays");
  assert.deepEqual(["便利店 (scene 3)", "高层公寓", "检察厅", "地铁站", "办公大楼", "研究所", "神社"].map((label) => buildingUseOf(label)), ["convenience", "apartment", "government", "station", "office", "lab", null]);
});

test("what is there first: a building dwells in the nearest building its place's ground made of its use, the scarcest uses first; the rest for Jev", () => {
  const canvas = emptyCanvas();
  centralBuild(canvas, [{ id: "district", label: "District", scale: "district", parent: null, landscape: "skyscrapers" }]);
  for (const [id, label, at] of [["cafe", "咖啡店", [0, 0]], ["office", "办公大楼", [500, 0]], ["school", "学校", [0, 0]], ["bank", "银行", [0, 0]]] as const) addUnit(canvas, "district", { id, label, kind: "building", r: 12, at: [at[0], at[1]] });
  const made = [
    { lot: "a", x: 10, z: 0, w: 10, d: 10, angle: 0, floors: 3, kind: "shop", use: "cafe" },
    { lot: "b", x: 400, z: 0, w: 30, d: 30, angle: 0, floors: 30, kind: "tower", use: "office" },
    { lot: "c", x: 900, z: 0, w: 30, d: 30, angle: 0, floors: 30, kind: "tower", use: "office" },
    { lot: "d", x: 50, z: 0, w: 40, d: 30, angle: 0, floors: 4, kind: "school", use: "school" },
  ];
  const { dwells, forJev } = dwellInGround(canvas.places.district, made, (unit) => buildingUseOf(unit.label));
  const at = (id: string) => canvas.places.district.units.find((unit) => unit.id === id)!.at;
  assert.deepEqual(Object.keys(dwells).sort(), ["cafe", "office", "school"]);
  assert.deepEqual(at("office"), [400, 0], "the nearest office of the two");
  assert.deepEqual(at("cafe"), [10, 0]);
  assert.deepEqual(forJev, ["bank"], "no bank in the ground: for Jev");
});
