/**
 * Playground domain types — sector 13.
 *
 * One graph is the source of truth; every view (timeline lanes, a big
 * event's 3D interior, the gate queue) is a camera over it. Live agent
 * activity arrives as PlaygroundEvents and renders IN PLACE — proposed
 * nodes are ghosts wherever they belong, never a separate screen.
 */

export type LaneId = "canon" | "branch";
export type NodeKind =
  | "bigEvent"
  | "character"
  | "location"
  | "scene"
  | "event"
  | "dialogue"
  /** An EPUB illustration: an independent node type between its neighboring scenes (album store projection, not canon). */
  | "picture"
  /** A bound EPUB portrait, drawn attached to its character (album store projection, not canon). */
  | "portrait";

/** canon = merged truth · proposed = ghost awaiting the gate · held = gate held it (visually distinct) */
export type CanonState = "canon" | "proposed" | "held";

export interface WorldNode {
  id: string;
  label: string;
  subLabel?: string;
  summary?: string;
  relatedSummaries?: { id: string; text: string }[];
  dialogue?: { cardId?: string; participantIds?: string[]; participantLabels?: string[]; turn?: number; speakerId?: string | null; speakerLabel?: string; text?: string };
  cluster?: {
    kind: "scenes" | "records";
    ids: string[];
    recordCount: number;
    proposed: number;
    held: number;
    focusSceneId?: string;
  };
  kind: NodeKind;
  /** Sentence identities covered by this node (scenes only, for now).
   * Emitted by the CLI view builder in future work; until then it is
   * optional, and picture placement stays unplaced by design when a
   * scene carries no coverage — pictures are never force-assigned. */
  sentenceIds?: string[];
  state: CanonState;
  /** Which big event's interior this node lives in (null = lane-level node). */
  parent: string | null;
  lane: LaneId;
  /** Rough chronological order key inside its view. */
  chrono: number;
  trackId?: string;
  trackLabel?: string;
  /** Position in the lanes view. */
  lanePos: [number, number, number];
  /** Position inside the parent big event's interior view. */
  interiorPos: [number, number, number];
}

export interface WorldEdge {
  id: string;
  from: string;
  to: string;
  kind: "flow" | "contains" | "speaks" | "cross";
  state: CanonState;
  parent: string | null;
  weight?: number;
  derived?: boolean;
  relationLabel?: string;
  /** Stored ontology relation type (e.g. CAUSES); absent for view edges. */
  relationType?: string;
}

/** One stored CAUSES relation between two events, with each endpoint's
 * chapter. Direction is cause → effect. Never inferred from chronology. */
export interface CausalLink { id: string; from: string; to: string; fromChapter: string; toChapter: string; state: CanonState }
export interface CausalSummary { links: CausalLink[]; unresolved: number; /** Dialogue-card id -> owning scene id, for projecting dialogue endpoints onto their scene's sphere. */ dialogueScenes?: Record<string, string> }

export interface ChangeSet {
  id: string;
  label: string;
  status: "pending" | "held" | "merged";
  nodeIds: string[];
}

export type ViewState =
  | { mode: "lanes" }
  | { mode: "interior"; bigEventId: string };

/** The event contract between the CLI and the playground (sector 13). */
export type PlaygroundEvent =
  | { type: "block.started"; blockId: string; label: string }
  | { type: "sectioned"; blockId: string; sentences: number }
  | { type: "verdict"; patch: string; text: string }
  | {
      type: "proposal.added";
      changesetId: string;
      node: WorldNode;
      edges: WorldEdge[];
    }
  | { type: "changeset.pending"; changesetId: string; label: string; nodeIds: string[] }
  | { type: "changeset.held"; changesetId: string; nodeIds: string[] }
  | { type: "changeset.merged"; changesetId: string }
  | { type: "entity.merged"; keepId: string; dropId: string }
  | { type: "entity.distinct"; aId: string; bId: string }
  | { type: "graph.rebuilt" }
  /** Album pre-process anchors for one block; the orbit resolves them to picture nodes at render. */
  | { type: "album.anchored"; blockId: string; pictures: { id: string; asset: string; kind: string; sentenceId: string | null }[] }
  /** Album portrait bindings for one block; the orbit draws each bound portrait attached to its character.
   * Portraits with no binding emit nothing and stay hidden by design. */
  | { type: "album.portraitBound"; blockId: string; portraits: AlbumPortrait[] };

/** A portrait bound to one character entity (album store, not canon). */
export interface AlbumPortrait {
  id: string;
  asset: string;
  entityId: string;
  entityLabel: string;
}

export interface EventSource {
  subscribe(handler: (event: PlaygroundEvent) => void): () => void;
  /** File sources load asynchronously; SSE sources connect synchronously. */
  start(): void | Promise<void>;
  stop(): void;
}
