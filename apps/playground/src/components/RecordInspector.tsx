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
}

export function RecordInspector({ selected, nodes, lookupNodes = nodes, edges, childCount, canOpen, onSelect, orbital = false }: Props) {
  if (!selected) return <p className="empty-state">No records in this view.</p>;
  const connections = edges.filter((edge) => edge.from === selected.id || edge.to === selected.id);
  return (
    <div className="record-inspector">
      <div className="record-eyebrow"><span>{KIND_LABEL[selected.kind]}</span><span>#{String(nodes.indexOf(selected) + 1).padStart(2, "0")}</span></div>
      <h2>{selected.label}</h2>
      <span className={`record-status status-${selected.state}`}><i />{selected.cluster ? "View-only group · not an ontology record" : recordStatus(selected)}</span>
      <section className="record-summary" aria-label="Recorded summary">
        <h3>{selected.kind === "scene" ? "Scene · recorded event summary" : "Recorded summary"}</h3>
        {selected.cluster && selected.summary && <p>{selected.summary}</p>}
        {selected.dialogue && <p className="dialogue-turn-heading">Turn {selected.dialogue.turn + 1} · {selected.dialogue.speakerLabel ?? "Speaker unresolved"}</p>}
        {selected.dialogue?.text ? <p className="dialogue-turn-text">{selected.dialogue.text}</p> : selected.dialogue && <p className="empty-state">Original turn text is not stored in this projection. Any summary below is not a transcript.</p>}
        {selected.cluster ? <p>{selected.cluster.ids.length} {selected.cluster.kind} · {selected.cluster.recordCount} represented records. {orbital ? "Zoom to reveal its orbital timeline; double-click a revealed sphere to enter." : <button onClick={() => onSelect(selected)}>Expand group →</button>}</p> : !selected.dialogue?.text && (selected.summary ? <p>{selected.summary}</p> : selected.kind === "dialogue" && !selected.dialogue ? <p>{selected.label}</p> : <p className="empty-state">No stored summary for this record.</p>)}
        {!!selected.relatedSummaries?.length && <ul>{selected.relatedSummaries.filter((entry) => entry.text !== selected.summary).map((entry) => <li key={entry.id}><button onClick={() => { const event = lookupNodes.find((node) => node.id === entry.id); if (event) onSelect(event); }}>{entry.text}</button></li>)}</ul>}
      </section>
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
