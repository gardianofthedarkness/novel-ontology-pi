import { useEffect, useMemo, useRef, useState } from "react";
import { CharacterCard, CompareBar, HallOfFame, PairLog } from "./components/Panels";
import { RelationWeb } from "./components/RelationWeb";
import { RelationWeb3D } from "./components/RelationWeb3D";
import { fromBundles, type VolumeBundle } from "./model/bundle";
import { characterWeb, pairHistory } from "./model/web";

type Scope = number | "series";
type View = "2d" | "3d";
const portraitUrl = (volume: number, entityId: string) => `api/portrait?volume=${volume}&entity=${encodeURIComponent(entityId)}`;
const WATCH_MS = 1700;

/** The chosen view is a per-viewer convenience: remembered when storage allows, fine without it. */
function storedView(): View {
  try { return localStorage.getItem("cast-web:view") === "3d" ? "3d" : "2d"; } catch { return "2d"; }
}

export function App() {
  const [bundles, setBundles] = useState<VolumeBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [scope, setScope] = useState<Scope>(1);
  const [view, setView] = useState<View>(storedView);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  /** The next pick on the web becomes the second of a pair. */
  const [pickingSecond, setPickingSecond] = useState(false);
  /** Index into the pair's history while watching it. */
  const [watching, setWatching] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);

  useEffect(() => {
    fetch("api/volumes", { cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error(`Character data unavailable (${response.status}).`);
      const body = await response.json() as { configured: boolean; volumes: VolumeBundle[] };
      setConfigured(body.configured);
      setBundles(body.volumes);
      if (body.volumes.length) setScope(body.volumes[0].volume);
    }).catch((reason: Error) => setError(reason.message));
  }, []);
  useEffect(() => { try { localStorage.setItem("cast-web:view", view); } catch { /* the view still switches */ } }, [view]);

  const data = useMemo(() => {
    if (!bundles?.length) return null;
    const chosen = scope === "series" ? bundles : bundles.filter((bundle) => bundle.volume === scope);
    return fromBundles(chosen, scope === "series" ? "series-by-name" : "volume", portraitUrl);
  }, [bundles, scope]);
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

  useEffect(() => { setStep(null); setPlaying(false); setSelected([]); setWatching(null); setPickingSecond(false); }, [scope]);
  useEffect(() => { setWatching(null); }, [selected]);

  const choose = (ids: string[]) => { setSelected(ids); setPickingSecond(false); };
  const pick = (id: string, additive: boolean) => {
    if (selected.includes(id)) return choose(selected.filter((entry) => entry !== id));
    if ((additive || pickingSecond) && selected.length) return choose([selected[selected.length - 1], id]);
    choose([id]);
  };

  if (error) return <main className="empty"><h1>Cast web</h1><p>{error}</p></main>;
  if (!bundles) return <main className="empty"><h1>Cast web</h1><p>Loading the extracted volumes…</p></main>;
  if (!data || !web) return (
    <main className="empty">
      <h1>Cast web</h1>
      <p>{configured ? "The configured runtime has no extracted volume yet." : "No runtime configured."}</p>
      <p>Start the host with <code>NOVEL_REVIEW_HOME</code> pointing at a Pi review home whose <code>runtime/live-volumes.json</code> lists extracted workspaces.</p>
    </main>
  );

  return (
    <div className={`app${pickingSecond ? " is-picking" : ""}`}>
      <header className="bar">
        <div className="brand"><span className="mark">◎</span><div><h1>Cast web</h1><small>Relation web · hall of fame · two-character history</small></div></div>
        <nav className="scopes" aria-label="Scope">
          {bundles.map((bundle) => <button key={bundle.volume} type="button" className={scope === bundle.volume ? "is-on" : ""} onClick={() => setScope(bundle.volume)}>{bundle.label}</button>)}
          {bundles.length > 1 && <button type="button" className={scope === "series" ? "is-on" : ""} onClick={() => setScope("series")} title="Characters joined across volumes when they share a recorded name: provisional, not reviewed identity">Series · by name</button>}
        </nav>
        <div className="switch" role="group" aria-label="View">
          {(["2d", "3d"] as const).map((name) => <button key={name} type="button" aria-pressed={view === name} className={view === name ? "is-on" : ""} onClick={() => setView(name)}>{name.toUpperCase()}</button>)}
        </div>
        <button type="button" className="motion" onClick={() => setReducedMotion(!reducedMotion)} aria-pressed={reducedMotion}>{reducedMotion ? "Motion off" : "Motion on"}</button>
      </header>
      <section className="timeline" aria-label="Story so far">
        <button type="button" className="play" onClick={() => { setWatching(null); setPlaying(!playing); }} aria-label={playing ? "Pause" : "Replay the story"}>{playing ? "❚❚" : "▶"}</button>
        <input type="range" min={0} max={Math.max(0, positions.length - 1)} value={at} aria-label="Scenes so far"
          onChange={(event) => { setPlaying(false); setWatching(null); setStep(Number(event.target.value)); }} />
        <span className="reached">{reached ? `Vol ${reached.book} · ch ${reached.chapter + 1} · scene ${at + 1}/${positions.length}` : ""}</span>
      </section>
      <main className="stage">
        <div className="web-wrap">
          {pickingSecond && <p className="picking" role="status">Pick a second character on the web, or search on the right.</p>}
          {view === "3d"
            ? <RelationWeb3D web={web} selected={selected} reducedMotion={reducedMotion} pulse={watching !== null ? pairEdge : undefined} onPick={pick} />
            : <RelationWeb web={web} selected={selected} reducedMotion={reducedMotion} pulse={watching !== null ? pairEdge : undefined} onPick={pick} />}
          <ul className="key">
            <li><i className="tone tone-bond" />Bond</li><li><i className="tone tone-tension" />Tension</li><li><i className="tone tone-neutral" />Contact</li>
            <li className="note">{view === "3d" ? "Drag to orbit, scroll to zoom; higher steps are more central. " : ""}Ties: shared scenes, exchanges and actions, plus recorded affinity. {scope === "series" ? "Series joins characters by shared name (provisional). " : ""}Reading order; story time is not recorded for these volumes.</li>
          </ul>
        </div>
        <aside className="panel-column">
          <CompareBar data={data} web={web} selected={selected} picking={pickingSecond} onChoose={choose} onPickSecond={() => setPickingSecond(!pickingSecond)} />
          {/* Keyed by what it shows, so each view opens at its top. */}
          <div className="panel" key={selected.join("|") || "hall"}>
            {pair ? <PairLog web={web} history={pair} until={until} watching={watching} onWatch={() => setWatching(watching === null ? 0 : null)} onClose={() => choose([selected[0]])} onSwap={(id) => choose([id])} />
              : selected.length === 1 ? <CharacterCard data={data} web={web} id={selected[0]} scope={{ until }} onPick={() => choose([])} onPair={(other) => choose([selected[0], other])} onCompare={() => setPickingSecond(true)} />
              : <HallOfFame web={web} onPick={(id) => choose([id])} />}
          </div>
        </aside>
      </main>
    </div>
  );
}
