import { placeBearings, type JourneyScene } from "../../data/orbitalJourney";
import "./cast.css";

/**
 * Traditional Journey: the character's scenes as a spine in story order, in
 * the Story time view's form. Each place keeps one colour, as each keeps one
 * side of the orbital tunnel.
 */
export function JourneyList({ label, scenes }: { label: string; scenes: JourneyScene[] }) {
  const bearings = placeBearings(scenes);
  const hue = (place: string) => bearings.has(place) ? Math.round(((bearings.get(place)! + Math.PI / 2) / (2 * Math.PI)) * 360) : null;
  return (
    <section className="tp-view journey-flat" aria-label={`${label}'s journey`}>
      <header className="tp-head">
        <span className="eyebrow">Journey · time and place</span>
        <b lang="zh">{label}</b>
        <p>{scenes.length} scenes in story order (reading order until story time is recorded) · {bearings.size} place{bearings.size === 1 ? "" : "s"}. Each place keeps its colour here and its side of the tunnel in 3D.</p>
      </header>
      <ol className="tp-spine">
        {scenes.map((scene, step) => {
          const tone = hue(scene.place);
          return (
            <li key={scene.id} className="tp-row" style={tone === null ? undefined : { ["--tp-row" as string]: `hsl(${tone} 70% 68%)` }}>
              <span className="tp-dot" />
              <div className="tp-row-head">
                <span className="tp-row-title"><b lang="zh">{scene.title}</b><span className="tp-date">step {step + 1} · ch {scene.chapter + 1}{scene.place ? <> · <span style={tone === null ? undefined : { color: `hsl(${tone} 70% 72%)` }}>⌖ {scene.place}</span></> : " · place not stated"}</span></span>
              </div>
              {scene.events.slice(0, 2).map((event, index) => <p key={index} className="journey-event" lang="zh">{event}</p>)}
              {scene.others.length > 0 && <p className="tp-meta journey-with" lang="zh">with {scene.others.join(" · ")}</p>}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
