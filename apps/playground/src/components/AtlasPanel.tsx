import { useMemo } from "react";
import { dateLine, scenePeriod, type TimePlaceProjection } from "../data/timePlace";

/**
 * Orbital Places side panel: the story-time window that decides which
 * periods' scenes float above the map, and a character to trace through
 * them. `periods` null means every period.
 */
interface Props {
  data: TimePlaceProjection;
  periods: ReadonlySet<string> | null;
  onPeriods: (periods: Set<string> | null) => void;
  onCharacter: (id: string) => void;
}

const NOT_STATED = "";

export function AtlasPanel({ data, periods, onPeriods, onCharacter }: Props) {
  const placed = useMemo(() => data.scenes.filter((scene) => scene.placeIds.length), [data]);
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const scene of placed) counts.set(scenePeriod(scene) ?? NOT_STATED, (counts.get(scenePeriod(scene) ?? NOT_STATED) ?? 0) + 1);
    const timed = [...data.times].sort((first, second) => first.storyIndex - second.storyIndex).map((time) => ({ id: time.id, label: `${time.flashback ? "↶ " : ""}${time.label}`, detail: dateLine(time) || time.gloss, count: counts.get(time.id) ?? 0, flashback: time.flashback }));
    return counts.has(NOT_STATED) ? [{ id: NOT_STATED, label: "Time not stated", detail: "before the first time word", count: counts.get(NOT_STATED)!, flashback: false }, ...timed] : timed;
  }, [data, placed]);
  const all = rows.map((row) => row.id);
  const on = (id: string) => !periods || periods.has(id);
  const shown = rows.filter((row) => on(row.id)).reduce((sum, row) => sum + row.count, 0);
  const toggle = (id: string) => {
    const next = new Set(periods ?? all);
    if (next.has(id)) next.delete(id); else next.add(id);
    onPeriods(next.size === all.length ? null : next);
  };
  const unplaced = data.scenes.length - placed.length;
  const wide = typeof window !== "undefined" && window.matchMedia?.("(min-width: 701px)").matches;
  return <details className="atlas-panel" open={wide}>
    <summary><span className="eyebrow">Story time window</span><b>{shown} of {placed.length} placed scenes</b></summary>
    <div className="atlas-actions"><button onClick={() => onPeriods(null)} aria-pressed={!periods}>All</button><button onClick={() => onPeriods(new Set())} aria-pressed={!!periods && !periods.size}>None</button><button onClick={() => onPeriods(new Set(rows.filter((row) => !row.flashback).map((row) => row.id)))}>Present only</button></div>
    <ol aria-label="Story periods, earliest first">
      {rows.map((row) => <li key={row.id || "not-stated"} className={row.flashback ? "is-flashback" : ""}><label><input type="checkbox" checked={on(row.id)} onChange={() => toggle(row.id)} /><span><b lang="zh">{row.label}</b><small>{row.detail ? `${row.detail} · ` : ""}{row.count} scene{row.count === 1 ? "" : "s"}</small></span></label></li>)}
    </ol>
    {data.characters.length > 0 && <label className="atlas-character"><span>Trace a character</span><select value="" onChange={(event) => { if (event.target.value) onCharacter(event.target.value); }}><option value="">Choose…</option>{data.characters.slice(0, 20).map((character) => <option key={character.id} value={character.id}>{character.label} · {character.scenes}</option>)}</select></label>}
    {unplaced > 0 && <p className="atlas-note">{unplaced} scene{unplaced === 1 ? "" : "s"} name no place and stay off the map.</p>}
  </details>;
}
