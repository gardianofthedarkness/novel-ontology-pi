import { test } from "node:test";
import assert from "node:assert/strict";
import { facultyAnchors, facultyChipText, facultyEffectKind, facultyFamily, MAX_EFFECTS_PER_ANCHOR } from "../apps/playground/src/data/facultyEffects.js";
import type { LiveActivity } from "../apps/playground/src/data/liveActivity.js";
import type { OrbitalDraw } from "../apps/playground/src/data/orbitalLayout.js";
import type { WorldNode } from "../apps/playground/src/types.js";

const node = (id: string): WorldNode => ({ id, kind: "scene", label: id, chrono: 0, state: "canon", lane: "canon", parent: "chapter_1", lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
const draw = (id: string, x: number, members: string[] = []): OrbitalDraw => ({ node: node(id), position: [x, 0, 0], radius: 100, role: "main", ...(members.length ? { entry: { node: node(id), members } } : {}) } as OrbitalDraw);
type Faculty = LiveActivity["faculties"][number];
const faculty = (name: string, system: string, extra: Partial<Faculty> = {}): Faculty => ({ id: `${system}:${name}`, label: name, faculty: name, system, status: "working", active: 1, calls: 1, chapterId: "chapter_2", anchorIds: [], ...extra });

test("each faculty keeps its own shape; System 1 and System 2 share the digger colour", () => {
  assert.equal(facultyEffectKind("speaker"), "voice");
  assert.equal(facultyEffectKind("speaker-attribution"), "orbit");
  assert.equal(facultyEffectKind("scene-understanding"), "scan");
  assert.equal(facultyEffectKind("brand-new-faculty"), "glow", "unknown faculties still show something");
  assert.equal(facultyFamily("speaker", "system1"), facultyFamily("speaker-attribution", "system2"));
  assert.equal(facultyFamily("scene-understanding", "work"), "work");
  assert.equal(facultyFamily("grounding-assembly", "cli"), "assembly");
});

test("effects play on the newest draft scene when visible, inside its group sphere when grouped", () => {
  const draws = [draw("chapter_2", 0), draw("group_a", 500, ["draft:b9:scene:12", "scene_3"])];
  const anchors = facultyAnchors([faculty("speaker", "system1", { anchorIds: ["draft:b9:scene:12"] })], draws);
  assert.deepEqual(anchors.map((anchor) => anchor.id), ["group_a"]);
});

test("without a visible draft they fall back to the chapter sphere, then to the timeline's newest end in that chapter", () => {
  const volume = [draw("chapter_1", 0), draw("chapter_2", 600)];
  assert.equal(facultyAnchors([faculty("birth", "system1")], volume)[0].id, "chapter_2");
  const inside = [draw("scene_1", 0), draw("scene_9", 900), draw("scene_5", 400)];
  assert.equal(facultyAnchors([faculty("birth", "system1")], inside, "chapter_2")[0].id, "scene_9");
  assert.deepEqual(facultyAnchors([faculty("birth", "system1")], inside, "chapter_7"), [], "another chapter's work is not drawn here");
});

test("only live work shows: open calls or calls that just ran", () => {
  const draws = [draw("chapter_2", 0)];
  assert.equal(facultyAnchors([faculty("speaker", "system1", { active: 0, recent: false })], draws).length, 0);
  assert.equal(facultyAnchors([faculty("speaker", "system1", { active: 0, recent: true })], draws).length, 1);
  assert.equal(facultyAnchors([faculty("decisions", "jev", { chapterId: undefined })], draws).length, 0, "no block, no place to draw");
});

test("a busy sphere shows at most four effects, and the chip folds the rest into +N", () => {
  const names = ["speaker", "dlg_start", "dlg_end", "birth", "fragment", "scene-understanding"];
  const [anchor] = facultyAnchors(names.map((name) => faculty(name, name.includes("-") ? "work" : "system1")), [draw("chapter_2", 0)]);
  assert.equal(anchor.effects.length, MAX_EFFECTS_PER_ANCHOR);
  assert.equal(facultyChipText(anchor), "speaker · dlg_start · dlg_end +3");
});
