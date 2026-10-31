import assert from "node:assert/strict";
import { test } from "node:test";
import { fillLandscape, frameOf, LANDSCAPE_VERSION, LANDSCAPES, patchFromBox, STREET_TYPES, type LandscapeType, type Manifold, type Patch } from "../src/ground/stage/landscape.js";
import { hallsOf } from "../src/ground/stage/underground.js";
import type { Building } from "../src/ground/stage/cityFill.js";

const manifold: Manifold = { gradient: 0.2, core: 0.3, spread: 0.4, tail: 0.05, index: 5 };
const street = (type: LandscapeType, w = 300, d = 110, median = 15): Patch => ({ ...patchFromBox(type, `s:${type}`, `s:${type}`, { x0: -w / 2, z0: -d / 2, x1: w / 2, z1: d / 2 }, undefined, { median, manifold }), borrowed: true });
const cbd = () => patchFromBox("skyscrapers", "p0", "pool", { x0: -220, z0: -220, x1: 220, z1: 220 }, undefined, { median: 80, manifold: { gradient: 0.5, core: 0.3, spread: 0.5, tail: 0.1, index: 5 } });
const fill = (patches: Patch[]) => fillLandscape({ version: LANDSCAPE_VERSION, seed: "pool", patches });
const own = (patch: Patch, landmarks: Building[]) => landmarks.filter((b) => b.lot.startsWith(`${patch.id}:`));

test("every street type builds its own form: rows down both sides of its road, a ring round its square, a compound, water and a bridge; the same each time", () => {
  for (const type of STREET_TYPES) {
    const patch = street(type, type === "square" || type === "centre" ? 220 : 300, type === "square" || type === "centre" ? 220 : 110), result = fill([patch]), mine = own(patch, result.landmarks), lots = (part: string) => mine.filter((b) => b.lot.includes(part));
    assert.ok(mine.length > 0, `${type}: a form`);
    assert.equal(JSON.stringify(fill([patch]).landmarks), JSON.stringify(result.landmarks), `${type}: the same form each time`);
    const kind = LANDSCAPES[type];
    if (kind.axis) assert.ok(result.fabric.roads.some((road) => road.id === `AX:${patch.id}`) && lots(":rown").length && lots(":rows").length, `${type}: its road and a row each side`);
    if (kind.band) assert.ok(result.waters.length === 1 && lots(":bridge").length === 1, `${type}: water and a bridge`);
    if (type === "square") assert.ok(lots(":ring").length >= 8 && lots(":monument").length === 1 && result.plazas.length === 1, "a square: a ring round open ground");
    if (type === "centre") assert.ok(lots(":tower").length >= 1 && lots(":podium").length >= 2 && lots(":screen").length === 1, "a centre: towers rising from a podium, a screen");
    if (type === "station") assert.ok(lots(":hall").length === 1 && result.plazas.length === 1, "a station front: its hall and plaza");
  }
});

test("a form's pieces never overlap (the world stands each as a lot of its own): a podium's wings round its towers, a street's rows", () => {
  for (const type of ["centre", "shopping", "avenue", "terrace"] as LandscapeType[]) {
    const patch = street(type, 300, type === "centre" ? 220 : 110, type === "centre" ? 45 : 15), pieces = own(patch, fill([patch]).landmarks).filter((b) => !b.lot.includes(":ring"));
    const box = (b: (typeof pieces)[number]) => { const { along, across } = frameOf(patch, [b.x, b.z]); return [along - b.w / 2, across - b.d / 2, along + b.w / 2, across + b.d / 2]; };
    for (let i = 0; i < pieces.length; i++) for (let j = i + 1; j < pieces.length; j++) {
      const a = box(pieces[i]), b = box(pieces[j]), overlap = Math.min(a[2], b[2]) - Math.max(a[0], b[0]) > 0.5 && Math.min(a[3], b[3]) - Math.max(a[1], b[1]) > 0.5;
      assert.ok(!overlap, `${type}: ${pieces[i].lot} and ${pieces[j].lot} overlap`);
    }
  }
});

test("a street in a CBD: the city's roads give way along it, a shopping street's shops are the bases of the CBD's towers, an alley stays low, and the CBD's landmark moves off the street", () => {
  const shopping = street("shopping"), result = fill([cbd(), shopping]), inside = (p: [number, number]) => Math.abs(frameOf(shopping, p).across) < 6 + 26 && Math.abs(frameOf(shopping, p).along) < 140;
  const along = result.fabric.roads.filter((road) => road.id !== `AX:${shopping.id}` && Array.from({ length: 9 }, (_, n) => [road.a[0] + ((n + 1) / 10) * (road.b[0] - road.a[0]), road.a[1] + ((n + 1) / 10) * (road.b[1] - road.a[1])] as [number, number]).filter(inside).length >= 5);
  assert.equal(along.length, 0, "no road of the city's runs along inside it");
  const bases = own(shopping, result.landmarks).filter((b) => b.base);
  assert.ok(bases.length > 0 && bases.every((b) => b.floors > b.base!.floors && b.base!.kind !== b.kind), `shops under towers: ${bases.length}`);
  const landmark = result.landmarks.find((b) => b.lot === "p0:landmark")!;
  assert.ok(Math.abs(frameOf(shopping, [landmark.x, landmark.z]).across) > 32, "the CBD's landmark stands clear of the street");
  const alley = street("alley", 200, 70, 5);
  assert.equal(own(alley, fill([cbd(), alley]).landmarks).filter((b) => b.base).length, 0, "an alley keeps its own low fabric");
  assert.ok(hallsOf({ version: LANDSCAPE_VERSION, seed: "pool", patches: [street("centre", 220, 220, 45)] }).some((hall) => hall.kind === "mall"), "a mall under a centre");
});
