import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { HoloStage, replayMs, type HoloMode } from "./HoloStage";
import { placeScript, sentenceKey, type HoloScript } from "../data/holoScript";
import { keyedPlan, pageScene, paginate, placePlan, reelWindow, sceneSpans, type ReadPage, type ReadSentence, type StagePlan } from "../data/readMode";
import { ARCHITECTURE_LABEL } from "../data/placeArchitecture";
import type { TimePlaceProjection } from "../data/timePlace";
import type { WorldEdge, WorldNode } from "../types";
import "../read.css";

/**
 * Read mode (desktop): the book's text in a reading panel, its places
 * replayed beside it. Resting on a page (no scrolling for a moment) wakes
 * that page's hooks: the scenes it tells replay once in the place's
 * hologram, squeezed into about ten seconds, with the sentences being
 * played lit in the text; then the stage is the reader's to turn, scrub and
 * click. Fast scrolling wakes nothing, and the hologram draws no frames
 * while it is still. Animation comes from the book's prepared plan (novel
 * stage prep, the last step of the analysis); without it the text reads on
 * its own. View only: nothing here writes to the archive.
 */
interface Props {
  timePlace: TimePlaceProjection | null;
  world: { interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }> };
  volume: number | null;
  title: string;
  reducedMotion: boolean;
  /** `?volume=N` for the book on show, or "" for the active one. */
  bookQuery: string;
  exitHref: string;
  /** The book's simulation player (novel sim run), when it has runs. */
  simulationHref?: string | null;
  simulationLabel?: string;
}

const REEL_MS = 10_000;
/** How long the text must rest before a page's hooks wake. */
const SETTLE_MS = 750;

type Show = { page: number; placeId: string | null; sceneIds: string[]; window: { from: number; to: number } | null; reel: { key: string; from: number; to: number; ms: number } | null };

const Page = memo(function Page({ page, focused, lit }: { page: ReadPage; focused: boolean; lit: { from: number; to: number } | null }) {
  return <article className={`read-page${focused ? " is-focused" : ""}`} data-page={page.index}>
    <header><span>{page.index + 1}</span></header>
    {page.paragraphs.map((paragraph, at) => <p key={paragraph[0].id} className={at === 0 && !paragraph[0].paragraph ? "is-continued" : undefined}>
      {paragraph.map((sentence) => { const key = sentenceKey(sentence.id); return <span key={sentence.id} className={lit && key >= lit.from && key <= lit.to ? "is-lit" : undefined}>{sentence.text}</span>; })}
    </p>)}
  </article>;
});

export function ReadMode({ timePlace, world, volume, title, reducedMotion, bookQuery, exitHref, simulationHref, simulationLabel = "Simulation" }: Props) {
  // The text, block by block (a block is one source file of the book).
  const [blocks, setBlocks] = useState<ReadSentence[][]>([]);
  const [textState, setTextState] = useState<"loading" | "ready" | "missing">("loading");
  useEffect(() => {
    let live = true;
    const glue = bookQuery ? `${bookQuery}&` : "?";
    (async () => {
      const first = await fetch(`api/book-text${glue}block=0`, { cache: "no-store" }).then((response) => response.ok ? response.json() as Promise<{ blocks: number; sentences: ReadSentence[] }> : null).catch(() => null);
      if (!live) return;
      if (!first) { setTextState("missing"); return; }
      const loaded: ReadSentence[][] = [first.sentences];
      setBlocks([...loaded]);
      setTextState("ready");
      for (let block = 1; block < first.blocks && live; block++) {
        const response = await fetch(`api/book-text${glue}block=${block}`, { cache: "no-store" }).catch(() => null);
        if (!live || !response) break;
        // A block the host does not have (404) is skipped; any other failure stops loading.
        if (response.status === 404) continue;
        const next = response.ok ? await (response.json() as Promise<{ sentences: ReadSentence[] }>).catch(() => null) : null;
        if (!live || !next) break;
        loaded.push(next.sentences);
        setBlocks([...loaded]);
      }
    })();
    return () => { live = false; };
  }, [bookQuery]);

  // The prepared animation (null: not prepared yet).
  const [stage, setStage] = useState<StagePlan | null | "loading">("loading");
  useEffect(() => {
    let live = true;
    fetch(`api/stage${bookQuery}`, { cache: "no-store" }).then((response) => response.ok ? response.json() : null).then((plan: StagePlan | null) => { if (live) setStage(plan?.places ? plan : null); }).catch(() => { if (live) setStage(null); });
    return () => { live = false; };
  }, [bookQuery]);

  const pages = useMemo(() => paginate(blocks.flat()), [blocks]);
  const spans = useMemo(() => timePlace ? sceneSpans(timePlace, world) : [], [timePlace, world]);
  const scripts = useRef(new Map<string, HoloScript>());
  useEffect(() => { scripts.current.clear(); }, [timePlace, world]);
  const scriptFor = useCallback((placeId: string) => {
    if (!timePlace) return null;
    if (!scripts.current.has(placeId)) scripts.current.set(placeId, placeScript(timePlace, world, placeId, volume));
    return scripts.current.get(placeId)!;
  }, [timePlace, world, volume]);

  // Which page the reader is on: the one under the reading line, once the text rests.
  const panel = useRef<HTMLDivElement>(null);
  const [focus, setFocus] = useState(0);
  const [settled, setSettled] = useState<number | null>(null);
  const played = useRef(new Set<number>());
  useEffect(() => {
    const element = panel.current;
    if (!element) return;
    let frame = 0, timer = 0;
    const measure = () => {
      frame = 0;
      const line = element.scrollTop + element.clientHeight * 0.32;
      const articles = element.querySelectorAll<HTMLElement>(".read-page");
      let found = 0;
      for (const article of articles) { if (article.offsetTop <= line) found = Number(article.dataset.page); else break; }
      setFocus(found);
      clearTimeout(timer);
      timer = window.setTimeout(() => setSettled(found), SETTLE_MS);
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    element.addEventListener("scroll", onScroll, { passive: true });
    measure();
    return () => { element.removeEventListener("scroll", onScroll); cancelAnimationFrame(frame); clearTimeout(timer); };
  }, [pages.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps -- measure once pages exist; scrolling drives the rest

  // A rested page wakes its hooks: its place's stage, and (the first time) a replay of what it tells.
  const [show, setShow] = useState<Show | null>(null);
  useEffect(() => {
    if (settled === null || !pages[settled] || stage === "loading") return;
    const page = pages[settled];
    const { main, touched } = pageScene(page, spans);
    const placeId = main?.placeId ?? null;
    const sceneIds = touched.filter((scene) => scene.placeId === placeId).map((scene) => scene.id);
    const script = placeId ? scriptFor(placeId) : null;
    const span = script ? reelWindow(script, page, sceneIds) : null;
    setShow({ page: settled, placeId: span ? placeId : null, sceneIds, window: span, reel: span && !played.current.has(settled) && !reducedMotion ? { key: `page:${settled}`, from: span.from, to: span.to, ms: REEL_MS } : null });
  }, [settled, pages, spans, scriptFor, stage, reducedMotion]);

  const script = show?.placeId ? scriptFor(show.placeId) : null;
  const plan = useMemo(() => { const prepared = show?.placeId && stage && stage !== "loading" ? placePlan(stage, show.placeId, volume) : null; return prepared && script ? keyedPlan(prepared, script) : null; }, [show?.placeId, script, stage, volume]);
  const [mode, setMode] = useState<HoloMode>("diorama");
  const [beat, setBeat] = useState<number | null>(null);
  const reelDone = useCallback(() => { setShow((current) => { if (current) played.current.add(current.page); return current ? { ...current, reel: null } : current; }); }, []);
  const replaying = !!show?.reel;
  // The sentences of the beat on show, lit in the text.
  const lit = script && beat !== null && script.beats[beat]?.kind !== "scene" ? script.beats[beat]?.source ?? null : null;
  const place = show?.placeId ? timePlace?.places.find((entry) => entry.id === show.placeId) : undefined;
  const kind = script?.places[0]?.kind;

  return <div className="read-mode">
    <header className="read-top">
      <a className="read-back" href={exitHref}>← Archive</a>
      <div className="read-title"><span>READ MODE</span><strong>{title}</strong></div>
      <span className={`read-status${stage && stage !== "loading" ? " is-ready" : ""}`} role="status">
        {stage === "loading" ? "Looking for the prepared animation…" : stage ? `Animation prepared · ${Object.keys(stage.places).length} places · ${stage.counts.moves ?? 0} moves` : "No animation yet: it is prepared once the book's analysis is complete"}
      </span>
      {simulationHref && <a className="read-sim" href={simulationHref} title="The simulation: buildings as skeletons, every move sampled from the path integral, things placed, fights damaging the buildings">{simulationLabel}</a>}
    </header>
    <div className="read-body">
      <div className="read-panel" ref={panel} aria-label="Book text">
        {textState === "loading" && <p className="read-note">Opening the book…</p>}
        {textState === "missing" && <p className="read-note">This host does not serve the book's text.</p>}
        {pages.map((page) => <Page key={page.index} page={page} focused={page.index === focus} lit={show?.page === page.index ? lit : null} />)}
      </div>
      <section className="read-stage" aria-label="Places of this page">
        {show && script && show.placeId ? <HoloStage key={show.placeId} script={script} mode={mode} onMode={setMode} onClose={() => undefined} reducedMotion={reducedMotion} embedded
          plan={plan} reel={show.reel} onReelEnd={reelDone} onBeat={setBeat} initialBeat={show.window?.to ?? 0} seek={`page:${show.page}`} autoplay={false} />
          : <div className="read-idle"><div className="read-idle-ring" /><p>{settled === null ? "Rest on a page to see where it happens." : "This page names no place to stage."}</p></div>}
        {show && script && <div className={`read-hook${replaying ? " is-replaying" : ""}`} role="status">
          <b>Page {show.page + 1}</b>
          <span>{place?.label ?? script.title}{kind ? ` · ${ARCHITECTURE_LABEL[kind]}` : ""}</span>
          <small>{replaying ? "Replaying this page…" : played.current.has(show.page) ? "Yours to explore: drag to turn, click the timeline" : "Shown at the page's last moment"}</small>
          {replaying && show.reel && <i key={show.reel.key} style={{ animationDuration: `${replayMs(script, show.reel.from, show.reel.to, show.reel.ms)}ms` }} />}
        </div>}
      </section>
    </div>
  </div>;
}
