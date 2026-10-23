import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { GraphCanvasRef } from "reagraph";
import type { WorldEdge, WorldNode } from "../types";
import type { Position3 } from "../data/spatialLayout";
import { orbitalContents, orbitalLevel, progressiveNebula, volumeScope, type OrbitalScope, type OrbitalWorld } from "../data/orbitalModel";
import { layoutOrbitalLevel, layoutOrbitalPreview, nestedEntityConnections, type OrbitalDraw, type OrbitalMorph, type OrbitalPose } from "../data/orbitalLayout";
import { framePositions, type LabelBus } from "./WorldGraph";
import { OrbitalGraph, ORBITAL_TRANSITION_MS } from "./OrbitalGraph";

export interface OrbitalInspection { node: WorldNode; nodes: WorldNode[]; edges: WorldEdge[]; lookupNodes: WorldNode[]; contents: WorldNode[]; inspect?: boolean }
interface Props {
  world: OrbitalWorld;
  activityNodes: WorldNode[];
  activityEdges: WorldEdge[];
  reducedMotion: boolean;
  showRelations: boolean;
  resetToken: number;
  focusRequest: { node: WorldNode; sequence: number; chapterId?: string } | null;
  onSelect: (inspection: OrbitalInspection | null) => void;
  onChapter: (id: string | null) => void;
  onMotion: () => void;
  onRelations: () => void;
}

export function OrbitalExplorer({ world, activityNodes, activityEdges, reducedMotion, showRelations, resetToken, focusRequest, onSelect, onChapter, onMotion, onRelations }: Props) {
  const [path, setPath] = useState<OrbitalScope[]>([volumeScope]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [revealedId, setRevealedId] = useState<string | null>(null);
  const [morph, setMorph] = useState<OrbitalMorph | null>(null);
  const graphRef = useRef<GraphCanvasRef>(null);
  const singleClick = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastFocus = useRef(-1);
  const bus = useMemo<LabelBus>(() => ({ targets: new Map(), active: new Set(), positions: new Map(), trackTargets: new Map() }), []);
  const scope = path[path.length - 1];
  const level = useMemo(() => orbitalLevel(world, scope, activityNodes, activityEdges), [world, scope, activityNodes, activityEdges]);
  const surrounding = useMemo(() => progressiveNebula(level, path.length, selectedId), [level, path.length, selectedId]);
  const nebula = surrounding.nodes;
  const layout = useMemo(() => layoutOrbitalLevel(level, nebula), [level, nebula]);
  const parent = layout.draws.find((draw) => draw.node.id === revealedId && draw.entry?.scope);
  const previewLevel = useMemo(() => parent?.entry?.scope ? orbitalLevel(world, parent.entry.scope, activityNodes, activityEdges) : null, [world, parent, activityNodes, activityEdges]);
  const preview = useMemo(() => parent && previewLevel ? layoutOrbitalPreview(parent, previewLevel) : { draws: [], paths: [] }, [parent, previewLevel]);
  const baseDraws = useMemo(() => [...layout.draws, ...preview.draws.filter((draw) => !layout.draws.some((entry) => entry.node.id === draw.node.id))], [layout.draws, preview.draws]);
  const connections = useMemo(() => nestedEntityConnections(level, baseDraws, selectedId), [level, baseDraws, selectedId]);
  const draws = useMemo(() => [...baseDraws, ...connections.draws], [baseDraws, connections.draws]);
  const paths = useMemo(() => [...layout.paths.map((track) => {
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
  }), ...preview.paths], [layout.paths, layout.draws, preview.paths, morph]);
  const edges = connections.edges;
  const selected = draws.find((draw) => draw.node.id === selectedId);
  const inspectedRecord = selected?.node ?? level.sourceNodes.find((node) => node.id === selectedId);

  useEffect(() => { setPath([volumeScope]); setSelectedId(null); setRevealedId(null); setMorph(null); }, [resetToken]);
  useEffect(() => { onChapter(scope.chapterId ?? null); }, [scope.chapterId, onChapter]);
  useEffect(() => () => { if (singleClick.current) clearTimeout(singleClick.current); }, []);
  useEffect(() => {
    if (!morph) return;
    const timeout = setTimeout(() => setMorph(null), reducedMotion ? 0 : ORBITAL_TRANSITION_MS + 50);
    return () => clearTimeout(timeout);
  }, [morph, reducedMotion]);
  useEffect(() => {
    const record = inspectedRecord ?? level.main[0]?.node ?? level.nebula[0];
    onSelect(record ? { node: record, nodes: draws.map((draw) => draw.node), edges: inspectedRecord ? edges : [], lookupNodes: level.sourceNodes, contents: orbitalContents(record, level), inspect: !!inspectedRecord } : null);
  }, [inspectedRecord, draws, edges, level.sourceNodes, onSelect]);

  const snapshot = () => new Map(draws.map((draw): [string, OrbitalPose] => [draw.node.id, { position: bus.positions.get(draw.node.id) ?? draw.position, radius: draw.radius }]));
  const focus = useCallback((draw: OrbitalDraw) => {
    const center = bus.positions.get(draw.node.id) ?? draw.position;
    framePositions(graphRef, [center], 1.2, !reducedMotion, { focusRadius: draw.radius });
  }, [bus, reducedMotion]);
  const [pendingFocus, setPendingFocus] = useState<OrbitalDraw | null>(null);
  useLayoutEffect(() => {
    if (!pendingFocus) return;
    focus(pendingFocus);
    setPendingFocus(null);
  }, [pendingFocus, focus]);
  const inspect = (draw: OrbitalDraw) => {
    if (singleClick.current) clearTimeout(singleClick.current);
    singleClick.current = setTimeout(() => {
      setSelectedId(draw.node.id);
      onSelect({ node: draw.node, nodes: draws.map((entry) => entry.node), edges: nestedEntityConnections(level, baseDraws, draw.node.id).edges, lookupNodes: level.sourceNodes, contents: orbitalContents(draw.node, level) });
      setPendingFocus(draw);
    }, 260);
  };
  useEffect(() => {
    if (!focusRequest || lastFocus.current === focusRequest.sequence) return;
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
      onSelect({ node: draw.node, nodes: draws.map((entry) => entry.node), edges: nestedEntityConnections(level, baseDraws, draw.node.id).edges, lookupNodes: level.sourceNodes, contents: orbitalContents(draw.node, level) });
      setPendingFocus(draw);
    }
    else if (focusRequest.node.parent && world.interiors[focusRequest.node.parent] && scope.chapterId !== focusRequest.node.parent) {
      const chapterId = focusRequest.node.parent;
      setPath([volumeScope, { key: `orbital:chapter:${chapterId}`, kind: "chapter", chapterId, label: world.laneNodes.find((node) => node.id === chapterId)?.label ?? "Chapter" }]);
      setSelectedId(null); setRevealedId(null);
    } else {
      lastFocus.current = focusRequest.sequence;
      setSelectedId(focusRequest.node.id);
      onSelect({ node: focusRequest.node, nodes: draws.map((entry) => entry.node), edges: level.sourceEdges.filter((edge) => edge.from === focusRequest.node.id || edge.to === focusRequest.node.id), lookupNodes: level.sourceNodes, contents: orbitalContents(focusRequest.node, level) });
      const container = layout.draws.find((entry) => entry.entry?.members.includes(focusRequest.node.id));
      if (container) setPendingFocus(container);
    }
  }, [focusRequest, draws, focus, world, scope.chapterId, level, layout.draws, onSelect]);
  const enter = (draw: OrbitalDraw) => {
    if (draw.role !== "preview" || !parent?.entry?.scope || morph) return;
    if (singleClick.current) clearTimeout(singleClick.current);
    graphRef.current?.getControls?.()?.stop();
    setMorph({ startedAt: performance.now(), from: snapshot() });
    setPath((current) => [...current, parent.entry!.scope!]);
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
  const reveal = useCallback((id: string | null) => setRevealedId((current) => current === id ? current : id), []);
  const allPositions = layout.draws.map((draw) => bus.positions.get(draw.node.id) ?? draw.position);
  const zoomBy = (delta: number) => document.querySelector(".orbital-stage")?.dispatchEvent(new CustomEvent("orbital-zoom", { detail: { delta } }));
  return <div className="orbital-explorer">
    <nav className="scene-sequence orbital-navigation" aria-label="Orbital levels">
      <div className="orbital-navigation-top"><button onClick={back} disabled={path.length <= 1 || !!morph} aria-label="Back one orbital level">← Back</button><span className="orbital-level">{String(path.length).padStart(2, "0")} / {scope.kind === "scene" ? "SCENE · CONVERSATIONS" : scope.kind.toUpperCase()}</span><button onClick={() => zoomBy(-80)} aria-label="Zoom in" title="Zoom in (+); Shift + scroll for fine control">＋</button><button onClick={() => zoomBy(80)} aria-label="Zoom out" title="Zoom out (−)">−</button><button onClick={() => framePositions(graphRef, allPositions, 1.2, !reducedMotion)}>Frame view ⌖</button><button aria-pressed={showRelations} onClick={onRelations}>Connections {showRelations ? "on" : "off"}</button></div>
      <div className="orbital-breadcrumb" title={path.map((entry) => entry.label).join(" / ")}>{path.map((entry, index) => <span key={`${index}:${entry.key}`}>{index ? " / " : ""}{entry.label}</span>)}</div>
      <div className="orbital-help"><span>Click to inspect · zoom to reveal · double-click a revealed sphere to enter</span><span className="orbital-count" role="status">{level.main.length} main · {nebula.length}/{surrounding.eligible} surrounding · {preview.draws.length} revealed · {edges.length} links</span></div>
    </nav>
    <div className="stage orbital-stage" tabIndex={0} aria-label="Orbital timeline. Scroll or pinch to zoom; Shift scroll for fine control; plus and minus zoom. Select a sphere to inspect; Shift Enter on a revealed sphere enters its level. Escape returns one level." onKeyDown={(event) => {
      if (event.target !== event.currentTarget) return;
      if (event.key === "Escape") { event.preventDefault(); back(); }
      if (!event.metaKey && !event.ctrlKey && ["+", "=", "-", "_"].includes(event.key)) { event.preventDefault(); zoomBy(event.key === "+" || event.key === "=" ? -80 : 80); }
      if (event.key === "Enter" && selected) { event.preventDefault(); if (event.shiftKey) enter(selected); else inspect(selected); }
    }}>
      <div className="graph-canvas"><OrbitalGraph ref={graphRef} draws={draws} paths={paths} edges={showRelations ? edges : []} bus={bus} selectedId={selectedId} revealedId={revealedId} levelKey={scope.key} reducedMotion={reducedMotion} morph={morph} onSelect={inspect} onEnter={enter} onReveal={reveal} onBack={back} /></div>
      <div className="labels-layer orbital-labels">{draws.map((draw) => <button key={draw.node.id} className={`node-label orbital-label role-${draw.role} k-${draw.node.kind} s-${draw.node.state}${selectedId === draw.node.id ? " is-selected" : ""}`} style={{ visibility: "hidden" }} aria-label={`Inspect ${draw.role === "preview" ? "revealed " : ""}${draw.node.kind} ${draw.node.label}`} aria-pressed={selectedId === draw.node.id} title={draw.role === "preview" ? "Double-click or Shift Enter to enter this revealed level" : draw.entry?.scope ? "Click to inspect and zoom. Zoom reveals the next timeline inside." : "Click to inspect"} ref={(element) => { if (element) bus.targets.set(draw.node.id, element); else bus.targets.delete(draw.node.id); }} onClick={() => inspect(draw)} onDoubleClick={() => enter(draw)} onKeyDown={(event) => { if (event.key === "Enter" && event.shiftKey) { event.preventDefault(); enter(draw); } }}>
        <span className="node-code">{draw.role === "preview" ? "REVEALED / " : ""}{draw.node.kind.toUpperCase()}{draw.node.state !== "canon" ? ` · ${draw.node.state}` : ""}</span><b>{draw.node.label}</b>{draw.node.cluster && <span>{draw.node.cluster.ids.length} records · orbital group</span>}
      </button>)}</div>
      <div className="orbital-time-key" aria-hidden="true"><i />TIME → <span>Blue arrows follow narrative order</span></div>
      {morph && <div className="orbital-transition-status" role="status">Uncoiling into the local timeline…</div>}
    </div>
    <div className="scene-legend"><span><i className="canon" />Canon</span><span><i className="proposed" />Proposed</span><span><i className="held" />Held</span><span>Spheres / weighted nebula</span><button aria-pressed={reducedMotion} onClick={onMotion}>{reducedMotion ? "Motion reduced" : "Motion on"}</button></div>
  </div>;
}
