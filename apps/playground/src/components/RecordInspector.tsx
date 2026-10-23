import { useEffect, useState } from "react";
import { KIND_LABEL, recordStatus } from "../archive";
import type { WorldEdge, WorldNode } from "../types";

interface Props {
  selected: WorldNode | undefined;
  nodes: WorldNode[];
  lookupNodes?: WorldNode[];
  edges: WorldEdge[];
  childCount: number;
  canOpen: boolean;
  onSelect: (node: WorldNode) => void;
  orbital?: boolean;
  contents?: WorldNode[];
  sourceEndpoint?: string;
}

function OriginalSource({ node, endpoint }: { node: WorldNode; endpoint?: string }) {
  const [source, setSource] = useState<{ id: string; text?: string; complete?: boolean; contiguous?: boolean; message?: string } | null>(null);
  const sourceKey = `${endpoint ?? ""}:${node.id}`;
  useEffect(() => {
    if (!endpoint) return;
    const controller = new AbortController();
    const url = `${endpoint}${endpoint.includes("?") ? "&" : "?"}id=${encodeURIComponent(node.id)}`;
    fetch(url, { signal: controller.signal, cache: "no-store" }).then(async (response) => {
      if (!response.ok) throw new Error("Original source is unavailable in this viewer.");
      const result = await response.json();
      setSource({ ...result, id: sourceKey });
    }).catch(() => { if (!controller.signal.aborted) setSource({ id: sourceKey, message: "Original source is unavailable in this viewer." }); });
    return () => controller.abort();
  }, [node.id, endpoint, sourceKey]);
  const current = source?.id === sourceKey ? source : null;
  return <section className="original-source" aria-label="Original source text"><h3>{node.dialogue ? "Original dialogue exchange" : "Original segment"}</h3>{!endpoint ? <p className="empty-state">Open the Mac-local source viewer to read the original text.</p> : !current ? <p role="status">Loading original text…</p> : current.text ? <><p className="original-source-text">{current.text}</p>{current.contiguous === false && <p className="empty-state">Separate stored source spans are shown in their original order.</p>}{!current.complete && <p className="empty-state">Some stored source references are unavailable; this is not the complete segment.</p>}</> : <p className="empty-state">{current.message ?? "No original source span is available for this record."}</p>}</section>;
}

export function RecordInspector({ selected, nodes, lookupNodes = nodes, edges, childCount, canOpen, onSelect, orbital = false, contents = [], sourceEndpoint }: Props) {
  if (!selected) return <p className="empty-state">No records in this view.</p>;
  const connections = edges.filter((edge) => edge.from === selected.id || edge.to === selected.id);
  return (
    <div className="record-inspector">
      <div className="record-eyebrow"><span>{KIND_LABEL[selected.kind]}</span><span>#{String(nodes.findIndex((node) => node.id === selected.id) + 1).padStart(2, "0")}</span></div>
      <h2>{selected.label}</h2>
      <span className={`record-status status-${selected.state}`}><i />{selected.cluster ? "View-only group · not an ontology record" : recordStatus(selected)}</span>
      <section className="record-summary" aria-label="Recorded summary">
        <h3>{selected.kind === "scene" ? "Scene · recorded event summary" : "Recorded summary"}</h3>
        {selected.cluster && selected.summary && <p>{selected.summary}</p>}
        {selected.dialogue && <p className="dialogue-turn-heading">{selected.dialogue.cardId ? `Exchange · ${selected.dialogue.participantLabels?.join(" / ") || "Participants unresolved"}` : `Legacy turn ${(selected.dialogue.turn ?? 0) + 1} · ${selected.dialogue.speakerLabel ?? "Speaker unresolved"}`}</p>}
        {selected.dialogue?.text && <p className="dialogue-turn-text">{selected.dialogue.text}</p>}
        {selected.cluster ? <p>{selected.cluster.ids.length} {selected.cluster.kind} · {selected.cluster.recordCount} represented records. {orbital ? "Zoom to reveal its orbital timeline; double-click a revealed sphere to enter." : <button onClick={() => onSelect(selected)}>Expand group →</button>}</p> : !selected.dialogue?.text && (selected.summary ? <p>{selected.summary}</p> : selected.kind === "dialogue" && !selected.dialogue ? <p>{selected.label}</p> : <p className="empty-state">No stored summary for this record.</p>)}
        {!!selected.relatedSummaries?.length && <ul>{selected.relatedSummaries.filter((entry) => entry.text !== selected.summary).map((entry) => <li key={entry.id}><button onClick={() => { const event = lookupNodes.find((node) => node.id === entry.id); if (event) onSelect(event); }}>{entry.text}</button></li>)}</ul>}
      </section>
      {!selected.cluster && (selected.kind === "scene" || selected.kind === "event" || selected.kind === "dialogue") && <OriginalSource node={selected} endpoint={sourceEndpoint} />}
      {!!contents.length && <section className="chronological-contents" aria-label="Contents in chronological order"><h3>Inside · earlier → later</h3><ol>{contents.map((node, index) => <li key={node.id}><button onClick={() => onSelect(node)}><small>{String(index + 1).padStart(2, "0")} / {KIND_LABEL[node.kind]}</small><span>{node.summary ?? node.label}</span></button></li>)}</ol></section>}
      <dl className="record-facts">
        <div><dt>Record ID</dt><dd>{selected.id}</dd></div>
        <div><dt>Timeline</dt><dd>{selected.lane === "canon" ? "01 / Canon" : "02 / Branch"}</dd></div>
        <div><dt>Sequence</dt><dd>{String(selected.chrono).padStart(2, "0")}</dd></div>
        <div><dt>Connections</dt><dd>{connections.length}</dd></div>
      </dl>
      {canOpen ? <p className="interior-summary">{childCount} interior records · {orbital ? "zoom to reveal; double-click a revealed sphere to enter" : "click the file to enter ↗"}</p> : !orbital && selected.kind === "bigEvent" && <p className="empty-state">No interior records in this sample.</p>}
      <div className="index-heading"><h3>Records in this view</h3><span>{nodes.length}</span></div>
      <ol className="record-index" aria-label="Archive records">
        {nodes.map((node, index) => (
          <li key={node.id}>
            <button className={node.id === selected.id ? "selected" : ""} aria-pressed={node.id === selected.id} onClick={() => onSelect(node)}>
              <span className="record-number">{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{node.label}</strong><small>{KIND_LABEL[node.kind]} / {node.state !== "canon" ? node.state : node.lane}</small></span>
              <span aria-hidden="true">{node.id === selected.id ? "↗" : "·"}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
