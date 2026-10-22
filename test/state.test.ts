import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { BundleStore } from "../src/connectors/bundle.js";
import { foldStateAt } from "../src/ontology/state.js";
import type { Entity, OntEvent, StateChange } from "../src/ontology/types.js";
import { applyChangeSet } from "../src/merge/apply.js";
import type { ChangeSet } from "../src/merge/changeset.js";

const ev = (id: string, order: number): OntEvent => ({
  id,
  timelineId: "tl_canon",
  chapterIndex: 0,
  chronologicalOrder: order,
  eventType: "action",
  summaryEn: `event ${id}`,
  evidence: { text: "", sentenceIds: [] },
  importance: 0.5,
  primaryActors: [],
  affectedCharacters: [],
  confidence: 0.9,
});

const delta = (partial: Partial<StateChange> & { id: string; afterEventId: string }): StateChange => ({
  characterId: "char_1",
  emotions: {},
  knowledgeAdd: [],
  goalsAdd: [],
  relationships: {},
  location: null,
  possessionsAdd: [],
  possessionsRemove: [],
  ...partial,
});

const EVENTS = [ev("e1", 1), ev("e2", 2), ev("e3", 3)];

test("fold: deltas replay in event order, not insertion order", () => {
  const deltas = [
    delta({ id: "d2", afterEventId: "e2", location: "宿舍" }),
    delta({ id: "d1", afterEventId: "e1", location: "教室" }),
  ];
  const s = foldStateAt("char_1", "e3", EVENTS, deltas)!;
  assert.equal(s.location, "宿舍", "the later event's delta wins regardless of array order");
});

test("fold: emotions and relationships are additive and clamped to [-1, 1]", () => {
  const deltas = [
    delta({ id: "d1", afterEventId: "e1", emotions: { joy: 0.7 }, relationships: { char_2: 0.4 } }),
    delta({ id: "d2", afterEventId: "e2", emotions: { joy: 0.7 }, relationships: { char_2: -0.4 } }),
  ];
  const s = foldStateAt("char_1", "e3", EVENTS, deltas)!;
  assert.equal(s.emotions.joy, 1, "0.7 + 0.7 clamps to 1");
  assert.deepEqual(s.relationships, {}, "a value returning to exactly 0 drops the key");
});

test("fold: sets add without duplicates; possessions remove; null location never clears", () => {
  const deltas = [
    delta({ id: "d1", afterEventId: "e1", knowledgeAdd: ["秘密A"], goalsAdd: ["回家"], possessionsAdd: ["伞", "钥匙"], location: "车站" }),
    delta({ id: "d2", afterEventId: "e2", knowledgeAdd: ["秘密A", "秘密B"], possessionsRemove: ["伞"], location: null }),
  ];
  const s = foldStateAt("char_1", "e3", EVENTS, deltas)!;
  assert.deepEqual(s.knowledge, ["秘密A", "秘密B"]);
  assert.deepEqual(s.goals, ["回家"]);
  assert.deepEqual(s.possessions, ["钥匙"]);
  assert.equal(s.location, "车站");
});

test("fold: the at-point cuts off later deltas; unknown point and orphan deltas", () => {
  const deltas = [
    delta({ id: "d1", afterEventId: "e1", emotions: { calm: 0.5 } }),
    delta({ id: "d2", afterEventId: "e3", emotions: { calm: 0.5 } }),
    delta({ id: "dX", afterEventId: "e_missing", emotions: { calm: 0.5 } }),
  ];
  const early = foldStateAt("char_1", "e1", EVENTS, deltas)!;
  assert.equal(early.emotions.calm, 0.5, "only the first delta is in scope at e1");
  const late = foldStateAt("char_1", "e3", EVENTS, deltas)!;
  assert.equal(late.emotions.calm, 1, "the orphan delta (unknown event) never applies");
  assert.equal(foldStateAt("char_1", "e_nope", EVENTS, deltas), null);
  const other = foldStateAt("char_2", "e3", EVENTS, deltas)!;
  assert.deepEqual(other.emotions, {}, "another character's fold is empty, not null");
});

const charEntity = (id: string, name: string): Entity => ({
  id,
  kind: "Character",
  names: [{ text: name, lang: "zh", kind: "canonical" }],
  properties: {},
  confidence: 0.95,
});

test("apply: aliases and state deltas materialize; only a missing-entity alias defers", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-state-"));
  const store = new BundleStore(dir);
  const emitted: { type: string; unsupportedProposalIds?: string[] }[] = [];
  const cs: ChangeSet = {
    id: "cs_b0001",
    blockId: "b0001",
    status: "approved",
    reviewNotes: {},
    createdAt: new Date().toISOString(),
    proposals: [
      { id: "p_ent", kind: "upsert_entity", payload: charEntity("char_1", "御坂美琴"), confidence: 0.9, provenance: { blockId: "b0001", sentenceIds: [], patchId: "extraction" } },
      { id: "p_e1", kind: "create_event", payload: ev("e1", 1), confidence: 0.9, provenance: { blockId: "b0001", sentenceIds: [], patchId: "extraction" } },
      { id: "p_e2", kind: "create_event", payload: ev("e2", 2), confidence: 0.9, provenance: { blockId: "b0001", sentenceIds: [], patchId: "extraction" } },
      {
        id: "b0001_e1_state_char_1", kind: "set_state_change", confidence: 0.7,
        payload: { characterId: "char_1", afterEventId: "e1", emotions: { 警惕: 0.6 }, knowledgeAdd: [], goalsAdd: [], relationships: {}, location: "小巷", possessionsAdd: [], possessionsRemove: [] },
        provenance: { blockId: "b0001", sentenceIds: [], patchId: "extraction" },
      },
      {
        id: "b0001_e2_state_char_1", kind: "set_state_change", confidence: 0.7,
        payload: { characterId: "char_1", afterEventId: "e2", emotions: { 警惕: 0.6 }, knowledgeAdd: ["对方的身份"], goalsAdd: [], relationships: {}, location: null, possessionsAdd: [], possessionsRemove: [] },
        provenance: { blockId: "b0001", sentenceIds: [], patchId: "extraction" },
      },
      { id: "p_alias", kind: "add_alias", payload: { entityId: "char_1", aliasText: "超电磁炮" }, confidence: 0.8, provenance: { blockId: "b0001", sentenceIds: [], patchId: "name-detector" } },
      { id: "p_alias_missing", kind: "add_alias", payload: { entityId: "char_ghost", aliasText: "幽灵" }, confidence: 0.8, provenance: { blockId: "b0001", sentenceIds: [], patchId: "name-detector" } },
    ],
  };
  const result = await applyChangeSet(store, cs, async (e) => { emitted.push(e as never); });
  assert.deepEqual(result, { applied: 6, processed: 7, deferred: 1 });
  const appliedEvent = emitted.find((e) => e.type === "changeset.applied")!;
  assert.deepEqual(appliedEvent.unsupportedProposalIds, ["p_alias_missing"]);
  assert.ok(!emitted.some((e) => e.type === "changeset.merged"), "merged is withheld while anything defers");

  // Disk-true: a fresh store over the same folder folds the state.
  const fresh = new BundleStore(dir);
  const at1 = await fresh.getStateAt("char_1", "e1");
  assert.equal(at1?.emotions["警惕"], 0.6);
  assert.equal(at1?.location, "小巷");
  const at2 = await fresh.getStateAt("char_1", "e2");
  assert.equal(at2?.emotions["警惕"], 1, "0.6 + 0.6 clamps to 1");
  assert.deepEqual(at2?.knowledge, ["对方的身份"]);
  assert.equal(at2?.location, "小巷", "null location in the second delta did not clear it");

  const entityRows = await fresh.loadFile<Entity>("entities.jsonl");
  const folded = new Map<string, Entity>();
  for (const e of entityRows) folded.set(e.id, e);
  assert.ok(folded.get("char_1")!.names.some((n) => n.text === "超电磁炮" && n.kind === "alias"), "alias materialized as a name form");

  const deltaLines = (await readFile(join(dir, "state-changes.jsonl"), "utf8")).trim().split("\n");
  assert.equal(deltaLines.length, 2, "both deltas persisted as records");
});

test("apply: a fully materializable changeset fires changeset.merged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "novel-state-"));
  const store = new BundleStore(dir);
  const emitted: string[] = [];
  const cs: ChangeSet = {
    id: "cs_b0001",
    blockId: "b0001",
    status: "approved",
    reviewNotes: {},
    createdAt: new Date().toISOString(),
    proposals: [
      { id: "p_ent", kind: "upsert_entity", payload: charEntity("char_1", "上条当麻"), confidence: 0.9, provenance: { blockId: "b0001", sentenceIds: [], patchId: "extraction" } },
      { id: "p_alias", kind: "add_alias", payload: { entityId: "char_1", aliasText: "幻想杀手" }, confidence: 0.8, provenance: { blockId: "b0001", sentenceIds: [], patchId: "name-detector" } },
    ],
  };
  const result = await applyChangeSet(store, cs, async (e) => { emitted.push((e as { type: string }).type); });
  assert.deepEqual(result, { applied: 2, processed: 2, deferred: 0 });
  assert.ok(emitted.includes("changeset.merged"));
});
