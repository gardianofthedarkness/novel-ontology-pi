import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GraphCanvasRef } from "reagraph";
import { Vector3 } from "three";
import type { AlbumPortrait, WorldEdge, WorldNode } from "../types";
import type { Position3 } from "../data/spatialLayout";
import { canEnterOrbitalScope, orbitalContents, mainProminence, orbitalLevel, representativeScene, surroundingEntities, volumeScope, type OrbitalScope, type OrbitalWorld } from "../data/orbitalModel";
import { layoutOrbitalLevel, layoutOrbitalPreview, layoutParentBackdrop, morphSpan, nestedEntityConnections, openingMorph, type OrbitalDraw, type OrbitalMorph, type OrbitalPose } from "../data/orbitalLayout";
import { framePositions, type LabelBus } from "./graphCamera";
import { OrbitalGraph, ORBITAL_TRANSITION_MS } from "./OrbitalGraph";
import { copyOrbitalBookmark, orbitalActivityBatchPath, orbitalTouchAncestors, type OrbitalReadingBookmark } from "../data/orbitalActivity";
import { activityFocus, piBusy, type LiveActivity } from "../data/liveActivity";
import { placePictures, type OrbitIllustration } from "../data/pictureNodes";
import { orbitalLocation } from "../data/orbitalLocation";
import { causalProjection, libraryCausalProjection, worldCausalLinks } from "../data/causalProjection";
import { planJoins, type LastPose, type PendingJoin } from "../data/joinAnimation";
import { addRipple, createMotionBus, now, rayPlanePoint, scheduleGlints } from "../data/orbitalMotion";
import { KIND_LABEL } from "../archive";
import type { BookEntry } from "../data/bookCatalog";
import type { AlbumPanelPicture } from "./AlbumPanel";
import { libraryActivityPath, libraryReadingPrefix, libraryScope } from "../data/libraryModel";
import { RollingText } from "./RollingText";
import { facultyAnchors, facultyChipText } from "../data/facultyEffects";
import type { OrbitalArrangement } from "../data/orbitalTimePlace";

const PICTURE_KIND_LABELS: Record<string, string> = { cover: "Cover", plate: "Plate", story: "Illustration", paratext: "Paratext" };
const pictureKindLabel = (kind: string) => PICTURE_KIND_LABELS[kind] ?? (kind ? kind[0].toUpperCase() + kind.slice(1) : "Picture");

export interface OrbitalInspection { node: WorldNode; nodes: WorldNode[]; edges: WorldEdge[]; lookupNodes: WorldNode[]; contents: WorldNode[]; inspect?: boolean; passive?: boolean; album?: AlbumPanelPicture[] }
interface Props {
  world: OrbitalWorld;
  /** The book whose world is shown (catalog entry and ID); a change resets the reading path. */
  book?: BookEntry | null;
  bookId?: number | null;
  /** Book picker / Pi book status, shown above the location path. */
  bookBar?: ReactNode;
  onSourceVolume?: (volume: number) => void;
  /** Album illustrations from album.anchored events (App state, deduped by id). */
  albumPictures?: OrbitIllustration[];
  /** Bound album portraits from album.portraitBound events (App state, deduped by id). */
  albumPortraits?: AlbumPortrait[];
  activityNodes: WorldNode[];
  activityEdges: WorldEdge[];
  activity?: LiveActivity | null;
  followingActivity?: boolean;
  reducedMotion: boolean;
  showRelations: boolean;
  resetToken: number;
  focusRequest: { node: WorldNode; sequence: number; chapterId?: string } | null;
  /** Real EM joins to show; several may arrive in one refresh. */
  joins: PendingJoin[];
  onJoinSettled: (dropId: string) => void;
  onSelect: (inspection: OrbitalInspection | null) => void;
  onChapter: (id: string | null) => void;
  onPage?: (page: { key: string; label: string; kind: string; chapterId?: string }) => void;
  onMotion: () => void;
  onRelations: () => void;
  /** Volume-level arrangement for regrouped worlds (orbital Story time / Places). */
  arrangement?: OrbitalArrangement;
  /** Draw the book's stored causal links (Story time only; library-level universe links always show). */
  showCausal?: boolean;
  /** Main spheres near the centre of the view (volume level), reported as the camera settles. */
  onCenter?: (ids: string[]) => void;
}

// Stable defaults: a fresh [] per render would re-run every memo and effect keyed on them.
const NO_PICTURES: OrbitIllustration[] = [];
const NO_PORTRAITS: AlbumPortrait[] = [];

export function OrbitalExplorer({ world, book = null, bookId = null, bookBar = null, onSourceVolume, albumPictures = NO_PICTURES, albumPortraits = NO_PORTRAITS, activityNodes, activityEdges, activity = null, followingActivity = false, reducedMotion, showRelations, resetToken, focusRequest, joins, onJoinSettled, onSelect, onChapter, onPage, onMotion, onRelations, arrangement, showCausal = false, onCenter }: Props) {
  const readingPrefix = useMemo(() => libraryReadingPrefix(world), [world.library, world.sourceId]);
  const currentSource = world.library?.sources.find(source => source.id === world.sourceId);
  const volumeRoot = useMemo<OrbitalScope>(() => ({ ...volumeScope, ...(world.sourceId ? { sourceId: world.sourceId } : {}), label: currentSource?.filename ?? volumeScope.label }), [world.sourceId, currentSource?.filename]);
  const initialPath = () => world.library ? world.sourceId ? [...readingPrefix, volumeRoot] : [libraryScope] : [volumeScope];
  const [path, setPath] = useState<OrbitalScope[]>(initialPath);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [morph, setMorph] = useState<OrbitalMorph | null>(null);
  /** Opening sequence in progress (skippable). */
  const [intro, setIntro] = useState(false);
  const opened = useRef(false);
  /** Selection last sent to the inspector (undefined = nothing sent yet). */
  const lastInspected = useRef<string | null | undefined>(undefined);
  const graphRef = useRef<GraphCanvasRef>(null);
  const singleClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocus = useRef(-1);
  const readingBookmark = useRef<OrbitalReadingBookmark | null>(null);
  const [restoreRequest, setRestoreRequest] = useState<OrbitalReadingBookmark | null>(null);
  const [followTarget, setFollowTarget] = useState<{ key: string } | null>(null);
  const lastFollow = useRef("");
  const suppressInspection = useRef(false);
  const bus = useMemo<LabelBus>(() => ({ targets: new Map(), active: new Set(), positions: new Map(), trackTargets: new Map() }), []);
  /** View-only motion (breathing, ripples, glints) and hover, shared with every glyph. */
  const motion = useMemo(createMotionBus, []);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const hoverCard = useRef<HTMLDivElement>(null);
  const scope = path[path.length - 1];
  const level = useMemo(() => orbitalLevel(world, scope, activityNodes, activityEdges), [world, scope, activityNodes, activityEdges]);
  const surrounding = useMemo(() => surroundingEntities(level, selectedId), [level, selectedId]);
  const nebula = surrounding.nodes;
  const mainWeights = useMemo(() => mainProminence(level), [level]);
  const arranged = scope.kind === "volume" ? arrangement : undefined;
  const layout = useMemo(() => layoutOrbitalLevel(level, nebula, { main: mainWeights, nebula: surrounding.prominence, anchors: arranged?.anchors, radiusScale: arranged?.radiusScale }), [level, nebula, mainWeights, surrounding.prominence, arranged]);
  /** The level we came from, recoiled behind the current one (view only). */
  const backdrop = useMemo(() => {
    if (path.length < 2) return undefined;
    const parentLevel = orbitalLevel(world, path[path.length - 2], activityNodes, activityEdges);
    const enteredId = parentLevel.main.find((entry) => entry.scope?.key === scope.key)?.node.id;
    if (!enteredId) return undefined;
    return layoutParentBackdrop(layoutOrbitalLevel(parentLevel, [], { main: mainProminence(parentLevel), anchors: path[path.length - 2].kind === "volume" ? arrangement?.anchors : undefined }).draws, enteredId, layout.draws);
  }, [path, world, activityNodes, activityEdges, scope.key, layout.draws, arrangement]);
  const parent = layout.draws.find((draw) => draw.node.id === revealedId && draw.entry?.scope);
  const previewLevel = useMemo(() => parent?.entry?.scope ? orbitalLevel(world, parent.entry.scope, activityNodes, activityEdges) : null, [world, parent, activityNodes, activityEdges]);
  const preview = useMemo(() => parent && previewLevel ? layoutOrbitalPreview(parent, previewLevel) : { draws: [], paths: [] }, [parent, previewLevel]);
  const baseDraws = useMemo(() => {
    const extra = arranged?.extraDraws ?? [];
    const taken = new Set([...layout.draws, ...extra].map((draw) => draw.node.id));
    const main = arranged?.envelope ? layout.draws.map((draw) => draw.role === "main" ? { ...draw, envelope: arranged.envelope } : draw) : layout.draws;
    return [...main, ...extra, ...preview.draws.filter((draw) => !taken.has(draw.node.id))];
  }, [layout.draws, arranged, preview.draws]);
  /** Picture draws: placePictures resolves each album illustration
   * against the level's scene-kind nodes; a placed picture becomes a
   * main-role "picture" draw interpolated between its neighboring
   * scene draws. Unplaced pictures (anchor sentence in no scene) and
   * pictures whose prev scene has no draw in this level produce no
   * draw — never force-assigned. */
  const pictureDraws = useMemo(() => {
    if (!albumPictures.length) return [];
    const scenes = level.sourceNodes
      .filter((node) => node.kind === "scene")
      .sort((first, second) => first.chrono - second.chrono)
      .map((node) => ({ id: node.id, chrono: node.chrono, sentenceIds: node.sentenceIds ?? [] }));
    if (!scenes.length) return [];
    const known = new Set(baseDraws.map((draw) => draw.node.id));
    const sceneDraws = baseDraws
      .filter((draw) => draw.node.kind === "scene")
      .sort((first, second) => first.node.chrono - second.node.chrono);
    const drawForScene = (sceneId: string) =>
      baseDraws.find((draw) => draw.node.id === sceneId)
      ?? baseDraws.find((draw) => draw.node.cluster?.ids.includes(sceneId));
    const draws: OrbitalDraw[] = [];
    for (const placement of placePictures(scenes, albumPictures)) {
      if (!placement.placed || known.has(placement.pictureId)) continue;
      const prevDraw = drawForScene(placement.prevSceneId);
      if (!prevDraw) continue;
      const nextDraw = placement.nextSceneId ? drawForScene(placement.nextSceneId) : undefined;
      const prevScene = scenes.find((scene) => scene.id === placement.prevSceneId)!;
      const nextScene = placement.nextSceneId ? scenes.find((scene) => scene.id === placement.nextSceneId) : undefined;
      const fraction = nextScene && nextScene.chrono > prevScene.chrono
        ? (placement.chrono - prevScene.chrono) / (nextScene.chrono - prevScene.chrono)
        : 1;
      const prevIndex = sceneDraws.findIndex((draw) => draw.node.id === prevDraw.node.id);
      const prevPrev = prevIndex > 0 ? sceneDraws[prevIndex - 1] : undefined;
      let position: Position3;
      if (nextDraw) {
        position = prevDraw.position.map((value, axis) => value + (nextDraw.position[axis] - value) * fraction) as Position3;
      } else {
        position = prevPrev
          ? prevDraw.position.map((value, axis) => value + (value - prevPrev.position[axis])) as Position3
          : [prevDraw.position[0], prevDraw.position[1] + 60, prevDraw.position[2]];
      }
      /** Timeline tangent at the picture: toward the next scene, or along
       * the previous interval past the last scene. The card's plane stands
       * perpendicular to this direction at all times (never billboarded). */
      const facing: Position3 = nextDraw
        ? nextDraw.position.map((value, axis) => value - prevDraw.position[axis]) as Position3
        : prevPrev
          ? prevDraw.position.map((value, axis) => value - prevPrev.position[axis]) as Position3
          : [0, 0, 1];
      draws.push({
        node: { id: placement.pictureId, label: pictureKindLabel(placement.kind), kind: "picture", state: "canon", parent: null, lane: "canon", chrono: placement.chrono, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] },
        role: "main",
        radius: prevDraw.radius * 0.9 || 16,
        position,
        facing,
      });
    }
    return draws;
  }, [albumPictures, level.sourceNodes, baseDraws]);
  /** Portrait draws: each bound portrait becomes a main-role "portrait"
   * draw billboarded next to its character's draw in this level. A
   * portrait whose character has no draw here produces no draw — the
   * portrait stays hidden, exactly like an unbound orphan. */
  const portraitDraws = useMemo(() => {
    if (!albumPortraits.length) return [];
    const known = new Set(baseDraws.map((draw) => draw.node.id));
    const draws: OrbitalDraw[] = [];
    for (const portrait of albumPortraits) {
      if (known.has(portrait.id)) continue;
      const charDraw = baseDraws.find((draw) => draw.node.id === portrait.entityId);
      if (!charDraw) continue;
      const radius = charDraw.radius * 0.8 || 14;
      draws.push({
        node: { id: portrait.id, label: `Portrait · ${portrait.entityLabel}`, kind: "portrait", state: "canon", parent: charDraw.node.parent, lane: "canon", chrono: charDraw.node.chrono, lanePos: [0, 0, 0], interiorPos: [0, 0, 0] },
        role: "main",
        radius,
        position: [charDraw.position[0] + charDraw.radius * 2.4, charDraw.position[1] + charDraw.radius * 1.2, charDraw.position[2]],
      });
    }
    return draws;
  }, [albumPortraits, baseDraws]);
  /** Album panel entries: the same placePictures resolution as the draws,
   * plus scene labels, so the side panel can show every album picture —
   * placed ones between their neighboring scenes, unplaced ones listed
   * as not yet on the orbit. */
  const albumInfo = useMemo((): AlbumPanelPicture[] => {
    if (!albumPictures.length) return [];
    const scenes = level.sourceNodes
      .filter((node) => node.kind === "scene")
      .sort((first, second) => first.chrono - second.chrono)
      .map((node) => ({ id: node.id, chrono: node.chrono, sentenceIds: node.sentenceIds ?? [], label: node.label }));
    if (!scenes.length) {
      return albumPictures.map((picture) => ({ id: picture.id, asset: picture.asset, kind: picture.kind, label: pictureKindLabel(picture.kind), placed: false, prevSceneLabel: null, nextSceneLabel: null, chrono: null }));
    }
    const labelFor = (id: string | null) => scenes.find((scene) => scene.id === id)?.label ?? null;
    return placePictures(scenes, albumPictures).map((placement) => ({
      id: placement.pictureId,
      asset: placement.asset,
      kind: placement.kind,
      label: pictureKindLabel(placement.kind),
      placed: placement.placed,
      prevSceneLabel: placement.placed ? labelFor(placement.prevSceneId) : null,
      nextSceneLabel: placement.placed ? labelFor(placement.nextSceneId) : null,
      chrono: placement.chrono,
    }));
  }, [albumPictures, level.sourceNodes]);
  const connections = useMemo(() => nestedEntityConnections(level, baseDraws, selectedId), [level, baseDraws, selectedId]);
  const causalLinks = useMemo(() => scope.kind === "library" || scope.kind === "series" || !showCausal ? [] : worldCausalLinks(world), [world, scope.kind, showCausal]);
  const causal = useMemo(() => {
    if (scope.kind === "library" || scope.kind === "series") return libraryCausalProjection(level, baseDraws, world.library);
    const projected = causalProjection(level, baseDraws, causalLinks, world.causal?.dialogueScenes ?? {});
    return arranged?.routeCausal ? { ...projected, arrows: arranged.routeCausal(projected.arrows, baseDraws) } : projected;
  }, [level, baseDraws, causalLinks, world, scope.kind, arranged]);
  const causalShown = showCausal || scope.kind === "library" || scope.kind === "series";
  const hoveredDraw = hoveredId ? baseDraws.find((draw) => draw.node.id === hoveredId) : undefined;
  /** Hovering an entity previews its links to visible spheres as faint threads. */
  const hoverEdges = useMemo(() => {
    if (!hoveredDraw || hoveredDraw.role !== "nebula" || hoveredDraw.node.id === selectedId) return [];
    const visible = new Set(baseDraws.map((draw) => draw.node.id));
    // Links into scenes hidden inside a sphere end on that containing sphere.
    const nested = nestedEntityConnections(level, baseDraws, hoveredDraw.node.id);
    const container = new Map(nested.draws.map((port) => [port.node.id, port.previewParentId]));
    const threads = new Map<string, WorldEdge>();
    for (const edge of nested.edges) {
      const to = visible.has(edge.to) ? edge.to : container.get(edge.to);
      if (to && visible.has(edge.from) && visible.has(to) && !threads.has(to)) threads.set(to, { ...edge, id: `hover:${edge.from}:${to}`, to });
    }
    return [...threads.values()];
  }, [hoveredDraw, selectedId, level, baseDraws]);
  useEffect(() => { motion.hoveredId = null; setHoveredId(null); }, [scope.key, motion]);
  /** EM joins: a still-drawn dropped record moves onto its survivor; one the
   * new snapshot already removed gets a view-only preimage at the survivor,
   * and the morph glides both in from their last drawn poses. */
  const [joinView, setJoinView] = useState<{ moves: Map<string, Position3>; preimages: OrbitalDraw[] } | null>(null);
  const draws = useMemo(() => {
    const all = [...baseDraws, ...connections.draws, ...pictureDraws, ...portraitDraws, ...(joinView?.preimages ?? [])];
    if (!joinView?.moves.size) return all;
    return all.map((draw) => {
      const target = joinView.moves.get(draw.node.id);
      return target ? { ...draw, position: target } : draw;
    });
  }, [baseDraws, connections.draws, pictureDraws, portraitDraws, joinView]);
  const levelPaths = useMemo(() => arranged?.paths ? arranged.paths(layout.draws, selectedId) : layout.paths, [arranged, layout.draws, layout.paths, selectedId]);
  const paths = useMemo(() => [...levelPaths.map((track) => {
    if (!morph) return track;
    const fromPoints = track.points.map((point) => {
      const draw = layout.draws.find((entry) => entry.role === "main" && entry.position.every((value, axis) => value === point[axis]));
      return draw ? morph.from.get(draw.node.id)?.position ?? point : point;
    });
    if (fromPoints.length > 2) {
      fromPoints[0] = fromPoints[1];
      fromPoints[fromPoints.length - 1] = fromPoints[fromPoints.length - 2];
    }
    return { ...track, fromPoints };
  }), ...preview.paths], [levelPaths, layout.draws, preview.paths, morph]);
  const edges = connections.edges;
  const visibleConnections = useMemo(() => scope.kind === "library" || scope.kind === "series"
    ? connections.edges.filter(edge => edge.relationType !== "CAUSES")
    : connections.edges, [connections.edges, scope.kind]);
  const selected = draws.find((draw) => draw.node.id === selectedId);
  const inspectedRecord = selected?.node ?? level.sourceNodes.find((node) => node.id === selectedId);
  const activityTarget = useMemo(() => activityFocus(activity), [activity]);
  const libraryEvent = world.library?.events.at(-1);
  const libraryActive = !!libraryEvent && (!activityTarget.timestamp || libraryEvent.timestamp > activityTarget.timestamp);
  const touchedNodeIds = libraryActive ? libraryEvent.sourceIds : activityTarget.nodeIds;
  const touchAncestors = useMemo(() => new Set(touchedNodeIds.flatMap(id => [...orbitalTouchAncestors(level.sourceNodes, level.sourceEdges, id)])), [touchedNodeIds, level.sourceNodes, level.sourceEdges]);
  const touchedIds = useMemo(() => draws.filter(draw => touchAncestors.has(draw.node.id) || draw.entry?.members.some(id => touchAncestors.has(id))).map(draw => draw.node.id), [draws, touchAncestors]);
  const pageLabel = scope.sceneId ? level.sourceNodes.find(node => node.id === scope.sceneId)?.summary ?? level.sourceNodes.find(node => node.id === scope.sceneId)?.label ?? scope.label : scope.kind === "chapter" ? world.laneNodes.find(node => node.id === scope.chapterId)?.label ?? scope.label : scope.kind === "scenes" ? representativeScene(level.sourceNodes, level.sourceEdges, level.sourceNodes.filter(node => scope.ids?.includes(node.id)))?.summary ?? scope.label : scope.label;
  const location = useMemo(() => orbitalLocation(world, path, level, book, inspectedRecord ?? null), [world, path, level, book, inspectedRecord]);
  const locationRef = useRef<HTMLOListElement>(null);
  useEffect(() => { const list = locationRef.current; if (list) list.scrollLeft = list.scrollWidth; }, [location]);
  const overviewPositions = useRef<Position3[]>([]);
  overviewPositions.current = layout.draws.map(draw => draw.position);

  useEffect(() => { setPath(initialPath()); setSelectedId(null); setRevealedId(null); setMorph(null); }, [resetToken]);
  /** Another book's world: start at its overview, except when returning to
   * the book whose reading bookmark was just restored after following Pi. */
  const shownBook = useRef(bookId);
  const bookmarkBook = useRef<number | null>(null);
  const restoredBook = useRef<number | null>(null);
  useEffect(() => {
    if (shownBook.current === bookId) return;
    shownBook.current = bookId;
    lastFollow.current = "";
    if (bookId !== null && restoredBook.current === bookId) { restoredBook.current = null; return; }
    restoredBook.current = null;
    setPath(initialPath()); setSelectedId(null); setRevealedId(null); setMorph(null); setJoinView(null);
  }, [bookId]);
  useEffect(() => {
    if (!world.library) return;
    setPath(current => {
      const volumeIndex = current.findIndex(entry => entry.kind === "volume");
      if (volumeIndex < 0) {
        const series = current.find(entry => entry.kind === "series");
        return series && !orbitalLevel(world, series).main.length ? [libraryScope] : current;
      }
      if (!world.sourceId) return current;
      return [...readingPrefix, volumeRoot, ...current.slice(volumeIndex + 1)];
    });
  }, [world.library?.revision, readingPrefix, volumeRoot]);
  useEffect(() => {
    if (canEnterOrbitalScope(scope)) return;
    setPath(current => current.filter(canEnterOrbitalScope));
    setSelectedId(scope.sceneId ?? null);
    setRevealedId(scope.sceneId ?? null);
    setMorph(null);
  }, [scope.kind, scope.sceneId]);
  useEffect(() => { onChapter(scope.chapterId ?? null); }, [scope.chapterId, onChapter]);
  useEffect(() => { onPage?.({ key: scope.key, label: pageLabel, kind: scope.kind, chapterId: scope.chapterId }); }, [scope.key, scope.kind, scope.chapterId, pageLabel, onPage]);
  useEffect(() => () => { if (singleClick.current) clearTimeout(singleClick.current); }, []);
  useEffect(() => {
    if (!morph) return;
    const timeout = setTimeout(() => setMorph(null), reducedMotion ? 0 : morphSpan(morph, ORBITAL_TRANSITION_MS) + 50);
    return () => clearTimeout(timeout);
  }, [morph, reducedMotion]);
  useEffect(() => {
    if (restoreRequest || !followingActivity && readingBookmark.current) return;
    if (suppressInspection.current) { suppressInspection.current = false; return; }
    // Live data refreshes re-send the same selection; only a new selection may
    // open (or close) the inspector, so a panel the reader closed stays closed.
    const selectionKey = inspectedRecord?.id ?? null;
    const refresh = lastInspected.current === selectionKey;
    lastInspected.current = selectionKey;
    const record = followingActivity ? draws.find(draw => draw.node.id === touchedNodeIds.at(-1))?.node ?? [...draws].reverse().find(draw => touchedIds.includes(draw.node.id))?.node ?? inspectedRecord ?? level.main[0]?.node ?? level.nebula[0] : inspectedRecord ?? level.main[0]?.node ?? level.nebula[0];
    onSelect(record ? { node: record, nodes: draws.map((draw) => draw.node), edges: inspectedRecord ? edges : [], lookupNodes: level.sourceNodes, contents: orbitalContents(record, level), inspect: !!inspectedRecord, passive: followingActivity || refresh, album: albumInfo } : null);
  }, [inspectedRecord, draws, edges, level.sourceNodes, onSelect, followingActivity, restoreRequest, touchedIds, touchedNodeIds, albumInfo]);

  const snapshot = () => new Map(draws.map((draw): [string, OrbitalPose] => [draw.node.id, { position: bus.positions.get(draw.node.id) ?? draw.position, radius: draw.radius }]));
  /** EM join animation for a batch of real merges. Poses come from the last
   * rendered frame of this level, because the snapshot announcing a merge has
   * usually already removed the dropped entity. Joins not visible here settle
   * at once (the activity notice still reports them); nothing pulls the
   * reader's camera away. Nothing here touches canonical data. */
  const lastPoses = useRef<{ key: string; poses: Map<string, LastPose> }>({ key: "", poses: new Map() });
  const handledJoins = useRef(new Set<number>());
  const joinTimers = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => joinTimers.current.forEach(clearTimeout), []);
  useEffect(() => {
    const fresh = joins.filter((join) => !handledJoins.current.has(join.seq));
    if (!fresh.length) return;
    fresh.forEach((join) => handledJoins.current.add(join.seq));
    const plan = planJoins(fresh, lastPoses.current.key === scope.key ? lastPoses.current.poses : new Map(), draws);
    plan.offscreen.forEach((join) => onJoinSettled(join.dropId));
    if (!plan.animated.length) return;
    setMorph({ startedAt: performance.now(), from: new Map([...snapshot(), ...plan.from]) });
    setJoinView((current) => ({ moves: new Map([...(current?.moves ?? []), ...plan.moves]), preimages: [...(current?.preimages ?? []), ...plan.preimages] }));
    const settled = new Set(plan.animated.map((join) => join.dropId));
    joinTimers.current.push(setTimeout(() => {
      setJoinView((current) => current && { moves: new Map([...current.moves].filter(([id]) => !settled.has(id))), preimages: current.preimages.filter((draw) => !plan.preimages.includes(draw)) });
      plan.animated.forEach((join) => onJoinSettled(join.dropId));
    }, reducedMotion ? 0 : ORBITAL_TRANSITION_MS + 80));
    // draws/snapshot are read from the render that delivered these joins;
    // re-running on their identity changes would restart them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [joins]);
  // Declared after the join effect so a join still sees the previous frame.
  // Entities that vanish keep their final pose until the level changes, in
  // case the merge event arrives a refresh after the removal.
  useEffect(() => {
    const poses = new Map(lastPoses.current.key === scope.key ? lastPoses.current.poses : []);
    for (const draw of draws) if (draw.role !== "preimage") poses.set(draw.node.id, { node: draw.node, position: bus.positions.get(draw.node.id) ?? draw.position, radius: draw.radius });
    lastPoses.current = { key: scope.key, poses };
  }, [draws, scope.key, bus]);
  const focus = useCallback((draw: OrbitalDraw) => {
    // A regrouped level may frame more than the sphere (a character's whole route).
    const span = arranged?.focusFor?.(draw.node.id, layout.draws);
    if (span && span.length > 1) { framePositions(graphRef, span, 1.15, !reducedMotion, { direction: arranged?.direction }); return; }
    const center = bus.positions.get(draw.node.id) ?? draw.position;
    framePositions(graphRef, [center], 1.2, !reducedMotion, { focusRadius: draw.radius });
  }, [bus, reducedMotion, arranged, layout.draws]);
  const [pendingFocus, setPendingFocus] = useState<OrbitalDraw | null>(null);
  useLayoutEffect(() => {
    if (!pendingFocus) return;
    focus(pendingFocus);
    setPendingFocus(null);
  }, [pendingFocus, focus]);
  useEffect(() => {
    if (followingActivity) {
      if (readingBookmark.current) return;
      if (singleClick.current) clearTimeout(singleClick.current);
      const controls = graphRef.current?.getControls?.();
      controls?.stop();
      bookmarkBook.current = bookId;
      readingBookmark.current = copyOrbitalBookmark({ path, selectedId, revealedId, camera: controls ? { position: controls.getPosition(new Vector3(), false).toArray() as Position3, target: controls.getTarget(new Vector3(), false).toArray() as Position3, up: controls.camera.up.toArray() as Position3, zoom: controls.camera.zoom, focalOffset: controls.getFocalOffset(new Vector3(), false).toArray() as Position3 } : null });
      setPendingFocus(null);
      return;
    }
    const saved = readingBookmark.current;
    if (!saved) return;
    readingBookmark.current = null;
    restoredBook.current = bookmarkBook.current !== shownBook.current ? bookmarkBook.current : null;
    lastFollow.current = "";
    setFollowTarget(null);
    setPendingFocus(null);
    setPath(saved.path);
    setSelectedId(saved.selectedId);
    setRevealedId(saved.revealedId);
    setMorph(null);
    setRestoreRequest(saved);
  }, [followingActivity]);
  useEffect(() => {
    if (!restoreRequest) return;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const restore = () => {
      const controls = graphRef.current?.getControls?.();
      if (!controls && ++attempts < 40) { timer = setTimeout(restore, 50); return; }
      const camera = restoreRequest.camera;
      if (controls && camera) {
        controls.stop();
        controls.camera.up.set(...camera.up);
        void controls.zoomTo(camera.zoom, false);
        void controls.setFocalOffset(...camera.focalOffset, false);
        void controls.setLookAt(...camera.position, ...camera.target, !reducedMotion);
      }
      suppressInspection.current = true;
      lastFocus.current = focusRequest?.sequence ?? -1;
      setRestoreRequest(null);
    };
    timer = setTimeout(restore, 180);
    return () => clearTimeout(timer);
  }, [restoreRequest, reducedMotion, focusRequest?.sequence]);
  useEffect(() => {
    if (!followingActivity || !activity && !libraryEvent || restoreRequest) return;
    const key = libraryActive ? libraryEvent!.id : activityTarget.id ?? `${activity?.chapterId}:waiting`;
    if (lastFollow.current === key) return;
    const firstFollow = !lastFollow.current;
    const route = libraryActive ? { path: libraryActivityPath(world, libraryEvent!), targetId: null }
      : orbitalActivityBatchPath(world, touchedNodeIds, activity?.chapterId ?? "", activityNodes, activityEdges, path);
    if (!libraryActive && world.library) route.path = [...readingPrefix, ...route.path.map(entry => entry.kind === "volume" ? volumeRoot : entry)];
    lastFollow.current = key;
    const nextKey = route.path.map(entry => entry.key).join("/");
    if (nextKey !== path.map(entry => entry.key).join("/")) {
      setMorph({ startedAt: performance.now(), from: snapshot() });
      setPath(route.path);
      setRevealedId(null);
      setSelectedId(null);
      setPendingFocus(null);
      setFollowTarget({ key: nextKey });
    } else if (firstFollow) {
      setFollowTarget({ key: nextKey });
    }
  }, [followingActivity, activity, activityTarget.id, world, activityNodes, activityEdges, path, restoreRequest, touchedNodeIds, libraryActive, libraryEvent, readingPrefix, volumeRoot]);
  useEffect(() => {
    if (!followingActivity || !followTarget) return;
    let timer: ReturnType<typeof setTimeout>;
    let attempts = 0;
    const positionCamera = () => {
      if (!graphRef.current?.getControls?.() && ++attempts < 40) { timer = setTimeout(positionCamera, 50); return; }
      framePositions(graphRef, overviewPositions.current, 1.2, !reducedMotion);
      setFollowTarget(null);
    };
    timer = setTimeout(positionCamera, 180);
    return () => clearTimeout(timer);
  }, [followingActivity, followTarget, reducedMotion]);
  const inspect = (draw: OrbitalDraw) => {
    if (singleClick.current) clearTimeout(singleClick.current);
    singleClick.current = setTimeout(() => {
      const linked = nestedEntityConnections(level, baseDraws, draw.node.id).edges;
      setSelectedId(draw.node.id);
      onSelect({ node: draw.node, nodes: draws.map((entry) => entry.node), edges: linked, lookupNodes: level.sourceNodes, contents: orbitalContents(draw.node, level), album: albumInfo });
      setPendingFocus(draw);
      if (!reducedMotion) {
        // Selection answers physically: a lift wave along the timeline and
        // linked entities glinting in order of link strength.
        const t = now();
        addRipple(motion, { kind: "select", origin: draw.position, start: t });
        scheduleGlints(motion, draw.node.id, linked, t);
      }
    }, 260);
  };
  /** Click on empty space: a soft ripple from that point and the selection clears. */
  const blankClick = (event: MouseEvent) => {
    const controls = graphRef.current?.getControls?.();
    const surface = event.target instanceof HTMLElement ? event.target.getBoundingClientRect() : null;
    if (controls && surface && !reducedMotion) {
      const camera = controls.camera;
      const ndc = new Vector3(((event.clientX - surface.left) / surface.width) * 2 - 1, -((event.clientY - surface.top) / surface.height) * 2 + 1, 0.5).unproject(camera);
      const direction = ndc.sub(camera.position).normalize();
      const origin = rayPlanePoint(camera.position.toArray() as Position3, direction.toArray() as Position3, 0) ?? controls.getTarget(new Vector3(), false).toArray() as Position3;
      addRipple(motion, { kind: "blank", origin, start: now() });
    }
    setHover(null);
    if (!followingActivity && selectedId) setSelectedId(null);
  };
  useEffect(() => {
    if (followingActivity || restoreRequest || !focusRequest || lastFocus.current === focusRequest.sequence) return;
    if (focusRequest.chapterId && scope.chapterId !== focusRequest.chapterId) {
      const chapterId = focusRequest.chapterId;
      setPath([volumeScope, { key: `orbital:chapter:${chapterId}`, kind: "chapter", chapterId, label: world.laneNodes.find((node) => node.id === chapterId)?.label ?? "Chapter" }]);
      setSelectedId(null); setRevealedId(null);
      return;
    }
    const draw = draws.find((entry) => entry.node.id === focusRequest.node.id);
    if (draw) {
      lastFocus.current = focusRequest.sequence;
      setSelectedId(draw.node.id);
      onSelect({ node: draw.node, nodes: draws.map((entry) => entry.node), edges: nestedEntityConnections(level, baseDraws, draw.node.id).edges, lookupNodes: level.sourceNodes, contents: orbitalContents(draw.node, level), album: albumInfo });
      setPendingFocus(draw);
    }
    else if (focusRequest.node.parent && world.interiors[focusRequest.node.parent] && scope.chapterId !== focusRequest.node.parent) {
      const chapterId = focusRequest.node.parent;
      setPath([volumeScope, { key: `orbital:chapter:${chapterId}`, kind: "chapter", chapterId, label: world.laneNodes.find((node) => node.id === chapterId)?.label ?? "Chapter" }]);
      setSelectedId(null); setRevealedId(null);
    } else {
      lastFocus.current = focusRequest.sequence;
      setSelectedId(focusRequest.node.id);
      onSelect({ node: focusRequest.node, nodes: draws.map((entry) => entry.node), edges: level.sourceEdges.filter((edge) => edge.from === focusRequest.node.id || edge.to === focusRequest.node.id), lookupNodes: level.sourceNodes, contents: orbitalContents(focusRequest.node, level), album: albumInfo });
      const container = layout.draws.find((entry) => entry.entry?.members.includes(focusRequest.node.id));
      if (container) setPendingFocus(container);
    }
  }, [focusRequest, draws, focus, world, scope.chapterId, level, layout.draws, onSelect, followingActivity, restoreRequest]);
  const enter = (draw: OrbitalDraw) => {
    const target = draw.role === "preview" ? parent?.entry?.scope : draw.node.library ? draw.entry?.scope : undefined;
    if (!target || morph) return;
    if (!canEnterOrbitalScope(target)) { inspect(draw); return; }
    if (target.kind === "volume" && draw.node.library?.volume) onSourceVolume?.(draw.node.library.volume);
    if (singleClick.current) clearTimeout(singleClick.current);
    graphRef.current?.getControls?.()?.stop();
    setMorph({ startedAt: performance.now(), from: snapshot() });
    setPath((current) => [...current, target]);
    setSelectedId(draw.node.id);
    setRevealedId(null);
  };
  const back = () => {
    if (path.length <= 1 || morph) return;
    if (singleClick.current) clearTimeout(singleClick.current);
    graphRef.current?.getControls?.()?.stop();
    setMorph({ startedAt: performance.now(), from: snapshot() });
    setPath((current) => current.slice(0, -1));
    setSelectedId(null); setRevealedId(null);
  };
  const jumpTo = (index: number) => {
    if (index >= path.length - 1 || morph) return;
    if (singleClick.current) clearTimeout(singleClick.current);
    graphRef.current?.getControls?.()?.stop();
    setMorph({ startedAt: performance.now(), from: snapshot() });
    setPath((current) => current.slice(0, index + 1));
    setSelectedId(null); setRevealedId(null);
  };
  const setHover = useCallback((id: string | null) => {
    motion.hoveredId = id;
    setHoveredId(id);
    const canvas = document.querySelector<HTMLCanvasElement>(".orbital-stage canvas");
    if (canvas) canvas.style.cursor = id ? "pointer" : "";
  }, [motion]);
  useEffect(() => {
    const stage = document.querySelector(".orbital-stage");
    const leave = () => setHover(null);
    stage?.addEventListener("pointerleave", leave);
    return () => stage?.removeEventListener("pointerleave", leave);
  }, [setHover]);
  /** Opening sequence: once per browser session, the volume uncoils from one
   * point into its timeline. Any tap, key or wheel skips it. */
  useEffect(() => {
    if (opened.current || !draws.length) return;
    let seen = reducedMotion || !!restoreRequest;
    try { seen ||= !!sessionStorage.getItem("orbital-opening-seen"); } catch { /* storage unavailable: play it once for this view */ }
    if (seen) { opened.current = true; return; }
    // Start after this mount's own resets (book, scope) have settled.
    const timer = setTimeout(() => {
      opened.current = true;
      try { sessionStorage.setItem("orbital-opening-seen", "1"); } catch { /* see above */ }
      const opening = openingMorph(draws, performance.now());
      if (opening) { setMorph(opening); setIntro(true); }
    }, 60);
    return () => clearTimeout(timer);
  }, [draws, reducedMotion, restoreRequest]);
  useEffect(() => {
    if (!intro) return;
    if (!morph?.delays) { setIntro(false); return; }
    const skip = () => { setMorph(null); setIntro(false); };
    window.addEventListener("pointerdown", skip, true);
    window.addEventListener("keydown", skip, true);
    window.addEventListener("wheel", skip, { capture: true, passive: true });
    return () => { window.removeEventListener("pointerdown", skip, true); window.removeEventListener("keydown", skip, true); window.removeEventListener("wheel", skip, true); };
  }, [intro, morph]);
  /** Pi heartbeat target: the record Pi is touching right now (live work only). */
  const heartbeatId = useMemo(() => {
    if (!piBusy(activity) || activityTarget.historical || !touchedIds.length) return null;
    const latest = touchedNodeIds.at(-1);
    return touchedIds.find((id) => id === latest) ?? draws.find((draw) => draw.role === "main" && touchedIds.includes(draw.node.id))?.node.id ?? touchedIds.at(-1)!;
  }, [activity, activityTarget.historical, touchedIds, touchedNodeIds, draws]);
  /** Faculties working right now, placed on the sphere where their block is built. */
  const working = useMemo(() => facultyAnchors(activity?.faculties, draws, scope.chapterId), [activity?.faculties, draws, scope.chapterId]);
  const openFacultyStrip = () => {
    const strip = document.querySelector<HTMLDetailsElement>(".faculty-pipeline details");
    if (!strip) return;
    strip.open = true;
    strip.scrollIntoView({ block: "nearest", behavior: reducedMotion ? "auto" : "smooth" });
  };
  /** Swipes on the phone record bar arrive as "orbital-nav": up goes one level
   * deeper (enter a revealed sphere, else zoom closer), down goes back. */
  const navigate = useRef<(direction: "deeper" | "back") => void>(() => {});
  navigate.current = (direction) => {
    if (direction === "back") { if (path.length > 1) back(); else zoomBy(160); return; }
    const entry = preview.draws.find((draw) => draw.role === "preview");
    if (parent?.entry?.scope && entry && canEnterOrbitalScope(parent.entry.scope)) enter(entry); else zoomBy(-160);
  };
  useEffect(() => {
    const stage = document.querySelector(".orbital-stage");
    const command = (event: Event) => navigate.current((event as CustomEvent<"deeper" | "back">).detail);
    stage?.addEventListener("orbital-nav", command);
    return () => stage?.removeEventListener("orbital-nav", command);
  }, []);
  const reveal = useCallback((id: string | null) => setRevealedId((current) => current === id ? current : id), []);
  const allPositions = layout.draws.map((draw) => bus.positions.get(draw.node.id) ?? draw.position);
  const zoomBy = (delta: number) => document.querySelector(".orbital-stage")?.dispatchEvent(new CustomEvent("orbital-zoom", { detail: { delta } }));
  return <div className="orbital-explorer">
    <nav className="scene-sequence orbital-navigation" aria-label="Orbital levels">
      <div className="orbital-navigation-top"><button onClick={back} disabled={path.length <= 1 || !!morph} aria-label="Back one orbital level">← Back</button>{world.library && <button onClick={() => { setPath([libraryScope]); setSelectedId(null); setRevealedId(null); }} disabled={followingActivity || !!morph}>Series overview</button>}<span className="orbital-level"><RollingText text={`${String(path.length).padStart(2, "0")} / ${scope.kind === "scene" ? "SCENE · CONVERSATIONS" : scope.kind.toUpperCase()}`} /></span><button onClick={() => zoomBy(-80)} aria-label="Zoom in" title="Zoom in (+); Shift + scroll for fine control">＋</button><button onClick={() => zoomBy(80)} aria-label="Zoom out" title="Zoom out (−)">−</button><button onClick={() => framePositions(graphRef, allPositions, 1.2, !reducedMotion, { direction: arranged?.direction })}>Frame view ⌖</button><button aria-pressed={showRelations} onClick={onRelations}>Connections {showRelations ? "on" : "off"}</button></div>
      {bookBar}
      <ol ref={locationRef} className="orbital-location" aria-label="Location in the book">{location.map((crumb, index) => {
        const content = <><b><RollingText text={crumb.label} /></b>{crumb.detail && <span>{crumb.detail}</span>}</>;
        const navigable = crumb.pathIndex !== undefined && crumb.pathIndex < path.length - 1;
        return <li key={`${index}:${crumb.key}`} className={`location-${crumb.kind}${crumb.selection ? " is-selection" : ""}`} aria-current={index === location.length - 1 ? "location" : undefined} title={[crumb.label, crumb.detail].filter(Boolean).join(" · ")}>{navigable ? <button onClick={() => jumpTo(crumb.pathIndex!)} disabled={!!morph} aria-label={`Go to ${crumb.label}`}>{content}</button> : <span>{content}</span>}</li>;
      })}</ol>
      <div className="orbital-help"><span>Click to inspect · zoom to reveal · enter scene groups; conversations stay in place</span><span className="orbital-count" role="status">{level.main.length} main · {nebula.length} surrounding · {preview.draws.length} revealed · {edges.length} links{causalShown ? ` · ${causal.arrows.length} causal${causal.inside ? ` (+${causal.inside} inside spheres)` : ""}${causal.elsewhere ? ` · ${causal.elsewhere} to other chapters` : ""}` : ""}</span></div>
      {followingActivity && activity && !libraryActive && <div className="orbital-live-status" role="status"><b>Following activity · {activity.blockId ?? "waiting"} · page overview</b><span>{activity.phase}</span>{activityTarget.timestamp && <small>{activityTarget.historical ? "Last observed · " : ""}{touchedNodeIds.length ? `Blue bounds · ${touchedNodeIds.length} ${activityTarget.kind === "review" ? "review targets (not edits)" : "edited records"}` : "No visible graph target for this tool action"} · {activityTarget.faculty} · {new Date(activityTarget.timestamp).toLocaleTimeString()}</small>}</div>}
      {(scope.kind === "library" || scope.kind === "series") && <div className="orbital-live-status"><b>{scope.kind === "library" ? "Series / continuity groups" : "Files in reading order — not story time"}</b><span>{world.library?.plans.length ?? 0} proposed/held plans · {world.library?.omittedPlans ? `${world.library.omittedPlans} older plans not shown · ` : ""}Unattached files are inspect-only; opening a file never starts Pi.</span></div>}
      {followingActivity && libraryActive && <div className="orbital-live-status" role="status"><b>Following library activity · {libraryEvent.type.replaceAll(".", " / ")}</b><span>{libraryEvent.sourceIds.length} organization targets · {new Date(libraryEvent.timestamp).toLocaleTimeString()}</span></div>}
    </nav>
    <div className="stage orbital-stage" tabIndex={0} aria-label="Orbital timeline. Scroll or pinch to zoom; Shift scroll for fine control; plus and minus zoom. Select a sphere to inspect; Shift Enter on a revealed sphere enters its level. Escape returns one level." onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Escape") { event.preventDefault(); back(); }
      if (!event.metaKey && !event.ctrlKey && ["+", "=", "-", "_"].includes(event.key)) { event.preventDefault(); zoomBy(event.key === "+" || event.key === "=" ? -80 : 80); }
      if (event.key === "Enter" && selected) { event.preventDefault(); if (event.shiftKey) enter(selected); else inspect(selected); }
    }}>
      <div className="graph-canvas"><OrbitalGraph ref={graphRef} draws={draws} paths={paths} edges={showRelations && !(arranged?.pathReplacesLinks && level.nebula.some((node) => node.id === selectedId)) ? visibleConnections : []} causal={showRelations ? causal.arrows : []} backdrop={backdrop} bus={bus} selectedId={selectedId} touchedIds={touchedIds} autoFrame={!followingActivity && !restoreRequest} revealedId={revealedId} levelKey={scope.key} reducedMotion={reducedMotion} morph={morph} onSelect={inspect} onEnter={enter} onReveal={reveal} onBack={back} motion={motion} hoverEdges={hoverEdges} hoverCard={hoverCard} onHover={setHover} onBlank={blankClick} heartbeatId={heartbeatId} faculties={working}  floor={arranged?.floor} frameDirection={arranged?.direction} frameSpan={arranged?.initialFrame?.(layout.draws)} onCenter={scope.kind === "volume" ? onCenter : undefined} /></div>
      {intro && <div className="orbital-intro-skip" aria-hidden="true">Tap anywhere to skip</div>}
      <div className="labels-layer faculty-chips">{working.map((anchor) => <button key={anchor.id} type="button" className="faculty-chip" data-faculty-anchor={anchor.id} onClick={openFacultyStrip} aria-label={`Working here: ${anchor.faculties.join(", ")}. Open faculty activity`}>{facultyChipText(anchor)}</button>)}</div>
      <div className="labels-layer orbital-labels">{draws.filter((draw) => draw.role !== "preimage" && draw.envelope !== "hidden").map((draw) => <button key={draw.node.id} className={`node-label orbital-label role-${draw.role} k-${draw.node.kind} s-${draw.node.state}${selectedId === draw.node.id ? " is-selected" : ""}${touchedIds.includes(draw.node.id) ? " latest-touch" : ""}${draw.role === "nebula" && (draw.prominence ?? 1) < 0.35 && selectedId !== draw.node.id ? " is-faint" : ""}${hoveredId === draw.node.id ? " is-hovered" : ""}`} style={{ visibility: "hidden" }} aria-label={`Inspect ${draw.role === "preview" ? "revealed " : ""}${draw.node.kind} ${draw.node.label}`} aria-pressed={selectedId === draw.node.id} title={draw.role === "preview" ? canEnterOrbitalScope(parent?.entry?.scope) ? "Double-click or Shift Enter to enter this revealed level" : "Inspect this record in place; no deeper timeline" : draw.entry?.scope ? "Click to inspect and zoom. Zoom reveals contents in place." : "Click to inspect"} ref={(element) => { if (element) bus.targets.set(draw.node.id, element); else bus.targets.delete(draw.node.id); }} onClick={() => inspect(draw)} onDoubleClick={() => enter(draw)} onPointerEnter={() => setHover(draw.node.id)} onPointerLeave={() => { if (motion.hoveredId === draw.node.id) setHover(null); }} onKeyDown={(event) => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); enter(draw); } }}>
        <span className="node-code">{draw.role === "preview" && !arranged?.envelope ? "REVEALED / " : ""}{(draw.node.viewKind ?? draw.node.library?.type ?? draw.node.kind).toUpperCase()}{draw.node.state !== "canon" ? ` · ${draw.node.state}` : ""}</span><b>{draw.node.label}</b>{draw.node.cluster && <span>{draw.node.cluster.ids.length} records · orbital group</span>}{showRelations && !!causal.insideBy.get(draw.node.id) && <span className="causal-inside">{causal.insideBy.get(draw.node.id)} causal inside</span>}
      </button>)}</div>
      <div ref={hoverCard} className="orbital-hover-card" aria-hidden="true" style={{ visibility: "hidden" }}>{hoveredDraw && <HoverCard key={hoveredDraw.node.id} draw={hoveredDraw} links={hoverEdges.length} causalInside={causal.insideBy.get(hoveredDraw.node.id) ?? 0} enterable={!!hoveredDraw.entry?.scope} />}</div>
      <div className="orbital-time-key" aria-hidden="true"><i />{arranged ? arranged.timeKey.label : scope.kind === "library" ? "SERIES" : scope.kind === "series" ? "READING ORDER →" : "TIME →"}<span>{arranged ? arranged.timeKey.detail : scope.kind === "library" ? "No chronological order between series" : scope.kind === "series" ? "Volume order, not actual story time" : "Blue arrows follow narrative order"}</span></div>
      {morph && <div className="orbital-transition-status" role="status">Uncoiling into the local timeline…</div>}
    </div>
    <div className="scene-legend"><span><i className="canon" />Canon</span><span><i className="proposed" />Proposed</span><span><i className="held" />Held</span><span>Spheres / weighted nebula</span>{causalShown && <span className="causal-key"><i />Causes (stored) · dashed = projected</span>}<button aria-pressed={reducedMotion} onClick={onMotion}>{reducedMotion ? "Motion reduced" : "Motion on"}</button></div>
  </div>;
}

/** Small floating card for the hovered sphere; its title rolls in per character. */
function HoverCard({ draw, links, causalInside, enterable }: { draw: OrbitalDraw; links: number; causalInside: number; enterable: boolean }) {
  const title = (draw.node.summary ?? draw.node.label).trim();
  const rolled = [...title.slice(0, 28)];
  const detail = draw.node.cluster ? `${draw.node.cluster.ids.length} scenes · orbital group` : draw.role === "nebula" ? `linked to ${links} visible sphere${links === 1 ? "" : "s"}` : enterable ? "Zoom to reveal · double-click a revealed sphere to enter" : "Click to inspect";
  return <>
    <span className="hover-kind">{draw.node.viewKind ?? KIND_LABEL[draw.node.kind] ?? draw.node.kind}{draw.node.state !== "canon" ? ` · ${draw.node.state}` : ""}</span>
    <b>{rolled.map((character, index) => <span key={index} style={{ animationDelay: `${index * 14}ms` }}>{character}</span>)}{title.length > 28 ? "…" : ""}</b>
    <small>{detail}{causalInside ? ` · ${causalInside} causal inside` : ""}</small>
  </>;
}
