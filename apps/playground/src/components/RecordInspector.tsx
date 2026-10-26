import { useEffect, useState } from "react";
import { KIND_LABEL, recordStatus } from "../archive";
import type { CausalLink, WorldEdge, WorldNode } from "../types";

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
  causalLinks?: CausalLink[];
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

function CausalLinks({ selected, links, lookupNodes, onSelect }: { selected: WorldNode; links: CausalLink[]; lookupNodes: WorldNode[]; onSelect: (node: WorldNode) => void }) {
  const causes = links.filter((link) => link.to === selected.id);
  const effects = links.filter((link) => link.from === selected.id);
  if (!causes.length && !effects.length) return null;
  const item = (link: CausalLink, otherId: string, chapter: string) => {
    const other = lookupNodes.find((node) => node.id === otherId);
    const status = link.state === "canon" ? "" : ` · ${link.state}`;
    return <li key={link.id}>{other ? <button onClick={() => onSelect(other)}><span>{other.summary ?? other.label}</span><small>{otherId}{status}</small></button> : <span>{otherId} · {chapter}{status}</span>}</li>;
  };
  return <section className="causal-links" aria-label="Stored causal relations">
    <h3>Causes / effects</h3>
    <p className="empty-state">Stored CAUSES relations, shown as recorded; not re-certified here.</p>
    {!!causes.length && <><h4>Caused by</h4><ul>{causes.map((link) => item(link, link.from, link.fromChapter))}</ul></>}
    {!!effects.length && <><h4>Leads to</h4><ul>{effects.map((link) => item(link, link.to, link.toChapter))}</ul></>}
  </section>;
}

export function RecordInspector({ selected, nodes, lookupNodes = nodes, edges, childCount, canOpen, onSelect, orbital = false, contents = [], sourceEndpoint, causalLinks = [] }: Props) {
  if (!selected) return <p className="empty-state">No records in this view.</p>;
  const connections = edges.filter((edge) => edge.from === selected.id || edge.to === selected.id);
  return (
    <div className="record-inspector">
      <div className="record-eyebrow"><span>{selected.library?.type ?? KIND_LABEL[selected.kind]}</span><span>#{String(nodes.findIndex((node) => node.id === selected.id) + 1).padStart(2, "0")}</span></div>
      <h2>{selected.label}</h2>
      <span className={`record-status status-${selected.state}`}><i />{selected.library ? `${selected.state === "canon" ? "Reviewed" : selected.state} organization · not an ontology fact` : selected.cluster ? "View-only group · not an ontology record" : recordStatus(selected)}</span>
      <section className="record-summary" aria-label="Recorded summary">
        <h3>{selected.kind === "scene" ? "Scene · recorded event summary" : "Recorded summary"}</h3>
        {selected.cluster && selected.summary && <p>{selected.summary}</p>}
        {selected.dialogue && <p className="dialogue-turn-heading">{selected.dialogue.cardId ? `Exchange · ${selected.dialogue.participantLabels?.join(" / ") || "Participants unresolved"}` : `Legacy turn ${(selected.dialogue.turn ?? 0) + 1} · ${selected.dialogue.speakerLabel ?? "Speaker unresolved"}`}</p>}
        {selected.dialogue?.text && <p className="dialogue-turn-text">{selected.dialogue.text}</p>}
        {selected.cluster ? <p>{selected.cluster.ids.length} {selected.cluster.kind} · {selected.cluster.recordCount} represented records. {orbital ? "Zoom to reveal its orbital timeline; double-click a revealed sphere to enter." : <button onClick={() => onSelect(selected)}>Expand group →</button>}</p> : !selected.dialogue?.text && (selected.summary ? <p>{selected.summary}</p> : selected.kind === "dialogue" && !selected.dialogue ? <p>{selected.label}</p> : <p className="empty-state">No stored summary for this record.</p>)}
        {!!selected.relatedSummaries?.length && <ul>{selected.relatedSummaries.filter((entry) => entry.text !== selected.summary).map((entry) => <li key={entry.id}><button onClick={() => { const event = lookupNodes.find((node) => node.id === entry.id); if (event) onSelect(event); }}>{entry.text}</button></li>)}</ul>}
      </section>
      {!selected.cluster && (selected.kind === "scene" || selected.kind === "event" || selected.kind === "dialogue") && <OriginalSource node={selected} endpoint={sourceEndpoint} />}
      {(selected.kind === "event" || selected.kind === "dialogue") && <CausalLinks selected={selected} links={causalLinks} lookupNodes={lookupNodes} onSelect={onSelect} />}
      {!!contents.length && <section className="chronological-contents" aria-label={selected.library ? "Files in reading order" : "Contents in chronological order"}><h3>{selected.library ? "Files · reading order / unknown placement" : "Inside · earlier → later"}</h3><ol>{contents.map((node, index) => <li key={node.id}><button onClick={() => onSelect(node)}><small>{String(index + 1).padStart(2, "0")} / {node.library?.type ?? KIND_LABEL[node.kind]}</small><span>{node.library ? node.label : node.summary ?? node.label}</span></button></li>)}</ol></section>}
      <dl className="record-facts">
        <div><dt>Record ID</dt><dd>{selected.id}</dd></div>
        <div><dt>{selected.library ? "Scope" : "Timeline"}</dt><dd>{selected.library ? "Library organization" : selected.lane === "canon" ? "01 / Canon" : "02 / Branch"}</dd></div>
        <div><dt>{selected.library ? "Reading position" : "Sequence"}</dt><dd>{selected.library ? selected.library.readingOrder ?? "Unknown / not applicable" : String(selected.chrono).padStart(2, "0")}</dd></div>
        <div><dt>Connections</dt><dd>{connections.length}</dd></div>
      </dl>
      {canOpen ? <p className="interior-summary">{childCount} interior records · {orbital ? "zoom to reveal; double-click a revealed sphere to enter" : "click the file to enter ↗"}</p> : !orbital && selected.kind === "bigEvent" && !contents.length && <p className="empty-state">No interior records in this sample.</p>}
      <div className="index-heading"><h3>Records in this view</h3><span>{nodes.length}</span></div>
      <ol className="record-index" aria-label="Archive records">
        {nodes.map((node, index) => (
          <li key={node.id}>
            <button className={node.id === selected.id ? "selected" : ""} aria-pressed={node.id === selected.id} onClick={() => onSelect(node)}>
              <span className="record-number">{String(index + 1).padStart(2, "0")}</span>
              <span><strong>{node.label}</strong><small>{node.library?.type ?? KIND_LABEL[node.kind]} / {node.state !== "canon" ? node.state : node.library ? "organization" : node.lane}</small></span>
              <span aria-hidden="true">{node.id === selected.id ? "↗" : "·"}</span>
            </button>
          </li>
        ))}
      </ol>
    </div>
  );
}
