import { useEffect, useMemo, useRef, useState } from "react";
import { fromBundles, type VolumeBundle } from "../../data/castBundle";
import { characterWeb, pairHistory } from "../../data/castWeb";
import type { AlbumPortrait } from "../../types";
import { CharacterCard, CompareBar, HallOfFame, PairLog } from "./CastPanels";
import { CastWeb2D } from "./CastWeb2D";
import { CastWeb3D } from "./CastWeb3D";
import "./cast.css";

const WATCH_MS = 1700;

interface Props {
  /** The live snapshot's cast projection for the loaded book (null outside the live viewer). */
  bundle: VolumeBundle | null | undefined;
  portraits: AlbumPortrait[];
  /** Orbital mode shows the amphitheater in 3D; Traditional the flat web. */
  orbital: boolean;
  reducedMotion: boolean;
}

/**
 * Characters: the relation web, the hall of fame it ranks, and the history of
 * any two characters, beside Story time and Places.
 */
export function CastView({ bundle, portraits, orbital, reducedMotion }: Props) {
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  /** The next pick on the web becomes the second of a pair. */
  const [pickingSecond, setPickingSecond] = useState(false);
  /** Index into the pair's history while watching it. */
  const [watching, setWatching] = useState<number | null>(null);

  const portraitOf = useMemo(() => new Map(portraits.map((portrait) => [portrait.entityId, portrait.asset])), [portraits]);
  const data = useMemo(() => bundle ? fromBundles([bundle], "volume", (_, entityId) => portraitOf.get(entityId) ?? "") : null, [bundle, portraitOf]);
  const positions = useMemo(() => data ? [...new Set(data.scenes.map((scene) => scene.story))].sort((x, y) => x - y) : [], [data]);
  const at = step === null ? positions.length - 1 : Math.min(step, positions.length - 1);
  const until = positions[at];
  const web = useMemo(() => data ? characterWeb(data, { until }) : null, [data, until]);
  // The log shows the pair's whole history; what lies past the scrubber is dimmed, not hidden.
  const pair = useMemo(() => data && selected.length === 2 ? pairHistory(data, selected[0], selected[1]) : null, [data, selected]);
  const reached = data?.scenes.find((scene) => scene.story === until);
  const pairEdge = web && selected.length === 2 ? web.edges.find((edge) => selected.includes(edge.a) && selected.includes(edge.b))?.id : undefined;

  // Replaying the story: the web grows scene by scene, gliding as ranks change.
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setStep((current) => {
      const next = (current ?? positions.length - 1) >= positions.length - 1 ? 0 : (current ?? 0) + 1;
      if (next >= positions.length - 1) setPlaying(false);
      return next;
    }), reducedMotion ? 260 : 140);
    return () => clearInterval(timer.current);
  }, [playing, positions.length, reducedMotion]);

  // Watching a pair: the scrubber jumps to each moment they share, and the web catches up around them.
  useEffect(() => {
    if (watching === null || !pair) return;
    const entry = pair.entries[watching];
    if (!entry) { setWatching(null); return; }
    setStep(positions.indexOf(entry.scene.story));
    const next = setTimeout(() => setWatching(watching + 1 < pair.entries.length ? watching + 1 : null), reducedMotion ? WATCH_MS * 1.5 : WATCH_MS);
    return () => clearTimeout(next);
  }, [watching, pair, positions, reducedMotion]);

  // A new book starts from its whole story with nobody chosen.
  useEffect(() => { setStep(null); setPlaying(false); setSelected([]); setWatching(null); setPickingSecond(false); }, [bundle?.volume]);
  useEffect(() => { setWatching(null); }, [selected]);

  const choose = (ids: string[]) => { setSelected(ids); setPickingSecond(false); };
  const pick = (id: string, additive: boolean) => {
    if (selected.includes(id)) return choose(selected.filter((entry) => entry !== id));
    if ((additive || pickingSecond) && selected.length) return choose([selected[selected.length - 1], id]);
    choose([id]);
  };

  if (!data || !web || !web.nodes.length) return (
    <section className="tp-view cast-view cast-empty" aria-label="Characters">
      <span className="eyebrow">CHARACTERS</span>
      <h2>No cast yet.</h2>
      <p>{bundle === undefined || bundle === null ? "The character web reads a book's extracted scenes, events and relationship changes from the live viewer." : "This book has no characters in its extracted scenes yet."}</p>
    </section>
  );

  return (
    <section className={`tp-view cast-view${pickingSecond ? " is-picking" : ""}`} aria-label="Characters">
      <div className="cast-timeline" aria-label="Story so far">
        <button type="button" className="play" onClick={() => { setWatching(null); setPlaying(!playing); }} aria-label={playing ? "Pause" : "Replay the story"}>{playing ? "❚❚" : "▶"}</button>
        <input type="range" min={0} max={Math.max(0, positions.length - 1)} value={at} aria-label="Scenes so far"
          onChange={(event) => { setPlaying(false); setWatching(null); setStep(Number(event.target.value)); }} />
        <span className="reached">{reached ? `ch ${reached.chapter + 1} · scene ${at + 1}/${positions.length}` : ""}</span>
      </div>
      <div className="cast-stage">
        <div className="web-wrap">
          {pickingSecond && <p className="picking" role="status">Pick a second character on the web, or search on the right.</p>}
          {orbital
            ? <CastWeb3D web={web} selected={selected} reducedMotion={reducedMotion} pulse={watching !== null ? pairEdge : undefined} onPick={pick} />
            : <CastWeb2D web={web} selected={selected} reducedMotion={reducedMotion} pulse={watching !== null ? pairEdge : undefined} onPick={pick} />}
          <ul className="key">
            <li><i className="tone tone-bond" />Bond</li><li><i className="tone tone-tension" />Tension</li><li><i className="tone tone-neutral" />Contact</li>
            <li className="note">{orbital ? "Drag to orbit, scroll to zoom; higher steps are more central. " : ""}Ties: shared scenes, exchanges and actions, plus recorded affinity. Reading order; story time is not recorded for this book yet.</li>
          </ul>
        </div>
        <aside className="panel-column">
          <CompareBar data={data} web={web} selected={selected} picking={pickingSecond} onChoose={choose} onPickSecond={() => setPickingSecond(!pickingSecond)} />
          {/* Keyed by what it shows, so each view opens at its top. */}
          <div className="cast-panel" key={selected.join("|") || "hall"}>
            {pair ? <PairLog web={web} history={pair} until={until} watching={watching} onWatch={() => setWatching(watching === null ? 0 : null)} onClose={() => choose([selected[0]])} onSwap={(id) => choose([id])} />
              : selected.length === 1 ? <CharacterCard data={data} web={web} id={selected[0]} scope={{ until }} onPick={() => choose([])} onPair={(other) => choose([selected[0], other])} onCompare={() => setPickingSecond(true)} />
              : <HallOfFame web={web} onPick={(id) => choose([id])} />}
          </div>
        </aside>
      </div>
    </section>
  );
}
