import { test } from "node:test";
import assert from "node:assert/strict";
import { addPatch, circleOf, depthInside, fillLandscape, firstLandscape, insideBy, LANDSCAPE_TYPES, LANDSCAPES, ownerOf, samplePatch, type Landscape, type LandscapeType } from "../src/ground/stage/landscape.js";

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
const fill = (type: LandscapeType, seed = "loc_mock") => fillLandscape(firstLandscape(seed, type));
const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length);

test("every landscape type draws a different shape each seed, always within its type's ranges, and the same shape for the same seed", () => {
  for (const type of LANDSCAPE_TYPES) {
    const kind = LANDSCAPES[type], shapes = ["a", "b", "c", "d"].map((seed) => samplePatch(type, "p0", seed));
    assert.ok(same(samplePatch(type, "p0", "a"), shapes[0]), `${type}: the same seed, the same patch`);
    assert.equal(new Set(shapes.map((patch) => JSON.stringify(patch.shape) + patch.R)).size, 4, `${type}: varied`);
    for (const patch of shapes) assert.ok(patch.R >= kind.radius[0] && patch.R <= kind.radius[1] && patch.H >= kind.height[0] && patch.H <= kind.height[1] && patch.lot >= kind.lot[0] && patch.lot <= kind.lot[1], `${type}: in range`);
    // The outline reaches R in some direction and never collapses.
    const reach = Array.from({ length: 36 }, (_, n) => insideBy(shapes[0], [Math.cos(n / 36 * Math.PI * 2) * 1e-3, Math.sin(n / 36 * Math.PI * 2) * 1e-3]) + 1e-3);
    assert.ok(Math.max(...reach) <= shapes[0].R + 1 && Math.min(...reach) > shapes[0].R * 0.3, `${type}: a closed outline`);
  }
});

test("each type fills like its landscape: towers tallest, then shops, homes and villages; industry and farms on big plots; farms mostly fields; castles walled with a keep", () => {
  const floors = Object.fromEntries(LANDSCAPE_TYPES.map((type) => [type, mean(fill(type).fabric.buildings.map((b) => b.floors))]));
  assert.ok(floors.skyscrapers > 2 * floors.commercial && floors.commercial > floors.residential && floors.residential > floors.village, JSON.stringify(floors));
  const plot = (type: LandscapeType) => mean(fill(type).fabric.lots.map((lot) => lot.area));
  assert.ok(plot("industrial") > 2.5 * plot("residential") && plot("farm") > 2 * plot("industrial"), "big plots for industry, bigger fields for farms");
  const farm = fill("farm");
  assert.ok(farm.fabric.buildings.length < 0.3 * farm.fabric.lots.length, "a farm is mostly fields");
  const castle = fill("castle");
  assert.ok(castle.walls.length > 40 && castle.keeps.length === 1 && castle.keeps[0].floors >= 10, "walls round a keep");
  const village = fill("village");
  assert.ok(village.fabric.buildings.length < 0.7 * village.fabric.lots.length, "a village leaves gardens");
});

test("a place is filled from its centre with a probabilistic edge: every lot belongs to a patch, the edge fades over the type's softness, a castle's is a wall", async () => {
  const { ownerOfLot, membership } = await import("../src/ground/stage/landscape.js");
  const landscape = firstLandscape("loc_mock", "residential"), filled = fillLandscape(landscape), patch = landscape.patches[0], soft = LANDSCAPES.residential.soft;
  assert.ok(filled.fabric.lots.length > 40);
  for (const lot of filled.fabric.lots) assert.ok(ownerOfLot(landscape, lot), `${lot.id} belongs to a patch`);
  const outside = (lot: { centre: [number, number] }) => -insideBy(patch, lot.centre), count = (low: number, high: number) => filled.fabric.lots.filter((lot) => outside(lot) >= low && outside(lot) < high).length;
  assert.ok(count(0, 3 * soft + 10) > 0, "some lots past the hard outline: the edge is soft");
  assert.ok(Math.max(...filled.fabric.lots.map(outside)) <= 3 * soft + 10, "but none past the fade");
  assert.ok(count(-30, 0) > count(0, 30) && count(0, 30) > count(30, 60) && count(30, 60) >= count(60, 90), `thinning outward, 30 m at a time (${[count(-30, 0), count(0, 30), count(30, 60), count(60, 90)].join(" → ")})`);
  assert.ok(membership(patch, [patch.x, patch.z]) > 0.97, "all but sure at the centre");
  const castle = firstLandscape("loc_mock", "castle"), walled = fillLandscape(castle);
  assert.ok(walled.fabric.lots.every((lot) => -insideBy(castle.patches[0], lot.centre) < 12), "a castle stops at its wall");
});

test("a new part joins the edge where the scene drifted; the circle grows to hold it; nothing already there changes", () => {
  const first: Landscape = firstLandscape("loc_mock", "skyscrapers"), before = fillLandscape(first);
  const drift: [number, number] = [first.patches[0].R + 5, 0];
  assert.ok(depthInside(first, drift) < 10, "the scene reached the edge: a new part is needed");
  const grown = addPatch(first, "residential", drift, { by: "drift" }), after = fillLandscape(grown);
  assert.ok(insideBy(grown.patches[1], drift) > 0, "the new part covers where the scene went");
  assert.ok(grown.patches[1].x > first.patches[0].R * 0.8, "against the edge, on the drift's side");
  assert.ok(circleOf(grown) > circleOf(first) + 50, `the circle grew (${Math.round(circleOf(first))} → ${Math.round(circleOf(grown))} m)`);
  const lots = new Map(after.fabric.lots.map((lot) => [lot.id, lot])), buildings = new Map(after.fabric.buildings.map((b) => [b.lot, b]));
  for (const lot of before.fabric.lots) assert.ok(same(lot, lots.get(lot.id)), `lot ${lot.id} kept`);
  for (const building of before.fabric.buildings) assert.ok(same(building, buildings.get(building.lot)), `building on ${building.lot} kept`);
  assert.ok(after.fabric.lots.length > before.fabric.lots.length + 40, "the new part is filled");
  assert.ok(Object.values(after.owner).includes("p1"));
  // A scene that drifted well past the edge still gets its part where it went.
  const far: [number, number] = [0, first.patches[0].R + 160], reached = addPatch(first, "village", far);
  assert.ok(insideBy(reached.patches[1], far) > 0, "the far drift is covered");
});

test("a landscape is kept as its patches alone, and fills the same from them every time", () => {
  const landscape = addPatch(firstLandscape("loc_mock", "castle"), "farm", [0, 300]), kept = JSON.parse(JSON.stringify(landscape)) as Landscape;
  assert.ok(same(fillLandscape(kept), fillLandscape(landscape)), "the patches are enough to draw it again");
  assert.ok(JSON.stringify(kept).length < 1500, `small enough to keep in the ontology (${JSON.stringify(kept).length} bytes)`);
});

test("Jev picks each open place's landscape from what the analysis knows of it; picks are kept; the landscape goes to the ontology as the place's property", async () => {
  const { pickLandscapes, landscapeProposal, landscapeQuestion } = await import("../src/digger/stage/landscape.js");
  const places = [{ id: "c", label: "星城", scale: "city", path: ["c"], contains: ["d"], scenes: ["高楼林立的街道上，无人机穿梭。"], buildings: ["中央塔"] },
    { id: "d", label: "旧堡区", scale: "district", path: ["c", "d"], contains: [], scenes: ["城墙下的石板路。"], buildings: [] }, { id: "t", label: "钟楼", scale: "building", path: ["c", "d", "t"], contains: [], scenes: [], buildings: [] }];
  const asked: string[] = [], model = { modelId: "test", async decide(state: string, questions: { key: string; options?: string[] }[]) { asked.push(state); return questions.map((question) => ({ key: question.key, value: state.includes("城墙") ? "castle" : "skyscrapers", confidence: 0.8 })); } };
  const report = await pickLandscapes(places, { decisions: model as never, names: { c: "星城", d: "旧堡区" } });
  assert.deepEqual(Object.fromEntries(Object.entries(report.places).map(([id, pick]) => [id, pick.type])), { c: "skyscrapers", d: "castle" }, "buildings and rooms are not asked");
  assert.ok(asked[0].includes("Buildings the story names there: 中央塔") && asked[1].includes("星城 › 旧堡区"), "Jev reads the analysis: named buildings, the tree path, scenes");
  assert.deepEqual(landscapeQuestion(places[0]).question.options, [...LANDSCAPE_TYPES, "none"]);
  const again = await pickLandscapes(places, { decisions: { modelId: "test", decide: async () => { throw new Error("asked again"); } } as never, previous: report });
  assert.deepEqual([again.usage, again.complete], [{ calls: 0, reused: 2, skipped: 0 }, true]);
  // Without Jev, places not asked before are left for a run with it.
  const unasked = await pickLandscapes([...places, { id: "e", label: "新港", scale: "district", path: ["c", "e"], contains: [], scenes: [], buildings: [] }], { previous: report });
  assert.deepEqual([unasked.usage, unasked.complete, Object.keys(unasked.places)], [{ calls: 0, reused: 2, skipped: 1 }, false, ["c", "d"]]);
  const entity = { id: "c", kind: "Location" as const, names: [{ text: "星城", lang: "zh", kind: "canonical" as const }], properties: { source: "time-place" }, confidence: 1 }, landscape = firstLandscape("c", "skyscrapers");
  const proposal = landscapeProposal(entity, landscape, ["b0001_s0002"]);
  assert.equal(proposal.kind, "upsert_entity");
  assert.deepEqual((proposal.payload as typeof entity & { properties: Record<string, unknown> }).properties, { source: "time-place", landscape }, "the place's record keeps what it had, with its landscape added");
});

test("heights: every type keeps under its cap; skyscraper cores peak anywhere up to 600 m and never past it", async () => {
  const { PEAK } = await import("../src/ground/stage/landscape.js");
  for (const type of LANDSCAPE_TYPES) for (const seed of ["a", "b", "c"]) {
    const tallest = Math.max(0, ...fill(type, `loc_${seed}`).fabric.buildings.map((b) => b.floors * 3));
    assert.ok(tallest <= LANDSCAPES[type].cap + 3, `${type}/${seed}: ${tallest} m within its cap of ${LANDSCAPES[type].cap} m`);
  }
  const peaks = Array.from({ length: 60 }, (_, n) => samplePatch("skyscrapers", "p0", `city_${n}`).H);
  assert.ok(Math.max(...peaks) <= PEAK && PEAK === 600 && Math.min(...peaks) >= 80, "80 m to 600 m");
  assert.ok(peaks.some((h) => h > 400) && peaks.filter((h) => h < 300).length > peaks.length / 2, `varied, mostly lower (${Math.min(...peaks)}–${Math.max(...peaks)} m)`);
});

test("modern ground merges at any height: a new part rises to meet a tall core at the seam, past its own cap; ancient ground never overlaps anything", async () => {
  const { overlaps } = await import("../src/ground/stage/landscape.js");
  const towers = { ...samplePatch("skyscrapers", "p0", "loc_tall"), R: 180, H: 600 }, core: Landscape = { version: 1, seed: "loc_tall", patches: [towers] };
  const merged: Landscape = { ...core, patches: [towers, { ...samplePatch("residential", "p1", "loc_tall"), x: 180 + 0.6 * 280, z: 0, R: 280 }] }, filled = fillLandscape(merged), patch = merged.patches[1];
  // The seam: within the 600 m core's merge reach (85 m); far: well past it.
  const homes = filled.fabric.buildings.filter((b) => filled.owner[b.lot] === "p1"), seam = homes.filter((b) => -insideBy(core.patches[0], [b.x, b.z]) < 90), far = homes.filter((b) => -insideBy(core.patches[0], [b.x, b.z]) > 200);
  assert.ok(seam.length && far.length, "homes at the seam and far from it");
  assert.ok(far.filter((b) => b.floors * 3 > LANDSCAPES.residential.cap + 3).length <= 0.2 * far.length, "and mostly within it away from them (the towers' heights still reach a few, by chance)");
  assert.ok(overlaps(core.patches[0], patch), "modern parts overlap and join");
  for (const type of ["castle", "village", "farm"] as const) {
    const beside = addPatch(core, type, [300, 100]);
    assert.ok(!overlaps(core.patches[0], beside.patches[1]), `${type}: clear of the towers`);
    const after = addPatch(beside, "commercial", [beside.patches[1].x, beside.patches[1].z]);
    assert.ok(!overlaps(beside.patches[1], after.patches[2]), `a modern part placed toward the ${type} stays clear of it`);
  }
});

test("merging two height manifolds: each lot by a seam draws from the older ground with its membership as the chance, so heights step across smoothly, either way round", async () => {
  const { meanHeight } = await import("../src/ground/stage/landscape.js");
  const bands = (filled: ReturnType<typeof fillLandscape>, id: string, older: Parameters<typeof insideBy>[0], edges: number[]) => edges.slice(1).map((high, n) => {
    const list = filled.fabric.buildings.filter((b) => filled.owner[b.lot] === id && -insideBy(older, [b.x, b.z]) >= edges[n] && -insideBy(older, [b.x, b.z]) < high);
    return { n: list.length, mean: mean(list.map((b) => b.floors * 3)), tall: list.filter((b) => b.floors * 3 > LANDSCAPES.residential.cap).length / Math.max(1, list.length) };
  });
  // A tall core (peak 600 m) first, a living area added beside it: the homes rise toward the towers at the seam.
  const towers = { ...samplePatch("skyscrapers", "p0", "loc_merge"), R: 180, H: 600 }, core: Landscape = { version: 1, seed: "loc_merge", patches: [towers] };
  const merged: Landscape = { ...core, patches: [towers, { ...samplePatch("residential", "p1", "loc_merge"), x: 180 + 0.6 * 300, z: 0, R: 300 }] }, filled = fillLandscape(merged);
  const steps = bands(filled, "p1", towers, [-1e9, 40, 100, 200, 1e9]).filter((band) => band.n >= 4);
  assert.ok(steps.length >= 3, JSON.stringify(steps));
  for (let n = 1; n < steps.length; n++) assert.ok(steps[n].mean <= steps[n - 1].mean * 1.1, `heights fall away from the towers: ${steps.map((b) => Math.round(b.mean)).join(" → ")} m`);
  assert.ok(steps[0].tall >= 0.2 && steps.at(-1)!.tall < steps[0].tall / 2, `by the seam a share of homes draw the towers' heights (${steps.map((b) => Math.round(b.tall * 100)).join(" → ")}%), farther off fewer`);
  // Across the seam: the towers' own edge, the homes at the seam, the homes far off.
  const edge = meanHeight(towers, 0.05), seam = steps[0].mean, far = steps.at(-1)!.mean;
  assert.ok(seam < edge && seam > 2 * far, `the seam lies between the two manifolds (${Math.round(edge)} m > ${Math.round(seam)} m > ${Math.round(far)} m)`);
  // The other way round: a living area first, a tall core added beside it, whose skyline steps down to meet the homes.
  const homes: Landscape = firstLandscape("loc_merge2", "residential"), withTowers = addPatch(homes, "skyscrapers", [homes.patches[0].R + 5, 0]);
  withTowers.patches[1] = { ...withTowers.patches[1], H: 600 };
  const second = fillLandscape(withTowers), down = bands(second, "p1", homes.patches[0], [-1e9, 30, 1e9]).filter((band) => band.n >= 2);
  assert.ok(down[0].mean < down.at(-1)!.mean, `towers by the homes are lower than the core's (${down.map((b) => Math.round(b.mean)).join(" → ")} m)`);
  // The older ground never draws from the newer: the homes stay homes.
  const own = second.fabric.buildings.filter((b) => second.owner[b.lot] === "p0");
  assert.ok(own.every((b) => b.floors * 3 <= LANDSCAPES.residential.cap + 3), "the older living area is untouched by the towers");
});

test("a district starts as a box at its parent's centre; a box Jev draws becomes a patch centred in it, as large as fits it", async () => {
  const { defaultBox, patchFromBox, reachOf } = await import("../src/ground/stage/landscape.js");
  const start = defaultBox("residential", [10, -20]);
  assert.deepEqual([(start.x0 + start.x1) / 2, (start.z0 + start.z1) / 2], [10, -20], "the default box is the centre");
  const patch = patchFromBox("residential", "p1", "loc_d", { x0: 100, z0: 50, x1: 400, z1: 250 });
  assert.deepEqual([patch.x, patch.z, patch.R], [250, 150, 100], "centred, as large as the box's shorter side allows");
  const field = patchFromBox("farm", "p2", "loc_f", { x0: -300, z0: 0, x1: 300, z1: 200 });
  assert.equal(field.R, 300);
  assert.ok(Math.abs(reachOf(field, [field.x + 1, field.z]) - 300) < 1 && reachOf(field, [field.x, field.z + 1]) < 130, "a boxy landscape takes the box's proportions");
  assert.ok(same(patchFromBox("residential", "p1", "loc_d", { x0: 100, z0: 50, x1: 400, z1: 250 }), patch), "the same box, the same patch");
});

test("taller cores stand on wider plots with wider streets: no building more than eight times as tall as it is wide", async () => {
  const { SLENDER, streetsFor } = await import("../src/ground/stage/landscape.js");
  const core = (H: number): Landscape => ({ version: 1, seed: "loc_tall", patches: [{ ...samplePatch("skyscrapers", "p0", "loc_tall"), R: 200, H }] });
  const low = fillLandscape(core(120)), high = fillLandscape(core(600));
  for (const filled of [low, high]) for (const b of filled.fabric.buildings) assert.ok(b.floors * 3 <= SLENDER * Math.max(b.w, b.d) + 6, `${b.lot}: ${b.floors * 3} m on ${Math.round(b.w)} × ${Math.round(b.d)} m`);
  const widest = (filled: typeof low) => Math.max(...filled.fabric.roads.map((road) => road.width)), plots = (filled: typeof low) => mean(filled.fabric.lots.map((lot) => lot.area));
  assert.ok(widest(high) >= 2 * widest(low) * 0.9 && streetsFor(core(600).patches[0]) === 2.5, `wider streets round the 600 m core (${Math.round(widest(low))} m → ${Math.round(widest(high))} m)`);
  // Only super-tall ground widens: a 120 m core, and the 600 m core's outer ground, keep the type's own plots and streets.
  const { superTallAt, SUPER_TALL } = await import("../src/ground/stage/landscape.js"), outer: [number, number] = [core(600).patches[0].x + 170, core(600).patches[0].z];
  assert.ok(superTallAt(core(120).patches[0], [core(120).patches[0].x, core(120).patches[0].z]) === 0 && streetsFor(core(120).patches[0]) === 1, "no super-tall ground under a 120 m core");
  assert.ok(superTallAt(core(600).patches[0], outer) === 0 && streetsFor(core(600).patches[0], outer) === 1 && SUPER_TALL === 250, "regular streets at the 600 m core's edge");
  const regular = (filled: typeof low) => mean(filled.fabric.lots.filter((lot) => Math.hypot(...lot.centre) > 150).map((lot) => lot.area));
  assert.ok(regular(high) < 1.5 * regular(low), `plots away from the super-tall middle stay regular (${Math.round(regular(low))} vs ${Math.round(regular(high))} m²)`);
  // Plots grow with the core on its super-tall middle: the big plots there are larger than a 120 m core's.
  const p90 = (filled: typeof low) => Math.max(...filled.fabric.lots.filter((lot) => Math.hypot(...lot.centre) < 80).map((lot) => lot.area));
  assert.ok(p90(high) > 1.3 * p90(low), `bigger plots near the taller core (${Math.round(p90(low))} → ${Math.round(p90(high))} m²)`);
  const tower = high.landmarks.find((mark) => mark.lot.endsWith(":landmark"))!;
  assert.ok(tower.floors * 3 >= 590 && tower.w >= 600 / SLENDER, `a signature tower at the 600 m peak, ${tower.w} m wide`);
  assert.ok(high.fabric.lots.every((lot) => Math.hypot(...lot.centre) > tower.w / 2), "on open ground of its own");
});

test("a stadium is an oval bowl with open ground round it; a commercial quarter has a plaza with a fountain and a boulevard through it", async () => {
  const { bowlOf, plazaOf, boulevardOf } = await import("../src/ground/stage/landscape.js");
  const arena = firstLandscape("loc_arena", "stadium"), stadium = fillLandscape(arena), bowl = bowlOf(arena.patches[0]);
  assert.ok(stadium.landmarks.some((mark) => mark.kind === "stadium" && mark.w > mark.d), "one oval bowl");
  assert.ok(stadium.fabric.lots.every((lot) => Math.hypot(lot.centre[0] - bowl.x, lot.centre[1] - bowl.z) > bowl.d / 2), "no lot in the bowl");
  assert.ok(stadium.fabric.buildings.length < 0.4 * stadium.fabric.lots.length, "mostly parking round it");
  const shops = firstLandscape("loc_shops", "commercial"), filled = fillLandscape(shops), patch = shops.patches[0], plaza = plazaOf(patch), avenue = boulevardOf(patch);
  assert.ok(filled.fabric.lots.every((lot) => Math.hypot(lot.centre[0] - plaza.x, lot.centre[1] - plaza.z) >= plaza.r), "the plaza is open");
  assert.ok(filled.landmarks.some((mark) => mark.kind === "fountain") && filled.plazas.length === 1);
  assert.ok(filled.fabric.roads.some((road) => road.level === "boulevard" && road.width === 30 && road.id === avenue.id), "a 30 m boulevard");
  const u = [Math.cos(patch.shape.turn), Math.sin(patch.shape.turn)], off = (p: [number, number]) => Math.abs(-(p[0] - patch.x) * u[1] + (p[1] - patch.z) * u[0]), along = (p: [number, number]) => Math.abs((p[0] - patch.x) * u[0] + (p[1] - patch.z) * u[1]);
  assert.ok(filled.fabric.lots.every((lot) => off(lot.centre) >= 15 || along(lot.centre) >= 0.85 * patch.R), "no lot on the boulevard");
});
