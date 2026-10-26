import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useChromeInsets } from "./useChromeInsets";
import type { OrbitalInspection } from "./OrbitalExplorer";
import { locateRecord, narrativeChapters, type NarrativeChapter, type NarrativeScene } from "../data/narrative";
import { activityFocus, piBusy, type LiveActivity } from "../data/liveActivity";
import { dateLine, type TimePlaceProjection } from "../data/timePlace";
import type { WorldEdge, WorldNode } from "../types";

/**
 * Traditional mode, Narrative view: the book in reading order as a flat
 * list (no WebGL). Chapters open to their scenes; a scene opens to its
 * events and dialogue. Selecting anything fills the same inspector the
 * orbit uses. Proposals and held records show in place with their state,
 * and the chapter Pi is working in is marked live.
 */
interface Props {
  world: { laneNodes: WorldNode[]; interiors: Record<string, { nodes: WorldNode[]; edges: WorldEdge[] }>; bigEventLabels?: Record<string, string> };
  activityNodes: WorldNode[];
  activityEdges: WorldEdge[];
  activity: LiveActivity | null;
  followingActivity: boolean;
  timePlace: TimePlaceProjection | null;
  bookBar?: ReactNode;
  selectedId: string | null;
  focusRequest: { node: WorldNode; sequence: number } | null;
  onSelect: (inspection: OrbitalInspection | null) => void;
}

const STATE_LABEL: Record<string, string> = { proposed: "proposed", held: "held", branch: "branch" };
const stateTag = (node: WorldNode) => node.state !== "canon" ? <em className={`nl-state is-${node.state}`}>{STATE_LABEL[node.state] ?? node.state}</em> : null;
const recordText = (node: WorldNode) => node.dialogue?.text ? `${node.dialogue.speakerLabel ?? node.dialogue.participantLabels?.join(" / ") ?? ""}${node.dialogue.speakerLabel || node.dialogue.participantLabels?.length ? "：" : ""}${node.dialogue.text}` : node.summary ?? node.label;

export function NarrativeList({ world, activityNodes, activityEdges, activity, followingActivity, timePlace, bookBar, selectedId, focusRequest, onSelect }: Props) {
  const insets = useChromeInsets();
  const chapters = useMemo(() => narrativeChapters(world, activityNodes, activityEdges), [world, activityNodes, activityEdges]);
  const [openChapters, setOpenChapters] = useState<Set<string>>(() => new Set());
  const [openScenes, setOpenScenes] = useState<Set<string>>(() => new Set());
  const rowRefs = useRef(new Map<string, HTMLElement>());
  const timeById = useMemo(() => new Map((timePlace?.times ?? []).map((time) => [time.id, time])), [timePlace]);
  const sceneTime = useMemo(() => new Map((timePlace?.scenes ?? []).map((scene) => [scene.id, scene])), [timePlace]);
  const focus = activityFocus(activity);
  const touched = new Set(focus.nodeIds);
  const busy = piBusy(activity);
  const working = (activity?.faculties ?? []).filter((faculty) => faculty.active > 0 || faculty.recent);
  const liveChapter = busy ? activity?.chapterId ?? null : null;
  const sceneCount = chapters.reduce((sum, chapter) => sum + chapter.scenes.length, 0);

  const toggle = (setter: typeof setOpenChapters, id: string, open?: boolean) => setter((current) => {
    const next = new Set(current);
    if (open ?? !next.has(id)) next.add(id); else next.delete(id);
    return next;
  });
  const inspect = (node: WorldNode, chapter: NarrativeChapter, scene: NarrativeScene | null) => {
    const siblings = node.kind === "bigEvent" ? chapters.map((entry) => entry.node) : scene && node.id !== scene.node.id ? scene.records : chapter.scenes.map((entry) => entry.node);
    const contents = node.kind === "bigEvent" ? chapter.scenes.map((entry) => entry.node) : scene && node.id === scene.node.id ? scene.records : [];
    // A chapter has no summary of its own; show its gist like the orbit does.
    if (node.kind === "bigEvent" && !node.summary && chapter.gist) node = { ...node, summary: chapter.gist };
    onSelect({ node, nodes: siblings.length ? siblings : [node], edges: chapter.edges, lookupNodes: chapter.nodes, contents });
  };
  const reveal = (id: string, select: boolean) => {
    const found = locateRecord(chapters, id);
    if (!found) return;
    toggle(setOpenChapters, found.chapter.node.id, true);
    if (found.scene && found.scene.node.id !== id) toggle(setOpenScenes, found.scene.node.id, true);
    if (select) {
      const node = found.chapter.node.id === id ? found.chapter.node : found.chapter.nodes.find((entry) => entry.id === id);
      if (node) inspect(node, found.chapter, found.scene);
    }
    requestAnimationFrame(() => rowRefs.current.get(id)?.scrollIntoView({ block: "center", behavior: "smooth" }));
  };

  // Inspector links, record stepping and "fly to the work" arrive as focus requests.
  useEffect(() => { if (focusRequest) reveal(focusRequest.node.id, true); }, [focusRequest?.sequence]); // eslint-disable-line react-hooks/exhaustive-deps
  // Following Pi: keep the touched records open and in view, without taking the selection.
  const focusKey = followingActivity ? focus.id ?? liveChapter : null;
  useEffect(() => {
    if (!focusKey) return;
    const target = focus.nodeIds.find((id) => locateRecord(chapters, id)) ?? liveChapter;
    if (target) reveal(target, false);
  }, [focusKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const ref = (id: string) => (element: HTMLElement | null) => { if (element) rowRefs.current.set(id, element); else rowRefs.current.delete(id); };
  const names = (list: WorldNode[], limit: number) => list.length ? `${list.slice(0, limit).map((node) => node.label).join("、")}${list.length > limit ? ` +${list.length - limit}` : ""}` : "";

  return <section className="tp-view nl-view" aria-label="Narrative in reading order" style={insets}>
    <header className="tp-head">
      <div><span className="eyebrow">Narrative · reading order</span><b>{chapters.length} chapter{chapters.length === 1 ? "" : "s"} · {sceneCount} scene{sceneCount === 1 ? "" : "s"}</b></div>
      <p>The book in the order it is read. Open a chapter for its scenes and a scene for its events and dialogue; select any line to inspect it.</p>
      {bookBar}
    </header>
    {busy && <div className="nl-live" role="status">
      <i aria-hidden="true" /><span>Pi is working{liveChapter ? <> in <b lang="zh">{chapters.find((chapter) => chapter.node.id === liveChapter)?.title ?? liveChapter}</b></> : ""}{working.length ? ` · ${working.map((faculty) => faculty.label).join(", ")}` : ""}</span>
      {liveChapter && <button onClick={() => reveal(focus.nodeIds.find((id) => locateRecord(chapters, id)) ?? liveChapter, false)}>Show</button>}
    </div>}
    {!chapters.length && <div className="nl-empty">No chapters yet. They appear here as Pi reads the book.</div>}
    <ol className="nl-chapters">
      {chapters.map((chapter, index) => {
        const open = openChapters.has(chapter.node.id);
        const live = chapter.node.id === liveChapter;
        return <li key={chapter.node.id} className={`nl-chapter${open ? " is-open" : ""}${live ? " is-live" : ""}${selectedId === chapter.node.id ? " is-selected" : ""}`} ref={ref(chapter.node.id)}>
          <button className="nl-chapter-head" aria-expanded={open} onClick={() => { toggle(setOpenChapters, chapter.node.id); inspect(chapter.node, chapter, null); }}>
            <span className="nl-index">{String(index + 1).padStart(2, "0")}</span>
            <span className="nl-chapter-title">
              <b lang="zh">{chapter.title}</b>
              {chapter.gist && chapter.gist !== chapter.title && <span className="nl-summary" lang="zh">{chapter.gist}</span>}
              <span className="nl-meta">{chapter.scenes.length} scene{chapter.scenes.length === 1 ? "" : "s"} · {chapter.counts.events} event{chapter.counts.events === 1 ? "" : "s"} · {chapter.counts.dialogue} dialogue{chapter.counts.proposed ? <em className="nl-state is-proposed">{chapter.counts.proposed} proposed</em> : null}{chapter.counts.held ? <em className="nl-state is-held">{chapter.counts.held} held</em> : null}{live ? <em className="nl-state is-live">live</em> : null}</span>
              {!!chapter.cast.length && <span className="nl-cast" lang="zh">{chapter.cast.slice(0, 8).map(({ node }) => <span key={node.id} className={node.state !== "canon" ? "is-new" : ""} title={node.state !== "canon" ? `${node.label} (${node.state})` : node.label}>{node.label}</span>)}{chapter.cast.length > 8 && <span className="nl-more">+{chapter.cast.length - 8}</span>}</span>}
            </span>
            <span className="nl-caret" aria-hidden="true">{open ? "−" : "+"}</span>
          </button>
          {open && <ol className="nl-scenes">
            {chapter.scenes.map((scene) => {
              const sceneOpen = openScenes.has(scene.node.id);
              const story = sceneTime.get(scene.node.id);
              const time = story?.times.map((entry) => timeById.get(entry.id)).find(Boolean);
              const place = story?.placeIds[0] ? timePlace?.names[story.placeIds[0]] : scene.locations[0]?.label;
              return <li key={scene.node.id} className={`nl-scene${touched.has(scene.node.id) || scene.records.some((record) => touched.has(record.id)) ? " is-touched" : ""}${selectedId === scene.node.id ? " is-selected" : ""}${scene.node.state !== "canon" ? ` is-${scene.node.state}` : ""}`} ref={ref(scene.node.id)}>
                <div className="nl-scene-row">
                  <button className="nl-scene-main" onClick={() => inspect(scene.node, chapter, scene)} aria-pressed={selectedId === scene.node.id}>
                    <span className="nl-index">S{scene.number}</span>
                    <span className="nl-scene-text">
                      <span className="nl-scene-label" lang="zh">{scene.node.summary ?? scene.node.label}</span>
                      <span className="nl-chips" lang="zh">
                        {time && <span className={`nl-chip is-time${time.flashback ? " is-flashback" : ""}`} title={time.flashback ? "Flashback (story time)" : "Story time period"}>{time.flashback ? "↶ " : "◷ "}{time.label}{dateLine(time) ? ` · ${dateLine(time)}` : ""}</span>}
                        {place && <span className={`nl-chip is-place${story?.placeCarried ? " is-carried" : ""}`} title={story?.placeCarried ? "Carried over from the previous scene" : "Named in this scene"}>⌖ {place}</span>}
                        {!!scene.present.length && <span className="nl-chip is-cast">{names(scene.present, 4)}</span>}
                        {stateTag(scene.node)}
                      </span>
                    </span>
                  </button>
                  {!!scene.records.length && <button className="nl-records-toggle" aria-expanded={sceneOpen} aria-label={`${sceneOpen ? "Hide" : "Show"} ${scene.records.length} records in scene ${scene.number}`} onClick={() => toggle(setOpenScenes, scene.node.id)}>{scene.records.length}<span aria-hidden="true">{sceneOpen ? " ▴" : " ▾"}</span></button>}
                </div>
                {sceneOpen && <ol className="nl-records">
                  {scene.records.map((record) => <li key={record.id} ref={ref(record.id)} className={`${touched.has(record.id) ? "is-touched" : ""}${selectedId === record.id ? " is-selected" : ""}${record.state !== "canon" ? ` is-${record.state}` : ""}`}>
                    <button onClick={() => inspect(record, chapter, scene)} aria-pressed={selectedId === record.id}><span className="nl-kind">{record.kind === "dialogue" ? "“ ”" : "·"}</span><span lang="zh">{recordText(record)}</span>{stateTag(record)}</button>
                  </li>)}
                </ol>}
              </li>;
            })}
            {!!chapter.loose.length && <li className="nl-loose">
              <span className="eyebrow">Not in a scene yet · {chapter.loose.length}</span>
              <ol className="nl-records">{chapter.loose.map((record) => <li key={record.id} ref={ref(record.id)} className={`${touched.has(record.id) ? "is-touched" : ""}${selectedId === record.id ? " is-selected" : ""}${record.state !== "canon" ? ` is-${record.state}` : ""}`}>
                <button onClick={() => inspect(record, chapter, null)} aria-pressed={selectedId === record.id}><span className="nl-kind">{record.kind === "dialogue" ? "“ ”" : "·"}</span><span lang="zh">{recordText(record)}</span>{stateTag(record)}</button>
              </li>)}</ol>
            </li>}
            {!chapter.scenes.length && !chapter.loose.length && <li className="nl-empty">No scenes in this chapter yet.</li>}
          </ol>}
        </li>;
      })}
    </ol>
  </section>;
}
