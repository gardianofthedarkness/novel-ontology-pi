import type {
  Branch,
  CharacterStateAtPoint,
  Entity,
  OntEvent,
  Relation,
  Scene,
  StateChange,
} from "./types.js";

/**
 * The ONLY doorway to the ontology main graph.
 *
 * The Pi agent never touches the DB directly, and the System 1 miniloop
 * NEVER writes through this interface — the miniloop accumulates proposals
 * into a ChangeSet, and only an approved merge applies them here
 * (see src/merge/changeset.ts and DESIGN.md §Merge gate).
 *
 * Implementations: BundleStore (JSONL, the portable source of truth) and
 * LadybugStore (hot query engine rebuilt from the bundle). Keeping every
 * read/write behind this interface is what lets the engine be swapped.
 */
export interface OntologyStore {
  // --- writes: called ONLY by an approved merge ---
  upsertEntity(entity: Entity): Promise<void>;
  upsertEvent(event: OntEvent): Promise<void>;
  upsertScene(scene: Scene): Promise<void>;
  addRelation(relation: Relation): Promise<void>;
  createBranch(branch: Branch): Promise<void>;
  /** Persist one state delta (state materialization v1). Deltas are records; state is their fold. */
  addStateChange(change: StateChange): Promise<void>;
  /**
   * Materialize an alias name form onto an entity. Returns false when
   * the entity does not exist (the proposal cannot be applied).
   * Idempotent: an already-present form is a successful no-op.
   */
  addAlias(entityId: string, aliasText: string): Promise<boolean>;

  // --- reads ---
  getEntity(id: string): Promise<Entity | null>;
  /** Deterministic alias scan used by the name-detector patch. */
  findByName(text: string): Promise<Entity[]>;
  traverse(fromId: string, relation: string, depth: number): Promise<Entity[]>;
  searchText(query: string, limit: number): Promise<Entity[]>;
  searchVector(embedding: number[], limit: number): Promise<Entity[]>;
  getStateAt(characterId: string, eventId: string): Promise<CharacterStateAtPoint | null>;
  listEvents(timelineId: string, minImportance: number): Promise<OntEvent[]>;
}
