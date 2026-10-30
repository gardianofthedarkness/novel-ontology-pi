import type { LiveActivity } from "./liveActivity.js";
import type { OrbitalDraw } from "./orbitalLayout.js";

/**
 * Live faculty animations. Faculty telemetry names a block, not records, so
 * each working faculty plays its own effect on the sphere where its block is
 * being built: the newest draft scene of the block when it is visible, else
 * the block's chapter sphere, else (inside that chapter) the newest end of
 * the timeline. Effects say "working here", never "this record changed".
 *
 * Diggers (System 1 and System 2 alike) share one colour; the work model and
 * draft assembly have their own. Each faculty keeps a shape for what it does.
 */
export type FacultyEffectKind = "voice" | "quote-open" | "quote-close" | "gate-front" | "gate-back" | "seam" | "birth" | "fragment" | "orbit" | "scales" | "stack" | "ripple" | "scan" | "assembly" | "glow";
export type FacultyFamily = "digger" | "work" | "assembly";
export interface FacultyEffect { faculty: string; kind: FacultyEffectKind; family: FacultyFamily }
export interface FacultyAnchor { id: string; effects: FacultyEffect[]; faculties: string[] }

const KINDS: Record<string, FacultyEffectKind> = {
  speaker: "voice", dlg_kind: "quote-open", dlg_turn: "quote-close", dlg_start: "quote-open", dlg_end: "quote-close", scene_start: "gate-front", scene_end: "gate-back",
  scene_seam: "seam", birth: "birth", fragment: "fragment", "speaker-attribution": "orbit", "scene-adjudication": "scales",
  "dialogue-structure": "stack", "entities-participants": "ripple", "scene-understanding": "scan", "grounding-assembly": "assembly",
};
export const MAX_EFFECTS_PER_ANCHOR = 4;

export function facultyFamily(faculty: string, system: string): FacultyFamily {
  if (faculty === "grounding-assembly") return "assembly";
  return system === "work" ? "work" : "digger";
}

export function facultyEffectKind(faculty: string): FacultyEffectKind {
  return KINDS[faculty] ?? "glow";
}

/** Effects to play now, grouped by the visible sphere they play on. */
export function facultyAnchors(faculties: LiveActivity["faculties"] | undefined, draws: OrbitalDraw[], scopeChapterId?: string | null): FacultyAnchor[] {
  const contains = (draw: OrbitalDraw, id: string) => draw.node.id === id || !!draw.entry?.members.includes(id);
  const frontier = () => draws.filter((draw) => draw.role === "main").sort((first, second) => second.position[0] - first.position[0])[0];
  const anchors = new Map<string, FacultyAnchor>();
  for (const faculty of faculties ?? []) {
    if (!(faculty.active > 0 || faculty.recent) || !faculty.chapterId) continue;
    const exact = (faculty.anchorIds ?? []).map((id) => draws.find((draw) => contains(draw, id))).find(Boolean);
    const target = exact ?? draws.find((draw) => contains(draw, faculty.chapterId!)) ?? (scopeChapterId === faculty.chapterId ? frontier() : undefined);
    if (!target) continue;
    const anchor = anchors.get(target.node.id) ?? { id: target.node.id, effects: [], faculties: [] };
    anchor.faculties.push(faculty.faculty);
    if (anchor.effects.length < MAX_EFFECTS_PER_ANCHOR && !anchor.effects.some((effect) => effect.faculty === faculty.faculty)) {
      anchor.effects.push({ faculty: faculty.faculty, kind: facultyEffectKind(faculty.faculty), family: facultyFamily(faculty.faculty, faculty.system) });
    }
    anchors.set(target.node.id, anchor);
  }
  return [...anchors.values()];
}

/** Chip text: who is working here, with overflow folded into "+N". */
export function facultyChipText(anchor: FacultyAnchor, shown = 3): string {
  const names = [...new Set(anchor.faculties)];
  return names.slice(0, shown).join(" · ") + (names.length > shown ? ` +${names.length - shown}` : "");
}
