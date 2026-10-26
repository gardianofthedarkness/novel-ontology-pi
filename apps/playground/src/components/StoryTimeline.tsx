import { useEffect, useMemo, useRef, useState } from "react";
import { useChromeInsets } from "./useChromeInsets";
import { dateLine, readingJumps, scenePeriod, storyRows, type StoryScene, type StoryTime, type TimePlaceProjection } from "../data/timePlace";

/**
 * Story time view (time-place faculty, phase 1): the story in the order it
 * happens, not the order it is read. Periods run top (earliest) to bottom;
 * a flashback sits before the period it was told during, offset in amber
 * with how sure Jev was. The reading ribbon underneath the title keeps the
 * reading order visible, so a jump back is never hidden.
 */
interface Props {
  data: TimePlaceProjection;
  names: Map<string, string>;
  onShowInOrbit?: (sceneId: string) => void;
  /** Periods that just emerged live (highlighted and scrolled to). */
  emerging?: ReadonlySet<string>;
  /** Scenes Pi is touching; followed (scrolled to) while following Pi. */
  touched?: ReadonlySet<string>;
  following?: boolean;
}

const hue = (index: number, total: number) => `hsl(${200 - Math.round(150 * index / Math.max(1, total - 1))} 70% 62%)`;

export function StoryTimeline({ data, names, onShowInOrbit, emerging, touched, following = false }: Props) {
  const rows = useMemo(() => storyRows(data), [data]);
  const jumps = useMemo(() => new Set(readingJumps(data).map((jump) => jump.sceneId)), [data]);
  const timeById = useMemo(() => new Map(data.times.map((time) => [time.id, time])), [data]);
  const [selected, setSelected] = useState<StoryScene | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const insets = useChromeInsets();
  const flashbacks = data.times.filter((time) => time.flashback).length;
  const proposed = data.times.filter((time) => time.proposed).length;
  // Live: bring what just emerged (or what Pi is touching, when following) into view.
  useEffect(() => { const first = data.times.find((time) => emerging?.has(time.id)); if (first) rowRefs.current.get(first.id)?.scrollIntoView({ block: "center", behavior: "smooth" }); }, [emerging]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (!following || !touched?.size) return;
    const scene = data.scenes.find((entry) => touched.has(entry.id));
    if (scene) rowRefs.current.get(scenePeriod(scene) ?? "unplaced")?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [touched, following]); // eslint-disable-line react-hooks/exhaustive-deps
  const reading = [...data.scenes].sort((first, second) => first.index - second.index);
  const colourOf = (scene: StoryScene) => {
    const time = timeById.get(scenePeriod(scene) ?? "");
    return !time ? "var(--tp-unplaced)" : time.flashback ? "var(--tp-flashback)" : hue(time.storyIndex, data.times.length);
  };
  const jumpTo = (scene: StoryScene) => {
    setSelected(scene);
    rowRefs.current.get(scenePeriod(scene) ?? "unplaced")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  if (!data.available) return <div className="tp-empty" style={insets}><b>No story time yet</b><span>Run the time-place faculty for this book (<code>novel timeplace run</code>) and approve its changeset to see the story in time order.</span></div>;
  return <section className="tp-view tp-story" aria-label="Story timeline" style={insets}>
    <header className="tp-head">
      <div><span className="eyebrow">Story time · phase 1</span><b>{data.times.length} time period{data.times.length === 1 ? "" : "s"}{flashbacks ? ` · ${flashbacks} flashback${flashbacks === 1 ? "" : "s"}` : ""}{proposed ? ` · ${proposed} proposed, awaiting review` : ""}</b></div>
      <p>Earliest at the top. A period starts at a time word in the text and lasts until the next; order is estimated from the text, and dates marked <i>derived</i> are calculated from stated words, never guessed.</p>
    </header>
    <div className="tp-ribbon" role="list" aria-label="Reading order: each scene coloured by its story period">
      <span className="tp-ribbon-label">Reading order →</span>
      <div className="tp-ribbon-cells">{reading.map((scene) => <button key={scene.id} role="listitem" className={`tp-cell${selected?.id === scene.id ? " is-selected" : ""}${jumps.has(scene.id) ? " is-jump" : ""}`} style={{ background: colourOf(scene) }} title={`${scene.label} — ${timeById.get(scenePeriod(scene) ?? "")?.label ?? "time not stated"}`} aria-label={`Scene ${scene.index + 1}, chapter ${scene.chapterIndex}: ${scene.label}`} onClick={() => jumpTo(scene)} />)}</div>
    </div>
    <ol className="tp-spine">
      {rows.map(({ time, scenes }) => {
        const host = time?.toldFromId ? timeById.get(time.toldFromId) : undefined;
        return <li key={time?.id ?? "unplaced"} ref={(element) => { if (element) rowRefs.current.set(time?.id ?? "unplaced", element); }} className={`tp-row${time?.flashback ? " is-flashback" : ""}${!time ? " is-unplaced" : ""}${time?.proposed ? " is-proposed" : ""}${time && emerging?.has(time.id) ? " is-emerging" : ""}`} style={time && !time.flashback ? { ["--tp-row" as string]: hue(time.storyIndex, data.times.length) } : undefined}>
          <div className="tp-row-head">
            <span className="tp-dot" aria-hidden="true" />
            <div className="tp-row-title">
              {time ? <><b lang="zh">{time.flashback ? "↶ " : ""}{time.label}{time.proposed && <em className="tp-proposed">proposed · awaiting review</em>}</b><span className="tp-date">{dateLine(time) || time.gloss}</span></> : <><b>Time not stated</b><span className="tp-date">before the first time word in the text</span></>}
            </div>
            <span className="tp-meta">{time ? `ch ${time.chapterIndex} · ` : ""}{scenes.length} scene{scenes.length === 1 ? "" : "s"}</span>
          </div>
          {time?.flashback && <p className="tp-told">Flashback{host ? <> told during <b lang="zh">{host.label}</b> (ch {host.chapterIndex})</> : ""} · Jev {Math.round(time.flashbackProbability * 100)}% sure it goes back in time</p>}
          <div className="tp-scenes">{scenes.map((scene) => <SceneChip key={scene.id} scene={scene} names={names} touched={!!touched?.has(scene.id)} selected={selected?.id === scene.id} anchor={!!time && scene.times.some((entry) => entry.id === time.id && entry.via === "anchor")} onClick={() => setSelected(scene)} />)}</div>
        </li>;
      })}
    </ol>
    {selected && <SceneDetail scene={selected} names={names} times={timeById} onClose={() => setSelected(null)} onShowInOrbit={onShowInOrbit} />}
  </section>;
}

function SceneChip({ scene, names, selected, anchor, touched, onClick }: { scene: StoryScene; names: Map<string, string>; selected: boolean; anchor: boolean; touched: boolean; onClick: () => void }) {
  const place = scene.placeIds[0] ? names.get(scene.placeIds[0]) ?? scene.placeIds[0] : null;
  return <button className={`tp-chip${selected ? " is-selected" : ""}${anchor ? " is-anchor" : ""}${touched ? " is-touched" : ""}`} onClick={onClick} aria-pressed={selected}>
    <span className="tp-chip-index">{anchor ? "◆ " : ""}S{scene.index + 1} · ch {scene.chapterIndex}</span>
    <span className="tp-chip-label" lang="zh">{scene.label}</span>
    {place && <span className={`tp-place${scene.placeCarried ? " is-carried" : ""}`} lang="zh" title={scene.placeCarried ? "Carried over from the previous scene (not named in this scene)" : "Named in this scene"}>⌖ {place}</span>}
  </button>;
}

function SceneDetail({ scene, names, times, onClose, onShowInOrbit }: { scene: StoryScene; names: Map<string, string>; times: Map<string, StoryTime>; onClose: () => void; onShowInOrbit?: (sceneId: string) => void }) {
  return <aside className="tp-detail" aria-label="Scene in story time">
    <div className="tp-detail-head"><span className="eyebrow">Scene {scene.index + 1} · chapter {scene.chapterIndex}</span><button onClick={onClose} aria-label="Close scene details">×</button></div>
    <b lang="zh">{scene.label}</b>
    <dl>
      <dt>When</dt><dd>{scene.times.length ? scene.times.map((entry) => { const time = times.get(entry.id); return <span key={entry.id} lang="zh">{time?.flashback ? "↶ " : ""}{time?.label ?? entry.id} <small>{entry.via === "anchor" ? "named in this scene" : "continues from an earlier scene"}{time && dateLine(time) ? ` · ${dateLine(time)}` : ""}</small></span>; }) : "Time not stated"}</dd>
      <dt>Where</dt><dd>{scene.placeIds.length ? scene.placeIds.map((id) => <span key={id} lang="zh">{names.get(id) ?? id} <small>{scene.placeCarried ? "carried from the previous scene" : "named in this scene"}</small></span>) : "Place not named"}</dd>
      <dt>Who</dt><dd lang="zh">{scene.characterIds.length ? scene.characterIds.map((id) => names.get(id) ?? id).join("、") : "—"}</dd>
    </dl>
    {onShowInOrbit && <button className="tp-orbit-link" onClick={() => onShowInOrbit(scene.id)}>Show in orbit →</button>}
  </aside>;
}
