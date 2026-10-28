import { useEffect, useMemo, useRef, useState } from "react";
import { CharacterCard, HallOfFame, PairLog } from "./components/Panels";
import { RelationWeb } from "./components/RelationWeb";
import { fromBundles, type VolumeBundle } from "./model/bundle";
import { characterWeb, pairHistory } from "./model/web";

type Scope = number | "series";
const portraitUrl = (volume: number, entityId: string) => `api/portrait?volume=${volume}&entity=${encodeURIComponent(entityId)}`;

export function App() {
  const [bundles, setBundles] = useState<VolumeBundle[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const [scope, setScope] = useState<Scope>(1);
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
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

  const data = useMemo(() => {
    if (!bundles?.length) return null;
    const chosen = scope === "series" ? bundles : bundles.filter((bundle) => bundle.volume === scope);
    return fromBundles(chosen, scope === "series" ? "series-by-name" : "volume", portraitUrl);
  }, [bundles, scope]);
  const positions = useMemo(() => data ? [...new Set(data.scenes.map((scene) => scene.story))].sort((x, y) => x - y) : [], [data]);
  const at = step === null ? positions.length - 1 : Math.min(step, positions.length - 1);
  const until = positions[at];
  const web = useMemo(() => data ? characterWeb(data, { until }) : null, [data, until]);
  const pair = useMemo(() => data && selected.length === 2 ? pairHistory(data, selected[0], selected[1], { until }) : null, [data, selected, until]);
  const reached = data?.scenes.find((scene) => scene.story === until);

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
  useEffect(() => { setStep(null); setPlaying(false); setSelected([]); }, [scope]);

  const pick = (id: string, additive: boolean) => setSelected((current) => {
    if (current.includes(id)) return current.filter((entry) => entry !== id);
    if (additive && current.length) return [current[current.length - 1], id];
    return [id];
  });

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
    <div className="app">
      <header className="bar">
        <div className="brand"><span className="mark">◎</span><div><h1>Cast web</h1><small>Relation web · hall of fame · two-character history</small></div></div>
        <nav className="scopes" aria-label="Scope">
          {bundles.map((bundle) => <button key={bundle.volume} type="button" className={scope === bundle.volume ? "is-on" : ""} onClick={() => setScope(bundle.volume)}>{bundle.label}</button>)}
          {bundles.length > 1 && <button type="button" className={scope === "series" ? "is-on" : ""} onClick={() => setScope("series")} title="Characters joined across volumes when they share a recorded name: provisional, not reviewed identity">Series · by name</button>}
        </nav>
        <button type="button" className="motion" onClick={() => setReducedMotion(!reducedMotion)} aria-pressed={reducedMotion}>{reducedMotion ? "Motion off" : "Motion on"}</button>
      </header>
      <section className="timeline" aria-label="Story so far">
        <button type="button" className="play" onClick={() => setPlaying(!playing)} aria-label={playing ? "Pause" : "Replay the story"}>{playing ? "❚❚" : "▶"}</button>
        <input type="range" min={0} max={Math.max(0, positions.length - 1)} value={at} aria-label="Scenes so far"
          onChange={(event) => { setPlaying(false); setStep(Number(event.target.value)); }} />
        <span className="reached">{reached ? `Vol ${reached.book} · ch ${reached.chapter + 1} · scene ${at + 1}/${positions.length}` : ""}</span>
      </section>
      <main className="stage">
        <div className="web-wrap">
          <RelationWeb web={web} selected={selected} reducedMotion={reducedMotion} onPick={pick} />
          <ul className="key">
            <li><i className="tone tone-bond" />Bond</li><li><i className="tone tone-tension" />Tension</li><li><i className="tone tone-neutral" />Contact</li>
            <li className="note">Ties: shared scenes, exchanges and actions, plus recorded affinity. {scope === "series" ? "Series joins characters by shared name (provisional)." : ""} Reading order; story time is not recorded for these volumes.</li>
          </ul>
        </div>
        {/* Keyed by what it shows, so each view opens at its top. */}
        <aside className="panel" key={selected.join("|") || "hall"}>
          {pair ? <PairLog web={web} history={pair} onClose={() => setSelected([selected[0]])} onSwap={(id) => setSelected([id])} />
            : selected.length === 1 ? <CharacterCard data={data} web={web} id={selected[0]} scope={{ until }} onPick={() => setSelected([])} onPair={(other) => setSelected([selected[0], other])} />
            : <HallOfFame web={web} onPick={(id) => setSelected([id])} />}
        </aside>
      </main>
    </div>
  );
}
