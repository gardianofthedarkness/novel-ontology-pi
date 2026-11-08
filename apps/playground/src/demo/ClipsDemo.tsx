import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { ClipReel, type ReelEntry } from "../components/StageClips";
import type { HoloScript } from "../data/holoScript";
import type { MovePlan } from "../data/holoNav";
import type { StageClip } from "../data/stageClips";
import "./clips-demo.css";

/**
 * Stage clips as a standalone page to share (clips-demo.html): the clip
 * player over clips exported ahead of time (playground/export-clips-demo.mjs),
 * embedded in the page as JSON. No host, archive, book text or agent behind
 * it: each clip carries only its scene's beats (summaries and names), its
 * place and the prepared moves.
 */
export interface ClipsDemoData { exportedAt: string; books: { id: number; title: string; stages: Record<string, { script: HoloScript; plan: MovePlan }>; clips: StageClip[] }[] }

const embedded = (): ClipsDemoData | null => {
  try { const data = JSON.parse(document.getElementById("clips-data")?.textContent || "null"); return data?.books ? data : null; } catch { return null; }
};

function ClipsDemo() {
  // In the built page the clips are embedded; the dev server reads clips-demo.json beside the page.
  const [data, setData] = useState<ClipsDemoData | null | "missing">(embedded);
  useEffect(() => {
    if (data) return;
    fetch("clips-demo.json").then((response) => response.ok ? response.json() : null).then((loaded: ClipsDemoData | null) => setData(loaded?.books ? loaded : "missing")).catch(() => setData("missing"));
  }, [data]);
  const [book, setBook] = useState<number | null>(null);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  useEffect(() => { const query = window.matchMedia("(prefers-reduced-motion: reduce)"); const change = () => setReducedMotion(query.matches); query.addEventListener("change", change); return () => query.removeEventListener("change", change); }, []);
  const books = data && data !== "missing" ? data.books : [];
  const shown = books.find((entry) => entry.id === book) ?? books.at(-1);
  // Clips of one place share its stage (one hologram, kept between them).
  const entries = useMemo(() => shown ? shown.clips.flatMap((clip): ReelEntry[] => shown.stages[clip.placeId] ? [{ clip, stage: clip.placeId, ...shown.stages[clip.placeId] }] : []) : [], [shown]);
  return <ClipReel entries={entries} eyebrow="STAGE CLIPS · DEMO" title={shown?.title ?? "Stage clips"} books={books.map((entry) => ({ id: entry.id, label: entry.title }))} book={shown?.id ?? null}
    onBook={setBook} reducedMotion={reducedMotion} status={data === "missing" ? "No clips in this page." : "Opening the clips…"} />;
}

createRoot(document.getElementById("root")!).render(<StrictMode><ClipsDemo /></StrictMode>);
