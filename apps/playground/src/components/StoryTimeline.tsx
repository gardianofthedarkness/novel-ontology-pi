import { Fragment, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChromeInsets } from "./useChromeInsets";
import type { AlbumPanelPicture } from "../data/albumEntries";
import { placePictures, type OrbitIllustration } from "../data/pictureNodes";
import { albumImageUrl } from "../data/albumImage";
import { calendarDay, calendarDays, calendarTimeLabel, CALENDAR_DAY, dateLine, readingJumps, scenePeriod, storyRows, universeStoryRows, type CalendarViewEntry, type StoryScene, type StoryTime, type TimePlaceProjection } from "../data/timePlace";

/**
 * Story time view: the story in the order it happens, not the order it is
 * read. With the universe calendar (one clock for every book), the calendar
 * is the axis: days run top to bottom, each period on its day at its stated
 * time or part of the day, books are coloured marks across the days, and a
 * flashback sits at its own date. Without any date it falls back to story
 * order per book. The reading ribbon keeps the reading order visible, so a
 * jump back is never hidden.
 */
interface Props {
  data: TimePlaceProjection;
  names: Map<string, string>;
  onShowInOrbit?: (sceneId: string) => void;
  pictures?: OrbitIllustration[];
  album?: AlbumPanelPicture[];
  onPicture?: (id: string) => void;
  /** Periods that just emerged live (highlighted and scrolled to). */
  emerging?: ReadonlySet<string>;
  /** Scenes Pi is touching; followed (scrolled to) while following Pi. */
  touched?: ReadonlySet<string>;
  following?: boolean;
  /** The book picker and "Pi working on …" status, as in every view. */
  bookBar?: ReactNode;
  /** Universe views: the book being read; the list glides to it and the other books recede. */
  focusBook?: number | null;
}

const hue = (index: number, total: number) => `hsl(${200 - Math.round(150 * index / Math.max(1, total - 1))} 70% 62%)`;

export function StoryTimeline({ data, names, onShowInOrbit, emerging, touched, following = false, pictures = [], album = [], onPicture, bookBar, focusBook = null }: Props) {
  const universe = data.scope === "universe";
  const rows = useMemo(() => universe ? universeStoryRows(data) : storyRows(data).map((row) => ({ ...row, book: null, continuityId: null })), [data, universe]);
  // The calendar is the axis whenever any period is on it.
  const calendar = data.calendar?.entries.length ? data.calendar : null;
  const days = useMemo(() => calendar ? calendarDays(calendar) : [], [calendar]);
  const calendarBooks = useMemo(() => (calendar?.books ?? []).filter((book) => book.span), [calendar]);
  const bookColour = (volume: number | null | undefined) => { const at = calendarBooks.findIndex((book) => book.volume === (volume ?? null)); return hue(Math.max(0, at), calendarBooks.length); };
  const dayRefs = useRef(new Map<string, HTMLElement>());
  const rowKey = (scene: StoryScene) => scenePeriod(scene) ?? (universe ? `unplaced:${scene.book}` : "unplaced");
  const bookRefs = useRef(new Map<number, HTMLElement>());
  // Universe: choosing a book glides the list to it.
  useEffect(() => {
    if (!universe || focusBook === null) return;
    const first = calendar?.entries.find((entry) => entry.book === focusBook);
    (first ? rowRefs.current.get(first.id) : bookRefs.current.get(focusBook))?.scrollIntoView({ block: "start", behavior: "smooth" });
  }, [focusBook, universe]); // eslint-disable-line react-hooks/exhaustive-deps
  const illustrations = useMemo(() => placePictures(rows.flatMap(row => row.scenes).map((scene, index) => ({ id: scene.id, chrono: index, sentenceIds: [] })), pictures).filter(placement => placement.placed), [rows, pictures]);
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
    if (scene) rowRefs.current.get(rowKey(scene))?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [touched, following]); // eslint-disable-line react-hooks/exhaustive-deps
  // The reading-order ribbon follows one book (the chosen one, in a universe).
  const reading = [...data.scenes].filter((scene) => !universe || focusBook === null || scene.book === focusBook).sort((first, second) => first.index - second.index);
  const colourOf = (scene: StoryScene) => {
    const time = timeById.get(scenePeriod(scene) ?? "");
    return !time ? "var(--tp-unplaced)" : time.flashback ? "var(--tp-flashback)" : hue(time.storyIndex, data.times.length);
  };
  const jumpTo = (scene: StoryScene) => {
    setSelected(scene);
    rowRefs.current.get(rowKey(scene))?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  };
  const sceneById = useMemo(() => new Map(data.scenes.map((scene) => [scene.id, scene])), [data]);
  const unplacedScenes = useMemo(() => calendar ? data.scenes.filter((scene) => !scene.times.length || !scene.times.some((entry) => calendar.entries.some((item) => item.id === entry.id))).sort((first, second) => (first.book ?? 0) - (second.book ?? 0) || first.index - second.index) : [], [data, calendar]);
  /** One period on the calendar: its time of day, its book's mark colour, its scenes. */
  const calendarRow = (entry: CalendarViewEntry, time: StoryTime | null, scenes: StoryScene[]) => {
    const host = time?.toldFromId ? timeById.get(time.toldFromId) : undefined;
    const away = universe && focusBook !== null && entry.book !== focusBook;
    const book = calendar?.books.find((item) => item.volume === entry.book);
    const between = entry.placed === "between" ? `between ${calendarDayLabelShort(entry.span.start)} and ${calendarDayLabelShort(entry.span.end)}` : null;
    return <li key={entry.id} ref={(element) => { if (element) rowRefs.current.set(entry.id, element); }} className={`tp-row${entry.flashback ? " is-flashback" : ""}${entry.placed === "between" ? " is-between" : ""}${time?.proposed ? " is-proposed" : ""}${emerging?.has(entry.id) ? " is-emerging" : ""}${away ? " is-other-book" : ""}`} style={{ ["--tp-row" as string]: bookColour(entry.book) }}>
      <div className="tp-row-head">
        <span className="tp-dot" aria-hidden="true" />
        <span className="tp-clock" title={entry.placed === "derived" ? "Derived from stated words" : entry.placed === "between" ? "No date of its own: between its dated neighbours" : "Stated in the text"}>{calendarTimeLabel(entry) || "—"}</span>
        <div className="tp-row-title">
          <b lang="zh">{entry.flashback ? "↶ " : ""}{entry.label}{time?.proposed && <em className="tp-proposed">proposed · awaiting review</em>}</b>
          <span className="tp-date">{between ?? (time ? dateLine(time) || time.gloss : "")}</span>
        </div>
        {universe && book && <span className="tp-book-chip" style={{ background: bookColour(entry.book) }} lang="zh" title={book.title}>{book.readingOrder !== null ? `Book ${book.readingOrder}` : book.title}</span>}
        <span className="tp-meta">{time ? `ch ${time.chapterIndex} · ` : ""}{scenes.length} scene{scenes.length === 1 ? "" : "s"}</span>
      </div>
      {entry.flashback && time && <p className="tp-told">Flashback{host ? <> told during <b lang="zh">{host.label}</b> (ch {host.chapterIndex})</> : ""} · Jev {Math.round(time.flashbackProbability * 100)}% sure it goes back in time</p>}
      <div className="tp-scenes">{scenes.map((scene) => <Fragment key={scene.id}><SceneChip scene={scene} names={names} touched={!!touched?.has(scene.id)} selected={selected?.id === scene.id} anchor={!!time && scene.times.some((item) => item.id === time.id && item.via === "anchor")} onClick={() => setSelected(scene)} />{illustrations.filter(picture => picture.prevSceneId === scene.id).map(picture => <button key={picture.pictureId} className="tp-illustration" aria-label={`Open album picture ${picture.pictureId}`} onClick={() => onPicture?.(picture.pictureId)}><img src={albumImageUrl(picture.asset, window.location.href) ?? undefined} referrerPolicy="no-referrer" alt={album.find(item => item.id === picture.pictureId)?.label ?? "Illustration"} /><span>Illustration · {picture.pictureId}</span></button>)}</Fragment>)}</div>
    </li>;
  };
  if (!data.available) return <div className="tp-empty" style={insets}>{bookBar}<b>No story time yet</b><span>Run the time-place faculty for this book (<code>novel timeplace run</code>) and approve its changeset to see the story in time order.</span></div>;
  return <section className="tp-view tp-story" aria-label="Story timeline" style={insets}>
    {bookBar}
    <header className="tp-head">
      <div><span className="eyebrow">{calendar ? `Story time · calendar${universe ? ` · ${data.universe?.title ?? ""}` : ""}` : universe ? `Story time · universe · ${data.universe?.title ?? ""} · ${data.books?.length ?? 0} books` : "Story time"}</span><b>{calendar ? `${days.length} day${days.length === 1 ? "" : "s"} · ` : ""}{data.times.length} time period{data.times.length === 1 ? "" : "s"}{flashbacks ? ` · ${flashbacks} flashback${flashbacks === 1 ? "" : "s"}` : ""}{proposed ? ` · ${proposed} proposed, awaiting review` : ""}</b></div>
      <p>{calendar ? <>One clock for every book. Each period sits on its day, at its stated time or part of the day; an undated one between its dated neighbours. Books are the coloured marks; a flashback sits at its own date. Years nobody states count from the first dated book.{calendar.questions ? <> <em className="tp-cal-question">{calendar.questions} year question{calendar.questions === 1 ? "" : "s"} awaiting review.</em></> : ""}</> : <>{universe ? "Each continuity keeps its own clock; books follow their reading order. " : ""}Earliest at the top. A period starts at a time word in the text and lasts until the next; order is estimated from the text, and dates marked <i>derived</i> are calculated from stated words, never guessed.</>}</p>
    </header>
    {calendar && <CalendarMarks days={days.map((day) => day.key)} books={calendarBooks} colour={bookColour} focus={focusBook} onBook={(volume) => { const first = calendar.entries.find((entry) => entry.book === volume); if (first) rowRefs.current.get(first.id)?.scrollIntoView({ block: "start", behavior: "smooth" }); }} onDay={(key) => dayRefs.current.get(key)?.scrollIntoView({ block: "start", behavior: "smooth" })} />}
    <div className="tp-ribbon" role="list" aria-label="Reading order: each scene coloured by its story period">
      <span className="tp-ribbon-label">Reading order →</span>
      <div className="tp-ribbon-cells">{reading.map((scene) => <button key={scene.id} role="listitem" className={`tp-cell${selected?.id === scene.id ? " is-selected" : ""}${jumps.has(scene.id) ? " is-jump" : ""}`} style={{ background: colourOf(scene) }} title={`${scene.label} — ${timeById.get(scenePeriod(scene) ?? "")?.label ?? "time not stated"}`} aria-label={`Scene ${scene.index + 1}, chapter ${scene.chapterIndex}: ${scene.label}`} onClick={() => jumpTo(scene)} />)}</div>
    </div>
    {calendar ? <ol className="tp-spine is-calendar">
      {days.flatMap((day) => [
        <li key={`day:${day.key}`} ref={(element) => { if (element) dayRefs.current.set(day.key, element); }} className="tp-day-marker" role="presentation"><b>{day.label}</b><span>{[...new Set(day.entries.map((entry) => calendar.books.find((book) => book.volume === entry.book)?.title ?? ""))].filter(Boolean).join(" · ")}</span></li>,
        ...day.entries.map((entry) => { const time = timeById.get(entry.id) ?? null; return calendarRow(entry, time, time ? time.sceneIds.map((id) => sceneById.get(id)!).filter(Boolean).sort((first, second) => first.index - second.index) : []); }),
      ])}
      {unplacedScenes.length > 0 && <li key="unplaced" ref={(element) => { if (element) rowRefs.current.set("unplaced", element); }} className="tp-row is-unplaced"><div className="tp-row-head"><span className="tp-dot" aria-hidden="true" /><div className="tp-row-title"><b>Time not stated</b><span className="tp-date">not on the calendar: before the first time word, or a book with no dates yet</span></div><span className="tp-meta">{unplacedScenes.length} scene{unplacedScenes.length === 1 ? "" : "s"}</span></div><div className="tp-scenes">{unplacedScenes.map((scene) => <SceneChip key={scene.id} scene={scene} names={names} touched={!!touched?.has(scene.id)} selected={selected?.id === scene.id} anchor={false} onClick={() => setSelected(scene)} />)}</div></li>}
    </ol> : <ol className="tp-spine">
      {rows.flatMap(({ time, scenes, book, continuityId }, index) => {
        const host = time?.toldFromId ? timeById.get(time.toldFromId) : undefined;
        const key = time?.id ?? (universe ? `unplaced:${book}` : "unplaced");
        const previous = rows[index - 1];
        const headings = [];
        if (universe && (index === 0 || previous.continuityId !== continuityId)) headings.push(<li key={`continuity:${continuityId}`} className="tp-continuity" role="presentation"><span className="eyebrow">Continuity</span><b>{data.continuities?.find((entry) => entry.id === continuityId)?.title ?? "No continuity"}</b></li>);
        if (universe && book !== null && (index === 0 || previous.book !== book)) { const entry = data.books?.find((item) => item.volume === book); headings.push(<li key={`book:${book}`} ref={(element) => { if (element) bookRefs.current.set(book, element); }} className={`tp-book-marker${focusBook === book ? " is-focus" : ""}`} role="presentation"><span>Book {entry?.readingOrder ?? book}</span><b lang="zh">{entry?.title ?? `Volume ${book}`}</b></li>); }
        const away = universe && focusBook !== null && book !== focusBook;
        return [...headings, <li key={key} ref={(element) => { if (element) rowRefs.current.set(key, element); }} className={`tp-row${time?.flashback ? " is-flashback" : ""}${!time ? " is-unplaced" : ""}${time?.proposed ? " is-proposed" : ""}${time && emerging?.has(time.id) ? " is-emerging" : ""}${away ? " is-other-book" : ""}`} style={time && !time.flashback ? { ["--tp-row" as string]: hue(time.storyIndex, data.times.length) } : undefined}>
          <div className="tp-row-head">
            <span className="tp-dot" aria-hidden="true" />
            <div className="tp-row-title">
              {time ? <><b lang="zh">{time.flashback ? "↶ " : ""}{time.label}{time.proposed && <em className="tp-proposed">proposed · awaiting review</em>}</b><span className="tp-date">{dateLine(time) || time.gloss}</span></> : <><b>Time not stated</b><span className="tp-date">before the first time word in the text</span></>}
            </div>
            <span className="tp-meta">{time ? `ch ${time.chapterIndex} · ` : ""}{scenes.length} scene{scenes.length === 1 ? "" : "s"}</span>
          </div>
          {time?.flashback && <p className="tp-told">Flashback{host ? <> told during <b lang="zh">{host.label}</b> (ch {host.chapterIndex})</> : ""} · Jev {Math.round(time.flashbackProbability * 100)}% sure it goes back in time</p>}
          <div className="tp-scenes">{scenes.map((scene) => <Fragment key={scene.id}><SceneChip scene={scene} names={names} touched={!!touched?.has(scene.id)} selected={selected?.id === scene.id} anchor={!!time && scene.times.some((entry) => entry.id === time.id && entry.via === "anchor")} onClick={() => setSelected(scene)} />{illustrations.filter(picture => picture.prevSceneId === scene.id).map(picture => <button key={picture.pictureId} className="tp-illustration" aria-label={`Open album picture ${picture.pictureId}`} onClick={() => onPicture?.(picture.pictureId)}><img src={albumImageUrl(picture.asset, window.location.href) ?? undefined} referrerPolicy="no-referrer" alt={album.find(entry => entry.id === picture.pictureId)?.label ?? "Illustration"} /><span>Illustration · {picture.pictureId}</span></button>)}</Fragment>)}</div>
        </li>];
      })}
    </ol>}
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

const calendarDayLabelShort = (minute: number) => { const day = calendarDay(minute); return `${day.month}-${day.day}`; };

/**
 * The books as marks on the calendar: one bar per book across the days it
 * covers, under a day axis. Choosing a mark or a day glides the list there.
 */
function CalendarMarks({ days, books, colour, focus, onBook, onDay }: { days: string[]; books: NonNullable<TimePlaceProjection["calendar"]>["books"]; colour: (volume: number | null) => string; focus: number | null; onBook: (volume: number | null) => void; onDay: (key: string) => void }) {
  const starts = days.map((key) => { const [year, month, day] = key.split("-").map(Number); return ((year * 12 + (month - 1)) * 31 + (day - 1)) * CALENDAR_DAY; });
  const low = Math.min(...starts, ...books.map((book) => book.span!.start)), high = Math.max(...starts.map((start) => start + CALENDAR_DAY), ...books.map((book) => book.span!.end));
  const at = (minute: number) => `${(100 * (minute - low)) / Math.max(1, high - low)}%`;
  const width = (span: { start: number; end: number }) => `${Math.max(2.5, (100 * (span.end - span.start)) / Math.max(1, high - low))}%`;
  return <div className="tp-cal" aria-label="Books on the calendar">
    <div className="tp-cal-axis">{days.map((key, index) => <button key={key} className="tp-cal-day" style={{ left: at(starts[index]), width: `${(100 * CALENDAR_DAY) / Math.max(1, high - low)}%` }} onClick={() => onDay(key)} title={`Go to ${key}`}>{calendarDayLabelShort(starts[index])}</button>)}</div>
    <div className="tp-cal-marks" role="list">{books.map((book) => <button key={book.sourceId} role="listitem" className={`tp-cal-mark${focus !== null && focus === book.volume ? " is-focus" : ""}`} style={{ left: at(book.span!.start), width: width(book.span!), background: colour(book.volume) }} onClick={() => onBook(book.volume)} title={`${book.title}${book.year !== null ? ` · Year ${book.year}${book.yearBy === "pending" ? " (awaiting review)" : ""}` : ""}`} lang="zh"><span>{book.readingOrder !== null ? `${book.readingOrder} · ` : ""}{book.title}</span></button>)}</div>
  </div>;
}
