import { useMemo, useState } from "react";
import { useChromeInsets } from "./useChromeInsets";
import { characterTrack, dateLine, placeLayout, placeLinks, whereDuring, type TimePlaceProjection } from "../data/timePlace";

/**
 * Places view (time-place faculty, phase 1): a schematic map — no
 * geography — of the named places scenes happen in. Busy places sit toward
 * the centre; lines are moves between consecutive scenes. Pick a character
 * to trace their route in story order (dashed where a scene did not name
 * its place and the previous scene's place was carried over); slide through
 * story time to see who is where.
 */
interface Props { data: TimePlaceProjection; names: Map<string, string>; /** Places that just emerged live. */ emerging?: ReadonlySet<string> }

const SIZE = 600;
const initials = (name: string) => [...name.replace(/[·・\s]/g, "")].slice(0, 2).join("");

export function PlaceMap({ data, names, emerging }: Props) {
  const insets = useChromeInsets();
  const links = useMemo(() => placeLinks(data), [data]);
  const layout = useMemo(() => placeLayout(data.places, links, SIZE), [data.places, links]);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [timeIndex, setTimeIndex] = useState<number | null>(null);
  const track = useMemo(() => characterId ? characterTrack(data, characterId) : [], [data, characterId]);
  const time = timeIndex === null ? null : data.times[timeIndex] ?? null;
  const present = useMemo(() => time ? whereDuring(data, time.id) : new Map<string, { placeId: string; carried: boolean }>(), [data, time]);
  const unnamed = data.scenes.filter((scene) => !scene.placeIds.length).length;
  const maxLink = Math.max(1, ...links.map((link) => link.count));
  if (!data.places.length) return <div className="tp-empty" style={insets}><b>No places yet</b><span>Run the time-place faculty for this book and approve its changeset to map where scenes happen.</span></div>;
  const occupants = new Map<string, { id: string; carried: boolean }[]>();
  for (const [id, where] of present) occupants.set(where.placeId, [...(occupants.get(where.placeId) ?? []), { id, carried: where.carried }]);
  return <section className="tp-view tp-places" aria-label="Location map" style={insets}>
    <header className="tp-head">
      <div><span className="eyebrow">Places · schematic, not geographic</span><b>{data.places.length} named place{data.places.length === 1 ? "" : "s"} · {data.scenes.length - unnamed} of {data.scenes.length} scenes placed</b></div>
      <p>Solid: the scene names its place. Dashed: carried over from the previous scene in the same chapter.{unnamed ? ` ${unnamed} scene${unnamed === 1 ? "" : "s"} name no place.` : ""}</p>
    </header>
    <div className="tp-controls">
      <div className="tp-characters" role="radiogroup" aria-label="Trace a character">
        <button role="radio" aria-checked={characterId === null} className={characterId === null ? "is-on" : ""} onClick={() => setCharacterId(null)}>Everyone</button>
        {data.characters.slice(0, 10).map((character) => <button key={character.id} role="radio" aria-checked={characterId === character.id} className={characterId === character.id ? "is-on" : ""} onClick={() => setCharacterId(character.id)} lang="zh">{character.label}</button>)}
      </div>
      {data.times.length > 0 && <label className="tp-scrub"><span>Story time</span><input type="range" min={-1} max={data.times.length - 1} step={1} value={timeIndex ?? -1} onChange={(event) => setTimeIndex(Number(event.target.value) < 0 ? null : Number(event.target.value))} aria-valuetext={time ? `${time.label} ${dateLine(time)}` : "All of the story"} /><b lang="zh">{time ? `${time.flashback ? "↶ " : ""}${time.label}${dateLine(time) ? ` · ${dateLine(time)}` : ""}` : "All of the story"}</b></label>}
    </div>
    <svg className="tp-map" viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`Schematic map of ${data.places.length} places`}>
      <defs><marker id="tp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--tp-track)" /></marker></defs>
      {links.map((link) => { const from = layout.get(link.from), to = layout.get(link.to); return from && to ? <line key={`${link.from}-${link.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="tp-link" strokeWidth={1 + 3 * link.count / maxLink} /> : null; })}
      {track.slice(1).map((step, index) => {
        const from = layout.get(track[index].placeId), to = layout.get(step.placeId);
        if (!from || !to) return null;
        const dx = to.x - from.x, dy = to.y - from.y, distance = Math.max(1, Math.hypot(dx, dy));
        const bend = 14 + (index % 3) * 6;
        const mx = (from.x + to.x) / 2 - dy / distance * bend, my = (from.y + to.y) / 2 + dx / distance * bend;
        const end = { x: to.x - dx / distance * (to.r + 3), y: to.y - dy / distance * (to.r + 3) };
        return <g key={index}><path d={`M${from.x},${from.y} Q${mx},${my} ${end.x},${end.y}`} className={`tp-track${step.carried ? " is-carried" : ""}`} markerEnd="url(#tp-arrow)" /><text x={mx} y={my} className="tp-step">{index + 2}</text></g>;
      })}
      {data.places.map((place) => {
        const point = layout.get(place.id)!;
        const onTrack = track.some((step) => step.placeId === place.id);
        const here = occupants.get(place.id) ?? [];
        const dim = (characterId && !onTrack) || (time && !here.length);
        return <g key={place.id} className={`tp-place-node${dim ? " is-dim" : ""}${place.proposed ? " is-proposed" : ""}${emerging?.has(place.id) ? " is-emerging" : ""}`} transform={`translate(${point.x},${point.y})`}>
          <circle r={point.r} className={place.statedScenes ? "" : "is-carried"} />
          {track[0]?.placeId === place.id && <text className="tp-step" y={-point.r - 4}>1</text>}
          {emerging?.has(place.id) && <circle r={point.r + 10} className="tp-emerge-ring" />}
          <text className="tp-place-label" y={point.r + 13} lang="zh">{place.label}{place.proposed ? " · proposed" : ""}</text>
          <text className="tp-place-count" y={4}>{place.sceneIds.length}</text>
          {here.slice(0, 6).map((occupant, index) => { const angle = -Math.PI / 2 + index * (Math.PI / 3.2); return <g key={occupant.id} transform={`translate(${Math.cos(angle) * (point.r + 11)},${Math.sin(angle) * (point.r + 11)})`} className={`tp-occupant${occupant.carried ? " is-carried" : ""}`}><circle r={9} /><text y={3} lang="zh">{initials(names.get(occupant.id) ?? "?")}</text><title>{names.get(occupant.id)}</title></g>; })}
        </g>;
      })}
    </svg>
    {time && <ul className="tp-whereabouts" aria-label={`Who is where during ${time.label}`}>
      {occupants.size ? [...occupants].sort((first, second) => second[1].length - first[1].length).map(([placeId, people]) => <li key={placeId}><b lang="zh">{names.get(placeId) ?? placeId}</b> <span lang="zh">{people.map((person) => `${names.get(person.id) ?? person.id}${person.carried ? "*" : ""}`).join("、")}</span></li>) : <li>No placed scenes in this period.</li>}
      {[...occupants.values()].some((people) => people.some((person) => person.carried)) && <li className="tp-footnote">* place carried over from the previous scene, not named in the scene itself</li>}
    </ul>}
    {characterId && <ol className="tp-track-list" aria-label="Route in story order">
      {track.length ? track.map((step, index) => <li key={index} className={step.carried ? "is-carried" : ""}><b>{index + 1}</b> <span lang="zh">{names.get(step.placeId) ?? step.placeId}</span> <small lang="zh">{step.timeLabel} · {step.sceneIds.length} scene{step.sceneIds.length === 1 ? "" : "s"}{step.carried ? " · carried" : ""}</small></li>) : <li>No placed scenes for this character yet.</li>}
    </ol>}
  </section>;
}
