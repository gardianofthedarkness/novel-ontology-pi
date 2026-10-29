import { useMemo } from "react";
import { dateLine, scenePeriod, type TimePlaceProjection } from "../data/timePlace";
import type { AtlasLevels } from "../data/orbitalTimePlace";
import { buildingMoments, buildingsAt as namedAt, simulationAt } from "../data/placeBuildings";

/**
 * Orbital Places side panel: what floats above the map — scenes, events
 * and/or dialogue; the story-time window (periods, or the stretch of the
 * Story time spiral that was in view); and a character to trace through
 * them. `periods` null means every period; `focus` null means no stretch.
 * With a building log, a slider picks the story moment the named buildings
 * are shown at (`buildingsAt` null: the end of the story).
 */
interface Props {
  data: TimePlaceProjection;
  periods: ReadonlySet<string> | null;
  onPeriods: (periods: Set<string> | null) => void;
  focus: ReadonlySet<string> | null;
  onClearFocus: () => void;
  levels: AtlasLevels;
  onLevels: (levels: AtlasLevels) => void;
  onCharacter: (id: string) => void;
  buildingsAt: string | null;
  onBuildingsAt: (at: string | null) => void;
  laterBuildings: boolean;
  onLaterBuildings: (later: boolean) => void;
}
const LEVELS: [keyof AtlasLevels, string][] = [["scene", "Scenes"], ["event", "Events"], ["dialogue", "Dialogue"]];

const NOT_STATED = "";

export function AtlasPanel({ data, periods, onPeriods, focus, onClearFocus, levels, onLevels, onCharacter, buildingsAt, onBuildingsAt, laterBuildings, onLaterBuildings }: Props) {
  // Named buildings by story moment: the slider's last step is the end of the story (everything standing).
  const moments = useMemo(() => data.buildings?.length || data.simulation ? buildingMoments(data) : [], [data]);
  // A moment of another book (or none) is the end of the story, as the map reads it.
  const found = moments.findIndex((moment) => moment.id === buildingsAt), step = found < 0 ? moments.length : found;
  const named = useMemo(() => [...namedAt(data, step < moments.length ? moments[step].id : null).values()].flat(), [data, moments, step]);
  const standingCount = named.filter((entry) => entry.standing).length;
  const simulated = useMemo(() => [...simulationAt(data, step < moments.length ? moments[step].id : null).values()], [data, moments, step]);
  const hitsSoFar = simulated.reduce((sum, place) => sum + place.hits.filter((hit) => hit.standing).length, 0);
  const placed = useMemo(() => data.scenes.filter((scene) => scene.placeIds.length), [data]);
  const rows = useMemo(() => {
    const counts = new Map<string, number>();
    for (const scene of placed) counts.set(scenePeriod(scene) ?? NOT_STATED, (counts.get(scenePeriod(scene) ?? NOT_STATED) ?? 0) + 1);
    const timed = [...data.times].sort((first, second) => first.storyIndex - second.storyIndex).map((time) => ({ id: time.id, label: `${time.flashback ? "↶ " : ""}${time.label}`, detail: dateLine(time) || time.gloss, count: counts.get(time.id) ?? 0, flashback: time.flashback }));
    return counts.has(NOT_STATED) ? [{ id: NOT_STATED, label: "Time not stated", detail: "before the first time word", count: counts.get(NOT_STATED)!, flashback: false }, ...timed] : timed;
  }, [data, placed]);
  const all = rows.map((row) => row.id);
  const on = (id: string) => !periods || periods.has(id);
  const shown = placed.filter((scene) => on(scenePeriod(scene) ?? NOT_STATED) && (!focus || focus.has(scene.id))).length;
  const level = (key: keyof AtlasLevels) => {
    const next = { ...levels, [key]: !levels[key] };
    if (next.scene || next.event || next.dialogue) onLevels(next);
  };
  const toggle = (id: string) => {
    const next = new Set(periods ?? all);
    if (next.has(id)) next.delete(id); else next.add(id);
    onPeriods(next.size === all.length ? null : next);
  };
  const unplaced = data.scenes.length - placed.length;
  const wide = typeof window !== "undefined" && window.matchMedia?.("(min-width: 701px)").matches;
  return <details className="atlas-panel" open={wide}>
    <summary><span className="eyebrow">Story time window</span><b>{shown} of {placed.length} placed scenes</b></summary>
    <div className="atlas-levels" role="group" aria-label="Show above the map">{LEVELS.map(([key, label]) => <button key={key} aria-pressed={levels[key]} onClick={() => level(key)}>{label}</button>)}</div>
    {(levels.event || levels.dialogue) && <p className="atlas-note">{levels.scene ? "Each scene is a clear bubble around its " : "Scenes are hidden; their "}{[levels.event && "events", levels.dialogue && "dialogue"].filter(Boolean).join(" and ")}{levels.scene ? "." : " float where the scene would be."}</p>}
    {focus && <p className="atlas-focus">From Story time: the {focus.size} scene{focus.size === 1 ? "" : "s"} you were looking at<button onClick={onClearFocus}>Show all</button></p>}
    <div className="atlas-actions"><button onClick={() => onPeriods(null)} aria-pressed={!periods}>All</button><button onClick={() => onPeriods(new Set())} aria-pressed={!!periods && !periods.size}>None</button><button onClick={() => onPeriods(new Set(rows.filter((row) => !row.flashback).map((row) => row.id)))}>Present only</button></div>
    <ol aria-label="Story periods, earliest first">
      {rows.map((row) => <li key={row.id || "not-stated"} className={row.flashback ? "is-flashback" : ""}><label><input type="checkbox" checked={on(row.id)} onChange={() => toggle(row.id)} /><span><b lang="zh">{row.label}</b><small>{row.detail ? `${row.detail} · ` : ""}{row.count} scene{row.count === 1 ? "" : "s"}</small></span></label></li>)}
    </ol>
    {moments.length > 0 && <div className="atlas-buildings">
      <label htmlFor="atlas-buildings-at"><span>Buildings as of</span><b lang="zh">{step < moments.length ? moments[step].label : "the end of the story"}</b></label>
      <input id="atlas-buildings-at" type="range" min={0} max={moments.length} step={1} value={step} aria-valuetext={step < moments.length ? moments[step].label : "the end of the story"}
        onChange={(event) => { const at = Number(event.target.value); onBuildingsAt(at >= moments.length ? null : moments[at].id); }} />
      <small>{standingCount} of {named.length} building{named.length === 1 ? "" : "s"} the story names are standing (warm) · the rest of each skyline always stands · named by a model, not reviewed</small>
      {simulated.length > 0 && <small>{simulated.length} place{simulated.length === 1 ? "" : "s"} drawn from the stage simulation ({[...new Set(simulated.map((place) => place.title))].join("; ")}), as the strand page draws them: corridors (cyan) and stair cores (orange) inside each building, its walls and roof once hit, what a hit cut off (red), Jev's placed things (gold), {hitsSoFar} hit{hitsSoFar === 1 ? "" : "s"} so far (red spheres), amber arcs for who moved between places</small>}
      <label className="atlas-later"><input type="checkbox" checked={laterBuildings} onChange={(event) => onLaterBuildings(event.target.checked)} /> Show later ones faintly</label>
    </div>}
    {data.characters.length > 0 && <label className="atlas-character"><span>Trace a character</span><select value="" onChange={(event) => { if (event.target.value) onCharacter(event.target.value); }}><option value="">Choose…</option>{data.characters.slice(0, 20).map((character) => <option key={character.id} value={character.id}>{character.label} · {character.scenes}</option>)}</select></label>}
    {unplaced > 0 && <p className="atlas-note">{unplaced} scene{unplaced === 1 ? "" : "s"} name no place and stay off the map.</p>}
  </details>;
}
