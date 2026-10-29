import { test } from "node:test";
import assert from "node:assert/strict";
import { addPart, addUnit, adopt, bear, bearChain, emptyCanvas, holderFor, LEAST, worldOf, type Canvas } from "../src/ground/stage/placeCanvas.js";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Every child circle lies inside its parent's, and no two siblings overlap. */
function assertNested(canvas: Canvas) {
  const places = Object.values(canvas.places);
  for (const place of places) {
    if (!place.parent) continue;
    const parent = canvas.places[place.parent];
    assert.ok(Math.hypot(...place.at) + place.r <= parent.r + 1e-6, `${place.label} inside ${parent.label}`);
    for (const other of places) if (other.parent === place.parent && other.id < place.id) assert.ok(Math.hypot(place.at[0] - other.at[0], place.at[1] - other.at[1]) >= place.r + other.r - 1e-6, `${place.label} and ${other.label} apart`);
  }
}
// An invented story: a tower in a street of the seventh ward of a city, then more.
const city = { id: "c", label: "City", scale: "city", landscape: "skyscrapers" as const }, ward = { id: "w7", label: "Ward 7", scale: "district", landscape: "residential" as const }, street = { id: "s", label: "Long Street", scale: "street" };

test("a building known to belong to a street of a ward of a city brings each of them into being around it, smallest last, each a circle of its own", () => {
  const canvas = bearChain(emptyCanvas(), [city, ward, street]);
  addUnit(canvas, "s", { id: "tower", label: "Tower", kind: "building", r: 14 });
  assert.deepEqual(Object.values(canvas.places).map((place) => [place.label, place.parent]), [["City", null], ["Ward 7", "c"], ["Long Street", "w7"]]);
  assertNested(canvas);
  assert.ok(canvas.places.s.r >= LEAST.street && canvas.places.w7.r > canvas.places.s.r && canvas.places.c.r > canvas.places.w7.r, "each larger than what it holds");
  assert.ok(Math.hypot(...canvas.places.w7.at) > 0, "the ward is born beside the city's own ground, not on it");
});

test("circles grow as things are built inside them, and the growth carries up to the city", () => {
  const canvas = bearChain(emptyCanvas(), [city, ward, street]);
  const before = { s: canvas.places.s.r, w7: canvas.places.w7.r, c: canvas.places.c.r };
  for (let n = 0; n < 8; n++) addUnit(canvas, "s", { id: `shop${n}`, label: `Shop ${n}`, kind: "building", r: 12 });
  assert.ok(canvas.places.s.r > before.s && canvas.places.w7.r > before.w7 && canvas.places.c.r > before.c, `street ${before.s} → ${canvas.places.s.r} m, ward ${before.w7} → ${canvas.places.w7.r} m, city ${before.c} → ${canvas.places.c.r} m`);
  addPart(canvas, "w7", "commercial", [300, 0], { by: "drift" });
  assert.ok(canvas.places.w7.landscape!.patches.length === 2, "a new part where a scene drifted");
  assertNested(canvas);
});

test("a growing circle pushes its neighbours aside whole (and moves itself off its parent's own ground): nothing inside any place moves in its own frame", () => {
  // A city with no ground of its own here, so the wards only meet one another.
  const canvas = bearChain(emptyCanvas(), [{ ...city, landscape: null }, ward]);
  for (const [id, label] of [["w8", "Ward 8"], ["w6", "Ward 6"], ["w23", "Ward 23"]]) bear(canvas, { id, label, scale: "district", parent: "c", landscape: "village" });
  addUnit(canvas, "w8", { id: "inn", label: "Inn", kind: "building", r: 10 });
  const inside = JSON.stringify(Object.values(canvas.places).map((place) => [place.id, place.landscape, place.units])), before = Object.fromEntries(Object.values(canvas.places).map((place) => [place.id, place.at]));
  for (let n = 0; n < 6; n++) addPart(canvas, "w7", "residential", [Math.cos(n) * 400, Math.sin(n) * 400]);
  assertNested(canvas);
  assert.ok(["w8", "w6", "w23"].some((id) => !same(canvas.places[id].at, before[id])), "a neighbour was pushed aside");
  const after = JSON.parse(JSON.stringify(Object.values(canvas.places).map((place) => [place.id, place.id === "w7" ? null : place.landscape, place.units])));
  assert.ok(same(after.filter(([id]: [string]) => id !== "w7"), JSON.parse(inside).filter(([id]: [string]) => id !== "w7")), "every other place's ground and buildings are unchanged in its own frame");
  assert.ok(Math.hypot(...worldOf(canvas, "w8")) > 0);
});

test("the same story builds the same canvas", () => {
  const build = () => { const canvas = bearChain(emptyCanvas(), [city, ward, street]); addUnit(canvas, "s", { id: "tower", label: "Tower", kind: "building", r: 14 }); bear(canvas, { id: "w8", label: "Ward 8", scale: "district", parent: "c", landscape: "industrial" }); addPart(canvas, "w7", "commercial", [200, 50]); return canvas; };
  assert.ok(same(build(), build()));
});

test("a ward growing into its city's own ground moves off it, whole, rather than covering it", () => {
  const canvas = bearChain(emptyCanvas(), [city, ward]), core = canvas.places.c.landscape!;
  for (let n = 0; n < 4; n++) addPart(canvas, "w7", "residential", [Math.cos(n * 1.7) * 300, Math.sin(n * 1.7) * 300]);
  assertNested(canvas);
  assert.ok(same(canvas.places.c.landscape, core), "the city's own ground is where it was");
  const fromCore = Math.hypot(...canvas.places.w7.at);
  assert.ok(fromCore >= canvas.places.w7.r, `the ward clears the city's middle (${Math.round(fromCore)} m off, radius ${canvas.places.w7.r} m)`);
});

test("places at the top of the canvas (two cities, an unplaced street) are born beside one another and pushed aside as they grow", () => {
  const canvas = bearChain(emptyCanvas(), [city, ward]);
  bear(canvas, { id: "c2", label: "Other City", scale: "city", parent: null, landscape: "castle" });
  bear(canvas, { id: "tunnel", label: "Tunnel", scale: "street", parent: null, landscape: "industrial" });
  for (let n = 0; n < 4; n++) addPart(canvas, "c", "residential", [Math.cos(n * 1.6) * 500, Math.sin(n * 1.6) * 500]);
  const tops = Object.values(canvas.places).filter((place) => !place.parent);
  for (const a of tops) for (const b of tops) if (a.id < b.id) assert.ok(Math.hypot(a.at[0] - b.at[0], a.at[1] - b.at[1]) >= a.r + b.r - 1e-6, `${a.label} and ${b.label} apart`);
  assertNested(canvas);
});

test("a building known only to lie somewhere in a city gets an unnamed temporary area; when the text names that area, the temporary one becomes it", () => {
  const canvas = bearChain(emptyCanvas(), [city]);
  const holder = holderFor(canvas, "c", "building", "lab");
  assert.ok(holder.startsWith("tmp:") && canvas.places[holder].temporary && canvas.places[holder].scale === "district" && canvas.places[holder].parent === "c", "an unnamed district of the city");
  addUnit(canvas, holder, { id: "lab", label: "Lab", kind: "building", r: 18 });
  assertNested(canvas);
  assert.equal(holderFor(bearChain(emptyCanvas(), [city, ward]), "w7", "building", "inn"), "w7", "a district holds its buildings itself");
  const before = { at: canvas.places[holder].at, units: canvas.places[holder].units };
  adopt(canvas, holder, { id: "w23", label: "Ward 23" });
  assert.ok(!canvas.places[holder] && canvas.places.w23 && !canvas.places.w23.temporary, "the temporary area is now Ward 23");
  assert.ok(same([canvas.places.w23.at, canvas.places.w23.units], [before.at, before.units]), "where it was, with what it held");
});
