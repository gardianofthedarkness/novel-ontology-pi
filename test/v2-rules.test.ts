import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { chooseSetting, holderIn, isLocative, isPartOrFloor, LANGUAGE, mayHold, nameHolds, RULES, settledCategory, sureParent, usualType } from "../src/v2/rules/index.js";

test("the code rules: one folder, a language profile, and a catalogue of every rule with where it lives", () => {
  const root = join(import.meta.dirname, "..", "..");
  for (const rule of RULES) assert.ok(existsSync(join(root, rule.lives.split(" ")[0].replace(/,$/, ""))), `${rule.name} lives in ${rule.lives}`);
  assert.equal(new Set(RULES.map((rule) => rule.name)).size, RULES.length);
  // The language profile (zh).
  assert.deepEqual([isLocative("街上", true, 0.1), isLocative("马路", true, 0.1), isLocative("上海", true, 0.9), isLocative("桌上", false, 0.1)], [true, false, false, false]);
  assert.ok(LANGUAGE.join.test("的") && LANGUAGE.join.test("，") && !LANGUAGE.join.test("占据了"));
  assert.equal(LANGUAGE.scaleOfName("第七学区"), "district");
  // Typing, places.
  assert.equal(usualType(new Map([["vehicle", 1], ["building", 1]]), (type) => type === "building"), "vehicle", "a tie is no place");
  assert.deepEqual(["高墙", "大厦墙壁", "混凝土支柱", "最上层", "第四十四层", "楼顶", "地下停车场", "高楼大厦"].map((text) => isPartOrFloor(text, true, 0.1)), [true, true, true, true, true, true, false, false]);
  const categoryOf = (type: string) => ({ region: "place", concept: "concept", person: "person" })[type] ?? null;
  assert.deepEqual(settledCategory(new Map([["region", 1], ["concept", 1]]), categoryOf), { type: "concept", category: "concept" }, "魔法侧: a region once, a concept once: no place");
  assert.deepEqual(settledCategory(new Map([["region", 3], ["concept", 1]]), categoryOf), { type: "region", category: "place" });
  assert.ok(mayHold("city", "district") && !mayHold("district", "city") && mayHold("region", "region") && !mayHold("city", "city"));
  assert.ok(nameHolds(["学园都市"], ["学园都市第七学区"]) && !nameHolds(["学园都市第七学区"], ["学园都市"]));
  assert.equal(sureParent([{ id: "a", score: 2.3, evidence: [{ kind: "stated" }] }, { id: "b", score: 1.3, evidence: [{ kind: "sentence" }] }]), null, "not twice the second");
  assert.equal(sureParent([{ id: "a", score: 3.3, evidence: [{ kind: "name" }] }])?.by, "name");
  assert.equal(holderIn(["city", "d7", "school"], "building", (id) => ({ city: "city", d7: "district", school: "building" })[id] ?? null), "d7", "the deepest larger place");
  const tree: Record<string, string[]> = { city: ["city"], d7: ["city", "d7"], d15: ["city", "d15"] };
  const at = { depth: (id: string) => tree[id]?.length ?? 1, under: (id: string, top: string) => id !== top && (tree[id] ?? []).includes(top) };
  assert.deepEqual(chooseSetting({ environment: [["city", 1], ["d7", 1]], action: [], any: [], previous: null, past: false, continues: true, ...at }), { place: "d7", by: "environment", branched: [] });
  assert.deepEqual(chooseSetting({ environment: [["d7", 1], ["d15", 1]], action: [], any: [], previous: null, past: false, continues: true, ...at }).branched.length, 1, "two branches: Jev's");
  assert.deepEqual(chooseSetting({ environment: [], action: [], any: [], previous: "d7", past: false, continues: true, ...at }), { place: "d7", by: "carried", branched: [] });
});

test("an entity whose typings settle on another category moves there, under an id of it, with its names", async () => {
  const { Chart } = await import("../src/v2/em.js");
  const chart = new Chart(), place = chart.mint("place", "region", "魔法侧", ["s1"]);
  const moved = chart.recategorize(place.id, "concept", "concept");
  assert.ok(!chart.entities.has(place.id) && chart.entities.get(moved)?.category === "concept" && !moved.startsWith("loc_"));
  assert.equal(chart.exact("魔法侧")?.id, moved);
});
