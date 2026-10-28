import { useEffect, useRef } from "react";
import { BREAKDOWN_HELP, BREAKDOWN_LABEL, TIERS, TIER_LABEL, WEIGHTS, type Breakdown, type WebNode } from "../../data/castWeb";
import type { CastState } from "./useCast";
import "./cast.css";

const PARTS = Object.keys(WEIGHTS) as (keyof Breakdown)[];
const KIND_LABEL = { met: "First together", together: "Together", mentioned: "Mentioned", shift: "Shift" } as const;

/** The score as its weighted parts, so a rank always shows why. */
function Parts({ node }: { node: WebNode }) {
  return (
    <span className="cast-parts" title={PARTS.map((part) => `${BREAKDOWN_LABEL[part]} ${Math.round(node.breakdown[part] * 100)}`).join(" · ")}>
      {PARTS.map((part) => <i key={part} className={`part-${part}`} style={{ width: `${WEIGHTS[part] * node.breakdown[part] * 100}%` }} />)}
    </span>
  );
}

/**
 * The Characters side panel, in the Places atlas panel's form: the hall of
 * fame, the scrubber, the pair being compared and its history. `onFocus`
 * shows a character in the view (the orbit centres it and opens the glass
 * inspector; the flat web selects it).
 */
export function CastPanel({ cast, onFocus, onJourney }: { cast: CastState; onFocus: (id: string) => void; onJourney: (id: string) => void }) {
  const { web, pair, selected } = cast;
  const now = useRef<HTMLLIElement>(null);
  useEffect(() => { now.current?.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, [cast.watching]);
  if (!web) return null;
  const name = (id: string) => web.byId.get(id)?.name ?? pair?.names[id] ?? id;
  const one = selected.length === 1 ? web.byId.get(selected[0]) : undefined;
  const ties = one ? web.edges.filter((edge) => edge.a === one.id || edge.b === one.id).slice(0, 8) : [];
  const wide = typeof window !== "undefined" && window.matchMedia?.("(min-width: 701px)").matches;
  const slot = (index: number) => (
    <select value={selected[index] ?? ""} aria-label={index ? "Second character" : "First character"}
      onChange={(event) => {
        const id = event.target.value;
        const next = [...selected];
        if (id) next[index] = id; else next.splice(index, 1);
        cast.choose(next.filter(Boolean).filter((entry, at, all) => all.indexOf(entry) === at).slice(0, 2));
        if (id) onFocus(id);
      }}>
      <option value="">{index ? "Second…" : "Choose…"}</option>
      {web.nodes.map((node) => <option key={node.id} value={node.id}>{node.rank}. {node.name}</option>)}
    </select>
  );

  return (
    <details className="atlas-panel cast-panel" open={wide}>
      <summary><span className="eyebrow">Hall of fame</span><b>{web.nodes.length} characters · {web.edges.length} ties</b></summary>
      <div className="cast-scrub">
        <button onClick={cast.togglePlay} aria-label={cast.playing ? "Pause" : "Replay the book"} aria-pressed={cast.playing}>{cast.playing ? "❚❚" : "▶"}</button>
        <input type="range" min={0} max={Math.max(0, cast.positions.length - 1)} value={cast.at} aria-label="Scenes so far" onChange={(event) => cast.scrub(Number(event.target.value))} />
        <small>{cast.reached ? `ch ${cast.reached.chapter + 1} · ${cast.at + 1}/${cast.positions.length}` : ""}</small>
      </div>
      <div className="cast-compare" role="group" aria-label="Compare two characters">
        <span>Compare</span>
        {slot(0)}{slot(1)}
        {selected.length === 1 && <button aria-pressed={cast.pickingSecond} onClick={() => cast.setPickingSecond(!cast.pickingSecond)}>{cast.pickingSecond ? "Pick in view…" : "Pick in view"}</button>}
      </div>

      {pair ? (
        <section className="cast-pair" aria-label="Their history together">
          <p className="atlas-note">{pair.together} scene{pair.together === 1 ? "" : "s"} together · affinity <b className={pair.affinity > 0.15 ? "is-bond" : pair.affinity < -0.15 ? "is-tension" : ""}>{pair.affinity > 0 ? "+" : ""}{pair.affinity.toFixed(2)}</b>{pair.first ? ` · first in ch ${pair.first.chapter + 1}` : ""}</p>
          {pair.entries.length > 1 && (
            <svg className="cast-affinity" viewBox="0 0 200 40" preserveAspectRatio="none" aria-label="Affinity over their shared scenes">
              <line x1="0" x2="200" y1="20" y2="20" />
              <polyline points={pair.entries.map((entry, index) => `${(index / (pair.entries.length - 1)) * 200},${20 - (entry.affinity / Math.max(0.5, ...pair.entries.map((item) => Math.abs(item.affinity)))) * 17}`).join(" ")} />
            </svg>
          )}
          <div className="atlas-actions">
            <button aria-pressed={cast.watching !== null} onClick={cast.toggleWatch}>{cast.watching !== null ? `Watching ${cast.watching + 1}/${pair.entries.length}` : "Watch their story"}</button>
            <button onClick={() => cast.choose([selected[0]])}>Close</button>
          </div>
          <ol className="cast-log">
            {pair.entries.map((entry, index) => (
              <li key={entry.scene.id} ref={index === cast.watching ? now : undefined}
                className={`kind-${entry.kind}${index === cast.watching ? " is-now" : ""}${cast.until !== undefined && entry.scene.story > cast.until ? " is-later" : ""}${pair.turning?.scene.id === entry.scene.id ? " is-turning" : ""}`}>
                <small>ch {entry.scene.chapter + 1} · {KIND_LABEL[entry.kind]}{entry.speaker ? ` by ${name(entry.speaker)}` : ""}{pair.turning?.scene.id === entry.scene.id ? " · turning point" : ""}</small>
                <b lang="zh">{entry.scene.title}</b>
                {entry.events.slice(0, 2).map((event) => <p key={event.id} lang="zh">{event.summary}</p>)}
                {entry.shifts.map((shift) => <p key={shift.id} className={shift.delta > 0 ? "is-bond" : "is-tension"}>{name(shift.characterId)} → {name(shift.towardId)} {shift.delta > 0 ? "+" : ""}{shift.delta.toFixed(2)}</p>)}
              </li>
            ))}
          </ol>
        </section>
      ) : one ? (
        <section className="cast-one" aria-label={`${one.name}: why this rank`}>
          <p className="atlas-note"><b lang="zh">{one.name}</b> · {TIER_LABEL[one.tier].replace(/s$/, "")} #{one.rank} · {Math.round(one.score * 100)}</p>
          <div className="atlas-actions"><button className="cast-journey" onClick={() => onJourney(one.id)} title="Story time and Places, narrowed to their scenes">Follow their journey →</button></div>
          {PARTS.map((part) => (
            <div className="cast-part" key={part} title={BREAKDOWN_HELP[part]}>
              <span>{BREAKDOWN_LABEL[part]}</span><span className="cast-meter"><i className={`part-${part}`} style={{ width: `${one.breakdown[part] * 100}%` }} /></span>
            </div>
          ))}
          <ol aria-label="Closest ties">
            {ties.map((edge) => {
              const other = edge.a === one.id ? edge.b : edge.a;
              return <li key={edge.id}><button onClick={() => { cast.choose([one.id, other]); }} aria-label={`${name(other)}: their history together`}><i className={`cast-tone tone-${edge.tone}`} /><span lang="zh">{name(other)}</span><small>{edge.scenes} sc{edge.affinity ? ` · ${edge.affinity > 0 ? "+" : ""}${edge.affinity.toFixed(1)}` : ""}</small></button></li>;
            })}
          </ol>
        </section>
      ) : null}

      <div className="cast-legend">{PARTS.map((part) => <span key={part}><i className={`part-${part}`} />{BREAKDOWN_LABEL[part]}</span>)}</div>
      {TIERS.map((tier) => {
        const members = web.nodes.filter((node) => node.tier === tier);
        if (!members.length) return null;
        return (
          <section key={tier} className={`cast-tier tier-${tier}`}>
            <h4>{TIER_LABEL[tier]} <small>{members.length}</small></h4>
            <ol>
              {members.slice(0, tier === "cameo" ? 10 : undefined).map((node) => (
                <li key={node.id} className={selected.includes(node.id) ? "is-selected" : ""}>
                  <button onClick={() => { cast.pick(node.id); onFocus(node.id); }}>
                    <span className="cast-rank">{node.rank}</span><b lang="zh">{node.name}</b><Parts node={node} /><small>{Math.round(node.score * 100)}</small>
                  </button>
                </li>
              ))}
            </ol>
            {tier === "cameo" && members.length > 10 && <p className="atlas-note">+{members.length - 10} more</p>}
          </section>
        );
      })}
    </details>
  );
}
