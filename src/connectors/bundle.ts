import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import { join } from "node:path";
import type { OntologyStore } from "../ontology/store.js";
import { foldStateAt } from "../ontology/state.js";
import type {
  Branch,
  CharacterStateAtPoint,
  Entity,
  OntEvent,
  Relation,
  Scene,
  StateChange,
} from "../ontology/types.js";

export interface BundleManifest {
  novelId: string;
  title: string;
  schemaVersion: number;
  sourceLanguages: string[];
  embeddingModel: string | null;
  embeddingDimension: number | null;
  decisionModel: string; // pinned Jev version
  blocksProcessed: number;
}

/**
 * The portable ontology bundle: plain JSONL files in a per-novel folder.
 * This is the source of truth — shareable by copying the folder, diffable
 * in git, and the input from which the Ladybug hot store is rebuilt.
 *
 *   novels/<novel-id>/
 *     source/            the novel file the user dropped in (unchanged)
 *     ontology/
 *       manifest.json
 *       entities.jsonl  relations.jsonl  events.jsonl
 *       scenes.jsonl    timelines.jsonl  branches.jsonl
 *       state-changes.jsonl  (state deltas; character state is their fold)
 *       graph.lbug      rebuilt from the bundle — disposable
 *     branches/<branch-id>/   delta events + fork-point state snapshot
 *
 * In-memory maps here are a skeleton; large novels stream via appendFile.
 */
export class BundleStore implements OntologyStore {
  private entities = new Map<string, Entity>();
  private events = new Map<string, OntEvent>();
  private scenes = new Map<string, Scene>();
  private relations: Relation[] = [];
  private branches = new Map<string, Branch>();
  private stateChanges: StateChange[] = [];

  constructor(private ontologyDir: string) {}

  async init(manifest: BundleManifest): Promise<void> {
    await mkdir(this.ontologyDir, { recursive: true });
    await writeFile(
      join(this.ontologyDir, "manifest.json"),
      JSON.stringify(manifest, null, 2),
    );
  }

  private async append(file: string, record: unknown): Promise<void> {
    await appendFile(join(this.ontologyDir, file), JSON.stringify(record) + "\n");
  }

  async upsertEntity(entity: Entity): Promise<void> {
    this.entities.set(entity.id, entity);
    await this.append("entities.jsonl", entity);
  }
  async upsertEvent(event: OntEvent): Promise<void> {
    this.events.set(event.id, event);
    await this.append("events.jsonl", event);
  }
  async upsertScene(scene: Scene): Promise<void> {
    this.scenes.set(scene.id, scene);
    await this.append("scenes.jsonl", scene);
  }
  async addRelation(relation: Relation): Promise<void> {
    this.relations.push(relation);
    await this.append("relations.jsonl", relation);
  }
  async createBranch(branch: Branch): Promise<void> {
    this.branches.set(branch.id, branch);
    await this.append("branches.jsonl", branch);
  }
  async addStateChange(change: StateChange): Promise<void> {
    // Append-log semantics with last-write-wins by id, like every
    // other bundle file: a re-applied delta replaces, never doubles.
    this.stateChanges = this.stateChanges.filter((c) => c.id !== change.id);
    this.stateChanges.push(change);
    await this.append("state-changes.jsonl", change);
  }
  async addAlias(entityId: string, aliasText: string): Promise<boolean> {
    // Disk-true: the apply path runs on a fresh store instance, so the
    // entity is resolved from the bundle file (fold by id), not from
    // the in-memory map.
    const rows = await this.loadFile<Entity>("entities.jsonl");
    const byId = new Map<string, Entity>();
    for (const e of rows) byId.set(e.id, e);
    const entity = byId.get(entityId) ?? this.entities.get(entityId);
    if (!entity) return false;
    if (entity.names.some((n) => n.text === aliasText)) {
      this.entities.set(entity.id, entity);
      return true;
    }
    await this.upsertEntity({
      ...entity,
      names: [
        ...entity.names,
        { text: aliasText, lang: entity.names[0]?.lang ?? "und", kind: "alias" },
      ],
    });
    return true;
  }

  async getEntity(id: string): Promise<Entity | null> {
    return this.entities.get(id) ?? null;
  }
  async findByName(text: string): Promise<Entity[]> {
    const hits: Entity[] = [];
    for (const e of this.entities.values()) {
      if (e.names.some((n) => n.text === text || text.includes(n.text))) hits.push(e);
    }
    return hits;
  }
  async traverse(): Promise<Entity[]> {
    throw new Error("BundleStore is the write/sync layer; traverse via LadybugStore.");
  }
  async searchText(): Promise<Entity[]> {
    throw new Error("Use LadybugStore FTS index for text search.");
  }
  async searchVector(): Promise<Entity[]> {
    throw new Error("Use LadybugStore vector index for similarity search.");
  }
  async getStateAt(characterId: string, eventId: string): Promise<CharacterStateAtPoint | null> {
    // Fold-on-read over the bundle (decision #10: state = fold, never
    // a row). Events fold by id (last write wins); deltas fold by id
    // the same way, then replay chronologically — see ontology/state.
    const eventRows = await this.loadFile<OntEvent>("events.jsonl");
    const eventsById = new Map<string, OntEvent>();
    for (const e of eventRows) eventsById.set(e.id, e);
    for (const e of this.events.values()) eventsById.set(e.id, e);
    const deltaRows = await this.loadFile<StateChange>("state-changes.jsonl");
    const deltasById = new Map<string, StateChange>();
    for (const d of deltaRows) deltasById.set(d.id, d);
    for (const d of this.stateChanges) deltasById.set(d.id, d);
    return foldStateAt(characterId, eventId, [...eventsById.values()], [...deltasById.values()]);
  }
  async listEvents(timelineId: string, minImportance: number): Promise<OntEvent[]> {
    return [...this.events.values()].filter(
      (e) => e.timelineId === timelineId && e.importance >= minImportance,
    );
  }

  /** Read a JSONL file back into memory (used by `novel graph build`). */
  async loadFile<T>(file: string): Promise<T[]> {
    let raw: string;
    try {
      raw = await readFile(join(this.ontologyDir, file), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    const records: T[] = [];
    const lines = raw.split("\n");
    for (let i = 0; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      try {
        records.push(JSON.parse(lines[i]) as T);
      } catch (err) {
        throw new Error(`corrupt JSONL in ${file} line ${i + 1}: ${String(err)}`);
      }
    }
    return records;
  }
}
