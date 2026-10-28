import { CastWeb2D } from "./CastWeb2D";
import type { CastState } from "./useCast";
import "./cast.css";

/**
 * Traditional Characters: the relation web flat, in the Story time and
 * Places views' frame. Orbital Characters is the orbit itself (orbitalCast.ts);
 * both share the side panel and state (useCast).
 */
export function CastView({ cast, hasSource, reducedMotion }: { cast: CastState; hasSource: boolean; reducedMotion: boolean }) {
  const { web } = cast;
  if (!web || !web.nodes.length) return (
    <div className="tp-empty">
      <b>No cast yet.</b>
      <span>{hasSource ? "This book has no characters in its extracted scenes yet." : "Characters read a book's extracted scenes, events and relationship changes from the live viewer."}</span>
    </div>
  );
  const pairEdge = cast.selected.length === 2 ? web.edges.find((edge) => cast.selected.includes(edge.a) && cast.selected.includes(edge.b))?.id : undefined;
  return (
    <section className={`tp-view cast-flat${cast.pickingSecond ? " is-picking" : ""}`} aria-label="Characters">
      <header className="tp-head">
        <span className="eyebrow">Characters · relation web</span>
        <b>{web.nodes.length} characters on four rings</b>
        <p>Protagonists at the heart, then pillars, connectors and cameos; ties are shared scenes, exchanges and actions, green for bonds and red for tension. Choose two to follow their history.</p>
      </header>
      <CastWeb2D web={web} selected={cast.selected} reducedMotion={reducedMotion} pulse={cast.watching !== null ? pairEdge : undefined} onPick={cast.pick} />
    </section>
  );
}
