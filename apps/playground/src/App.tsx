import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphCanvasRef } from "reagraph";
import { ActivityTab, DecisionFeed, GateQueue, type FeedEntry } from "./components/panels";
import { PipelineStrip } from "./components/PipelineStrip";
import { PiConsole } from "./components/PiConsole";
import { PiReviewProgress } from "./components/PiReviewProgress";
import { WorldGraph, framePositions, scaledPos, type LabelBus } from "./components/WorldGraph";
import { loadWorld, type LoadedWorld } from "./data/loadWorld";
import { FileEventSource } from "./events/fileSource";
import { SseEventSource } from "./events/sseSource";
import { RecordInspector } from "./components/RecordInspector";
import { ExplorerNavigation } from "./components/ExplorerNavigation";
import { OrbitalExplorer, type OrbitalInspection } from "./components/OrbitalExplorer";
import type { OrbitIllustration } from "./data/pictureNodes";
import "./orbital.css";
import "./live.css";
import type { LiveActivity } from "./data/liveActivity";
import { applySnapshotChanges } from "../../../tools/pi-review/snapshot-delta.mjs";
import { useSceneExplorer } from "./data/useSceneExplorer";
import { KIND_LABEL } from "./archive";
import { arrangeTimeline, withOverviewActivity } from "./data/timelineLayout";
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
interface LiveSnapshot {
  world: LoadedWorld;
  activity?: LiveActivity;
  gates: ChangeSet[];
  feed: FeedEntry[];
  status: "idle" | "working" | "review" | "complete" | "error";
  stage: number;
  label: string;
  volume?: number;
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
  const [orbitalMode, setOrbitalMode] = useState(true);
  const [orbitalReset, setOrbitalReset] = useState(0);
  const [orbitalInspection, setOrbitalInspection] = useState<OrbitalInspection | null>(null);
  const [orbitalPage, setOrbitalPage] = useState<{ key: string; label: string; kind: string; chapterId?: string } | null>(null);
  const reportOrbitalPage = useCallback((page: { key: string; label: string; kind: string; chapterId?: string }) => setOrbitalPage(current => current?.key === page.key && current.label === page.label ? current : page), []);
  const [orbitalFocus, setOrbitalFocus] = useState<{ node: WorldNode; sequence: number; chapterId?: string } | null>(null);
  const inspectOrbital = useCallback((inspection: OrbitalInspection | null) => { setOrbitalInspection(inspection); if (inspection?.passive) return; if (inspection?.inspect !== false && inspection) setPanel("record"); setInspectorOpen(!!inspection && inspection.inspect !== false); }, []);
  const chapterOrbital = useCallback((id: string | null) => setView((current) => id ? current.mode === "interior" && current.bigEventId === id ? current : { mode: "interior", bigEventId: id } : current.mode === "lanes" ? current : { mode: "lanes" }), []);
  const [selectedId, setSelectedId] = useState<string | null>("chapter_0");
  const [panel, setPanel] = useState<"record" | "activity" | "review">("record");
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
  const [join, setJoin] = useState<{ dropId: string; keepId: string; seq: number } | null>(null);
  const joinRef = useRef<{ dropId: string; keepId: string } | null>(null);
  const joinTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const labelsRef = useRef<Record<string, string>>({});
  const [activity, setActivity] = useState({ count: 0, shine: false, caughtUp: false });
  const [blockLabel, setBlockLabel] = useState<string | null>(null);
  const sourceRef = useRef<PlaygroundEventSource | null>(null);
  /** Live mode: ?live=<watch SSE url> swaps the file replay for `novel watch`. */
  const liveUrl = useMemo(
    () => new URLSearchParams(window.location.search).get("live"),
    [],
  );
  const graphRef = useRef<GraphCanvasRef>(null);
  const phoneLive = useMemo(() => new URLSearchParams(window.location.search).has("phone"), []);
  const [liveLabel, setLiveLabel] = useState("Fresh database · connecting to Pi");
  const [liveCollection, setLiveCollection] = useState("Live novel / connecting");
  const [liveCounts, setLiveCounts] = useState({ entities: 0, events: 0, repairs: 0, ghosts: 0 });
  const [workSite, setWorkSite] = useState("chapter_0");
  const seenMerges = useRef(new Set<string>());
  const [liveActivity, setLiveActivity] = useState<LiveActivity | null>(null);
  const [followingActivity, setFollowingActivity] = useState(false);
  const readingPanelBookmark = useRef<{ inspection: OrbitalInspection | null; panel: "record" | "activity" | "review"; open: boolean; selectedId: string | null } | null>(null);
  const identityBaseline = useRef(false);
  const [identityNotice, setIdentityNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!identityNotice) return;
    const timer = setTimeout(() => setIdentityNotice(null), 6500);
    return () => clearTimeout(timer);
  }, [identityNotice]);
  const focusFlight = useRef<number | null>(null);
  /** The most recently emerged ghost node — where System 1 is knitting right now (Phase B). */
  const lastKnitRef = useRef<{ node: WorldNode; chapterId: string } | null>(null);
  useEffect(() => () => { if (focusFlight.current !== null) cancelAnimationFrame(focusFlight.current); }, []);
  const inspectorRef = useRef<HTMLDivElement>(null);
  const labelBus = useMemo<LabelBus>(
    () => ({ targets: new Map(), active: new Set(), positions: new Map(), trackTargets: new Map() }),
    [],
  );
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => {
    loadWorld(`${DB}/view.json`)
      .then(setWorld)
      .catch((e: Error) => setLoadError(e.message));
  }, []);

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
    return { laneNodes: lanes.nodes, laneEdges: lanes.edges, interiors, bigEventLabels: world.bigEventLabels };
  }, [world, merges]);

  const visibleDyn = useMemo(
    () => applyMergesToSet(dynNodes, dynEdges, merges),
    [dynNodes, dynEdges, merges],
  );

  /** A join animation finished (or cannot run here): settle the merge. */
  const settleJoin = useCallback((dropId: string) => {
    const current = joinRef.current;
    if (!current || current.dropId !== dropId) return;
    joinRef.current = null;
    if (joinTimer.current) {
      clearTimeout(joinTimer.current);
      joinTimer.current = null;
    }
    setJoin(null);
    setMerges((m) => new Map(m).set(current.dropId, current.keepId));
  }, []);

  const beginJoin = useCallback(
    (dropId: string, keepId: string) => {
      if (joinRef.current) settleJoin(joinRef.current.dropId);
      joinRef.current = { dropId, keepId };
      setJoin({ dropId, keepId, seq: Date.now() });
      // Backstop: if neither renderer can animate this pair (off-view
      // in both), the merge still settles promptly.
      joinTimer.current = setTimeout(() => settleJoin(dropId), 2600);
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

  const startSession = useCallback(() => {
    sourceRef.current?.stop();
    lastKnitRef.current = null;
    joinRef.current = null;
    if (joinTimer.current) {
      clearTimeout(joinTimer.current);
      joinTimer.current = null;
    }
    setJoin(null);
    setMerges(new Map());
    setDynNodes([]);
    setDynEdges([]);
    setAlbumPictures([]);
    setAlbumPortraits([]);
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
        if (stopped) return;
        current = data;
        if (data.world !== previousWorld) {
          previousWorld = data.world;
          setWorld(data.world);
        }
        for (const record of data.activity?.identityEvents ?? []) {
          if (seenMerges.current.has(record.id)) continue;
          seenMerges.current.add(record.id);
          if (identityBaseline.current) {
            handleEvent(record.event);
            setIdentityNotice(record.event.type === "entity.merged" ? `EM joined ${record.event.dropId} → ${record.event.keepId}` : `EM kept ${record.event.aId} and ${record.event.bId} distinct`);
          }
        }
        identityBaseline.current = true;
        setLiveActivity(data.activity ?? null);
        setChangesets(data.gates);
        setFeed(data.feed);
        setProcessingStatus(data.status);
        setStage(data.stage);
        setLiveLabel(data.label);
        setLiveCollection(`Volume ${data.volume ?? 1} / ${data.jobLabel ?? "Live processing"}`);
        setLiveCounts(data.counts);
        setWorkSite(data.workSite ?? "chapter_0");
        setBlockLabel(data.label);
        setLoadError(null);
        setActivity(currentActivity => ({ ...currentActivity, count: data.activity?.count ?? 0, shine: data.status === "working", caughtUp: data.status === "complete" }));
    };
    const poll = async () => {
      if (stopped || !polling) return;
      try {
        request = new AbortController();
        const response = await fetch("api/live", { cache: "no-store", signal: request.signal });
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
      stream = new EventSource("api/live/stream");
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
  }, [phoneLive, handleEvent]);

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
        setOrbitalMode(true);
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
    // Phase B: if real work has emerged this session, fly to the
    // latest ghost in its own chapter interior — the demo world's
    // fixed knit site is only the fallback.
    const knit = lastKnitRef.current;
    if (knit && displayWorld?.interiors[knit.chapterId]) {
      if (orbitalMode) setOrbitalFocus((current) => ({ node: knit.node, chapterId: knit.chapterId, sequence: (current?.sequence ?? 0) + 1 }));
      setView({ mode: "interior", bigEventId: knit.chapterId });
      setSelectedId(knit.node.id);
      setPanel("review");
      setInspectorOpen(true);
      setActivity((a) => ({ ...a, count: 0, shine: false }));
      return;
    }
    const target = displayWorld?.interiors[KNIT_SITE]?.nodes[0];
    if (orbitalMode && target) setOrbitalFocus((current) => ({ node: target, chapterId: KNIT_SITE, sequence: (current?.sequence ?? 0) + 1 }));
    setView({ mode: "interior", bigEventId: KNIT_SITE });
    setSelectedId(displayWorld?.interiors[KNIT_SITE]?.nodes[0]?.id ?? null);
    setPanel("review");
    setInspectorOpen(true);
    setActivity((a) => ({ ...a, count: 0, shine: false }));
    if (viewRef.current.mode === "interior" && viewRef.current.bigEventId === KNIT_SITE) {
      framePositions(graphRef, [...labelBus.positions.values()], 1.18, !reducedMotion);
    }
  }, [displayWorld, reducedMotion, labelBus, orbitalMode, phoneLive, workSite, followingActivity, orbitalInspection, panel, inspectorOpen, selectedId]);

  const openNode = useCallback(
    (node: WorldNode) => {
      if (node.kind === "bigEvent" && displayWorld?.interiors[node.id]) {
        setView({ mode: "interior", bigEventId: node.id });
        setSelectedId(null);
        setPanel("record");
        setInspectorOpen(false);
        if (node.id === KNIT_SITE) {
          setActivity((a) => ({ ...a, count: 0, shine: false }));
        }
      }
    },
    [displayWorld],
  );

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

  const explorer = useSceneExplorer(sourceNodes, sourceEdges, view.mode === "interior", view.mode === "lanes" ? "lanes" : view.bigEventId);
  const { nodes, edges } = explorer;
  const timeline = useMemo(() => explorer.timeline ?? arrangeTimeline(nodes, edges, view.mode === "interior", explorer.structure), [nodes, edges, view.mode, explorer.structure, explorer.timeline]);
  const openableIds = useMemo(() => [...Object.keys(displayWorld?.interiors ?? {}), ...nodes.filter((node) => (node.cluster || node.kind === "scene") && !explorer.path.some((scope) => scope.key === node.id)).map((node) => node.id)], [displayWorld, nodes, explorer.path]);
  const visibleEdges = useMemo(() => showRelations ? edges : [], [edges, showRelations]);

  const displayNodes = orbitalMode && orbitalInspection ? orbitalInspection.nodes : nodes;
  const selected = orbitalMode && orbitalInspection ? orbitalInspection.node : nodes.find((node) => node.id === selectedId) ?? nodes[0];
  const selectedIndex = selected ? Math.max(0, displayNodes.findIndex((node) => node.id === selected.id)) : 0;
  const pendingCount = changesets.filter((changeset) => changeset.status === "pending").length;
  useEffect(() => {
    inspectorRef.current?.scrollTo(0, 0);
  }, [panel, selected?.id, view.mode, inspectorOpen]);
  const selectNode = (node: WorldNode) => {
    setSelectedId(node.id); setPanel("record"); setInspectorOpen(true);
    if (focusFlight.current !== null) cancelAnimationFrame(focusFlight.current);
    focusFlight.current = requestAnimationFrame(() => {
      const positioned = timeline.nodes.find((record) => record.id === node.id) ?? node;
      const position = labelBus.positions.get(node.id) ?? scaledPos(positioned, view.mode === "interior");
      framePositions(graphRef, [position], 1.2, !reducedMotion);
    });
  };
  const stopCamera = () => {
    if (focusFlight.current !== null) cancelAnimationFrame(focusFlight.current);
    graphRef.current?.getControls?.()?.stop();
  };
  const activateNode = (node: WorldNode) => {
    if (node.kind === "bigEvent" && displayWorld?.interiors[node.id]) { explorer.reset(); openNode(node); return; }
    if (explorer.reveal(node) || explorer.open(node)) {
      setSelectedId(node.id);
      stopCamera();
      setPanel("record");
      setInspectorOpen(!node.cluster);
      return;
    }
    selectNode(node);
  };
  const requestOrbitalFocus = (node: WorldNode) => {
    if (orbitalInspection) setOrbitalInspection({ ...orbitalInspection, node });
    setOrbitalFocus({ node, sequence: Date.now() });
  };
  const stepRecord = (step: number) => {
    if (orbitalMode && displayNodes.length) { requestOrbitalFocus(displayNodes[(selectedIndex + step + displayNodes.length) % displayNodes.length]); return; }
    if (nodes.length) activateNode(nodes[(selectedIndex + step + nodes.length) % nodes.length]);
  };
  const overview = () => {
    setOrbitalReset((current) => current + 1);
    setOrbitalInspection(null);
    if (view.mode === "interior") setSelectedId(view.bigEventId);
    setView({ mode: "lanes" });
    setPanel("record");
  };

  const backLevel = () => {
    if (!explorer.back()) { overview(); return; }
    stopCamera();
    setSelectedId(null);
    setInspectorOpen(false);
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

  useEffect(() => {
    labelBus.active = new Set(nodes.map((n) => n.id));
  }, [labelBus, nodes]);

  const shownWorld: LoadedWorld = displayWorld ?? (world as LoadedWorld);

  if (!world) {
    return (
      <main className="loading-screen"><span className="eyebrow">NOVEL / ONTOLOGY PI</span><h1>Narrative archive.</h1><p role={loadError ? "alert" : "status"}>{loadError ? `Could not open the archive: ${loadError}` : "Opening local records…"}</p></main>
    );
  }

  return (
    <div className={`app${orbitalMode ? " orbital-active" : ""}${reducedMotion ? " reduce-motion" : ""}${followingActivity ? " following-orbital" : ""}`}>
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
        <div><div className="eyebrow">{phoneLive ? liveCollection : "COLLECTION 001 / INDEX SAMPLE"}{followingActivity && orbitalPage ? ` / ${orbitalPage.kind.toUpperCase()} OVERVIEW` : ""}</div><h1>{followingActivity && orbitalPage ? orbitalPage.label : view.mode === "lanes" ? "Narrative archive." : shownWorld.bigEventLabels[view.bigEventId]}</h1>{phoneLive && <p className="live-runtime-status" role="status">{followingActivity ? liveActivity?.phase ?? liveLabel : liveLabel}<small>{liveCounts.ghosts} ghosts · {liveCounts.entities} canonical entities · {liveCounts.events} events · {liveCounts.repairs} audited operations · live updates</small></p>}</div>
        <div className={`heading-caption${view.mode === "interior" ? " interior-heading" : ""}`}>{view.mode === "lanes" ? <><span>One world. Parallel stories.</span><small>Click a file or scroll closer to enter.</small></> : <><button className="back-link" onClick={overview}>← Back to chronology</button><small>EVENT INTERIOR / {sourceNodes.length} RECORDS</small></>}</div>
      </div>
      <main className="workspace">
        <section className="scene-panel" aria-label="Archive graph">
          <button className="design-switch" disabled={followingActivity} aria-pressed={orbitalMode} onClick={() => { setOrbitalMode(!orbitalMode); setInspectorOpen(false); }}>{orbitalMode ? "Orbital / switch to classic" : "Classic / switch to orbital"}</button>
          {orbitalMode ? <OrbitalExplorer world={shownWorld} albumPictures={albumPictures} albumPortraits={albumPortraits} activityNodes={visibleDyn.nodes} activityEdges={visibleDyn.edges} activity={liveActivity} followingActivity={followingActivity} join={join} onJoinSettled={settleJoin} reducedMotion={reducedMotion} showRelations={showRelations} resetToken={orbitalReset} focusRequest={orbitalFocus} onSelect={inspectOrbital} onChapter={chapterOrbital} onPage={reportOrbitalPage} onMotion={() => setReducedMotion(!reducedMotion)} onRelations={() => setShowRelations(!showRelations)} /> : <>
          <div className="scene-toolbar"><span className="eyebrow">{view.mode === "lanes" ? "01 / TIMELINE COLLECTION" : "02 / EVENT INTERIOR"}</span><div>
            <span className="direction-label">{view.mode === "interior" ? (explorer.structure === "cloud" ? "Shared links → closeness" : "Earlier → later") : "Chapter order →"}</span>
            <button aria-pressed={showRelations} onClick={() => setShowRelations(!showRelations)}>{showRelations ? "Relations on" : "Relations off"}</button>
            <button onClick={() => framePositions(graphRef, labelBus.positions.size ? [...labelBus.positions.values()] : timeline.nodes.map((node) => scaledPos(node, view.mode === "interior")), 1.18, !reducedMotion)}>Frame view ⌖</button>
          </div></div>
          {view.mode === "interior" && <ExplorerNavigation nodes={sourceNodes} selectedId={selected?.id ?? null} onSelect={activateNode} structure={explorer.structure} onStructure={explorer.setStructure} expandedCount={explorer.path.length} scopeLabel={explorer.path.at(-1)?.label} shown={nodes.length} total={sourceNodes.length} onBack={backLevel} onReset={() => { stopCamera(); explorer.reset(); setSelectedId(null); setInspectorOpen(false); }} />}
          <div className="stage" tabIndex={0} aria-label="3D records. Arrow keys select, Enter opens an event, Escape returns to chronology." onKeyDown={(event) => {
            if (event.target !== event.currentTarget) return;
            if (event.key === "ArrowRight" || event.key === "ArrowLeft") { event.preventDefault(); stepRecord(event.key === "ArrowRight" ? 1 : -1); }
            if (event.key === "Enter" && selected) { event.preventDefault(); activateNode(selected); }
            if (event.key === "Escape") backLevel();
          }}>
            <div className="graph-canvas"><WorldGraph ref={graphRef} nodes={timeline.nodes} edges={visibleEdges} tracks={timeline.tracks} contextNodeIds={explorer.rootIds} interior={view.mode === "interior"} viewId={explorer.key} openableIds={openableIds} labelBus={labelBus} selectedId={selected?.id ?? null} reducedMotion={reducedMotion} onNodeClick={activateNode} onNodeOpen={activateNode} onViewBack={backLevel} join={join} onJoinSettled={settleJoin} /></div>
            <div className="scene-coordinate" aria-hidden="true">X / Y / Z<br /><span>TIME → / RELATIONS<br />SPATIAL ONTOLOGY</span></div>
            <div className="labels-layer">
              {nodes.map((node, index) => <button key={node.id} className={`node-label k-${node.kind} s-${node.state}${selected?.id === node.id ? " is-selected" : ""}`} style={{ visibility: "hidden" }} aria-label={`${openableIds.includes(node.id) ? "Open" : "Select"} ${node.label}`} aria-pressed={selected?.id === node.id} ref={(element) => { if (element) labelBus.targets.set(node.id, element); else labelBus.targets.delete(node.id); }} onClick={() => activateNode(node)}>
                <span className="node-code">{node.cluster ? `${node.cluster.ids.length} ${node.cluster.kind.toUpperCase()}` : node.kind === "scene" ? `SCENE ${explorer.rank.get(node.id) ?? index + 1}` : String(index + 1).padStart(2, "0")} / {node.lane.toUpperCase()}</span><b>{node.label}</b>{node.cluster && <em className="cluster-preview">{node.subLabel}</em>}<span>{node.cluster ? `${node.cluster.recordCount} records · ${explorer.path.some((scope) => scope.key === node.id) ? "collapse" : "expand"}${node.cluster.proposed ? ` · ${node.cluster.proposed} ghosts` : ""}${node.cluster.held ? ` · ${node.cluster.held} held` : ""}` : node.state !== "canon" ? node.state.toUpperCase() : KIND_LABEL[node.kind]}</span>
                {node.kind === "bigEvent" && visibleDyn.nodes.some((child) => child.parent === node.id && child.state !== "canon") && <em className="node-updates">{visibleDyn.nodes.filter((child) => child.parent === node.id && child.state !== "canon").length} IN REVIEW</em>}
              </button>)}
            </div>
            <div className="track-labels">{timeline.tracks.map((track) => <span key={track.id} className="track-label" ref={(element) => { if (element) labelBus.trackTargets.set(track.id, element); else labelBus.trackTargets.delete(track.id); }}>{track.label}<small>SEQUENCE →</small></span>)}</div>
            <div className="stage-bottom"><span>CLICK TO INSPECT / SCROLL TO ZOOM</span><span>{view.mode === "interior" ? explorer.structure.toUpperCase() : `${timeline.tracks.length} TRACKS`} · {nodes.length} SHOWN</span></div>
          </div>
          <div className="scene-legend"><span><i className="canon" />Canon</span><span><i className="branch" />Branch</span><span><i className="proposed" />Proposed</span><span><i className="held" />Held</span><button aria-pressed={reducedMotion} onClick={() => setReducedMotion(!reducedMotion)}>{reducedMotion ? "Motion reduced" : "Motion on"}</button></div>
          </>}
        </section>
        <aside className={`inspector${inspectorOpen ? " is-open" : ""}`} aria-label="Record and processing details">
          <div className="inspector-tabs" role="tablist" aria-orientation="vertical" aria-label="Inspector">
            {(["record", "activity", "review"] as const).map((tab, index, tabs) => <button key={tab} id={`tab-${tab}`} role="tab" tabIndex={panel === tab ? 0 : -1} aria-selected={inspectorOpen && panel === tab} aria-controls={`panel-${tab}`} onClick={() => { setInspectorOpen(panel === tab ? !inspectorOpen : true); setPanel(tab); }} onKeyDown={(event) => {
              if (!["ArrowRight", "ArrowLeft", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key)) return;
              event.preventDefault();
              const next = event.key === "Home" ? 0 : event.key === "End" ? tabs.length - 1 : (index + (["ArrowRight", "ArrowDown"].includes(event.key) ? 1 : -1) + tabs.length) % tabs.length;
              setPanel(tabs[next]);
              setInspectorOpen(true);
              document.getElementById(`tab-${tabs[next]}`)?.focus();
            }}>{tab}{tab === "review" && pendingCount > 0 && <span>{pendingCount}</span>}</button>)}
          </div>
          <div className="inspector-sheet" hidden={!inspectorOpen}>
          <div className="sheet-heading"><span className="eyebrow">ARCHIVE / {panel}</span><button aria-label="Close details" onClick={() => { setInspectorOpen(false); document.getElementById(`tab-${panel}`)?.focus(); }}>×</button></div>
          <div ref={inspectorRef} className="inspector-body" id={`panel-${panel}`} role="tabpanel" aria-labelledby={`tab-${panel}`}>
            {panel === "record" && <RecordInspector selected={selected} nodes={displayNodes} lookupNodes={orbitalMode && orbitalInspection ? orbitalInspection.lookupNodes : sourceNodes} edges={orbitalMode && orbitalInspection ? orbitalInspection.edges : selected?.cluster ? edges : sourceEdges} orbital={orbitalMode} contents={orbitalMode ? orbitalInspection?.contents : []} sourceEndpoint={new URLSearchParams(location.search).has("source") ? "api/record-source" : undefined} childCount={selected ? (shownWorld.interiors[selected.id]?.nodes.length ?? 0) + visibleDyn.nodes.filter((node) => node.parent === selected.id).length : 0} canOpen={!!selected && !!shownWorld.interiors[selected.id]} onSelect={orbitalMode ? requestOrbitalFocus : activateNode} />}
            {panel === "activity" && <><div className="panel-intro"><span className="eyebrow">PROCESSING JOURNAL</span><h2>In the making.</h2><p>{blockLabel ?? "Waiting for the live stream."}</p><a href="replay/">Pi session replay ↗</a>{!phoneLive && <button onClick={startSession}>Reconnect</button>}</div><DecisionFeed entries={feed} /></>}
            {panel === "review" && <><div className="panel-intro"><span className="eyebrow">THE MERGE GATE</span><h2>Before it is canon.</h2><p>{phoneLive ? "Read-only live viewer. Pi reviews consequential facts; held facts stay outside canon." : "Review sample proposals."}</p></div><div inert={phoneLive ? true : undefined}><GateQueue changesets={changesets} heldMap={heldMap} labels={labels} onApprove={approve} /></div></>}
          </div>
          </div>
        </aside>
        <div className="activity-dock"><ActivityTab count={activity.count} shine={activity.shine} caughtUp={activity.caughtUp} active={followingActivity} onClick={flyToSite} /></div>
      </main>
      <PipelineStrip stage={stage} status={processingStatus} reducedMotion={reducedMotion} faculties={liveActivity?.faculties} telemetryNote={liveActivity?.telemetryNote} />
      {phoneLive && <PiReviewProgress review={liveActivity?.review} />}
      {phoneLive && <PiConsole />}
      {identityNotice && <div className="identity-notice" role="status">{identityNotice}</div>}
      <footer className="transport">
        <div className="selection-counter"><span className="eyebrow">RECORD / SELECT</span><div>{String(selected ? selectedIndex + 1 : 0).padStart(2, "0")}<small>/ {String(displayNodes.length).padStart(2, "0")}</small></div></div>
        <div className="record-transport"><button className="arrow-button" aria-label="Previous record" disabled={!nodes.length} onClick={() => stepRecord(-1)}>←</button><div><strong>{selected?.label ?? "Archive"}</strong><span>{selected ? `${KIND_LABEL[selected.kind]} / ${selected.lane}` : "No records"}</span></div><button className="arrow-button" aria-label="Next record" disabled={!nodes.length} onClick={() => stepRecord(1)}>→</button></div>
        <div className="session-controls"><span className="eyebrow">{phoneLive || liveUrl ? "LIVE / NOVEL WATCH" : "LOCAL FILE REPLAY / DEMO"}</span>{phoneLive ? <a href="replay/">Session replay ↗</a> : <button onClick={startSession}>Replay session ↻</button>}</div>
      </footer>
    </div>
  );
}
