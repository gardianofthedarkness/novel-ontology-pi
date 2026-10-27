import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityTab, DecisionFeed, GateQueue, type FeedEntry } from "./components/panels";
import { PipelineStrip } from "./components/PipelineStrip";
import { PiConsole } from "./components/PiConsole";
import { PiReviewProgress } from "./components/PiReviewProgress";
import { loadWorld, type LoadedWorld } from "./data/loadWorld";
import { FileEventSource } from "./events/fileSource";
import { SseEventSource } from "./events/sseSource";
import { RecordInspector } from "./components/RecordInspector";
import { AlbumPanel, type AlbumPanelPicture } from "./components/AlbumPanel";
import { albumEntries } from "./data/albumEntries";
import { OrbitalExplorer, type OrbitalInspection } from "./components/OrbitalExplorer";
import type { OrbitIllustration } from "./data/pictureNodes";
import "./orbital.css";
import "./live.css";
import "./glass.css";
import "./timeplace.css";
import { StoryTimeline } from "./components/StoryTimeline";
import { NarrativeList } from "./components/NarrativeList";
import "./narrative.css";
import { PlaceMap } from "./components/PlaceMap";
import { followTarget, timePlaceEmergence, universeIds, type TimePlaceProjection } from "./data/timePlace";
import { atlasArrangement, atlasNodeId, atlasWorld, pinNodeId, readingOrderProjection, sceneOfSpiral, spiralNodeId, SCENE_LEVEL, spiralArrangement, spiralWorld, type AtlasLevels, type StoryShape } from "./data/orbitalTimePlace";
import { AtlasPanel } from "./components/AtlasPanel";
import { RollingText } from "./components/RollingText";
import { attachSwipe } from "./swipe";
import type { Swipe } from "./data/gestures";
import { activityFocus, type LiveActivity } from "./data/liveActivity";
import { applySnapshotChanges } from "../../../tools/pi-review/snapshot-delta.mjs";
import { KIND_LABEL } from "./archive";
import { worldCausalLinks } from "./data/causalProjection";
import { freshIdentityEvents, type PendingJoin } from "./data/joinAnimation";
import { liveAlbum, sameAlbumEntries, type LiveAlbum } from "./data/liveAlbum";
import { acceptsSnapshot, bookName, bookOptionLabel, bookQuery, libraryBooks, parseBookParam, sameBooks, viewedBook, type BookEntry } from "./data/bookCatalog";
import { withOverviewActivity } from "./data/timelineLayout";
import type {
  AlbumPortrait,
  ChangeSet,
  EventSource as PlaygroundEventSource,
  PlaygroundEvent,
  ViewState,
  WorldEdge,
  WorldNode,
} from "./types";

const KNIT_SITE = "chapter_0";
const DB = "db/novel";
let feedSeq = 0;
const EMPTY_TIME_PLACE: TimePlaceProjection = { available: false, times: [], scenes: [], places: [], characters: [], names: {} };
/** Two modes (Orbital 3D, Traditional flat), each with the same three views. */
type StageView = "narrative" | "story" | "places";
const STAGE_VIEWS: [StageView, string][] = [["narrative", "Narrative"], ["story", "Story time"], ["places", "Places"]];
const MODES: [boolean, string][] = [[true, "Orbital"], [false, "Traditional"]];
const NO_NODES: WorldNode[] = [];
const NO_EDGES: WorldEdge[] = [];
const NO_JOINS: PendingJoin[] = [];
const ignoreChapter = () => {};

interface LiveSnapshot {
  /** Story time and places (time-place faculty); absent on older viewers. */
  timePlace?: TimePlaceProjection;
  universeTimePlace?: TimePlaceProjection;
  world: LoadedWorld;
  activity?: LiveActivity;
  libraryActivity?: { count: number; latest: { id: string; type: string; timestamp: string } | null };
  gates: ChangeSet[];
  feed: FeedEntry[];
  status: "idle" | "working" | "review" | "complete" | "error";
  stage: number;
  label: string;
  volume?: number;
  activeVolume?: number;
  availableVolumes?: number[];
  books?: BookEntry[];
  album?: LiveAlbum;
  jobLabel?: string;
  counts: { entities: number; events: number; repairs: number; ghosts: number };
  workSite?: string;
}

/** Follow a merge chain (a keeper can itself be merged away later). */
function resolveKept(id: string, merges: Map<string, string>): string {
  let current = id;
  const seen = new Set<string>();
  while (merges.has(current) && !seen.has(current)) {
    seen.add(current);
    current = merges.get(current)!;
  }
  return current;
}

/**
 * The graph state after settled EM merges: dropped records are gone,
 * their edges retargeted onto the survivor (self-loops and edges to
 * vanished nodes dropped). Applied to the loaded world and to the
 * session's ghost layer alike — one graph, merges included.
 */
function applyMergesToSet(
  nodes: WorldNode[],
  edges: WorldEdge[],
  merges: Map<string, string>,
): { nodes: WorldNode[]; edges: WorldEdge[] } {
  if (merges.size === 0) return { nodes, edges };
  const keptNodes = nodes.filter((n) => !merges.has(n.id));
  const keptIds = new Set(keptNodes.map((n) => n.id));
  const keptEdges = edges
    .map((e) => ({ ...e, from: resolveKept(e.from, merges), to: resolveKept(e.to, merges) }))
    .filter((e) => e.from !== e.to && keptIds.has(e.from) && keptIds.has(e.to));
  return { nodes: keptNodes, edges: keptEdges };
}

export default function App() {
  const [world, setWorld] = useState<LoadedWorld | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [view, setView] = useState<ViewState>({ mode: "lanes" });
  const [showRelations, setShowRelations] = useState(true);
  // Deep links: ?mode=orbital|traditional and ?view=narrative|story|places.
  const [orbitalMode, setOrbitalMode] = useState(() => new URLSearchParams(window.location.search).get("mode") !== "traditional");
  /** Narrative (reading order), Story time (when it happens) or Places (where). */
  const [stageView, setStageView] = useState<StageView>(() => {
    const requested = new URLSearchParams(window.location.search).get("view");
    return requested === "story" || requested === "places" ? requested : "narrative";
  });
  const [timePlace, setTimePlace] = useState<TimePlaceProjection | null>(null);
  /** Story time and places of the whole universe the reader's book belongs to (every hosted book). */
  const [universeTimePlace, setUniverseTimePlace] = useState<TimePlaceProjection | null>(null);
  /** Orbital Places: story periods rendered above the map (null: all). */
  const [atlasPeriods, setAtlasPeriods] = useState<Set<string> | null>(null);
  /** Orbital Places: only the scenes that were at the centre of the Story time spiral (null: no limit). */
  const [atlasFocus, setAtlasFocus] = useState<Set<string> | null>(null);
  const [atlasLevels, setAtlasLevels] = useState<AtlasLevels>(SCENE_LEVEL);
  /** Orbital Story time: one spiral line, or strands on a ribbon (remembered per browser). */
  const [storyShape, setStoryShape] = useState<StoryShape>(() => { try { return localStorage.getItem("story-shape") === "strands" ? "strands" : "line"; } catch { return "line"; } });
  const chooseStoryShape = (shape: StoryShape) => { setStoryShape(shape); try { localStorage.setItem("story-shape", shape); } catch { /* per-browser convenience only */ } };
  /** Scenes at the centre of the Story time spiral, kept for the switch to Places. */
  const storyCentre = useRef<string[]>([]);
  const noteStoryCentre = useCallback((ids: string[]) => { storyCentre.current = ids.map(sceneOfSpiral).filter((id): id is string => !!id); }, []);
  /** Story time → Places (orbital): Places opens on the stretch of the spiral that was in view. */
  const chooseStageView = (next: StageView) => {
    if (orbitalMode && stageView === "story" && next === "places" && storyCentre.current.length) {
      // Only scenes Places can show (placed, same ids); none left means open on everything, never an empty map.
      const placed = new Set((viewTimePlace?.scenes ?? []).filter((scene) => scene.placeIds.length).map((scene) => scene.id));
      const focus = storyCentre.current.filter((id) => placed.has(id));
      setAtlasFocus(focus.length ? new Set(focus) : null);
    }
    setStageView(next);
  };
  const [orbitalReset, setOrbitalReset] = useState(0);
  const [orbitalInspection, setOrbitalInspection] = useState<OrbitalInspection | null>(null);
  const [orbitalPage, setOrbitalPage] = useState<{ key: string; label: string; kind: string; chapterId?: string } | null>(null);
  const reportOrbitalPage = useCallback((page: { key: string; label: string; kind: string; chapterId?: string }) => setOrbitalPage(current => current?.key === page.key && current.label === page.label ? current : page), []);
  const [orbitalFocus, setOrbitalFocus] = useState<{ node: WorldNode; sequence: number; chapterId?: string; passive?: boolean } | null>(null);
  const [albumInfo, setAlbumInfo] = useState<AlbumPanelPicture[]>([]);
  const inspectOrbital = useCallback((inspection: OrbitalInspection | null) => { setOrbitalInspection(inspection); if (inspection?.album) setAlbumInfo(inspection.album); if (inspection?.passive) return; if (inspection?.inspect !== false && inspection) setPanel(inspection.node.kind === "picture" ? "album" : "record"); setInspectorOpen(!!inspection && inspection.inspect !== false); }, []);
  const chapterOrbital = useCallback((id: string | null) => setView((current) => id ? current.mode === "interior" && current.bigEventId === id ? current : { mode: "interior", bigEventId: id } : current.mode === "lanes" ? current : { mode: "lanes" }), []);
  const [selectedId, setSelectedId] = useState<string | null>("chapter_0");
  const [panel, setPanel] = useState<"record" | "activity" | "review" | "album">("record");
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  const [dynNodes, setDynNodes] = useState<WorldNode[]>([]);
  const [dynEdges, setDynEdges] = useState<WorldEdge[]>([]);
  const [albumPictures, setAlbumPictures] = useState<OrbitIllustration[]>([]);
  const [albumPortraits, setAlbumPortraits] = useState<AlbumPortrait[]>([]);
  const [proposalsByCs, setProposalsByCs] = useState<Record<string, string[]>>({});
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [stage, setStage] = useState(0);
  const [processingStatus, setProcessingStatus] = useState<"idle" | "working" | "review" | "complete" | "error">("idle");
  const [changesets, setChangesets] = useState<ChangeSet[]>([]);
  const [heldMap, setHeldMap] = useState<Record<string, string[]>>({});
  /** Settled EM merges (dropId -> keepId) and the join now animating. */
  const [merges, setMerges] = useState<Map<string, string>>(new Map());
  /** Real EM joins now animating; several can arrive in one refresh. */
  const [joins, setJoins] = useState<PendingJoin[]>([]);
  const joinsRef = useRef<PendingJoin[]>([]);
  const joinTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const joinSeq = useRef(0);
  const labelsRef = useRef<Record<string, string>>({});
  const [activity, setActivity] = useState({ count: 0, shine: false, caughtUp: false });
  const [blockLabel, setBlockLabel] = useState<string | null>(null);
  const sourceRef = useRef<PlaygroundEventSource | null>(null);
  /** Live mode: ?live=<watch SSE url> swaps the file replay for `novel watch`. */
  const liveUrl = useMemo(
    () => new URLSearchParams(window.location.search).get("live"),
    [],
  );
  const phoneLive = useMemo(() => new URLSearchParams(window.location.search).has("phone"), []);
  const [liveLabel, setLiveLabel] = useState("Fresh database · connecting to Pi");
  const [liveCollection, setLiveCollection] = useState("Live novel / connecting");
  const [liveCounts, setLiveCounts] = useState({ entities: 0, events: 0, repairs: 0, ghosts: 0 });
  const [workSite, setWorkSite] = useState("chapter_0");
  const seenMerges = useRef(new Set<string>());
  const [liveActivity, setLiveActivity] = useState<LiveActivity | null>(null);
  const [followingActivity, setFollowingActivity] = useState(false);
  /** Pinned reading book (the owner's choice) vs the book Pi is working on.
   * Only an explicit Follow agent shows Pi's book; an active-book change
   * never replaces the pin. loadedBook is the book whose records are shown. */
  const [pinnedBook, setPinnedBook] = useState<number | null>(() => parseBookParam(window.location.search));
  const [agentBook, setAgentBook] = useState<number | null>(null);
  const [loadedBook, setLoadedBook] = useState<number | null>(null);
  const [books, setBooks] = useState<BookEntry[]>([]);
  const requestedBook = viewedBook(pinnedBook, followingActivity, agentBook);
  const loadedBookRef = useRef<number | null>(null);
  const pinnedBookRef = useRef(pinnedBook);
  pinnedBookRef.current = pinnedBook;
  const readingPanelBookmark = useRef<{ inspection: OrbitalInspection | null; panel: "record" | "activity" | "review" | "album"; open: boolean; selectedId: string | null } | null>(null);
  const identityBaseline = useRef(false);
  const libraryBaseline = useRef<string | null>(null);
  const [identityNotice, setIdentityNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!identityNotice) return;
    const timer = setTimeout(() => setIdentityNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [identityNotice]);
  /** The most recently emerged ghost node — where System 1 is knitting right now (Phase B). */
  const lastKnitRef = useRef<{ node: WorldNode; chapterId: string } | null>(null);
  // Glass panels catch the pointer (static under reduced motion).
  const inspectorRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    // Live viewers receive their (book-scoped) world from the snapshot stream.
    if (phoneLive) return;
    loadWorld(`${DB}/view.json`)
      .then(setWorld)
      .catch((e: Error) => setLoadError(e.message));
  }, [phoneLive]);

  const pushFeed = useCallback((text: string, tone: FeedEntry["tone"] = "plain") => {
    setFeed((f) => [...f.slice(-40), { id: ++feedSeq, text, tone }]);
  }, []);

  /** Activity shines when something happens where the user is NOT looking. */
  const noteActivity = useCallback((alwaysShine: boolean) => {
    const v = viewRef.current;
    const atSite = v.mode === "interior" && v.bigEventId === KNIT_SITE;
    if (atSite && !alwaysShine) return;
    setActivity((a) => ({ count: a.count + 1, shine: true, caughtUp: false }));
  }, []);

  /** The world as currently settled: EM-merged records already joined. */
  const displayWorld = useMemo<LoadedWorld | null>(() => {
    if (!world) return null;
    if (merges.size === 0) return world;
    const lanes = applyMergesToSet(world.laneNodes, world.laneEdges, merges);
    const interiors: LoadedWorld["interiors"] = {};
    for (const [id, group] of Object.entries(world.interiors)) {
      interiors[id] = applyMergesToSet(group.nodes, group.edges, merges);
    }
    return { ...world, laneNodes: lanes.nodes, laneEdges: lanes.edges, interiors };
  }, [world, merges]);

  const visibleDyn = useMemo(
    () => applyMergesToSet(dynNodes, dynEdges, merges),
    [dynNodes, dynEdges, merges],
  );

  /** A join animation finished (or cannot run here): settle the merge. */
  const settleJoin = useCallback((dropId: string) => {
    const current = joinsRef.current.find((entry) => entry.dropId === dropId);
    if (!current) return;
    joinsRef.current = joinsRef.current.filter((entry) => entry !== current);
    clearTimeout(joinTimers.current.get(dropId));
    joinTimers.current.delete(dropId);
    setJoins(joinsRef.current);
    setMerges((m) => new Map(m).set(current.dropId, current.keepId));
  }, []);

  const clearJoins = useCallback(() => {
    for (const timer of joinTimers.current.values()) clearTimeout(timer);
    joinTimers.current.clear();
    joinsRef.current = [];
    setJoins([]);
  }, []);

  const beginJoin = useCallback(
    (dropId: string, keepId: string) => {
      if (joinsRef.current.some((entry) => entry.dropId === dropId)) return;
      joinsRef.current = [...joinsRef.current, { id: `${dropId}>${keepId}`, dropId, keepId, seq: ++joinSeq.current }];
      setJoins(joinsRef.current);
      // Backstop: if neither renderer can animate this pair (off-view
      // in both), the merge still settles promptly.
      joinTimers.current.set(dropId, setTimeout(() => settleJoin(dropId), 2600));
    },
    [settleJoin],
  );

  const handleEvent = useCallback(
    (ev: PlaygroundEvent) => {
      switch (ev.type) {
        case "block.started":
          setProcessingStatus("working");
          setBlockLabel(ev.label);
          setStage(0);
          pushFeed(`▸ ${ev.label} entered the pipeline`);
          break;
        case "sectioned":
          setStage(1);
          pushFeed(`▸ sectioned — ${ev.sentences} sentences`);
          break;
        case "verdict":
          setStage(1);
          pushFeed(ev.text, "jev");
          break;
        case "proposal.added":
          setStage(2);
          // Replace-by-id: a revised changeset re-emits its ghosts,
          // and a relation re-emits its source node to carry the edge.
          setDynNodes((ns) => [...ns.filter((n) => n.id !== ev.node.id), ev.node]);
          setDynEdges((es) => [
            ...es.filter((e) => !ev.edges.some((x) => x.id === e.id)),
            ...ev.edges,
          ]);
          lastKnitRef.current = { node: ev.node, chapterId: ev.node.parent ?? KNIT_SITE };
          setProposalsByCs((m) => ({
            ...m,
            [ev.changesetId]: [...(m[ev.changesetId] ?? []), ev.node.id],
          }));
          pushFeed(`◌ proposal — ${ev.node.label} (ghost, branch)`, "warn");
          noteActivity(false);
          break;
        case "changeset.pending":
          setStage(4);
          setProcessingStatus("review");
          setChangesets((cs) => [
            ...cs,
            { id: ev.changesetId, label: ev.label, status: "pending", nodeIds: ev.nodeIds },
          ]);
          pushFeed(`⚖ ${ev.label} reached the GATE`, "warn");
          noteActivity(true); // gate arrivals always shine
          break;
        case "changeset.held": {
          setHeldMap((m) => ({ ...m, [ev.changesetId]: ev.nodeIds }));
          setDynNodes((ns) =>
            ns.map((n) => (ev.nodeIds.includes(n.id) ? { ...n, state: "held" } : n)),
          );
          setDynEdges((es) =>
            es.map((e) =>
              ev.nodeIds.includes(e.from) || ev.nodeIds.includes(e.to)
                ? { ...e, state: "held" }
                : e,
            ),
          );
          pushFeed(
            `⧗ main agent HELD ${ev.nodeIds.length} proposal${ev.nodeIds.length === 1 ? "" : "s"} — ${ev.changesetId}`,
            "warn",
          );
          noteActivity(true); // escalations shine immediately
          break;
        }
        case "changeset.merged":
          setProcessingStatus("complete");
          pushFeed(`✓ ${ev.changesetId} merged — graph rebuilt`, "ok");
          break;
        case "entity.merged": {
          const dropLabel = labelsRef.current[ev.dropId] ?? ev.dropId;
          const keepLabel = labelsRef.current[ev.keepId] ?? ev.keepId;
          pushFeed(`⬢ EM matched — ${dropLabel} joins ${keepLabel} (same entity)`, "jev");
          noteActivity(false); // knitting, not an escalation: no forced shine
          beginJoin(ev.dropId, ev.keepId);
          break;
        }
        case "candidate.resolved":
          // Not an EM decision: a candidate glides into what it became.
          pushFeed(`◇ ${labelsRef.current[ev.dropId] ?? "candidate"} became ${labelsRef.current[ev.keepId] ?? ev.keepId}`);
          beginJoin(ev.dropId, ev.keepId);
          break;
        case "entity.distinct": {
          const aLabel = labelsRef.current[ev.aId] ?? ev.aId;
          const bLabel = labelsRef.current[ev.bId] ?? ev.bId;
          pushFeed(`⬢ EM — ${aLabel} ≠ ${bLabel} (kept distinct)`);
          break;
        }
        case "graph.rebuilt":
          pushFeed("✓ graph rebuilt from bundle", "ok");
          break;
        case "album.anchored":
          // Dedup by id: gate-mode re-runs re-emit the same block.
          setAlbumPictures((prev) => [
            ...prev.filter((pic) => !ev.pictures.some((next) => next.id === pic.id)),
            ...ev.pictures.map((pic) => ({ ...pic })),
          ]);
          pushFeed(`▸ album — ${ev.pictures.length} picture${ev.pictures.length === 1 ? "" : "s"} anchored (${ev.blockId})`);
          break;
        case "album.portraitBound":
          // Dedup by id, same as pictures. Unbound portraits emit nothing.
          setAlbumPortraits((prev) => [
            ...prev.filter((por) => !ev.portraits.some((next) => next.id === por.id)),
            ...ev.portraits.map((por) => ({ ...por })),
          ]);
          pushFeed(`▸ album — ${ev.portraits.length} portrait${ev.portraits.length === 1 ? "" : "s"} bound (${ev.blockId})`);
          break;
      }
    },
    [noteActivity, pushFeed, beginJoin],
  );

  /** Per-book live state; the next snapshot re-baselines identity events. */
  const resetBookData = useCallback(() => {
    clearJoins();
    setMerges(new Map());
    setDynNodes([]);
    setDynEdges([]);
    setAlbumPictures([]);
    setAlbumPortraits([]);
    setAlbumInfo([]);
    setProposalsByCs({});
    setHeldMap({});
    seenMerges.current = new Set();
    identityBaseline.current = false;
    setIdentityNotice(null);
  }, []);

  const startSession = useCallback(() => {
    sourceRef.current?.stop();
    lastKnitRef.current = null;
    clearJoins();
    setMerges(new Map());
    setDynNodes([]);
    setDynEdges([]);
    setAlbumPictures([]);
    setAlbumPortraits([]);
    setAlbumInfo([]);
    setProposalsByCs({});
    setFeed([]);
    setChangesets([]);
    setHeldMap({});
    setActivity({ count: 0, shine: false, caughtUp: false });
    setStage(0);
    setProcessingStatus("idle");
    const src: PlaygroundEventSource = liveUrl
      ? new SseEventSource(liveUrl)
      : new FileEventSource(`${DB}/events.jsonl`);
    src.subscribe(handleEvent);
    sourceRef.current = src;
    try {
      const started = src.start();
      if (started) {
        void started.catch((e: Error) => {
          setProcessingStatus("error");
          pushFeed(`⚠ events file: ${e.message}`, "warn");
        });
      }
    } catch (e) {
      setProcessingStatus("error");
      pushFeed(`⚠ event source: ${(e as Error).message}`, "warn");
    }
  }, [handleEvent, pushFeed, liveUrl]);

  useEffect(() => {
    if (!phoneLive) return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    let current: LiveSnapshot | null = null;
    let previousWorld: LoadedWorld | null = null;
    let stream: EventSource | null = null;
    let polling = false;
    let request: AbortController | null = null;
    const receive = (data: LiveSnapshot) => {
        if (stopped || !acceptsSnapshot(requestedBook, data)) return;
        const volume = data.volume ?? null;
        if (volume !== loadedBookRef.current) {
          // Another book: its graph, ghosts, joins and merge baseline start
          // fresh, so the new book's historical merges never replay as live.
          if (loadedBookRef.current !== null) resetBookData();
          loadedBookRef.current = volume;
          setLoadedBook(volume);
        }
        const nextBooks = libraryBooks(data);
        setBooks((previous) => sameBooks(previous, nextBooks) ? previous : nextBooks);
        setAgentBook(data.activeVolume ?? null);
        if (data.album) {
          // Live album: anchored EPUB pictures and bound portraits from the snapshot.
          const album = liveAlbum(data.album, volume);
          setAlbumPictures((previous) => sameAlbumEntries(previous, album.pictures) ? previous : album.pictures);
          setAlbumPortraits((previous) => sameAlbumEntries(previous, album.portraits) ? previous : album.portraits);
        }
        if (pinnedBookRef.current === null && volume !== null) setPinnedBook(volume);
        current = data;
        if (data.world !== previousWorld) {
          previousWorld = data.world;
          setWorld(data.world);
        }
        const identity = freshIdentityEvents(data.activity?.identityEvents ?? [], seenMerges.current, identityBaseline.current);
        identityBaseline.current = identity.baselineDone;
        for (const record of identity.events) handleEvent(record.event);
        const emEvents = identity.events.filter((record) => record.event.type !== "candidate.resolved");
        if (emEvents.length) {
          const text = (record: (typeof identity.events)[number]) => record.event.type !== "entity.distinct" ? `${labelsRef.current[record.event.dropId] ?? record.event.dropId} → ${labelsRef.current[record.event.keepId] ?? record.event.keepId}` : `${labelsRef.current[record.event.aId] ?? record.event.aId} ≠ ${labelsRef.current[record.event.bId] ?? record.event.bId}`;
          const merged = emEvents.filter((record) => record.event.type === "entity.merged").length;
          setIdentityNotice(emEvents.length === 1 ? `EM ${merged ? "joined" : "kept distinct"} ${text(emEvents[0])}` : `EM · ${merged} joined, ${emEvents.length - merged} kept distinct · ${emEvents.slice(0, 3).map(text).join(" · ")}${emEvents.length > 3 ? " …" : ""}`);
        }
        setLiveActivity(data.activity ?? null);
        setChangesets(data.gates);
        setFeed(data.feed);
        setProcessingStatus(data.status);
        setStage(data.stage);
        setLiveLabel(data.label);
        setLiveCollection(`Volume ${data.volume ?? 1} / ${data.jobLabel ?? "Live processing"}`);
        setLiveCounts(data.counts);
        setTimePlace((previous) => data.timePlace && JSON.stringify(previous) === JSON.stringify(data.timePlace) ? previous : data.timePlace ?? null);
        setUniverseTimePlace((previous) => data.universeTimePlace && JSON.stringify(previous) === JSON.stringify(data.universeTimePlace) ? previous : data.universeTimePlace ?? null);
        setWorkSite(data.workSite ?? "chapter_0");
        setBlockLabel(data.label);
        setLoadError(null);
        const libraryEvent = data.libraryActivity?.latest;
        const newLibraryEvent = !!libraryEvent && libraryBaseline.current !== null && libraryBaseline.current !== libraryEvent.id;
        if (libraryEvent) libraryBaseline.current = libraryEvent.id;
        setActivity(currentActivity => ({ ...currentActivity, count: (data.activity?.count ?? 0) + (data.libraryActivity?.count ?? 0), shine: data.status === "working" || newLibraryEvent, caughtUp: data.status === "complete" && !newLibraryEvent }));
    };
    const poll = async () => {
      if (stopped || !polling) return;
      try {
        request = new AbortController();
        const response = await fetch(`api/live${bookQuery(requestedBook)}`, { cache: "no-store", signal: request.signal });
        if (!response.ok) throw new Error(`Live connection: HTTP ${response.status}`);
        const data = await response.json() as LiveSnapshot;
        if (polling) receive(data);
      } catch (error) {
        if (!stopped && polling) setLiveLabel(`Connection interrupted · retrying: ${(error as Error).message}`);
      } finally {
        if (!stopped && polling) timer = setTimeout(poll, 1000);
      }
    };
    const fallback = () => {
      if (stopped || polling) return;
      polling = true;
      void poll();
    };
    const reconnect = () => {
      if (stopped) return;
      stream?.close();
      stream = new EventSource(`api/live/stream${bookQuery(requestedBook)}`);
      stream.addEventListener("snapshot", event => {
        polling = false;
        request?.abort();
        clearTimeout(timer);
        receive(JSON.parse((event as MessageEvent).data) as LiveSnapshot);
      });
      stream.addEventListener("patch", event => {
        if (current) receive(applySnapshotChanges(current, JSON.parse((event as MessageEvent).data)) as LiveSnapshot);
      });
      stream.onerror = fallback;
    };
    if (typeof EventSource === "undefined") fallback();
    else reconnect();
    timer = setTimeout(() => { if (!current) fallback(); }, 4000);
    return () => { stopped = true; clearTimeout(timer); stream?.close(); request?.abort(); };
  }, [phoneLive, handleEvent, requestedBook, resetBookData]);

  useEffect(() => {
    if (!phoneLive || pinnedBook === null) return;
    try {
      const url = new URL(window.location.href);
      if (url.searchParams.get("book") === String(pinnedBook)) return;
      url.searchParams.set("book", String(pinnedBook));
      window.history.replaceState(window.history.state, "", url);
    } catch { /* the pin still works without a reload-safe URL */ }
  }, [phoneLive, pinnedBook]);

  /** Readonly selection among assigned books: no ingest, prompt or write. */
  const chooseBook = useCallback((id: number) => {
    if (id === pinnedBookRef.current) return;
    setPinnedBook(id);
    setOrbitalInspection(null);
    setInspectorOpen(false);
    setSelectedId(null);
  }, []);

  useEffect(() => {
    if (world && !phoneLive) startSession();
    return () => sourceRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [world]);

  const approve = useCallback(
    (changesetId: string) => {
      if (phoneLive) return;
      const held = heldMap[changesetId] ?? [];
      const ids = proposalsByCs[changesetId] ?? [];
      setDynNodes((ns) =>
        ns.map((n) => (ids.includes(n.id) && !held.includes(n.id) ? { ...n, state: "canon" } : n)),
      );
      setDynEdges((es) =>
        es.map((e) => (!held.includes(e.from) && !held.includes(e.to) ? { ...e, state: "canon" } : e)),
      );
      setChangesets((cs) =>
        cs.map((c) => (c.id === changesetId ? { ...c, status: "merged" } : c)),
      );
      handleEvent({ type: "changeset.merged", changesetId });
      setActivity({ count: 0, shine: false, caughtUp: true });
    },
    [handleEvent, heldMap, proposalsByCs, phoneLive],
  );

  /** Guided flight: wherever the user is, take the camera to the knitting site. */
  const flyToSite = useCallback(() => {
    if (phoneLive) {
      if (!followingActivity) {
        readingPanelBookmark.current = { inspection: orbitalInspection, panel, open: inspectorOpen, selectedId };
        setInspectorOpen(false);
      } else if (readingPanelBookmark.current) {
        const saved = readingPanelBookmark.current;
        setOrbitalInspection(saved.inspection);
        setPanel(saved.panel);
        setInspectorOpen(saved.open);
        setSelectedId(saved.selectedId);
        readingPanelBookmark.current = null;
      }
      setFollowingActivity(!followingActivity);
      return;
    }
    // Phase B: if real work has emerged this session, go to the latest
    // ghost in its own chapter — the demo world's fixed knit site is only
    // the fallback. Either mode's Narrative view answers the focus request.
    const knit = lastKnitRef.current;
    const target = knit && displayWorld?.interiors[knit.chapterId] ? knit : displayWorld?.interiors[KNIT_SITE]?.nodes[0] ? { node: displayWorld.interiors[KNIT_SITE].nodes[0], chapterId: KNIT_SITE } : null;
    if (target) {
      setStageView("narrative");
      setOrbitalFocus((current) => ({ node: target.node, chapterId: target.chapterId, sequence: (current?.sequence ?? 0) + 1 }));
      setView({ mode: "interior", bigEventId: target.chapterId });
      setSelectedId(target.node.id);
    }
    setPanel("review");
    setInspectorOpen(true);
    setActivity((a) => ({ ...a, count: 0, shine: false }));
  }, [displayWorld, phoneLive, followingActivity, orbitalInspection, panel, inspectorOpen, selectedId]);

  /** Switch mode, keeping the view; an open record stays open in the other mode. */
  const switchMode = (orbital: boolean) => {
    if (orbital === orbitalMode) return;
    setOrbitalMode(orbital);
    const node = orbitalInspection?.node;
    if (node && inspectorOpen && panel === "record") setOrbitalFocus({ node, sequence: Date.now() });
    else setOrbitalInspection(null);
  };
  useEffect(() => {
    try {
      const url = new URL(window.location.href);
      const mode = orbitalMode ? null : "traditional", view = stageView === "narrative" ? null : stageView;
      if (url.searchParams.get("mode") === mode && url.searchParams.get("view") === view) return;
      if (mode) url.searchParams.set("mode", mode); else url.searchParams.delete("mode");
      if (view) url.searchParams.set("view", view); else url.searchParams.delete("view");
      window.history.replaceState(window.history.state, "", url);
    } catch { /* the switch still works without a shareable URL */ }
  }, [orbitalMode, stageView]);

  const { nodes: sourceNodes, edges: sourceEdges } = useMemo(() => {
    if (!displayWorld) return { nodes: [] as WorldNode[], edges: [] as WorldEdge[] };
    if (view.mode === "lanes") {
      return withOverviewActivity(displayWorld.laneNodes, displayWorld.laneEdges, visibleDyn.nodes, visibleDyn.edges);
    }
    const interior = displayWorld.interiors[view.bigEventId];
    const mine = visibleDyn.nodes.filter((n) => n.parent === view.bigEventId);
    const myEdges = visibleDyn.edges.filter((e) => e.parent === view.bigEventId);
    return {
      nodes: [...(interior?.nodes ?? []), ...mine],
      edges: [...(interior?.edges ?? []), ...myEdges],
    };
  }, [displayWorld, view, visibleDyn]);
  const nodes = useMemo(() => [...sourceNodes].sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id)), [sourceNodes]);

  // Either renderer reports its selection as an inspection; without one the
  // transport walks the current chapter list.
  const displayNodes = orbitalInspection ? orbitalInspection.nodes : nodes;
  const selected = orbitalInspection ? orbitalInspection.node : nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const selectedIndex = selected ? Math.max(0, displayNodes.findIndex((node) => node.id === selected.id)) : 0;
  const pendingCount = changesets.filter((changeset) => changeset.status === "pending").length;
  useEffect(() => {
    if (panel !== "album") inspectorRef.current?.scrollTo(0, 0);
  }, [panel, selected?.id, view.mode, inspectorOpen]);
  /** Scene that holds each record (for following Pi in the scene-based views). */
  /** What Story time and Places show: the universe when the book is in one with other hosted books, else the book. */
  const viewTimePlace = universeTimePlace?.scope === "universe" ? universeTimePlace : timePlace;
  const universeId = useMemo(() => universeIds(viewTimePlace, loadedBook), [viewTimePlace, loadedBook]);
  /** The book the universe views fly to: the one chosen in the picker, or the one loaded. */
  const focusBook = requestedBook ?? loadedBook;
  const sceneOfRecord = useMemo(() => {
    const owner = new Map<string, string>();
    for (const interior of Object.values(displayWorld?.interiors ?? {})) {
      const scenes = new Set(interior.nodes.filter((node) => node.kind === "scene").map((node) => node.id));
      for (const edge of interior.edges) if (edge.kind === "contains" && scenes.has(edge.from) && !owner.has(edge.to)) owner.set(edge.to, edge.from);
      for (const id of scenes) owner.set(id, id);
    }
    return owner;
  }, [displayWorld]);
  const touchedScenes = useMemo(() => new Set(activityFocus(liveActivity).nodeIds.map((id) => sceneOfRecord.get(id)).filter((id): id is string => !!id)), [liveActivity, sceneOfRecord]);
  /** Periods and places that just emerged (new, or proposed → confirmed), for the highlight. */
  const [emerging, setEmerging] = useState<{ times: Set<string>; places: Set<string>; at: number } | null>(null);
  const previousTimePlace = useRef<TimePlaceProjection | null>(null);
  const previousBook = useRef<number | null>(null);
  const lastWork = useRef<string | null | undefined>(undefined);
  const lastAutoSwitch = useRef(0);
  const queuedSwitch = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** Latest follow/view state for the queued Places switch below: the callback
   *  must not fire after the user turned following off or moved to another view
   *  (manual tab switches bypass this effect, so the closed-over values would lie). */
  const followingRef = useRef(followingActivity);
  followingRef.current = followingActivity;
  const stageViewRef = useRef(stageView);
  stageViewRef.current = stageView;
  useEffect(() => () => { if (queuedSwitch.current) clearTimeout(queuedSwitch.current); }, []);
  // Following Pi reads its work across all three views: periods that emerge
  // open Story time, places open Places (after the periods), the time-place
  // run points to Story time and other new work to Narrative. A view stays
  // at least 5 s unless something new emerged.
  useEffect(() => {
    // A different book is not new work: its periods and places must not read as "just emerged"
    // (that focused its first scene and pulled the camera off the book the reader flew to).
    if (previousBook.current !== loadedBook) { previousBook.current = loadedBook; previousTimePlace.current = null; }
    const change = timePlace ? timePlaceEmergence(previousTimePlace.current, timePlace) : { times: [], places: [] };
    if (timePlace) previousTimePlace.current = timePlace;
    if (change.times.length || change.places.length) setEmerging({ times: new Set(change.times), places: new Set(change.places), at: Date.now() });
    const work = activityFocus(liveActivity).id ?? null;
    const otherWork = lastWork.current !== undefined && !!work && work !== lastWork.current;
    lastWork.current = work;
    if (!followingActivity) return;
    const target = followTarget(change, liveActivity?.command, otherWork);
    const emerged = change.times.length + change.places.length > 0;
    if (target && target !== stageView && (emerged || Date.now() - lastAutoSwitch.current > 5000)) { setStageView(target); lastAutoSwitch.current = Date.now(); }
    if (change.times.length && change.places.length) {
      if (queuedSwitch.current) clearTimeout(queuedSwitch.current);
      queuedSwitch.current = setTimeout(() => {
        if (!followingRef.current || stageViewRef.current !== "story") return;
        setStageView("places"); lastAutoSwitch.current = Date.now();
      }, 6000);
    }
  }, [timePlace, liveActivity]); // eslint-disable-line react-hooks/exhaustive-deps
  // Take the orbit to what just emerged (Story time: the period's first scene; Places: the place).
  const focusedEmergence = useRef(0);
  useEffect(() => {
    if (!emerging || !orbitalMode || focusedEmergence.current === emerging.at || !timePlace) return;
    const time = stageView === "story" ? timePlace.times.find((entry) => emerging.times.has(entry.id)) : undefined;
    const sceneId = time?.anchorSceneId ?? time?.sceneIds[0];
    const placeId = stageView === "places" ? [...emerging.places][0] : undefined;
    const id = sceneId ? spiralNodeId(universeId.scene(sceneId)) : placeId ? pinNodeId(universeId.place(placeId)) : null;
    if (!id) return;
    focusedEmergence.current = emerging.at;
    setOrbitalFocus({ node: { id, label: id, kind: "scene", state: "canon", parent: null, lane: "canon", chrono: 0, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }, sequence: Date.now(), passive: followingActivity });
  }, [emerging, stageView, orbitalMode, timePlace]);
  // Following Pi in the orbital Story time / Places views: go to the scene Pi is touching.
  useEffect(() => {
    if (!followingActivity || !orbitalMode || stageView === "narrative") return;
    // What just emerged keeps the camera for a while; then Pi's latest touch leads again.
    if (emerging && Date.now() - emerging.at < 9000) return;
    const sceneId = [...touchedScenes][0];
    if (!sceneId) return;
    const id = stageView === "story" ? spiralNodeId(universeId.scene(sceneId)) : atlasNodeId(universeId.scene(sceneId));
    setOrbitalFocus({ node: { id, label: id, kind: "scene", state: "canon", parent: null, lane: "canon", chrono: 0, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }, sequence: Date.now(), passive: true });
  }, [touchedScenes, followingActivity, orbitalMode, stageView]); // eslint-disable-line react-hooks/exhaustive-deps
  const requestOrbitalFocus = (node: WorldNode) => {
    if (orbitalInspection) setOrbitalInspection({ ...orbitalInspection, node });
    setOrbitalFocus({ node, sequence: Date.now() });
  };
  /** Album strip click: a placed picture also focuses its 3D card (which
   * re-opens the album panel on it); an unplaced picture has no card, so
   * the panel just shows it locally. */
  const albumThumbnailSelect = (id: string) => {
    const picture = albumInfo.find((entry) => entry.id === id);
    if (!picture?.placed) return;
    if (orbitalMode) {
      requestOrbitalFocus({ id, label: picture.label, kind: "picture", state: "canon", parent: null, lane: "canon", chrono: picture.chrono ?? 0, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] });
    } else {
      setSelectedId(id);
    }
  };
  const storyAlbum = useMemo(() => {
    if (!displayWorld || orbitalMode || stageView !== "story") return [];
    const order = timePlace?.available ? timePlace : readingOrderProjection(displayWorld);
    return albumEntries(spiralWorld(displayWorld, order).laneNodes, albumPictures);
  }, [displayWorld, timePlace, albumPictures, orbitalMode, stageView]);
  const selectStoryPicture = (id: string) => {
    const picture = storyAlbum.find(entry => entry.id === id);
    if (!picture) return;
    inspectOrbital({ node: { id, label: picture.label, kind: "picture", state: "canon", parent: null, lane: "canon", chrono: picture.chrono ?? 0, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] }, nodes: [], edges: [], lookupNodes: [], contents: [], album: storyAlbum });
  };
  const stepRecord = (step: number) => {
    if (displayNodes.length) requestOrbitalFocus(displayNodes[(selectedIndex + step + displayNodes.length) % displayNodes.length]);
  };
  /** Phone swipes on the record bar: left/right step records, up/down move
   * one orbital level deeper or back (the canvas keeps its own drag). */
  const swipeRef = useRef<(swipe: Swipe) => void>(() => {});
  const transportRef = useCallback((bar: HTMLElement | null) => bar ? attachSwipe(bar, (swipe) => swipeRef.current(swipe)) : undefined, []);
  swipeRef.current = (swipe) => {
    if (swipe === "left" || swipe === "right") { stepRecord(swipe === "left" ? 1 : -1); return; }
    if (orbitalMode) document.querySelector(".orbital-stage")?.dispatchEvent(new CustomEvent("orbital-nav", { detail: swipe === "up" ? "deeper" : "back" }));
  };
  const overview = () => {
    setOrbitalReset((current) => current + 1);
    setOrbitalInspection(null);
    if (view.mode === "interior") setSelectedId(view.bigEventId);
    setView({ mode: "lanes" });
    setPanel("record");
  };

  const labels = useMemo(() => {
    const map: Record<string, string> = { ...(displayWorld?.bigEventLabels ?? {}) };
    for (const n of [...(displayWorld?.laneNodes ?? []), ...visibleDyn.nodes]) map[n.id] = n.label;
    for (const group of Object.values(displayWorld?.interiors ?? {})) {
      for (const n of group.nodes) map[n.id] = n.label;
    }
    return map;
  }, [displayWorld, visibleDyn]);
  labelsRef.current = labels;

  /** Orbital Story time / Places: the world regrouped by period or by place (view only). */
  const regroupedOrbit = useMemo(() => {
    if (!orbitalMode || stageView === "narrative" || !displayWorld) return null;
    if (stageView === "story") {
      // Without time facts yet, the spiral runs in reading order (its causal arrows still show);
      // a universe stays a universe: every book in reading order, not just the book being read.
      const order = viewTimePlace?.available || viewTimePlace?.scope === "universe" ? viewTimePlace : readingOrderProjection(displayWorld);
      const spiral = spiralWorld(displayWorld, order, loadedBook);
      return { world: spiral, arrangement: spiralArrangement(order, spiral, focusBook, storyShape) };
    }
    if (!viewTimePlace?.places.length) return null;
    const filter = { periods: atlasPeriods, sceneIds: atlasFocus, levels: atlasLevels };
    const regrouped = atlasWorld(displayWorld, viewTimePlace, filter, loadedBook);
    return { world: regrouped, arrangement: atlasArrangement(viewTimePlace, filter, regrouped, focusBook) };
  }, [orbitalMode, stageView, displayWorld, viewTimePlace, atlasPeriods, atlasFocus, atlasLevels, loadedBook, focusBook, storyShape]);
  /** Live highlights and Pi's touches, in the ids the shown projection uses. */
  const shownEmerging = useMemo(() => emerging ? { times: new Set([...emerging.times].map(universeId.time)), places: new Set([...emerging.places].map(universeId.place)) } : null, [emerging, universeId]);
  const shownTouched = useMemo(() => new Set([...touchedScenes].map(universeId.scene)), [touchedScenes, universeId]);

  const shownWorld: LoadedWorld = displayWorld ?? (world as LoadedWorld);
  const loadedBookEntry = books.find((book) => book.id === loadedBook) ?? null;
  const agentBookEntry = books.find((book) => book.id === agentBook) ?? null;
  const bookLoading = phoneLive && requestedBook !== null && requestedBook !== loadedBook;
  const bookBar = phoneLive && books.length > 0 ? <div className="book-bar" role="group" aria-label="Books">
            <label className="book-picker"><span>{followingActivity ? "Following Pi in" : "Reading"}</span><select value={requestedBook ?? ""} disabled={followingActivity} title={followingActivity ? "Stop following Pi to choose your own book" : "Choose an assigned book to read (read-only)"} onChange={(event) => chooseBook(Number(event.target.value))}>{requestedBook === null && <option value="">Pi's current book</option>}{books.map((book) => <option key={book.id} value={book.id}>{bookOptionLabel(book)}</option>)}</select></label>
            <span className="book-agent" role="status">Pi working on <b>{agentBookEntry ? bookName(agentBookEntry) : agentBook !== null ? `Book ${agentBook}` : "unknown"}</b>{!followingActivity && agentBook !== null && agentBook !== pinnedBook && <button onClick={() => chooseBook(agentBook)}>Read Pi's book</button>}</span>
            {followingActivity && pinnedBook !== null && pinnedBook !== agentBook && <small>Your pinned book returns when you stop following.</small>}
            {bookLoading && <small role="status">Loading {bookName(books.find((book) => book.id === requestedBook))}…</small>}
          </div> : null;
  const libraryAtTop = !!shownWorld?.library && ["library", "series"].includes(orbitalPage?.kind ?? "");
  const libraryCaption = shownWorld?.library?.events.at(-1)?.type.replaceAll(".", " / ") ?? "Waiting for organization";

  if (!world) {
    return (
      <main className="loading-screen"><span className="eyebrow">NOVEL / ONTOLOGY PI</span><h1>Narrative archive.</h1><p role={loadError ? "alert" : "status"}>{loadError ? `Could not open the archive: ${loadError}` : "Opening local records…"}</p></main>
    );
  }

  return (
    <div className={`app orbital-active ${orbitalMode ? "mode-orbital" : "mode-traditional"}${stageView !== "narrative" ? " stage-alt" : ""}${reducedMotion ? " reduce-motion" : ""}${followingActivity ? " following-orbital" : ""}`}>
      <header className="topbar">
        <button className="brand" onClick={overview} aria-label="Return to archive overview"><svg viewBox="0 0 40 40" aria-hidden="true"><path d="M4 32V8h7l18 24h7V8M4 32h7V18l18 14M19 8h17" fill="none" stroke="currentColor" strokeWidth="3" /></svg><span>NOVEL<span>ONTOLOGY / PI</span></span></button>
        <nav aria-label="Workspace navigation">
          <button className={panel === "record" ? "active" : ""} onClick={overview}>Archive <span>↗</span></button>
          <button className={inspectorOpen && panel === "activity" ? "active" : ""} onClick={() => { setPanel("activity"); setInspectorOpen(true); }}>Activity <span>/</span></button>
          <button className={inspectorOpen && panel === "review" ? "active" : ""} onClick={() => { setPanel("review"); setInspectorOpen(true); }}>Review <span>{String(pendingCount).padStart(2, "0")}</span></button>
        </nav>
        <span className="sample-badge"><i />{phoneLive || liveUrl ? "LIVE" : "LOCAL SAMPLE"}</span>
      </header>
      <div className="page-heading">
        <div><div className="eyebrow">{libraryAtTop ? "SERIES LIBRARY / " : ""}{phoneLive ? liveCollection : "COLLECTION 001 / INDEX SAMPLE"}{followingActivity && orbitalPage ? ` / ${orbitalPage.kind.toUpperCase()} OVERVIEW` : ""}</div><h1><RollingText text={(followingActivity || libraryAtTop) && orbitalPage ? orbitalPage.label : view.mode === "lanes" ? "Narrative archive." : shownWorld.bigEventLabels[view.bigEventId] ?? ""} /></h1>{phoneLive && <p className="live-runtime-status" role="status">{libraryAtTop ? libraryCaption : followingActivity ? liveActivity?.phase ?? liveLabel : liveLabel}<small>{libraryAtTop ? `${shownWorld.library!.sources.length} files · ${shownWorld.library!.organization.series.length} reviewed series · ${shownWorld.library!.plans.length} proposed/held plans · live updates` : `${liveCounts.ghosts} ghosts · ${liveCounts.entities} canonical entities · ${liveCounts.events} events · ${liveCounts.repairs} audited operations · live updates`}</small></p>}</div>
        <div className={`heading-caption${view.mode === "interior" ? " interior-heading" : ""}`}>{view.mode === "lanes" ? <><span>One world. Parallel stories.</span><small>Click a file or scroll closer to enter.</small></> : <><button className="back-link" onClick={overview}>← Back to chronology</button><small>EVENT INTERIOR / {sourceNodes.length} RECORDS</small></>}</div>
      </div>
      <main className="workspace">
        <section className="scene-panel" aria-label="Archive graph">
          <div className="design-switch stage-switch" role="toolbar" aria-label="Mode and view">
            <div className="stage-group" role="group" aria-label="Mode">{MODES.map(([orbital, label]) => <button key={label} aria-pressed={orbitalMode === orbital} onClick={() => switchMode(orbital)} title={orbital ? "3D orbital views" : "Flat traditional views"}>{label}</button>)}</div>
            <div className="stage-group" role="group" aria-label="View">{STAGE_VIEWS.map(([value, label]) => <button key={value} aria-pressed={stageView === value} onClick={() => chooseStageView(value)}>{label}</button>)}</div>
            {orbitalMode && stageView === "story" && viewTimePlace?.available && <div className="stage-group" role="group" aria-label="Story shape">{([["line", "Line"], ["strands", "Strands"]] as const).map(([value, label]) => <button key={value} aria-pressed={storyShape === value} title={value === "strands" ? "Scenes that run in parallel side by side (estimated from who is in each scene)" : "Every scene on one line in story order"} onClick={() => chooseStoryShape(value)}>{label}</button>)}</div>}
          </div>
          {regroupedOrbit && stageView === "places" && viewTimePlace && <AtlasPanel data={viewTimePlace} periods={atlasPeriods} onPeriods={(periods) => { setAtlasPeriods(periods); setAtlasFocus(null); }} focus={atlasFocus} onClearFocus={() => setAtlasFocus(null)} levels={atlasLevels} onLevels={setAtlasLevels} onCharacter={(id) => requestOrbitalFocus({ id, label: viewTimePlace.names[id] ?? id, kind: "character", state: "canon", parent: null, lane: "canon", chrono: 0, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] })} />}
          {regroupedOrbit ? <OrbitalExplorer key={stageView} world={regroupedOrbit.world} arrangement={regroupedOrbit.arrangement} albumPictures={stageView === "story" ? albumPictures : []} albumPortraits={albumPortraits} showCausal activity={liveActivity} quietSelection={followingActivity} followingActivity={followingActivity} onPage={reportOrbitalPage} onCenter={stageView === "story" ? noteStoryCentre : undefined} onSourceVolume={chooseBook} book={loadedBookEntry} bookId={loadedBook} bookBar={bookBar} activityNodes={NO_NODES} activityEdges={NO_EDGES} reducedMotion={reducedMotion} showRelations={showRelations} resetToken={orbitalReset} focusRequest={orbitalFocus && !orbitalFocus.chapterId ? orbitalFocus : null} joins={NO_JOINS} onJoinSettled={settleJoin} onSelect={inspectOrbital} onChapter={ignoreChapter} onMotion={() => setReducedMotion(!reducedMotion)} onRelations={() => setShowRelations(!showRelations)} />
          : stageView === "story" ? <StoryTimeline pictures={albumPictures} album={storyAlbum} onPicture={selectStoryPicture} data={viewTimePlace ?? EMPTY_TIME_PLACE} names={new Map(Object.entries(viewTimePlace?.names ?? {}))} bookBar={bookBar} focusBook={focusBook} emerging={shownEmerging?.times} touched={emerging && Date.now() - emerging.at < 9000 ? undefined : shownTouched} following={followingActivity} onShowInOrbit={(sceneId) => {
            // Universe ids are "<volume>:<scene>": another book opens first.
            const scene = viewTimePlace?.scenes.find((entry) => entry.id === sceneId);
            if (scene?.book !== undefined && scene.book !== loadedBook) { chooseBook(scene.book); setStageView("narrative"); return; }
            const local = scene?.book !== undefined ? sceneId.slice(sceneId.indexOf(":") + 1) : sceneId;
            const node = Object.values(shownWorld.interiors).flatMap((graph) => graph.nodes).find((entry) => entry.id === local); setStageView("narrative"); if (node) requestOrbitalFocus(node); }} />
          : stageView === "places" ? <PlaceMap data={viewTimePlace ?? EMPTY_TIME_PLACE} names={new Map(Object.entries(viewTimePlace?.names ?? {}))} emerging={shownEmerging?.places} bookBar={bookBar} focusBook={focusBook} />
          : orbitalMode ? <OrbitalExplorer key="narrative" world={shownWorld} onSourceVolume={chooseBook} book={loadedBookEntry} bookId={loadedBook} bookBar={bookBar} albumPictures={albumPictures} albumPortraits={albumPortraits} activityNodes={visibleDyn.nodes} activityEdges={visibleDyn.edges} activity={liveActivity} followingActivity={followingActivity} joins={joins} onJoinSettled={settleJoin} reducedMotion={reducedMotion} showRelations={showRelations} resetToken={orbitalReset} focusRequest={orbitalFocus} onSelect={inspectOrbital} onChapter={chapterOrbital} onPage={reportOrbitalPage} onMotion={() => setReducedMotion(!reducedMotion)} onRelations={() => setShowRelations(!showRelations)} />          : <NarrativeList world={shownWorld} activityNodes={visibleDyn.nodes} activityEdges={visibleDyn.edges} activity={liveActivity} followingActivity={followingActivity} timePlace={timePlace} bookBar={bookBar} selectedId={selected?.id ?? null} focusRequest={orbitalFocus} onSelect={inspectOrbital} />}
        </section>
        <aside className={`inspector${inspectorOpen ? " is-open" : ""}${panel === "album" ? " album-open" : ""}`} aria-label="Record and processing details">
          <div className="inspector-tabs" role="tablist" aria-orientation="vertical" aria-label="Inspector">
            {(["record", "activity", "review", "album"] as const).map((tab, index, tabs) => <button key={tab} id={`tab-${tab}`} role="tab" tabIndex={panel === tab ? 0 : -1} aria-selected={inspectorOpen && panel === tab} aria-controls={`panel-${tab}`} onClick={() => { setInspectorOpen(panel === tab ? !inspectorOpen : true); setPanel(tab); }} onKeyDown={(event) => {
              if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
              setPanel(tabs[next]);
              setInspectorOpen(true);
              document.getElementById(`tab-${tabs[next]}`)?.focus();
            }}>{tab}{tab === "review" && pendingCount > 0 && <span>{pendingCount}</span>}{tab === "album" && (albumInfo.length || albumPictures.length) > 0 && <span>{albumInfo.length || albumPictures.length}</span>}</button>)}
          </div>
          <div className="inspector-sheet" hidden={!inspectorOpen}>
          <div className="sheet-heading"><span className="eyebrow">ARCHIVE / {panel}</span><button aria-label="Close details" onClick={() => { setInspectorOpen(false); document.getElementById(`tab-${panel}`)?.focus(); }}>×</button></div>
          <div ref={inspectorRef} className="inspector-body" id={`panel-${panel}`} role="tabpanel" aria-labelledby={`tab-${panel}`}>
            {panel === "record" && <RecordInspector selected={selected} nodes={displayNodes} lookupNodes={orbitalInspection ? orbitalInspection.lookupNodes : sourceNodes} edges={orbitalInspection ? orbitalInspection.edges : sourceEdges} orbital={orbitalMode} contents={orbitalInspection?.contents ?? []} sourceEndpoint={new URLSearchParams(location.search).has("source") ? `api/record-source${bookQuery(phoneLive ? loadedBook : null)}` : undefined} childCount={selected ? (shownWorld.interiors[selected.id]?.nodes.length ?? 0) + visibleDyn.nodes.filter((node) => node.parent === selected.id).length : 0} canOpen={orbitalMode && !!selected && !!shownWorld.interiors[selected.id]} causalLinks={worldCausalLinks(shownWorld)} onSelect={requestOrbitalFocus} />}
            {panel === "activity" && <><div className="panel-intro"><span className="eyebrow">PROCESSING JOURNAL</span><h2>In the making.</h2><p>{blockLabel ?? "Waiting for the live stream."}</p><a href="replay/">Pi session replay ↗</a>{!phoneLive && <button onClick={startSession}>Reconnect</button>}</div><DecisionFeed entries={feed} /></>}
            {panel === "review" && <><div className="panel-intro"><span className="eyebrow">THE MERGE GATE</span><h2>Before it is canon.</h2><p>{phoneLive ? "Read-only live viewer. Pi reviews consequential facts; held facts stay outside canon." : "Review sample proposals."}</p></div><div inert={phoneLive ? true : undefined}><GateQueue changesets={changesets} heldMap={heldMap} labels={labels} onApprove={approve} /></div></>}
            {panel === "album" && <AlbumPanel key={loadedBook ?? "sample"} pictures={albumInfo.length ? albumInfo : albumPictures.map((picture) => ({ id: picture.id, asset: picture.asset, kind: picture.kind, label: picture.kind ? picture.kind[0].toUpperCase() + picture.kind.slice(1) : "Picture", placed: false, prevSceneLabel: null, nextSceneLabel: null, chrono: null }))} selectedId={selected?.id ?? null} onSelect={albumThumbnailSelect} />}
          </div>
          </div>
        </aside>
        <div className="activity-dock"><ActivityTab count={activity.count} shine={activity.shine} caughtUp={activity.caughtUp} active={followingActivity} onClick={flyToSite} /></div>
      </main>
      <PipelineStrip stage={stage} status={processingStatus} reducedMotion={reducedMotion} faculties={liveActivity?.faculties} telemetryNote={liveActivity?.telemetryNote} />
      {phoneLive && (!libraryAtTop || liveActivity?.review) && <PiReviewProgress review={liveActivity?.review} />}
      {phoneLive && <PiConsole />}
      {identityNotice && <div className="identity-notice" role="status">{identityNotice}</div>}
      <footer className="transport" ref={transportRef}>
        <div className="selection-counter"><span className="eyebrow">RECORD / SELECT</span><div>{String(selected ? selectedIndex + 1 : 0).padStart(2, "0")}<small>/ {String(displayNodes.length).padStart(2, "0")}</small></div></div>
        <div className="record-transport"><button className="arrow-button" aria-label="Previous record" disabled={!nodes.length} onClick={() => stepRecord(-1)}>←</button><div><strong>{selected?.label ?? "Archive"}</strong><span>{selected ? `${selected.library?.type ?? KIND_LABEL[selected.kind]} / ${selected.library ? "organization" : selected.lane}` : "No records"}</span></div><button className="arrow-button" aria-label="Next record" disabled={!nodes.length} onClick={() => stepRecord(1)}>→</button></div>
        <div className="session-controls"><span className="eyebrow">{phoneLive || liveUrl ? "LIVE / NOVEL WATCH" : "LOCAL FILE REPLAY / DEMO"}</span>{phoneLive ? <a href="replay/">Session replay ↗</a> : <button onClick={startSession}>Replay session ↻</button>}</div>
      </footer>
    </div>
  );
}
