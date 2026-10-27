import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChromeInsets } from "./useChromeInsets";
import { characterTrack, dateLine, placeLinks, placePathLabel, placeTreeLayout, whereDuring, type TimePlaceProjection } from "../data/timePlace";

/**
 * Places view (time-place faculty): a schematic map — no geography — of the
 * named places scenes happen in, nested by the place tree: a place that
 * contains others is a region drawn around them (dashed while its link is
 * only proposed). Busy places are larger; lines are moves between
 * consecutive scenes. Pick a character
 * to trace their route in story order (dashed where a scene did not name
 * its place and the previous scene's place was carried over); slide through
 * story time to see who is where.
 */
interface Props { data: TimePlaceProjection; names: Map<string, string>; /** Places that just emerged live. */ emerging?: ReadonlySet<string>; /** The book picker and "Pi working on …" status, as in every view. */ bookBar?: ReactNode; /** Universe views: the book being read; the map glides to its places. */ focusBook?: number | null }

const SIZE = 600;
const initials = (name: string) => [...name.replace(/[·・\s]/g, "")].slice(0, 2).join("");

export function PlaceMap({ data, names, emerging, bookBar, focusBook = null }: Props) {
  const universe = data.scope === "universe";
  const insets = useChromeInsets();
  const links = useMemo(() => placeLinks(data), [data]);
  const layout = useMemo(() => placeTreeLayout(data.places, links, SIZE), [data.places, links]);
  const placeById = useMemo(() => new Map(data.places.map((place) => [place.id, place])), [data.places]);
  const pathLabel = (id: string) => placePathLabel(placeById.get(id), names);
  const pathOf = (id: string) => placeById.get(id)?.path ?? [id];
  /** Where a place's own scenes, moves and routes attach. */
  const spot = (id: string) => { const point = layout.get(id); return point ? { x: point.spotX, y: point.spotY, r: point.region ? 6 : point.r } : undefined; };
  const regions = data.places.filter((place) => layout.get(place.id)?.region).sort((first, second) => (layout.get(first.id)!.depth - layout.get(second.id)!.depth));
  // Universe: the chosen book's places (and the regions holding them) stay bright; the map glides to them.
  const bookPlaces = useMemo(() => {
    if (!universe || focusBook === null) return null;
    const ids = new Set<string>();
    for (const scene of data.scenes.filter((entry) => entry.book === focusBook)) for (const id of scene.placeIds) for (const step of placeById.get(id)?.path ?? [id]) ids.add(step);
    return ids;
  }, [universe, focusBook, data.scenes, placeById]);
  const [wholeUniverse, setWholeUniverse] = useState(false);
  useEffect(() => setWholeUniverse(false), [focusBook]);
  const targetBox = useMemo(() => {
    const leaves = bookPlaces && !wholeUniverse ? [...bookPlaces].filter((id) => !layout.get(id)?.region || placeById.get(id)?.sceneIds.length) : [];
    if (!leaves.length) return [0, 0, SIZE, SIZE];
    const points = leaves.map((id) => layout.get(id)).filter((point): point is NonNullable<typeof point> => !!point);
    const [minX, maxX] = [Math.min(...points.map((point) => point.x - point.r)) - 60, Math.max(...points.map((point) => point.x + point.r)) + 60];
    const [minY, maxY] = [Math.min(...points.map((point) => point.y - point.r)) - 60, Math.max(...points.map((point) => point.y + point.r)) + 70];
    const side = Math.min(SIZE, Math.max(220, maxX - minX, maxY - minY));
    const cx = (minX + maxX) / 2, cy = (minY + maxY) / 2;
    return [Math.max(0, Math.min(SIZE - side, cx - side / 2)), Math.max(0, Math.min(SIZE - side, cy - side / 2)), side, side];
  }, [bookPlaces, wholeUniverse, layout, placeById]);
  const [box, setBox] = useState(targetBox);
  const boxRef = useRef(box); boxRef.current = box;
  useEffect(() => {
    const from = boxRef.current, started = performance.now();
    if (from.every((value, index) => value === targetBox[index])) return;
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) { setBox(targetBox); return; }
    let frame = 0;
    const step = (now: number) => {
      const t = Math.min(1, (now - started) / 700), eased = t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
      setBox(from.map((value, index) => value + (targetBox[index] - value) * eased));
      if (t < 1) frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [targetBox]);
  const away = (id: string) => !!bookPlaces && !bookPlaces.has(id);
  const [characterId, setCharacterId] = useState<string | null>(null);
  const [timeIndex, setTimeIndex] = useState<number | null>(null);
  const track = useMemo(() => characterId ? characterTrack(data, characterId) : [], [data, characterId]);
  const time = timeIndex === null ? null : data.times[timeIndex] ?? null;
  const present = useMemo(() => time ? whereDuring(data, time.id) : new Map<string, { placeId: string; carried: boolean }>(), [data, time]);
  const unnamed = data.scenes.filter((scene) => !scene.placeIds.length).length;
  const maxLink = Math.max(1, ...links.map((link) => link.count));
  if (!data.places.length) return <div className="tp-empty" style={insets}>{bookBar}<b>No places yet</b><span>Run the time-place faculty for this book and approve its changeset to map where scenes happen.</span></div>;
  const occupants = new Map<string, { id: string; carried: boolean }[]>();
  for (const [id, where] of present) occupants.set(where.placeId, [...(occupants.get(where.placeId) ?? []), { id, carried: where.carried }]);
  return <section className="tp-view tp-places" aria-label="Location map" style={insets}>
    {bookBar}
    <header className="tp-head">
      <div><span className="eyebrow">{universe ? `Places · universe · ${data.universe?.title ?? ""} · ${data.books?.length ?? 0} books · schematic` : "Places · schematic, not geographic"}</span><b>{data.places.length} named place{data.places.length === 1 ? "" : "s"}{regions.length ? ` · ${regions.length} containing others` : ""} · {data.scenes.length - unnamed} of {data.scenes.length} scenes placed</b></div>
      <p>A place inside another sits within its circle (dashed while that link is only proposed). Solid dot: the scene names its place. Dashed: carried over from the previous scene in the same chapter.{unnamed ? ` ${unnamed} scene${unnamed === 1 ? "" : "s"} name no place.` : ""}</p>
    </header>
    <div className="tp-controls">
      <div className="tp-characters" role="radiogroup" aria-label="Trace a character">
        <button role="radio" aria-checked={characterId === null} className={characterId === null ? "is-on" : ""} onClick={() => setCharacterId(null)}>Everyone</button>
        {data.characters.slice(0, 10).map((character) => <button key={character.id} role="radio" aria-checked={characterId === character.id} className={characterId === character.id ? "is-on" : ""} onClick={() => setCharacterId(character.id)} lang="zh">{character.label}</button>)}
      </div>
      {data.times.length > 0 && <label className="tp-scrub"><span>Story time</span><input type="range" min={-1} max={data.times.length - 1} step={1} value={timeIndex ?? -1} onChange={(event) => setTimeIndex(Number(event.target.value) < 0 ? null : Number(event.target.value))} aria-valuetext={time ? `${time.label} ${dateLine(time)}` : "All of the story"} /><b lang="zh">{time ? `${time.flashback ? "↶ " : ""}${time.label}${dateLine(time) ? ` · ${dateLine(time)}` : ""}` : "All of the story"}</b></label>}
    </div>
    {universe && bookPlaces && <div className="tp-map-zoom"><button aria-pressed={wholeUniverse} onClick={() => setWholeUniverse(!wholeUniverse)}>{wholeUniverse ? "Back to this book" : "Whole universe"}</button><span>{wholeUniverse ? "Every book's places" : `This book's ${[...bookPlaces].length} places; the rest of the universe fades`}</span></div>}
    <svg className="tp-map" viewBox={box.map((value) => value.toFixed(1)).join(" ")} role="img" aria-label={`Schematic map of ${data.places.length} places`}>
      <defs><marker id="tp-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="var(--tp-track)" /></marker></defs>
      {regions.map((place) => {
        const point = layout.get(place.id)!;
        const onTrack = track.some((step) => pathOf(step.placeId).includes(place.id));
        const here = [...occupants].filter(([placeId]) => pathOf(placeId).includes(place.id)).length;
        const dim = (characterId && !onTrack) || (time && !here);
        return <g key={place.id} className={`tp-region depth-${Math.min(3, point.depth)}${dim ? " is-dim" : ""}${away(place.id) ? " is-other-book" : ""}${place.proposed ? " is-proposed" : ""}${place.parentProposed ? " is-link-proposed" : ""}${emerging?.has(place.id) ? " is-emerging" : ""}`}>
          <circle cx={point.x} cy={point.y} r={point.r} />
          <text className="tp-region-label" x={point.x} y={point.y - point.r + 14} lang="zh">{place.label}{place.proposed ? " · proposed" : ""}</text>
          <text className="tp-region-count" x={point.x} y={point.y - point.r + 26}>{place.totalScenes ?? place.sceneIds.length} scene{(place.totalScenes ?? place.sceneIds.length) === 1 ? "" : "s"} inside</text>
          <title>{pathLabel(place.id)}</title>
        </g>;
      })}
      {links.map((link) => { const from = spot(link.from), to = spot(link.to); return from && to ? <line key={`${link.from}-${link.to}`} x1={from.x} y1={from.y} x2={to.x} y2={to.y} className="tp-link" strokeWidth={1 + 3 * link.count / maxLink} /> : null; })}
      {track.slice(1).map((step, index) => {
        const from = spot(track[index].placeId), to = spot(step.placeId);
        if (!from || !to) return null;
        const dx = to.x - from.x, dy = to.y - from.y, distance = Math.max(1, Math.hypot(dx, dy));
        const bend = 14 + (index % 3) * 6;
        const mx = (from.x + to.x) / 2 - dy / distance * bend, my = (from.y + to.y) / 2 + dx / distance * bend;
        const end = { x: to.x - dx / distance * (to.r + 3), y: to.y - dy / distance * (to.r + 3) };
        return <g key={index}><path d={`M${from.x},${from.y} Q${mx},${my} ${end.x},${end.y}`} className={`tp-track${step.carried ? " is-carried" : ""}`} markerEnd="url(#tp-arrow)" /><text x={mx} y={my} className="tp-step">{index + 2}</text></g>;
      })}
      {data.places.filter((place) => !layout.get(place.id)?.region || place.sceneIds.length).map((place) => {
        const tree = layout.get(place.id);
        if (!tree) return null;
        // A region's own scenes (they name only the region) gather at its spot under the label.
        const point = tree.region ? { x: tree.spotX, y: tree.spotY, r: 7 } : tree;
        const onTrack = track.some((step) => step.placeId === place.id);
        const here = occupants.get(place.id) ?? [];
        const dim = (characterId && !onTrack) || (time && !here.length);
        return <g key={place.id} className={`tp-place-node${tree.region ? " is-region-own" : ""}${dim ? " is-dim" : ""}${away(place.id) ? " is-other-book" : ""}${place.proposed ? " is-proposed" : ""}${place.parentProposed ? " is-link-proposed" : ""}${emerging?.has(place.id) ? " is-emerging" : ""}`} transform={`translate(${point.x},${point.y})`}>
          <title>{pathLabel(place.id)}</title>
          <circle r={point.r} className={place.statedScenes ? "" : "is-carried"} />
          {track[0]?.placeId === place.id && <text className="tp-step" y={-point.r - 4}>1</text>}
          {emerging?.has(place.id) && <circle r={point.r + 10} className="tp-emerge-ring" />}
          {!tree.region && <text className="tp-place-label" y={point.r + 13} lang="zh">{place.label}{place.proposed ? " · proposed" : ""}</text>}
          {!tree.region && <text className="tp-place-count" y={4}>{place.sceneIds.length}</text>}
          {here.slice(0, 6).map((occupant, index) => { const angle = -Math.PI / 2 + index * (Math.PI / 3.2); return <g key={occupant.id} transform={`translate(${Math.cos(angle) * (point.r + 11)},${Math.sin(angle) * (point.r + 11)})`} className={`tp-occupant${occupant.carried ? " is-carried" : ""}`}><circle r={9} /><text y={3} lang="zh">{initials(names.get(occupant.id) ?? "?")}</text><title>{names.get(occupant.id)}</title></g>; })}
        </g>;
      })}
    </svg>
    {time && <ul className="tp-whereabouts" aria-label={`Who is where during ${time.label}`}>
      {occupants.size ? [...occupants].sort((first, second) => second[1].length - first[1].length).map(([placeId, people]) => <li key={placeId}><b lang="zh">{pathLabel(placeId) || names.get(placeId) || placeId}</b> <span lang="zh">{people.map((person) => `${names.get(person.id) ?? person.id}${person.carried ? "*" : ""}`).join("、")}</span></li>) : <li>No placed scenes in this period.</li>}
      {[...occupants.values()].some((people) => people.some((person) => person.carried)) && <li className="tp-footnote">* place carried over from the previous scene, not named in the scene itself</li>}
    </ul>}
    {characterId && <ol className="tp-track-list" aria-label="Route in story order">
      {track.length ? track.map((step, index) => <li key={index} className={step.carried ? "is-carried" : ""}><b>{index + 1}</b> <span lang="zh">{pathLabel(step.placeId) || names.get(step.placeId) || step.placeId}</span> <small lang="zh">{step.timeLabel} · {step.sceneIds.length} scene{step.sceneIds.length === 1 ? "" : "s"}{step.carried ? " · carried" : ""}</small></li>) : <li>No placed scenes for this character yet.</li>}
    </ol>}
  </section>;
}
