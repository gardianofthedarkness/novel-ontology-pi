import { Connection, Database } from "@ladybugdb/core";
import type { QueryResult } from "@ladybugdb/core";

/**
 * The reading's own graph (docs/v2/world-model.md §6): an in-memory Ladybug store built once the facts are settled, so the
 * recommenders and the context engine ask the reading by Cypher, as the world engine asks the workspace's graph once canon
 * is written (src/ground/ontology/retrieval.ts). It holds the entities (with a place's scale), the scenes in reading order,
 * which places each scene names (and whether in its environment), and the facts with what each is about. A store of
 * layer 5: it is read, never decides.
 */
export interface GraphInput {
  entities: { id: string; name: string; kind: string; scale?: string | null }[];
  scenes: { id: string; index: number }[];
  /** A scene names a place: how often, and whether its environment cards do. */
  names: { scene: string; place: string; count: number; environment: boolean }[];
  /** A fact: its place in reading order (`at`), the scene it is in, and what it is about. */
  facts: { id: string; at: number; scene: string | null; about: string[] }[];
}
type Row = Record<string, unknown>;

export class ReadingGraph {
  private constructor(private readonly db: Database, private readonly conn: Connection) {}

  static async build(input: GraphInput): Promise<ReadingGraph> {
    const db = new Database(":memory:"), graph = new ReadingGraph(db, new Connection(db));
    for (const ddl of [
      "CREATE NODE TABLE Entity(id STRING, name STRING, kind STRING, scale STRING, PRIMARY KEY(id))",
      "CREATE NODE TABLE Scene(id STRING, idx INT64, PRIMARY KEY(id))",
      "CREATE NODE TABLE Fact(id STRING, at INT64, PRIMARY KEY(id))",
      "CREATE REL TABLE NAMES(FROM Scene TO Entity, count INT64, environment BOOLEAN)",
      "CREATE REL TABLE ABOUT(FROM Fact TO Entity)",
      "CREATE REL TABLE IN_SCENE(FROM Fact TO Scene)",
    ]) await graph.run(ddl);
    const ids = new Set(input.entities.map((entity) => entity.id)), scenes = new Set(input.scenes.map((scene) => scene.id));
    for (const entity of input.entities) await graph.run("CREATE (:Entity {id: $id, name: $name, kind: $kind, scale: $scale})", { id: entity.id, name: entity.name, kind: entity.kind, scale: entity.scale ?? "" });
    for (const scene of input.scenes) await graph.run("CREATE (:Scene {id: $id, idx: $idx})", { id: scene.id, idx: scene.index });
    for (const entry of input.names) if (scenes.has(entry.scene) && ids.has(entry.place)) await graph.run("MATCH (s:Scene {id: $scene}), (p:Entity {id: $place}) CREATE (s)-[:NAMES {count: $count, environment: $environment}]->(p)", entry);
    for (const fact of input.facts) {
      await graph.run("CREATE (:Fact {id: $id, at: $at})", { id: fact.id, at: fact.at });
      if (fact.scene && scenes.has(fact.scene)) await graph.run("MATCH (f:Fact {id: $id}), (s:Scene {id: $scene}) CREATE (f)-[:IN_SCENE]->(s)", { id: fact.id, scene: fact.scene });
      for (const about of new Set(fact.about)) if (ids.has(about)) await graph.run("MATCH (f:Fact {id: $id}), (e:Entity {id: $about}) CREATE (f)-[:ABOUT]->(e)", { id: fact.id, about });
    }
    return graph;
  }

  async run(cypher: string, params?: Record<string, unknown>): Promise<Row[]> {
    const result = params ? await this.conn.execute(await this.conn.prepare(cypher), params as Record<string, never>) : await this.conn.query(cypher);
    const results: QueryResult[] = Array.isArray(result) ? result : [result];
    try { return (await results[0].getAll()) as Row[]; } finally { for (const entry of results) entry.close(); }
  }

  /** The latest facts about `id` read before `before`, newest first. */
  async factsAbout(id: string, before: number, limit: number): Promise<string[]> {
    const rows = await this.run("MATCH (f:Fact)-[:ABOUT]->(:Entity {id: $id}) WHERE f.at < $before RETURN f.id AS id ORDER BY f.at DESC LIMIT $limit", { id, before, limit });
    return rows.map((row) => String(row.id));
  }

  /** The facts about `id`, those about it alone first (a fact about one thing describes it; one about five only names it), then in reading order. */
  async factsOf(id: string, limit: number): Promise<{ id: string; subjects: number }[]> {
    const rows = await this.run("MATCH (f:Fact)-[:ABOUT]->(:Entity {id: $id}) MATCH (f)-[:ABOUT]->(e:Entity) RETURN f.id AS id, f.at AS at, count(e) AS subjects ORDER BY subjects, at LIMIT $limit", { id, limit });
    return rows.map((row) => ({ id: String(row.id), subjects: Number(row.subjects) }));
  }

  /** Facts about both places (one that names a district and its city), newest first. */
  async factsAboutBoth(a: string, b: string, limit: number): Promise<string[]> {
    const rows = await this.run("MATCH (f:Fact)-[:ABOUT]->(:Entity {id: $a}), (f)-[:ABOUT]->(:Entity {id: $b}) RETURN f.id AS id ORDER BY f.at DESC LIMIT $limit", { a, b, limit });
    return rows.map((row) => String(row.id));
  }

  /** Narrative adjacency: how often a scene naming `a` is right before or after one naming `b`. */
  async adjacentScenes(a: string, b: string): Promise<number> {
    const rows = await this.run("MATCH (s:Scene)-[:NAMES]->(:Entity {id: $a}), (t:Scene)-[:NAMES]->(:Entity {id: $b}) WHERE s.idx - t.idx = 1 OR t.idx - s.idx = 1 RETURN count(*) AS n", { a, b });
    return Number(rows[0]?.n ?? 0);
  }

  /** The scenes whose environment names both places. */
  async sharedSettings(a: string, b: string): Promise<number> {
    const rows = await this.run("MATCH (s:Scene)-[x:NAMES]->(:Entity {id: $a}), (s)-[y:NAMES]->(:Entity {id: $b}) WHERE x.environment AND y.environment RETURN count(*) AS n", { a, b });
    return Number(rows[0]?.n ?? 0);
  }

  async close(): Promise<void> { await this.conn.close(); await this.db.close(); }
}
