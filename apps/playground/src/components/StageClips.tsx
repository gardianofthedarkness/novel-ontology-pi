import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HoloStage, replayMs, type HoloMode } from "./HoloStage";
import { preloadArchitecture } from "./ArchitectureHolograms";
import { placeScript, sentenceKey, type HoloScript } from "../data/holoScript";
import type { MovePlan } from "../data/holoNav";
import { keyedPlan, placePlan, type ReadSentence, type StagePlan } from "../data/readMode";
import { pickClips, sceneClips, type StageClip } from "../data/stageClips";
import { ARCHITECTURE_LABEL } from "../data/placeArchitecture";
import type { TimePlaceProjection } from "../data/timePlace";
import type { WorldEdge, WorldNode } from "../types";
import "../clips.css";

/**
 * Stage clips (?clips, phones too): a book's prepared animation as a reel of
 * short pieces — the scenes where the most people move, spread over its
 * buildings. Each clip replays once (about twelve seconds) with the line it
 * tells under the stage, then the next one follows unless the reader stops
 * the reel; prev/next, a swipe or the clip strip jump around, and after a
 * replay the stage is theirs to turn and scrub. View only.
 */
interface Props {
  timePlace: TimePlaceProjection | null;
  world: { interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }> };
  /** The book whose data is loaded, and the one the link asked for (null: the active one). */
  volume: number | null; requested: number | null;
  title: string;
  books: { id: number; label: string }[];
  reducedMotion: boolean;
  bookQuery: string;
  exitHref: string;
  clipsHref: (book: number) => string;
}

const CLIP_MS = 12_000;
/** The pause on a clip's last moment before the reel moves on. */
const HOLD_MS = 2_200;
const KIND_LABEL: Record<string, string> = { scene: "Scene", event: "Event", dialogue: "Dialogue", travel: "On the move" };

export function StageClips({ timePlace, world, volume, requested, title, books, reducedMotion, bookQuery, exitHref, clipsHref }: Props) {
  const [stage, setStage] = useState<StagePlan | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    setStage("loading");
    fetch(`api/stage${bookQuery}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((plan: StagePlan | null) => { if (live) setStage(plan?.places ? plan : null); }).catch(() => { if (live) setStage(null); });
    return () => { live = false; };
  }, [bookQuery]);

  // The book's stages (one per prepared place) and the clips cut from them.
  const ready = !!timePlace && stage !== "loading" && (requested === null || requested === volume);
  const { clips, stages } = useMemo(() => {
    const stages = new Map<string, { script: HoloScript; plan: MovePlan }>();
    if (!ready || !stage || !timePlace) return { clips: [] as StageClip[], stages };
    for (const key of Object.keys(stage.places)) {
      const placeId = timePlace.places.find((place) => place.id === key || place.id === `${volume}:${key}`)?.id;
      if (!placeId || stages.has(placeId)) continue;
      const script = placeScript(timePlace, world, placeId, volume);
      const plan = placePlan(stage, placeId, volume);
      if (plan && script.beats.length) stages.set(placeId, { script, plan: keyedPlan(plan, script) });
    }
    return { clips: pickClips([...stages.values()].flatMap(({ script, plan }) => sceneClips(script, plan))), stages };
  }, [ready, stage, timePlace, world, volume]);

  // The first replay waits for the building models, or it would play on an empty stage.
  const [models, setModels] = useState(false);
  useEffect(() => { let live = true; preloadArchitecture().catch(() => undefined).then(() => { if (live) setModels(true); }); return () => { live = false; }; }, []);
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [auto, setAuto] = useState(true);
  const [ended, setEnded] = useState(false);
  const [beat, setBeat] = useState<number | null>(null);
  const [mode, setMode] = useState<HoloMode>("diorama");
  useEffect(() => { setIndex(0); }, [clips]);
  const clip = clips[Math.min(index, clips.length - 1)] as StageClip | undefined;
  const shown = clip ? stages.get(clip.placeId) : undefined;
  // The clip strip keeps the clip on show in view.
  const strip = useRef<HTMLElement>(null);
  useEffect(() => { strip.current?.querySelector(".is-on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: reducedMotion ? "auto" : "smooth" }); }, [index, clips, reducedMotion]);
  const go = useCallback((next: number) => { if (!clips.length) return; setIndex(Math.max(0, Math.min(clips.length - 1, next))); setRun((count) => count + 1); setEnded(false); setBeat(null); }, [clips.length]);

  // After a clip's replay: hold its last moment, then the next clip (while the reel runs).
  useEffect(() => {
    if (!ended || !auto || index >= clips.length - 1) return;
    const timer = window.setTimeout(() => go(index + 1), HOLD_MS);
    return () => clearTimeout(timer);
  }, [ended, auto, index, clips.length, go]);

  // The text a beat tells, fetched by block (b0003_s0012 is in block 3) as clips need it.
  const blocks = useRef(new Map<number, ReadSentence[] | null>());
  const [, setLoaded] = useState(0);
  useEffect(() => { blocks.current.clear(); }, [bookQuery]);
  useEffect(() => {
    if (!clip || !shown) return;
    const glue = bookQuery ? `${bookQuery}&` : "?";
    const wanted = new Set(shown.script.beats.slice(clip.from, clip.to + 1).flatMap((entry) => entry.source ? [Math.floor(entry.source.from / 1_000_000), Math.floor(entry.source.to / 1_000_000)] : []));
    for (const number of wanted) {
      if (blocks.current.has(number)) continue;
      blocks.current.set(number, null);
      fetch(`api/book-text${glue}block=${number}`, { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ sentences: ReadSentence[] }> : null)
        .then((text) => { if (text) { blocks.current.set(number, text.sentences); setLoaded((count) => count + 1); } }).catch(() => undefined);
    }
  }, [clip, shown, bookQuery]);

  const current = shown && beat !== null ? shown.script.beats[beat] : shown && clip ? shown.script.beats[clip.from] : undefined;
  const lines = current?.source ? [...new Set([Math.floor(current.source.from / 1_000_000), Math.floor(current.source.to / 1_000_000)])].flatMap((number) => blocks.current.get(number) ?? [])
    .filter((sentence) => { const key = sentenceKey(sentence.id); return key >= current.source!.from && key <= current.source!.to; }) : [];
  const speaker = current?.actors[0] ? shown?.script.actors.find((actor) => actor.id === current.actors[0])?.label : undefined;
  const reel = clip && shown && !reducedMotion ? { key: `${clip.id}:${run}`, from: clip.from, to: clip.to, ms: CLIP_MS } : null;
  const playing = !!reel && !ended;
  const at = books.findIndex((book) => book.id === (requested ?? volume));
  const nextBook = at >= 0 ? books[at + 1] : undefined;

  // A sideways swipe on the caption flips clips (the stage itself turns on drag).
  const swipe = useRef<{ x: number; y: number } | null>(null);
  const onTouchStart = (event: React.TouchEvent) => { swipe.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; };
  const onTouchEnd = (event: React.TouchEvent) => {
    const start = swipe.current; swipe.current = null;
    if (!start) return;
    const dx = event.changedTouches[0].clientX - start.x, dy = event.changedTouches[0].clientY - start.y;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(dy) * 1.5) go(index + (dx < 0 ? 1 : -1));
  };

  return <div className="clips">
    <header className="clips-top">
      <a className="clips-back" href={exitHref}>← Archive</a>
      <div className="clips-title"><span>STAGE CLIPS</span><strong>{title}</strong></div>
      <nav className="clips-books" aria-label="Books">{books.map((book) => <a key={book.id} href={clipsHref(book.id)} className={book.id === (requested ?? volume) ? "is-on" : undefined} title={book.label}>Vol {book.id}</a>)}</nav>
    </header>
    <section className="clips-stage" aria-label="Clip">
      {clip && shown && models ? <HoloStage key={clip.placeId} script={shown.script} mode={mode} onMode={setMode} onClose={() => undefined} reducedMotion={reducedMotion} embedded
        plan={shown.plan} reel={reel} onReelEnd={() => setEnded(true)} onBeat={setBeat} initialBeat={reducedMotion ? clip.to : clip.from} autoplay={false} />
        : <div className="clips-idle"><div className="clips-ring" /><p>{!ready || (clip && !models) ? "Opening the book…" : stage ? "No scene of this book has anyone moving yet." : "This book's animation is not prepared yet."}</p></div>}
    </section>
    {clip && <section className="clips-caption" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-live="polite">
      <div className="clips-meta"><b>{index + 1} / {clips.length}</b><span>{clip.scene}</span><span>{clip.place}{clip.kind ? ` · ${ARCHITECTURE_LABEL[clip.kind]}` : ""}</span>{clip.when && <span>{clip.when}</span>}<span>{clip.movers} moving · {clip.moves} moves</span></div>
      <h2>{clip.title}</h2>
      {current && current.kind !== "scene" && <p className="clips-beat"><i>{KIND_LABEL[current.kind] ?? current.kind}</i>{current.kind === "dialogue" && speaker && <b>{speaker}: </b>}{current.text}</p>}
      {lines.length > 0 && <blockquote lang="zh">{lines.map((sentence) => sentence.text).join("")}</blockquote>}
      {playing && shown && <i className="clips-reel" key={reel!.key} style={{ animationDuration: `${replayMs(shown.script, reel!.from, reel!.to, reel!.ms)}ms` }} />}
    </section>}
    <footer className="clips-controls">
      <button onClick={() => go(index - 1)} disabled={!clip || index === 0} aria-label="Previous clip">‹</button>
      <button onClick={() => go(index)} disabled={!clip} className="clips-replay">↺ Replay</button>
      <button onClick={() => setAuto((on) => !on)} disabled={!clip} className={auto ? "is-on" : undefined} aria-pressed={auto}>{auto ? "Auto ▶" : "Auto ❚❚"}</button>
      {clip && index === clips.length - 1 && ended && nextBook ? <a className="clips-nextbook" href={clipsHref(nextBook.id)}>Vol {nextBook.id} →</a>
        : <button onClick={() => go(index + 1)} disabled={!clip || index >= clips.length - 1} aria-label="Next clip">›</button>}
    </footer>
    {clips.length > 0 && <nav className="clips-list" aria-label="Clips" ref={strip}>{clips.map((entry, at) => <button key={entry.id} className={at === index ? "is-on" : undefined} onClick={() => go(at)}><b>{at + 1}</b><span>{entry.title}</span><small>{entry.place}</small></button>)}</nav>}
  </div>;
}
