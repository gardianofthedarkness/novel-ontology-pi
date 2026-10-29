import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HoloStage, replayMs, type HoloMode } from "./HoloStage";
import { preloadArchitecture } from "./ArchitectureHolograms";
import { placeScript, sentenceKey, type HoloBeat, type HoloScript } from "../data/holoScript";
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
  /** The book's simulation player (novel sim run), when it has runs. */
  simulationHref?: string | null;
  simulationLabel?: string;
}

/** A clip with the stage it plays on. Clips of one `stage` share one hologram (their place's whole script). */
export interface ReelEntry { clip: StageClip; stage: string; script: HoloScript; plan: MovePlan }

/** The host's clips: the book's prepared plan (api/stage) cut into clips, with the original sentences (api/book-text) under each beat. */
export function StageClips({ timePlace, world, volume, requested, title, books, reducedMotion, bookQuery, exitHref, clipsHref, simulationHref, simulationLabel = "Simulation" }: Props) {
  const [stage, setStage] = useState<StagePlan | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    setStage("loading");
    fetch(`api/stage${bookQuery}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((plan: StagePlan | null) => { if (live) setStage(plan?.places ? plan : null); }).catch(() => { if (live) setStage(null); });
    return () => { live = false; };
  }, [bookQuery]);

  // The book's stages (one per prepared place) and the clips cut from them.
  const ready = !!timePlace && stage !== "loading" && (requested === null || requested === volume);
  const entries = useMemo(() => {
    if (!ready || !stage || !timePlace) return [];
    const stages = new Map<string, { script: HoloScript; plan: MovePlan }>();
    for (const key of Object.keys(stage.places)) {
      const placeId = timePlace.places.find((place) => place.id === key || place.id === `${volume}:${key}`)?.id;
      if (!placeId || stages.has(placeId)) continue;
      const script = placeScript(timePlace, world, placeId, volume);
      const plan = placePlan(stage, placeId, volume);
      if (plan && script.beats.length) stages.set(placeId, { script, plan: keyedPlan(plan, script) });
    }
    return pickClips([...stages.values()].flatMap(({ script, plan }) => sceneClips(script, plan))).map((clip): ReelEntry => ({ clip, stage: clip.placeId, ...stages.get(clip.placeId)! }));
  }, [ready, stage, timePlace, world, volume]);

  // The text a beat tells, fetched by block (b0003_s0012 is in block 3) as clips need it.
  const blocks = useRef(new Map<number, ReadSentence[] | null>());
  const [, setLoaded] = useState(0);
  useEffect(() => { blocks.current.clear(); }, [bookQuery]);
  const onShow = useCallback((entry: ReelEntry) => {
    const glue = bookQuery ? `${bookQuery}&` : "?";
    const wanted = new Set(entry.script.beats.slice(entry.clip.from, entry.clip.to + 1).flatMap((beat) => beat.source ? [Math.floor(beat.source.from / 1_000_000), Math.floor(beat.source.to / 1_000_000)] : []));
    for (const number of wanted) {
      if (blocks.current.has(number)) continue;
      blocks.current.set(number, null);
      fetch(`api/book-text${glue}block=${number}`, { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ sentences: ReadSentence[] }> : null)
        .then((text) => { if (text) { blocks.current.set(number, text.sentences); setLoaded((count) => count + 1); } }).catch(() => undefined);
    }
  }, [bookQuery]);
  const linesOf = (beat: HoloBeat) => beat.source ? [...new Set([Math.floor(beat.source.from / 1_000_000), Math.floor(beat.source.to / 1_000_000)])].flatMap((number) => blocks.current.get(number) ?? [])
    .filter((sentence) => { const key = sentenceKey(sentence.id); return key >= beat.source!.from && key <= beat.source!.to; }).map((sentence) => sentence.text) : [];

  return <ClipReel entries={entries} eyebrow="STAGE CLIPS" title={title} books={books} book={requested ?? volume} bookHref={clipsHref} exit={{ href: exitHref, label: "← Archive" }} extra={simulationHref ? { href: simulationHref, label: simulationLabel } : undefined} reducedMotion={reducedMotion}
    status={!ready ? "Opening the book…" : stage ? "No scene of this book has anyone moving yet." : "This book's animation is not prepared yet."} linesOf={linesOf} onShow={onShow} />;
}

const CLIP_MS = 12_000;
/** The pause on a clip's last moment before the reel moves on. */
const HOLD_MS = 2_200;
const KIND_LABEL: Record<string, string> = { scene: "Scene", event: "Event", dialogue: "Dialogue", travel: "On the move" };

interface ReelProps {
  entries: ReelEntry[];
  eyebrow: string; title: string;
  books: { id: number; label: string }[]; book: number | null;
  /** Books open as links (the host's pages) or, without bookHref, switch in place. */
  bookHref?: (book: number) => string; onBook?: (book: number) => void;
  exit?: { href: string; label: string };
  /** One more link in the header (the book's simulation). */
  extra?: { href: string; label: string };
  /** Shown on the stage when there is no clip. */
  status: string;
  reducedMotion: boolean;
  /** The original sentences a beat tells, when the host serves the text; onShow asks for a clip's. */
  linesOf?: (beat: HoloBeat) => string[];
  onShow?: (entry: ReelEntry) => void;
}

/** The clip player: one hologram, the caption under it, controls and the clip strip. */
export function ClipReel({ entries, eyebrow, title, books, book, bookHref, onBook, exit, extra, status, reducedMotion, linesOf, onShow }: ReelProps) {
  // The first replay waits for the building models, or it would play on an empty stage.
  const [models, setModels] = useState(false);
  useEffect(() => { let live = true; preloadArchitecture().catch(() => undefined).then(() => { if (live) setModels(true); }); return () => { live = false; }; }, []);
  const [index, setIndex] = useState(0);
  const [run, setRun] = useState(0);
  const [auto, setAuto] = useState(true);
  const [ended, setEnded] = useState(false);
  const [beat, setBeat] = useState<number | null>(null);
  const [mode, setMode] = useState<HoloMode>("diorama");
  useEffect(() => { setIndex(0); setEnded(false); setBeat(null); }, [entries]);
  const entry = entries[Math.min(index, entries.length - 1)] as ReelEntry | undefined;
  const clip = entry?.clip;
  useEffect(() => { if (entry) onShow?.(entry); }, [entry, onShow]);
  // The clip strip keeps the clip on show in view.
  const strip = useRef<HTMLElement>(null);
  useEffect(() => { strip.current?.querySelector(".is-on")?.scrollIntoView({ block: "nearest", inline: "center", behavior: reducedMotion ? "auto" : "smooth" }); }, [index, entries, reducedMotion]);
  const go = useCallback((next: number) => { if (!entries.length) return; setIndex(Math.max(0, Math.min(entries.length - 1, next))); setRun((count) => count + 1); setEnded(false); setBeat(null); }, [entries.length]);

  // After a clip's replay: hold its last moment, then the next clip (while the reel runs).
  useEffect(() => {
    if (!ended || !auto || index >= entries.length - 1) return;
    const timer = window.setTimeout(() => go(index + 1), HOLD_MS);
    return () => clearTimeout(timer);
  }, [ended, auto, index, entries.length, go]);

  const current = entry && beat !== null ? entry.script.beats[beat] : entry && clip ? entry.script.beats[clip.from] : undefined;
  const lines = current && linesOf ? linesOf(current) : [];
  const speaker = current?.actors[0] ? entry?.script.actors.find((actor) => actor.id === current.actors[0])?.label : undefined;
  // One reel object per clip run: the stage's beat timer restarts only for a new replay, not on every caption update.
  const reel = useMemo(() => clip && !reducedMotion ? { key: `${clip.id}:${run}`, from: clip.from, to: clip.to, ms: CLIP_MS } : null, [clip, run, reducedMotion]);
  const reelEnded = useCallback(() => setEnded(true), []);
  const playing = !!reel && !ended;
  const at = books.findIndex((entry) => entry.id === book);
  const nextBook = at >= 0 ? books[at + 1] : undefined;
  const bookLink = (target: { id: number; label: string }, className: string | undefined, label: string) => bookHref
    ? <a key={target.id} href={bookHref(target.id)} className={className} title={target.label}>{label}</a>
    : <button key={target.id} onClick={() => onBook?.(target.id)} className={className} title={target.label}>{label}</button>;

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
      {exit && <a className="clips-back" href={exit.href}>{exit.label}</a>}
      <div className="clips-title"><span>{eyebrow}</span><strong>{title}</strong></div>
      {extra && <a className="clips-extra" href={extra.href}>{extra.label}</a>}
      <nav className="clips-books" aria-label="Books">{books.map((entry) => bookLink(entry, entry.id === book ? "is-on" : undefined, `Vol ${entry.id}`))}</nav>
    </header>
    <section className="clips-stage" aria-label="Clip">
      {entry && clip && models ? <HoloStage key={entry.stage} script={entry.script} mode={mode} onMode={setMode} onClose={() => undefined} reducedMotion={reducedMotion} embedded
        plan={entry.plan} reel={reel} onReelEnd={reelEnded} onBeat={setBeat} initialBeat={reducedMotion ? clip.to : clip.from} seek={`${clip.id}:${run}`} autoplay={false} />
        : <div className="clips-idle"><div className="clips-ring" /><p>{clip && !models ? "Opening the book…" : status}</p></div>}
    </section>
    {entry && clip && <section className="clips-caption" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd} aria-live="polite">
      <div className="clips-meta"><b>{index + 1} / {entries.length}</b><span>{clip.scene}</span><span>{clip.place}{clip.kind ? ` · ${ARCHITECTURE_LABEL[clip.kind]}` : ""}</span>{clip.when && <span>{clip.when}</span>}<span>{clip.movers} moving · {clip.moves} moves</span></div>
      <h2>{clip.title}</h2>
      {current && current.kind !== "scene" && <p className="clips-beat"><i>{KIND_LABEL[current.kind] ?? current.kind}</i>{current.kind === "dialogue" && speaker && <b>{speaker}: </b>}{current.text}</p>}
      {lines.length > 0 && <blockquote lang="zh">{lines.join("")}</blockquote>}
      {playing && <i className="clips-reel" key={reel!.key} style={{ animationDuration: `${replayMs(entry.script, reel!.from, reel!.to, reel!.ms)}ms` }} />}
    </section>}
    <footer className="clips-controls">
      <button onClick={() => go(index - 1)} disabled={!clip || index === 0} aria-label="Previous clip">‹</button>
      <button onClick={() => go(index)} disabled={!clip} className="clips-replay">↺ Replay</button>
      <button onClick={() => setAuto((on) => !on)} disabled={!clip} className={auto ? "is-on" : undefined} aria-pressed={auto}>{auto ? "Auto ▶" : "Auto ❚❚"}</button>
      {clip && index === entries.length - 1 && ended && nextBook ? bookLink(nextBook, "clips-nextbook", `Vol ${nextBook.id} →`)
        : <button onClick={() => go(index + 1)} disabled={!clip || index >= entries.length - 1} aria-label="Next clip">›</button>}
    </footer>
    {entries.length > 0 && <nav className="clips-list" aria-label="Clips" ref={strip}>{entries.map((item, at) => <button key={item.clip.id} className={at === index ? "is-on" : undefined} onClick={() => go(at)}><b>{at + 1}</b><span>{item.clip.title}</span><small>{item.clip.place}</small></button>)}</nav>}
  </div>;
}
