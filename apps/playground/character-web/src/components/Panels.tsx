import { BREAKDOWN_HELP, BREAKDOWN_LABEL, TIERS, TIER_LABEL, WEIGHTS, characterArc, type Breakdown, type CharacterWeb, type PairHistory, type WebData, type WebNode } from "../model/web";

const PARTS = Object.keys(WEIGHTS) as (keyof Breakdown)[];

function Avatar({ node, size = 34 }: { node: Pick<WebNode, "name" | "portrait" | "tier">; size?: number }) {
  return node.portrait
    ? <img className={`avatar tier-${node.tier}`} src={node.portrait} alt="" width={size} height={size} />
    : <span className={`avatar tier-${node.tier}`} style={{ width: size, height: size, fontSize: size * 0.48 }} aria-hidden="true">{[...node.name][0]}</span>;
}

/** The score as its weighted parts, so a rank always shows why. */
function ScoreBar({ node }: { node: WebNode }) {
  return (
    <span className="scorebar" title={PARTS.map((part) => `${BREAKDOWN_LABEL[part]} ${Math.round(node.breakdown[part] * 100)}%`).join(" · ")}>
      {PARTS.map((part) => <i key={part} className={`part-${part}`} style={{ width: `${WEIGHTS[part] * node.breakdown[part] * 100}%` }} />)}
    </span>
  );
}

export function HallOfFame({ web, onPick }: { web: CharacterWeb; onPick: (id: string) => void }) {
  return (
    <div className="hall">
      <p className="hint">Ranked by storyline connection. Click a character to open them; shift-click a second to compare two.</p>
      <ul className="legend">{PARTS.map((part) => <li key={part}><i className={`part-${part}`} />{BREAKDOWN_LABEL[part]}</li>)}</ul>
      {TIERS.map((tier) => {
        const members = web.nodes.filter((node) => node.tier === tier);
        if (!members.length) return null;
        return (
          <section key={tier} className={`tier-block tier-${tier}`}>
            <h3>{TIER_LABEL[tier]} <small>{members.length}</small></h3>
            <ol>
              {members.slice(0, tier === "cameo" ? 12 : undefined).map((node) => (
                <li key={node.id}>
                  <button type="button" onClick={() => onPick(node.id)}>
                    <span className="rank">{node.rank}</span>
                    <Avatar node={node} />
                    <span className="who"><strong>{node.name}</strong><small>{node.raw.scenes} scenes · {node.raw.partners} ties{node.raw.books.length > 1 ? ` · vol ${node.raw.books.join(", ")}` : ""}</small></span>
                    <span className="score"><ScoreBar node={node} /><b>{Math.round(node.score * 100)}</b></span>
                  </button>
                </li>
              ))}
            </ol>
            {tier === "cameo" && members.length > 12 && <p className="hint">+{members.length - 12} more on the outer ring</p>}
          </section>
        );
      })}
    </div>
  );
}

export function CharacterCard({ data, web, id, onPick, onPair, scope }: { data: WebData; web: CharacterWeb; id: string; onPick: (id: string) => void; onPair: (other: string) => void; scope: { book?: number; until?: number } }) {
  const node = web.byId.get(id);
  const character = data.characters.find((entry) => entry.id === id);
  if (!node || !character) return <p className="hint">Not in this scope.</p>;
  const ties = web.edges.filter((edge) => edge.a === id || edge.b === id).slice(0, 8);
  const arc = characterArc(data, id, scope);
  const total = web.scenes.length || 1;
  return (
    <div className="card">
      <header>
        <Avatar node={node} size={64} />
        <div>
          <span className={`badge tier-${node.tier}`}>{TIER_LABEL[node.tier].replace(/s$/, "")} · #{node.rank}</span>
          <h2>{node.name}</h2>
          {character.names.length > 1 && <p className="aliases">{character.names.filter((name) => name !== node.name).join(" · ")}</p>}
        </div>
        <b className="big-score">{Math.round(node.score * 100)}</b>
      </header>
      <section>
        <h4>Why this rank</h4>
        {PARTS.map((part) => (
          <div className="part-row" key={part} title={BREAKDOWN_HELP[part]}>
            <span>{BREAKDOWN_LABEL[part]}</span>
            <span className="meter"><i className={`part-${part}`} style={{ width: `${node.breakdown[part] * 100}%` }} /></span>
            <small>{part === "presence" ? `${node.raw.scenes} scenes` : part === "agency" ? `${node.raw.agency.toFixed(1)}` : part === "reach" ? `${node.raw.partners} people` : part === "influence" ? `${node.raw.influence}` : `${node.raw.bridges} groups`}</small>
          </div>
        ))}
      </section>
      <section>
        <h4>Through the story</h4>
        {/* One tick per scene in scope: taller for more of their events; faint when only mentioned. */}
        <svg className="arc" viewBox="0 0 300 30" preserveAspectRatio="none" aria-label={`${arc.filter((entry) => entry.present).length} scenes present`}>
          <line x1="0" x2="300" y1="29" y2="29" />
          {arc.map((entry) => {
            const x = (web.scenes.findIndex((scene) => scene.id === entry.scene.id) + 0.5) / total * 300;
            const height = entry.present ? 6 + Math.min(22, entry.events.length * 2.5) : 4;
            return <line key={entry.scene.id} x1={x} x2={x} y1={29} y2={29 - height} className={entry.present ? "on" : "mention"} />;
          })}
        </svg>
        <p className="arc-axis"><span>Start</span><span>{arc.filter((entry) => entry.present).length} of {total} scenes</span><span>Now</span></p>
      </section>
      <section>
        <h4>Closest ties</h4>
        <ul className="ties">
          {ties.map((edge) => {
            const other = edge.a === id ? edge.b : edge.a;
            const partner = web.byId.get(other);
            if (!partner) return null;
            return (
              <li key={edge.id}>
                <button type="button" onClick={() => onPair(other)} aria-label={`${partner.name}: open your history together`}>
                  <i className={`tone tone-${edge.tone}`} />
                  <span>{partner.name}</span>
                  <small>{edge.scenes} scenes{edge.cards ? ` · ${edge.cards} exchanges` : ""}{edge.affinity ? ` · ${edge.affinity > 0 ? "+" : ""}${edge.affinity.toFixed(1)}` : ""}</small>
                  <span className="go">⟷</span>
                </button>
              </li>
            );
          })}
        </ul>
        <button type="button" className="ghost" onClick={() => onPick(id)}>Back to the hall</button>
      </section>
    </div>
  );
}

const KIND_LABEL = { met: "First together", together: "Together", mentioned: "Mentioned", shift: "Shift" } as const;

export function PairLog({ web, history, onClose, onSwap }: { web: CharacterWeb; history: PairHistory; onClose: () => void; onSwap: (id: string) => void }) {
  const a = web.byId.get(history.a), b = web.byId.get(history.b);
  if (!a || !b) return null;
  const points = history.entries.map((entry, index) => ({ x: history.entries.length > 1 ? (index / (history.entries.length - 1)) * 300 : 150, y: entry.affinity }));
  const span = Math.max(0.5, ...points.map((point) => Math.abs(point.y)));
  const y = (value: number) => 40 - (value / span) * 34;
  const name = (id: string) => web.byId.get(id)?.name ?? id;
  return (
    <div className="pair">
      <header>
        <button type="button" className="who" onClick={() => onSwap(a.id)}><Avatar node={a} size={44} /><strong>{a.name}</strong></button>
        <span className="link">⟷</span>
        <button type="button" className="who" onClick={() => onSwap(b.id)}><Avatar node={b} size={44} /><strong>{b.name}</strong></button>
        <button type="button" className="close" onClick={onClose} aria-label="Close the comparison">×</button>
      </header>
      <dl className="pair-stats">
        <div><dt>Scenes together</dt><dd>{history.together}</dd></div>
        <div><dt>Affinity now</dt><dd className={history.affinity > 0.15 ? "bond" : history.affinity < -0.15 ? "tension" : ""}>{history.affinity > 0 ? "+" : ""}{history.affinity.toFixed(2)}</dd></div>
        <div><dt>First together</dt><dd>{history.first ? `Vol ${history.first.book} · ch ${history.first.chapter + 1}` : "—"}</dd></div>
      </dl>
      {points.length > 1 && (
        <svg className="affinity" viewBox="0 0 300 80" preserveAspectRatio="none" aria-label="Affinity over their shared scenes">
          <line className="zero" x1="0" x2="300" y1={y(0)} y2={y(0)} />
          <polyline points={points.map((point) => `${point.x},${y(point.y)}`).join(" ")} />
          {points.map((point, index) => <circle key={index} cx={point.x} cy={y(point.y)} r={history.entries[index].shifts.length ? 3.2 : 1.6} />)}
        </svg>
      )}
      <ol className="log">
        {history.entries.map((entry) => (
          <li key={entry.scene.id} className={`entry kind-${entry.kind}${history.turning?.scene.id === entry.scene.id ? " is-turning" : ""}`}>
            <div className="when">Vol {entry.scene.book} · ch {entry.scene.chapter + 1}</div>
            <div className="what">
              <span className="kind">{KIND_LABEL[entry.kind]}{entry.speaker ? ` by ${name(entry.speaker)}` : ""}{history.turning?.scene.id === entry.scene.id ? " · turning point" : ""}</span>
              <strong>{entry.scene.title}</strong>
              {entry.events.slice(0, 3).map((event) => <p key={event.id}>{event.summary}</p>)}
              {entry.cards.length > 0 && <p className="exchange">{entry.cards.length} shared exchange{entry.cards.length > 1 ? "s" : ""}</p>}
              {entry.shifts.map((shift) => <p key={shift.id} className={`shift ${shift.delta > 0 ? "bond" : "tension"}`}>{name(shift.characterId)} → {name(shift.towardId)} {shift.delta > 0 ? "+" : ""}{shift.delta.toFixed(2)}</p>)}
            </div>
          </li>
        ))}
        {!history.entries.length && <li className="hint">No shared scenes, mentions or shifts in this scope.</li>}
      </ol>
    </div>
  );
}
