import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { GraphCanvasRef } from "reagraph";
import { ActivityTab, DecisionFeed, GateQueue, type FeedEntry } from "./components/panels";
import { PipelineStrip } from "./components/PipelineStrip";
import { WorldGraph } from "./components/WorldGraph";
import { BIG_EVENT_LABELS, INTERIORS, LANE_EDGES, LANE_NODES } from "./data/demoWorld";
import { DemoEventSource } from "./events/demoSource";
import type {
  ChangeSet,
  PlaygroundEvent,
  ViewState,
  WorldEdge,
  WorldNode,
} from "./types";

const KNIT_SITE = "be_found"; // the branch big event System 1 is knitting in this session
let feedSeq = 0;

export default function App() {
  const [view, setView] = useState<ViewState>({ mode: "lanes" });
  const [layout, setLayout] = useState<"locked" | "force">("locked");
  const [dynNodes, setDynNodes] = useState<WorldNode[]>([]);
  const [dynEdges, setDynEdges] = useState<WorldEdge[]>([]);
  const [feed, setFeed] = useState<FeedEntry[]>([]);
  const [stage, setStage] = useState(0);
  const [changesets, setChangesets] = useState<ChangeSet[]>([]);
  const [heldMap, setHeldMap] = useState<Record<string, string[]>>({});
  const [activity, setActivity] = useState({ count: 0, shine: false, caughtUp: false });
  const [blockLabel, setBlockLabel] = useState<string | null>(null);
  const sourceRef = useRef<DemoEventSource | null>(null);
  const graphRef = useRef<GraphCanvasRef>(null);
  const viewRef = useRef(view);
  viewRef.current = view;

  const pushFeed = useCallback((text: string, tone: FeedEntry["tone"] = "plain") => {
    setFeed((f) => [...f.slice(-40), { id: ++feedSeq, text, tone }]);
  }, []);

  /** Activity shines when something happens where the user is NOT looking. */
  const noteActivity = useCallback(
    (alwaysShine: boolean) => {
      const v = viewRef.current;
      const atSite = v.mode === "interior" && v.bigEventId === KNIT_SITE;
      if (atSite && !alwaysShine) return;
      setActivity((a) => ({ count: a.count + 1, shine: true, caughtUp: false }));
    },
    [],
  );

  const handleEvent = useCallback(
    (ev: PlaygroundEvent) => {
      switch (ev.type) {
        case "block.started":
          setBlockLabel(ev.label);
          setStage(0);
          pushFeed(`▸ ${ev.label} entered the pipeline`);
          break;
        case "sectioned":
          setStage(1);
          pushFeed(`▸ sectioned — ${ev.sentences} sentences`);
          break;
        case "verdict":
          pushFeed(ev.text, "jev");
          break;
        case "proposal.added":
          setDynNodes((ns) => [...ns, ev.node]);
          setDynEdges((es) => [...es, ...ev.edges]);
          pushFeed(`◌ proposal — ${ev.node.label} (ghost, branch)`, "warn");
          noteActivity(false);
          break;
        case "changeset.pending": {
          setStage(4);
          setChangesets((cs) => [
            ...cs,
            {
              id: ev.changesetId,
              label: ev.label,
              status: "pending",
              nodeIds: DEMO_NODE_IDS,
            },
          ]);
          pushFeed(`⚖ ${ev.label} reached the GATE`, "warn");
          noteActivity(true); // gate arrivals always shine
          break;
        }
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
          pushFeed("⧗ main agent HELD 1 proposal — 事件·提前归还 (uncertain)", "warn");
          noteActivity(true); // escalations shine immediately
          break;
        }
        case "changeset.merged":
          pushFeed(`✓ ${ev.changesetId} merged — graph rebuilt`, "ok");
          break;
        case "graph.rebuilt":
          pushFeed("✓ graph rebuilt from bundle", "ok");
          break;
      }
    },
    [noteActivity, pushFeed],
  );

  const startSession = useCallback(() => {
    sourceRef.current?.stop();
    setDynNodes([]);
    setDynEdges([]);
    setFeed([]);
    setChangesets([]);
    setHeldMap({});
    setActivity({ count: 0, shine: false, caughtUp: false });
    setStage(0);
    const src = new DemoEventSource();
    src.subscribe(handleEvent);
    sourceRef.current = src;
    src.start();
  }, [handleEvent]);

  useEffect(() => {
    startSession();
    return () => sourceRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const approve = useCallback(
    (changesetId: string) => {
      const held = heldMap[changesetId] ?? [];
      setDynNodes((ns) =>
        ns.map((n) =>
          DEMO_NODE_IDS.includes(n.id) && !held.includes(n.id)
            ? { ...n, state: "canon" }
            : n,
        ),
      );
      setDynEdges((es) =>
        es.map((e) =>
          !held.includes(e.from) && !held.includes(e.to) ? { ...e, state: "canon" } : e,
        ),
      );
      setChangesets((cs) =>
        cs.map((c) => (c.id === changesetId ? { ...c, status: "merged" } : c)),
      );
      handleEvent({ type: "changeset.merged", changesetId });
      setActivity({ count: 0, shine: false, caughtUp: true });
    },
    [handleEvent, heldMap],
  );

  /** Guided flight: wherever the user is, take the camera to the knitting site. */
  const flyToSite = useCallback(() => {
    setView({ mode: "interior", bigEventId: KNIT_SITE });
    setActivity((a) => ({ ...a, count: 0, shine: false }));
    setTimeout(() => {
      graphRef.current?.fitNodesInView?.([...DEMO_NODE_IDS, "b_ev_ask"], {
        animated: true,
      } as never);
    }, 350);
  }, []);

  const onNodeClick = useCallback((node: WorldNode) => {
    if (node.kind === "bigEvent" && INTERIORS[node.id]) {
      setView({ mode: "interior", bigEventId: node.id });
      if (node.id === KNIT_SITE) {
        setActivity((a) => ({ ...a, count: 0, shine: false }));
      }
    }
  }, []);

  const { nodes, edges } = useMemo(() => {
    if (view.mode === "lanes") {
      return { nodes: [...LANE_NODES, ...dynNodes], edges: [...LANE_EDGES, ...dynEdges] };
    }
    const interior = INTERIORS[view.bigEventId];
    const mine = dynNodes.filter((n) => n.parent === view.bigEventId);
    const myEdges = dynEdges.filter((e) => e.parent === view.bigEventId);
    return {
      nodes: [...(interior?.nodes ?? []), ...mine],
      edges: [...(interior?.edges ?? []), ...myEdges],
    };
  }, [view, dynNodes, dynEdges]);

  const labels = useMemo(() => {
    const map: Record<string, string> = { ...BIG_EVENT_LABELS };
    for (const n of [...LANE_NODES, ...dynNodes]) map[n.id] = n.label;
    for (const group of Object.values(INTERIORS)) {
      for (const n of group.nodes) map[n.id] = n.label;
    }
    return map;
  }, [dynNodes]);

  const crumb =
    view.mode === "lanes"
      ? "timeline · chapter range — canon + branch lanes"
      : `timeline › ${BIG_EVENT_LABELS[view.bigEventId]} › 3D interior`;

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          novel-ontology-pi <span>playground · sector 13</span>
        </div>
        <div className="crumb">{crumb}</div>
        <div className="top-actions">
          {view.mode === "interior" && (
            <button onClick={() => setView({ mode: "lanes" })}>← back to lanes</button>
          )}
          <button onClick={() => setLayout(layout === "locked" ? "force" : "locked")}>
            layout: {layout === "locked" ? "chronological" : "force 3D"}
          </button>
          <button onClick={startSession}>↻ replay session</button>
        </div>
      </header>
      <PipelineStrip stage={stage} />
      <div className="main">
        <aside className="rail">
          {blockLabel && <div className="block-chip">▣ {blockLabel}</div>}
          <DecisionFeed entries={feed} />
          <GateQueue
            changesets={changesets}
            heldMap={heldMap}
            labels={labels}
            onApprove={approve}
          />
          <div className="panel legend">
            <h4>Legend</h4>
            <p>
              <i style={{ background: "#2dd4bf" }} /> event / flow ·{" "}
              <i style={{ background: "#a78bfa" }} /> character / branch ·{" "}
              <i style={{ background: "#7dd3fc" }} /> location ·{" "}
              <i style={{ background: "#fbbf24" }} /> dialogue
            </p>
            <p>
              <i style={{ background: "#d97706" }} /> proposed ghost ·{" "}
              <i style={{ background: "#64748b" }} /> held by the gate
            </p>
            <p className="dim">
              One graph, many cameras: the agent knits in the branch lane while
              you browse canon. The activity tab shines instead of interrupting.
            </p>
          </div>
        </aside>
        <section className="stage">
          <WorldGraph
            ref={graphRef}
            nodes={nodes}
            edges={edges}
            interior={view.mode === "interior"}
            layout={layout}
            onNodeClick={onNodeClick}
          />
          <ActivityTab
            count={activity.count}
            shine={activity.shine}
            caughtUp={activity.caughtUp}
            onClick={flyToSite}
          />
          {view.mode === "lanes" && (
            <div className="stage-hint">
              click a big event (归还终端 or 寻回） to dive into its 3D interior
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

const DEMO_NODE_IDS = ["p_clerk", "p_dlg_ask", "p_ev_early"];
