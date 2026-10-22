import { useMemo } from "react";
import type { WorldNode } from "../types";
import type { StructureMode } from "../data/sceneHierarchy";

interface Props {
  nodes: WorldNode[];
  selectedId: string | null;
  onSelect: (node: WorldNode) => void;
  structure: StructureMode;
  onStructure: (mode: StructureMode) => void;
  expandedCount: number;
  scopeLabel?: string;
  shown: number;
  total: number;
  onBack: () => void;
  onReset: () => void;
}

export function ExplorerNavigation({ nodes, selectedId, onSelect, structure, onStructure, expandedCount, scopeLabel, shown, total, onBack, onReset }: Props) {
  const scenes = useMemo(() => nodes.filter((node) => node.kind === "scene").sort((first, second) => first.chrono - second.chrono || first.id.localeCompare(second.id)), [nodes]);
  if (!scenes.length) return null;
  const index = scenes.findIndex((node) => node.id === selectedId);
  const characterCount = nodes.filter((node) => node.kind === "character").length;
  return <nav className="scene-sequence explorer-navigation" aria-label="Scene explorer">
    <div className="explorer-structure">
      <div className="structure-switch" role="group" aria-label="Viewing structure">
        <button aria-pressed={structure === "chronology"} onClick={() => onStructure("chronology")}>Chronology →</button>
        <button aria-pressed={structure === "cloud"} onClick={() => onStructure("cloud")}>Relation cloud</button>
      </div>
      <span className="explorer-count" role="status" title={`${total} source records · all chapter characters stay visible`}>{shown} visible · {characterCount} characters</span>
    </div>
    <div className="explorer-path">
      <button onClick={onReset} disabled={!expandedCount}>Collapse all</button>
      {!!expandedCount && <><button aria-label="Collapse last expansion" onClick={onBack}>↶ Undo</button><span title={scopeLabel}>{expandedCount} open · {scopeLabel}</span></>}
      {!expandedCount && <span title="Twenty scene cards per expansion, plus every chapter character">{scenes.length} scenes · 20 scene slots + all characters</span>}
    </div>
    <div className="explorer-sequence">
      <span>Order →</span>
      <button disabled={index <= 0} aria-label="Previous scene" onClick={() => onSelect(scenes[index - 1])}>←</button>
      <select aria-label="Choose scene in chronological order" value={index < 0 ? "" : scenes[index].id} onChange={(event) => { const scene = scenes.find((node) => node.id === event.target.value); if (scene) onSelect(scene); }}>
        {index < 0 && <option value="">Jump to scene · {scenes.length} total</option>}
        {scenes.map((scene, position) => <option key={scene.id} value={scene.id}>{position + 1}. {scene.label}</option>)}
      </select>
      <button disabled={index >= scenes.length - 1} aria-label="Next scene" onClick={() => onSelect(scenes[index + 1])}>→</button>
    </div>
  </nav>;
}
