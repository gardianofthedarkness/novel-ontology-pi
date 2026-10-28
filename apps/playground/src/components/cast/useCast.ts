import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { fromBundles, type VolumeBundle } from "../../data/castBundle";
import { characterWeb, pairHistory } from "../../data/castWeb";
import type { AlbumPortrait } from "../../types";

const WATCH_MS = 1700;

/**
 * The Characters view's state, shared by its orbital and flat forms: the
 * book's web up to the scrubber, who is chosen (one, or a pair), and the
 * pair's history while it is watched.
 */
export function useCast(bundle: VolumeBundle | null | undefined, portraits: AlbumPortrait[], reducedMotion: boolean) {
  const [step, setStep] = useState<number | null>(null);
  const [playing, setPlaying] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  /** The next pick (on the web or the orbit) becomes the second of a pair. */
  const [pickingSecond, setPickingSecond] = useState(false);
  /** Index into the pair's history while watching it. */
  const [watching, setWatching] = useState<number | null>(null);

  const portraitOf = useMemo(() => new Map(portraits.map((portrait) => [portrait.entityId, portrait.asset])), [portraits]);
  const data = useMemo(() => bundle ? fromBundles([bundle], "volume", (_, entityId) => portraitOf.get(entityId) ?? "") : null, [bundle, portraitOf]);
  const positions = useMemo(() => data ? [...new Set(data.scenes.map((scene) => scene.story))].sort((x, y) => x - y) : [], [data]);
  const at = step === null ? positions.length - 1 : Math.min(step, positions.length - 1);
  const until = positions[at];
  const web = useMemo(() => data ? characterWeb(data, { until }) : null, [data, until]);
  // The pair's whole history; what lies past the scrubber is dimmed, not hidden.
  const pair = useMemo(() => data && selected.length === 2 ? pairHistory(data, selected[0], selected[1]) : null, [data, selected]);
  const reached = data?.scenes.find((scene) => scene.story === until);

  // Replaying the book: the web grows scene by scene.
  const timer = useRef<ReturnType<typeof setInterval>>(undefined);
  useEffect(() => {
    if (!playing) return;
    timer.current = setInterval(() => setStep((current) => {
      const next = (current ?? positions.length - 1) >= positions.length - 1 ? 0 : (current ?? 0) + 1;
      if (next >= positions.length - 1) setPlaying(false);
      return next;
    }), reducedMotion ? 320 : 160);
    return () => clearInterval(timer.current);
  }, [playing, positions.length, reducedMotion]);

  // Watching a pair: the scrubber jumps to each moment they share.
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

  const choose = useCallback((ids: string[]) => { setSelected(ids); setPickingSecond(false); }, []);
  /** A pick from the web or the orbit: replaces the choice, or completes a pair when one is being picked. */
  const pick = useCallback((id: string, additive = false) => setSelected((current) => {
    setPickingSecond(false);
    if (current.includes(id)) return current.length === 2 ? current : current.filter((entry) => entry !== id);
    return (additive || pickingSecond) && current.length ? [current[current.length - 1], id] : [id];
  }), [pickingSecond]);
  const scrub = useCallback((index: number) => { setPlaying(false); setWatching(null); setStep(index); }, []);

  return {
    data, web, pair, positions, at, until, reached, selected, choose, pick, scrub,
    playing, togglePlay: () => { setWatching(null); setPlaying(!playing); },
    pickingSecond, setPickingSecond,
    watching, toggleWatch: () => setWatching(watching === null ? 0 : null),
  };
}
export type CastState = ReturnType<typeof useCast>;
